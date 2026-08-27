import { NextRequest } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import { calculatePayrollTotals, validateMoneyFields } from '@/lib/payroll/domain';
import { URAIAN_EDITOR_ROLES } from '@/lib/payroll/roles';
import {
  assertOnlyOwnedChanged,
  classifySlipForPropagation,
  DRIFT_NOTICES_COLLECTION,
  mergeOwnedFields,
  type PropagationOutcome,
  type SlipFieldChange,
} from '@/lib/payroll/slipPropagation';
import {
  vakasiApprovedEarningsForEmployee,
  vakasiEventNamesForEmployee,
  vakasiOwnedEarningPredicate,
  type VakasiTambahanEventLike,
} from '@/lib/payroll/vakasiTambahan';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '@/lib/server/audit';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

interface PropagationCommand {
  /** Normalized to YYYY-MM. */
  period: string;
  /** Normalized to YYYY_MM. */
  periodKey: string;
  employeeIds: string[];
  requestId: string;
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

  const rawPeriod = typeof command.period === 'string' ? command.period : '';
  const periodMatch = /^(\d{4})-(\d{2})$/.exec(rawPeriod);
  if (!periodMatch) {
    throw new HttpError(400, 'Periode wajib menggunakan format YYYY-MM.');
  }

  const employeeIds = Array.isArray(command.employeeIds)
    ? command.employeeIds.filter(
        (id): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id),
      )
    : [];
  if (employeeIds.length === 0 || employeeIds.length > 200) {
    throw new HttpError(400, 'Daftar pegawai wajib berisi 1 sampai 200 id.');
  }
  if (new Set(employeeIds).size !== employeeIds.length) {
    throw new HttpError(400, 'Daftar pegawai tidak boleh duplikat.');
  }

  const requestId = typeof command.requestId === 'string' ? command.requestId : '';
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(requestId)) {
    throw new HttpError(400, 'requestId tidak valid.');
  }

  return {
    period: rawPeriod,
    periodKey: `${periodMatch[1]}_${periodMatch[2]}`,
    employeeIds,
    requestId,
  };
}

/**
 * Pushes each employee's current approved VakasiTambahan total for one period
 * onto their draft payslip.
 *
 * The request carries no amounts: every rupiah is re-derived here from
 * VakasiTambahan documents the caller was already authorized to write, using
 * the same "recompute the truth, merge only owned rows" shape as
 * uraian-propagation and employee-profile-propagation. Called after any event
 * mutation that can change what a worker is owed for the period — approval,
 * un-approval, decline, or an edit to an already-approved event's worker list
 * or amounts — so a draft never depends on someone remembering to re-save it,
 * right up until it locks.
 */
