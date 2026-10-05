import assert from 'node:assert/strict';
import test from 'node:test';
import {
  academicYearFor, buildFinancialStatements, buildVoucher, DEFAULT_ACCOUNTS,
  fiscalMonths, JournalEntry, validateEntryDate, validateOpeningBalances,
} from './core';

const academicYear = '2026-2027';
const opening = { '11001': { debit: 5_000_000, credit: 0 }, '30000': { debit: 0, credit: 5_000_000 } };

function entry(id: string, date: string, raw: Record<string, unknown>): JournalEntry {
  const voucher = buildVoucher({ date, description: `Voucher ${id}`, ...raw }, DEFAULT_ACCOUNTS);
  return { id, satkerId: 'puskomnet', academicYear, monthIndex: Number(date.slice(5, 7)), createdBy: 'test', ...voucher };
}

test('catalog faithfully includes 129 workbook codes and rejects empty placeholders', () => {
  assert.equal(DEFAULT_ACCOUNTS.length, 129);
  assert.equal(DEFAULT_ACCOUNTS.find((account) => account.code === '11001')?.name, 'Bank Mandiri');
  assert.equal(DEFAULT_ACCOUNTS.find((account) => account.code === '11002')?.postable, false);
  assert.throws(() => entry('invalid', '2026-09-02', { kind: 'EXPENSE', accountCode: '11002', paymentAccountCode: '10000', amount: 1 }), /tidak dapat diposting|memerlukan/);
});

test('a pengeluaran may debit any postable account except the cash account it is paid from', () => {
  const toBank = entry('to-bank', '2026-09-02', { kind: 'EXPENSE', accountCode: '11001', paymentAccountCode: '10000', amount: 750_000 });
  assert.deepEqual(toBank.lines.map((line) => [line.accountCode, line.debit, line.credit]), [['11001', 750_000, 0], ['10000', 0, 750_000]]);
  assert.throws(() => entry('same', '2026-09-02', { kind: 'EXPENSE', accountCode: '10000', paymentAccountCode: '10000', amount: 1 }), /harus berbeda/);
});

test('a penerimaan may credit any postable account except the cash account it is received in', () => {
  const refund = entry('refund', '2026-09-02', { kind: 'INFLOW', accountCode: '51000', paymentAccountCode: '10000', amount: 100_000 });
  assert.deepEqual(refund.lines.map((line) => [line.accountCode, line.debit, line.credit]), [['10000', 100_000, 0], ['51000', 0, 100_000]]);
  assert.throws(() => entry('same', '2026-09-02', { kind: 'INFLOW', accountCode: '10000', paymentAccountCode: '10000', amount: 1 }), /harus berbeda/);
});

