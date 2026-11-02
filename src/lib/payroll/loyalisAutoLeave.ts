import { isDateOnly } from './annualPaidLeave';
import { planAutoAbsenceLeave, type AutoLeaveUncoveredReason } from './autoAbsenceLeave';
export type { AutoLeavePlanInput, AutoLeavePlan, AutoLeaveUncoveredReason } from './autoAbsenceLeave';

/**
 * Automatic cuti for a Loyalis who was absent on a working day without any
 * leave submission. When the month's presence is saved, each such day spends
 * one day of the employee's annual balance and counts as CUTI; with no balance
 * left (or before the first entitlement) the day stays an absence.
 *
 * Everything here is pure. The server applies the plan
 * (`src/lib/server/loyalisAutoLeave.ts`), and it is re-derived on every save,
 * so a later correction or a fixed scan releases the day again.
 */

/** First payroll period the rule applies to; earlier months are never touched. */
export const LOYALIS_AUTO_LEAVE_START_PERIOD = '2026-09';

/** `source` of an annual-leave request the system created from an absence. */
export const AUTO_ABSENCE_LEAVE_SOURCE = 'auto_absence' as const;

export const AUTO_ABSENCE_LEAVE_REASON = 'Tidak hadir pada hari kerja tanpa pengajuan.';
export const AUTO_ABSENCE_DECISION_REASON =
  'Cuti otomatis: saldo cuti dipakai untuk hari tidak hadir tanpa pengajuan.';

export interface AutoLeaveDailyLog {
  Tanggal?: unknown;
  'Jam kerja'?: unknown;
}

/** "29-09-2026" (as stored in dailyLogs) to "2026-09-29", or '' when it is not one. */
export function loyalisLogDateToIso(tanggal: unknown): string {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(tanggal ?? '').trim());
  if (!match) return '';
  const iso = `${match[3]}-${match[2]}-${match[1]}`;
  return isDateOnly(iso) ? iso : '';
}

export function isAutoLeavePeriod(period: string): boolean {
  return /^\d{4}-\d{2}$/.test(period) && period >= LOYALIS_AUTO_LEAVE_START_PERIOD;
}

/**
 * The working days of `period` on which the presence marks the employee
 * absent. Jumat and Tanggal Merah (`isOffDay`) are never working days, so
 * missing them is no absence.
 */
export function autoLeaveAbsentDates(
  dailyLogs: readonly AutoLeaveDailyLog[] | null | undefined,
  period: string,
  isOffDay: (isoDate: string) => boolean,
): string[] {
  const dates = new Set<string>();
  for (const log of dailyLogs || []) {
    if (String(log['Jam kerja'] ?? '').trim().toUpperCase() !== 'TIDAK HADIR') continue;
    const iso = loyalisLogDateToIso(log.Tanggal);
    if (!iso || !iso.startsWith(`${period}-`) || isOffDay(iso)) continue;
    dates.add(iso);
  }
  return Array.from(dates).sort();
}

/**
 * Decides which absent days the balance covers. Earlier days come first, and
 * each day is held to the entitlement of its own date (the tiers grow with the
 * years of service). The balance already held by everything except this
 * period's automatic days (pending and approved requests, manual days) comes
 * off the top, so re-planning after a save changes nothing unless the presence
 * or the balance moved.
 */
export const planLoyalisAutoLeave = planAutoAbsenceLeave;

export interface AutoLeaveEmployeeResult {
  employeeId: string;
  employeeName: string;
  /** Days newly covered by cuti in this run (YYYY-MM-DD). */
  covered: string[];
  /** Days whose earlier automatic cuti was taken back. */
  released: string[];
  /** Absent working days the balance could not cover. */
  uncovered: Array<{ date: string; reason: AutoLeaveUncoveredReason }>;
  updated?: string[];
  balance?: { entitlementDays: number; usedDays: number; reservedDays: number; availableDays: number };
  /** Dates or employees awaiting reliable source evidence. */
  held?: Array<{ date: string | null; reason: string }>;
  /** Why this employee was not processed, when that is the case. */
  skipped?: string;
  /** A processing error rather than an ineligible/finalized employee. */
  failed?: boolean;
}

export interface AutoLeaveSummary {
  period: string;
  /** False when nothing was processed for the whole period; `note` says why. */
  applicable: boolean;
  note?: string;
  results: AutoLeaveEmployeeResult[];
}

const MAX_NAMES_SHOWN = 4;

function nameList(names: readonly string[]): string {
  const shown = names.slice(0, MAX_NAMES_SHOWN).join(', ');
  return names.length > MAX_NAMES_SHOWN ? `${shown}, dan ${names.length - MAX_NAMES_SHOWN} lainnya` : shown;
}

/** The sentence(s) the presence page shows after a save; '' when nothing happened. */
export function describeAutoLeaveSummary(summary: AutoLeaveSummary): string {
  if (!summary.applicable) return summary.note ? ` ${summary.note}` : '';
  const covered = summary.results.filter((item) => item.covered.length > 0);
  const released = summary.results.filter((item) => item.released.length > 0);
  const uncovered = summary.results.filter((item) => item.uncovered.length > 0);
  const skipped = summary.results.filter((item) => item.skipped);
  const parts: string[] = [];
  if (covered.length > 0) {
    const days = covered.reduce((total, item) => total + item.covered.length, 0);
    parts.push(`Cuti otomatis dipakai ${days} hari untuk ${covered.length} pegawai.`);
  }
  if (released.length > 0) {
    const days = released.reduce((total, item) => total + item.released.length, 0);
    parts.push(`${days} hari cuti otomatis dikembalikan ke saldo (presensi atau pengajuan berubah).`);
  }
  if (uncovered.length > 0) {
    const days = uncovered.reduce((total, item) => total + item.uncovered.length, 0);
    parts.push(
      `${days} hari tetap tidak hadir karena saldo cuti habis atau belum berhak: ${nameList(
        uncovered.map((item) => item.employeeName),
      )}.`,
    );
  }
  if (skipped.length > 0) {
    parts.push(
      `Tidak diproses: ${nameList(
        skipped.map((item) => `${item.employeeName} (${item.skipped})`),
      )}.`,
    );
  }
  return parts.length > 0 ? ` ${parts.join(' ')}` : '';
}
