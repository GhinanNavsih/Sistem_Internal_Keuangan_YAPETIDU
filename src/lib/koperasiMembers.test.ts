import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bankDetailsDiffer, diffKoperasiMember, employeeLinkedToMember, hasSakuBank,
  KOPERASI_MEMBERSHIP_STATUSES, KOPERASI_PAYMENT_STATUSES, KOPERASI_STAFF_ROLES,
  koperasiMemberApproved, koperasiMemberSnapshot, koperasiMonthlyIuranWajib,
  mirroredStatus, parseKoperasiMemberEdit, rankKoperasiLinkCandidates,
  sakuBankDetails, toKoperasiEmployee, validateKoperasiMemberEdit,
} from './koperasiMembers';

const valid = { paymentStatus: 'Payroll Deduction', membershipStatus: 'approved', role: 'Member', iuranPokok: 250_000, iuranWajib: 25_000, confirmStaffRole: false, note: '' };

test('payroll requires effective approval and explicit Payroll Deduction', () => {
  for (const membershipStatus of [...KOPERASI_MEMBERSHIP_STATUSES, undefined]) {
    for (const paymentStatus of [...KOPERASI_PAYMENT_STATUSES, undefined]) {
      const member = { status: 'approved', membershipStatus, paymentStatus, iuranWajib: 42_500 };
      const approved = membershipStatus === 'approved' || membershipStatus === undefined;
      assert.equal(koperasiMonthlyIuranWajib(member), approved && paymentStatus === 'Payroll Deduction' ? 42_500 : 0);
    }
  }
  assert.equal(koperasiMonthlyIuranWajib(null), 0);
  assert.equal(koperasiMonthlyIuranWajib({ status: 'approved' }), 0, 'Loyalis_248 missing payment status stops deduction');
  for (const amount of [undefined, null, 0]) assert.equal(koperasiMonthlyIuranWajib({ ...valid, iuranWajib: amount }), 25_000);
  assert.equal(koperasiMemberApproved({ status: 'approved', membershipStatus: 'inactive' }), false);
  assert.equal(koperasiMemberApproved({ status: 'inactive', membershipStatus: 'approved' }), true);
  assert.equal(koperasiMemberApproved({ status: 'approved', membershipStatus: '' }), false, 'empty is not missing');
});

test('every membership state mirrors the legacy status and audit includes the correction', () => {
  for (const status of KOPERASI_MEMBERSHIP_STATUSES) assert.equal(mirroredStatus(status), status === 'Pending' ? 'pending' : status);
  const before = { ...valid, status: 'inactive' };
  assert.deepEqual(diffKoperasiMember(before, { ...before, status: 'approved' }), [{ field: 'status', before: 'inactive', after: 'approved' }]);
  assert.equal(koperasiMemberSnapshot({}).paymentStatus, null);
});

test('edit validates enums, integer money bounds, legacy pending, note, and staff consent', () => {
  assert.deepEqual(validateKoperasiMemberEdit(parseKoperasiMemberEdit(valid)), {});
  for (const field of ['iuranPokok', 'iuranWajib'] as const) {
    for (const value of [0, -1, 0.5, 10_000_001, NaN, Infinity, '25000', true, null]) {
      assert.ok(validateKoperasiMemberEdit(parseKoperasiMemberEdit({ ...valid, [field]: value }))[field]);
    }
    for (const value of [1, 10_000_000]) assert.deepEqual(validateKoperasiMemberEdit({ ...valid, [field]: value }), {});
  }
  for (const role of KOPERASI_STAFF_ROLES) {
    assert.ok(validateKoperasiMemberEdit({ ...valid, role }).confirmStaffRole);
    assert.deepEqual(validateKoperasiMemberEdit({ ...valid, role, confirmStaffRole: true }), {});
    assert.ok(validateKoperasiMemberEdit(parseKoperasiMemberEdit({ ...valid, role, confirmStaffRole: 'true' })).confirmStaffRole);
  }
  for (const field of ['membershipStatus', 'paymentStatus', 'role'] as const) assert.ok(validateKoperasiMemberEdit({ ...valid, [field]: 'invalid' })[field]);
  const pending = { ...valid, paymentStatus: 'Pending Verification' };
  assert.ok(validateKoperasiMemberEdit(pending, valid).paymentStatus);
  assert.deepEqual(validateKoperasiMemberEdit(pending, pending), {});
  assert.ok(validateKoperasiMemberEdit({ ...valid, note: 'a'.repeat(501) }).note);
  assert.equal(parseKoperasiMemberEdit({ ...valid, bankDetails: { bank: 'Forged' } }).note, '');
});

test('bank mapping preserves bank names and leading account zeroes, strips account separators', () => {
  const expected = { bank: 'BRIS', nomorRekening: '0012345' };
  assert.deepEqual(sakuBankDetails({ banking_info: { bank_name: 'BRIS', account_number: '001-23 45' } }, 'Employees_Loyalis'), expected);
  assert.deepEqual(sakuBankDetails({ bankAccount: { bankName: 'BRIS', accountNumber: '0012345' } }, 'Employees_BlueCollar'), expected);
  assert.equal(bankDetailsDiffer({ ...expected, bank: 'BSI' }, expected), true);
  assert.equal(bankDetailsDiffer(expected, expected), false);
  assert.equal(bankDetailsDiffer(null, expected), true);
  assert.equal(hasSakuBank(sakuBankDetails({}, 'Employees_Loyalis')), false);
  assert.equal(hasSakuBank({ bank: 'BSI', nomorRekening: '' }), false);
});

test('link ranking is NIK, email, normalized/overridden name, then everyone else', () => {
  const employee = (id: string, data = {}) => toKoperasiEmployee(id, 'Employees_BlueCollar', { name: 'Other', employment: { status: 'active' }, ...data });
  const candidates = rankKoperasiLinkCandidates({ id: 'member', nama: 'Siti Rofiah', email: 'TEST@EXAMPLE.TEST', nik: '35170001' }, [
    employee('name', { name: "Siti Rofi'ah, A. Md." }),
    employee('other'),
    employee('email', { email: 'test@example.test' }),
    employee('nik', { nik: '35170001' }),
    employee('linked', { nik: '35170001', koperasiUserId: 'already-linked' }),
    employee('uid-only', { koperasiAuthUid: 'already-linked' }),
    employee('inactive', { employment: { status: 'inactive' } }),
    employee('converted', { conversion: { toEmployeeId: 'Loyalis_001', effectivePeriod: '2026-10' } }),
  ]);
  assert.deepEqual(candidates.map(row => row.employee.id), ['nik', 'email', 'name', 'other']);
  assert.deepEqual(candidates.map(row => row.match), ['NIK', 'Email', 'Nama', '']);
  assert.equal(rankKoperasiLinkCandidates({ id: 'member' }, [employee('no-identity')])[0].score, 0);
  assert.equal(employeeLinkedToMember({ id: 'missing-uid' }, { koperasiAuthUid: 'missing-uid' }), true);
});
