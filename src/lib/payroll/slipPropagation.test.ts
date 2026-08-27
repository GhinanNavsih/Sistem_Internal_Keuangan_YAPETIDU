import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertOnlyOwnedChanged,
  assertOnlyProfileOwnedChanged,
  classifySlipForPropagation,
  isPayRelevantChange,
  isProfileOwnedLabel,
  mergeOwnedFields,
  mergeProfileOwnedFields,
  resolvePropagationPeriods,
} from './slipPropagation';

// A stored draft carrying values that came from somewhere other than the
// employee profile. None of these may ever move.
const storedDeductions = [
  { label: 'Koperasi Rochmad', amount: 0 },
  { label: 'BPJS', amount: 0 },
  { label: 'Tabungan', amount: 100_000 },
  { label: 'Revisi Gaji', amount: 500_000 },
  { label: 'Pinjaman Kop. UNIPDU', amount: 250_000 },
  { label: 'Potongan Presensi', amount: 268_125 },
];

const storedEarnings = [
  { label: 'Gaji Pokok', amount: 4_000_000 },
  { label: 'SPJ', amount: 1_200_000 },
  { label: 'Vakasi Harian', amount: 375_000 },
  { label: 'Presensi', amount: 268_125 },
  { label: 'Beras', amount: 250_000 },
];

test('non-profile rows survive a merge untouched', () => {
  const fresh = [
    { label: 'Koperasi Rochmad', amount: 0 },
    { label: 'BPJS', amount: 0 },
    { label: 'Tabungan', amount: 100_000 },
    // The builders always emit these at zero; the stored values must win.
    { label: 'Revisi Gaji', amount: 0 },
    { label: 'Pinjaman Kop. UNIPDU', amount: 0 },
    { label: 'Potongan Presensi', amount: 0 },
  ];
  const { merged, changes } = mergeProfileOwnedFields(storedDeductions, fresh, 'deductions');
  assert.deepEqual(merged, storedDeductions);
  assert.deepEqual(changes, []);
});

test('a changed BPJS deduction rewrites exactly one row and keeps the order', () => {
  const fresh = [
    { label: 'Koperasi Rochmad', amount: 0 },
    { label: 'BPJS', amount: 472_878 },
    { label: 'Tabungan', amount: 100_000 },
    { label: 'Revisi Gaji', amount: 0 },
  ];
  const { merged, changes } = mergeProfileOwnedFields(storedDeductions, fresh, 'deductions');

  assert.equal(merged.length, storedDeductions.length);
  assert.deepEqual(
    merged.map((field) => field.label),
    storedDeductions.map((field) => field.label),
  );
  assert.equal(merged.find((field) => field.label === 'BPJS')?.amount, 472_878);
  assert.equal(merged.find((field) => field.label === 'Revisi Gaji')?.amount, 500_000);
  assert.deepEqual(changes, [
    { kind: 'deductions', label: 'BPJS', oldValue: 0, newValue: 472_878 },
  ]);
});

test('earnings the profile does not own are never rewritten', () => {
  // A fresh server build has no uraian/presence data, so these come back at 0.
  const fresh = [
    { label: 'Gaji Pokok', amount: 4_500_000 },
    { label: 'SPJ', amount: 0 },
    { label: 'Vakasi Harian', amount: 0 },
    { label: 'Presensi', amount: 0 },
    { label: 'Beras', amount: 300_000 },
  ];
  const { merged, changes } = mergeProfileOwnedFields(storedEarnings, fresh, 'earnings');

  assert.equal(merged.find((field) => field.label === 'SPJ')?.amount, 1_200_000);
  assert.equal(merged.find((field) => field.label === 'Vakasi Harian')?.amount, 375_000);
  assert.equal(merged.find((field) => field.label === 'Presensi')?.amount, 268_125);
  assert.equal(merged.find((field) => field.label === 'Gaji Pokok')?.amount, 4_500_000);
  assert.equal(merged.find((field) => field.label === 'Beras')?.amount, 300_000);
  assert.equal(changes.length, 2);
});

