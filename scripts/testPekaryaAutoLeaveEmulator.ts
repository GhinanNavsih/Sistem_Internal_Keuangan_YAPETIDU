/** Full automatic annual-cuti lifecycle. All writes are confined to emulators. */
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

const PROJECT = 'demo-pekarya-auto-leave';
async function main() {
  if (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== PROJECT ||
      !/^(localhost|127\.0\.0\.1):8188$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') ||
      !/^(localhost|127\.0\.0\.1):9198$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || '')) {
    throw new Error('Requires the demo Pekarya auto-leave Firestore and Auth emulators.');
  }
  const { adminDb: db } = await import('../src/lib/firebase-admin');
  const { POST } = await import('../src/app/api/attendance/pekarya/auto-leave/route');
  const { GET } = await import('../src/app/api/attendance/pekarya/route');
  const { POST: correct } = await import('../src/app/api/attendance/pekarya/corrections/route');
  const { POST: reviewShift } = await import('../src/app/api/satpam/shifts/review/route');
  const { reconcilePekaryaAutoLeave, ensurePekaryaAutoLeave } = await import('../src/lib/server/pekaryaAutoLeave');
  const { assertAutoLeaveReady } = await import('../src/lib/server/automaticLeavePosting');
  const { loadEffectiveAttendanceDays, loadAttendanceEmployeeIdentities, pekaryaPublicationId } = await import('../src/lib/server/attendanceStore');
  const { buildPekaryaAttendanceView, buildSatpamAttendanceDetails } = await import('../src/lib/server/pekaryaAttendance');
  const { annualPaidLeaveDocumentId } = await import('../src/lib/server/annualPaidLeave');
  const { PEKARYA_JOB_CATEGORIES } = await import('../src/lib/payroll/pekaryaSpj');
  const { periodFridayDates } = await import('../src/lib/payroll/calendar');
  const { shiftOccurrenceId } = await import('../src/lib/payroll/domain');
  const period = '2026-10';
  const actor = { uid: 'system-test', role: 'super_admin' as const, displayName: 'Test', email: null, permittedCategories: [] };
  async function signup(role: string, permittedCategories: string[] = []) {
    const identity = await (await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `${role}-${permittedCategories.join('-') || 'all'}@example.test`, password: 'password123', returnSecureToken: true }),
    })).json();
    assert.ok(identity.idToken, JSON.stringify(identity));
    await db.doc(`users/${identity.localId}`).set({ role, displayName: role, permittedCategories });
    return `Bearer ${identity.idToken}`;
  }
  const authorization = await signup('super_admin');
  const outsider = await signup('honorer');
  const head = await signup('satker_head', ['TEKNISI']);
  const finance = await signup('finance_verifier');
  async function call(handler: (request: NextRequest) => Promise<Response>, body?: Record<string, unknown>, auth = authorization, url = 'http://localhost/test') {
    const response = await handler(new NextRequest(url, { method: body ? 'POST' : 'GET', headers: { authorization: auth, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }));
    return { status: response.status, body: await response.json() };
  }
  const requestRef = (id: string, date: string) => db.doc(`AnnualPaidLeaveRequests/${annualPaidLeaveDocumentId(id, date)}`);
  const postRef = (id: string, date: string) => db.doc(`AnnualPaidLeavePayrollPosts/${annualPaidLeaveDocumentId(id, date)}`);
  const used = async (id: string) => Number((await db.doc(`AnnualPaidLeaveBalances/${id}__2026`).get()).data()?.usedDays || 0);
  const read = async (path: string) => (await db.doc(path).get()).data()!;
  const ids = Object.fromEntries(PEKARYA_JOB_CATEGORIES.map((category) => [category, `AUTO_${category}`]));
  for (const category of PEKARYA_JOB_CATEGORIES) await db.doc(`Employees_BlueCollar/${ids[category]}`).set({
    name: category, nipy: `N-${category}`, employment: { jobCategory: category, status: 'active', startDate: '2010-01-01' }, flags: { isActive: true, isPayrollEligible: true },
  });
  await db.doc('Employees_BlueCollar/MISSING').set({ name: 'Missing data', nipy: 'N-MISSING', employment: { jobCategory: 'TEKNISI', status: 'active', startDate: '2010-01-01' } });
  await db.doc('Employees_WhiteCollar/DUP').set({ nipy: 'N-PONTI', name: 'Duplicate', employment: { status: 'active' } });
  await db.doc(`PayrollPeriods/${period}`).set({ period, workCalendar: { revision: 1, premiumDates: [...periodFridayDates(period), '2026-10-03'] } });
  await db.doc('PayrollSlipStates/2026_10_AUTO_KEBERSIHAN').set({ period: '2026_10', status: 'locked' });
  await db.doc(`AnnualPaidLeaveBalances/${ids.TEKNISI}__2026`).set({ employeeId: ids.TEKNISI, year: 2026, usedDays: 0, reservedDays: 0, manualUsedDays: 8 });
  await requestRef(ids.PEKARYA, '2026-10-01').set({ employeeId: ids.PEKARYA, employeeKind: 'blue_collar', category: 'PEKARYA', leaveDate: '2026-10-01', period, status: 'pending', revision: 1 });
  await db.doc(`AnnualPaidLeaveBalances/${ids.PEKARYA}__2026`).set({ employeeId: ids.PEKARYA, year: 2026, reservedDays: 1, usedDays: 0 });
  await db.doc('PekaryaOfficialLeaveRequests/pending').set({ employeeId: ids.KEBERSIHAN_PONTI, category: 'KEBERSIHAN_PONTI', date: '2026-10-05', period, status: 'pending' });
  const rows: Array<Record<string, unknown>> = [];
  function row(id: string, date: string, extra: Record<string, unknown> = {}) {
    return { rowNumber: rows.length + 1, nipy: `N-${id.replace('AUTO_', '')}`, identifierSource: 'NIPY', sourceNipy: `N-${id.replace('AUTO_', '')}`, sourcePin: null,
      name: id.replace('AUTO_', ''), department: 'CS', date, workStatus: 'TIDAK HADIR', scanIn: null, scanOut: null, issues: [], ...extra };
  }
  for (const category of PEKARYA_JOB_CATEGORIES) for (const date of ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-31']) rows.push(row(ids[category], date));
  async function activate(revision: number, sourceRows = rows) {
    const revisionId = `2026_10__r000${revision}`;
    await db.doc(`AttendanceImportRevisions/${revisionId}`).set({ period, revision, status: 'active' });
    await Promise.all(sourceRows.map((data, index) => db.doc(`AttendanceImportRows/${revisionId}_${index}`).set({ ...data, revisionId })));
    await db.doc(`AttendanceImports/${period}`).set({ period, activeRevision: revision, activeRevisionId: revisionId });
  }
  await activate(1);
  await db.doc('ActivityReports/JOURNEY').set({ employeeId: ids.SOPIR, jobCategory: 'SOPIR', period, status: 'approved',
    journeyId: 'J1', activityDate: '2026-10-05', dateStart: '2026-10-05', dateEnd: '2026-10-05', timeStart: '07:00', timeEnd: '15:00' });
  await db.doc('Employees_BlueCollar/COVER').set({ name: 'Cover', nipy: 'N-COVER', employment: { jobCategory: 'SATPAM', status: 'active', startDate: '2010-01-01' } });
  await db.doc('ActivityReports/COVER').set({ employeeId: 'COVER', employeeName: 'Cover', jobCategory: 'SATPAM', period,
    dutyDate: '2026-10-02', shiftName: 'Sore', reportKind: 'satpam_shift_assignment', status: 'approved',
    shiftType: 'Lembur Cover', fee: 50_000, coveredEmployeeId: ids.SATPAM });
  const planDay = (date: string, shiftName: string) => ({ dutyDate: date, shiftName, assignments: [{ postId: 'Pos 1', employeeId: ids.SATPAM }], offDutyEmployeeId: 'OTHER' });
  await db.doc('SatpamDutyPlans/202610__team_1').set({ period, teamId: 'team_1', revision: 1, status: 'published',
    ketuaShiftId: ids.SATPAM, rosterEmployeeIds: [ids.SATPAM], reconciliationEmployeeIds: [ids.SATPAM], generatedDays: [
      planDay('2026-10-01', 'Pagi'), planDay('2026-10-02', 'Sore'), planDay('2026-10-03', 'Malam'), planDay('2026-10-31', 'Malam'),
    ], staleDates: [], lateBackfillDates: [] });
  await db.doc(`PekaryaAttendancePublications/${pekaryaPublicationId(period, 'PEKARYA')}`).set({ period, category: 'PEKARYA', state: 'published', stale: false, importRevisionId: '2026_10__r0001', calendarRevision: 1, publicationRevision: 1 });
  await db.doc('UraianGaji/2026_10_PEKARYA').set({ entries: { [ids.PEKARYA]: { values: { harian: 0, custom: 123 }, counts: {} } } });

  assert.equal((await call(POST, { period }, outsider)).status, 403);
  assert.equal((await call(POST, { period, category: 'SATPAM' }, head)).status, 403);
  assert.equal((await call(POST, { period: '2026-99' })).status, 400);
  const preview = await reconcilePekaryaAutoLeave(period, actor, { dryRun: true });
  assert.ok(preview.results.some((item) => item.covered.length));
  assert.equal((await db.collection('AnnualPaidLeaveRequests').where('source', '==', 'auto_absence').get()).size, 0);
  const first = await call(POST, { period, category: 'ALL' });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const resultOf = (id: string) => first.body.results.find((item: { employeeId: string }) => item.employeeId === id);
  assert.ok(resultOf('MISSING').held.length);
  assert.ok(resultOf(ids.PONTI).held.length);
  assert.equal(await used(ids.PONTI), 0);
  assert.equal(await used(ids.KEBERSIHAN), 0);
  assert.equal(await used(ids.TEKNISI), 1);
  // A run for one employee (what linking attendance does) rechecks only that
  // employee and leaves what the page lists for everyone else in place.
  const summaryIds = async (category: string) => ((await db.doc(`PekaryaAutoLeaveStates/${period.replace('-', '_')}__${category}`).get())
    .data()?.summary?.results ?? []).map((item: { employeeId: string }) => item.employeeId).sort();
  const teknisiBefore = await summaryIds('TEKNISI');
  const sopirBefore = await summaryIds('SOPIR');
  assert.ok(teknisiBefore.includes(ids.TEKNISI) && sopirBefore.includes(ids.SOPIR));
  const scoped = await ensurePekaryaAutoLeave(period, actor, ['TEKNISI', 'SOPIR'], [ids.TEKNISI]);
  assert.deepEqual(scoped.results.map((item) => item.employeeId), [ids.TEKNISI]);
  assert.deepEqual(await summaryIds('TEKNISI'), teknisiBefore);
  assert.deepEqual(await summaryIds('SOPIR'), sopirBefore);
  assert.equal(await used(ids.TEKNISI), 1);
  assert.equal(await used(ids.SOPIR), 3); // 1, 4, 31; journey attendance protects 5.
  assert.equal((await requestRef(ids.SOPIR, '2026-10-05').get()).exists, false);
  // A pending journey spans every date it touches, including the overnight
  // end date; neither date may silently consume annual leave during review.
  await db.doc('ActivityReports/PENDING_JOURNEY').set({ employeeId: ids.SOPIR, jobCategory: 'SOPIR', period,
    status: 'pending', journeyId: 'J2', activityDate: '2026-10-03', dateStart: '2026-10-03',
    timeStart: '20:00', timeEnd: '08:00' });
  assert.equal((await call(POST, { period, category: 'SOPIR' })).status, 200);
  assert.equal(await used(ids.SOPIR), 2);
  assert.equal((await requestRef(ids.SOPIR, '2026-10-04').get()).data()?.status, 'withdrawn');
  await db.doc('ActivityReports/PENDING_JOURNEY').update({ status: 'withdrawn' });
  assert.equal((await call(POST, { period, category: 'SOPIR' })).status, 200);
  assert.equal(await used(ids.SOPIR), 3);
  assert.equal((await requestRef(ids.PEKARYA, '2026-10-01').get()).data()?.status, 'pending');
  assert.equal((await requestRef(ids.KEBERSIHAN_PONTI, '2026-10-05').get()).exists, false);
  assert.equal((await requestRef(ids.PEKARYA, '2026-10-02').get()).exists, false);
  assert.equal((await requestRef(ids.PEKARYA, '2026-10-03').get()).exists, false);
  assert.equal(await used(ids.SATPAM), 3);
  assert.equal((await postRef(ids.SATPAM, '2026-10-01').get()).data()?.amount, 15_000);
  assert.equal((await postRef(ids.SATPAM, '2026-10-02').get()).data()?.amount, 25_000);
  assert.equal((await read('ActivityReports/COVER')).fee, 50_000);
  assert.equal((await postRef(ids.SATPAM, '2026-10-03').get()).data()?.amount, 25_000);
  assert.equal((await requestRef(ids.SATPAM, '2026-10-31').get()).exists, false);
  assert.equal((await read('UraianGaji/2026_10_PEKARYA')).entries[ids.PEKARYA].values.harian, 37_500);
  assert.equal((await read('UraianGaji/2026_10_PEKARYA')).entries[ids.PEKARYA].values.custom, 123);
  const identities = await loadAttendanceEmployeeIdentities(period);
  const actual = await loadEffectiveAttendanceDays(period, { identities, includeAutomaticLeave: false });
  const effective = await loadEffectiveAttendanceDays(period, { identities });
  assert.equal(actual.days.find((day) => day.nipy === 'N-TEKNISI' && day.date === '2026-10-01')?.present, false);
  assert.equal(effective.days.find((day) => day.nipy === 'N-TEKNISI' && day.date === '2026-10-01')?.scanIn, '07:30:00');
  assert.equal((await buildPekaryaAttendanceView(period, 'TEKNISI')).employees.find((employee) => employee.employeeId === ids.TEKNISI)?.harianAmount, 12_500);
  const details = (await buildSatpamAttendanceDetails(period)).employees.find((employee) => employee.employeeId === ids.SATPAM)!;
  assert.equal(details.days.find((day) => day.date === '2026-10-03')?.scanIn, '23:00');
  assert.equal(details.days.find((day) => day.date === '2026-10-03')?.scanOutDate, '2026-10-04');
  const audits = (await db.collection('FinancialAuditLogs').get()).size;
  await Promise.all([call(POST, { period }, finance), call(POST, { period })]).then((results) => results.forEach((result) => assert.equal(result.status, 200, JSON.stringify(result.body))));
  assert.equal((await db.collection('FinancialAuditLogs').get()).size, audits);
  assert.equal(await used(ids.SATPAM), 3);
  const correction = await call(correct, { period, category: 'PEKARYA', employeeId: ids.PEKARYA, date: '2026-10-05',
    present: true, scanIn: '07:30', scanOut: '14:00', workStatus: 'MASUK', reason: 'Kehadiran dikonfirmasi petugas', expectedRevision: 0, requestId: 'actual-attendance-correction' });
  assert.equal(correction.status, 200, JSON.stringify(correction.body));
  assert.equal((await requestRef(ids.PEKARYA, '2026-10-05').get()).data()?.status, 'withdrawn');
  assert.equal((await postRef(ids.PEKARYA, '2026-10-05').get()).exists, false);
  assert.equal(await used(ids.PEKARYA), 2);

  // The approved shift itself refunds automatic leave in the same transaction.
  const occurrenceId = shiftOccurrenceId('team_1', '2026-10-01', 'Pagi');
  await db.doc(`ShiftOccurrences/${occurrenceId}`).set({ teamId: 'team_1', dutyDate: '2026-10-01', payrollPeriod: period,
    shiftName: 'Pagi', reportedShiftName: 'Pagi', suggestedShiftName: 'Pagi', status: 'pending_review', reviewStatus: 'pending',
    revision: 1, ketuaShiftId: ids.SATPAM, reportIds: ['WORK1'], pendingReportIds: ['WORK1'] });
  await db.doc('ActivityReports/WORK1').set({ employeeId: ids.SATPAM, employeeName: 'SATPAM', period, dutyDate: '2026-10-01',
    jobCategory: 'SATPAM', reportKind: 'satpam_shift_assignment', assignmentKind: 'primary', assignmentKey: 'primary_Pos_1',
    sourceOccurrenceId: occurrenceId, sourceLedgerEntryId: 'WORK1', ketuaShiftId: ids.SATPAM, postId: 'Pos 1',
    shiftName: 'Pagi', reportedShiftName: 'Pagi', shiftType: 'Harian', status: 'pending', fee: 0 });
  const reviewed = await call(reviewShift, { occurrenceId, expectedRevision: 1, requestId: 'approve-real-shift', decisions: [{ reportId: 'WORK1', action: 'approve' }] });
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));
  assert.equal((await requestRef(ids.SATPAM, '2026-10-01').get()).data()?.status, 'withdrawn');
  assert.equal(await used(ids.SATPAM), 2);
  assert.equal((await read('ActivityReports/WORK1')).fee, 15_000);
  assert.equal((await read('PayrollLedgerEntries/WORK1')).amount, 15_000);
  assert.equal((await call(POST, { period })).status, 200);
  assert.equal(await used(ids.SATPAM), 2);

  await db.doc('AttendanceImportRevisions/2026_11__r0001').set({ period: '2026-11', revision: 1 });
  await db.doc('AttendanceImportRows/NOV1').set({ ...row(ids.SATPAM, '2026-11-01'), revisionId: '2026_11__r0001' });
  await db.doc('AttendanceImports/2026-11').set({ activeRevisionId: '2026_11__r0001', activeRevision: 1 });
  assert.equal((await call(POST, { period })).status, 200);
  assert.equal((await requestRef(ids.SATPAM, '2026-10-31').get()).data()?.status, 'approved');
  assert.equal((await postRef(ids.SATPAM, '2026-10-31').get()).data()?.scheduledShift.endsAtIso, '2026-11-01T07:00:00+07:00');
  await db.doc('Employees_WhiteCollar/DUP').delete();
  // The page-load reconciles above already synced PONTI into the rekap; remove
  // it to recreate a publication whose rekap has gone missing.
  await db.doc('UraianGaji/2026_10_PONTI').delete();
  await db.doc(`PekaryaAttendancePublications/${pekaryaPublicationId(period, 'PONTI')}`).set({
    period, category: 'PONTI', state: 'published', stale: false, importRevisionId: '2026_10__r0001', calendarRevision: 1, publicationRevision: 1,
  });
  assert.equal((await call(POST, { period, category: 'PONTI' })).status, 409, 'posting succeeds but missing derived rekap blocks payroll');
  await assert.rejects(assertAutoLeaveReady(period, ['PONTI']), /belum selesai/);
  await db.doc('UraianGaji/2026_10_PONTI').set({ entries: {} });
  assert.equal((await call(POST, { period, category: 'PONTI' })).status, 200);
  await assertAutoLeaveReady(period, ['PONTI']);
  assert.ok(await used(ids.PONTI) > 0);

  // Missing rows on a replacement import release prior automatic credits.
  await activate(2, rows.filter((data) => data.nipy !== 'N-PONTI'));
  assert.equal((await call(POST, { period, category: 'PONTI' })).status, 200);
  assert.equal(await used(ids.PONTI), 0);
  assert.equal((await requestRef(ids.PONTI, '2026-10-01').get()).data()?.status, 'withdrawn');
  // Explicit manual decisions remain authoritative, even after withdrawal.
  await requestRef(ids.PONTI, '2026-10-01').set({ employeeId: ids.PONTI, employeeKind: 'blue_collar', category: 'PONTI',
    period, leaveDate: '2026-10-01', source: 'manual', status: 'withdrawn', revision: 1 });
  await activate(3);
  assert.equal((await call(POST, { period, category: 'PONTI' })).status, 200);
  assert.equal((await requestRef(ids.PONTI, '2026-10-01').get()).data()?.status, 'withdrawn');
  await requestRef(ids.PONTI, '2026-10-01').update({ status: 'approved' });
  const manualConflict = await call(correct, { period, category: 'PONTI', employeeId: ids.PONTI, date: '2026-10-01',
    present: true, scanIn: '07:30', scanOut: '14:00', reason: 'Manual approved leave must retain its guard', expectedRevision: 0, requestId: 'manual-cuti-guard' });
  assert.equal(manualConflict.status, 409);
  const beforeGet = (await db.collection('FinancialAuditLogs').get()).size;
  assert.equal((await call(GET, undefined, finance, `http://localhost/api/attendance/pekarya?period=${period}&category=ALL`)).status, 200);
  assert.equal((await db.collection('FinancialAuditLogs').get()).size, beforeGet);
  await db.doc(`PayrollPeriods/${period}`).update({ attendanceStatus: 'closed' });
  const closed = await call(POST, { period });
  assert.equal(closed.status, 200);
  assert.equal(closed.body.applicable, false);
  assert.equal((await call(POST, { period: '2026-08' })).body.applicable, false);
  if (process.env.PEKARYA_AUTO_LEAVE_BROWSER === '1') {
    await db.doc(`PayrollPeriods/${period}`).update({ attendanceStatus: 'open' });
    await db.doc(`PayrollSlipStates/2026_10_${ids.KEBERSIHAN}`).delete();
    await call(POST, { period });
  }
  console.log('Pekarya auto leave: all categories, holds, quota, actual attendance, shift refunds, rates, payroll, replay/concurrency and closure passed.');
  await db.terminate();
}
main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
