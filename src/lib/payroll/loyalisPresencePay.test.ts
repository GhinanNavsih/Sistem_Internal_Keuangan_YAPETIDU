import assert from 'node:assert/strict';
import test from 'node:test';
import {
  loyalisNetPresence,
  loyalisNetPresenceApplies,
  loyalisPresenceAmounts,
  loyalisPresenceBreakdown,
  summarizeLoyalisPresenceDelta,
} from './loyalisPresencePay';
import { buildInitialDeductions } from './slipBuilders';
import { mergeOwnedFields } from './slipPropagation';
import { loyalisPresenceOwnedPredicate } from './uraianPropagation';

const FULL_PRESENSI = Math.round(25 * 6.5 * 1650); // 268.125
const presence = {
  workingDays: 25,
  expectedHours: 6.5,
  entries: {
    STRATUM1: { absenceMinutes: 0, deduction: 0 },
    STRATUM2: { absenceMinutes: 690, deduction: 100_000 },
    STRATUM5: { absenceMinutes: 1_200, deduction: 250_000 },
    NOSCANS: { absenceMinutes: 25 * 6.5 * 60, deduction: 250_000 },
  },
};

test('net pay starts in November 2026, in either period spelling', () => {
  assert.equal(loyalisNetPresenceApplies('2026-10'), false);
  assert.equal(loyalisNetPresenceApplies('2026-11'), true);
  assert.equal(loyalisNetPresenceApplies('2026_11'), true);
  assert.equal(loyalisNetPresenceApplies('2027-01'), true);
  assert.equal(loyalisNetPresenceApplies(''), false);
  assert.equal(loyalisNetPresenceApplies(undefined), false);
});

test('before the attendance import a Loyalis earns no Presensi and no bonus', () => {
  const nothing = {
    presensiEarning: 0,
    presenceBonus: 0,
    presensiDeduction: 0,
    presenceDeduction: 0,
    imported: false,
    presensiShortfall: 0,
    bonusDeduction: 0,
  };
  assert.deepEqual(loyalisPresenceAmounts(null, 'L1', '2026-11'), nothing);
  assert.deepEqual(
    loyalisPresenceAmounts({ workingDays: 25, expectedHours: 6.5, entries: {} }, 'L1', '2026-11'),
    nothing,
  );
});

test('after the import Presensi and the bonus are paid net, with no deductions', () => {
  assert.deepEqual(loyalisPresenceAmounts(presence, 'STRATUM1', '2026-11'), {
    presensiEarning: FULL_PRESENSI,
    presenceBonus: 250_000,
    presensiDeduction: 0,
    presenceDeduction: 0,
    imported: true,
    presensiShortfall: 0,
    bonusDeduction: 0,
  });

  // 690 minutes short is Rp18.975 of Presensi and Stratum 2.
  assert.deepEqual(loyalisPresenceAmounts(presence, 'STRATUM2', '2026-11'), {
    presensiEarning: FULL_PRESENSI - 18_975,
    presenceBonus: 150_000,
    presensiDeduction: 0,
    presenceDeduction: 0,
    imported: true,
    presensiShortfall: 18_975,
    bonusDeduction: 100_000,
  });

  // Stratum 5 loses the bonus only; the minutes worked are still paid.
  const stratum5 = loyalisPresenceAmounts(presence, 'STRATUM5', '2026-11');
  assert.equal(stratum5.presenceBonus, 0);
  assert.equal(stratum5.presensiEarning, FULL_PRESENSI - 33_000);

  // No scans at all: the whole month is short, so nothing is earned.
  const noScans = loyalisPresenceAmounts(presence, 'NOSCANS', '2026-11');
  assert.equal(noScans.presensiEarning, 0);
  assert.equal(noScans.presenceBonus, 0);

  // Missing from an imported run: earns neither.
  const missing = loyalisPresenceAmounts(presence, 'MISSING', '2026-11');
  assert.equal(missing.presensiEarning + missing.presenceBonus, 0);
  assert.equal(missing.imported, true);
});

