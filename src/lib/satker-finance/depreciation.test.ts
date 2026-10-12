import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_ACCOUNTS } from './core';
import {
  accumulatedDepreciation, assetChangeBlocker, assetFiguresChanged, buildDepreciationJournal, depreciationEntryId, depreciationForMonth,
  depreciationStatus, scheduledAccumulatedByAccount, suggestedAccumulatedAccountId, validateFixedAsset, type FixedAsset,
} from './depreciation';

const academicYear = '2026-2027';
// 13003 Kendaraan with 13012 Akum.Dep Kendaraan; 13004 Sarana & Perlengkapan with 13013; expense 54100 lain-lain.
const car: FixedAsset = {
  id: 'asset_car_0001', name: 'Mobil operasional', assetAccountId: '13003', accumulatedAccountId: '13012', expenseAccountId: '54100',
  acquisitionDate: '2026-09-15', cost: 240_000_001, residualValue: 0, usefulLifeMonths: 96,
};
const laptop: FixedAsset = {
  id: 'asset_laptop_01', name: 'Laptop keuangan', assetAccountId: '13004', accumulatedAccountId: '13013', expenseAccountId: '54100',
  acquisitionDate: '2026-10-03', cost: 12_000_000, residualValue: 0, usefulLifeMonths: 48,
};

test('straight-line depreciation starts in the acquisition month and adds up to exactly cost minus residual value', () => {
  assert.equal(depreciationForMonth(car, 2026, 8), 0);
  assert.equal(depreciationForMonth(car, 2026, 9), 2_500_000);
  assert.equal(depreciationForMonth(car, 2027, 1), 2_500_000, 'January follows December of the year before');
  assert.equal(accumulatedDepreciation(car, 2027, 8), 30_000_000);
  let total = 0;
  for (let index = 0; index < 100; index++) {
    const year = 2026 + Math.floor((8 + index) / 12);
    const month = (8 + index) % 12 + 1;
    const amount = depreciationForMonth(car, year, month);
    if (index >= 96) assert.equal(amount, 0, 'nothing after the useful life');
    total += amount;
  }
  assert.equal(total, 240_000_001, 'the odd Rupiah lands in a later month, so the total is exact');
  const withResidual = { ...car, cost: 10_000_000, residualValue: 1_000_000, usefulLifeMonths: 12 };
  assert.equal(depreciationForMonth(withResidual, 2026, 9), 750_000);
  assert.equal(accumulatedDepreciation(withResidual, 2030, 1), 9_000_000);
});

test('one journal per month, grouped by account, for the whole register', () => {
  assert.equal(depreciationEntryId(9), 'depreciation-09');
  const september = buildDepreciationJournal([car, laptop], DEFAULT_ACCOUNTS, academicYear, 9)!;
  assert.deepEqual(september.lines.map((line) => [line.accountCode, line.debit, line.credit]), [['54100', 2_500_000, 0], ['13012', 0, 2_500_000]]);
  const october = buildDepreciationJournal([car, laptop], DEFAULT_ACCOUNTS, academicYear, 10)!;
  assert.deepEqual(october.lines.map((line) => [line.accountCode, line.debit, line.credit]), [['54100', 2_750_000, 0], ['13012', 0, 2_500_000], ['13013', 0, 250_000]]);
  assert.deepEqual(october.assets.map((item) => [item.assetId, item.amount]), [['asset_laptop_01', 250_000], ['asset_car_0001', 2_500_000]]);
  assert.equal(october.total, 2_750_000);
  assert.equal(buildDepreciationJournal([car, laptop], DEFAULT_ACCOUNTS, '2025-2026', 8), null, 'nothing before the first acquisition');
  assert.throws(() => buildDepreciationJournal([{ ...car, expenseAccountId: '99999' }], DEFAULT_ACCOUNTS, academicYear, 9), /tidak dapat diposting/);
  const scheduled = scheduledAccumulatedByAccount([car, laptop], academicYear, 10);
  assert.equal(scheduled.get('13012'), 5_000_000);
  assert.equal(scheduled.get('13013'), 250_000);
});

