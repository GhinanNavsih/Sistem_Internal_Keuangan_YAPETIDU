import assert from 'node:assert/strict';
import test from 'node:test';
import {
  closestGantiLiburOffDay,
  evaluateGantiLiburAttendance,
  gantiLiburAttendanceCheck,
  gantiLiburAttendanceConfirmationMatches,
  parseGantiLiburAttendanceConfirmation,
  gantiLiburDecisionIssue,
  gantiLiburSubmitIssue,
  gantiLiburWeekEnd,
  gantiLiburWeekStart,
  gantiLiburWeekUsage,
  gantiLiburEmployeeKind,
  gantiLiburPeriod,
  canReadGantiLibur,
  canReviewGantiLibur,
  gantiLiburAttendanceCorrection,
  hasGantiLiburDayOff,
} from './gantiLibur';
import { PEKARYA_JOB_CATEGORIES } from './pekaryaSpj';

test('every Pekarya category uses category-scoped review, including Satpam', () => {
  for (const category of PEKARYA_JOB_CATEGORIES) {
    const request = { employeeKind: 'blue_collar' as const, category };
    assert.equal(canReviewGantiLibur({ role: 'satker_head', permittedCategories: [category] }, request), true);
    assert.equal(canReviewGantiLibur({ role: 'satker_head', permittedCategories: [] }, request), false);
    assert.equal(canReadGantiLibur({ role: 'loyalis_admin', permittedCategories: [] }, request), false);
    assert.equal(canReadGantiLibur({ role: 'satker_head_loyalis', permittedCategories: [] }, request), false);
    assert.equal(canReviewGantiLibur({ role: 'super_admin', permittedCategories: [] }, request), true);
    assert.equal(canReadGantiLibur({ role: 'finance_verifier', permittedCategories: [] }, request), true);
    assert.equal(canReviewGantiLibur({ role: 'finance_verifier', permittedCategories: [category] }, request), false);
  }
});

test('attendance confirmation must describe the exact current scans and verdict', () => {
  const current = { verdict: 'incomplete' as const, scanIn: '07:30', scanOut: '' };
  assert.deepEqual(parseGantiLiburAttendanceConfirmation(current), current);
  assert.equal(gantiLiburAttendanceConfirmationMatches(current, current), true);
  assert.equal(gantiLiburAttendanceConfirmationMatches(null, current), false);
  assert.equal(gantiLiburAttendanceConfirmationMatches({ ...current, scanIn: '07:35' }, current), false);
  assert.equal(gantiLiburAttendanceConfirmationMatches({ ...current, verdict: 'absent' }, current), false);
  assert.equal(gantiLiburAttendanceConfirmationMatches(current, { ...current, scanOut: '13:00' }), false);
  for (const invalid of [true, {}, { confirmed: true }, { ...current, verdict: 'eligible' },
    { ...current, verdict: 'unknown' }, { ...current, scanIn: 730 }, { ...current, scanOut: 'garbage' }]) {
    assert.equal(parseGantiLiburAttendanceConfirmation(invalid), null);
  }
});

test('legacy Loyalis requests retain their identity and calendar-month payroll', () => {
  assert.equal(gantiLiburEmployeeKind({}), 'loyalis');
  assert.equal(gantiLiburEmployeeKind({ employeeCollection: 'Employees_BlueCollar' }), 'blue_collar');
  assert.equal(canReviewGantiLibur({ role: 'loyalis_admin', permittedCategories: [] }, {}), true);
  assert.equal(gantiLiburPeriod('loyalis', '2026-09-26'), '2026-09');
  assert.equal(gantiLiburPeriod('blue_collar', '2026-05-25'), '2026-05');
  assert.equal(gantiLiburPeriod('blue_collar', '2026-05-26'), '2026-06');
  assert.equal(gantiLiburPeriod('blue_collar', '2026-06-26'), '2026-07');
  assert.equal(gantiLiburPeriod('blue_collar', '2026-07-31'), '2026-07');
  assert.equal(gantiLiburPeriod('blue_collar', '2026-08-01'), '2026-08');
  assert.equal(gantiLiburPeriod('blue_collar', '2026-09-25'), '2026-09');
  assert.equal(gantiLiburPeriod('blue_collar', '2026-09-26'), '2026-09');
  assert.equal(gantiLiburPeriod('blue_collar', '2026-12-26'), '2026-12');
});

