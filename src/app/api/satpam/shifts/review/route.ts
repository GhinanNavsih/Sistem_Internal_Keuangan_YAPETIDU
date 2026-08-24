import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import {
  activityReportId,
  analyzeSatpamShiftSubmission,
  assertRequestId,
  getRegularSatpamPayType,
  getShiftIsoBounds,
  guardDutyIndexId,
  hasSatpamShiftEnded,
  isImmutablePayrollStatus,
  payrollPeriodForDutyDate,
  SATPAM_POSTS,
  SATPAM_RATES,
  SHIFT_TIMES,
  type SatpamPostId,
  type SatpamShiftName,
  SatpamPayType,
} from '@/lib/payroll/domain';
import { getSatpamShiftForTeam } from '@/utils/satpamRotation';
import { periodCalendarFromData } from '@/lib/payroll/calendar';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '@/lib/server/audit';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';
import {
  assertPeriodAcceptsInput,
  buildPeriodMaterialization,
} from '@/lib/server/payrollPeriod';
import {
  classifySatpamDutyAssignments,
  isSatpamDutyPlanRequired,
  satpamDutyKey,
  satpamDutyPlanId,
  type SatpamDutyPlanDay,
} from '@/lib/payroll/satpamDutyPlan';
import { satpamAttendanceReportType } from '@/lib/payroll/satpamAttendance';
import {
  SATPAM_ABSENCE_REQUESTS_COLLECTION,
  SATPAM_DUTY_PLANS_COLLECTION,
  syncSatpamDutyReconciliation,
} from '@/lib/server/satpamDutyPlan';

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

interface AuditorEditAssignment {
  reportId?: string;
  assignmentKind: 'primary' | 'extra';
  postId: SatpamPostId;
  employeeId: string;
  shiftType: Exclude<SatpamPayType, 'Off-Duty'>;
  coveredEmployeeId?: string;
  overtimeReason?: string;
}

interface AuditorEditCommand {
  requestId: string;
  occurrenceId: string;
  expectedRevision: number;
  dutyDate: string;
  shiftName: SatpamShiftName;
  reason: string;
  assignments: AuditorEditAssignment[];
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
  if (reason.length > 500) {
    throw new HttpError(400, 'Catatan audit maksimal 500 karakter.');
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
    if (decision.action === 'decline' && itemReason.length > 500) {
      throw new HttpError(400, 'Alasan penolakan maksimal 500 karakter.');
    }
    if (decision.action !== 'decline' && itemReason.length > 500) {
      throw new HttpError(400, 'Alasan penolakan maksimal 500 karakter.');
    }
    return { reportId: decision.reportId, action: decision.action, reason: itemReason };
  });
  if (new Set(decisions.map((decision) => decision.reportId)).size !== decisions.length) {
    throw new HttpError(400, 'Penugasan audit tidak boleh duplikat.');
  }
  if (
    decisions.some(
      (decision) =>
        decision.action === 'decline' &&
        (decision.reason || reason).trim().length < 8,
    )
  ) {
    throw new HttpError(400, 'Alasan penolakan wajib diisi sekurang-kurangnya 8 karakter.');
  }
  return {
    requestId: value.requestId,
    occurrenceId: value.occurrenceId,
    reason,
    decisions,
  };
}

