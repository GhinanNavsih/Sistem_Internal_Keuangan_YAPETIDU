import {
  LOYALIS_DAY_CREDIT_WORK_STATUS,
  loyalisPresenceStratum,
  paidLeaveIsoToLoyalisDate,
  type LoyalisPaidLeaveDailyLog,
  type LoyalisPaidLeaveEntry,
} from './loyalisPaidLeave';
import { recalculateLoyalisSummary } from './loyalisPresenceSummary';

/**
 * First period whose approved presence corrections are re-applied on top of
 * the scanner file. Earlier months were settled without it, so their saved
 * figures are never rewritten.
 */
export const LOYALIS_CORRECTION_OVERLAY_START_PERIOD = '2026-10';

const OVERLAY_CORRECTION_TYPES = new Set(['tap_in', 'tap_out', 'both', 'izin_resmi']);
const DAY_CREDIT_STATUSES = new Set(Object.values(LOYALIS_DAY_CREDIT_WORK_STATUS));
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The part of an approved correction request the overlay needs. */
export interface ApprovedLoyalisCorrection {
  id: string;
  employeeId: string;
  /** YYYY-MM-DD */
  date: string;
  type: string;
  status?: string;
  checkInTime?: string | null;
  checkOutTime?: string | null;
  /** Set when an admin turned the request into another kind (cuti, ganti libur). */
  typeChangedTo?: unknown;
}

/**
 * Approving a correction edits the saved presence once; a scanner file loaded
 * afterwards replaces those rows. This is what lets the correction be applied
 * again: only an approved izin resmi / scan correction counts, never one that
 * was converted to another kind.
 */
export function isApplicableApprovedCorrection(
  correction: Pick<ApprovedLoyalisCorrection, 'status' | 'type' | 'date' | 'typeChangedTo'>,
): boolean {
  return (
    correction.status === 'approved' &&
    !correction.typeChangedTo &&
    OVERLAY_CORRECTION_TYPES.has(correction.type) &&
    DATE_ONLY_PATTERN.test(correction.date)
  );
}

export function loyalisCorrectionOverlayApplies(period: string): boolean {
  return /^\d{4}-\d{2}$/.test(period) && period >= LOYALIS_CORRECTION_OVERLAY_START_PERIOD;
}

function dateSortValue(value: unknown): string {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(value ?? ''));
  return match ? `${match[3]}-${match[2]}-${match[1]}` : String(value ?? '');
}

/**
 * Writes each approved correction onto its day, the same way the approval
 * itself does (izin resmi is a full 07:30–14:00 day; masuk/pulang replace only
 * the scan they name). Rows are stamped with `appliedCorrectionId`, so:
 * - running this again changes nothing, and
 * - a scan the admin edited by hand afterwards is not reverted.
 * A day already credited as CUTI / GANTI LIBUR keeps that credit.
 *
 * Corrections are applied in the order given; the last one for a day wins.
 */
export function applyApprovedCorrectionsToDailyLogs<T extends LoyalisPaidLeaveDailyLog>(
  dailyLogs: readonly T[],
  corrections: readonly ApprovedLoyalisCorrection[],
): { dailyLogs: T[]; changed: boolean } {
  const logs = [...dailyLogs];
  let changed = false;

  for (const correction of corrections) {
    if (!isApplicableApprovedCorrection(correction)) continue;
    const dateKey = paidLeaveIsoToLoyalisDate(correction.date);
    if (!dateKey) continue;
    const index = logs.findIndex((row) => row.Tanggal === dateKey);
    const existing = index >= 0 ? logs[index] : null;
    if (existing?.appliedCorrectionId === correction.id) continue;
    if (
      existing &&
      DAY_CREDIT_STATUSES.has(String(existing['Jam kerja'] || '').trim().toUpperCase())
    ) {
      continue;
    }

    const existingScanIn = String(existing?.['Scan masuk'] || '');
    const existingScanOut = String(existing?.['Scan pulang'] || '');
    const checkIn =
      correction.type === 'izin_resmi'
        ? '07:30'
        : correction.type !== 'tap_out'
          ? correction.checkInTime || '07:30'
          : existingScanIn;
    const checkOut =
      correction.type === 'izin_resmi'
        ? '14:00'
        : correction.type !== 'tap_in'
          ? correction.checkOutTime || '14:00'
          : existingScanOut;

    const nextRow = {
      ...(existing || {}),
      Tanggal: dateKey,
      'Jam kerja': 'MASUK',
      'Scan masuk': checkIn,
      'Scan pulang': checkOut,
      scanMasukAuto: correction.type === 'tap_out' ? Boolean(existing?.scanMasukAuto) : false,
      scanPulangAuto: correction.type === 'tap_in' ? Boolean(existing?.scanPulangAuto) : false,
      appliedCorrectionId: correction.id,
    } as unknown as T;
    if (index >= 0) logs[index] = nextRow;
    else logs.push(nextRow);
    changed = true;
  }

  if (changed) {
    logs.sort((left, right) =>
      dateSortValue(left.Tanggal).localeCompare(dateSortValue(right.Tanggal)),
    );
  }
  return { dailyLogs: logs, changed };
}

/** Minutes → shortfall, strata and bonus, as the presence page and approvals compute them. */
export function calculateLoyalisPresenceStratum(
  minutes: number,
  mode: 'worked' | 'absent',
  days: number,
  hours: number,
) {
  const expectedTotal = days * hours * 60;
  const absenceMinutes = mode === 'worked' ? Math.max(0, expectedTotal - minutes) : minutes;
  return { absenceMinutes, ...loyalisPresenceStratum(absenceMinutes, days) };
}

/**
 * Entry-level overlay for server-side presence: applies the approved
 * corrections of one employee, then re-derives the entry's totals from its
 * logs. An entry with nothing to apply is returned untouched.
 */
export function applyApprovedCorrectionsToLoyalisEntry(input: {
  entry: LoyalisPaidLeaveEntry;
  corrections: readonly ApprovedLoyalisCorrection[];
  expectedHours: number;
  workingDays: number;
  mode: 'worked' | 'absent';
  isOffDay: (tanggal: string) => boolean;
}): LoyalisPaidLeaveEntry {
  const applied = applyApprovedCorrectionsToDailyLogs(
    input.entry.dailyLogs || [],
    input.corrections,
  );
  if (!applied.changed) return input.entry;
  const summary = recalculateLoyalisSummary(
    applied.dailyLogs,
    input.expectedHours,
    input.isOffDay,
  );
  return {
    ...input.entry,
    ...summary,
    ...calculateLoyalisPresenceStratum(
      summary.minutes,
      input.mode,
      input.workingDays,
      input.expectedHours,
    ),
    isNotFoundInExcel: false,
  };
}
