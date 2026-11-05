/**
 * Keeps a bulk payslip email run across a page reload. The queue is saved in
 * the tab's sessionStorage, so it survives a refresh but not closing the tab
 * (salary figures are not left behind on a shared computer). Nothing here can
 * cause a second email: every item keeps its requestId, which the server
 * dedupes on, and bulk sends skip slips the server already marked as sent.
 */

export const BULK_EMAIL_STORAGE_KEY = 'saku.bulkEmailJob.v1';
/** A run interrupted longer ago than this comes back paused, not sending. */
export const AUTO_RESUME_WINDOW_MS = 30 * 60 * 1000;

export type StoredJobStatus = 'sending' | 'paused' | 'done';
type ItemStatus = 'pending' | 'sending' | 'success' | 'failed';

export interface StorableQueueItem {
  employeeId: string;
  employeeName: string;
  email: string;
  status: ItemStatus;
  requestId?: string;
  slipData: unknown;
}

export interface StoredBulkEmailJob<TItem extends StorableQueueItem> {
  version: 1;
  uid: string;
  period: string;
  dbPeriod: string;
  status: StoredJobStatus;
  savedAt: number;
  queue: TItem[];
}

export interface RestoredBulkEmailJob<TItem extends StorableQueueItem> {
  period: string;
  dbPeriod: string;
  status: StoredJobStatus;
  queue: TItem[];
  /** True when the run was sending and picks up again without a click. */
  resumed: boolean;
}

const ITEM_STATUSES = new Set<ItemStatus>(['pending', 'sending', 'success', 'failed']);
const JOB_STATUSES = new Set<StoredJobStatus>(['sending', 'paused', 'done']);

function isItem(value: unknown): value is StorableQueueItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.employeeId === 'string' &&
    typeof item.employeeName === 'string' &&
    typeof item.email === 'string' &&
    typeof item.requestId === 'string' &&
    ITEM_STATUSES.has(item.status as ItemStatus) &&
    Boolean(item.slipData) && typeof item.slipData === 'object';
}

export function serializeBulkEmailJob<TItem extends StorableQueueItem>(
  job: Omit<StoredBulkEmailJob<TItem>, 'version'>,
): string {
  return JSON.stringify({ version: 1, ...job });
}

/**
 * The saved run for this user, or null when there is none, it is unreadable,
 * or it belongs to someone else who used this tab.
 */
export function restoreBulkEmailJob<TItem extends StorableQueueItem>(
  raw: string | null,
  uid: string,
  now: number,
): RestoredBulkEmailJob<TItem> | null {
  if (!raw || !uid) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const job = parsed as Record<string, unknown>;
  if (
    job.version !== 1 ||
    job.uid !== uid ||
    typeof job.period !== 'string' ||
    typeof job.dbPeriod !== 'string' ||
    !/^\d{4}_\d{2}$/.test(job.dbPeriod) ||
    !JOB_STATUSES.has(job.status as StoredJobStatus) ||
    typeof job.savedAt !== 'number' ||
    !Array.isArray(job.queue) ||
    job.queue.length === 0 ||
    !job.queue.every(isItem)
  ) {
    return null;
  }

  // A send cut off by the reload may or may not have gone out; asking again
  // with the same requestId lets the server answer which.
  const queue = (job.queue as TItem[]).map((item) =>
    item.status === 'sending' ? { ...item, status: 'pending' as const } : item,
  );
  const hasPending = queue.some((item) => item.status === 'pending');
  let status = job.status as StoredJobStatus;
  if (!hasPending) status = 'done';
  const recent = now - (job.savedAt as number) <= AUTO_RESUME_WINDOW_MS;
  if (status === 'sending' && !recent) status = 'paused';
  return {
    period: job.period,
    dbPeriod: job.dbPeriod,
    status,
    queue,
    resumed: status === 'sending',
  };
}
