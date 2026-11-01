import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFinancialStatements, buildVoucher, DEFAULT_ACCOUNTS, type JournalEntry } from './core';
import { cashFlowStatementSections } from './cashFlowStatement';

const academicYear = '2026-2027';

function entry(id: string, date: string, raw: Record<string, unknown>): JournalEntry {
  const voucher = buildVoucher({ date, description: `Voucher ${id}`, ...raw }, DEFAULT_ACCOUNTS);
  return { id, satkerId: 'puskomnet', academicYear, monthIndex: Number(date.slice(5, 7)), createdBy: 'test', ...voucher };
}

test('a month lists cash received and paid by account, and its sections add up to the cash change', () => {
  const entries = [
    entry('in', '2026-10-03', { kind: 'INFLOW', accountCode: '41000', paymentAccountCode: '10000', amount: 8_150_000 }),
    entry('out', '2026-10-05', { kind: 'EXPENSE', accountCode: '52000', paymentAccountCode: '10000', amount: 2_212_500 }),
    entry('other-month', '2026-09-02', { kind: 'INFLOW', accountCode: '41000', paymentAccountCode: '10000', amount: 999 }),
  ];
  const sections = cashFlowStatementSections({ entries, accounts: DEFAULT_ACCOUNTS, academicYear, monthIndex: 10 });

  assert.deepEqual(sections.OPERATING.receipts.filter((row) => row.amount).map((row) => [row.code, row.amount]), [['41000', 8_150_000]]);
  assert.deepEqual(sections.OPERATING.payments.filter((row) => row.amount).map((row) => [row.code, row.amount]), [['52000', 2_212_500]]);
  assert.equal(sections.OPERATING.net, 8_150_000 - 2_212_500);
  assert.equal(sections.INVESTING.net, 0);
  assert.equal(sections.FINANCING.net, 0);

  const statement = buildFinancialStatements({ accounts: DEFAULT_ACCOUNTS, opening: {}, entries, academicYear, monthIndex: 10 });
  assert.equal(sections.OPERATING.net + sections.INVESTING.net + sections.FINANCING.net, statement.cashFlow.netChange);
});

test('income and expense accounts with no movement are listed at zero, balance-sheet accounts are not', () => {
  const entries = [entry('in', '2026-10-03', { kind: 'INFLOW', accountCode: '41000', paymentAccountCode: '10000', amount: 1_000 })];
  const sections = cashFlowStatementSections({ entries, accounts: DEFAULT_ACCOUNTS, academicYear, monthIndex: 10 });

  assert.ok(sections.OPERATING.receipts.some((row) => row.code === '42000' && row.amount === 0));
  assert.ok(sections.OPERATING.payments.some((row) => row.code === '52100' && row.amount === 0));
  assert.deepEqual(sections.INVESTING.receipts, []);
  assert.deepEqual(sections.INVESTING.payments, []);
  assert.equal(sections.OPERATING.receiptTotal, 1_000);
});
