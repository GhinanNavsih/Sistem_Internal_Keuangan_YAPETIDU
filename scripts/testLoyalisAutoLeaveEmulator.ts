/**
 * Integration check for automatic cuti on unexcused Loyalis absences
 * (POST /api/attendance/loyalis/auto-leave). Writes only to local emulators.
 */
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

const PROJECT = 'demo-loyalis-auto-leave';
const PERIOD = '2026-09';

async function main() {
  if (
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== PROJECT ||
    !/^(localhost|127\.0\.0\.1):8188$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') ||
    !/^(localhost|127\.0\.0\.1):9198$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || '')
  ) {
    throw new Error('This test requires the demo Loyalis auto-leave Firestore and Auth emulators.');
  }

  const { adminDb: db } = await import('../src/lib/firebase-admin');
  const { POST } = await import('../src/app/api/attendance/loyalis/auto-leave/route');
  const { annualPaidLeaveDocumentId, applyApprovedLoyalisDayCreditsToPresence } = await import(
    '../src/lib/server/annualPaidLeave'
  );
  const { periodFridayDates } = await import('../src/lib/payroll/calendar');

  async function signUp(email: string, role: string) {
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
    await db.doc(`users/${identity.localId}`).set({
      role,
      displayName: email,
      permittedCategories: [],
    });
    return `Bearer ${identity.idToken}`;
  }
  const admin = await signUp('loyalis-admin@example.test', 'loyalis_admin');
  const outsider = await signUp('honorer@example.test', 'honorer');

  async function run(period: string, authorization = admin) {
    const response = await POST(
      new NextRequest('http://localhost/api/attendance/loyalis/auto-leave', {
        method: 'POST',
        headers: { authorization, 'content-type': 'application/json' },
        body: JSON.stringify({ period }),
      }),
    );
    return { status: response.status, body: await response.json() };
  }
  type ResultRow = {
    employeeId: string;
    covered: string[];
    released: string[];
    uncovered: Array<{ date: string; reason: string }>;
    skipped?: string;
  };
  const resultOf = (body: { results: ResultRow[] }, employeeId: string) =>
    body.results.find((item) => item.employeeId === employeeId);

  const requestRef = (employeeId: string, date: string) =>
    db.doc(`AnnualPaidLeaveRequests/${annualPaidLeaveDocumentId(employeeId, date)}`);
  const postRef = (employeeId: string, date: string) =>
    db.doc(`AnnualPaidLeavePayrollPosts/${annualPaidLeaveDocumentId(employeeId, date)}`);
  const usedDays = async (employeeId: string) =>
    Number((await db.doc(`AnnualPaidLeaveBalances/${employeeId}__2026`).get()).data()?.usedDays ?? 0);

  const logRow = (day: string, status: string) => ({
    Tanggal: `${day}-09-2026`,
    'Jam kerja': status,
  });
  const absent = (...days: string[]) => days.map((day) => logRow(day, 'Tidak Hadir'));
  async function setPresence(logs: Record<string, ReturnType<typeof logRow>[]>) {
    await db.doc('LoyalisPresence/2026_09').set({
      period: PERIOD,
      workingDays: 22,
      expectedHours: 6.5,
      entries: Object.fromEntries(
        Object.entries(logs).map(([employeeId, dailyLogs]) => [
          employeeId,
          { employeeId, minutes: 0, absenceMinutes: 0, dailyLogs },
        ]),
      ),
    });
  }

  // 3 days a year (5+ years), none yet (under 5 years), 6 days a year (10+ years).
  for (const [id, name, hired] of [
    ['L1', 'Ani', '2018-01-01'],
    ['L2', 'Budi', '2024-01-01'],
    ['L3', 'Citra', '2015-10-01'],
  ]) {
    await db.doc(`Employees_Loyalis/${id}`).set({
      personal_info: { name, status: 'AKTIF' },
      employment_profile: { date_of_hire: hired },
    });
  }
  await db.doc(`PayrollPeriods/${PERIOD}`).set({
    period: PERIOD,
    workCalendar: { revision: 1, annualVersion: 'TEST', premiumDates: periodFridayDates(PERIOD) },
  });
  // 4 Sep 2026 is a Friday, so it is not a working day.
  await setPresence({
    L1: absent('01', '02', '03', '04', '07', '08'),
    L2: absent('01'),
    L3: absent('01', '02'),
  });
  await db.doc('LoyalisPresenceCorrections/c1').set({
    employeeId: 'L3',
    date: '2026-09-02',
    status: 'pending',
    type: 'izin_resmi',
  });

  // ── Only Loyalis Admin / Super Admin may run it; it needs a saved presence.
  assert.equal((await run(PERIOD, outsider)).status, 403);
  assert.equal((await run('2026-10')).status, 409);

  // ── First run: earliest absent working days covered until the balance ends.
  const first = await run(PERIOD);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.applicable, true);
  assert.deepEqual(resultOf(first.body, 'L1')?.covered, ['2026-09-01', '2026-09-02', '2026-09-03']);
  assert.deepEqual(resultOf(first.body, 'L1')?.uncovered, [
    { date: '2026-09-07', reason: 'saldo_habis' },
    { date: '2026-09-08', reason: 'saldo_habis' },
  ]);
  assert.deepEqual(resultOf(first.body, 'L2')?.uncovered, [
    { date: '2026-09-01', reason: 'belum_berhak' },
  ]);
  assert.deepEqual(resultOf(first.body, 'L3')?.covered, ['2026-09-01']);
  assert.equal(await usedDays('L1'), 3);
  assert.equal(await usedDays('L2'), 0);
  assert.equal(await usedDays('L3'), 1);
  const covered = (await requestRef('L1', '2026-09-01').get()).data();
  assert.equal(covered?.status, 'approved');
  assert.equal(covered?.source, 'auto_absence');
  assert.equal(covered?.employeeKind, 'loyalis');
  assert.equal((await postRef('L1', '2026-09-01').get()).data()?.payrollMode, 'loyalis_presence_overlay');
  assert.equal((await requestRef('L1', '2026-09-04').get()).exists, false, 'a Friday is no absence');
  assert.equal((await requestRef('L3', '2026-09-02').get()).exists, false, 'a pending correction excuses the day');
  assert.equal((await requestRef('L2', '2026-09-01').get()).exists, false);

  // Payroll reads the day as CUTI through the posts, without the presence doc changing.
  const presence = (await db.doc('LoyalisPresence/2026_09').get()).data() as Record<string, unknown>;
  const overlaid = (await applyApprovedLoyalisDayCreditsToPresence(PERIOD, presence)) as {
    entries: Record<string, { dailyLogs: Array<{ Tanggal: string; 'Jam kerja': string }> }>;
  };
  assert.equal(
    overlaid.entries.L1.dailyLogs.find((row) => row.Tanggal === '01-09-2026')?.['Jam kerja'],
    'CUTI',
  );

  // ── Running again spends nothing more.
  const again = await run(PERIOD);
  for (const row of again.body.results as ResultRow[]) {
    assert.deepEqual([row.covered, row.released], [[], []], row.employeeId);
  }
  assert.equal(await usedDays('L1'), 3);
  assert.equal((await requestRef('L1', '2026-09-01').get()).data()?.revision, 1);

  // ── A day that turns out to be worked is released and the balance goes to the next absence.
  await setPresence({
    L1: [logRow('01', 'MASUK'), ...absent('02', '03', '04', '07', '08')],
    L2: absent('01'),
    L3: absent('01', '02'),
  });
  const fixed = await run(PERIOD);
  assert.deepEqual(resultOf(fixed.body, 'L1')?.released, ['2026-09-01']);
  assert.deepEqual(resultOf(fixed.body, 'L1')?.covered, ['2026-09-07']);
  assert.equal(await usedDays('L1'), 3);
  const released = (await requestRef('L1', '2026-09-01').get()).data();
  assert.equal(released?.status, 'withdrawn');
  assert.equal(released?.revision, 2);
  assert.equal((await postRef('L1', '2026-09-01').get()).exists, false);
  assert.equal((await requestRef('L1', '2026-09-07').get()).data()?.status, 'approved');

  // ── A submission made for a covered day takes it back out of the automatic set.
  await db.doc('LoyalisPresenceCorrections/c2').set({
    employeeId: 'L1',
    date: '2026-09-02',
    status: 'pending',
    type: 'izin_resmi',
  });
  const submitted = await run(PERIOD);
  assert.deepEqual(resultOf(submitted.body, 'L1')?.released, ['2026-09-02']);
  assert.deepEqual(resultOf(submitted.body, 'L1')?.covered, ['2026-09-08']);
  assert.equal(await usedDays('L1'), 3);

  // ── A rejected correction leaves the day absent, so it is covered.
  await db.doc('LoyalisPresenceCorrections/c1').set({ status: 'rejected' }, { merge: true });
  const rejected = await run(PERIOD);
  assert.deepEqual(resultOf(rejected.body, 'L3')?.covered, ['2026-09-02']);
  assert.equal(await usedDays('L3'), 2);

  // ── A final slip is never disturbed.
  await db.doc(`PayrollSlipStates/2026_09_L3`).set({ status: 'locked' });
  await setPresence({
    L1: [logRow('01', 'MASUK'), ...absent('02', '03', '04', '07', '08')],
    L2: absent('01'),
    L3: absent('01', '02', '03'),
  });
  const locked = await run(PERIOD);
  assert.match(resultOf(locked.body, 'L3')?.skipped || '', /final/);
  assert.equal(await usedDays('L3'), 2);
  assert.equal((await requestRef('L3', '2026-09-03').get()).exists, false);

  // ── A closed period and a month before the first applicable one change nothing.
  await db.doc(`PayrollPeriods/${PERIOD}`).set({ attendanceStatus: 'closed' }, { merge: true });
  await setPresence({ L1: absent('09') });
  const closed = await run(PERIOD);
  assert.equal(closed.body.applicable, false);
  assert.equal((await requestRef('L1', '2026-09-09').get()).exists, false);
  const early = await run('2026-08');
  assert.equal(early.body.applicable, false);

  // ── Every automatic change left an audit entry.
  const audit = await db.collection('FinancialAuditLogs').get();
  const count = (action: string) => audit.docs.filter((item) => item.data().action === action).length;
  assert.equal(count('ANNUAL_PAID_LEAVE_AUTO_APPLIED'), 7);
  assert.equal(count('ANNUAL_PAID_LEAVE_AUTO_RELEASED'), 2);

  console.log('Loyalis auto-leave emulator checks passed.');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
