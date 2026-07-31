import {
  addCalendarDays,
  assertDateOnly,
  getShiftIsoBounds,
  SATPAM_POSTS,
  type SatpamPayType,
  type SatpamPostId,
  type SatpamShiftName,
} from '@/lib/payroll/domain';

export const SATPAM_DUTY_PLAN_SCHEMA_VERSION = 2;
export const SATPAM_DUTY_PLAN_ROTATION_VERSION = 'SATPAM-8DAY-V1';
export const SATPAM_DUTY_PLAN_SEED_LENGTH = 8;
export const SATPAM_PAID_ABSENCE_RATE = 12_500;
export const SATPAM_MONTHLY_ATTENDANCE_BONUS = 100_000;
export const SATPAM_DUTY_PLAN_TRIAL_PERIOD = '2026-07';

export const SATPAM_ROTATING_POST_IDS = [
  'Pos 1',
  'Pos 8',
  'Pos 6',
  'Pos 5',
  'Pos 7',
  'Pos 4',
  'Pos 3',
] as const satisfies readonly SatpamPostId[];
export const SATPAM_ROTATION_SLOTS = [
  ...SATPAM_ROTATING_POST_IDS,
  'Off-Duty',
] as const;
export const SATPAM_KETUA_POST_ID = 'Pos 2' as const satisfies SatpamPostId;
export const SATPAM_FIXED_POST_ID = 'Pos 9' as const satisfies SatpamPostId;

export type SatpamRotationSlot = (typeof SATPAM_ROTATION_SLOTS)[number];

export interface SatpamRotationSlotAssignment {
  slot: SatpamRotationSlot;
  employeeId: string;
}

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

