import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertSatpamPhotoUrl,
  analyzeSatpamShiftSubmission,
  calculatePayrollTotals,
  dedupeSatpamActivityReports,
  defaultPayrollPeriodToken,
  getRegularSatpamPayType,
  getShiftIsoBounds,
  hasActivityEnded,
  hasSatpamShiftEnded,
  inferLegacySatpamReportKind,
  guardDutyIndexId,
  isTransferEligibleStatus,
  payrollPeriodForDutyDate,
  resolveSatpamAssignmentPayType,
  SATPAM_RATES,
  shiftOccurrenceId,
  satpamKetuaEditConflict,
  summarizeApprovedSatpamReports,
} from './domain';
import { pekaryaPayrollPeriodForDate } from './pekaryaSpj';

test('Thursday night remains Thursday regular duty and ends Friday', () => {
  assert.equal(getRegularSatpamPayType('2026-07-23', new Set()), 'Harian');
  assert.deepEqual(getShiftIsoBounds('2026-07-23', 'Malam'), {
    startsAtIso: '2026-07-23T22:00:00+07:00',
    endsAtIso: '2026-07-24T08:00:00+07:00',
  });
  assert.equal(payrollPeriodForDutyDate('2026-07-23'), '2026-07');
});

test('Friday and configured holidays use the premium rate', () => {
  assert.equal(getRegularSatpamPayType('2026-07-24', new Set()), 'Jumat & Libur');
  assert.equal(
    getRegularSatpamPayType('2026-08-17', new Set(['2026-08-17'])),
    'Jumat & Libur',
  );
});

test('month-end night shift stays in the start-date payroll period', () => {
  assert.deepEqual(getShiftIsoBounds('2026-07-31', 'Malam'), {
    startsAtIso: '2026-07-31T22:00:00+07:00',
    endsAtIso: '2026-08-01T08:00:00+07:00',
  });
  assert.equal(payrollPeriodForDutyDate('2026-07-31'), '2026-07');
  assert.equal(getRegularSatpamPayType('2026-07-31', new Set()), 'Jumat & Libur');
});

test('canonical Satpam rates match the approved pay structure', () => {
  assert.deepEqual(SATPAM_RATES, {
    Harian: 12_500,
    'Jumat & Libur': 25_000,
    'Lembur Sendiri': 30_000,
    'Lembur Cover': 50_000,
    'Off-Duty': 0,
  });
});

test('financial and occurrence identifiers are deterministic', () => {
  assert.equal(
    shiftOccurrenceId('team_1', '2026-07-24', 'Malam'),
    shiftOccurrenceId('team_1', '2026-07-24', 'Malam'),
  );
  assert.equal(
    guardDutyIndexId('2026-07-24', 'Malam', 'SAT-001'),
    '20260724__malam__SAT-001',
  );
});

test('legacy read path deduplicates financial identity without mutating inputs', () => {
  const reports = [
    {
      id: 'a',
      employeeId: 'E1',
      activityDate: '2026-07-24',
      shiftName: 'Pagi',
      postName: 'Pos 1',
      shiftType: 'Harian',
      fee: 12_500,
    },
    {
      id: 'b',
      employeeId: 'E1',
      activityDate: '2026-07-24',
      shiftName: 'Pagi',
      postName: 'Pos 1',
      shiftType: 'Harian',
      fee: 12_500,
    },
  ];
  const result = dedupeSatpamActivityReports(reports);
  assert.equal(result.length, 1);
  assert.equal(reports.length, 2);
});

test('negative net pay is rejected and transfer eligibility is locked-only', () => {
  assert.throws(
    () => calculatePayrollTotals([{ label: 'Gaji', amount: 1 }], [{ label: 'Potongan', amount: 2 }]),
    /tidak boleh negatif/,
  );
  assert.equal(isTransferEligibleStatus('draft'), false);
  assert.equal(isTransferEligibleStatus('finance_verified'), false);
  assert.equal(isTransferEligibleStatus('confirmed'), true);
  assert.equal(isTransferEligibleStatus('locked'), true);
  assert.equal(isTransferEligibleStatus('paid'), true);
});

