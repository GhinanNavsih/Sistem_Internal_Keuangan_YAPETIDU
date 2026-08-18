import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import {
  assertRequestId,
  isImmutablePayrollStatus,
  payrollPeriodForDutyDate,
  SATPAM_RATES,
  type SatpamPayType,
} from '@/lib/payroll/domain';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '@/lib/server/audit';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';
import { assertPeriodAcceptsInput } from '@/lib/server/payrollPeriod';
import { syncSatpamDutyReconciliation } from '@/lib/server/satpamDutyPlan';

export const dynamic = 'force-dynamic';

/**
 * Off-Duty is a planning marker, not a payable classification, so it is never
 * a valid correction target. The remaining four are the rates a Satpam shift
 * assignment can actually be paid at.
 */
const EDITABLE_PAY_TYPES: readonly Exclude<SatpamPayType, 'Off-Duty'>[] = [
  'Harian',
  'Jumat & Libur',
  'Lembur Sendiri',
  'Lembur Cover',
];

interface PayTypeCommand {
  requestId: string;
  reportId: string;
  payType: Exclude<SatpamPayType, 'Off-Duty'>;
  coveredEmployeeId?: string;
  reason: string;
}

function parseCommand(raw: unknown): PayTypeCommand {
  if (!raw || typeof raw !== 'object') {
    throw new HttpError(400, 'Perintah koreksi upah tidak valid.');
  }
  const value = raw as Record<string, unknown>;
  if (typeof value.requestId !== 'string') {
    throw new HttpError(400, 'requestId wajib diisi.');
  }
  try {
    assertRequestId(value.requestId);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : 'requestId tidak valid.');
  }
  if (
    typeof value.reportId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,180}$/.test(value.reportId)
  ) {
    throw new HttpError(400, 'ID penugasan tidak valid.');
  }
  if (
    typeof value.payType !== 'string' ||
    !EDITABLE_PAY_TYPES.includes(value.payType as Exclude<SatpamPayType, 'Off-Duty'>)
  ) {
    throw new HttpError(400, 'Kategori upah tidak dikenal.');
  }
  const reason = typeof value.reason === 'string' ? value.reason.trim() : '';
  if (reason.length < 8 || reason.length > 500) {
    throw new HttpError(400, 'Alasan koreksi wajib diisi antara 8 dan 500 karakter.');
  }
  const coveredEmployeeId =
    typeof value.coveredEmployeeId === 'string' ? value.coveredEmployeeId.trim() : '';
  return {
    requestId: value.requestId,
    reportId: value.reportId,
    payType: value.payType as Exclude<SatpamPayType, 'Off-Duty'>,
    ...(coveredEmployeeId ? { coveredEmployeeId } : {}),
    reason,
  };
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['super_admin', 'satker_head']);
    if (actor.role === 'satker_head' && !actor.permittedCategories.includes('SATPAM')) {
      throw new HttpError(403, 'Anda tidak memiliki akses kategori SATPAM.');
    }

    const command = parseCommand(await request.json());
    const requestHash = createHash('sha256').update(JSON.stringify(command)).digest('hex');

    const result = await adminDb.runTransaction(async (transaction) => {
      const idempotencyRef = adminDb
        .collection('FinancialIdempotencyKeys')
        .doc(`${actor.uid}__${command.requestId}`);
      const reportRef = adminDb.collection('ActivityReports').doc(command.reportId);

      const [idempotencySnapshot, reportSnapshot] = await Promise.all([
        transaction.get(idempotencyRef),
        transaction.get(reportRef),
      ]);

      if (idempotencySnapshot.exists) {
        const previous = idempotencySnapshot.data()!;
        if (previous.requestHash !== requestHash) {
          throw new HttpError(409, 'requestId sudah digunakan untuk koreksi berbeda.');
        }
        return {
          updated: true,
          idempotent: true,
          employeeId: String(previous.employeeId || ''),
          period: String(previous.period || ''),
        };
      }

      if (!reportSnapshot.exists) {
        throw new HttpError(404, 'Penugasan tidak ditemukan.');
      }
      const before = reportSnapshot.data()!;

      if (String(before.jobCategory || '') !== 'SATPAM') {
        throw new HttpError(409, 'Koreksi ini hanya berlaku untuk penugasan Satpam.');
      }
      if (
        before.reportKind !== 'satpam_shift_assignment' ||
        !before.sourceOccurrenceId
      ) {
        throw new HttpError(
          409,
          'Koreksi ini hanya berlaku untuk penugasan pos dalam laporan shift regu.',
        );
      }
      // Only approved rows carry a payable ledger entry and feed the Uraian
      // shift columns; pending rows still belong to the normal audit flow and
      // declined rows are worth nothing regardless of their classification.
      if (before.status !== 'approved') {
        throw new HttpError(
          409,
          'Hanya penugasan yang sudah disetujui yang dapat dikoreksi kategori upahnya.',
        );
      }

      const previousPayType = String(before.shiftType || '');
      const coveredEmployeeId =
        command.coveredEmployeeId || String(before.coveredEmployeeId || '').trim();
      if (command.payType === 'Lembur Cover' && !coveredEmployeeId) {
        throw new HttpError(
          409,
          'Lembur Cover harus menyebutkan petugas yang digantikan.',
        );
      }
      if (previousPayType === command.payType) {
        throw new HttpError(409, 'Kategori upah tidak berubah.');
      }

      const employeeId = String(before.employeeId || '');
      const period = String(
        before.payrollPeriod ||
          before.period ||
          (before.dutyDate || before.activityDate
            ? payrollPeriodForDutyDate(String(before.dutyDate || before.activityDate))
            : ''),
      );
      if (!/^\d{4}-\d{2}$/.test(period)) {
        throw new HttpError(409, 'Periode payroll penugasan tidak dapat ditentukan.');
      }

      const periodRef = adminDb.collection('PayrollPeriods').doc(period);
      const slipRef = adminDb
        .collection('PayrollSlipStates')
        .doc(`${period.replace('-', '_')}_${employeeId}`);
      const ledgerRef = adminDb.collection('PayrollLedgerEntries').doc(command.reportId);

      const [periodSnapshot, slipSnapshot, ledgerSnapshot] = await Promise.all([
        transaction.get(periodRef),
        transaction.get(slipRef),
        transaction.get(ledgerRef),
      ]);

      assertPeriodAcceptsInput(
        periodSnapshot.data(),
        'Periode payroll sudah ditutup; kategori upah tidak dapat diubah.',
      );
      if (slipSnapshot.exists && isImmutablePayrollStatus(slipSnapshot.data()?.status)) {
        throw new HttpError(
          409,
          'Slip pegawai sudah dikunci/dibayar; gunakan alur koreksi finansial untuk periode ini.',
        );
      }

      const now = admin.firestore.FieldValue.serverTimestamp();
      const amount = SATPAM_RATES[command.payType];
      const after = {
        ...before,
        shiftType: command.payType,
        fee: amount,
        // Lembur Cover is the only classification that names a replaced guard;
        // switching away from it must not leave that pointer behind.
        coveredEmployeeId:
          command.payType === 'Lembur Cover' ? coveredEmployeeId : null,
        payTypeCorrectedAt: now,
        payTypeCorrectedBy: actor.uid,
        payTypeCorrectedFrom: previousPayType,
        reviewRevision: Number(before.reviewRevision || 0) + 1,
      };
      transaction.set(reportRef, after);

      // Keep the payable ledger consistent with the report it was posted from.
      if (ledgerSnapshot.exists) {
        transaction.update(ledgerRef, {
          payType: command.payType,
          amount,
          correctedAt: now,
          correctedBy: actor.uid,
        });
      }

      transaction.create(
        newFinancialAuditRef(),
        buildFinancialAuditRecord(actor, {
          action: 'SATPAM_SHIFT_ASSIGNMENT_PAY_TYPE_CORRECTED',
          entityType: 'ActivityReport',
          entityId: command.reportId,
          reason: command.reason,
          requestId: command.requestId,
          before,
          after,
          metadata: {
            employeeId,
            period,
            occurrenceId: before.sourceOccurrenceId,
            previousPayType,
            newPayType: command.payType,
            previousFee: Number(before.fee || 0),
            newFee: amount,
          },
        }),
      );

      transaction.create(idempotencyRef, {
        requestHash,
        entityId: command.reportId,
        employeeId,
        period,
        resultingStatus: 'approved',
        createdAt: now,
      });

      return { updated: true, idempotent: false, employeeId, period };
    });

    // Recompute the Satpam shift columns in Uraian Gaji from the corrected
    // reports, mirroring what the approve/decline flow does.
    if (result.period && !result.idempotent) {
      await syncSatpamDutyReconciliation(result.period, actor.uid);
    }
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