test('the net figure is exactly what the old earning minus its deduction paid', () => {
  for (const employeeId of Object.keys(presence.entries)) {
    const legacy = loyalisPresenceAmounts(presence, employeeId, '2026-10');
    const net = loyalisPresenceAmounts(presence, employeeId, '2026-11');
    assert.equal(net.presensiEarning, Math.max(0, legacy.presensiEarning - legacy.presensiDeduction), employeeId);
    assert.equal(net.presenceBonus, legacy.presenceBonus - legacy.presenceDeduction, employeeId);
  }
});

test('periods before November 2026 keep the legacy full-then-deduct amounts', () => {
  assert.deepEqual(loyalisPresenceAmounts(presence, 'STRATUM2', '2026-10'), {
    presensiEarning: FULL_PRESENSI,
    presenceBonus: 250_000,
    presensiDeduction: 18_975,
    presenceDeduction: 100_000,
    imported: true,
    presensiShortfall: 18_975,
    bonusDeduction: 100_000,
  });
  // Legacy pre-import default: everyone was credited in full.
  assert.deepEqual(loyalisPresenceAmounts(null, 'L1', '2026-10'), {
    presensiEarning: FULL_PRESENSI,
    presenceBonus: 250_000,
    presensiDeduction: 0,
    presenceDeduction: 0,
    imported: false,
    presensiShortfall: 0,
    bonusDeduction: 0,
  });
  assert.equal(
    loyalisPresenceAmounts(presence, 'MISSING', '2026-10').presensiEarning,
    0,
  );
  assert.equal(
    loyalisPresenceAmounts({ workingDays: 20, expectedHours: 7, entries: {} }, 'L1', '2026-10')
      .presensiEarning,
    Math.round(20 * 7 * 1650),
  );
});

test('a net-paid Loyalis slip has no Potongan Presensi rows; a legacy one keeps them at 0', () => {
  const labels = (period?: string) =>
    buildInitialDeductions({}, 'loyalis', 0, 0, 0, 0, period).map((field) => field.label);

  assert.equal(labels('2026-11').includes('Potongan Presensi'), false);
  assert.equal(labels('2026-11').includes('Potongan Bonus Presensi'), false);
  assert.equal(labels('2026-10').includes('Potongan Presensi'), true);
  assert.equal(labels('2026-10').includes('Potongan Bonus Presensi'), true);
  assert.equal(labels(undefined).includes('Potongan Presensi'), true);
});

test('propagating November presence removes the Potongan rows from a draft', () => {
  const stored = [
    { label: 'Pinjaman Kop. UNIPDU', amount: 100_000 },
    { label: 'Potongan Presensi', amount: 0 },
    { label: 'Potongan Bonus Presensi', amount: 0 },
    { label: 'Revisi Gaji', amount: 5_000 },
  ];
  const fresh = buildInitialDeductions({}, 'loyalis', 0, 0, 0, 0, '2026-11');
  const { merged, changes } = mergeOwnedFields(
    stored,
    fresh,
    loyalisPresenceOwnedPredicate('deductions'),
    'deductions',
  );
  assert.deepEqual(merged, [
    { label: 'Pinjaman Kop. UNIPDU', amount: 100_000 },
    { label: 'Revisi Gaji', amount: 5_000 },
  ]);
  assert.equal(changes.length, 2);
});

test('loyalisNetPresence never pays below zero', () => {
  const net = loyalisNetPresence({
    workingDays: 25,
    expectedHours: 6.5,
    absenceMinutes: 99_999,
    bonusDeduction: 999_999,
  });
  assert.equal(net.presensiEarning, 0);
  assert.equal(net.presensiShortfall, FULL_PRESENSI);
  assert.equal(net.presenceBonus, 0);
  assert.equal(net.bonusDeduction, 250_000);
});

