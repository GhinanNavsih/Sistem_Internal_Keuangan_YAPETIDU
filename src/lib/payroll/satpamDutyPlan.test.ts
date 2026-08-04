import assert from 'node:assert/strict';
import test from 'node:test';
import { SATPAM_POSTS } from './domain';
import {
  applyLiburDateSwap,
  classifySatpamDutyAssignments,
  findFirstUpcomingSwapDate,
  isSatpamAdvancePlanningPeriod,
  isSatpamDutyPlanRequired,
  nextSatpamRotationAssignments,
  reconcileSatpamDuties,
  satpamDutyKey,
  SATPAM_DUTY_PLAN_ROTATION_VERSION,
  SATPAM_FIXED_POST_ID,
  SATPAM_KETUA_POST_ID,
  SATPAM_MONTHLY_ATTENDANCE_BONUS,
  SATPAM_PAID_ABSENCE_RATE,
  SATPAM_ROTATION_SLOTS,
  validateAndGenerateSatpamDutyPlan,
  validateSatpamDutyPlanDay,
  type SatpamDutyPlanDay,
  type SatpamRotationSlotAssignment,
} from './satpamDutyPlan';

const roster = Array.from({ length: 10 }, (_, index) =>
  `SAT-${String(index + 1).padStart(2, '0')}`,
);

test('July 2026 is an explicit Satpam trial period', () => {
  assert.equal(isSatpamDutyPlanRequired('2026-07', null), true);
  assert.equal(isSatpamDutyPlanRequired('2026-06', null), false);
  assert.equal(
    isSatpamDutyPlanRequired('2026-08', {
      satpamDutyPlanRequired: true,
    }),
    true,
  );
});

test('Ketua may plan exactly the next Jakarta calendar month', () => {
  const julyInstant = new Date('2026-07-30T12:00:00+07:00');
  assert.equal(isSatpamAdvancePlanningPeriod('2026-08', julyInstant), true);
  assert.equal(isSatpamAdvancePlanningPeriod('2026-09', julyInstant), false);

  const yearEnd = new Date('2026-12-31T23:30:00+07:00');
  assert.equal(isSatpamAdvancePlanningPeriod('2027-01', yearEnd), true);
});

const ketuaShiftId = roster[0];
const fixedPost9EmployeeId = roster[1];

function firstDayAssignments(): SatpamRotationSlotAssignment[] {
  return SATPAM_ROTATION_SLOTS.map((slot, index) => ({
    slot,
    employeeId: roster[index + 2],
  }));
}

function generatePlan(periodStart = '2026-08-01', periodEnd = '2026-08-23') {
  return validateAndGenerateSatpamDutyPlan({
    periodStart,
    periodEnd,
    rosterEmployeeIds: roster,
    ketuaShiftId,
    fixedPost9EmployeeId,
    firstDayAssignments: firstDayAssignments(),
  });
}

test('eight-day seed follows the canonical sequence and repeats on day nine', () => {
  const { generatedDays: days, seedDays, rotatingEmployeeIds } = generatePlan();

  assert.equal(SATPAM_DUTY_PLAN_ROTATION_VERSION, 'SATPAM-8DAY-V1');
  assert.equal(seedDays.length, 8);
  assert.deepEqual(rotatingEmployeeIds, roster.slice(2));
  assert.equal(days.length, 23);
  assert.equal(days[8].dutyDate, '2026-08-09');
  assert.equal(days[8].offDutyEmployeeId, days[0].offDutyEmployeeId);
  assert.deepEqual(days[8].assignments, days[0].assignments);
  assert.equal(days[16].offDutyEmployeeId, days[0].offDutyEmployeeId);
  assert.deepEqual(days[22].assignments, days[6].assignments);
  assert.equal(days[22].cycleNumber, 3);

  const firstGuard = roster[2];
  const expectedPosts = ['Pos 1', 'Pos 8', 'Pos 6', 'Pos 5', 'Pos 7', 'Pos 4', 'Pos 3'];
  expectedPosts.forEach((postId, dayIndex) => {
    assert.equal(
      days[dayIndex].assignments.find(
        (assignment) => assignment.employeeId === firstGuard,
      )?.postId,
      postId,
    );
  });
  assert.equal(days[7].offDutyEmployeeId, firstGuard);
});

