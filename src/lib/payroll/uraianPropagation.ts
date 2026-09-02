import type { RekapColumn, UraianEntry } from '@/types';
import { resolveRekapColumnsForSlip } from './slipBuilders';
import { normalizeLabel, type OwnedLabelPredicate, type SlipFieldKind } from './slipPropagation';

/**
 * Rules for pushing a saved Uraian rekap — and the Loyalis presence
 * calculator — onto already-saved draft payslips.
 *
 * Employees cannot read `UraianGaji` or `LoyalisPresence` themselves, so
 * without this the numbers Finance locks in the rekap never reach the slip an
 * employee actually sees. As with profile propagation, only the labels the
 * source is authoritative for are overlaid; rows Finance types by hand and
 * rows owned by other systems keep their stored value.
 *
 * Pure module — no Firebase — so the whole rule set is unit tested.
 */

/**
 * Earnings labels a blue-collar Uraian rekap owns: every rekap column that
 * maps to a slip row, including the admin's own custom columns.
 *
 * Deliberately derived from the same column resolution the slip builder uses,
 * rather than a hand-maintained list — a new rekap column becomes propagatable
 * automatically instead of silently going stale.
 */
export function uraianOwnedEarningLabels(
  jobCategory: string,
  uraian?: UraianEntry,
  customColumns?: RekapColumn[],
): Set<string> {
  const labels = new Set<string>();
  for (const column of resolveRekapColumnsForSlip(jobCategory, uraian, customColumns)) {
    if (column.slipLabel) labels.add(normalizeLabel(column.slipLabel));
  }
  return labels;
}

export function uraianOwnedEarningPredicate(
  jobCategory: string,
  uraian?: UraianEntry,
  customColumns?: RekapColumn[],
): OwnedLabelPredicate {
  const labels = uraianOwnedEarningLabels(jobCategory, uraian, customColumns);
  const legacySatpamBonusLabels =
    jobCategory === 'SATPAM'
      ? new Set(['bonus presensi mutlak', 'bonus mutlak'])
      : null;
  return (label: string) => {
    const normalized = normalizeLabel(label);
    return (
      labels.has(normalized) ||
      Boolean(legacySatpamBonusLabels?.has(normalized))
    );
  };
}

/**
 * The Uraian rekap has no say over any deduction row, so its deduction
 * predicate owns nothing. Kept explicit rather than skipping deductions at the
 * call site, so the merge is driven by one uniform mechanism.
 */
export const ownsNothing: OwnedLabelPredicate = () => false;

// ── Loyalis presence ────────────────────────────────────────────────────────

/** Flat monthly attendance bonus for a Loyalis employee with no shortfall. */
export const LOYALIS_PRESENCE_BONUS = 250_000;
/** Rupiah per hour used for both the attendance earning and its shortfall. */
export const LOYALIS_HOURLY_RATE = 1_650;
export const LOYALIS_DEFAULT_WORKING_DAYS = 25;
export const LOYALIS_DEFAULT_EXPECTED_HOURS = 6.5;

export interface LoyalisPresenceEntry {
  deduction?: number;
  absenceMinutes?: number;
}

export interface LoyalisPresenceDocument {
  workingDays?: number;
  expectedHours?: number;
  entries?: Record<string, LoyalisPresenceEntry | undefined>;
}

export interface LoyalisPresenceAmounts {
  presensiEarning: number;
  presenceBonus: number;
  presensiDeduction: number;
  presenceDeduction: number;
}

/**
 * Mirrors the Loyalis presence maths the payroll dashboard applies when it
 * builds a slip, so a propagated slip and a manually refreshed one agree.
 *
 * Note the deliberate asymmetry carried over from the dashboard: while the
 * period has no presence document at all, everyone is credited the full
 * attendance earning and bonus. Once entries exist, an employee missing from
 * them is treated as having earned neither.
 */
export function loyalisPresenceAmounts(
  presence: LoyalisPresenceDocument | null | undefined,
  employeeId: string,
): LoyalisPresenceAmounts {
  const entries = presence?.entries;
  const hasEntries = Boolean(entries && Object.keys(entries).length > 0);
  const entry = hasEntries ? entries?.[employeeId] : undefined;
  const isMissingFromEntries = hasEntries && !entry;

  const workingDays = Number(presence?.workingDays) || LOYALIS_DEFAULT_WORKING_DAYS;
  const expectedHours = Number(presence?.expectedHours) || LOYALIS_DEFAULT_EXPECTED_HOURS;

  return {
    presensiEarning: isMissingFromEntries
      ? 0
      : Math.round(workingDays * expectedHours * LOYALIS_HOURLY_RATE),
    presenceBonus: isMissingFromEntries ? 0 : LOYALIS_PRESENCE_BONUS,
    presensiDeduction: entry
      ? Math.round(((Number(entry.absenceMinutes) || 0) / 60) * LOYALIS_HOURLY_RATE)
      : 0,
    presenceDeduction: entry ? Number(entry.deduction) || 0 : 0,
  };
}

const LOYALIS_PRESENCE_EARNING_LABELS = new Set(['presensi', 'bonus presensi']);
const LOYALIS_PRESENCE_DEDUCTION_LABELS = new Set([
  'potongan presensi',
  'potongan bonus presensi',
]);

export function loyalisPresenceOwnedPredicate(kind: SlipFieldKind): OwnedLabelPredicate {
  const labels =
    kind === 'earnings'
      ? LOYALIS_PRESENCE_EARNING_LABELS
      : LOYALIS_PRESENCE_DEDUCTION_LABELS;
  return (label: string) => labels.has(normalizeLabel(label));
}
