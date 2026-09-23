import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addCalendarYears,
  annualPaidLeaveAttendanceCorrection,
  annualPaidLeaveDecisionIssue,
  annualPaidLeaveEntitlementDays,
  annualPaidLeavePayType,
  annualPaidLeaveQualifyingDate,
  annualPaidLeaveRequestId,
  annualPaidLeaveTableFigures,
  calculateAnnualPaidLeaveBalance,
  canReviewAnnualPaidLeave,
  completedServiceYears,
  isAnnualPaidLeaveEligible,
  isDateOnly,
} from './annualPaidLeave';
import { pekaryaAttendanceAmount } from './attendance';

test('annual entitlement increases only after passing the five, ten, and fifteen year marks', () => {
  assert.equal(annualPaidLeaveEntitlementDays('2016-09-22', '2021-09-22'), 0);
  assert.equal(annualPaidLeaveEntitlementDays('2016-09-22', '2021-09-23'), 3);
  assert.equal(annualPaidLeaveEntitlementDays('2016-09-22', '2026-09-22'), 3);
  assert.equal(annualPaidLeaveEntitlementDays('2016-09-22', '2026-09-23'), 6);
  assert.equal(annualPaidLeaveEntitlementDays('2016-09-22', '2031-09-22'), 6);
  assert.equal(annualPaidLeaveEntitlementDays('2016-09-22', '2031-09-23'), 9);
  assert.equal(completedServiceYears('2016-09-22', '2026-09-22'), 10);
  assert.equal(isAnnualPaidLeaveEligible('2016-09-22', '2021-09-22'), false);
  assert.equal(isAnnualPaidLeaveEligible('2016-09-22', '2021-09-23'), true);
  assert.equal(annualPaidLeaveQualifyingDate('2016-09-22'), '2021-09-23');
});

test('calendar-year addition clamps leap-day anniversaries', () => {
  assert.equal(addCalendarYears('2016-02-29', 10), '2026-02-28');
  assert.equal(annualPaidLeaveEntitlementDays('2016-02-29', '2021-02-28'), 0);
  assert.equal(annualPaidLeaveEntitlementDays('2016-02-29', '2021-03-01'), 3);
  assert.equal(annualPaidLeaveQualifyingDate('2016-02-29'), '2021-03-01');
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
  ], 6);
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
    6,
  );
  assert.equal(exhausted.availableDays, 0);
  assert.equal(exhausted.reservedDays, 6);

  const released = calculateAnnualPaidLeaveBalance([
    { status: 'approved' },
    { status: 'declined' },
    { status: 'withdrawn' },
  ], 6);
  assert.deepEqual(released, {
    entitlementDays: 6,
    reservedDays: 0,
    usedDays: 1,
    availableDays: 5,
  });
});

test('eligibility and balances do not leak across calendar-year boundaries', () => {
  assert.equal(isAnnualPaidLeaveEligible('2021-12-31', '2026-12-31'), false);
  assert.equal(isAnnualPaidLeaveEligible('2021-12-31', '2027-01-01'), true);
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
      { role: 'loyalis_admin', permittedCategories: [] },
      { kind: 'loyalis', category: 'LOYALIS' },
    ),
    true,
  );
  assert.equal(
    canReviewAnnualPaidLeave(
      { role: 'loyalis_admin', permittedCategories: [] },
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

test('employee table leave figures prefer the stored balance and never guess a remainder', () => {
  const base = { serviceDate: '2016-09-22', year: 2026, asOfDate: '2026-09-23' };
  assert.deepEqual(
    annualPaidLeaveTableFigures({ ...base, balance: { entitlementDays: 6, availableDays: 2 } }),
    { entitlementDays: 6, remainingDays: 2, qualifyingDate: '2021-09-23' },
  );
  // Entitled but no readable balance (inactive, or outside the viewer's scope).
  assert.deepEqual(
    annualPaidLeaveTableFigures(base),
    { entitlementDays: 6, remainingDays: null, qualifyingDate: '2021-09-23' },
  );
  // Not yet past five years: nothing to take, so the remainder is known to be zero.
  assert.deepEqual(
    annualPaidLeaveTableFigures({ ...base, serviceDate: '2023-01-10' }),
    { entitlementDays: 0, remainingDays: 0, qualifyingDate: '2028-01-11' },
  );
  // A past year is judged at 31 December of that year.
  assert.equal(
    annualPaidLeaveTableFigures({ ...base, serviceDate: '2021-06-01', year: 2025, asOfDate: '2026-09-23' })
      .entitlementDays,
    0,
  );
  assert.deepEqual(
    annualPaidLeaveTableFigures({ ...base, serviceDate: '' }),
    { entitlementDays: null, remainingDays: null, qualifyingDate: null },
  );
});
