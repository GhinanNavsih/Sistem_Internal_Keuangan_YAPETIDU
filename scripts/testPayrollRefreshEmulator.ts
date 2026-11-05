/** Real payroll save API against Auth + Firestore emulators. Koperasi HTTP is a fixture. */
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

const PROJECT = 'demo-payroll-refresh';
async function main() {
  if (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== PROJECT ||
    !/^(127\.0\.0\.1|localhost):8188$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') ||
    !/^(127\.0\.0\.1|localhost):9198$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || '')) {
    throw new Error('Refusing to run outside demo-payroll-refresh emulators.');
  }
  const { adminDb } = await import('../src/lib/firebase-admin');
  const { hashKoperasiInstallmentPlan } = await import('../src/lib/server/koperasiPayrollBridge');
  process.env.KOPERASI_PAYROLL_BRIDGE_URL = 'https://koperasi-refresh-fixture.test';
  process.env.KOPERASI_PAYROLL_HMAC_SECRET = 'emulator-fixture-secret-for-refresh-only';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    if (String(input) === process.env.KOPERASI_PAYROLL_BRIDGE_URL) {
      const command = JSON.parse(String(options?.body));
      assert.equal(command.action, 'preview', 'refresh never advances Koperasi installments');
      const plan = { schemaVersion: 1 as const, payrollPeriod: command.payrollPeriod,
        matchType: 'none' as const, resolvedUserId: null, expectedDeduction: 0, loans: [] };
      return Response.json({ ...plan, planHash: hashKoperasiInstallmentPlan(plan) });
    }
    assert.match(String(input), /^http:\/\/(127\.0\.0\.1|localhost):/, 'no production HTTP requests');
    return originalFetch(input, options);
  };
  try {
    const { POST } = await import('../src/app/api/payroll/slips/route');
    const signup = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }),
    });
    const identity = await signup.json();
    await adminDb.doc(`users/${identity.localId}`).set({ role: 'super_admin', displayName: 'Refresh reviewer' });
    const headers = { authorization: `Bearer ${identity.idToken}`, 'content-type': 'application/json' };
    const period = '2026_10';
    await adminDb.doc('PayrollPeriods/2026-10').set({ attendanceStatus: 'open' });
    await adminDb.doc('Employees_Loyalis/Loyalis_Refresh').set({ personal_info: { name: 'Refresh test', status: 'AKTIF' } });
    const ref = adminDb.doc(`PayrollSlipStates/${period}_Loyalis_Refresh`);
    const seed = async (status = 'draft', revision = 1) => ref.set({ employeeId: 'Loyalis_Refresh', period, status,
      earnings: [{ label: 'Gaji Pokok', amount: 7000000 }], deductions: [], taxApplied: true, revision });
    await seed();
    const body = { action: 'save_draft', employeeId: 'Loyalis_Refresh', period,
      earnings: [{ label: 'Gaji Pokok', amount: 8000000 }], deductions: [], expectedRevision: 1 };
    const call = async (requestId: string, extra: Record<string, unknown> = {}, authorization = headers.authorization) => {
      const response = await POST(new NextRequest('http://localhost/api/payroll/slips', {
        method: 'POST', headers: { ...headers, authorization }, body: JSON.stringify({ ...body, requestId, ...extra }),
      }));
      return { status: response.status, data: await response.json() };
    };
    const saved = await call('refresh-save-0001');
    assert.equal(saved.status, 201, JSON.stringify(saved.data));
    assert.equal(saved.data.revision, 2);
    assert.equal(saved.data.taxApplied, true);
    assert.equal(saved.data.totalTax, 400000);
    assert.deepEqual(saved.data.earnings, (await ref.get()).data()?.earnings, 'UI receives canonical persisted rows');
    const replay = await call('refresh-save-0001');
    assert.equal(replay.status, 200);
    assert.equal(replay.data.idempotent, true);
    assert.equal(replay.data.revision, 2);
    assert.equal(replay.data.taxApplied, true);
    assert.equal((await ref.get()).data()?.revision, 2, 'retry does not save twice');
    assert.equal((await call('refresh-stale-0002')).status, 409);
    assert.equal((await call('refresh-null-0003', { expectedRevision: null })).status, 409);
    assert.equal((await call('refresh-negative-0004', { expectedRevision: -1 })).status, 400);
    assert.equal((await call('refresh-fraction-0005', { expectedRevision: 1.5 })).status, 400);
    assert.equal((await call('refresh-unauth-0006', {}, '')).status, 401);
    await adminDb.doc(`users/${identity.localId}`).update({ role: 'loyalis' });
    assert.equal((await call('refresh-forbidden-0006')).status, 403);
    await adminDb.doc(`users/${identity.localId}`).update({ role: 'super_admin' });
    await seed();
    const concurrent = await Promise.all([call('refresh-concurrent-a'), call('refresh-concurrent-b')]);
    assert.deepEqual(concurrent.map(r => r.status).sort(), [201, 409], 'stale comparison cannot overwrite a concurrent save');
    for (const status of ['locked', 'payment_created', 'paid', 'confirmed']) {
      await seed(status);
      assert.equal((await call(`refresh-immutable-${status}`)).status, 409);
    }
    await seed();
    await adminDb.doc('PayrollPeriods/2026-10').update({ attendanceStatus: 'closed' });
    assert.equal((await call('refresh-closed-0007')).status, 409);
    await adminDb.doc('PayrollPeriods/2026-10').update({ attendanceStatus: 'open' });
    await ref.delete();
    const created = await call('refresh-new-slip-0008', { expectedRevision: null });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.equal((await ref.get()).data()?.revision, 1);
    assert.equal((await adminDb.collection('FinancialAuditLogs').where('action', '==', 'SAVE_DRAFT').get()).size, 3,
      'only the three successful writes create financial audit records');
    console.log('PASS refresh API: persistence, canonical response, tax selection, idempotent retry, stale/new-draft conflicts, concurrent saves, authorization, immutable slips and closed periods');
  } finally {
    globalThis.fetch = originalFetch;
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