test('Ketua and fixed Pos 9 guard work every day while each rotating guard rests once', () => {
  const { seedDays } = generatePlan('2026-08-01', '2026-08-08');
  for (const day of seedDays) {
    assert.equal(
      day.assignments.find((assignment) => assignment.postId === SATPAM_KETUA_POST_ID)
        ?.employeeId,
      ketuaShiftId,
    );
    assert.equal(
      day.assignments.find((assignment) => assignment.postId === SATPAM_FIXED_POST_ID)
        ?.employeeId,
      fixedPost9EmployeeId,
    );
  }
  assert.deepEqual(
    seedDays.map((day) => day.offDutyEmployeeId).sort(),
    roster.slice(2).sort(),
  );
});

test('rotation continuation advances every guard from the prior final day', () => {
  const july = generatePlan('2026-06-26', '2026-07-31');
  const continued = nextSatpamRotationAssignments(july.generatedDays.at(-1)!);
  const august = validateAndGenerateSatpamDutyPlan({
    periodStart: '2026-08-01',
    periodEnd: '2026-08-08',
    rosterEmployeeIds: roster,
    ketuaShiftId,
    fixedPost9EmployeeId,
    firstDayAssignments: continued,
  });
  assert.equal(
    august.generatedDays[0].offDutyEmployeeId,
    july.generatedDays[4].offDutyEmployeeId,
  );
  assert.deepEqual(august.generatedDays[0].assignments, july.generatedDays[4].assignments);
});

test('manual start requires all eight rotating members exactly once', () => {
  const invalidStart = firstDayAssignments();
  invalidStart[7] = { ...invalidStart[7], employeeId: invalidStart[0].employeeId };
  assert.throws(
    () =>
      validateAndGenerateSatpamDutyPlan({
        periodStart: '2026-08-01',
        periodEnd: '2026-08-31',
        rosterEmployeeIds: roster,
        ketuaShiftId,
        fixedPost9EmployeeId,
        firstDayAssignments: invalidStart,
      }),
    /harus dipakai tepat satu kali/,
  );
});

test('fixed roles must be valid and cannot be changed by a daily plan edit', () => {
  assert.throws(
    () =>
      validateAndGenerateSatpamDutyPlan({
        periodStart: '2026-08-01',
        periodEnd: '2026-08-08',
        rosterEmployeeIds: roster,
        ketuaShiftId,
        fixedPost9EmployeeId: ketuaShiftId,
        firstDayAssignments: firstDayAssignments(),
      }),
    /petugas tetap Pos 9/i,
  );

  const day = generatePlan('2026-08-01', '2026-08-08').generatedDays[0];
  const invalidDay = {
    ...day,
    assignments: day.assignments.map((assignment) =>
      assignment.postId === SATPAM_KETUA_POST_ID
        ? { ...assignment, employeeId: roster[2] }
        : assignment.employeeId === roster[2]
          ? { ...assignment, employeeId: ketuaShiftId }
        : assignment,
    ),
  };
  assert.throws(
    () =>
      validateSatpamDutyPlanDay(invalidDay, roster, {
        ketuaShiftId,
        fixedPost9EmployeeId,
      }),
    /Pos 2 wajib tetap diisi Ketua Shift/,
  );
});

test('Libur swap uses the first eligible upcoming date and preserves duty counts', () => {
  const original = generatePlan('2026-08-01', '2026-08-16').generatedDays;
  const dateXDay = original[0];
  const guardAId = dateXDay.assignments.find(
    (assignment) => assignment.postId === 'Pos 1',
  )!.employeeId;
  const guardBId = dateXDay.offDutyEmployeeId;
  const dateY = findFirstUpcomingSwapDate(
    original,
    dateXDay.dutyDate,
    guardAId,
    guardBId,
  );

  assert.equal(dateY, '2026-08-08');
  const dateYBefore = original.find((day) => day.dutyDate === dateY)!;
  const guardBPostOnDateY = dateYBefore.assignments.find(
    (assignment) => assignment.employeeId === guardBId,
  )!.postId;
  const workCount = (days: readonly SatpamDutyPlanDay[], employeeId: string) =>
    days.filter((day) =>
      day.assignments.some((assignment) => assignment.employeeId === employeeId),
    ).length;

  const swapped = applyLiburDateSwap(
    original,
    dateXDay.dutyDate,
    dateY!,
    guardAId,
    guardBId,
    'Pos 1',
  );
  const dateXAfter = swapped[0];
  const dateYAfter = swapped.find((day) => day.dutyDate === dateY)!;

  assert.equal(
    dateXAfter.assignments.find((assignment) => assignment.postId === 'Pos 1')
      ?.employeeId,
    guardBId,
  );
  assert.equal(dateXAfter.offDutyEmployeeId, guardAId);
  assert.equal(
    dateYAfter.assignments.find(
      (assignment) => assignment.postId === guardBPostOnDateY,
    )?.employeeId,
    guardAId,
  );
  assert.equal(dateYAfter.offDutyEmployeeId, guardBId);
  assert.equal(workCount(swapped, guardAId), workCount(original, guardAId));
  assert.equal(workCount(swapped, guardBId), workCount(original, guardBId));
  assert.equal(original[0].offDutyEmployeeId, guardBId, 'input must stay immutable');
});

