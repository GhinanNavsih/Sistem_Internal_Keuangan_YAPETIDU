import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import {
  assertDateOnly,
  assertPekaryaActivityProofUrl,
  assertRequestId,
  getShiftIsoBounds,
} from '@/lib/payroll/domain';
import { payrollPeriodForDutyDate } from '@/lib/payroll/domain';
import { normalizeAttendanceTime } from '@/lib/payroll/attendance';
import {
  isSatpamDutyPlanRequired,
  isSatpamPlanDayStarted,
  satpamDutyKey,
} from '@/lib/payroll/satpamDutyPlan';
import {
  isValidSatpamAttendanceScanRange,
  satpamAttendanceReportType,
  type SatpamAttendanceReportType,
} from '@/lib/payroll/satpamAttendance';
import {
  findSatpamTeamForEmployee,
  loadSatpamDutyPlanContext,
  SATPAM_ABSENCE_REQUESTS_COLLECTION,
} from '@/lib/server/satpamDutyPlan';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '@/lib/server/audit';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';
import { isPeriodClosed } from '@/lib/server/payrollPeriod';

export const dynamic = 'force-dynamic';

const ABSENCE_TYPES = new Set([
  'sakit',
  'izin_resmi',
  'darurat',
  'lainnya',
]);

function absenceRequestId(employeeId: string, dutyDate: string): string {
  return `${satpamDutyKey(employeeId, dutyDate).replaceAll('-', '')}`;
}

