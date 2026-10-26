/** Proposal ownership, lifecycle, retries and stale-write checks; local emulators only. */
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

const PROJECT = 'demo-proposal-lifecycle';
if (
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== PROJECT ||
  process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:18134' ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:19134'
) {
  throw new Error('Refusing to test outside the proposal lifecycle emulators.');
}

async function main() {
  const { adminDb, default: admin } = await import('../src/lib/firebase-admin');
  const { POST } = await import('../src/app/api/payroll/proposal-kegiatan/route');
  const { POST: approveLpj } = await import(
    '../src/app/api/payroll/proposal-kegiatan/approve/route'
  );
  const signup = async (name: string, role: string) => {
    const response = await fetch(
      `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: `${name}@example.test`,
          password: 'proposal-test-123',
          returnSecureToken: true,
        }),
      },
    );
    const identity = await response.json();
    assert.ok(identity.idToken);
    await adminDb
      .doc(`users/${identity.localId}`)
      .set({ role, displayName: name, permittedCategories: [], disabled: false });
    return { uid: identity.localId as string, token: identity.idToken as string };
  };
  const head = await signup('new-head', 'satker_head_loyalis');
  const other = await signup('other-head', 'satker_head_loyalis');
  const finance = await signup('finance', 'super_admin');
  const outsider = await signup('employee', 'loyalis');
  let requestNumber = 0;
  const invoke = (actor: typeof head, body: Record<string, unknown>, endpoint = POST) =>
    endpoint(
      new NextRequest('http://localhost/api/payroll/proposal-kegiatan', {
        method: 'POST',
        headers: { Authorization: `Bearer ${actor.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: `request_${++requestNumber}`,
          actorUid: actor.uid,
          ...body,
        }),
      }),
    );
  const expect = async (response: Response, status = 200) => {
    const result = await response.json();
    assert.equal(response.status, status, JSON.stringify(result));
    return result;
  };
  const id = '2026-10_prop_fresh-account';
  const command = {
    proposalId: id,
    period: '2026-10',
    action: 'save_draft',
    stage: 'proposal',
    expectedRevision: 0,
  };
  const data = {
    reportName: 'First event',
    pemasukanRows: [{ uraian: 'Pemasukan', rincianQty: '2', rincianRate: 100 }],
    pengeluaranRows: [],
    submittedBy: finance.uid,
    status: 'proposal_approved',
    period: '2026-09',
  };
  const requestId = 'create-and-retry';
  await expect(await invoke(head, { ...command, data, actorUid: other.uid }), 403);
  const first = await expect(await invoke(head, { ...command, data, requestId }));
  const doc = adminDb.doc(`ProposalKegiatan/${id}`);
  let stored = (await doc.get()).data()!;
  assert.equal(
    stored.submittedBy,
    head.uid,
    'server derives the creator from authenticated identity',
  );
  assert.equal(stored.period, '2026-10');
  assert.equal(stored.status, 'proposal_draft');
  assert.equal(first.revision, 1);
  assert.equal(
    stored.reportName,
    'First event',
    'an incomplete first draft persists before selecting a SatKer',
  );
  const retry = await expect(await invoke(head, { ...command, data, requestId }));
  assert.equal(
    retry.revision,
    1,
    'retry of an acknowledged or lost-response request is idempotent',
  );
  await expect(await invoke(other, { ...command, expectedRevision: 1, data }), 403);
  await expect(await invoke(outsider, { ...command, data }), 403);
  await expect(await invoke(head, { ...command, data, expectedRevision: 0 }), 409);

  const updated = await expect(
    await invoke(head, {
      ...command,
      expectedRevision: 1,
      data: { ...data, departmentUnit: 'REKTORAT' },
    }),
  );
  const submitted = await expect(
    await invoke(head, {
      ...command,
      action: 'submit_proposal',
      expectedRevision: updated.revision,
      data: { ...data, departmentUnit: 'REKTORAT' },
    }),
  );
  assert.equal(submitted.status, 'proposal_submitted');
  assert.equal(submitted.proposalQueueNumber, 1);
  await expect(
    await invoke(head, {
      ...command,
      action: 'review',
      decision: 'proposal_approved',
      expectedRevision: submitted.revision,
    }),
    403,
  );
  const approved = await expect(
    await invoke(finance, {
      ...command,
      action: 'review',
      decision: 'proposal_approved',
      expectedRevision: submitted.revision,
    }),
  );
  stored = (await doc.get()).data()!;
  assert.equal(stored.submittedBy, head.uid, 'admin approval preserves the head ownership');
  assert.equal(
    stored.lpjPemasukanRows[0].realisasi,
    200,
    'LPJ starts from the stored proposal budget',
  );
  assert.equal(stored.status, 'proposal_approved');
  const approvedSnapshot = JSON.stringify(stored);
  await expect(
    await invoke(head, {
      ...command,
      expectedRevision: submitted.revision,
      data: { reportName: 'Stale tab' },
    }),
    409,
  );
  await expect(
    await invoke(head, {
      ...command,
      expectedRevision: approved.revision,
      data: { reportName: 'Locked edit' },
    }),
    409,
  );
  assert.equal(JSON.stringify((await doc.get()).data()), approvedSnapshot);
  const adminSaved = await expect(
    await invoke(finance, {
      ...command,
      expectedRevision: approved.revision,
      data: { reportName: 'Admin corrected title' },
    }),
  );
  assert.equal((await doc.get()).data()?.submittedBy, head.uid, 'admin save cannot take ownership');

  const results = await Promise.all([
    invoke(finance, {
      ...command,
      expectedRevision: adminSaved.revision,
      data: { reportName: 'Concurrent one' },
    }),
    invoke(finance, {
      ...command,
      expectedRevision: adminSaved.revision,
      data: { reportName: 'Concurrent two' },
    }),
  ]);
  assert.deepEqual(
    results.map((result) => result.status).sort(),
    [200, 409],
    'only one concurrent revision can win',
  );
  const version = (await doc.get()).data()!.revision;
  const lpj = await expect(
    await invoke(head, {
      ...command,
      action: 'save_lpj',
      stage: 'lpj',
      expectedRevision: version,
      data: {
        lpjPemasukanRows: [
          { uraian: 'Laporan', rincianQty: '1', rincianRate: 300, realisasi: 250 },
        ],
        lpjPengeluaranRows: [],
        reportName: 'Must not replace approved proposal',
        submittedBy: finance.uid,
      },
    }),
  );
  assert.equal(lpj.status, 'lpj_draft');
  assert.notEqual((await doc.get()).data()?.reportName, 'Must not replace approved proposal');
  const lpjSubmitted = await expect(
    await invoke(head, {
      ...command,
      action: 'submit_lpj',
      stage: 'lpj',
      expectedRevision: lpj.revision,
      data: { lpjPengeluaranRows: [], expenseReports: [] },
    }),
  );
  await expect(
    await invoke(finance, { proposalId: id, expectedRevision: lpj.revision }, approveLpj),
    409,
  );
  await expect(
    await invoke(finance, { proposalId: id, expectedRevision: lpjSubmitted.revision }, approveLpj),
  );
  assert.equal((await doc.get()).data()?.status, 'lpj_approved');
  assert.equal((await doc.get()).data()?.submittedBy, head.uid);
  assert.equal((await doc.get()).data()?.revision, lpjSubmitted.revision + 1);
  assert.ok(
    (await adminDb.collection('FinancialAuditLogs').where('entityId', '==', id).get()).size >= 7,
  );

  const secondId = '2026-10_prop_other-head';
  const second = await expect(
    await invoke(other, {
      ...command,
      proposalId: secondId,
      data: { reportName: 'Other event', departmentUnit: 'REKTORAT' },
    }),
  );
  const secondSubmitted = await expect(
    await invoke(other, {
      ...command,
      proposalId: secondId,
      action: 'submit_proposal',
      expectedRevision: second.revision,
      data: { reportName: 'Other event', departmentUnit: 'REKTORAT' },
    }),
  );
  assert.equal(secondSubmitted.proposalQueueNumber, 2);
  const resumedId = '2026-10_prop_navigation-during-request';
  await expect(
    await invoke(head, {
      ...command,
      proposalId: resumedId,
      data: { reportName: 'Before navigation' },
      requestId: 'own-predecessor',
    }),
  );
  const resumed = await expect(
    await invoke(head, {
      ...command,
      proposalId: resumedId,
      predecessorRequestIds: ['own-predecessor'],
      data: { reportName: 'Latest input after navigation' },
    }),
  );
  assert.equal(
    resumed.revision,
    2,
    'a remounted page can continue its own in-flight write without a false conflict',
  );
  assert.equal(
    (await adminDb.doc(`ProposalKegiatan/${resumedId}`).get()).data()?.reportName,
    'Latest input after navigation',
  );
  await expect(
    await invoke(finance, {
      ...command,
      proposalId: resumedId,
      predecessorRequestIds: [
        (await adminDb.doc(`ProposalKegiatan/${resumedId}`).get()).data()?.lastWriteId,
      ],
      data: { reportName: 'Different actor cannot claim ancestry' },
    }),
    409,
  );
  await adminDb.doc('PayrollPeriods/2026-10').set({ attendanceStatus: 'closed' });
  await expect(
    await invoke(finance, {
      ...command,
      expectedRevision: secondSubmitted.revision,
      proposalId: secondId,
      data: { reportName: 'Closed' },
    }),
    409,
  );
  await adminDb.doc('PayrollPeriods/2026-10').set({ attendanceStatus: 'open' });
  console.log(
    'PASS API: fresh accounts, durable partial drafts, ownership, idempotency, queue order, concurrent revisions, approval, LPJ and closed periods.',
  );

  // Exercise the old browser's exact write pattern through deployed-equivalent rules.
  const restPath = `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/ProposalKegiatan/${id}`;
  const legacyOwnerWrite = await fetch(`${restPath}?updateMask.fieldPaths=submittedBy`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${finance.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { submittedBy: { stringValue: finance.uid } } }),
  });
  assert.equal(
    legacyOwnerWrite.status,
    403,
    'old admin autosave must be forbidden from changing the stored owner',
  );
  const legacyStatusWrite = await fetch(`${restPath}?updateMask.fieldPaths=status`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${head.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { status: { stringValue: 'proposal_draft' } } }),
  });
  assert.equal(legacyStatusWrite.status, 403, 'old head autosave must not revert an approval');
  const read = await fetch(restPath, { headers: { Authorization: `Bearer ${head.token}` } });
  assert.equal(read.status, 200, 'the head can still read their approved event');
  assert.equal((await doc.get()).data()?.submittedBy, head.uid);
  console.log('PASS Firestore rules: legacy browser writes cannot steal or revert proposals.');

  const verifier = await signup('verifier', 'finance_verifier');
  const retiredRef = adminDb.doc('PelaporanKegiatan/retired-existing');
  const retiredFixture = { period: '2026-10', reportName: 'Retired test report', submittedBy: head.uid };
  await retiredRef.set(retiredFixture);
  const retiredBase = `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/PelaporanKegiatan`;
  for (const actor of [head, finance, verifier]) {
    const headers = { Authorization: `Bearer ${actor.token}`, 'Content-Type': 'application/json' };
    const create = await fetch(`${retiredBase}/retired-new-${actor.uid}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ fields: { period: { stringValue: '2026-10' }, reportName: { stringValue: 'Recreated by old tab' } } }),
    });
    assert.equal(create.status, 403, 'retired reporting tabs cannot recreate deleted test reports');
    const update = await fetch(`${retiredBase}/retired-existing?updateMask.fieldPaths=reportName`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ fields: { reportName: { stringValue: 'Old tab autosave' } } }),
    });
    assert.equal(update.status, 403, 'retired reports cannot be updated by former editors');
    const remove = await fetch(`${retiredBase}/retired-existing`, { method: 'DELETE', headers });
    assert.equal(remove.status, 403, 'retired reports can only be cleaned up by the trusted server');
    const legacyRead = await fetch(`${retiredBase}/retired-existing`, { headers });
    assert.equal(legacyRead.status, 200, 'older application versions retain their existing read access');
  }
  assert.deepEqual((await retiredRef.get()).data(), retiredFixture);
  assert.equal((await adminDb.collection('PelaporanKegiatan').get()).size, 1);
  console.log('PASS Firestore rules: retired reporting writes are denied for heads, Super Admin and finance verifiers.');
  await admin.app().delete();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
