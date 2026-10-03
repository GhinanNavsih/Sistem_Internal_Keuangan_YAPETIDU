import assert from 'node:assert/strict';
import test from 'node:test';
import { isPayableSatpamOfficialLeave, isSatpamShiftPayReport, satpamOfficialLeavePayment } from './satpamOfficialLeave';

test('approved scheduled leave wins over a legacy shift-registration exclusion', () => {
  const request = { status: 'approved', reportType: 'izin_resmi', teamId: 'team_3',
    payrollExcludedFromHarian: true, payrollExclusionReason: 'SHIFT_REGISTERED_SAME_DATE' };
  assert.equal(isPayableSatpamOfficialLeave(request), true);
  assert.equal(isPayableSatpamOfficialLeave({ ...request, status: 'pending' }), false);
  assert.equal(isPayableSatpamOfficialLeave({ ...request, status: 'declined' }), false);
  assert.equal(isPayableSatpamOfficialLeave({ ...request, reportType: 'scan' }), false);
  assert.equal(isPayableSatpamOfficialLeave({ ...request, scheduleRelation: 'unassigned' }), false);
  assert.equal(isPayableSatpamOfficialLeave({ ...request, teamId: null }), false);
  assert.equal(isPayableSatpamOfficialLeave({ ...request, payrollExclusionReason: 'NO_SCHEDULED_DUTY' }), false);
  assert.equal(isPayableSatpamOfficialLeave(request, true), false);
  assert.equal(isPayableSatpamOfficialLeave({ ...request, approvedAmount: 12500 }, true), true);
});

test('official leave uses the scheduled ordinary, Friday and frozen holiday rate', () => {
  const calendar = new Set(['2026-09-28']);
  assert.deepEqual(satpamOfficialLeavePayment('2026-09-30', calendar), { payType: 'Harian', amount: 12500 });
  assert.deepEqual(satpamOfficialLeavePayment('2026-09-25', calendar), { payType: 'Jumat & Libur', amount: 25000 });
  assert.deepEqual(satpamOfficialLeavePayment('2026-09-28', calendar), { payType: 'Jumat & Libur', amount: 25000 });
});

test('shift pay sources include legacy shift rows and exclude personal SPJ or other categories', () => {
  assert.equal(isSatpamShiftPayReport({ reportKind: 'satpam_shift_assignment', jobCategory: 'SATPAM' }), true);
  assert.equal(isSatpamShiftPayReport({ sourceType: 'satpam_shift' }), true);
  assert.equal(isSatpamShiftPayReport({ reportKind: 'satpam_spj', jobCategory: 'SATPAM' }), false);
  assert.equal(isSatpamShiftPayReport({ sourceOccurrenceId: 'driver', jobCategory: 'SOPIR' }), false);
});
