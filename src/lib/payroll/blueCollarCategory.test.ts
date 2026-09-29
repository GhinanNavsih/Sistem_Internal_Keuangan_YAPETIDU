import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendJobCategoryChange,
  jobCategoryForPayrollPeriod,
  withPayrollJobCategory,
} from './blueCollarCategory';
import { buildPekaryaSlipPreview } from './pekaryaSlipPreview';

test('a 1 October Satpam transfer preserves September pay category and changes October', () => {
  const employee = {
    employment: { jobCategory: 'SATPAM', startDate: '2024-11-01' },
  };
  const history = appendJobCategoryChange(employee, 'KEBERSIHAN', '2026-10-01');
  const transferred = {
    employment: { ...employee.employment, jobCategory: 'KEBERSIHAN', jobCategoryHistory: history },
  };
  assert.equal(jobCategoryForPayrollPeriod(transferred, '2026-07'), 'SATPAM');
  assert.equal(jobCategoryForPayrollPeriod(transferred, '2026-08'), 'SATPAM');
  assert.equal(jobCategoryForPayrollPeriod(transferred, '2026-09'), 'SATPAM');
  assert.equal(jobCategoryForPayrollPeriod(transferred, '2026-10'), 'KEBERSIHAN');
});

test('a later transfer retains both earlier periods', () => {
  const september = {
    employment: {
      jobCategory: 'KEBERSIHAN',
      jobCategoryHistory: [
        { category: 'SATPAM', effectiveFrom: '2024-11-01' },
        { category: 'KEBERSIHAN', effectiveFrom: '2026-10-01' },
      ],
    },
  };
  const history = appendJobCategoryChange(september, 'TEKNISI', '2027-01-01');
  assert.equal(jobCategoryForPayrollPeriod({ employment: { jobCategory: 'TEKNISI', jobCategoryHistory: history } }, '2026-09'), 'SATPAM');
  assert.equal(jobCategoryForPayrollPeriod({ employment: { jobCategory: 'TEKNISI', jobCategoryHistory: history } }, '2026-10'), 'KEBERSIHAN');
});

test('an old profile keeps its current category; a same-month or backdated transfer fails', () => {
  assert.equal(jobCategoryForPayrollPeriod({ employment: { jobCategory: 'SATPAM' } }, '2026-09'), 'SATPAM');
  assert.throws(() => appendJobCategoryChange({ employment: { jobCategory: 'SATPAM' } }, 'KEBERSIHAN', '2026-09-29'));
  assert.throws(() => appendJobCategoryChange({ employment: { jobCategory: 'SATPAM', jobCategoryHistory: [{ category: 'SATPAM', effectiveFrom: '2026-10-01' }] } }, 'KEBERSIHAN', '2026-10-01'));
});

test('Sugeng September SPJ and both overtime labels survive an October category transfer', () => {
  const employee = {
    id: 'BC_061',
    salaryProfile: { salaryGradeCode: 'D' },
    employment: {
      jobCategory: 'KEBERSIHAN',
      startDate: '2024-11-01',
      jobCategoryHistory: [
        { category: 'SATPAM', effectiveFrom: '2024-11-01' },
        { category: 'KEBERSIHAN', effectiveFrom: '2026-10-01' },
      ],
    },
  };
  const september = buildPekaryaSlipPreview({
    employee: withPayrollJobCategory(employee, '2026-09'),
    period: '2026-09',
    targetDate: new Date(2026, 8, 1),
    salaryMatrix: { D: { 1: 200_000, 2: 210_000 } },
    uraianEntry: {
      employeeId: 'BC_061',
      name: 'Sugeng Prayitno Satpam',
      values: { lemburSendiri: 30_000, lemburCover: 100_000 },
      counts: { lemburSendiri: 1, lemburCover: 2 },
    } as NonNullable<Parameters<typeof buildPekaryaSlipPreview>[0]['uraianEntry']>,
    approvedActivitySpj: 242_500,
    approvedEventSpj: 0,
  });
  const amount = (label: string) => september.earnings.find((row) => row.label === label)?.amount;
  assert.equal(september.meta.jobCategory, 'SATPAM');
  assert.equal(amount('SPJ'), 242_500);
  assert.equal(amount('Lembur Sendiri'), 30_000);
  assert.equal(amount('Lembur Cover'), 100_000);

  const october = buildPekaryaSlipPreview({
    employee: withPayrollJobCategory(employee, '2026-10'),
    period: '2026-10',
    targetDate: new Date(2026, 9, 1),
    salaryMatrix: { D: { 1: 200_000, 2: 210_000 } },
  });
  assert.equal(october.meta.jobCategory, 'KEBERSIHAN');
  assert.equal(october.earnings.some((row) => row.label === 'Lembur Sendiri' || row.label === 'Lembur Cover'), false);
});
