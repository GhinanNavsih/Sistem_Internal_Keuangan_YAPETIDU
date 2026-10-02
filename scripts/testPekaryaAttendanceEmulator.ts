/** Existing blank-status imports must reach review, publication and payslips. Emulator only. */
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { PEKARYA_JOB_CATEGORIES } from '../src/lib/payroll/pekaryaSpj';
import { categoryUsesAttendanceImport } from '../src/utils/rekapConfig';

const PROJECT = 'demo-pekarya-attendance';

async function main() {
  if (
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== PROJECT ||
    !/^(localhost|127\.0\.0\.1):8188$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') ||
    !/^(localhost|127\.0\.0\.1):9198$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || '')
  ) {
    throw new Error('This test requires the demo Pekarya attendance Firestore and Auth emulators.');
  }
  const { adminDb: db } = await import('../src/lib/firebase-admin');
  const { GET } = await import('../src/app/api/attendance/pekarya/route');
  const { POST: publish } = await import('../src/app/api/attendance/pekarya/publish/route');
  const { loadPekaryaSlipPreviews } = await import('../src/lib/server/pekaryaSlipPreview');
  const { attendanceCorrectionHeadId } = await import('../src/lib/server/attendanceStore');
  const signup = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`,
    {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'attendance-reviewer@example.test', password: 'password123', returnSecureToken: true }),
    },
  );
  const identity = await signup.json();
  assert.ok(identity.idToken, JSON.stringify(identity));
  await db.doc(`users/${identity.localId}`).set({ role: 'super_admin', displayName: 'Attendance reviewer' });
  const headers = { Authorization: `Bearer ${identity.idToken}`, 'Content-Type': 'application/json' };
  const period = '2026-09';
  const revisionId = '2026_09__r0001';
  await db.doc(`AttendanceImports/${period}`).set({ activeRevisionId: revisionId, activeRevision: 1 });
  await db.doc(`AttendanceImportRevisions/${revisionId}`).set({ revision: 1, status: 'active' });
  await db.doc(`PayrollPeriods/${period}`).set({ attendanceStatus: 'open', workCalendar: { revision: 1 } });

  const categories = PEKARYA_JOB_CATEGORIES.filter(categoryUsesAttendanceImport);
  const fixtures: Array<{ category: string; employeeId: string; nipy: string }> = [];
  const scans = [
    ['2026-09-01', '', '06:10:31', '16:01:32'],
    ['2026-09-02', '', '06:58:10', '14:01:52'],
    ['2026-09-03', '', '06:04:44', null],
    ['2026-09-04', '', '07:30:00', '14:00:00'],
    ['2026-09-05', 'TIDAK HADIR', '07:30:00', '14:00:00'],
    ['2026-09-06', '', '07:30:00', '14:00:00'],
    ['2026-09-07', '', null, null],
  ] as const;
  for (const [index, category] of categories.entries()) {
    const employeeId = `BC_ATTENDANCE_${index}`;
    const nipy = `140110000${String(index + 1).padStart(2, '0')}`;
    fixtures.push({ category, employeeId, nipy });
    await db.doc(`Employees_BlueCollar/${employeeId}`).set({
      name: `Worker ${category}`, nipy,
      employment: { status: 'active', jobCategory: category, startDate: '2025-01-01' },
      flags: { isActive: true, isPayrollEligible: true },
    });
    for (const [dayIndex, [date, workStatus, scanIn, scanOut]] of scans.entries()) {
      // Exactly the old database shape, including its incorrect derived issue.
      await db.doc(`AttendanceImportRows/${employeeId}_${date}`).set({
        revisionId, period, rowNumber: index * 100 + dayIndex + 2,
        nipy, name: `Worker ${category}`, department: '', date, workStatus, scanIn, scanOut,
        issues: scanIn || scanOut ? ['SCAN_WITHOUT_MASUK'] : [],
      });
    }
    await db.doc(`PekaryaAttendanceCorrectionHeads/${attendanceCorrectionHeadId(period, employeeId, '2026-09-06')}`).set({
      period, employeeId, nipy, date: '2026-09-06', present: false, revision: 1,
    });
  }
  const getView = async (category: string) => {
    const response = await GET(new NextRequest(`http://localhost/api/attendance/pekarya?period=${period}&category=${category}`, { headers }));
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    return result;
  };
  for (const fixture of fixtures) {
    const view = await getView(fixture.category);
    assert.equal(view.employees.length, 1);
    const employee = view.employees[0];
    assert.equal(employee.payableDays, 4, fixture.category);
    assert.equal(employee.harianAmount, 29_808);
    assert.equal(employee.jumatLiburAmount, 25_001);
    assert.equal(employee.totalAmount, 54_809);
    assert.equal(employee.incompletePunchCount, 1);
    assert.deepEqual(employee.days.map((day: { amount: number }) => day.amount), [12_500, 12_500, 4_808, 25_001, 0, 0, 0]);
    const denied = employee.days.find((day: { date: string }) => day.date === '2026-09-06');
    assert.equal(denied.present, false);
    assert.equal(denied.corrected, true);
    const partial = employee.days.find((day: { date: string }) => day.date === '2026-09-03');
    assert.equal(partial.scanOutAuto, true);
    assert.deepEqual(partial.issues, ['INCOMPLETE_PUNCH']);
  }
  const all = await getView('ALL');
  assert.equal(all.employees.length, fixtures.length);
  const employeeIds = fixtures.map((fixture) => fixture.employeeId);
  const provisional = await loadPekaryaSlipPreviews(period, employeeIds);
  for (const fixture of fixtures) {
    const preview = provisional.previews[fixture.employeeId];
    assert.equal(preview.meta.attendanceSource, 'uploaded_attendance');
    assert.ok(preview.meta.warnings.some((warning) => warning.code === 'attendance_unpublished'));
    assert.equal(provisional.attendanceLogs![fixture.employeeId].reduce((sum, day) => sum + day.amount, 0), 54_809);
  }

  // Publication must persist those same exact amounts and keep source scans intact.
  const publication = await publish(new NextRequest('http://localhost/api/attendance/pekarya/publish', {
    method: 'POST', headers,
    body: JSON.stringify({
      requestId: 'pekarya-attendance-blank-status-test', period, category: 'ALL',
      acknowledgedWarnings: ['INCOMPLETE_PUNCH', 'CORRECTED_ATTENDANCE'],
    }),
  }));
  const published = await publication.json();
  assert.equal(publication.status, 200, JSON.stringify(published));
  for (const fixture of fixtures) {
    const uraian = (await db.doc(`UraianGaji/2026_09_${fixture.category}`).get()).data()!;
    const entry = uraian.entries[fixture.employeeId];
    assert.equal(entry.values.harian, 29_808);
    assert.equal(entry.values.jumatLibur, 25_001);
    assert.deepEqual(entry.counts, { harian: 3, jumatLibur: 1 });
    const source = (await db.doc(`AttendanceImportRows/${fixture.employeeId}_2026-09-03`).get()).data()!;
    assert.equal(source.workStatus, '');
    assert.equal(source.scanOut, null);
    assert.deepEqual(source.issues, ['SCAN_WITHOUT_MASUK']);
  }
  const final = await loadPekaryaSlipPreviews(period, employeeIds);
  for (const fixture of fixtures) {
    const preview = final.previews[fixture.employeeId];
    assert.equal(preview.meta.attendanceSource, 'uraian');
    assert.equal(preview.meta.warnings.some((warning) => warning.code === 'attendance_unpublished'), false);
  }
  const satpam = await publish(new NextRequest('http://localhost/api/attendance/pekarya/publish', {
    method: 'POST', headers, body: JSON.stringify({ requestId: 'satpam-attendance-test', period, category: 'SATPAM' }),
  }));
  assert.equal(satpam.status, 403);
  await db.doc(`PayrollPeriods/${period}`).update({ attendanceStatus: 'closed' });
  const closed = await publish(new NextRequest('http://localhost/api/attendance/pekarya/publish', {
    method: 'POST', headers,
    body: JSON.stringify({ requestId: 'closed-attendance-test', period, category: 'ALL', acknowledgedWarnings: ['INCOMPLETE_PUNCH', 'CORRECTED_ATTENDANCE'] }),
  }));
  assert.equal(closed.status, 409);
  console.log(`PASS: existing blank-status scans reach review, publication and payslips for all ${categories.length} payable categories; absence, corrections, raw evidence, Satpam and closed periods remain protected.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
