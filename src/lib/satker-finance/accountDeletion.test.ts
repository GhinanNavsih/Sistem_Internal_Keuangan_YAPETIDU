import assert from 'node:assert/strict';
import test from 'node:test';
import { accountDeletionBlocker, journalsUsingAccount, openingHasValue, openingWithout } from './accountDeletion';

const line = (accountCode: string) => ({ accountCode, accountName: 'Akun', debit: 1, credit: 0 });
const entries = [
  { id: 'voucher-2', date: '2026-10-05', description: 'Beli ATK', lines: [line('52101'), line('10000')] },
  { id: 'voucher-1', date: '2026-09-02', description: 'Setoran', lines: [line('11001'), line('10000')] },
  { id: 'reverse_voucher-2', date: '2026-10-06', description: 'Pembalikan', lines: [line('10000')] },
];
const none = { journals: [], openingYears: [], fixedAssets: 0, reconciliations: 0 };

test('journals are found by the account on their lines, oldest first', () => {
  assert.deepEqual(journalsUsingAccount(entries, '10000').map((journal) => journal.id), ['voucher-1', 'voucher-2', 'reverse_voucher-2']);
  assert.deepEqual(journalsUsingAccount(entries, '52101').map((journal) => journal.id), ['voucher-2']);
  assert.deepEqual(journalsUsingAccount(entries, '99999'), []);
});

test('an opening balance counts only when a debit or credit is set', () => {
  assert.equal(openingHasValue({ '10000': { debit: 0, credit: 0 } }, '10000'), false);
  assert.equal(openingHasValue({ '10000': { debit: 5, credit: 0 } }, '10000'), true);
  assert.equal(openingHasValue({ '10000': { debit: 0, credit: 5 } }, '10000'), true);
  assert.equal(openingHasValue({ '10000': { debit: 5, credit: 0 } }, '30000'), false);
});

test('removing an account keeps the other opening rows', () => {
  assert.deepEqual(openingWithout({ '10000': { debit: 0, credit: 0 }, '30000': { debit: 0, credit: 5 } }, '10000'), { '30000': { debit: 0, credit: 5 } });
});

test('nothing blocks an unused account', () => {
  assert.equal(accountDeletionBlocker(none, 'Akun 52990'), null);
});

test('journals block first and name the first ones', () => {
  const message = accountDeletionBlocker({ ...none, journals: journalsUsingAccount(entries, '10000'), openingYears: ['2026-2027'] }, 'Akun 10000 Kas');
  assert.match(message ?? '', /dipakai di 3 jurnal \(2026-09-02 Setoran; 2026-10-05 Beli ATK; 2026-10-06 Pembalikan\)/);
  assert.match(message ?? '', /Hapus jurnal tersebut di tab Jurnal/);
});

test('more than three journals are counted, not all listed', () => {
  const many = Array.from({ length: 5 }, (_, index) => ({ id: `v${index}`, date: `2026-09-0${index + 1}`, description: '', lines: [line('52101')] }));
  const message = accountDeletionBlocker({ ...none, journals: journalsUsingAccount(many, '52101') }, 'Akun 52101');
  assert.match(message ?? '', /dipakai di 5 jurnal \(2026-09-01 v0; 2026-09-02 v1; 2026-09-03 v2, dan 2 lainnya\)/);
});

test('opening balances, fixed assets and reconciliations each block', () => {
  assert.match(accountDeletionBlocker({ ...none, openingYears: ['2025-2026', '2026-2027'] }, 'Akun 10000') ?? '', /saldo awal pada tahun buku 2025-2026, 2026-2027/);
  assert.match(accountDeletionBlocker({ ...none, fixedAssets: 2 }, 'Akun 12101') ?? '', /dipakai oleh 2 aset tetap/);
  assert.match(accountDeletionBlocker({ ...none, reconciliations: 1 }, 'Akun 10000') ?? '', /rekonsiliasi bank tersimpan/);
});