function stableHash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    const period = request.nextUrl.searchParams.get('period') || '';
    if (!/^\d{4}-\d{2}$/.test(period)) {
      throw new HttpError(400, 'Periode wajib menggunakan format YYYY-MM.');
    }
    let query: FirebaseFirestore.Query = adminDb
      .collection(SATPAM_ABSENCE_REQUESTS_COLLECTION)
      .where('period', '==', period);
    const isEmployee =
      actor.role === 'honorer' || actor.role === 'ketua_shift_satpam';
    if (isEmployee) {
      if (!actor.linkedEmployeeId) {
        throw new HttpError(409, 'Akun belum terhubung ke data Satpam.');
      }
      query = query.where('employeeId', '==', actor.linkedEmployeeId);
    } else {
      requireRole(actor, [
        'super_admin',
        'finance_verifier',
        'satker_head',
      ]);
      if (
        actor.role === 'satker_head' &&
        !actor.permittedCategories.includes('SATPAM')
      ) {
        throw new HttpError(403, 'Anda tidak memiliki akses kategori SATPAM.');
      }
    }
    const snapshot = await query.get();
    let scheduledDuties: Array<{
      dutyDate: string;
      shiftName: string;
      postId: string;
    }> = [];
    if (isEmployee && actor.linkedEmployeeId) {
      const team = await findSatpamTeamForEmployee(actor.linkedEmployeeId);
      if (team) {
        const plan = await loadSatpamDutyPlanContext(
          period,
          team.teamId,
          `${period}-01`,
        );
        scheduledDuties =
          plan.plan?.generatedDays.flatMap((day) => {
            const assignment = day.assignments.find(
              (candidate) =>
                candidate.employeeId === actor.linkedEmployeeId,
            );
            return assignment
              ? [{
                  dutyDate: day.dutyDate,
                  shiftName: day.shiftName,
                  postId: assignment.postId,
                }]
              : [];
          }) || [];
      }
    }
    return Response.json(
      {
        period,
        scheduledDuties,
        requests: snapshot.docs
          .map(
            (document): { id: string; [key: string]: unknown } => ({
              id: document.id,
              ...(document.data() as Record<string, unknown>),
            }),
          )
          .sort((left, right) =>
            String(right.dutyDate || '').localeCompare(
              String(left.dutyDate || ''),
            ),
          ),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['honorer', 'ketua_shift_satpam']);
    if (!actor.linkedEmployeeId) {
      throw new HttpError(409, 'Akun belum terhubung ke data Satpam.');
    }
    const employeeSnapshot = await adminDb
      .collection('Employees_BlueCollar')
      .doc(actor.linkedEmployeeId)
      .get();
    if (
      !employeeSnapshot.exists ||
      employeeSnapshot.data()?.employment?.jobCategory !== 'SATPAM' ||
      employeeSnapshot.data()?.employment?.status !== 'active' ||
      employeeSnapshot.data()?.flags?.isActive === false ||
      employeeSnapshot.data()?.flags?.isPayrollEligible === false
    ) {
      throw new HttpError(409, 'Akun ini tidak terhubung ke pegawai Satpam.');
    }
    if (
      actor.permittedCategories.length > 0 &&
      !actor.permittedCategories.includes('SATPAM')
    ) {
      throw new HttpError(403, 'Akun ini tidak memiliki akses kategori SATPAM.');
    }
    const body = await request.json();
    const action = String(body.action || 'submit');
    const requestId = String(body.requestId || '');
    const dutyDate = String(body.dutyDate || '');
    const expectedRevision = Number(body.expectedRevision || 0);
    if (action !== 'submit' && action !== 'withdraw') {
      throw new HttpError(400, 'Aksi pengajuan tidak valid.');
    }
    try {
      assertRequestId(requestId);
      assertDateOnly(dutyDate);
    } catch (error) {
      throw new HttpError(
        400,
        error instanceof Error ? error.message : 'Tanggal atau requestId tidak valid.',
      );
    }
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      throw new HttpError(400, 'Revisi pengajuan tidak valid.');
    }
    const period = payrollPeriodForDutyDate(dutyDate);
    const periodSnapshot = await adminDb.collection('PayrollPeriods').doc(period).get();
    if (
      isPeriodClosed(periodSnapshot.data()) ||
      !isSatpamDutyPlanRequired(period, periodSnapshot.data() || null)
    ) {
      throw new HttpError(
        409,
        'Pengajuan hanya tersedia pada periode rencana dinas yang terbuka.',
      );
    }
    const team = await findSatpamTeamForEmployee(actor.linkedEmployeeId);
    if (!team) {
      throw new HttpError(409, 'Satpam belum ditempatkan pada regu.');
    }
    const { plan, day } = await loadSatpamDutyPlanContext(
      period,
      team.teamId,
      dutyDate,
    );
    if (!plan || !day) {
      throw new HttpError(409, 'Rencana dinas tanggal ini belum diterbitkan.');
    }
    const plannedAssignment = day.assignments.find(
      (assignment) => assignment.employeeId === actor.linkedEmployeeId,
    );
    if (!plannedAssignment) {
      throw new HttpError(
        409,
        'Tanggal ini adalah hari Libur atau bukan kewajiban dinas Anda.',
      );
    }
    const documentId = absenceRequestId(actor.linkedEmployeeId, dutyDate);
    const absenceRef = adminDb
      .collection(SATPAM_ABSENCE_REQUESTS_COLLECTION)
      .doc(documentId);
    const idempotencyRef = adminDb
      .collection('FinancialIdempotencyKeys')
      .doc(`${actor.uid}__${requestId}`);
    const planRef = adminDb
      .collection('SatpamDutyPlans')
      .doc(plan.id);

    let reportType: SatpamAttendanceReportType =
      body.reportType === 'scan' ? 'scan' : 'izin_resmi';
    let scanIn: string | null = null;
    let scanOut: string | null = null;
    let absenceType = '';
    let reason = '';
    let evidenceUrl: string | null = null;
    if (action === 'submit') {
      if (body.reportType !== 'scan' && body.reportType !== 'izin_resmi') {
        throw new HttpError(400, 'Jenis pengajuan presensi tidak valid.');
      }
      reportType = body.reportType;
      reason = String(body.reason || '').trim();
      if (reason.length > 500) {
        throw new HttpError(
          400,
          'Alasan pengajuan maksimal 500 karakter.',
        );
      }
      if (reportType === 'scan') {
        scanIn = normalizeAttendanceTime(body.scanIn);
        scanOut = normalizeAttendanceTime(body.scanOut);
        if (
          !scanIn ||
          !scanOut ||
          !isValidSatpamAttendanceScanRange(
            scanIn,
            scanOut,
            day.shiftName,
          )
        ) {
          throw new HttpError(
            400,
            'Scan masuk dan scan keluar tidak membentuk rentang waktu yang valid untuk shift terpilih.',
          );
        }
      } else {
        absenceType = String(body.absenceType || '');
        if (!ABSENCE_TYPES.has(absenceType)) {
          throw new HttpError(400, 'Jenis izin tidak valid.');
        }
      }
      if (body.evidenceUrl) {
        if (typeof body.evidenceUrl !== 'string') {
          throw new HttpError(400, 'URL bukti izin tidak valid.');
        }
        try {
          assertPekaryaActivityProofUrl(
            body.evidenceUrl,
            actor.linkedEmployeeId,
          );
        } catch (error) {
          throw new HttpError(
            400,
            error instanceof Error ? error.message : 'URL bukti izin tidak valid.',
          );
        }
        evidenceUrl = body.evidenceUrl;
      }
    }
    const requestHash = stableHash({
      action,
      employeeId: actor.linkedEmployeeId,
      dutyDate,
      expectedRevision,
      reportType,
      scanIn,
      scanOut,
      absenceType,
      reason,
      evidenceUrl,
      planRevision: plan.revision,
    });
    const result = await adminDb.runTransaction(async (transaction) => {
      const [
        beforeSnapshot,
        idempotencySnapshot,
        latestPeriodSnapshot,
        latestPlanSnapshot,
      ] = await Promise.all([
        transaction.get(absenceRef),
        transaction.get(idempotencyRef),
        transaction.get(adminDb.collection('PayrollPeriods').doc(period)),
        transaction.get(planRef),
      ]);
      if (idempotencySnapshot.exists) {
        if (idempotencySnapshot.data()?.requestHash !== requestHash) {
          throw new HttpError(409, 'requestId sudah digunakan untuk pengajuan lain.');
        }
        return {
          id: documentId,
          revision: Number(
            idempotencySnapshot.data()?.revision || expectedRevision,
          ),
          status: idempotencySnapshot.data()?.status,
          idempotent: true,
        };
      }
      if (isPeriodClosed(latestPeriodSnapshot.data())) {
        throw new HttpError(
          409,
          'Periode payroll sudah ditutup; pengajuan tidak dapat diubah.',
        );
      }
      if (
        !isSatpamDutyPlanRequired(
          period,
          latestPeriodSnapshot.data() || null,
        ) ||
        Number(latestPlanSnapshot.data()?.revision || 0) !== plan.revision
      ) {
        throw new HttpError(
          409,
          'Rencana dinas berubah. Muat ulang sebelum mengajukan.',
        );
      }
      const before = beforeSnapshot.exists ? beforeSnapshot.data()! : null;
      const effectiveReportType =
        action === 'withdraw' && before
          ? satpamAttendanceReportType(before)
          : reportType;
      const currentRevision = Number(before?.revision || 0);
      if (currentRevision !== expectedRevision) {
        throw new HttpError(409, 'Pengajuan telah berubah. Muat ulang lalu coba lagi.');
      }
      if (
        action === 'withdraw' &&
        (!before || before.status !== 'pending')
      ) {
        throw new HttpError(
          409,
          'Hanya pengajuan yang masih menunggu yang dapat ditarik.',
        );
      }
      if (
        action === 'submit' &&
        before &&
        !['declined', 'withdrawn'].includes(String(before.status || ''))
      ) {
        throw new HttpError(
          409,
          'Pengajuan tanggal ini masih aktif atau sudah disetujui.',
        );
      }
      const revision = currentRevision + 1;
      const now = admin.firestore.FieldValue.serverTimestamp();
      const late = isSatpamPlanDayStarted(day);
      const { startsAtIso, endsAtIso } = getShiftIsoBounds(
        dutyDate,
        day.shiftName,
      );
      const after =
        action === 'withdraw'
          ? {
              ...before,
              status: 'withdrawn',
              revision,
              withdrawnAt: now,
              withdrawnBy: actor.uid,
              updatedAt: now,
            }
          : {
              employeeId: actor.linkedEmployeeId,
              employeeName: String(
                employeeSnapshot.data()?.name || actor.displayName,
              ),
              employeeNipy: String(employeeSnapshot.data()?.nipy || ''),
              period,
              teamId: team.teamId,
              planId: plan.id,
              planRevision: plan.revision,
              dutyDate,
              shiftName: day.shiftName,
              postId: plannedAssignment.postId,
              startsAtIso,
              endsAtIso,
              reportType,
              scanIn,
              scanOut,
              absenceType,
              reason,
              evidenceUrl,
              late,
              status: 'pending',
              revision,
              submittedAt: now,
              submittedBy: actor.uid,
              updatedAt: now,
              schemaVersion: 2,
            };
      transaction.set(absenceRef, after);
      transaction.create(
        adminDb
          .collection('SatpamAbsenceRequestRevisions')
          .doc(`${documentId}__r${revision}`),
        {
          absenceRequestId: documentId,
          revision,
          action,
          before,
          after,
          actorUid: actor.uid,
          requestId,
          createdAt: now,
        },
      );
      transaction.create(
        newFinancialAuditRef(),
        buildFinancialAuditRecord(actor, {
          action:
            action === 'withdraw'
              ? `SATPAM_${effectiveReportType === 'scan' ? 'ATTENDANCE' : 'ABSENCE'}_WITHDRAWN`
              : `SATPAM_${effectiveReportType === 'scan' ? 'ATTENDANCE' : 'ABSENCE'}_SUBMITTED`,
          entityType:
            effectiveReportType === 'scan'
              ? 'SatpamAttendanceRequest'
              : 'SatpamAbsenceRequest',
          entityId: documentId,
          requestId,
          reason:
            reason ||
            (action === 'withdraw'
              ? `Pengajuan ${effectiveReportType === 'scan' ? 'presensi' : 'izin'} ditarik oleh Satpam.`
              : `Pengajuan ${effectiveReportType === 'scan' ? 'presensi' : 'izin'} dikirim tanpa keterangan tambahan oleh Satpam.`),
          before,
          after,
          metadata: { late, planRevision: plan.revision },
        }),
      );
      transaction.create(idempotencyRef, {
        actorUid: actor.uid,
        requestId,
        requestHash,
        entityType:
          effectiveReportType === 'scan'
            ? 'SatpamAttendanceRequest'
            : 'SatpamAbsenceRequest',
        entityId: documentId,
        revision,
        status: after.status,
        createdAt: now,
      });
      return {
        id: documentId,
        revision,
        status: after.status,
        late,
        idempotent: false,
      };
    });
    return Response.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