test('owned rows are appended when new and removed when the profile drops them', () => {
  const stored = [
    { label: 'Struktural: Kepala Unit', amount: 1_000_000 },
    { label: 'Revisi Gaji', amount: 250_000 },
  ];
  const fresh = [
    { label: 'Struktural: Sekretaris', amount: 400_000 },
    { label: 'Revisi Gaji', amount: 0 },
  ];
  const { merged, changes } = mergeProfileOwnedFields(stored, fresh, 'earnings');

  assert.deepEqual(merged, [
    { label: 'Revisi Gaji', amount: 250_000 },
    { label: 'Struktural: Sekretaris', amount: 400_000 },
  ]);
  assert.deepEqual(changes, [
    { kind: 'earnings', label: 'Struktural: Kepala Unit', oldValue: 1_000_000, newValue: null },
    { kind: 'earnings', label: 'Struktural: Sekretaris', oldValue: null, newValue: 400_000 },
  ]);
});

test('the label allowlist fails closed', () => {
  assert.equal(isProfileOwnedLabel('deductions', 'BPJS'), true);
  assert.equal(isProfileOwnedLabel('deductions', ' bpjs '), true);
  assert.equal(isProfileOwnedLabel('deductions', 'Revisi Gaji'), false);
  assert.equal(isProfileOwnedLabel('earnings', 'Struktural: Kepala Unit'), true);
  assert.equal(isProfileOwnedLabel('earnings', 'Tunjangan Beras'), true);
  // Rekap-sourced columns must never be claimed by the profile.
  assert.equal(isProfileOwnedLabel('earnings', 'SPJ'), false);
  assert.equal(isProfileOwnedLabel('earnings', 'Tunjangan Jabatan'), false);
  assert.equal(isProfileOwnedLabel('earnings', 'Vakasi Harian'), false);
  assert.equal(isProfileOwnedLabel('earnings', 'Bonus Presensi'), false);
  // 'BPJS' is a deduction label; as an earning only the allowance row is owned.
  assert.equal(isProfileOwnedLabel('earnings', 'BPJS'), false);
  assert.equal(isProfileOwnedLabel('earnings', 'BPJS (Tunjangan)'), true);
});

test('the transaction guard rejects collateral damage', () => {
  const tampered = storedEarnings.map((field) =>
    field.label === 'SPJ' ? { ...field, amount: 0 } : field,
  );
  assert.throws(
    () => assertOnlyProfileOwnedChanged(storedEarnings, tampered, 'earnings'),
    /di luar sumbernya/,
  );
  const dropped = storedEarnings.filter((field) => field.label !== 'Presensi');
  assert.throws(
    () => assertOnlyProfileOwnedChanged(storedEarnings, dropped, 'earnings'),
    /menghapus baris di luar sumbernya/,
  );
  const legitimate = storedEarnings.map((field) =>
    field.label === 'Beras' ? { ...field, amount: 300_000 } : field,
  );
  assert.doesNotThrow(() =>
    assertOnlyProfileOwnedChanged(storedEarnings, legitimate, 'earnings'),
  );
});

test('only draft slips in an open period may be rewritten', () => {
  assert.equal(classifySlipForPropagation(true, 'draft', false), 'eligible');
  assert.equal(classifySlipForPropagation(false, undefined, false), 'no_slip');
  assert.equal(classifySlipForPropagation(true, 'retired_status', false), 'blocked_status');
  for (const status of ['confirmed', 'locked', 'payment_created', 'paid']) {
    assert.equal(classifySlipForPropagation(true, status, false), 'immutable');
  }
  // A closed period outranks whatever the slip status says.
  assert.equal(classifySlipForPropagation(true, 'draft', true), 'period_closed');
  assert.equal(classifySlipForPropagation(true, 'locked', true), 'period_closed');
});

