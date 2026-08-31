import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import {
  assertRequestId,
  payrollPeriodForDutyDate,
  SATPAM_RATES,
  type SatpamPayType,
} from '@/lib/payroll/domain';
import { satpamDutyKey } from '@/lib/payroll/satpamDutyPlan';
import { satpamAttendanceReportType } from '@/lib/payroll/satpamAttendance';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '@/lib/server/audit';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';
import { assertPeriodAcceptsInput } from '@/lib/server/payrollPeriod';
import { SATPAM_ABSENCE_REQUESTS_COLLECTION } from '@/lib/server/satpamDutyPlan';

export const dynamic = 'force-dynamic';

/**
 * Same editable set as the approved-report correction
 * (admin-pay-type/route.ts) — Off-Duty is a planning marker, never a payable
 * classification.
 */
const EDITABLE_PAY_TYPES: readonly Exclude<SatpamPayType, 'Off-Duty'>[] = [
  'Harian',
  'Jumat & Libur',
  'Lembur Sendiri',
  'Lembur Cover',
];

const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,180}$/;

interface PendingEditCommand {
  requestId: string;
  reportId: string;
  payType: Exclude<SatpamPayType, 'Off-Duty'>;
  employeeId: string;
  coveredEmployeeId?: string;
  reason: string;
}

