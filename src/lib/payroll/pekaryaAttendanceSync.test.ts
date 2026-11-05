import assert from 'node:assert/strict';
import test from 'node:test';
import {
  attendanceHoldReason,
  attendanceSyncSource,
  buildAutoPublishedEntries,
  isAttendanceHeld,
  type AttendanceSyncEmployee,
  type AttendanceSyncView,
} from './pekaryaAttendanceSync';

function employee(overrides: Partial<AttendanceSyncEmployee> = {}): AttendanceSyncEmployee {
  return {
    employeeId: 'BC_001',
    name: 'Sugeng',
    publishBlocked: false,
    warnings: [],
    harianAmount: 37_500,
    jumatLiburAmount: 25_001,
    harianCount: 3,
    jumatLiburCount: 1,
    presenceBonus: { amount: 100_000 },
    ...overrides,
  };
}

function view(employees: AttendanceSyncEmployee[], overrides: Partial<AttendanceSyncView> = {}): AttendanceSyncView {
  return {
    category: 'KEBERSIHAN',
    importRevisionId: '2026_11__r0001',
    calendarRevision: 1,
    singleScanPolicy: 'work_window_inferred',
    employees,
    ...overrides,
  };
}

test('a held employee is named by the NIPY problem it has', () => {
  assert.equal(attendanceHoldReason(employee()), null);
  assert.equal(attendanceHoldReason(employee({ publishBlocked: true, warnings: ['NIPY_MISSING'] })), 'NIPY_MISSING');
  assert.equal(attendanceHoldReason(employee({ publishBlocked: true, warnings: ['NIPY_DUPLICATE', 'INCOMPLETE_PUNCH'] })), 'NIPY_DUPLICATE');
});

test('the sync source ignores employee order and warnings that do not change pay', () => {
  const a = employee();
  const b = employee({ employeeId: 'BC_002', name: 'Budi' });
  assert.equal(
    attendanceSyncSource(view([a, b]), 'bonusPresensi'),
    attendanceSyncSource(view([b, { ...a, warnings: ['INCOMPLETE_PUNCH'] }]), 'bonusPresensi'),
  );
});

test('the sync source changes with any written figure, revision or hold', () => {
  const base = attendanceSyncSource(view([employee()]), 'bonusPresensi');
  const variants = [
    view([employee({ harianAmount: 35_577 })]),
    view([employee({ jumatLiburCount: 2 })]),
    view([employee({ presenceBonus: { amount: 50_000 } })]),
    view([employee({ name: 'Sugeng Riyadi' })]),
    view([employee({ publishBlocked: true, warnings: ['NIPY_DUPLICATE'] })]),
    view([employee()], { importRevisionId: '2026_11__r0002' }),
    view([employee()], { calendarRevision: 2 }),
    view([employee()], { singleScanPolicy: 'offset_150_minutes' }),
  ];
  for (const variant of variants) {
    assert.notEqual(attendanceSyncSource(variant, 'bonusPresensi'), base);
  }
});

test('written entries keep other columns and replace only attendance figures', () => {
  const existing = {
    BC_001: {
      employeeId: 'BC_001',
      name: 'Sugeng',
      values: { harian: 1, jumatLibur: 2, spj: 75_000, presensi: 9 },
      counts: { harian: 9, lembur: 4 },
    },
    BC_OTHER: { employeeId: 'BC_OTHER', name: 'Outside the view', values: { spj: 10 } },
  };
  const result = buildAutoPublishedEntries(existing, view([employee()]), {
    bonusKey: 'bonusPresensi',
    publicationRevision: 4,
  });
  assert.deepEqual(result.entries.BC_001, {
    employeeId: 'BC_001',
    name: 'Sugeng',
    values: { harian: 37_500, jumatLibur: 25_001, spj: 75_000, bonusPresensi: 100_000 },
    counts: { harian: 3, jumatLibur: 1, lembur: 4 },
    attendanceSource: {
      singleScanPolicy: 'work_window_inferred',
      importRevisionId: '2026_11__r0001',
      calendarRevision: 1,
      publicationRevision: 4,
    },
  });
  assert.deepEqual(result.entries.BC_OTHER, existing.BC_OTHER);
  assert.deepEqual(result.totals, { harian: 3, jumatLibur: 1, amount: 62_501, employeeCount: 1 });
  assert.deepEqual(result.heldEmployees, []);
  // The input is never mutated.
  assert.equal(existing.BC_001.values.harian, 1);
});

test('a category without a presence bonus never writes one', () => {
  const result = buildAutoPublishedEntries({}, view([employee()], { category: 'SOPIR' }), {
    bonusKey: null,
    publicationRevision: 1,
  });
  assert.deepEqual(result.entries.BC_001.values, { harian: 37_500, jumatLibur: 25_001 });
});

test('a held employee keeps their money, is marked held and is left out of the totals', () => {
  const existing = {
    BC_001: { employeeId: 'BC_001', name: 'Sugeng', values: { harian: 12_500, spj: 5 }, counts: { harian: 1 } },
  };
  const held = employee({ publishBlocked: true, warnings: ['NIPY_DUPLICATE'], harianAmount: 99_999 });
  const other = employee({ employeeId: 'BC_002', name: 'Budi' });
  const result = buildAutoPublishedEntries(existing, view([held, other]), {
    bonusKey: 'bonusPresensi',
    publicationRevision: 2,
  });
  assert.deepEqual(result.entries.BC_001, {
    employeeId: 'BC_001',
    name: 'Sugeng',
    values: { harian: 12_500, spj: 5 },
    counts: { harian: 1 },
    attendanceHold: { reason: 'NIPY_DUPLICATE' },
  });
  assert.equal(isAttendanceHeld(result.entries.BC_001), true);
  assert.equal(isAttendanceHeld(result.entries.BC_002), false);
  assert.deepEqual(result.heldEmployees, [{ employeeId: 'BC_001', name: 'Sugeng', reason: 'NIPY_DUPLICATE' }]);
  assert.deepEqual(result.totals, { harian: 3, jumatLibur: 1, amount: 62_501, employeeCount: 1 });
});

test('a held employee with no rekap entry yet gets an empty held one', () => {
  const held = employee({ publishBlocked: true, warnings: ['NIPY_MISSING'] });
  const result = buildAutoPublishedEntries({}, view([held]), { bonusKey: null, publicationRevision: 1 });
  assert.deepEqual(result.entries.BC_001, {
    values: {},
    employeeId: 'BC_001',
    name: 'Sugeng',
    attendanceHold: { reason: 'NIPY_MISSING' },
  });
});

test('fixing the NIPY releases the hold and writes the figures', () => {
  const existing = {
    BC_001: { employeeId: 'BC_001', name: 'Sugeng', values: {}, attendanceHold: { reason: 'NIPY_MISSING' } },
  };
  const result = buildAutoPublishedEntries(existing, view([employee()]), { bonusKey: null, publicationRevision: 3 });
  assert.equal(isAttendanceHeld(result.entries.BC_001), false);
  assert.equal('attendanceHold' in result.entries.BC_001, false);
  assert.equal((result.entries.BC_001.values as Record<string, number>).harian, 37_500);
});
