import assert from 'node:assert/strict';
import test from 'node:test';
import { collectSatpamFindings } from './satpamAttendanceFindings';
import type {
  SatpamAttendanceDetailEmployee,
  SatpamAttendanceDetailRow,
} from './satpamAttendanceDetail';

function row(overrides: Partial<SatpamAttendanceDetailRow>): SatpamAttendanceDetailRow {
  return {
    key: 'BC_1:2026-09-02',
    date: '2026-09-02',
    shiftName: 'Pagi',
    payType: 'Harian',
    expectedScanIn: '08:00',
    expectedScanOut: '14:00',
    scanIn: '07:50:00',
    scanOut: '14:01:00',
    amount: 12_500,
    status: 'complete',
    coveredByName: null,
    pendingAbsenceId: null,
    warning: null,
    review: { occurrenceId: 'team_1__20260902__pagi', employeeId: 'BC_1' },
    ...overrides,
  };
}

function guard(
  name: string,
  days: SatpamAttendanceDetailRow[],
  identityIssue: string | null = null,
): SatpamAttendanceDetailEmployee {
  return {
    employeeId: `BC_${name}`,
    name,
    nipy: '1',
    category: 'SATPAM',
    identityIssue,
    harianCount: 0,
    jumatLiburCount: 0,
    lemburCount: 0,
    harianAmount: 0,
    jumatLiburAmount: 0,
    lemburAmount: 0,
    totalAmount: 0,
    paidDays: 0,
    incompleteDays: 0,
    days,
  };
}

test('ordinary days, lateness, absences and leave are not findings', () => {
  const findings = collectSatpamFindings([
    guard('A', [
      row({ status: 'complete' }),
      row({ key: 'k2', date: '2026-09-03', status: 'late' }),
      row({ key: 'k3', date: '2026-09-04', status: 'leave' }),
      row({ key: 'k4', date: '2026-09-05', status: 'absent' }),
      row({ key: 'k5', date: '2026-09-06', status: 'covered' }),
      row({ key: 'k6', date: '2026-09-07', status: 'pending' }),
    ]),
  ]);
  assert.deepEqual(findings, []);
});

test('report without scan, scan without report and one-sided scans are findings', () => {
  const findings = collectSatpamFindings([
    guard('A', [
      row({ key: 'k1', date: '2026-09-02', status: 'no_scan' }),
      row({ key: 'k2', date: '2026-09-03', status: 'scan_only', review: null }),
      row({ key: 'k3', date: '2026-09-04', status: 'partial' }),
    ]),
  ]);
  assert.deepEqual(
    findings.map((finding) => finding.kind),
    ['report_without_scan', 'scan_without_report', 'one_sided_scan'],
  );
  assert.equal(findings[0].review?.occurrenceId, 'team_1__20260902__pagi');
  assert.equal(findings[1].review, null);
});

test('a leave day that still conflicts with work or a scan is a finding of its own', () => {
  const findings = collectSatpamFindings([
    guard('A', [
      row({ status: 'leave', warning: 'Ada scan kehadiran pada tanggal izin yang disetujui.' }),
    ]),
  ]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, 'leave_conflict');
  assert.match(findings[0].message, /scan kehadiran/);
});

test('an identity problem is a finding about the guard, without a date', () => {
  const findings = collectSatpamFindings([guard('A', [], 'NIPY belum diisi.')]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, 'identity');
  assert.equal(findings[0].date, null);
});

test('findings are ordered by date, then guard name', () => {
  const findings = collectSatpamFindings([
    guard('Budi', [row({ key: 'b1', date: '2026-09-05', status: 'no_scan' })]),
    guard('Agus', [
      row({ key: 'a1', date: '2026-09-05', status: 'no_scan' }),
      row({ key: 'a2', date: '2026-09-01', status: 'no_scan' }),
    ]),
  ]);
  assert.deepEqual(
    findings.map((finding) => `${finding.date} ${finding.employeeName}`),
    ['2026-09-01 Agus', '2026-09-05 Agus', '2026-09-05 Budi'],
  );
});
