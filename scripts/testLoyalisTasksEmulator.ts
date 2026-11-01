/** Tugas Loyalis against the Auth and Firestore emulators only. */
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

const PROJECT = 'demo-loyalis-tasks';

async function signUp(email: string) {
  const response = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`,
    { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'password123', returnSecureToken: true }) },
  );
  const identity = await response.json();
  assert.ok(identity.idToken, JSON.stringify(identity));
  return { uid: identity.localId as string, authorization: `Bearer ${identity.idToken}` };
}

async function main() {
  if (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== PROJECT ||
    !/^(127\.0\.0\.1|localhost):8188$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') ||
    !/^(127\.0\.0\.1|localhost):9198$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || '')) {
    throw new Error(`Refusing to run outside the ${PROJECT} emulators.`);
  }
  const { adminDb } = await import('../src/lib/firebase-admin');
  const adminApi = await import('../src/app/api/loyalis-tasks/route');
  const adminItemApi = await import('../src/app/api/loyalis-tasks/[id]/route');
  const employeeApi = await import('../src/app/api/employee/tasks/route');
  const employeeItemApi = await import('../src/app/api/employee/tasks/[id]/route');
  const today = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

  const superAdmin = await signUp('super@example.test');
  const loyalisA = await signUp('loyalis-a@example.test');
  const loyalisB = await signUp('loyalis-b@example.test');
  const employeeAdmin = await signUp('admin@example.test');
  await adminDb.doc(`users/${superAdmin.uid}`).set({ role: 'super_admin', displayName: 'Super Admin' });
  await adminDb.doc(`users/${loyalisA.uid}`).set({ role: 'loyalis', displayName: 'Loyalis A', linkedEmployeeId: 'Loyalis_901' });
  await adminDb.doc(`users/${loyalisB.uid}`).set({ role: 'loyalis', displayName: 'Loyalis B', linkedEmployeeId: 'Loyalis_902' });
  await adminDb.doc(`users/${employeeAdmin.uid}`).set({ role: 'loyalis_admin', displayName: 'Admin Karyawan' });
  await adminDb.doc('Employees_Loyalis/Loyalis_901').set({ personal_info: { name: 'Loyalis A', status: 'AKTIF' } });
  await adminDb.doc('Employees_Loyalis/Loyalis_902').set({ personal_info: { name: 'Loyalis B', status: 'AKTIF' } });
  await adminDb.doc('Employees_Loyalis/Loyalis_903').set({ personal_info: { name: 'Loyalis Nonaktif', status: 'NONAKTIF' } });

  const call = (handler: (request: NextRequest, context?: never) => Promise<Response>, url: string, init: {
    method: string; authorization: string; body?: unknown;
  }) => handler(new NextRequest(`http://localhost${url}`, {
    method: init.method,
    headers: { authorization: init.authorization, 'content-type': 'application/json' },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  }));
  const item = (id: string) => ({ params: Promise.resolve({ id }) });
  const give = (authorization: string, body: unknown) => call(adminApi.POST, '/api/loyalis-tasks', { method: 'POST', authorization, body });
  const own = async (authorization: string, query = '') => {
    const response = await call(employeeApi.GET, `/api/employee/tasks${query}`, { method: 'GET', authorization });
    return { status: response.status, body: await response.json() };
  };
  const setStatus = (authorization: string, id: string, status: unknown) =>
    employeeItemApi.PATCH(new NextRequest(`http://localhost/api/employee/tasks/${id}`, {
      method: 'PATCH', headers: { authorization, 'content-type': 'application/json' }, body: JSON.stringify({ status }),
    }), item(id));

  // ── Nobody has tasks yet: the page does not exist for anyone ──
  let summary = await own(loyalisA.authorization, '?countOnly=true');
  assert.equal(summary.status, 200);
  assert.deepEqual(summary.body, { hasTasks: false, openCount: 0 });

  // ── Only Super Admin gives tasks ──
  const draft = { assigneeEmployeeId: 'Loyalis_901', title: 'Susun laporan', description: 'Bulan Oktober', dueDate: '' };
  assert.equal((await give(employeeAdmin.authorization, draft)).status, 403, 'Admin Karyawan cannot give tasks');
  assert.equal((await give(loyalisA.authorization, draft)).status, 403, 'a Loyalis cannot give tasks');
  assert.equal((await give(superAdmin.authorization, { ...draft, title: '  ' })).status, 400, 'a title is required');
  assert.equal((await give(superAdmin.authorization, { ...draft, dueDate: yesterday })).status, 400, 'due date cannot be in the past');
  assert.equal((await give(superAdmin.authorization, { ...draft, assigneeEmployeeId: 'Loyalis_903' })).status, 400, 'inactive Loyalis');
  assert.equal((await give(superAdmin.authorization, { ...draft, assigneeEmployeeId: 'Loyalis_999' })).status, 400, 'unknown Loyalis');
  assert.equal((await adminApi.GET(new NextRequest('http://localhost/api/loyalis-tasks', {
    headers: { authorization: loyalisA.authorization },
  }))).status, 403, 'a Loyalis cannot list every task');

  let response = await give(superAdmin.authorization, draft);
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
  const first = (await response.json()).task;
  assert.equal(first.status, 'open');
  assert.equal(first.assigneeName, 'Loyalis A');
  response = await give(superAdmin.authorization, { ...draft, title: 'Rekap presensi', dueDate: today });
  const second = (await response.json()).task;

  // ── Only the Loyalis it is for sees it, and the page appears for them alone ──
  summary = await own(loyalisA.authorization, '?countOnly=true');
  assert.deepEqual(summary.body, { hasTasks: true, openCount: 2 });
  summary = await own(loyalisB.authorization, '?countOnly=true');
  assert.deepEqual(summary.body, { hasTasks: false, openCount: 0 }, 'no tasks, no page');
  const listA = await own(loyalisA.authorization);
  assert.deepEqual(listA.body.tasks.map((task: { title: string }) => task.title), ['Rekap presensi', 'Susun laporan'],
    'dated task first, undated after');
  assert.equal((await own(loyalisB.authorization)).body.tasks.length, 0);
  assert.equal((await own(superAdmin.authorization)).status, 403, 'only a loyalis account has the Loyalis side');
  assert.equal((await own(employeeAdmin.authorization)).status, 403);

  // ── A Loyalis completes and reopens only their own task ──
  response = await setStatus(loyalisB.authorization, first.id, 'completed');
  assert.equal(response.status, 404, 'someone else\'s task looks missing');
  assert.equal((await adminDb.doc(`LoyalisTasks/${first.id}`).get()).data()?.status, 'open');
  assert.equal((await setStatus(loyalisA.authorization, first.id, 'done')).status, 400, 'unknown status');
  response = await setStatus(loyalisA.authorization, first.id, 'completed');
  assert.equal(response.status, 200);
  let task = (await response.json()).task;
  assert.equal(task.status, 'completed');
  assert.ok(task.completedAt);
  let stored = (await adminDb.doc(`LoyalisTasks/${first.id}`).get()).data()!;
  assert.equal(stored.completedByUid, loyalisA.uid);
  assert.equal((await setStatus(loyalisA.authorization, first.id, 'completed')).status, 200, 'completing twice is harmless');
  summary = await own(loyalisA.authorization, '?countOnly=true');
  assert.deepEqual(summary.body, { hasTasks: true, openCount: 1 });
  response = await setStatus(loyalisA.authorization, first.id, 'open');
  task = (await response.json()).task;
  assert.equal(task.status, 'open');
  assert.equal(task.completedAt, null);
  stored = (await adminDb.doc(`LoyalisTasks/${first.id}`).get()).data()!;
  assert.equal(stored.completedByUid, null);

  // ── The page stays while any task exists, even when all are completed ──
  await setStatus(loyalisA.authorization, first.id, 'completed');
  await setStatus(loyalisA.authorization, second.id, 'completed');
  summary = await own(loyalisA.authorization, '?countOnly=true');
  assert.deepEqual(summary.body, { hasTasks: true, openCount: 0 }, 'completed tasks still count as having tasks');

  // ── Super Admin edits, reopens and deletes ──
  const edit = (body: unknown) => adminItemApi.PUT(new NextRequest(`http://localhost/api/loyalis-tasks/${second.id}`, {
    method: 'PUT', headers: { authorization: superAdmin.authorization, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }), item(second.id));
  response = await edit({ title: 'Rekap presensi Oktober', description: '', dueDate: today, status: 'open' });
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  task = (await response.json()).task;
  assert.equal(task.title, 'Rekap presensi Oktober');
  assert.equal(task.status, 'open', 'Super Admin can reopen');
  assert.equal(task.assigneeEmployeeId, 'Loyalis_901', 'the assignee does not change');
  assert.equal((await edit({ title: 'x', dueDate: yesterday })).status, 400, 'a new past due date is refused');
  assert.equal((await adminItemApi.PUT(new NextRequest(`http://localhost/api/loyalis-tasks/${second.id}`, {
    method: 'PUT', headers: { authorization: loyalisA.authorization, 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Diubah Loyalis' }),
  }), item(second.id))).status, 403, 'a Loyalis cannot edit through the admin route');
  // An overdue task can still be reworded without touching its date.
  await adminDb.doc(`LoyalisTasks/${second.id}`).update({ dueDate: yesterday });
  response = await edit({ title: 'Rekap presensi (lama)', dueDate: yesterday });
  assert.equal(response.status, 200, 'overdue task keeps its own due date');

  const remove = (id: string, authorization: string) => adminItemApi.DELETE(new NextRequest(`http://localhost/api/loyalis-tasks/${id}`, {
    method: 'DELETE', headers: { authorization },
  }), item(id));
  assert.equal((await remove(first.id, loyalisA.authorization)).status, 403, 'a Loyalis cannot delete');
  assert.equal((await remove(first.id, superAdmin.authorization)).status, 200);
  assert.equal((await remove(first.id, superAdmin.authorization)).status, 404, 'already gone');
  summary = await own(loyalisA.authorization, '?countOnly=true');
  assert.deepEqual(summary.body, { hasTasks: true, openCount: 1 });
  assert.equal((await remove(second.id, superAdmin.authorization)).status, 200);
  summary = await own(loyalisA.authorization, '?countOnly=true');
  assert.deepEqual(summary.body, { hasTasks: false, openCount: 0 }, 'no tasks left: the page goes away');

  // ── Super Admin can filter by Loyalis ──
  await give(superAdmin.authorization, { ...draft, assigneeEmployeeId: 'Loyalis_902', title: 'Tugas B' });
  await give(superAdmin.authorization, { ...draft, title: 'Tugas A' });
  const everything = await call(adminApi.GET, '/api/loyalis-tasks', { method: 'GET', authorization: superAdmin.authorization });
  assert.equal((await everything.json()).tasks.length, 2);
  const onlyB = await call(adminApi.GET, '/api/loyalis-tasks?employeeId=Loyalis_902', { method: 'GET', authorization: superAdmin.authorization });
  assert.deepEqual((await onlyB.json()).tasks.map((item: { title: string }) => item.title), ['Tugas B']);

  // ── The browser cannot read or write the collection directly ──
  const documents = `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${PROJECT}/databases/(default)/documents`;
  for (const who of [superAdmin, loyalisA]) {
    const read = await fetch(`${documents}/LoyalisTasks`, { headers: { authorization: who.authorization } });
    assert.equal(read.status, 403, 'LoyalisTasks is server-only');
  }
  const forged = await fetch(`${documents}/LoyalisTasks?documentId=forged`, {
    method: 'POST', headers: { authorization: loyalisA.authorization, 'content-type': 'application/json' },
    body: JSON.stringify({ fields: { title: { stringValue: 'x' }, assigneeEmployeeId: { stringValue: 'Loyalis_901' } } }),
  });
  assert.equal(forged.status, 403, 'a Loyalis cannot create a task from the browser');

  console.log('Tugas Loyalis integration passed: assigner-only create, validation, per-Loyalis visibility and menu summary, own-task complete/reopen, ownership 404, page stays while any task exists, edit/reopen/delete, filter, server-only rules.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
