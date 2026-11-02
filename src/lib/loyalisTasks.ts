/**
 * Tugas Loyalis: a to-do list Super Admin hands to individual Loyalis
 * (CONTEXT.md). Pure rules shared by both pages and the API, so they are unit
 * tested without Firebase. A Loyalis sees the page only while at least one
 * task exists for them, completed or not.
 */

export const LOYALIS_TASK_PATH = '/employee/tugas';
export const LOYALIS_TASK_ADMIN_PATH = '/dashboard/payroll/uraian/tugas';
const LEGACY_LOYALIS_TASK_ADMIN_PATH = '/dashboard/tugas';

export function isLoyalisTaskPath(pathname: string): boolean {
  return (
    pathname === LOYALIS_TASK_PATH ||
    pathname === LOYALIS_TASK_ADMIN_PATH ||
    pathname === LEGACY_LOYALIS_TASK_ADMIN_PATH ||
    pathname.startsWith(`${LOYALIS_TASK_PATH}/`) ||
    pathname.startsWith(`${LOYALIS_TASK_ADMIN_PATH}/`) ||
    pathname.startsWith(`${LEGACY_LOYALIS_TASK_ADMIN_PATH}/`)
  );
}

export const LOYALIS_TASK_STATUSES = ['open', 'completed'] as const;
export type LoyalisTaskStatus = (typeof LOYALIS_TASK_STATUSES)[number];

export const LOYALIS_TASK_STATUS_LABELS: Readonly<Record<LoyalisTaskStatus, string>> = {
  open: 'Belum Selesai',
  completed: 'Selesai',
};

export const MAX_LOYALIS_TASK_TITLE_LENGTH = 120;
export const MAX_LOYALIS_TASK_DESCRIPTION_LENGTH = 2000;

export function isLoyalisTaskStatus(value: unknown): value is LoyalisTaskStatus {
  return typeof value === 'string' && (LOYALIS_TASK_STATUSES as readonly string[]).includes(value);
}

/** A task as the pages see it; dates are ISO strings, `dueDate` is `YYYY-MM-DD`. */
export interface LoyalisTaskView {
  id: string;
  assigneeEmployeeId: string;
  assigneeName: string;
  title: string;
  description: string;
  dueDate: string | null;
  status: LoyalisTaskStatus;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface LoyalisTaskFields {
  title: string;
  description: string;
  dueDate: string | null;
}

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * The editable fields of a task. A new task's due date cannot be in the past;
 * when editing, pass the task's current due date as `keepDueDate` so an
 * overdue task can be reworded without its date being rejected.
 */
export function validateLoyalisTaskFields(
  raw: unknown,
  today: string,
  keepDueDate: string | null = null,
): LoyalisTaskFields {
  const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title) throw new Error('Judul tugas wajib diisi.');
  if (title.length > MAX_LOYALIS_TASK_TITLE_LENGTH) {
    throw new Error(`Judul tugas maksimal ${MAX_LOYALIS_TASK_TITLE_LENGTH} karakter.`);
  }

  const description = typeof input.description === 'string' ? input.description.trim() : '';
  if (description.length > MAX_LOYALIS_TASK_DESCRIPTION_LENGTH) {
    throw new Error(`Deskripsi maksimal ${MAX_LOYALIS_TASK_DESCRIPTION_LENGTH} karakter.`);
  }

  const rawDue = typeof input.dueDate === 'string' ? input.dueDate.trim() : '';
  let dueDate: string | null = null;
  if (rawDue) {
    if (!isRealDate(rawDue)) throw new Error('Tenggat tidak valid.');
    if (rawDue < today && rawDue !== keepDueDate) {
      throw new Error('Tenggat tidak boleh sebelum hari ini.');
    }
    dueDate = rawDue;
  }

  return { title, description, dueDate };
}

/** The Loyalis a new task is for, as an `Employees_Loyalis` document id. */
export function parseLoyalisTaskAssignee(raw: unknown): string {
  const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const id = typeof input.assigneeEmployeeId === 'string' ? input.assigneeEmployeeId.trim() : '';
  if (!id) throw new Error('Pilih Loyalis penerima tugas.');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error('Loyalis penerima tidak valid.');
  return id;
}

/**
 * A Loyalis (or Super Admin) moves a task between open and completed in either
 * direction. Asking for the status a task already has changes nothing, so a
 * double tap or a retry is harmless.
 */
export function planLoyalisTaskStatusChange(
  current: LoyalisTaskStatus,
  next: unknown,
): { changed: boolean; status: LoyalisTaskStatus } {
  if (!isLoyalisTaskStatus(next)) throw new Error('Status tugas tidak valid.');
  return { changed: next !== current, status: next };
}

export function isLoyalisTaskOverdue(
  task: Pick<LoyalisTaskView, 'status' | 'dueDate'>,
  today: string,
): boolean {
  return task.status === 'open' && task.dueDate !== null && task.dueDate < today;
}

/**
 * Open tasks first, by due date (so overdue ones lead), then undated ones,
 * newest first. Completed tasks follow, the latest completed on top.
 */
export function sortLoyalisTasks<T extends LoyalisTaskView>(tasks: readonly T[]): T[] {
  const rank = (task: T): number => {
    if (task.status === 'completed') return 2;
    return task.dueDate !== null ? 0 : 1;
  };
  return [...tasks].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    if (a.status === 'completed') {
      return (b.completedAt ?? '').localeCompare(a.completedAt ?? '');
    }
    if (a.dueDate !== null && b.dueDate !== null && a.dueDate !== b.dueDate) {
      return a.dueDate.localeCompare(b.dueDate);
    }
    return b.createdAt.localeCompare(a.createdAt);
  });
}

/** What the navigation needs: whether the page exists for this Loyalis, and the open count. */
export function summarizeLoyalisTasks(
  tasks: readonly Pick<LoyalisTaskView, 'status'>[],
): { hasTasks: boolean; openCount: number } {
  return {
    hasTasks: tasks.length > 0,
    openCount: tasks.filter((task) => task.status === 'open').length,
  };
}

/** `2026-11-05` as "5 Nov 2026". */
export function formatLoyalisTaskDate(dueDate: string): string {
  const parsed = new Date(`${dueDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return dueDate;
  return parsed.toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