test('Libur swap returns no candidate when Guard A has no later Libur date', () => {
  const days = generatePlan('2026-08-01', '2026-08-08').generatedDays;
  const dateXDay = days.at(-1)!;
  const guardAId = dateXDay.assignments.find(
    (assignment) => assignment.postId === 'Pos 1',
  )!.employeeId;
  assert.equal(
    findFirstUpcomingSwapDate(
      days,
      dateXDay.dutyDate,
      guardAId,
      dateXDay.offDutyEmployeeId,
    ),
    null,
  );
});

test('server classification distinguishes regular, Cover, and Lembur Sendiri', () => {
  const [planDay] = generatePlan('2026-08-01', '2026-08-08').generatedDays;
  const moved = [
    { ...planDay.assignments[0], postId: planDay.assignments[1].postId },
    { ...planDay.assignments[1], postId: planDay.assignments[0].postId },
    ...planDay.assignments.slice(2),
  ];
  const movedResult = classifySatpamDutyAssignments({
    planDay,
    primaryAssignments: moved,
    regularPayType: 'Harian',
    teamRosterEmployeeIds: new Set(roster),
  });
  assert.equal(movedResult.assignments[0].payType, 'Harian');
  assert.equal(
    movedResult.assignments[0].scheduleRelation,
    'planned_other_post',
  );

  const coveredEmployee = planDay.assignments[0].employeeId;
  const coverResult = classifySatpamDutyAssignments({
    planDay,
    primaryAssignments: [
      {
        postId: planDay.assignments[0].postId,
        employeeId: planDay.offDutyEmployeeId,
      },
      ...planDay.assignments.slice(1),
    ],
    regularPayType: 'Harian',
    teamRosterEmployeeIds: new Set(roster),
  });
  assert.equal(coverResult.assignments[0].payType, 'Lembur Cover');
  assert.equal(coverResult.assignments[0].coveredEmployeeId, coveredEmployee);

  const extraResult = classifySatpamDutyAssignments({
    planDay,
    primaryAssignments: planDay.assignments,
    extraAssignment: {
      postId: SATPAM_POSTS[0].id,
      employeeId: planDay.offDutyEmployeeId,
    },
    regularPayType: 'Harian',
    teamRosterEmployeeIds: new Set(roster),
  });
  const extra = extraResult.assignments.at(-1);
  assert.equal(extra?.payType, 'Lembur Sendiri');
  assert.equal(extra?.scheduleRelation, 'off_duty_extra');
  assert.deepEqual(extraResult.anomalyCodes, []);
});

test('Ketua Shift may choose Harian or Lembur Sendiri on their own post', () => {
  const [planDay] = generatePlan('2026-08-01', '2026-08-08').generatedDays;
  const ketuaAssignments = planDay.assignments.map((assignment) =>
    assignment.postId === SATPAM_KETUA_POST_ID
      ? { ...assignment, shiftType: 'Harian' as const }
      : assignment,
  );
  const regular = classifySatpamDutyAssignments({
    planDay,
    primaryAssignments: ketuaAssignments,
    regularPayType: 'Jumat & Libur',
    teamRosterEmployeeIds: new Set(roster),
    ketuaShiftId,
  });
  const regularKetua = regular.assignments.find(
    (assignment) => assignment.employeeId === ketuaShiftId,
  );
  assert.equal(regularKetua?.payType, 'Harian');

  const self = classifySatpamDutyAssignments({
    planDay,
    primaryAssignments: ketuaAssignments.map((assignment) =>
      assignment.employeeId === ketuaShiftId
        ? { ...assignment, shiftType: 'Lembur Sendiri' as const }
        : assignment,
    ),
    regularPayType: 'Harian',
    teamRosterEmployeeIds: new Set(roster),
    ketuaShiftId,
  });
  const selfKetua = self.assignments.find(
    (assignment) => assignment.employeeId === ketuaShiftId,
  );
  assert.equal(selfKetua?.payType, 'Lembur Sendiri');
  assert.equal(selfKetua?.coveredEmployeeId, null);

  const noPlan = classifySatpamDutyAssignments({
    planDay: null,
    primaryAssignments: [
      {
        postId: SATPAM_KETUA_POST_ID,
        employeeId: ketuaShiftId,
        shiftType: 'Lembur Sendiri',
      },
    ],
    regularPayType: 'Jumat & Libur',
    teamRosterEmployeeIds: new Set(roster),
    ketuaShiftId,
  });
  assert.equal(noPlan.assignments[0]?.payType, 'Lembur Sendiri');
});