function parseCommand(raw: unknown): PendingEditCommand {
  if (!raw || typeof raw !== 'object') {
    throw new HttpError(400, 'Perintah koreksi tidak valid.');
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
  if (typeof value.reportId !== 'string' || !SAFE_ID_RE.test(value.reportId)) {
    throw new HttpError(400, 'ID penugasan tidak valid.');
  }
  if (
    typeof value.payType !== 'string' ||
    !EDITABLE_PAY_TYPES.includes(value.payType as Exclude<SatpamPayType, 'Off-Duty'>)
  ) {
    throw new HttpError(400, 'Kategori upah tidak dikenal.');
  }
  if (typeof value.employeeId !== 'string' || !SAFE_ID_RE.test(value.employeeId)) {
    throw new HttpError(400, 'Petugas tujuan tidak valid.');
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
    employeeId: value.employeeId,
    ...(coveredEmployeeId ? { coveredEmployeeId } : {}),
    reason,
  };
}

/**
 * Corrects a single still-pending Satpam shift-assignment report's guard
 * and/or pay type — the per-post counterpart of admin-pay-type/route.ts, for
 * before a report has been decided rather than after.
 *
 * A pending report has not posted anything financially yet (no
 * PayrollLedgerEntries doc, no GuardDutyIndexes entry — both are created only
 * at approval, see the POST handler in shifts/review/route.ts), so this
 * intentionally skips the ledger sync, GuardDutyIndexes double-booking check,
 * and slip-immutability check that route needs. It is not skipping a real gap:
 * the approve/decline flow re-validates the employee's active/SATPAM status,
 * approved-leave conflicts, slip immutability, double-booking, and
 * pay-classification-vs-calendar match itself before it will ever let this
 * report become 'approved' (shifts/review/route.ts, the per-decision checks
 * in the POST handler). This route only needs to catch an obviously-wrong
 * save early, not fully pre-clear every approval-time gate.
 */
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
        return { updated: true, idempotent: true };
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
      if (before.status !== 'pending') {
        throw new HttpError(
          409,
          'Koreksi ini hanya berlaku untuk penugasan yang masih menunggu keputusan.',
        );
      }

      const previousPayType = String(before.shiftType || '');
      const payTypeChanged = previousPayType !== command.payType;
      const employeeId = String(before.employeeId || '');
      const targetEmployeeId = command.employeeId;
      const employeeChanged = targetEmployeeId !== employeeId;

      const coveredEmployeeId =
        command.coveredEmployeeId || String(before.coveredEmployeeId || '').trim();
      if (command.payType === 'Lembur Cover' && !coveredEmployeeId) {
        throw new HttpError(
          409,
          'Lembur Cover harus menyebutkan petugas yang digantikan.',
        );
      }
      if (command.payType === 'Lembur Cover' && coveredEmployeeId === targetEmployeeId) {
        throw new HttpError(
          409,
          'Petugas yang digantikan tidak boleh sama dengan petugas yang ditugaskan.',
        );
      }
      if (!payTypeChanged && !employeeChanged) {
        throw new HttpError(409, 'Tidak ada perubahan yang disimpan.');
      }

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
      const dutyDate = String(before.dutyDate || before.activityDate || '');

      const periodRef = adminDb.collection('PayrollPeriods').doc(period);
      const newEmployeeRef = employeeChanged
        ? adminDb.collection('Employees_BlueCollar').doc(targetEmployeeId)
        : null;
      const newAbsenceRef = employeeChanged
        ? adminDb
            .collection(SATPAM_ABSENCE_REQUESTS_COLLECTION)
            .doc(satpamDutyKey(targetEmployeeId, dutyDate).replaceAll('-', ''))
        : null;

      const [periodSnapshot, newEmployeeSnapshot, newAbsenceSnapshot] = await Promise.all([
        transaction.get(periodRef),
        newEmployeeRef ? transaction.get(newEmployeeRef) : Promise.resolve(null),
        newAbsenceRef ? transaction.get(newAbsenceRef) : Promise.resolve(null),
      ]);

      assertPeriodAcceptsInput(
        periodSnapshot.data(),
        'Periode payroll sudah ditutup; penugasan tidak dapat diubah.',
      );

      let newEmployeeName = '';
      if (employeeChanged) {
        const newEmployeeData = newEmployeeSnapshot?.exists ? newEmployeeSnapshot.data() : undefined;
        newEmployeeName = String(newEmployeeData?.name || targetEmployeeId);
        const isNewEmployeeActiveSatpam = Boolean(
          newEmployeeData &&
            newEmployeeData.employment?.jobCategory === 'SATPAM' &&
            (newEmployeeData.employment?.status === 'active' ||
              newEmployeeData.flags?.isActive === true),
        );
        if (!isNewEmployeeActiveSatpam) {
          throw new HttpError(409, `${newEmployeeName} bukan Satpam aktif.`);
        }
        if (
          newAbsenceSnapshot?.exists &&
          newAbsenceSnapshot.data()?.status === 'approved' &&
          satpamAttendanceReportType(newAbsenceSnapshot.data() || {}) === 'izin_resmi'
        ) {
          throw new HttpError(
            409,
            `${newEmployeeName} memiliki izin dibayar pada tanggal ini. Selesaikan konflik izin terlebih dahulu.`,
          );
        }
      }

      const now = admin.firestore.FieldValue.serverTimestamp();
      const amount = SATPAM_RATES[command.payType];
      const after = {
        ...before,
        employeeId: targetEmployeeId,
        employeeName: employeeChanged ? newEmployeeName : String(before.employeeName || employeeId),
        shiftType: command.payType,
        fee: amount,
        coveredEmployeeId:
          command.payType === 'Lembur Cover' ? coveredEmployeeId : null,
        auditorEditedAt: now,
        auditorEditedBy: actor.uid,
        ...(payTypeChanged
          ? {
              payTypeCorrectedAt: now,
              payTypeCorrectedBy: actor.uid,
              payTypeCorrectedFrom: previousPayType,
            }
          : {}),
        ...(employeeChanged
          ? {
              employeeCorrectedAt: now,
              employeeCorrectedBy: actor.uid,
              employeeCorrectedFrom: employeeId,
              // Same reasoning as the approved-report route: any existing
              // photo was captured as proof for whoever originally submitted
              // it, not for the newly-assigned guard.
              photoStaleAfterCorrection: true,
            }
          : {}),
      };
      transaction.set(reportRef, after);

      transaction.create(
        newFinancialAuditRef(),
        buildFinancialAuditRecord(actor, {
          action: employeeChanged
            ? 'SATPAM_SHIFT_ASSIGNMENT_PENDING_EMPLOYEE_EDITED'
            : 'SATPAM_SHIFT_ASSIGNMENT_PENDING_PAY_TYPE_EDITED',
          entityType: 'ActivityReport',
          entityId: command.reportId,
          reason: command.reason,
          requestId: command.requestId,
          before,
          after,
          metadata: {
            period,
            occurrenceId: before.sourceOccurrenceId,
            payTypeChanged,
            previousPayType,
            newPayType: command.payType,
            previousFee: Number(before.fee || 0),
            newFee: amount,
            employeeChanged,
            previousEmployeeId: employeeId,
            newEmployeeId: targetEmployeeId,
          },
        }),
      );

      transaction.create(idempotencyRef, {
        requestHash,
        entityId: command.reportId,
        employeeId: targetEmployeeId,
        period,
        resultingStatus: 'pending',
        createdAt: now,
      });

      return { updated: true, idempotent: false };
    });

    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
