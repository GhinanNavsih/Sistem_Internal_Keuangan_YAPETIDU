/** BanSos (Ajuan Duka / Melahirkan) against Auth, Firestore and Storage emulators only. */
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

const PROJECT = 'demo-bansos';
// A real JPEG header: the server decides the type by the bytes.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);

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
  const { adminDb } = await import('../src/lib/firebase-admin');
  const employeeApi = await import('../src/app/api/employee/bansos/route');
  const reviewApi = await import('../src/app/api/payroll/bansos/route');
  const vakasiApi = await import('../src/app/api/payroll/vakasi-events/route');
  const today = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const period = today.slice(0, 7);
  const dukaEvent = `VakasiTambahan/BANSOS_${period}_DUKA`;
  const birthEvent = `VakasiTambahan/BANSOS_${period}_MELAHIRKAN`;

  const loyalis = await signUp('loyalis@example.test');
  const otherLoyalis = await signUp('other@example.test');
  const honorer = await signUp('honorer@example.test');
  const employeeAdmin = await signUp('admin@example.test');
  const superAdmin = await signUp('super@example.test');
  const finance = await signUp('finance@example.test');
  await adminDb.doc(`users/${loyalis.uid}`).set({ role: 'loyalis', displayName: 'Ani', linkedEmployeeId: 'Loyalis_901' });
  await adminDb.doc(`users/${otherLoyalis.uid}`).set({ role: 'loyalis', displayName: 'Bayu', linkedEmployeeId: 'Loyalis_902' });
  await adminDb.doc(`users/${honorer.uid}`).set({ role: 'honorer', displayName: 'Cahyo', linkedEmployeeId: 'BC_901', permittedCategories: ['KEBERSIHAN'] });
  await adminDb.doc(`users/${employeeAdmin.uid}`).set({ role: 'loyalis_admin', displayName: 'Admin Karyawan' });
  await adminDb.doc(`users/${superAdmin.uid}`).set({ role: 'super_admin', displayName: 'Super Admin' });
  await adminDb.doc(`users/${finance.uid}`).set({ role: 'finance_verifier', displayName: 'Badan Keuangan' });
  await adminDb.doc('Employees_Loyalis/Loyalis_901').set({ personal_info: { name: 'Ani', status: 'AKTIF' } });
  await adminDb.doc('Employees_Loyalis/Loyalis_902').set({ personal_info: { name: 'Bayu', status: 'AKTIF' } });
  await adminDb.doc('Employees_BlueCollar/BC_901').set({ name: 'Cahyo', employment: { status: 'active', jobCategory: 'KEBERSIHAN' } });
  await adminDb.doc(`PayrollPeriods/${period}`).set({ attendanceStatus: 'open' });
  const slipPath = `PayrollSlipStates/${period.replace('-', '_')}_Loyalis_901`;
  await adminDb.doc(slipPath).set({
    employeeId: 'Loyalis_901', period: period.replace('-', '_'), status: 'draft', revision: 1,
    earnings: [{ label: 'Gaji Pokok', amount: 4_000_000 }], deductions: [], taxes: [],
  });

  const submit = (authorization: string, requestId: string, fields: Record<string, string>, bytes: Buffer | null = JPEG) => {
    const form = new FormData();
    form.set('requestId', requestId);
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    if (bytes) form.set('file', new File([new Uint8Array(bytes)], 'bukti.jpg', { type: 'image/jpeg' }));
    return employeeApi.POST(new NextRequest('http://localhost/api/employee/bansos', {
      method: 'POST', headers: { authorization }, body: form,
    }));
  };
  const ownList = async (authorization: string) =>
    (await employeeApi.GET(new NextRequest('http://localhost/api/employee/bansos', { headers: { authorization } })));
  const list = (authorization: string, query: string) =>
    reviewApi.GET(new NextRequest(`http://localhost/api/payroll/bansos?${query}`, { headers: { authorization } }));
  let decisionCounter = 0;
  const decide = async (authorization: string, bansosRequestId: string, action: string, extra: Record<string, unknown> = {}) => {
    const revision = Number((await adminDb.doc(`BansosRequests/${bansosRequestId}`).get()).data()?.revision || 1);
    decisionCounter += 1;
    return reviewApi.POST(new NextRequest('http://localhost/api/payroll/bansos', {
      method: 'POST', headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: `bansos_decision_${String(decisionCounter).padStart(4, '0')}`, bansosRequestId, action, expectedRevision: revision, ...extra }),
    }));
  };
  const expectStatus = async (response: Response, status: number, note = '') => {
    const body = await response.clone().json().catch(() => ({}));
    assert.equal(response.status, status, `${note} ${JSON.stringify(body)}`);
    return body;
  };
  const duka = { kind: 'duka', eventDate: today, relationship: 'ayah', subjectName: 'Pak Darmo' };

  // ── Submitting ──
  await expectStatus(await submit(employeeAdmin.authorization, 'bansos_req_admin_01', duka), 403, 'admins do not submit');
  await expectStatus(await submit(loyalis.authorization, 'bansos_req_noproof', duka, null), 400, 'proof is required');
  await expectStatus(await submit(loyalis.authorization, 'bansos_req_svg01', duka, Buffer.from('<svg></svg>')), 400, 'type comes from the bytes');
  await expectStatus(await submit(loyalis.authorization, 'bansos_req_norel', { kind: 'duka', eventDate: today, subjectName: 'X Y' }), 400);
  await expectStatus(await submit(loyalis.authorization, 'bansos_req_dukaA1', duka), 201);
  const replay = await expectStatus(await submit(loyalis.authorization, 'bansos_req_dukaA1', duka), 200, 'retry');
  assert.equal(replay.idempotent, true);
  await expectStatus(await submit(honorer.authorization, 'bansos_req_dukaC1', { ...duka, subjectName: 'Mbah Sri', relationship: 'ibu' }), 201);
  await expectStatus(await submit(honorer.authorization, 'bansos_req_dukaC2', { ...duka, subjectName: 'mbah  sri', relationship: 'ibu' }), 201);
  await expectStatus(await submit(loyalis.authorization, 'bansos_req_lahirA1', { kind: 'melahirkan', eventDate: today }), 201);

  const stored = (await adminDb.doc('BansosRequests/bansos_req_dukaA1').get()).data()!;
  assert.equal(stored.amount, 1_000_000, 'Loyalis Duka default');
  assert.equal(stored.period, period);
  assert.equal((await adminDb.doc('BansosRequests/bansos_req_dukaC1').get()).data()!.amount, 750_000, 'Pekarya Duka default');
  assert.equal((await adminDb.doc('BansosRequests/bansos_req_dukaC1').get()).data()!.jobCategory, 'KEBERSIHAN');
  assert.equal((await adminDb.doc('BansosRequests/bansos_req_lahirA1').get()).data()!.amount, 500_000, 'Melahirkan default');
  let event = (await adminDb.doc(dukaEvent).get()).data()!;
  assert.equal(event.eventName, 'Ajuan Duka');
  assert.equal(event.sourceKind, 'bansos');
  assert.equal(event.status, 'pending_review');
  assert.deepEqual(event.eventWorkers, {});
  assert.deepEqual(event.bansosCounts, { waiting: 3, paid: 0, rejected: 0 });
  assert.equal((await adminDb.doc(birthEvent).get()).data()!.eventName, 'Ajuan Melahirkan');

  const own = await expectStatus(await ownList(loyalis.authorization), 200);
  assert.deepEqual(own.requests.map((item: { id: string }) => item.id).sort(), ['bansos_req_dukaA1', 'bansos_req_lahirA1']);
  assert.equal(own.defaultAmounts.duka, 1_000_000);
  assert.equal((await expectStatus(await ownList(otherLoyalis.authorization), 200)).requests.length, 0, 'only your own ajuan');

  // ── Reading as reviewers ──
  await expectStatus(await list(honorer.authorization, 'tab=waiting'), 403);
  const waiting = await expectStatus(await list(employeeAdmin.authorization, 'tab=waiting'), 200);
  assert.equal(waiting.requests.length, 4);
  const dupes = waiting.requests.filter((item: { possibleDuplicate?: boolean }) => item.possibleDuplicate).map((item: { id: string }) => item.id).sort();
  assert.deepEqual(dupes, ['bansos_req_dukaC1', 'bansos_req_dukaC2'], 'same person, same date');
  const panel = await expectStatus(await list(finance.authorization, `period=${period}&kind=duka`), 200);
  assert.equal(panel.requests.length, 3, 'Badan Keuangan reads the panel');
  await expectStatus(await decide(finance.authorization, 'bansos_req_dukaA1', 'accept', { amount: 1 }), 403, 'Badan Keuangan cannot decide');

  // ── Admin Karyawan first, then Super Admin (with an edited amount) ──
  await expectStatus(await decide(employeeAdmin.authorization, 'bansos_req_dukaA1', 'accept', { amount: 5 }), 409, 'only Super Admin sets the amount');
  let body = await expectStatus(await decide(employeeAdmin.authorization, 'bansos_req_dukaA1', 'accept'), 200);
  assert.equal(body.status, 'awaiting_finance');
  assert.deepEqual((await adminDb.doc(dukaEvent).get()).data()!.eventWorkers, {}, 'not paid after one side');
  await expectStatus(await decide(employeeAdmin.authorization, 'bansos_req_dukaA1', 'accept'), 409, 'decided twice');
  const stale = await reviewApi.POST(new NextRequest('http://localhost/api/payroll/bansos', {
    method: 'POST', headers: { authorization: superAdmin.authorization, 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: 'bansos_decision_stale1', bansosRequestId: 'bansos_req_dukaA1', action: 'accept', amount: 1, expectedRevision: 1 }),
  }));
  await expectStatus(stale, 409, 'stale revision');
  body = await expectStatus(await decide(superAdmin.authorization, 'bansos_req_dukaA1', 'accept', { amount: 1_200_000 }), 200);
  assert.equal(body.status, 'paid');
  event = (await adminDb.doc(dukaEvent).get()).data()!;
  assert.equal(event.status, 'approved');
  assert.equal(event.eventWorkers.Loyalis_901.payGiven, 1_200_000);
  assert.equal(event.eventWorkers.Loyalis_901.employeeCollection, 'Employees_Loyalis');
  let slip = (await adminDb.doc(slipPath).get()).data()!;
  assert.deepEqual(slip.earnings.find((row: { label: string }) => row.label === 'Ajuan Duka'), { label: 'Ajuan Duka', amount: 1_200_000 }, 'paid on the draft slip');

  // ── Super Admin first, then Admin Karyawan: the Pekarya SPJ projection ──
  body = await expectStatus(await decide(superAdmin.authorization, 'bansos_req_dukaC1', 'accept', { amount: 750_000 }), 200);
  assert.equal(body.status, 'awaiting_admin');
  body = await expectStatus(await decide(employeeAdmin.authorization, 'bansos_req_dukaC1', 'accept'), 200);
  assert.equal(body.status, 'paid');
  const projection = (await adminDb.doc(`KegiatanSpj/VAKASI_PEKARYA__BANSOS_${period}_DUKA__KEBERSIHAN`).get()).data()!;
  assert.equal(projection.status, 'approved');
  assert.equal(projection.eventName, 'Ajuan Duka');
  assert.equal(projection.eventWorkers.BC_901.payGiven, 750_000);
  assert.deepEqual((await adminDb.doc(dukaEvent).get()).data()!.bansosCounts, { waiting: 1, paid: 2, rejected: 0 });

  // ── Rejection ends it for the other side; the employee cannot withdraw it ──
  await expectStatus(await decide(employeeAdmin.authorization, 'bansos_req_dukaC2', 'reject'), 409, 'reason required');
  body = await expectStatus(await decide(employeeAdmin.authorization, 'bansos_req_dukaC2', 'reject', { reason: 'Ajuan ganda' }), 200);
  assert.equal(body.status, 'rejected');
  await expectStatus(await decide(superAdmin.authorization, 'bansos_req_dukaC2', 'accept', { amount: 750_000 }), 409);
  await expectStatus(await employeeApi.DELETE(new NextRequest('http://localhost/api/employee/bansos?requestId=bansos_req_dukaC2', {
    method: 'DELETE', headers: { authorization: honorer.authorization },
  })), 409);
  assert.equal((await adminDb.doc(`KegiatanSpj/VAKASI_PEKARYA__BANSOS_${period}_DUKA__KEBERSIHAN`).get()).data()!.eventWorkers.BC_901.payGiven, 750_000, 'a rejected twin pays nothing');

  // ── Reset removes the payout; a locked slip blocks it ──
  body = await expectStatus(await decide(superAdmin.authorization, 'bansos_req_dukaA1', 'reset'), 200);
  assert.equal(body.status, 'awaiting_finance');
  assert.equal((await adminDb.doc(dukaEvent).get()).data()!.eventWorkers.Loyalis_901, undefined);
  slip = (await adminDb.doc(slipPath).get()).data()!;
  assert.equal(slip.earnings.some((row: { label: string; amount: number }) => row.label === 'Ajuan Duka' && row.amount > 0), false, 'removed from the slip');
  await expectStatus(await decide(superAdmin.authorization, 'bansos_req_dukaA1', 'accept', { amount: 1_000_000 }), 200);
  await adminDb.doc(slipPath).update({ status: 'locked' });
  await expectStatus(await decide(employeeAdmin.authorization, 'bansos_req_dukaA1', 'reset'), 409, 'locked slip');
  await adminDb.doc(slipPath).update({ status: 'draft' });

  // ── Withdraw ──
  await expectStatus(await submit(loyalis.authorization, 'bansos_req_lahirA2', { kind: 'melahirkan', eventDate: today, subjectName: 'Bayi' }), 201);
  const withdraw = () => employeeApi.DELETE(new NextRequest('http://localhost/api/employee/bansos?requestId=bansos_req_lahirA2', {
    method: 'DELETE', headers: { authorization: loyalis.authorization },
  }));
  assert.equal((await expectStatus(await withdraw(), 200)).status, 'withdrawn');
  assert.equal((await expectStatus(await withdraw(), 200)).status, 'withdrawn', 'withdrawing twice is harmless');
  await expectStatus(await decide(employeeAdmin.authorization, 'bansos_req_lahirA2', 'accept'), 409, 'withdrawn');
  await expectStatus(await employeeApi.DELETE(new NextRequest('http://localhost/api/employee/bansos?requestId=bansos_req_lahirA1', {
    method: 'DELETE', headers: { authorization: otherLoyalis.authorization },
  })), 404, 'not your ajuan');

  // ── A month that closed meanwhile pays in the current month ──
  await adminDb.doc('PayrollPeriods/2026-01').set({ attendanceStatus: 'closed' });
  await adminDb.doc('BansosRequests/bansos_req_lahirA1').update({ period: '2026-01' });
  await expectStatus(await decide(employeeAdmin.authorization, 'bansos_req_lahirA1', 'accept'), 200);
  body = await expectStatus(await decide(superAdmin.authorization, 'bansos_req_lahirA1', 'accept', { amount: 500_000 }), 200);
  assert.equal(body.paidPeriod, period);
  assert.equal((await adminDb.doc(birthEvent).get()).data()!.eventWorkers.Loyalis_901.payGiven, 500_000);
  const movedPanel = await expectStatus(await list(superAdmin.authorization, `period=${period}&kind=melahirkan`), 200);
  assert.ok(movedPanel.requests.some((item: { id: string }) => item.id === 'bansos_req_lahirA1'));

  // ── A regular Vakasi event still pays through the shared write helpers ──
  const vakasiCommand = (requestId: string, eventId: string | undefined, expectedRevision: number | undefined, workers: { employeeId: string; payGiven: number }[]) =>
    vakasiApi.POST(new NextRequest('http://localhost/api/payroll/vakasi-events', {
      method: 'POST', headers: { authorization: superAdmin.authorization, 'content-type': 'application/json' },
      body: JSON.stringify({
        requestId, action: 'save', eventId, expectedRevision, desiredStatus: 'approved',
        snapshot: { eventName: 'Rapat Kerja', period, isEndOfMonth: true, workers },
      }),
    }));
  const regular = await expectStatus(await vakasiCommand('vakasi_regular_save1', undefined, undefined, [
    { employeeId: 'Loyalis_902', payGiven: 300_000 }, { employeeId: 'BC_901', payGiven: 200_000 },
  ]), 201, 'regular Vakasi save');
  const regularProjection = `KegiatanSpj/VAKASI_PEKARYA__${regular.eventId}__KEBERSIHAN`;
  assert.equal((await adminDb.doc(regularProjection).get()).data()!.status, 'approved');
  assert.deepEqual((await adminDb.doc(`VakasiTambahan/${regular.eventId}`).get()).data()!.ownedEarningLabelsByEmployee, { Loyalis_902: ['Rapat Kerja'] });
  await expectStatus(await vakasiCommand('vakasi_regular_save2', regular.eventId, regular.revision, [
    { employeeId: 'Loyalis_902', payGiven: 300_000 },
  ]), 200, 'regular Vakasi edit');
  assert.equal((await adminDb.doc(regularProjection).get()).data()!.status, 'voided', 'a removed Pekarya projection is voided');
  await adminDb.doc(`PayrollSlipStates/${period.replace('-', '_')}_Loyalis_902`).set({ employeeId: 'Loyalis_902', status: 'locked' });
  await expectStatus(await vakasiCommand('vakasi_regular_save3', regular.eventId, regular.revision + 1, [
    { employeeId: 'Loyalis_902', payGiven: 400_000 },
  ]), 409, 'a locked slip still blocks a regular Vakasi change');

  // ── The generic Vakasi editor and browsers cannot touch BanSos ──
  const vakasiSave = await vakasiApi.POST(new NextRequest('http://localhost/api/payroll/vakasi-events', {
    method: 'POST', headers: { authorization: superAdmin.authorization, 'content-type': 'application/json' },
    body: JSON.stringify({
      requestId: 'vakasi_bansos_forge1', action: 'save', eventId: `BANSOS_${period}_DUKA`, expectedRevision: 1, desiredStatus: 'approved',
      snapshot: { eventName: 'Ajuan Duka', period, isEndOfMonth: true, workers: [{ employeeId: 'Loyalis_902', payGiven: 9_000_000 }] },
    }),
  }));
  await expectStatus(vakasiSave, 409, 'vakasi-events refuses BanSos events');
  const documents = `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${PROJECT}/databases/(default)/documents`;
  const clientPatch = (authorization: string, path: string) => fetch(`${documents}/${path}?updateMask.fieldPaths=totalPayout`, {
    method: 'PATCH', headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify({ fields: { totalPayout: { integerValue: '1' } } }),
  });
  assert.equal((await clientPatch(superAdmin.authorization, dukaEvent)).status, 403, 'browser cannot edit a BanSos event');
  assert.equal((await clientPatch(superAdmin.authorization, `VakasiTambahan/BANSOS_${period}_NEW`)).status, 403, 'nor create one');
  const clientRead = await fetch(`${documents}/BansosRequests/bansos_req_dukaA1`, { headers: { authorization: loyalis.authorization } });
  assert.equal(clientRead.status, 403, 'BansosRequests are server-only');

  const audits = await adminDb.collection('FinancialAuditLogs').where('entityType', '==', 'BansosRequests').get();
  assert.ok(audits.size >= 10, 'every change is audited');
  console.log('BanSos integration passed: submit/idempotency/proof bytes, defaults, events, duplicates, both decision orders, amount edit, slip + SPJ payout, reject, reset, locked slip, withdraw, closed-month move, editor and rules guards.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
