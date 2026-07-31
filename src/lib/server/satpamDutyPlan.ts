import admin, { adminDb } from '@/lib/firebase-admin';
import {
  hasSatpamShiftEnded,
  SATPAM_RATES,
  type SatpamShiftName,
} from '@/lib/payroll/domain';
import {
  reconcileSatpamDuties,
  satpamDutyKey,
  satpamDutyPlanId,
  SATPAM_PAID_ABSENCE_RATE,
  type SatpamDutyPlanDay,
  type SatpamDutyPlanStatus,
  type SatpamRotationSlotAssignment,
} from '@/lib/payroll/satpamDutyPlan';

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
  acknowledgedBackfillDates: string[];
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
    status: SatpamDutyPlanStatus;
    revision: number;
    lateBackfillDates: string[];
    acknowledgedBackfillDates: string[];
    missingOccurrenceDates: string[];
    pendingOccurrenceDates: string[];
    employees: Array<{
      employeeId: string;
      employeeName: string;
      requiredDuties: number;
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
  const conflictKeys = new Set<string>();

  for (const reportSnapshot of reportSnapshots) {
    if (!reportSnapshot.exists || reportSnapshot.data()?.status !== 'approved') {
      continue;
    }
    const report = reportSnapshot.data()!;
    const employeeId = String(report.employeeId || '');
    const dutyDate = String(report.dutyDate || report.activityDate || '');
    if (!employeeId || !dutyDate) continue;
    const key = satpamDutyKey(employeeId, dutyDate);
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
    if (absence.status !== 'approved') continue;
    const employeeId = String(absence.employeeId || '');
    const dutyDate = String(absence.dutyDate || '');
    if (!employeeId || !dutyDate) continue;
    const key = satpamDutyKey(employeeId, dutyDate);
    approvedAbsenceKeys.add(key);
    approvedAbsenceCounts.set(
      employeeId,
      Number(approvedAbsenceCounts.get(employeeId) || 0) + 1,
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
      status: plan.status,
      revision: plan.revision,
      lateBackfillDates: plan.lateBackfillDates || [],
      acknowledgedBackfillDates: plan.acknowledgedBackfillDates || [],
      missingOccurrenceDates,
      pendingOccurrenceDates,
      employees: employeeResults,
    };
  });

  const pendingAbsenceCount = absenceSnapshot.docs.filter(
    (snapshot) => snapshot.data().status === 'pending',
  ).length;
  const blockers: string[] = [];
  if (!uraianSnapshot.exists) {
    blockers.push('Rekap Uraian Satpam belum dibuat untuk periode ini.');
  }
  if (plans.some((plan) => plan.status !== 'published')) {
    blockers.push('Ada rencana dinas yang belum berstatus dipublikasikan.');
  }
  if (
    plans.some((plan) =>
      (plan.lateBackfillDates || []).some(
        (date) => !(plan.acknowledgedBackfillDates || []).includes(date),
      ),
    )
  ) {
    blockers.push('Ada tanggal backfill yang belum dikonfirmasi Kepala SatKer.');
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
  const reconciliationBatch = adminDb.batch();
  let reconciliationWriteCount = 0;
  for (const plan of view.plans) {
    for (const employee of plan.employees) {
      const reconciliationId = `${period.replace('-', '')}__${plan.teamId}__${employee.employeeId}`;
      reconciliationBatch.set(
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
      reconciliationWriteCount += 1;
    }
  }
  if (reconciliationWriteCount > 0) {
    await reconciliationBatch.commit();
  }

  const uraianRef = adminDb
    .collection('UraianGaji')
    .doc(`${period.replace('-', '_')}_SATPAM`);
  await adminDb.runTransaction(async (transaction) => {
    const uraianSnapshot = await transaction.get(uraianRef);
    if (!uraianSnapshot.exists) return;
    const uraian = uraianSnapshot.data()!;
    const entries =
      uraian.entries && typeof uraian.entries === 'object'
        ? { ...(uraian.entries as Record<string, Record<string, unknown>>) }
        : {};
    const reconciledEmployeeIds = new Set<string>();
    for (const plan of view.plans) {
      for (const employee of plan.employees) {
        reconciledEmployeeIds.add(employee.employeeId);
        const existing = entries[employee.employeeId] || {};
        const values =
          existing.values && typeof existing.values === 'object'
            ? { ...(existing.values as Record<string, number>) }
            : {};
        const counts =
          existing.counts && typeof existing.counts === 'object'
            ? { ...(existing.counts as Record<string, number>) }
            : {};
        const shiftCounts = shiftCountsByEmployee.get(employee.employeeId) || {
          harian: 0,
          jumatLibur: 0,
          lemburSendiri: 0,
          lemburCover: 0,
        };
        const totalHarianCount =
          shiftCounts.harian + employee.approvedAbsenceCount;
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
        counts.bonusPresensiBulanan = employee.bonusCount;
        values.bonusPresensiBulanan = employee.bonusAmount;
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
      const values =
        existing.values && typeof existing.values === 'object'
          ? { ...(existing.values as Record<string, number>) }
          : {};
      const counts =
        existing.counts && typeof existing.counts === 'object'
          ? { ...(existing.counts as Record<string, number>) }
          : {};
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
      counts.bonusPresensiBulanan = 0;
      values.bonusPresensiBulanan = 0;
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
