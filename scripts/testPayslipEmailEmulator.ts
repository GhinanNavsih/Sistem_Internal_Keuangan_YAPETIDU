/**
 * Payslip email history and the bulk "never send twice" guard, against the
 * demo-payslip-email Auth + Firestore emulators only. No SMTP is configured, so
 * a send that gets past the guards fails at the mail step, which is exactly
 * what shows the guard did not stop it.
 */
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

const PROJECT = 'demo-payslip-email';

async function main() {
  if (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== PROJECT ||
    !/^(127\.0\.0\.1|localhost):8188$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') ||
    !/^(127\.0\.0\.1|localhost):9198$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || '')) {
    throw new Error(`Refusing to run outside the ${PROJECT} emulators.`);
  }
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  const { adminDb } = await import('../src/lib/firebase-admin');
  const { GET, POST } = await import('../src/app/api/payroll/send-email/route');

  const signUp = async (role: string) => {
    const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }),
    });
    const identity = await response.json();
    await adminDb.doc(`users/${identity.localId}`).set({ role, displayName: role });
    return `Bearer ${identity.idToken}`;
  };
  const finance = await signUp('finance_verifier');
  const loyalis = await signUp('loyalis');

  const period = '2026_10';
  const employees = [
    ['Loyalis_Ani', 'Ani', 'locked', true],
    ['Loyalis_Budi', 'Budi', 'locked', false],
    ['Loyalis_Citra', 'Citra', 'draft', false],
    ['Loyalis_Dodi', 'Dodi', 'paid', false],
  ] as const;
  for (const [id, name, status, emailSent] of employees) {
    await adminDb.doc(`Employees_Loyalis/${id}`).set({ personal_info: { name, email: `${name.toLowerCase()}@x.test` } });
    await adminDb.doc(`PayrollSlipStates/${period}_${id}`).set({
      employeeId: id,
      period,
      status,
      earnings: [{ label: 'Gaji Pokok', amount: 1000000 }],
      deductions: [],
      ...(emailSent ? { emailSent: true, emailSentAt: new Date('2026-11-04T07:00:00Z') } : {}),
    });
  }
  await adminDb.doc(`PayrollDeliveryEvents/${period}_Loyalis_Budi__email__req_budi_0001`).set({
    slipId: `${period}_Loyalis_Budi`, employeeId: 'Loyalis_Budi', dbPeriod: period, channel: 'email',
    recipient: 'budi@x.test', status: 'failed', error: 'Mailbox full', requestedAt: new Date(),
  });

  const pdfBase64 = Buffer.from('%PDF-1.4\n%test\n').toString('base64');
  const send = (employeeId: string, requestId: string, extra: Record<string, unknown> = {}) =>
    POST(new NextRequest('http://localhost/api/payroll/send-email', {
      method: 'POST',
      headers: { authorization: finance, 'content-type': 'application/json' },
      body: JSON.stringify({ employeeId, dbPeriod: period, requestId, pdfBase64, ...extra }),
    }));

  // A bulk send skips a slip the server already marked as emailed, without
  // claiming a delivery: this is what makes a resumed or restarted run safe.
  const skipped = await send('Loyalis_Ani', 'bulk_email_ani_0001', { skipIfSent: true });
  assert.equal(skipped.status, 200);
  assert.deepEqual(await skipped.json(), { success: true, alreadySent: true });
  assert.equal((await adminDb.doc(`PayrollDeliveryEvents/${period}_Loyalis_Ani__email__bulk_email_ani_0001`).get()).exists, false);

  // A single send from the slip dialog may still resend on purpose: it gets
  // past the guard and stops only at the (unconfigured) mail step.
  const resend = await send('Loyalis_Ani', 'email_ani_0002');
  assert.equal(resend.status, 500);
  assert.equal((await adminDb.doc(`PayrollDeliveryEvents/${period}_Loyalis_Ani__email__email_ani_0002`).get()).data()?.status, 'failed');

  // An unsent slip is not skipped by the bulk flag.
  const unsent = await send('Loyalis_Dodi', 'bulk_email_dodi_0001', { skipIfSent: true });
  assert.equal(unsent.status, 500, 'reached the mail step');

  const history = async (authorization: string, query = `dbPeriod=${period}`) =>
    GET(new NextRequest(`http://localhost/api/payroll/send-email?${query}`, { headers: { authorization } }));

  assert.equal((await history(loyalis)).status, 403);
  assert.equal((await history(finance, 'dbPeriod=2026-10')).status, 400);

  const response = await history(finance);
  assert.equal(response.status, 200);
  const { rows } = await response.json() as { rows: Array<{ employeeId: string; employeeName: string; status: string; sentAt: string | null; error: string | null; attempts: number }> };
  const byId = new Map(rows.map((row) => [row.employeeId, row]));
  assert.deepEqual(rows.map((row) => row.employeeName), ['Ani', 'Budi', 'Dodi'], 'drafts are left out, sorted by name');
  assert.equal(byId.get('Loyalis_Ani')?.status, 'sent', 'a later failed resend does not hide the earlier send');
  assert.equal(byId.get('Loyalis_Ani')?.sentAt, '2026-11-04T07:00:00.000Z');
  assert.equal(byId.get('Loyalis_Budi')?.status, 'failed');
  assert.equal(byId.get('Loyalis_Budi')?.error, 'Mailbox full');
  assert.equal(byId.get('Loyalis_Dodi')?.status, 'failed', 'the failed attempt above is recorded');
  assert.equal(byId.get('Loyalis_Dodi')?.attempts, 1);

  console.log('PASS: bulk sends skip already-emailed slips, single sends can still resend, history reads the server record.');
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
