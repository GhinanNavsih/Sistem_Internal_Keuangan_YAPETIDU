import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSatpamAttendanceDetail,
  type BuildSatpamAttendanceDetailInput,
  type SatpamDetailAbsence,
  type SatpamDetailReport,
} from './satpamAttendanceDetail';

const NOW = new Date('2026-10-03T00:00:00+07:00');

function report(overrides: Partial<SatpamDetailReport>): SatpamDetailReport {
  return {
    id: 'report-1',
    employeeId: 'BC_024',
    dutyDate: '2026-09-02',
    shiftName: 'Pagi',
    shiftType: 'Harian',
    status: 'approved',
    fee: 12_500,
    coveredEmployeeId: null,
    ...overrides,
  };
}

function leave(overrides: Partial<SatpamDetailAbsence>): SatpamDetailAbsence {
  return {
    id: 'BC_024__20260912',
    dutyDate: '2026-09-12',
    shiftName: 'Malam',
    status: 'approved',
    reportType: 'izin_resmi',
    payable: true,
    approvedPayType: 'Harian',
    approvedAmount: 12_500,
    ...overrides,
  };
}

function build(overrides: Partial<BuildSatpamAttendanceDetailInput>) {
  return buildSatpamAttendanceDetail({
    employee: { employeeId: 'BC_024', name: 'Didik Siswanto', nipy: '15181009012' },
    planDays: [],
    reports: [],
    coverReports: [],
    absences: [],
    scanDays: new Map(),
    premiumDates: new Set<string>(),
    preserveRecordedPayment: false,
    employeeNames: new Map([['BC_021', 'Pengganti Satu']]),
    now: NOW,
    ...overrides,
  });
}

test('a reported and approved duty shows its shift, expected scans, scans and wage', () => {
  const result = build({
    planDays: [{ dutyDate: '2026-09-06', shiftName: 'Malam' }],
    reports: [report({ dutyDate: '2026-09-06', shiftName: 'Malam' })],
    scanDays: new Map([['2026-09-06', { scanIn: '21:54:15', scanOut: '08:04:22' }]]),
  });
  assert.equal(result.days.length, 1);
  const [row] = result.days;
  assert.equal(row.shiftName, 'Malam');
  assert.equal(row.payType, 'Harian');
  assert.equal(row.expectedScanIn, '22:00');
  assert.equal(row.expectedScanOut, '08:00');
  assert.equal(row.scanIn, '21:54:15');
  assert.equal(row.scanOut, '08:04:22');
  assert.equal(row.amount, 12_500);
  assert.equal(row.status, 'complete');
  assert.equal(result.totalAmount, 12_500);
  assert.equal(result.harianCount, 1);
});

test('expected scan times follow the shift table in force on the duty date', () => {
  const result = build({
    planDays: [{ dutyDate: '2026-10-05', shiftName: 'Pagi' }],
    reports: [report({ dutyDate: '2026-10-05', fee: 15_000 })],
  });
  assert.equal(result.days[0].expectedScanIn, '07:00');
  assert.equal(result.days[0].expectedScanOut, '15:00');
});

test('a Friday duty keeps the premium pay type and amount, and a missing scan flags it', () => {
  const result = build({
    planDays: [{ dutyDate: '2026-09-04', shiftName: 'Pagi' }],
    reports: [report({ dutyDate: '2026-09-04', shiftType: 'Jumat & Libur', fee: 25_000 })],
    scanDays: new Map([['2026-09-04', { scanIn: '07:54:39', scanOut: null }]]),
  });
  const [row] = result.days;
  assert.equal(row.payType, 'Jumat & Libur');
  assert.equal(row.amount, 25_000);
  assert.equal(row.status, 'partial');
  assert.equal(result.jumatLiburAmount, 25_000);
  assert.equal(result.incompleteDays, 1);
});

test('approved leave is paid once even when a work report also exists', () => {
  const result = build({
    planDays: [{ dutyDate: '2026-09-30', shiftName: 'Malam' }],
    reports: [report({ dutyDate: '2026-09-30', shiftName: 'Malam' })],
    absences: [leave({ dutyDate: '2026-09-30' })],
  });
  assert.equal(result.days.length, 1);
  assert.equal(result.days[0].status, 'leave');
  assert.equal(result.days[0].amount, 12_500);
  assert.equal(result.totalAmount, 12_500);
});

test('approved leave on a Friday is paid at the premium rate', () => {
  const result = build({
    planDays: [{ dutyDate: '2026-09-11', shiftName: 'Malam' }],
    absences: [leave({ dutyDate: '2026-09-11' })],
  });
  assert.equal(result.days[0].payType, 'Jumat & Libur');
  assert.equal(result.days[0].amount, 25_000);
});

test('a sealed record keeps its recorded leave amount', () => {
  const result = build({
    planDays: [{ dutyDate: '2026-09-12', shiftName: 'Malam' }],
    absences: [leave({ approvedAmount: 12_500, approvedPayType: 'Harian' })],
    preserveRecordedPayment: true,
  });
  assert.equal(result.days[0].amount, 12_500);
  assert.equal(result.days[0].payType, 'Harian');
});

