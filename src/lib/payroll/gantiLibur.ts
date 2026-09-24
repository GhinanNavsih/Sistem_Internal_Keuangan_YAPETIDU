import { isDateOnly } from './annualPaidLeave';
import { normalizeAttendanceTime } from './attendance';
import type { GantiLiburAttachment } from './gantiLiburAttachments';
import {
  LOYALIS_WORK_WINDOW_END_MINUTES,
  LOYALIS_WORK_WINDOW_START_MINUTES,
} from './loyalisPresenceWindow';

/**
 * Ganti libur (compensatory day off) — Loyalis only.
 *
 * A Loyalis who comes in on a non-working day (Jumat or Tanggal Merah) for the
 * full 07:30–14:00 window earns one day off on a working day. Coming in for
 * less than that is lembur, not ganti libur. At most two ganti libur days may
 * be taken in one Saturday–Friday week (it ends on the Loyalis weekly day
 * off, Friday). The worked holiday and the day off may
 * fall in either order; the request is verified once the worked date's
 * attendance has been uploaded (the start of the following month).
 */

export const GANTI_LIBUR_MAX_DAYS_PER_WEEK = 2;
export const GANTI_LIBUR_REQUIRED_SCAN_IN = '07:30' as const;
export const GANTI_LIBUR_REQUIRED_SCAN_OUT = '14:00' as const;

export type GantiLiburStatus = 'pending' | 'approved' | 'declined' | 'withdrawn';

export type GantiLiburAttendanceVerdict =
  /** Scanned in by 07:30 and out at or after 14:00. */
  | 'eligible'
  /** Both scans exist but cover less than 07:30–14:00. */
  | 'lembur'
  /** Only one genuine scan, so the hours cannot be verified. */
  | 'incomplete'
  /** No scan on the worked date. */
  | 'absent'
  /** The worked date's attendance has not been uploaded yet. */
  | 'awaiting_upload';

export interface GantiLiburAttendanceCheck {
  verdict: GantiLiburAttendanceVerdict;
  /** "HH:MM", or '' when there is no genuine scan. */
  scanIn: string;
  scanOut: string;
}

export interface GantiLiburRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  /** The Jumat / Tanggal Merah the employee came in. */
  workedDate: string;
  workedPeriod: string;
  /** The working day taken off in exchange. */
  dayOffDate: string;
  dayOffPeriod: string;
  reason: string;
  status: GantiLiburStatus;
  revision: number;
  decisionReason?: string | null;
  /** Live for pending requests; the snapshot taken at decision otherwise. */
  attendanceCheck?: GantiLiburAttendanceCheck | null;
  /** Surat resmi files the employee attached; optional. */
  attachments?: GantiLiburAttachment[];
}

export interface GantiLiburDailyLog {
  Tanggal?: unknown;
  'Jam kerja'?: unknown;
  'Scan masuk'?: unknown;
  'Scan pulang'?: unknown;
  scanMasukAuto?: unknown;
  scanPulangAuto?: unknown;
  [key: string]: unknown;
}

export type GantiLiburSubmitIssue =
  | 'invalid_date'
  | 'same_date'
  | 'worked_date_not_off_day'
  | 'day_off_not_working_day'
  | 'worked_date_used'
  | 'day_off_taken'
  | 'weekly_limit';

export type GantiLiburDecisionIssue =
  | 'period_closed'
  | 'immutable_slip'
  | 'revision_conflict'
  | 'not_pending'
  | 'attendance_not_verified'
  | 'day_off_now_holiday'
  | 'day_off_conflict';