test('a cross-team Pos 9 guard defaults to Harian and may use either overtime type', () => {
  const [planDay] = generatePlan('2026-08-01', '2026-08-08').generatedDays;
  const otherTeamPos9 = 'SAT-99';
  const pos9Replaced = planDay.assignments.map((assignment) =>
    assignment.postId === SATPAM_FIXED_POST_ID
      ? { ...assignment, employeeId: otherTeamPos9, shiftType: 'Harian' as const }
      : assignment,
  );
  const pos9Guards = new Set([fixedPost9EmployeeId, otherTeamPos9]);

  const regular = classifySatpamDutyAssignments({
    planDay,
    primaryAssignments: pos9Replaced,
    regularPayType: 'Jumat & Libur',
    teamRosterEmployeeIds: new Set(roster),
    pos9GuardIds: pos9Guards,
  });
  assert.equal(
    regular.assignments.find((assignment) => assignment.postId === SATPAM_FIXED_POST_ID)?.payType,
    'Harian',
  );

  const self = classifySatpamDutyAssignments({
    planDay,
    primaryAssignments: pos9Replaced.map((assignment) =>
      assignment.postId === SATPAM_FIXED_POST_ID
        ? { ...assignment, shiftType: 'Lembur Sendiri' as const }
        : assignment,
    ),
    regularPayType: 'Harian',
    teamRosterEmployeeIds: new Set(roster),
    pos9GuardIds: pos9Guards,
  });
  assert.equal(
    self.assignments.find((assignment) => assignment.postId === SATPAM_FIXED_POST_ID)?.payType,
    'Lembur Sendiri',
  );

  const cover = classifySatpamDutyAssignments({
    planDay,
    primaryAssignments: pos9Replaced.map((assignment) =>
      assignment.postId === SATPAM_FIXED_POST_ID
        ? {
            ...assignment,
            shiftType: 'Lembur Cover' as const,
            coveredEmployeeId: fixedPost9EmployeeId,
          }
        : assignment,
    ),
    regularPayType: 'Harian',
    teamRosterEmployeeIds: new Set(roster),
    pos9GuardIds: pos9Guards,
  });
  const covered = cover.assignments.find(
    (assignment) => assignment.postId === SATPAM_FIXED_POST_ID,
  );
  assert.equal(covered?.payType, 'Lembur Cover');
  assert.equal(covered?.coveredEmployeeId, fixedPost9EmployeeId);

  const ownPos9 = classifySatpamDutyAssignments({
    planDay,
    primaryAssignments: planDay.assignments.map((assignment) =>
      assignment.postId === SATPAM_FIXED_POST_ID
        ? { ...assignment, shiftType: 'Lembur Sendiri' as const }
        : assignment,
    ),
    regularPayType: 'Jumat & Libur',
    teamRosterEmployeeIds: new Set(roster),
    pos9GuardIds: new Set([fixedPost9EmployeeId]),
  });
  const ownPos9Assignment = ownPos9.assignments.find(
    (assignment) => assignment.postId === SATPAM_FIXED_POST_ID,
  );
  assert.equal(ownPos9Assignment?.payType, 'Lembur Sendiri');
  assert.equal(ownPos9Assignment?.scheduleRelation, 'designated_pos9');
});

