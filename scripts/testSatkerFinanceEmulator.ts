/** Full SatKer finance workflow against the Auth and Firestore emulators only. */
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

const PROJECT = 'demo-satker-finance';
if (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== PROJECT ||
    !/^(127\.0\.0\.1|localhost):8188$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') ||
    !/^(127\.0\.0\.1|localhost):9198$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || '') ||
    !/^(127\.0\.0\.1|localhost):9298$/.test(process.env.FIREBASE_STORAGE_EMULATOR_HOST || '')) {
  throw new Error('Refusing to run outside the demo-satker-finance emulators.');
}

async function signUp(email: string) {
  const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123', returnSecureToken: true }),
  });
  const identity = await response.json();
  assert.ok(identity.idToken, JSON.stringify(identity));
  return { uid: identity.localId as string, token: identity.idToken as string };
}

async function main() {
  const { adminDb, default: admin } = await import('../src/lib/firebase-admin');
  const { GET, POST } = await import('../src/app/api/satker-finance/route');
  const { GET: verify } = await import('../src/app/api/satker-finance/verify/route');
  const { GET: receiptGet } = await import('../src/app/api/satker-finance/receipt/route');
  const { adminStorage } = await import('../src/lib/firebase-admin');
  const adminStorageFileExists = async (path: string) => (await adminStorage.bucket().file(path).exists())[0];
  const bak = await signUp('bak@example.test');
  const head = await signUp('head@example.test');
  const secretary = await signUp('secretary@example.test');
  const outsider = await signUp('outsider@example.test');
  const rector = await signUp('rector@example.test');
  for (const [identity, role] of [[bak, 'super_admin'], [head, 'satker_head_loyalis'], [secretary, 'satker_finance_admin'], [outsider, 'satker_head_loyalis'], [rector, 'rector_finance']] as const) {
    await adminDb.collection('users').doc(identity.uid).set({ role, displayName: role, disabled: false });
  }
  await adminDb.collection('Employees_Loyalis').doc('private-test').set({ name: 'Private employee' });
  const firestoreRest = (actor: typeof bak, path: string) => fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`, { headers: { authorization: `Bearer ${actor.token}` } });
  assert.equal((await firestoreRest(secretary, `users/${secretary.uid}`)).status, 200);
  assert.equal((await firestoreRest(rector, `users/${rector.uid}`)).status, 200);
  assert.equal((await firestoreRest(secretary, 'Employees_Loyalis/private-test')).status, 403);
  assert.equal((await firestoreRest(rector, 'Employees_Loyalis/private-test')).status, 403);
  const invoke = (actor: typeof bak, body: Record<string, unknown>) => POST(new NextRequest('http://localhost/api/satker-finance', {
    method: 'POST', headers: { authorization: `Bearer ${actor.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
  const read = (actor: typeof bak, query: Record<string, string>) => GET(new NextRequest(`http://localhost/api/satker-finance?${new URLSearchParams(query)}`, {
    headers: { authorization: `Bearer ${actor.token}` },
  }));
  async function succeeds(response: Response) {
    const data = await response.json();
    assert.equal(response.status, 200, JSON.stringify(data));
    return data;
  }
  const base = { unitId: 'puskomnet', academicYear: '2026-2027' };
  await succeeds(await invoke(bak, { action: 'SAVE_UNIT', id: 'puskomnet', name: 'PUSKOMNET', headName: 'Kepala Unit', adminName: 'Bendahara', editorUids: [head.uid, secretary.uid] }));
  assert.equal((await read(outsider, { ...base, month: '9' })).status, 403);
  // A Kepala SatKer Loyalis on no book gets their own the first time they open the page, exactly once.
  const ownView = await succeeds(await read(outsider, { academicYear: '2026-2027', month: '9' }));
  assert.equal(ownView.units.length, 1);
  const ownUnit = ownView.units[0];
  assert.match(ownUnit.id, /^loyalis-/);
  assert.deepEqual(ownUnit.editorUids, [outsider.uid]);
  assert.equal((await succeeds(await read(outsider, { academicYear: '2026-2027', month: '9' }))).units.length, 1);
  assert.equal((await adminDb.collection('SatkerFinancialConfigAudit').where('target', '==', ownUnit.id).get()).size, 1);
  // A head Super Admin already assigned, and a finance secretary, are not given an extra book.
  assert.deepEqual((await succeeds(await read(head, { academicYear: '2026-2027', month: '9' }))).units.map((unit: { id: string }) => unit.id), ['puskomnet']);
  assert.equal((await succeeds(await read(secretary, { academicYear: '2026-2027', month: '9' }))).units.length, 1);
  // Removing a head from their own book sticks: it is not created again.
  await succeeds(await invoke(bak, { action: 'SAVE_UNIT', id: ownUnit.id, name: ownUnit.name, headName: ownUnit.headName, adminName: '', editorUids: [], expectedRevision: ownUnit.revision }));
  assert.equal((await succeeds(await read(outsider, { academicYear: '2026-2027', month: '9' }))).units.length, 0);
  assert.equal((await invoke(outsider, { ...base, action: 'POST_ENTRY', entryId: 'outsider-01', monthIndex: 9, date: '2026-09-01', kind: 'INFLOW', accountCode: '41000', paymentAccountCode: '10000', amount: 100, description: 'Tidak boleh' })).status, 403);
  assert.equal((await invoke(outsider, { ...base, action: 'SAVE_OPENING', openingBalances: {}, expectedRevision: 0 })).status, 403);
  assert.equal((await invoke(rector, { ...base, action: 'SAVE_OPENING', openingBalances: {}, expectedRevision: 0 })).status, 403);
  assert.equal((await invoke(bak, { ...base, action: 'SAVE_OPENING', openingBalances: { '10000': { debit: 1000, credit: 0 } }, expectedRevision: 0 })).status, 400);
  await succeeds(await invoke(head, { ...base, action: 'SAVE_OPENING', openingBalances: { '10000': { debit: 1000, credit: 0 }, '30000': { debit: 0, credit: 1000 } }, expectedRevision: 0 }));
  const receiptDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/3ocAAAAASUVORK5CYII=';
  const voucher = { ...base, action: 'POST_ENTRY', entryId: 'voucher-sep-001', monthIndex: 9, date: '2026-09-02', kind: 'EXPENSE', accountCode: '52101', paymentAccountCode: '10000', amount: 100, description: 'Perawatan lab', receiptDataUrl };
  await succeeds(await invoke(secretary, voucher));
  assert.equal((await succeeds(await invoke(secretary, voucher))).duplicate, true);
  const receiptUrl = `http://localhost/api/satker-finance/receipt?${new URLSearchParams({ ...base, entryId: 'voucher-sep-001' })}`;
  const photoResponse = await receiptGet(new NextRequest(receiptUrl, { headers: { authorization: `Bearer ${head.token}` } }));
  assert.equal(photoResponse.status, 200);
  assert.equal(photoResponse.headers.get('content-type'), 'image/png');
  assert.ok((await photoResponse.arrayBuffer()).byteLength > 20);
  assert.equal((await receiptGet(new NextRequest(receiptUrl, { headers: { authorization: `Bearer ${outsider.token}` } }))).status, 403);
  assert.equal((await invoke(head, { ...voucher, entryId: 'unbalanced-01', kind: 'ADVANCED', lines: [{ accountCode: '52101', debit: 100, credit: 0 }, { accountCode: '10000', debit: 0, credit: 90 }] })).status, 400);
  assert.equal((await invoke(bak, { ...base, action: 'SAVE_ACCOUNT', code: '52101', name: 'Perawatan baru', normalBalance: 'DEBIT', reportTarget: 'INCOME_STATEMENT', cashEquivalent: false, cashFlowSection: 'OPERATING' })).status, 409);
  await succeeds(await invoke(bak, { ...base, action: 'SAVE_ACCOUNT', code: '11002', name: 'Bank Syariah', normalBalance: 'DEBIT', reportTarget: 'BALANCE_SHEET', cashEquivalent: true, cashFlowSection: null, expectedRevision: 0 }));
  let view = await succeeds(await read(head, { ...base, month: '9' }));
  assert.equal(view.statements.cashFlow.endingCash, 900);
  assert.equal(view.statements.trialBalance.difference, 0);
  assert.equal(view.entries.length, 1);
  assert.equal(view.entries[0].isBalanced, true);
  // The cash-flow split comes from the counter account's classification, not from the journal.
  assert.deepEqual(view.entries[0].cashFlows, { OPERATING: -100, INVESTING: 0, FINANCING: 0 });
  // A month goes to BAK only once every cash and bank account matches its statement or cash count.
  const reconcile = (unitBase: typeof base, monthIndex: number, accountId: string, statementBalance: number, expectedRevision = 0, extra: Record<string, unknown> = {}) =>
    invoke(secretary, { ...unitBase, action: 'SAVE_BANK_RECONCILIATION', monthIndex, accountId, statementBalance, items: [], expectedRevision, ...extra });
  const refused = await invoke(head, { ...base, action: 'SUBMIT_REPORT', monthIndex: 9 });
  assert.equal(refused.status, 409);
  assert.match((await refused.json()).error, /10000 KAS \(belum diisi\)/);
  await succeeds(await reconcile(base, 9, '10000', 950));
  assert.match((await (await invoke(head, { ...base, action: 'SUBMIT_REPORT', monthIndex: 9 })).json()).error, /selisih Rp 50/);
  assert.equal((await reconcile(base, 9, '10000', 900)).status, 409, 'a reconciliation is saved on its current revision');
  assert.equal((await reconcile(base, 9, '52101', 0)).status, 400, 'only cash and bank accounts are reconciled');
  await succeeds(await reconcile(base, 9, '10000', 900, 1, { statementDataUrl: receiptDataUrl, items: [] }));
  const statementResponse = await receiptGet(new NextRequest(`http://localhost/api/satker-finance/receipt?${new URLSearchParams({ ...base, reconciliationId: '09_10000' })}`, { headers: { authorization: `Bearer ${head.token}` } }));
  assert.equal(statementResponse.status, 200, 'the attached cash count is served like a receipt');
  await succeeds(await invoke(head, { ...base, action: 'SUBMIT_REPORT', monthIndex: 9 }));
  assert.equal((await reconcile(base, 9, '10000', 900, 2)).status, 409, 'a sealed month\'s reconciliation is frozen with its report');
  assert.equal((await invoke(secretary, { ...voucher, entryId: 'voucher-locked-01' })).status, 409);
  assert.equal((await invoke(rector, { ...base, action: 'RECTOR_APPROVE', monthIndex: 9, expectedRevision: 1 })).status, 409);
  assert.equal((await invoke(head, { ...base, action: 'BAK_APPROVE', monthIndex: 9, expectedRevision: 1 })).status, 403);
  await succeeds(await invoke(bak, { ...base, action: 'BAK_APPROVE', monthIndex: 9, expectedRevision: 1 }));
  assert.equal((await invoke(bak, { ...base, action: 'BAK_APPROVE', monthIndex: 9, expectedRevision: 1 })).status, 409);
  await succeeds(await invoke(rector, { ...base, action: 'RECTOR_APPROVE', monthIndex: 9, expectedRevision: 2 }));
  view = await succeeds(await read(head, { ...base, month: '9' }));
  assert.equal(view.reports[0].status, 'APPROVED');
  assert.equal(view.reports[0].snapshot.cashFlow.endingCash, 900);
  assert.equal(view.reports[0].totalExpense, 100);
  const verifyParams = new URLSearchParams({ ...base, month: '09', code: view.reports[0].verificationCode });
  assert.equal((await verify(new NextRequest(`http://localhost/api/satker-finance/verify?${verifyParams}`))).status, 200);
  verifyParams.set('code', '0'.repeat(36));
  assert.equal((await verify(new NextRequest(`http://localhost/api/satker-finance/verify?${verifyParams}`))).status, 404);
  assert.ok((await adminDb.doc('users/' + head.uid).collection('satkerFinancialNotifications').get()).size >= 1);
  const auditRecords = await adminDb.collection('SatkerFinancialYears').doc('puskomnet_2026-2027').collection('audit').get();
  assert.ok(auditRecords.size >= 5);
  assert.ok(auditRecords.docs.some((doc) => doc.data().action === 'REPORT_SUBMITTED' && doc.data().actorRole === 'satker_head_loyalis'));
  await succeeds(await invoke(bak, { action: 'SAVE_UNIT', id: 'fakultas-a', name: 'Fakultas A', headName: 'Kepala Fakultas', adminName: 'Bendahara Fakultas', editorUids: [secretary.uid] }));
  const secondUnit = { unitId: 'fakultas-a', academicYear: '2026-2027' };
  await succeeds(await invoke(bak, { ...secondUnit, action: 'SAVE_OPENING', openingBalances: { '10000': { debit: 200, credit: 0 }, '30000': { debit: 0, credit: 200 } }, expectedRevision: 0 }));
  await succeeds(await invoke(secretary, { ...secondUnit, action: 'POST_ENTRY', entryId: 'fakultas-sep-001', monthIndex: 9, date: '2026-09-01', kind: 'INFLOW', accountCode: '41000', paymentAccountCode: '10000', amount: 50, description: 'Pendapatan fakultas' }));
  assert.equal((await read(head, { ...secondUnit, month: '9' })).status, 403);
  const consolidated = await succeeds(await read(bak, { unitId: 'ALL', academicYear: '2026-2027', month: '9' }));
  assert.equal(consolidated.unitSummaries.length, 3); // includes the head's auto-created (empty) book
  assert.equal(consolidated.statements.incomeStatement.income, 50);
  assert.equal(consolidated.statements.incomeStatement.expense, 100);
  assert.equal(consolidated.statements.cashFlow.physicalCash, 1150);
  assert.equal(consolidated.statements.cashFlow.reconciliationDelta, 0);
  // Super Admin's list shows every active Kepala SatKer Loyalis on no book, each once; a disabled head gets none, and a head removed from their own book stays off it.
  const unassignedHead = await signUp('unassigned-head@example.test');
  const disabledHead = await signUp('disabled-head@example.test');
  await adminDb.collection('users').doc(unassignedHead.uid).set({ role: 'satker_head_loyalis', displayName: 'Kepala Tanpa Buku', satkerName: 'SatKer Tanpa Buku', disabled: false });
  await adminDb.collection('users').doc(disabledHead.uid).set({ role: 'satker_head_loyalis', displayName: 'Kepala Nonaktif', disabled: true });
  const bakUnits = (await succeeds(await read(bak, { academicYear: '2026-2027', month: '9' }))).units;
  const created = bakUnits.filter((unit: { editorUids: string[] }) => unit.editorUids.includes(unassignedHead.uid));
  assert.equal(created.length, 1);
  assert.equal(created[0].name, 'SatKer Tanpa Buku');
  assert.equal(bakUnits.some((unit: { editorUids: string[] }) => unit.editorUids.includes(disabledHead.uid)), false);
  assert.deepEqual(bakUnits.find((unit: { id: string }) => unit.id === ownUnit.id).editorUids, []);
  assert.equal((await succeeds(await read(bak, { academicYear: '2026-2027', month: '9' }))).units.length, bakUnits.length);
  assert.equal((await adminDb.collection('SatkerFinancialConfigAudit').where('target', '==', created[0].id).get()).size, 1);
  // Once disabled, the head's book leaves the lists but still counts in the consolidated totals.
  await adminDb.collection('users').doc(unassignedHead.uid).update({ disabled: true });
  assert.equal((await succeeds(await read(bak, { academicYear: '2026-2027', month: '9' }))).units.some((unit: { id: string }) => unit.id === created[0].id), false);
  const consolidatedAfterDisable = await succeeds(await read(bak, { unitId: 'ALL', academicYear: '2026-2027', month: '9' }));
  assert.equal(consolidatedAfterDisable.unitSummaries.some((item: { unit: { id: string } }) => item.unit.id === created[0].id), false);
  assert.equal(consolidatedAfterDisable.unitSummaries.length, 3);
  await succeeds(await invoke(secretary, { ...base, action: 'POST_ENTRY', entryId: 'voucher-oct-001', monthIndex: 10, date: '2026-10-01', kind: 'INFLOW', accountCode: '41000', paymentAccountCode: '11001', amount: 500, description: 'Droping' }));
  assert.equal((await invoke(secretary, { ...base, action: 'POST_ENTRY', entryId: 'depreciation-10', monthIndex: 10, date: '2026-10-01', kind: 'INFLOW', accountCode: '41000', paymentAccountCode: '11001', amount: 1, description: 'x' })).status, 400, 'server-made journal ids are reserved');
  // KAS still holds a balance in October, so it is counted again alongside the bank.
  await succeeds(await reconcile(base, 10, '10000', 900));
  await succeeds(await reconcile(base, 10, '11001', 450, 0, { items: [{ kind: 'DEPOSIT_IN_TRANSIT', description: 'Droping belum masuk rekening koran', amount: 50 }] }));
  await succeeds(await invoke(head, { ...base, action: 'SUBMIT_REPORT', monthIndex: 10 }));
  await succeeds(await invoke(bak, { ...base, action: 'BAK_REVISE', monthIndex: 10, expectedRevision: 1, note: 'Lampiran biaya belum lengkap.' }));
  await succeeds(await invoke(secretary, { ...base, action: 'POST_ENTRY', entryId: 'voucher-oct-002', monthIndex: 10, date: '2026-10-03', kind: 'EXPENSE', accountCode: '54101', paymentAccountCode: '10000', amount: 50, description: 'Biaya bank' }));
  assert.equal((await invoke(secretary, { ...base, action: 'REVERSE_ENTRY', sourceEntryId: 'voucher-oct-002', monthIndex: 10, date: '2026-10-02', description: 'Tanggal koreksi salah' })).status, 400);

  // Edit and delete: allowed only while the journal's month and every later month are open.
  const yearDoc = adminDb.collection('SatkerFinancialYears').doc('puskomnet_2026-2027');
  const entryDoc = (id: string) => yearDoc.collection('entries').doc(id);
  const receiptsOf = (snapshot: FirebaseFirestore.DocumentSnapshot) => (snapshot.data()!.receiptPaths ?? []) as string[];
  const auditActions = async (action: string) => (await yearDoc.collection('audit').where('action', '==', action).get()).docs.map((doc) => doc.data());
  const edit = (entryId: string, extra: Record<string, unknown> = {}) => ({
    ...base, action: 'UPDATE_ENTRY', entryId, expectedRevision: 0, monthIndex: 10, date: '2026-10-01', description: 'Droping (dikoreksi)', cashFlowSection: 'OPERATING',
    lines: [{ accountCode: '11001', description: 'Droping diterima', debit: 600, credit: 0 }, { accountCode: '41000', description: 'Droping diterima', debit: 0, credit: 600 }],
    ...extra,
  });
  const remove = (entryId: string, extra: Record<string, unknown> = {}) => ({ ...base, action: 'DELETE_ENTRY', entryId, expectedRevision: 0, reason: 'Salah input', ...extra });
  // September is approved, so its journal is sealed for good.
  assert.equal((await invoke(secretary, edit('voucher-sep-001', { monthIndex: 9, date: '2026-09-02' }))).status, 409);
  assert.equal((await invoke(secretary, remove('voucher-sep-001'))).status, 409);
  assert.equal((await entryDoc('voucher-sep-001').get()).exists, true);
  // Only the unit's own editors, and never a reviewer.
  assert.equal((await invoke(outsider, edit('voucher-oct-001'))).status, 403);
  assert.equal((await invoke(rector, edit('voucher-oct-001'))).status, 403);
  assert.equal((await invoke(rector, remove('voucher-oct-001'))).status, 403);
  // October is open again (revision requested): an edit validates like a posting does.
  assert.equal((await invoke(secretary, edit('voucher-oct-001', { lines: [{ accountCode: '11001', debit: 600, credit: 0 }, { accountCode: '41000', debit: 0, credit: 500 }] }))).status, 400);
  assert.equal((await invoke(secretary, edit('voucher-oct-001', { expectedRevision: 5 }))).status, 409);
  assert.equal((await invoke(secretary, edit('voucher-oct-001', { expectedRevision: -1 }))).status, 400);
  assert.equal((await invoke(secretary, edit('voucher-oct-001', { monthIndex: 9, date: '2026-09-20' }))).status, 409, 'cannot be moved into a sealed month');
  assert.equal((await invoke(secretary, edit('voucher-oct-001', { date: '2026-11-02' }))).status, 400, 'date and month must agree');
  assert.equal((await invoke(secretary, edit('voucher-missing-001'))).status, 404);
  assert.equal((await invoke(secretary, remove('voucher-oct-001', { reason: '' }))).status, 400);
  const yearBefore = (await yearDoc.get()).data()!;
  await succeeds(await invoke(secretary, edit('voucher-oct-001')));
  const edited = (await entryDoc('voucher-oct-001').get()).data()!;
  assert.equal(edited.revision, 1);
  assert.equal(edited.kind, 'ADVANCED');
  assert.equal(edited.totalAmount, 600);
  assert.equal(edited.lines[0].debit, 600);
  assert.equal(edited.lines[0].description, 'Droping diterima');
  assert.equal(edited.updatedBy, secretary.uid);
  assert.equal(edited.createdBy, secretary.uid);
  assert.equal((await yearDoc.get()).data()!.revision, yearBefore.revision + 1, 'a changed journal moves the year revision, so a report built meanwhile is refused');
  assert.equal((await yearDoc.get()).data()!.entryCount, yearBefore.entryCount);
  const updates = await auditActions('ENTRY_UPDATED');
  assert.equal(updates.length, 1);
  assert.equal(updates[0].details.before.totalAmount, 500);
  assert.equal(updates[0].details.after.totalAmount, 600);
  assert.equal(updates[0].actorRole, 'satker_finance_admin');
  assert.equal((await invoke(secretary, edit('voucher-oct-001'))).status, 409, 'the same edit twice is refused: the journal is on revision 1 now');
  // The same journal on its new revision, with a receipt photo added; without a photo the receipt stays.
  await succeeds(await invoke(secretary, edit('voucher-oct-001', { expectedRevision: 1, receiptDataUrl })));
  assert.equal((await succeeds(await read(head, { ...base, month: '10' }))).entries.find((item: { id: string }) => item.id === 'voucher-oct-001').hasReceipt, true);
  const octReceipt = await receiptGet(new NextRequest(`http://localhost/api/satker-finance/receipt?${new URLSearchParams({ ...base, entryId: 'voucher-oct-001' })}`, { headers: { authorization: `Bearer ${head.token}` } }));
  assert.equal(octReceipt.status, 200);
  const receiptPath = (await entryDoc('voucher-oct-001').get()).data()!.receiptPaths[0];
  assert.match(receiptPath, /^satker-finance\/puskomnet\/2026-2027\/voucher-oct-001_/);
  assert.equal((await succeeds(await read(head, { ...base, month: '10' }))).entries.find((item: { id: string }) => item.id === 'voucher-oct-001').receiptCount, 1);
  await succeeds(await invoke(secretary, edit('voucher-oct-001', { expectedRevision: 2, description: 'Droping (dikoreksi lagi)' })));
  const reedited = (await entryDoc('voucher-oct-001').get()).data()!;
  assert.deepEqual(reedited.receiptPaths, [receiptPath]);
  assert.equal(reedited.revision, 3);
  assert.equal(reedited.description, 'Droping (dikoreksi lagi)');
  view = await succeeds(await read(head, { ...base, month: '10' }));
  assert.equal(view.statements.incomeStatement.income, 600);
  assert.equal(view.statements.trialBalance.difference, 0);
  assert.equal(view.statements.cashFlow.reconciliationDelta, 0);
  assert.equal(view.entries.find((item: { id: string }) => item.id === 'voucher-oct-001').revision, 3);
  // Receipts may be any common photo or scan; the type comes from the bytes, not from what the browser declared.
  const asDataUrl = (declared: string, ...parts: (number | string)[]) => `data:${declared};base64,${Buffer.from(parts.flatMap((part) => typeof part === 'number' ? [part] : [...part].map((char) => char.charCodeAt(0)))).toString('base64')}`;
  const pdfReceipt = asDataUrl('application/octet-stream', '%PDF-1.4\n', '1 0 obj <<>> endobj');
  const heicReceipt = asDataUrl('', 0, 0, 0, 24, 'ftypheic', 0, 0, 0, 0, 'mif1heic');
  await succeeds(await invoke(secretary, edit('voucher-oct-001', { expectedRevision: 3, receiptDataUrl: pdfReceipt })));
  const pdfResponse = await receiptGet(new NextRequest(`http://localhost/api/satker-finance/receipt?${new URLSearchParams({ ...base, entryId: 'voucher-oct-001', index: '1' })}`, { headers: { authorization: `Bearer ${head.token}` } }));
  assert.equal(receiptsOf(await entryDoc('voucher-oct-001').get()).length, 2, 'a receipt added on edit joins the saved one');
  assert.equal(pdfResponse.status, 200);
  assert.equal(pdfResponse.headers.get('content-type'), 'application/pdf');
  assert.match((await entryDoc('voucher-oct-001').get()).data()!.receiptPaths[1], /\.pdf$/);
  await succeeds(await invoke(secretary, edit('voucher-oct-001', { expectedRevision: 4, receiptDataUrl: heicReceipt })));
  const heicResponse = await receiptGet(new NextRequest(`http://localhost/api/satker-finance/receipt?${new URLSearchParams({ ...base, entryId: 'voucher-oct-001', index: '2' })}`, { headers: { authorization: `Bearer ${head.token}` } }));
  assert.equal(heicResponse.headers.get('content-type'), 'image/heic');
  assert.equal((await receiptGet(new NextRequest(`http://localhost/api/satker-finance/receipt?${new URLSearchParams({ ...base, entryId: 'voucher-oct-001', index: '3' })}`, { headers: { authorization: `Bearer ${head.token}` } }))).status, 404, 'there is no fourth receipt');
  // Several receipts in one request, up to ten per journal; a file that fails keeps the others out too.
  await succeeds(await invoke(secretary, edit('voucher-oct-001', { expectedRevision: 5, receiptDataUrls: [pdfReceipt, receiptDataUrl] })));
  assert.equal(receiptsOf(await entryDoc('voucher-oct-001').get()).length, 5);
  assert.equal((await invoke(secretary, edit('voucher-oct-001', { expectedRevision: 6, receiptDataUrls: [receiptDataUrl, 'hello'] }))).status, 400);
  assert.equal((await invoke(secretary, edit('voucher-oct-001', { expectedRevision: 6, receiptDataUrls: Array(11).fill(receiptDataUrl) }))).status, 400, 'more than ten files in one request');
  assert.equal((await invoke(secretary, edit('voucher-oct-001', { expectedRevision: 6, receiptDataUrls: Array(6).fill(receiptDataUrl) }))).status, 409, 'five saved plus six would pass ten');
  assert.equal(receiptsOf(await entryDoc('voucher-oct-001').get()).length, 5);
  await succeeds(await invoke(secretary, edit('voucher-oct-001', { expectedRevision: 6, receiptDataUrls: Array(5).fill(receiptDataUrl) })));
  assert.equal(receiptsOf(await entryDoc('voucher-oct-001').get()).length, 10);
  assert.equal((await succeeds(await read(head, { ...base, month: '10' }))).entries.find((item: { id: string }) => item.id === 'voucher-oct-001').receiptCount, 10);
  assert.equal((await invoke(secretary, edit('voucher-oct-001', { expectedRevision: 7, receiptDataUrl: asDataUrl('image/png', 'MZ', 0x90, 0, 3, 0, 0, 0) }))).status, 400, 'a program renamed to .png is refused');
  assert.equal((await invoke(secretary, edit('voucher-oct-001', { expectedRevision: 7, receiptDataUrl: 'hello' }))).status, 400);
  const pngOver2Mb = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(2 * 1024 * 1024)]).toString('base64')}`;
  assert.equal((await invoke(secretary, edit('voucher-oct-001', { expectedRevision: 7, receiptDataUrl: pngOver2Mb }))).status, 400, 'a journal receipt over 2 MB is refused (the browser compresses to that size)');
  assert.equal((await entryDoc('voucher-oct-001').get()).data()!.revision, 7, 'a refused receipt changes nothing');
  // Saved receipts can be removed individually, including while replacing files at the ten-receipt limit.
  const beforeReceiptRemoval = (await entryDoc('voucher-oct-001').get()).data()!;
  const originalReceiptPaths = beforeReceiptRemoval.receiptPaths as string[];
  const removeReceipts = (removedReceiptIndexes: unknown, extra: Record<string, unknown> = {}) => edit('voucher-oct-001', { expectedRevision: 7, removedReceiptIndexes, ...extra });
  for (const invalid of [null, '0', [-1], [0.5], ['0'], [0, 0], [10], Array(11).fill(0)]) {
    assert.equal((await invoke(secretary, removeReceipts(invalid))).status, 400, `invalid removal list: ${JSON.stringify(invalid)}`);
  }
  assert.equal((await invoke(outsider, removeReceipts([0]))).status, 403);
  assert.equal((await invoke(rector, removeReceipts([0]))).status, 403);
  assert.equal((await invoke(head, edit('voucher-sep-001', { monthIndex: 9, date: '2026-09-02', removedReceiptIndexes: [0] }))).status, 409, 'receipt removal respects the sealed month');
  assert.deepEqual((await entryDoc('voucher-oct-001').get()).data(), beforeReceiptRemoval, 'refused removals change nothing');
  await succeeds(await invoke(secretary, removeReceipts([0, 2], { receiptDataUrls: [receiptDataUrl, pdfReceipt] })));
  const replacedReceipts = (await entryDoc('voucher-oct-001').get()).data()!;
  assert.equal(replacedReceipts.receiptPaths.length, 10);
  assert.deepEqual(replacedReceipts.receiptPaths.slice(0, 8), originalReceiptPaths.filter((_, index) => index !== 0 && index !== 2));
  assert.ok(!replacedReceipts.receiptPaths.includes(originalReceiptPaths[0]));
  assert.ok(!replacedReceipts.receiptPaths.includes(originalReceiptPaths[2]));
  assert.equal(replacedReceipts.revision, 8);
  assert.equal((await invoke(head, removeReceipts([1]))).status, 409, 'a stale receipt index cannot remove a different file');
  const retainedReceiptResponse = await receiptGet(new NextRequest(`http://localhost/api/satker-finance/receipt?${new URLSearchParams({ ...base, entryId: 'voucher-oct-001', index: '0' })}`, { headers: { authorization: `Bearer ${head.token}` } }));
  assert.equal(retainedReceiptResponse.headers.get('content-type'), 'application/pdf', 'preview indexes follow the retained receipt order');
  const receiptRemovalAudit = (await auditActions('ENTRY_UPDATED')).find((item) => JSON.stringify(item.details.after.receiptPaths) === JSON.stringify(replacedReceipts.receiptPaths))!;
  assert.deepEqual(receiptRemovalAudit.details.before.receiptPaths, originalReceiptPaths);
  assert.equal(receiptRemovalAudit.actorUid, secretary.uid);
  assert.equal(await adminStorageFileExists(originalReceiptPaths[0]), true, 'removed files remain archived with the audit trail');
  assert.equal(await adminStorageFileExists(originalReceiptPaths[2]), true);
  await succeeds(await invoke(head, removeReceipts(Array.from({ length: 10 }, (_, index) => index), { expectedRevision: 8 })));
  const withoutReceipts = (await entryDoc('voucher-oct-001').get()).data()!;
  assert.deepEqual(withoutReceipts.receiptPaths, []);
  assert.equal(withoutReceipts.receiptPath, undefined);
  assert.deepEqual(withoutReceipts.lines, replacedReceipts.lines);
  assert.equal(withoutReceipts.totalAmount, replacedReceipts.totalAmount);
  const receiptFreeView = await succeeds(await read(head, { ...base, month: '10' }));
  const receiptFreeEntry = receiptFreeView.entries.find((item: { id: string }) => item.id === 'voucher-oct-001');
  assert.equal(receiptFreeEntry.receiptCount, 0);
  assert.equal(receiptFreeEntry.hasReceipt, false);
  assert.equal((await receiptGet(new NextRequest(`http://localhost/api/satker-finance/receipt?${new URLSearchParams({ ...base, entryId: 'voucher-oct-001' })}`, { headers: { authorization: `Bearer ${head.token}` } }))).status, 404);
  // Legacy single-file journals clear both fields, so the old receipt cannot reappear through the fallback.
  await entryDoc('voucher-oct-001').update({ receiptPaths: admin.firestore.FieldValue.delete(), receiptPath });
  await succeeds(await invoke(head, removeReceipts([0], { expectedRevision: 9 })));
  const clearedLegacy = (await entryDoc('voucher-oct-001').get()).data()!;
  assert.deepEqual(clearedLegacy.receiptPaths, []);
  assert.equal(clearedLegacy.receiptPath, undefined);
  assert.equal(await adminStorageFileExists(receiptPath), true);
  // A journal and its reversal belong together: neither half is changed alone, a reversal can only be deleted.
  const entriesBeforeScratch = (await yearDoc.get()).data()!.entryCount;
  await succeeds(await invoke(secretary, { ...base, action: 'POST_ENTRY', entryId: 'voucher-oct-003', monthIndex: 10, date: '2026-10-04', kind: 'EXPENSE', accountCode: '54101', paymentAccountCode: '10000', amount: 20, description: 'Biaya sementara' }));
  await succeeds(await invoke(secretary, { ...base, action: 'REVERSE_ENTRY', sourceEntryId: 'voucher-oct-003', monthIndex: 10, date: '2026-10-05', description: 'Salah catat' }));
  assert.equal((await invoke(secretary, edit('voucher-oct-003'))).status, 409);
  assert.equal((await invoke(secretary, remove('voucher-oct-003'))).status, 409);
  assert.equal((await invoke(secretary, edit('reverse_voucher-oct-003'))).status, 409);
  await succeeds(await invoke(secretary, remove('reverse_voucher-oct-003')));
  assert.equal((await entryDoc('reverse_voucher-oct-003').get()).exists, false);
  // With its reversal gone the journal can be deleted: it leaves the books but not the audit trail, nor its receipt photo.
  await succeeds(await invoke(secretary, remove('voucher-oct-003', { reason: 'Biaya ternyata tidak terjadi' })));
  assert.equal((await entryDoc('voucher-oct-003').get()).exists, false);
  assert.equal((await yearDoc.get()).data()!.entryCount, entriesBeforeScratch, 'entryCount follows the live journals');
  assert.equal((await invoke(secretary, remove('voucher-oct-003'))).status, 404, 'a journal that is gone cannot be deleted again');
  const deletions = await auditActions('ENTRY_DELETED');
  assert.equal(deletions.length, 2);
  const deletion = deletions.find((item) => item.details.entryId === 'voucher-oct-003')!;
  assert.equal(deletion.details.reason, 'Biaya ternyata tidak terjadi');
  assert.equal(deletion.details.entry.totalAmount, 20);
  assert.equal(deletion.details.entry.lines[0].accountCode, '54101');
  assert.equal(deletion.actorRole, 'satker_finance_admin');
  view = await succeeds(await read(head, { ...base, month: '10' }));
  assert.equal(view.statements.incomeStatement.expense, 50, 'only the journals that remain are counted');
  assert.ok((await adminStorageFileExists(receiptPath)), 'the receipt photo of an edited journal stays in Storage');
  // The corrections moved both balances, so the saved reconciliations no longer explain them.
  assert.equal((await invoke(head, { ...base, action: 'SUBMIT_REPORT', monthIndex: 10 })).status, 409);
  await succeeds(await reconcile(base, 10, '10000', 850, 1));
  await succeeds(await reconcile(base, 10, '11001', 600, 1));
  await succeeds(await invoke(head, { ...base, action: 'SUBMIT_REPORT', monthIndex: 10 }));
  const revisions = await adminDb.collection('SatkerFinancialYears').doc('puskomnet_2026-2027').collection('reportRevisions').get();
  const octoberRevisions = revisions.docs.filter((doc) => doc.id.startsWith('10_'));
  assert.equal(octoberRevisions.length, 2);
  assert.notEqual(octoberRevisions[0].data().snapshot.cashFlow.endingCash, octoberRevisions[1].data().snapshot.cashFlow.endingCash);
  await succeeds(await invoke(bak, { ...base, action: 'BAK_APPROVE', monthIndex: 10, expectedRevision: 3 }));
  await succeeds(await invoke(rector, { ...base, action: 'RECTOR_APPROVE', monthIndex: 10, expectedRevision: 4 }));
  const correction = { ...base, action: 'REVERSE_ENTRY', sourceEntryId: 'voucher-oct-002', monthIndex: 11, date: '2026-11-01', description: 'Koreksi biaya ganda' };
  await succeeds(await invoke(secretary, correction));
  assert.equal((await succeeds(await invoke(secretary, correction))).duplicate, true);
  assert.equal((await invoke(secretary, { ...correction, description: 'Alasan berbeda' })).status, 409);
  const reversal = await adminDb.collection('SatkerFinancialYears').doc('puskomnet_2026-2027').collection('entries').doc('reverse_voucher-oct-002').get();
  assert.equal(reversal.data()?.lines[0].credit, 50);
  assert.equal((await invoke(bak, { ...base, action: 'CLOSE_YEAR' })).status, 409);
  await succeeds(await invoke(bak, { action: 'SAVE_UNIT', id: 'puskomnet', name: 'PUSKOMNET Baru', headName: 'Kepala Unit', adminName: 'Bendahara', editorUids: [head.uid, secretary.uid], expectedRevision: 1 }));
  verifyParams.set('code', view.reports[0].verificationCode);
  const verifiedAfterRename = await succeeds(await verify(new NextRequest(`http://localhost/api/satker-finance/verify?${verifyParams}`)));
  assert.equal(verifiedAfterRename.unitName, 'PUSKOMNET');

  // Fixed assets: a laptop bought on credit in November and written down over one year. The register first gets the
  // cost wrong (4.800 instead of 6.000) and is corrected while November is still open.
  await succeeds(await invoke(secretary, { ...base, action: 'POST_ENTRY', entryId: 'voucher-nov-001', monthIndex: 11, date: '2026-11-10', kind: 'ADVANCED', description: 'Laptop dibeli kredit',
    lines: [{ accountCode: '13004', debit: 6000, credit: 0 }, { accountCode: '20001', debit: 0, credit: 6000 }] }));
  const assetPayload = { unitId: 'puskomnet', action: 'SAVE_FIXED_ASSET', name: 'Laptop keuangan', assetAccountId: '13004', accumulatedAccountId: '13013', expenseAccountId: '54100',
    acquisitionDate: '2026-11-10', cost: 4800, residualValue: 0, usefulLifeYears: 1, expectedRevision: 0 };
  assert.equal((await invoke(outsider, assetPayload)).status, 403);
  assert.equal((await invoke(secretary, { ...assetPayload, accumulatedAccountId: '13004' })).status, 400, 'the accumulated account must be a contra account');
  const { assetId } = await succeeds(await invoke(secretary, assetPayload));
  await succeeds(await reconcile(base, 11, '10000', 900));
  await succeeds(await reconcile(base, 11, '11001', 600));
  assert.match((await (await invoke(head, { ...base, action: 'SUBMIT_REPORT', monthIndex: 11 })).json()).error, /Penyusutan Rp 400 belum diposting/);
  assert.equal((await succeeds(await invoke(secretary, { ...base, action: 'POST_DEPRECIATION', monthIndex: 11 }))).outcome, 'created');
  assert.equal((await succeeds(await invoke(secretary, { ...base, action: 'POST_DEPRECIATION', monthIndex: 11 }))).outcome, 'unchanged');
  const depreciationNov = async () => (await yearDoc.collection('entries').doc('depreciation-11').get()).data()!;
  assert.deepEqual((await depreciationNov()).lines.map((line: { accountCode: string; debit: number; credit: number }) => [line.accountCode, line.debit, line.credit]), [['54100', 400, 0], ['13013', 0, 400]]);
  assert.equal((await depreciationNov()).date, '2026-11-30');
  assert.equal((await invoke(secretary, edit('depreciation-11', { monthIndex: 11, date: '2026-11-30' }))).status, 409, 'a depreciation journal is never edited by hand');
  await succeeds(await invoke(secretary, { ...assetPayload, assetId, cost: 6000, expectedRevision: 1 }));
  assert.match((await (await invoke(head, { ...base, action: 'SUBMIT_REPORT', monthIndex: 11 })).json()).error, /Posting ulang/);
  assert.equal((await succeeds(await invoke(secretary, { ...base, action: 'POST_DEPRECIATION', monthIndex: 11 }))).outcome, 'updated');
  assert.equal((await depreciationNov()).totalAmount, 500);
  const approveMonth = async (unitBase: typeof base, monthIndex: number) => {
    await succeeds(await invoke(head, { ...unitBase, action: 'SUBMIT_REPORT', monthIndex }));
    await succeeds(await invoke(bak, { ...unitBase, action: 'BAK_APPROVE', monthIndex, expectedRevision: 1 }));
    await succeeds(await invoke(rector, { ...unitBase, action: 'RECTOR_APPROVE', monthIndex, expectedRevision: 2 }));
  };
  await approveMonth(base, 11);
  // November is sealed with the laptop's depreciation in it: its figures are frozen, its name is not.
  assert.equal((await invoke(secretary, { ...assetPayload, assetId, cost: 7000, expectedRevision: 2 })).status, 409);
  await succeeds(await invoke(secretary, { ...assetPayload, assetId, cost: 6000, name: 'Laptop bagian keuangan', expectedRevision: 2 }));
  assert.equal((await invoke(secretary, { unitId: 'puskomnet', action: 'DELETE_FIXED_ASSET', assetId, expectedRevision: 3 })).status, 409);

  // The next year can start journaling, but its months wait for this year's closing to bring the opening balance.
  const nextBase = { unitId: 'puskomnet', academicYear: '2027-2028' };
  await succeeds(await invoke(secretary, { ...nextBase, action: 'POST_ENTRY', entryId: 'voucher-2027-09-01', monthIndex: 9, date: '2027-09-02', kind: 'INFLOW', accountCode: '41000', paymentAccountCode: '10000', amount: 10, description: 'Penerimaan September' }));
  assert.match((await (await invoke(head, { ...nextBase, action: 'SUBMIT_REPORT', monthIndex: 9 })).json()).error, /2026-2027 belum ditutup/);
  assert.equal((await invoke(bak, { ...nextBase, action: 'SAVE_OPENING', openingBalances: { '10000': { debit: 1, credit: 0 }, '30000': { debit: 0, credit: 1 } }, expectedRevision: 1 })).status, 409, 'nobody types the second year\'s opening');
  for (const monthIndex of [12, 1, 2, 3, 4, 5, 6, 7, 8]) {
    await succeeds(await invoke(secretary, { ...base, action: 'POST_DEPRECIATION', monthIndex }));
    await succeeds(await reconcile(base, monthIndex, '10000', 900));
    await succeeds(await reconcile(base, monthIndex, '11001', 600));
    await approveMonth(base, monthIndex);
  }
  assert.equal((await invoke(bak, { ...base, action: 'CLOSE_YEAR', equityAccountId: '20001' })).status, 400, 'the surplus goes into a Modal account');
  await succeeds(await invoke(bak, { ...base, action: 'CLOSE_YEAR' }));
  assert.equal((await invoke(bak, { ...base, action: 'CLOSE_YEAR' })).status, 409);
  const closedYear = (await yearDoc.get()).data()!;
  assert.equal(closedYear.status, 'CLOSED');
  // Income 600; expenses 100 + 50 − 50 (reversed) + 10 months × 500 of depreciation = 5.100: a 4.500 deficit debited to Modal.
  assert.equal(closedYear.closing.surplus, -4500);
  assert.equal(closedYear.closing.equityAccountId, '30000');
  const nextYearDoc = (await adminDb.collection('SatkerFinancialYears').doc('puskomnet_2027-2028').get()).data()!;
  assert.deepEqual(nextYearDoc.openingBalances, {
    '10000': { debit: 900, credit: 0 }, '11001': { debit: 600, credit: 0 }, '13004': { debit: 6000, credit: 0 },
    '13013': { debit: 0, credit: 5000 }, '20001': { debit: 0, credit: 6000 }, '30000': { debit: 3500, credit: 0 },
  });
  assert.deepEqual(nextYearDoc.openingBalances, closedYear.closing.balances);
  assert.equal(nextYearDoc.openingSource, 'CARRIED_FORWARD');
  assert.equal(nextYearDoc.openingCarriedFrom, '2026-2027');
  assert.equal(nextYearDoc.entryCount, 1, 'the journal posted before the carry-forward is kept');
  assert.equal((await adminDb.collection('SatkerFinancialYears').doc('puskomnet_2027-2028').collection('audit').where('action', '==', 'OPENING_CARRIED_FORWARD').get()).size, 1);
  const nextView = await succeeds(await read(head, { ...nextBase, month: '9' }));
  assert.equal(nextView.year.openingSource, 'CARRIED_FORWARD');
  assert.equal(nextView.previousYear.status, 'CLOSED');
  assert.equal(nextView.statements.trialBalance.difference, 0);
  assert.equal((await invoke(bak, { ...nextBase, action: 'SAVE_OPENING', openingBalances: nextYearDoc.openingBalances, expectedRevision: nextView.year.revision })).status, 409);
  // September 2027 is the laptop's eleventh month; with it posted and the cash counted, the month goes to BAK.
  await succeeds(await invoke(secretary, { ...nextBase, action: 'POST_DEPRECIATION', monthIndex: 9 }));
  await succeeds(await reconcile(nextBase, 9, '10000', 910));
  await succeeds(await reconcile(nextBase, 9, '11001', 600));
  await succeeds(await invoke(head, { ...nextBase, action: 'SUBMIT_REPORT', monthIndex: 9 }));

  // Existing books can enter and correct their first opening balances until a report is created.
  const openingBase = { unitId: 'opening-test', academicYear: '2026-2027' };
  await succeeds(await invoke(bak, { action: 'SAVE_UNIT', id: openingBase.unitId, name: 'Opening balance test', editorUids: [head.uid, secretary.uid] }));
  await succeeds(await invoke(secretary, { ...openingBase, action: 'POST_ENTRY', entryId: 'opening-test-entry', monthIndex: 9, date: '2026-09-02', kind: 'INFLOW', accountCode: '41000', paymentAccountCode: '10000', amount: 25, description: 'Penerimaan sebelum saldo awal diisi' }));
  const openingYear = adminDb.collection('SatkerFinancialYears').doc('opening-test_2026-2027');
  const beforeOpening = (await openingYear.get()).data()!;
  const unchangedOtherYear = (await yearDoc.get()).data()!;
  assert.equal(beforeOpening.entryCount, 1);
  await succeeds(await invoke(head, { unitId: openingBase.unitId, action: 'SAVE_UNIT_ACCOUNT', code: '11099.5', name: 'Bank SatKer', type: 'AKTIVA', cashEquivalent: true, expectedCatalogRevision: 0 }));
  const openingView = await succeeds(await read(head, { ...openingBase, month: '9' }));
  const localBank = openingView.accounts.find((account: { code: string }) => account.code === '11099.5');
  assert.ok(localBank.id.startsWith('custom_'));
  const openingBalances = { [localBank.id]: { debit: 250, credit: 0 }, '30000': { debit: 0, credit: 250 } };
  const saveOpening = (openingBalances: Record<string, { debit: number; credit: number }>, expectedRevision: number) => ({ ...openingBase, action: 'SAVE_OPENING', openingBalances, expectedRevision });
  assert.equal((await invoke(outsider, saveOpening(openingBalances, beforeOpening.revision))).status, 403);
  assert.equal((await invoke(rector, saveOpening(openingBalances, beforeOpening.revision))).status, 403);
  assert.equal((await invoke(head, saveOpening({ '10000': { debit: 250, credit: 0 } }, beforeOpening.revision))).status, 400);
  assert.equal((await invoke(head, saveOpening({ '52101': { debit: 250, credit: 0 }, '30000': { debit: 0, credit: 250 } }, beforeOpening.revision))).status, 400, 'expense accounts begin at zero');
  await succeeds(await invoke(secretary, saveOpening(openingBalances, beforeOpening.revision)));
  const savedOpening = (await openingYear.get()).data()!;
  assert.deepEqual(savedOpening.openingBalances, openingBalances);
  assert.equal(savedOpening.entryCount, 1, 'saving the opening does not reset the journal count');
  assert.equal(savedOpening.revision, beforeOpening.revision + 1);
  assert.equal((await openingYear.collection('entries').get()).size, 1);
  assert.deepEqual((await yearDoc.get()).data(), unchangedOtherYear, 'another SatKer is untouched');
  const openingAudit = (await openingYear.collection('audit').where('action', '==', 'OPENING_BALANCE_UPDATED').get()).docs[0].data();
  assert.equal(openingAudit.actorUid, secretary.uid);
  assert.deepEqual(openingAudit.details.after, openingBalances);

  // Changing an account's displayed number keeps its opening balance attached to its stable identity.
  await succeeds(await invoke(head, { unitId: openingBase.unitId, action: 'SAVE_UNIT_ACCOUNT', accountId: localBank.localAccountId, code: '11099.6', name: 'Bank SatKer baru', expectedRevision: localBank.revision, expectedCatalogRevision: openingView.accountCatalogRevision }));
  const renamedOpening = await succeeds(await read(head, { ...openingBase, month: '9' }));
  const bankRow = renamedOpening.statements.rows.find((row: { account: { id: string } }) => row.account.id === localBank.id);
  assert.equal(bankRow.account.code, '11099.6');
  assert.equal(bankRow.openingDebit, 250);
  assert.equal(renamedOpening.statements.cashFlow.endingCash, 275, 'the statements combine the opening and the existing journal');

  const replacementOpening = { '10000': { debit: 100, credit: 0 }, '30000': { debit: 0, credit: 100 } };
  await succeeds(await invoke(head, saveOpening(replacementOpening, savedOpening.revision)));
  assert.deepEqual((await openingYear.get()).data()!.openingBalances, replacementOpening, 'cleared accounts are removed from the stored map');
  assert.equal((await invoke(secretary, saveOpening(openingBalances, savedOpening.revision))).status, 409, 'a stale editor cannot overwrite the new balance');
  await succeeds(await invoke(head, saveOpening({}, savedOpening.revision + 1)));
  assert.deepEqual((await openingYear.get()).data()!.openingBalances, {}, 'all balances can be cleared before reporting');
  await succeeds(await reconcile(openingBase, 9, '10000', 25));
  await succeeds(await invoke(head, { ...openingBase, action: 'SUBMIT_REPORT', monthIndex: 9 }));
  const reportedOpening = (await openingYear.get()).data()!;
  assert.equal((await invoke(head, saveOpening(replacementOpening, reportedOpening.revision))).status, 409, 'the first report locks the opening');
  assert.deepEqual((await openingYear.get()).data(), reportedOpening);
  assert.equal((await invoke(head, { ...base, action: 'SAVE_OPENING', openingBalances: closedYear.openingBalances, expectedRevision: closedYear.revision })).status, 409, 'a closed year stays locked');
  assert.equal((await invoke(secretary, { ...nextBase, action: 'SAVE_OPENING', openingBalances: nextView.year.openingBalances, expectedRevision: nextView.year.revision })).status, 409, 'carried openings stay locked for unit editors');
  console.log('SatKer finance emulator workflow passed.');
  await admin.app().delete();
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
