import assert from 'node:assert/strict';
import test from 'node:test';
import { SATPAM_POSTS } from './domain';
import {
  classifySatpamDutyAssignments,
  isSatpamAdvancePlanningPeriod,
  isSatpamDutyPlanRequired,
  reconcileSatpamDuties,
  satpamDutyKey,
  SATPAM_MONTHLY_ATTENDANCE_BONUS,
  SATPAM_PAID_ABSENCE_RATE,
  validateAndGenerateSatpamDutyPlan,
  type SatpamDutyPlanDay,
  type SatpamDutyPlanSeedDay,
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

function seedDays(): SatpamDutyPlanSeedDay[] {
  return Array.from({ length: 10 }, (_, dayIndex) => {
    const offDutyEmployeeId = roster[dayIndex];
    const working = roster.filter(
      (employeeId) => employeeId !== offDutyEmployeeId,
    );
    return {
      dutyDate: `2026-08-${String(dayIndex + 1).padStart(2, '0')}`,
      shiftName: 'Pagi' as const,
      assignments: SATPAM_POSTS.map((post, postIndex) => ({
        postId: post.id,
        employeeId: working[postIndex],
      })),
      offDutyEmployeeId,
    };
  });
}

test('ten-day seed repeats across the exact payroll window', () => {
  const days = validateAndGenerateSatpamDutyPlan({
    periodStart: '2026-08-01',
    periodEnd: '2026-08-23',
    rosterEmployeeIds: roster,
    seedDays: seedDays(),
  });

  assert.equal(days.length, 23);
  assert.equal(days[10].dutyDate, '2026-08-11');
  assert.equal(days[10].offDutyEmployeeId, days[0].offDutyEmployeeId);
  assert.deepEqual(days[10].assignments, days[0].assignments);
  assert.equal(days[20].offDutyEmployeeId, days[0].offDutyEmployeeId);
  assert.deepEqual(days[22].assignments, days[2].assignments);
  assert.equal(days[22].cycleNumber, 3);
});

test('seed requires nine unique posts and every guard Off-duty once', () => {
  const invalidSeed = seedDays();
  invalidSeed[9] = {
    ...invalidSeed[9],
    offDutyEmployeeId: invalidSeed[0].offDutyEmployeeId,
  };
  assert.throws(
    () =>
      validateAndGenerateSatpamDutyPlan({
        periodStart: '2026-08-01',
        periodEnd: '2026-08-31',
        rosterEmployeeIds: roster,
        seedDays: invalidSeed,
      }),
    /setiap anggota regu tepat satu kali|Off-duty tepat satu kali/,
  );
});

test('server classification distinguishes regular, Cover, and Lembur Sendiri', () => {
  const [planDay] = validateAndGenerateSatpamDutyPlan({
    periodStart: '2026-08-01',
    periodEnd: '2026-08-10',
    rosterEmployeeIds: roster,
    seedDays: seedDays(),
  });
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
