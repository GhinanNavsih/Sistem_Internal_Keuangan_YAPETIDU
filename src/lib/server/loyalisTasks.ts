import type { firestore } from 'firebase-admin';
import {
  parseLoyalisTaskAssignee,
  planLoyalisTaskStatusChange,
  sortLoyalisTasks,
  summarizeLoyalisTasks,
  validateLoyalisTaskFields,
  type LoyalisTaskView,
} from '@/lib/loyalisTasks';
import { HttpError, requireRole, type AuthenticatedProfile } from '@/lib/server/auth';
import { jakartaToday } from '@/lib/server/payrollPeriod';

/**
 * Tugas Loyalis, one document each. A task belongs to an `Employees_Loyalis`
 * id, not to a login, so it follows the person across the accounts they switch
 * between. Super Admin gives, edits, reopens and deletes tasks; the Loyalis it
 * is for lists their own and moves it between open and completed. Server-only;
 * the Firestore rules refuse browser access.
 */
type Firestore = firestore.Firestore;

export const LOYALIS_TASKS_COLLECTION = 'LoyalisTasks';
const ADMIN_LIST_LIMIT = 500;
const NOT_FOUND = 'Tugas tidak ditemukan.';

function isoOf(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object' && 'toDate' in value &&
    typeof (value as { toDate?: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return typeof value === 'string' ? value : '';
}

function toView(id: string, data: firestore.DocumentData): LoyalisTaskView {
  return {
    id,
    assigneeEmployeeId: String(data.assigneeEmployeeId || ''),
    assigneeName: String(data.assigneeName || ''),
    title: String(data.title || ''),
    description: String(data.description || ''),
    dueDate: typeof data.dueDate === 'string' && data.dueDate ? data.dueDate : null,
    status: data.status === 'completed' ? 'completed' : 'open',
    createdAt: isoOf(data.createdAt),
    updatedAt: isoOf(data.updatedAt),
    completedAt: data.completedAt ? isoOf(data.completedAt) : null,
  };
}

/** Runs a pure rule and turns its plain `Error` into a 400 for the caller. */
function asBadRequest<T>(rule: () => T): T {
  try {
    return rule();
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : 'Data tugas tidak valid.');
  }
}

async function activeLoyalis(db: Firestore, employeeId: string): Promise<{ id: string; name: string } | null> {
  const snapshot = await db.collection('Employees_Loyalis').doc(employeeId).get();
  const data = snapshot.data();
  if (!snapshot.exists || !data || data.personal_info?.status !== 'AKTIF') return null;
  return { id: snapshot.id, name: String(data.personal_info?.name || '') };
}

/**
 * The signed-in Loyalis's own employee record, found the way Santunan does:
 * the account's `linkedEmployeeId`, never anything the browser sends.
 */
export async function requireSelfLoyalisEmployee(
  db: Firestore,
  actor: AuthenticatedProfile,
): Promise<{ id: string; name: string }> {
  requireRole(actor, ['loyalis']);
  const employeeId = actor.linkedEmployeeId?.trim() || '';
  if (!employeeId) throw new HttpError(409, 'Akun Anda belum terhubung ke data pegawai.');
  const employee = await activeLoyalis(db, employeeId);
  if (!employee) throw new HttpError(409, 'Data Loyalis aktif tidak ditemukan.');
  return employee;
}

/** Every task (newest given first), or those of one Loyalis. */
export async function listLoyalisTasks(
  db: Firestore,
  filter: { employeeId?: string } = {},
): Promise<LoyalisTaskView[]> {
  const collection = db.collection(LOYALIS_TASKS_COLLECTION);
  // One filter field, sorted here, so no composite index is needed.
  const snapshot = filter.employeeId
    ? await collection.where('assigneeEmployeeId', '==', filter.employeeId).get()
    : await collection.orderBy('createdAt', 'desc').limit(ADMIN_LIST_LIMIT).get();
  return sortLoyalisTasks(snapshot.docs.map((document) => toView(document.id, document.data())));
}

export async function createLoyalisTask(
  db: Firestore,
  actor: AuthenticatedProfile,
  raw: unknown,
  now: Date = new Date(),
): Promise<LoyalisTaskView> {
  const assigneeEmployeeId = asBadRequest(() => parseLoyalisTaskAssignee(raw));
  const fields = asBadRequest(() => validateLoyalisTaskFields(raw, jakartaToday(now)));
  const assignee = await activeLoyalis(db, assigneeEmployeeId);
  if (!assignee) throw new HttpError(400, 'Loyalis penerima tidak ditemukan atau tidak aktif.');

  const ref = db.collection(LOYALIS_TASKS_COLLECTION).doc();
  const document = {
    ...fields,
    assigneeEmployeeId: assignee.id,
    assigneeName: assignee.name,
    status: 'open',
    createdAt: now,
    createdByUid: actor.uid,
    updatedAt: now,
    completedAt: null,
    completedByUid: null,
  };
  await ref.set(document);
  return toView(ref.id, document);
}

/**
 * Changes a task's wording and due date and, when `status` is sent, reopens or
 * completes it. The Loyalis it is for cannot be changed: give a new task instead.
 */
export async function updateLoyalisTask(
  db: Firestore,
  actor: AuthenticatedProfile,
  id: string,
  raw: unknown,
  now: Date = new Date(),
): Promise<LoyalisTaskView> {
  const ref = db.collection(LOYALIS_TASKS_COLLECTION).doc(id);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = snapshot.data();
    if (!snapshot.exists || !current) throw new HttpError(404, NOT_FOUND);

    const view = toView(id, current);
    const fields = asBadRequest(() => validateLoyalisTaskFields(raw, jakartaToday(now), view.dueDate));
    const requestedStatus = (raw as { status?: unknown } | null)?.status;
    const change = requestedStatus === undefined
      ? { changed: false, status: view.status }
      : asBadRequest(() => planLoyalisTaskStatusChange(view.status, requestedStatus));

    const update: firestore.UpdateData<firestore.DocumentData> = { ...fields, updatedAt: now };
    if (change.changed) {
      update.status = change.status;
      update.completedAt = change.status === 'completed' ? now : null;
      update.completedByUid = change.status === 'completed' ? actor.uid : null;
    }
    transaction.update(ref, update);
    return toView(id, { ...current, ...update });
  });
}

