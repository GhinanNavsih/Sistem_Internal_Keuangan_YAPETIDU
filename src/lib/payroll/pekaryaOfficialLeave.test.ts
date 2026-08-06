import assert from 'node:assert/strict';
import test from 'node:test';
import {
  attendanceDayKey,
  consolidateAttendanceDays,
  summarizePekaryaAttendance,
} from './attendance';
import {
  isPekaryaOfficialLeaveCategory,
  officialLeaveAttendanceCorrection,
} from './pekaryaOfficialLeave';

test('official leave is available to every non-Satpam Pekarya category', () => {
  for (const category of [
    'SOPIR',
    'PEKARYA',
    'TEKNISI',
    'KEBERSIHAN',
    'KEBERSIHAN_PONTI',
    'PONTI',
  ]) {
    assert.equal(isPekaryaOfficialLeaveCategory(category), true);
  }
  assert.equal(isPekaryaOfficialLeaveCategory('SATPAM'), false);
  assert.equal(isPekaryaOfficialLeaveCategory('LOYALIS'), false);
});

test('approved official leave creates a payable full-day attendance record', () => {
  const correction = officialLeaveAttendanceCorrection();
  const date = '2026-08-10';
  const days = consolidateAttendanceDays(
    [],
    new Map([[attendanceDayKey('P-001', date), correction]]),
  );
  assert.equal(days.length, 1);
  assert.equal(days[0].present, true);
  assert.equal(days[0].workStatus, 'IZIN RESMI');
  assert.equal(days[0].scanIn, '07:30:00');
  assert.equal(days[0].scanOut, '14:00:00');
  assert.equal(days[0].completePunch, true);
  assert.equal(
    summarizePekaryaAttendance('P-001', days, new Set()).totalAmount,
    12_500,
  );
  assert.equal(
    summarizePekaryaAttendance('P-001', days, new Set(['2026-08-10'])).totalAmount,
    25_000,
  );
});
