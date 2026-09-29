/** Regression check for an auditor marking a Satpam post as No Petugas. Writes only to local emulators. */
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

const PROJECT = 'demo-satpam-empty-post';

async function main() {
  if (
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== PROJECT ||
    !/^(localhost|127\.0\.0\.1):8188$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') ||
    !/^(localhost|127\.0\.0\.1):9198$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || '')
  ) {
    throw new Error('This test requires the demo Satpam Firestore and Auth emulators.');
  }

  const { adminDb: db } = await import('../src/lib/firebase-admin');
  const { GET, POST, PUT } = await import('../src/app/api/satpam/shifts/review/route');
  const { SATPAM_POSTS, guardDutyIndexId } = await import('../src/lib/payroll/domain');
  const { periodFridayDates } = await import('../src/lib/payroll/calendar');

  const signup = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'satpam-auditor@example.test',
        password: 'password123',
        returnSecureToken: true,
      }),
    },
  );
  const identity = await signup.json();
  assert.ok(identity.idToken, JSON.stringify(identity));
  await db.doc(`users/${identity.localId}`).set({
    role: 'satker_head',
    displayName: 'Satpam auditor',
    permittedCategories: ['SATPAM'],
  });
  const authorization = `Bearer ${identity.idToken}`;
  const period = '2026-09';
  const dutyDate = '2026-09-24';
  const shiftName = 'Sore';
  const occurrenceId = 'team_2__20260924__sore';
  const planId = '202609__team_2';
  const employeeIds = Array.from({ length: 10 }, (_, index) => `BC_TEST_${index + 1}`);
  const plannedAssignments = SATPAM_POSTS.map((post, index) => ({
    postId: post.id,
    employeeId: employeeIds[index],
  }));
  // Mirrors the reported fault: the Ketua is entered at Pos 2 and Pos 5,
  // while Pos 2 was actually empty.
  const assignments = plannedAssignments.map((assignment) => ({ ...assignment }));
  assignments[4].employeeId = employeeIds[1];
  const planDay = {
    dutyDate,
    shiftName,
    assignments: plannedAssignments,
    offDutyEmployeeId: employeeIds[9],
    sourceSeedDate: dutyDate,
    sourceSeedIndex: 0,
    cycleNumber: 0,
  };
  for (const [index, employeeId] of employeeIds.entries()) {
    await db.doc(`Employees_BlueCollar/${employeeId}`).set({
      name: `Guard ${index + 1}`,
      employment: { status: 'active', jobCategory: 'SATPAM' },
      flags: { isActive: true, isPayrollEligible: true },
    });
  }
  await db.doc('SatpamShiftTeams/team_2').set({
    ketuaShiftId: employeeIds[1],
    memberEmployeeIds: employeeIds.filter((id) => id !== employeeIds[1]),
  });
  await db.doc(`SatpamDutyPlans/${planId}`).set({
    period,
    teamId: 'team_2',
    status: 'published',
    revision: 1,
    ketuaShiftId: employeeIds[1],
    fixedPost9EmployeeId: employeeIds[8],
    rosterEmployeeIds: employeeIds,
    reconciliationEmployeeIds: employeeIds,
    generatedDays: [planDay],
    staleDates: [],
    lateBackfillDates: [],
  });
  await db.doc(`PayrollPeriods/${period}`).set({
    period,
    satpamDutyPlanRequired: true,
    workCalendar: {
      revision: 1,
      annualVersion: 'TEST',
      premiumDates: periodFridayDates(period),
    },
  });
  await db.doc('UraianGaji/2026_09_SATPAM').set({ entries: {} });

  const reportIds = assignments.map((_, index) => `SAT_EMPTY_TEST_${index + 1}`);
  await db.doc(`ShiftOccurrences/${occurrenceId}`).set({
    teamId: 'team_2',
    dutyDate,
    payrollPeriod: period,
    shiftName,
    reportedShiftName: shiftName,
    suggestedShiftName: shiftName,
    status: 'pending_review',
    reviewStatus: 'pending',
    revision: 1,
    ketuaShiftId: employeeIds[1],
    ketuaShiftName: 'Guard 2',
    dutyPlanId: planId,
    dutyPlanRevision: 1,
    plannedAssignmentSnapshot: planDay,
    initialSubmissionSnapshot: {
      dutyDate,
      reportedShiftName: shiftName,
      suggestedShiftName: shiftName,
      assignments: assignments.map((item) => ({ ...item, payType: 'Harian' })),
    },
    actualAssignmentSnapshot: assignments.map((item) => ({
      ...item,
      assignmentKind: 'primary',
      shiftType: 'Harian',
    })),
    anomalyCodes: ['DUPLICATE_GUARD'],
    reportIds,
    pendingReportIds: reportIds,
    assignmentCount: reportIds.length,
    pendingAssignmentCount: reportIds.length,
    approvedAssignmentCount: 0,
    declinedAssignmentCount: 0,
  });
  for (const [index, assignment] of assignments.entries()) {
    await db.doc(`ActivityReports/${reportIds[index]}`).set({
      ...assignment,
      employeeName: `Guard ${employeeIds.indexOf(assignment.employeeId) + 1}`,
      jobCategory: 'SATPAM',
      reportKind: 'satpam_shift_assignment',
      period,
      payrollPeriod: period,
      activityDate: dutyDate,
      dutyDate,
      shiftName,
      reportedShiftName: shiftName,
      status: 'pending',
      assignmentKind: 'primary',
      assignmentKey: `primary_${assignment.postId}`,
      shiftType: index === 4 ? 'Jumat & Libur' : 'Harian',
      fee: index === 4 ? 25_000 : 12_500,
      photoUrl: `https://example.test/photo-${index + 1}.jpg`,
      sourceOccurrenceId: occurrenceId,
      sourceOccurrenceRevision: 1,
    });
  }

  async function call(
    handler: (request: NextRequest) => Promise<Response>,
    method: 'GET' | 'POST' | 'PUT',
    body?: Record<string, unknown>,
    status = 200,
    query = '',
  ) {
    const response = await handler(new NextRequest(`http://localhost/test${query}`, {
      method,
      headers: { authorization, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }));
    const data = await response.json();
    assert.equal(response.status, status, JSON.stringify(data));
    return data;
  }
  const edit = (requestId: string, expectedRevision: number, skippedPosts: string[]) => ({
    requestId,
    occurrenceId,
    expectedRevision,
    dutyDate,
    shiftName,
    reason: `Pos ${skippedPosts.join(' dan ')} ditandai No Petugas oleh auditor.`,
    assignments: assignments
      .filter((assignment) => !skippedPosts.includes(assignment.postId))
      .map((assignment) => ({
        reportId: reportIds[assignments.indexOf(assignment)],
        assignmentKind: 'primary',
        ...assignment,
        shiftType: assignment.postId === 'Pos 5' ? 'Jumat & Libur' : 'Harian',
      })),
  });
  async function currentReportExpectation() {
    const occurrence = (await db.doc(`ShiftOccurrences/${occurrenceId}`).get()).data()!;
    const snapshots = await Promise.all(occurrence.reportIds.map(
      (reportId: string) => db.doc(`ActivityReports/${reportId}`).get(),
    ));
    return snapshots.map((snapshot) => ({
      reportId: snapshot.id,
      status: snapshot.data()?.status,
      employeeId: snapshot.data()?.employeeId,
      shiftType: snapshot.data()?.shiftType,
      coveredEmployeeId: String(snapshot.data()?.coveredEmployeeId || ''),
      fee: Number(snapshot.data()?.fee || 0),
    }));
  }

  const directory = await call(GET, 'GET', undefined, 200, `?occurrenceId=${occurrenceId}&auditorEdit=true`);
  assert.equal(directory.occurrence.assignmentCount, 9);
  const initialReports = await currentReportExpectation();
  await db.doc(`ActivityReports/${reportIds[0]}`).update({ fee: 13_000 });
  await call(PUT, 'PUT', {
    ...edit('stale-report-content', 1, ['Pos 2']),
    expectedReports: initialReports,
  }, 409);
  await db.doc(`ActivityReports/${reportIds[0]}`).update({ fee: 12_500 });
  const foreignReport = edit('foreign-report-id', 1, ['Pos 2']);
  foreignReport.assignments[0].reportId = 'UNRELATED_REPORT';
  await call(PUT, 'PUT', foreignReport, 409);
  await call(PUT, 'PUT', {
    ...edit('pending-empty-post', 1, ['Pos 2']),
    expectedReports: initialReports,
  });
  assert.equal((await db.doc(`ActivityReports/${reportIds[1]}`).get()).exists, false);
  const pendingOccurrence = (await db.doc(`ShiftOccurrences/${occurrenceId}`).get()).data()!;
  assert.equal(pendingOccurrence.pendingAssignmentCount, 8);
  assert.ok(pendingOccurrence.anomalyCodes.includes('MISSING_POSTS'));
  assert.ok(!pendingOccurrence.anomalyCodes.includes('DUPLICATE_GUARD'));
  assert.equal((await db.doc(`PayrollLedgerEntries/${reportIds[1]}`).get()).exists, false);
  assert.equal((await db.doc(`ActivityReports/${reportIds[4]}`).get()).data()?.shiftType, 'Harian');
  const pendingAudit = await db.collection('FinancialAuditLogs')
    .where('requestId', '==', 'pending-empty-post').get();
  assert.equal(pendingAudit.docs[0].data().metadata.removedAssignments[0].photoUrl, 'https://example.test/photo-2.jpg');

  await call(POST, 'POST', {
    requestId: 'approve-eight-posts',
    occurrenceId,
    reason: 'Delapan pos dijaga sesuai bukti.',
    decisions: reportIds.filter((_, index) => index !== 1).map((reportId) => ({ reportId, action: 'approve' })),
  });
  assert.equal((await db.doc(`PayrollLedgerEntries/${reportIds[2]}`).get()).data()?.amount, 12_500);
  const approvedOccurrence = (await db.doc(`ShiftOccurrences/${occurrenceId}`).get()).data()!;
  const approvedReports = await currentReportExpectation();
  await call(PUT, 'PUT', edit('stale-empty-post', approvedOccurrence.revision - 1, ['Pos 2', 'Pos 3']), 409);
  await db.doc(`PayrollPeriods/${period}`).update({ attendanceStatus: 'closed' });
  await call(PUT, 'PUT', {
    ...edit('closed-empty-post', approvedOccurrence.revision, ['Pos 2', 'Pos 3']),
    expectedReports: approvedReports,
  }, 409);
  await db.doc(`PayrollPeriods/${period}`).update({ attendanceStatus: 'open' });
  const slipRef = db.doc(`PayrollSlipStates/2026_09_${employeeIds[2]}`);
  await slipRef.set({ status: 'paid' });
  await call(PUT, 'PUT', {
    ...edit('paid-empty-post', approvedOccurrence.revision, ['Pos 2', 'Pos 3']),
    expectedReports: approvedReports,
  }, 409);
  await slipRef.delete();
  assert.equal((await db.doc(`ActivityReports/${reportIds[2]}`).get()).exists, true);
  await call(PUT, 'PUT', {
    ...edit('approved-empty-post', approvedOccurrence.revision, ['Pos 2', 'Pos 3']),
    expectedReports: approvedReports,
  });
  assert.equal((await db.doc(`ActivityReports/${reportIds[2]}`).get()).exists, false);
  assert.equal((await db.doc(`PayrollLedgerEntries/${reportIds[2]}`).get()).exists, false);
  assert.equal((await db.doc(`GuardDutyIndexes/${guardDutyIndexId(dutyDate, shiftName, employeeIds[2])}`).get()).exists, false);
  const finalOccurrence = (await db.doc(`ShiftOccurrences/${occurrenceId}`).get()).data()!;
  assert.equal(finalOccurrence.approvedAssignmentCount, 7);
  assert.equal(finalOccurrence.assignmentCount, 7);
  assert.ok(finalOccurrence.anomalyCodes.includes('MISSING_POSTS'));
  const uraian = (await db.doc('UraianGaji/2026_09_SATPAM').get()).data()!;
  assert.equal(uraian.entries[employeeIds[2]].counts.harian, 0);
  assert.equal(uraian.entries[employeeIds[3]].counts.harian, 1);
  const audit = await db.collection('FinancialAuditLogs')
    .where('requestId', '==', 'approved-empty-post').get();
  assert.equal(audit.size, 1);
  assert.equal(audit.docs[0].data().metadata.removedAssignments[0].photoUrl, 'https://example.test/photo-3.jpg');
  const restore = edit('restore-empty-post', finalOccurrence.revision, ['Pos 2', 'Pos 3']);
  await call(PUT, 'PUT', {
    ...restore,
    expectedReports: await currentReportExpectation(),
    assignments: [
      ...restore.assignments,
      {
        assignmentKind: 'primary',
        postId: 'Pos 3',
        employeeId: employeeIds[2],
        shiftType: 'Harian',
      },
    ],
  });
  const restoredOccurrence = (await db.doc(`ShiftOccurrences/${occurrenceId}`).get()).data()!;
  assert.equal(restoredOccurrence.approvedAssignmentCount, 8);
  const restoredPos3 = await Promise.all(restoredOccurrence.reportIds.map(
    (reportId: string) => db.doc(`ActivityReports/${reportId}`).get(),
  ));
  const restoredReport = restoredPos3.find((snapshot) => snapshot.data()?.postId === 'Pos 3');
  assert.ok(restoredReport);
  assert.equal((await db.doc(`PayrollLedgerEntries/${restoredReport.id}`).get()).data()?.amount, 12_500);
  assert.equal((await db.doc('UraianGaji/2026_09_SATPAM').get()).data()?.entries[employeeIds[2]].counts.harian, 1);
  console.log('Satpam No Petugas pending, approved, and restore checks passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
