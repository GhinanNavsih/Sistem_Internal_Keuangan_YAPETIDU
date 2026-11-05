import admin, { adminDb } from '@/lib/firebase-admin';
import type { RekapColumn, UraianEntry } from '@/types';
import { calculatePayrollTotals, validateMoneyFields } from '@/lib/payroll/domain';
import { recalculateSlipTaxes } from '@/lib/payroll/payrollTax';
import {
  buildInitialDeductions,
  buildInitialEarnings,
} from '@/lib/payroll/slipBuilders';
import {
  assertOnlyOwnedChanged,
  classifySlipForPropagation,
  DRIFT_NOTICES_COLLECTION,
  mergeOwnedFields,
  type OwnedLabelPredicate,
  type PropagationOutcome,
  type SlipFieldChange,
} from '@/lib/payroll/slipPropagation';
import {
  loyalisPresenceOwnedPredicate,
  uraianOwnedEarningPredicate,
} from '@/lib/payroll/uraianPropagation';
import { loyalisPresenceAmounts } from '@/lib/payroll/loyalisPresencePay';
import {
  isSatpamLegacyBonusColumn,
  normalizeSatpamUraianEntry,
} from '@/lib/payroll/satpamCompensation';
import { isAttendanceHeld } from '@/lib/payroll/pekaryaAttendanceSync';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '@/lib/server/audit';
import { HttpError, type AuthenticatedProfile } from '@/lib/server/auth';
import { reconcileAndLoadLoyalisPresence } from '@/lib/server/loyalisPresence';
import { ensurePekaryaAutoLeave } from '@/lib/server/pekaryaAutoLeave';
import { assertAutoLeaveReady, autoLeaveStateRef } from '@/lib/server/automaticLeavePosting';
import { employeeInPayrollPeriod } from '@/lib/employeeConversion';
import { attendancePublicationMatchesPolicy, pekaryaSingleScanPolicy } from '@/lib/payroll/attendance';
import { pekaryaPublicationId } from '@/lib/server/attendanceStore';

/** Employees handled per transaction; keeps writes well under Firestore's 500. */
const CHUNK_SIZE = 50;

export type PropagationScope = 'pekarya' | 'loyalis';

export interface PropagationCommand {
  scope: PropagationScope;
  /** Normalized to YYYY_MM. */
  periodKey: string;
  periodToken: string;
  jobCategory: string;
  requestId: string;
}

export interface PropagationOptions {
  /** The caller already reconciled automatic leave for this category. */
  autoLeaveReconciled?: boolean;
  /** Only these employees' slips; every other one is left alone. */
  employeeIds?: readonly string[];
}

interface SlipTarget {
  employeeId: string;
  /** Rows this source is authoritative for; everything else is left alone. */
  earningsOwned: OwnedLabelPredicate;
  deductionsOwned: OwnedLabelPredicate;
  freshEarnings: { label: string; amount: number }[];
  freshDeductions: { label: string; amount: number }[];
}

export interface EmployeeOutcome {
  employeeId: string;
  outcome: PropagationOutcome;
  changes: SlipFieldChange[];
}

export interface PropagationResult {
  period: string;
  scope: PropagationScope;
  summary: Record<string, number>;
  results: EmployeeOutcome[];
}

/**
 * The Uraian rekap changed while its figures were being written onto slips.
 * Whoever changed it runs their own propagation afterwards, so this run stops
 * instead of finishing with figures that are already out of date.
 */
export class UraianChangedDuringPropagation extends HttpError {
  constructor() {
    super(409, 'Rekap Uraian berubah saat slip diperbarui; pembaruan slip diulang.');
  }
}

export function uraianDocumentId(periodKey: string, jobCategory: string): string {
  return `${periodKey}_${jobCategory}`;
}