test('Satpam duty dates use the same payroll periods as the other Pekarya', () => {
  // Regression: Satpam used to slice the calendar month here, so duties on the
  // 26th-31st were stamped with a period the payslip window never matched and
  // the fee silently vanished from the slip.
  assert.equal(payrollPeriodForDutyDate('2026-06-26'), '2026-07');
  assert.equal(payrollPeriodForDutyDate('2026-06-30'), '2026-07');
  assert.equal(payrollPeriodForDutyDate('2026-05-28'), '2026-06');
  assert.equal(payrollPeriodForDutyDate('2026-06-25'), '2026-06');
  // From August 2026 the period is the plain calendar month.
  assert.equal(payrollPeriodForDutyDate('2026-08-01'), '2026-08');
  assert.equal(payrollPeriodForDutyDate('2026-08-27'), '2026-08');
  assert.equal(payrollPeriodForDutyDate('2026-08-31'), '2026-08');
  assert.equal(payrollPeriodForDutyDate('2026-09-01'), '2026-09');

  // The two entry points must stay identical; drift is what caused the bug.
  for (const date of [
    '2026-05-26', '2026-06-25', '2026-06-26', '2026-06-30',
    '2026-07-31', '2026-08-01', '2026-08-27', '2026-09-30',
  ]) {
    assert.equal(payrollPeriodForDutyDate(date), pekaryaPayrollPeriodForDate(date));
  }
});

test('a Ketua Shift cannot pick an arbitrary pay rate for a regular post', () => {
  // Regression: the API used to trust any client-supplied shiftType that was
  // a key of SATPAM_RATES, letting a Ketua Shift mark an ordinary Tuesday
  // post as 'Jumat & Libur' or 'Lembur Cover' and get paid up to 4x the
  // correct rate. Only 'Lembur Cover' (with a documented substitution) may
  // ever override the server-computed regular rate.
  assert.equal(resolveSatpamAssignmentPayType(undefined, false, 'Harian'), 'Harian');
  assert.equal(
    resolveSatpamAssignmentPayType('Jumat & Libur', false, 'Harian'),
    'Harian',
    'a claimed Friday/holiday rate on a regular day must be ignored',
  );
  assert.equal(
    resolveSatpamAssignmentPayType('Lembur Sendiri', false, 'Harian'),
    'Harian',
    'Lembur Sendiri is only valid for the off-duty extra assignment, never a primary post',
  );
  assert.equal(
    resolveSatpamAssignmentPayType('Off-Duty', false, 'Harian'),
    'Harian',
    'Off-Duty must never be assignable to a filled post',
  );
  assert.equal(
    resolveSatpamAssignmentPayType('Lembur Cover', false, 'Harian'),
    'Lembur Cover',
    'an in-roster guard may still be marked as covering, with proof required upstream',
  );
  // An external (non-roster) guard is always paid the cover rate, regardless
  // of what shiftType the client sends — their presence alone proves cover.
  assert.equal(resolveSatpamAssignmentPayType('Harian', true, 'Harian'), 'Lembur Cover');
  assert.equal(resolveSatpamAssignmentPayType(undefined, true, 'Jumat & Libur'), 'Lembur Cover');
});

test('guard post photo URLs must live in the submitting Ketua Shift folder', () => {
  const valid =
    'https://firebasestorage.googleapis.com/v0/b/bucket.appspot.com/o/' +
    encodeURIComponent('satpam_shifts/EMP001/2026-07-28_Malam_Pos_1_123.jpg') +
    '?alt=media&token=abc';
  assert.doesNotThrow(() => assertSatpamPhotoUrl(valid, 'EMP001'));

  // A photo belonging to another Ketua Shift cannot be claimed as evidence.
  assert.throws(() => assertSatpamPhotoUrl(valid, 'EMP002'), /luar folder/);

  // Arbitrary remote images and non-HTTPS URLs are refused outright.
  assert.throws(
    () => assertSatpamPhotoUrl('https://evil.example.com/fake.jpg', 'EMP001'),
    /Firebase Storage/,
  );
  assert.throws(
    () =>
      assertSatpamPhotoUrl(
        'http://firebasestorage.googleapis.com/v0/b/x/o/satpam_shifts%2FEMP001%2Fa.jpg',
        'EMP001',
      ),
    /HTTPS/,
  );
  assert.throws(() => assertSatpamPhotoUrl('not-a-url', 'EMP001'), /tidak valid/);

  // Another collection's folder must not pass just because the host matches.
  assert.throws(
    () =>
      assertSatpamPhotoUrl(
        'https://firebasestorage.googleapis.com/v0/b/x/o/' +
          encodeURIComponent('receipts/JRN-1/toll.jpg') +
          '?alt=media',
        'EMP001',
      ),
    /luar folder/,
  );
});

