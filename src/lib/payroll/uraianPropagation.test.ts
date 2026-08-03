import assert from 'node:assert/strict';
import test from 'node:test';
import { buildInitialEarnings } from './slipBuilders';
import { mergeOwnedFields } from './slipPropagation';
import {
  loyalisPresenceAmounts,
  loyalisPresenceOwnedPredicate,
  uraianOwnedEarningPredicate,
} from './uraianPropagation';

test('the rekap owns its own slip columns and nothing else', () => {
  const owns = uraianOwnedEarningPredicate('SOPIR');
  assert.equal(owns('Vakasi Harian'), true);
  assert.equal(owns('Jumat & Libur'), true);
  assert.equal(owns('SPJ'), true);
  assert.equal(owns('  spj  '), true, 'matching is case- and space-insensitive');
  // Profile-owned rows must survive an Uraian save untouched.
  assert.equal(owns('Gaji Pokok'), false);
  assert.equal(owns('BPJS (Tunjangan)'), false);
  assert.equal(owns('Tunjangan Beras'), false);
  assert.equal(owns('Struktural: Kepala Unit'), false);
});

test('a published attendance entry swaps Presensi for the Harian pair', () => {
  const legacy = uraianOwnedEarningPredicate('KEBERSIHAN', {
    employeeId: 'BC_1',
    name: 'x',
    values: { presensi: 500_000 },
  });
  assert.equal(legacy('Presensi'), true);

  const published = uraianOwnedEarningPredicate('KEBERSIHAN', {
    employeeId: 'BC_1',
    name: 'x',
    values: { harian: 30, jumatLibur: 1 },
  });
  assert.equal(published('Vakasi Harian'), true);
  assert.equal(published('Jumat & Libur'), true);
  assert.equal(published('Presensi'), false);
});

test('custom rekap columns propagate without a code change', () => {
  const owns = uraianOwnedEarningPredicate('SOPIR', undefined, [
    { key: 'custom_x', label: 'Uang Makan', type: 'currency', slipLabel: 'Uang Makan' },
  ]);
  assert.equal(owns('Uang Makan'), true);
});

test('a locked rekap reaches the slip without disturbing other rows', () => {
  // What the employee currently sees: zero placeholders for the rekap rows,
  // and figures that came from elsewhere.
  const storedEarnings = [
    { label: 'Gaji Pokok', amount: 1_000_000 },
    { label: 'Vakasi Harian', amount: 0 },
    { label: 'Jumat & Libur', amount: 0 },
    { label: 'SPJ', amount: 0 },
    { label: 'Tunjangan Beras', amount: 250_000 },
  ];
  const entry = {
    employeeId: 'BC_1',
    name: 'Pekarya',
    values: { harian: 375_000, jumatLibur: 50_000, spj: 120_000 },
    counts: { harian: 30, jumatLibur: 2 },
  };
  const fresh = buildInitialEarnings(
    { employment: { jobCategory: 'KEBERSIHAN' } },
    0,
    'blue',
    entry,
  );
  const { merged, changes } = mergeOwnedFields(
    storedEarnings,
    fresh,
    uraianOwnedEarningPredicate('KEBERSIHAN', entry),
    'earnings',
  );

  const amountOf = (label: string) => merged.find((f) => f.label === label)?.amount;
  assert.equal(amountOf('Vakasi Harian'), 375_000);
  assert.equal(amountOf('Jumat & Libur'), 50_000);
  assert.equal(amountOf('SPJ'), 120_000);
  // Untouched, even though the builder emitted Gaji Pokok 0 and no Beras row.
  assert.equal(amountOf('Gaji Pokok'), 1_000_000);
  assert.equal(amountOf('Tunjangan Beras'), 250_000);
  // Rekap columns the stored slip never had are appended, so the slip ends up
  // carrying the full rekap structure rather than a partial one.
  assert.equal(amountOf('Bonus Presensi'), 0);
  assert.equal(amountOf('Tunjangan Khusus'), 0);
  assert.equal(merged.length, storedEarnings.length + 2);
  assert.equal(changes.length, 5);
  // Original rows keep their position; appends go to the end.
  assert.deepEqual(
    merged.slice(0, storedEarnings.length).map((f) => f.label),
    storedEarnings.map((f) => f.label),
  );
});

test('re-running propagation over an already-synced slip is a no-op', () => {
  const entry = {
    employeeId: 'BC_1',
    name: 'Pekarya',
    values: { harian: 375_000 },
    counts: { harian: 30 },
  };
  const fresh = buildInitialEarnings(
    { employment: { jobCategory: 'KEBERSIHAN' } },
    0,
    'blue',
    entry,
  );
  const owns = uraianOwnedEarningPredicate('KEBERSIHAN', entry);
  const first = mergeOwnedFields(
    [{ label: 'Vakasi Harian', amount: 0 }],
    fresh,
    owns,
    'earnings',
  );
  const second = mergeOwnedFields(first.merged, fresh, owns, 'earnings');
  assert.equal(second.changes.length, 0, 'converges, so repeated saves stop writing');
});

test('Loyalis presence amounts match the payroll dashboard formulas', () => {
  const presence = {
    workingDays: 25,
    expectedHours: 6.5,
    entries: {
      L1: { absenceMinutes: 120, deduction: 50_000 },
      L2: { absenceMinutes: 0, deduction: 0 },
    },
  };

  assert.deepEqual(loyalisPresenceAmounts(presence, 'L1'), {
    presensiEarning: Math.round(25 * 6.5 * 1650),
    presenceBonus: 250_000,
    presensiDeduction: Math.round((120 / 60) * 1650),
    presenceDeduction: 50_000,
  });

  // Present in the run with a clean record: full earning, no deductions.
  assert.deepEqual(loyalisPresenceAmounts(presence, 'L2'), {
    presensiEarning: Math.round(25 * 6.5 * 1650),
    presenceBonus: 250_000,
    presensiDeduction: 0,
    presenceDeduction: 0,
  });

  // Absent from a run that has entries: earns neither.
  assert.deepEqual(loyalisPresenceAmounts(presence, 'MISSING'), {
    presensiEarning: 0,
    presenceBonus: 0,
    presensiDeduction: 0,
    presenceDeduction: 0,
  });

  // No presence document yet: everyone is credited in full, matching the
  // dashboard's deliberate pre-calculation default.
  assert.deepEqual(loyalisPresenceAmounts(null, 'L1'), {
    presensiEarning: Math.round(25 * 6.5 * 1650),
    presenceBonus: 250_000,
    presensiDeduction: 0,
    presenceDeduction: 0,
  });

  // Configured working days drive the earning.
  assert.equal(
    loyalisPresenceAmounts({ workingDays: 20, expectedHours: 7, entries: {} }, 'L1')
      .presensiEarning,
    Math.round(20 * 7 * 1650),
  );
});

test('Loyalis presence owns only its four rows', () => {
  const earnings = loyalisPresenceOwnedPredicate('earnings');
  const deductions = loyalisPresenceOwnedPredicate('deductions');

  assert.equal(earnings('Presensi'), true);
  assert.equal(earnings('Bonus Presensi'), true);
  assert.equal(earnings('Gaji Pokok'), false);
  assert.equal(earnings('T. Keluarga'), false);

  assert.equal(deductions('Potongan Presensi'), true);
  assert.equal(deductions('Potongan Bonus Presensi'), true);
  // Finance types this by hand; a presence run must never clear it.
  assert.equal(deductions('Revisi Gaji'), false);
  assert.equal(deductions('BPJS'), false);
  assert.equal(deductions('Pinjaman Kop. UNIPDU'), false);
});
