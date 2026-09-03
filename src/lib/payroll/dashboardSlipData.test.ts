import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDashboardSlipData,
  DashboardPeriodInputs,
  sumSlipFields,
} from './dashboardSlipData';
import { PAYROLL_TAX_LABEL } from './payrollTax';
import { loyalisPresenceAmounts } from './uraianPropagation';

const inputs: DashboardPeriodInputs = {
  targetDate: new Date(2026, 7, 1),
  salaryMatrix: { A: { 0: 1_000_000 } },
  uraianMap: {},
  vakasiTambahanMap: {},
  vakasiTambahanListMap: {},
  functionalAllowanceMap: {},
  kepangkatanAllowanceMap: {},
  koperasiDeductions: { 'pekarya-1': 600_000 },
  koperasiSavings: { 'pekarya-1': 25_000 },
  loyalisPresenceData: null,
};

test('Loyalis fallback uses the payroll builder for every deduction source', () => {
  const data = buildDashboardSlipData(
    {
      id: 'pekarya-1',
      employment_profile: { date_of_hire: '2026-01-01' },
      academic_and_tier: { level_code: 'A' },
      deductions: { koperasiRochmad: 50_000 },
      bpjs: { deductionAmount: 10_000 },
      tht: { deductionAmount: 20_000 },
      savings: { deductionAmount: 30_000 },
      ziz: { deductionAmount: 40_000 },
      pinlu: { deductionAmount: 50_000 },
    },
    'loyalis',
    undefined,
    inputs,
  );

  assert.equal(sumSlipFields(data.deductions), 825_000);
});

test('a persisted slip remains authoritative over fallback calculations', () => {
  const saved = {
    earnings: [{ label: 'Gaji Pokok', amount: 9_000_000 }],
    deductions: [{ label: 'BPJS', amount: 99_000 }],
  };

  assert.deepEqual(
    buildDashboardSlipData(
      { id: 'pekarya-1', employment: { jobCategory: 'SOPIR' } },
      'pekarya',
      saved,
      inputs,
    ),
    // An untaxed slip returns the same rows plus an empty tax category.
    { ...saved, taxes: [] },
  );
});

test('a persisted tax selection is exposed separately and recalculated from its rows', () => {
  const data = buildDashboardSlipData(
    { id: 'pekarya-1', employment: { jobCategory: 'SOPIR' } },
    'pekarya',
    {
      earnings: [{ label: 'Gaji Pokok', amount: 10_000_000 }],
      deductions: [{ label: 'BPJS', amount: 1_000_000 }],
      taxApplied: true,
      // A stale stored amount must not leak into the dashboard aggregate.
      taxes: [{ label: PAYROLL_TAX_LABEL, amount: 1 }],
    },
    inputs,
  );

  assert.deepEqual(data.deductions, [{ label: 'BPJS', amount: 1_000_000 }]);
  assert.deepEqual(data.taxes, [
    { label: PAYROLL_TAX_LABEL, amount: 450_000 },
  ]);
});

// ─── Persisted-state precedence for Pekarya ──────────────────────────────

const PEKARYA_EMPLOYEE = {
  id: 'pekarya-1',
  employment: { startDate: '2026-01-01', jobCategory: 'SOPIR' },
  salaryProfile: { salaryGradeCode: 'A', baseSalaryAmount: 777_000 },
};

const LIVE_PREVIEW = {
  earnings: [
    { label: 'Gaji Pokok', amount: 269_000 },
    { label: 'SPJ', amount: 553_068 },
  ],
  gapok: 269_000,
  meta: {
    employeeId: 'pekarya-1',
    jobCategory: 'SOPIR',
    period: '2026-08',
    matrixVersion: '2026_v1',
    gradeLevel: 'A',
    serviceYears: 28,
    effectiveMatrixYear: 28,
    gapokStatus: 'ok' as const,
    spjSource: 'activity_and_events' as const,
    attendanceSource: 'piket_estimate' as const,
    isProvisional: true,
    canCreateSlip: true,
    warnings: [],
  },
};

const inputsWithPreview: DashboardPeriodInputs = {
  ...inputs,
  pekaryaPreviews: { 'pekarya-1': LIVE_PREVIEW },
};

test('no persisted state falls through to the shared live preview', () => {
  const data = buildDashboardSlipData(
    PEKARYA_EMPLOYEE,
    'pekarya',
    undefined,
    inputsWithPreview,
  );

  assert.deepEqual(data.earnings, LIVE_PREVIEW.earnings);
  assert.equal(sumSlipFields(data.earnings), 822_068);
});

