/** Family allowance requests against Auth, Firestore and Storage emulators only. */
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

const PROJECT = 'demo-family-allowance';

async function signUp(email: string) {
  const response = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`,
    { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'password123', returnSecureToken: true }) },
  );
  const identity = await response.json();
  assert.ok(identity.idToken, JSON.stringify(identity));
  return { uid: identity.localId as string, authorization: `Bearer ${identity.idToken}` };
}

async function main() {
  if (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== PROJECT ||
    !/^(127\.0\.0\.1|localhost):8188$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') ||
    !/^(127\.0\.0\.1|localhost):9198$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || '') ||
    !/^(127\.0\.0\.1|localhost):9298$/.test(process.env.FIREBASE_STORAGE_EMULATOR_HOST || '')) {
    throw new Error(`Refusing to run outside the ${PROJECT} emulators.`);
  }
  const { adminDb, adminStorage } = await import('../src/lib/firebase-admin');
  const employeeApi = await import('../src/app/api/employee/family-allowance/route');
  const reviewApi = await import('../src/app/api/payroll/family-allowance/review/route');
  const { dependentChildren } = await import('../src/lib/payroll/familyAllowance');
  const today = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const loyalis = await signUp('loyalis@example.test');
  const other = await signUp('other@example.test');
  const admin = await signUp('admin@example.test');
  await adminDb.doc(`users/${loyalis.uid}`).set({ role: 'loyalis', displayName: 'Loyalis A', linkedEmployeeId: 'Loyalis_901' });
  await adminDb.doc(`users/${other.uid}`).set({ role: 'loyalis', displayName: 'Loyalis B', linkedEmployeeId: 'Loyalis_902' });
  await adminDb.doc(`users/${admin.uid}`).set({ role: 'loyalis_admin', displayName: 'Admin Loyalis' });
  await adminDb.doc('Employees_Loyalis/Loyalis_901').set({
    personal_info: { name: 'Loyalis A', status: 'AKTIF' },
    academic_and_tier: { level_code: 'A' },
    employment_profile: { date_of_hire: '2020-01-01' },
    family_allowance_metrics: { spouse_count: 1, children_sd: 1 },
  });
  await adminDb.doc('Employees_Loyalis/Loyalis_902').set({
    personal_info: { name: 'Loyalis B', status: 'AKTIF' },
    family_allowance_metrics: { spouse_count: 0, children_sd: 0 },
  });
  const period = today.slice(0, 7);
  const slipId = `${period.replace('-', '_')}_Loyalis_901`;
  await adminDb.doc('SalaryMatrix_WhiteCollar/2026_v1/rows/zero').set({ tahun: 0, salaries: { A: 4_000_000 } });
  await adminDb.doc(`PayrollPeriods/${period}`).set({ attendanceStatus: 'open' });
  await adminDb.doc(`PayrollSlipStates/${slipId}`).set({
    employeeId: 'Loyalis_901', period: period.replace('-', '_'), status: 'draft', revision: 1,
    earnings: [{ label: 'Gaji Pokok', amount: 4_000_000 }, { label: 'T. Keluarga', amount: 400_000 }],
    deductions: [], taxes: [],
  });

  const submit = (authorization: string, requestId: string, targetChildId: string, level: string) => {
    const form = new FormData();
    form.set('requestId', requestId);
    form.set('targetChildId', targetChildId);
    form.set('level', level);
    form.set('enrolledAt', today);
    form.set('file', new File([Buffer.from('emulator-proof')], 'enrollment.jpg', { type: 'image/jpeg' }));
    return employeeApi.POST(new NextRequest('http://localhost/api/employee/family-allowance', {
      method: 'POST', headers: { authorization }, body: form,
    }));
  };
  const review = (authorization: string, body: Record<string, unknown>) =>
    reviewApi.POST(new NextRequest('http://localhost/api/payroll/family-allowance/review', {
      method: 'POST', headers: { authorization, 'content-type': 'application/json' }, body: JSON.stringify(body),
    }));

  assert.equal((await submit(admin.authorization, 'family_request_admin_001', 'new', 'SD')).status, 403);
  assert.equal((await submit(other.authorization, 'family_request_other_001', 'legacy-SD-1', 'SLTP')).status, 409);

  let response = await submit(loyalis.authorization, 'family_request_0001', 'legacy-SD-1', 'SLTP');
  assert.equal(response.status, 201, JSON.stringify(await response.json()));
  response = await submit(loyalis.authorization, 'family_request_0001', 'legacy-SD-1', 'SLTP');
  assert.equal(response.status, 200, 'retry is idempotent');
  assert.equal((await response.json()).idempotent, true);
  response = await submit(loyalis.authorization, 'family_request_duplicate_001', 'legacy-SD-1', 'SLTP');
  assert.equal(response.status, 409, 'the same child cannot have two pending requests');
  assert.equal((await adminDb.doc('Employees_Loyalis/Loyalis_901').get()).data()?.family_allowance_metrics.children_sd, 1,
    'submission does not change T. Keluarga');
  assert.equal((await adminDb.doc(`PayrollSlipStates/${slipId}`).get()).data()?.earnings[1].amount, 400_000);
  const pending = (await adminDb.doc('FamilyAllowanceRequests/family_request_0001').get()).data()!;
  assert.equal(pending.status, 'pending');
  assert.equal((await adminStorage.bucket().file(pending.proofPath).exists())[0], true);

  response = await reviewApi.GET(new NextRequest('http://localhost/api/payroll/family-allowance/review', {
    headers: { authorization: admin.authorization },
  }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).requests.length, 1);
  response = await reviewApi.GET(new NextRequest('http://localhost/api/payroll/family-allowance/review', {
    headers: { authorization: loyalis.authorization },
  }));
  assert.equal(response.status, 403);

  const approval = {
    familyRequestId: 'family_request_0001', decisionId: 'family_decision_0001',
    action: 'approve', expectedRevision: 1, targetChildId: 'legacy-SD-1',
  };
  response = await review(admin.authorization, approval);
  const approvalResult = await response.json();
  assert.equal(response.status, 200, JSON.stringify(approvalResult));
  assert.equal(approvalResult.propagation?.ok, true, JSON.stringify(approvalResult));
  let profile = (await adminDb.doc('Employees_Loyalis/Loyalis_901').get()).data()!;
  assert.equal(dependentChildren(profile.family_allowance_metrics).length, 1);
  assert.equal(profile.family_allowance_metrics.dependents.length, 2, 'legacy school stage remains in history');
  assert.equal(profile.family_allowance_metrics.children_sd, 0);
  assert.equal(profile.family_allowance_metrics.children_sltp, 1);
  const slip = (await adminDb.doc(`PayrollSlipStates/${slipId}`).get()).data()!;
  assert.equal(slip.earnings.find((field: { label: string }) => field.label === 'T. Keluarga')?.amount, 500_000,
    'approval itself updates the draft family earning');
  response = await review(admin.authorization, approval);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).idempotent, true);
  response = await review(admin.authorization, { ...approval, decisionId: 'family_decision_0002' });
  assert.equal(response.status, 409, 'a second decision cannot apply twice');
  const ownHistory = await employeeApi.GET(new NextRequest('http://localhost/api/employee/family-allowance', {
    headers: { authorization: loyalis.authorization },
  }));
  assert.equal((await ownHistory.json()).requests[0].status, 'approved');
  const otherHistory = await employeeApi.GET(new NextRequest('http://localhost/api/employee/family-allowance', {
    headers: { authorization: other.authorization },
  }));
  assert.equal((await otherHistory.json()).requests.length, 0, 'employees only see their own requests');

  response = await submit(loyalis.authorization, 'family_request_0002', 'new', 'S1');
  assert.equal(response.status, 201);
  response = await review(admin.authorization, {
    familyRequestId: 'family_request_0002', decisionId: 'family_decision_0003',
    action: 'reject', expectedRevision: 1, reason: 'Bukti tidak menunjukkan pendaftaran aktif.',
  });
  assert.equal(response.status, 200);
  profile = (await adminDb.doc('Employees_Loyalis/Loyalis_901').get()).data()!;
  assert.equal(dependentChildren(profile.family_allowance_metrics).length, 1, 'rejection does not add a child');
  response = await submit(loyalis.authorization, 'family_request_0003', 'new', 'SD');
  assert.equal(response.status, 201);
  response = await employeeApi.DELETE(new NextRequest(
    'http://localhost/api/employee/family-allowance?requestId=family_request_0003',
    { method: 'DELETE', headers: { authorization: loyalis.authorization } },
  ));
  assert.equal(response.status, 200);
  assert.equal((await adminDb.doc('FamilyAllowanceRequests/family_request_0003').get()).data()?.status, 'withdrawn');
  console.log('Family allowance request emulator: ownership, proof, approval, rejection, idempotency and withdrawal passed.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