/** Statuses that hold a worked date and a day off. */
export function isActiveGantiLiburStatus(status: unknown): boolean {
  return status === 'pending' || status === 'approved';
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/**
 * The non-working day (Jumat or Tanggal Merah) nearest to `today`, looking up
 * to `maxDays` either side; '' when there is none. Today counts. On a tie the
 * earlier date wins, since a holiday already worked is likelier to be the one
 * being claimed. `isTaken` skips a day that cannot be used, such as one an
 * earlier request already holds. Used to pre-fill the worked-holiday field.
 */
export function closestGantiLiburOffDay(input: {
  today: string;
  isOffDay: (date: string) => boolean;
  isTaken?: (date: string) => boolean;
  maxDays?: number;
}): string {
  if (!isDateOnly(input.today)) return '';
  const maxDays = input.maxDays ?? 60;
  for (let distance = 0; distance <= maxDays; distance += 1) {
    const candidates = distance === 0
      ? [input.today]
      : [addDays(input.today, -distance), addDays(input.today, distance)];
    for (const candidate of candidates) {
      if (input.isOffDay(candidate) && !input.isTaken?.(candidate)) return candidate;
    }
  }
  return '';
}

/** Day the ganti libur week starts on, as `Date#getUTCDay` numbers it (6 = Saturday). */
const WEEK_START_WEEKDAY = 6;

/** Saturday of the Saturday–Friday week containing `date`. */
export function gantiLiburWeekStart(date: string): string {
  if (!isDateOnly(date)) throw new Error('Tanggal wajib menggunakan format YYYY-MM-DD.');
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return addDays(date, -((weekday - WEEK_START_WEEKDAY + 7) % 7));
}

/** Friday of the Saturday–Friday week containing `date`. */
export function gantiLiburWeekEnd(date: string): string {
  return addDays(gantiLiburWeekStart(date), 6);
}

/**
 * How many active ganti libur days fall in the same Saturday–Friday week as
 * `dayOffDate`, leaving out the request with `excludeId` (the one being
 * resubmitted).
 */
export function gantiLiburWeekUsage(
  requests: readonly Pick<GantiLiburRequest, 'id' | 'dayOffDate' | 'status'>[],
  dayOffDate: string,
  excludeId?: string,
): number {
  const weekStart = gantiLiburWeekStart(dayOffDate);
  return requests.filter(
    (request) =>
      request.id !== excludeId &&
      isActiveGantiLiburStatus(request.status) &&
      isDateOnly(request.dayOffDate) &&
      gantiLiburWeekStart(request.dayOffDate) === weekStart,
  ).length;
}

export function gantiLiburSubmitIssue(input: {
  requestId: string;
  workedDate: string;
  dayOffDate: string;
  /** Jumat or Tanggal Merah. */
  isOffDay: (date: string) => boolean;
  /** Status of the stored request for this worked date, if any. */
  currentStatus?: unknown;
  /** Every request of this employee (the one being resubmitted may be among them). */
  requests: readonly Pick<GantiLiburRequest, 'id' | 'dayOffDate' | 'status'>[];
}): GantiLiburSubmitIssue | null {
  if (!isDateOnly(input.workedDate) || !isDateOnly(input.dayOffDate)) {
    return 'invalid_date';
  }
  if (input.workedDate === input.dayOffDate) return 'same_date';
  if (!input.isOffDay(input.workedDate)) return 'worked_date_not_off_day';
  if (input.isOffDay(input.dayOffDate)) return 'day_off_not_working_day';
  if (isActiveGantiLiburStatus(input.currentStatus)) return 'worked_date_used';
  if (
    input.requests.some(
      (request) =>
        request.id !== input.requestId &&
        isActiveGantiLiburStatus(request.status) &&
        request.dayOffDate === input.dayOffDate,
    )
  ) {
    return 'day_off_taken';
  }
  if (
    gantiLiburWeekUsage(input.requests, input.dayOffDate, input.requestId) >=
    GANTI_LIBUR_MAX_DAYS_PER_WEEK
  ) {
    return 'weekly_limit';
  }
  return null;
}

export function gantiLiburSubmitIssueMessage(issue: GantiLiburSubmitIssue): string {
  return {
    invalid_date: 'Tanggal wajib menggunakan format YYYY-MM-DD yang valid.',
    same_date: 'Tanggal masuk di hari libur dan tanggal ganti libur tidak boleh sama.',
    worked_date_not_off_day:
      'Tanggal masuk harus hari libur (Jumat atau Tanggal Merah).',
    day_off_not_working_day:
      'Tanggal ganti libur harus hari kerja, bukan Jumat atau Tanggal Merah.',
    worked_date_used:
      'Hari libur ini sudah dipakai untuk pengajuan ganti libur lain.',
    day_off_taken: 'Tanggal ganti libur ini sudah diajukan.',
    weekly_limit: `Ganti libur maksimal ${GANTI_LIBUR_MAX_DAYS_PER_WEEK} hari per minggu (Sabtu–Jumat).`,
  }[issue];
}

function scanMinutes(value: unknown): { minutes: number; display: string } | null {
  const normalized = normalizeAttendanceTime(
    typeof value === 'string' ? value.trim() : value,
  );
  if (!normalized) return null;
  const [hours, minutes] = normalized.split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return { minutes: hours * 60 + minutes, display: normalized.slice(0, 5) };
}

/** Work statuses that mean nobody actually scanned in that day. */
const NOT_WORKED_STATUSES = new Set(['TIDAK HADIR', 'CUTI', 'GANTI LIBUR']);

/**
 * Judges one day's attendance row against rule 1. A scan the presence
 * calculator generated for a forgotten tap (`scanMasukAuto` /
 * `scanPulangAuto`) is not a real scan, so it never counts toward the window.
 * Scans are compared to the minute, as the attendance export shows them.
 */
export function evaluateGantiLiburAttendance(
  row: GantiLiburDailyLog | null | undefined,
): GantiLiburAttendanceCheck {
  if (!row) return { verdict: 'absent', scanIn: '', scanOut: '' };
  const status = String(row['Jam kerja'] || '').trim().toUpperCase();
  if (NOT_WORKED_STATUSES.has(status)) {
    return { verdict: 'absent', scanIn: '', scanOut: '' };
  }
  const scanIn = row.scanMasukAuto === true ? null : scanMinutes(row['Scan masuk']);
  const scanOut = row.scanPulangAuto === true ? null : scanMinutes(row['Scan pulang']);
  const display = {
    scanIn: scanIn?.display || '',
    scanOut: scanOut?.display || '',
  };
  if (!scanIn && !scanOut) return { verdict: 'absent', ...display };
  if (!scanIn || !scanOut) return { verdict: 'incomplete', ...display };
  const eligible =
    scanIn.minutes <= LOYALIS_WORK_WINDOW_START_MINUTES &&
    scanOut.minutes >= LOYALIS_WORK_WINDOW_END_MINUTES;
  return { verdict: eligible ? 'eligible' : 'lembur', ...display };
}

function isoToLoyalisDate(date: string): string {
  return `${date.slice(8, 10)}-${date.slice(5, 7)}-${date.slice(0, 4)}`;
}

function loyalisDateToIso(value: unknown): string {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(value || '').trim());
  return match ? `${match[3]}-${match[2]}-${match[1]}` : '';
}

