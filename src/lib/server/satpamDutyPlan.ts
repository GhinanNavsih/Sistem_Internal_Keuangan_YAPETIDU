import admin, { adminDb } from '@/lib/firebase-admin';
import {
  hasSatpamShiftEnded,
  SATPAM_RATES,
  type SatpamShiftName,
} from '@/lib/payroll/domain';
import {
  reconcileSatpamDuties,
  isActiveSatpamShiftRegistration,
  satpamHarianCountWithApprovedAbsences,
  satpamDutyKey,
  satpamDutyPlanId,
  SATPAM_MONTHLY_ATTENDANCE_BONUS,
  SATPAM_PAID_ABSENCE_RATE,
  shouldExcludeSatpamLeaveFromHarian,
  type SatpamDutyPlanDay,
  type SatpamDutyPlanStatus,
  type SatpamRotationSlotAssignment,
} from '@/lib/payroll/satpamDutyPlan';
import { satpamAttendanceReportType } from '@/lib/payroll/satpamAttendance';
import {
  normalizeSatpamUraianEntry,
} from '@/lib/payroll/satpamCompensation';
import type { UraianEntry } from '@/types';

export const SATPAM_DUTY_PLANS_COLLECTION = 'SatpamDutyPlans';
export const SATPAM_DUTY_PLAN_REVISIONS_COLLECTION =
  'SatpamDutyPlanRevisions';
export const SATPAM_ABSENCE_REQUESTS_COLLECTION = 'SatpamAbsenceRequests';
export const SATPAM_ABSENCE_ENTITLEMENTS_COLLECTION =
  'SatpamAbsenceEntitlements';
export const SATPAM_DUTY_RECONCILIATIONS_COLLECTION =
  'SatpamDutyReconciliations';

export interface StoredSatpamDutyPlan {
  id: string;
  period: string;
  teamId: string;
  periodStart: string;
  periodEnd: string;
  ketuaShiftId: string;
  fixedPost9EmployeeId: string;
  rotatingEmployeeIds: string[];
  rotationVersion: string;
  rotationStartMode: 'manual' | 'continued';
  continuedFromPlanId?: string | null;
  continuedFromRevision?: number | null;
  firstDayAssignments?: SatpamRotationSlotAssignment[];
  rosterEmployeeIds: string[];
  reconciliationEmployeeIds?: string[];
  rosterSnapshot: Array<{
    employeeId: string;
    name: string;
    nipy: string;
    dutyRole?: 'ketua' | 'fixed_pos_9' | 'rotating';
  }>;
  seedDays: SatpamDutyPlanDay[];
  generatedDays: SatpamDutyPlanDay[];
  status: SatpamDutyPlanStatus;
  revision: number;
  lateBackfillDates: string[];
  staleDates: string[];
  publishedAt?: unknown;
  publishedBy?: string;
}

export interface SatpamDutyPlanContext {
  plan: StoredSatpamDutyPlan | null;
  day: SatpamDutyPlanDay | null;
}

export interface SatpamDutyReconciliationView {
  period: string;
  generatedAtIso: string;
  periodComplete: boolean;
  plans: Array<{
    planId: string;
    teamId: string;
    ketuaShiftId: string;
    fixedPost9EmployeeId: string;
    status: SatpamDutyPlanStatus;
    revision: number;
    lateBackfillDates: string[];
    missingOccurrenceDates: string[];
    pendingOccurrenceDates: string[];
    employees: Array<{
      employeeId: string;
      employeeName: string;
      requiredDuties: number;
      bonusTargetDuties: number;
      workedShiftCount: number;
      fulfilledDuties: number;
      fulfilledByWork: number;
      fulfilledByAbsence: number;
      missedDuties: number;
      pendingDuties: number;
      conflictingDuties: number;
      extraDuties: number;
      eligibleForBonus: boolean;
      bonusCount: 0 | 1;
      bonusAmount: number;
      approvedAbsenceCount: number;
    }>;
  }>;
  pendingAbsenceCount: number;
  conflictCount: number;
  unassignedExternalEmployees: Array<{
    employeeId: string;
    employeeName: string;
    extraDuties: number;
    eligibleForBonus: false;
    bonusAmount: 0;
  }>;
  blockers: string[];
}

