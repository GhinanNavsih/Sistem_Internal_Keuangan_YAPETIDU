import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

const projectId = 'demo-loyalis-retirement';

async function main() {
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
  if (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== projectId ||
      !/^(127\.0\.0\.1|localhost):9198$/.test(authHost ?? '') ||
      !/^(127\.0\.0\.1|localhost):8188$/.test(firestoreHost ?? '')) {
    throw new Error(`Run against the ${projectId} emulators only.`);
  }

  const { adminDb } = await import('../src/lib/firebase-admin');
  const { GET, PUT } = await import('../src/app/api/admin/loyalis-retirement/route');
  async function signUp(role: string) {
    const response = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `${role}@example.test`, password: 'password123', returnSecureToken: true }),
    });
    const { localId, idToken } = await response.json();
    assert.equal(response.status, 200);
    assert.ok(localId && idToken);
    await adminDb.doc(`users/${localId}`).set({ role });
    return { uid: localId, authorization: `Bearer ${idToken}` };
  }

  const [employeeAdmin, finance, loyalis] = await Promise.all([
    signUp('loyalis_admin'), signUp('finance_verifier'), signUp('loyalis'),
  ]);
  const employeeRef = adminDb.doc('Employees_Loyalis/Loyalis_901');
  const employee = { loyalisType: 'Admin', personal_info: { status: 'AKTIF' } };
  const payrollRef = adminDb.doc('PayrollSlipStates/2026_11_Loyalis_901');
  const payroll = { status: 'locked' };
  await Promise.all([employeeRef.set(employee), payrollRef.set(payroll)]);

  const url = 'http://localhost/api/admin/loyalis-retirement';
  const get = (authorization = '', employeeId?: string) => GET(new NextRequest(
    employeeId ? `${url}?employeeId=${encodeURIComponent(employeeId)}` : url,
    { headers: { authorization } },
  ));
  const confirm = (authorization: string, body: unknown) => PUT(new NextRequest(url, {
    method: 'PUT', headers: { authorization, 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
  const birthMonth = { employeeId: employeeRef.id, birthMonth: '1967-11' };

  assert.equal((await get()).status, 401);
  assert.equal((await get(loyalis.authorization)).status, 403);
  assert.equal((await confirm(loyalis.authorization, birthMonth)).status, 403);
  assert.deepEqual(await (await get(finance.authorization)).json(), { birthMonths: [] });
  assert.equal((await confirm(employeeAdmin.authorization, { ...birthMonth, birthMonth: '1967-13' })).status, 400);
  assert.equal((await confirm(employeeAdmin.authorization, { ...birthMonth, birthMonth: '9999-01' })).status, 400);
  assert.equal((await confirm(employeeAdmin.authorization, { ...birthMonth, employeeId: 'Loyalis/missing' })).status, 400);
  assert.equal((await confirm(employeeAdmin.authorization, { ...birthMonth, employeeId: 'Unknown' })).status, 404);

  const saved = await confirm(employeeAdmin.authorization, birthMonth);
  assert.equal(saved.status, 200, await saved.clone().text());
  assert.deepEqual(await saved.json(), birthMonth);
  const privateRef = adminDb.doc(`LoyalisRetirementBirthMonths/${employeeRef.id}`);
  const stored = (await privateRef.get()).data();
  assert.equal(stored?.confirmedBy, employeeAdmin.uid);
  assert.ok(stored?.confirmedAt.toMillis() > 0);
  assert.deepEqual(await (await get(finance.authorization)).json(), { birthMonths: [birthMonth] });

  const directRead = await fetch(`http://${firestoreHost}/v1/projects/${projectId}/databases/(default)/documents/${privateRef.path}`, {
    headers: { authorization: employeeAdmin.authorization },
  });
  assert.equal(directRead.status, 403, 'confirmed birth months are API-only');

  const correction = { ...birthMonth, birthMonth: '1967-12' };
  assert.equal((await confirm(finance.authorization, correction)).status, 200);
  assert.deepEqual(await (await get(employeeAdmin.authorization)).json(), { birthMonths: [correction] });
  assert.deepEqual(await (await get(employeeAdmin.authorization, employeeRef.id)).json(), { birthMonth: '1967-12', birthDate: null });

  const birthDate = { employeeId: employeeRef.id, birthDate: '1968-02-29' };
  assert.equal((await confirm(loyalis.authorization, birthDate)).status, 403);
  assert.equal((await get(loyalis.authorization, employeeRef.id)).status, 403);
  assert.equal((await confirm(employeeAdmin.authorization, { ...birthDate, birthDate: '1967-02-29' })).status, 400);
  assert.equal((await confirm(employeeAdmin.authorization, { ...birthDate, birthDate: '9999-01-01' })).status, 400);
  assert.equal((await confirm(employeeAdmin.authorization, birthDate)).status, 200);
  assert.deepEqual(await (await get(finance.authorization, employeeRef.id)).json(), { birthMonth: '1968-02', birthDate: birthDate.birthDate });
  assert.deepEqual(await (await get(finance.authorization)).json(), { birthMonths: [{ employeeId: employeeRef.id, birthMonth: '1968-02' }] });
  assert.equal((await confirm(finance.authorization, { ...birthMonth, birthMonth: '1968-02' })).status, 200);
  assert.equal((await confirm(finance.authorization, correction)).status, 409);
  assert.equal((await privateRef.get()).get('birthDate'), birthDate.birthDate);

  assert.deepEqual((await employeeRef.get()).data(), employee);
  assert.deepEqual((await payrollRef.get()).data(), payroll);
  console.log('Loyalis retirement roles, private confirmation, correction, and read-only roster behavior passed.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
