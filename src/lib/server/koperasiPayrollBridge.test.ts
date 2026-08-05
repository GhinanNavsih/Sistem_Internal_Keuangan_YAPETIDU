import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hashKoperasiInstallmentPlan,
  koperasiLoanDeduction,
  replaceKoperasiLoanDeduction,
} from './koperasiPayrollBridge';

test('Koperasi loan deduction recognizes canonical aliases only', () => {
  assert.equal(
    koperasiLoanDeduction([
      { label: 'Pinjaman Kop. UNIPDU', amount: 325_000 },
      { label: 'Pinjaman Koperasi', amount: 100_000 },
      { label: 'Iuran Wajib Kop. UNIPDU', amount: 25_000 },
      { label: 'Koperasi Rochmad', amount: 50_000 },
    ]),
    425_000,
  );
});

test('legacy repair replaces exactly one Koperasi loan deduction total', () => {
  const repaired = replaceKoperasiLoanDeduction([
    { label: 'BPJS', amount: 50_000 },
    { label: 'Pinjaman Kop. UNIPDU', amount: 100_000 },
    { label: 'Pinjaman Koperasi', amount: 200_000 },
  ], 325_000);

  assert.equal(koperasiLoanDeduction(repaired), 325_000);
  assert.deepEqual(repaired, [
    { label: 'BPJS', amount: 50_000 },
    { label: 'Pinjaman Kop. UNIPDU', amount: 325_000 },
    { label: 'Pinjaman Koperasi', amount: 0 },
  ]);
});

test('sealed Koperasi plan hash changes with installment state', () => {
  const plan = {
    schemaVersion: 1 as const,
    payrollPeriod: '2026-07',
    matchType: 'uid' as const,
    resolvedUserId: 'koperasi-user-1',
    expectedDeduction: 325_000,
    loans: [{
      loanId: 'loan-1',
      borrowerUserId: 'koperasi-user-1',
      installmentAmount: 325_000,
      paidBefore: 10,
      paidAfter: 11,
      tenor: 12,
      balanceBefore: 650_000,
      balanceAfter: 325_000,
      willPayOff: false,
    }],
  };
  const original = hashKoperasiInstallmentPlan(plan);
  assert.equal(original.length, 64);
  assert.notEqual(
    original,
    hashKoperasiInstallmentPlan({
      ...plan,
      loans: [{ ...plan.loans[0], paidBefore: 11, paidAfter: 12 }],
    }),
  );
});