export async function loadSatpamDutyPlan(
  period: string,
  teamId: string,
): Promise<StoredSatpamDutyPlan | null> {
  const planSnapshot = await adminDb
    .collection(SATPAM_DUTY_PLANS_COLLECTION)
    .doc(satpamDutyPlanId(period, teamId))
    .get();
  if (!planSnapshot.exists) return null;
  return {
    id: planSnapshot.id,
    ...(planSnapshot.data() as Omit<StoredSatpamDutyPlan, 'id'>),
  };
}

export async function loadSatpamDutyPlanContext(
  period: string,
  teamId: string,
  dutyDate: string,
): Promise<SatpamDutyPlanContext> {
  const plan = await loadSatpamDutyPlan(period, teamId);
  if (!plan) return { plan: null, day: null };
  const day =
    plan.generatedDays.find((candidate) => candidate.dutyDate === dutyDate) ||
    null;
  return { plan, day };
}

export async function findSatpamTeamForEmployee(employeeId: string): Promise<{
  teamId: string;
  ketuaShiftId: string;
  rosterEmployeeIds: string[];
} | null> {
  const teamsSnapshot = await adminDb.collection('SatpamShiftTeams').get();
  const match = teamsSnapshot.docs.find((snapshot) => {
    const data = snapshot.data();
    return (
      data.ketuaShiftId === employeeId ||
      (Array.isArray(data.memberEmployeeIds) &&
        data.memberEmployeeIds.includes(employeeId))
    );
  });
  if (!match) return null;
  const data = match.data();
  return {
    teamId: match.id,
    ketuaShiftId: String(data.ketuaShiftId || ''),
    rosterEmployeeIds: Array.from(
      new Set<string>([
        String(data.ketuaShiftId || ''),
        ...(Array.isArray(data.memberEmployeeIds)
          ? data.memberEmployeeIds.filter(
              (value: unknown): value is string => typeof value === 'string',
            )
          : []),
      ]),
    ).filter(Boolean),
  };
}

export interface SatpamShiftRegistration {
  id: string;
  employeeId: string;
  dutyDate: string;
  shiftName: string | null;
  postId: string | null;
  postName: string | null;
  shiftType: string | null;
  assignmentKind: string | null;
  status: string;
  ketuaShiftId: string | null;
  ketuaShiftName: string | null;
  sourceOccurrenceId: string | null;
}

/**
 * Loads active shift registrations made through the Ketua Shift workflow.
 * This is deliberately computed from ActivityReports so a leave reviewer sees
 * a current warning even when the request itself was created earlier.
 */
export async function loadSatpamShiftRegistrations(
  period: string,
): Promise<SatpamShiftRegistration[]> {
  const snapshot = await adminDb
    .collection('ActivityReports')
    .where('period', '==', period)
    .get();

  return snapshot.docs
    .flatMap((document) => {
      const report = document.data();
      if (!isActiveSatpamShiftRegistration(report)) return [];
      const employeeId = String(report.employeeId || '');
      const dutyDate = String(report.dutyDate || report.activityDate || '');
      if (!employeeId || !/^\d{4}-\d{2}-\d{2}$/.test(dutyDate)) return [];
      const status = String(report.status || 'approved');
      return [{
        id: document.id,
        employeeId,
        dutyDate,
        shiftName: report.reportedShiftName || report.shiftName
          ? String(report.reportedShiftName || report.shiftName)
          : null,
        postId: report.postId ? String(report.postId) : null,
        postName: report.postName ? String(report.postName) : null,
        shiftType: report.shiftType ? String(report.shiftType) : null,
        assignmentKind: report.assignmentKind
          ? String(report.assignmentKind)
          : null,
        status,
        ketuaShiftId: report.ketuaShiftId ? String(report.ketuaShiftId) : null,
        ketuaShiftName: report.ketuaShiftName
          ? String(report.ketuaShiftName)
          : null,
        sourceOccurrenceId: report.sourceOccurrenceId
          ? String(report.sourceOccurrenceId)
          : null,
      } satisfies SatpamShiftRegistration];
    })
    .sort((left, right) =>
      `${right.dutyDate}__${right.id}`.localeCompare(
        `${left.dutyDate}__${left.id}`,
      ),
    );
}