function parseAuditorEditCommand(raw: unknown): AuditorEditCommand {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new HttpError(400, 'Perubahan auditor tidak valid.');
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
    typeof value.occurrenceId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,180}$/.test(value.occurrenceId) ||
    !Number.isInteger(value.expectedRevision) ||
    Number(value.expectedRevision) < 1
  ) {
    throw new HttpError(400, 'ID shift atau revisi auditor tidak valid.');
  }
  if (typeof value.dutyDate !== 'string') {
    throw new HttpError(400, 'Tanggal dinas wajib diisi.');
  }
  try {
    const [year, month, day] = value.dutyDate.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(value.dutyDate) ||
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      throw new Error('invalid');
    }
  } catch {
    throw new HttpError(400, 'Tanggal dinas tidak valid.');
  }
  if (!['Pagi', 'Sore', 'Malam'].includes(String(value.shiftName))) {
    throw new HttpError(400, 'Nama shift tidak valid.');
  }
  const reason = typeof value.reason === 'string' ? value.reason.trim() : '';
  if (reason.length < 8 || reason.length > 500) {
    throw new HttpError(400, 'Alasan edit auditor wajib diisi antara 8 dan 500 karakter.');
  }
  if (!Array.isArray(value.assignments) || value.assignments.length < 1 || value.assignments.length > 20) {
    throw new HttpError(400, 'Edit auditor harus memuat 1 sampai 20 penugasan.');
  }
  const validPosts = new Set<string>(SATPAM_POSTS.map((post) => post.id));
  const validPayTypes = new Set<string>([
    'Harian',
    'Jumat & Libur',
    'Lembur Sendiri',
    'Lembur Cover',
  ]);
  const assignments = value.assignments.map((rawAssignment) => {
    if (!rawAssignment || typeof rawAssignment !== 'object' || Array.isArray(rawAssignment)) {
      throw new HttpError(400, 'Baris edit auditor tidak valid.');
    }
    const assignment = rawAssignment as Record<string, unknown>;
    if (
      assignment.reportId !== undefined &&
      (typeof assignment.reportId !== 'string' ||
        !/^[A-Za-z0-9_-]{1,180}$/.test(assignment.reportId))
    ) {
      throw new HttpError(400, 'ID penugasan edit tidak valid.');
    }
    if (
      !['primary', 'extra'].includes(String(assignment.assignmentKind)) ||
      typeof assignment.postId !== 'string' ||
      !validPosts.has(assignment.postId) ||
      typeof assignment.employeeId !== 'string' ||
      !assignment.employeeId.trim() ||
      typeof assignment.shiftType !== 'string' ||
      !validPayTypes.has(assignment.shiftType)
    ) {
      throw new HttpError(400, 'Pos, petugas, atau kategori upah edit tidak valid.');
    }
    return {
      ...(typeof assignment.reportId === 'string'
        ? { reportId: assignment.reportId }
        : {}),
      assignmentKind: assignment.assignmentKind as 'primary' | 'extra',
      postId: assignment.postId as SatpamPostId,
      employeeId: assignment.employeeId.trim(),
      shiftType: assignment.shiftType as Exclude<SatpamPayType, 'Off-Duty'>,
      ...(typeof assignment.coveredEmployeeId === 'string' &&
      assignment.coveredEmployeeId.trim()
        ? { coveredEmployeeId: assignment.coveredEmployeeId.trim() }
        : {}),
      ...(typeof assignment.overtimeReason === 'string'
        ? { overtimeReason: assignment.overtimeReason.trim().slice(0, 500) }
        : {}),
    };
  });
  const providedReportIds = assignments.flatMap((assignment) =>
    assignment.reportId ? [assignment.reportId] : [],
  );
  if (new Set(providedReportIds).size !== providedReportIds.length) {
    throw new HttpError(400, 'ID penugasan edit tidak boleh duplikat.');
  }
  return {
    requestId: value.requestId,
    occurrenceId: value.occurrenceId,
    expectedRevision: Number(value.expectedRevision),
    dutyDate: value.dutyDate,
    shiftName: value.shiftName as SatpamShiftName,
    reason,
    assignments,
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
          period: String(occurrenceSnapshot.data()?.payrollPeriod || ''),
          idempotent: true,
        };
      }
      if (!occurrenceSnapshot.exists) {
        throw new HttpError(404, 'Shift tidak ditemukan.');
      }
      const occurrence = occurrenceSnapshot.data()!;
      if (!['pending_review', 'under_review'].includes(String(occurrence.status))) {
        throw new HttpError(409, 'Shift ini sudah pernah diaudit atau memakai alur lama.');
      }
      if (
        occurrence.reviewOwnerUid &&
        occurrence.reviewOwnerUid !== actor.uid &&
        actor.role !== 'super_admin'
      ) {
        throw new HttpError(409, 'Shift ini sedang ditangani oleh auditor lain.');
      }
      const expectedReportIds = Array.isArray(occurrence.pendingReportIds)
        ? occurrence.pendingReportIds.filter(
            (reportId: unknown): reportId is string =>
              typeof reportId === 'string',
          )
        : Array.isArray(occurrence.reportIds)
          ? occurrence.reportIds.filter(
            (reportId: unknown): reportId is string =>
              typeof reportId === 'string',
          )
          : [];
      const decidedReportIds = new Set(
        command.decisions.map((decision) => decision.reportId),
      );
      if (
        expectedReportIds.length !== decidedReportIds.size ||
        expectedReportIds.some((reportId: string) => !decidedReportIds.has(reportId))
      ) {
        throw new HttpError(
          409,
          'Semua penugasan yang masih menunggu harus diberi keputusan.',
        );
      }
      const hasApprovals = command.decisions.some(
        (decision) => decision.action === 'approve',
      );
      if (
        hasApprovals &&
        !hasSatpamShiftEnded(
          String(occurrence.dutyDate || ''),
          String(occurrence.reportedShiftName || occurrence.shiftName || '') as SatpamShiftName,
        )
      ) {
        throw new HttpError(
          409,
          'Waktu dinas belum selesai. Laporan belum dapat disetujui.',
        );
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
      const employeeRefs = reports.map((report) =>
        adminDb.collection('Employees_BlueCollar').doc(String(report.employeeId || '')),
      );
      const holidayRef = adminDb
        .collection('PayrollHolidayCalendars')
        .doc(String(occurrence.dutyDate || '').slice(0, 4));
      const guardIndexRefs = reports.map((report) =>
        adminDb
          .collection('GuardDutyIndexes')
          .doc(
            guardDutyIndexId(
              String(occurrence.dutyDate || ''),
              String(occurrence.reportedShiftName || occurrence.shiftName || '') as SatpamShiftName,
              String(report.employeeId || ''),
            ),
          ),
      );
      const dutyPlanRef = adminDb
        .collection(SATPAM_DUTY_PLANS_COLLECTION)
        .doc(
          String(occurrence.dutyPlanId || '') ||
            satpamDutyPlanId(period, String(occurrence.teamId || '')),
        );
      const absenceRefs = reports.map((report) =>
        adminDb
          .collection(SATPAM_ABSENCE_REQUESTS_COLLECTION)
          .doc(
            satpamDutyKey(
              String(report.employeeId || ''),
              String(occurrence.dutyDate || ''),
            ).replaceAll('-', ''),
          ),
      );
      const secondarySnapshots = await Promise.all([
        transaction.get(periodRef),
        ...slipRefs.map((reference) => transaction.get(reference)),
        ...employeeRefs.map((reference) => transaction.get(reference)),
        transaction.get(holidayRef),
        ...guardIndexRefs.map((reference) => transaction.get(reference)),
        transaction.get(dutyPlanRef),
        ...absenceRefs.map((reference) => transaction.get(reference)),
      ]);
      const periodSnapshot = secondarySnapshots[0];
      const slipSnapshots = secondarySnapshots.slice(1, 1 + reports.length);
      const employeeSnapshots = secondarySnapshots.slice(
        1 + reports.length,
        1 + reports.length * 2,
      );
      const holidaySnapshot = secondarySnapshots[1 + reports.length * 2];
      const guardIndexStart = 2 + reports.length * 2;
      const guardIndexSnapshots = secondarySnapshots.slice(
        guardIndexStart,
        guardIndexStart + reports.length,
      );
      const dutyPlanSnapshot =
        secondarySnapshots[guardIndexStart + reports.length];
      const absenceSnapshots = secondarySnapshots.slice(
        guardIndexStart + reports.length + 1,
      );

      assertPeriodAcceptsInput(periodSnapshot.data());
      if (
        hasApprovals &&
        isSatpamDutyPlanRequired(period, periodSnapshot.data() || null)
      ) {
        if (!dutyPlanSnapshot.exists) {
          throw new HttpError(
            409,
            'Rencana dinas belum tersedia. Laporan boleh disimpan tetapi belum dapat disetujui.',
          );
        }
        const latestPlanData = dutyPlanSnapshot.data()!;
        const occurrenceDateIsStale =
          Array.isArray(latestPlanData.staleDates) &&
          latestPlanData.staleDates.includes(occurrence.dutyDate);
        const latestPlanDay = Array.isArray(latestPlanData.generatedDays)
          ? latestPlanData.generatedDays.find(
              (day: SatpamDutyPlanDay) =>
                day.dutyDate === occurrence.dutyDate,
            )
          : null;
        const plannedDayChanged =
          JSON.stringify(latestPlanDay || null) !==
          JSON.stringify(occurrence.plannedAssignmentSnapshot || null);
        if (
          Number(latestPlanData.revision || 0) !==
            Number(occurrence.dutyPlanRevision || 0) &&
          (occurrenceDateIsStale || plannedDayChanged)
        ) {
          throw new HttpError(
            409,
            'Rencana dinas telah berubah. Edit auditor diperlukan sebelum persetujuan.',
          );
        }
      }
      const annualHolidayDates =
        holidaySnapshot?.exists && Array.isArray(holidaySnapshot.data()?.dates)
          ? holidaySnapshot
              .data()!
              .dates.filter((date: unknown): date is string => typeof date === 'string')
          : [];
      const periodCalendar = periodCalendarFromData(
        period,
        periodSnapshot.exists ? periodSnapshot.data()! : null,
        annualHolidayDates,
      );
      // An approval may be the first money committed against a month that was
      // never explicitly opened. Freeze its calendar before rating the shift.
      if (hasApprovals) {
        const periodMaterialization = buildPeriodMaterialization({
          period,
          periodData: periodSnapshot.exists ? periodSnapshot.data()! : null,
          annualDates: annualHolidayDates,
          actorUid: actor.uid,
          reason: `Kalender periode dibekukan saat persetujuan shift Satpam ${period}`,
        });
        if (periodMaterialization) {
          transaction.set(periodRef, periodMaterialization, { merge: true });
        }
      }
      if (
        hasApprovals &&
        Number(occurrence.calendarRevision || periodCalendar.revision) !==
          periodCalendar.revision
      ) {
        throw new HttpError(
          409,
          'Kalender periode telah berubah. Simpan ulang koreksi auditor sebelum menyetujui.',
        );
      }
      const approvedEmployeeIds = reports.flatMap((report, index) =>
        command.decisions[index].action === 'approve'
          ? [String(report.employeeId || '')]
          : [],
      );
      if (new Set(approvedEmployeeIds).size !== approvedEmployeeIds.length) {
        throw new HttpError(
          409,
          'Satu petugas tidak boleh menerima dua pembayaran pada shift yang sama. Edit atau tolak salah satu penugasan.',
        );
      }
      const anomalyCodes = Array.isArray(occurrence.anomalyCodes)
        ? occurrence.anomalyCodes.filter((code: unknown): code is string => typeof code === 'string')
        : [];
      const financiallyBlockingPlanAnomaly = anomalyCodes.find((code) =>
        [
          'DUTY_PLAN_MISSING',
          'DUTY_PLAN_STALE',
          'EXTRA_NOT_OFF_DUTY',
          'EXTRA_WITH_INCOMPLETE_PRIMARY_ROSTER',
          'ABSENCE_WORK_CONFLICT',
          'DUTY_PLAN_CHANGED_AFTER_REPORT',
        ].includes(code),
      );
      if (hasApprovals && financiallyBlockingPlanAnomaly) {
        throw new HttpError(
          409,
          `Klasifikasi rencana dinas belum selesai (${financiallyBlockingPlanAnomaly}). Gunakan Edit Auditor.`,
        );
      }

      const now = admin.firestore.FieldValue.serverTimestamp();
      let approvedCount = 0;
      let declinedCount = 0;
      const existingApprovedCount = Number(occurrence.approvedAssignmentCount || 0);
      const existingDeclinedCount = Number(occurrence.declinedAssignmentCount || 0);

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
        // Fees are server-derived from the rate table, never client supplied.
        const payType = String(before.shiftType || '') as SatpamPayType;
        const rate = SATPAM_RATES[payType];
        const isKetuaPrimary =
          before.assignmentKind !== 'extra' &&
          String(before.employeeId || '') === String(occurrence.ketuaShiftId || '');
        const isDesignatedPos9Primary =
          before.assignmentKind !== 'extra' &&
          String(before.postId || '') === 'Pos 9' &&
          ['cross_team_pos9', 'designated_pos9'].includes(
            String(before.scheduleRelation || ''),
          );
        const isSelfPayAllowed = isKetuaPrimary || isDesignatedPos9Primary;
        if (decision.action === 'approve') {
          const employee = employeeSnapshots[index]?.data();
          if (
            !employeeSnapshots[index]?.exists ||
            employee?.employment?.jobCategory !== 'SATPAM' ||
            (employee?.employment?.status !== 'active' &&
              employee?.flags?.isActive !== true)
          ) {
            throw new HttpError(
              409,
              `Status aktif atau kategori ${String(before.employeeName || before.employeeId)} belum sesuai.`,
            );
          }
          if (
            absenceSnapshots[index]?.data()?.status === 'approved' &&
            satpamAttendanceReportType(
              absenceSnapshots[index]?.data() || {},
            ) === 'izin_resmi'
          ) {
            throw new HttpError(
              409,
              `${String(before.employeeName || before.employeeId)} memiliki izin dibayar pada tanggal ini. Selesaikan konflik izin terlebih dahulu.`,
            );
          }
          if (
            slipSnapshots[index]?.exists &&
            isImmutablePayrollStatus(slipSnapshots[index]?.data()?.status)
          ) {
            throw new HttpError(409, 'Slip pegawai sudah dikunci; gunakan alur koreksi.');
          }
          if (typeof rate !== 'number') {
            throw new HttpError(409, `Tipe upah ${payType} tidak dikenal.`);
          }
          if (
            (before.assignmentKind === 'extra' &&
              payType !== 'Lembur Sendiri') ||
            (before.assignmentKind !== 'extra' &&
              (payType === 'Off-Duty' ||
                (payType === 'Lembur Sendiri' && !isSelfPayAllowed)))
          ) {
            throw new HttpError(
              409,
              `Klasifikasi upah ${String(before.employeeName || '')} belum sesuai jenis penugasannya.`,
            );
          }
          if (
            payType === 'Lembur Cover' &&
            !String(before.coveredEmployeeId || '').trim()
          ) {
            throw new HttpError(
              409,
              `Petugas yang digantikan oleh ${String(before.employeeName || '')} belum ditentukan.`,
            );
          }
        }
        if (
          decision.action === 'approve' &&
          before.assignmentKind !== 'extra' &&
          (payType === 'Harian' || payType === 'Jumat & Libur')
        ) {
          const holidayDates = new Set<string>(
            Array.isArray(holidaySnapshot.data()?.dates)
              ? holidaySnapshot
                  .data()!
                  .dates.filter(
                    (date: unknown): date is string => typeof date === 'string',
                  )
              : [],
          );
          const expectedPayType = getRegularSatpamPayType(
            String(occurrence.dutyDate || ''),
            holidayDates,
          );
          if (payType !== expectedPayType && !isSelfPayAllowed) {
            throw new HttpError(
              409,
              `Kategori upah ${String(before.employeeName || '')} tidak sesuai kalender. Gunakan Edit Auditor.`,
            );
          }
        }
        if (
          decision.action === 'approve' &&
          guardIndexSnapshots[index]?.exists &&
          guardIndexSnapshots[index]?.data()?.occurrenceId !== command.occurrenceId
        ) {
          throw new HttpError(
            409,
            `${String(before.employeeName || before.employeeId)} sudah memiliki pembayaran pada shift yang sama.`,
          );
        }

        const after =
          decision.action === 'approve'
            ? {
                ...before,
                status: 'approved',
                fee: rate!,
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
          transaction.set(
            guardIndexRefs[index],
            {
              employeeId: before.employeeId,
              occurrenceId: command.occurrenceId,
              reportId: decision.reportId,
              dutyDate: occurrence.dutyDate,
              shiftName: occurrence.reportedShiftName || occurrence.shiftName,
              startsAt: occurrence.startsAt || before.startsAt || null,
              endsAt: occurrence.endsAt || before.endsAt || null,
              approvedAt: now,
            },
            { merge: true },
          );
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
              amount: rate!,
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

      const totalApprovedCount = existingApprovedCount + approvedCount;
      const totalDeclinedCount = existingDeclinedCount + declinedCount;
      transaction.update(occurrenceRef, {
        status: 'reviewed',
        reviewStatus:
          totalDeclinedCount === 0
            ? 'approved'
            : totalApprovedCount === 0
              ? 'declined'
              : 'partially_approved',
        pendingReportIds: [],
        pendingAssignmentCount: 0,
        approvedAssignmentCount: totalApprovedCount,
        declinedAssignmentCount: totalDeclinedCount,
        reviewedAt: now,
        reviewedBy: actor.uid,
        reviewedByRole: actor.role,
        auditorActionAt: occurrence.auditorActionAt || now,
        reviewOwnerUid: occurrence.reviewOwnerUid || actor.uid,
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
            approvedAssignmentCount: totalApprovedCount,
            declinedAssignmentCount: totalDeclinedCount,
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
        approvedCount: totalApprovedCount,
        declinedCount: totalDeclinedCount,
        createdAt: now,
      });

      return {
        occurrenceId: command.occurrenceId,
        approved: totalApprovedCount,
        declined: totalDeclinedCount,
        period,
        idempotent: false,
      };
    });

    if (result.period) {
      await syncSatpamDutyReconciliation(result.period, actor.uid);
    }
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['super_admin', 'satker_head']);
    if (actor.role === 'satker_head' && !actor.permittedCategories.includes('SATPAM')) {
      throw new HttpError(403, 'Anda tidak memiliki akses kategori SATPAM.');
    }
    const employeeSnapshot = await adminDb
      .collection('Employees_BlueCollar')
      .where('employment.jobCategory', '==', 'SATPAM')
      .get();
    const employees = employeeSnapshot.docs
      .map((snapshot) => {
        const data = snapshot.data();
        return {
          id: snapshot.id,
          name: String(data.name || snapshot.id),
          isActive:
            data.employment?.status === 'active' || data.flags?.isActive === true,
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name, 'id'));
    return Response.json(
      { employees },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['super_admin', 'satker_head']);
    if (actor.role === 'satker_head' && !actor.permittedCategories.includes('SATPAM')) {
      throw new HttpError(403, 'Anda tidak memiliki akses kategori SATPAM.');
    }
    const command = parseAuditorEditCommand(await request.json());
    const requestHash = createHash('sha256')
      .update(JSON.stringify(command))
      .digest('hex');

    const result = await adminDb.runTransaction(async (transaction) => {
      const occurrenceRef = adminDb
        .collection('ShiftOccurrences')
        .doc(command.occurrenceId);
      const idempotencyRef = adminDb
        .collection('FinancialIdempotencyKeys')
        .doc(`${actor.uid}__${command.requestId}`);
      const [occurrenceSnapshot, idempotencySnapshot] = await Promise.all([
        transaction.get(occurrenceRef),
        transaction.get(idempotencyRef),
      ]);
      if (idempotencySnapshot.exists) {
        const previous = idempotencySnapshot.data()!;
        if (
          previous.requestHash !== requestHash ||
          previous.entityId !== command.occurrenceId
        ) {
          throw new HttpError(409, 'requestId sudah digunakan untuk edit berbeda.');
        }
        return {
          occurrenceId: command.occurrenceId,
          revision: Number(previous.revision || command.expectedRevision),
          anomalies: previous.anomalies || [],
          idempotent: true,
        };
      }
      if (!occurrenceSnapshot.exists) {
        throw new HttpError(404, 'Shift tidak ditemukan.');
      }
      const before = occurrenceSnapshot.data()!;
      // A 'reviewed' occurrence still accepts edits, but as a direct financial
      // correction (approved-in-place) rather than the pre-approval
      // delete-and-resubmit-as-pending flow below.
      const isApprovedEditBranch = before.status === 'reviewed';
      if (
        !isApprovedEditBranch &&
        !['pending_review', 'under_review'].includes(String(before.status))
      ) {
        throw new HttpError(409, 'Shift ini sudah selesai diaudit.');
      }
      if (
        before.reviewOwnerUid &&
        before.reviewOwnerUid !== actor.uid &&
        actor.role !== 'super_admin'
      ) {
        throw new HttpError(409, 'Shift ini sedang ditangani oleh auditor lain.');
      }
      if (Number(before.revision || 1) !== command.expectedRevision) {
        throw new HttpError(
          409,
          'Laporan telah berubah. Muat ulang sebelum menyimpan edit auditor.',
        );
      }

      const period = payrollPeriodForDutyDate(command.dutyDate);
      const periodRef = adminDb.collection('PayrollPeriods').doc(period);
      const holidayRef = adminDb
        .collection('PayrollHolidayCalendars')
        .doc(command.dutyDate.slice(0, 4));
      const teamRef = adminDb.collection('SatpamShiftTeams').doc(String(before.teamId || ''));
      const dutyPlanRef = adminDb
        .collection(SATPAM_DUTY_PLANS_COLLECTION)
        .doc(
          String(before.dutyPlanId || '') ||
            satpamDutyPlanId(period, String(before.teamId || '')),
        );
      const pos9PlansQuery = adminDb
        .collection(SATPAM_DUTY_PLANS_COLLECTION)
        .where('period', '==', period);
      const oldReportIds = Array.isArray(before.reportIds)
        ? before.reportIds.filter((id: unknown): id is string => typeof id === 'string')
        : [];
      const oldReportRefs = oldReportIds.map((reportId: string) =>
        adminDb.collection('ActivityReports').doc(reportId),
      );
      const employeeIds = Array.from(
        new Set(command.assignments.map((assignment) => assignment.employeeId)),
      );
      const employeeRefs = employeeIds.map((employeeId) =>
        adminDb.collection('Employees_BlueCollar').doc(employeeId),
      );
      const secondarySnapshots = await Promise.all([
        transaction.get(periodRef),
        transaction.get(holidayRef),
        transaction.get(teamRef),
        transaction.get(dutyPlanRef),
        transaction.get(pos9PlansQuery),
        ...oldReportRefs.map((reference) => transaction.get(reference)),
        ...employeeRefs.map((reference) => transaction.get(reference)),
      ]);
      const periodSnapshot = secondarySnapshots[0] as FirebaseFirestore.DocumentSnapshot;
      const holidaySnapshot = secondarySnapshots[1] as FirebaseFirestore.DocumentSnapshot;
      const teamSnapshot = secondarySnapshots[2] as FirebaseFirestore.DocumentSnapshot;
      const dutyPlanSnapshot = secondarySnapshots[3] as FirebaseFirestore.DocumentSnapshot;
      const pos9PlanSnapshots = secondarySnapshots[4] as FirebaseFirestore.QuerySnapshot;
      const oldReportSnapshots = secondarySnapshots.slice(
        5,
        5 + oldReportRefs.length,
      ) as FirebaseFirestore.DocumentSnapshot[];
      const employeeSnapshots = secondarySnapshots.slice(
        5 + oldReportRefs.length,
      ) as FirebaseFirestore.DocumentSnapshot[];

      assertPeriodAcceptsInput(periodSnapshot.data());
      if (!teamSnapshot.exists) {
        throw new HttpError(409, 'Regu Satpam tidak ditemukan.');
      }
      // Pre-approval: the whole roster must still be undecided (delete-all/
      // recreate-all below). Approved-edit: partition into the editable
      // approved set and the untouched declined set; anything else on a
      // reviewed occurrence is unexpected.
      const oldApprovedReportSnapshots: FirebaseFirestore.DocumentSnapshot[] = [];
      const oldDeclinedReportSnapshots: FirebaseFirestore.DocumentSnapshot[] = [];
      if (isApprovedEditBranch) {
        for (const snapshot of oldReportSnapshots) {
          if (!snapshot.exists) continue;
          const status = String(snapshot.data()?.status || '');
          if (status === 'approved') oldApprovedReportSnapshots.push(snapshot);
          else if (status === 'declined') oldDeclinedReportSnapshots.push(snapshot);
          else {
            throw new HttpError(
              409,
              'Ada penugasan berstatus tidak terduga untuk diedit.',
            );
          }
        }
      } else if (
        oldReportSnapshots.some(
          (snapshot) => snapshot.exists && snapshot.data()?.status !== 'pending',
        )
      ) {
        throw new HttpError(409, 'Ada penugasan yang sudah diputuskan.');
      }

      const teamNumber = Number(String(before.teamId || '').split('_')[1]);
      if (![1, 2, 3].includes(teamNumber)) {
        throw new HttpError(409, 'Nomor regu Satpam tidak valid.');
      }
      const employeeById = new Map(
        employeeSnapshots.map((snapshot) => [snapshot.id, snapshot]),
      );
      const activeSatpamIds = new Set(
        employeeSnapshots
          .filter((snapshot) => {
            const employee = snapshot.data();
            return (
              snapshot.exists &&
              employee?.employment?.jobCategory === 'SATPAM' &&
              (employee?.employment?.status === 'active' ||
                employee?.flags?.isActive === true)
            );
          })
          .map((snapshot) => snapshot.id),
      );
      const oldReportById = new Map(
        (isApprovedEditBranch ? oldApprovedReportSnapshots : oldReportSnapshots)
          .filter((snapshot) => snapshot.exists)
          .map((snapshot) => [snapshot.id, snapshot.data()!]),
      );
      // Approved-edit only: a client-provided reportId must name a row that is
      // actually part of this occurrence's current approved set. Trusting an
      // unverified id here would let `transaction.set` overwrite an unrelated
      // report belonging to a different occurrence entirely.
      if (isApprovedEditBranch) {
        for (const assignment of command.assignments) {
          if (assignment.reportId && !oldReportById.has(assignment.reportId)) {
            throw new HttpError(
              409,
              'ID penugasan edit tidak dikenal untuk laporan yang sudah disetujui.',
            );
          }
        }
      }
      const suggestedShiftName = getSatpamShiftForTeam(teamNumber, command.dutyDate);
      const annualHolidayDates =
        holidaySnapshot.exists && Array.isArray(holidaySnapshot.data()?.dates)
          ? holidaySnapshot
              .data()!
              .dates.filter((date: unknown): date is string => typeof date === 'string')
          : [];
      const periodCalendar = periodCalendarFromData(
        period,
        periodSnapshot.exists ? periodSnapshot.data()! : null,
        annualHolidayDates,
      );
      const periodMaterialization = buildPeriodMaterialization({
        period,
        periodData: periodSnapshot.exists ? periodSnapshot.data()! : null,
        annualDates: annualHolidayDates,
        actorUid: actor.uid,
        reason: `Kalender periode dibekukan saat koreksi auditor shift Satpam ${period}`,
      });
      if (periodMaterialization) {
        transaction.set(periodRef, periodMaterialization, { merge: true });
      }
      const holidayDates = new Set<string>(periodCalendar.premiumDates);
      const expectedRegularPayType = getRegularSatpamPayType(
        command.dutyDate,
        holidayDates,
      );
      const teamData = teamSnapshot.data()!;
      const teamRoster = new Set<string>([
        String(teamData.ketuaShiftId || ''),
        ...(Array.isArray(teamData.memberEmployeeIds)
          ? teamData.memberEmployeeIds.filter(
              (value: unknown): value is string => typeof value === 'string',
            )
          : []),
      ]);
      const pos9GuardIds = new Set<string>(
        pos9PlanSnapshots.docs
          .filter((snapshot) => snapshot.data()?.status !== 'stale')
          .map((snapshot) => String(snapshot.data()?.fixedPost9EmployeeId || ''))
          .filter(Boolean),
      );
      const planDay: SatpamDutyPlanDay | null =
        dutyPlanSnapshot.exists &&
        Array.isArray(dutyPlanSnapshot.data()?.generatedDays)
          ? dutyPlanSnapshot
              .data()!
              .generatedDays.find(
                (day: SatpamDutyPlanDay) =>
                  day.dutyDate === command.dutyDate,
              ) || null
          : null;
      const primaryCommandAssignments = command.assignments.filter(
        (assignment) => assignment.assignmentKind === 'primary',
      );
      const extraCommandAssignments = command.assignments.filter(
        (assignment) => assignment.assignmentKind === 'extra',
      );
      const canonicalEnabled = isSatpamDutyPlanRequired(
        period,
        periodSnapshot.data() || null,
      );
      const classification = canonicalEnabled
        ? classifySatpamDutyAssignments({
            planDay,
            primaryAssignments: primaryCommandAssignments.map(
              (assignment) => ({
                postId: assignment.postId,
                employeeId: assignment.employeeId,
                shiftType: assignment.shiftType,
                coveredEmployeeId: assignment.coveredEmployeeId || null,
              }),
            ),
            extraAssignment: extraCommandAssignments[0]
              ? {
                  postId: extraCommandAssignments[0].postId,
                  employeeId: extraCommandAssignments[0].employeeId,
                }
              : null,
            regularPayType: expectedRegularPayType,
            teamRosterEmployeeIds: teamRoster,
            ketuaShiftId: String(teamData.ketuaShiftId || ''),
            pos9GuardIds,
          })
        : null;
      let primaryClassificationIndex = 0;
      let extraClassificationIndex = 0;
      const classifiedPrimary =
        classification?.assignments.filter(
          (assignment) => assignment.assignmentKind === 'primary',
        ) || [];
      const classifiedExtra =
        classification?.assignments.filter(
          (assignment) => assignment.assignmentKind === 'extra',
        ) || [];
      const canonicalAssignments: AuditorEditAssignment[] =
        command.assignments.map((assignment) => {
          const classified =
            assignment.assignmentKind === 'primary'
              ? classifiedPrimary[primaryClassificationIndex++]
              : classifiedExtra[extraClassificationIndex++];
          if (!classified) return assignment;
          return {
            ...assignment,
            shiftType: classified.payType,
            coveredEmployeeId:
              classified.coveredEmployeeId || undefined,
            overtimeReason:
              classified.payType === 'Lembur Cover'
                ? 'Pengganti petugas sesuai rencana dinas'
                : assignment.overtimeReason,
          };
        });
      if (
        canonicalAssignments.some(
          (assignment) =>
            assignment.assignmentKind === 'primary' &&
            assignment.employeeId === String(teamData.ketuaShiftId || '') &&
            // Matches resolveKetuaSatpamPayType's own contract: Harian and
            // Lembur Sendiri are explicit overrides, while Jumat & Libur is
            // the calendar default the Ketua's own post falls back to on a
            // Friday/holiday, same as an ordinary guard's post.
            !['Harian', 'Jumat & Libur', 'Lembur Sendiri'].includes(assignment.shiftType),
        )
      ) {
        throw new HttpError(
          409,
          'Jenis upah Ketua Shift hanya dapat Harian, Jumat & Libur, atau Lembur Sendiri.',
        );
      }
      if (
        canonicalAssignments.some(
          (assignment) =>
            assignment.assignmentKind === 'primary' &&
            assignment.shiftType === 'Lembur Sendiri' &&
            assignment.employeeId !== String(teamData.ketuaShiftId || '') &&
            !(
              assignment.postId === 'Pos 9' &&
              pos9GuardIds.has(assignment.employeeId)
            ),
        )
      ) {
        throw new HttpError(
          409,
          'Lembur Sendiri pada pos utama hanya dapat dipilih oleh Ketua Shift.',
        );
      }
      const primaryAssignments = canonicalAssignments
        .filter((assignment) => assignment.assignmentKind === 'primary')
        .map((assignment) => {
          const original = assignment.reportId
            ? oldReportById.get(assignment.reportId)
            : undefined;
          return {
            postId: assignment.postId,
            employeeId: assignment.employeeId,
            shiftType: assignment.shiftType,
            coveredEmployeeId: assignment.coveredEmployeeId,
            overtimeReason: assignment.overtimeReason,
            photoUrl:
              typeof original?.photoUrl === 'string' ? original.photoUrl : undefined,
            photoAuditMetadata: original?.photoAuditMetadata,
          };
        });
      const anomalies = analyzeSatpamShiftSubmission({
        dutyDate: command.dutyDate,
        reportedShiftName: command.shiftName,
        suggestedShiftName,
        ketuaShiftId: String(before.ketuaShiftId || ''),
        assignments: primaryAssignments,
        activeSatpamIds,
        pos9GuardIds,
        holidayCalendarConfigured: periodCalendar.premiumDates.length > 0,
      });
      const extraAssignments = canonicalAssignments.filter(
        (assignment) => assignment.assignmentKind === 'extra',
      );
      const allGuardIds = canonicalAssignments.map((assignment) => assignment.employeeId);
      if (new Set(allGuardIds).size !== allGuardIds.length) {
        if (!anomalies.some((anomaly) => anomaly.code === 'DUPLICATE_GUARD')) {
          anomalies.push({
            code: 'DUPLICATE_GUARD',
            severity: 'blocking',
            message: 'Ada petugas yang masih dicatat lebih dari satu kali.',
          });
        }
      }
      if (
        extraAssignments.some(
          (assignment) =>
            !activeSatpamIds.has(assignment.employeeId) ||
            assignment.shiftType !== 'Lembur Sendiri',
        )
      ) {
        anomalies.push({
          code: 'INACTIVE_OR_MISMATCHED_GUARD',
          severity: 'blocking',
          message: 'Petugas tambahan atau kategori upahnya belum sesuai.',
        });
      }
      if (
        canonicalAssignments.some(
          (assignment) =>
            assignment.assignmentKind === 'primary' &&
            (assignment.shiftType === 'Harian' ||
              assignment.shiftType === 'Jumat & Libur') &&
            // An outside-team substitution defaults to Harian by design. It
            // is a reviewable schedule deviation, not a calendar-pay error.
            !(
              assignment.employeeId === String(teamData.ketuaShiftId || '') ||
              !teamRoster.has(assignment.employeeId) ||
              assignment.postId === 'Pos 9' &&
              pos9GuardIds.has(assignment.employeeId)
            ) &&
            assignment.shiftType !== expectedRegularPayType,
        )
      ) {
        anomalies.push({
          code: 'PAY_CLASSIFICATION_MISMATCH',
          severity: 'blocking',
          message: 'Ada kategori upah reguler yang tidak sesuai kalender.',
        });
      }
      if (canonicalEnabled) {
        for (const code of classification?.anomalyCodes || ['DUTY_PLAN_MISSING']) {
          if (anomalies.some((anomaly) => anomaly.code === code)) continue;
          anomalies.push({
            code,
            severity: [
              'EXTRA_NOT_OFF_DUTY',
              'EXTRA_WITH_INCOMPLETE_PRIMARY_ROSTER',
            ].includes(code)
              ? 'blocking'
              : 'warning',
            message:
              code === 'DUTY_PLAN_MISSING'
                ? 'Rencana dinas belum tersedia.'
                : code === 'ACTUAL_ROSTER_DIFFERS'
                  ? 'Roster aktual berbeda dari rencana dinas.'
                  : code === 'POS9_GUARD_MISMATCH'
                    ? 'Pos 9 diisi petugas pengganti. Kepala SatKer perlu memeriksa substitusi ini.'
                    : 'Klasifikasi penugasan tambahan belum sesuai rencana dinas.',
          });
        }
        if (
          dutyPlanSnapshot.exists &&
          Array.isArray(dutyPlanSnapshot.data()?.lateBackfillDates) &&
          dutyPlanSnapshot.data()!.lateBackfillDates.includes(command.dutyDate)
        ) {
          anomalies.push({
            code: 'DUTY_PLAN_BACKFILL_PENDING',
            severity: 'warning',
            message: 'Rencana dinas diterbitkan setelah tanggal ini dimulai (backfill).',
          });
        }
        if (
          dutyPlanSnapshot.exists &&
          dutyPlanSnapshot.data()?.status === 'stale' &&
          Array.isArray(dutyPlanSnapshot.data()?.staleDates) &&
          dutyPlanSnapshot.data()!.staleDates.includes(command.dutyDate)
        ) {
          anomalies.push({
            code: 'DUTY_PLAN_STALE',
            severity: 'blocking',
            message:
              'Susunan regu berubah dan tanggal ini belum diregenerasi.',
          });
        }
      }
      const uniqueAnomalies = anomalies.filter(
        (anomaly, index, list) =>
          list.findIndex((candidate) => candidate.code === anomaly.code) === index,
      );

      // Approved-edit only: this saves straight to 'approved', so it must
      // clear every gate the normal POST approval flow would otherwise apply
      // (duplicate post/guard, incomplete cover, inactive/mismatched
      // employee, pay-classification vs calendar, stale duty plan, ...).
      // 'blocking' anomalies are exactly that gate set.
      const referencedApprovedIds = new Set(
        command.assignments.flatMap((assignment) =>
          assignment.reportId ? [assignment.reportId] : [],
        ),
      );
      const removedApprovedSnapshots = isApprovedEditBranch
        ? oldApprovedReportSnapshots.filter(
            (snapshot) => !referencedApprovedIds.has(snapshot.id),
          )
        : [];
      let approvedEditContext: {
        oldPeriod: string;
        periodChanged: boolean;
        guardKeyForAssignment: Map<number, { oldKey: string | null; newKey: string }>;
      } | null = null;

      if (isApprovedEditBranch) {
        const blockingAnomalies = uniqueAnomalies.filter(
          (anomaly) => anomaly.severity === 'blocking',
        );
        if (blockingAnomalies.length > 0) {
          throw new HttpError(
            409,
            `Koreksi tidak dapat langsung disetujui: ${blockingAnomalies
              .map((anomaly) => anomaly.message)
              .join(' ')}`,
          );
        }

        const oldPeriod = String(before.payrollPeriod || '');
        const periodChanged = oldPeriod !== period;
        const oldShiftName = String(before.reportedShiftName || before.shiftName || '');

        const guardKeyForAssignment = new Map<
          number,
          { oldKey: string | null; newKey: string }
        >();
        const guardKeysToRead = new Set<string>();
        canonicalAssignments.forEach((assignment, index) => {
          const original = assignment.reportId
            ? oldReportById.get(assignment.reportId)
            : undefined;
          const oldKey = original
            ? guardDutyIndexId(
                String(original.dutyDate || before.dutyDate || ''),
                String(
                  original.reportedShiftName || original.shiftName || oldShiftName,
                ) as SatpamShiftName,
                String(original.employeeId || ''),
              )
            : null;
          const newKey = guardDutyIndexId(
            command.dutyDate,
            command.shiftName,
            assignment.employeeId,
          );
          guardKeyForAssignment.set(index, { oldKey, newKey });
          if (oldKey !== newKey) guardKeysToRead.add(newKey);
        });

        const touchedEmployeeIds = Array.from(
          new Set(
            [
              ...canonicalAssignments.map((assignment) => assignment.employeeId),
              ...removedApprovedSnapshots.map((snapshot) =>
                String(snapshot.data()?.employeeId || ''),
              ),
            ].filter(Boolean),
          ),
        );
        const slipKeysToRead: Array<[string, string, string]> = [];
        for (const employeeId of touchedEmployeeIds) {
          slipKeysToRead.push([`${period}::${employeeId}`, period, employeeId]);
          if (periodChanged) {
            slipKeysToRead.push([`${oldPeriod}::${employeeId}`, oldPeriod, employeeId]);
          }
        }
        const guardKeyList = Array.from(guardKeysToRead);
        const absenceRefsByEmployee = new Map(
          canonicalAssignments.map((assignment) => [
            assignment.employeeId,
            adminDb
              .collection(SATPAM_ABSENCE_REQUESTS_COLLECTION)
              .doc(satpamDutyKey(assignment.employeeId, command.dutyDate).replaceAll('-', '')),
          ]),
        );

        const [oldPeriodSnapshot, ...restSnapshots] = await Promise.all([
          periodChanged
            ? transaction.get(adminDb.collection('PayrollPeriods').doc(oldPeriod))
            : Promise.resolve(null),
          ...slipKeysToRead.map(([, per, empId]) =>
            transaction.get(
              adminDb.collection('PayrollSlipStates').doc(`${per.replace('-', '_')}_${empId}`),
            ),
          ),
          ...guardKeyList.map((key) =>
            transaction.get(adminDb.collection('GuardDutyIndexes').doc(key)),
          ),
          ...Array.from(absenceRefsByEmployee.values()).map((ref) => transaction.get(ref)),
        ]);
        const slipSnapshots = restSnapshots.slice(0, slipKeysToRead.length);
        const guardIndexSnapshots = restSnapshots.slice(
          slipKeysToRead.length,
          slipKeysToRead.length + guardKeyList.length,
        );
        const absenceSnapshots = restSnapshots.slice(
          slipKeysToRead.length + guardKeyList.length,
        );

        if (periodChanged) {
          assertPeriodAcceptsInput(
            oldPeriodSnapshot?.data() ?? null,
            'Periode payroll lama sudah ditutup; koreksi tidak dapat memindahkan tanggal dinas.',
          );
        }
        const slipSnapshotsByKey = new Map(
          slipKeysToRead.map(([key], idx) => [key, slipSnapshots[idx]]),
        );
        for (const employeeId of touchedEmployeeIds) {
          const newSlip = slipSnapshotsByKey.get(`${period}::${employeeId}`);
          if (newSlip?.exists && isImmutablePayrollStatus(newSlip.data()?.status)) {
            throw new HttpError(
              409,
              'Slip pegawai sudah dikunci/dibayar; gunakan alur koreksi finansial untuk periode ini.',
            );
          }
          if (periodChanged) {
            const oldSlip = slipSnapshotsByKey.get(`${oldPeriod}::${employeeId}`);
            if (oldSlip?.exists && isImmutablePayrollStatus(oldSlip.data()?.status)) {
              throw new HttpError(
                409,
                'Slip pegawai sudah dikunci/dibayar; gunakan alur koreksi finansial untuk periode ini.',
              );
            }
          }
        }
        const guardIndexSnapshotsByKey = new Map(
          guardKeyList.map((key, idx) => [key, guardIndexSnapshots[idx]]),
        );
        for (const [index, { newKey, oldKey }] of guardKeyForAssignment) {
          if (oldKey === newKey) continue;
          const existing = guardIndexSnapshotsByKey.get(newKey);
          if (existing?.exists && existing.data()?.occurrenceId !== command.occurrenceId) {
            const assignment = canonicalAssignments[index];
            const employeeName = String(
              employeeById.get(assignment.employeeId)?.data()?.name || assignment.employeeId,
            );
            throw new HttpError(
              409,
              `${employeeName} sudah memiliki pembayaran pada shift yang sama.`,
            );
          }
        }
        const absenceEmployeeIds = Array.from(absenceRefsByEmployee.keys());
        absenceEmployeeIds.forEach((employeeId, idx) => {
          const snapshot = absenceSnapshots[idx];
          if (
            snapshot?.exists &&
            snapshot.data()?.status === 'approved' &&
            satpamAttendanceReportType(snapshot.data() || {}) === 'izin_resmi'
          ) {
            const employeeName = String(
              employeeById.get(employeeId)?.data()?.name || employeeId,
            );
            throw new HttpError(
              409,
              `${employeeName} memiliki izin dibayar pada tanggal ini. Selesaikan konflik izin terlebih dahulu.`,
            );
          }
        });

        approvedEditContext = { oldPeriod, periodChanged, guardKeyForAssignment };
      }

      const revision = command.expectedRevision + 1;
      const { startsAtIso, endsAtIso } = getShiftIsoBounds(
        command.dutyDate,
        command.shiftName,
      );
      const startsAt = admin.firestore.Timestamp.fromDate(new Date(startsAtIso));
      const endsAt = admin.firestore.Timestamp.fromDate(new Date(endsAtIso));
      const now = admin.firestore.FieldValue.serverTimestamp();

      const reportIds = canonicalAssignments.map((assignment, index) =>
        assignment.reportId ||
        activityReportId(
          command.occurrenceId,
          assignment.employeeId,
          `auditor_${index}_${command.requestId.slice(-8)}`,
        ),
      );
      if (isApprovedEditBranch) {
        // Only rows the auditor actually dropped are removed. Untouched
        // declined rows and kept/modified approved rows (overwritten below
        // via `transaction.set`) are left alone.
        removedApprovedSnapshots.forEach((snapshot) => {
          transaction.delete(snapshot.ref);
          transaction.delete(adminDb.collection('PayrollLedgerEntries').doc(snapshot.id));
          const removedData = snapshot.data() || {};
          const removedDutyDate = String(removedData.dutyDate || before.dutyDate || '');
          const removedShiftName = String(
            removedData.reportedShiftName ||
              removedData.shiftName ||
              before.reportedShiftName ||
              before.shiftName ||
              '',
          );
          const removedEmployeeId = String(removedData.employeeId || '');
          if (removedDutyDate && removedShiftName && removedEmployeeId) {
            transaction.delete(
              adminDb
                .collection('GuardDutyIndexes')
                .doc(
                  guardDutyIndexId(
                    removedDutyDate,
                    removedShiftName as SatpamShiftName,
                    removedEmployeeId,
                  ),
                ),
            );
          }
        });
      } else {
        oldReportRefs.forEach((reference) => transaction.delete(reference));
      }
      canonicalAssignments.forEach((assignment, index) => {
        const original = assignment.reportId
          ? oldReportById.get(assignment.reportId)
          : undefined;
        const initialAssignments = Array.isArray(
          before.initialSubmissionSnapshot?.assignments,
        )
          ? before.initialSubmissionSnapshot.assignments
          : [];
        const initialAssignment = initialAssignments.find(
          (item: Record<string, unknown>) =>
            String(item.assignmentKey || '') ===
            String(original?.assignmentKey || ''),
        );
        const employee = employeeById.get(assignment.employeeId);
        const post = SATPAM_POSTS.find((item) => item.id === assignment.postId)!;
        const plannedEmployeeId =
          assignment.assignmentKind === 'primary'
            ? planDay?.assignments.find(
                (planned) => planned.postId === assignment.postId,
              )?.employeeId || null
            : null;
        const reportId = reportIds[index];
        const assignmentKey =
          String(original?.assignmentKey || `auditor_${assignment.postId}_${index}`);
        const approvedNow = isApprovedEditBranch
          ? {
              status: 'approved' as const,
              reviewedAt: now,
              reviewedBy: actor.uid,
              reviewedByRole: actor.role,
              approvedAt: now,
              approvedBy: actor.uid,
              declineReason: '',
              reviewRevision: Number(original?.reviewRevision || 0) + 1,
            }
          : { status: 'pending' as const };
        transaction.set(adminDb.collection('ActivityReports').doc(reportId), {
          employeeId: assignment.employeeId,
          employeeName: String(employee?.data()?.name || assignment.employeeId),
          plannedEmployeeId,
          plannedEmployeeName: plannedEmployeeId
            ? String(
                employeeById.get(plannedEmployeeId)?.data()?.name ||
                  plannedEmployeeId,
              )
            : null,
          jobCategory: 'SATPAM',
          reportKind: 'satpam_shift_assignment',
          period,
          payrollPeriod: period,
          activityName: `Pengamanan di ${post.id}: ${post.name}`,
          activityType: 'Lainnya',
          activityDate: command.dutyDate,
          dutyDate: command.dutyDate,
          timeStart: SHIFT_TIMES[command.shiftName].start,
          timeEnd: SHIFT_TIMES[command.shiftName].end,
          startsAt,
          endsAt,
          ...approvedNow,
          fee: SATPAM_RATES[assignment.shiftType],
          shiftType: assignment.shiftType,
          assignmentKind: assignment.assignmentKind,
          assignmentKey,
          postId: assignment.postId,
          postName: `${post.id}: ${post.name}`,
          photoUrl: original?.photoUrl || null,
          photoAuditMetadata: original?.photoAuditMetadata || null,
          originalPhotoUrl: original?.originalPhotoUrl || original?.photoUrl || null,
          shiftName: command.shiftName,
          reportedShiftName: command.shiftName,
          suggestedShiftName,
          submittedDutyDate:
            original?.submittedDutyDate ||
            before.initialSubmissionSnapshot?.dutyDate ||
            before.dutyDate,
          submittedShiftName:
            original?.submittedShiftName ||
            before.initialSubmissionSnapshot?.reportedShiftName ||
            before.reportedShiftName ||
            before.shiftName,
          submittedPostId:
            original?.submittedPostId ||
            initialAssignment?.postId ||
            original?.postId ||
            assignment.postId,
          submittedEmployeeId:
            original?.submittedEmployeeId ||
            initialAssignment?.employeeId ||
            original?.employeeId ||
            assignment.employeeId,
          submittedPayType:
            original?.submittedPayType ||
            initialAssignment?.payType ||
            original?.shiftType ||
            assignment.shiftType,
          coveredEmployeeId: assignment.coveredEmployeeId || null,
          overtimeReason: assignment.overtimeReason || null,
          ketuaShiftId: before.ketuaShiftId,
          ketuaShiftName: before.ketuaShiftName,
          sourceOccurrenceId: command.occurrenceId,
          sourceOccurrenceRevision: revision,
          sourceLedgerEntryId: reportId,
          anomalyCodes: uniqueAnomalies.map((anomaly) => anomaly.code),
          auditorActionAt: now,
          reviewOwnerUid: actor.uid,
          rateVersion: before.rateVersion || null,
          holidayCalendarVersion: `PERIOD-${period}-R${periodCalendar.revision}`,
          calendarRevision: periodCalendar.revision,
          dutyPlanId: dutyPlanSnapshot.exists ? dutyPlanRef.id : null,
          dutyPlanRevision: dutyPlanSnapshot.exists
            ? Number(dutyPlanSnapshot.data()?.revision || 0)
            : null,
          submittedAt: original?.submittedAt || now,
          auditorEditedAt: now,
          auditorEditedBy: actor.uid,
          schemaVersion: 3,
        });

        if (isApprovedEditBranch) {
          transaction.set(
            adminDb.collection('PayrollLedgerEntries').doc(reportId),
            {
              employeeId: assignment.employeeId,
              payrollPeriod: period,
              sourceType: 'satpam_shift',
              sourceId: reportId,
              sourceOccurrenceId: command.occurrenceId,
              payType: assignment.shiftType,
              amount: SATPAM_RATES[assignment.shiftType],
              currency: 'IDR',
              status: 'posted',
              rateVersion: before.rateVersion || null,
              dutyDate: command.dutyDate,
              startsAt,
              endsAt,
              approvedBy: actor.uid,
              correctedAt: now,
              correctedBy: actor.uid,
              // `original` is the ActivityReport, which never carried its own
              // `createdAt` (only `submittedAt`) — merge:true means omitting
              // this field here preserves whatever the ledger doc already has
              // for a kept-in-place row, and only a genuinely new row falls
              // back to `now`.
              ...(original ? {} : { createdAt: now }),
              schemaVersion: 1,
            },
            { merge: true },
          );

          const guardKey = approvedEditContext!.guardKeyForAssignment.get(index)!;
          if (guardKey.oldKey !== guardKey.newKey) {
            if (guardKey.oldKey) {
              transaction.delete(
                adminDb.collection('GuardDutyIndexes').doc(guardKey.oldKey),
              );
            }
            transaction.set(
              adminDb.collection('GuardDutyIndexes').doc(guardKey.newKey),
              {
                employeeId: assignment.employeeId,
                occurrenceId: command.occurrenceId,
                reportId,
                dutyDate: command.dutyDate,
                shiftName: command.shiftName,
                startsAt,
                endsAt,
                approvedAt: now,
              },
              { merge: true },
            );
          }
        }
      });

      const finalReportIds = isApprovedEditBranch
        ? [...oldDeclinedReportSnapshots.map((snapshot) => snapshot.id), ...reportIds]
        : reportIds;
      const after = {
        ...before,
        dutyDate: command.dutyDate,
        payrollPeriod: period,
        shiftName: command.shiftName,
        reportedShiftName: command.shiftName,
        suggestedShiftName,
        startsAt,
        endsAt,
        status: isApprovedEditBranch ? 'reviewed' : 'under_review',
        reviewStatus: isApprovedEditBranch
          ? oldDeclinedReportSnapshots.length > 0
            ? 'partially_approved'
            : 'approved'
          : 'auditor_editing',
        revision,
        auditorActionAt: before.auditorActionAt || now,
        reviewOwnerUid: before.reviewOwnerUid || actor.uid,
        anomalyCodes: uniqueAnomalies.map((anomaly) => anomaly.code),
        anomalies: uniqueAnomalies,
        blockingAnomalyCount: uniqueAnomalies.filter(
          (anomaly) => anomaly.severity === 'blocking',
        ).length,
        warningAnomalyCount: uniqueAnomalies.filter(
          (anomaly) => anomaly.severity === 'warning',
        ).length,
        reportIds: finalReportIds,
        pendingReportIds: isApprovedEditBranch ? [] : reportIds,
        assignmentCount: finalReportIds.length,
        pendingAssignmentCount: isApprovedEditBranch ? 0 : reportIds.length,
        approvedAssignmentCount: isApprovedEditBranch ? reportIds.length : 0,
        declinedAssignmentCount: isApprovedEditBranch
          ? oldDeclinedReportSnapshots.length
          : 0,
        holidayCalendarVersion: `PERIOD-${period}-R${periodCalendar.revision}`,
        calendarRevision: periodCalendar.revision,
        dutyPlanId: dutyPlanSnapshot.exists ? dutyPlanRef.id : null,
        dutyPlanRevision: dutyPlanSnapshot.exists
          ? Number(dutyPlanSnapshot.data()?.revision || 0)
          : null,
        plannedAssignmentSnapshot: planDay,
        actualAssignmentSnapshot: canonicalAssignments.map((assignment) => ({
          assignmentKind: assignment.assignmentKind,
          postId: assignment.postId,
          employeeId: assignment.employeeId,
          shiftType: assignment.shiftType,
          coveredEmployeeId: assignment.coveredEmployeeId || null,
        })),
        dutyPlanStale: false,
        auditorEditReason: command.reason,
        auditorEditedAt: now,
        updatedAt: now,
      };
      transaction.set(occurrenceRef, after);
      transaction.create(
        newFinancialAuditRef(),
        buildFinancialAuditRecord(actor, {
          action: 'SATPAM_SHIFT_AUDITOR_EDITED',
          entityType: 'ShiftOccurrence',
          entityId: command.occurrenceId,
          reason: command.reason,
          requestId: command.requestId,
          before,
          after,
          metadata: {
            revision,
            anomalyCodes: uniqueAnomalies.map((anomaly) => anomaly.code),
          },
        }),
      );
      transaction.create(idempotencyRef, {
        actorUid: actor.uid,
        requestId: command.requestId,
        requestHash,
        entityType: 'ShiftOccurrence',
        entityId: command.occurrenceId,
        revision,
        anomalies: uniqueAnomalies,
        createdAt: now,
      });
      const affectedEmployeeIds = isApprovedEditBranch
        ? Array.from(
            new Set(
              [
                ...canonicalAssignments.map((assignment) => assignment.employeeId),
                ...removedApprovedSnapshots.map((snapshot) =>
                  String(snapshot.data()?.employeeId || ''),
                ),
              ].filter(Boolean),
            ),
          )
        : [];
      const affectedPeriods = isApprovedEditBranch
        ? Array.from(
            new Set(
              [period, approvedEditContext?.periodChanged ? approvedEditContext.oldPeriod : null].filter(
                (value): value is string => Boolean(value),
              ),
            ),
          )
        : [period];
      return {
        occurrenceId: command.occurrenceId,
        revision,
        anomalies: uniqueAnomalies,
        affectedEmployeeIds,
        affectedPeriods,
        idempotent: false,
      };
    });

    const periodsToReconcile = result.affectedPeriods?.length
      ? result.affectedPeriods
      : [
          String(
            (
              await adminDb.collection('ShiftOccurrences').doc(command.occurrenceId).get()
            ).data()?.payrollPeriod || '',
          ),
        ].filter(Boolean);
    for (const period of periodsToReconcile) {
      await syncSatpamDutyReconciliation(period, actor.uid);
    }
    return Response.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
