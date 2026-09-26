/** Auth + Firestore integration ONLY. Both Firebase projects use the emulator. */
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { koperasiMemberSnapshot, mirroredStatus } from '../src/lib/koperasiMembers';

const PROJECT = 'demo-koperasi-members';
async function signUp(email: string) {
  const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123', returnSecureToken: true }),
  });
  const identity = await response.json();
  assert.ok(identity.idToken, JSON.stringify(identity));
  return { uid: identity.localId as string, authorization: `Bearer ${identity.idToken}` };
}

async function main() {
  if (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== PROJECT ||
      !/^(127\.0\.0\.1|localhost):8188$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') ||
      !/^(127\.0\.0\.1|localhost):9198$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || '')) {
    throw new Error('Refusing to run outside the demo-koperasi-members emulators.');
  }
  const { adminDb, default: admin } = await import('../src/lib/firebase-admin');
  const { koperasiAdminDb } = await import('../src/lib/koperasi-admin');
  const koperasi = koperasiAdminDb();
  assert.equal(admin.app('koperasi').options.projectId, 'koperasi-unipdu');
  const { PATCH } = await import('../src/app/api/admin/koperasi-members/route');
  const { POST: link } = await import('../src/app/api/admin/koperasi-members/link/route');
  const { POST: sync } = await import('../src/app/api/admin/koperasi-members/bank-sync/route');
  const { GET: redirect } = await import('../src/app/dashboard/payroll/simpan-pinjam/route');
  const superAdmin = await signUp('super@example.test');
  const loyalisAdmin = await signUp('loyalis@example.test');
  const finance = await signUp('finance@example.test');
  const worker = await signUp('worker@example.test');
  for (const [identity, role] of [[superAdmin, 'super_admin'], [loyalisAdmin, 'loyalis_admin'], [finance, 'finance_verifier'], [worker, 'honorer']] as const) {
    await adminDb.doc(`users/${identity.uid}`).set({ role, displayName: role });
  }
  const invoke = (handler: (request: NextRequest) => Promise<Response>, body: unknown, authorization = superAdmin.authorization, method = 'POST') =>
    handler(new NextRequest('http://localhost/api/admin/koperasi-members', { method, headers: { authorization, 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  async function succeeds(response: Response, status = 200) {
    const data = await response.json();
    assert.equal(response.status, status, JSON.stringify(data));
    return data;
  }
  let sequence = 0;
  const key = () => `koperasi_integration_${++sequence}`;
  const base = { nama: 'Anggota Uji', role: 'Member', membershipStatus: 'approved', status: 'inactive', paymentStatus: 'Payroll Deduction', iuranPokok: 250000, iuranWajib: 25000 };
  const initial = koperasi.doc('users/member-1');
  await initial.set({ ...base, uid: 'uid-1', bankDetails: { bank: 'Old', nomorRekening: '123' } });
  const input = { paymentStatus: 'Transfer', membershipStatus: 'inactive', iuranPokok: 250000, iuranWajib: 75000, role: 'Member', note: 'Uji edit', confirmStaffRole: false };
  const command = { memberId: 'member-1', input, expected: koperasiMemberSnapshot(base), requestId: key() };
  for (const actor of [worker, finance, loyalisAdmin]) {
    assert.equal((await invoke(PATCH, command, actor.authorization, 'PATCH')).status, 403);
    assert.equal((await invoke(link, {}, actor.authorization)).status, 403);
    assert.equal((await invoke(sync, { memberIds: ['member-1'] }, actor.authorization)).status, 403);
  }
  assert.equal((await invoke(PATCH, command, '', 'PATCH')).status, 401);
  assert.equal((await invoke(PATCH, { ...command, input: { ...input, role: 'Admin' } }, undefined, 'PATCH')).status, 400);
  assert.equal((await invoke(PATCH, { ...command, input: { ...input, iuranWajib: 0 } }, undefined, 'PATCH')).status, 400);
  await succeeds(await invoke(PATCH, command, undefined, 'PATCH'));
  const edited = (await initial.get()).data()!;
  assert.equal(edited.membershipStatus, 'inactive');
  assert.equal(edited.status, 'inactive');
  assert.equal(edited.iuranWajib, 75000);
  assert.equal(edited.updatedBy, `internal-bak:${superAdmin.uid}`);
  assert.ok(edited.updatedAt);
  const audits = () => adminDb.collection('FinancialAuditLogs').get();
  let log = (await audits()).docs[0].data();
  assert.equal(log.action, 'KOPERASI_MEMBER_UPDATED');
  assert.equal(log.before.paymentStatus, 'Payroll Deduction');
  assert.equal(log.after.paymentStatus, 'Transfer');
  assert.equal((await succeeds(await invoke(PATCH, command, undefined, 'PATCH'))).idempotent, true);
  assert.equal((await audits()).size, 1, 'lost HTTP response replays without a second audit');
  assert.equal((await invoke(PATCH, { ...command, input: { ...input, iuranWajib: 80000 } }, undefined, 'PATCH')).status, 409, 'request id cannot be reused');
  assert.equal((await invoke(PATCH, { ...command, requestId: key(), input: { ...input, paymentStatus: 'Payroll Deduction' } }, undefined, 'PATCH')).status, 409, 'stale expected is rejected');

  // Lost cross-project response: Koperasi applied, SAKU receipt not yet written.
  const recovered = { ...input, membershipStatus: 'Pending', paymentStatus: 'Payroll Deduction', role: 'Admin', confirmStaffRole: true };
  await initial.update({ ...koperasiMemberSnapshot({ ...recovered, status: mirroredStatus(recovered.membershipStatus) }), updatedBy: `internal-bak:${superAdmin.uid}` });
  const recovery = { memberId: 'member-1', expected: koperasiMemberSnapshot(edited), input: recovered, requestId: key() };
  await succeeds(await invoke(PATCH, recovery, undefined, 'PATCH'));
  const recoveryLog = (await adminDb.collection('FinancialAuditLogs').where('requestId', '==', recovery.requestId).get()).docs[0].data();
  assert.equal(recoveryLog.before.iuranWajib, 75000);
  assert.equal(recoveryLog.after.status, 'pending');
  assert.equal(recoveryLog.metadata.recoveredFromExpected, true);

  // Concurrent reuse of a request id must lose BEFORE mutating the other project.
  await koperasi.doc('users/concurrent-a').set(base);
  await koperasi.doc('users/concurrent-b').set(base);
  const reusedId = key();
  const competingEdits = await Promise.all(['concurrent-a', 'concurrent-b'].map(memberId => invoke(PATCH, {
    memberId, expected: koperasiMemberSnapshot(base), input, requestId: reusedId,
  }, undefined, 'PATCH')));
  assert.deepEqual(competingEdits.map(response => response.status).sort(), [200, 409]);
  const competitors = await koperasi.getAll(koperasi.doc('users/concurrent-a'), koperasi.doc('users/concurrent-b'));
  assert.equal(competitors.filter(doc => doc.data()?.paymentStatus === 'Transfer').length, 1);

  const loyalis = adminDb.doc('Employees_Loyalis/Loyalis_001');
  const pekarya = adminDb.doc('Employees_BlueCollar/BC_001');
  await loyalis.set({ personal_info: { name: 'Pegawai Loyalis', status: 'AKTIF' }, banking_info: { bank_name: 'BRIS', account_number: '001-2345' } });
  await pekarya.set({ name: 'Pegawai Pekarya', employment: { status: 'active' }, flags: { isActive: true }, bankAccount: { bankName: 'BSI', accountNumber: '0098765' } });
  await koperasi.doc('users/no-uid').set(base);
  const linkCommand = { memberId: 'no-uid', employeeId: 'Loyalis_001', employeeCollection: 'Employees_Loyalis', expectedEmployeeId: null, expectedEmployeeCollection: null, action: 'link', requestId: key() };
  await succeeds(await invoke(link, linkCommand));
  assert.equal((await loyalis.get()).data()?.koperasiAuthUid, 'no-uid', 'doc id fallback for missing uid');
  assert.equal((await loyalis.get()).data()?.koperasiUserId, 'no-uid');
  assert.deepEqual((await koperasi.doc('users/no-uid').get()).data()?.bankDetails, { bank: 'BRIS', nomorRekening: '0012345' });
  let auditCount = (await audits()).size;
  assert.equal((await succeeds(await invoke(link, linkCommand))).idempotent, true);
  assert.equal((await audits()).size, auditCount);
  assert.equal((await invoke(link, { ...linkCommand, memberId: 'member-1', requestId: key() })).status, 409, 'employee already linked');
  assert.equal((await invoke(link, { ...linkCommand, employeeId: 'BC_001', employeeCollection: 'Employees_BlueCollar', requestId: key() })).status, 409, 'member already linked');

  await adminDb.doc('Employees_BlueCollar/BC_OLD').set({ name: 'Old', employment: { status: 'inactive' }, koperasiAuthUid: 'no-uid', koperasiUserId: 'no-uid', conversion: { toEmployeeId: 'Loyalis_001', effectivePeriod: '2026-10' } });
  assert.equal((await invoke(link, { ...linkCommand, employeeId: 'BC_OLD', employeeCollection: 'Employees_BlueCollar', expectedEmployeeId: 'Loyalis_001', expectedEmployeeCollection: 'Employees_Loyalis', requestId: key() })).status, 409);
  const replacement = { ...linkCommand, employeeId: 'BC_001', employeeCollection: 'Employees_BlueCollar', expectedEmployeeId: 'Loyalis_001', expectedEmployeeCollection: 'Employees_Loyalis', requestId: key() };
  await succeeds(await invoke(link, replacement));
  assert.equal((await loyalis.get()).data()?.koperasiAuthUid, null);
  assert.equal((await pekarya.get()).data()?.koperasiAuthUid, 'no-uid');
  assert.equal((await adminDb.doc('Employees_BlueCollar/BC_OLD').get()).data()?.koperasiAuthUid, 'no-uid', 'historical converted link remains');
  assert.deepEqual((await koperasi.doc('users/no-uid').get()).data()?.bankDetails, { bank: 'BSI', nomorRekening: '0098765' });
  const unlink = { ...replacement, action: 'unlink', expectedEmployeeId: 'BC_001', expectedEmployeeCollection: 'Employees_BlueCollar', requestId: key() };
  await succeeds(await invoke(link, unlink));
  assert.equal((await pekarya.get()).data()?.koperasiAuthUid, null);
  auditCount = (await audits()).size;
  await succeeds(await invoke(link, unlink));
  assert.equal((await audits()).size, auditCount);

  // Competing links serialize through SAKU, including the no-results query.
  const competing = await Promise.all([
    invoke(link, { ...linkCommand, requestId: key() }),
    invoke(link, { ...linkCommand, employeeId: 'BC_001', employeeCollection: 'Employees_BlueCollar', requestId: key() }),
  ]);
  assert.deepEqual(competing.map(response => response.status).sort(), [200, 409]);

  await koperasi.doc('users/bank-1').set({ ...base, uid: 'bank-uid', bankDetails: { bank: 'OLD', nomorRekening: '1' } });
  await koperasi.doc('users/empty-bank').set({ ...base, bankDetails: { bank: 'Keep', nomorRekening: '2' } });
  await adminDb.doc('Employees_Loyalis/Loyalis_002').set({ personal_info: { name: 'Bank Test', status: 'AKTIF' }, banking_info: { bank_name: 'BRIS', account_number: '0012000' }, koperasiUserId: 'bank-1', koperasiAuthUid: 'bank-uid' });
  await adminDb.doc('Employees_Loyalis/Loyalis_003').set({ personal_info: { name: 'Empty', status: 'AKTIF' }, banking_info: { bank_name: 'BSI', account_number: '' }, koperasiUserId: 'empty-bank', koperasiAuthUid: 'empty-bank' });
  const bulkCommand = { memberIds: ['bank-1', 'empty-bank'], requestId: key() };
  const bulk = await succeeds(await invoke(sync, bulkCommand));
  assert.equal(bulk.synced, 1);
  assert.equal(bulk.skipped.length, 1);
  assert.deepEqual((await koperasi.doc('users/empty-bank').get()).data()?.bankDetails, { bank: 'Keep', nomorRekening: '2' });
  log = (await adminDb.collection('FinancialAuditLogs').where('requestId', '==', bulkCommand.requestId).get()).docs[0].data();
  assert.equal(log.action, 'KOPERASI_BANK_SYNCED');
  assert.equal(log.metadata.members[0].memberId, 'bank-1');
  assert.equal((await succeeds(await invoke(sync, bulkCommand))).synced, 1);
  await adminDb.doc('Employees_Loyalis/Loyalis_002').update({ 'banking_info.account_number': '0055000' });
  await succeeds(await invoke(sync, { employeeId: 'Loyalis_002', requestId: key() }, loyalisAdmin.authorization));
  assert.equal((await koperasi.doc('users/bank-1').get()).data()?.bankDetails.nomorRekening, '0055000');
  assert.equal((await invoke(sync, { employeeId: 'Loyalis_002' }, finance.authorization)).status, 403);
  assert.equal((await invoke(sync, { employeeId: 'Loyalis_002', bankDetails: { bank: 'Fake' } }, loyalisAdmin.authorization)).status, 400);

  // Inject an actual SAKU failure after the Koperasi bank batch commits.
  // The retry must keep the original before-values and exactly one audit.
  await adminDb.doc('Employees_Loyalis/Loyalis_002').update({ 'banking_info.account_number': '0066000' });
  const failedBankCommand = { employeeId: 'Loyalis_002', requestId: key() };
  const originalTransaction = adminDb.runTransaction.bind(adminDb);
  let transactions = 0;
  Object.defineProperty(adminDb, 'runTransaction', { configurable: true, writable: true, value: (...args: Parameters<typeof adminDb.runTransaction>) => {
    transactions += 1;
    if (transactions === 2) throw new Error('Injected SAKU audit outage after Koperasi commit');
    return originalTransaction(...args);
  } });
  try { assert.equal((await invoke(sync, failedBankCommand)).status, 500); }
  finally { Object.defineProperty(adminDb, 'runTransaction', { configurable: true, writable: true, value: originalTransaction }); }
  assert.equal((await koperasi.doc('users/bank-1').get()).data()?.bankDetails.nomorRekening, '0066000');
  assert.equal((await adminDb.doc(`FinancialIdempotencyKeys/${superAdmin.uid}__${failedBankCommand.requestId}`).get()).data()?.state, 'pending');
  assert.equal((await succeeds(await invoke(sync, failedBankCommand))).synced, 1);
  const recoveredBankAudits = await adminDb.collection('FinancialAuditLogs').where('requestId', '==', failedBankCommand.requestId).get();
  assert.equal(recoveredBankAudits.size, 1);
  assert.equal(recoveredBankAudits.docs[0].data().before[0].bankDetails.nomorRekening, '0055000');
  assert.equal(recoveredBankAudits.docs[0].data().after[0].bankDetails.nomorRekening, '0066000');

  // Authenticated browser writes use actual Firestore rules through REST.
  const clientWrite = (authorization: string, path: string, fields: Record<string, unknown>) => fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/${path}?${Object.keys(fields).map(field => `updateMask.fieldPaths=${field}`).join('&')}`,
    { method: 'PATCH', headers: { authorization, 'content-type': 'application/json' }, body: JSON.stringify({ fields }) },
  );
  for (const actor of [superAdmin, loyalisAdmin]) {
    for (const collection of ['Employees_Loyalis', 'Employees_BlueCollar']) {
      const path = `${collection}/rules-control`;
      await adminDb.doc(path).set({ name: 'Control' });
      for (const field of ['koperasiAuthUid', 'koperasiUserId']) {
        assert.equal((await clientWrite(actor.authorization, path, { [field]: { stringValue: 'forged' } })).status, 403);
        assert.equal((await clientWrite(actor.authorization, `${collection}/forged-${field}`, { [field]: { stringValue: 'forged' } })).status, 403);
      }
      assert.equal((await clientWrite(actor.authorization, path, { name: { stringValue: 'Ordinary edit' } })).status, 200);
      assert.equal((await clientWrite(actor.authorization, `${collection}/null-links`, { koperasiAuthUid: { nullValue: null }, koperasiUserId: { nullValue: null } })).status, 200);
    }
  }
  assert.equal((await clientWrite(loyalisAdmin.authorization, 'Employees_Loyalis/Loyalis_002', { koperasiUserId: { nullValue: null } })).status, 403, 'existing links cannot be cleared by a client');
  const redirected = redirect(new NextRequest('http://localhost/dashboard/payroll/simpan-pinjam?period=2026-09&filter=a&filter=b&view=koperasi'));
  assert.equal(redirected.status, 308);
  const destination = new URL(redirected.headers.get('location')!);
  assert.equal(destination.pathname, '/dashboard/payroll/koperasi');
  assert.equal(destination.searchParams.get('view'), 'simpan-pinjam');
  assert.deepEqual(destination.searchParams.getAll('filter'), ['a', 'b']);
  assert.equal(destination.searchParams.get('period'), '2026-09');
  console.log('Koperasi member integration passed: auth, validation, optimistic edits, status mirroring, audit, replay recovery, missing uid, concurrent unique linking, replacement/unlink, converted exclusion, bank sync, empty-bank skip, rules and 308 redirect.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
