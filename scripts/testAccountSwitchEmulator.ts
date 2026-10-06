/**
 * "Ganti Peran" (switching between one person's accounts) against the Auth +
 * Firestore emulators ONLY. Never run against real accounts:
 * `npm run test:account-switch:integration`.
 */
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

const PROJECT = 'demo-account-switch';

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

/** What the browser does with the token the switch returns. */
async function signInWithCustomToken(token: string) {
  const response = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=demo`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, returnSecureToken: true }),
    },
  );
  const identity = await response.json();
  assert.ok(identity.idToken, JSON.stringify(identity));
  const claims = JSON.parse(
    Buffer.from(String(identity.idToken).split('.')[1], 'base64url').toString('utf8'),
  );
  return { claims, authorization: `Bearer ${identity.idToken}` };
}

async function main() {
  if (
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== PROJECT ||
    !/^(127\.0\.0\.1|localhost):8188$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') ||
    !/^(127\.0\.0\.1|localhost):9198$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || '')
  ) {
    throw new Error(`Refusing to run outside the ${PROJECT} Auth + Firestore emulators.`);
  }
  const { adminAuth, adminDb } = await import('../src/lib/firebase-admin');
  const linkedRoute = await import('../src/app/api/auth/linked-accounts/route');
  const switchRoute = await import('../src/app/api/auth/switch-account/route');
  const usersRoute = await import('../src/app/api/admin/users/route');

  const listLinked = async (authorization: string) => {
    const response = await linkedRoute.GET(
      new NextRequest('http://localhost/api/auth/linked-accounts', { headers: { authorization } }),
    );
    assert.equal(response.status, 200, await response.clone().text());
    const body = await response.json();
    return body.accounts as { uid: string; role: string; email: string }[];
  };
  const linkedUids = async (authorization: string) =>
    (await listLinked(authorization)).map((account) => account.uid);
  const requestSwitch = (authorization: string, body: unknown) =>
    switchRoute.POST(
      new NextRequest('http://localhost/api/auth/switch-account', {
        method: 'POST',
        headers: { authorization, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );

  // Employee records. Loyalis_046 shares Indah's name but is someone else;
  // BC_061 was converted to Loyalis_301.
  await adminDb.doc('Employees_Loyalis/Loyalis_045').set({
    personal_info: { name: 'Indah Wahyuni, SS', status: 'AKTIF' },
  });
  await adminDb.doc('Employees_Loyalis/Loyalis_046').set({
    personal_info: { name: 'Indah Wahyuni', status: 'AKTIF' },
  });
  await adminDb.doc('Employees_BlueCollar/BC_061').set({
    name: 'Ahmad Fauzi',
    employment: { status: 'inactive', jobCategory: 'SOPIR' },
    conversion: { toCollection: 'Employees_Loyalis', toEmployeeId: 'Loyalis_301', effectivePeriod: '2026-10' },
  });
  await adminDb.doc('Employees_Loyalis/Loyalis_301').set({
    personal_info: { name: 'Ahmad Fauzi', status: 'AKTIF' },
    conversion: { fromCollection: 'Employees_BlueCollar', fromEmployeeId: 'BC_061', effectivePeriod: '2026-10' },
  });

  // Indah's three accounts, plus the near misses.
  const pekaryaHead = await signUp('biroumum@example.test');
  const loyalisHead = await signUp('psa@example.test');
  const loyalisSelf = await signUp('indah@example.test');
  const namesake = await signUp('namesake@example.test');
  const unlinked = await signUp('unlinked@example.test');
  const superAdmin = await signUp('super@example.test');
  const disabled = await signUp('disabled@example.test');
  const otherPerson = await signUp('siti@example.test');
  const convertedSelf = await signUp('ahmad@example.test');
  const convertedHead = await signUp('ahmad-head@example.test');

  const seed = (uid: string, profile: Record<string, unknown>) =>
    adminDb.doc(`users/${uid}`).set({ permittedCategories: [], disabled: false, ...profile });
  await seed(pekaryaHead.uid, {
    email: 'biroumum@example.test', displayName: 'Indah Wahyuni, SS', role: 'satker_head',
    permittedCategories: ['SOPIR'], personEmployeeId: 'Loyalis_045',
  });
  await seed(loyalisHead.uid, {
    email: 'psa@example.test', displayName: 'Indah W.', role: 'satker_head_loyalis',
    personEmployeeId: 'Loyalis_045',
  });
  await seed(loyalisSelf.uid, {
    email: 'indah@example.test', displayName: 'INDAH WAHYUNI, S.S', role: 'loyalis',
    linkedEmployeeId: 'Loyalis_045', personEmployeeId: 'Loyalis_045',
  });
  await seed(namesake.uid, {
    email: 'namesake@example.test', displayName: 'Indah Wahyuni, SS', role: 'satker_head',
    permittedCategories: ['TEKNISI'], personEmployeeId: 'Loyalis_046',
  });
  await seed(unlinked.uid, {
    email: 'unlinked@example.test', displayName: 'Indah Wahyuni, SS', role: 'satker_head',
  });
  await seed(superAdmin.uid, {
    email: 'super@example.test', displayName: 'Indah Wahyuni', role: 'super_admin',
    personEmployeeId: 'Loyalis_045',
  });
  await seed(disabled.uid, {
    email: 'disabled@example.test', displayName: 'Indah Wahyuni, SS', role: 'finance_verifier',
    personEmployeeId: 'Loyalis_045', disabled: true,
  });
  await seed(otherPerson.uid, {
    email: 'siti@example.test', displayName: 'Siti Rofiah', role: 'loyalis',
    linkedEmployeeId: 'Loyalis_002', personEmployeeId: 'Loyalis_002',
  });
  await seed(convertedSelf.uid, {
    email: 'ahmad@example.test', displayName: 'Ahmad Fauzi', role: 'loyalis',
    linkedEmployeeId: 'Loyalis_301', personEmployeeId: 'Loyalis_301',
  });
  await seed(convertedHead.uid, {
    email: 'ahmad-head@example.test', displayName: 'Ahmad F.', role: 'satker_head',
    personEmployeeId: 'BC_061',
  });

  // 1. Accounts naming the same employee list each other, in role order, even
  //    under differently written names.
  assert.deepEqual(await linkedUids(pekaryaHead.authorization), [loyalisHead.uid, loyalisSelf.uid]);
  assert.deepEqual(await linkedUids(loyalisSelf.authorization), [pekaryaHead.uid, loyalisHead.uid]);
  const listed = await listLinked(loyalisHead.authorization);
  assert.deepEqual(
    listed.map(({ uid, role, email }) => ({ uid, role, email })),
    [
      { uid: pekaryaHead.uid, role: 'satker_head', email: 'biroumum@example.test' },
      { uid: loyalisSelf.uid, role: 'loyalis', email: 'indah@example.test' },
    ],
  );
  // A same-name account of another employee, an account naming no employee,
  // Super Admin and an unrelated person see nobody.
  assert.deepEqual(await linkedUids(namesake.authorization), []);
  assert.deepEqual(await linkedUids(unlinked.authorization), []);
  assert.deepEqual(await linkedUids(superAdmin.authorization), []);
  assert.deepEqual(await linkedUids(otherPerson.authorization), []);
  // An account still naming the closed Pekarya record of a converted employee
  // stays with the person, in both directions.
  assert.deepEqual(await linkedUids(convertedHead.authorization), [convertedSelf.uid]);
  assert.deepEqual(await linkedUids(convertedSelf.authorization), [convertedHead.uid]);

  // 2. A switch returns a session for the other account, and is audited.
  const switched = await requestSwitch(pekaryaHead.authorization, { targetUid: loyalisSelf.uid });
  assert.equal(switched.status, 200, await switched.clone().text());
  const switchBody = await switched.json();
  assert.equal(typeof switchBody.customToken, 'string');
  assert.equal(switchBody.targetProfile.uid, loyalisSelf.uid);
  assert.equal(switchBody.targetProfile.role, 'loyalis');

  const session = await signInWithCustomToken(switchBody.customToken);
  assert.equal(session.claims.user_id, loyalisSelf.uid, 'the new session belongs to the target account');
  assert.equal(session.claims.switchedFrom, pekaryaHead.uid);
  // The new session is accepted by every protected route, as the target account.
  assert.deepEqual(await linkedUids(session.authorization), [pekaryaHead.uid, loyalisHead.uid]);
  // ...and can switch onward.
  const onward = await requestSwitch(session.authorization, { targetUid: loyalisHead.uid });
  assert.equal(onward.status, 200, await onward.clone().text());
  // The converted employee's pair switches too.
  const convertedSwitch = await requestSwitch(convertedHead.authorization, { targetUid: convertedSelf.uid });
  assert.equal(convertedSwitch.status, 200, await convertedSwitch.clone().text());

  const audits = await adminDb
    .collection('audit_logs')
    .where('action', '==', 'ACCOUNT_SWITCHED')
    .get();
  const firstAudit = audits.docs
    .map((document) => document.data())
    .find((entry) => entry.actorUid === pekaryaHead.uid);
  assert.ok(firstAudit, 'the switch is in audit_logs');
  assert.equal(firstAudit.targetUid, loyalisSelf.uid);
  assert.equal(firstAudit.actorRole, 'satker_head');
  assert.equal(firstAudit.targetRole, 'loyalis');
  assert.equal(audits.size, 3);

  // 3. Anything outside the person's own accounts is refused.
  for (const [target, status, why] of [
    [otherPerson.uid, 403, 'another person'],
    [namesake.uid, 403, 'a same-name account of another employee'],
    [unlinked.uid, 403, 'a same-name account naming no employee'],
    [superAdmin.uid, 403, 'a Super Admin naming the same employee'],
    [disabled.uid, 403, 'a disabled account'],
    ['no-such-uid', 403, 'an unknown uid'],
    [pekaryaHead.uid, 400, 'the current account'],
  ] as const) {
    const refused = await requestSwitch(pekaryaHead.authorization, { targetUid: target });
    assert.equal(refused.status, status, `switching to ${why}: ${await refused.clone().text()}`);
  }
  assert.equal((await requestSwitch(pekaryaHead.authorization, {})).status, 400);
  const fromSuperAdmin = await requestSwitch(superAdmin.authorization, { targetUid: pekaryaHead.uid });
  assert.equal(fromSuperAdmin.status, 403, 'Super Admin never switches');
  const fromUnlinked = await requestSwitch(unlinked.authorization, { targetUid: pekaryaHead.uid });
  assert.equal(fromUnlinked.status, 403, 'a same name alone is not a link');
  const unauthenticated = await switchRoute.POST(
    new NextRequest('http://localhost/api/auth/switch-account', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetUid: loyalisSelf.uid }),
    }),
  );
  assert.equal(unauthenticated.status, 401);

  // An account disabled only in Firebase Auth is refused too.
  await adminAuth.updateUser(loyalisSelf.uid, { disabled: true });
  const toAuthDisabled = await requestSwitch(pekaryaHead.authorization, { targetUid: loyalisSelf.uid });
  assert.equal(toAuthDisabled.status, 403, await toAuthDisabled.clone().text());
  await adminAuth.updateUser(loyalisSelf.uid, { disabled: false });

  // 4. Inside a Super Admin impersonation session there is nothing to switch to.
  const impersonationToken = await adminAuth.createCustomToken(pekaryaHead.uid, {
    impersonatedBy: superAdmin.uid,
  });
  const impersonation = await signInWithCustomToken(impersonationToken);
  assert.deepEqual(await listLinked(impersonation.authorization), []);
  const fromImpersonation = await requestSwitch(impersonation.authorization, {
    targetUid: loyalisSelf.uid,
  });
  assert.equal(fromImpersonation.status, 409, await fromImpersonation.clone().text());

  // 5. The Users page: the list shows who links to whom, decided as a switch would.
  const usersList = await usersRoute.GET(
    new NextRequest('http://localhost/api/admin/users', {
      headers: { authorization: superAdmin.authorization },
    }),
  );
  assert.equal(usersList.status, 200, await usersList.clone().text());
  const listedUsers = (await usersList.json()).users as { uid: string; linkedAccountUids: string[] }[];
  const linkedOnPage = (uid: string) => listedUsers.find((item) => item.uid === uid)?.linkedAccountUids;
  assert.deepEqual(linkedOnPage(pekaryaHead.uid), [loyalisHead.uid, loyalisSelf.uid]);
  assert.deepEqual(linkedOnPage(convertedHead.uid), [convertedSelf.uid]);
  assert.deepEqual(linkedOnPage(namesake.uid), []);
  assert.deepEqual(linkedOnPage(superAdmin.uid), []);

  // 6. Saving an account: the employee is kept when not sent, can be changed
  //    and cleared, must exist, and follows the linked employee for
  //    employee-linked roles. Super Admin never keeps one.
  const editNamesake = (extra: Record<string, unknown>) =>
    usersRoute.PUT(
      new NextRequest('http://localhost/api/admin/users', {
        method: 'PUT',
        headers: { authorization: superAdmin.authorization, 'content-type': 'application/json' },
        body: JSON.stringify({
          uid: namesake.uid,
          email: 'namesake@example.test',
          displayName: 'Indah Wahyuni, SS',
          role: 'satker_head',
          permittedCategories: ['TEKNISI'],
          ...extra,
        }),
      }),
    );
  const storedPerson = async (uid: string) =>
    (await adminDb.doc(`users/${uid}`).get()).data()?.personEmployeeId;

  const kept = await editNamesake({});
  assert.equal(kept.status, 200, await kept.clone().text());
  assert.equal(await storedPerson(namesake.uid), 'Loyalis_046', 'an edit without the field keeps it');

  const moved = await editNamesake({ personEmployeeId: 'Loyalis_045' });
  assert.equal(moved.status, 200, await moved.clone().text());
  assert.equal(await storedPerson(namesake.uid), 'Loyalis_045');
  assert.ok((await linkedUids(pekaryaHead.authorization)).includes(namesake.uid));

  const cleared = await editNamesake({ personEmployeeId: null });
  assert.equal(cleared.status, 200, await cleared.clone().text());
  assert.equal(await storedPerson(namesake.uid), null);
  assert.ok(!(await linkedUids(pekaryaHead.authorization)).includes(namesake.uid));

  assert.equal((await editNamesake({ personEmployeeId: 'Loyalis_999' })).status, 409, 'unknown employee');
  assert.equal((await editNamesake({ personEmployeeId: 'Loyalis/045' })).status, 400, 'not an id');
  assert.equal((await editNamesake({ personEmployeeId: 45 })).status, 400, 'not a string');

  const promoted = await editNamesake({ role: 'super_admin', personEmployeeId: 'Loyalis_045' });
  assert.equal(promoted.status, 200, await promoted.clone().text());
  assert.equal(await storedPerson(namesake.uid), null, 'Super Admin never names an employee');

  const createAccount = (body: Record<string, unknown>) =>
    usersRoute.POST(
      new NextRequest('http://localhost/api/admin/users', {
        method: 'POST',
        headers: { authorization: superAdmin.authorization, 'content-type': 'application/json' },
        body: JSON.stringify({ password: 'password123', permittedCategories: [], ...body }),
      }),
    );
  const newHead = await createAccount({
    email: 'new-head@example.test',
    displayName: 'Bu Indah',
    role: 'satker_head',
    permittedCategories: ['KEBERSIHAN'],
    personEmployeeId: 'Loyalis_045',
  });
  assert.equal(newHead.status, 201, await newHead.clone().text());
  const newHeadUid = (await newHead.json()).user.uid as string;
  assert.equal(await storedPerson(newHeadUid), 'Loyalis_045');
  assert.ok((await linkedUids(pekaryaHead.authorization)).includes(newHeadUid));

  const newLoyalis = await createAccount({
    email: 'other-indah@example.test',
    displayName: 'Indah Wahyuni',
    role: 'loyalis',
    linkedEmployeeId: 'Loyalis_046',
    personEmployeeId: 'Loyalis_045',
  });
  assert.equal(newLoyalis.status, 201, await newLoyalis.clone().text());
  const newLoyalisUid = (await newLoyalis.json()).user.uid as string;
  assert.equal(
    await storedPerson(newLoyalisUid),
    'Loyalis_046',
    'an employee-linked account always belongs to its linked employee',
  );

  console.log(
    'Account switch emulator integration passed: linked lists by employee (incl. converted Pekarya), switch session + claims, onward switch, audit, refusals (another person, same-name other employee, no employee, Super Admin, disabled in Firestore and Auth, self, unauthenticated), impersonation guard, Users list links, and employee save/keep/clear/validate.',
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
