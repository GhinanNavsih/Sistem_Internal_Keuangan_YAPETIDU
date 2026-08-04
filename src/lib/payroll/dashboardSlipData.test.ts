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
