/** Approved scheduled leave owns pay, independent of shift review order. Emulator-only. */
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

async function main() {
  if (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== 'demo-satpam-leave-pay' ||
    !/^(localhost|127\.0\.0\.1):8188$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') ||
    !/^(localhost|127\.0\.0\.1):9198$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || '')) {
    throw new Error('This test requires the demo Satpam leave-pay Auth and Firestore emulators.');
  }
  const { adminDb: db } = await import('../src/lib/firebase-admin');
  const { POST: review } = await import('../src/app/api/satpam/absences/review/route');
  const { GET: absences } = await import('../src/app/api/satpam/absences/route');
  const { POST: reviewShift } = await import('../src/app/api/satpam/shifts/review/route');
  const { POST: submitShift } = await import('../src/app/api/satpam/shifts/route');
  const { GET: config } = await import('../src/app/api/satpam/config/route');
  const { buildSatpamDutyReconciliation, syncSatpamDutyReconciliation } = await import('../src/lib/server/satpamDutyPlan');
  const { buildSatpamAttendanceMismatches } = await import('../src/lib/server/pekaryaAttendance');
  const { repairSatpamApprovedLeavePay } = await import('../src/lib/server/satpamApprovedLeaveRepair');
  const { SATPAM_POSTS, shiftOccurrenceId } = await import('../src/lib/payroll/domain');
  const { periodFridayDates } = await import('../src/lib/payroll/calendar');
  const { getSatpamShiftForTeam } = await import('../src/utils/satpamRotation');
  const { defaultSatpamScanTimes } = await import('../src/lib/payroll/satpamAttendance');
  const signup = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'leave-pay@example.test', password: 'password123', returnSecureToken: true }),
  });
  const identity = await signup.json();
  assert.ok(identity.idToken, JSON.stringify(identity));
  const userRef = db.doc(`users/${identity.localId}`);
  const auditor = { role: 'satker_head', displayName: 'Satpam auditor', permittedCategories: ['SATPAM'] };
  await userRef.set(auditor);
  const ids = Array.from({ length: 10 }, (_, index) => `LEAVE_GUARD_${index + 1}`);
  const employeeId = ids[0];
  const leaderId = ids[1];
  const period = '2026-09';
  const teamId = 'team_3';
  const dates = ['2026-09-25', '2026-09-28', '2026-09-29', '2026-09-30'];
  const day = (date: string) => ({ dutyDate: date, shiftName: getSatpamShiftForTeam(3, date),
    assignments: SATPAM_POSTS.map((post, index) => ({ postId: post.id, employeeId: ids[index] })), offDutyEmployeeId: ids[9] });
  for (const [index, id] of ids.entries()) await db.doc(`Employees_BlueCollar/${id}`).set({ name: id, nipy: `14011000${index + 10}`,
    employment: { status: 'active', jobCategory: 'SATPAM' }, flags: { isActive: true, isPayrollEligible: true } });
  await db.doc(`SatpamShiftTeams/${teamId}`).set({ ketuaShiftId: leaderId, memberEmployeeIds: ids.filter((id) => id !== leaderId) });
  await db.doc('SatpamDutyPlans/202609__team_3').set({ period, teamId, status: 'published', revision: 1,
    ketuaShiftId: leaderId, fixedPost9EmployeeId: ids[8], rosterEmployeeIds: ids, reconciliationEmployeeIds: ids,
    generatedDays: dates.map(day), lateBackfillDates: [], staleDates: [] });
  await db.doc(`PayrollPeriods/${period}`).set({ period, workCalendar: { revision: 1, premiumDates: [...periodFridayDates(period), '2026-09-28'] } });
  // The annual calendar differs deliberately; frozen period holidays must win.
  await db.doc('PayrollHolidayCalendars/2026').set({ dates: ['2026-09-29'] });
  await db.doc('UraianGaji/2026_09_SATPAM').set({ entries: {} });
  const leaveId = (date: string, id = employeeId) => `${id}__${date.replaceAll('-', '')}`;
  async function seedLeave(date: string, extra: Record<string, unknown> = {}, id = employeeId) {
    await db.doc(`SatpamAbsenceRequests/${leaveId(date, id)}`).set({ employeeId: id, employeeName: id, period, dutyDate: date,
      teamId, reportType: 'izin_resmi', absenceType: 'sakit', shiftName: day(date).shiftName, postId: 'Pos 1',
      status: 'pending', revision: 1, reason: 'Sakit', ...extra });
  }
  async function seedWork(date: string, status: string) {
    const occurrenceId = shiftOccurrenceId(teamId, date, day(date).shiftName);
    const reportId = `WORK-${date}`;
    await db.doc(`ShiftOccurrences/${occurrenceId}`).set({ teamId, dutyDate: date, payrollPeriod: period,
      shiftName: day(date).shiftName, reportedShiftName: day(date).shiftName, suggestedShiftName: day(date).shiftName,
      status: status === 'pending' ? 'pending_review' : 'approved', reviewStatus: status === 'pending' ? 'pending' : 'approved',
      revision: 1, ketuaShiftId: leaderId, reportIds: [reportId], pendingReportIds: status === 'pending' ? [reportId] : [] });
    await db.doc(`ActivityReports/${reportId}`).set({ employeeId, employeeName: employeeId, period, dutyDate: date,
      jobCategory: 'SATPAM', reportKind: 'satpam_shift_assignment', assignmentKind: 'primary', assignmentKey: 'primary_Pos_1',
      sourceOccurrenceId: occurrenceId, sourceLedgerEntryId: reportId, ketuaShiftId: leaderId,
      postId: 'Pos 1', shiftName: day(date).shiftName, reportedShiftName: day(date).shiftName,
      shiftType: 'Harian', status, fee: status === 'approved' ? 12500 : 0 });
    if (status === 'approved') await db.doc(`PayrollLedgerEntries/${reportId}`).set({ employeeId, payrollPeriod: period,
      status: 'posted', sourceType: 'satpam_shift', sourceId: reportId, payType: 'Harian', amount: 12500 });
    return { reportId, occurrenceId };
  }
  async function call(handler: (request: NextRequest) => Promise<Response>, body?: Record<string, unknown>, status = 200, url = 'http://localhost/test') {
    const response = await handler(new NextRequest(url, { method: body ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${identity.idToken}`, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}) }));
    const data = await response.json();
    assert.equal(response.status, status, JSON.stringify(data));
    return data;
  }
  const command = (date: string, action = 'approve', revision = 1, requestId = `approve-${date}`) => ({
    absenceRequestId: leaveId(date), expectedRevision: revision, action, requestId,
  });
  const read = async (path: string) => (await db.doc(path).get()).data()!;
  // Auditor rejected work first: accepted leave must still pay the ordinary duty.
  await seedLeave(dates[2]);
  const declined = await seedWork(dates[2], 'declined');
  await call(review, command(dates[2]));
  assert.equal((await read(`PayrollLedgerEntries/ABS-${leaveId(dates[2])}`)).amount, 12500);
  assert.equal((await read(`ActivityReports/${declined.reportId}`)).status, 'declined');
  // Approved work first: leave replaces its payment atomically.
  await seedLeave(dates[3]);
  const work = await seedWork(dates[3], 'approved');
  const approved = await call(review, command(dates[3]));
  assert.equal(approved.amount, 12500);
  assert.equal((await read(`PayrollLedgerEntries/${work.reportId}`)).status, 'voided');
  assert.equal((await read(`ActivityReports/${work.reportId}`)).fee, 0);
  assert.equal((await read(`ActivityReports/${work.reportId}`)).status, 'approved');
  const uraian = await read('UraianGaji/2026_09_SATPAM');
  assert.equal(uraian.entries[employeeId].counts.harian, 2);
  assert.equal(uraian.entries[employeeId].values.harian, 25000);
  const view = await buildSatpamDutyReconciliation(period);
  const employee = view.plans[0].employees.find((item) => item.employeeId === employeeId)!;
  assert.equal(employee.fulfilledByAbsence, 2);
  assert.equal(employee.fulfilledByWork, 0);
  assert.equal(employee.conflictingDuties, 0);
  const attendance = await buildSatpamAttendanceMismatches(period, { allowMissingActiveImport: true });
  assert.ok(!attendance.mismatches.some((item) => item.employeeId === employeeId && item.code === 'REPORT_WITHOUT_ATTENDANCE'));
  assert.ok(!attendance.mismatches.some((item) => item.reportId === declined.reportId && item.code === 'APPROVED_ABSENCE_WORK_CONFLICT'));
  assert.ok(attendance.mismatches.some((item) => item.reportId === work.reportId && item.code === 'APPROVED_ABSENCE_WORK_CONFLICT'));
  await call(review, command(dates[2], 'supersede_decline', 2, 'reverse-declined-work-leave'));
  assert.equal((await read(`ActivityReports/${declined.reportId}`)).fee, 0);
  assert.equal((await read(`ActivityReports/${declined.reportId}`)).status, 'declined');
  assert.equal((await db.doc(`PayrollLedgerEntries/${declined.reportId}`).get()).exists, false);
  await call(review, command(dates[2], 'supersede_approve', 3, 'restore-declined-work-leave'));
  assert.equal((await call(review, command(dates[3]))).idempotent, true);
  assert.equal((await db.collection('FinancialAuditLogs').where('requestId', '==', `approve-${dates[3]}`).get()).size, 1);
  await call(review, command(dates[3], 'supersede_decline', 1, 'stale-reversal'), 409);
  await call(review, command(dates[3], 'supersede_decline', 2, 'reverse-approved-leave'));
  assert.equal((await read(`PayrollLedgerEntries/${work.reportId}`)).amount, 12500);
  assert.equal((await read(`PayrollLedgerEntries/${work.reportId}`)).status, 'posted');
  assert.equal((await read(`ActivityReports/${work.reportId}`)).fee, 12500);
  assert.equal((await read(`PayrollLedgerEntries/ABS-${leaveId(dates[3])}`)).status, 'voided');
  await call(review, command(dates[3], 'supersede_approve', 3, 'accept-leave-again'));
  // Leave first: subsequent work approval and submission cannot double-pay it.
  await seedLeave(dates[0]);
  assert.equal((await call(review, command(dates[0]))).amount, 25000);
  const pending = await seedWork(dates[0], 'pending');
  await call(reviewShift, { requestId: 'work-after-leave', occurrenceId: pending.occurrenceId,
    decisions: [{ reportId: pending.reportId, action: 'approve' }], confirmPayClassificationWarnings: true }, 409);
  await call(reviewShift, { requestId: 'decline-work-after-leave', occurrenceId: pending.occurrenceId,
    decisions: [{ reportId: pending.reportId, action: 'decline', reason: 'Approved official leave' }] });
  assert.equal((await read(`PayrollLedgerEntries/ABS-${leaveId(dates[0])}`)).amount, 25000);
  // Legacy exclusion and a frozen holiday are repaired without changing acceptance.
  await seedLeave(dates[1], { status: 'approved', approvedAmount: 0, approvedPayType: null,
    payrollExcludedFromHarian: true, payrollExclusionReason: 'SHIFT_REGISTERED_SAME_DATE' });
  const dry = await repairSatpamApprovedLeavePay(leaveId(dates[1]), 1);
  assert.equal(dry.status, 'would_repair');
  assert.ok('amount' in dry);
  assert.equal(dry.amount, 25000);
  assert.equal((await read(`SatpamAbsenceRequests/${leaveId(dates[1])}`)).revision, 1);
  assert.equal((await repairSatpamApprovedLeavePay(leaveId(dates[1]), 1, true)).status, 'repaired');
  assert.equal((await repairSatpamApprovedLeavePay(leaveId(dates[1]), 2, true)).status, 'unchanged');
  await assert.rejects(repairSatpamApprovedLeavePay(leaveId(dates[1]), 1, true), /Stale/);
  assert.equal((await read(`SatpamAbsenceEntitlements/${leaveId(dates[1])}`)).payType, 'Jumat & Libur');
  const payload = await call(absences, undefined, 200, `http://localhost/test?period=${period}`);
  const returned = payload.requests.find((request: { id: string }) => request.id === leaveId(dates[3]));
  assert.equal(returned.payrollExcludedFromHarian, false);
  assert.equal(returned.hasShiftRegistrationConflict, true);
  // Existing protections remain in both the API and the repair.
  await db.doc(`PayrollSlipStates/2026_09_${employeeId}`).set({ status: 'paid' });
  const immutableUraian = (await read('UraianGaji/2026_09_SATPAM')).entries[employeeId];
  await syncSatpamDutyReconciliation(period);
  assert.deepEqual((await read('UraianGaji/2026_09_SATPAM')).entries[employeeId], immutableUraian);
  await call(review, command(dates[1], 'supersede_approve', 2, 'immutable-leave'), 409);
  assert.equal((await repairSatpamApprovedLeavePay(leaveId(dates[1]), 2, true)).status, 'blocked');
  await db.doc(`PayrollSlipStates/2026_09_${employeeId}`).delete();
  await db.doc(`PayrollPeriods/${period}`).update({ attendanceStatus: 'closed' });
  await call(review, command(dates[1], 'supersede_approve', 2, 'closed-leave'), 409);
  assert.equal((await repairSatpamApprovedLeavePay(leaveId(dates[1]), 2, true)).status, 'blocked');
  await db.doc(`PayrollPeriods/${period}`).update({ attendanceStatus: 'open' });
  await seedLeave(dates[2], { teamId: null, scheduleRelation: 'unassigned' }, ids[9]);
  const unassigned = await call(review, { ...command(dates[2], 'approve', 1, 'unassigned-leave'), absenceRequestId: leaveId(dates[2], ids[9]) });
  assert.equal(unassigned.amount, 0);
  assert.equal(unassigned.payrollExclusionReason, 'NO_SCHEDULED_DUTY');
  await seedLeave(dates[2], { reportType: 'scan', ...defaultSatpamScanTimes(dates[2], day(dates[2]).shiftName) }, ids[2]);
  assert.equal((await repairSatpamApprovedLeavePay(leaveId(dates[2], ids[2]), 1, true)).status, 'skipped');
  const scan = await call(review, { ...command(dates[2], 'approve', 1, 'scan-is-not-paid-leave'), absenceRequestId: leaveId(dates[2], ids[2]) });
  assert.equal(scan.amount, 0);
  assert.equal((await db.doc(`PayrollLedgerEntries/ABS-${leaveId(dates[2], ids[2])}`).get()).exists, false);
  await userRef.set({ role: 'ketua_shift_satpam', displayName: 'Ketua', linkedEmployeeId: leaderId });
  const configuration = await call(config, undefined, 200, `http://localhost/test?dutyDate=${dates[1]}`);
  assert.ok(configuration.dutyPlan.approvedLeaveEmployeeIds.includes(employeeId));
  const rejected = await call(submitShift, { requestId: 'submit-on-approved-leave', dutyDate: dates[1],
    shiftName: day(dates[1]).shiftName, assignments: day(dates[1]).assignments }, 409);
  assert.match(rejected.error, /izin disetujui/);
  await call(review, command(dates[1], 'supersede_approve', 2, 'unauthorized-leave'), 403);
  console.log('Satpam leave payroll: review order, one payment, rates, reversal, repair, guards and shift selection passed.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
