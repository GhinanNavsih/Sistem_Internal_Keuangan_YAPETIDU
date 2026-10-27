import assert from 'node:assert/strict';
import test from 'node:test';
import type { FinancialAccount } from './core';
import { bookImportFrom, planBookAccounts } from './bookImport';

const catalog: FinancialAccount[] = [
  { id: '10000', code: '10000', name: 'KAS', type: 'AKTIVA', normalBalance: 'DEBIT', reportTarget: 'BALANCE_SHEET', postable: true, cashEquivalent: true, cashFlowSection: null },
  { id: '41000', code: '41000', name: 'Penerimaan Lain', type: 'TERIMA', normalBalance: 'CREDIT', reportTarget: 'INCOME_STATEMENT', postable: true, cashEquivalent: false, cashFlowSection: 'OPERATING' },
];

test('a code of the shared catalog becomes a unit override; any other code a unit account of its own', () => {
  const planned = planBookAccounts([
    { code: '10000', name: 'KAS SATKER', type: 'AKTIVA', contra: false },
    { code: '11003', name: 'BANK UNIPDU MANDIRI 141', type: 'AKTIVA', contra: false },
    { code: '41000', name: 'Droping', type: 'TERIMA', contra: false },
  ], 'pusat-studi', catalog);
  assert.deepEqual(planned.map((item) => [item.accountId, item.docId]), [
    ['10000', 'base_10000'],
    ['custom_pusat-studi_11003', 'custom_pusat-studi_11003'],
    ['41000', 'base_41000'],
  ]);
  assert.equal(planned[0].data.baseCode, '10000');
  assert.equal(planned[1].data.type, 'AKTIVA');
});

test('bank accounts are cash equivalents with no cash-flow section; payables default to operating, capital to financing', () => {
  const planned = planBookAccounts([
    { code: '11003', name: 'BANK', type: 'AKTIVA', contra: false },
    { code: '20001', name: 'Hutang Lain-Lain', type: 'HUTANG', contra: false },
    { code: '30000', name: 'Modal', type: 'MODAL', contra: false },
  ], 'pusat-studi', catalog);
  assert.deepEqual(planned.map((item) => [item.account.cashEquivalent, item.account.cashFlowSection, item.account.normalBalance]), [
    [true, null, 'DEBIT'],
    [false, 'OPERATING', 'CREDIT'],
    [false, 'FINANCING', 'CREDIT'],
  ]);
});

test('a contra account takes the side opposite its group', () => {
  const [planned] = planBookAccounts([{ code: '13101', name: 'Akumulasi penyusutan', type: 'AKTIVA', contra: true }], 'pusat-studi', catalog);
  assert.equal(planned.account.normalBalance, 'CREDIT');
  assert.equal(planned.account.cashFlowSection, 'INVESTING');
});

test('refuses a code used twice and a shared code whose group differs from the catalog', () => {
  assert.throws(() => planBookAccounts([
    { code: '11003', name: 'A', type: 'AKTIVA', contra: false },
    { code: '11003', name: 'B', type: 'AKTIVA', contra: false },
  ], 'pusat-studi', catalog), /11003 muncul lebih dari sekali/);
  assert.throws(() => planBookAccounts([{ code: '41000', name: 'Droping', type: 'KELUAR', contra: false }], 'pusat-studi', catalog), /41000 tidak sesuai katalog umum/);
});

const validBook = {
  accounts: [{ code: '10000', name: 'KAS', type: 'AKTIVA', contra: false }],
  opening: { '10000': { debit: 1000, credit: 0 } },
  vouchers: [{
    id: 'imp-uji-r7', date: '2026-09-04', description: 'Setoran',
    lines: [{ code: '10000', debit: 1000, credit: 0, description: '' }, { code: '10000', debit: 0, credit: 1000, description: '' }],
  }],
};

test('accepts a well-formed book', () => {
  assert.deepEqual(bookImportFrom(validBook), validBook);
});

test('refuses a book that is not in the expected shape', () => {
  assert.throws(() => bookImportFrom({ ...validBook, accounts: [] }), /1–400 akun/);
  assert.throws(() => bookImportFrom({ ...validBook, opening: { '10000': { debit: 1.5, credit: 0 } } }), /Rupiah bulat/);
  assert.throws(() => bookImportFrom({ ...validBook, vouchers: [{ ...validBook.vouchers[0], lines: [validBook.vouchers[0].lines[0]] }] }), /2–30 baris/);
  assert.throws(() => bookImportFrom({ ...validBook, accounts: [{ code: 'KAS', name: 'x', type: 'AKTIVA', contra: false }] }), /harus berupa angka/);
});
