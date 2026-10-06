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
  const requestSwitch = (authorization: string, body: unknown) =>
    switchRoute.POST(
      new NextRequest('http://localhost/api/auth/switch-account', {
        method: 'POST',
        headers: { authorization, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );

  // One person (Indah) with three accounts, plus the near misses.
  const pekaryaHead = await signUp('biroumum@example.test');
  const loyalisHead = await signUp('psa@example.test');
  const loyalisSelf = await signUp('indah@example.test');
  const namesake = await signUp('namesake@example.test');
  const superAdmin = await signUp('super@example.test');
  const disabled = await signUp('disabled@example.test');
  const otherPerson = await signUp('siti@example.test');

  await adminDb.doc(`users/${pekaryaHead.uid}`).set({
    email: 'biroumum@example.test', displayName: 'Indah Wahyuni, SS', role: 'satker_head',
    permittedCategories: ['SOPIR'], disabled: false,
  });
  await adminDb.doc(`users/${loyalisHead.uid}`).set({
    email: 'psa@example.test', displayName: 'Indah Wahyuni, SS', role: 'satker_head_loyalis',
    permittedCategories: [], disabled: false,
  });
  await adminDb.doc(`users/${loyalisSelf.uid}`).set({
    email: 'indah@example.test', displayName: 'INDAH WAHYUNI, S.S', role: 'loyalis',
    permittedCategories: ['BIRO UMUM'], linkedEmployeeId: 'Loyalis_001', disabled: false,
  });
  await adminDb.doc(`users/${namesake.uid}`).set({
    email: 'namesake@example.test', displayName: 'Indah Wahyuni', role: 'satker_head',
    permittedCategories: ['TEKNISI'], disabled: false, accountGroupExcluded: true,
  });
  await adminDb.doc(`users/${superAdmin.uid}`).set({
    email: 'super@example.test', displayName: 'Indah Wahyuni', role: 'super_admin',
    permittedCategories: [], disabled: false,
  });
  await adminDb.doc(`users/${disabled.uid}`).set({
    email: 'disabled@example.test', displayName: 'Indah Wahyuni, SS', role: 'finance_verifier',
    permittedCategories: [], disabled: true,
  });
  await adminDb.doc(`users/${otherPerson.uid}`).set({
    email: 'siti@example.test', displayName: 'Siti Rofiah', role: 'loyalis',
    permittedCategories: [], linkedEmployeeId: 'Loyalis_002', disabled: false,
  });

  // 1. Each of Indah's accounts lists the other two, in role order.
  assert.deepEqual(
    (await listLinked(pekaryaHead.authorization)).map((account) => account.uid),
    [loyalisHead.uid, loyalisSelf.uid],
  );
  assert.deepEqual(
    (await listLinked(loyalisSelf.authorization)).map((account) => account.uid),
    [pekaryaHead.uid, loyalisHead.uid],
  );
  const listed = await listLinked(loyalisHead.authorization);
  assert.deepEqual(
    listed.map(({ uid, role, email }) => ({ uid, role, email })),
    [
      { uid: pekaryaHead.uid, role: 'satker_head', email: 'biroumum@example.test' },
      { uid: loyalisSelf.uid, role: 'loyalis', email: 'indah@example.test' },
    ],
  );
  // Opted out, Super Admin and an unrelated person see nobody.
  assert.deepEqual(await listLinked(namesake.authorization), []);
  assert.deepEqual(await listLinked(superAdmin.authorization), []);
  assert.deepEqual(await listLinked(otherPerson.authorization), []);

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
  assert.deepEqual(
    (await listLinked(session.authorization)).map((account) => account.uid),
    [pekaryaHead.uid, loyalisHead.uid],
  );
  // ...and can switch onward (and back).
  const onward = await requestSwitch(session.authorization, { targetUid: loyalisHead.uid });
  assert.equal(onward.status, 200, await onward.clone().text());

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
  assert.equal(audits.size, 2);

  // 3. Anything outside the person's own accounts is refused.
  for (const [target, status, why] of [
    [otherPerson.uid, 403, 'another person'],
    [namesake.uid, 403, 'an opted-out namesake'],
    [superAdmin.uid, 403, 'a Super Admin namesake'],
    [disabled.uid, 403, 'a disabled account'],
    ['no-such-uid', 403, 'an unknown uid'],
    [pekaryaHead.uid, 400, 'the current account'],
  ] as const) {
    const refused = await requestSwitch(pekaryaHead.authorization, { targetUid: target });
    assert.equal(refused.status, status, `switching to ${why}: ${await refused.clone().text()}`);
  }
  assert.equal((await requestSwitch(pekaryaHead.authorization, {})).status, 400);
  const fromSuperAdmin = await requestSwitch(superAdmin.authorization, { targetUid: pekaryaHead.uid });
  assert.equal(fromSuperAdmin.status, 403, 'Super Admin cannot switch by name');
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

  // 5. The Users page keeps the opt-out when an edit does not send it, and can lift it.
  const editNamesake = (extra: Record<string, unknown>) =>
    usersRoute.PUT(
      new NextRequest('http://localhost/api/admin/users', {
        method: 'PUT',
        headers: { authorization: superAdmin.authorization, 'content-type': 'application/json' },
        body: JSON.stringify({
          uid: namesake.uid,
          email: 'namesake@example.test',
          displayName: 'Indah Wahyuni',
          role: 'satker_head',
          permittedCategories: ['TEKNISI'],
          ...extra,
        }),
      }),
    );
  const keptOptOut = await editNamesake({});
  assert.equal(keptOptOut.status, 200, await keptOptOut.clone().text());
  assert.equal((await adminDb.doc(`users/${namesake.uid}`).get()).data()?.accountGroupExcluded, true);
  assert.deepEqual(await listLinked(namesake.authorization), []);

  const liftedOptOut = await editNamesake({ accountGroupExcluded: false });
  assert.equal(liftedOptOut.status, 200, await liftedOptOut.clone().text());
  assert.equal((await adminDb.doc(`users/${namesake.uid}`).get()).data()?.accountGroupExcluded, false);
  assert.ok(
    (await listLinked(pekaryaHead.authorization)).some((account) => account.uid === namesake.uid),
    'lifting the opt-out links the account again',
  );

  const invalidFlag = await editNamesake({ accountGroupExcluded: 'yes' });
  assert.equal(invalidFlag.status, 400);

  const created = await usersRoute.POST(
    new NextRequest('http://localhost/api/admin/users', {
      method: 'POST',
      headers: { authorization: superAdmin.authorization, 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'new-namesake@example.test',
        password: 'password123',
        displayName: 'Indah Wahyuni',
        role: 'satker_head',
        permittedCategories: ['KEBERSIHAN'],
        accountGroupExcluded: true,
      }),
    }),
  );
  assert.equal(created.status, 201, await created.clone().text());
  const createdUid = (await created.json()).user.uid as string;
  assert.equal((await adminDb.doc(`users/${createdUid}`).get()).data()?.accountGroupExcluded, true);
  assert.ok(
    !(await listLinked(pekaryaHead.authorization)).some((account) => account.uid === createdUid),
    'an account created with the opt-out never links',
  );

  console.log(
    'Account switch emulator integration passed: linked lists, switch session + claims, onward switch, audit, refusals (other person, opt-out, Super Admin, disabled in Firestore and Auth, self, unauthenticated), impersonation guard, and opt-out save/lift.',
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
