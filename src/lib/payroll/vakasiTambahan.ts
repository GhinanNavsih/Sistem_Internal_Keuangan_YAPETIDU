import type { MoneyField } from './domain';
import { normalizeLabel, type OwnedLabelPredicate } from './slipPropagation';

export const PROPOSAL_LPJ_SANDBOX_SOURCE_KIND = 'proposal_lpj_report';

interface VakasiTambahanFinancialRecord {
  sourceKind?: unknown;
  status?: unknown;
}

function asFinancialRecord(value: unknown): VakasiTambahanFinancialRecord {
  return value && typeof value === 'object'
    ? value as VakasiTambahanFinancialRecord
    : {};
}

/** Proposal/LPJ report assignments are sandbox data and must never become payroll earnings. */
export function isProposalLpjSandboxSource(value: unknown): boolean {
  return asFinancialRecord(value).sourceKind === PROPOSAL_LPJ_SANDBOX_SOURCE_KIND;
}

/** Shared guard for every VakasiTambahan reader that contributes to a payslip. */
export function isPayableVakasiTambahan(value: unknown): boolean {
  const record = asFinancialRecord(value);
  if (isProposalLpjSandboxSource(record)) return false;
  return !record.status || record.status === 'approved';
}

/**
 * Rules for pushing an approved VakasiTambahan event onto an already-saved
 * draft payslip, so the slip does not go stale between an event's approval
 * and whenever Finance next happens to re-save it.
 *
 * Pure module — no Firebase — so the whole rule set is unit tested. The
 * caller is expected to have already queried every VakasiTambahan document
 * for one period (any status) and hand the resulting list here.
 */

/** One VakasiTambahan document, narrowed to the fields propagation needs. */
export interface VakasiTambahanEventLike {
  eventName?: unknown;
  eventWorkers?: Record<string, { payGiven?: unknown }> | unknown;
  status?: unknown;
  sourceKind?: unknown;
}

/**
 * The label a slip carries when it predates per-event line items, or when an
 * employee's list happened to be empty at save time — see
 * buildInitialEarnings' fallback branch in slipBuilders.ts. Recognized as
 * owned so an old-style row is replaced by itemized rows once this runs,
 * rather than left behind alongside them.
 */
export const VAKASI_FALLBACK_EARNING_LABEL = 'Vakasi Tambahan';

function workerPayGiven(
  event: VakasiTambahanEventLike,
  employeeId: string,
): number | null {
  const workers =
    event.eventWorkers && typeof event.eventWorkers === 'object'
      ? (event.eventWorkers as Record<string, { payGiven?: unknown }>)
      : {};
  const worker = workers[employeeId];
  if (!worker) return null;
  const amount = Number(worker.payGiven);
  return Number.isFinite(amount) ? amount : 0;
}

/**
 * Every event name this employee has ever been listed against in this
 * period, regardless of current approval status. This is deliberately wider
 * than "currently approved" — a row this predicate does not recognize as
 * Vakasi-owned can never be cleaned up by a merge, so a name has to stay
 * recognized even after its event is declined, put back to review, or has
 * that worker removed, or the stale row survives on the slip forever.
 */
export function vakasiEventNamesForEmployee(
  events: readonly VakasiTambahanEventLike[],
  employeeId: string,
): Set<string> {
  const names = new Set<string>();
  for (const event of events) {
    if (isProposalLpjSandboxSource(event)) continue;
    if (workerPayGiven(event, employeeId) === null) continue;
    const eventName = typeof event.eventName === 'string' ? event.eventName.trim() : '';
    if (eventName) names.add(normalizeLabel(eventName));
  }
  return names;
}

/**
 * This employee's current approved Vakasi earnings for the period, one row
 * per distinct event name. Two approved events that happen to share a name
 * are summed into one row rather than emitted twice — mergeOwnedFields keys
 * its target rows by normalized label, so two rows with the same label would
 * silently collapse into whichever one it saw last.
 */
export function vakasiApprovedEarningsForEmployee(
  events: readonly VakasiTambahanEventLike[],
  employeeId: string,
): MoneyField[] {
  const amountsByName = new Map<string, number>();
  for (const event of events) {
    if (!isPayableVakasiTambahan(event)) continue;
    const amount = workerPayGiven(event, employeeId);
    if (amount === null) continue;
    const eventName = typeof event.eventName === 'string' ? event.eventName.trim() : '';
    if (!eventName) continue;
    amountsByName.set(eventName, (amountsByName.get(eventName) || 0) + amount);
  }
  return Array.from(amountsByName, ([label, amount]) => ({ label, amount }));
}

/** Recognizes an event-name row this employee has ever carried, plus the pre-itemization fallback label. */
export function vakasiOwnedEarningPredicate(
  eventNames: ReadonlySet<string>,
): OwnedLabelPredicate {
  const fallback = normalizeLabel(VAKASI_FALLBACK_EARNING_LABEL);
  return (label: string) => {
    const normalized = normalizeLabel(label);
    return normalized === fallback || eventNames.has(normalized);
  };
}
