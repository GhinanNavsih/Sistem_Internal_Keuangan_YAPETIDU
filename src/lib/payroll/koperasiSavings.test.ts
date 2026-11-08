import assert from 'node:assert/strict';
import test from 'node:test';
import { koperasiSavingsAmounts } from './koperasiSavings';
import { buildInitialDeductions } from './slipBuilders';
const member = { membershipStatus: 'approved', paymentStatus: 'Payroll Deduction', iuranPokok: 250000, iuranWajib: 25000,
  payrollSavings: { startPeriod: '2026-11', initialPeriod: '2026-11', initialPaid: false } };
test('initial contribution is assigned once to the first payroll month, independent of balance', () => {
  assert.deepEqual(koperasiSavingsAmounts(member, '2026-10'), { initial: 0, monthly: 0 });
  assert.deepEqual(koperasiSavingsAmounts(member, '2026-11'), { initial: 250000, monthly: 25000 });
  assert.deepEqual(koperasiSavingsAmounts({ ...member, payrollSavings: { ...member.payrollSavings, initialPaid: true } }, '2026-11'), { initial: 0, monthly: 25000 });
  assert.deepEqual(koperasiSavingsAmounts(member, '2026-12'), { initial: 0, monthly: 25000 });
});
test('subsidy, inactive and pending membership have no contribution; configured amounts are retained', () => {
  assert.deepEqual(koperasiSavingsAmounts({ ...member, paymentStatus: 'Yayasan Subsidy' }, '2026-11'), { initial: 0, monthly: 0 });
  assert.deepEqual(koperasiSavingsAmounts({ ...member, membershipStatus: 'Pending' }, '2026-11'), { initial: 0, monthly: 0 });
  assert.deepEqual(koperasiSavingsAmounts({ ...member, iuranPokok: 300000, iuranWajib: 50000 }, '2026-11'), { initial: 300000, monthly: 50000 });
});
test('both collars show separate registration and monthly deduction rows', () => {
  for (const collar of ['loyalis', 'pekarya']) {
    const rows = buildInitialDeductions({}, collar, 0, 0, 0, 25000, '2026-11', 250000);
    assert.equal(rows.find(row => row.label === 'Iuran Pokok Kop. UNIPDU')?.amount, 250000);
    assert.equal(rows.find(row => row.label === 'Iuran Wajib Kop. UNIPDU')?.amount, 25000);
  }
});