/** Blue-collar targets, built from the saved Uraian rekap entries. */
async function collectPekaryaTargets(
  command: PropagationCommand,
): Promise<{ targets: SlipTarget[]; uraianSnapshot: FirebaseFirestore.DocumentSnapshot }> {
  const [uraianSnapshot, teamSnapshot] = await Promise.all([
    adminDb
      .collection('UraianGaji')
      .doc(uraianDocumentId(command.periodKey, command.jobCategory))
      .get(),
    command.jobCategory === 'SATPAM'
      ? adminDb.collection('SatpamShiftTeams').get()
      : Promise.resolve(null),
  ]);
  if (!uraianSnapshot.exists) return { targets: [], uraianSnapshot };

  const data = uraianSnapshot.data() || {};
  const entries = (data.entries || {}) as Record<string, UraianEntry | undefined>;
  const customColumns = (Array.isArray(data.customColumns)
    ? (data.customColumns as RekapColumn[])
    : []).filter(
      (column) =>
        command.jobCategory !== 'SATPAM' || !isSatpamLegacyBonusColumn(column),
    );
  const ketuaShiftIds = new Set(
    (teamSnapshot?.docs || [])
      .map((snapshot) => String(snapshot.data()?.ketuaShiftId || '').trim())
      .filter(Boolean),
  );

  // Only the rekap-owned rows survive the merge, so the builder is fed a
  // minimal employee: the job category is all it needs to resolve columns, and
  // every profile-derived row it emits (Gaji Pokok, BPJS, Beras) is discarded.
  // That also means this reads no employee documents at all.
  const minimalEmployee = { employment: { jobCategory: command.jobCategory } };

  const targets: SlipTarget[] = [];
  for (const [employeeId, entry] of Object.entries(entries)) {
    if (!entry || !/^[A-Za-z0-9_-]{1,128}$/.test(employeeId)) continue;
    // Held for a NIPY problem: the slip keeps what it has until the hold lifts.
    if (isAttendanceHeld(entry)) continue;
    const effectiveEntry =
      command.jobCategory === 'SATPAM'
        ? normalizeSatpamUraianEntry(entry, ketuaShiftIds.has(employeeId))
        : entry;
    targets.push({
      employeeId,
      earningsOwned: uraianOwnedEarningPredicate(
        command.jobCategory,
        effectiveEntry,
        customColumns,
        command.periodToken,
      ),
      deductionsOwned: () => false,
      freshEarnings: buildInitialEarnings(
        minimalEmployee,
        0,
        'blue',
        effectiveEntry,
        0,
        [],
        0,
        0,
        customColumns,
        0,
        0,
        command.periodToken,
      ),
      freshDeductions: [],
    });
  }
  return { targets, uraianSnapshot };
}

/** Loyalis targets, built from the presence calculator's saved document. */
async function collectLoyalisTargets(
  command: PropagationCommand,
  actor: AuthenticatedProfile,
): Promise<SlipTarget[]> {
  const [presence, employeeSnapshot] = await Promise.all([
    reconcileAndLoadLoyalisPresence(command.periodToken, actor),
    adminDb.collection('Employees_Loyalis').get(),
  ]);

  const earningsOwned = loyalisPresenceOwnedPredicate('earnings');
  const deductionsOwned = loyalisPresenceOwnedPredicate('deductions');

  const targets: SlipTarget[] = [];
  for (const employeeDoc of employeeSnapshot.docs) {
    const employeeId = employeeDoc.id;
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(employeeId)) continue;
    // A record converted from Pekarya only has Loyalis slips from its switch month.
    if (!employeeInPayrollPeriod('Employees_Loyalis', employeeDoc.data(), command.periodToken)) {
      continue;
    }
    const amounts = loyalisPresenceAmounts(presence, employeeId, command.periodToken);
    targets.push({
      employeeId,
      earningsOwned,
      deductionsOwned,
      // The builder owns the label spelling; feeding it the presence amounts
      // keeps propagation and a manual Refresh byte-identical.
      freshEarnings: buildInitialEarnings(
        employeeDoc.data(),
        0,
        'loyalis',
        undefined,
        0,
        [],
        0,
        0,
        [],
        amounts.presenceBonus,
        amounts.presensiEarning,
        command.periodToken,
      ),
      freshDeductions: buildInitialDeductions(
        employeeDoc.data(),
        'loyalis',
        0,
        amounts.presenceDeduction,
        amounts.presensiDeduction,
        0,
        command.periodToken,
      ),
    });
  }
  return targets;
}

function sameDocumentVersion(
  left: FirebaseFirestore.DocumentSnapshot,
  right: FirebaseFirestore.DocumentSnapshot,
): boolean {
  if (!left.exists || !right.exists) return left.exists === right.exists;
  return Boolean(left.updateTime && right.updateTime && left.updateTime.isEqual(right.updateTime));
}

/**
 * Pushes a saved Uraian rekap (or the Loyalis presence calculator) onto the
 * draft payslips for that period.
 *
 * The command carries no amounts: every figure is re-derived here from the
 * source document. Slips past draft are never rewritten, so a locked slip
 * keeps its signature and snapshot hash intact; the drift is recorded next to
 * it for Finance instead. Callers authorize the actor first.
 */