test('propagation targets the open periods payroll is actually working on', () => {
  const noneClosed = () => false;
  // 1 August, July still open: the edit belongs to both live periods.
  assert.deepEqual(
    resolvePropagationPeriods(new Date(2026, 7, 1), noneClosed),
    ['2026-07', '2026-08'],
  );
  // Once July closes, it is out of reach.
  assert.deepEqual(
    resolvePropagationPeriods(new Date(2026, 7, 1), (period) => period === '2026-07'),
    ['2026-08'],
  );
  // From the 6th the previous month is no longer being compiled.
  assert.deepEqual(
    resolvePropagationPeriods(new Date(2026, 7, 10), noneClosed),
    ['2026-08'],
  );
  // Year boundary.
  assert.deepEqual(
    resolvePropagationPeriods(new Date(2027, 0, 3), noneClosed),
    ['2026-12', '2027-01'],
  );
  // Everything closed: nothing to write.
  assert.deepEqual(resolvePropagationPeriods(new Date(2026, 7, 1), () => true), []);
});

test('pay relevance is decided by profile path prefix', () => {
  assert.equal(isPayRelevantChange(['bpjs.deductionAmount']), true);
  assert.equal(isPayRelevantChange(['salaryProfile.tunjanganBeras']), true);
  assert.equal(isPayRelevantChange(['employment_profile.structural_positions.0.allowance']), true);
  assert.equal(isPayRelevantChange(['t_instruksional']), true);
  assert.equal(isPayRelevantChange(['personal_info.phone']), false);
  assert.equal(isPayRelevantChange(['personal_info.phone', 'ziz.deductionAmount']), true);
  assert.equal(isPayRelevantChange([]), false);
});

// ── Single-label ownership, as used by the historical SPJ correction ────────
// That route replaces exactly one row ('SPJ') on an already-saved draft. It
// used to rewrite the earnings array by hand with no check that nothing else
// moved; it now composes mergeOwnedFields + assertOnlyOwnedChanged like every
// other slip writer, so the composition is pinned here.

const isSpjLabel = (label: string) => label.trim().toUpperCase() === 'SPJ';

const storedSpjEarnings = [
  { label: 'Gaji Pokok', amount: 1_000_000 },
  { label: 'SPJ', amount: 50_000 },
  { label: 'Tunjangan Jabatan', amount: 100_000 },
];

test('an SPJ correction rewrites only the SPJ row and keeps the order', () => {
  const { merged } = mergeOwnedFields(
    storedSpjEarnings,
    [{ label: 'SPJ', amount: 75_000 }],
    isSpjLabel,
    'earnings',
  );

  assert.deepEqual(merged, [
    { label: 'Gaji Pokok', amount: 1_000_000 },
    { label: 'SPJ', amount: 75_000 },
    { label: 'Tunjangan Jabatan', amount: 100_000 },
  ]);
  assert.doesNotThrow(() =>
    assertOnlyOwnedChanged(storedSpjEarnings, merged, isSpjLabel),
  );
});

test('an SPJ correction appends the row when the slip has none', () => {
  const stored = [{ label: 'Gaji Pokok', amount: 1_000_000 }];
  const { merged } = mergeOwnedFields(
    stored,
    [{ label: 'SPJ', amount: 75_000 }],
    isSpjLabel,
    'earnings',
  );

  assert.deepEqual(merged, [
    { label: 'Gaji Pokok', amount: 1_000_000 },
    { label: 'SPJ', amount: 75_000 },
  ]);
  assert.doesNotThrow(() => assertOnlyOwnedChanged(stored, merged, isSpjLabel));
});

test('an SPJ correction that moved a row it does not own is rejected', () => {
  // Simulates a gathering bug: the merge output has Gaji Pokok altered and
  // Tunjangan Jabatan dropped, neither of which this correction owns.
  const corrupted = [
    { label: 'Gaji Pokok', amount: 999 },
    { label: 'SPJ', amount: 75_000 },
  ];

  assert.throws(
    () => assertOnlyOwnedChanged(storedSpjEarnings, corrupted, isSpjLabel),
    /di luar sumbernya/,
  );
});
