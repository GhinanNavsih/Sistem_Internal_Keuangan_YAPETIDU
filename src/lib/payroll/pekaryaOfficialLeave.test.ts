import assert from 'node:assert/strict';
import test from 'node:test';
import {
  attendanceDayKey,
  consolidateAttendanceDays,
  summarizePekaryaAttendance,
} from './attendance';
import {
  isPekaryaOfficialLeaveCategory,
  isValidAttendanceScanRange,
  normalizePekaryaAttendanceReportFields,
  officialLeaveAttendanceCorrection,
  pekaryaAttendanceReportType,
  scanAttendanceCorrection,
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
  // Official leave grants exactly the 07:30–14:00 window, so it is paid as a
  // full day at whichever rate its date earns.
  assert.equal(
    summarizePekaryaAttendance('P-001', days, new Set()).totalAmount,
    12_500,
  );
  const premium = summarizePekaryaAttendance(
    'P-001',
    days,
    new Set(['2026-08-10']),
  );
  assert.equal(premium.totalAmount, 25_001);
  assert.equal(premium.jumatLiburCount, 1);
  assert.equal(premium.jumatLiburAmount, 25_001);
});

test('Pekarya attendance requests distinguish scan reports from legacy official leave', () => {
  assert.equal(pekaryaAttendanceReportType({ reportType: 'scan' }), 'scan');
  assert.equal(
    pekaryaAttendanceReportType({ leaveType: 'izin_resmi' }),
    'izin_resmi',
  );
  assert.deepEqual(scanAttendanceCorrection('08:00:00', '14:00:00'), {
    present: true,
    workStatus: 'MASUK',
    scanIn: '08:00:00',
    scanOut: '14:00:00',
  });
});

test('attendance scan ranges must move forward within the same day', () => {
  assert.equal(isValidAttendanceScanRange('08:00', '14:00'), true);
  assert.equal(isValidAttendanceScanRange('08:00:01', '08:00:02'), true);
  assert.equal(isValidAttendanceScanRange('14:00', '08:00'), false);
  assert.equal(isValidAttendanceScanRange('08:00', '08:00'), false);
  assert.equal(isValidAttendanceScanRange('not-a-time', '14:00'), false);
});

test('admin report-type changes normalize the stored attendance fields', () => {
  assert.deepEqual(
    normalizePekaryaAttendanceReportFields('izin_resmi', '08:00', '14:00'),
    {
      reportType: 'izin_resmi',
      leaveType: 'izin_resmi',
      scanIn: null,
      scanOut: null,
    },
  );
  assert.deepEqual(
    normalizePekaryaAttendanceReportFields('scan', '08:00', '14:00'),
    {
      reportType: 'scan',
      leaveType: null,
      scanIn: '08:00:00',
      scanOut: '14:00:00',
    },
  );
  assert.equal(
    normalizePekaryaAttendanceReportFields('scan', '14:00', '08:00'),
    null,
  );
});
