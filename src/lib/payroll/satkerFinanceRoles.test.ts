import assert from 'node:assert/strict';
import test from 'node:test';
import { canDeleteSatkerAccount, canEditAllSatkerFinance, canReadAllSatkerFinance } from './roles';

test('Badan Keuangan and Super Admin can edit every SatKer book', () => {
  assert.equal(canEditAllSatkerFinance('finance_verifier'), true);
  assert.equal(canEditAllSatkerFinance('super_admin'), true);
});

test('other roles still need to be on a unit editor list', () => {
  for (const role of ['rector_finance', 'satker_finance_admin', 'satker_head_loyalis', 'satker_head', undefined]) {
    assert.equal(canEditAllSatkerFinance(role), false, String(role));
  }
});

test('Badan Keuangan stays read-all', () => {
  assert.equal(canReadAllSatkerFinance('finance_verifier'), true);
});

test('the Kepala SatKer Loyalis of the book, Badan Keuangan and Super Admin can delete its accounts', () => {
  assert.equal(canDeleteSatkerAccount('satker_head_loyalis', true), true);
  assert.equal(canDeleteSatkerAccount('finance_verifier', false), true);
  assert.equal(canDeleteSatkerAccount('super_admin', false), true);
});

test('other editors and heads outside the book cannot delete accounts', () => {
  assert.equal(canDeleteSatkerAccount('satker_head_loyalis', false), false);
  assert.equal(canDeleteSatkerAccount('satker_finance_admin', true), false);
  assert.equal(canDeleteSatkerAccount('rector_finance', true), false);
});
