import type { MoneyField } from './domain';
import { normalizeLabel, type OwnedLabelPredicate } from './slipPropagation';

export const PROPOSAL_LPJ_SANDBOX_SOURCE_KIND = 'proposal_lpj_report';
export const VAKASI_PEKARYA_PROJECTION_SOURCE_KIND =
  'vakasi_tambahan_pekarya';

export type VakasiEmployeeCollection =
  | 'Employees_Loyalis'
  | 'Employees_BlueCollar';

export interface VakasiWorkerLike {
  employeeName?: unknown;
  payGiven?: unknown;
  employeeCollection?: unknown;
  jobCategory?: unknown;
  department?: unknown;
  role?: unknown;
}

export interface ResolvedVakasiWorker {
  employeeId: string;
  employeeName: string;
  payGiven: number;
  employeeCollection: VakasiEmployeeCollection;
  jobCategory?: string;
  department?: string;
  role?: string;
}

export interface VakasiPekaryaProjectionInput {
  id: string;
  sourceVakasiEventId: string;
  sourceKind: typeof VAKASI_PEKARYA_PROJECTION_SOURCE_KIND;
  eventName: string;
  period: string;
  jobCategory: string;
  eventFee: number;
  variablePay: boolean;
  eventWorkers: Record<string, { employeeName: string; payGiven: number }>;
  totalPayout: number;
}

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
  eventWorkers?: Record<string, VakasiWorkerLike> | unknown;
  ownedEarningLabelsByEmployee?: Record<string, unknown> | unknown;
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

/**
 * Old Vakasi records predate recipient typing and historically contained only
 * Loyalis workers. Treat an absent/unknown marker as Loyalis so those records
 * keep paying exactly as before, while explicitly typed Pekarya recipients can
 * never leak into itemized Vakasi earnings.
 */
export function vakasiWorkerCollection(
  worker: VakasiWorkerLike | null | undefined,
): VakasiEmployeeCollection {
  return worker?.employeeCollection === 'Employees_BlueCollar'
    ? 'Employees_BlueCollar'
    : 'Employees_Loyalis';
}

function loyalisWorkerPayGiven(
  event: VakasiTambahanEventLike,
  employeeId: string,
): number | null {
  const workers =
    event.eventWorkers && typeof event.eventWorkers === 'object'
      ? (event.eventWorkers as Record<string, VakasiWorkerLike>)
      : {};
  const worker = workers[employeeId];
  if (!worker) return null;
  if (vakasiWorkerCollection(worker) !== 'Employees_Loyalis') return null;
  const amount = Number(worker.payGiven);
  return Number.isFinite(amount) ? amount : 0;
}

/** Stable Firestore id for the one projection owned by an event/category pair. */
export function vakasiPekaryaProjectionId(
  sourceVakasiEventId: string,
  jobCategory: string,
): string {
  const safeEvent = sourceVakasiEventId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 180);
  const safeCategory = encodeURIComponent(jobCategory.normalize('NFKC').trim())
    .replaceAll('%', '~');
  return `VAKASI_PEKARYA__${safeEvent}__${safeCategory}`;
}

/**
 * Partitions authoritative mixed Vakasi recipients into one Pekarya SPJ
 * projection per job category. Loyalis recipients are intentionally omitted.
 */
export function buildVakasiPekaryaProjectionInputs(input: {
  sourceVakasiEventId: string;
  eventName: string;
  period: string;
  workers: readonly ResolvedVakasiWorker[];
}): VakasiPekaryaProjectionInput[] {
  const byCategory = new Map<string, ResolvedVakasiWorker[]>();
  for (const worker of input.workers) {
    if (worker.employeeCollection !== 'Employees_BlueCollar') continue;
    const category = worker.jobCategory?.trim();
    if (!category) continue;
    const categoryWorkers = byCategory.get(category) || [];
    categoryWorkers.push(worker);
    byCategory.set(category, categoryWorkers);
  }

  return [...byCategory.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'id'))
    .map(([jobCategory, workers]) => {
      const amounts = new Set(workers.map((worker) => worker.payGiven));
      const eventWorkers = Object.fromEntries(
        [...workers]
          .sort((left, right) => left.employeeId.localeCompare(right.employeeId))
          .map((worker) => [
            worker.employeeId,
            { employeeName: worker.employeeName, payGiven: worker.payGiven },
          ]),
      );
      return {
        id: vakasiPekaryaProjectionId(input.sourceVakasiEventId, jobCategory),
        sourceVakasiEventId: input.sourceVakasiEventId,
        sourceKind: VAKASI_PEKARYA_PROJECTION_SOURCE_KIND,
        eventName: input.eventName,
        period: input.period,
        jobCategory,
        eventFee: amounts.size === 1 ? workers[0].payGiven : 0,
        variablePay: amounts.size > 1,
        eventWorkers,
        totalPayout: workers.reduce((sum, worker) => sum + worker.payGiven, 0),
      };
    });
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
    const historicalLabels =
      event.ownedEarningLabelsByEmployee &&
      typeof event.ownedEarningLabelsByEmployee === 'object'
        ? (event.ownedEarningLabelsByEmployee as Record<string, unknown>)[employeeId]
        : undefined;
    if (Array.isArray(historicalLabels)) {
      historicalLabels.forEach((label) => {
        if (typeof label === 'string' && label.trim()) {
          names.add(normalizeLabel(label));
        }
      });
    }
    if (loyalisWorkerPayGiven(event, employeeId) === null) continue;
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
    const amount = loyalisWorkerPayGiven(event, employeeId);
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