export interface SatpamDutyPlanGeneration {
  rotatingEmployeeIds: string[];
  seedDays: SatpamDutyPlanDay[];
  generatedDays: SatpamDutyPlanDay[];
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

function normalizeRotationStart(input: {
  rosterEmployeeIds: readonly string[];
  ketuaShiftId: string;
  fixedPost9EmployeeId: string;
  firstDayAssignments: readonly SatpamRotationSlotAssignment[];
}): { roster: string[]; rotatingEmployeeIds: string[] } {
  const roster = input.rosterEmployeeIds.map((employeeId) => employeeId.trim());
  const ketuaShiftId = input.ketuaShiftId.trim();
  const fixedPost9EmployeeId = input.fixedPost9EmployeeId.trim();
  if (
    roster.length !== 10 ||
    roster.some((employeeId) => !employeeId) ||
    new Set(roster).size !== 10
  ) {
    throw new Error('Regu wajib berisi tepat sepuluh Satpam unik.');
  }
  const rosterSet = new Set(roster);
  if (!rosterSet.has(ketuaShiftId)) {
    throw new Error('Ketua Shift tidak terdaftar dalam roster regu.');
  }
  if (
    !rosterSet.has(fixedPost9EmployeeId) ||
    fixedPost9EmployeeId === ketuaShiftId
  ) {
    throw new Error('Petugas tetap Pos 9 wajib dipilih dari anggota selain Ketua Shift.');
  }
  if (input.firstDayAssignments.length !== SATPAM_DUTY_PLAN_SEED_LENGTH) {
    throw new Error('Susunan tanggal pertama wajib mengisi tujuh pos dan satu Libur.');
  }
  const slots = input.firstDayAssignments.map((assignment) => assignment.slot);
  if (
    slots.some(
      (slot) => !(SATPAM_ROTATION_SLOTS as readonly string[]).includes(slot),
    ) ||
    new Set(slots).size !== SATPAM_DUTY_PLAN_SEED_LENGTH
  ) {
    throw new Error('Setiap slot rotasi wajib diisi tepat satu kali.');
  }
  const employeeBySlot = new Map(
    input.firstDayAssignments.map((assignment) => [
      assignment.slot,
      assignment.employeeId.trim(),
    ]),
  );
  const rotatingEmployeeIds = SATPAM_ROTATION_SLOTS.map(
    (slot) => employeeBySlot.get(slot) || '',
  );
  const expectedRotatingIds = roster.filter(
    (employeeId) =>
      employeeId !== ketuaShiftId && employeeId !== fixedPost9EmployeeId,
  );
  if (
    rotatingEmployeeIds.some((employeeId) => !employeeId) ||
    new Set(rotatingEmployeeIds).size !== SATPAM_DUTY_PLAN_SEED_LENGTH ||
    rotatingEmployeeIds.some(
      (employeeId) => !expectedRotatingIds.includes(employeeId),
    ) ||
    expectedRotatingIds.some(
      (employeeId) => !rotatingEmployeeIds.includes(employeeId),
    )
  ) {
    throw new Error(
      'Delapan anggota selain Ketua dan petugas tetap Pos 9 harus dipakai tepat satu kali.',
    );
  }
  return { roster, rotatingEmployeeIds };
}

function buildCanonicalSeedDay(input: {
  dutyDate: string;
  shiftName: SatpamShiftName;
  seedIndex: number;
  ketuaShiftId: string;
  fixedPost9EmployeeId: string;
  rotatingEmployeeIds: readonly string[];
}): SatpamDutyPlanDay {
  const employeeForSlot = (slotIndex: number) =>
    input.rotatingEmployeeIds[
      (slotIndex - input.seedIndex + SATPAM_DUTY_PLAN_SEED_LENGTH) %
        SATPAM_DUTY_PLAN_SEED_LENGTH
    ];
  const rotatingByPost = new Map<SatpamPostId, string>(
    SATPAM_ROTATING_POST_IDS.map((postId, slotIndex) => [
      postId,
      employeeForSlot(slotIndex),
    ]),
  );
  return {
    dutyDate: input.dutyDate,
    shiftName: input.shiftName,
    assignments: SATPAM_POSTS.map((post) => ({
      postId: post.id,
      employeeId:
        post.id === SATPAM_KETUA_POST_ID
          ? input.ketuaShiftId
          : post.id === SATPAM_FIXED_POST_ID
            ? input.fixedPost9EmployeeId
            : rotatingByPost.get(post.id) || '',
    })),
    offDutyEmployeeId: employeeForSlot(SATPAM_DUTY_PLAN_SEED_LENGTH - 1),
    sourceSeedDate: input.dutyDate,
    sourceSeedIndex: input.seedIndex,
    cycleNumber: 1,
  };
}

export function validateAndGenerateSatpamDutyPlan(input: {
  periodStart: string;
  periodEnd: string;
  rosterEmployeeIds: readonly string[];
  ketuaShiftId: string;
  fixedPost9EmployeeId: string;
  firstDayAssignments: readonly SatpamRotationSlotAssignment[];
  shiftNameForDate?: (dutyDate: string) => SatpamShiftName;
}): SatpamDutyPlanGeneration {
  const periodDates = periodDatesBetween(input.periodStart, input.periodEnd);
  if (periodDates.length < SATPAM_DUTY_PLAN_SEED_LENGTH) {
    throw new Error('Periode Satpam harus memiliki sedikitnya delapan tanggal.');
  }
  const { rotatingEmployeeIds } = normalizeRotationStart(input);
  const seedDays = periodDates
    .slice(0, SATPAM_DUTY_PLAN_SEED_LENGTH)
    .map((dutyDate, seedIndex) => {
      const shiftName = input.shiftNameForDate
        ? input.shiftNameForDate(dutyDate)
        : 'Pagi';
      if (!VALID_SHIFT_NAMES.has(shiftName)) {
        throw new Error(`Nama shift pada ${dutyDate} tidak valid.`);
      }
      return buildCanonicalSeedDay({
        dutyDate,
        shiftName,
        seedIndex,
        ketuaShiftId: input.ketuaShiftId.trim(),
        fixedPost9EmployeeId: input.fixedPost9EmployeeId.trim(),
        rotatingEmployeeIds,
      });
    });
  const generatedDays = periodDates.map((dutyDate, dateIndex) => {
    const sourceSeedIndex = dateIndex % SATPAM_DUTY_PLAN_SEED_LENGTH;
    const source = seedDays[sourceSeedIndex];
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
  return {
    rotatingEmployeeIds: [...rotatingEmployeeIds],
    seedDays,
    generatedDays,
  };
}

export function nextSatpamRotationAssignments(
  previousDay: SatpamDutyPlanSeedDay,
): SatpamRotationSlotAssignment[] {
  const employeeByPreviousSlot = new Map<SatpamRotationSlot, string>();
  for (const postId of SATPAM_ROTATING_POST_IDS) {
    const employeeId = previousDay.assignments.find(
      (assignment) => assignment.postId === postId,
    )?.employeeId;
    if (!employeeId) {
      throw new Error('Rencana sebelumnya tidak memiliki susunan rotasi lengkap.');
    }
    employeeByPreviousSlot.set(postId, employeeId);
  }
  if (!previousDay.offDutyEmployeeId) {
    throw new Error('Rencana sebelumnya tidak memiliki petugas Libur.');
  }
  employeeByPreviousSlot.set('Off-Duty', previousDay.offDutyEmployeeId);
  return SATPAM_ROTATION_SLOTS.map((slot, slotIndex) => ({
    slot,
    employeeId: employeeByPreviousSlot.get(
      SATPAM_ROTATION_SLOTS[
        (slotIndex - 1 + SATPAM_DUTY_PLAN_SEED_LENGTH) %
          SATPAM_DUTY_PLAN_SEED_LENGTH
      ],
    )!,
  }));
}

export function validateSatpamDutyPlanDay(
  day: SatpamDutyPlanSeedDay,
  rosterEmployeeIds: readonly string[],
  fixedRoles?: {
    ketuaShiftId: string;
    fixedPost9EmployeeId: string;
  },
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
  if (fixedRoles) {
    const employeeByPost = new Map(
      day.assignments.map((assignment) => [assignment.postId, assignment.employeeId]),
    );
    if (employeeByPost.get(SATPAM_KETUA_POST_ID) !== fixedRoles.ketuaShiftId) {
      throw new Error('Pos 2 wajib tetap diisi Ketua Shift.');
    }
    if (
      employeeByPost.get(SATPAM_FIXED_POST_ID) !==
      fixedRoles.fixedPost9EmployeeId
    ) {
      throw new Error('Pos 9 wajib tetap diisi petugas tetap periode ini.');
    }
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