test('paid absence scans never earn another compensatory day', () => {
  for (const workStatus of ['CUTI', 'IZIN RESMI', 'IZIN', 'SAKIT', 'GANTI LIBUR']) {
    assert.equal(evaluateGantiLiburAttendance({
      'Jam kerja': workStatus, 'Scan masuk': '07:30', 'Scan pulang': '14:00',
    }).verdict, 'absent');
  }
  const correction = gantiLiburAttendanceCorrection();
  assert.equal(correction.present, true);
  assert.equal(evaluateGantiLiburAttendance({
    'Jam kerja': correction.workStatus, 'Scan masuk': correction.scanIn, 'Scan pulang': correction.scanOut,
  }).verdict, 'absent');
});

test('pending swaps reserve the date; declined or withdrawn swaps release it', () => {
  const request = { dayOffDate: '2026-09-28', status: 'pending' };
  assert.equal(hasGantiLiburDayOff([request], request.dayOffDate), true);
  assert.equal(hasGantiLiburDayOff([request], request.dayOffDate, true), false);
  assert.equal(hasGantiLiburDayOff([{ ...request, status: 'approved' }], request.dayOffDate, true), true);
  for (const status of ['declined', 'withdrawn']) {
    assert.equal(hasGantiLiburDayOff([{ ...request, status }], request.dayOffDate), false);
  }
});

// 2026-09-25 is a Friday; 2026-09-17 is declared Tanggal Merah for these tests.
const isOffDay = (date: string) =>
  date === '2026-09-17' ||
  new Date(`${date}T00:00:00.000Z`).getUTCDay() === 5;

function row(scanIn: string, scanOut: string, extra: Record<string, unknown> = {}) {
  return {
    Tanggal: '25-09-2026',
    'Jam kerja': 'MASUK',
    'Scan masuk': scanIn,
    'Scan pulang': scanOut,
    ...extra,
  };
}

test('weeks run Saturday to Friday', () => {
  assert.equal(gantiLiburWeekStart('2026-09-19'), '2026-09-19'); // Saturday starts the week
  assert.equal(gantiLiburWeekStart('2026-09-20'), '2026-09-19'); // Sunday
  assert.equal(gantiLiburWeekStart('2026-09-21'), '2026-09-19'); // Monday
  assert.equal(gantiLiburWeekStart('2026-09-25'), '2026-09-19'); // Friday ends it
  assert.equal(gantiLiburWeekStart('2026-09-26'), '2026-09-26'); // next Saturday
  assert.equal(gantiLiburWeekEnd('2026-09-23'), '2026-09-25');
  assert.equal(gantiLiburWeekEnd('2026-09-26'), '2026-10-02');
  assert.equal(gantiLiburWeekStart('2027-01-01'), '2026-12-26'); // across a year
});

