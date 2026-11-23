import assert from 'node:assert/strict';
import test from 'node:test';
import { EMPLOYEE_ACTIVITY_PATHS } from './employeeActivities';
import {
  getUserRoleLabel,
  isFinanceDashboardPath,
  isLoyalisAdminPath,
  LOYALIS_ADMIN_HOME_PATH,
} from './payroll/roles';
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

test('Badan Keuangan can open payroll pages and Keuangan SatKer', () => {
  assert.equal(isFinanceDashboardPath(getRoleHomePath({ role: 'finance_verifier' })), true);
  for (const path of [
    '/dashboard/payroll/master',
    '/dashboard/employees',
    '/dashboard/satker-finance',
    '/dashboard/payroll/koperasi',
    '/dashboard/payroll/simpan-pinjam',
    '/dashboard/payroll/uraian/rekap-pekarya',
    '/dashboard/payroll/uraian/presensi-loyalis-raw',
    '/dashboard/payroll/uraian/kjm',
  ]) assert.equal(isFinanceDashboardPath(path), true, path);

  for (const path of [
    '/dashboard/users',
    '/dashboard/surat-menyurat',
    '/dashboard/reservasi-ruang',
    '/dashboard/pemeriksaan-ruang',
    '/dashboard/payroll/facility-reports',
    '/dashboard/payroll/driver-journeys',
    '/dashboard/payroll/uraian/tugas',
    '/dashboard/payroll/uraian/simulasi-perjalanan',
    '/employee/payslip',
  ]) assert.equal(isFinanceDashboardPath(path), false, path);
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

test('Admin Karyawan (loyalis_admin) is named so and may open Presensi Pekarya', () => {
  assert.equal(getUserRoleLabel('loyalis_admin'), 'Admin Karyawan');
  assert.equal(getUserRoleLabel('employee_admin'), 'Admin Karyawan');
  assert.equal(isLoyalisAdminPath('/dashboard/payroll/uraian/presensi-pekarya'), true);
  assert.equal(isLoyalisAdminPath('/dashboard/payroll/uraian/rekap-pekarya'), false);
  assert.equal(isLoyalisAdminPath('/dashboard/payroll/uraian/senam-pagi'), true);
});
