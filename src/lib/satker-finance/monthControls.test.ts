import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFinancialStatements, buildVoucher, DEFAULT_ACCOUNTS, type JournalEntry } from './core';
import { buildDepreciationJournal, depreciationEntryId, type FixedAsset } from './depreciation';
import { monthChecks, openingComesFromPreviousYear } from './monthControls';

const academicYear = '2026-2027';
const opening = { '11001': { debit: 5_000_000, credit: 0 }, '30000': { debit: 0, credit: 5_000_000 } };
const droping: JournalEntry = {
  id: 'droping-0001', satkerId: 'unit', academicYear, monthIndex: 9, createdBy: 'test',
  ...buildVoucher({ date: '2026-09-01', description: 'Droping', kind: 'INFLOW', accountCode: '41000', paymentAccountCode: '11001', amount: 1_000_000 }, DEFAULT_ACCOUNTS),
};
const car: FixedAsset = {
  id: 'asset_car_0001', name: 'Mobil operasional', assetAccountId: '13003', accumulatedAccountId: '13012', expenseAccountId: '54100',
  acquisitionDate: '2026-09-15', cost: 96_000_000, residualValue: 0, usefulLifeMonths: 96,
};
const bankMatched = { monthIndex: 9, accountId: '11001', statementBalance: 6_000_000, items: [] };

function checks(overrides: Partial<Parameters<typeof monthChecks>[0]> = {}) {
  const entries = overrides.entries as JournalEntry[] | undefined ?? [droping];
  const statements = buildFinancialStatements({ accounts: DEFAULT_ACCOUNTS, opening, entries, academicYear, monthIndex: 9 });
  const result = monthChecks({
    academicYear, monthIndex: 9, accounts: DEFAULT_ACCOUNTS, statements, entries, openingBalances: opening,
    previousYear: null, assets: [], reconciliations: [bankMatched], ...overrides,
  });
  return Object.fromEntries(result.map((check) => [check.id, check]));
}

test('a balanced, reconciled first-year month with no assets passes every check', () => {
  const result = checks();
  assert.deepEqual(Object.values(result).map((check) => [check.id, check.ok]), [['trial', true], ['cash', true], ['opening', true], ['depreciation', true], ['bank', true]]);
});

test('the bank statement must explain the book balance', () => {
  const result = checks({ reconciliations: [] });
  assert.equal(result.bank.ok, false);
  assert.match(result.bank.detail, /11001 Bank Mandiri \(belum diisi\)/);
  assert.match(checks({ reconciliations: [{ ...bankMatched, statementBalance: 5_999_000 }] }).bank.detail, /selisih Rp -1\.000/);
});

test('after the first year, the opening balance must be the previous year\'s closing', () => {
  assert.match(checks({ previousYear: { academicYear: '2025-2026', status: 'ACTIVE', entryCount: 4 } }).opening.detail, /belum ditutup/);
  assert.equal(checks({ previousYear: { academicYear: '2025-2026', status: 'ACTIVE', entryCount: 0 } }).opening.ok, true, 'an unused previous year does not count');
  assert.equal(checks({ previousYear: { academicYear: '2025-2026', status: 'CLOSED', closingBalances: opening } }).opening.ok, true);
  const different = checks({ previousYear: { academicYear: '2025-2026', status: 'CLOSED', closingBalances: { ...opening, '30000': { debit: 0, credit: 4_000_000 } } } });
  assert.match(different.opening.detail, /tidak sama/);
  // A year closed before closings were stored has nothing to carry: the next opening is typed in as before.
  assert.equal(openingComesFromPreviousYear({ academicYear: '2025-2026', status: 'CLOSED', closingBalances: null }), false);
  assert.equal(checks({ previousYear: { academicYear: '2025-2026', status: 'CLOSED', closingBalances: null } }).opening.ok, true);
  assert.equal(openingComesFromPreviousYear(null), false);
});

test('the month\'s depreciation must be posted and match the register', () => {
  assert.match(checks({ assets: [car] }).depreciation.detail, /Rp 1\.000\.000 belum diposting/);
  const journal = buildDepreciationJournal([car], DEFAULT_ACCOUNTS, academicYear, 9)!;
  const posted: JournalEntry = {
    id: depreciationEntryId(9), satkerId: 'unit', academicYear, monthIndex: 9, date: '2026-09-30', description: 'Penyusutan', kind: 'DEPRECIATION',
    lines: journal.lines, totalAmount: journal.total, cashFlowSection: null, createdBy: 'test',
  };
  assert.equal(checks({ assets: [car], entries: [droping, posted] }).depreciation.ok, true);
  assert.match(checks({ assets: [{ ...car, cost: 120_000_000 }], entries: [droping, posted] }).depreciation.detail, /Posting ulang/);
});
