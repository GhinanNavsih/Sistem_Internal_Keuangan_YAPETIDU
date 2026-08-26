import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDashboardSlipData,
  DashboardPeriodInputs,
  sumSlipFields,
} from './dashboardSlipData';

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

test('dashboard fallback uses the payroll builder for every deduction source', () => {
  const data = buildDashboardSlipData(
    {
      id: 'pekarya-1',
      employment: { startDate: '2026-01-01', jobCategory: 'SOPIR' },
      salaryProfile: { salaryGradeCode: 'A' },
      deductions: { koperasiRochmad: 50_000 },
      bpjs: { deductionAmount: 10_000 },
      tht: { deductionAmount: 20_000 },
      savings: { deductionAmount: 30_000 },
      ziz: { deductionAmount: 40_000 },
      pinlu: { deductionAmount: 50_000 },
    },
    'pekarya',
    undefined,
    inputs,
  );

  assert.equal(sumSlipFields(data.deductions), 825_000);
  assert.equal(sumSlipFields(data.earnings), 1_000_000);
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
    saved,
  );
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
    saved,
  );
});

test('a Pekarya without a preview never adopts the profile base salary', () => {
  // The preview map is keyed by employee id; an employee it does not cover
  // falls back to the matrix-driven builder, which is fed by calculateGapok —
  // salaryProfile.baseSalaryAmount is not a source anywhere in this path.
  const data = buildDashboardSlipData(
    PEKARYA_EMPLOYEE,
    'pekarya',
    undefined,
    { ...inputs, pekaryaPreviews: {} },
  );

  const gapok = data.earnings.find((field) => field.label === 'Gaji Pokok');
  assert.equal(gapok?.amount, 1_000_000);
  assert.notEqual(gapok?.amount, 777_000);
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
