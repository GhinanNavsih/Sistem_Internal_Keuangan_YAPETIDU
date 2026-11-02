/**
 * Automatic monthly Satpam duty plan against the Firestore emulator ONLY.
 * Never run against production: `npm run test:satpam-auto-plan:integration`.
 */
import assert from 'node:assert/strict';

const PROJECT = 'demo-satpam-auto-plan';
const DECEMBER_FIRST = new Date('2026-12-01T05:00:00+07:00');
const DECEMBER_TENTH = new Date('2026-12-10T12:00:00+07:00');

async function main() {
  if (
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== PROJECT ||
    !/^(127\.0\.0\.1|localhost):8188$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')
  ) {
    throw new Error('Refusing to run outside the Firestore emulator.');
  }
  const { adminDb: db } = await import('../src/lib/firebase-admin');
  const { ensureCurrentSatpamDutyPlans } = await import('../src/lib/server/satpamDutyPlan');
  const { validateAndGenerateSatpamDutyPlan, SATPAM_DUTY_PLAN_ROTATION_VERSION, SATPAM_ROTATION_SLOTS } =
    await import('../src/lib/payroll/satpamDutyPlan');
  const { getSatpamShiftForTeam } = await import('../src/utils/satpamRotation');

  const roster = (team: number) =>
    Array.from({ length: 10 }, (_, index) => `T${team}_G${index + 1}`);

  async function clearAll() {
    for (const collection of await db.listCollections()) {
      const documents = await collection.listDocuments();
      await Promise.all(documents.map((document) => document.delete()));
    }
  }

  async function seedTeam(team: number, overrides: Record<string, unknown> = {}) {
    const ids = roster(team);
    const [ketuaShiftId, fixedPost9EmployeeId, ...rotating] = ids;
    for (const id of ids) {
      await db.doc(`Employees_BlueCollar/${id}`).set({
        name: id,
        nipy: id,
        employment: { status: 'active', jobCategory: 'SATPAM' },
        flags: { isActive: true },
      });
    }
    await db.doc(`SatpamShiftTeams/team_${team}`).set({
      ketuaShiftId,
      memberEmployeeIds: ids.slice(1),
    });
    const generation = validateAndGenerateSatpamDutyPlan({
      periodStart: '2026-11-01',
      periodEnd: '2026-11-30',
      rosterEmployeeIds: ids,
      ketuaShiftId,
      fixedPost9EmployeeId,
      firstDayAssignments: SATPAM_ROTATION_SLOTS.map((slot, index) => ({
        slot,
        employeeId: rotating[index],
      })),
      shiftNameForDate: (date) => getSatpamShiftForTeam(team, date),
    });
    await db.doc(`SatpamDutyPlans/202611__team_${team}`).set({
      period: '2026-11',
      teamId: `team_${team}`,
      schemaVersion: 2,
      rotationVersion: SATPAM_DUTY_PLAN_ROTATION_VERSION,
      status: 'published',
      revision: 2,
      ketuaShiftId,
      fixedPost9EmployeeId,
      rosterEmployeeIds: ids,
      seedDays: generation.seedDays,
      generatedDays: generation.generatedDays,
      lateBackfillDates: [],
      staleDates: [],
      ...overrides,
    });
    return generation;
  }

  const december = async (team: number) =>
    (await db.doc(`SatpamDutyPlans/202612__team_${team}`).get()).data();

  // Publishes all three regu, continuing the rotation, recorded as the system.
  await clearAll();
  const november = await seedTeam(1);
  await seedTeam(2);
  await seedTeam(3);
  await ensureCurrentSatpamDutyPlans(DECEMBER_FIRST);
  for (const team of [1, 2, 3]) {
    const plan = await december(team);
    assert.equal(plan?.status, 'published');
    assert.equal(plan?.autoPublished, true);
    assert.equal(plan?.publishedBy, 'system');
    assert.equal(plan?.revision, 1);
    assert.equal(plan?.rotationStartMode, 'continued');
    assert.equal(plan?.continuedFromPlanId, `202611__team_${team}`);
    assert.equal(plan?.generatedDays.length, 31);
    assert.equal(plan?.fixedPost9EmployeeId, `T${team}_G2`);
  }
  const lastNovemberSeed = november.seedDays[november.generatedDays[29].sourceSeedIndex];
  const firstDecember = (await december(1))?.generatedDays[0];
  assert.notEqual(firstDecember.offDutyEmployeeId, lastNovemberSeed.offDutyEmployeeId);
  assert.equal(firstDecember.shiftName, getSatpamShiftForTeam(1, '2026-12-01'));
  const audits = await db
    .collection('FinancialAuditLogs')
    .where('action', '==', 'SATPAM_DUTY_PLAN_AUTO_PUBLISHED')
    .get();
  assert.equal(audits.size, 3);
  assert.equal(audits.docs[0].data().actorUid, 'system');
  assert.equal(audits.docs[0].data().actorRole, 'system');
  assert.equal((await db.doc('SatpamDutyPlanRevisions/202612__team_1__r1').get()).data()?.action, 'auto_published');

  // A second visit changes nothing, and simultaneous visits make no duplicates.
  await Promise.all([
    ensureCurrentSatpamDutyPlans(DECEMBER_FIRST),
    ensureCurrentSatpamDutyPlans(DECEMBER_FIRST),
  ]);
  assert.equal((await december(1))?.revision, 1);
  assert.equal(
    (await db.collection('FinancialAuditLogs').where('action', '==', 'SATPAM_DUTY_PLAN_AUTO_PUBLISHED').get()).size,
    3,
  );

  // Simultaneous visits to a month nobody has published yet still write once.
  await clearAll();
  await seedTeam(1);
  await Promise.all([
    ensureCurrentSatpamDutyPlans(DECEMBER_FIRST),
    ensureCurrentSatpamDutyPlans(DECEMBER_FIRST),
    ensureCurrentSatpamDutyPlans(DECEMBER_FIRST),
  ]);
  assert.equal((await december(1))?.revision, 1);
  assert.equal(
    (await db.collection('FinancialAuditLogs').where('action', '==', 'SATPAM_DUTY_PLAN_AUTO_PUBLISHED').get()).size,
    1,
  );

  // An existing plan is untouched, including a stale one.
  await clearAll();
  await seedTeam(1);
  await db.doc('SatpamDutyPlans/202612__team_1').set({ period: '2026-12', teamId: 'team_1', status: 'stale', revision: 4 });
  await ensureCurrentSatpamDutyPlans(DECEMBER_FIRST);
  assert.equal((await december(1))?.status, 'stale');
  assert.equal((await december(1))?.revision, 4);

  // A changed roster, a stale previous plan, or no previous plan: manual form.
  await clearAll();
  await seedTeam(1);
  await db.doc('Employees_BlueCollar/T1_NEW').set({
    name: 'T1_NEW',
    employment: { status: 'active', jobCategory: 'SATPAM' },
    flags: { isActive: true },
  });
  await db.doc('SatpamShiftTeams/team_1').set({
    ketuaShiftId: 'T1_G1',
    memberEmployeeIds: [...roster(1).slice(1, -1), 'T1_NEW'],
  });
  await seedTeam(2, { status: 'stale' });
  await db.doc('SatpamShiftTeams/team_3').set({ ketuaShiftId: 'T3_G1', memberEmployeeIds: roster(3).slice(1) });
  await ensureCurrentSatpamDutyPlans(DECEMBER_FIRST);
  for (const team of [1, 2, 3]) assert.equal(await december(team), undefined);

  // A closed period and an inactive member both leave the regu to the form, and
  // one regu's failure doesn't stop the next one.
  await clearAll();
  await seedTeam(1);
  await db.doc('PayrollPeriods/2026-12').set({ attendanceStatus: 'closed' });
  await ensureCurrentSatpamDutyPlans(DECEMBER_FIRST);
  assert.equal(await december(1), undefined);
  await clearAll();
  await seedTeam(1);
  await seedTeam(2);
  await db.doc('Employees_BlueCollar/T1_G5').set({
    name: 'T1_G5',
    employment: { status: 'inactive', jobCategory: 'SATPAM' },
    flags: { isActive: false },
  });
  await ensureCurrentSatpamDutyPlans(DECEMBER_FIRST);
  assert.equal(await december(1), undefined);
  assert.equal((await december(2))?.status, 'published');

  // Locked slips block it, as they block a manual publish.
  await clearAll();
  await seedTeam(1);
  await db.doc('PayrollSlipStates/2026_12_T1_G1').set({ period: '2026_12', status: 'paid' });
  await ensureCurrentSatpamDutyPlans(DECEMBER_FIRST);
  assert.equal(await december(1), undefined);

  // Published partway through the month: started dates are flagged as late, and
  // an existing report on one of those dates goes back for review.
  await clearAll();
  await seedTeam(1);
  await db.doc('ShiftOccurrences/occurrence_late').set({
    teamId: 'team_1',
    dutyDate: '2026-12-02',
    payrollPeriod: '2026-12',
    status: 'pending_review',
    anomalyCodes: ['DUTY_PLAN_MISSING'],
    reportIds: [],
  });
  await ensureCurrentSatpamDutyPlans(DECEMBER_TENTH);
  const latePlan = await december(1);
  assert.ok(latePlan?.lateBackfillDates.includes('2026-12-02'));
  assert.ok(!latePlan?.lateBackfillDates.includes('2026-12-20'));
  const occurrence = (await db.doc('ShiftOccurrences/occurrence_late').get()).data();
  assert.deepEqual(occurrence?.anomalyCodes, ['DUTY_PLAN_CHANGED_AFTER_REPORT']);
  assert.equal(occurrence?.dutyPlanId, '202612__team_1');

  console.log('Satpam auto-publish emulator test passed.');
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
