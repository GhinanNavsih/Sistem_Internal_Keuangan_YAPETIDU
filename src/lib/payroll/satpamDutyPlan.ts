import {
  addCalendarDays,
  assertDateOnly,
  getShiftIsoBounds,
  SATPAM_POSTS,
  type SatpamPayType,
  type SatpamPostId,
  type SatpamShiftName,
} from '@/lib/payroll/domain';

export const SATPAM_DUTY_PLAN_SCHEMA_VERSION = 1;
export const SATPAM_DUTY_PLAN_SEED_LENGTH = 10;
export const SATPAM_PAID_ABSENCE_RATE = 12_500;
export const SATPAM_MONTHLY_ATTENDANCE_BONUS = 100_000;
export const SATPAM_DUTY_PLAN_TRIAL_PERIOD = '2026-07';

export function isSatpamDutyPlanRequired(
  period: string,
  periodData?: Record<string, unknown> | null,
): boolean {
  return (
    period === SATPAM_DUTY_PLAN_TRIAL_PERIOD ||
    periodData?.satpamDutyPlanRequired === true
  );
}

export function satpamAdvancePlanningPeriod(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    throw new Error('Waktu perencanaan Satpam tidak valid.');
  }
  const next = new Date(Date.UTC(year, month, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function isSatpamAdvancePlanningPeriod(
  period: string,
  now: Date = new Date(),
): boolean {
  return period === satpamAdvancePlanningPeriod(now);
}

export type SatpamDutyPlanStatus =
  | 'draft'
  | 'published'
  | 'pending_backfill_review'
  | 'stale';

export interface SatpamPlannedPostAssignment {
  postId: SatpamPostId;
  employeeId: string;
}

export interface SatpamDutyPlanSeedDay {
  dutyDate: string;
  shiftName: SatpamShiftName;
  assignments: SatpamPlannedPostAssignment[];
  offDutyEmployeeId: string;
}

export interface SatpamDutyPlanDay extends SatpamDutyPlanSeedDay {
  sourceSeedDate: string;
  sourceSeedIndex: number;
  cycleNumber: number;
  overridden?: boolean;
}

export interface SatpamActualPrimaryAssignment {
  postId: SatpamPostId;
  employeeId: string;
}

export interface SatpamClassifiedAssignment extends SatpamActualPrimaryAssignment {
  assignmentKind: 'primary' | 'extra';
  payType: Exclude<SatpamPayType, 'Off-Duty'>;
  coveredEmployeeId: string | null;
  scheduleRelation:
    | 'planned_post'
    | 'planned_other_post'
    | 'off_duty_cover'
    | 'external_cover'
    | 'off_duty_extra'
    | 'unresolved_extra';
}

export type SatpamDutyPlanAnomalyCode =
  | 'DUTY_PLAN_MISSING'
  | 'DUTY_PLAN_STALE'
  | 'DUTY_PLAN_BACKFILL_PENDING'
  | 'ACTUAL_ROSTER_DIFFERS'
  | 'EXTRA_NOT_OFF_DUTY'
  | 'EXTRA_WITH_INCOMPLETE_PRIMARY_ROSTER'
  | 'ABSENCE_WORK_CONFLICT';

export interface SatpamDutyReconciliationInput {
  employeeIds: readonly string[];
  planDays: readonly SatpamDutyPlanDay[];
  fulfilledWorkKeys: ReadonlySet<string>;
  approvedAbsenceKeys: ReadonlySet<string>;
  pendingDutyKeys: ReadonlySet<string>;
  unfinishedDutyKeys: ReadonlySet<string>;
  extraDutyKeys: ReadonlySet<string>;
  periodComplete: boolean;
}

export interface SatpamDutyReconciliationEmployee {
  employeeId: string;
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
}

const VALID_SHIFT_NAMES = new Set<SatpamShiftName>(['Pagi', 'Sore', 'Malam']);
const VALID_POST_IDS = new Set<string>(SATPAM_POSTS.map((post) => post.id));

export function satpamDutyPlanId(period: string, teamId: string): string {
  assertPayrollPeriod(period);
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(teamId)) {
    throw new Error('ID regu Satpam tidak valid.');
  }
  return `${period.replace('-', '')}__${teamId}`;
}

export function satpamDutyKey(employeeId: string, dutyDate: string): string {
  assertDateOnly(dutyDate);
  return `${employeeId}__${dutyDate}`;
}

export function periodDatesBetween(startsOn: string, endsOn: string): string[] {
  assertDateOnly(startsOn);
  assertDateOnly(endsOn);
  if (endsOn < startsOn) {
    throw new Error('Akhir periode tidak boleh mendahului awal periode.');
  }
  const dates: string[] = [];
  for (let date = startsOn; date <= endsOn; date = addCalendarDays(date, 1)) {
    dates.push(date);
    if (dates.length > 370) {
      throw new Error('Jendela periode terlalu panjang.');
    }
  }
  return dates;
}

export function validateAndGenerateSatpamDutyPlan(input: {
  periodStart: string;
  periodEnd: string;
  rosterEmployeeIds: readonly string[];
  seedDays: readonly SatpamDutyPlanSeedDay[];
  shiftNameForDate?: (dutyDate: string) => SatpamShiftName;
}): SatpamDutyPlanDay[] {
  const periodDates = periodDatesBetween(input.periodStart, input.periodEnd);
  if (periodDates.length < SATPAM_DUTY_PLAN_SEED_LENGTH) {
    throw new Error('Periode Satpam harus memiliki sedikitnya sepuluh tanggal.');
  }
  const roster = input.rosterEmployeeIds.map((employeeId) => employeeId.trim());
  if (
    roster.length !== SATPAM_DUTY_PLAN_SEED_LENGTH ||
    roster.some((employeeId) => !employeeId) ||
    new Set(roster).size !== SATPAM_DUTY_PLAN_SEED_LENGTH
  ) {
    throw new Error('Regu wajib berisi tepat sepuluh Satpam unik.');
  }
  if (input.seedDays.length !== SATPAM_DUTY_PLAN_SEED_LENGTH) {
    throw new Error('Lengkapi tepat sepuluh hari pola awal.');
  }

  const rosterSet = new Set(roster);
  const offDutyCounts = new Map(roster.map((employeeId) => [employeeId, 0]));
  const normalizedSeed = input.seedDays.map((day, seedIndex) => {
    const expectedDate = periodDates[seedIndex];
    if (day.dutyDate !== expectedDate) {
      throw new Error(`Hari pola ke-${seedIndex + 1} harus bertanggal ${expectedDate}.`);
    }
    if (!VALID_SHIFT_NAMES.has(day.shiftName)) {
      throw new Error(`Nama shift pada ${day.dutyDate} tidak valid.`);
    }
    if (day.assignments.length !== SATPAM_POSTS.length) {
      throw new Error(`${day.dutyDate} wajib memiliki sembilan penugasan pos.`);
    }
    const postIds = day.assignments.map((assignment) => assignment.postId);
    const assignedEmployeeIds = day.assignments.map((assignment) =>
      assignment.employeeId.trim(),
    );
    if (
      postIds.some((postId) => !VALID_POST_IDS.has(postId)) ||
      new Set(postIds).size !== SATPAM_POSTS.length
    ) {
      throw new Error(`${day.dutyDate} wajib mengisi sembilan pos secara unik.`);
    }
    const offDutyEmployeeId = day.offDutyEmployeeId.trim();
    const dailyRoster = [...assignedEmployeeIds, offDutyEmployeeId];
    if (
      dailyRoster.some((employeeId) => !rosterSet.has(employeeId)) ||
      new Set(dailyRoster).size !== SATPAM_DUTY_PLAN_SEED_LENGTH
    ) {
      throw new Error(
        `${day.dutyDate} harus memakai setiap anggota regu tepat satu kali, termasuk Off-duty.`,
      );
    }
    offDutyCounts.set(
      offDutyEmployeeId,
      Number(offDutyCounts.get(offDutyEmployeeId) || 0) + 1,
    );
    return {
      dutyDate: day.dutyDate,
      shiftName: day.shiftName,
      assignments: day.assignments.map((assignment) => ({
        postId: assignment.postId,
        employeeId: assignment.employeeId.trim(),
      })),
      offDutyEmployeeId,
    };
  });

  const invalidOffDutyRotation = Array.from(offDutyCounts.entries()).find(
    ([, count]) => count !== 1,
  );
  if (invalidOffDutyRotation) {
    throw new Error(
      'Dalam sepuluh hari awal, setiap anggota regu harus mendapat Off-duty tepat satu kali.',
    );
  }

  return periodDates.map((dutyDate, dateIndex) => {
    const sourceSeedIndex = dateIndex % SATPAM_DUTY_PLAN_SEED_LENGTH;
    const source = normalizedSeed[sourceSeedIndex];
    return {
      dutyDate,
      shiftName: input.shiftNameForDate
        ? input.shiftNameForDate(dutyDate)
        : source.shiftName,
      assignments: source.assignments.map((assignment) => ({ ...assignment })),
      offDutyEmployeeId: source.offDutyEmployeeId,
      sourceSeedDate: source.dutyDate,
      sourceSeedIndex,
      cycleNumber: Math.floor(dateIndex / SATPAM_DUTY_PLAN_SEED_LENGTH) + 1,
    };
  });
}

export function validateSatpamDutyPlanDay(
  day: SatpamDutyPlanSeedDay,
  rosterEmployeeIds: readonly string[],
): void {
  assertDateOnly(day.dutyDate);
  if (!VALID_SHIFT_NAMES.has(day.shiftName)) {
    throw new Error('Nama shift tidak valid.');
  }
  const roster = new Set(rosterEmployeeIds);
  const posts = day.assignments.map((assignment) => assignment.postId);
  const employees = [
    ...day.assignments.map((assignment) => assignment.employeeId),
    day.offDutyEmployeeId,
  ];
  if (
    roster.size !== 10 ||
    day.assignments.length !== SATPAM_POSTS.length ||
    posts.some((postId) => !VALID_POST_IDS.has(postId)) ||
    new Set(posts).size !== SATPAM_POSTS.length ||
    employees.some((employeeId) => !roster.has(employeeId)) ||
    new Set(employees).size !== 10
  ) {
    throw new Error(
      'Tanggal wajib memiliki sembilan pos dan satu Off-duty dengan petugas unik.',
    );
  }
}

export function classifySatpamDutyAssignments(input: {
  planDay: SatpamDutyPlanDay | null;
  primaryAssignments: readonly SatpamActualPrimaryAssignment[];
  extraAssignment?: SatpamActualPrimaryAssignment | null;
  regularPayType: 'Harian' | 'Jumat & Libur';
  teamRosterEmployeeIds: ReadonlySet<string>;
}): {
  assignments: SatpamClassifiedAssignment[];
  anomalyCodes: SatpamDutyPlanAnomalyCode[];
} {
  const anomalies: SatpamDutyPlanAnomalyCode[] = [];
  if (!input.planDay) {
    return {
      assignments: [
        ...input.primaryAssignments.map((assignment) => ({
          ...assignment,
          assignmentKind: 'primary' as const,
          payType: input.teamRosterEmployeeIds.has(assignment.employeeId)
            ? input.regularPayType
            : ('Lembur Cover' as const),
          coveredEmployeeId: null,
          scheduleRelation: input.teamRosterEmployeeIds.has(assignment.employeeId)
            ? ('planned_other_post' as const)
            : ('external_cover' as const),
        })),
        ...(input.extraAssignment
          ? [{
              ...input.extraAssignment,
              assignmentKind: 'extra' as const,
              payType: 'Lembur Sendiri' as const,
              coveredEmployeeId: null,
              scheduleRelation: 'unresolved_extra' as const,
            }]
          : []),
      ],
      anomalyCodes: ['DUTY_PLAN_MISSING'],
    };
  }

  const plannedByPost = new Map(
    input.planDay.assignments.map((assignment) => [
      assignment.postId,
      assignment.employeeId,
    ]),
  );
  const plannedPostByEmployee = new Map(
    input.planDay.assignments.map((assignment) => [
      assignment.employeeId,
      assignment.postId,
    ]),
  );
  const actualEmployeeIds = new Set(
    input.primaryAssignments.map((assignment) => assignment.employeeId),
  );
  const classified: SatpamClassifiedAssignment[] =
    input.primaryAssignments.map((assignment): SatpamClassifiedAssignment => {
    const plannedPost = plannedPostByEmployee.get(assignment.employeeId);
    if (plannedPost) {
      if (plannedPost !== assignment.postId) {
        anomalies.push('ACTUAL_ROSTER_DIFFERS');
      }
      return {
        ...assignment,
        assignmentKind: 'primary' as const,
        payType: input.regularPayType,
        coveredEmployeeId: null,
        scheduleRelation:
          plannedPost === assignment.postId
            ? ('planned_post' as const)
            : ('planned_other_post' as const),
      };
    }
    const plannedEmployeeForPost = plannedByPost.get(assignment.postId) || null;
    anomalies.push('ACTUAL_ROSTER_DIFFERS');
    return {
      ...assignment,
      assignmentKind: 'primary' as const,
      payType: 'Lembur Cover' as const,
      coveredEmployeeId:
        plannedEmployeeForPost && !actualEmployeeIds.has(plannedEmployeeForPost)
          ? plannedEmployeeForPost
          : null,
      scheduleRelation:
        assignment.employeeId === input.planDay!.offDutyEmployeeId
          ? ('off_duty_cover' as const)
          : ('external_cover' as const),
    };
    });

  if (input.extraAssignment) {
    const distinctPosts = new Set(
      input.primaryAssignments.map((assignment) => assignment.postId),
    );
    const distinctGuards = new Set(
      input.primaryAssignments.map((assignment) => assignment.employeeId),
    );
    const completePrimaryRoster =
      distinctPosts.size === SATPAM_POSTS.length &&
      distinctGuards.size === SATPAM_POSTS.length;
    const isPlannedOffDuty =
      input.extraAssignment.employeeId === input.planDay.offDutyEmployeeId;
    if (!completePrimaryRoster) {
      anomalies.push('EXTRA_WITH_INCOMPLETE_PRIMARY_ROSTER');
    }
    if (!isPlannedOffDuty) {
      anomalies.push('EXTRA_NOT_OFF_DUTY');
    }
    classified.push({
      ...input.extraAssignment,
      assignmentKind: 'extra',
      payType: 'Lembur Sendiri',
      coveredEmployeeId: null,
      scheduleRelation:
        completePrimaryRoster && isPlannedOffDuty
          ? 'off_duty_extra'
          : 'unresolved_extra',
    });
  }

  return {
    assignments: classified,
    anomalyCodes: Array.from(new Set(anomalies)),
  };
}

export function isSatpamPlanDayStarted(
  day: Pick<SatpamDutyPlanDay, 'dutyDate' | 'shiftName'>,
  now: Date = new Date(),
): boolean {
  const { startsAtIso } = getShiftIsoBounds(day.dutyDate, day.shiftName);
  return new Date(startsAtIso).getTime() <= now.getTime();
}

export function reconcileSatpamDuties(
  input: SatpamDutyReconciliationInput,
): SatpamDutyReconciliationEmployee[] {
  return input.employeeIds.map((employeeId) => {
    const requiredKeys = input.planDays
      .filter((day) =>
        day.assignments.some((assignment) => assignment.employeeId === employeeId),
      )
      .map((day) => satpamDutyKey(employeeId, day.dutyDate));
    const workKeys = requiredKeys.filter((key) => input.fulfilledWorkKeys.has(key));
    const absenceKeys = requiredKeys.filter((key) =>
      input.approvedAbsenceKeys.has(key),
    );
    const conflictingKeys = requiredKeys.filter(
      (key) =>
        input.fulfilledWorkKeys.has(key) && input.approvedAbsenceKeys.has(key),
    );
    const fulfilledKeys = new Set([...workKeys, ...absenceKeys]);
    const pendingKeys = requiredKeys.filter(
      (key) =>
        !fulfilledKeys.has(key) &&
        (input.pendingDutyKeys.has(key) || input.unfinishedDutyKeys.has(key)),
    );
    const missedKeys = requiredKeys.filter(
      (key) => !fulfilledKeys.has(key) && !pendingKeys.includes(key),
    );
    const extraDuties = Array.from(input.extraDutyKeys).filter((key) =>
      key.startsWith(`${employeeId}__`),
    ).length;
    const eligibleForBonus =
      input.periodComplete &&
      requiredKeys.length > 0 &&
      fulfilledKeys.size >= requiredKeys.length &&
      pendingKeys.length === 0 &&
      conflictingKeys.length === 0;
    return {
      employeeId,
      requiredDuties: requiredKeys.length,
      fulfilledDuties: fulfilledKeys.size,
      fulfilledByWork: workKeys.length,
      fulfilledByAbsence: absenceKeys.filter(
        (key) => !input.fulfilledWorkKeys.has(key),
      ).length,
      missedDuties: missedKeys.length,
      pendingDuties: pendingKeys.length,
      conflictingDuties: conflictingKeys.length,
      extraDuties,
      eligibleForBonus,
      bonusCount: eligibleForBonus ? 1 : 0,
      bonusAmount: eligibleForBonus ? SATPAM_MONTHLY_ATTENDANCE_BONUS : 0,
    };
  });
}

function assertPayrollPeriod(period: string): void {
  if (!/^\d{4}-\d{2}$/.test(period)) {
    throw new Error('Periode wajib menggunakan format YYYY-MM.');
  }
}
