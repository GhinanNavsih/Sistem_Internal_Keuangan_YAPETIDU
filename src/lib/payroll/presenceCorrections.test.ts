import assert from 'node:assert/strict';
import test from 'node:test';
import {
  correctionTimeLabel,
  correctionTypeLabel,
  isPresenceCorrectionType,
  isPresenceCorrectionVisibleToEmployee,
} from './presenceCorrections';

test('employee history hides only explicitly soft-deleted requests', () => {
  assert.equal(isPresenceCorrectionVisibleToEmployee({}), true);
  assert.equal(isPresenceCorrectionVisibleToEmployee({ hiddenFromEmployee: false }), true);
  assert.equal(isPresenceCorrectionVisibleToEmployee({ hiddenFromEmployee: true }), false);
});

test('isPresenceCorrectionType validates all valid correction types including cuti_tahunan and ganti_libur', () => {
  assert.equal(isPresenceCorrectionType('cuti_tahunan'), true);
  assert.equal(isPresenceCorrectionType('ganti_libur'), true);
  assert.equal(isPresenceCorrectionType('izin_resmi'), true);
  assert.equal(isPresenceCorrectionType('both'), true);
  assert.equal(isPresenceCorrectionType('tap_in'), true);
  assert.equal(isPresenceCorrectionType('tap_out'), true);

  assert.equal(isPresenceCorrectionType('invalid_type'), false);
  assert.equal(isPresenceCorrectionType(''), false);
  assert.equal(isPresenceCorrectionType(null), false);
  assert.equal(isPresenceCorrectionType(undefined), false);
});

test('correctionTypeLabel returns correct labels for all types', () => {
  assert.equal(correctionTypeLabel('izin_resmi'), 'Izin Resmi (Hari Penuh)');
  assert.equal(correctionTypeLabel('cuti_tahunan'), 'Cuti Tahunan');
  assert.equal(correctionTypeLabel('ganti_libur'), 'Ganti Libur');
  assert.equal(correctionTypeLabel('both'), 'Masuk & Pulang');
  assert.equal(correctionTypeLabel('tap_in'), 'Masuk Saja');
  assert.equal(correctionTypeLabel('tap_out'), 'Pulang Saja');
});

test('correctionTimeLabel returns full day for izin_resmi, cuti_tahunan, and ganti_libur', () => {
  const reqBase = {
    id: 'req1',
    date: '2026-09-17',
    employeeId: 'emp1',
    status: 'pending' as const,
  };

  assert.equal(
    correctionTimeLabel({ ...reqBase, type: 'cuti_tahunan' }),
    '07:30 — 14:00 (Hari Penuh)',
  );
  assert.equal(
    correctionTimeLabel({ ...reqBase, type: 'ganti_libur' }),
    '07:30 — 14:00 (Hari Penuh)',
  );
  assert.equal(
    correctionTimeLabel({ ...reqBase, type: 'izin_resmi' }),
    '07:30 — 14:00 (Hari Penuh)',
  );
  assert.equal(
    correctionTimeLabel({
      ...reqBase,
      type: 'both',
      checkInTime: '07:45',
      checkOutTime: '14:15',
    }),
    '07:45 — 14:15',
  );
  assert.equal(
    correctionTimeLabel({ ...reqBase, type: 'tap_in', checkInTime: '07:45' }),
    '07:45',
  );
  assert.equal(
    correctionTimeLabel({ ...reqBase, type: 'tap_out', checkOutTime: '14:15' }),
    '14:15',
  );
});
