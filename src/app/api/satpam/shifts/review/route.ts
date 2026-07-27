import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import {
  assertRequestId,
  isImmutablePayrollStatus,
  SATPAM_RATES,
  SatpamPayType,
} from '@/lib/payroll/domain';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '@/lib/server/audit';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

type ShiftDecisionAction = 'approve' | 'decline';

interface ShiftDecision {
  reportId: string;
  action: ShiftDecisionAction;
  reason?: string;
}

interface ShiftReviewCommand {
  requestId: string;
  occurrenceId: string;
  reason: string;
  decisions: ShiftDecision[];
}

function parseCommand(raw: unknown): ShiftReviewCommand {
  if (!raw || typeof raw !== 'object') {
    throw new HttpError(400, 'Perintah audit shift tidak valid.');
  }
  const value = raw as Partial<ShiftReviewCommand>;
  if (typeof value.requestId !== 'string') {
    throw new HttpError(400, 'requestId wajib diisi.');
  }
  try {
    assertRequestId(value.requestId);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : 'requestId tidak valid.');
  }
  if (
    typeof value.occurrenceId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,180}$/.test(value.occurrenceId)
  ) {
    throw new HttpError(400, 'ID shift tidak valid.');
  }
  const reason = typeof value.reason === 'string' ? value.reason.trim() : '';
  if (reason.length < 8 || reason.length > 500) {
    throw new HttpError(400, 'Catatan audit wajib diisi antara 8 dan 500 karakter.');
  }
  if (!Array.isArray(value.decisions) || value.decisions.length < 1 || value.decisions.length > 20) {
    throw new HttpError(400, 'Audit shift harus memuat 1 sampai 20 penugasan.');
  }
  const decisions = value.decisions.map((decision) => {
    if (
      !decision ||
      typeof decision !== 'object' ||
      typeof decision.reportId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,180}$/.test(decision.reportId) ||
      (decision.action !== 'approve' && decision.action !== 'decline')
    ) {
      throw new HttpError(400, 'Keputusan audit penugasan tidak valid.');
    }
    const itemReason = typeof decision.reason === 'string' ? decision.reason.trim() : '';
    if (decision.action === 'decline' && itemReason.length < 8) {
      throw new HttpError(
        400,
        'Penugasan yang ditolak wajib menyertakan alasan minimal 8 karakter.',
      );
    }
    if (itemReason.length > 500) {
      throw new HttpError(400, 'Alasan penolakan maksimal 500 karakter.');
    }
    return { reportId: decision.reportId, action: decision.action, reason: itemReason };
  });
  if (new Set(decisions.map((decision) => decision.reportId)).size !== decisions.length) {
    throw new HttpError(400, 'Penugasan audit tidak boleh duplikat.');
  }
  return {
    requestId: value.requestId,
    occurrenceId: value.occurrenceId,
    reason,
    decisions,
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
      const occurrenceRef = adminDb.collection('ShiftOccurrences').doc(command.occurrenceId);
      const reportRefs = command.decisions.map((decision) =>
        adminDb.collection('ActivityReports').doc(decision.reportId),
      );

      const [idempotencySnapshot, occurrenceSnapshot, ...reportSnapshots] = await Promise.all([
        transaction.get(idempotencyRef),
        transaction.get(occurrenceRef),
        ...reportRefs.map((reference) => transaction.get(reference)),
      ]);

      if (idempotencySnapshot.exists) {
        const previous = idempotencySnapshot.data()!;
        if (previous.requestHash !== requestHash) {
          throw new HttpError(409, 'requestId sudah digunakan untuk audit berbeda.');
        }
        return {
          occurrenceId: command.occurrenceId,
          approved: previous.approvedCount || 0,
          declined: previous.declinedCount || 0,
          idempotent: true,
        };
      }
      if (!occurrenceSnapshot.exists) {
        throw new HttpError(404, 'Shift tidak ditemukan.');
      }
      const occurrence = occurrenceSnapshot.data()!;
      if (occurrence.status !== 'pending_review') {
        throw new HttpError(409, 'Shift ini sudah pernah diaudit atau memakai alur lama.');
      }

      const reports = reportSnapshots.map((snapshot, index) => {
        if (!snapshot.exists) {
          throw new HttpError(404, `Laporan ${command.decisions[index].reportId} tidak ditemukan.`);
        }
        return snapshot.data()!;
      });

      const period = String(occurrence.payrollPeriod || '');
      const periodRef = adminDb.collection('PayrollPeriods').doc(period);
      const slipRefs = reports.map((report) =>
        adminDb
          .collection('PayrollSlipStates')
          .doc(`${period.replace('-', '_')}_${report.employeeId}`),
      );
      const [periodSnapshot, ...slipSnapshots] = await Promise.all([
        transaction.get(periodRef),
        ...slipRefs.map((reference) => transaction.get(reference)),
      ]);

      if (!periodSnapshot.exists || periodSnapshot.data()?.attendanceStatus !== 'open') {
        throw new HttpError(409, 'Periode payroll belum dibuka atau sudah ditutup.');
      }

      const now = admin.firestore.FieldValue.serverTimestamp();
      let approvedCount = 0;
      let declinedCount = 0;

      reports.forEach((before, index) => {
        const decision = command.decisions[index];
        if (String(before.jobCategory || '') !== 'SATPAM') {
          throw new HttpError(409, 'Audit ini hanya berlaku untuk laporan SATPAM.');
        }
        if (String(before.sourceOccurrenceId || '') !== command.occurrenceId) {
          throw new HttpError(409, 'Laporan tidak termasuk dalam shift yang diaudit.');
        }
        if (before.status !== 'pending') {
          throw new HttpError(409, `Laporan ${decision.reportId} sudah pernah diaudit.`);
        }
        if (
          slipSnapshots[index]?.exists &&
          isImmutablePayrollStatus(slipSnapshots[index]?.data()?.status)
        ) {
          throw new HttpError(409, 'Slip pegawai sudah dikunci; gunakan alur koreksi.');
        }

        // Fees are server-derived from the rate table, never client supplied.
        const payType = String(before.shiftType || '') as SatpamPayType;
        const rate = SATPAM_RATES[payType];
        if (typeof rate !== 'number') {
          throw new HttpError(409, `Tipe upah ${payType} tidak dikenal.`);
        }

        const after =
          decision.action === 'approve'
            ? {
                ...before,
                status: 'approved',
                fee: rate,
                declineReason: '',
                reviewedAt: now,
                reviewedBy: actor.uid,
                reviewedByRole: actor.role,
                approvedAt: now,
                approvedBy: actor.uid,
                reviewRevision: Number(before.reviewRevision || 0) + 1,
              }
            : {
                ...before,
                status: 'declined',
                fee: 0,
                declineReason: decision.reason || command.reason,
                reviewedAt: now,
                reviewedBy: actor.uid,
                reviewedByRole: actor.role,
                reviewRevision: Number(before.reviewRevision || 0) + 1,
              };

        transaction.set(reportRefs[index], after);

        if (decision.action === 'approve') {
          approvedCount += 1;
          // Ledger posting is deferred to approval so a declined post never
          // leaves a payable trace behind.
          transaction.create(
            adminDb.collection('PayrollLedgerEntries').doc(decision.reportId),
            {
              employeeId: before.employeeId,
              payrollPeriod: period,
              sourceType: 'satpam_shift',
              sourceId: decision.reportId,
              sourceOccurrenceId: command.occurrenceId,
              payType,
              amount: rate,
              currency: 'IDR',
              status: 'posted',
              rateVersion: before.rateVersion || null,
              dutyDate: before.dutyDate || before.activityDate || null,
              startsAt: before.startsAt || null,
              endsAt: before.endsAt || null,
              approvedBy: actor.uid,
              createdAt: now,
              schemaVersion: 1,
            },
          );
        } else {
          declinedCount += 1;
        }

        transaction.create(
          newFinancialAuditRef(),
          buildFinancialAuditRecord(actor, {
            action:
              decision.action === 'approve'
                ? 'SATPAM_SHIFT_ASSIGNMENT_APPROVED'
                : 'SATPAM_SHIFT_ASSIGNMENT_DECLINED',
            entityType: 'ActivityReport',
            entityId: decision.reportId,
            reason: decision.reason || command.reason,
            requestId: command.requestId,
            before,
            after,
            metadata: {
              employeeId: before.employeeId,
              occurrenceId: command.occurrenceId,
              postId: before.postId || before.postName || null,
              hasPhoto: Boolean(before.photoUrl),
              period,
            },
          }),
        );
      });

      transaction.update(occurrenceRef, {
        status: 'reviewed',
        reviewStatus:
          declinedCount === 0
            ? 'approved'
            : approvedCount === 0
              ? 'declined'
              : 'partially_approved',
        pendingAssignmentCount: 0,
        approvedAssignmentCount: approvedCount,
        declinedAssignmentCount: declinedCount,
        reviewedAt: now,
        reviewedBy: actor.uid,
        reviewedByRole: actor.role,
        reviewNote: command.reason,
      });

      transaction.create(
        newFinancialAuditRef(),
        buildFinancialAuditRecord(actor, {
          action: 'SATPAM_SHIFT_REVIEWED',
          entityType: 'ShiftOccurrence',
          entityId: command.occurrenceId,
          reason: command.reason,
          requestId: command.requestId,
          after: {
            approvedAssignmentCount: approvedCount,
            declinedAssignmentCount: declinedCount,
            dutyDate: occurrence.dutyDate,
            shiftName: occurrence.shiftName,
          },
        }),
      );

      transaction.create(idempotencyRef, {
        actorUid: actor.uid,
        requestId: command.requestId,
        requestHash,
        entityType: 'ShiftOccurrence',
        entityId: command.occurrenceId,
        approvedCount,
        declinedCount,
        createdAt: now,
      });

      return {
        occurrenceId: command.occurrenceId,
        approved: approvedCount,
        declined: declinedCount,
        idempotent: false,
      };
    });

    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
