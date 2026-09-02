import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import {
  assertRequestId,
  isImmutablePayrollStatus,
} from '@/lib/payroll/domain';
import {
  normalizeAttendanceTime,
  resolveEmployeeAttendanceNipy,
  satpamAttendanceEvidenceDates,
} from '@/lib/payroll/attendance';
import {
  isValidSatpamAttendanceScanRange,
  satpamAttendanceReportType,
} from '@/lib/payroll/satpamAttendance';
import {
  isActiveSatpamShiftRegistration,
  shouldExcludeSatpamLeaveFromHarian,
} from '@/lib/payroll/satpamDutyPlan';
import { scanAttendanceCorrection } from '@/lib/payroll/pekaryaOfficialLeave';
import {
  absenceEntitlementData,
  loadSatpamDutyPlan,
  SATPAM_ABSENCE_ENTITLEMENTS_COLLECTION,
  SATPAM_ABSENCE_REQUESTS_COLLECTION,
  syncSatpamDutyReconciliation,
} from '@/lib/server/satpamDutyPlan';
import {
  attendanceCorrectionHeadId,
  ATTENDANCE_IMPORTS_COLLECTION,
  PEKARYA_CORRECTIONS_COLLECTION,
  PEKARYA_CORRECTION_HEADS_COLLECTION,
} from '@/lib/server/attendanceStore';
import { buildPekaryaAttendanceView } from '@/lib/server/pekaryaAttendance';
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
  'change_type',
  'supersede_approve',
  'supersede_decline',
]);

const SATPAM_ABSENCE_TYPES = new Set([
  'sakit',
  'izin_resmi',
  'darurat',
  'lainnya',
]);

