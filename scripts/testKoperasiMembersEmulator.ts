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
  const { PATCH, DELETE } = await import('../src/app/api/admin/koperasi-members/route');
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
    assert.equal((await invoke(DELETE, { memberId: 'member-1' }, actor.authorization, 'DELETE')).status, 403);
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

  // Test member deletion: rejection with active loan, unlink from employee, and deletion with audit log
  const toDelete = koperasi.doc('users/member-delete-test');
  await toDelete.set({ ...base, uid: 'uid-delete-test' });
  const deleteEmployee = adminDb.doc('Employees_Loyalis/Loyalis_Delete_Test');
  await deleteEmployee.set({ personal_info: { status: 'AKTIF' }, koperasiUserId: 'member-delete-test', koperasiAuthUid: 'uid-delete-test' });

  // 1. Rejects deletion when active loan exists (409)
  const activeLoan = koperasi.doc('simpanPinjam/loan-delete-test');
  await activeLoan.set({ userId: 'member-delete-test', status: 'Disetujui dan Aktif', sisaHutang: 500000 });
  assert.equal((await invoke(DELETE, { memberId: 'member-delete-test', requestId: key() }, superAdmin.authorization, 'DELETE')).status, 409);

  // 2. Allows deletion when loan is settled / Lunas
  await activeLoan.set({ userId: 'member-delete-test', status: 'Lunas', sisaHutang: 0 });
  const deleteRequestId = key();
  const deleteResult = await succeeds(await invoke(DELETE, { memberId: 'member-delete-test', requestId: deleteRequestId }, superAdmin.authorization, 'DELETE'));
  assert.equal(deleteResult.deleted, true);

  // Check user doc is deleted from Koperasi
  assert.equal((await toDelete.get()).exists, false);

  // Check unlinked from SAKU employee
  const employeeAfterDelete = (await deleteEmployee.get()).data()!;
  assert.equal(employeeAfterDelete.koperasiUserId, null);
  assert.equal(employeeAfterDelete.koperasiAuthUid, null);

  // Check audit log recorded
  const deleteAudits = await adminDb.collection('FinancialAuditLogs').where('action', '==', 'KOPERASI_MEMBER_DELETED').where('requestId', '==', deleteRequestId).get();
  assert.equal(deleteAudits.size, 1);
  assert.equal(deleteAudits.docs[0].data().entityId, 'member-delete-test');

  // Replay is idempotent
  assert.equal((await succeeds(await invoke(DELETE, { memberId: 'member-delete-test', requestId: deleteRequestId }, superAdmin.authorization, 'DELETE'))).deleted, true);

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

  // Super Admin declines a loan that has not been paid out yet.
  const { POST: decline } = await import('../src/app/api/admin/koperasi-loans/decline/route');
  const { KOPERASI_LOANS_COLLECTION } = await import('../src/lib/koperasi-admin');
  const loans = koperasi.collection(KOPERASI_LOANS_COLLECTION);
  const declineAudits = (loanId: string) => adminDb.collection('FinancialAuditLogs')
    .where('action', '==', 'KOPERASI_LOAN_DECLINED').where('entityId', '==', loanId).get();
  for (const [index, status] of ['Menunggu Persetujuan BAK', 'Menunggu Persetujuan Wakil Rektor 2', 'Menunggu Transfer BAK'].entries()) {
    const loanId = `decline-${index}`;
    await loans.doc(loanId).set({ userId: 'uid-1', status, jumlahPinjaman: 2000000, tenor: 6, history: [{ status, notes: 'Pengajuan pinjaman baru' }] });
    const body = { loanId, expectedStatus: status, reason: 'Dokumen tidak lengkap', requestId: key() };
    for (const actor of [worker, finance, loyalisAdmin]) {
      assert.equal((await invoke(decline, body, actor.authorization)).status, 403);
    }
    assert.equal((await invoke(decline, { ...body, reason: '  ' })).status, 400, 'reason is required');
    const declined = await succeeds(await invoke(decline, body));
    assert.equal(declined.status, 'Ditolak BAK');
    assert.equal(declined.idempotent, false);
    const loan = (await loans.doc(loanId).get()).data()!;
    assert.equal(loan.status, 'Ditolak BAK');
    assert.equal(loan.alasanPenolakan, 'Dokumen tidak lengkap');
    const lastEntry = loan.history[loan.history.length - 1];
    assert.equal(lastEntry.status, 'Ditolak BAK');
    assert.equal(lastEntry.notes, 'Ditolak dengan alasan: Dokumen tidak lengkap');
    assert.equal(lastEntry.updatedBy, `internal-bak:${superAdmin.uid}`);
    assert.equal((await succeeds(await invoke(decline, body))).idempotent, true, 'replay of the same request');
    assert.equal((await declineAudits(loanId)).size, 1, 'one audit per decline');
    assert.equal((await invoke(decline, { ...body, requestId: key() })).status, 409, 'already declined');
  }

  await loans.doc('decline-active').set({ userId: 'uid-1', status: 'Disetujui dan Aktif', jumlahPinjaman: 2000000, tenor: 6 });
  assert.equal((await invoke(decline, { loanId: 'decline-active', expectedStatus: 'Disetujui dan Aktif', reason: 'x', requestId: key() })).status, 400, 'active is not declinable');
  assert.equal((await invoke(decline, { loanId: 'decline-active', expectedStatus: 'Menunggu Transfer BAK', reason: 'x', requestId: key() })).status, 409, 'stale expected status');
  assert.equal((await loans.doc('decline-active').get()).data()!.status, 'Disetujui dan Aktif');
  assert.equal((await invoke(decline, { loanId: 'decline-missing', expectedStatus: 'Menunggu Transfer BAK', reason: 'x', requestId: key() })).status, 404);

  // Declining a restructuring hands the old loan back its active status.
  await loans.doc('restructure-parent').set({ userId: 'uid-1', status: 'Menunggu Persetujuan Restrukturisasi', restructuredToLoanId: 'restructure-child', jumlahPinjaman: 3000000, tenor: 6, jumlahMenyicil: 2, history: [] });
  await loans.doc('restructure-child').set({ userId: 'uid-1', status: 'Menunggu Persetujuan Wakil Rektor 2', restructuredFromLoanId: 'restructure-parent', jumlahPinjaman: 4000000, tenor: 8, history: [] });
  const restructured = await succeeds(await invoke(decline, { loanId: 'restructure-child', expectedStatus: 'Menunggu Persetujuan Wakil Rektor 2', reason: 'Plafon penuh', requestId: key() }));
  assert.equal(restructured.parentReverted, true);
  const parentAfter = (await loans.doc('restructure-parent').get()).data()!;
  assert.equal(parentAfter.status, 'Disetujui dan Aktif');
  assert.equal(parentAfter.restructuredToLoanId, null);
  assert.equal(parentAfter.history[parentAfter.history.length - 1].status, 'Disetujui dan Aktif');
  assert.equal((await loans.doc('restructure-child').get()).data()!.status, 'Ditolak BAK');

  // Lost cross-project response: Koperasi applied, SAKU receipt still pending.
  await loans.doc('decline-lost').set({ userId: 'uid-1', status: 'Menunggu Transfer BAK', jumlahPinjaman: 2000000, tenor: 6, history: [] });
  const lostBody = { loanId: 'decline-lost', expectedStatus: 'Menunggu Transfer BAK', reason: 'Rekening salah', requestId: key() };
  const originalRunTransaction = adminDb.runTransaction.bind(adminDb);
  let declineTransactions = 0; // prepareOperation is call 1, finishOperation is call 2
  Object.defineProperty(adminDb, 'runTransaction', { configurable: true, writable: true, value: (...args: Parameters<typeof adminDb.runTransaction>) => {
    declineTransactions += 1;
    if (declineTransactions === 2) throw new Error('Injected SAKU audit outage after Koperasi decline');
    return originalRunTransaction(...args);
  } });
  try { assert.equal((await invoke(decline, lostBody)).status, 500); }
  finally { Object.defineProperty(adminDb, 'runTransaction', { configurable: true, writable: true, value: originalRunTransaction }); }
  assert.equal((await loans.doc('decline-lost').get()).data()!.status, 'Ditolak BAK');
  assert.equal((await declineAudits('decline-lost')).size, 0);
  const resumed = await succeeds(await invoke(decline, lostBody));
  assert.equal(resumed.idempotent, false);
  assert.equal((await declineAudits('decline-lost')).size, 1, 'resumed request finishes its audit once');
  const lostHistory = (await loans.doc('decline-lost').get()).data()!.history;
  assert.equal(lostHistory.filter((entry: { status: string }) => entry.status === 'Ditolak BAK').length, 1, 'no second history entry');

  // Direct employee enrollment uses the two projects and the Koperasi Auth namespace.
  const { POST: enroll, GET: previewEnrollment } = await import('../src/app/api/admin/koperasi-members/route');
  const { koperasiAdminAuth } = await import('../src/lib/koperasi-admin');
  await adminDb.doc('PayrollPeriods/2026-10').set({ attendanceStatus: 'closed' });
  await adminDb.doc('PayrollPeriods/2026-11').set({ attendanceStatus: 'open' });
  const enrollEmployee = async (id: string, collection = 'Employees_BlueCollar', extra = {}) => {
    await adminDb.doc(`${collection}/${id}`).set(collection === 'Employees_BlueCollar'
      ? { name: id, email: `${id.toLowerCase()}@example.test`, nik: `nik-${id}`, employment: { status: 'active' }, flags: { isActive: true }, bankAccount: { bankName: 'BRIS', accountNumber: '001-234' }, ...extra }
      : { personal_info: { name: id, email: `${id.toLowerCase()}@example.test`, nik: `nik-${id}`, status: 'AKTIF' }, banking_info: { bank_name: 'BSI', account_number: '00987' }, ...extra });
    return { employeeId: id, employeeCollection: collection, email: `${id.toLowerCase()}@example.test`, initialPassword: 'new-member-password', paymentStatus: 'Payroll Deduction', requestId: key() };
  };
  const newPekarya = await enrollEmployee('EnrollPekarya');
  for (const actor of [worker, finance, loyalisAdmin]) assert.equal((await invoke(enroll, newPekarya, actor.authorization)).status, 403);
  assert.equal((await invoke(enroll, newPekarya, '')).status, 401);
  assert.equal((await invoke(enroll, { ...newPekarya, initialPassword: 'short' })).status, 400);
  const enrolled = await succeeds(await invoke(enroll, newPekarya));
  assert.equal(enrolled.firstPayrollPeriod, '2026-11');
  const registered = (await koperasi.doc(`users/${enrolled.memberId}`).get()).data()!;
  assert.equal(registered.uid, enrolled.uid);
  assert.equal(registered.role, 'Member');
  assert.equal(registered.status, 'approved');
  assert.equal(registered.membershipStatus, 'approved');
  assert.equal(registered.nominalTabungan, 0);
  assert.equal(registered.iuranPokok, 250000);
  assert.equal(registered.iuranWajib, 25000);
  assert.equal(registered.payrollSavings.initialPaid, false);
  assert.match(registered.nomorAnggota, /^\d{5,}$/);
  assert.deepEqual(registered.bankDetails, { bank: 'BRIS', nomorRekening: '001234' });
  assert.equal((await koperasiAdminAuth().getUser(enrolled.uid)).email, newPekarya.email);
  assert.equal((await adminDb.doc('Employees_BlueCollar/EnrollPekarya').get()).data()!.koperasiAuthUid, enrolled.uid);
  assert.equal((await succeeds(await invoke(enroll, newPekarya))).idempotent, true);
  assert.equal((await succeeds(await invoke(enroll, { ...newPekarya, requestId: key() }))).idempotent, true);
  const receipt = await adminDb.doc(`FinancialIdempotencyKeys/${superAdmin.uid}__${newPekarya.requestId}`).get();
  assert.ok(!JSON.stringify(receipt.data()).includes(newPekarya.initialPassword), 'password never enters durable receipt');
  const enrollmentAudit = await adminDb.collection('FinancialAuditLogs').where('action', '==', 'KOPERASI_MEMBER_ENROLLED').where('entityId', '==', enrolled.memberId).get();
  assert.equal(enrollmentAudit.size, 1);
  assert.ok(!JSON.stringify(enrollmentAudit.docs[0].data()).includes(newPekarya.initialPassword));

  const subsidy = await enrollEmployee('EnrollLoyalis', 'Employees_Loyalis');
  const subsidyResult = await succeeds(await invoke(enroll, { ...subsidy, paymentStatus: 'Yayasan Subsidy' }));
  assert.equal((await koperasi.doc(`users/${subsidyResult.memberId}`).get()).data()!.paymentStatus, 'Yayasan Subsidy');
  assert.deepEqual((await koperasi.doc(`users/${subsidyResult.memberId}`).get()).data()!.bankDetails, { bank: 'BSI', nomorRekening: '00987' });

  // An existing account is explicitly selected and its role/password survive activation.
  const reuseBody = await enrollEmployee('EnrollExisting');
  const reuseIdentity = await koperasiAdminAuth().createUser({ uid: 'existing-auth', email: reuseBody.email, password: 'keep-existing-password' });
  const passwordHash = (await koperasiAdminAuth().getUser(reuseIdentity.uid)).passwordHash;
  await koperasi.doc('users/existing-member').set({ uid: reuseIdentity.uid, email: reuseBody.email, nama: 'EnrollExisting', role: 'BAK', membershipStatus: 'Pending', status: 'pending', iuranPokok: 300000, iuranWajib: 50000 });
  assert.equal((await invoke(enroll, reuseBody)).status, 409, 'existing account must be explicitly selected');
  const reused = await succeeds(await invoke(enroll, { ...reuseBody, existingMemberId: 'existing-member' }));
  assert.equal(reused.uid, reuseIdentity.uid);
  assert.equal((await koperasi.doc('users/existing-member').get()).data()!.role, 'BAK');
  assert.equal((await koperasi.doc('users/existing-member').get()).data()!.iuranWajib, 50000);
  assert.equal((await koperasiAdminAuth().getUser(reuseIdentity.uid)).passwordHash, passwordHash);

  const concurrentBody = await enrollEmployee('EnrollConcurrent');
  const concurrentEnrollment = await Promise.all([invoke(enroll, concurrentBody), invoke(enroll, { ...concurrentBody, requestId: key() })]);
  assert.ok(concurrentEnrollment.some(response => response.status === 200));
  assert.ok(concurrentEnrollment.every(response => [200, 409].includes(response.status)));
  assert.equal((await koperasi.collection('users').where('email', '==', concurrentBody.email).get()).size, 1);

  const lostEnrollment = await enrollEmployee('EnrollLost');
  let enrollmentTransactions = 0;
  Object.defineProperty(adminDb, 'runTransaction', { configurable: true, writable: true, value: (...args: Parameters<typeof adminDb.runTransaction>) => {
    enrollmentTransactions++;
    if (enrollmentTransactions === 4) throw new Error('Injected enrollment audit outage');
    return originalRunTransaction(...args);
  } });
  try { assert.equal((await invoke(enroll, lostEnrollment)).status, 500); }
  finally { Object.defineProperty(adminDb, 'runTransaction', { configurable: true, writable: true, value: originalRunTransaction }); }
  const beforeResume = await koperasi.collection('users').where('email', '==', lostEnrollment.email).get();
  const pendingClaim = await adminDb.doc('KoperasiEnrollments/Employees_BlueCollar__EnrollLost').get();
  const pendingMemberId = pendingClaim.data()!.intent.memberId;
  const pendingMember = (await koperasi.doc(`users/${pendingMemberId}`).get()).data()!;
  assert.equal((await invoke(PATCH, { memberId: pendingMemberId, expected: koperasiMemberSnapshot(pendingMember), input: { paymentStatus: 'Transfer', membershipStatus: 'approved', iuranPokok: 250000, iuranWajib: 25000, role: 'Member', note: '', confirmStaffRole: false }, requestId: key() }, undefined, 'PATCH')).status, 409, 'pending enrollment cannot be edited');

  assert.equal(beforeResume.size, 1);
  const numberBeforeResume = beforeResume.docs[0].data().nomorAnggota;
  const recoveredEnrollment = await succeeds(await invoke(enroll, lostEnrollment));
  assert.equal(recoveredEnrollment.memberId, beforeResume.docs[0].id);
  assert.equal((await koperasi.doc(`users/${recoveredEnrollment.memberId}`).get()).data()!.nomorAnggota, numberBeforeResume);
  assert.equal((await adminDb.doc('KoperasiEnrollments/Employees_BlueCollar__EnrollLost').get()).data()!.state, 'completed');

  // Migration preserves balances, marks the legacy initial fee settled and repairs a lost audit.
  await koperasi.doc('users/migration-legacy').set({ uid: 'migration-uid', role: 'Member', membershipStatus: 'approved', status: 'approved', paymentStatus: 'Payroll Deduction', nominalTabungan: 650000, iuranPokok: 250000, iuranWajib: 25000 });
  await adminDb.doc('Employees_BlueCollar/MigrationLegacy').set({ name: 'Migration Legacy', employment: { status: 'active' }, koperasiAuthUid: 'migration-uid', koperasiUserId: 'migration-legacy' });
  const { execFileSync } = await import('node:child_process');
  const migrate = (apply = false) => execFileSync(process.execPath, ['--import', 'tsx', 'scripts/migrateKoperasiPayrollSavings.ts', '--ids=migration-legacy', ...(apply ? ['--apply'] : [])], { cwd: process.cwd(), env: process.env, encoding: 'utf8' });
  assert.match(migrate(), /"candidates": 1/);
  assert.equal((await koperasi.doc('users/migration-legacy').get()).data()!.payrollSavings, undefined);
  migrate(true);
  const migrated = (await koperasi.doc('users/migration-legacy').get()).data()!;
  assert.equal(migrated.nominalTabungan, 650000);
  assert.equal(migrated.payrollSavings.initialPaid, true);
  assert.equal(migrated.payrollSavings.startPeriod, '2026-11');
  assert.equal((await adminDb.doc('KoperasiEnrollments/migration__2026-11').get()).data()!.state, 'completed');
  await adminDb.doc('KoperasiEnrollments/migration__2026-11').update({ state: 'pending' });
  assert.match(migrate(true), /"candidates": 0/);
  assert.equal((await adminDb.doc('KoperasiEnrollments/migration__2026-11').get()).data()!.state, 'completed', 'resume completes migration even after all policies were already written');
  const migrationAudits = await adminDb.collection('FinancialAuditLogs').where('action', '==', 'KOPERASI_SAVINGS_MIGRATED').get();
  assert.equal(migrationAudits.size, 1);
  await migrationAudits.docs[0].ref.delete();
  assert.match(migrate(true), /"auditRepairs": 1/);
  assert.equal((await adminDb.collection('FinancialAuditLogs').where('action', '==', 'KOPERASI_SAVINGS_MIGRATED').get()).size, 1);

  // A lock with uncertain external completion prevents identity replacement/deletion.
  const inFlight = adminDb.doc('PayrollKoperasiProgressions/2026_11_EnrollPekarya');
  await inFlight.set({ employeeId: 'EnrollPekarya', status: 'external_pending' });
  assert.equal((await invoke(link, { memberId: enrolled.memberId, action: 'unlink', employeeId: 'EnrollPekarya', employeeCollection: 'Employees_BlueCollar', expectedEmployeeId: 'EnrollPekarya', expectedEmployeeCollection: 'Employees_BlueCollar', requestId: key() })).status, 409);
  assert.equal((await invoke(DELETE, { memberId: enrolled.memberId, requestId: key() }, undefined, 'DELETE')).status, 409);
  await inFlight.delete();

  // Enrollment claims are released on deletion, so an employee can register again.
  await succeeds(await invoke(DELETE, { memberId: enrolled.memberId, requestId: key() }, undefined, 'DELETE'));
  assert.equal((await adminDb.doc('KoperasiEnrollments/Employees_BlueCollar__EnrollPekarya').get()).exists, false);
  const registeredAgain = await succeeds(await invoke(enroll, { ...newPekarya, requestId: key() }));
  assert.notEqual(registeredAgain.uid, enrolled.uid);

  const authOnlyBody = await enrollEmployee('EnrollAuthOnly');
  await koperasiAdminAuth().createUser({ uid: 'auth-only-user', email: authOnlyBody.email, password: 'unchanged-password' });
  const authOnlyCommand = { ...authOnlyBody, initialPassword: undefined };
  const authOnly = await succeeds(await invoke(enroll, authOnlyCommand));
  assert.equal(authOnly.uid, 'auth-only-user', 'Auth-only identities are reused without requiring a new password');

  const ambiguous = await enrollEmployee('EnrollAmbiguous');
  for (const memberId of ['ambiguous-one', 'ambiguous-two']) await koperasi.doc(`users/${memberId}`).set({ email: ambiguous.email, role: 'Member' });
  assert.equal((await invoke(enroll, ambiguous)).status, 409);
  assert.equal((await adminDb.doc('KoperasiEnrollments/Employees_BlueCollar__EnrollAmbiguous').get()).exists, false);

  // A previously subsidized new member's first fee moves to the current open month.
  await koperasi.doc(`users/${subsidyResult.memberId}`).update({ 'payrollSavings.initialPeriod': '2026-10' });
  const beforeSwitch = (await koperasi.doc(`users/${subsidyResult.memberId}`).get()).data()!;
  await succeeds(await invoke(PATCH, { memberId: subsidyResult.memberId, expected: koperasiMemberSnapshot(beforeSwitch), input: {
    paymentStatus: 'Payroll Deduction', membershipStatus: 'approved', iuranPokok: 250000, iuranWajib: 25000, role: 'Member', note: '', confirmStaffRole: false,
  }, requestId: key() }, undefined, 'PATCH'));
  assert.equal((await koperasi.doc(`users/${subsidyResult.memberId}`).get()).data()!.payrollSavings.initialPeriod, '2026-11');

  const inactiveBody = await enrollEmployee('EnrollInactive', 'Employees_BlueCollar', { employment: { status: 'inactive' } });
  assert.equal((await invoke(enroll, inactiveBody)).status, 409);
  await adminDb.doc('PayrollPeriods/2026-11').update({ attendanceStatus: 'closed' });
  const closedBody = await enrollEmployee('EnrollClosed');
  assert.equal((await invoke(enroll, closedBody)).status, 409);
  const context = await previewEnrollment(new NextRequest('http://localhost/api/admin/koperasi-members', { headers: { authorization: superAdmin.authorization } }));
  assert.equal(context.status, 409);
  console.log('Employee enrollment integration passed: Pekarya, Loyalis, subsidy, Auth creation/reuse, role and password preservation, permissions, concurrent uniqueness, lost-response recovery, one audit, bank mapping and closed periods.');

  console.log('Koperasi member integration passed: auth, validation, optimistic edits, status mirroring, audit, replay recovery, missing uid, concurrent unique linking, replacement/unlink, converted exclusion, bank sync, empty-bank skip, rules, 308 redirect and loan decline.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
