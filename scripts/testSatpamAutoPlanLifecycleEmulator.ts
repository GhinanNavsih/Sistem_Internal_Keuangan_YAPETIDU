/**
 * A whole month on an automatically published Satpam duty plan, through the
 * real API routes: leave, shift approval, attendance bonus and period closing.
 * Writes only to local emulators: `npm run test:satpam-auto-plan-lifecycle:integration`.
 */
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

const PROJECT = 'demo-satpam-auto-plan-lifecycle';

function shiftPeriod(period: string, months: number): string {
  const [year, month] = period.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + months, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function main() {
  if (
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== PROJECT ||
    !/^(localhost|127\.0\.0\.1):8188$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') ||
    !/^(localhost|127\.0\.0\.1):9198$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || '')
  ) {
    throw new Error('This test requires the demo Satpam Firestore and Auth emulators.');
  }
  const { adminDb: db } = await import('../src/lib/firebase-admin');
  const {
    buildSatpamDutyReconciliation,
    ensureCurrentSatpamDutyPlans,
  } = await import('../src/lib/server/satpamDutyPlan');
  const {
    SATPAM_DUTY_PLAN_ROTATION_VERSION,
    SATPAM_MONTHLY_ATTENDANCE_BONUS,
    SATPAM_ROTATION_SLOTS,
    validateAndGenerateSatpamDutyPlan,
  } = await import('../src/lib/payroll/satpamDutyPlan');
  const { pekaryaPayrollPeriodForDate, pekaryaPayrollWindow } = await import('../src/lib/payroll/pekaryaSpj');
  const { jakartaToday } = await import('../src/lib/server/payrollPeriod');
  const { periodFridayDates } = await import('../src/lib/payroll/calendar');
  const { bonusTriwulanWindow } = await import('../src/lib/payroll/bonusTriwulan');
  const { hashKoperasiInstallmentPlan } = await import('../src/lib/server/koperasiPayrollBridge');
  const { getSatpamShiftForTeam } = await import('../src/utils/satpamRotation');
  const { POST: submitLeave } = await import('../src/app/api/satpam/absences/route');
  const { POST: reviewLeave } = await import('../src/app/api/satpam/absences/review/route');
  const { POST: submitShift } = await import('../src/app/api/satpam/shifts/route');
  const { POST: reviewShift } = await import('../src/app/api/satpam/shifts/review/route');
  const { POST: changePeriod } = await import('../src/app/api/payroll/periods/route');

  // Dated from today so the month under test is always fully in the past, which
  // is what closing it requires.
  const currentPeriod = pekaryaPayrollPeriodForDate(jakartaToday());
  const period = shiftPeriod(currentPeriod, -1);
  const sourcePeriod = shiftPeriod(currentPeriod, -2);
  const periodToken = period.replace('-', '_');
  const teams = [1, 2, 3];
  const rosterOf = (team: number) =>
    Array.from({ length: 10 }, (_, index) => `T${team}_G${index + 1}`);
  const allEmployeeIds = teams.flatMap(rosterOf);

  async function signIn(key: string, profile: Record<string, unknown>) {
    const response = await fetch(
      `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: `${key}@example.test`, password: 'password123', returnSecureToken: true }),
      },
    );
    const identity = await response.json();
    assert.ok(identity.idToken, JSON.stringify(identity));
    await db.doc(`users/${identity.localId}`).set({ email: `${key}@example.test`, displayName: key, ...profile });
    return String(identity.idToken);
  }

  async function call(
    handler: (request: NextRequest) => Promise<Response>,
    token: string,
    body: Record<string, unknown>,
    expected: number | number[] = 200,
  ) {
    const response = await handler(
      new NextRequest('http://localhost/test', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    const data = await response.json();
    const allowed = Array.isArray(expected) ? expected : [expected];
    assert.ok(allowed.includes(response.status), `${response.status}: ${JSON.stringify(data)}`);
    return data;
  }

  // ── Seed: three regu, last month's plans, and every non-Satpam close condition.
  for (const [index, id] of allEmployeeIds.entries()) {
    await db.doc(`Employees_BlueCollar/${id}`).set({
      name: `Satpam ${id}`,
      nipy: `140110${String(index + 1000)}`,
      employment: { status: 'active', jobCategory: 'SATPAM' },
      flags: { isActive: true, isPayrollEligible: true },
    });
    const plan = {
      schemaVersion: 1 as const,
      payrollPeriod: period,
      matchType: 'none' as const,
      resolvedUserId: null,
      expectedDeduction: 0,
      loans: [],
    };
    await db.doc(`PayrollSlipStates/${periodToken}_${id}`).set({
      period: periodToken,
      employeeId: id,
      status: 'draft',
      deductions: [],
      koperasiInstallmentPlan: { ...plan, planHash: hashKoperasiInstallmentPlan(plan) },
    });
  }
  const sourceWindow = pekaryaPayrollWindow(sourcePeriod);
  for (const team of teams) {
    const ids = rosterOf(team);
    const [ketuaShiftId, fixedPost9EmployeeId, ...rotating] = ids;
    await db.doc(`SatpamShiftTeams/team_${team}`).set({
      ketuaShiftId,
      ketuaShiftName: `Satpam ${ketuaShiftId}`,
      memberEmployeeIds: ids.slice(1),
    });
    const generation = validateAndGenerateSatpamDutyPlan({
      periodStart: sourceWindow.startsOn,
      periodEnd: sourceWindow.endsOn,
      rosterEmployeeIds: ids,
      ketuaShiftId,
      fixedPost9EmployeeId,
      firstDayAssignments: SATPAM_ROTATION_SLOTS.map((slot, index) => ({
        slot,
        employeeId: rotating[index],
      })),
      shiftNameForDate: (date) => getSatpamShiftForTeam(team, date),
    });
    await db.doc(`SatpamDutyPlans/${sourcePeriod.replace('-', '')}__team_${team}`).set({
      period: sourcePeriod,
      teamId: `team_${team}`,
      schemaVersion: 2,
      rotationVersion: SATPAM_DUTY_PLAN_ROTATION_VERSION,
      status: 'published',
      revision: 1,
      ketuaShiftId,
      fixedPost9EmployeeId,
      rosterEmployeeIds: ids,
      seedDays: generation.seedDays,
      generatedDays: generation.generatedDays,
      lateBackfillDates: [],
      staleDates: [],
    });
  }
  await db.doc(`PayrollPeriods/${period}`).set({
    period,
    satpamDutyPlanRequired: true,
    satpamDutyPlanSchemaVersion: 1,
    calendarReconciliationStatus: 'complete',
    workCalendar: { revision: 1, annualVersion: 'TEST', premiumDates: periodFridayDates(period) },
  });
  await db.doc(`UraianGaji/${periodToken}_SATPAM`).set({ entries: {} });
  await db.doc(`AttendanceImports/${period}`).set({ activeRevisionId: 'revision-1', activeRevision: 1 });
  // Source readers require a real revision even when this lifecycle fixture
  // deliberately has no fingerprint rows (approved reports supply its pay).
  await db.doc('AttendanceImportRevisions/revision-1').set({ period, revision: 1, status: 'active' });
  // Loyalis conditions for closing, met by a month with no Loyalis on the roster.
  for (const month of bonusTriwulanWindow(period)) {
    await db.doc(`LoyalisPresence/${month.replace('-', '_')}`).set({
      entries: { Loyalis_not_on_roster: {} },
      sourceImportRevision: 1,
      sourceCalendarRevision: 1,
    });
    await db.doc(`SenamPagi/${month}`).set({ source: 'saku', noSessions: true, sessions: [], revision: 1 });
    await db.doc(`BonusTriwulan/${month}`).set({ recipients: {}, missing: [] });
  }

  const admin = await signIn('admin', { role: 'super_admin', permittedCategories: ['SATPAM'] });
  const ketua = new Map<number, string>();
  for (const team of teams) {
    ketua.set(team, await signIn(`ketua-${team}`, {
      role: 'ketua_shift_satpam',
      linkedEmployeeId: `T${team}_G1`,
      permittedCategories: ['SATPAM'],
    }));
  }

  // ── The system publishes the month under test; no Ketua is involved.
  await ensureCurrentSatpamDutyPlans(new Date(`${period}-01T00:30:00+07:00`));
  const planFor = async (planPeriod: string, team: number) =>
    (await db.doc(`SatpamDutyPlans/${planPeriod.replace('-', '')}__team_${team}`).get()).data();
  for (const team of teams) {
    const plan = await planFor(period, team);
    assert.equal(plan?.autoPublished, true);
    assert.equal(plan?.publishedBy, 'system');
    assert.deepEqual(plan?.lateBackfillDates, []);
  }

  // ── 2. Satpam can request leave, even as the very first request of a month.
  const pos9Guard = await signIn('guard-pos9', {
    role: 'honorer',
    linkedEmployeeId: 'T1_G2',
    permittedCategories: ['SATPAM'],
  });
  assert.equal(await planFor(currentPeriod, 1), undefined);
  const firstRequest = await call(submitLeave, pos9Guard, {
    action: 'submit',
    requestId: 'first-request-of-the-month',
    dutyDate: `${currentPeriod}-01`,
    expectedRevision: 0,
    reportType: 'izin_resmi',
    absenceType: 'sakit',
    reason: 'Sakit',
  });
  assert.equal(firstRequest.status, 'pending');
  assert.equal((await planFor(currentPeriod, 1))?.autoPublished, true);
  console.log('PASS leave: the first request of a month publishes the plan and is accepted');

  const firstPlan = await planFor(period, 1);
  const leaveDay = firstPlan?.generatedDays.find(
    (day: { assignments: Array<{ employeeId: string }> }) =>
      day.assignments.some((assignment) => assignment.employeeId === 'T1_G6'),
  );
  const leaveGuard = await signIn('guard-leave', {
    role: 'honorer',
    linkedEmployeeId: 'T1_G6',
    permittedCategories: ['SATPAM'],
  });
  const leave = await call(submitLeave, leaveGuard, {
    action: 'submit',
    requestId: 'leave-on-a-planned-duty',
    dutyDate: leaveDay.dutyDate,
    expectedRevision: 0,
    reportType: 'izin_resmi',
    absenceType: 'sakit',
    reason: 'Sakit',
  });
  const approvedLeave = await call(reviewLeave, admin, {
    absenceRequestId: leave.id,
    expectedRevision: leave.revision,
    action: 'approve',
    requestId: 'approve-leave-on-a-planned-duty',
  });
  assert.ok(approvedLeave.amount > 0, JSON.stringify(approvedLeave));
  console.log('PASS leave: a request on a planned duty is approved and paid');

  // The planned Libur day is still refused, which proves the plan is being read.
  const liburDay = firstPlan?.generatedDays.find(
    (day: { offDutyEmployeeId: string }) => day.offDutyEmployeeId === 'T1_G6',
  );
  await call(submitLeave, leaveGuard, {
    action: 'submit',
    requestId: 'leave-on-a-libur-day',
    dutyDate: liburDay.dutyDate,
    expectedRevision: 0,
    reportType: 'izin_resmi',
    absenceType: 'sakit',
    reason: 'Sakit',
  }, 409);
  console.log('PASS leave: a planned Libur day is still refused');

  // ── 3 (control). Closing is refused while the month's reports are missing.
  const closeBody = { period, attendanceStatus: 'closed', holidays: [], reason: 'Tutup periode uji' };
  const refused = await call(changePeriod, admin, closeBody, 409);
  assert.match(refused.error, /Rekonsiliasi Satpam belum selesai/);
  console.log('PASS close: refused while reports are missing');

  // The same refusal applies to a month nobody has saved anything for yet.
  const periodRef = db.doc(`PayrollPeriods/${period}`);
  const storedPeriod = (await periodRef.get()).data()!;
  await periodRef.delete();
  const refusedWithoutRecord = await call(changePeriod, admin, closeBody, 409);
  assert.match(refusedWithoutRecord.error, /Rekonsiliasi Satpam belum selesai/);
  assert.equal((await periodRef.get()).exists, false);
  await periodRef.set(storedPeriod);
  console.log('PASS close: refused while reports are missing, with no period record either');

  // ── 1. Every Ketua reports every date, and each report is approved.
  // T1_G5 misses three planned duties, so the bonus has someone to refuse.
  const absentDates = new Set(
    firstPlan?.generatedDays
      .filter((day: { assignments: Array<{ employeeId: string }> }) =>
        day.assignments.some((assignment) => assignment.employeeId === 'T1_G5'),
      )
      .slice(0, 3)
      .map((day: { dutyDate: string }) => day.dutyDate),
  );
  let approvedShifts = 0;
  for (const team of teams) {
    const plan = await planFor(period, team);
    for (const day of plan?.generatedDays || []) {
      const assignments = day.assignments.filter(
        (assignment: { employeeId: string }) =>
          !(team === 1 && assignment.employeeId === 'T1_G6' && day.dutyDate === leaveDay.dutyDate) &&
          !(team === 1 && assignment.employeeId === 'T1_G5' && absentDates.has(day.dutyDate)),
      );
      const submitted = await call(submitShift, ketua.get(team)!, {
        requestId: `report-${team}-${day.dutyDate}`,
        dutyDate: day.dutyDate,
        shiftName: day.shiftName,
        assignments,
      }, 201);
      const occurrence = (await db.doc(`ShiftOccurrences/${submitted.occurrenceId}`).get()).data()!;
      assert.equal(occurrence.dutyPlanId, `${period.replace('-', '')}__team_${team}`);
      assert.ok(!occurrence.anomalyCodes?.includes('DUTY_PLAN_MISSING'));
      await call(reviewShift, admin, {
        requestId: `approve-${team}-${day.dutyDate}`,
        occurrenceId: submitted.occurrenceId,
        decisions: occurrence.reportIds.map((reportId: string) => ({ reportId, action: 'approve' })),
        confirmPayClassificationWarnings: true,
      });
      approvedShifts += 1;
    }
  }
  const pendingOccurrences = await db
    .collection('ShiftOccurrences')
    .where('payrollPeriod', '==', period)
    .where('reviewStatus', '==', 'pending')
    .get();
  assert.equal(pendingOccurrences.size, 0);
  const ledger = await db.collection('PayrollLedgerEntries').where('payrollPeriod', '==', period).get();
  assert.ok(ledger.docs.some((entry) => entry.data().status === 'posted'));
  console.log(`PASS shifts: ${approvedShifts} reports on automatic plans approved and posted to payroll`);

  // ── 4. The attendance bonus counts against the automatic plan.
  const reconciliation = await buildSatpamDutyReconciliation(period);
  assert.equal(reconciliation.plans.length, 3);
  assert.equal(reconciliation.periodComplete, true);
  assert.deepEqual(reconciliation.blockers, []);
  const uraian = (await db.doc(`UraianGaji/${periodToken}_SATPAM`).get()).data()!;
  assert.equal(uraian.satpamDutyReconciliation.blockerCount, 0);
  const expectBonus = (employeeId: string, amount: number) => {
    const entry = uraian.entries[employeeId];
    assert.ok(entry, `${employeeId} has no Uraian entry`);
    assert.equal(entry.values.bonusPresensiBulanan, amount, employeeId);
    assert.equal(entry.satpamDutySource.planId.endsWith(employeeId.slice(0, 2).replace('T', '__team_')), true);
    assert.ok(entry.satpamDutySource.requiredDuties > 0, employeeId);
    return entry.satpamDutySource;
  };
  expectBonus('T1_G1', SATPAM_MONTHLY_ATTENDANCE_BONUS);
  expectBonus('T1_G2', SATPAM_MONTHLY_ATTENDANCE_BONUS);
  expectBonus('T1_G3', SATPAM_MONTHLY_ATTENDANCE_BONUS);
  expectBonus('T2_G3', SATPAM_MONTHLY_ATTENDANCE_BONUS);
  expectBonus('T3_G3', SATPAM_MONTHLY_ATTENDANCE_BONUS);
  assert.equal(expectBonus('T1_G6', SATPAM_MONTHLY_ATTENDANCE_BONUS).approvedAbsenceCount, 1);
  assert.equal(expectBonus('T1_G5', 0).missedDuties, 3);
  console.log('PASS bonus: full attendance and approved leave earn it; three missed duties do not');

  // ── 3. With everything reported and reviewed, the period closes.
  await call(changePeriod, admin, closeBody, 201);
  assert.equal((await db.doc(`PayrollPeriods/${period}`).get()).data()?.attendanceStatus, 'closed');
  console.log('PASS close: the month closes on automatic plans');

  // A month with no period record still closes once everything is reviewed.
  await periodRef.delete();
  await call(changePeriod, admin, closeBody, 201);
  assert.equal((await periodRef.get()).data()?.attendanceStatus, 'closed');
  console.log('PASS close: a fully reviewed month with no period record closes');

  // ── 1 (edge). A page left open across midnight sends the month's first request.
  async function forgetCurrentPlans() {
    for (const team of teams) {
      const planId = `${currentPeriod.replace('-', '')}__team_${team}`;
      await db.doc(`SatpamDutyPlans/${planId}`).delete();
      await db.doc(`SatpamDutyPlanRevisions/${planId}__r1`).delete();
      await db.doc(`FinancialIdempotencyKeys/system__satpam-auto-plan-${planId}`).delete();
    }
  }
  const dayTwo = (await planFor(currentPeriod, 2))?.generatedDays[0];
  await forgetCurrentPlans();
  const firstReport = await call(submitShift, ketua.get(2)!, {
    requestId: 'first-report-of-the-month',
    dutyDate: dayTwo.dutyDate,
    shiftName: dayTwo.shiftName,
    assignments: dayTwo.assignments,
  }, 201);
  assert.equal((await planFor(currentPeriod, 2))?.autoPublished, true);
  const firstOccurrence = (await db.doc(`ShiftOccurrences/${firstReport.occurrenceId}`).get()).data()!;
  assert.ok(!firstOccurrence.anomalyCodes?.includes('DUTY_PLAN_MISSING'));
  await call(reviewShift, admin, {
    requestId: 'approve-first-report-of-the-month',
    occurrenceId: firstReport.occurrenceId,
    decisions: firstOccurrence.reportIds.map((reportId: string) => ({ reportId, action: 'approve' })),
    confirmPayClassificationWarnings: true,
  });
  console.log('PASS shifts: the first report of a month publishes the plan and is approved');

  // A report filed before any plan existed can still be approved afterwards.
  const dayThree = (await planFor(currentPeriod, 3))?.generatedDays[0];
  const earlyReport = await call(submitShift, ketua.get(3)!, {
    requestId: 'report-before-the-plan',
    dutyDate: dayThree.dutyDate,
    shiftName: dayThree.shiftName,
    assignments: dayThree.assignments,
  }, 201);
  await forgetCurrentPlans();
  const earlyRef = db.doc(`ShiftOccurrences/${earlyReport.occurrenceId}`);
  await earlyRef.update({ anomalyCodes: ['DUTY_PLAN_MISSING'] });
  const earlyReportIds: string[] = (await earlyRef.get()).data()!.reportIds;
  await call(reviewShift, admin, {
    requestId: 'approve-report-before-the-plan',
    occurrenceId: earlyReport.occurrenceId,
    decisions: earlyReportIds.map((reportId) => ({ reportId, action: 'approve' })),
    confirmPayClassificationWarnings: true,
  });
  assert.equal((await planFor(currentPeriod, 3))?.autoPublished, true);
  assert.equal((await db.doc(`ActivityReports/${earlyReportIds[0]}`).get()).data()?.status, 'approved');
  console.log('PASS shifts: a report filed before the plan existed is approved');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