test('an editable draft keeps its saved values over the live preview', () => {
  const saved = {
    earnings: [{ label: 'Gaji Pokok', amount: 264_750 }],
    deductions: [{ label: 'BPJS', amount: 1_000 }],
  };

  assert.deepEqual(
    buildDashboardSlipData(PEKARYA_EMPLOYEE, 'pekarya', saved, inputsWithPreview),
    { ...saved, taxes: [] },
  );
});

test('a Pekarya without a preview fails closed instead of using local values', () => {
  const data = buildDashboardSlipData(
    PEKARYA_EMPLOYEE,
    'pekarya',
    undefined,
    { ...inputs, pekaryaPreviews: {} },
  );

  assert.deepEqual(data, { earnings: [], deductions: [], taxes: [] });
});

test('an explicitly empty saved Pekarya draft remains authoritative', () => {
  const data = buildDashboardSlipData(
    PEKARYA_EMPLOYEE,
    'pekarya',
    { earnings: [], deductions: [] },
    inputsWithPreview,
  );

  assert.deepEqual(data, { earnings: [], deductions: [], taxes: [] });
});

test('Loyalis is unaffected by the Pekarya preview map', () => {
  const loyalis = buildDashboardSlipData(
    {
      id: 'pekarya-1',
      employment_profile: { date_of_hire: '2026-01-01', department_unit: 'Staf' },
      academic_and_tier: { level_code: 'A' },
    },
    'loyalis',
    undefined,
    inputsWithPreview,
  );

  const gapok = loyalis.earnings.find((field) => field.label === 'Gaji Pokok');
  assert.equal(gapok?.amount, 1_000_000);
});

test('the dashboard reads Loyalis presence through the shared propagation maths', () => {
  // Guards the consolidation: the dashboard used to reimplement these four
  // amounts with its own hardcoded 250000/1650/25/6.5 literals, so a slip built
  // here could disagree with one propagated onto a saved draft. Both sides now
  // go through loyalisPresenceAmounts, so this asserts the dashboard's rendered
  // rows match that function's output exactly.
  const presence = {
    workingDays: 20,
    expectedHours: 7,
    entries: { 'pekarya-1': { deduction: 15_000, absenceMinutes: 120 } },
  };
  const expected = loyalisPresenceAmounts(presence, 'pekarya-1');

  const data = buildDashboardSlipData(
    {
      id: 'pekarya-1',
      employment_profile: { date_of_hire: '2026-01-01', department_unit: 'Staf' },
      academic_and_tier: { level_code: 'A' },
    },
    'loyalis',
    undefined,
    { ...inputs, loyalisPresenceData: presence },
  );

  const amountOf = (fields: { label: string; amount: number }[], label: string) =>
    fields.find((field) => field.label === label)?.amount;

  assert.equal(amountOf(data.earnings, 'Presensi'), expected.presensiEarning);
  assert.equal(amountOf(data.earnings, 'Bonus Presensi'), expected.presenceBonus);
  assert.equal(amountOf(data.deductions, 'Potongan Presensi'), expected.presensiDeduction);
  assert.equal(
    amountOf(data.deductions, 'Potongan Bonus Presensi'),
    expected.presenceDeduction,
  );

  // And the shared function is actually doing the arithmetic, not a constant.
  assert.equal(expected.presensiEarning, Math.round(20 * 7 * 1_650));
  assert.equal(expected.presensiDeduction, Math.round((120 / 60) * 1_650));
});

test('historical period with saved slips resolves immediately without pekaryaPreviews', () => {
  const savedSlip = {
    earnings: [
      { label: 'Gaji Pokok', amount: 3_500_000 },
      { label: 'SPJ', amount: 450_000 },
    ],
    deductions: [{ label: 'BPJS', amount: 50_000 }],
  };

  const data = buildDashboardSlipData(
    PEKARYA_EMPLOYEE,
    'pekarya',
    savedSlip,
    // pekaryaPreviews is explicitly undefined (e.g. historical closed month)
    { ...inputs, pekaryaPreviews: undefined },
  );

  assert.deepEqual(data, { ...savedSlip, taxes: [] });
  assert.equal(sumSlipFields(data.earnings), 3_950_000);
  assert.equal(sumSlipFields(data.deductions), 50_000);
});