/**
 * Checks the worked date inside one employee's saved `LoyalisPresence` entry.
 * No entry, no daily logs, or logs that stop before the worked date all mean
 * the attendance for that date is not in yet — never that the employee was
 * absent.
 */
export function gantiLiburAttendanceCheck(
  entry: { dailyLogs?: unknown } | null | undefined,
  workedDate: string,
): GantiLiburAttendanceCheck {
  const logs = Array.isArray(entry?.dailyLogs)
    ? (entry.dailyLogs as GantiLiburDailyLog[]).filter(
        (row) => row && typeof row === 'object',
      )
    : [];
  const lastLoggedDate = logs
    .map((row) => loyalisDateToIso(row.Tanggal))
    .filter(Boolean)
    .sort()
    .at(-1);
  if (!lastLoggedDate || lastLoggedDate < workedDate) {
    return { verdict: 'awaiting_upload', scanIn: '', scanOut: '' };
  }
  const dateKey = isoToLoyalisDate(workedDate);
  return evaluateGantiLiburAttendance(
    logs.find((row) => String(row.Tanggal || '').trim() === dateKey),
  );
}

export function gantiLiburVerdictLabel(verdict: GantiLiburAttendanceVerdict): string {
  return {
    eligible: 'Memenuhi 07.30–14.00',
    lembur: 'Kurang dari 07.30–14.00 — dihitung lembur',
    incomplete: 'Scan tidak lengkap',
    absent: 'Tidak ada presensi',
    awaiting_upload: 'Menunggu data presensi',
  }[verdict];
}

/** A ready-made decline reason for a request that cannot be approved. */
export function gantiLiburDeclineSuggestion(
  verdict: GantiLiburAttendanceVerdict,
): string {
  return {
    eligible: '',
    lembur:
      'Jam kerja pada hari libur kurang dari 07.30–14.00 WIB, sehingga dihitung lembur, bukan ganti libur.',
    incomplete:
      'Presensi hari libur hanya memiliki satu scan, sehingga jam kerja 07.30–14.00 WIB tidak dapat dipastikan.',
    absent: 'Tidak ada presensi pada hari libur yang diajukan.',
    awaiting_upload: '',
  }[verdict];
}

export function gantiLiburDecisionIssue(input: {
  approving: boolean;
  periodClosed: boolean;
  immutableSlip: boolean;
  expectedRevision: number;
  currentRevision: number;
  status: GantiLiburStatus;
  verdict: GantiLiburAttendanceVerdict;
  dayOffIsOffDay: boolean;
  dayOffConflict: boolean;
}): GantiLiburDecisionIssue | null {
  if (input.approving && input.periodClosed) return 'period_closed';
  if (input.approving && input.immutableSlip) return 'immutable_slip';
  if (input.currentRevision !== input.expectedRevision) return 'revision_conflict';
  if (input.status !== 'pending') return 'not_pending';
  if (input.approving && input.verdict !== 'eligible') return 'attendance_not_verified';
  if (input.approving && input.dayOffIsOffDay) return 'day_off_now_holiday';
  if (input.approving && input.dayOffConflict) return 'day_off_conflict';
  return null;
}