export async function propagateUraianToDraftSlips(
  command: PropagationCommand,
  actor: AuthenticatedProfile,
  options: PropagationOptions = {},
): Promise<PropagationResult> {
  let expectedAutoRevision = 0;
  if (command.scope === 'pekarya') {
    if (!options.autoLeaveReconciled) {
      await ensurePekaryaAutoLeave(command.periodToken, actor, [command.jobCategory]);
    }
    await assertAutoLeaveReady(command.periodToken, [command.jobCategory]);
    expectedAutoRevision = Number((await autoLeaveStateRef(command.periodToken, command.jobCategory).get()).data()?.revision || 0);
  }

  let uraianBefore: FirebaseFirestore.DocumentSnapshot | null = null;
  let targets: SlipTarget[];
  if (command.scope === 'pekarya') {
    const collected = await collectPekaryaTargets(command);
    uraianBefore = collected.uraianSnapshot;
    targets = collected.targets;
  } else {
    targets = await collectLoyalisTargets(command, actor);
  }
  if (options.employeeIds) {
    const chosen = new Set(options.employeeIds);
    targets = targets.filter((target) => chosen.has(target.employeeId));
  }

  const outcomes: EmployeeOutcome[] = [];

  for (let offset = 0; offset < targets.length; offset += CHUNK_SIZE) {
    const chunk = targets.slice(offset, offset + CHUNK_SIZE);
    const chunkOutcomes = await adminDb.runTransaction(async (transaction) => {
      if (command.scope === 'pekarya') {
        const [state, uraianNow] = await transaction.getAll(
          autoLeaveStateRef(command.periodToken, command.jobCategory),
          adminDb.collection('UraianGaji').doc(uraianDocumentId(command.periodKey, command.jobCategory)),
        );
        if (state.data()?.dirty === true || Number(state.data()?.revision || 0) !== expectedAutoRevision) {
          throw new HttpError(409, 'Cuti otomatis berubah; ulangi pembaruan slip.');
        }
        if (uraianBefore && !sameDocumentVersion(uraianBefore, uraianNow)) {
          throw new UraianChangedDuringPropagation();
        }
      }
      const slipRefs = chunk.map((target) =>
        adminDb
          .collection('PayrollSlipStates')
          .doc(`${command.periodKey}_${target.employeeId}`),
      );
      const periodRef = adminDb
        .collection('PayrollPeriods')
        .doc(command.periodToken);
      // The seal is read in the same transaction as every draft write. If a
      // close races this propagation, Firestore retries against the closed
      // period and no historical value can move.
      const [periodSnapshot, ...slipSnapshots] = await transaction.getAll(
        periodRef,
        ...slipRefs,
      );
      const periodClosed =
        periodSnapshot.data()?.attendanceStatus === 'closed';
      if (command.scope === 'pekarya' && !periodClosed) {
        const publication = await transaction.get(adminDb.doc(
          `PekaryaAttendancePublications/${pekaryaPublicationId(command.periodToken, command.jobCategory)}`,
        ));
        if (publication.exists && !attendancePublicationMatchesPolicy(publication.data(),
          pekaryaSingleScanPolicy(command.jobCategory, periodSnapshot.data(), publication.data()))) {
          throw new HttpError(409, 'Presensi belum tersinkron dengan aturan scan terbaru. Buka Presensi Pekarya lalu tekan Sinkronkan Ulang.');
        }
      }
      const results: EmployeeOutcome[] = [];

      chunk.forEach((target, index) => {
        const slipSnapshot = slipSnapshots[index];
        const slipRef = slipRefs[index];
        const before = slipSnapshot.exists ? slipSnapshot.data()! : null;
        const classification = classifySlipForPropagation(
          slipSnapshot.exists,
          before?.status,
          periodClosed,
        );

        if (classification === 'no_slip' || classification === 'period_closed') {
          // No slip means the payroll page still computes from source on
          // read, so there is nothing stale to repair.
          results.push({ employeeId: target.employeeId, outcome: classification, changes: [] });
          return;
        }

        const storedEarnings = validateMoneyFields(before?.earnings ?? [], 'earnings');
        const storedDeductions = validateMoneyFields(before?.deductions ?? [], 'deductions');
        const earningsMerge = mergeOwnedFields(
          storedEarnings,
          target.freshEarnings,
          target.earningsOwned,
          'earnings',
        );
        const deductionsMerge = mergeOwnedFields(
          storedDeductions,
          target.freshDeductions,
          target.deductionsOwned,
          'deductions',
        );
        const changes = [...earningsMerge.changes, ...deductionsMerge.changes];

        if (changes.length === 0) {
          results.push({ employeeId: target.employeeId, outcome: 'unchanged', changes });
          return;
        }

        if (classification !== 'eligible') {
          // Locked or paid numbers stay exactly as signed, and the drift is
          // recorded next to the slip for Finance to act on.
          transaction.set(
            adminDb
              .collection(DRIFT_NOTICES_COLLECTION)
              .doc(`${command.periodKey}_${target.employeeId}`),
            {
              period: command.periodToken,
              employeeId: target.employeeId,
              employeeCollection:
                command.scope === 'loyalis' ? 'Employees_Loyalis' : 'Employees_BlueCollar',
              slipStatus: before?.status ?? null,
              pendingChanges: changes,
              source: command.scope === 'loyalis' ? 'loyalis_presence' : 'uraian',
              sourceFields: command.scope === 'pekarya' ? [command.jobCategory] : [],
              status: 'pending',
              requestedAt: admin.firestore.FieldValue.serverTimestamp(),
              requestedBy: actor.uid,
              requestedByRole: actor.role,
              schemaVersion: 1,
            },
          );
          results.push({ employeeId: target.employeeId, outcome: classification, changes });
          return;
        }

        // Nothing outside this source's own labels may move, ever.
        assertOnlyOwnedChanged(storedEarnings, earningsMerge.merged, target.earningsOwned);
        assertOnlyOwnedChanged(
          storedDeductions,
          deductionsMerge.merged,
          target.deductionsOwned,
        );

        // The rekap owns earnings and deductions; the tax rides on both,
        // so it is re-derived from the merged rows instead of carried over.
        const taxes = recalculateSlipTaxes(
          before,
          earningsMerge.merged,
          deductionsMerge.merged,
        );
        const totals = calculatePayrollTotals(
          earningsMerge.merged,
          deductionsMerge.merged,
          taxes,
        );
        const timestamp = admin.firestore.FieldValue.serverTimestamp();
        transaction.set(slipRef, {
          ...before,
          employeeId: target.employeeId,
          period: command.periodKey,
          status: 'draft',
          earnings: earningsMerge.merged,
          deductions: deductionsMerge.merged,
          taxes,
          ...totals,
          revision: Number(before?.revision || 0) + 1,
          generatedAt: before?.generatedAt || timestamp,
          updatedAt: timestamp,
          updatedBy: actor.uid,
          schemaVersion: 2,
        });
        transaction.delete(
          adminDb
            .collection(DRIFT_NOTICES_COLLECTION)
            .doc(`${command.periodKey}_${target.employeeId}`),
        );
        results.push({ employeeId: target.employeeId, outcome: 'updated', changes });
      });

      return results;
    });
    outcomes.push(...chunkOutcomes);
  }

  const summary = outcomes.reduce<Record<string, number>>((counts, result) => {
    counts[result.outcome] = (counts[result.outcome] || 0) + 1;
    return counts;
  }, {});

  if ((summary.updated || 0) > 0 || (summary.blocked_status || 0) > 0 || (summary.immutable || 0) > 0) {
    // One audit record for the whole run: a per-slip row for a 40-employee
    // rekap save would bury the signal rather than preserve it.
    await newFinancialAuditRef().create(
      buildFinancialAuditRecord(actor, {
        action: 'PAYROLL_URAIAN_PROPAGATION',
        entityType: command.scope === 'loyalis' ? 'LoyalisPresence' : 'UraianGaji',
        entityId:
          command.scope === 'loyalis'
            ? command.periodToken
            : uraianDocumentId(command.periodKey, command.jobCategory),
        reason: 'Perubahan rekap uraian diterapkan ke slip draf',
        requestId: command.requestId,
        metadata: {
          summary,
          updated: outcomes
            .filter((result) => result.outcome === 'updated')
            .map((result) => ({ employeeId: result.employeeId, changes: result.changes })),
          blocked: outcomes
            .filter(
              (result) =>
                result.outcome === 'blocked_status' || result.outcome === 'immutable',
            )
            .map((result) => ({ employeeId: result.employeeId, outcome: result.outcome })),
        },
      }),
    );
  }

  return { period: command.periodToken, scope: command.scope, summary, results: outcomes };
}
