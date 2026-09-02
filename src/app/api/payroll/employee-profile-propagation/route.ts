import { NextRequest } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import {
  calculatePayrollTotals,
  previousPayrollPeriodToken,
  validateMoneyFields,
} from '@/lib/payroll/domain';
import { recalculateSlipTaxes } from '@/lib/payroll/payrollTax';
import { EMPLOYEE_PROFILE_EDITOR_ROLES } from '@/lib/payroll/roles';
import {
  buildInitialDeductions,
  buildInitialEarnings,
} from '@/lib/payroll/slipBuilders';
import {
  calculateGapok,
  matchFunctionalAllowance,
  toSlipEmployeeView,
  type ProfileLike,
} from '@/lib/payroll/salaryMatrix';
import {
  assertOnlyProfileOwnedChanged,
  classifySlipForPropagation,
  DRIFT_NOTICES_COLLECTION,
  mergeProfileOwnedFields,
  resolvePropagationPeriods,
  type PropagationOutcome,
  type SlipFieldChange,
} from '@/lib/payroll/slipPropagation';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '@/lib/server/audit';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

/** The employee document, narrowed to the fields this route reads by name. */
interface ProfileDocument extends ProfileLike {
  academic_and_tier?: {
    level_code?: string;
    education_level?: string;
    functional_tier?: number | string;
  };
  kepangkatan?: { cummulativeCredit?: number | string };
  [key: string]: unknown;
}

interface PropagationCommand {
  employeeId: string;
  requestId: string;
  changedFields?: string[];
}

interface PeriodResult {
  period: string;
  outcome: PropagationOutcome;
  changes: SlipFieldChange[];
}

function parseCommand(raw: unknown): PropagationCommand {
  if (!raw || typeof raw !== 'object') {
    throw new HttpError(400, 'Perintah propagasi tidak valid.');
  }
  const command = raw as Partial<PropagationCommand>;
  if (
    typeof command.employeeId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(command.employeeId) ||
    typeof command.requestId !== 'string' ||
    !/^[A-Za-z0-9_-]{8,128}$/.test(command.requestId)
  ) {
    throw new HttpError(400, 'employeeId atau requestId tidak valid.');
  }
  const changedFields = Array.isArray(command.changedFields)
    ? command.changedFields
        .filter((field): field is string => typeof field === 'string')
        .slice(0, 200)
        .map((field) => field.slice(0, 200))
    : [];
  return { employeeId: command.employeeId, requestId: command.requestId, changedFields };
}

async function loadActiveRows(collectionName: string) {
  const configSnapshot = await adminDb.collection(collectionName).doc('_config').get();
  const activeVersion = configSnapshot.data()?.activeVersion || '2026_v1';
  return adminDb.collection(collectionName).doc(activeVersion).collection('rows').get();
}

/**
 * Re-derives an employee's payslip rows from their profile and pushes the
 * profile-owned subset onto any draft slip in an open payroll period.
 *
 * The request carries no amounts — every rupiah is computed here from the
 * employee document and the salary matrices — so an employee_admin editing a
 * profile can never post an arbitrary figure onto a payslip.
 */
