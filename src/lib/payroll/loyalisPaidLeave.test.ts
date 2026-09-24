import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyApprovedPaidLeaveToLoyalisEntry,
  loyalisHasPayableAttendance,
} from './loyalisPaidLeave';

test('approved Loyalis paid leave replaces an absence with a full paid day', () => {
  const result = applyApprovedPaidLeaveToLoyalisEntry({
    entry: {
      minutes: 1_000,
      absenceMinutes: 390,
      deduction: 250_000,
      netBonus: 0,
      absentDaysCount: 1,
      dailyLogs: [{
        Tanggal: '22-09-2026',
        'Jam kerja': 'TIDAK HADIR',
        'Scan masuk': '',
        'Scan pulang': '',
      }],
    },
    leaveDate: '2026-09-22',
    expectedHours: 6.5,
    workingDays: 25,
    isOffDay: false,
  });
  assert.equal(result.absenceMinutes, 0);
  assert.equal(result.deduction, 0);
  assert.equal(result.netBonus, 250_000);
  assert.equal(result.absentDaysCount, 0);
  assert.equal(result.dailyLogs?.[0]?.['Jam kerja'], 'CUTI');
  assert.equal(result.dailyLogs?.[0]?.['Scan masuk'], '07:30');
  assert.equal(result.dailyLogs?.[0]?.['Scan pulang'], '14:00');
});

test('off-day Loyalis paid leave remains visible without reducing another absence', () => {
  const result = applyApprovedPaidLeaveToLoyalisEntry({
    entry: { absenceMinutes: 390, dailyLogs: [] },
    leaveDate: '2026-09-25',
    expectedHours: 6.5,
    workingDays: 25,
    isOffDay: true,
  });
  assert.equal(result.absenceMinutes, 390);
  assert.equal(result.dailyLogs?.[0]?.['Jam kerja'], 'CUTI');
});

test('an existing scanner row blocks paid-leave approval', () => {
  assert.equal(
    loyalisHasPayableAttendance(
      {
        dailyLogs: [{
          Tanggal: '22-09-2026',
          'Jam kerja': 'MASUK',
          'Scan masuk': '07:35',
          'Scan pulang': '14:00',
        }],
      },
      '2026-09-22',
    ),
    true,
  );
});

test('reapplying the same Loyalis paid-leave date is idempotent', () => {
  const first = applyApprovedPaidLeaveToLoyalisEntry({
    entry: { minutes: 0, absenceMinutes: 390, dailyLogs: [] },
    leaveDate: '2026-09-22',
    expectedHours: 6.5,
    workingDays: 25,
    isOffDay: false,
  });
  const second = applyApprovedPaidLeaveToLoyalisEntry({
    entry: first,
    leaveDate: '2026-09-22',
    expectedHours: 6.5,
    workingDays: 25,
    isOffDay: false,
  });
  assert.equal(second.minutes, first.minutes);
  assert.equal(second.absenceMinutes, first.absenceMinutes);
  assert.deepEqual(second.approvedPaidLeaveDates, ['2026-09-22']);
  assert.equal(second.dailyLogs?.length, 1);
});

test('a later Loyalis scanner import is replaced by CUTI without double-counting minutes', () => {
  const result = applyApprovedPaidLeaveToLoyalisEntry({
    entry: {
      minutes: 390,
      absenceMinutes: 0,
      activeDaysCount: 1,
      dailyLogs: [{
        Tanggal: '22-09-2026',
        'Jam kerja': 'MASUK',
        'Scan masuk': '07:30',
        'Scan pulang': '14:00',
      }],
    },
    leaveDate: '2026-09-22',
    expectedHours: 6.5,
    workingDays: 25,
    isOffDay: false,
  });
  assert.equal(result.minutes, 390);
  assert.equal(result.absenceMinutes, 0);
  assert.equal(result.activeDaysCount, 1);
  assert.equal(result.dailyLogs?.[0]?.['Jam kerja'], 'CUTI');
});

test('an approved ganti libur credits its day off as a full day, labelled GANTI LIBUR', () => {
  const result = applyApprovedPaidLeaveToLoyalisEntry({
    entry: {
      minutes: 1_000,
      absenceMinutes: 390,
      deduction: 250_000,
      netBonus: 0,
      absentDaysCount: 1,
      dailyLogs: [{
        Tanggal: '28-09-2026',
        'Jam kerja': 'TIDAK HADIR',
        'Scan masuk': '',
        'Scan pulang': '',
      }],
    },
    leaveDate: '2026-09-28',
    expectedHours: 6.5,
    workingDays: 25,
    isOffDay: false,
    kind: 'ganti_libur',
  });
  assert.equal(result.absenceMinutes, 0);
  assert.equal(result.absentDaysCount, 0);
  assert.equal(result.dailyLogs?.[0]?.['Jam kerja'], 'GANTI LIBUR');
  assert.equal(result.dailyLogs?.[0]?.gantiLibur, true);
  assert.equal(result.dailyLogs?.[0]?.annualPaidLeave, undefined);
  assert.deepEqual(result.approvedGantiLiburDates, ['2026-09-28']);
  assert.equal(result.approvedPaidLeaveDates, undefined);
  assert.equal(
    loyalisHasPayableAttendance(result, '2026-09-28'),
    false,
  );
});

test('a date already credited as CUTI is not credited again by ganti libur', () => {
  const leave = applyApprovedPaidLeaveToLoyalisEntry({
    entry: { minutes: 0, absenceMinutes: 780, dailyLogs: [] },
    leaveDate: '2026-09-28',
    expectedHours: 6.5,
    workingDays: 25,
    isOffDay: false,
  });
  const both = applyApprovedPaidLeaveToLoyalisEntry({
    entry: leave,
    leaveDate: '2026-09-28',
    expectedHours: 6.5,
    workingDays: 25,
    isOffDay: false,
    kind: 'ganti_libur',
  });
  assert.equal(both.minutes, leave.minutes);
  assert.equal(both.absenceMinutes, leave.absenceMinutes);
});