test('flexible Satpam submission records warnings without rejecting partial rosters', () => {
  const anomalies = analyzeSatpamShiftSubmission({
    dutyDate: '2026-08-02',
    reportedShiftName: 'Sore',
    suggestedShiftName: 'Pagi',
    ketuaShiftId: 'KETUA001',
    assignments: [
      { postId: 'Pos 1', employeeId: 'GUARD001' },
      { postId: 'Pos 2', employeeId: 'GUARD001', shiftType: 'Lembur Cover' },
    ],
    activeSatpamIds: new Set(['GUARD001']),
    holidayCalendarConfigured: false,
    now: new Date('2026-07-30T00:00:00.000Z'),
  });

  assert.deepEqual(
    new Set(anomalies.map((item) => item.code)),
    new Set([
      'MISSING_POSTS',
      'DUPLICATE_GUARD',
      'KETUA_NOT_ASSIGNED',
      'ROTA_MISMATCH',
      'COVER_DETAILS_INCOMPLETE',
      'MISSING_PHOTO',
      'HOLIDAY_CALENDAR_MISSING',
      'FUTURE_WORK_NOT_FINISHED',
    ]),
  );
  assert.equal(
    anomalies.find((item) => item.code === 'DUPLICATE_GUARD')?.severity,
    'blocking',
  );
  assert.equal(
    anomalies.find((item) => item.code === 'MISSING_POSTS')?.severity,
    'warning',
  );
});

test('future work can be captured but does not become reviewable early', () => {
  assert.equal(
    hasSatpamShiftEnded(
      '2026-08-01',
      'Malam',
      new Date('2026-08-01T23:00:00+07:00'),
    ),
    false,
  );
  assert.equal(
    hasSatpamShiftEnded(
      '2026-08-01',
      'Malam',
      new Date('2026-08-02T08:01:00+07:00'),
    ),
    true,
  );
  assert.equal(
    hasActivityEnded(
      '2026-08-01',
      '22:00',
      '01:00',
      new Date('2026-08-02T00:30:00+07:00'),
    ),
    false,
  );
});

test('legacy report classification uses source metadata while explicit classification wins', () => {
  assert.equal(
    inferLegacySatpamReportKind({
      id: 'personal',
      reportKind: 'satpam_spj',
      shiftName: 'Pagi',
    }),
    'satpam_spj',
    'explicit personal SPJ must never be reclassified from incidental fields',
  );
  assert.equal(
    inferLegacySatpamReportKind({
      id: 'legacy-shift',
      sourceOccurrenceId: 'team_1__20260801__pagi',
    }),
    'satpam_shift_assignment',
  );
  assert.equal(
    inferLegacySatpamReportKind({ id: 'legacy-personal' }),
    'satpam_spj',
  );
});