export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, URAIAN_EDITOR_ROLES);
    const command = parseCommand(await request.json());

    const eventsSnapshot = await adminDb
      .collection('VakasiTambahan')
      .where('period', '==', command.period)
      .get();
    const events = eventsSnapshot.docs.map(
      (doc) => doc.data() as VakasiTambahanEventLike,
    );

    const outcomes: EmployeeOutcome[] = [];

    for (const employeeId of command.employeeIds) {
      const eventNames = vakasiEventNamesForEmployee(events, employeeId);
      const freshEarnings = vakasiApprovedEarningsForEmployee(events, employeeId);
      const earningsOwned = vakasiOwnedEarningPredicate(eventNames);

      const idempotencyRef = adminDb
        .collection('FinancialIdempotencyKeys')
        .doc(`${actor.uid}__${command.requestId}__${employeeId}`);
      const slipRef = adminDb
        .collection('PayrollSlipStates')
        .doc(`${command.periodKey}_${employeeId}`);
      const periodRef = adminDb.collection('PayrollPeriods').doc(command.period);
      const noticeRef = adminDb
        .collection(DRIFT_NOTICES_COLLECTION)
        .doc(`${command.periodKey}_${employeeId}`);

      const outcome = await adminDb.runTransaction(async (transaction) => {
        const [idempotencySnapshot, slipSnapshot, periodSnapshot] = await Promise.all([
          transaction.get(idempotencyRef),
          transaction.get(slipRef),
          transaction.get(periodRef),
        ]);

        if (idempotencySnapshot.exists) {
          const previous = idempotencySnapshot.data()!;
          return {
            employeeId,
            outcome: (previous.outcome || 'unchanged') as PropagationOutcome,
            changes: [] as SlipFieldChange[],
          };
        }

        const before = slipSnapshot.exists ? slipSnapshot.data()! : null;
        const classification = classifySlipForPropagation(
          slipSnapshot.exists,
          before?.status,
          periodSnapshot.data()?.attendanceStatus === 'closed',
        );

        if (classification === 'no_slip' || classification === 'period_closed') {
          return { employeeId, outcome: classification, changes: [] as SlipFieldChange[] };
        }

        const storedEarnings = validateMoneyFields(before?.earnings ?? [], 'earnings');
        const { merged, changes } = mergeOwnedFields(
          storedEarnings,
          freshEarnings,
          earningsOwned,
          'earnings',
        );

        if (changes.length === 0) {
          return { employeeId, outcome: 'unchanged' as PropagationOutcome, changes };
        }

        if (classification !== 'eligible') {
          // Locked or paid numbers stay exactly as signed. The drift is
          // recorded next to the slip for Finance to act on, same as the
          // Uraian and profile propagation routes.
          transaction.set(noticeRef, {
            period: command.period,
            employeeId,
            employeeCollection: 'Employees_Loyalis',
            slipStatus: before?.status ?? null,
            pendingChanges: changes,
            source: 'vakasi_tambahan',
            status: 'pending',
            requestedAt: admin.firestore.FieldValue.serverTimestamp(),
            requestedBy: actor.uid,
            requestedByRole: actor.role,
            schemaVersion: 1,
          });
          return { employeeId, outcome: classification, changes };
        }

        // Nothing outside the event names this employee has ever carried may
        // move, ever.
        assertOnlyOwnedChanged(storedEarnings, merged, earningsOwned);

        const storedDeductions = validateMoneyFields(before?.deductions ?? [], 'deductions');
        const totals = calculatePayrollTotals(merged, storedDeductions);
        const timestamp = admin.firestore.FieldValue.serverTimestamp();
        const after = {
          ...before,
          employeeId,
          period: command.periodKey,
          status: 'draft',
          earnings: merged,
          deductions: storedDeductions,
          ...totals,
          revision: Number(before?.revision || 0) + 1,
          generatedAt: before?.generatedAt || timestamp,
          updatedAt: timestamp,
          updatedBy: actor.uid,
          schemaVersion: 2,
        };
        transaction.set(slipRef, after);
        transaction.delete(noticeRef);
        transaction.create(
          newFinancialAuditRef(),
          buildFinancialAuditRecord(actor, {
            action: 'PAYROLL_VAKASI_PROPAGATION',
            entityType: 'PayrollSlipState',
            entityId: `${command.periodKey}_${employeeId}`,
            reason: 'Perubahan Vakasi Tambahan diterapkan ke slip draf',
            requestId: command.requestId,
            before,
            after,
            metadata: { changes },
          }),
        );
        transaction.create(idempotencyRef, {
          actorUid: actor.uid,
          requestId: command.requestId,
          entityType: 'PayrollSlipState',
          entityId: `${command.periodKey}_${employeeId}`,
          outcome: 'updated',
          createdAt: timestamp,
        });

        return { employeeId, outcome: 'updated' as PropagationOutcome, changes };
      });

      outcomes.push(outcome);
    }

    const summary = outcomes.reduce<Record<string, number>>((counts, result) => {
      counts[result.outcome] = (counts[result.outcome] || 0) + 1;
      return counts;
    }, {});

    return Response.json(
      { period: command.period, summary, results: outcomes },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
