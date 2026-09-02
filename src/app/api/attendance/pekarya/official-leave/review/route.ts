import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import {
  ATTENDANCE_PAYROLL_START_PERIOD,
  isPremiumAttendanceDate,
  normalizeAttendanceTime,
  pekaryaAttendanceAmount,
  resolveEmployeeAttendanceNipy,
} from '@/lib/payroll/attendance';
import {
  assertDateOnly,
  assertRequestId,
  isImmutablePayrollStatus,
} from '@/lib/payroll/domain';
import { pekaryaPayrollWindow } from '@/lib/payroll/pekaryaSpj';
import {
  isPekaryaOfficialLeaveCategory,
  isValidAttendanceScanRange,
  normalizePekaryaAttendanceReportFields,
  officialLeaveAttendanceCorrection,
  scanAttendanceCorrection,
  PEKARYA_OFFICIAL_LEAVE_SCAN_IN,
  PEKARYA_OFFICIAL_LEAVE_SCAN_OUT,
  PEKARYA_OFFICIAL_LEAVE_TYPE,
} from '@/lib/payroll/pekaryaOfficialLeave';
import {
  attendanceCorrectionHeadId,
  ATTENDANCE_IMPORTS_COLLECTION,
  PEKARYA_CORRECTIONS_COLLECTION,
  PEKARYA_CORRECTION_HEADS_COLLECTION,
  PEKARYA_PUBLICATIONS_COLLECTION,
  pekaryaPublicationId,
} from '@/lib/server/attendanceStore';
import {
  PEKARYA_OFFICIAL_LEAVE_REQUESTS_COLLECTION,
  PEKARYA_OFFICIAL_LEAVE_REVISIONS_COLLECTION,
} from '@/lib/server/pekaryaOfficialLeave';
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

const ACTIONS = new Set(['approve', 'decline', 'change_type']);

