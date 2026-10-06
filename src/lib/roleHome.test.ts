import assert from 'node:assert/strict';
import test from 'node:test';
import { EMPLOYEE_ACTIVITY_PATHS } from './employeeActivities';
import { LOYALIS_ADMIN_HOME_PATH } from './payroll/roles';
import { getRoleHomePath } from './roleHome';

test('each role lands on its own home page', () => {
  assert.equal(getRoleHomePath({ role: 'loyalis' }), '/employee/payslip');
  assert.equal(getRoleHomePath({ role: 'satker_head' }), '/dashboard/payroll/activity-review');
  assert.equal(getRoleHomePath({ role: 'satker_head_loyalis' }), '/dashboard/payroll/uraian');
  assert.equal(getRoleHomePath({ role: 'satker_finance_admin' }), '/dashboard/satker-finance');
  assert.equal(getRoleHomePath({ role: 'rector_finance' }), '/dashboard/satker-finance');
  assert.equal(getRoleHomePath({ role: 'loyalis_admin' }), LOYALIS_ADMIN_HOME_PATH);
  assert.equal(getRoleHomePath({ role: 'super_admin' }), '/dashboard/payroll');
  assert.equal(getRoleHomePath({ role: 'finance_verifier' }), '/dashboard/payroll');
});

test('honorer and ketua shift land on their own activity workflow', () => {
  assert.equal(
    getRoleHomePath({ role: 'honorer', permittedCategories: ['SOPIR'] }),
    EMPLOYEE_ACTIVITY_PATHS.sopir,
  );
  assert.equal(
    getRoleHomePath({ role: 'honorer', permittedCategories: ['KEBERSIHAN'] }),
    EMPLOYEE_ACTIVITY_PATHS.pekarya,
  );
  assert.equal(
    getRoleHomePath({ role: 'ketua_shift_satpam', permittedCategories: [] }),
    EMPLOYEE_ACTIVITY_PATHS.satpam,
  );
});

test('a retired role id lands where its successor does', () => {
  assert.equal(getRoleHomePath({ role: 'employee_admin' }), LOYALIS_ADMIN_HOME_PATH);
  assert.equal(getRoleHomePath({ role: 'loyalis_presence_admin' }), LOYALIS_ADMIN_HOME_PATH);
});
