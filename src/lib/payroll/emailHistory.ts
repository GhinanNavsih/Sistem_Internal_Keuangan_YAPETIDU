/**
 * Who has received their payslip email for a period, and how a running bulk
 * send changes that picture. The server's record is the truth: a slip marked
 * `emailSent` was mailed, whatever any browser remembers. Pure, so the rules
 * are unit tested; the Firestore reads live in /api/payroll/send-email (GET).
 */
import { isTransferEligibleStatus } from './domain';

/** A delivery still "sending" after this long never reported back. */
export const STALE_SENDING_MS = 5 * 60 * 1000;

export type EmailHistoryStatus = 'sent' | 'failed' | 'sending' | 'not_sent';

export interface EmailHistoryRow {
  employeeId: string;
  employeeName: string;
  email: string;
  status: EmailHistoryStatus;
  /** ISO time of the send the server recorded; null when not sent. */
  sentAt: string | null;
  /** Why the last attempt failed, or a caution about an unconfirmed one. */
  error: string | null;
  /** Delivery attempts recorded for this slip in the period. */
  attempts: number;
}

export interface SlipEmailInput {
  employeeId: string;
  status: unknown;
  emailSent: boolean;
  /** Milliseconds, or null when unknown. */
  emailSentAt: number | null;
}

export interface DeliveryEventInput {
  employeeId: string;
  status: string;
  recipient: string;
  /** Milliseconds; null when missing. */
  requestedAt: number | null;
  sentAt: number | null;
  error: string;
}

export const UNCONFIRMED_SEND_MESSAGE =
  'Server tidak mengonfirmasi pengiriman. Periksa kotak masuk karyawan sebelum mengirim ulang.';

function iso(ms: number | null): string | null {
  return ms !== null && Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export function buildEmailHistory(input: {
  slips: readonly SlipEmailInput[];
  deliveries: readonly DeliveryEventInput[];
  employees: ReadonlyMap<string, { name: string; email: string }>;
  now: number;
}): EmailHistoryRow[] {
  const deliveriesByEmployee = new Map<string, DeliveryEventInput[]>();
  for (const delivery of input.deliveries) {
    const list = deliveriesByEmployee.get(delivery.employeeId) || [];
    list.push(delivery);
    deliveriesByEmployee.set(delivery.employeeId, list);
  }

  const rows: EmailHistoryRow[] = [];
  for (const slip of input.slips) {
    const deliveries = (deliveriesByEmployee.get(slip.employeeId) || [])
      .slice()
      .sort((left, right) => (left.requestedAt ?? 0) - (right.requestedAt ?? 0));
    // Only final slips can be mailed; a draft with no history is not listed.
    if (!isTransferEligibleStatus(slip.status) && !slip.emailSent && deliveries.length === 0) continue;

    const employee = input.employees.get(slip.employeeId);
    const lastSent = [...deliveries].reverse().find((delivery) => delivery.status === 'sent');
    const latest = deliveries[deliveries.length - 1];
    const base = {
      employeeId: slip.employeeId,
      employeeName: employee?.name || slip.employeeId,
      email: lastSent?.recipient || latest?.recipient || employee?.email || '',
      attempts: deliveries.length,
    };

    if (slip.emailSent || lastSent) {
      rows.push({
        ...base,
        status: 'sent',
        sentAt: iso(slip.emailSentAt ?? lastSent?.sentAt ?? null),
        error: null,
      });
    } else if (latest?.status === 'sending') {
      const fresh = latest.requestedAt !== null && input.now - latest.requestedAt < STALE_SENDING_MS;
      rows.push({
        ...base,
        status: fresh ? 'sending' : 'failed',
        sentAt: null,
        error: fresh ? null : UNCONFIRMED_SEND_MESSAGE,
      });
    } else if (latest?.status === 'failed') {
      rows.push({ ...base, status: 'failed', sentAt: null, error: latest.error || 'Gagal mengirim.' });
    } else {
      rows.push({ ...base, status: 'not_sent', sentAt: null, error: null });
    }
  }
  return rows.sort((left, right) => left.employeeName.localeCompare(right.employeeName, 'id-ID'));
}

export type EmailDetailStatus = 'sent' | 'failed' | 'sending' | 'pending' | 'not_sent';

export interface EmailDetailRow {
  employeeId: string;
  employeeName: string;
  email: string;
  status: EmailDetailStatus;
  sentAt: string | null;
  note: string | null;
}

export interface QueueItemLike {
  employeeId: string;
  employeeName: string;
  email: string;
  status: 'pending' | 'sending' | 'success' | 'failed';
  error?: string;
  /** The server skipped it: the slip had already been mailed. */
  alreadySent?: boolean;
}

export const ALREADY_SENT_NOTE = 'Sudah terkirim sebelumnya, tidak dikirim ulang.';

/**
 * The period's history with the live queue laid over it. A send the server
 * recorded always shows as sent, even if this browser's queue still lists it.
 */
export function mergeEmailDetail(
  history: readonly EmailHistoryRow[] | null,
  queue: readonly QueueItemLike[] | null,
): EmailDetailRow[] {
  const rows = new Map<string, EmailDetailRow>();
  for (const row of history || []) {
    rows.set(row.employeeId, {
      employeeId: row.employeeId,
      employeeName: row.employeeName,
      email: row.email,
      status: row.status,
      sentAt: row.sentAt,
      note: row.error,
    });
  }
  for (const item of queue || []) {
    const recorded = rows.get(item.employeeId);
    if (recorded?.status === 'sent' && item.status !== 'success') continue;
    const status: EmailDetailStatus = item.status === 'success' ? 'sent' : item.status;
    rows.set(item.employeeId, {
      employeeId: item.employeeId,
      employeeName: item.employeeName || recorded?.employeeName || item.employeeId,
      email: item.email || recorded?.email || '',
      status,
      sentAt: status === 'sent' ? recorded?.sentAt ?? null : null,
      note:
        item.status === 'failed'
          ? item.error || 'Gagal mengirim.'
          : item.alreadySent
            ? ALREADY_SENT_NOTE
            : null,
    });
  }
  return [...rows.values()].sort((left, right) =>
    left.employeeName.localeCompare(right.employeeName, 'id-ID'),
  );
}
