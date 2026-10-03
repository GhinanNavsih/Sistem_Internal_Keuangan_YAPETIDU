/** Real authenticated route/transaction tests. Writes only to local emulators. */
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { PEKARYA_JOB_CATEGORIES } from '../src/lib/payroll/pekaryaSpj';
import { GANTI_LIBUR_ATTENDANCE_CONFIRMATION_REQUIRED } from '../src/lib/payroll/gantiLibur';

const PROJECT = 'demo-pekarya-leave';
type Handler = (request: NextRequest) => Promise<Response>;
let sequence = 0;

async function main() {
  if (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== PROJECT ||
    !/^(localhost|127\.0\.0\.1):8188$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') ||
    !/^(localhost|127\.0\.0\.1):9198$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || '')) {
    throw new Error('This test requires the demo-pekarya-leave Firestore and Auth emulators.');
  }
  const { adminDb: db, default: admin } = await import('../src/lib/firebase-admin');
  const swap = await import('../src/app/api/employee/ganti-libur/route');
  const swapReview = await import('../src/app/api/payroll/ganti-libur/review/route');
  const propagation = await import('../src/app/api/payroll/uraian-propagation/route');
  const leave = await import('../src/app/api/employee/paid-leave/route');
  const leaveReview = await import('../src/app/api/payroll/paid-leave/review/route');
  const balances = await import('../src/app/api/payroll/paid-leave/balances/route');
  const corrections = await import('../src/app/api/attendance/pekarya/corrections/route');
  const officialReview = await import('../src/app/api/attendance/pekarya/official-leave/review/route');
  const satpamAbsenceReview = await import('../src/app/api/satpam/absences/review/route');
  const { attendanceCorrectionHeadId } = await import('../src/lib/server/attendanceStore');
  const { annualPaidLeaveBalanceDocumentId } = await import('../src/lib/server/annualPaidLeave');
  const { buildSatpamDutyReconciliation } = await import('../src/lib/server/satpamDutyPlan');
  const { loadApprovedGantiLiburDayOffs } = await import('../src/lib/server/gantiLibur');
  const { prepareBlueCollarGantiLiburReview, readBlueCollarGantiLiburReview } = await import('../src/lib/server/gantiLiburBlueCollar');

  async function account(role: string, employeeId?: string, category?: string) {
    const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `user-${++sequence}@example.test`, password: 'password123', returnSecureToken: true }),
    });
    const identity = await response.json();
    assert.ok(identity.idToken, JSON.stringify(identity));
    await db.doc(`users/${identity.localId}`).set({
      role, displayName: `${role} ${category || ''}`, permittedCategories: category ? [category] : [],
      ...(employeeId ? { linkedEmployeeId: employeeId } : {}),
    });
    return `Bearer ${identity.idToken}`;
  }
  async function call(handler: Handler, authorization: string, body?: Record<string, unknown>, status = 200, query = '') {
    const response = await handler(new NextRequest(`http://localhost/test${query}`, {
      method: body ? 'POST' : 'GET', headers: { authorization, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }));
    const data = await response.json();
    assert.equal(response.status, status, JSON.stringify(data));
    return data;
  }
  const command = (body: Record<string, unknown>) => ({ requestId: `test-command-${++sequence}`, ...body });
  const submit = (workedDate = '2026-09-25', dayOffDate = '2026-10-01', expectedRevision = 0) =>
    command({ action: 'submit', workedDate, dayOffDate, expectedRevision, reason: 'Penggantian hari libur' });
  const annual = (action: string, expectedRevision: number, leaveDate = '2026-10-03') =>
    command({ action, leaveDate, expectedRevision, reason: 'Keperluan keluarga' });

  const superAdmin = await account('super_admin');
  const loyalisAdmin = await account('loyalis_admin');
  const finance = await account('finance_verifier');
  const fixtures: Array<{ category: string; employeeId: string; worker: string; reviewer: string; nipy: string }> = [];
  for (const [index, category] of PEKARYA_JOB_CATEGORIES.entries()) {
    const employeeId = `BC_${index}`;
    const nipy = `15010320${String(index + 1).padStart(3, '0')}`;
    await db.doc(`Employees_BlueCollar/${employeeId}`).set({
      employeeId, name: `Worker ${category}`, nipy,
      employment: { status: 'active', jobCategory: category, startDate: '2010-01-01' },
      flags: { isActive: true, isPayrollEligible: true },
    });
    fixtures.push({ category, employeeId, nipy,
      worker: await account(category === 'SATPAM' ? 'ketua_shift_satpam' : 'honorer', employeeId, category),
      reviewer: await account('satker_head', undefined, category),
    });
    await db.doc(`PekaryaAttendancePublications/2026_10__${category}`).set({ state: 'published', stale: false, publicationRevision: 1, totals: { harian: 0, jumatLibur: 0, amount: 0 } });
    await db.doc(`UraianGaji/2026_10_${category}`).set({ entries: {} });
  }
  for (const period of ['2026-09', '2026-10']) {
    const revisionId = `${period.replace('-', '_')}__r0001`;
    await db.doc(`AttendanceImports/${period}`).set({ activeRevisionId: revisionId, activeRevision: 1 });
    await db.doc(`AttendanceImportRevisions/${revisionId}`).set({ fileHash: period });
    for (const fixture of fixtures) {
      const dates = period === '2026-09' ? ['2026-09-18', '2026-09-25'] : ['2026-10-01', '2026-10-03'];
      for (const date of dates) {
        const worked = date === '2026-09-25';
        await db.doc(`AttendanceImportRows/${fixture.employeeId}_${date}`).set({
          revisionId, rowNumber: ++sequence, nipy: fixture.nipy, name: `Worker ${fixture.category}`,
          department: 'PEKARYA', date, workStatus: worked ? 'MASUK' : 'TIDAK HADIR',
          scanIn: worked ? '07:25:00' : null, scanOut: worked ? '14:05:00' : null, issues: [],
        });
      }
    }
  }

  for (const fixture of fixtures) {
    const { worker, reviewer, employeeId, category } = fixture;
    const initial = await call(leave.GET, worker, undefined, 200, '?year=2026');
    assert.equal(initial.balance.availableDays, 9, category);
    const pending = await call(leave.POST, worker, annual('submit', 0));
    assert.equal((await call(leave.GET, worker, undefined, 200, '?year=2026')).balance.reservedDays, 1);
    await call(leave.POST, worker, annual('withdraw', 1));
    assert.equal((await call(leave.GET, worker, undefined, 200, '?year=2026')).balance.availableDays, 9);
    await call(leave.POST, worker, annual('submit', 2));
    await call(leaveReview.POST, reviewer, command({ action: 'decline', annualPaidLeaveRequestId: pending.id, expectedRevision: 3, reason: 'Tanggal perlu diubah' }));
    assert.equal((await call(leave.GET, worker, undefined, 200, '?year=2026')).balance.availableDays, 9);
    await call(leave.POST, worker, annual('submit', 4));
    await call(leaveReview.POST, reviewer, command({ action: 'approve', annualPaidLeaveRequestId: pending.id, expectedRevision: 5, reason: 'Disetujui' }));
    const balance = await call(leave.GET, worker, undefined, 200, '?year=2026');
    assert.equal(balance.balance.usedDays, 1);
    assert.equal(balance.balance.reservedDays, 0);
    assert.equal(balance.balance.availableDays, 8);
    const storedBalance = (await db.doc(`AnnualPaidLeaveBalances/${annualPaidLeaveBalanceDocumentId(employeeId, 2026)}`).get()).data()!;
    await call(balances.POST, reviewer, command({ employeeId, employeeKind: 'blue_collar', year: 2026,
      remainingDays: 5, expectedRevision: storedBalance.balanceRevision, reason: 'Saldo awal dari pencatatan manual' }));
    assert.equal((await call(leave.GET, worker, undefined, 200, '?year=2026')).balance.availableDays, 5);
    await call(swap.POST, worker, submit('2026-09-18', '2026-10-03'), 409);

    const swapCommand = submit();
    const request = await call(swap.POST, worker, swapCommand);
    assert.equal((await call(swap.POST, worker, swapCommand)).idempotent, true);
    const stored = (await db.doc(`GantiLiburRequests/${request.id}`).get()).data()!;
    assert.equal(stored.employeeKind, 'blue_collar');
    assert.equal(stored.category, category);
    assert.equal(stored.workedPeriod, '2026-09');
    assert.equal(stored.dayOffPeriod, '2026-10');
    await call(leave.POST, worker, annual('submit', 0, '2026-10-01'), 409);
    await call(swap.POST, worker, submit('2026-09-25', '2026-09-29', 1), 409);
    const decision = command({ action: 'approve', gantiLiburRequestId: request.id, expectedRevision: 1, reason: '' });
    await call(swapReview.POST, loyalisAdmin, decision, 403);
    await call(swapReview.POST, finance, decision, 403);
    await call(swapReview.POST, fixtures.find((other) => other.category !== category)!.reviewer, decision, 403);
    const reviewList = await call(swapReview.GET, reviewer);
    assert.ok(reviewList.requests.every((item: { category: string }) => item.category === category));
    assert.equal(reviewList.requests.find((item: { id: string }) => item.id === request.id).attendanceCheck.verdict, 'eligible');
    await call(swapReview.POST, reviewer, { ...decision, expectedRevision: 99 }, 409);
    await call(swapReview.POST, reviewer, decision);
    assert.equal((await call(swapReview.POST, reviewer, decision)).idempotent, true);
    const final = (await db.doc(`GantiLiburRequests/${request.id}`).get()).data()!;
    assert.equal(final.status, 'approved');
    assert.equal(final.revision, 2);
    assert.ok(final.approvedAmount > 0);
    assert.equal((await call(leave.GET, worker, undefined, 200, '?year=2026')).balance.availableDays, 5, 'ganti libur does not spend annual leave');
    assert.equal((await call(swap.GET, worker)).requests.length, 1);
    if (category !== 'SATPAM') {
      const head = (await db.doc(`PekaryaAttendanceCorrectionHeads/${attendanceCorrectionHeadId('2026-10', employeeId, '2026-10-01')}`).get()).data()!;
      assert.equal(head.sourceType, 'ganti_libur');
      assert.equal(head.workStatus, 'GANTI LIBUR');
      const uraian = (await db.doc(`UraianGaji/2026_10_${category}`).get()).data()!;
      assert.equal(uraian.entries[employeeId].counts.harian, 2);
      assert.equal(uraian.entries[employeeId].values.harian, 25_000);
      for (const present of [true, false]) {
        const rejected = await call(corrections.POST, reviewer, command({ period: '2026-10', category, employeeId,
          date: '2026-10-01', present, expectedRevision: head.revision, reason: 'Mengubah presensi setelah persetujuan' }), 409);
        assert.match(rejected.error, /Ganti libur/);
      }
      await db.doc(`PekaryaOfficialLeaveRequests/conflict-${employeeId}`).set({
        employeeId, category, period: '2026-10', date: '2026-10-01', status: 'pending', revision: 1,
        reportType: 'izin_resmi', leaveType: 'izin_resmi', reason: 'Sakit',
      });
      await call(officialReview.POST, reviewer, command({ officialLeaveRequestId: `conflict-${employeeId}`,
        action: 'approve', expectedRevision: 1, reason: 'Memeriksa benturan izin' }), 409);
    } else {
      await db.doc(`SatpamAbsenceRequests/conflict-${employeeId}`).set({
        employeeId, period: '2026-10', dutyDate: '2026-10-01', status: 'pending', revision: 1,
        reportType: 'izin_resmi', absenceType: 'sakit', reason: 'Sakit', scheduleRelation: 'unassigned',
      });
      const rejected = await call(satpamAbsenceReview.POST, reviewer, command({ absenceRequestId: `conflict-${employeeId}`,
        action: 'approve', expectedRevision: 1, reason: 'Memeriksa benturan izin' }), 409);
      assert.match(rejected.error, /Ganti libur/);
    }
    console.log(`PASS ${category}: cuti reservation/withdrawal/decline/approval/balance adjustment and ganti libur payroll`);
  }
  const reconciliation = await buildSatpamDutyReconciliation('2026-10');
  const satpam = reconciliation.unassignedExternalEmployees.find((item) => item.employeeId === fixtures[0].employeeId)!;
  assert.equal(satpam.gantiLiburCount, 1);
  assert.equal(satpam.annualPaidLeaveCount, 1);
  const satpamUraian = (await db.doc('UraianGaji/2026_10_SATPAM').get()).data()!;
  assert.equal(satpamUraian.entries[fixtures[0].employeeId].counts.harian, 2);
  assert.equal((await loadApprovedGantiLiburDayOffs('2026-10')).length, 0, 'Pekarya credits cannot enter Loyalis presence');
  assert.equal((await call(swapReview.GET, loyalisAdmin, undefined, 200, '?status=all')).requests.length, 0);
  assert.equal((await call(swapReview.GET, superAdmin, undefined, 200, '?status=all')).requests.length, fixtures.length);

  // The shared API also requires an explicit exception for every Pekarya category.
  for (const fixture of fixtures) {
    const request = await call(swap.POST, fixture.worker, submit('2026-09-11', '2026-10-06'));
    const approve = command({ action: 'approve', gantiLiburRequestId: request.id, expectedRevision: 1 });
    const warning = await call(swapReview.POST, fixture.reviewer, approve, 409);
    assert.equal(warning.code, GANTI_LIBUR_ATTENDANCE_CONFIRMATION_REQUIRED, fixture.category);
    await call(swapReview.POST, fixture.reviewer, { ...approve, attendanceConfirmation: warning.details.attendanceCheck });
    const stored = (await db.doc(`GantiLiburRequests/${request.id}`).get()).data()!;
    assert.equal(stored.status, 'approved', fixture.category);
    assert.ok(stored.approvedAmount > 0, fixture.category);
    assert.equal(stored.attendanceOverride.attendanceCheck.verdict, 'absent', fixture.category);
    const uraian = (await db.doc(`UraianGaji/2026_10_${fixture.category}`).get()).data()!;
    assert.equal(uraian.entries[fixture.employeeId].counts.harian, 3, fixture.category);
  }
  console.log('PASS confirmed attendance exceptions apply paid Ganti Libur to all seven Pekarya categories');

  // Missing/short attendance, withdrawal, weekly limits, locked periods and slips.
  const fixture = fixtures[1];
  const request = await call(swap.POST, fixture.worker, submit('2026-09-18', '2026-09-29'));
  await call(swapReview.POST, fixture.reviewer, command({ action: 'approve', gantiLiburRequestId: request.id, expectedRevision: 1 }), 409);
  await call(swap.POST, fixture.worker, command({ action: 'withdraw', workedDate: '2026-09-18', expectedRevision: 1 }));
  await call(swap.POST, fixture.worker, submit('2026-09-18', '2026-09-29', 2));
  await call(swap.POST, fixture.worker, submit('2026-09-11', '2026-09-30'), 409);
  for (const [scanIn, scanOut, workStatus, verdict] of [
    ['07:30:00', null, 'MASUK', 'incomplete'],
    ['07:35:00', '14:00:00', 'MASUK', 'lembur'],
    ['07:30:00', '14:00:00', 'IZIN RESMI', 'absent'],
  ]) {
    await db.doc(`AttendanceImportRows/${fixture.employeeId}_2026-09-18`).update({ scanIn, scanOut, workStatus });
    const review = await call(swapReview.GET, fixture.reviewer);
    assert.equal(review.requests.find((item: { id: string }) => item.id === request.id).attendanceCheck.verdict, verdict);
    await call(swapReview.POST, fixture.reviewer, command({ action: 'approve', gantiLiburRequestId: request.id, expectedRevision: 3 }), 409);
  }
  const awaitingRequest = await call(swap.POST, fixture.worker, submit('2026-10-09', '2026-10-12'));
  const awaitingReview = await call(swapReview.GET, fixture.reviewer);
  assert.equal(awaitingReview.requests.find((item: { id: string }) => item.id === awaitingRequest.id).attendanceCheck.verdict, 'awaiting_upload');
  await call(swapReview.POST, fixture.reviewer, command({ action: 'approve', gantiLiburRequestId: awaitingRequest.id, expectedRevision: 1 }), 409);
  await db.doc('PayrollPeriods/2026-11').set({ attendanceStatus: 'closed' });
  await call(swap.POST, fixture.worker, submit('2026-10-30', '2026-11-02'), 409);
  await db.doc(`PayrollSlipStates/2026_12_${fixture.employeeId}`).set({ status: 'locked' });
  await call(swap.POST, fixture.worker, submit('2026-11-27', '2026-12-03'), 409);

  // Source data changing after review preparation must invalidate the approval.
  const prepared = await prepareBlueCollarGantiLiburReview({ id: request.id, employeeId: fixture.employeeId,
    employeeName: fixture.category, employeeKind: 'blue_collar', category: fixture.category,
    workedDate: '2026-09-18', workedPeriod: '2026-09', dayOffDate: '2026-09-29', dayOffPeriod: '2026-09',
    reason: '', revision: 3, status: 'pending' });
  await db.doc('AttendanceImports/2026-09').update({ activeRevisionId: 'replaced-import' });
  assert.equal((await db.runTransaction((transaction) => readBlueCollarGantiLiburReview(transaction, prepared))).unchanged, false);
  await db.doc('AttendanceImports/2026-09').update({ activeRevisionId: '2026_09__r0001' });

  const legacyWorker = await account('loyalis', 'LOY_1');
  await db.doc('Employees_Loyalis/LOY_1').set({ personal_info: { name: 'Legacy Loyalis', status: 'AKTIF' } });
  await db.doc('LoyalisPresence/2026_09').set({ entries: { LOY_1: { employeeId: 'LOY_1', dailyLogs: [
    { Tanggal: '25-09-2026', 'Jam kerja': 'MASUK', 'Scan masuk': '07:30', 'Scan pulang': '14:00' },
  ] } } });
  await db.doc('LoyalisPresence/2026_10').set({ entries: {}, workingDays: 25, expectedHours: 6.5 });
  const legacyRequest = await call(swap.POST, legacyWorker, submit());
  await db.doc(`GantiLiburRequests/${legacyRequest.id}`).update({ employeeKind: admin.firestore.FieldValue.delete(), category: admin.firestore.FieldValue.delete() });
  await call(swapReview.POST, loyalisAdmin, command({ action: 'approve', gantiLiburRequestId: legacyRequest.id, expectedRevision: 1 }));
  assert.equal((await loadApprovedGantiLiburDayOffs('2026-10')).length, 1);
  const legacyPresence = (await db.doc('LoyalisPresence/2026_10').get()).data()!;
  assert.equal(legacyPresence.entries.LOY_1.dailyLogs[0]['Jam kerja'], 'GANTI LIBUR');
  console.log('PASS immutable compensatory credits, izin conflicts, import changes and legacy Loyalis approvals');

  // Loyalis admin exceptions preserve real attendance evidence and apply one paid day.
  for (const [verdict, scanIn, scanOut] of [
    ['absent', '', ''], ['incomplete', '07:30', ''],
    ['lembur', '07:40', '13:00'], ['awaiting_upload', '', ''],
  ] as const) {
    const employeeId = `LOY_OVERRIDE_${verdict}`;
    const worker = await account('loyalis', employeeId);
    await db.doc(`Employees_Loyalis/${employeeId}`).set({ personal_info: { name: employeeId, status: 'AKTIF' } });
    await db.doc('LoyalisPresence/2026_09').set({ entries: { [employeeId]: { dailyLogs: [{
      Tanggal: verdict === 'awaiting_upload' ? '01-09-2026' : '18-09-2026',
      'Jam kerja': 'MASUK', 'Scan masuk': scanIn, 'Scan pulang': scanOut,
    }] } } }, { merge: true });
    const dayOffEntry = { employeeId, minutes: 24 * 390, absenceMinutes: 390, netBonus: 230_000,
      activeDaysCount: 24, absentDaysCount: 1, dailyLogs: [{
        Tanggal: '01-10-2026', 'Jam kerja': 'TIDAK HADIR', 'Scan masuk': '', 'Scan pulang': '',
      }] };
    await db.doc('LoyalisPresence/2026_10').set({ entries: { [employeeId]: dayOffEntry } }, { merge: true });
    const request = await call(swap.POST, worker, submit('2026-09-18'));
    const approve = command({ action: 'approve', gantiLiburRequestId: request.id, expectedRevision: 1 });
    const warning = await call(swapReview.POST, loyalisAdmin, approve, 409);
    assert.equal(warning.code, GANTI_LIBUR_ATTENDANCE_CONFIRMATION_REQUIRED);
    assert.equal(warning.details.attendanceCheck.verdict, verdict);
    assert.equal((await db.doc(`GantiLiburRequests/${request.id}`).get()).data()!.status, 'pending');
    assert.equal((await db.doc('LoyalisPresence/2026_10').get()).data()!.entries[employeeId].absenceMinutes, 390);
    assert.equal((await db.doc(`FinancialIdempotencyKeys/${(await admin.auth().verifyIdToken(loyalisAdmin.slice(7))).uid}__${approve.requestId}`).get()).exists, false);
    await call(swapReview.POST, loyalisAdmin, { ...approve, attendanceConfirmation: true }, 400);
    let confirmation = warning.details.attendanceCheck;
    if (verdict === 'incomplete') {
      await db.doc('LoyalisPresence/2026_09').update({ [`entries.${employeeId}.dailyLogs`]: [{
        Tanggal: '18-09-2026', 'Jam kerja': 'MASUK', 'Scan masuk': '07:40', 'Scan pulang': '',
      }] });
      const refreshed = await call(swapReview.POST, loyalisAdmin, { ...approve, attendanceConfirmation: confirmation }, 409);
      assert.equal(refreshed.code, GANTI_LIBUR_ATTENDANCE_CONFIRMATION_REQUIRED);
      assert.equal(refreshed.details.attendanceCheck.scanIn, '07:40');
      confirmation = refreshed.details.attendanceCheck;
    }
    const confirmed = { ...approve, attendanceConfirmation: confirmation };
    await call(swapReview.POST, finance, confirmed, 403);
    await call(swapReview.POST, loyalisAdmin, { ...confirmed, expectedRevision: 99 }, 409);
    if (verdict === 'absent') {
      await db.doc('PayrollPeriods/2026-10').set({ attendanceStatus: 'closed' });
      assert.match((await call(swapReview.POST, loyalisAdmin, confirmed, 409)).error, /ditutup/);
      await db.doc('PayrollPeriods/2026-10').delete();
      await db.doc(`PayrollSlipStates/2026_10_${employeeId}`).set({ status: 'locked' });
      assert.match((await call(swapReview.POST, loyalisAdmin, confirmed, 409)).error, /final/);
      await db.doc(`PayrollSlipStates/2026_10_${employeeId}`).delete();
      await db.doc('LoyalisPresence/2026_10').update({ [`entries.${employeeId}.dailyLogs`]: [{
        Tanggal: '01-10-2026', 'Jam kerja': 'MASUK', 'Scan masuk': '07:30', 'Scan pulang': '14:00',
      }] });
      const conflict = await call(swapReview.POST, loyalisAdmin, confirmed, 409);
      assert.match(conflict.error, /sudah memiliki presensi/);
      assert.equal(conflict.code, undefined, 'attendance override does not bypass replacement-date conflicts');
      await db.doc('LoyalisPresence/2026_10').update({ [`entries.${employeeId}`]: dayOffEntry });
    }
    await call(swapReview.POST, loyalisAdmin, confirmed);
    assert.equal((await call(swapReview.POST, loyalisAdmin, confirmed)).idempotent, true);
    await call(swapReview.POST, loyalisAdmin, approve, 409);
    const stored = (await db.doc(`GantiLiburRequests/${request.id}`).get()).data()!;
    assert.equal(stored.status, 'approved');
    assert.equal(stored.attendanceCheck.verdict, verdict);
    assert.deepEqual(stored.attendanceOverride.attendanceCheck, confirmation);
    assert.ok(stored.attendanceOverride.confirmedBy);
    assert.ok(stored.attendanceOverride.confirmedAt);
    const presence = (await db.doc('LoyalisPresence/2026_10').get()).data()!.entries[employeeId];
    assert.equal(presence.dailyLogs[0]['Jam kerja'], 'GANTI LIBUR');
    assert.equal(presence.minutes, 25 * 390);
    assert.equal(presence.absenceMinutes, 0);
    assert.equal(presence.netBonus, 250_000);
    assert.equal(presence.activeDaysCount, 25, 'idempotent retries never add a second paid day');
    await db.doc(`PayrollSlipStates/2026_10_${employeeId}`).set({ status: 'draft',
      earnings: [{ label: 'Bonus Presensi', amount: 250_000 }],
      deductions: [{ label: 'Potongan Bonus Presensi', amount: 20_000 }], taxes: [],
    });
    await call(propagation.POST, loyalisAdmin, command({ scope: 'loyalis', period: '2026-10' }));
    const slip = (await db.doc(`PayrollSlipStates/2026_10_${employeeId}`).get()).data()!;
    assert.equal(slip.deductions.find((field: { label: string }) => field.label === 'Potongan Bonus Presensi').amount, 0);
    assert.equal((await db.doc(`GantiLiburRequestRevisions/${request.id}__r2`).get()).data()!.after.attendanceOverride.confirmedBy, stored.attendanceOverride.confirmedBy);
    const audits = await db.collection('FinancialAuditLogs').where('entityId', '==', request.id).get();
    assert.ok(audits.docs.some((document) => document.data().metadata?.attendanceOverridden === true));
    const reviewed = await call(swapReview.GET, loyalisAdmin, undefined, 200, '?status=all');
    assert.equal(reviewed.requests.find((item: { id: string }) => item.id === request.id).attendanceOverride.confirmedBy, stored.attendanceOverride.confirmedBy);
  }
  console.log('PASS Loyalis attendance override: absent/incomplete/short/unuploaded scans, refreshed confirmation, paid bonus, audit, idempotency and financial guards');

  const decliningWorker = await account('loyalis', 'LOY_DECLINE');
  await db.doc('Employees_Loyalis/LOY_DECLINE').set({ personal_info: { name: 'Declined Loyalis', status: 'AKTIF' } });
  const declined = await call(swap.POST, decliningWorker, submit('2026-09-18'));
  await call(swapReview.POST, loyalisAdmin, command({ action: 'decline', gantiLiburRequestId: declined.id,
    expectedRevision: 1, reason: 'Dokumen tidak sesuai' }));
  assert.equal((await db.doc(`GantiLiburRequests/${declined.id}`).get()).data()!.attendanceOverride, null);
  // An older exception must never survive a new submission of a declined request.
  await db.doc(`GantiLiburRequests/${declined.id}`).update({ attendanceOverride: { confirmedBy: 'old-reviewer' } });
  await call(swap.POST, decliningWorker, submit('2026-09-18', '2026-10-01', 2));
  assert.equal((await db.doc(`GantiLiburRequests/${declined.id}`).get()).data()!.attendanceOverride, null);

  // Client SDKs cannot forge balance/approval data even for their own employee.
  const response = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/GantiLiburRequests/forged`, {
    method: 'PATCH', headers: { authorization: fixture.worker, 'content-type': 'application/json' },
    body: JSON.stringify({ fields: { status: { stringValue: 'approved' } } }),
  });
  assert.equal(response.status, 403);
  console.log('PASS authorization, period cutoff, idempotency, conflicts, locked payroll, Satpam reconciliation and Firestore rules');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