test('September-August fiscal calendar and real dates are enforced', () => {
  assert.deepEqual(fiscalMonths(academicYear).map((month) => month.monthIndex), [9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(academicYearFor(new Date('2027-01-15T00:00:00Z')), academicYear);
  assert.doesNotThrow(() => validateEntryDate('2027-02-28', academicYear, 2));
  assert.throws(() => validateEntryDate('2027-02-29', academicYear, 2), /tidak valid/);
  assert.throws(() => validateEntryDate('2026-08-31', academicYear, 8), /di luar/);
});

test('opening balances and every journal line must balance exactly in whole Rupiah', () => {
  assert.deepEqual(validateOpeningBalances(opening, DEFAULT_ACCOUNTS), { debit: 5_000_000, credit: 5_000_000 });
  assert.throws(() => validateOpeningBalances({ '10000': { debit: 100, credit: 0 } }, DEFAULT_ACCOUNTS), /belum seimbang/);
  assert.throws(() => validateOpeningBalances({ '41000': { debit: 0, credit: 100 }, '10000': { debit: 100, credit: 0 } }, DEFAULT_ACCOUNTS), /tidak tersedia/);
  assert.throws(() => entry('bad', '2026-09-02', { kind: 'ADVANCED', cashFlowSection: 'OPERATING', lines: [
    { accountCode: '10000', debit: 100, credit: 0 }, { accountCode: '41000', debit: 0, credit: 90 },
  ] }), /harus seimbang/);
  assert.throws(() => entry('fraction', '2026-09-02', { kind: 'EXPENSE', accountCode: '52101', paymentAccountCode: '10000', amount: 1.5 }), /bulat/);
});

test('expense, droping, transfer, and investing vouchers reconcile ledger and cash flow', () => {
  const entries = [
    entry('droping', '2026-09-01', { kind: 'INFLOW', accountCode: '41000', paymentAccountCode: '11001', amount: 5_100_000 }),
    entry('expense', '2026-09-02', { kind: 'EXPENSE', accountCode: '52101', paymentAccountCode: '10000', amount: 655_000 }),
    entry('transfer', '2026-09-03', { kind: 'TRANSFER', accountCode: '10000', paymentAccountCode: '11001', amount: 1_000_000 }),
    entry('investment', '2026-09-04', { kind: 'EXPENSE', accountCode: '13005', paymentAccountCode: '11001', amount: 2_000_000 }),
  ];
  assert.deepEqual(entries[2].lines.map((line) => [line.accountCode, line.debit, line.credit]), [['10000', 1_000_000, 0], ['11001', 0, 1_000_000]]);
  const statements = buildFinancialStatements({ accounts: DEFAULT_ACCOUNTS, opening, entries, academicYear, monthIndex: 9 });
  assert.equal(statements.incomeStatement.income, 5_100_000);
  assert.equal(statements.incomeStatement.expense, 655_000);
  assert.equal(statements.cashFlow.OPERATING, 5_100_000 - 655_000);
  assert.equal(statements.cashFlow.INVESTING, -2_000_000);
  assert.equal(statements.cashFlow.FINANCING, 0);
  assert.equal(statements.cashFlow.endingCash, 5_000_000 + 5_100_000 - 655_000 - 2_000_000);
  assert.equal(statements.cashFlow.reconciliationDelta, 0);
  assert.equal(statements.trialBalance.difference, 0);
  assert.equal(statements.annualWorksheet.incomeDebit, statements.annualWorksheet.incomeCredit);
  assert.equal(statements.annualWorksheet.balanceDebit, statements.annualWorksheet.balanceCredit);
  assert.equal(statements.rows.find((row) => row.account.code === '10000')?.endingDebit, 345_000);
});

test('advanced accrual does not invent a cash flow and monthly balances chain into annual', () => {
  const entries = [
    entry('accrual', '2026-09-20', { kind: 'ADVANCED', lines: [
      { accountCode: '54101', debit: 100_000, credit: 0 }, { accountCode: '20001', debit: 0, credit: 100_000 },
    ] }),
    entry('october', '2026-10-01', { kind: 'INFLOW', accountCode: '41000', paymentAccountCode: '10000', amount: 200_000 }),
  ];
  const september = buildFinancialStatements({ accounts: DEFAULT_ACCOUNTS, opening, entries, academicYear, monthIndex: 9 });
  const october = buildFinancialStatements({ accounts: DEFAULT_ACCOUNTS, opening, entries, academicYear, monthIndex: 10 });
  const annual = buildFinancialStatements({ accounts: DEFAULT_ACCOUNTS, opening, entries, academicYear, monthIndex: 'ANNUAL' });
  assert.equal(september.cashFlow.netChange, 0);
  assert.equal(september.incomeStatement.expense, 100_000);
  assert.equal(october.cashFlow.openingCash, september.cashFlow.endingCash);
  assert.equal(october.cashFlow.netChange, 200_000);
  assert.equal(october.incomeStatement.expense, 0);
  assert.equal(annual.cashFlow.endingCash, october.cashFlow.endingCash);
  assert.equal(annual.trialBalance.difference, 0);
  assert.equal(annual.annualWorksheet.incomeDebit, annual.annualWorksheet.incomeCredit);
  assert.equal(annual.annualWorksheet.balanceDebit, annual.annualWorksheet.balanceCredit);
});
