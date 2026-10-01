/**
 * Multi-day leave: an employee who is sick or on cuti for several days picks a
 * first and last date once, and every date in between gets a request of its
 * own. The server still sees one request per date, so balance, period and
 * duplicate rules stay exactly as they are for a single day.
 */

/** A month. Guards against a mistyped year turning into thousands of requests. */
export const MAX_LEAVE_RANGE_DAYS = 31;

export type LeaveRangeError = 'invalid' | 'reversed' | 'too_long';

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseUtc(value: string): number | null {
  const match = DATE_ONLY.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const time = Date.UTC(year, month - 1, day);
  const date = new Date(time);
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? time
    : null;
}

function formatUtc(time: number): string {
  const date = new Date(time);
  return [
    String(date.getUTCFullYear()).padStart(4, '0'),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

/**
 * Every calendar date from `start` to `end`, both included. An empty `end`
 * means a single day. Only the first and last date are the employee's choice;
 * weekends and holidays inside the range are not skipped.
 */
export function expandLeaveDateRange(
  start: string,
  end: string,
): { dates: string[]; error: LeaveRangeError | null } {
  const first = parseUtc(start);
  if (first === null) return { dates: [], error: 'invalid' };
  if (!end || end === start) return { dates: [start], error: null };
  const last = parseUtc(end);
  if (last === null) return { dates: [], error: 'invalid' };
  if (last < first) return { dates: [], error: 'reversed' };
  const dayCount = Math.round((last - first) / 86_400_000) + 1;
  if (dayCount > MAX_LEAVE_RANGE_DAYS) return { dates: [], error: 'too_long' };
  return {
    dates: Array.from({ length: dayCount }, (_, index) => formatUtc(first + index * 86_400_000)),
    error: null,
  };
}

export function leaveRangeErrorMessage(error: LeaveRangeError): string {
  switch (error) {
    case 'invalid':
      return 'Tanggal tidak valid.';
    case 'reversed':
      return 'Tanggal akhir tidak boleh lebih awal dari tanggal mulai.';
    case 'too_long':
      return `Rentang tanggal maksimal ${MAX_LEAVE_RANGE_DAYS} hari.`;
  }
}

export interface LeaveRangeOutcome {
  succeeded: string[];
  /** Dates left out because they already hold an active request. */
  skipped: string[];
  failed: { date: string; message: string }[];
}

/**
 * Submits the dates one by one. A failed date does not stop the rest, so the
 * employee can see exactly which days went through and resend only the others.
 */
export async function submitLeaveRange(
  dates: readonly string[],
  isAlreadySubmitted: (date: string) => boolean,
  submitOne: (date: string) => Promise<void>,
  onProgress?: (done: number, total: number) => void,
): Promise<LeaveRangeOutcome> {
  const outcome: LeaveRangeOutcome = { succeeded: [], skipped: [], failed: [] };
  const todo = dates.filter((date) => {
    if (!isAlreadySubmitted(date)) return true;
    outcome.skipped.push(date);
    return false;
  });
  for (const [index, date] of todo.entries()) {
    onProgress?.(index, todo.length);
    try {
      await submitOne(date);
      outcome.succeeded.push(date);
    } catch (cause) {
      outcome.failed.push({
        date,
        message: cause instanceof Error ? cause.message : 'Pengajuan gagal dikirim.',
      });
    }
  }
  onProgress?.(todo.length, todo.length);
  return outcome;
}

/** Plain-language result for the status banner. `failed` means nothing went through or some did not. */
export function describeLeaveRangeOutcome(
  outcome: LeaveRangeOutcome,
  noun: string,
  formatDate: (date: string) => string = (date) => date,
): { failed: boolean; text: string } {
  const lines: string[] = [];
  const { succeeded, skipped, failed } = outcome;
  if (succeeded.length > 0) {
    lines.push(`${succeeded.length} hari ${noun} berhasil dikirim.`);
  }
  if (skipped.length > 0) {
    lines.push(
      `Dilewati karena sudah ada pengajuan: ${skipped.map(formatDate).join(', ')}.`,
    );
  }
  for (const item of failed) {
    lines.push(`${formatDate(item.date)}: ${item.message}`);
  }
  if (lines.length === 0) lines.push(`Tidak ada tanggal baru untuk diajukan.`);
  return { failed: failed.length > 0 || succeeded.length === 0, text: lines.join(' ') };
}
