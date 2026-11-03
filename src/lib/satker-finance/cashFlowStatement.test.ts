import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFinancialStatements, buildVoucher, DEFAULT_ACCOUNTS, type JournalEntry } from './core';
import { cashFlowStatementSections, journalReceiptRefs, movedCashFlowSections } from './cashFlowStatement';

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

test("a month prints every receipt of its journals by date, with the cash each journal moved", () => {
  const withReceipts = (value: JournalEntry, receiptCount: number) => ({ ...value, receiptCount });
  // The expense is owed instead of paid, so the journal touches no cash.
  const onCredit = (value: JournalEntry): JournalEntry => ({ ...value, lines: value.lines.map((line) => line.accountCode === '10000' ? { ...line, accountCode: '20001', accountName: 'Hutang Lain-Lain' } : line) });
  const entries = [
    withReceipts(entry('late', '2026-10-20', { kind: 'EXPENSE', accountCode: '52000', paymentAccountCode: '10000', amount: 500 }), 1),
    withReceipts(entry('early', '2026-10-03', { kind: 'INFLOW', accountCode: '41000', paymentAccountCode: '10000', amount: 8_150_000 }), 2),
    withReceipts(onCredit(entry('on-credit', '2026-10-10', { kind: 'EXPENSE', accountCode: '52000', paymentAccountCode: '10000', amount: 900 })), 1),
    withReceipts(entry('no-receipt', '2026-10-04', { kind: 'EXPENSE', accountCode: '52000', paymentAccountCode: '10000', amount: 700 }), 0),
    withReceipts(entry('other-month', '2026-09-02', { kind: 'INFLOW', accountCode: '41000', paymentAccountCode: '10000', amount: 999 }), 1),
  ];
  const refs = journalReceiptRefs({ entries, accounts: DEFAULT_ACCOUNTS, academicYear, monthIndex: 10 });

  assert.deepEqual(refs.map((ref) => [ref.entryId, ref.index, ref.count, ref.cashChange]), [['early', 0, 2, 8_150_000], ['early', 1, 2, 8_150_000], ['on-credit', 0, 1, 0], ['late', 0, 1, -500]]);
  assert.equal(refs.find((ref) => ref.entryId === 'on-credit')?.totalAmount, 900);
});

test('accounts with no movement that month can be left out without changing any total', () => {
  const entries = [entry('in', '2026-10-03', { kind: 'INFLOW', accountCode: '41000', paymentAccountCode: '10000', amount: 1_000 })];
  const sections = cashFlowStatementSections({ entries, accounts: DEFAULT_ACCOUNTS, academicYear, monthIndex: 10 });
  const moved = movedCashFlowSections(sections);

  assert.ok(sections.OPERATING.receipts.length > 1);
  assert.deepEqual(moved.OPERATING.receipts.map((row) => [row.code, row.amount]), [['41000', 1_000]]);
  assert.deepEqual(moved.OPERATING.payments, []);
  assert.equal(moved.OPERATING.receiptTotal, sections.OPERATING.receiptTotal);
  assert.equal(moved.OPERATING.net, sections.OPERATING.net);
});