test('an unpayable leave request does not turn a scheduled day into a paid one', () => {
  const result = build({
    planDays: [{ dutyDate: '2026-09-12', shiftName: 'Malam' }],
    absences: [leave({ payable: false })],
  });
  assert.equal(result.days[0].status, 'absent');
  assert.equal(result.days[0].amount, 0);
});

test('a duty handed to another guard shows who covered it and pays nothing', () => {
  const result = build({
    planDays: [{ dutyDate: '2026-09-27', shiftName: 'Malam' }],
    coverReports: [
      report({
        id: 'cover-1',
        employeeId: 'BC_021',
        dutyDate: '2026-09-27',
        shiftType: 'Lembur Cover',
        coveredEmployeeId: 'BC_024',
      }),
    ],
  });
  const [row] = result.days;
  assert.equal(row.status, 'covered');
  assert.equal(row.coveredByName, 'Pengganti Satu');
  assert.equal(row.amount, 0);
});

test('a scheduled duty with nothing reported is absent once over and upcoming before', () => {
  const result = build({
    planDays: [
      { dutyDate: '2026-09-10', shiftName: 'Malam' },
      { dutyDate: '2026-10-20', shiftName: 'Pagi' },
    ],
  });
  assert.deepEqual(
    result.days.map((row) => row.status),
    ['absent', 'upcoming'],
  );
});

test('declined and pending reports are unpaid', () => {
  const result = build({
    planDays: [
      { dutyDate: '2026-09-02', shiftName: 'Pagi' },
      { dutyDate: '2026-09-03', shiftName: 'Pagi' },
    ],
    reports: [
      report({ id: 'a', dutyDate: '2026-09-02', status: 'declined' }),
      report({ id: 'b', dutyDate: '2026-09-03', status: 'pending_review' }),
    ],
  });
  assert.deepEqual(
    result.days.map((row) => [row.status, row.amount]),
    [
      ['declined', 0],
      ['pending', 0],
    ],
  );
  assert.equal(result.totalAmount, 0);
});

test('an approved extra shift on an off day is its own paid row', () => {
  const result = build({
    reports: [
      report({
        id: 'extra-1',
        dutyDate: '2026-09-01',
        shiftType: 'Lembur Sendiri',
        fee: 12_500,
      }),
    ],
    scanDays: new Map([['2026-09-01', { scanIn: '07:41:54', scanOut: '14:00:24' }]]),
  });
  assert.equal(result.days.length, 1);
  assert.equal(result.days[0].payType, 'Lembur Sendiri');
  assert.equal(result.days[0].status, 'complete');
  assert.equal(result.lemburCount, 1);
  assert.equal(result.lemburAmount, 12_500);
  assert.equal(result.harianCount, 0);
});

test('attendance no report accounts for is listed unpaid', () => {
  const result = build({
    scanDays: new Map([['2026-09-09', { scanIn: '08:00:00', scanOut: '14:00:00' }]]),
  });
  assert.equal(result.days[0].status, 'scan_only');
  assert.equal(result.days[0].amount, 0);
  assert.equal(result.paidDays, 0);
});

test('a pending request on the date is exposed for the review action', () => {
  const result = build({
    planDays: [{ dutyDate: '2026-09-13', shiftName: 'Sore' }],
    absences: [leave({ id: 'req-9', dutyDate: '2026-09-13', status: 'pending', payable: false })],
  });
  assert.equal(result.days[0].pendingAbsenceId, 'req-9');
});

test('rows are ordered by date', () => {
  const result = build({
    planDays: [
      { dutyDate: '2026-09-05', shiftName: 'Pagi' },
      { dutyDate: '2026-09-02', shiftName: 'Pagi' },
    ],
    reports: [
      report({ id: 'x', dutyDate: '2026-09-05' }),
      report({ id: 'y', dutyDate: '2026-09-02' }),
    ],
  });
  assert.deepEqual(
    result.days.map((row) => row.date),
    ['2026-09-02', '2026-09-05'],
  );
});

test('a scan-in even one second past the shift start reads Telat, and pay is unchanged', () => {
  const planDays = [{ dutyDate: '2026-09-19', shiftName: 'Malam' }];
  const reports = [report({ dutyDate: '2026-09-19', shiftName: 'Malam' })];
  const statusFor = (scanIn: string, scanOut: string | null = '08:03:38') =>
    build({
      planDays,
      reports,
      scanDays: new Map([['2026-09-19', { scanIn, scanOut }]]),
    }).days[0];

  const late = statusFor('22:02:36');
  assert.equal(late.status, 'late');
  assert.equal(late.amount, 12_500);
  assert.equal(statusFor('22:00:01').status, 'late');
  assert.equal(statusFor('22:00:00').status, 'complete');
  assert.equal(statusFor('21:54:15').status, 'complete');
  // A missing scan-out still takes priority over lateness.
  assert.equal(statusFor('22:02:36', null).status, 'partial');
  assert.equal(
    build({
      planDays,
      reports,
      scanDays: new Map([['2026-09-19', { scanIn: '22:02:36', scanOut: '08:03:38' }]]),
    }).paidDays,
    1,
  );
});

