import { NextRequest } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import type { RekapColumn, UraianEntry } from '@/types';
import { calculatePayrollTotals, validateMoneyFields } from '@/lib/payroll/domain';
import { URAIAN_EDITOR_ROLES } from '@/lib/payroll/roles';
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
  loyalisPresenceAmounts,
  loyalisPresenceOwnedPredicate,
  uraianOwnedEarningPredicate,
  type LoyalisPresenceDocument,
} from '@/lib/payroll/uraianPropagation';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '@/lib/server/audit';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
  type AuthenticatedProfile,
} from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

/** Employees handled per transaction; keeps writes well under Firestore's 500. */
const CHUNK_SIZE = 50;

type PropagationScope = 'pekarya' | 'loyalis';

interface PropagationCommand {
  scope: PropagationScope;
  /** Normalized to YYYY_MM. */
  periodKey: string;
  periodToken: string;
  jobCategory: string;
  requestId: string;
}

interface SlipTarget {
  employeeId: string;
  /** Rows this source is authoritative for; everything else is left alone. */
  earningsOwned: OwnedLabelPredicate;
  deductionsOwned: OwnedLabelPredicate;
  freshEarnings: { label: string; amount: number }[];
  freshDeductions: { label: string; amount: number }[];
}

interface EmployeeOutcome {
  employeeId: string;
  outcome: PropagationOutcome;
  changes: SlipFieldChange[];
}

function parseCommand(raw: unknown): PropagationCommand {
  if (!raw || typeof raw !== 'object') {
    throw new HttpError(400, 'Perintah propagasi tidak valid.');
  }
  const command = raw as Record<string, unknown>;

  const scope = command.scope;
  if (scope !== 'pekarya' && scope !== 'loyalis') {
    throw new HttpError(400, 'Scope propagasi tidak valid.');
  }

  const rawPeriod = typeof command.period === 'string' ? command.period : '';
  const periodMatch = /^(\d{4})[-_](\d{2})$/.exec(rawPeriod);
  if (!periodMatch) {
    throw new HttpError(400, 'Periode wajib menggunakan format YYYY-MM.');
  }
  const periodKey = `${periodMatch[1]}_${periodMatch[2]}`;
  const periodToken = `${periodMatch[1]}-${periodMatch[2]}`;

  const requestId = typeof command.requestId === 'string' ? command.requestId : '';
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(requestId)) {
    throw new HttpError(400, 'requestId tidak valid.');
  }

  let jobCategory = '';
  if (scope === 'pekarya') {
    jobCategory = typeof command.jobCategory === 'string' ? command.jobCategory : '';
    if (!/^[A-Za-z0-9_ -]{1,64}$/.test(jobCategory)) {
      throw new HttpError(400, 'Kategori pekerjaan tidak valid.');
    }
  }

  return { scope, periodKey, periodToken, jobCategory, requestId };
}

/**
 * A Satker head may only propagate the categories they are responsible for.
 * Finance roles and super_admin are unrestricted, matching the Uraian rules.
 */
function assertCategoryAllowed(actor: AuthenticatedProfile, command: PropagationCommand): void {
  if (actor.role !== 'satker_head' && actor.role !== 'satker_head_loyalis') return;
  if (command.scope === 'loyalis') {
    if (actor.role !== 'satker_head_loyalis') {
      throw new HttpError(403, 'Anda tidak berwenang atas presensi Loyalis.');
    }
    return;
  }
  if (!actor.permittedCategories.includes(command.jobCategory)) {
    throw new HttpError(403, `Anda tidak berwenang atas kategori ${command.jobCategory}.`);
  }
}

/** Blue-collar targets, built from the saved Uraian rekap entries. */
async function collectPekaryaTargets(command: PropagationCommand): Promise<SlipTarget[]> {
  const uraianSnapshot = await adminDb
    .collection('UraianGaji')
    .doc(`${command.periodKey}_${command.jobCategory}`)
    .get();
  if (!uraianSnapshot.exists) return [];

  const data = uraianSnapshot.data() || {};
  const entries = (data.entries || {}) as Record<string, UraianEntry | undefined>;
  const customColumns = Array.isArray(data.customColumns)
    ? (data.customColumns as RekapColumn[])
    : [];

  // Only the rekap-owned rows survive the merge, so the builder is fed a
  // minimal employee: the job category is all it needs to resolve columns, and
  // every profile-derived row it emits (Gaji Pokok, BPJS, Beras) is discarded.
  // That also means this route reads no employee documents at all.
  const minimalEmployee = { employment: { jobCategory: command.jobCategory } };

  const targets: SlipTarget[] = [];
  for (const [employeeId, entry] of Object.entries(entries)) {
    if (!entry || !/^[A-Za-z0-9_-]{1,128}$/.test(employeeId)) continue;
    targets.push({
      employeeId,
      earningsOwned: uraianOwnedEarningPredicate(command.jobCategory, entry, customColumns),
      deductionsOwned: () => false,
      freshEarnings: buildInitialEarnings(
        minimalEmployee,
        0,
        'blue',
        entry,
        0,
        [],
        0,
        0,
        customColumns,
        0,
        0,
      ),
      freshDeductions: [],
    });
  }
  return targets;
}