test('the roster delta compares the slips with everyone present and on time', () => {
  const rows = [
    { employeeId: 'STRATUM1', absenceMinutes: 0, deduction: 0 },
    { employeeId: 'STRATUM2', absenceMinutes: 690, deduction: 100_000 },
    { employeeId: 'STRATUM5', absenceMinutes: 1_200, deduction: 250_000 },
    { employeeId: 'NOSCANS', absenceMinutes: 9_750, deduction: 250_000 },
    // A workbook row never linked to an employee is not on payroll.
    { employeeId: '', absenceMinutes: 0, deduction: 0 },
  ];
  const delta = summarizeLoyalisPresenceDelta(rows, 25, 6.5);

  assert.equal(delta.employeeCount, 4);
  assert.equal(delta.shortfallMinutes, 11_640);
  assert.deepEqual(delta.presensi, {
    ideal: 4 * FULL_PRESENSI,
    actual: FULL_PRESENSI + (FULL_PRESENSI - 18_975) + (FULL_PRESENSI - 33_000),
    delta: 18_975 + 33_000 + FULL_PRESENSI,
  });
  assert.deepEqual(delta.bonus, { ideal: 1_000_000, actual: 400_000, delta: 600_000 });
  assert.equal(delta.totalDelta, delta.presensi.delta + delta.bonus.delta);

  // The rows the page lists add up to the card's Realisasi.
  const rowSum = Object.keys(presence.entries).reduce(
    (sum, id) => sum + loyalisPresenceAmounts(presence, id, '2026-11').presensiEarning,
    0,
  );
  assert.equal(delta.presensi.actual, rowSum);
});

test('an orderly roster has no delta, and a re-linked row replaces the earlier one', () => {
  const orderly = summarizeLoyalisPresenceDelta(
    [
      { employeeId: 'A', absenceMinutes: 0, deduction: 0 },
      { employeeId: 'B', absenceMinutes: 0, deduction: 0 },
    ],
    25,
    6.5,
  );
  assert.equal(orderly.totalDelta, 0);

  const relinked = summarizeLoyalisPresenceDelta(
    [
      { employeeId: 'A', absenceMinutes: 690, deduction: 100_000 },
      { employeeId: 'A', absenceMinutes: 0, deduction: 0 },
    ],
    25,
    6.5,
  );
  assert.equal(relinked.employeeCount, 1);
  assert.equal(relinked.totalDelta, 0);

  assert.equal(summarizeLoyalisPresenceDelta([], 25, 6.5).employeeCount, 0);
});

test('the slip explanation reads a legacy slip and a net slip the same way', () => {
  const presenceInfo = {
    workingDays: 25,
    expectedHours: 6.5,
    absenceMinutes: 690,
    bonusDeduction: 100_000,
    imported: true,
  };
  const legacy = loyalisPresenceBreakdown({
    earnings: [
      { label: 'Presensi', amount: FULL_PRESENSI },
      { label: 'Bonus Presensi', amount: 250_000 },
    ],
    deductions: [
      { label: 'Potongan Presensi', amount: 18_975 },
      { label: 'Potongan Bonus Presensi', amount: 100_000 },
    ],
    presenceInfo,
  });
  const net = loyalisPresenceBreakdown({
    earnings: [
      { label: 'Presensi', amount: FULL_PRESENSI - 18_975 },
      { label: 'Bonus Presensi', amount: 150_000 },
    ],
    deductions: [],
    presenceInfo,
  });
  assert.deepEqual(net, legacy);
  assert.equal(net.netPresensi, FULL_PRESENSI - 18_975);
  assert.equal(net.grossPresensi, FULL_PRESENSI);
  assert.equal(net.netBonus, 150_000);
  assert.equal(net.stratum, 2);
  assert.equal(net.stratumRule, 'Kekurangan ≤ 750 menit');
  assert.equal(net.targetMinutes, 9_750);
  assert.equal(net.actualMinutes, 9_060);
});

test('the slip explanation says when attendance is not imported yet', () => {
  const pending = loyalisPresenceBreakdown({
    earnings: [
      { label: 'Presensi', amount: 0 },
      { label: 'Bonus Presensi', amount: 0 },
    ],
    deductions: [],
    presenceInfo: { workingDays: 25, expectedHours: 6.5, absenceMinutes: 0, bonusDeduction: 0, imported: false },
  });
  assert.equal(pending.imported, false);

  // A legacy slip was always credited, so it always has figures to explain.
  const legacy = loyalisPresenceBreakdown({
    earnings: [{ label: 'Presensi', amount: Math.round(20 * 7 * 1650) }],
    deductions: [{ label: 'Potongan Presensi', amount: 0 }],
    presenceInfo: { imported: false },
  });
  assert.equal(legacy.imported, true);
  // Without a schedule the legacy full earning still carries the target.
  assert.equal(legacy.targetMinutes, 20 * 7 * 60);
});
