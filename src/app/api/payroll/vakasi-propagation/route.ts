import { NextRequest } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import { calculatePayrollTotals, validateMoneyFields } from '@/lib/payroll/domain';
import { recalculateSlipTaxes } from '@/lib/payroll/payrollTax';
import { URAIAN_EDITOR_ROLES } from '@/lib/payroll/roles';
import {
  allowsHistoricalPaperSpjEntry,
  allowsManualSpjEntry,
} from '@/lib/payroll/pekaryaSpj';
import {
  assertOnlyOwnedChanged,
  classifySlipForPropagation,
  DRIFT_NOTICES_COLLECTION,
  mergeOwnedFields,
  normalizeLabel,
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
import { loadPekaryaSlipPreviews } from '@/lib/server/pekaryaSlipPreview';
import type { UraianEntry } from '@/types';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

interface VakasiPropagationCommand {
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

interface EmployeeDirectoryEntry {
  employeeId: string;
  employeeCollection: 'Employees_Loyalis' | 'Employees_BlueCollar';
  name: string;
  jobCategory?: string;
}

function parseCommand(raw: unknown): VakasiPropagationCommand {
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

async function loadDirectory(
  employeeIds: readonly string[],
): Promise<Map<string, EmployeeDirectoryEntry>> {
  const loyalisRefs = employeeIds.map((employeeId) =>
    adminDb.collection('Employees_Loyalis').doc(employeeId),
  );
  const blueRefs = employeeIds.map((employeeId) =>
    adminDb.collection('Employees_BlueCollar').doc(employeeId),
  );
  const snapshots = await adminDb.getAll(...loyalisRefs, ...blueRefs);
  const directory = new Map<string, EmployeeDirectoryEntry>();
  employeeIds.forEach((employeeId, index) => {
    const loyalis = snapshots[index];
    const blue = snapshots[index + employeeIds.length];
    if (loyalis.exists && blue.exists) {
      throw new HttpError(409, `ID ${employeeId} terdapat di dua koleksi pegawai.`);
    }
    if (blue.exists) {
      const data = blue.data() || {};
      const jobCategory = String(data.employment?.jobCategory || '').trim();
      if (!jobCategory) {
        throw new HttpError(409, `Kategori Pekarya ${employeeId} belum diisi.`);
      }
      directory.set(employeeId, {
        employeeId,
        employeeCollection: 'Employees_BlueCollar',
        name: String(data.name || employeeId),
        jobCategory,
      });
      return;
    }
    if (loyalis.exists) {
      const data = loyalis.data() || {};
      directory.set(employeeId, {
        employeeId,
        employeeCollection: 'Employees_Loyalis',
        name: String(data.personal_info?.name || employeeId),
      });
      return;
    }
    throw new HttpError(404, `Pegawai ${employeeId} tidak ditemukan.`);
  });
  return directory;
}

async function propagateLoyalisEmployee(input: {
  actor: Awaited<ReturnType<typeof requireAuthenticatedProfile>>;
  command: VakasiPropagationCommand;
  employeeId: string;
  events: readonly VakasiTambahanEventLike[];
}): Promise<EmployeeOutcome> {
  const { actor, command, employeeId, events } = input;
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

  return adminDb.runTransaction(async (transaction) => {
    const [idempotencySnapshot, slipSnapshot, periodSnapshot] =
      await transaction.getAll(idempotencyRef, slipRef, periodRef);
    if (idempotencySnapshot.exists) {
      return {
        employeeId,
        outcome: (idempotencySnapshot.data()?.outcome || 'unchanged') as PropagationOutcome,
        changes: [],
      };
    }

    const before = slipSnapshot.exists ? slipSnapshot.data()! : null;
    const classification = classifySlipForPropagation(
      slipSnapshot.exists,
      before?.status,
      periodSnapshot.data()?.attendanceStatus === 'closed',
    );
    if (classification === 'no_slip' || classification === 'period_closed') {
      return { employeeId, outcome: classification, changes: [] };
    }

    const storedEarnings = validateMoneyFields(before?.earnings ?? [], 'earnings');
    const { merged, changes } = mergeOwnedFields(
      storedEarnings,
      freshEarnings,
      earningsOwned,
      'earnings',
    );
    if (changes.length === 0) {
      return { employeeId, outcome: 'unchanged', changes };
    }

    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    if (classification !== 'eligible') {
      transaction.set(noticeRef, {
        period: command.period,
        employeeId,
        employeeCollection: 'Employees_Loyalis',
        slipStatus: before?.status ?? null,
        pendingChanges: changes,
        source: 'vakasi_tambahan',
        status: 'pending',
        requestedAt: timestamp,
        requestedBy: actor.uid,
        requestedByRole: actor.role,
        schemaVersion: 1,
      });
      transaction.create(idempotencyRef, {
        actorUid: actor.uid,
        requestId: command.requestId,
        entityType: 'PayrollSlipState',
        entityId: `${command.periodKey}_${employeeId}`,
        outcome: classification,
        createdAt: timestamp,
      });
      return { employeeId, outcome: classification, changes };
    }

    assertOnlyOwnedChanged(storedEarnings, merged, earningsOwned);
    const storedDeductions = validateMoneyFields(before?.deductions ?? [], 'deductions');
    // Moving an earning moves the tax base with it, so a taxed slip is
    // re-charged 5% of its new Gaji Bersih rather than keeping a stale figure.
    const taxes = recalculateSlipTaxes(before, merged, storedDeductions);
    const totals = calculatePayrollTotals(merged, storedDeductions, taxes);
    const after = {
      ...before,
      employeeId,
      period: command.periodKey,
      status: 'draft',
      earnings: merged,
      deductions: storedDeductions,
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
        action: 'PAYROLL_VAKASI_PROPAGATION',
        entityType: 'PayrollSlipState',
        entityId: `${command.periodKey}_${employeeId}`,
        reason: 'Perubahan Vakasi Tambahan diterapkan ke slip draf Loyalis',
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
    return { employeeId, outcome: 'updated', changes };
  });
}

async function propagatePekaryaEmployee(input: {
  actor: Awaited<ReturnType<typeof requireAuthenticatedProfile>>;
  command: VakasiPropagationCommand;
  employee: EmployeeDirectoryEntry;
  canonicalSpj: number;
}): Promise<EmployeeOutcome> {
  const { actor, command, employee, canonicalSpj } = input;
  const employeeId = employee.employeeId;
  const jobCategory = employee.jobCategory!;
  const manualSpj =
    allowsManualSpjEntry(jobCategory, command.period) ||
    allowsHistoricalPaperSpjEntry(jobCategory, command.period, employeeId);
  const idempotencyRef = adminDb
    .collection('FinancialIdempotencyKeys')
    .doc(`${actor.uid}__${command.requestId}__${employeeId}`);
  const slipRef = adminDb
    .collection('PayrollSlipStates')
    .doc(`${command.periodKey}_${employeeId}`);
  const periodRef = adminDb.collection('PayrollPeriods').doc(command.period);
  const uraianRef = adminDb
    .collection('UraianGaji')
    .doc(`${command.periodKey}_${jobCategory}`);
  const noticeRef = adminDb
    .collection(DRIFT_NOTICES_COLLECTION)
    .doc(`${command.periodKey}_${employeeId}`);
  const spjOwned = (label: string) => normalizeLabel(label) === 'spj';

  return adminDb.runTransaction(async (transaction) => {
    const [idempotencySnapshot, slipSnapshot, periodSnapshot, uraianSnapshot] =
      await transaction.getAll(idempotencyRef, slipRef, periodRef, uraianRef);
    if (idempotencySnapshot.exists) {
      return {
        employeeId,
        outcome: (idempotencySnapshot.data()?.outcome || 'unchanged') as PropagationOutcome,
        changes: [],
      };
    }

    const periodClosed = periodSnapshot.data()?.attendanceStatus === 'closed';
    if (periodClosed) {
      return { employeeId, outcome: 'period_closed', changes: [] };
    }

    const beforeSlip = slipSnapshot.exists ? slipSnapshot.data()! : null;
    const classification = classifySlipForPropagation(
      slipSnapshot.exists,
      beforeSlip?.status,
      false,
    );
    const storedEarnings = slipSnapshot.exists
      ? validateMoneyFields(beforeSlip?.earnings ?? [], 'earnings')
      : [];
    const freshSpj = [{ label: 'SPJ', amount: canonicalSpj }];
    const { merged, changes } = slipSnapshot.exists
      ? mergeOwnedFields(storedEarnings, freshSpj, spjOwned, 'earnings')
      : { merged: storedEarnings, changes: [] as SlipFieldChange[] };

    const uraianData = uraianSnapshot.data() || {};
    const entries = { ...(uraianData.entries || {}) } as Record<string, UraianEntry>;
    const previousEntry = entries[employeeId];
    const uraianNeedsUpdate =
      !manualSpj &&
      uraianSnapshot.exists &&
      Number(previousEntry?.values?.spj || 0) !== canonicalSpj;
    if (uraianNeedsUpdate) {
      entries[employeeId] = {
        ...(previousEntry || {
          employeeId,
          name: employee.name,
          values: {},
        }),
        employeeId,
        name: previousEntry?.name || employee.name,
        values: {
          ...(previousEntry?.values || {}),
          spj: canonicalSpj,
        },
        counts: {
          ...(previousEntry?.counts || {}),
          spj: 0,
        },
      };
      transaction.set(
        uraianRef,
        {
          entries,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: actor.uid,
        },
        { merge: true },
      );
    }

    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    let outcome: PropagationOutcome = 'unchanged';
    let afterSlip: Record<string, unknown> | null = beforeSlip;
    if (changes.length > 0 && classification !== 'eligible') {
      transaction.set(noticeRef, {
        period: command.period,
        employeeId,
        employeeCollection: 'Employees_BlueCollar',
        slipStatus: beforeSlip?.status ?? null,
        pendingChanges: changes,
        source: 'vakasi_tambahan_pekarya',
        sourceFields: [jobCategory, 'SPJ'],
        status: 'pending',
        requestedAt: timestamp,
        requestedBy: actor.uid,
        requestedByRole: actor.role,
        schemaVersion: 1,
      });
      outcome = classification;
    } else if (changes.length > 0 && classification === 'eligible') {
      assertOnlyOwnedChanged(storedEarnings, merged, spjOwned);
      const storedDeductions = validateMoneyFields(beforeSlip?.deductions ?? [], 'deductions');
      const taxes = recalculateSlipTaxes(beforeSlip, merged, storedDeductions);
      const totals = calculatePayrollTotals(merged, storedDeductions, taxes);
      afterSlip = {
        ...beforeSlip,
        employeeId,
        period: command.periodKey,
        status: 'draft',
        earnings: merged,
        deductions: storedDeductions,
        taxes,
        ...totals,
        revision: Number(beforeSlip?.revision || 0) + 1,
        generatedAt: beforeSlip?.generatedAt || timestamp,
        updatedAt: timestamp,
        updatedBy: actor.uid,
        schemaVersion: 2,
      };
      transaction.set(slipRef, afterSlip);
      transaction.delete(noticeRef);
      outcome = 'updated';
    } else if (uraianNeedsUpdate) {
      outcome = 'updated';
    } else if (classification === 'no_slip') {
      outcome = 'no_slip';
    }

    if (uraianNeedsUpdate || changes.length > 0) {
      transaction.create(
        newFinancialAuditRef(),
        buildFinancialAuditRecord(actor, {
          action: 'PAYROLL_VAKASI_PEKARYA_PROPAGATION',
          entityType: 'PekaryaSpj',
          entityId: `${command.periodKey}_${employeeId}`,
          reason: 'Proyeksi Vakasi Pekarya diterapkan ke SPJ kanonik',
          requestId: command.requestId,
          before: { uraianEntry: previousEntry || null, slip: beforeSlip },
          after: {
            canonicalSpj,
            uraianEntry: entries[employeeId] || previousEntry || null,
            slip: afterSlip,
          },
          metadata: { jobCategory, changes, manualSpj },
        }),
      );
      transaction.create(idempotencyRef, {
        actorUid: actor.uid,
        requestId: command.requestId,
        entityType: 'PekaryaSpj',
        entityId: `${command.periodKey}_${employeeId}`,
        outcome,
        createdAt: timestamp,
      });
    }
    return { employeeId, outcome, changes };
  });
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
async function propagateVakasiEmployees(
  actor: Awaited<ReturnType<typeof requireAuthenticatedProfile>>,
  command: VakasiPropagationCommand,
) {
  const eventsSnapshot = await adminDb
    .collection('VakasiTambahan')
    .where('period', '==', command.period)
    .get();
  const events = eventsSnapshot.docs.map(
    (doc) => doc.data() as VakasiTambahanEventLike,
  );

  const directory = await loadDirectory(command.employeeIds);
  const pekaryaIds = command.employeeIds.filter(
    (employeeId) =>
      directory.get(employeeId)?.employeeCollection === 'Employees_BlueCollar',
  );
  const pekaryaPreviews = pekaryaIds.length > 0
    ? await loadPekaryaSlipPreviews(command.period, pekaryaIds)
    : null;

  const outcomes: EmployeeOutcome[] = [];

  for (const employeeId of command.employeeIds) {
    const employee = directory.get(employeeId)!;
    const outcome = employee.employeeCollection === 'Employees_Loyalis'
      ? await propagateLoyalisEmployee({ actor, command, employeeId, events })
      : await propagatePekaryaEmployee({
          actor,
          command,
          employee,
          canonicalSpj: Number(
            pekaryaPreviews?.previews[employeeId]?.earnings.find(
              (field) => normalizeLabel(field.label) === 'spj',
            )?.amount || 0,
          ),
        });

    outcomes.push(outcome);
  }

  const summary = outcomes.reduce<Record<string, number>>((counts, result) => {
    counts[result.outcome] = (counts[result.outcome] || 0) + 1;
    return counts;
  }, {});

  return { period: command.period, summary, results: outcomes };
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, URAIAN_EDITOR_ROLES);
    const command = parseCommand(await request.json());
    const result = await propagateVakasiEmployees(actor, command);
    return Response.json(result, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
