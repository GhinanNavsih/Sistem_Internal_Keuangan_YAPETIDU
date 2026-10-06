/** Category-transfer integration against demo Auth and Firestore emulators only. */
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

const PROJECT = 'demo-category-transfer';
const FIXED_OCTOBER_FIRST = '2026-10-01T03:00:00.000Z';
const FIXED_OCTOBER_SIXTH = '2026-10-06T03:00:00.000Z';

async function signUp(email: string) {
  const response = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'password123', returnSecureToken: true }),
    },
  );
  const identity = await response.json();
  assert.ok(identity.idToken, JSON.stringify(identity));
  return { uid: identity.localId as string, authorization: `Bearer ${identity.idToken}` };
}

async function clientPatchCategory(authorization: string) {
  return fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/Employees_BlueCollar/BC_061?updateMask.fieldPaths=employment.jobCategory`,
    {
      method: 'PATCH',
      headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify({
        fields: {
          employment: {
            mapValue: { fields: { jobCategory: { stringValue: 'TEKNISI' } } },
          },
        },
      }),
    },
  );
}

async function main() {
  if (
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== PROJECT ||
    !/^(127\.0\.0\.1|localhost):8188$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') ||
    !/^(127\.0\.0\.1|localhost):9198$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || '')
  ) {
    throw new Error('Refusing to run outside the demo category-transfer emulators.');
  }

  const { adminAuth, adminDb } = await import('../src/lib/firebase-admin');
  const { POST } = await import('../src/app/api/admin/employee-category-transfers/route');
  const administrator = await signUp('category-admin@example.test');
  const worker = await signUp('category-worker@example.test');
  await adminDb.doc(`users/${administrator.uid}`).set({ role: 'super_admin' });
  await adminDb.doc(`users/${worker.uid}`).set({
    role: 'honorer',
    linkedEmployeeId: 'BC_061',
    permittedCategories: ['SATPAM'],
  });
  const roster = ['BC_061', ...Array.from({ length: 8 }, (_, index) => `BC_${String(index + 100).padStart(3, '0')}`)];
  await adminDb.doc('SatpamShiftTeams/team_3').set({
    ketuaShiftId: 'BC_099',
    memberEmployeeIds: roster,
  });
  await adminDb.doc('Employees_BlueCollar/BC_061').set({
    name: 'Sugeng test',
    employment: { status: 'active', jobCategory: 'SATPAM', startDate: '2024-11-01' },
    flags: { isActive: true, isPayrollEligible: true },
  });
  await adminDb.doc('Employees_BlueCollar/BC_010').set({
    name: 'Replacement test',
    employment: { status: 'active', jobCategory: 'SATPAM', startDate: '2024-11-01' },
    flags: { isActive: true, isPayrollEligible: true },
  });
  await adminDb.doc('ActivityReports/sep-spj').set({
    employeeId: 'BC_061', period: '2026-09', jobCategory: 'SATPAM',
    reportKind: 'satpam_spj', status: 'approved', approvedAmount: 242_500,
  });
  await adminDb.doc('ActivityReports/sep-self').set({
    employeeId: 'BC_061', period: '2026-09', jobCategory: 'SATPAM',
    reportKind: 'satpam_shift_assignment', shiftType: 'Lembur Sendiri', status: 'approved', approvedAmount: 30_000,
  });
  await adminDb.doc('ActivityReports/sep-cover').set({
    employeeId: 'BC_061', period: '2026-09', jobCategory: 'SATPAM',
    reportKind: 'satpam_shift_assignment', shiftType: 'Lembur Cover', status: 'approved', approvedAmount: 50_000,
  });

  const request = (
    requestId: string,
    replacementEmployeeId?: string,
    effectiveFrom = '2026-10-01',
    employeeId = 'BC_061',
  ) => POST(new NextRequest(
    'http://localhost/api/admin/employee-category-transfers',
    {
      method: 'POST',
      headers: { authorization: administrator.authorization, 'content-type': 'application/json' },
      body: JSON.stringify({
        employeeId, fromCategory: 'SATPAM', toCategory: 'KEBERSIHAN',
        effectiveFrom, replacementEmployeeId, requestId,
      }),
    },
  ));

  const OriginalDate = Date;
  const originalVerifyIdToken = adminAuth.verifyIdToken;
  // The Auth emulator issued a real-clock token. Avoid making that token
  // appear expired while the server clock is fixed to a test date.
  const withClock = async (fixedIso: string, run: () => Promise<void>) => {
    adminAuth.verifyIdToken = async () => ({ uid: administrator.uid } as
      Awaited<ReturnType<typeof adminAuth.verifyIdToken>>);
    globalThis.Date = new Proxy(OriginalDate, {
      construct(target, args) {
        return Reflect.construct(target, args.length ? args : [fixedIso]);
      },
      get(target, property) {
        if (property === 'now') return () => OriginalDate.parse(fixedIso);
        return Reflect.get(target, property);
      },
    }) as DateConstructor;
    try {
      await run();
    } finally {
      globalThis.Date = OriginalDate;
      adminAuth.verifyIdToken = originalVerifyIdToken;
    }
  };
  await withClock(FIXED_OCTOBER_FIRST, async () => {
    // Only a 1st is accepted, and never one before the current Jakarta month.
    assert.equal((await request('transfer-mid-month', 'BC_010', '2026-10-15')).status, 409);
    assert.equal((await request('transfer-past-month', 'BC_010', '2026-09-01')).status, 409);
    assert.equal((await request('transfer-no-replacement')).status, 409);
    await adminDb.doc('ActivityReports/oct-old-category').set({
      employeeId: 'BC_061', period: '2026-10', jobCategory: 'SATPAM', status: 'pending',
    });
    assert.equal((await request('transfer-conflicting-report', 'BC_010')).status, 409);
    await adminDb.doc('ActivityReports/oct-old-category').delete();

    const response = await request('transfer-valid-001', 'BC_010');
    assert.equal(response.status, 200, await response.text());
    const repeat = await request('transfer-valid-001', 'BC_010');
    assert.equal(repeat.status, 200);
    assert.equal((await repeat.json()).idempotent, true);
  });

  const [employee, team, linkedUser, septemberReports, audit] = await Promise.all([
    adminDb.doc('Employees_BlueCollar/BC_061').get(),
    adminDb.doc('SatpamShiftTeams/team_3').get(),
    adminDb.doc(`users/${worker.uid}`).get(),
    adminDb.collection('ActivityReports').where('period', '==', '2026-09').get(),
    adminDb.collection('FinancialAuditLogs').where('action', '==', 'employee_category_transfer').get(),
  ]);
  assert.equal(employee.data()?.employment.jobCategory, 'KEBERSIHAN');
  assert.deepEqual(employee.data()?.employment.jobCategoryHistory, [
    { category: 'SATPAM', effectiveFrom: '2024-11-01' },
    { category: 'KEBERSIHAN', effectiveFrom: '2026-10-01' },
  ]);
  assert.deepEqual(team.data()?.memberEmployeeIds, roster.map((id) => id === 'BC_061' ? 'BC_010' : id));
  assert.deepEqual(linkedUser.data()?.permittedCategories, ['KEBERSIHAN']);
  assert.equal(septemberReports.size, 3);
  assert.equal(septemberReports.docs.reduce((sum, doc) => sum + Number(doc.data().approvedAmount || 0), 0), 322_500);
  assert.equal(audit.size, 1);
  assert.equal((await clientPatchCategory(administrator.authorization)).status, 403);
  const ordinaryEdit = await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/Employees_BlueCollar/BC_061?updateMask.fieldPaths=name`,
    {
      method: 'PATCH',
      headers: { authorization: administrator.authorization, 'content-type': 'application/json' },
      body: JSON.stringify({ fields: { name: { stringValue: 'Sugeng profile edit' } } }),
    },
  );
  assert.equal(ordinaryEdit.status, 200, await ordinaryEdit.text());
  // Backdating to the 1st of the current month, and scheduling a future 1st,
  // for Satpam who are in no shift team.
  for (const id of ['BC_070', 'BC_071']) {
    await adminDb.doc(`Employees_BlueCollar/${id}`).set({
      name: `${id} test`,
      employment: { status: 'active', jobCategory: 'SATPAM', startDate: '2024-11-01' },
      flags: { isActive: true, isPayrollEligible: true },
    });
  }
  await withClock(FIXED_OCTOBER_SIXTH, async () => {
    const backdated = await request('transfer-backdate', undefined, '2026-10-01', 'BC_070');
    assert.equal(backdated.status, 200, await backdated.text());
    const future = await request('transfer-future', undefined, '2026-11-01', 'BC_071');
    assert.equal(future.status, 200, await future.text());
    assert.equal((await request('transfer-future-mid', undefined, '2026-11-15', 'BC_071')).status, 409);
  });
  const [backdatedEmployee, futureEmployee] = await Promise.all([
    adminDb.doc('Employees_BlueCollar/BC_070').get(),
    adminDb.doc('Employees_BlueCollar/BC_071').get(),
  ]);
  const { jobCategoryForPayrollPeriod } = await import('../src/lib/payroll/blueCollarCategory');
  assert.equal(jobCategoryForPayrollPeriod(backdatedEmployee.data()!, '2026-09'), 'SATPAM');
  assert.equal(jobCategoryForPayrollPeriod(backdatedEmployee.data()!, '2026-10'), 'KEBERSIHAN');
  assert.equal(jobCategoryForPayrollPeriod(futureEmployee.data()!, '2026-10'), 'SATPAM');
  assert.equal(jobCategoryForPayrollPeriod(futureEmployee.data()!, '2026-11'), 'KEBERSIHAN');
  console.log('Category transfer emulator passed: date gate (1st only, no past months, backdate to this month, future 1st), replacement, target-period conflict, history, September earnings, idempotency, audit, and direct-write rule.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