test('a month is reported only with a journal that matches the register', () => {
  const expected = buildDepreciationJournal([car], DEFAULT_ACCOUNTS, academicYear, 9);
  assert.equal(depreciationStatus(null, undefined), 'NONE');
  assert.equal(depreciationStatus(expected, undefined), 'MISSING');
  assert.equal(depreciationStatus(expected, { lines: [...expected!.lines].reverse() }), 'POSTED', 'line order does not matter');
  assert.equal(depreciationStatus(expected, { lines: [{ ...expected!.lines[0], debit: 1 }, expected!.lines[1]] }), 'STALE');
  assert.equal(depreciationStatus(null, { lines: expected!.lines }), 'STALE', 'a journal for an asset no longer in the register');
});

test('an asset needs a debit asset account, a contra account, an expense account, and whole figures', () => {
  const raw = { name: ' Mobil ', assetAccountId: '13003', accumulatedAccountId: '13012', expenseAccountId: '54100', acquisitionDate: '2026-09-15', cost: 1_000_000, residualValue: 0, usefulLifeYears: 8 };
  assert.deepEqual(validateFixedAsset(raw, DEFAULT_ACCOUNTS), {
    name: 'Mobil', assetAccountId: '13003', accumulatedAccountId: '13012', expenseAccountId: '54100', acquisitionDate: '2026-09-15', cost: 1_000_000, residualValue: 0, usefulLifeMonths: 96,
  });
  assert.throws(() => validateFixedAsset({ ...raw, assetAccountId: '10000' }, DEFAULT_ACCOUNTS), /Akun aset/);
  assert.throws(() => validateFixedAsset({ ...raw, accumulatedAccountId: '13004' }, DEFAULT_ACCOUNTS), /pengurang/);
  assert.throws(() => validateFixedAsset({ ...raw, expenseAccountId: '41000' }, DEFAULT_ACCOUNTS), /Pengeluaran/);
  assert.throws(() => validateFixedAsset({ ...raw, residualValue: 1_000_000 }, DEFAULT_ACCOUNTS), /Nilai sisa/);
  assert.throws(() => validateFixedAsset({ ...raw, cost: 1.5 }, DEFAULT_ACCOUNTS), /Harga/);
  assert.throws(() => validateFixedAsset({ ...raw, usefulLifeYears: 0 }, DEFAULT_ACCOUNTS), /Umur/);
  assert.throws(() => validateFixedAsset({ ...raw, acquisitionDate: '2026-02-30' }, DEFAULT_ACCOUNTS), /Tanggal/);
  assert.equal(assetFiguresChanged(car, { ...car, name: 'Mobil dinas' }), false);
  assert.equal(assetFiguresChanged(car, { ...car, cost: car.cost + 1 }), true);
  // The catalog pairs each asset account with its accumulated-depreciation account (+9); land has none.
  assert.equal(suggestedAccumulatedAccountId('13002', DEFAULT_ACCOUNTS), '13011');
  assert.equal(suggestedAccumulatedAccountId('13005', DEFAULT_ACCOUNTS), '13014');
  assert.equal(suggestedAccumulatedAccountId('13001', DEFAULT_ACCOUNTS), '');
});

test('an asset\'s figures are frozen once its depreciation is in a sealed month or a closed year', () => {
  const posted = [{ monthIndex: 9, depreciation: { assets: [{ assetId: car.id, name: car.name, amount: 2_500_000 }] } }];
  const year = (status: string, reportStatus: string) => ({ academicYear, status, reports: [{ monthIndex: 9, status: reportStatus }], depreciationEntries: posted });
  assert.match(assetChangeBlocker(car.id, [year('ACTIVE', 'SUBMITTED')])!, /sudah masuk laporan/);
  assert.equal(assetChangeBlocker(car.id, [year('ACTIVE', 'DRAFT')]), null, 'an open month is simply re-posted');
  assert.equal(assetChangeBlocker(laptop.id, [year('ACTIVE', 'APPROVED')]), null, 'an asset in no journal');
  assert.match(assetChangeBlocker(car.id, [{ ...year('CLOSED', 'DRAFT') }])!, /sudah masuk laporan/);
});