export async function buildSatpamDutyReconciliation(
  period: string,
  now: Date = new Date(),
): Promise<SatpamDutyReconciliationView> {
  const [
    planSnapshot,
    occurrenceSnapshot,
    absenceSnapshot,
    employeeSnapshot,
    uraianSnapshot,
    shiftRegistrations,
  ] = await Promise.all([
    adminDb
      .collection(SATPAM_DUTY_PLANS_COLLECTION)
      .where('period', '==', period)
      .get(),
    adminDb
      .collection('ShiftOccurrences')
      .where('payrollPeriod', '==', period)
      .get(),
    adminDb
      .collection(SATPAM_ABSENCE_REQUESTS_COLLECTION)
      .where('period', '==', period)
      .get(),
    adminDb
      .collection('Employees_BlueCollar')
      .where('employment.jobCategory', '==', 'SATPAM')
      .get(),
    adminDb
      .collection('UraianGaji')
      .doc(`${period.replace('-', '_')}_SATPAM`)
      .get(),
    loadSatpamShiftRegistrations(period),
  ]);
  const plans: StoredSatpamDutyPlan[] = planSnapshot.docs.map((snapshot) => ({
    id: snapshot.id,
    ...(snapshot.data() as Omit<StoredSatpamDutyPlan, 'id'>),
  }));
  const employeesById = new Map(
    employeeSnapshot.docs.map((snapshot) => [
      snapshot.id,
      String(snapshot.data().name || snapshot.id),
    ]),
  );
  const reportIds = Array.from(
    new Set(
      occurrenceSnapshot.docs.flatMap((snapshot) => {
        const value = snapshot.data().reportIds;
        return Array.isArray(value)
          ? value.filter((item: unknown): item is string => typeof item === 'string')
          : [];
      }),
    ),
  );
  const reportSnapshots =
    reportIds.length > 0
      ? await adminDb.getAll(
          ...reportIds.map((reportId) =>
            adminDb.collection('ActivityReports').doc(reportId),
          ),
        )
      : [];
  const fulfilledWorkKeys = new Set<string>();
  const extraDutyKeys = new Set<string>();
  const extraDutyEmployeeIds = new Set<string>();
  const approvedAbsenceKeys = new Set<string>();
  const approvedAbsenceCounts = new Map<string, number>();
  const workedShiftCountsByEmployee = new Map<string, number>();
  const conflictKeys = new Set<string>();
  const registeredShiftKeys = new Set(
    shiftRegistrations.map((registration) =>
      satpamDutyKey(registration.employeeId, registration.dutyDate),
    ),
  );

  for (const reportSnapshot of reportSnapshots) {
    if (!reportSnapshot.exists || reportSnapshot.data()?.status !== 'approved') {
      continue;
    }
    const report = reportSnapshot.data()!;
    const employeeId = String(report.employeeId || '');
    const dutyDate = String(report.dutyDate || report.activityDate || '');
    if (!employeeId || !dutyDate) continue;
    const key = satpamDutyKey(employeeId, dutyDate);
    const shiftType = String(report.shiftType || '');
    if (
      ['Harian', 'Jumat & Libur', 'Lembur Sendiri', 'Lembur Cover'].includes(
        shiftType,
      )
    ) {
      workedShiftCountsByEmployee.set(
        employeeId,
        Number(workedShiftCountsByEmployee.get(employeeId) || 0) + 1,
      );
    }
    if (
      report.assignmentKind === 'primary' &&
      ['Harian', 'Jumat & Libur'].includes(String(report.shiftType || ''))
    ) {
      fulfilledWorkKeys.add(key);
    }
    if (['Lembur Cover', 'Lembur Sendiri'].includes(String(report.shiftType || ''))) {
      extraDutyKeys.add(`${key}__${reportSnapshot.id}`);
      extraDutyEmployeeIds.add(employeeId);
    }
  }

  for (const absenceDocument of absenceSnapshot.docs) {
    const absence = absenceDocument.data();
    if (
      absence.status !== 'approved' ||
      satpamAttendanceReportType(absence) === 'scan'
    ) {
      continue;
    }
    const employeeId = String(absence.employeeId || '');
    const dutyDate = String(absence.dutyDate || '');
    if (!employeeId || !dutyDate) continue;
    const key = satpamDutyKey(employeeId, dutyDate);
    if (
      shouldExcludeSatpamLeaveFromHarian({
        payrollExcludedFromHarian: absence.payrollExcludedFromHarian,
        hasShiftRegistration: registeredShiftKeys.has(key),
      })
    ) {
      continue;
    }
    approvedAbsenceKeys.add(key);
    approvedAbsenceCounts.set(
      employeeId,
      Number(approvedAbsenceCounts.get(employeeId) || 0) + 1,
    );
    // Approved leave is represented as paid Harian in the Uraian counts, so
    // keep the bonus comparison aligned with that persisted count.
    workedShiftCountsByEmployee.set(
      employeeId,
      Number(workedShiftCountsByEmployee.get(employeeId) || 0) + 1,
    );
    if (fulfilledWorkKeys.has(key)) conflictKeys.add(key);
  }

  const occurrencesByTeamDate = new Map<
    string,
    FirebaseFirestore.DocumentData
  >();
  for (const occurrence of occurrenceSnapshot.docs) {
    const data = occurrence.data();
    occurrencesByTeamDate.set(
      `${String(data.teamId || '')}__${String(data.dutyDate || '')}`,
      data,
    );
  }

  let allPeriodsComplete = true;
  const planViews = plans.map((plan) => {
    const pendingDutyKeys = new Set<string>();
    const unfinishedDutyKeys = new Set<string>();
    const missingOccurrenceDates: string[] = [];
    const pendingOccurrenceDates: string[] = [];
    for (const day of plan.generatedDays) {
      const occurrence = occurrencesByTeamDate.get(
        `${plan.teamId}__${day.dutyDate}`,
      );
      const shiftEnded = hasSatpamShiftEnded(
        day.dutyDate,
        day.shiftName as SatpamShiftName,
        now,
      );
      if (!shiftEnded) {
        allPeriodsComplete = false;
        day.assignments.forEach((assignment) =>
          unfinishedDutyKeys.add(satpamDutyKey(assignment.employeeId, day.dutyDate)),
        );
        continue;
      }
      if (!occurrence) {
        missingOccurrenceDates.push(day.dutyDate);
        day.assignments.forEach((assignment) =>
          pendingDutyKeys.add(satpamDutyKey(assignment.employeeId, day.dutyDate)),
        );
        continue;
      }
      if (
        ['pending_review', 'under_review'].includes(
          String(occurrence.status || occurrence.reviewStatus || ''),
        ) ||
        Number(occurrence.pendingAssignmentCount || 0) > 0
      ) {
        pendingOccurrenceDates.push(day.dutyDate);
        day.assignments.forEach((assignment) =>
          pendingDutyKeys.add(satpamDutyKey(assignment.employeeId, day.dutyDate)),
        );
      }
    }
    const employeeResults = reconcileSatpamDuties({
      employeeIds:
        plan.reconciliationEmployeeIds || plan.rosterEmployeeIds,
      planDays: plan.generatedDays,
      fulfilledWorkKeys,
      approvedAbsenceKeys,
      pendingDutyKeys,
      unfinishedDutyKeys,
      extraDutyKeys,
      period,
      monthlyTargetCapEmployeeIds: new Set([
        plan.ketuaShiftId,
        plan.fixedPost9EmployeeId,
      ]),
      workedShiftCountsByEmployee,
      periodComplete:
        plan.generatedDays.every((day) =>
          hasSatpamShiftEnded(day.dutyDate, day.shiftName, now),
        ),
    }).map((employee) => ({
      ...employee,
      employeeName: employeesById.get(employee.employeeId) || employee.employeeId,
      approvedAbsenceCount: Number(
        approvedAbsenceCounts.get(employee.employeeId) || 0,
      ),
    }));
    return {
      planId: plan.id,
      teamId: plan.teamId,
      ketuaShiftId: plan.ketuaShiftId,
      fixedPost9EmployeeId: plan.fixedPost9EmployeeId,
      status: plan.status,
      revision: plan.revision,
      lateBackfillDates: plan.lateBackfillDates || [],
      missingOccurrenceDates,
      pendingOccurrenceDates,
      employees: employeeResults,
    };
  });

  const pendingAbsenceCount = absenceSnapshot.docs.filter(
    (snapshot) =>
      snapshot.data().status === 'pending' &&
      satpamAttendanceReportType(snapshot.data()) === 'izin_resmi',
  ).length;
  const blockers: string[] = [];
  if (!uraianSnapshot.exists) {
    blockers.push('Rekap Uraian Satpam belum dibuat untuk periode ini.');
  }
  // 'pending_backfill_review' is legacy: no write path in duty-plans/route.ts
  // still produces it (a full publish always writes 'published', and neither
  // edit_day nor swap_libur_days touches status at all), and the Ketua Shift's
  // own panel already treats it as a finished publish — hides the publish
  // form (hasPublishedPlan) and labels it "Dipublikasikan (Backfill)", not
  // pending. Since nothing in the app can ever move a plan out of this status
  // again, holding the payroll gate to a stricter bar than the rest of the
  // system would permanently strand any plan still carrying it.
  if (
    plans.some(
      (plan) =>
        plan.status !== 'published' && plan.status !== 'pending_backfill_review',
    )
  ) {
    blockers.push('Ada rencana dinas yang belum berstatus dipublikasikan.');
  }
  if (planViews.some((plan) => plan.missingOccurrenceDates.length > 0)) {
    blockers.push('Ada tanggal dinas yang belum memiliki laporan regu.');
  }
  if (planViews.some((plan) => plan.pendingOccurrenceDates.length > 0)) {
    blockers.push('Ada laporan regu yang belum selesai diperiksa.');
  }
  if (pendingAbsenceCount > 0) {
    blockers.push('Ada pengajuan izin Satpam yang belum diputuskan.');
  }
  if (conflictKeys.size > 0) {
    blockers.push('Ada konflik antara izin disetujui dan laporan bekerja.');
  }
  const plannedEmployeeIds = new Set(
    plans.flatMap(
      (plan) => plan.reconciliationEmployeeIds || plan.rosterEmployeeIds,
    ),
  );
  const unassignedExternalEmployees = Array.from(extraDutyEmployeeIds)
    .filter((employeeId) => !plannedEmployeeIds.has(employeeId))
    .map((employeeId) => ({
      employeeId,
      employeeName: employeesById.get(employeeId) || employeeId,
      extraDuties: Array.from(extraDutyKeys).filter((key) =>
        key.startsWith(`${employeeId}__`),
      ).length,
      eligibleForBonus: false as const,
      bonusAmount: 0 as const,
    }));

  return {
    period,
    generatedAtIso: now.toISOString(),
    periodComplete: allPeriodsComplete && plans.length > 0,
    plans: planViews,
    pendingAbsenceCount,
    conflictCount: conflictKeys.size,
    unassignedExternalEmployees,
    blockers,
  };
}