function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['super_admin', 'satker_head']);
    const body = (await request.json()) as Record<string, unknown>;
    const officialLeaveRequestId = String(body.officialLeaveRequestId || '');
    const action = String(body.action || '');
    const requestId = String(body.requestId || '');
    const reason =
      String(body.reason || '').trim() ||
      (action === 'change_type'
        ? 'Perubahan jenis ajuan oleh auditor.'
        : 'Keputusan diproses dari Review Koreksi Presensi.');
    const expectedRevision = Number(body.expectedRevision);
    if (
      !/^[A-Za-z0-9_-]{1,180}$/.test(officialLeaveRequestId) ||
      !ACTIONS.has(action) ||
      reason.length > 500 ||
      !Number.isSafeInteger(expectedRevision) ||
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

    const leaveRef = adminDb
      .collection(PEKARYA_OFFICIAL_LEAVE_REQUESTS_COLLECTION)
      .doc(officialLeaveRequestId);
    const beforeSnapshot = await leaveRef.get();
    if (!beforeSnapshot.exists) {
      throw new HttpError(404, 'Pengajuan izin resmi tidak ditemukan.');
    }
    const leave = beforeSnapshot.data()!;
    const period = String(leave.period || '');
    const category = String(leave.category || '').toUpperCase();
    const employeeId = String(leave.employeeId || '');
    const date = String(leave.date || '');
    const reportType =
      leave.reportType === 'scan'
        ? 'scan'
        : leave.reportType === 'izin_resmi' ||
            leave.leaveType === PEKARYA_OFFICIAL_LEAVE_TYPE
            ? 'izin_resmi'
            : '';
    const requestedReportType =
      action === 'change_type' ? String(body.reportType || '') : '';
    if (
      !/^\d{4}-\d{2}$/.test(period) ||
      period < ATTENDANCE_PAYROLL_START_PERIOD ||
      !isPekaryaOfficialLeaveCategory(category) ||
      !reportType
    ) {
      throw new HttpError(409, 'Data periode, kategori, atau jenis pengajuan tidak valid.');
    }
    if (
      action === 'change_type' &&
      requestedReportType !== 'scan' &&
      requestedReportType !== 'izin_resmi'
    ) {
      throw new HttpError(400, 'Jenis pengajuan presensi baru tidak valid.');
    }
    if (
      actor.role === 'satker_head' &&
      !actor.permittedCategories
        .map((item) => item.trim().toUpperCase())
        .includes(category)
    ) {
      throw new HttpError(403, 'Anda tidak memiliki akses ke kategori pengajuan ini.');
    }
    let scanIn: string | null = null;
    let scanOut: string | null = null;
    if (action !== 'change_type' && reportType === 'scan') {
      scanIn = normalizeAttendanceTime(leave.scanIn);
      scanOut = normalizeAttendanceTime(leave.scanOut);
      if (!scanIn || !scanOut || !isValidAttendanceScanRange(scanIn, scanOut)) {
        throw new HttpError(409, 'Data scan masuk atau scan pulang tidak valid.');
      }
    }
    try {
      assertDateOnly(date);
    } catch (error) {
      throw new HttpError(
        409,
        error instanceof Error ? error.message : 'Tanggal presensi tidak valid.',
      );
    }
    const window = pekaryaPayrollWindow(period);
    if (date < window.startsOn || date > window.endsOn) {
      throw new HttpError(409, 'Tanggal presensi berada di luar periode payroll.');
    }
    const employeeRef = adminDb.collection('Employees_BlueCollar').doc(employeeId);
    const employeeSnapshot = await employeeRef.get();
    const employee = employeeSnapshot.data();
    if (
      !employeeSnapshot.exists ||
      employee?.employment?.jobCategory !== category ||
      employee?.employment?.status !== 'active' ||
      employee?.flags?.isActive === false ||
      employee?.flags?.isPayrollEligible === false
    ) {
      throw new HttpError(409, 'Pegawai aktif pada kategori pengajuan tidak ditemukan.');
    }

    if (action === 'change_type') {
      const nextFields = normalizePekaryaAttendanceReportFields(
        requestedReportType,
        body.scanIn,
        body.scanOut,
      );
      if (!nextFields) {
        throw new HttpError(
          400,
          'Scan masuk dan scan pulang wajib valid untuk Koreksi Scan.',
        );
      }

      const currentScanIn =
        reportType === 'scan' ? normalizeAttendanceTime(leave.scanIn) : null;
      const currentScanOut =
        reportType === 'scan' ? normalizeAttendanceTime(leave.scanOut) : null;
      if (
        reportType === nextFields.reportType &&
        (nextFields.reportType === 'izin_resmi' ||
          (currentScanIn === nextFields.scanIn && currentScanOut === nextFields.scanOut))
      ) {
        throw new HttpError(409, 'Jenis ajuan dan jam scan sudah sama.');
      }

      const idempotencyRef = adminDb
        .collection('FinancialIdempotencyKeys')
        .doc(`${actor.uid}__${requestId}`);
      const slipRef = adminDb
        .collection('PayrollSlipStates')
        .doc(`${period.replace('-', '_')}_${employeeId}`);
      const requestHash = stableHash({
        officialLeaveRequestId,
        action,
        currentReportType: reportType,
        reportType: nextFields.reportType,
        scanIn: nextFields.scanIn,
        scanOut: nextFields.scanOut,
        requestId,
        reason,
        expectedRevision,
      });
      const result = await adminDb.runTransaction(async (transaction) => {
        const [latestLeave, periodSnapshot, slipSnapshot, idempotencySnapshot] =
          await Promise.all([
            transaction.get(leaveRef),
            transaction.get(adminDb.collection('PayrollPeriods').doc(period)),
            transaction.get(slipRef),
            transaction.get(idempotencyRef),
          ]);
        if (idempotencySnapshot.exists) {
          if (idempotencySnapshot.data()?.requestHash !== requestHash) {
            throw new HttpError(409, 'requestId sudah digunakan untuk perubahan lain.');
          }
          return {
            id: officialLeaveRequestId,
            revision: Number(
              idempotencySnapshot.data()?.revision || expectedRevision,
            ),
            status: idempotencySnapshot.data()?.status,
            reportType: idempotencySnapshot.data()?.reportType,
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
        const current = latestLeave.data();
        if (!current) {
          throw new HttpError(404, 'Pengajuan izin resmi tidak ditemukan.');
        }
        if (Number(current.revision || 0) !== expectedRevision) {
          throw new HttpError(409, 'Pengajuan telah berubah. Muat ulang sebelum mengubah jenis.');
        }
        if (current.status !== 'pending') {
          throw new HttpError(
            409,
            'Jenis ajuan hanya dapat diubah saat pengajuan masih menunggu keputusan.',
          );
        }
        const currentReportType =
          current.reportType === 'scan' ? 'scan' : 'izin_resmi';
        const currentScanIn =
          currentReportType === 'scan'
            ? normalizeAttendanceTime(current.scanIn)
            : null;
        const currentScanOut =
          currentReportType === 'scan'
            ? normalizeAttendanceTime(current.scanOut)
            : null;
        if (
          currentReportType === nextFields.reportType &&
          (nextFields.reportType === 'izin_resmi' ||
            (currentScanIn === nextFields.scanIn &&
              currentScanOut === nextFields.scanOut))
        ) {
          throw new HttpError(409, 'Jenis ajuan dan jam scan sudah sama.');
        }

        const revision = expectedRevision + 1;
        const now = admin.firestore.FieldValue.serverTimestamp();
        const after = {
          ...current,
          status: current.status,
          reportType: nextFields.reportType,
          leaveType: nextFields.leaveType,
          scanIn: nextFields.scanIn,
          scanOut: nextFields.scanOut,
          revision,
          typeChangedAt: now,
          typeChangedBy: actor.uid,
          typeChangeReason: reason,
          updatedAt: now,
        };
        transaction.set(leaveRef, after);
        transaction.create(
          adminDb
            .collection(PEKARYA_OFFICIAL_LEAVE_REVISIONS_COLLECTION)
            .doc(`${officialLeaveRequestId}__r${revision}`),
          {
            officialLeaveRequestId,
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
            action: 'PEKARYA_ATTENDANCE_REQUEST_TYPE_CHANGED',
            entityType: 'PekaryaOfficialLeaveRequest',
            entityId: officialLeaveRequestId,
            requestId,
            reason,
            before: current,
            after,
            metadata: {
              category,
              employeeId,
              date,
              previousReportType: currentReportType,
              reportType: nextFields.reportType,
              attendanceCorrection: false,
            },
          }),
        );
        transaction.create(idempotencyRef, {
          actorUid: actor.uid,
          requestId,
          requestHash,
          entityType: 'PekaryaOfficialLeaveRequest',
          entityId: officialLeaveRequestId,
          revision,
          status: after.status,
          reportType: nextFields.reportType,
          createdAt: now,
        });
        return {
          id: officialLeaveRequestId,
          revision,
          status: after.status,
          reportType: nextFields.reportType,
          idempotent: false,
        };
      });
      return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
    }

    const nipy = resolveEmployeeAttendanceNipy(employee || {});
    if (action === 'approve' && !nipy) {
      throw new HttpError(409, 'NIPY pegawai wajib dilengkapi sebelum izin disetujui.');
    }

    const view = await buildPekaryaAttendanceView(period, category);
    const employeeView = view.employees.find(
      (candidate) => candidate.employeeId === employeeId,
    );
    if (!employeeView) {
      throw new HttpError(409, 'Pegawai tidak tersedia dalam presensi Pekarya periode ini.');
    }
    const currentDay = employeeView?.days.find((day) => day.date === date) || null;
    if (
      action === 'approve' &&
      (reportType === 'scan' ? currentDay?.completePunch : currentDay?.present)
    ) {
      throw new HttpError(
        409,
        reportType === 'scan'
          ? 'Presensi lengkap sudah tercatat pada tanggal ini. Selesaikan koreksi presensi sebelum menyetujui laporan.'
          : 'Pegawai sudah tercatat hadir pada tanggal ini. Selesaikan koreksi presensi sebelum menyetujui izin.',
      );
    }

    const headRef = adminDb
      .collection(PEKARYA_CORRECTION_HEADS_COLLECTION)
      .doc(attendanceCorrectionHeadId(period, employeeId, date));
    const correctionRef = adminDb.collection(PEKARYA_CORRECTIONS_COLLECTION).doc();
    const idempotencyRef = adminDb
      .collection('FinancialIdempotencyKeys')
      .doc(`${actor.uid}__${requestId}`);
    const publicationRef = adminDb
      .collection(PEKARYA_PUBLICATIONS_COLLECTION)
      .doc(pekaryaPublicationId(period, category));
    const uraianRef = adminDb
      .collection('UraianGaji')
      .doc(`${period.replace('-', '_')}_${category}`);
    const slipRef = adminDb
      .collection('PayrollSlipStates')
      .doc(`${period.replace('-', '_')}_${employeeId}`);
    const importRef = adminDb
      .collection(ATTENDANCE_IMPORTS_COLLECTION)
      .doc(period);
    const requestHash = stableHash({
      officialLeaveRequestId,
      reportType,
      scanIn,
      scanOut,
      action,
      requestId,
      reason,
      expectedRevision,
      importRevisionId: view.importRevisionId,
      calendarRevision: view.calendarRevision,
    });
    const result = await adminDb.runTransaction(async (transaction) => {
      const [
        latestLeave,
        headSnapshot,
        periodSnapshot,
        publicationSnapshot,
        uraianSnapshot,
        slipSnapshot,
        importSnapshot,
        idempotencySnapshot,
      ] = await Promise.all([
        transaction.get(leaveRef),
        transaction.get(headRef),
        transaction.get(adminDb.collection('PayrollPeriods').doc(period)),
        transaction.get(publicationRef),
        transaction.get(uraianRef),
        transaction.get(slipRef),
        transaction.get(importRef),
        transaction.get(idempotencyRef),
      ]);
      if (idempotencySnapshot.exists) {
        if (idempotencySnapshot.data()?.requestHash !== requestHash) {
          throw new HttpError(409, 'requestId sudah digunakan untuk keputusan lain.');
        }
        return {
          id: officialLeaveRequestId,
          revision: Number(idempotencySnapshot.data()?.revision || expectedRevision),
          status: idempotencySnapshot.data()?.status,
          idempotent: true,
        };
      }
      assertPeriodAcceptsInput(
        periodSnapshot.data(),
        'Periode payroll sudah ditutup; keputusan izin tidak dapat diubah.',
      );
      if (
        String(importSnapshot.data()?.activeRevisionId || '') !==
        view.importRevisionId
      ) {
        throw new HttpError(
          409,
          'Revisi import presensi berubah. Muat ulang sebelum memutuskan.',
        );
      }
      const currentCalendarRevision = Number(
        (periodSnapshot.data()?.workCalendar as { revision?: number } | undefined)
          ?.revision || 1,
      );
      if (currentCalendarRevision !== view.calendarRevision) {
        throw new HttpError(
          409,
          'Kalender kerja berubah. Muat ulang sebelum memutuskan.',
        );
      }
      if (
        slipSnapshot.exists &&
        isImmutablePayrollStatus(slipSnapshot.data()?.status)
      ) {
        throw new HttpError(
          409,
          'Slip pegawai sudah immutable; gunakan koreksi finansial.',
        );
      }
      const current = latestLeave.data();
      if (!current) throw new HttpError(404, 'Pengajuan izin resmi tidak ditemukan.');
      if (Number(current.revision || 0) !== expectedRevision) {
        throw new HttpError(409, 'Pengajuan telah berubah. Muat ulang sebelum memutuskan.');
      }
      if (current.status !== 'pending') {
        throw new HttpError(409, 'Pengajuan ini sudah pernah diputuskan.');
      }
      const headData = headSnapshot.data();
      const headHasCompletePunch =
        headData?.present === true &&
        typeof headData?.scanIn === 'string' &&
        typeof headData?.scanOut === 'string';
      if (
        action === 'approve' &&
        (reportType === 'scan'
          ? headHasCompletePunch
          : headData?.present === true)
      ) {
        throw new HttpError(
          409,
          reportType === 'scan'
            ? 'Tanggal ini sudah memiliki koreksi presensi lengkap. Selesaikan koreksi tersebut terlebih dahulu.'
            : 'Tanggal ini sudah memiliki koreksi hadir. Selesaikan koreksi tersebut terlebih dahulu.',
        );
      }

      const approving = action === 'approve';
      const revision = expectedRevision + 1;
      const now = admin.firestore.FieldValue.serverTimestamp();
      const premium = isPremiumAttendanceDate(date, new Set(view.premiumDates));
      const approvedPayType = premium ? 'Jumat & Libur' : 'Harian';
      // An approved report is paid for the hours it grants: the submitted scan
      // pair, or the fixed 07:30–14:00 window an official leave stands for.
      const approvedScanIn =
        reportType === 'scan' ? scanIn : PEKARYA_OFFICIAL_LEAVE_SCAN_IN;
      const approvedScanOut =
        reportType === 'scan' ? scanOut : PEKARYA_OFFICIAL_LEAVE_SCAN_OUT;
      const approvedAmount = pekaryaAttendanceAmount(
        approvedScanIn,
        approvedScanOut,
        premium,
      );
      const after = {
        ...current,
        status: approving ? 'approved' : 'declined',
        revision,
        decisionReason: reason,
        decidedAt: now,
        decidedBy: actor.uid,
        decidedByName: actor.displayName,
        decisionAction: action,
        approvedPayType: approving ? approvedPayType : null,
        approvedAmount: approving ? approvedAmount : 0,
        updatedAt: now,
      };
      transaction.set(leaveRef, after);
      transaction.create(
        adminDb
          .collection(PEKARYA_OFFICIAL_LEAVE_REVISIONS_COLLECTION)
          .doc(`${officialLeaveRequestId}__r${revision}`),
        {
          officialLeaveRequestId,
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
        const correction =
          reportType === 'scan'
            ? scanAttendanceCorrection(scanIn!, scanOut!)
            : officialLeaveAttendanceCorrection();
        const record = {
          period,
          category,
          employeeId,
          employeeName: String(employee.name || ''),
          nipy,
          date,
          revision: Number(headSnapshot.data()?.revision || 0) + 1,
          supersedesCorrectionId: headSnapshot.data()?.correctionId || null,
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
          importRevisionId: view.importRevisionId,
          calendarRevision: view.calendarRevision,
          reason: `${reportType === 'scan' ? 'Laporan presensi' : 'Izin resmi'}: ${String(current.reason || '')}\nKeputusan: ${reason}`,
          actorUid: actor.uid,
          actorName: actor.displayName,
          sourceType:
            reportType === 'scan'
              ? 'pekarya_scan_report'
              : PEKARYA_OFFICIAL_LEAVE_TYPE,
          sourceId: officialLeaveRequestId,
          createdAt: now,
        };
        transaction.create(correctionRef, record);
        transaction.set(headRef, {
          ...record,
          ...correction,
          correctionId: correctionRef.id,
          updatedAt: now,
        });

        if (
          publicationSnapshot.data()?.state === 'published' &&
          publicationSnapshot.data()?.stale !== true
        ) {
          if (!uraianSnapshot.exists) {
            throw new HttpError(
              409,
              'Rekap Uraian publikasi tidak ditemukan. Publikasikan ulang kategori.',
            );
          }
          const oldPayType = currentDay?.present ? currentDay.payType : null;
          let nextHarian = employeeView?.harianCount || 0;
          let nextPremium = employeeView?.jumatLiburCount || 0;
          let nextHarianAmount = employeeView?.harianAmount || 0;
          let nextPremiumAmount = employeeView?.jumatLiburAmount || 0;
          const oldDayAmount = currentDay?.amount || 0;
          if (oldPayType === 'Harian') {
            nextHarian = Math.max(0, nextHarian - 1);
            nextHarianAmount = Math.max(0, nextHarianAmount - oldDayAmount);
          }
          if (oldPayType === 'Jumat & Libur') {
            nextPremium = Math.max(0, nextPremium - 1);
            nextPremiumAmount = Math.max(0, nextPremiumAmount - oldDayAmount);
          }
          if (premium) {
            nextPremium += 1;
            nextPremiumAmount += approvedAmount;
          } else {
            nextHarian += 1;
            nextHarianAmount += approvedAmount;
          }
          const entries = {
            ...(uraianSnapshot.data()?.entries as Record<
              string,
              Record<string, unknown>
            >),
          };
          const existingEntry = entries[employeeId] || {};
          const existingValues =
            existingEntry.values && typeof existingEntry.values === 'object'
              ? (existingEntry.values as Record<string, unknown>)
              : {};
          const existingCounts =
            existingEntry.counts && typeof existingEntry.counts === 'object'
              ? (existingEntry.counts as Record<string, unknown>)
              : {};
          const nextPublicationRevision =
            Number(publicationSnapshot.data()?.publicationRevision || 0) + 1;
          entries[employeeId] = {
            ...existingEntry,
            employeeId,
            name: String(employee.name || ''),
            values: {
              ...existingValues,
              harian: nextHarianAmount,
              jumatLibur: nextPremiumAmount,
            },
            counts: {
              ...existingCounts,
              harian: nextHarian,
              jumatLibur: nextPremium,
            },
            attendanceSource: {
              importRevisionId: view.importRevisionId,
              calendarRevision: view.calendarRevision,
              publicationRevision: nextPublicationRevision,
            },
          };
          const oldAmount = employeeView?.totalAmount || 0;
          const nextAmount = nextHarianAmount + nextPremiumAmount;
          transaction.update(uraianRef, {
            entries,
            attendancePublication: {
              importRevisionId: view.importRevisionId,
              calendarRevision: view.calendarRevision,
              publicationRevision: nextPublicationRevision,
            },
            updatedAt: now,
          });
          transaction.update(publicationRef, {
            publicationRevision: nextPublicationRevision,
            'totals.harian':
              Number(publicationSnapshot.data()?.totals?.harian || 0) -
              (employeeView?.harianCount || 0) +
              nextHarian,
            'totals.jumatLibur':
              Number(publicationSnapshot.data()?.totals?.jumatLibur || 0) -
              (employeeView?.jumatLiburCount || 0) +
              nextPremium,
            'totals.amount':
              Number(publicationSnapshot.data()?.totals?.amount || 0) -
              oldAmount +
              nextAmount,
            correctedAt: now,
            correctedBy: actor.uid,
            stale: false,
            updatedAt: now,
          });
        }
      }

      transaction.create(
        newFinancialAuditRef(),
        buildFinancialAuditRecord(actor, {
          action: approving
            ? `PEKARYA_${reportType === 'scan' ? 'ATTENDANCE' : 'OFFICIAL_LEAVE'}_APPROVED`
            : `PEKARYA_${reportType === 'scan' ? 'ATTENDANCE' : 'OFFICIAL_LEAVE'}_DECLINED`,
          entityType:
            reportType === 'scan'
              ? 'PekaryaAttendanceRequest'
              : 'PekaryaOfficialLeaveRequest',
          entityId: officialLeaveRequestId,
          requestId,
          reason,
          before: current,
          after,
          metadata: {
            category,
            employeeId,
            date,
            amount: approving ? approvedAmount : 0,
            attendanceCorrection: approving,
          },
        }),
      );
      transaction.create(idempotencyRef, {
        actorUid: actor.uid,
        requestId,
        requestHash,
        entityType:
          reportType === 'scan'
            ? 'PekaryaAttendanceRequest'
            : 'PekaryaOfficialLeaveRequest',
        entityId: officialLeaveRequestId,
        revision,
        status: after.status,
        createdAt: now,
      });
      return {
        id: officialLeaveRequestId,
        revision,
        status: after.status,
        amount: approving ? approvedAmount : 0,
        idempotent: false,
      };
    });
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
