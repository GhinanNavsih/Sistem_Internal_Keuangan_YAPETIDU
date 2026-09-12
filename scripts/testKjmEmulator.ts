/** Integration tests use demo-kjm emulators ONLY. Never run against real payroll. */
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { NextRequest } from 'next/server';

async function main() {
  if (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== 'demo-kjm' ||
      !/^(127\.0\.0\.1|localhost):8188$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') ||
      !/^(127\.0\.0\.1|localhost):9198$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || '')) {
    throw new Error('Refusing to run outside the demo-kjm Auth + Firestore emulators.');
  }
  const { adminDb } = await import('../src/lib/firebase-admin');
  const { POST, GET } = await import('../src/app/api/payroll/kjm/route');
  const signup = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }),
  });
  const identity = await signup.json();
  assert.ok(identity.idToken);
  const authorization = `Bearer ${identity.idToken}`;
  await adminDb.doc(`users/${identity.localId}`).set({ role: 'super_admin', displayName: 'KJM TEST' });
  await adminDb.doc('Employees_Loyalis/Loyalis_KjmTest').set({ personal_info: { name: 'KJM TEST', status: 'AKTIF', employee_id_niy: '01123' },
    loyalisType: 'Keluarga', isDosen: true, academic_and_tier: { education_level: 'S2-Sosial' }, employment_profile: { job_role: 'Dosen' } });
  await adminDb.doc('SalaryMatrix_ExcessAttendance/_config').set({ activeVersion: 'test' });
  const rateRef = adminDb.doc('SalaryMatrix_ExcessAttendance/test/rows/S2');
  await rateRef.set({ education_level: 'S2', rates: { Sosial: 20000 } });
  const periodRef = adminDb.doc('PayrollPeriods/2026-09');
  const slipRef = adminDb.doc('PayrollSlipStates/2026_09_Loyalis_KjmTest');
  const book = (attendance: number) => {
    const w = XLSX.utils.book_new();
    for (const [i, name] of ['Kontrak Asli', 'Tetap Asli'].entries()) XLSX.utils.book_append_sheet(w, XLSX.utils.aoa_to_sheet([
      ['Program Studi PAI'], ['#', 'Kode MK', 'Nama Mata Kuliah', 'SKS', 'Kelas', 'Hadir'], ['01123-KJM TEST'], [1, `MK${i}`, 'Course', 3, 'A', attendance],
    ]), name);
    return XLSX.write(w, { type: 'buffer', bookType: 'xlsx' });
  };
  const upload = async (attendance = 16, period = '2026-09') => {
    const form = new FormData(); form.set('period', period); form.set('semester', '20251');
    form.set('file', new File([book(attendance)], 'test.xlsx'));
    return POST(new NextRequest('http://localhost/api/payroll/kjm', { method: 'POST', headers: { authorization }, body: form }));
  };
  const command = (body: unknown) => POST(new NextRequest('http://localhost/api/payroll/kjm', { method: 'POST', headers: { authorization, 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  const load = async (id: string) => {
    const response = await GET(new NextRequest(`http://localhost/api/payroll/kjm?period=2026-09&id=${id}`, { headers: { authorization } }));
    assert.equal(response.status, 200); return (await response.json()).draft;
  };
  const unauth = await GET(new NextRequest('http://localhost/api/payroll/kjm?period=2026-09'));
  assert.equal(unauth.status, 401);
  await periodRef.set({ attendanceStatus: 'closed' });
  assert.equal((await upload()).status, 409);
  await periodRef.set({ attendanceStatus: 'open' });
  const imported = await upload(); assert.equal(imported.status, 201, JSON.stringify(await imported.clone().json()));
  const { id } = await imported.json();
  assert.equal((await adminDb.collection('VakasiTambahan').get()).size, 0, 'upload must not create payroll earnings');
  assert.equal((await upload(16, '2026-10')).status, 409, 'same source cannot be reuploaded into another month');
  const disposable = await upload(17);
  assert.equal(disposable.status, 201);
  const disposableId = (await disposable.json()).id;
  const disposableDraft = await load(disposableId);
  assert.equal((await command({ action: 'delete', id: disposableId, revision: disposableDraft.revision })).status, 200, 'draft import can be deleted');
  assert.equal((await adminDb.doc(`KjmImports/${disposableId}`).get()).exists, false);
  let draft = await load(id);
  assert.equal((await command({ action: 'approve', id, revision: draft.revision, reviewHash: draft.reviewHash, confirmed: true })).status, 409, 'unreviewed source is blocked');
  const edits = { ...draft.edits, consortiumReviewed: true, courses: Object.fromEntries(draft.courses.map((course: { id: string }) => [course.id, { consortium: false }])) };
  assert.equal((await command({ action: 'save', id, revision: draft.revision, edits })).status, 200);
  assert.equal((await adminDb.collection('VakasiTambahan').get()).size, 0, 'saving review must not pay');
  draft = await load(id);
  const approve = () => command({ action: 'approve', id, revision: draft.revision, reviewHash: draft.reviewHash, confirmed: true });
  await rateRef.update({ 'rates.Sosial': 21000 });
  assert.equal((await approve()).status, 409, 'changed rate needs a new review');
  await command({ action: 'save', id, revision: draft.revision, edits }); draft = await load(id);
  await slipRef.set({ status: 'locked' });
  assert.equal((await approve()).status, 409, 'locked slip blocks approval');
  await slipRef.delete();
  await slipRef.set({ status: 'draft', revision: 1, earnings: [{ label: 'Gaji Pokok', amount: 5000000 }], deductions: [], taxes: [] });
  const approvals = await Promise.all([approve(), approve()]);
  for (const response of approvals) assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const eventRef = adminDb.doc(`VakasiTambahan/KJM_${id}`);
  assert.equal((await eventRef.get()).data()?.totalPayout, 1764000);
  assert.deepEqual((await slipRef.get()).data()?.earnings, [{ label: 'Gaji Pokok', amount: 5000000 }, { label: 'Kelebihan Jam Mengajar 20251', amount: 1764000 }], 'approval atomically updates an existing draft slip');
  assert.equal((await adminDb.collection('VakasiTambahan').get()).size, 1, 'concurrent approvals are idempotent');
  assert.equal((await adminDb.collection('KjmPaymentClaims').get()).size, 1);
  const approved = await load(id);
  assert.equal((await command({ action: 'delete', id, revision: approved.revision })).status, 409, 'approved import cannot be deleted');
  assert.equal((await command({ action: 'save', id, revision: draft.revision, edits })).status, 409, 'stale revision blocked');
  const second = await upload(15); assert.equal(second.status, 201);
  const secondId = (await second.json()).id;
  let other = await load(secondId);
  const otherEdits = { ...other.edits, consortiumReviewed: true, courses: Object.fromEntries(other.courses.map((course: { id: string }) => [course.id, { consortium: false }])) };
  await command({ action: 'save', id: secondId, revision: other.revision, edits: otherEdits }); other = await load(secondId);
  assert.equal((await command({ action: 'approve', id: secondId, revision: other.revision, reviewHash: other.reviewHash, confirmed: true })).status, 409, 'same semester employee cannot be paid from a second source');
  // Exercise deployed-rules shape with an authenticated client, not Admin SDK.
  const directWrite = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/demo-kjm/databases/(default)/documents/VakasiTambahan/KJM_${id}?updateMask.fieldPaths=totalPayout`, {
    method: 'PATCH', headers: { authorization, 'content-type': 'application/json' }, body: JSON.stringify({ fields: { totalPayout: { integerValue: '999' } } }),
  });
  assert.equal(directWrite.status, 403, 'even an admin client cannot bypass KJM approval');
  draft = await load(id);
  await slipRef.update({ status: 'paid' });
  assert.equal((await command({ action: 'revoke', id, revision: draft.revision })).status, 409);
  await slipRef.update({ status: 'draft' });
  assert.equal((await command({ action: 'revoke', id, revision: draft.revision })).status, 200);
  assert.equal((await eventRef.get()).data()?.status, 'voided');
  assert.deepEqual((await slipRef.get()).data()?.earnings, [{ label: 'Gaji Pokok', amount: 5000000 }], 'revocation removes only the KJM earning');
  assert.equal((await adminDb.collection('KjmPaymentClaims').get()).size, 0);
  const revoked = await load(id);
  assert.equal((await command({ action: 'delete', id, revision: revoked.revision })).status, 200, 'revoked draft can be deleted');
  assert.equal((await adminDb.doc(`KjmImports/${id}`).get()).exists, false);
  assert.equal((await eventRef.get()).exists, false);
  await adminDb.doc(`users/${identity.localId}`).update({ role: 'finance_verifier' });
  assert.equal((await GET(new NextRequest('http://localhost/api/payroll/kjm?period=2026-09', { headers: { authorization } }))).status, 403);
  console.log('KJM emulator integration passed: upload/save/delete unpaid drafts, auth/rules, stale master/revision, locked/paid slips, idempotency, duplicate semester claims, approval and revocation.');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
