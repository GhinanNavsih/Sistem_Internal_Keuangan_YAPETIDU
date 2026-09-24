import assert from 'node:assert/strict';
import test from 'node:test';
import {
  annualPaidLeaveDecisionIssue,
  annualPaidLeaveIdempotencyState,
  canReviewAnnualPaidLeave,
  isAnnualPaidLeaveRequestOwner,
  nextAnnualPaidLeaveBalanceRevision,
} from './annualPaidLeave';

test('employee API ownership is confined to the authenticated employee', () => {
  assert.equal(isAnnualPaidLeaveRequestOwner('employee-1', 'employee-1'), true);
  assert.equal(isAnnualPaidLeaveRequestOwner('employee-2', 'employee-1'), false);
  assert.equal(isAnnualPaidLeaveRequestOwner(undefined, 'employee-1'), false);
});

test('review API scopes Loyalis and blue-collar decisions by role and category', () => {
  assert.equal(
    canReviewAnnualPaidLeave(
      { role: 'loyalis_admin', permittedCategories: [] },
      { kind: 'loyalis', category: 'LOYALIS' },
    ),
    true,
  );
  assert.equal(
    canReviewAnnualPaidLeave(
      { role: 'satker_head', permittedCategories: ['KEBERSIHAN'] },
      { kind: 'blue_collar', category: 'SATPAM' },
    ),
    false,
  );
  assert.equal(
    canReviewAnnualPaidLeave(
      { role: 'super_admin', permittedCategories: [] },
      { kind: 'blue_collar', category: 'SATPAM' },
    ),
    true,
  );
});

test('idempotency replays an identical command and rejects key reuse', () => {
  assert.equal(annualPaidLeaveIdempotencyState(undefined, 'hash-a'), 'new');
  assert.equal(annualPaidLeaveIdempotencyState('hash-a', 'hash-a'), 'replay');
  assert.equal(annualPaidLeaveIdempotencyState('hash-a', 'hash-b'), 'conflict');
});

test('review API guard rejects stale revisions and immutable payroll approvals', () => {
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
});

test('review API guard rejects cross-workflow pay conflicts only on approval', () => {
  const conflict = {
    expectedRevision: 1,
    currentRevision: 1,
    status: 'pending' as const,
    reservedDays: 1,
    periodClosed: false,
    immutableSlip: false,
    payrollPostExists: false,
    approving: true,
    attendanceConflict: true,
  };
  assert.equal(annualPaidLeaveDecisionIssue(conflict), 'attendance_conflict');
  assert.equal(
    annualPaidLeaveDecisionIssue({ ...conflict, approving: false }),
    null,
  );
});

test('every balance write moves the revision on by one, whatever is stored', () => {
  assert.equal(nextAnnualPaidLeaveBalanceRevision(undefined), 1);
  assert.equal(nextAnnualPaidLeaveBalanceRevision(0), 1);
  assert.equal(nextAnnualPaidLeaveBalanceRevision(4), 5);
  assert.equal(nextAnnualPaidLeaveBalanceRevision('7'), 8);
  assert.equal(nextAnnualPaidLeaveBalanceRevision(-3), 1);
  assert.equal(nextAnnualPaidLeaveBalanceRevision(Number.NaN), 1);
});