test('an extra shift is judged against its own shift start', () => {
  const result = build({
    reports: [
      report({
        id: 'extra-late',
        dutyDate: '2026-09-01',
        shiftName: 'Pagi',
        shiftType: 'Lembur Sendiri',
      }),
    ],
    scanDays: new Map([['2026-09-01', { scanIn: '08:00:30', scanOut: '14:00:24' }]]),
  });
  assert.equal(result.days[0].status, 'late');
});

test('a reported duty opens its own shift report, on that guard', () => {
  const result = build({
    planDays: [{ dutyDate: '2026-09-02', shiftName: 'Pagi', occurrenceId: 'team_3__20260902__pagi' }],
    reports: [
      report({ dutyDate: '2026-09-02', sourceOccurrenceId: 'team_3__20260902__pagi' }),
    ],
  });
  assert.deepEqual(result.days[0].review, {
    occurrenceId: 'team_3__20260902__pagi',
    employeeId: 'BC_024',
  });
});

test('a duty with no report still opens its shift report once one was submitted', () => {
  const result = build({
    planDays: [
      { dutyDate: '2026-09-10', shiftName: 'Malam', occurrenceId: 'team_3__20260910__malam' },
      { dutyDate: '2026-10-20', shiftName: 'Pagi', occurrenceId: null },
    ],
    absences: [leave({ dutyDate: '2026-09-10' })],
  });
  assert.equal(result.days[0].status, 'leave');
  assert.equal(result.days[0].review?.occurrenceId, 'team_3__20260910__malam');
  // Nothing was submitted for the future duty, so there is nothing to check.
  assert.equal(result.days[1].status, 'upcoming');
  assert.equal(result.days[1].review, null);
});

test('a handed-over duty opens the shift report on the guard who covered it', () => {
  const result = build({
    planDays: [{ dutyDate: '2026-09-27', shiftName: 'Malam', occurrenceId: 'team_3__20260927__malam' }],
    coverReports: [
      report({
        id: 'cover-1',
        employeeId: 'BC_021',
        dutyDate: '2026-09-27',
        shiftType: 'Lembur Cover',
        coveredEmployeeId: 'BC_024',
        sourceOccurrenceId: 'team_3__20260927__malam',
      }),
    ],
  });
  assert.equal(result.days[0].status, 'covered');
  assert.deepEqual(result.days[0].review, {
    occurrenceId: 'team_3__20260927__malam',
    employeeId: 'BC_021',
  });
});

test('an extra shift opens its own report; bare attendance has nothing to check', () => {
  const result = build({
    reports: [
      report({
        id: 'extra-1',
        dutyDate: '2026-09-01',
        shiftType: 'Lembur Sendiri',
        sourceOccurrenceId: 'team_3__20260901__pagi',
      }),
    ],
    scanDays: new Map([
      ['2026-09-01', { scanIn: '07:41:54', scanOut: '14:00:24' }],
      ['2026-09-09', { scanIn: '08:00:00', scanOut: '14:00:00' }],
    ]),
  });
  const byDate = Object.fromEntries(result.days.map((row) => [row.date, row]));
  assert.equal(byDate['2026-09-01'].review?.occurrenceId, 'team_3__20260901__pagi');
  assert.equal(byDate['2026-09-09'].status, 'scan_only');
  assert.equal(byDate['2026-09-09'].review, null);
});

test('approved leave warns when a work report still lists the guard, or a scan exists', () => {
  const planDays = [{ dutyDate: '2026-09-30', shiftName: 'Malam' }];
  const absences = [leave({ dutyDate: '2026-09-30' })];

  const withReport = build({
    planDays,
    absences,
    reports: [report({ dutyDate: '2026-09-30', shiftName: 'Malam', status: 'approved' })],
  });
  assert.equal(withReport.days[0].status, 'leave');
  assert.match(withReport.days[0].warning || '', /laporan shift masih mencantumkan/);

  // A work report that was declined no longer contradicts the leave.
  const declined = build({
    planDays,
    absences,
    reports: [report({ dutyDate: '2026-09-30', shiftName: 'Malam', status: 'declined' })],
  });
  assert.equal(declined.days[0].warning, null);

  const withScan = build({
    planDays,
    absences,
    scanDays: new Map([['2026-09-30', { scanIn: '22:00:00', scanOut: '07:00:00' }]]),
  });
  assert.match(withScan.days[0].warning || '', /scan kehadiran/);

  assert.equal(build({ planDays, absences }).days[0].warning, null);
});

test('an identity problem is carried to the guard, and absent otherwise', () => {
  assert.equal(build({}).identityIssue, null);
  assert.match(
    build({ identityIssue: 'NIPY belum diisi' }).identityIssue || '',
    /NIPY/,
  );
});
