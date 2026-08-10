import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import {
  assertRequestId,
  guardDutyIndexId,
  isImmutablePayrollStatus,
  type SatpamShiftName,
} from '@/lib/payroll/domain';
import {
  buildPekaryaActivityIdentity,
  pekaryaPayrollPeriodForDate,
} from '@/lib/payroll/pekaryaSpj';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '@/lib/server/audit';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';
import { assertPeriodAcceptsInput } from '@/lib/server/payrollPeriod';

export const dynamic = 'force-dynamic';

interface DeleteCommand {
  requestId: string;
  reportId: string;
  reason: string;
}

function parseCommand(raw: unknown): DeleteCommand {
  if (!raw || typeof raw !== 'object') {
    throw new HttpError(400, 'Perintah penghapusan tidak valid.');
  }
  const value = raw as Partial<DeleteCommand>;
  if (typeof value.requestId !== 'string') {
    throw new HttpError(400, 'requestId wajib diisi.');
  }
  try {
    assertRequestId(value.requestId);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : 'requestId tidak valid.');
  }
  if (typeof value.reportId !== 'string' || !/^[A-Za-z0-9_-]{1,180}$/.test(value.reportId)) {
    throw new HttpError(400, 'ID laporan tidak valid.');
  }
  const reason = typeof value.reason === 'string' ? value.reason.trim() : '';
  if (reason.length < 8 || reason.length > 500) {
    throw new HttpError(400, 'Alasan penghapusan wajib diisi antara 8 dan 500 karakter.');
  }
  return { requestId: value.requestId, reportId: value.reportId, reason };
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['super_admin']);

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
          throw new HttpError(409, 'requestId sudah digunakan untuk penghapusan berbeda.');
        }
        return { deleted: true, idempotent: true, employeeId: previous.employeeId || null, period: previous.period || null };
      }

      if (!reportSnapshot.exists) {
        throw new HttpError(404, 'Laporan tidak ditemukan.');
      }
      const report = reportSnapshot.data()!;

      if (report.status !== 'approved' && report.status !== 'declined') {
        throw new HttpError(
          409,
          'Hanya laporan yang sudah disetujui atau ditolak yang dapat dihapus. Laporan yang masih menunggu diproses lewat alur review biasa.',
        );
      }
      // Driver journeys carry their own claim/fuel-reservation state machine
      // (see DriverJourneys + PayrollLedgerEntries fuel context) that this
      // endpoint does not unwind — deleting the ActivityReport alone would
      // leave the journey doc pointing at a report that no longer exists.
      if (report.journeyId) {
        throw new HttpError(
          409,
          'Laporan perjalanan Sopir dikelola lewat halaman Perjalanan Dinas, bukan lewat penghapusan ini.',
        );
      }

      const employeeId = String(report.employeeId || '');
      const period = String(
        report.payrollPeriod ||
          report.period ||
          (report.activityDate ? pekaryaPayrollPeriodForDate(String(report.activityDate)) : ''),
      );
      if (!/^\d{4}-\d{2}$/.test(period)) {
        throw new HttpError(409, 'Periode payroll laporan tidak dapat ditentukan.');
      }

      const isSatpamShiftAssignment =
        report.reportKind === 'satpam_shift_assignment' && Boolean(report.sourceOccurrenceId);

      const periodRef = adminDb.collection('PayrollPeriods').doc(period);
      const slipRef = adminDb
        .collection('PayrollSlipStates')
        .doc(`${period.replace('-', '_')}_${employeeId}`);
      const occurrenceRef = isSatpamShiftAssignment
        ? adminDb.collection('ShiftOccurrences').doc(String(report.sourceOccurrenceId))
        : null;

      const [periodSnapshot, slipSnapshot, occurrenceSnapshot] = await Promise.all([
        transaction.get(periodRef),
        transaction.get(slipRef),
        occurrenceRef ? transaction.get(occurrenceRef) : Promise.resolve(null),
      ]);

      assertPeriodAcceptsInput(
        periodSnapshot.data(),
        'Periode payroll sudah ditutup; laporan tidak dapat dihapus.',
      );
      if (slipSnapshot.exists && isImmutablePayrollStatus(slipSnapshot.data()?.status)) {
        throw new HttpError(
          409,
          'Slip pegawai sudah dikunci/dibayar; gunakan alur koreksi finansial untuk periode ini.',
        );
      }

      const now = admin.firestore.FieldValue.serverTimestamp();

      transaction.delete(reportRef);

      if (isSatpamShiftAssignment && occurrenceRef) {
        // Bare reportId is the PayrollLedgerEntries key the review endpoint
        // posts to on approval (src/app/api/satpam/shifts/review/route.ts).
        transaction.delete(adminDb.collection('PayrollLedgerEntries').doc(command.reportId));

        if (occurrenceSnapshot?.exists) {
          const occurrence = occurrenceSnapshot.data()!;
          const wasApproved = report.status === 'approved';
          transaction.update(occurrenceRef, {
            reportIds: admin.firestore.FieldValue.arrayRemove(command.reportId),
            assignmentCount: Math.max(0, Number(occurrence.assignmentCount || 0) - 1),
            approvedAssignmentCount: wasApproved
              ? Math.max(0, Number(occurrence.approvedAssignmentCount || 0) - 1)
              : Number(occurrence.approvedAssignmentCount || 0),
            declinedAssignmentCount: !wasApproved
              ? Math.max(0, Number(occurrence.declinedAssignmentCount || 0) - 1)
              : Number(occurrence.declinedAssignmentCount || 0),
          });
        }

        if (report.status === 'approved') {
          const dutyDate = String(report.dutyDate || report.activityDate || '');
          const shiftName = String(report.reportedShiftName || report.shiftName || '') as SatpamShiftName;
          if (dutyDate && shiftName) {
            transaction.delete(
              adminDb.collection('GuardDutyIndexes').doc(guardDutyIndexId(dutyDate, shiftName, employeeId)),
            );
          }
        }
      } else {
        // Same ledger-key convention used by /api/pekarya/activities/review.
        transaction.delete(
          adminDb.collection('PayrollLedgerEntries').doc(`SPJ_ACTIVITY__${command.reportId}`),
        );
        const identity =
          report.reportKind === 'satpam_found_item'
            ? ['found_item', command.reportId].join('__')
            : report.reportKind === 'satpam_reprimand'
              ? ['reprimand', command.reportId].join('__')
              : buildPekaryaActivityIdentity(
                  employeeId,
                  String(report.activityDate || ''),
                  String(report.timeStart || ''),
                  report.timeEnd ? String(report.timeEnd) : undefined,
                  String(report.activityName || ''),
                );
        transaction.delete(adminDb.collection('PekaryaActivityIndexes').doc(identity));
        // Compatibility cleanup for data written before the index collection
        // was renamed (mirrors the self-service DELETE handler).
        transaction.delete(adminDb.collection('ActivityReportsIndex').doc(command.reportId));
      }

      transaction.create(
        newFinancialAuditRef(),
        buildFinancialAuditRecord(actor, {
          action: isSatpamShiftAssignment
            ? 'SATPAM_SHIFT_ASSIGNMENT_DELETED_BY_ADMIN'
            : 'PEKARYA_ACTIVITY_DELETED_BY_ADMIN',
          entityType: 'ActivityReport',
          entityId: command.reportId,
          reason: command.reason,
          requestId: command.requestId,
          before: report,
          after: null,
          metadata: {
            employeeId,
            jobCategory: report.jobCategory || null,
            period,
            originalStatus: report.status,
            ...(isSatpamShiftAssignment ? { occurrenceId: report.sourceOccurrenceId } : {}),
          },
        }),
      );

      transaction.create(idempotencyRef, {
        requestHash,
        entityId: command.reportId,
        employeeId,
        period,
        resultingStatus: 'deleted',
        createdAt: now,
      });

      return { deleted: true, idempotent: false, employeeId, period };
    });

    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