/** Loyalis targets, built from the presence calculator's saved document. */
async function collectLoyalisTargets(command: PropagationCommand): Promise<SlipTarget[]> {
  const [canonicalPresenceSnapshot, legacyPresenceSnapshot, employeeSnapshot] = await Promise.all([
    adminDb.collection('LoyalisPresence').doc(command.periodToken).get(),
    // LoyalisPresence was historically stored with the payroll document key
    // (YYYY_MM). Keep reading it while new commands use the canonical YYYY-MM
    // period token, so existing attendance runs remain propagatable.
    adminDb.collection('LoyalisPresence').doc(command.periodKey).get(),
    adminDb.collection('Employees_Loyalis').get(),
  ]);
  const presenceData = canonicalPresenceSnapshot.exists
    ? canonicalPresenceSnapshot.data()
    : legacyPresenceSnapshot.data();
  const presence = (presenceData || null) as LoyalisPresenceDocument | null;

  const earningsOwned = loyalisPresenceOwnedPredicate('earnings');
  const deductionsOwned = loyalisPresenceOwnedPredicate('deductions');

  const targets: SlipTarget[] = [];
  for (const employeeDoc of employeeSnapshot.docs) {
    const employeeId = employeeDoc.id;
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(employeeId)) continue;
    const amounts = loyalisPresenceAmounts(presence, employeeId);
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
      ),
      freshDeductions: buildInitialDeductions(
        employeeDoc.data(),
        'loyalis',
        0,
        amounts.presenceDeduction,
        amounts.presensiDeduction,
        0,
      ),
    });
  }
  return targets;
}

/**
 * Pushes a saved Uraian rekap (or the Loyalis presence calculator) onto the
 * draft payslips for that period.
 *
 * The request carries no amounts: every figure is re-derived here from the
 * source document the caller was already authorized to write. Slips past draft
 * are never rewritten — they get a drift notice instead, so a verified or
 * locked slip keeps its signature and snapshot hash intact.
 */
export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, URAIAN_EDITOR_ROLES);
    const command = parseCommand(await request.json());
    assertCategoryAllowed(actor, command);

    const periodSnapshot = await adminDb
      .collection('PayrollPeriods')
      .doc(command.periodToken)
      .get();
    const periodClosed = periodSnapshot.data()?.attendanceStatus === 'closed';

    const targets =
      command.scope === 'pekarya'
        ? await collectPekaryaTargets(command)
        : await collectLoyalisTargets(command);

    const outcomes: EmployeeOutcome[] = [];

    for (let offset = 0; offset < targets.length; offset += CHUNK_SIZE) {
      const chunk = targets.slice(offset, offset + CHUNK_SIZE);
      const chunkOutcomes = await adminDb.runTransaction(async (transaction) => {
        const slipRefs = chunk.map((target) =>
          adminDb
            .collection('PayrollSlipStates')
            .doc(`${command.periodKey}_${target.employeeId}`),
        );
        // Every read must precede every write inside a transaction.
        const slipSnapshots = await transaction.getAll(...slipRefs);
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
            // Verified, approved, locked or paid: the numbers a human signed
            // off on stay exactly as they are, and the drift is recorded next
            // to the slip for Finance to act on.
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

          const totals = calculatePayrollTotals(earningsMerge.merged, deductionsMerge.merged);
          const timestamp = admin.firestore.FieldValue.serverTimestamp();
          transaction.set(slipRef, {
            ...before,
            employeeId: target.employeeId,
            period: command.periodKey,
            status: 'draft',
            earnings: earningsMerge.merged,
            deductions: deductionsMerge.merged,
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
              : `${command.periodKey}_${command.jobCategory}`,
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

    return Response.json(
      { period: command.periodToken, scope: command.scope, summary, results: outcomes },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