export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, EMPLOYEE_PROFILE_EDITOR_ROLES);
    const command = parseCommand(await request.json());

    const [blueSnapshot, loyalisSnapshot] = await Promise.all([
      adminDb.collection('Employees_BlueCollar').doc(command.employeeId).get(),
      adminDb.collection('Employees_Loyalis').doc(command.employeeId).get(),
    ]);
    if (!blueSnapshot.exists && !loyalisSnapshot.exists) {
      throw new HttpError(404, 'Pegawai payroll tidak ditemukan.');
    }
    // The collar decides the pay rules and is never taken from client input.
    const isLoyalis = loyalisSnapshot.exists;
    const employeeSnapshot = isLoyalis ? loyalisSnapshot : blueSnapshot;
    const collar: 'loyalis' | 'blue' = isLoyalis ? 'loyalis' : 'blue';
    const raw: ProfileDocument = {
      ...employeeSnapshot.data(),
      id: employeeSnapshot.id,
    };

    const now = new Date();

    // Which periods are still collecting. Read first: it decides whether any
    // recomputation is worth doing at all.
    const candidateTokens = [
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
      previousPayrollPeriodToken(now),
    ];
    const periodSnapshots = await Promise.all(
      candidateTokens.map((token) => adminDb.collection('PayrollPeriods').doc(token).get()),
    );
    const closedByToken = new Map(
      candidateTokens.map((token, index) => [
        token,
        periodSnapshots[index].data()?.attendanceStatus === 'closed',
      ]),
    );
    const periods = resolvePropagationPeriods(
      now,
      (token) => closedByToken.get(token) ?? false,
    );
    if (periods.length === 0) {
      return Response.json(
        { employeeId: command.employeeId, results: [] },
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    // Matrices are inputs, not write targets, so they are read outside the
    // transactions. A matrix edited between here and the commit would be picked
    // up by the next propagation or by Refresh Massal.
    const [matrixRows, functionalRows, kepangkatanRows] = await Promise.all([
      loadActiveRows(isLoyalis ? 'SalaryMatrix_WhiteCollar' : 'SalaryMatrix'),
      loadActiveRows('SalaryMatrix_Functional'),
      loadActiveRows('SalaryMatrix_Kepangkatan'),
    ]);

    const matrix: Record<string, Record<number, number>> = {};
    matrixRows.docs.forEach((row) => {
      const data = row.data();
      const salaries = data.salaries || {};
      Object.entries(salaries).forEach(([grade, amount]) => {
        if (!matrix[grade]) matrix[grade] = {};
        matrix[grade][data.tahun] = amount as number;
      });
    });

    const functionalMatrix: Record<
      string,
      { base_value: number; functional_tiers: Record<string, number> }
    > = {};
    functionalRows.docs.forEach((row) => {
      const data = row.data();
      functionalMatrix[row.id] = {
        base_value: data.base_value || 0,
        functional_tiers: data.functional_tiers || {},
      };
    });

    const kepangkatanMatrix: Record<number, number> = {};
    kepangkatanRows.docs.forEach((row) => {
      const data = row.data();
      kepangkatanMatrix[Number(data.credit_score) || 0] = Number(data.allowance) || 0;
    });

    const functionalAllowance = matchFunctionalAllowance(
      raw.academic_and_tier?.education_level,
      raw.academic_and_tier?.functional_tier,
      functionalMatrix,
    );
    const kepangkatanAllowance =
      kepangkatanMatrix[Number(raw.kepangkatan?.cummulativeCredit) || 0] || 0;

    const results: PeriodResult[] = [];

    for (const periodToken of periods) {
      const [year, month] = periodToken.split('-').map(Number);
      const periodKey = `${year}_${String(month).padStart(2, '0')}`;
      const slipId = `${periodKey}_${command.employeeId}`;

      // Gaji Pokok depends on seniority at the period being paid, so each
      // period is computed against its own target date.
      const targetDate = new Date(year, month - 1, 1);
      const gapok = calculateGapok(toSlipEmployeeView(raw, collar), matrix, targetDate);

      // Presence, vakasi, uraian and koperasi feed rows the profile does not
      // own, so they are deliberately left at zero and dropped by the merge.
      const freshEarnings = buildInitialEarnings(
        raw,
        gapok,
        collar,
        undefined,
        0,
        [],
        functionalAllowance,
        kepangkatanAllowance,
        [],
        0,
        0,
      );
      const freshDeductions = buildInitialDeductions(raw, collar, 0, 0, 0, 0);

      const result = await adminDb.runTransaction(async (transaction) => {
        const slipRef = adminDb.collection('PayrollSlipStates').doc(slipId);
        const periodRef = adminDb.collection('PayrollPeriods').doc(periodToken);
        const noticeRef = adminDb.collection(DRIFT_NOTICES_COLLECTION).doc(slipId);
        const idempotencyRef = adminDb
          .collection('FinancialIdempotencyKeys')
          .doc(`${actor.uid}__${command.requestId}__${periodKey}`);

        const [slipSnapshot, periodSnapshot, idempotencySnapshot] = await Promise.all([
          transaction.get(slipRef),
          transaction.get(periodRef),
          transaction.get(idempotencyRef),
        ]);

        if (idempotencySnapshot.exists) {
          const previous = idempotencySnapshot.data()!;
          return {
            period: periodToken,
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

        // Nothing to compare against, and nothing that could be written.
        if (classification === 'no_slip' || classification === 'period_closed') {
          return { period: periodToken, outcome: classification, changes: [] as SlipFieldChange[] };
        }

        const storedEarnings = validateMoneyFields(before?.earnings ?? [], 'earnings');
        const storedDeductions = validateMoneyFields(before?.deductions ?? [], 'deductions');
        const earningsMerge = mergeProfileOwnedFields(
          storedEarnings,
          freshEarnings,
          'earnings',
        );
        const deductionsMerge = mergeProfileOwnedFields(
          storedDeductions,
          freshDeductions,
          'deductions',
        );
        const changes = [...earningsMerge.changes, ...deductionsMerge.changes];

        // The slip already agrees with the profile — true for an edit that
        // touched nothing pay-related, which is the common case.
        if (changes.length === 0) {
          return {
            period: periodToken,
            outcome: 'unchanged' as PropagationOutcome,
            changes,
          };
        }

        if (classification !== 'eligible') {
          // The slip itself is never touched — a verified signature and a
          // locked snapshot hash both have to stay intact — so the drift is
          // recorded alongside it for Finance to act on.
          transaction.set(noticeRef, {
            period: periodToken,
            employeeId: command.employeeId,
            employeeCollection: isLoyalis ? 'Employees_Loyalis' : 'Employees_BlueCollar',
            slipStatus: before?.status ?? null,
            pendingChanges: changes,
            sourceFields: command.changedFields ?? [],
            status: 'pending',
            requestedAt: admin.firestore.FieldValue.serverTimestamp(),
            requestedBy: actor.uid,
            requestedByRole: actor.role,
            schemaVersion: 1,
          });
          return { period: periodToken, outcome: classification, changes };
        }

        // Nothing outside the profile's own labels may move, ever.
        assertOnlyProfileOwnedChanged(storedEarnings, earningsMerge.merged, 'earnings');
        assertOnlyProfileOwnedChanged(
          storedDeductions,
          deductionsMerge.merged,
          'deductions',
        );

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
        const after = {
          ...before,
          employeeId: command.employeeId,
          period: periodKey,
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
        };
        transaction.set(slipRef, after);
        transaction.delete(noticeRef);
        transaction.create(
          newFinancialAuditRef(),
          buildFinancialAuditRecord(actor, {
            action: 'PAYROLL_PROFILE_PROPAGATION',
            entityType: 'PayrollSlipState',
            entityId: slipId,
            reason: 'Perubahan data karyawan diterapkan ke slip',
            requestId: command.requestId,
            before,
            after,
            metadata: { changes, sourceFields: command.changedFields ?? [] },
          }),
        );
        transaction.create(idempotencyRef, {
          actorUid: actor.uid,
          requestId: command.requestId,
          entityType: 'PayrollSlipState',
          entityId: slipId,
          outcome: 'updated',
          createdAt: timestamp,
        });

        return { period: periodToken, outcome: 'updated' as PropagationOutcome, changes };
      });

      results.push(result);
    }

    return Response.json(
      { employeeId: command.employeeId, results },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
