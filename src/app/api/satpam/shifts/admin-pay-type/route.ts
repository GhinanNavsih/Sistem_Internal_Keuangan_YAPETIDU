import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import {
  assertRequestId,
  guardDutyIndexId,
  isImmutablePayrollStatus,
  payrollPeriodForDutyDate,
  SATPAM_RATES,
  type SatpamPayType,
  type SatpamShiftName,
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
import {
  SATPAM_ABSENCE_REQUESTS_COLLECTION,
  syncSatpamDutyReconciliation,
} from '@/lib/server/satpamDutyPlan';

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

const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,180}$/;

interface PayTypeCommand {
  requestId: string;
  reportId: string;
  payType: Exclude<SatpamPayType, 'Off-Duty'>;
  employeeId: string;
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
          'Hanya penugasan yang sudah disetujui yang dapat dikoreksi.',
        );
      }

      const previousPayType = String(before.shiftType || '');
      const payTypeChanged = previousPayType !== command.payType;
      const employeeId = String(before.employeeId || '');
      const targetEmployeeId = command.employeeId;
      const employeeChanged = targetEmployeeId !== employeeId;
      const previousCoveredEmployeeId = String(before.coveredEmployeeId || '').trim();

      const coveredEmployeeId =
        command.payType === 'Lembur Cover'
          ? command.coveredEmployeeId || previousCoveredEmployeeId
          : '';
      const coveredEmployeeChanged = coveredEmployeeId !== previousCoveredEmployeeId;
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
      if (!payTypeChanged && !employeeChanged && !coveredEmployeeChanged) {
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
      const shiftName = String(
        before.reportedShiftName || before.shiftName || '',
      ) as SatpamShiftName;

      const periodRef = adminDb.collection('PayrollPeriods').doc(period);
      const slipRef = adminDb
        .collection('PayrollSlipStates')
        .doc(`${period.replace('-', '_')}_${employeeId}`);
      const ledgerRef = adminDb.collection('PayrollLedgerEntries').doc(command.reportId);

      // The employee-swap checks below only apply when the guard is actually
      // changing — an ordinary pay-type-only correction never touches any of
      // this. All reads still happen up front in the same Promise.all,
      // Firestore transactions require every read before the first write.
      const newEmployeeRef = employeeChanged
        ? adminDb.collection('Employees_BlueCollar').doc(targetEmployeeId)
        : null;
      const newSlipRef = employeeChanged
        ? adminDb
            .collection('PayrollSlipStates')
            .doc(`${period.replace('-', '_')}_${targetEmployeeId}`)
        : null;
      const newGuardIndexKey = employeeChanged
        ? guardDutyIndexId(dutyDate, shiftName, targetEmployeeId)
        : null;
      const oldGuardIndexKey = employeeChanged
        ? guardDutyIndexId(dutyDate, shiftName, employeeId)
        : null;
      const newGuardIndexRef = newGuardIndexKey
        ? adminDb.collection('GuardDutyIndexes').doc(newGuardIndexKey)
        : null;
      const oldGuardIndexRef = oldGuardIndexKey
        ? adminDb.collection('GuardDutyIndexes').doc(oldGuardIndexKey)
        : null;
      const newAbsenceRef = employeeChanged
        ? adminDb
            .collection(SATPAM_ABSENCE_REQUESTS_COLLECTION)
            .doc(satpamDutyKey(targetEmployeeId, dutyDate).replaceAll('-', ''))
        : null;

      const [
        periodSnapshot,
        slipSnapshot,
        ledgerSnapshot,
        newEmployeeSnapshot,
        newSlipSnapshot,
        newGuardIndexSnapshot,
        oldGuardIndexSnapshot,
        newAbsenceSnapshot,
      ] = await Promise.all([
        transaction.get(periodRef),
        transaction.get(slipRef),
        transaction.get(ledgerRef),
        newEmployeeRef ? transaction.get(newEmployeeRef) : Promise.resolve(null),
        newSlipRef ? transaction.get(newSlipRef) : Promise.resolve(null),
        newGuardIndexRef ? transaction.get(newGuardIndexRef) : Promise.resolve(null),
        oldGuardIndexRef ? transaction.get(oldGuardIndexRef) : Promise.resolve(null),
        newAbsenceRef ? transaction.get(newAbsenceRef) : Promise.resolve(null),
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

      let newEmployeeName = '';
      if (employeeChanged) {
        if (newSlipSnapshot?.exists && isImmutablePayrollStatus(newSlipSnapshot.data()?.status)) {
          throw new HttpError(
            409,
            'Slip petugas pengganti sudah dikunci/dibayar; gunakan alur koreksi finansial untuk periode ini.',
          );
        }
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
        if (newGuardIndexSnapshot?.exists) {
          const existingOccurrenceId = String(newGuardIndexSnapshot.data()?.occurrenceId || '');
          const existingReportId = String(newGuardIndexSnapshot.data()?.reportId || '');
          if (existingOccurrenceId !== String(before.sourceOccurrenceId || '')) {
            throw new HttpError(
              409,
              `${newEmployeeName} sudah memiliki pembayaran pada shift yang sama.`,
            );
          }
          if (existingReportId !== command.reportId) {
            throw new HttpError(
              409,
              `${newEmployeeName} sudah bertugas di pos lain pada shift yang sama.`,
            );
          }
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
        // Lembur Cover is the only classification that names a replaced guard;
        // switching away from it must not leave that pointer behind.
        coveredEmployeeId:
          command.payType === 'Lembur Cover' ? coveredEmployeeId : null,
        reviewRevision: Number(before.reviewRevision || 0) + 1,
        ...(payTypeChanged
          ? {
              payTypeCorrectedAt: now,
              payTypeCorrectedBy: actor.uid,
              payTypeCorrectedFrom: previousPayType,
            }
          : {}),
        // plannedEmployeeId/plannedEmployeeName intentionally pass through
        // unchanged via the {...before} spread above — they record the
        // original duty-plan roster, not who is currently credited, and are
        // exactly what the "Rencana/Aktual" audit card diffs against.
        ...(employeeChanged
          ? {
              employeeCorrectedAt: now,
              employeeCorrectedBy: actor.uid,
              employeeCorrectedFrom: employeeId,
              // The existing photo was captured as proof for whoever
              // originally submitted it; it does not become new proof of the
              // newly-credited guard's presence just because the report's
              // employeeId changed after the fact. Flag it rather than
              // discard it — see SATPAM_SHIFT_ASSIGNMENT_EMPLOYEE_CORRECTED.
              photoStaleAfterCorrection: true,
            }
          : {}),
        ...(coveredEmployeeChanged
          ? {
              coveredEmployeeCorrectedAt: now,
              coveredEmployeeCorrectedBy: actor.uid,
              coveredEmployeeCorrectedFrom: previousCoveredEmployeeId || null,
              coveredEmployeeCorrectedTo: coveredEmployeeId || null,
            }
          : {}),
      };
      transaction.set(reportRef, after);

      // Keep the payable ledger consistent with the report it was posted from.
      if (ledgerSnapshot.exists) {
        transaction.update(ledgerRef, {
          employeeId: targetEmployeeId,
          payType: command.payType,
          amount,
          correctedAt: now,
          correctedBy: actor.uid,
        });
      }

      if (employeeChanged) {
        // Only clear the old guard's index entry if it still actually points
        // at this report — if it doesn't, it isn't ours to touch, and leaving
        // it alone surfaces a pre-existing inconsistency instead of hiding it.
        if (
          oldGuardIndexSnapshot?.exists &&
          String(oldGuardIndexSnapshot.data()?.reportId || '') === command.reportId
        ) {
          transaction.delete(adminDb.collection('GuardDutyIndexes').doc(oldGuardIndexKey!));
        }
        transaction.set(
          adminDb.collection('GuardDutyIndexes').doc(newGuardIndexKey!),
          {
            employeeId: targetEmployeeId,
            occurrenceId: before.sourceOccurrenceId,
            reportId: command.reportId,
            dutyDate,
            shiftName,
            startsAt: before.startsAt || null,
            endsAt: before.endsAt || null,
            approvedAt: now,
          },
          { merge: true },
        );
      }

      transaction.create(
        newFinancialAuditRef(),
        buildFinancialAuditRecord(actor, {
          action: employeeChanged
            ? 'SATPAM_SHIFT_ASSIGNMENT_EMPLOYEE_CORRECTED'
            : payTypeChanged
              ? 'SATPAM_SHIFT_ASSIGNMENT_PAY_TYPE_CORRECTED'
              : 'SATPAM_SHIFT_ASSIGNMENT_COVERED_EMPLOYEE_CORRECTED',
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
            coveredEmployeeChanged,
            previousCoveredEmployeeId: previousCoveredEmployeeId || null,
            newCoveredEmployeeId: coveredEmployeeId || null,
          },
        }),
      );

      transaction.create(idempotencyRef, {
        requestHash,
        entityId: command.reportId,
        employeeId: targetEmployeeId,
        period,
        resultingStatus: 'approved',
        createdAt: now,
      });

      return { updated: true, idempotent: false, employeeId: targetEmployeeId, period };
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
