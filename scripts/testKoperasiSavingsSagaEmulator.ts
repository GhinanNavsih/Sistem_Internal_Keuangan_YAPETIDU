/** Invoked by the Koperasi Functions integration suite against local emulators. */
import assert from 'node:assert/strict';
import admin, { adminDb } from '../src/lib/firebase-admin';
import { prepareKoperasiPlanForDraft, verifyAndLockWithKoperasi } from '../src/lib/server/payrollKoperasiSaga';
import { replaceKoperasiSavingsDeductions } from '../src/lib/server/koperasiPayrollBridge';
import type { AuthenticatedProfile } from '../src/lib/server/auth';

async function main() {
  if (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== 'demo-saku-savings' || !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') || !process.env.KOPERASI_PAYROLL_BRIDGE_URL?.startsWith('http://127.0.0.1:')) throw new Error('Emulators required.');
  const koperasi = admin.initializeApp({ projectId: 'demo-koperasi' }, 'savings-saga-koperasi').firestore();
  const actor: AuthenticatedProfile = { uid: 'saga-finance', email: 'finance@example.test', role: 'finance_verifier', displayName: 'Finance', permittedCategories: [] };
  const period = '2026_11';
  const policy = { startPeriod: '2026-11', initialPeriod: '2026-11', initialPaid: false };
  async function fixture(employeeId: string) {
    const memberId = `member-${employeeId}`, uid = `uid-${employeeId}`;
    await koperasi.doc(`users/${memberId}`).set({ uid, nama: employeeId, email: `${employeeId}@example.test`, role: 'Member',
      membershipStatus: 'approved', status: 'approved', paymentStatus: 'Payroll Deduction', nominalTabungan: 0, payrollSavings: policy });
    await adminDb.doc(`Employees_Loyalis/${employeeId}`).set({ personal_info: { name: employeeId, status: 'AKTIF' }, koperasiUserId: memberId, koperasiAuthUid: uid });
    const command = { employeeId, period, requestId: `request_${employeeId}`, reason: 'Integration verification', deductions: [{ label: 'Iuran Wajib Kop. UNIPDU', amount: 1 }] };
    const plan = await prepareKoperasiPlanForDraft(command, actor);
    assert.equal(plan.savings?.total, 275000);
    const deductions = replaceKoperasiSavingsDeductions(command.deductions, plan);
    assert.equal(deductions.reduce((sum, row) => sum + row.amount, 0), 275000, 'server plan replaces untrusted contribution');
    await adminDb.doc(`PayrollSlipStates/${period}_${employeeId}`).set({ employeeId, period, status: 'draft', revision: 1,
      earnings: [{ label: 'Gaji Pokok', amount: 1000000 }], deductions, taxes: [], koperasiInstallmentPlan: plan });
    return { command, memberId, plan };
  }
  const lost = await fixture('SavingsLost');
  const stale = await fixture('SavingsStale');
  const concurrent = await fixture('SavingsConcurrent');
  const relinked = await fixture('SavingsRelinked');
  await adminDb.doc('PayrollPeriods/2026-11').set({ attendanceStatus: 'closed', payrollRosterSeal: { schemaVersion: 1, employeeIds: ['SavingsLost', 'SavingsStale', 'SavingsConcurrent', 'SavingsRelinked'] } });
  const original = adminDb.runTransaction.bind(adminDb);
  let calls = 0;
  Object.defineProperty(adminDb, 'runTransaction', { configurable: true, writable: true, value: (...args: Parameters<typeof adminDb.runTransaction>) => {
    calls++;
    if (calls === 2) throw new Error('Injected completion failure after external credit');
    return original(...args);
  } });
  try { await assert.rejects(verifyAndLockWithKoperasi(lost.command, actor), /Injected completion failure/); }
  finally { Object.defineProperty(adminDb, 'runTransaction', { configurable: true, writable: true, value: original }); }
  assert.equal((await koperasi.doc(`users/${lost.memberId}`).get()).data()!.nominalTabungan, 275000);
  assert.equal((await adminDb.doc(`${'PayrollSlipStates'}/${period}_SavingsLost`).get()).data()!.status, 'draft');
  const resumed = await verifyAndLockWithKoperasi(lost.command, actor);
  assert.equal(resumed.status, 'locked');
  assert.equal(resumed.koperasi.status, 'applied', 'a savings-only contribution is an applied operation');
  assert.equal(resumed.koperasi.savings?.outcome, 'already_applied');
  assert.equal((await koperasi.doc(`users/${lost.memberId}`).get()).data()!.nominalTabungan, 275000);
  const locked = (await adminDb.doc(`PayrollSlipStates/${period}_SavingsLost`).get()).data()!;
  assert.equal(locked.lockedSnapshot.koperasiInstallmentPlan.savings.initial, 250000);
  assert.equal(locked.lockedSnapshot.totalDeductions, 275000);
  assert.equal((await verifyAndLockWithKoperasi(lost.command, actor)).idempotent, true);
  await koperasi.doc(`users/${stale.memberId}`).update({ iuranWajib: 50000 });
  await assert.rejects(verifyAndLockWithKoperasi(stale.command, actor), /berubah/);
  assert.equal((await koperasi.doc(`users/${stale.memberId}`).get()).data()!.nominalTabungan, 0);
  const results = await Promise.all([verifyAndLockWithKoperasi(concurrent.command, actor), verifyAndLockWithKoperasi(concurrent.command, actor)]);
  assert.ok(results.every(result => result.status === 'locked'));
  assert.equal((await koperasi.doc(`users/${concurrent.memberId}`).get()).data()!.nominalTabungan, 275000);
  await adminDb.doc('Employees_Loyalis/SavingsRelinked').update({ koperasiUserId: 'different-member' });
  await assert.rejects(verifyAndLockWithKoperasi(relinked.command, actor), /Tautan Koperasi berubah/);
  assert.equal((await koperasi.doc(`users/${relinked.memberId}`).get()).data()!.nominalTabungan, 0);
  console.log('SAKU savings saga passed: canonical deductions, external credit/completion failure, retry, frozen snapshot, stale policy, concurrent lock and changed identity.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