test('the worked-holiday field defaults to the non-working day nearest today', () => {
  const closest = (today: string, extra: Partial<Parameters<typeof closestGantiLiburOffDay>[0]> = {}) =>
    closestGantiLiburOffDay({ today, isOffDay, ...extra });
  // Fridays are 2026-09-18, 09-25 and 10-02.
  assert.equal(closest('2026-09-25'), '2026-09-25'); // today itself is a Friday
  assert.equal(closest('2026-09-26'), '2026-09-25'); // Saturday: yesterday
  assert.equal(closest('2026-09-28'), '2026-09-25'); // Monday: 3 days back beats 4 ahead
  assert.equal(closest('2026-09-29'), '2026-10-02'); // Tuesday: 3 days ahead beats 4 back
  assert.equal(closest('2026-09-30'), '2026-10-02'); // Wednesday: the coming Friday
  // Tanggal Merah counts too (2026-09-17 is declared one for these tests).
  assert.equal(closest('2026-09-16'), '2026-09-17');
  // A tie goes to the earlier date: Friday 09-18 and Tuesday 09-22 are both 2 days from Sunday 09-20.
  assert.equal(
    closest('2026-09-20', { isOffDay: (date) => isOffDay(date) || date === '2026-09-22' }),
    '2026-09-18',
  );
});

test('the default skips a holiday that is already taken', () => {
  const taken = new Set(['2026-09-25']);
  // 09-18 and 10-02 are both 7 days from 09-25, so the earlier one wins.
  assert.equal(
    closestGantiLiburOffDay({
      today: '2026-09-25',
      isOffDay,
      isTaken: (date) => taken.has(date),
    }),
    '2026-09-18',
  );
  taken.add('2026-09-18');
  assert.equal(
    closestGantiLiburOffDay({
      today: '2026-09-25',
      isOffDay,
      isTaken: (date) => taken.has(date),
    }),
    '2026-10-02',
  );
});

test('no default when today is invalid or no non-working day is near', () => {
  assert.equal(closestGantiLiburOffDay({ today: '2026-13-01', isOffDay }), '');
  assert.equal(closestGantiLiburOffDay({ today: '', isOffDay }), '');
  assert.equal(closestGantiLiburOffDay({ today: '2026-09-25', isOffDay: () => false }), '');
  assert.equal(
    closestGantiLiburOffDay({
      today: '2026-09-22',
      isOffDay: (date) => date === '2026-09-25',
      maxDays: 2,
    }),
    '',
  );
});

test('the full 07:30–14:00 window earns ganti libur, to the minute', () => {
  assert.equal(evaluateGantiLiburAttendance(row('07:30', '14:00')).verdict, 'eligible');
  assert.equal(evaluateGantiLiburAttendance(row('07:12', '15:40')).verdict, 'eligible');
  assert.equal(evaluateGantiLiburAttendance(row('07:30:59', '14:00:00')).verdict, 'eligible');
});

test('coming in late or leaving early is lembur, not ganti libur', () => {
  assert.equal(evaluateGantiLiburAttendance(row('07:31', '14:00')).verdict, 'lembur');
  assert.equal(evaluateGantiLiburAttendance(row('07:00', '13:59')).verdict, 'lembur');
  assert.equal(evaluateGantiLiburAttendance(row('09:00', '11:00')).verdict, 'lembur');
});

test('a single scan cannot be verified, and a generated scan does not count', () => {
  assert.equal(evaluateGantiLiburAttendance(row('07:20', '')).verdict, 'incomplete');
  assert.equal(
    evaluateGantiLiburAttendance(row('07:20', '09:50', { scanPulangAuto: true })).verdict,
    'incomplete',
  );
  assert.equal(
    evaluateGantiLiburAttendance(row('07:20', '14:10', { scanPulangAuto: false })).verdict,
    'eligible',
  );
});

test('no scan, or a leave status, is absent', () => {
  assert.equal(evaluateGantiLiburAttendance(null).verdict, 'absent');
  assert.equal(evaluateGantiLiburAttendance(row('', '')).verdict, 'absent');
  assert.equal(
    evaluateGantiLiburAttendance(row('07:30', '14:00', { 'Jam kerja': 'TIDAK HADIR' })).verdict,
    'absent',
  );
  assert.equal(
    evaluateGantiLiburAttendance(row('07:30', '14:00', { 'Jam kerja': 'CUTI' })).verdict,
    'absent',
  );
});

