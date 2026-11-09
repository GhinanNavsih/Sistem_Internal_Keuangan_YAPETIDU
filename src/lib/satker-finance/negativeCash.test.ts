import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_ACCOUNTS } from './core';
import { findNegativeCash } from './negativeCash';

const academicYear = '2026-2027';
const kasOpening = { '10000': { debit: 100_000, credit: 0 }, '11001': { debit: 1_000_000, credit: 0 } };

const lines = (...parts: [string, number, number][]) => parts.map(([accountCode, debit, credit]) => ({ accountCode, accountName: '', debit, credit }));
const saved = (id: string, date: string, ...parts: [string, number, number][]) => ({ id, date, academicYear, lines: lines(...parts) });
const spend = (amount: number) => lines(['52101', amount, 0], ['10000', 0, amount]);
const check = (draft: { date: string; amount: number }, entries = [] as ReturnType<typeof saved>[], extra: { editingEntryId?: string; opening?: typeof kasOpening } = {}) =>
  findNegativeCash({ accounts: DEFAULT_ACCOUNTS, opening: extra.opening ?? kasOpening, entries, academicYear, draft: { date: draft.date, lines: spend(draft.amount) }, editingEntryId: extra.editingEntryId });

test('spending more cash than KAS holds is reported with the first day and the lowest balance', () => {
  const entries = [saved('a', '2026-09-05', ['52101', 60_000, 0], ['10000', 0, 60_000])];
  const [dip, ...rest] = check({ date: '2026-09-10', amount: 50_000 }, entries);
  assert.equal(rest.length, 0);
  assert.equal(dip.accountCode, '10000');
  assert.equal(dip.firstDate, '2026-09-10');
  assert.equal(dip.lowest, -10_000);
});

test('spending within the balance is not reported', () => {
  const entries = [saved('a', '2026-09-05', ['52101', 60_000, 0], ['10000', 0, 60_000])];
  assert.deepEqual(check({ date: '2026-09-10', amount: 40_000 }, entries), []);
});

test('balances are read at the end of the day, so an expense and its withdrawal on one day do not warn', () => {
  const entries = [saved('withdraw', '2026-09-22', ['10000', 300_000, 0], ['11001', 0, 300_000])];
  assert.deepEqual(check({ date: '2026-09-22', amount: 300_000 }, entries), []);
});

test('a back-dated expense that makes a later day negative is reported on that later day', () => {
  const entries = [saved('a', '2026-09-20', ['52101', 60_000, 0], ['10000', 0, 60_000])];
  const [dip] = check({ date: '2026-09-05', amount: 50_000 }, entries);
  assert.equal(dip.firstDate, '2026-09-20');
  assert.equal(dip.lowest, -10_000);
});

test('a withdrawal that funds KAS does not warn while the bank stays positive', () => {
  const entries = [saved('a', '2026-09-05', ['52101', 150_000, 0], ['10000', 0, 150_000])];
  const withdrawal = lines(['10000', 200_000, 0], ['11001', 0, 200_000]);
  assert.deepEqual(findNegativeCash({ accounts: DEFAULT_ACCOUNTS, opening: kasOpening, entries, academicYear, draft: { date: '2026-09-06', lines: withdrawal } }), []);
});

test('a bank account taken below zero is reported too', () => {
  const draft = lines(['52101', 1_200_000, 0], ['11001', 0, 1_200_000]);
  const [dip] = findNegativeCash({ accounts: DEFAULT_ACCOUNTS, opening: kasOpening, entries: [], academicYear, draft: { date: '2026-09-06', lines: draft } });
  assert.equal(dip.accountCode, '11001');
  assert.equal(dip.lowest, -200_000);
});

test('editing a journal replaces it instead of counting it twice', () => {
  const entries = [saved('a', '2026-09-05', ['52101', 60_000, 0], ['10000', 0, 60_000])];
  assert.deepEqual(check({ date: '2026-09-05', amount: 90_000 }, entries, { editingEntryId: 'a' }), []);
  assert.equal(check({ date: '2026-09-05', amount: 90_000 }, entries).length, 1);
});

test('journals of another academic year and malformed dates are ignored', () => {
  const other = [{ ...saved('old', '2025-09-05', ['52101', 90_000, 0], ['10000', 0, 90_000]), academicYear: '2025-2026' }];
  assert.deepEqual(check({ date: '2026-09-10', amount: 50_000 }, other), []);
  assert.deepEqual(check({ date: '', amount: 500_000 }), []);
});