export async function syncSatpamDutyReconciliation(
  period: string,
  actorUid = 'system',
): Promise<SatpamDutyReconciliationView> {
  const [view, approvedShiftSnapshot] = await Promise.all([
    buildSatpamDutyReconciliation(period),
    adminDb.collection('ActivityReports').where('period', '==', period).get(),
  ]);
  const shiftCountsByEmployee = new Map<
    string,
    {
      harian: number;
      jumatLibur: number;
      lemburSendiri: number;
      lemburCover: number;
    }
  >();
  const countedFinancialSources = new Set<string>();
  for (const reportSnapshot of approvedShiftSnapshot.docs) {
    const report = reportSnapshot.data();
    if (
      report.status !== 'approved' ||
      !(
        report.reportKind === 'satpam_shift_assignment' ||
        report.sourceType === 'satpam_shift' ||
        report.sourceOccurrenceId
      )
    ) {
      continue;
    }
    const employeeId = String(report.employeeId || '');
    const payType = String(report.shiftType || '');
    const sourceIdentity = String(
      report.sourceLedgerEntryId ||
        `${report.sourceOccurrenceId || ''}__${report.assignmentKey || reportSnapshot.id}`,
    );
    if (
      !employeeId ||
      countedFinancialSources.has(sourceIdentity) ||
      !['Harian', 'Jumat & Libur', 'Lembur Sendiri', 'Lembur Cover'].includes(
        payType,
      )
    ) {
      continue;
    }
    countedFinancialSources.add(sourceIdentity);
    const counts = shiftCountsByEmployee.get(employeeId) || {
      harian: 0,
      jumatLibur: 0,
      lemburSendiri: 0,
      lemburCover: 0,
    };
    if (payType === 'Harian') counts.harian += 1;
    if (payType === 'Jumat & Libur') counts.jumatLibur += 1;
    if (payType === 'Lembur Sendiri') counts.lemburSendiri += 1;
    if (payType === 'Lembur Cover') counts.lemburCover += 1;
    shiftCountsByEmployee.set(employeeId, counts);
  }
  const now = admin.firestore.FieldValue.serverTimestamp();
  const uraianRef = adminDb
    .collection('UraianGaji')
    .doc(`${period.replace('-', '_')}_SATPAM`);
  const periodRef = adminDb.collection('PayrollPeriods').doc(period);
  await adminDb.runTransaction(async (transaction) => {
    const [periodSnapshot, uraianSnapshot] = await Promise.all([
      transaction.get(periodRef),
      transaction.get(uraianRef),
    ]);
    if (periodSnapshot.data()?.attendanceStatus === 'closed') {
      throw new Error(
        `Periode payroll ${period} sudah ditutup; rekonsiliasi tidak dapat mengubah data historis.`,
      );
    }
    for (const plan of view.plans) {
      for (const employee of plan.employees) {
        const reconciliationId = `${period.replace('-', '')}__${plan.teamId}__${employee.employeeId}`;
        transaction.set(
          adminDb
            .collection(SATPAM_DUTY_RECONCILIATIONS_COLLECTION)
            .doc(reconciliationId),
          {
            period,
            teamId: plan.teamId,
            planId: plan.planId,
            planRevision: plan.revision,
            ...employee,
            generatedAt: now,
            generatedBy: actorUid,
            schemaVersion: 1,
          },
        );
      }
    }
    if (!uraianSnapshot.exists) return;
    const uraian = uraianSnapshot.data()!;
    // July 2026 is a paper-based Satpam pilot. Once an authorised Satker
    // user saves the manual bonus column, later duty-plan reconciliation must
    // refresh shift counts without replacing that explicit 0/1 decision.
    const manualSatpamBonusOverride =
      period === '2026-07' &&
      uraian.satpamMonthlyBonusManualOverride === true;
    const entries =
      uraian.entries && typeof uraian.entries === 'object'
        ? { ...(uraian.entries as Record<string, Record<string, unknown>>) }
        : {};
    const reconciledEmployeeIds = new Set<string>();
    for (const plan of view.plans) {
      for (const employee of plan.employees) {
        reconciledEmployeeIds.add(employee.employeeId);
        const existing = entries[employee.employeeId] || {};
        const existingValues =
          existing.values && typeof existing.values === 'object'
            ? { ...(existing.values as Record<string, number>) }
            : {};
        const existingCounts =
          existing.counts && typeof existing.counts === 'object'
            ? { ...(existing.counts as Record<string, number>) }
            : {};
        const normalizedExisting = normalizeSatpamUraianEntry(
          {
            ...existing,
            employeeId: employee.employeeId,
            name: employee.employeeName,
            values: existingValues,
            counts: existingCounts,
          } as UraianEntry,
          employee.employeeId === plan.ketuaShiftId,
        );
        const values = { ...normalizedExisting.values };
        const counts = { ...(normalizedExisting.counts || {}) };
        const shiftCounts = shiftCountsByEmployee.get(employee.employeeId) || {
          harian: 0,
          jumatLibur: 0,
          lemburSendiri: 0,
          lemburCover: 0,
        };
        const totalHarianCount = satpamHarianCountWithApprovedAbsences(
          shiftCounts.harian,
          employee.approvedAbsenceCount,
        );
        counts.harian = totalHarianCount;
        values.harian = totalHarianCount * SATPAM_RATES.Harian;
        counts.jumatLibur = shiftCounts.jumatLibur;
        values.jumatLibur =
          shiftCounts.jumatLibur * SATPAM_RATES['Jumat & Libur'];
        counts.lemburSendiri = shiftCounts.lemburSendiri;
        values.lemburSendiri =
          shiftCounts.lemburSendiri * SATPAM_RATES['Lembur Sendiri'];
        counts.lemburCover = shiftCounts.lemburCover;
        values.lemburCover =
          shiftCounts.lemburCover * SATPAM_RATES['Lembur Cover'];
        if (!manualSatpamBonusOverride) {
          counts.bonusPresensiBulanan = employee.bonusCount;
          values.bonusPresensiBulanan = employee.bonusAmount;
        } else {
          const preservedBonusCount = Math.max(
            0,
            Number(
              counts.bonusPresensiBulanan ??
                Number(values.bonusPresensiBulanan || 0) /
                  SATPAM_MONTHLY_ATTENDANCE_BONUS,
            ),
          );
          counts.bonusPresensiBulanan = preservedBonusCount;
          values.bonusPresensiBulanan =
            preservedBonusCount * SATPAM_MONTHLY_ATTENDANCE_BONUS;
        }
        entries[employee.employeeId] = {
          ...existing,
          employeeId: employee.employeeId,
          name: employee.employeeName,
          values,
          counts,
          satpamDutySource: {
            planId: plan.planId,
            planRevision: plan.revision,
            approvedAbsenceCount: employee.approvedAbsenceCount,
            requiredDuties: employee.requiredDuties,
            bonusTargetDuties: employee.bonusTargetDuties,
            workedShiftCount: employee.workedShiftCount,
            fulfilledDuties: employee.fulfilledDuties,
            missedDuties: employee.missedDuties,
            pendingDuties: employee.pendingDuties,
            conflictingDuties: employee.conflictingDuties,
            extraDuties: employee.extraDuties,
            approvedShiftCounts: shiftCounts,
            eligibleForBonus: employee.eligibleForBonus,
            generatedAtIso: view.generatedAtIso,
          },
        };
      }
    }
    for (const external of view.unassignedExternalEmployees) {
      if (reconciledEmployeeIds.has(external.employeeId)) continue;
      const existing = entries[external.employeeId] || {};
      const shiftCounts = shiftCountsByEmployee.get(external.employeeId) || {
        harian: 0,
        jumatLibur: 0,
        lemburSendiri: 0,
        lemburCover: 0,
      };
      const existingValues =
        existing.values && typeof existing.values === 'object'
          ? { ...(existing.values as Record<string, number>) }
          : {};
      const existingCounts =
        existing.counts && typeof existing.counts === 'object'
          ? { ...(existing.counts as Record<string, number>) }
          : {};
      const normalizedExisting = normalizeSatpamUraianEntry(
        {
          ...existing,
          employeeId: external.employeeId,
          name: external.employeeName,
          values: existingValues,
          counts: existingCounts,
        } as UraianEntry,
        false,
      );
      const values = { ...normalizedExisting.values };
      const counts = { ...(normalizedExisting.counts || {}) };
      counts.harian = shiftCounts.harian;
      values.harian = shiftCounts.harian * SATPAM_RATES.Harian;
      counts.jumatLibur = shiftCounts.jumatLibur;
      values.jumatLibur =
        shiftCounts.jumatLibur * SATPAM_RATES['Jumat & Libur'];
      counts.lemburSendiri = shiftCounts.lemburSendiri;
      values.lemburSendiri =
        shiftCounts.lemburSendiri * SATPAM_RATES['Lembur Sendiri'];
      counts.lemburCover = shiftCounts.lemburCover;
      values.lemburCover =
        shiftCounts.lemburCover * SATPAM_RATES['Lembur Cover'];
      const preservedBonusCount = manualSatpamBonusOverride
        ? Math.max(
            0,
            Number(
              counts.bonusPresensiBulanan ??
                Number(values.bonusPresensiBulanan || 0) /
                  SATPAM_MONTHLY_ATTENDANCE_BONUS,
            ),
          )
        : 0;
      counts.bonusPresensiBulanan = preservedBonusCount;
      values.bonusPresensiBulanan =
        preservedBonusCount * SATPAM_MONTHLY_ATTENDANCE_BONUS;
      entries[external.employeeId] = {
        ...existing,
        employeeId: external.employeeId,
        name: external.employeeName,
        values,
        counts,
        satpamDutySource: {
          planId: null,
          planRevision: null,
          externalSubstitute: true,
          approvedAbsenceCount: 0,
          requiredDuties: 0,
          fulfilledDuties: 0,
          missedDuties: 0,
          pendingDuties: 0,
          conflictingDuties: 0,
          extraDuties: external.extraDuties,
          eligibleForBonus: false,
          approvedShiftCounts: shiftCounts,
          generatedAtIso: view.generatedAtIso,
        },
      };
    }
    transaction.update(uraianRef, {
      entries,
      satpamDutyReconciliation: {
        generatedAtIso: view.generatedAtIso,
        blockerCount: view.blockers.length,
      },
      updatedAt: now,
    });
  });
  return view;
}

export function absenceEntitlementData(input: {
  absenceRequestId: string;
  employeeId: string;
  employeeName: string;
  dutyDate: string;
  period: string;
  teamId: string;
  planId: string;
  planRevision: number;
  approvedBy: string;
  approvedAt: FirebaseFirestore.FieldValue;
}) {
  return {
    ...input,
    payType: 'Harian',
    count: 1,
    amount: SATPAM_PAID_ABSENCE_RATE,
    sourceType: 'satpam_approved_absence',
    schemaVersion: 1,
  };
}