test('Satpam payroll summarizes shift columns and personal SPJ simultaneously', () => {
  const contribution = summarizeApprovedSatpamReports([
    {
      id: 'shift-harian',
      reportKind: 'satpam_shift_assignment',
      sourceOccurrenceId: 'occurrence-1',
      employeeId: 'SAT-1',
      activityDate: '2026-08-01',
      postName: 'Pos 1',
      shiftName: 'Pagi',
      shiftType: 'Harian',
      status: 'approved',
      fee: 12_500,
    },
    {
      id: 'personal-spj',
      reportKind: 'satpam_spj',
      employeeId: 'SAT-1',
      activityDate: '2026-08-02',
      status: 'approved',
      fee: 47_500,
    },
    {
      id: 'found-item',
      reportKind: 'satpam_found_item',
      employeeId: 'SAT-1',
      activityDate: '2026-08-02',
      status: 'approved',
      fee: 5_000,
    },
    {
      id: 'shift-pending',
      reportKind: 'satpam_shift_assignment',
      employeeId: 'SAT-1',
      activityDate: '2026-08-03',
      shiftType: 'Lembur Cover',
      status: 'pending',
      fee: 50_000,
    },
  ]);
  assert.deepEqual(contribution, {
    personalSpj: 52_500,
    harianCount: 1,
    jumatLiburCount: 0,
    lemburSendiriCount: 0,
    lemburCoverCount: 0,
  });
});

test('duplicate shift financial identities are counted once but personal SPJs remain independent', () => {
  const contribution = summarizeApprovedSatpamReports([
    {
      id: 'shift-a',
      reportKind: 'satpam_shift_assignment',
      sourceLedgerEntryId: 'ledger-shift-1',
      employeeId: 'SAT-1',
      activityDate: '2026-08-01',
      shiftName: 'Pagi',
      postName: 'Pos 1',
      shiftType: 'Harian',
      status: 'approved',
      fee: 12_500,
    },
    {
      id: 'shift-retry',
      reportKind: 'satpam_shift_assignment',
      sourceLedgerEntryId: 'ledger-shift-1',
      employeeId: 'SAT-1',
      activityDate: '2026-08-01',
      shiftName: 'Pagi',
      postName: 'Pos 1',
      shiftType: 'Harian',
      status: 'approved',
      fee: 12_500,
    },
    {
      id: 'spj-a',
      reportKind: 'satpam_spj',
      employeeId: 'SAT-1',
      activityDate: '2026-08-01',
      status: 'approved',
      fee: 20_000,
    },
    {
      id: 'spj-b',
      reportKind: 'satpam_spj',
      employeeId: 'SAT-1',
      activityDate: '2026-08-01',
      status: 'approved',
      fee: 25_000,
    },
  ]);
  assert.equal(contribution.harianCount, 1);
  assert.equal(contribution.personalSpj, 45_000);
});

test('Ketua edit uses optimistic revision locking and auditor ownership', () => {
  assert.equal(
    satpamKetuaEditConflict({
      status: 'pending_review',
      auditorActionAt: null,
      revision: 3,
      expectedRevision: 3,
    }),
    null,
  );
  assert.equal(
    satpamKetuaEditConflict({
      status: 'pending_review',
      auditorActionAt: null,
      revision: 4,
      expectedRevision: 3,
    }),
    'stale_revision',
  );
  assert.equal(
    satpamKetuaEditConflict({
      status: 'under_review',
      auditorActionAt: { seconds: 1 },
      revision: 4,
      expectedRevision: 4,
    }),
    'auditor_locked',
  );
});

test('payroll lands on the month being compiled until the 6th', () => {
  // Before the 6th the previous period is still being compiled for the 5th-of-
  // month payment, so an open previous period wins over the current month.
  assert.equal(
    defaultPayrollPeriodToken(new Date(2026, 7, 1), false),
    '2026-07',
  );
  assert.equal(
    defaultPayrollPeriodToken(new Date(2026, 7, 5), false),
    '2026-07',
  );
  // Once that period is closed there is nothing left to compile in it.
  assert.equal(
    defaultPayrollPeriodToken(new Date(2026, 7, 1), true),
    '2026-08',
  );
  // From the 6th onward the current month is the live period either way.
  assert.equal(
    defaultPayrollPeriodToken(new Date(2026, 7, 6), false),
    '2026-08',
  );
  assert.equal(
    defaultPayrollPeriodToken(new Date(2026, 7, 20), false),
    '2026-08',
  );
  // January rolls back across the year boundary.
  assert.equal(
    defaultPayrollPeriodToken(new Date(2027, 0, 3), false),
    '2026-12',
  );
});