test('attendance that has not been uploaded is awaited, never judged absent', () => {
  assert.equal(gantiLiburAttendanceCheck(null, '2026-09-25').verdict, 'awaiting_upload');
  assert.equal(
    gantiLiburAttendanceCheck({ dailyLogs: [] }, '2026-09-25').verdict,
    'awaiting_upload',
  );
  assert.equal(
    gantiLiburAttendanceCheck(
      { dailyLogs: [{ ...row('07:30', '14:00'), Tanggal: '24-09-2026' }] },
      '2026-09-25',
    ).verdict,
    'awaiting_upload',
  );
});

test('an uploaded month without a row for the worked date is absent', () => {
  const check = gantiLiburAttendanceCheck(
    {
      dailyLogs: [
        { ...row('07:30', '14:00'), Tanggal: '24-09-2026' },
        { ...row('07:30', '14:00'), Tanggal: '30-09-2026' },
      ],
    },
    '2026-09-25',
  );
  assert.equal(check.verdict, 'absent');
});

test('the worked date row is found and its scans reported', () => {
  const check = gantiLiburAttendanceCheck(
    { dailyLogs: [row('07:25', '14:05'), { ...row('', ''), Tanggal: '30-09-2026' }] },
    '2026-09-25',
  );
  assert.deepEqual(check, { verdict: 'eligible', scanIn: '07:25', scanOut: '14:05' });
});

test('submission needs a holiday worked and a working day off', () => {
  const base = { requestId: 'r1', isOffDay, requests: [] };
  assert.equal(
    gantiLiburSubmitIssue({ ...base, workedDate: '2026-09-25', dayOffDate: '2026-09-28' }),
    null,
  );
  // Either order is allowed.
  assert.equal(
    gantiLiburSubmitIssue({ ...base, workedDate: '2026-09-25', dayOffDate: '2026-09-22' }),
    null,
  );
  assert.equal(
    gantiLiburSubmitIssue({ ...base, workedDate: '2026-09-17', dayOffDate: '2026-09-21' }),
    null,
  );
  assert.equal(
    gantiLiburSubmitIssue({ ...base, workedDate: '2026-09-24', dayOffDate: '2026-09-28' }),
    'worked_date_not_off_day',
  );
  assert.equal(
    gantiLiburSubmitIssue({ ...base, workedDate: '2026-09-25', dayOffDate: '2026-09-17' }),
    'day_off_not_working_day',
  );
  assert.equal(
    gantiLiburSubmitIssue({ ...base, workedDate: '2026-09-25', dayOffDate: '2026-09-25' }),
    'same_date',
  );
  assert.equal(
    gantiLiburSubmitIssue({ ...base, workedDate: '2026-02-30', dayOffDate: '2026-09-28' }),
    'invalid_date',
  );
});

test('a worked holiday and a day off are each used once', () => {
  assert.equal(
    gantiLiburSubmitIssue({
      requestId: 'r1',
      isOffDay,
      workedDate: '2026-09-25',
      dayOffDate: '2026-09-28',
      currentStatus: 'approved',
      requests: [],
    }),
    'worked_date_used',
  );
  // Resubmitting after a decline is allowed.
  assert.equal(
    gantiLiburSubmitIssue({
      requestId: 'r1',
      isOffDay,
      workedDate: '2026-09-25',
      dayOffDate: '2026-09-28',
      currentStatus: 'declined',
      requests: [{ id: 'r1', dayOffDate: '2026-09-28', status: 'declined' }],
    }),
    null,
  );
  assert.equal(
    gantiLiburSubmitIssue({
      requestId: 'r2',
      isOffDay,
      workedDate: '2026-10-02',
      dayOffDate: '2026-09-28',
      requests: [{ id: 'r1', dayOffDate: '2026-09-28', status: 'pending' }],
    }),
    'day_off_taken',
  );
});

