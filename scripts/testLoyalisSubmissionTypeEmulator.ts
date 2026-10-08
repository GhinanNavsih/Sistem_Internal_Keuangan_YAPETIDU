/** Authenticated type transfers and approvals; all writes stay in local emulators. */
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import type { LoyalisLeaveType, LoyalisSubmissionKind } from '../src/lib/payroll/loyalisLeaveTypes';

const PROJECT = 'demo-loyalis-submission-type';
const COLLECTIONS = { correction: 'LoyalisPresenceCorrections', paid_leave: 'AnnualPaidLeaveRequests', ganti_libur: 'GantiLiburRequests' };
type Handler = (request: NextRequest) => Promise<Response>;
let sequence = 0;

async function main() {
  if (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== PROJECT ||
    !/^(localhost|127\.0\.0\.1):8188$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') ||
    !/^(localhost|127\.0\.0\.1):9198$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || '')) {
    throw new Error('This test requires the demo-loyalis-submission-type Firestore and Auth emulators.');
  }
  const { adminDb: db, default: admin } = await import('../src/lib/firebase-admin');
  const transfer = await import('../src/app/api/attendance/loyalis/submission-type/route');
  const correctionReview = await import('../src/app/api/attendance/loyalis/review/route');
  const annualReview = await import('../src/app/api/payroll/paid-leave/review/route');
  const gantiReview = await import('../src/app/api/payroll/ganti-libur/review/route');
  const { annualPaidLeaveDocumentId, annualPaidLeaveBalanceDocumentId } = await import('../src/lib/server/annualPaidLeave');
  const { gantiLiburDocumentId, parseSavedLeaveAttachmentPaths } = await import('../src/lib/server/gantiLibur');

  async function account(role: string, employeeId?: string) {
    const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `user-${++sequence}@example.test`, password: 'password123', returnSecureToken: true }),
    });
    const identity = await response.json();
    assert.ok(identity.idToken);
    await db.doc(`users/${identity.localId}`).set({ role, displayName: role, ...(employeeId ? { linkedEmployeeId: employeeId } : {}) });
    return `Bearer ${identity.idToken}`;
  }
  async function call(handler: Handler, authorization: string, body?: Record<string, unknown>, status = 200, query = '') {
    const response = await handler(new NextRequest(`http://localhost/test${query}`, {
      method: body ? 'POST' : 'GET', headers: { authorization, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }));
    const result = await response.json();
    assert.equal(response.status, status, JSON.stringify(result));
    return result;
  }
  const command = (body: Record<string, unknown>) => ({ requestId: `type-command-${++sequence}`, ...body });
  const reviewer = await account('loyalis_admin');
  const superAdmin = await account('super_admin');
  const finance = await account('finance_verifier');
  const worker = await account('loyalis', 'LOY_0');
  await db.doc('LoyalisPresence/2026_09').set({ entries: {}, workingDays: 1, expectedHours: 6.5 });

  async function fixture(kind: LoyalisSubmissionKind) {
    const employeeId = `LOY_${++sequence}`;
    await db.doc(`Employees_Loyalis/${employeeId}`).set({ personal_info: { name: employeeId, status: 'AKTIF' },
      employment_profile: { date_of_hire: '2010-01-01' } });
    const id = kind === 'correction' ? `correction_${employeeId}` : kind === 'paid_leave'
      ? annualPaidLeaveDocumentId(employeeId, '2026-09-07') : gantiLiburDocumentId(employeeId, '2026-09-04');
    const attachments = [{ name: 'Surat.pdf', path: `${kind === 'paid_leave' ? 'paid_leave' : 'ganti_libur'}/${employeeId}/proof.pdf`,
      url: 'https://example.test/proof.pdf', contentType: 'application/pdf', size: 100 }];
    const data = { employeeId, employeeName: employeeId, employeeKind: 'loyalis', employeeCollection: 'Employees_Loyalis', category: 'LOYALIS',
      status: 'pending', revision: kind === 'correction' ? 0 : 1, reason: 'Dinas luar', attachments,
      updatedAt: admin.firestore.Timestamp.fromMillis(1000),
      ...(kind === 'correction' ? { date: '2026-09-07', period: '2026-09', type: 'izin_resmi', proofUrl: 'https://example.test/proof.pdf' }
        : kind === 'paid_leave' ? { leaveDate: '2026-09-07', period: '2026-09', year: 2026, serviceDate: '2010-01-01' }
          : { dayOffDate: '2026-09-07', dayOffPeriod: '2026-09', workedDate: '2026-09-04', workedPeriod: '2026-09' }) };
    const ref = db.doc(`${COLLECTIONS[kind]}/${id}`);
    await ref.set(data);
    const balanceRef = db.doc(`AnnualPaidLeaveBalances/${annualPaidLeaveBalanceDocumentId(employeeId, 2026)}`);
    await balanceRef.set({ employeeId, entitlementDays: 9, usedDays: 0, reservedDays: kind === 'paid_leave' ? 1 : 0, balanceRevision: 1 });
    await db.doc('LoyalisPresence/2026_09').set({ entries: { [employeeId]: {
      employeeId, minutes: 0, absenceMinutes: 390, netBonus: 0, activeDaysCount: 0, absentDaysCount: 1,
      dailyLogs: [{ Tanggal: '07-09-2026', 'Jam kerja': 'TIDAK HADIR', 'Scan masuk': '', 'Scan pulang': '' }],
    } } }, { merge: true });
    const change = (type: LoyalisLeaveType) => command({ sourceKind: kind, sourceRequestId: id,
      expectedRevision: data.revision, ...(kind === 'correction' ? { expectedUpdatedAt: 's1n0' } : {}),
      type, ...(type === 'ganti_libur' ? { workedDate: '2026-09-04' } : {}) });
    return { employeeId, id, ref, data, balanceRef, change };
  }

  for (const [sourceKind, nextTypes] of [
    ['correction', ['cuti_tahunan', 'ganti_libur']],
    ['paid_leave', ['izin_resmi', 'ganti_libur']],
    ['ganti_libur', ['izin_resmi', 'cuti_tahunan']],
  ] as const) {
    for (const nextType of nextTypes) {
      const item = await fixture(sourceKind);
      const change = item.change(nextType);
      await call(transfer.POST, finance, change, 403);
      await call(transfer.POST, worker, change, 403);
      await call(transfer.POST, reviewer, { ...change, expectedRevision: 99 }, 409);
      if (sourceKind === 'correction') await call(transfer.POST, reviewer, { ...change, expectedUpdatedAt: 's2n0' }, 409);
      const result = await call(transfer.POST, reviewer, change);
      assert.equal((await call(transfer.POST, reviewer, change)).idempotent, true);
      await call(transfer.POST, reviewer, { ...change, type: nextType === 'izin_resmi' ? 'cuti_tahunan' : 'izin_resmi' }, 409);
      const source = (await item.ref.get()).data()!;
      assert.equal(source.typeChangedTo.id, result.target.id);
      assert.equal(source.revision, item.data.revision + 1);
      assert.equal(source.status, sourceKind === 'correction' ? 'rejected' : 'withdrawn');
      const targetRef = db.doc(`${COLLECTIONS[result.target.kind as LoyalisSubmissionKind]}/${result.target.id}`);
      const target = (await targetRef.get()).data()!;
      assert.equal(target.status, 'pending', 'changing the type never approves it');
      assert.equal(target.typeChangedFrom.id, item.id);
      assert.equal(target.reason, 'Dinas luar');
      assert.deepEqual(target.attachments, item.data.attachments);
      assert.equal((await item.balanceRef.get()).data()!.reservedDays, nextType === 'cuti_tahunan' ? 1 : 0);
      assert.equal((await item.balanceRef.get()).data()!.usedDays, 0);
      assert.equal((await db.doc('LoyalisPresence/2026_09').get()).data()!.entries[item.employeeId].minutes, 0, 'pending transfers cannot change pay');
      const paths = item.data.attachments.map((attachment) => attachment.path);
      const folder = result.target.kind === 'paid_leave' ? 'paid_leave' : 'ganti_libur';
      assert.equal((await parseSavedLeaveAttachmentPaths(paths, item.employeeId, folder, targetRef)).ok, true);
      assert.equal((await parseSavedLeaveAttachmentPaths(['ganti_libur/another_employee/new.pdf'], item.employeeId, folder, targetRef)).ok, false);
      const audits = await db.collection('FinancialAuditLogs').where('entityId', '==', item.id).get();
      assert.equal(audits.size, 1);
      assert.equal(audits.docs[0].data().action, 'LOYALIS_LEAVE_TYPE_CHANGED');
      assert.equal(audits.docs[0].data().metadata.to.type, nextType);

      if (nextType === 'izin_resmi') {
        await db.doc(`PayrollSlipStates/2026_09_${item.employeeId}`).set({ status: 'locked' });
        await call(correctionReview.POST, reviewer, { requestId: result.target.id, action: 'approve' }, 409);
        await db.doc(`PayrollSlipStates/2026_09_${item.employeeId}`).delete();
        await db.doc('PayrollPeriods/2026-09').set({ attendanceStatus: 'closed' });
        await call(correctionReview.POST, reviewer, { requestId: result.target.id, action: 'approve' }, 409);
        await db.doc('PayrollPeriods/2026-09').delete();
        await call(correctionReview.POST, reviewer, { requestId: result.target.id, action: 'approve' });
      } else if (nextType === 'cuti_tahunan') {
        await call(annualReview.POST, reviewer, command({ annualPaidLeaveRequestId: result.target.id, action: 'approve', expectedRevision: result.revision }));
        assert.equal((await item.balanceRef.get()).data()!.usedDays, 1);
        assert.equal((await item.balanceRef.get()).data()!.reservedDays, 0);
      } else {
        const approval = command({ gantiLiburRequestId: result.target.id, action: 'approve', expectedRevision: result.revision });
        const warning = await call(gantiReview.POST, reviewer, approval, 409);
        assert.equal(warning.code, 'GANTI_LIBUR_ATTENDANCE_CONFIRMATION_REQUIRED');
        await call(gantiReview.POST, reviewer, { ...approval, attendanceConfirmation: warning.details.attendanceCheck });
      }
      assert.equal((await targetRef.get()).data()!.status, 'approved');
      assert.equal((await db.doc('LoyalisPresence/2026_09').get()).data()!.entries[item.employeeId].minutes, 390);
      console.log(`PASS ${sourceKind} -> ${nextType}: pending transfer, documents, quota, audit, idempotency and paid approval`);
    }
  }

  const racing = await fixture('correction');
  const requests = [racing.change('cuti_tahunan'), racing.change('cuti_tahunan')];
  const responses = await Promise.all(requests.map((body) => transfer.POST(new NextRequest('http://localhost/test', {
    method: 'POST', headers: { authorization: reviewer, 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))));
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  assert.equal((await racing.balanceRef.get()).data()!.reservedDays, 1);
  assert.equal((await db.collection('FinancialAuditLogs').where('entityId', '==', racing.id).get()).size, 1);
  const fractional = await fixture('correction');
  await fractional.ref.update({ updatedAt: new admin.firestore.Timestamp(1, 123456000) });
  await call(transfer.POST, reviewer, { ...fractional.change('cuti_tahunan'), expectedUpdatedAt: 's1n123456000' });
  const cycle = await fixture('ganti_libur');
  const toAnnual = await call(transfer.POST, reviewer, cycle.change('cuti_tahunan'));
  const back = await call(transfer.POST, reviewer, command({ sourceKind: 'paid_leave', sourceRequestId: toAnnual.target.id,
    expectedRevision: toAnnual.revision, type: 'ganti_libur', workedDate: '2026-09-04' }));
  assert.equal(back.target.id, cycle.id);
  assert.equal(back.revision, 3);
  assert.equal((await cycle.balanceRef.get()).data()!.reservedDays, 0);
  assert.equal((await cycle.ref.get()).data()!.typeChangedTo, undefined);
  const unsafe = await fixture('correction');
  await unsafe.ref.update({ attachments: [{ ...unsafe.data.attachments[0], path: 'ganti_libur/someone_else/proof.pdf' }] });
  await call(transfer.POST, reviewer, unsafe.change('cuti_tahunan'), 409);
  assert.equal((await unsafe.balanceRef.get()).data()!.reservedDays, 0);
  console.log('PASS simultaneous decisions, fractional Firestore timestamps, conversion back to original type and document ownership');

  for (const legacyType of ['cuti_tahunan', 'ganti_libur'] as const) {
    const legacy = await fixture('correction');
    await legacy.ref.update({ type: legacyType });
    await call(correctionReview.POST, reviewer, { requestId: legacy.id, action: 'approve' }, 409);
    const migrated = await call(transfer.POST, reviewer, legacy.change(legacyType));
    assert.equal(migrated.target.kind, legacyType === 'cuti_tahunan' ? 'paid_leave' : 'ganti_libur');
    assert.equal((await legacy.balanceRef.get()).data()!.reservedDays, legacyType === 'cuti_tahunan' ? 1 : 0);
  }
  console.log('PASS legacy correction leave types use validated native approval workflows');

  const locked = await fixture('ganti_libur');
  await db.doc('PayrollPeriods/2026-09').set({ attendanceStatus: 'closed' });
  await call(transfer.POST, superAdmin, locked.change('izin_resmi'), 409);
  await db.doc('PayrollPeriods/2026-09').delete();
  await db.doc(`PayrollSlipStates/2026_09_${locked.employeeId}`).set({ status: 'locked' });
  await call(transfer.POST, reviewer, locked.change('izin_resmi'), 409);
  await db.doc(`PayrollSlipStates/2026_09_${locked.employeeId}`).delete();
  await locked.ref.update({ status: 'approved' });
  await call(transfer.POST, reviewer, locked.change('izin_resmi'), 409);

  const full = await fixture('ganti_libur');
  await full.balanceRef.update({ usedDays: 9 });
  await call(transfer.POST, reviewer, full.change('cuti_tahunan'), 409);
  assert.equal((await full.ref.get()).data()!.status, 'pending');
  await db.doc(`Employees_Loyalis/${full.employeeId}`).update({ 'employment_profile.date_of_hire': '2025-01-01' });
  await call(transfer.POST, reviewer, full.change('cuti_tahunan'), 409);
  const invalidDate = await fixture('correction');
  await call(transfer.POST, reviewer, { ...invalidDate.change('ganti_libur'), workedDate: '2026-09-07' }, 409);
  await call(transfer.POST, reviewer, { ...invalidDate.change('ganti_libur'), workedDate: '' }, 400);
  await call(transfer.POST, reviewer, { ...invalidDate.change('ganti_libur'), type: 'sakit' }, 400);
  const conflict = await fixture('ganti_libur');
  await db.doc(`LoyalisPresenceCorrections/conflict_${conflict.id}`).set({ employeeId: conflict.employeeId, date: '2026-09-07', type: 'izin_resmi', status: 'pending' });
  await call(transfer.POST, reviewer, conflict.change('cuti_tahunan'), 409);

  // Client SDKs cannot reopen a converted source or forge transfer metadata.
  const ruleItem = await fixture('correction');
  const owner = await account('loyalis', ruleItem.employeeId);
  await call(transfer.POST, reviewer, ruleItem.change('cuti_tahunan'));
  const endpoint = `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${PROJECT}/databases/(default)/documents`;
  const newCorrection = await fetch(`${endpoint}/LoyalisPresenceCorrections/ordinary`, {
    method: 'PATCH', headers: { authorization: owner, 'content-type': 'application/json' },
    body: JSON.stringify({ fields: { employeeId: { stringValue: ruleItem.employeeId }, date: { stringValue: '2026-09-08' },
      period: { stringValue: '2026-09' }, status: { stringValue: 'pending' }, type: { stringValue: 'izin_resmi' } } }),
  });
  assert.equal(newCorrection.status, 200, await newCorrection.text());
  const ordinaryUpdate = await fetch(`${endpoint}/LoyalisPresenceCorrections/ordinary?updateMask.fieldPaths=reason`, {
    method: 'PATCH', headers: { authorization: owner, 'content-type': 'application/json' },
    body: JSON.stringify({ fields: { reason: { stringValue: 'Alasan diperbarui' } } }),
  });
  assert.equal(ordinaryUpdate.status, 200, await ordinaryUpdate.text());
  const forgeUpdate = await fetch(`${endpoint}/LoyalisPresenceCorrections/ordinary?updateMask.fieldPaths=typeChangedTo`, {
    method: 'PATCH', headers: { authorization: owner, 'content-type': 'application/json' },
    body: JSON.stringify({ fields: { typeChangedTo: { mapValue: { fields: {} } } } }),
  });
  assert.equal(forgeUpdate.status, 403);
  const reopen = await fetch(`${endpoint}/${ruleItem.ref.path}?updateMask.fieldPaths=status`, {
    method: 'PATCH', headers: { authorization: owner, 'content-type': 'application/json' },
    body: JSON.stringify({ fields: { status: { stringValue: 'pending' } } }),
  });
  assert.equal(reopen.status, 403);
  const forged = await fetch(`${endpoint}/LoyalisPresenceCorrections/forged`, {
    method: 'PATCH', headers: { authorization: owner, 'content-type': 'application/json' },
    body: JSON.stringify({ fields: { employeeId: { stringValue: ruleItem.employeeId }, date: { stringValue: '2026-09-07' },
      period: { stringValue: '2026-09' }, status: { stringValue: 'pending' }, typeChangedTo: { mapValue: { fields: {} } } } }),
  });
  assert.equal(forged.status, 403);
  console.log('PASS closed periods, locked slips, approved submissions, insufficient quota/service, dates, conflicts and server-owned history');

  // A correction must retain every other day's imported attendance, even when
  // the scanner leaves Jam kerja blank or uses its own label. Verify the
  // persisted month through the real authenticated approval handler.
  const attendance = await fixture('correction');
  await attendance.ref.update({ date: '2026-09-19' });
  const day = (date: string, status: string, scanIn: string, scanOut: string) => ({
    Tanggal: `${date}-09-2026`,
    'Jam kerja': status,
    'Scan masuk': scanIn,
    'Scan pulang': scanOut,
  });
  await db.doc('PayrollPeriods/2026-09').set({
    workCalendar: { revision: 1, premiumDates: ['2026-09-10'] },
  });
  const presenceRef = db.doc('LoyalisPresence/2026_09');
  await presenceRef.set({ workingDays: 26, expectedHours: 6.5, entries: {
    [attendance.employeeId]: {
      employeeId: attendance.employeeId,
      minutes: 1_956,
      absenceMinutes: 8_184,
      dailyLogs: [
        { ...day('01', '', '07:11:44', '14:03:14'), sourceRowNumber: 101 },
        day('02', 'Staff', '08:39:45', '14:24:00'),
        day('03', '', '08:45:06', '16:39:33'),
        { ...day('04', 'MASUK', '07:30', '14:00'), isOffDay: false },
        day('05', 'Tidak Hadir', '07:30', '14:00'),
        day('06', 'CUTI', '07:30', '14:00'),
        day('07', 'GANTI LIBUR', '07:30', '14:00'),
        day('08', '', '07:18:25', ''),
        { ...day('09', '', '07:30', ''), scanPulangAuto: false },
        { ...day('10', 'MASUK', '07:30', '14:00'), isOffDay: false },
        day('19', 'Tidak Hadir', '', ''),
        day('20', 'Tidak Hadir', '', ''),
      ],
    },
  } }, { merge: true });
  const savedAttendance = async () => (await presenceRef.get()).data()!.entries[attendance.employeeId];
  const approval = { requestId: attendance.id, action: 'approve' };
  const unchanged = await savedAttendance();
  await call(correctionReview.POST, worker, approval, 403);
  await db.doc(`PayrollSlipStates/2026_09_${attendance.employeeId}`).set({ status: 'locked' });
  await call(correctionReview.POST, reviewer, approval, 409);
  assert.deepEqual(await savedAttendance(), unchanged);
  assert.equal((await attendance.ref.get()).data()!.status, 'pending');
  await db.doc(`PayrollSlipStates/2026_09_${attendance.employeeId}`).delete();
  await call(correctionReview.POST, reviewer, approval);
  let saved = await savedAttendance();
  const savedDay = (date: string) => saved.dailyLogs.find((row: { Tanggal: string }) => row.Tanggal === `${date}-09-2026`);
  assert.equal(savedDay('01').duration, 390, 'blank-status scans must survive correction approval');
  assert.equal(savedDay('01').sourceRowNumber, 101);
  assert.equal(savedDay('02').duration, 321, 'scanner-specific labels remain payable');
  assert.equal(savedDay('03').duration, 315);
  assert.equal(savedDay('04').duration, 0, 'Friday scans never earn Loyalis attendance pay');
  assert.equal(savedDay('04').isOffDay, true);
  assert.equal(savedDay('05').duration, 0, 'explicit absences remain unpaid even with kept scans');
  assert.equal(savedDay('06').duration, 390, 'annual leave remains credited');
  assert.equal(savedDay('07').duration, 390, 'ganti libur remains credited');
  assert.equal(savedDay('08').duration, 150, 'single scans use the same auto-fill as the import page');
  assert.equal(savedDay('08').scanPulangAuto, true);
  assert.equal(savedDay('09').duration, 0, 'an explicitly disabled auto-fill remains disabled');
  assert.equal(savedDay('10').duration, 0, 'the current period calendar overrides old off-day flags');
  assert.equal(saved.minutes, 2_346);
  assert.equal(saved.absenceMinutes, 7_794);
  assert.equal(saved.activeDaysCount, 7);
  assert.equal(saved.incompleteDaysCount, 1);
  assert.equal(saved.absentDaysCount, 2);
  assert.equal(saved.offDayScannedCount, 2);
  assert.equal(saved.offDayExcludedMinutes, 780);
  await call(correctionReview.POST, reviewer, approval, 409);
  assert.deepEqual(await savedAttendance(), saved, 'a repeat approval must not change the month');

  const secondId = `second_${attendance.id}`;
  await db.doc(`LoyalisPresenceCorrections/${secondId}`).set({
    employeeId: attendance.employeeId, date: '2026-09-20', type: 'izin_resmi', status: 'pending',
  });
  await call(correctionReview.POST, reviewer, { requestId: secondId, action: 'approve' });
  saved = await savedAttendance();
  assert.equal(saved.minutes, 2_736, 'approving another date keeps the earlier credit and imported scans');
  assert.equal(saved.absenceMinutes, 7_404);
  assert.equal(savedDay('01').duration, 390);
  assert.equal(savedDay('19').duration, 390);
  assert.equal(savedDay('20').duration, 390);

  const tapOutId = `tap_out_${attendance.id}`;
  await db.doc(`LoyalisPresenceCorrections/${tapOutId}`).set({
    employeeId: attendance.employeeId, date: '2026-09-08', type: 'tap_out',
    checkOutTime: '14:00', status: 'pending',
  });
  await call(correctionReview.POST, reviewer, { requestId: tapOutId, action: 'approve' });
  saved = await savedAttendance();
  assert.equal(saved.minutes, 2_976);
  assert.equal(savedDay('08').duration, 390);
  assert.equal(savedDay('08').scanPulangAuto, false, 'an approved real scan replaces its automatic marker');

  // Before a month is materialized, the annual calendar still excludes its
  // national holidays. Once frozen, the period snapshot takes precedence.
  await db.doc('PayrollPeriods/2026-09').delete();
  await db.doc('PayrollHolidayCalendars/2026').set({ dates: ['2026-09-10'] });
  const annualCalendarId = `annual_calendar_${attendance.id}`;
  await db.doc(`LoyalisPresenceCorrections/${annualCalendarId}`).set({
    employeeId: attendance.employeeId, date: '2026-09-19', type: 'izin_resmi', status: 'pending',
  });
  await call(correctionReview.POST, reviewer, { requestId: annualCalendarId, action: 'approve' });
  saved = await savedAttendance();
  assert.equal(saved.minutes, 2_976);
  assert.equal(savedDay('10').duration, 0);
  await db.doc('PayrollPeriods/2026-09').set({
    workCalendar: { revision: 2, premiumDates: ['2026-09-04'] },
  });
  const frozenCalendarId = `frozen_calendar_${attendance.id}`;
  await db.doc(`LoyalisPresenceCorrections/${frozenCalendarId}`).set({
    employeeId: attendance.employeeId, date: '2026-09-19', type: 'izin_resmi', status: 'pending',
  });
  await call(correctionReview.POST, reviewer, { requestId: frozenCalendarId, action: 'approve' });
  saved = await savedAttendance();
  assert.equal(saved.minutes, 3_366);
  assert.equal(savedDay('10').duration, 390, 'the frozen period calendar takes precedence over annual dates');
  console.log('PASS correction approvals preserve imported scans, paid leave, auto-fill, calendars and immutable payroll guards');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
