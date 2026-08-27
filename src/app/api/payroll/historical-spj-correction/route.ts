import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import {
  calculatePayrollTotals,
  validateMoneyFields,
  type MoneyField,
} from '@/lib/payroll/domain';
import {
  assertOnlyOwnedChanged,
  mergeOwnedFields,
  type OwnedLabelPredicate,
} from '@/lib/payroll/slipPropagation';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '@/lib/server/audit';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

const HISTORICAL_PERIOD = '2026-07';
const HISTORICAL_CATEGORY = 'KEBERSIHAN';
const HISTORICAL_SPJ_EMPLOYEE_IDS = new Set(['BC_053', 'BC_054']);
const FINAL_SLIP_STATUSES = new Set([
  'confirmed',
  'locked',
  'payment_created',
  'paid',
]);

interface SpjCorrection {
  employeeId: string;
  spj: number;
}

interface HistoricalSpjCorrectionCommand {
  period: typeof HISTORICAL_PERIOD;
  jobCategory: typeof HISTORICAL_CATEGORY;
  corrections: SpjCorrection[];
  reason: string;
  requestId: string;
}

function commandHash(command: HistoricalSpjCorrectionCommand): string {
  return createHash('sha256').update(JSON.stringify(command)).digest('hex');
}

function parseCommand(raw: unknown): HistoricalSpjCorrectionCommand {
  if (!raw || typeof raw !== 'object') {
    throw new HttpError(400, 'Perintah koreksi SPJ tidak valid.');
  }
  const value = raw as Record<string, unknown>;
  if (value.period !== HISTORICAL_PERIOD || value.jobCategory !== HISTORICAL_CATEGORY) {
    throw new HttpError(
      409,
      'Koreksi SPJ historis hanya tersedia untuk Rekap KEBERSIHAN Juli 2026.',
    );
  }
  if (
    typeof value.requestId !== 'string' ||
    !/^[A-Za-z0-9_-]{8,128}$/.test(value.requestId)
  ) {
    throw new HttpError(400, 'requestId koreksi SPJ tidak valid.');
  }
  const reason = typeof value.reason === 'string' ? value.reason.trim() : '';
  if (reason.length < 8 || reason.length > 500) {
    throw new HttpError(400, 'Alasan koreksi wajib diisi antara 8 dan 500 karakter.');
  }
  if (!Array.isArray(value.corrections) || value.corrections.length === 0) {
    throw new HttpError(400, 'Tidak ada nilai SPJ yang dikoreksi.');
  }
  if (value.corrections.length > 100) {
    throw new HttpError(400, 'Jumlah baris koreksi SPJ terlalu banyak.');
  }

  const seen = new Set<string>();
  const corrections: SpjCorrection[] = value.corrections.map((rawCorrection) => {
    if (!rawCorrection || typeof rawCorrection !== 'object') {
      throw new HttpError(400, 'Baris koreksi SPJ tidak valid.');
    }
    const correction = rawCorrection as Record<string, unknown>;
    const employeeId = correction.employeeId;
    const spj = correction.spj;
    if (
      typeof employeeId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(employeeId) ||
      !HISTORICAL_SPJ_EMPLOYEE_IDS.has(employeeId) ||
      seen.has(employeeId) ||
      !Number.isSafeInteger(spj) ||
      Number(spj) < 0
    ) {
      throw new HttpError(400, 'Baris koreksi SPJ memiliki pegawai atau nilai yang tidak valid.');
    }
    seen.add(employeeId);
    return { employeeId, spj: Number(spj) };
  }).sort((left, right) => left.employeeId.localeCompare(right.employeeId));

  return {
    period: HISTORICAL_PERIOD,
    jobCategory: HISTORICAL_CATEGORY,
    corrections,
    reason,
    requestId: value.requestId,
  };
}

