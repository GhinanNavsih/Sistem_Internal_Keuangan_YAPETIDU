/**
 * Pekarya → Loyalis conversion against the Auth + Firestore emulators ONLY.
 * Never run against real payroll: `npm run test:employee-conversion:integration`.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';

const PROJECT = 'demo-conversion';

function jakartaToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function shift(period: string, months: number): string {
  const [year, month] = period.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + months, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

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

/** A client write through the Firestore REST API, so the deployed rules apply. */
function clientPatch(
  authorization: string,
  path: string,
  fieldPath: string,
  value: Record<string, unknown>,
) {
  const [top, ...rest] = fieldPath.split('.');
  const nested = rest.reduceRight<Record<string, unknown>>(
    (inner, key) => ({ mapValue: { fields: { [key]: inner } } }),
    value,
  );
  return fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/${path}?updateMask.fieldPaths=${encodeURIComponent(fieldPath)}`,
    {
      method: 'PATCH',
      headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify({ fields: { [top]: nested } }),
    },
  );
}

async function main() {
  if (
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== PROJECT ||
    !/^(127\.0\.0\.1|localhost):8188$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') ||
    !/^(127\.0\.0\.1|localhost):9198$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || '')
  ) {
    throw new Error(`Refusing to run outside the ${PROJECT} Auth + Firestore emulators.`);
  }
  const { adminDb } = await import('../src/lib/firebase-admin');
  const { GET, POST } = await import('../src/app/api/admin/employee-conversions/route');
  const { buildPayrollRoster } = await import('../src/lib/payroll/payrollRoster');

  const today = jakartaToday();
  const period = today.slice(0, 7);
  const previous = shift(period, -1);
  const slipPeriodKey = previous.replace('-', '_');
  const nipy = '15010320901';
  const nipyIndexId = createHash('sha256').update(nipy).digest('hex');

  const superAdmin = await signUp('super@example.test');
  const loyalisAdmin = await signUp('loyalis-admin@example.test');
  const worker = await signUp('worker@example.test');
  await adminDb.doc(`users/${superAdmin.uid}`).set({ role: 'super_admin', displayName: 'Super' });
  await adminDb.doc(`users/${loyalisAdmin.uid}`).set({ role: 'loyalis_admin', displayName: 'Admin Loyalis' });
  await adminDb.doc(`users/${worker.uid}`).set({
    role: 'honorer',
    displayName: 'Ahmad',
    email: 'worker@example.test',
    linkedEmployeeId: 'BC_901',
    permittedCategories: ['SATPAM'],
  });
  await adminDb.doc('Employees_BlueCollar/BC_901').set({
    employeeId: 'BC_901',
    name: 'Ahmad Fauzi',
    nik: '3517000000000901',
    phoneNumber: '081234567890',
    email: 'worker@example.test',
    nipy,
    nipyAssignment: { status: 'issued', sequence: 1, categoryGroup: 'SATPAM' },
    collarType: 'blue_collar',
    employment: { status: 'active', jobCategory: 'SATPAM', startDate: '2018-03-01', dateRecognized: '' },
    salaryProfile: { salaryGradeCode: 'P2', tunjanganBeras: 75000 },
    bankAccount: { bankName: 'BSI', accountNumber: '7001234567' },
    bpjs: { allowanceAmount: 150000, deductionAmount: 50000 },
    flags: { isActive: true, isPayrollEligible: true },
    koperasiAuthUid: 'kop-uid-901',
  });
  await adminDb.doc('Employees_BlueCollar/BC_902').set({
    employeeId: 'BC_902',
    name: 'Tidak Dialihkan',
    employment: { status: 'inactive', jobCategory: 'TEKNISI', startDate: '2020-01-01' },
    flags: { isActive: false, isPayrollEligible: false },
  });
  await adminDb.doc('Employees_Loyalis/Loyalis_045').set({
    personal_info: { name: 'Sudah Ada', status: 'AKTIF' },
  });
  await adminDb.doc(`AttendanceIdentityIndex/${nipyIndexId}`).set({
    nipy,
    employeeId: 'BC_901',
    employeeCollection: 'Employees_BlueCollar',
  });
  await adminDb.doc(`PayrollSlipStates/${slipPeriodKey}_BC_901`).set({
    employeeId: 'BC_901',
    period: slipPeriodKey,
    status: 'draft',
    earnings: [{ label: 'Gaji Pokok', amount: 2000000 }],
    deductions: [],
    taxes: [],
  });

  const preview = (authorization: string) =>
    GET(new NextRequest('http://localhost/api/admin/employee-conversions?employeeId=BC_901', {
      headers: { authorization },
    }));
  const convert = (authorization: string, body: Record<string, unknown>) =>
    POST(new NextRequest('http://localhost/api/admin/employee-conversions', {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }));
  const codes = async (response: Response) =>
    ((await response.json()).blockers as Array<{ code: string }>).map((issue) => issue.code);

  // Only employee-profile editors may even look.
  assert.equal((await preview(worker.authorization)).status, 403);

  // The month before must be closed first, so its last Pekarya slip still pays.
  let response = await preview(loyalisAdmin.authorization);
  assert.equal(response.status, 200);
  assert.deepEqual(await codes(response), ['PREVIOUS_PERIOD_OPEN']);
  await adminDb.doc(`PayrollPeriods/${previous}`).set({ attendanceStatus: 'closed' });

  // A pending report would be stranded once the Pekarya record closes.
  const reportRef = adminDb.doc('ActivityReports/PEK-BC_901-test');
  await reportRef.set({ employeeId: 'BC_901', status: 'pending', payrollPeriod: previous });
  response = await preview(loyalisAdmin.authorization);
  assert.deepEqual(await codes(response), ['PENDING_ACTIVITY_REPORTS']);

  const input = {
    name: 'Ahmad Fauzi',
    nik: '3517000000000901',
    phone: '081234567890',
    email: 'worker@example.test',
    bankName: 'BSI',
    accountNumber: '7001234567',
    dateOfHire: '2018-03-01',
    dateRecognized: '2018-03-01',
    departmentUnit: 'REKTORAT',
    loyalisType: 'Admin',
    isDosen: false,
    educationLevel: '',
    levelCode: '',
    bpjsTk: 100000,
    bpjsKes: 50000,
    spouseCount: 1,
    childrenSd: 0,
    childrenSltp: 0,
    childrenSlta: 0,
    childrenPt: 0,
  };
  const command = {
    employeeId: 'BC_901',
    input,
    reason: 'SK pengangkatan Loyalis nomor 12',
    requestId: 'conversion_test_0001',
  };
  response = await convert(loyalisAdmin.authorization, command);
  assert.equal(response.status, 409, 'blockers are re-checked on submit');
  await reportRef.update({ status: 'approved' });

  // Golongan is Super Admin only.
  response = await convert(loyalisAdmin.authorization, {
    ...command,
    requestId: 'conversion_test_0002',
    input: { ...input, levelCode: 'C' },
  });
  assert.equal(response.status, 400);

  response = await convert(loyalisAdmin.authorization, command);
  const result = await response.json();
  assert.equal(response.status, 201, JSON.stringify(result));
  assert.equal(result.loyalisEmployeeId, 'Loyalis_046');
  assert.equal(result.effectivePeriod, period);
  assert.equal(result.linkedAccountUid, worker.uid);

  const loyalis = (await adminDb.doc('Employees_Loyalis/Loyalis_046').get()).data()!;
  assert.equal(loyalis.personal_info.name, 'Ahmad Fauzi');
  assert.equal(loyalis.personal_info.status, 'AKTIF');
  assert.equal(loyalis.personal_info.employee_id_niy, nipy);
  assert.equal(loyalis.nipy, nipy);
  assert.equal(loyalis.employment_profile.department_unit, 'REKTORAT');
  assert.equal(loyalis.employment_profile.date_of_hire.toDate().toISOString(), '2018-03-01T00:00:00.000Z');
  assert.equal(loyalis.bpjs.t_bpjs_tk, 100000);
  assert.equal(loyalis.koperasiAuthUid, 'kop-uid-901');
  assert.equal(loyalis.conversion.fromEmployeeId, 'BC_901');
  assert.equal(loyalis.conversion.effectivePeriod, period);

  const blue = (await adminDb.doc('Employees_BlueCollar/BC_901').get()).data()!;
  assert.equal(blue.employment.status, 'inactive');
  assert.equal(blue.flags.isActive, false);
  assert.equal(blue.flags.isPayrollEligible, false);
  assert.equal('nipy' in blue, false, 'the NIPY leaves the Pekarya record');
  assert.equal(blue.conversion.previousNipy, nipy);
  assert.equal(blue.conversion.toEmployeeId, 'Loyalis_046');
  assert.equal(blue.koperasiAuthUid, 'kop-uid-901', 'kept for the final Pekarya slip lock');
  assert.ok(blue.nipyAssignment, 'the NIPY issuance history stays');

  const index = (await adminDb.doc(`AttendanceIdentityIndex/${nipyIndexId}`).get()).data()!;
  assert.equal(index.employeeId, 'Loyalis_046');
  assert.equal(index.employeeCollection, 'Employees_Loyalis');

  const account = (await adminDb.doc(`users/${worker.uid}`).get()).data()!;
  assert.equal(account.role, 'loyalis');
  assert.equal(account.linkedEmployeeId, 'Loyalis_046');
  assert.deepEqual(account.permittedCategories, ['REKTORAT']);

  const audits = await adminDb.collection('FinancialAuditLogs').get();
  assert.deepEqual(
    audits.docs.map((doc) => doc.data().action).sort(),
    ['EMPLOYEE_CONVERTED_TO_LOYALIS', 'USER_PROFILE_UPDATED'],
  );

  // The old slip survives untouched and still belongs to the Pekarya id.
  const oldSlip = (await adminDb.doc(`PayrollSlipStates/${slipPeriodKey}_BC_901`).get()).data()!;
  assert.equal(oldSlip.status, 'draft');

  // Same request replays; a new one is refused.
  response = await convert(loyalisAdmin.authorization, command);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).loyalisEmployeeId, 'Loyalis_046');
  response = await convert(loyalisAdmin.authorization, { ...command, requestId: 'conversion_test_0003' });
  assert.equal(response.status, 409);
  assert.equal((await adminDb.collection('Employees_Loyalis').get()).size, 2, 'no second record');

  // Each month is paid by exactly one record.
  const [blueDocs, loyalisDocs] = await Promise.all([
    adminDb.collection('Employees_BlueCollar').get(),
    adminDb.collection('Employees_Loyalis').get(),
  ]);
  const rosterFor = (target: string) =>
    buildPayrollRoster(
      blueDocs.docs.map((doc) => ({ id: doc.id, data: doc.data() })),
      loyalisDocs.docs.map((doc) => ({ id: doc.id, data: doc.data() })),
      target,
    ).entries.map((entry) => entry.employeeId);
  assert.deepEqual(rosterFor(previous), ['Loyalis_045']);
  assert.deepEqual(rosterFor(period), ['Loyalis_045', 'Loyalis_046']);

  // Rules: a browser client cannot reopen the closed record or forge a link,
  // while an ordinary Pekarya record can still be reactivated as before.
  const control = await clientPatch(
    loyalisAdmin.authorization,
    'Employees_BlueCollar/BC_902',
    'employment.status',
    { stringValue: 'active' },
  );
  assert.equal(control.status, 200, `an unconverted record stays editable: ${await control.text()}`);
  const reopen = await clientPatch(
    loyalisAdmin.authorization,
    'Employees_BlueCollar/BC_901',
    'employment.status',
    { stringValue: 'active' },
  );
  assert.equal(reopen.status, 403, 'a converted Pekarya record cannot be reactivated');
  const forge = await clientPatch(
    loyalisAdmin.authorization,
    'Employees_Loyalis/Loyalis_045',
    'conversion.fromEmployeeId',
    { stringValue: 'BC_777' },
  );
  assert.equal(forge.status, 403, 'conversion links are server-only');
  const ordinaryEdit = await clientPatch(
    loyalisAdmin.authorization,
    'Employees_Loyalis/Loyalis_046',
    'personal_info.phone',
    { stringValue: '081200000000' },
  );
  assert.equal(ordinaryEdit.status, 200, `a converted record stays editable: ${await ordinaryEdit.text()}`);

  // The employees page saves the whole record it loaded (setDoc merge), so
  // `conversion` — Timestamp included — goes back unchanged and must pass.
  const documentUrl = `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/Employees_Loyalis/Loyalis_046`;
  const loaded = await (await fetch(documentUrl, { headers: { authorization: loyalisAdmin.authorization } })).json();
  const fields = { ...loaded.fields };
  fields.personal_info.mapValue.fields.phone = { stringValue: '081299999999' };
  const mask = Object.keys(fields)
    .map((key) => `updateMask.fieldPaths=${encodeURIComponent(key)}`)
    .join('&');
  const fullSave = await fetch(`${documentUrl}?${mask}`, {
    method: 'PATCH',
    headers: { authorization: loyalisAdmin.authorization, 'content-type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  assert.equal(fullSave.status, 200, `saving the whole loaded record passes: ${await fullSave.text()}`);

  console.log(
    'Employee conversion emulator integration passed: auth, blockers, golongan guard, transaction writes, NIPY index, account switch, audit, idempotency, roster split and rules.',
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