test('at most two ganti libur days in one Saturday–Friday week', () => {
  // All three fall in the week Saturday 19 – Friday 25 September.
  const requests = [
    { id: 'a', dayOffDate: '2026-09-21', status: 'approved' as const },
    { id: 'b', dayOffDate: '2026-09-23', status: 'pending' as const },
    { id: 'c', dayOffDate: '2026-09-24', status: 'declined' as const },
  ];
  assert.equal(gantiLiburWeekUsage(requests, '2026-09-24'), 2);
  const submit = (dayOffDate: string) =>
    gantiLiburSubmitIssue({
      requestId: 'd',
      isOffDay,
      workedDate: '2026-10-02',
      dayOffDate,
      requests,
    });
  // Thursday, and the Saturday that opens the week, are both in that week.
  assert.equal(submit('2026-09-24'), 'weekly_limit');
  assert.equal(submit('2026-09-19'), 'weekly_limit');
  // The following Saturday starts a new week, even though the Monday-to-Sunday
  // week of the requests above would still have covered it.
  assert.equal(gantiLiburWeekUsage(requests, '2026-09-26'), 0);
  assert.equal(submit('2026-09-26'), null);
  assert.equal(submit('2026-09-28'), null);
  // A request being resubmitted does not count against itself.
  assert.equal(gantiLiburWeekUsage(requests, '2026-09-23', 'b'), 1);
});

test('approval requires verified attendance or an explicit attendance confirmation', () => {
  const base = {
    approving: true,
    periodClosed: false,
    immutableSlip: false,
    expectedRevision: 1,
    currentRevision: 1,
    status: 'pending' as const,
    verdict: 'eligible' as const,
    dayOffIsOffDay: false,
    dayOffConflict: false,
  };
  assert.equal(gantiLiburDecisionIssue(base), null);
  assert.equal(
    gantiLiburDecisionIssue({ ...base, verdict: 'lembur' }),
    'attendance_not_verified',
  );
  assert.equal(
    gantiLiburDecisionIssue({ ...base, verdict: 'awaiting_upload' }),
    'attendance_not_verified',
  );
  for (const verdict of ['absent', 'incomplete', 'lembur', 'awaiting_upload'] as const) {
    const confirmed = { ...base, verdict, attendanceConfirmed: true };
    assert.equal(gantiLiburDecisionIssue({ ...confirmed, attendanceConfirmed: false }), 'attendance_not_verified');
    assert.equal(gantiLiburDecisionIssue(confirmed), null);
    assert.equal(gantiLiburDecisionIssue({ ...confirmed, periodClosed: true }), 'period_closed');
    assert.equal(gantiLiburDecisionIssue({ ...confirmed, immutableSlip: true }), 'immutable_slip');
    assert.equal(gantiLiburDecisionIssue({ ...confirmed, currentRevision: 2 }), 'revision_conflict');
    assert.equal(gantiLiburDecisionIssue({ ...confirmed, status: 'approved' }), 'not_pending');
    assert.equal(gantiLiburDecisionIssue({ ...confirmed, dayOffIsOffDay: true }), 'day_off_now_holiday');
    assert.equal(gantiLiburDecisionIssue({ ...confirmed, dayOffConflict: true }), 'day_off_conflict');
  }
  // Declining never waits for attendance.
  assert.equal(
    gantiLiburDecisionIssue({ ...base, approving: false, verdict: 'awaiting_upload' }),
    null,
  );
  assert.equal(gantiLiburDecisionIssue({ ...base, periodClosed: true }), 'period_closed');
  assert.equal(gantiLiburDecisionIssue({ ...base, currentRevision: 2 }), 'revision_conflict');
  assert.equal(gantiLiburDecisionIssue({ ...base, status: 'approved' }), 'not_pending');
  assert.equal(gantiLiburDecisionIssue({ ...base, dayOffIsOffDay: true }), 'day_off_now_holiday');
  assert.equal(gantiLiburDecisionIssue({ ...base, dayOffConflict: true }), 'day_off_conflict');
});