function spjAmount(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

/** This correction is authoritative for the SPJ row and nothing else. */
const isSpjEarningLabel: OwnedLabelPredicate = (label) =>
  label.trim().toUpperCase() === 'SPJ';

/**
 * Replaces the slip's SPJ row, going through the same merge engine and
 * post-merge assertion every other slip writer uses (the uraian and
 * employee-profile propagation routes), instead of rewriting the array by
 * hand with no check that only SPJ moved.
 */
function replaceSpjEarning(
  earnings: readonly MoneyField[],
  amount: number,
): MoneyField[] {
  // mergeOwnedFields keys owned rows by normalized label, so two SPJ rows
  // would both take the replacement and double the total. The old hand-rolled
  // version rejected that case and so must this one.
  if (earnings.filter((field) => isSpjEarningLabel(field.label)).length > 1) {
    throw new HttpError(409, 'Slip memiliki lebih dari satu baris SPJ. Koreksi dibatalkan.');
  }
  const { merged } = mergeOwnedFields(
    earnings,
    [{ label: 'SPJ', amount }],
    isSpjEarningLabel,
    'earnings',
  );
  assertOnlyOwnedChanged(earnings, merged, isSpjEarningLabel);
  return merged;
}

function correctionId(command: HistoricalSpjCorrectionCommand): string {
  return `${command.period.replace('-', '_')}_${command.jobCategory}_${command.requestId}`;
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['super_admin']);
    const command = parseCommand(await request.json());
    const requestHash = commandHash(command);
    const periodRef = adminDb.collection('PayrollPeriods').doc(command.period);
    const uraianRef = adminDb
      .collection('UraianGaji')
      .doc(`${command.period.replace('-', '_')}_${command.jobCategory}`);
    const idempotencyRef = adminDb
      .collection('FinancialIdempotencyKeys')
      .doc(`historical_spj__${actor.uid}__${command.requestId}`);
    const correctionRef = adminDb
      .collection('PayrollHistoricalCorrections')
      .doc(correctionId(command));
    const auditRef = newFinancialAuditRef();
    const periodSlipsQuery = adminDb
      .collection('PayrollSlipStates')
      .where('period', '==', command.period.replace('-', '_'));

    const result = await adminDb.runTransaction(async (transaction) => {
      const [idempotencySnapshot, periodSnapshot, uraianSnapshot, periodSlipsSnapshot] =
        await Promise.all([
          transaction.get(idempotencyRef),
          transaction.get(periodRef),
          transaction.get(uraianRef),
          transaction.get(periodSlipsQuery),
        ]);

      if (idempotencySnapshot.exists) {
        const previous = idempotencySnapshot.data() || {};
        if (previous.requestHash !== requestHash) {
          throw new HttpError(409, 'requestId sudah digunakan untuk koreksi berbeda.');
        }
        return previous.result;
      }

      if (periodSnapshot.data()?.attendanceStatus !== 'closed') {
        throw new HttpError(409, 'Koreksi historis hanya dapat dilakukan pada periode tertutup.');
      }
      if (!uraianSnapshot.exists) {
        throw new HttpError(404, 'Rekap KEBERSIHAN Juli 2026 tidak ditemukan.');
      }

      const finalSlip = periodSlipsSnapshot.docs.find((document) =>
        FINAL_SLIP_STATUSES.has(String(document.data().status || '')),
      );
      if (finalSlip) {
        throw new HttpError(
          409,
          'Koreksi SPJ diblokir karena sudah ada slip Juli yang diverifikasi atau dibayar.',
        );
      }

      const uraianData = uraianSnapshot.data() || {};
      const entries = { ...(uraianData.entries || {}) } as Record<string, Record<string, unknown>>;
      const beforeCorrections: Array<{ employeeId: string; spj: number }> = [];
      const afterCorrections: Array<{ employeeId: string; spj: number }> = [];
      const slipByEmployee = new Map(
        periodSlipsSnapshot.docs.map((document) => [
          String(document.data().employeeId || document.id.replace('2026_07_', '')),
          document,
        ]),
      );

      for (const correction of command.corrections) {
        const entry = entries[correction.employeeId];
        if (!entry || typeof entry.values !== 'object' || !entry.values) {
          throw new HttpError(
            409,
            `Pegawai ${correction.employeeId} tidak memiliki baris pada Rekap KEBERSIHAN Juli 2026.`,
          );
        }
        const values = { ...(entry.values as Record<string, unknown>) };
        const beforeSpj = spjAmount(values.spj);
        beforeCorrections.push({ employeeId: correction.employeeId, spj: beforeSpj });
        afterCorrections.push({ employeeId: correction.employeeId, spj: correction.spj });
        values.spj = correction.spj;
        entries[correction.employeeId] = { ...entry, values };

        const slipSnapshot = slipByEmployee.get(correction.employeeId);
        if (!slipSnapshot) continue;
        const slipData = slipSnapshot.data();
        if (slipData.status !== 'draft') {
          throw new HttpError(
            409,
            `Slip ${correction.employeeId} bukan draf sehingga koreksi dibatalkan.`,
          );
        }
        const earnings = validateMoneyFields(slipData.earnings || [], 'earnings');
        const nextEarnings = replaceSpjEarning(earnings, correction.spj);
        const totals = calculatePayrollTotals(nextEarnings, validateMoneyFields(slipData.deductions || [], 'deductions'));
        const now = admin.firestore.FieldValue.serverTimestamp();
        transaction.set(slipSnapshot.ref, {
          ...slipData,
          earnings: nextEarnings,
          ...totals,
          revision: Number(slipData.revision || 0) + 1,
          updatedAt: now,
          updatedBy: actor.uid,
          lastHistoricalCorrection: {
            period: command.period,
            field: 'earnings.SPJ',
            correctedBy: actor.uid,
            reason: command.reason,
          },
        });
      }

      const now = admin.firestore.FieldValue.serverTimestamp();
      transaction.set(uraianRef, {
        ...uraianData,
        entries,
        updatedAt: now,
        updatedBy: actor.uid,
      });

      const result = {
        period: command.period,
        jobCategory: command.jobCategory,
        corrected: afterCorrections,
        updatedSlipCount: command.corrections.filter((correction) =>
          slipByEmployee.has(correction.employeeId),
        ).length,
        unchangedCount: beforeCorrections.filter((before, index) =>
          before.spj === afterCorrections[index]?.spj,
        ).length,
      };
      transaction.create(correctionRef, {
        schemaVersion: 1,
        ...result,
        before: beforeCorrections,
        reason: command.reason,
        correctedBy: actor.uid,
        correctedByRole: actor.role,
        createdAt: now,
      });
      transaction.create(
        auditRef,
        buildFinancialAuditRecord(actor, {
          action: 'PAYROLL_HISTORICAL_SPJ_CORRECTION',
          entityType: 'UraianGaji',
          entityId: uraianRef.id,
          reason: command.reason,
          requestId: command.requestId,
          before: { corrections: beforeCorrections },
          after: { corrections: afterCorrections },
          metadata: {
            period: command.period,
            jobCategory: command.jobCategory,
            updatedSlipCount: result.updatedSlipCount,
          },
        }),
      );
      transaction.create(idempotencyRef, {
        requestHash,
        actorUid: actor.uid,
        requestId: command.requestId,
        entityType: 'UraianGaji',
        entityId: uraianRef.id,
        resultingStatus: 'corrected',
        result,
        createdAt: now,
      });
      return result;
    });

    return Response.json(result, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