test('an outside-team guard on any post defaults to Harian and can opt into Cover', () => {
  const [planDay] = generatePlan('2026-08-01', '2026-08-08').generatedDays;
  const outsideGuard = 'SAT-OUTSIDE';
  const replaced = planDay.assignments.map((assignment) =>
    assignment.postId === 'Pos 1'
      ? { ...assignment, employeeId: outsideGuard, shiftType: 'Harian' as const }
      : assignment,
  );
  const regular = classifySatpamDutyAssignments({
    planDay,
    primaryAssignments: replaced,
    regularPayType: 'Jumat & Libur',
    teamRosterEmployeeIds: new Set(roster),
  });
  const regularAssignment = regular.assignments.find((a) => a.postId === 'Pos 1');
  assert.equal(regularAssignment?.payType, 'Harian');
  assert.equal(regularAssignment?.scheduleRelation, 'external_substitution');
  assert.equal(regularAssignment?.coveredEmployeeId, null);

  const cover = classifySatpamDutyAssignments({
    planDay,
    primaryAssignments: replaced.map((assignment) =>
      assignment.postId === 'Pos 1'
        ? {
            ...assignment,
            shiftType: 'Lembur Cover' as const,
            coveredEmployeeId: roster[2],
          }
        : assignment,
    ),
    regularPayType: 'Harian',
    teamRosterEmployeeIds: new Set(roster),
  });
  const coverAssignment = cover.assignments.find((a) => a.postId === 'Pos 1');
  assert.equal(coverAssignment?.payType, 'Lembur Cover');
  assert.equal(coverAssignment?.coveredEmployeeId, roster[2]);
});

test('off-day overtime cannot replace a missed scheduled duty for bonus', () => {
  const planDays: SatpamDutyPlanDay[] = [
    {
      dutyDate: '2026-08-01',
      shiftName: 'Pagi',
      assignments: [{ postId: 'Pos 1', employeeId: roster[0] }],
      offDutyEmployeeId: roster[1],
      sourceSeedDate: '2026-08-01',
      sourceSeedIndex: 0,
      cycleNumber: 1,
    },
    {
      dutyDate: '2026-08-02',
      shiftName: 'Pagi',
      assignments: [{ postId: 'Pos 1', employeeId: roster[1] }],
      offDutyEmployeeId: roster[0],
      sourceSeedDate: '2026-08-02',
      sourceSeedIndex: 1,
      cycleNumber: 1,
    },
  ];
  const result = reconcileSatpamDuties({
    employeeIds: [roster[0]],
    planDays,
    fulfilledWorkKeys: new Set(),
    approvedAbsenceKeys: new Set(),
    pendingDutyKeys: new Set(),
    unfinishedDutyKeys: new Set(),
    extraDutyKeys: new Set([
      `${satpamDutyKey(roster[0], '2026-08-02')}__EXTRA`,
    ]),
    periodComplete: true,
  })[0];

  assert.equal(result.requiredDuties, 1);
  assert.equal(result.fulfilledDuties, 0);
  assert.equal(result.missedDuties, 1);
  assert.equal(result.extraDuties, 1);
  assert.equal(result.eligibleForBonus, false);
  assert.equal(result.bonusAmount, 0);
});

test('approved absence fulfills duty at fixed pay, while a work conflict blocks bonus', () => {
  const key = satpamDutyKey(roster[0], '2026-08-01');
  const planDays: SatpamDutyPlanDay[] = [{
    dutyDate: '2026-08-01',
    shiftName: 'Pagi',
    assignments: [{ postId: 'Pos 1', employeeId: roster[0] }],
    offDutyEmployeeId: roster[1],
    sourceSeedDate: '2026-08-01',
    sourceSeedIndex: 0,
    cycleNumber: 1,
  }];
  const approvedAbsence = reconcileSatpamDuties({
    employeeIds: [roster[0]],
    planDays,
    fulfilledWorkKeys: new Set(),
    approvedAbsenceKeys: new Set([key]),
    pendingDutyKeys: new Set(),
    unfinishedDutyKeys: new Set(),
    extraDutyKeys: new Set(),
    periodComplete: true,
  })[0];
  assert.equal(SATPAM_PAID_ABSENCE_RATE, 12_500);
  assert.equal(approvedAbsence.fulfilledByAbsence, 1);
  assert.equal(
    approvedAbsence.bonusAmount,
    SATPAM_MONTHLY_ATTENDANCE_BONUS,
  );

  const conflict = reconcileSatpamDuties({
    employeeIds: [roster[0]],
    planDays,
    fulfilledWorkKeys: new Set([key]),
    approvedAbsenceKeys: new Set([key]),
    pendingDutyKeys: new Set(),
    unfinishedDutyKeys: new Set(),
    extraDutyKeys: new Set(),
    periodComplete: true,
  })[0];
  assert.equal(conflict.conflictingDuties, 1);
  assert.equal(conflict.eligibleForBonus, false);
});
