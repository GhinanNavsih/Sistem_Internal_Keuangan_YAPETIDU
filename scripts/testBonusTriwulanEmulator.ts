/** Senam Pagi and Bonus Triwulan against the Auth and Firestore emulators only. */
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

const PROJECT = 'demo-bonus-triwulan';

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
    !/^(127\.0\.0\.1|localhost):9198$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || '')) {
    throw new Error(`Refusing to run outside the ${PROJECT} emulators.`);
  }
  const { adminDb } = await import('../src/lib/firebase-admin');
  const senamApi = await import('../src/app/api/payroll/senam-pagi/route');
  const bonusApi = await import('../src/app/api/payroll/bonus-triwulan/route');
  const vakasiApi = await import('../src/app/api/payroll/vakasi-events/route');
  const { bonusTriwulanCloseBlocker } = await import('../src/lib/server/bonusTriwulan');
  const { bonusTriwulanWindow, BONUS_TRIWULAN_START_PERIOD } = await import('../src/lib/payroll/bonusTriwulan');

  const today = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const period = today.slice(0, 7);
  assert.ok(period >= BONUS_TRIWULAN_START_PERIOD, 'runs from the first automatic month');
  const [m2, m1] = bonusTriwulanWindow(period);
  const day1 = `${period}-01`;
  const day2 = `${period}-02`;
  const eventPath = `VakasiTambahan/BONUS_TRIWULAN_${period}`;
  const slipPath = (id: string) => `PayrollSlipStates/${period.replace('-', '_')}_${id}`;

  const employeeAdmin = await signUp('admin@example.test');
  const superAdmin = await signUp('super@example.test');
  const finance = await signUp('finance@example.test');
  const honorer = await signUp('honorer@example.test');
  await adminDb.doc(`users/${employeeAdmin.uid}`).set({ role: 'loyalis_admin', displayName: 'Admin Karyawan' });
  await adminDb.doc(`users/${superAdmin.uid}`).set({ role: 'super_admin', displayName: 'Super Admin' });
  await adminDb.doc(`users/${finance.uid}`).set({ role: 'finance_verifier', displayName: 'Badan Keuangan' });
  await adminDb.doc(`users/${honorer.uid}`).set({ role: 'honorer', displayName: 'Cahyo', permittedCategories: ['KEBERSIHAN'] });

  // Ani qualifies; Bayu was paid last month (fresh count); Citra had Strata 2 last month.
  await adminDb.doc('Employees_Loyalis/Loyalis_901').set({ personal_info: { name: 'Ani', status: 'AKTIF' } });
  await adminDb.doc('Employees_Loyalis/Loyalis_902').set({ personal_info: { name: 'Bayu', status: 'AKTIF' } });
  await adminDb.doc('Employees_Loyalis/Loyalis_903').set({ personal_info: { name: 'Citra', status: 'AKTIF' } });
  const all = ['Loyalis_901', 'Loyalis_902', 'Loyalis_903'];
  for (const month of [m2, m1, period]) {
    await adminDb.doc(`LoyalisPresence/${month}`).set({
      period: month,
      workingDays: 25,
      expectedHours: 6.5,
      entries: {
        Loyalis_901: { stratum: 1, deduction: 0 },
        Loyalis_902: { stratum: 1, deduction: 0 },
        Loyalis_903: { stratum: month === m1 ? 2 : 1, deduction: month === m1 ? 100_000 : 0 },
      },
    });
  }
  for (const [month, recipients] of [[m2, {}], [m1, { Loyalis_902: { employeeName: 'Bayu' } }]] as const) {
    await adminDb.doc(`SenamPagi/${month}`).set({ period: month, source: 'paper', paperMetEmployeeIds: all, revision: 1 });
    await adminDb.doc(`BonusTriwulan/${month}`).set({ period: month, source: 'paper', recipients, missing: [], revision: 1 });
  }
  await adminDb.doc(`PayrollPeriods/${period}`).set({ attendanceStatus: 'open' });
  for (const id of ['Loyalis_901', 'Loyalis_902']) {
    await adminDb.doc(slipPath(id)).set({
      employeeId: id, period: period.replace('-', '_'), status: 'draft', revision: 1,
      earnings: [{ label: 'Gaji Pokok', amount: 4_000_000 }], deductions: [], taxes: [],
    });
  }

  const expectStatus = async (response: Response, status: number, note = '') => {
    const body = await response.clone().json().catch(() => ({}));
    assert.equal(response.status, status, `${note} ${JSON.stringify(body)}`);
    return body;
  };
  const get = (api: typeof senamApi | typeof bonusApi, path: string, authorization: string, month = period) =>
    api.GET(new NextRequest(`http://localhost/api/payroll/${path}?period=${month}`, { headers: { authorization } }));
  let counter = 0;
  const senamWrite = async (authorization: string, body: Record<string, unknown>, month = period) => {
    const revision = Number((await adminDb.doc(`SenamPagi/${month}`).get()).data()?.revision || 0);
    counter += 1;
    return senamApi.POST(new NextRequest('http://localhost/api/payroll/senam-pagi', {
      method: 'POST', headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify({ period: month, requestId: `senam_test_${String(counter).padStart(4, '0')}`, expectedRevision: revision, ...body }),
    }));
  };
  const recalculate = (authorization: string) => {
    counter += 1;
    return bonusApi.POST(new NextRequest('http://localhost/api/payroll/bonus-triwulan', {
      method: 'POST', headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify({ period, requestId: `bonus_test_${String(counter).padStart(4, '0')}` }),
    }));
  };
  const slipEarning = async (id: string) =>
    ((await adminDb.doc(slipPath(id)).get()).data()!.earnings as Array<{ label: string; amount: number }>)
      .find((row) => row.label === 'Bonus Triwulan')?.amount ?? null;

  // ── Access ──
  await expectStatus(await get(senamApi, 'senam-pagi', honorer.authorization), 403, 'honorer cannot read');
  const financeView = await expectStatus(await get(senamApi, 'senam-pagi', finance.authorization), 200, 'Badan Keuangan reads');
  assert.equal(financeView.roster.length, 3);
  await expectStatus(await senamWrite(finance.authorization, { action: 'save_session', date: day1, presentEmployeeIds: [] }), 403, 'Badan Keuangan does not record');

  // ── Nothing recorded yet: nobody is paid and the page says why ──
  let bonus = await expectStatus(await get(bonusApi, 'bonus-triwulan', employeeAdmin.authorization), 200);
  assert.deepEqual(bonus.evaluation.recipients, []);
  assert.ok(bonus.evaluation.missing.some((text: string) => text.startsWith('Senam Pagi')), JSON.stringify(bonus.evaluation.missing));
  assert.match(String(await bonusTriwulanCloseBlocker(period)), /Senam Pagi .* belum dicatat/);

  // ── A paper month and a future date are refused ──
  await expectStatus(await senamWrite(employeeAdmin.authorization, { action: 'set_no_sessions', noSessions: true }, '2026-09'), 409, 'paper month');
  const future = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  if (future.startsWith(period)) {
    await expectStatus(await senamWrite(employeeAdmin.authorization, { action: 'save_session', date: future, presentEmployeeIds: [] }), 409, 'future date');
  }

  // ── Two sessions; Bayu misses one. Ani is paid, Bayu was paid last month, Citra had Strata 2 ──
  await adminDb.doc(`SenamPagi/${period}`).set({
    period, source: 'saku', noSessions: false, revision: 1,
    sessions: { [day2]: { presentEmployeeIds: all } },
  });
  let written = await expectStatus(
    await senamWrite(employeeAdmin.authorization, { action: 'save_session', date: day1, presentEmployeeIds: ['Loyalis_901', 'Loyalis_903'] }),
    200,
  );
  assert.equal(written.bonusNote, null, 'bonus recalculated with the save');
  assert.equal(written.view.month.sessions.length, 2);
  let event = (await adminDb.doc(eventPath).get()).data()!;
  assert.equal(event.eventName, 'Bonus Triwulan');
  assert.equal(event.sourceKind, 'bonus_triwulan');
  assert.equal(event.status, 'approved');
  assert.deepEqual(Object.keys(event.eventWorkers), ['Loyalis_901']);
  assert.equal(event.eventWorkers.Loyalis_901.payGiven, 500_000);
  assert.equal(await slipEarning('Loyalis_901'), 500_000, 'Ani\'s draft slip carries it');
  assert.equal(await slipEarning('Loyalis_902'), null, 'Bayu\'s does not');
  bonus = await expectStatus(await get(bonusApi, 'bonus-triwulan', finance.authorization), 200);
  assert.equal(bonus.stale, false);
  const rowOf = (id: string) => bonus.evaluation.rows.find((row: { employeeId: string }) => row.employeeId === id);
  assert.equal(rowOf('Loyalis_902').paidIn, m1);
  assert.match(rowOf('Loyalis_903').reason, /Strata 2/);
  assert.equal(await bonusTriwulanCloseBlocker(period), null, 'current and complete');

  // A stale revision is refused; a recalculation with nothing new changes nothing.
  const stale = await senamApi.POST(new NextRequest('http://localhost/api/payroll/senam-pagi', {
    method: 'POST', headers: { authorization: employeeAdmin.authorization, 'content-type': 'application/json' },
    body: JSON.stringify({ period, requestId: 'senam_test_stale', expectedRevision: 1, action: 'delete_session', date: day1 }),
  }));
  await expectStatus(stale, 409, 'stale revision');
  const unchanged = await expectStatus(await recalculate(finance.authorization), 200);
  assert.equal(unchanged.result.changed, false);

  // ── A change the save never saw (Ani now misses both) makes the result stale until recalculated ──
  await adminDb.doc(`SenamPagi/${period}`).update({
    [`sessions.${day1}.presentEmployeeIds`]: ['Loyalis_903'],
    [`sessions.${day2}.presentEmployeeIds`]: ['Loyalis_902', 'Loyalis_903'],
    revision: Number((await adminDb.doc(`SenamPagi/${period}`).get()).data()!.revision) + 1,
  });
  bonus = await expectStatus(await get(bonusApi, 'bonus-triwulan', superAdmin.authorization), 200);
  assert.equal(bonus.stale, true);
  assert.match(String(await bonusTriwulanCloseBlocker(period)), /Hitung ulang/);
  const changed = await expectStatus(await recalculate(superAdmin.authorization), 200);
  assert.equal(changed.result.changed, true);
  event = (await adminDb.doc(eventPath).get()).data()!;
  assert.equal(event.status, 'pending_review');
  assert.deepEqual(event.eventWorkers, {});
  assert.deepEqual(event.ownedEarningLabelsByEmployee, { Loyalis_901: ['Bonus Triwulan'] });
  assert.equal(await slipEarning('Loyalis_901'), null, 'the row leaves the draft slip');
  assert.equal(await bonusTriwulanCloseBlocker(period), null);

  // ── A locked slip refuses a change that would pay it ──
  await adminDb.doc(slipPath('Loyalis_901')).update({ status: 'locked' });
  const relock = await senamWrite(employeeAdmin.authorization, { action: 'save_session', date: day2, presentEmployeeIds: all });
  written = await expectStatus(relock, 200, 'attendance still saves');
  assert.match(String(written.bonusNote), /dikunci/);
  assert.deepEqual((await adminDb.doc(eventPath).get()).data()!.eventWorkers, {}, 'payout unchanged');
  await adminDb.doc(slipPath('Loyalis_901')).update({ status: 'draft' });
  await expectStatus(await recalculate(employeeAdmin.authorization), 200);
  assert.equal(await slipEarning('Loyalis_901'), 500_000, 'paid again once the slip is a draft');

  // ── The generic Vakasi editor and browsers cannot touch it ──
  const forged = await vakasiApi.POST(new NextRequest('http://localhost/api/payroll/vakasi-events', {
    method: 'POST', headers: { authorization: superAdmin.authorization, 'content-type': 'application/json' },
    body: JSON.stringify({
      requestId: 'vakasi_bonus_forge1', action: 'save', eventId: `BONUS_TRIWULAN_${period}`, expectedRevision: 1, desiredStatus: 'approved',
      snapshot: { eventName: 'Bonus Triwulan', period, isEndOfMonth: true, workers: [{ employeeId: 'Loyalis_902', payGiven: 9_000_000 }] },
    }),
  }));
  await expectStatus(forged, 409, 'vakasi-events refuses Bonus Triwulan');
  const documents = `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${PROJECT}/databases/(default)/documents`;
  const clientPatch = (path: string) => fetch(`${documents}/${path}?updateMask.fieldPaths=totalPayout`, {
    method: 'PATCH', headers: { authorization: superAdmin.authorization, 'content-type': 'application/json' },
    body: JSON.stringify({ fields: { totalPayout: { integerValue: '1' } } }),
  });
  assert.equal((await clientPatch(eventPath)).status, 403, 'browser cannot edit the event');
  assert.equal((await clientPatch(`VakasiTambahan/BONUS_TRIWULAN_2099-01`)).status, 403, 'nor create one');
  for (const path of [`SenamPagi/${period}`, `BonusTriwulan/${period}`]) {
    const read = await fetch(`${documents}/${path}`, { headers: { authorization: superAdmin.authorization } });
    assert.equal(read.status, 403, `${path} is server-only`);
  }

  // ── A closed period refuses both writes ──
  await adminDb.doc(`PayrollPeriods/${period}`).set({ attendanceStatus: 'closed' });
  await expectStatus(await senamWrite(employeeAdmin.authorization, { action: 'delete_session', date: day1 }), 409, 'closed: no senam');
  await expectStatus(await recalculate(superAdmin.authorization), 409, 'closed: no recalculation');

  const audits = await adminDb.collection('FinancialAuditLogs').where('entityType', 'in', ['SenamPagi', 'BonusTriwulan']).get();
  assert.ok(audits.size >= 5, `every change is audited (${audits.size})`);
  console.log('Bonus Triwulan integration passed: access, missing data, paper/future refusals, payout on save, fresh-start and strata rules, stale revision, no-op recalculation, stale result + close blocker, removal from slip, locked slip, editor and rules guards, closed period.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
