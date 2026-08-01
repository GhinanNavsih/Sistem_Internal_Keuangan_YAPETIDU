import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import {
  assertRequestId,
  isImmutablePayrollStatus,
} from '@/lib/payroll/domain';
import {
  absenceEntitlementData,
  loadSatpamDutyPlan,
  SATPAM_ABSENCE_ENTITLEMENTS_COLLECTION,
  SATPAM_ABSENCE_REQUESTS_COLLECTION,
  syncSatpamDutyReconciliation,
} from '@/lib/server/satpamDutyPlan';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '@/lib/server/audit';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';
import { assertPeriodAcceptsInput } from '@/lib/server/payrollPeriod';

export const dynamic = 'force-dynamic';

const ACTIONS = new Set([
  'approve',
  'decline',
  'supersede_approve',
  'supersede_decline',
]);

function stableHash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['satker_head']);
    if (
      actor.role === 'satker_head' &&
      !actor.permittedCategories.includes('SATPAM')
    ) {
      throw new HttpError(403, 'Anda tidak memiliki akses kategori SATPAM.');
    }
    const body = await request.json();
    const absenceRequestId = String(body.absenceRequestId || '');
    const action = String(body.action || '');
    const requestId = String(body.requestId || '');
    const reason = String(body.reason || '').trim();
    const expectedRevision = Number(body.expectedRevision);
    if (
      !/^[A-Za-z0-9_-]{1,180}$/.test(absenceRequestId) ||
      !ACTIONS.has(action) ||
      reason.length < 8 ||
      !Number.isInteger(expectedRevision) ||
      expectedRevision < 1
    ) {
      throw new HttpError(
        400,
        'ID pengajuan, aksi, revisi, atau alasan auditor tidak valid.',
      );
    }
    try {
      assertRequestId(requestId);
    } catch (error) {
      throw new HttpError(
        400,
        error instanceof Error ? error.message : 'requestId tidak valid.',
      );
    }
    const absenceRef = adminDb
      .collection(SATPAM_ABSENCE_REQUESTS_COLLECTION)
      .doc(absenceRequestId);
    const beforeSnapshot = await absenceRef.get();
    if (!beforeSnapshot.exists) {
      throw new HttpError(404, 'Pengajuan izin tidak ditemukan.');
    }
    const absence = beforeSnapshot.data()!;
    const period = String(absence.period || '');
    const employeeId = String(absence.employeeId || '');
    const plan = await loadSatpamDutyPlan(period, String(absence.teamId || ''));
    if (!plan) {
      throw new HttpError(409, 'Rencana dinas sumber tidak ditemukan.');
    }
    const planDay = plan.generatedDays.find(
      (day) => day.dutyDate === absence.dutyDate,
    );
    if (
      !planDay ||
      !planDay.assignments.some(
        (assignment) => assignment.employeeId === employeeId,
      )
    ) {
      throw new HttpError(
        409,
        'Pegawai tidak lagi memiliki kewajiban dinas pada tanggal tersebut.',
      );
    }
    const approving =
      action === 'approve' || action === 'supersede_approve';
    if (approving) {
      const reports = await adminDb
        .collection('ActivityReports')
        .where('employeeId', '==', employeeId)
        .get();
      const worked = reports.docs.find((snapshot) => {
        const report = snapshot.data();
        return (
          report.status === 'approved' &&
          (report.reportKind === 'satpam_shift_assignment' ||
            report.sourceType === 'satpam_shift' ||
            report.sourceOccurrenceId) &&
          String(report.dutyDate || report.activityDate || '') ===
            String(absence.dutyDate || '')
        );
      });
      if (worked) {
        throw new HttpError(
          409,
          'Pegawai sudah tercatat bekerja pada tanggal ini. Selesaikan laporan shift sebelum menyetujui izin.',
        );
      }
    }
    const requestHash = stableHash({
      absenceRequestId,
      action,
      requestId,
      reason,
      expectedRevision,
      planRevision: plan.revision,
    });
    const idempotencyRef = adminDb
      .collection('FinancialIdempotencyKeys')
      .doc(`${actor.uid}__${requestId}`);
    const entitlementRef = adminDb
      .collection(SATPAM_ABSENCE_ENTITLEMENTS_COLLECTION)
      .doc(absenceRequestId);
    const ledgerRef = adminDb
      .collection('PayrollLedgerEntries')
      .doc(`ABS-${absenceRequestId}`);
    const planRef = adminDb
      .collection('SatpamDutyPlans')
      .doc(plan.id);
    const periodRef = adminDb.collection('PayrollPeriods').doc(period);
    const slipRef = adminDb
      .collection('PayrollSlipStates')
      .doc(`${period.replace('-', '_')}_${employeeId}`);

    const result = await adminDb.runTransaction(async (transaction) => {
      const [
        latestAbsence,
        latestPlan,
        periodSnapshot,
        slipSnapshot,
        idempotencySnapshot,
      ] = await Promise.all([
        transaction.get(absenceRef),
        transaction.get(planRef),
        transaction.get(periodRef),
        transaction.get(slipRef),
        transaction.get(idempotencyRef),
      ]);
      if (idempotencySnapshot.exists) {
        if (idempotencySnapshot.data()?.requestHash !== requestHash) {
          throw new HttpError(409, 'requestId sudah digunakan untuk keputusan lain.');
        }
        return {
          id: absenceRequestId,
          revision: Number(
            idempotencySnapshot.data()?.revision || expectedRevision,
          ),
          status: idempotencySnapshot.data()?.status,
          idempotent: true,
        };
      }
      assertPeriodAcceptsInput(periodSnapshot.data());
      if (
        slipSnapshot.exists &&
        isImmutablePayrollStatus(slipSnapshot.data()?.status)
      ) {
        throw new HttpError(409, 'Slip pegawai sudah immutable; gunakan koreksi finansial.');
      }
      const current = latestAbsence.data()!;
      if (Number(current.revision || 0) !== expectedRevision) {
        throw new HttpError(409, 'Pengajuan telah berubah. Muat ulang lalu coba lagi.');
      }
      if (
        ['approve', 'decline'].includes(action) &&
        current.status !== 'pending'
      ) {
        throw new HttpError(409, 'Pengajuan ini sudah pernah diputuskan.');
      }
      if (
        action.startsWith('supersede_') &&
        !['approved', 'declined'].includes(String(current.status || ''))
      ) {
        throw new HttpError(409, 'Hanya keputusan final yang dapat digantikan.');
      }
      if (Number(latestPlan.data()?.revision || 0) !== plan.revision) {
        throw new HttpError(
          409,
          'Rencana dinas berubah. Muat ulang sebelum memutuskan izin.',
        );
      }
      const revision = expectedRevision + 1;
      const status = approving ? 'approved' : 'declined';
      const now = admin.firestore.FieldValue.serverTimestamp();
      const after = {
        ...current,
        status,
        revision,
        decisionReason: reason,
        decidedAt: now,
        decidedBy: actor.uid,
        decidedByName: actor.displayName,
        decisionAction: action,
        approvedPayType: approving ? 'Harian' : null,
        approvedAmount: approving ? 12_500 : 0,
        planRevision: plan.revision,
        updatedAt: now,
      };
      transaction.set(absenceRef, after);
      transaction.create(
        adminDb
          .collection('SatpamAbsenceRequestRevisions')
          .doc(`${absenceRequestId}__r${revision}`),
        {
          absenceRequestId,
          revision,
          action,
          before: current,
          after,
          actorUid: actor.uid,
          requestId,
          reason,
          createdAt: now,
        },
      );
      if (approving) {
        const entitlement = {
          ...absenceEntitlementData({
            absenceRequestId,
            employeeId,
            employeeName: String(current.employeeName || employeeId),
            dutyDate: String(current.dutyDate || ''),
            period,
            teamId: String(current.teamId || ''),
            planId: plan.id,
            planRevision: plan.revision,
            approvedBy: actor.uid,
            approvedAt: now,
          }),
          status: 'posted',
          revision,
          updatedAt: now,
        };
        transaction.set(entitlementRef, entitlement);
        transaction.set(ledgerRef, {
          employeeId,
          payrollPeriod: period,
          sourceType: 'satpam_approved_absence',
          sourceId: absenceRequestId,
          payType: 'Harian',
          amount: 12_500,
          currency: 'IDR',
          status: 'posted',
          dutyDate: current.dutyDate,
          approvedBy: actor.uid,
          createdAt: now,
          updatedAt: now,
          schemaVersion: 1,
        });
      } else {
        transaction.set(
          entitlementRef,
          {
            absenceRequestId,
            employeeId,
            period,
            status: 'voided',
            amount: 0,
            revision,
            voidedBy: actor.uid,
            voidedAt: now,
            updatedAt: now,
          },
          { merge: true },
        );
        transaction.set(
          ledgerRef,
          {
            employeeId,
            payrollPeriod: period,
            sourceType: 'satpam_approved_absence',
            sourceId: absenceRequestId,
            status: 'voided',
            amount: 0,
            voidedBy: actor.uid,
            voidedAt: now,
            updatedAt: now,
          },
          { merge: true },
        );
      }
      transaction.create(
        newFinancialAuditRef(),
        buildFinancialAuditRecord(actor, {
          action: approving
            ? 'SATPAM_ABSENCE_APPROVED'
            : 'SATPAM_ABSENCE_DECLINED',
          entityType: 'SatpamAbsenceRequest',
          entityId: absenceRequestId,
          requestId,
          reason,
          before: current,
          after,
          metadata: {
            employeeId,
            dutyDate: current.dutyDate,
            amount: approving ? 12_500 : 0,
            planRevision: plan.revision,
          },
        }),
      );
      transaction.create(idempotencyRef, {
        actorUid: actor.uid,
        requestId,
        requestHash,
        entityType: 'SatpamAbsenceRequest',
        entityId: absenceRequestId,
        revision,
        status,
        createdAt: now,
      });
      return {
        id: absenceRequestId,
        revision,
        status,
        amount: approving ? 12_500 : 0,
        idempotent: false,
      };
    });
    await syncSatpamDutyReconciliation(period, actor.uid);
    return Response.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
