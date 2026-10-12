import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_ACCOUNTS } from './core';
import { accountsToReconcile, adjustedStatementBalance, reconciliationDocId, reconciliationStates, validateReconciliationInput } from './bankReconciliation';

const account = (code: string) => DEFAULT_ACCOUNTS.find((item) => item.code === code)!;
const row = (code: string, endingDebit: number, endingCredit: number, periodDebit = 0, periodCredit = 0) => ({ account: account(code), endingDebit, endingCredit, periodDebit, periodCredit });

test('a reconciliation holds whole Rupiah amounts and described timing items', () => {
  assert.deepEqual(validateReconciliationInput({ statementBalance: 1_000, items: [{ kind: 'DEPOSIT_IN_TRANSIT', description: ' Setoran 30/9 ', amount: 200 }], note: ' ' }),
    { statementBalance: 1_000, items: [{ kind: 'DEPOSIT_IN_TRANSIT', description: 'Setoran 30/9', amount: 200 }] });
  assert.throws(() => validateReconciliationInput({ statementBalance: 1.5, items: [] }), /Rupiah bulat/);
  assert.throws(() => validateReconciliationInput({ statementBalance: 1, items: [{ kind: 'BANK_FEE', description: 'x', amount: 1 }] }), /Jenis/);
  assert.throws(() => validateReconciliationInput({ statementBalance: 1, items: [{ kind: 'OUTSTANDING_PAYMENT', description: ' ', amount: 1 }] }), /Uraian/);
  assert.throws(() => validateReconciliationInput({ statementBalance: 1, items: [{ kind: 'OUTSTANDING_PAYMENT', description: 'x', amount: 0 }] }), /lebih dari nol/);
  assert.throws(() => validateReconciliationInput({ statementBalance: 1, items: Array.from({ length: 51 }, () => ({ kind: 'OUTSTANDING_PAYMENT', description: 'x', amount: 1 })) }), /maksimal 50/);
  assert.equal(reconciliationDocId(9, '11001'), '09_11001');
});

test('deposits in transit add to the statement, payments the bank has not debited yet subtract', () => {
  assert.equal(adjustedStatementBalance({ statementBalance: 1_000, items: [
    { kind: 'DEPOSIT_IN_TRANSIT', description: 'Setoran', amount: 200 }, { kind: 'OUTSTANDING_PAYMENT', description: 'Cek', amount: 50 },
  ] }), 1_150);
});

test('every cash or bank account with a balance or movement must match its outside figure', () => {
  const rows = [row('11001', 5_000_000, 0), row('10000', 0, 0, 100, 100), row('41000', 0, 900), row('12001', 300, 0)];
  // Only cash-equivalent accounts, and KAS too although its balance is back to zero: it moved this month.
  assert.deepEqual(accountsToReconcile(rows).map((item) => item.account.code), ['11001', '10000']);
  assert.deepEqual(accountsToReconcile([row('10000', 0, 0)]), [], 'an idle, empty account needs nothing');
  const missing = reconciliationStates(rows, [], 9);
  assert.deepEqual(missing.map((state) => [state.account.code, state.status]), [['11001', 'MISSING'], ['10000', 'MISSING']]);
  const matched = reconciliationStates(rows, [
    { monthIndex: 9, accountId: '11001', statementBalance: 5_100_000, items: [{ kind: 'OUTSTANDING_PAYMENT', description: 'Cek ke CV Maju', amount: 100_000 }] },
    { monthIndex: 9, accountId: '10000', statementBalance: 0, items: [] },
    { monthIndex: 10, accountId: '10000', statementBalance: 999, items: [] },
  ], 9);
  assert.deepEqual(matched.map((state) => [state.account.code, state.status, state.difference]), [['11001', 'MATCHED', 0], ['10000', 'MATCHED', 0]]);
  const different = reconciliationStates(rows, [{ monthIndex: 9, accountId: '11001', statementBalance: 5_000_050, items: [] }], 9);
  assert.deepEqual([different[0].status, different[0].difference, different[0].bookBalance], ['DIFFERENT', 50, 5_000_000]);
});
