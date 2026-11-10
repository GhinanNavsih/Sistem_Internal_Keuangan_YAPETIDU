import assert from 'node:assert/strict';
import test from 'node:test';
import { buildVoucher, DEFAULT_ACCOUNTS, fiscalMonths, type JournalEntry } from './core';
import { buildLedger, ledgerDisplayBalance, printableLedgers } from './ledger';

const academicYear = '2026-2027';
const months = fiscalMonths(academicYear);
const opening = { '10000': { debit: 100_000, credit: 0 }, '11001': { debit: 900_000, credit: 0 }, '30000': { debit: 0, credit: 1_000_000 } };

function entry(id: string, date: string, raw: Record<string, unknown>): JournalEntry {
  const voucher = buildVoucher({ date, description: `Voucher ${id}`, ...raw }, DEFAULT_ACCOUNTS);
  return { id, satkerId: 'psq', academicYear, monthIndex: Number(date.slice(5, 7)), createdBy: 'test', ...voucher };
}

const entries = [
  entry('sep', '2026-09-10', { kind: 'EXPENSE', accountCode: '52101', paymentAccountCode: '10000', amount: 30_000 }),
  entry('oct1', '2026-10-05', { kind: 'EXPENSE', accountCode: '52101', paymentAccountCode: '10000', amount: 90_000 }),
  entry('oct2', '2026-10-06', { kind: 'TRANSFER', accountCode: '10000', paymentAccountCode: '11001', amount: 500_000 }),
  entry('nov', '2026-11-03', { kind: 'EXPENSE', accountCode: '52101', paymentAccountCode: '10000', amount: 40_000 }),
];

test('a month lists only its own lines and starts from the balance the earlier months left', () => {
  const october = buildLedger({ entries, opening, accountCode: '10000', months, month: 10 });
  assert.equal(october.beginning, 70_000);
  assert.deepEqual(october.rows.map((row) => [row.date, row.debit, row.credit, row.balance]), [['2026-10-05', 0, 90_000, -20_000], ['2026-10-06', 500_000, 0, 480_000]]);
  assert.equal(october.ending, 480_000);
});

test('the academic year lists every line from the opening balance, and the months chain into it', () => {
  const annual = buildLedger({ entries, opening, accountCode: '10000', months, month: 'ANNUAL' });
  assert.equal(annual.beginning, 100_000);
  assert.equal(annual.rows.length, 4);
  assert.equal(annual.ending, 440_000);
  assert.equal(buildLedger({ entries, opening, accountCode: '10000', months, month: 11 }).beginning, 480_000);
  assert.equal(buildLedger({ entries, opening, accountCode: '10000', months, month: 11 }).ending, annual.ending);
});

test('a credit-normal account is shown positive and a debit-normal one keeps its sign', () => {
  const hutang = DEFAULT_ACCOUNTS.find((account) => account.code === '20001');
  const kas = DEFAULT_ACCOUNTS.find((account) => account.code === '10000');
  assert.equal(ledgerDisplayBalance(hutang, -125_450), 125_450);
  assert.equal(ledgerDisplayBalance(kas, -22_000), -22_000);
  assert.equal(Object.is(ledgerDisplayBalance(hutang, 0), 0), true);
});

test('a printed Buku Besar holds each account with an opening balance or a line, by code, in its normal direction', () => {
  const printed = printableLedgers({ accounts: DEFAULT_ACCOUNTS, entries, opening, months, month: 11 });
  assert.deepEqual(printed.map((ledger) => ledger.code), ['10000', '11001', '30000', '52101']);
  const kas = printed[0];
  assert.deepEqual([kas.beginning, kas.totalDebit, kas.totalCredit, kas.ending], [480_000, 0, 40_000, 440_000]);
  // 30000 MODAL has an opening balance but no November line; its credit balance prints positive.
  assert.deepEqual([printed[2].beginning, printed[2].rows.length, printed[2].ending], [1_000_000, 0, 1_000_000]);
  // 52101 is an expense: September-October spending is carried into the November opening.
  assert.equal(printed[3].beginning, 120_000);
});

test('an account picked by hand prints even when it has no balance and no line', () => {
  const idle = DEFAULT_ACCOUNTS.filter((account) => account.code === '41000');
  assert.deepEqual(printableLedgers({ accounts: idle, entries, opening, months, month: 11 }), []);
  const [ledger] = printableLedgers({ accounts: idle, entries, opening, months, month: 11, includeEmpty: true });
  assert.deepEqual([ledger.code, ledger.beginning, ledger.ending, ledger.rows.length], ['41000', 0, 0, 0]);
});