export async function deleteLoyalisTask(db: Firestore, id: string): Promise<void> {
  const ref = db.collection(LOYALIS_TASKS_COLLECTION).doc(id);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new HttpError(404, NOT_FOUND);
    transaction.delete(ref);
  });
}

/** The signed-in Loyalis's own tasks, ready to show, with what the menu needs. */
export async function listOwnLoyalisTasks(
  db: Firestore,
  actor: AuthenticatedProfile,
): Promise<{ tasks: LoyalisTaskView[]; hasTasks: boolean; openCount: number }> {
  const employee = await requireSelfLoyalisEmployee(db, actor);
  const tasks = await listLoyalisTasks(db, { employeeId: employee.id });
  return { tasks, ...summarizeLoyalisTasks(tasks) };
}

/** Marks one of the signed-in Loyalis's own tasks completed, or open again. */
export async function setOwnLoyalisTaskStatus(
  db: Firestore,
  actor: AuthenticatedProfile,
  id: string,
  rawStatus: unknown,
  now: Date = new Date(),
): Promise<LoyalisTaskView> {
  const employee = await requireSelfLoyalisEmployee(db, actor);
  const ref = db.collection(LOYALIS_TASKS_COLLECTION).doc(id);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = snapshot.data();
    // Someone else's task looks exactly like one that does not exist.
    if (!snapshot.exists || !current || current.assigneeEmployeeId !== employee.id) {
      throw new HttpError(404, NOT_FOUND);
    }
    const change = asBadRequest(() => planLoyalisTaskStatusChange(toView(id, current).status, rawStatus));
    if (!change.changed) return toView(id, current);

    const update = {
      status: change.status,
      completedAt: change.status === 'completed' ? now : null,
      completedByUid: change.status === 'completed' ? actor.uid : null,
      updatedAt: now,
    };
    transaction.update(ref, update);
    return toView(id, { ...current, ...update });
  });
}
