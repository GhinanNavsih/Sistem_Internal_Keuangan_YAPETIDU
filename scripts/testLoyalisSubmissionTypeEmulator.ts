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
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