function stableHash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['super_admin', 'satker_head']);
    const body = await request.json();
    const absenceRequestId = String(body.absenceRequestId || '');
    const action = String(body.action || '');
    const requestId = String(body.requestId || '');
    const reason =
      String(body.reason || '').trim() ||
      (action === 'change_type'
        ? 'Perubahan jenis ajuan oleh auditor.'
        : 'Keputusan diproses dari Review Koreksi Presensi.');
    const expectedRevision = Number(body.expectedRevision);
    if (
      !/^[A-Za-z0-9_-]{1,180}$/.test(absenceRequestId) ||
      !ACTIONS.has(action) ||
      reason.length > 500 ||
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
    const employeeRef = adminDb.collection('Employees_BlueCollar').doc(employeeId);
    const employeeSnapshot = await employeeRef.get();
    const employee = employeeSnapshot.data();
    if (
      !employeeSnapshot.exists ||
      employee?.employment?.jobCategory !== 'SATPAM' ||
      employee?.employment?.status !== 'active' ||
      employee?.flags?.isActive === false ||
      employee?.flags?.isPayrollEligible === false
    ) {
      throw new HttpError(409, 'Pegawai Satpam aktif tidak ditemukan.');
    }
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
    const reportType = satpamAttendanceReportType(absence);
    const requestedReportType =
      action === 'change_type' ? String(body.reportType || '') : '';
    if (action === 'change_type') {
      if (requestedReportType !== 'scan' && requestedReportType !== 'izin_resmi') {
        throw new HttpError(400, 'Jenis pengajuan presensi baru tidak valid.');
      }
      let nextScanIn: string | null = null;
      let nextScanOut: string | null = null;
      let nextAbsenceType = '';
      if (requestedReportType === 'scan') {
        nextScanIn = normalizeAttendanceTime(body.scanIn);
        nextScanOut = normalizeAttendanceTime(body.scanOut);
        if (
          !nextScanIn ||
          !nextScanOut ||
          !isValidSatpamAttendanceScanRange(
            nextScanIn,
            nextScanOut,
            planDay.shiftName,
          )
        ) {
          throw new HttpError(
            400,
            'Scan masuk dan scan keluar tidak membentuk rentang waktu yang valid untuk shift terpilih.',
          );
        }
      } else {
        nextAbsenceType = String(body.absenceType || 'izin_resmi');
        if (!SATPAM_ABSENCE_TYPES.has(nextAbsenceType)) {
          throw new HttpError(400, 'Jenis alasan izin tidak valid.');
        }
      }

      const currentScanIn =
        reportType === 'scan' ? normalizeAttendanceTime(absence.scanIn) : null;
      const currentScanOut =
        reportType === 'scan' ? normalizeAttendanceTime(absence.scanOut) : null;
      const currentAbsenceType = String(absence.absenceType || '');
      if (
        reportType === requestedReportType &&
        (requestedReportType === 'scan'
          ? currentScanIn === nextScanIn && currentScanOut === nextScanOut
          : currentAbsenceType === nextAbsenceType)
      ) {
        throw new HttpError(409, 'Jenis ajuan dan data pendukungnya sudah sama.');
      }

      const idempotencyRef = adminDb
        .collection('FinancialIdempotencyKeys')
        .doc(`${actor.uid}__${requestId}`);
      const planRef = adminDb.collection('SatpamDutyPlans').doc(plan.id);
      const periodRef = adminDb.collection('PayrollPeriods').doc(period);
      const slipRef = adminDb
        .collection('PayrollSlipStates')
        .doc(`${period.replace('-', '_')}_${employeeId}`);
      const requestHash = stableHash({
        absenceRequestId,
        action,
        currentReportType: reportType,
        reportType: requestedReportType,
        scanIn: nextScanIn,
        scanOut: nextScanOut,
        absenceType: nextAbsenceType,
        requestId,
        reason,
        expectedRevision,
        planRevision: plan.revision,
      });
      const result = await adminDb.runTransaction(async (transaction) => {
        const [latestAbsence, latestPlan, periodSnapshot, slipSnapshot, latestEmployee, idempotencySnapshot] =
          await Promise.all([
            transaction.get(absenceRef),
            transaction.get(planRef),
            transaction.get(periodRef),
            transaction.get(slipRef),
            transaction.get(employeeRef),
            transaction.get(idempotencyRef),
          ]);
        if (idempotencySnapshot.exists) {
          if (idempotencySnapshot.data()?.requestHash !== requestHash) {
            throw new HttpError(409, 'requestId sudah digunakan untuk perubahan lain.');
          }
          return {
            id: absenceRequestId,
            revision: Number(
              idempotencySnapshot.data()?.revision || expectedRevision,
            ),
            status: idempotencySnapshot.data()?.status,
            reportType: idempotencySnapshot.data()?.reportType,
            absenceType: idempotencySnapshot.data()?.absenceType,
            idempotent: true,
          };
        }
        assertPeriodAcceptsInput(
          periodSnapshot.data(),
          'Periode payroll sudah ditutup; jenis pengajuan tidak dapat diubah.',
        );
        if (
          slipSnapshot.exists &&
          isImmutablePayrollStatus(slipSnapshot.data()?.status)
        ) {
          throw new HttpError(
            409,
            'Slip pegawai sudah immutable; jenis pengajuan tidak dapat diubah.',
          );
        }
        const latestEmployeeData = latestEmployee.data();
        if (
          !latestEmployee.exists ||
          latestEmployeeData?.employment?.jobCategory !== 'SATPAM' ||
          latestEmployeeData?.employment?.status !== 'active' ||
          latestEmployeeData?.flags?.isActive === false ||
          latestEmployeeData?.flags?.isPayrollEligible === false
        ) {
          throw new HttpError(409, 'Pegawai Satpam aktif tidak ditemukan.');
        }
        const current = latestAbsence.data();
        if (!current) {
          throw new HttpError(404, 'Pengajuan izin Satpam tidak ditemukan.');
        }
        if (Number(current.revision || 0) !== expectedRevision) {
          throw new HttpError(
            409,
            'Pengajuan telah berubah. Muat ulang sebelum mengubah jenis.',
          );
        }
        if (current.status !== 'pending') {
          throw new HttpError(
            409,
            'Jenis ajuan hanya dapat diubah saat pengajuan masih menunggu keputusan.',
          );
        }
        if (Number(latestPlan.data()?.revision || 0) !== plan.revision) {
          throw new HttpError(
            409,
            'Rencana dinas berubah. Muat ulang sebelum mengubah jenis.',
          );
        }
        const currentReportType = satpamAttendanceReportType(current);
        const currentScanIn =
          currentReportType === 'scan'
            ? normalizeAttendanceTime(current.scanIn)
            : null;
        const currentScanOut =
          currentReportType === 'scan'
            ? normalizeAttendanceTime(current.scanOut)
            : null;
        const currentAbsenceType = String(current.absenceType || '');
        if (
          currentReportType === requestedReportType &&
          (requestedReportType === 'scan'
            ? currentScanIn === nextScanIn && currentScanOut === nextScanOut
            : currentAbsenceType === nextAbsenceType)
        ) {
          throw new HttpError(409, 'Jenis ajuan dan data pendukungnya sudah sama.');
        }

        const revision = expectedRevision + 1;
        const now = admin.firestore.FieldValue.serverTimestamp();
        const after = {
          ...current,
          status: current.status,
          reportType: requestedReportType,
          scanIn: nextScanIn,
          scanOut: nextScanOut,
          absenceType: nextAbsenceType,
          revision,
          typeChangedAt: now,
          typeChangedBy: actor.uid,
          typeChangeReason: reason,
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
        transaction.create(
          newFinancialAuditRef(),
          buildFinancialAuditRecord(actor, {
            action: 'SATPAM_ATTENDANCE_REQUEST_TYPE_CHANGED',
            entityType: 'SatpamAbsenceRequest',
            entityId: absenceRequestId,
            requestId,
            reason,
            before: current,
            after,
            metadata: {
              employeeId,
              dutyDate: current.dutyDate,
              previousReportType: currentReportType,
              reportType: requestedReportType,
              absenceType: nextAbsenceType,
              planRevision: plan.revision,
              attendanceCorrection: false,
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
          status: after.status,
          reportType: requestedReportType,
          absenceType: nextAbsenceType,
          createdAt: now,
        });
        return {
          id: absenceRequestId,
          revision,
          status: after.status,
          reportType: requestedReportType,
          absenceType: nextAbsenceType,
          idempotent: false,
        };
      });
      return Response.json(result, {
        headers: { 'Cache-Control': 'no-store' },
      });
    }
    if (reportType === 'scan') {
      if (action !== 'approve' && action !== 'decline') {
        throw new HttpError(
          409,
          'Keputusan laporan scan yang sudah final tidak dapat digantikan.',
        );
      }
      const scanIn = normalizeAttendanceTime(absence.scanIn);
      const scanOut = normalizeAttendanceTime(absence.scanOut);
      if (
        !scanIn ||
        !scanOut ||
        !isValidSatpamAttendanceScanRange(
          scanIn,
          scanOut,
          planDay.shiftName,
        )
      ) {
        throw new HttpError(409, 'Data scan masuk atau scan keluar tidak valid.');
      }
      const nipy = resolveEmployeeAttendanceNipy(employee || {});
      if (action === 'approve' && !nipy) {
        throw new HttpError(
          409,
          'NIPY Satpam wajib dilengkapi sebelum laporan scan disetujui.',
        );
      }
      const attendanceView = await buildPekaryaAttendanceView(
        period,
        'SATPAM',
        { allowMissingActiveImport: action === 'decline' },
      );
      const employeeView = attendanceView.employees.find(
        (candidate) => candidate.employeeId === employeeId,
      );
      if (!employeeView) {
        throw new HttpError(
          409,
          'Pegawai tidak tersedia dalam data presensi Satpam periode ini.',
        );
      }
      const evidenceDates = new Set(
        satpamAttendanceEvidenceDates(
          String(absence.dutyDate || ''),
          planDay.shiftName,
        ),
      );
      const currentDay =
        employeeView.days.find(
          (day) => day.date === String(absence.dutyDate || ''),
        ) || null;
      if (
        action === 'approve' &&
        employeeView.days.some(
          (day) => evidenceDates.has(day.date) && day.completePunch,
        )
      ) {
        throw new HttpError(
          409,
          'Presensi lengkap sudah tercatat untuk kewajiban dinas ini.',
        );
      }

      const scanRequestHash = stableHash({
        absenceRequestId,
        reportType,
        scanIn,
        scanOut,
        action,
        requestId,
        reason,
        expectedRevision,
        planRevision: plan.revision,
        importRevisionId: attendanceView.importRevisionId,
        calendarRevision: attendanceView.calendarRevision,
      });
      const scanIdempotencyRef = adminDb
        .collection('FinancialIdempotencyKeys')
        .doc(`${actor.uid}__${requestId}`);
      const scanPlanRef = adminDb.collection('SatpamDutyPlans').doc(plan.id);
      const scanPeriodRef = adminDb.collection('PayrollPeriods').doc(period);
      const scanSlipRef = adminDb
        .collection('PayrollSlipStates')
        .doc(`${period.replace('-', '_')}_${employeeId}`);
      const scanHeadRef = adminDb
        .collection(PEKARYA_CORRECTION_HEADS_COLLECTION)
        .doc(
          attendanceCorrectionHeadId(
            period,
            employeeId,
            String(absence.dutyDate || ''),
          ),
        );
      const scanCorrectionRef = adminDb
        .collection(PEKARYA_CORRECTIONS_COLLECTION)
        .doc();
      const scanImportRef = adminDb
        .collection(ATTENDANCE_IMPORTS_COLLECTION)
        .doc(period);
      const scanResult = await adminDb.runTransaction(async (transaction) => {
        const [
          latestRequest,
          latestPlan,
          latestPeriod,
          latestSlip,
          latestEmployee,
          latestHead,
          latestImport,
          idempotencySnapshot,
        ] = await Promise.all([
          transaction.get(absenceRef),
          transaction.get(scanPlanRef),
          transaction.get(scanPeriodRef),
          transaction.get(scanSlipRef),
          transaction.get(employeeRef),
          transaction.get(scanHeadRef),
          transaction.get(scanImportRef),
          transaction.get(scanIdempotencyRef),
        ]);
        if (idempotencySnapshot.exists) {
          if (idempotencySnapshot.data()?.requestHash !== scanRequestHash) {
            throw new HttpError(409, 'requestId sudah digunakan untuk keputusan lain.');
          }
          return {
            id: absenceRequestId,
            revision: Number(
              idempotencySnapshot.data()?.revision || expectedRevision,
            ),
            status: idempotencySnapshot.data()?.status,
            amount: 0,
            idempotent: true,
          };
        }
        assertPeriodAcceptsInput(
          latestPeriod.data(),
          'Periode payroll sudah ditutup; keputusan presensi tidak dapat diubah.',
        );
        if (
          latestSlip.exists &&
          isImmutablePayrollStatus(latestSlip.data()?.status)
        ) {
          throw new HttpError(
            409,
            'Slip pegawai sudah immutable; gunakan koreksi finansial.',
          );
        }
        const latestEmployeeData = latestEmployee.data();
        if (
          !latestEmployee.exists ||
          latestEmployeeData?.employment?.jobCategory !== 'SATPAM' ||
          latestEmployeeData?.employment?.status !== 'active' ||
          latestEmployeeData?.flags?.isActive === false ||
          latestEmployeeData?.flags?.isPayrollEligible === false
        ) {
          throw new HttpError(409, 'Pegawai Satpam aktif tidak ditemukan.');
        }
        const current = latestRequest.data();
        if (!current) {
          throw new HttpError(404, 'Laporan scan tidak ditemukan.');
        }
        if (Number(current.revision || 0) !== expectedRevision) {
          throw new HttpError(
            409,
            'Pengajuan telah berubah. Muat ulang sebelum memutuskan.',
          );
        }
        if (current.status !== 'pending') {
          throw new HttpError(409, 'Laporan scan ini sudah pernah diputuskan.');
        }
        if (Number(latestPlan.data()?.revision || 0) !== plan.revision) {
          throw new HttpError(
            409,
            'Rencana dinas berubah. Muat ulang sebelum memutuskan.',
          );
        }
        if (
          String(latestImport.data()?.activeRevisionId || '') !==
          attendanceView.importRevisionId
        ) {
          throw new HttpError(
            409,
            'Revisi import presensi berubah. Muat ulang sebelum memutuskan.',
          );
        }
        const currentCalendarRevision = Number(
          latestPeriod.data()?.workCalendar?.revision || 1,
        );
        if (currentCalendarRevision !== attendanceView.calendarRevision) {
          throw new HttpError(
            409,
            'Kalender kerja berubah. Muat ulang sebelum memutuskan.',
          );
        }
        const headHasCompletePunch =
          latestHead.data()?.present === true &&
          typeof latestHead.data()?.scanIn === 'string' &&
          typeof latestHead.data()?.scanOut === 'string';
        if (action === 'approve' && headHasCompletePunch) {
          throw new HttpError(
            409,
            'Tanggal ini sudah memiliki koreksi presensi lengkap.',
          );
        }

        const approvingScan = action === 'approve';
        const revision = expectedRevision + 1;
        const now = admin.firestore.FieldValue.serverTimestamp();
        const after = {
          ...current,
          status: approvingScan ? 'approved' : 'declined',
          revision,
          decisionReason: reason,
          decidedAt: now,
          decidedBy: actor.uid,
          decidedByName: actor.displayName,
          decisionAction: action,
          approvedPayType: null,
          approvedAmount: 0,
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

        if (approvingScan) {
          const correction = scanAttendanceCorrection(scanIn, scanOut);
          const correctionRecord = {
            period,
            category: 'SATPAM',
            employeeId,
            employeeName: String(employee.name || ''),
            nipy,
            date: String(current.dutyDate || ''),
            revision: Number(latestHead.data()?.revision || 0) + 1,
            supersedesCorrectionId:
              latestHead.data()?.correctionId || null,
            rawValue:
              (currentDay as typeof currentDay & { rawValue?: unknown } | null)
                ?.rawValue || [],
            beforeEffectiveValue: currentDay
              ? {
                  workStatus: currentDay.workStatus,
                  scanIn: currentDay.scanIn,
                  scanOut: currentDay.scanOut,
                  present: currentDay.present,
                }
              : null,
            effectiveValue: correction,
            importRevisionId: attendanceView.importRevisionId,
            calendarRevision: attendanceView.calendarRevision,
            reason: `Laporan presensi Satpam: ${String(current.reason || '')}\nKeputusan: ${reason}`,
            actorUid: actor.uid,
            actorName: actor.displayName,
            sourceType: 'satpam_scan_report',
            sourceId: absenceRequestId,
            createdAt: now,
          };
          transaction.create(scanCorrectionRef, correctionRecord);
          transaction.set(scanHeadRef, {
            ...correctionRecord,
            ...correction,
            correctionId: scanCorrectionRef.id,
            updatedAt: now,
          });
        }

        transaction.create(
          newFinancialAuditRef(),
          buildFinancialAuditRecord(actor, {
            action: approvingScan
              ? 'SATPAM_ATTENDANCE_APPROVED'
              : 'SATPAM_ATTENDANCE_DECLINED',
            entityType: 'SatpamAttendanceRequest',
            entityId: absenceRequestId,
            requestId,
            reason,
            before: current,
            after,
            metadata: {
              employeeId,
              dutyDate: current.dutyDate,
              attendanceCorrection: approvingScan,
              amount: 0,
            },
          }),
        );
        transaction.create(scanIdempotencyRef, {
          actorUid: actor.uid,
          requestId,
          requestHash: scanRequestHash,
          entityType: 'SatpamAttendanceRequest',
          entityId: absenceRequestId,
          revision,
          status: after.status,
          createdAt: now,
        });
        return {
          id: absenceRequestId,
          revision,
          status: after.status,
          amount: 0,
          idempotent: false,
        };
      });
      return Response.json(scanResult, {
        headers: { 'Cache-Control': 'no-store' },
      });
    }
    const approving =
      action === 'approve' || action === 'supersede_approve';
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
    const employeeShiftReportsQuery = adminDb
      .collection('ActivityReports')
      .where('employeeId', '==', employeeId);

    const result = await adminDb.runTransaction(async (transaction) => {
      const [
        latestAbsence,
        latestPlan,
        periodSnapshot,
        slipSnapshot,
        latestEmployee,
        idempotencySnapshot,
        shiftReportsSnapshot,
      ] = await Promise.all([
        transaction.get(absenceRef),
        transaction.get(planRef),
        transaction.get(periodRef),
        transaction.get(slipRef),
        transaction.get(employeeRef),
        transaction.get(idempotencyRef),
        transaction.get(employeeShiftReportsQuery),
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
          amount: Number(idempotencySnapshot.data()?.amount || 0),
          harianCountAdded:
            idempotencySnapshot.data()?.harianCountAdded === true,
          payrollExcludedFromHarian:
            idempotencySnapshot.data()?.payrollExcludedFromHarian === true,
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
      const latestEmployeeData = latestEmployee.data();
      if (
        !latestEmployee.exists ||
        latestEmployeeData?.employment?.jobCategory !== 'SATPAM' ||
        latestEmployeeData?.employment?.status !== 'active' ||
        latestEmployeeData?.flags?.isActive === false ||
        latestEmployeeData?.flags?.isPayrollEligible === false
      ) {
        throw new HttpError(409, 'Pegawai Satpam aktif tidak ditemukan.');
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
      const shiftRegistration = shiftReportsSnapshot.docs.find((snapshot) => {
        const report = snapshot.data();
        return (
          isActiveSatpamShiftRegistration(report) &&
          String(report.dutyDate || report.activityDate || '') ===
            String(current.dutyDate || '')
        );
      });
      const payrollExcludedFromHarian =
        approving &&
        shouldExcludeSatpamLeaveFromHarian({
          hasShiftRegistration: Boolean(shiftRegistration),
        });
      const harianCountAdded = approving && !payrollExcludedFromHarian;
      const approvedAmount = harianCountAdded ? 12_500 : 0;
      const payrollExclusionReason = payrollExcludedFromHarian
        ? 'SHIFT_REGISTERED_SAME_DATE'
        : null;
      const after = {
        ...current,
        status,
        revision,
        decisionReason: reason,
        decidedAt: now,
        decidedBy: actor.uid,
        decidedByName: actor.displayName,
        decisionAction: action,
        approvedPayType: harianCountAdded ? 'Harian' : null,
        approvedAmount,
        payrollExcludedFromHarian,
        payrollExclusionReason,
        payrollExclusionShiftReportId: shiftRegistration?.id || null,
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
      if (harianCountAdded) {
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
            count: 0,
            payType: null,
            revision,
            voidedBy: actor.uid,
            voidedAt: now,
            voidedReason:
              payrollExclusionReason || 'ABSENCE_DECLINED',
            payrollExcludedFromHarian,
            payrollExclusionReason,
            payrollExclusionShiftReportId: shiftRegistration?.id || null,
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
            payType: null,
            voidedBy: actor.uid,
            voidedAt: now,
            voidedReason:
              payrollExclusionReason || 'ABSENCE_DECLINED',
            payrollExcludedFromHarian,
            payrollExclusionReason,
            payrollExclusionShiftReportId: shiftRegistration?.id || null,
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
            amount: approvedAmount,
            harianCountAdded,
            payrollExcludedFromHarian,
            payrollExclusionReason,
            shiftRegistrationReportId: shiftRegistration?.id || null,
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
        amount: approvedAmount,
        harianCountAdded,
        payrollExcludedFromHarian,
        createdAt: now,
      });
      return {
        id: absenceRequestId,
        revision,
        status,
        amount: approvedAmount,
        harianCountAdded,
        payrollExcludedFromHarian,
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
