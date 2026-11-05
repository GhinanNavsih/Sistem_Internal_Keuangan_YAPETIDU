import type { RekapColumn, UraianEntry } from '@/types';
import { resolveRekapColumnsForSlip, satpamSlipPeriod } from './slipBuilders';
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
  period?: string,
): Set<string> {
  const labels = new Set<string>();
  for (const column of resolveRekapColumnsForSlip(
    jobCategory,
    uraian,
    customColumns,
    satpamSlipPeriod(jobCategory, period),
  )) {
    if (column.slipLabel) labels.add(normalizeLabel(column.slipLabel));
  }
  return labels;
}

export function uraianOwnedEarningPredicate(
  jobCategory: string,
  uraian?: UraianEntry,
  customColumns?: RekapColumn[],
  period?: string,
): OwnedLabelPredicate {
  const labels = uraianOwnedEarningLabels(jobCategory, uraian, customColumns, period);
  const legacySatpamBonusLabels =
    jobCategory === 'SATPAM'
      ? new Set(['bonus presensi mutlak', 'bonus mutlak'])
      : null;
  // Draft slips created before the terminology change carry this old label.
  // Owning it lets propagation remove the legacy row and append the canonical
  // Presensi Harian row instead of leaving both amounts on one slip.
  const legacyBlueCollarAttendanceLabels =
    jobCategory === 'SATPAM' ? null : new Set(['vakasi harian']);
  return (label: string) => {
    const normalized = normalizeLabel(label);
    return (
      labels.has(normalized) ||
      Boolean(legacySatpamBonusLabels?.has(normalized)) ||
      Boolean(legacyBlueCollarAttendanceLabels?.has(normalized))
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

// The pay rules themselves live in `loyalisPresencePay.ts`; this module only
// decides which slip rows a presence run owns.

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
