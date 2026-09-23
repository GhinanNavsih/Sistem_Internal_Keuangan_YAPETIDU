import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addCalendarYears,
  annualPaidLeaveAttendanceCorrection,
  annualPaidLeaveDecisionIssue,
  annualPaidLeavePayType,
  annualPaidLeaveQualifyingDate,
  annualPaidLeaveRequestId,
  calculateAnnualPaidLeaveBalance,
  canReviewAnnualPaidLeave,
  completedServiceYears,
  isAnnualPaidLeaveEligible,
  isDateOnly,
} from './annualPaidLeave';
import { pekaryaAttendanceAmount } from './attendance';

test('annual paid leave requires ten completed years on the requested date', () => {
  assert.equal(completedServiceYears('2016-09-22', '2026-09-21'), 9);
  assert.equal(completedServiceYears('2016-09-22', '2026-09-22'), 10);
  assert.equal(isAnnualPaidLeaveEligible('2016-09-22', '2026-09-21'), false);
  assert.equal(isAnnualPaidLeaveEligible('2016-09-22', '2026-09-22'), true);
  assert.equal(annualPaidLeaveQualifyingDate('2016-09-22'), '2026-09-22');
});

test('calendar-year addition clamps leap-day anniversaries', () => {
  assert.equal(addCalendarYears('2016-02-29', 10), '2026-02-28');
  assert.equal(isAnnualPaidLeaveEligible('2016-02-29', '2026-02-27'), false);
  assert.equal(isAnnualPaidLeaveEligible('2016-02-29', '2026-02-28'), true);
});

test('date-only validation rejects impossible dates', () => {
  assert.equal(isDateOnly('2026-12-31'), true);
  assert.equal(isDateOnly('2026-02-29'), false);
  assert.equal(isDateOnly('2024-02-29'), true);
  assert.equal(isDateOnly('22-09-2026'), false);
});

test('pending days reserve balance and approved days consume it', () => {
  const balance = calculateAnnualPaidLeaveBalance([
    { status: 'pending' },
    { status: 'pending' },
    { status: 'approved' },
    { status: 'declined' },
    { status: 'withdrawn' },
  ]);
  assert.deepEqual(balance, {
    entitlementDays: 6,
    reservedDays: 2,
    usedDays: 1,
    availableDays: 3,
  });
});

test('six active dates exhaust the annual entitlement while declined and withdrawn dates release it', () => {
  const exhausted = calculateAnnualPaidLeaveBalance(
    Array.from({ length: 6 }, () => ({ status: 'pending' as const })),
  );
  assert.equal(exhausted.availableDays, 0);
  assert.equal(exhausted.reservedDays, 6);

  const released = calculateAnnualPaidLeaveBalance([
    { status: 'approved' },
    { status: 'declined' },
    { status: 'withdrawn' },
  ]);
  assert.deepEqual(released, {
    entitlementDays: 6,
    reservedDays: 0,
    usedDays: 1,
    availableDays: 5,
  });
});

test('eligibility and balances do not leak across calendar-year boundaries', () => {
  assert.equal(isAnnualPaidLeaveEligible('2017-01-01', '2026-12-31'), false);
  assert.equal(isAnnualPaidLeaveEligible('2017-01-01', '2027-01-01'), true);
  assert.equal(calculateAnnualPaidLeaveBalance([], 0).availableDays, 0);
  assert.equal(calculateAnnualPaidLeaveBalance([], 6).availableDays, 6);
});

test('employee and date form one deterministic duplicate-prevention key', () => {
  assert.equal(
    annualPaidLeaveRequestId('EMP_001', '2026-09-26'),
    'EMP_001__2026-09-26',
  );
  assert.notEqual(
    annualPaidLeaveRequestId('EMP_001', '2026-09-26'),
    annualPaidLeaveRequestId('EMP_001', '2026-09-27'),
  );
});

test('weekends remain valid paid-leave calendar dates', () => {
  assert.equal(isDateOnly('2026-09-26'), true);
  assert.deepEqual(annualPaidLeaveAttendanceCorrection(), {
    present: true,
    workStatus: 'CUTI',
    scanIn: '07:30:00',
    scanOut: '14:00:00',
  });
});

test('approved leave uses existing normal and premium attendance classifications', () => {
  assert.equal(annualPaidLeavePayType(false), 'Harian');
  assert.equal(annualPaidLeavePayType(true), 'Jumat & Libur');
  assert.deepEqual(annualPaidLeaveAttendanceCorrection(), {
    present: true,
    workStatus: 'CUTI',
    scanIn: '07:30:00',
    scanOut: '14:00:00',
  });
  assert.equal(pekaryaAttendanceAmount('07:30:00', '14:00:00', false), 12_500);
  assert.equal(pekaryaAttendanceAmount('07:30:00', '14:00:00', true), 25_001);
});

test('review scope follows employee kind and permitted blue-collar category', () => {
  assert.equal(
    canReviewAnnualPaidLeave(
      { role: 'loyalis_presence_admin', permittedCategories: [] },
      { kind: 'loyalis', category: 'LOYALIS' },
    ),
    true,
  );
  assert.equal(
    canReviewAnnualPaidLeave(
      { role: 'loyalis_presence_admin', permittedCategories: [] },
      { kind: 'blue_collar', category: 'TEKNISI' },
    ),
    false,
  );
  assert.equal(
    canReviewAnnualPaidLeave(
      { role: 'satker_head', permittedCategories: [' teknisi '] },
      { kind: 'blue_collar', category: 'TEKNISI' },
    ),
    true,
  );
  assert.equal(
    canReviewAnnualPaidLeave(
      { role: 'satker_head', permittedCategories: ['KEBERSIHAN'] },
      { kind: 'blue_collar', category: 'TEKNISI' },
    ),
    false,
  );
  assert.equal(
    canReviewAnnualPaidLeave(
      { role: 'super_admin', permittedCategories: [] },
      { kind: 'loyalis', category: 'LOYALIS' },
    ),
    true,
  );
});

test('review decision guard blocks unsafe approvals while still allowing a decline to release balance', () => {
  const valid = {
    expectedRevision: 1,
    currentRevision: 1,
    status: 'pending' as const,
    reservedDays: 1,
    periodClosed: false,
    immutableSlip: false,
    payrollPostExists: false,
    approving: true,
    attendanceConflict: false,
  };
  assert.equal(annualPaidLeaveDecisionIssue(valid), null);
  assert.equal(
    annualPaidLeaveDecisionIssue({ ...valid, currentRevision: 2 }),
    'revision_conflict',
  );
  assert.equal(
    annualPaidLeaveDecisionIssue({ ...valid, periodClosed: true }),
    'period_closed',
  );
  assert.equal(
    annualPaidLeaveDecisionIssue({ ...valid, immutableSlip: true }),
    'immutable_slip',
  );
  assert.equal(
    annualPaidLeaveDecisionIssue({ ...valid, attendanceConflict: true }),
    'attendance_conflict',
  );
  assert.equal(
    annualPaidLeaveDecisionIssue({ ...valid, reservedDays: 0 }),
    'reserved_balance_missing',
  );
  assert.equal(
    annualPaidLeaveDecisionIssue({ ...valid, payrollPostExists: true }),
    'payroll_post_exists',
  );
  assert.equal(
    annualPaidLeaveDecisionIssue({
      ...valid,
      approving: false,
      periodClosed: true,
      immutableSlip: true,
      attendanceConflict: true,
    }),
    null,
  );
});
