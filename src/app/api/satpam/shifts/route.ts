import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import {
  activityReportId,
  analyzeSatpamShiftSubmission,
  assertDateOnly,
  assertRequestId,
  assertSatpamPhotoUrl,
  getRegularSatpamPayType,
  getShiftIsoBounds,
  payrollPeriodForDutyDate,
  resolveCrossTeamPos9PayType,
  resolveDesignatedPos9PayType,
  resolveExternalSatpamPayType,
  resolveKetuaSatpamPayType,
  resolveSatpamAssignmentPayType,
  SATPAM_POSTS,
  SATPAM_RATES,
  satpamKetuaEditConflict,
  SATPAM_RATE_VERSION,
  SHIFT_TIMES,
  type PhotoAuditMetadata,
  type SatpamPayType,
  type SatpamPostId,
  type SatpamPrimaryAssignmentInput,
  type SatpamShiftAnomaly,
  type SatpamShiftName,
  shiftOccurrenceId,
} from '@/lib/payroll/domain';
import { periodCalendarFromData } from '@/lib/payroll/calendar';
import { getSatpamShiftForTeam } from '@/utils/satpamRotation';
import { isSatpamFlexibilityEnabled } from '@/lib/server/satpamFlexibility';
import { getTodayDateString } from '@/lib/payroll/driverPiket';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '@/lib/server/audit';
import {
  classifySatpamDutyAssignments,
  isSatpamDutyPlanRequired,
  satpamDutyPlanId,
  type SatpamDutyPlanDay,
} from '@/lib/payroll/satpamDutyPlan';
import { SATPAM_DUTY_PLANS_COLLECTION } from '@/lib/server/satpamDutyPlan';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';
import { isPeriodClosed } from '@/lib/server/payrollPeriod';

export const dynamic = 'force-dynamic';

interface ShiftCommand {
  requestId: string;
  occurrenceId?: string;
  expectedRevision?: number;
  dutyDate: string;
  shiftName?: SatpamShiftName;
  dutyPlanId?: string;
  dutyPlanRevision?: number;
  assignments: SatpamPrimaryAssignmentInput[];
  extraAssignment?: {
    postId: SatpamPostId;
    employeeId: string;
    overtimeReason: string;
    photoUrl?: string;
    photoAuditMetadata?: PhotoAuditMetadata;
  };
}

interface AssignmentRecord {
  assignmentKey: string;
  assignmentKind: 'primary' | 'extra';
  postId: SatpamPostId;
  employeeId: string;
  employeeName: string;
  plannedEmployeeId: string | null;
  plannedEmployeeName: string | null;
  payType: SatpamPayType;
  coveredEmployeeId: string | null;
  overtimeReason: string | null;
  photoUrl: string | null;
  photoAuditMetadata: PhotoAuditMetadata | null;
  scheduleRelation: string | null;
}

function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function parsePhotoAuditMetadata(value: unknown): PhotoAuditMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'Metadata audit foto tidak valid.');
  }
  const item = value as Record<string, unknown>;
  const stringOrNull = (key: string, max: number): string | null => {
    const field = item[key];
    if (field === null) return null;
    if (typeof field !== 'string' || field.trim().length > max) {
      throw new HttpError(400, `Metadata ${key} tidak valid.`);
    }
    return field.trim() || null;
  };
  const numberOrNull = (key: string, min: number, max: number): number | null => {
    const field = item[key];
    if (field === null) return null;
    if (typeof field !== 'number' || !Number.isFinite(field) || field < min || field > max) {
      throw new HttpError(400, `Metadata ${key} tidak valid.`);
    }
    return field;
  };
  if (typeof item.hasExif !== 'boolean') {
    throw new HttpError(400, 'Metadata hasExif tidak valid.');
  }
  const latitude = numberOrNull('latitude', -90, 90);
  const longitude = numberOrNull('longitude', -180, 180);
  if ((latitude === null) !== (longitude === null)) {
    throw new HttpError(400, 'Koordinat foto harus lengkap.');
  }
  return {
    capturedAt: stringOrNull('capturedAt', 64),
    latitude,
    longitude,
    deviceName: stringOrNull('deviceName', 200),
    hasExif: item.hasExif,
    locationName: stringOrNull('locationName', 200),
    locationAddress: stringOrNull('locationAddress', 500),
    locationPlaceId: stringOrNull('locationPlaceId', 200),
  };
}

function parsePhotoFields(
  value: Record<string, unknown>,
  ketuaShiftId: string,
): Pick<
  SatpamPrimaryAssignmentInput,
  'photoUrl' | 'photoAuditMetadata'
> {
  if (value.photoUrl === undefined || value.photoUrl === '') return {};
  if (typeof value.photoUrl !== 'string') {
    throw new HttpError(400, 'URL foto bukti tidak valid.');
  }
  try {
    assertSatpamPhotoUrl(value.photoUrl, ketuaShiftId);
  } catch (error) {
    throw new HttpError(
      400,
      error instanceof Error ? error.message : 'URL foto bukti tidak valid.',
    );
  }
  return {
    photoUrl: value.photoUrl,
    ...(value.photoAuditMetadata !== undefined
      ? { photoAuditMetadata: parsePhotoAuditMetadata(value.photoAuditMetadata) }
      : {}),
  };
}

function parseCommand(raw: unknown, ketuaShiftId: string, requireEditFields: boolean): ShiftCommand {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new HttpError(400, 'Payload shift tidak valid.');
  }
  const input = raw as Record<string, unknown>;
  if (typeof input.requestId !== 'string' || typeof input.dutyDate !== 'string') {
    throw new HttpError(400, 'requestId dan dutyDate wajib diisi.');
  }
  try {
    assertRequestId(input.requestId);
    assertDateOnly(input.dutyDate);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : 'Data tanggal tidak valid.');
  }
  if (
    input.shiftName !== undefined &&
    !['Pagi', 'Sore', 'Malam'].includes(String(input.shiftName))
  ) {
    throw new HttpError(400, 'Nama shift tidak valid.');
  }
  if (
    input.dutyPlanId !== undefined &&
    (typeof input.dutyPlanId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,180}$/.test(input.dutyPlanId))
  ) {
    throw new HttpError(400, 'ID rencana dinas tidak valid.');
  }
  if (
    input.dutyPlanRevision !== undefined &&
    (!Number.isInteger(input.dutyPlanRevision) ||
      Number(input.dutyPlanRevision) < 1)
  ) {
    throw new HttpError(400, 'Revisi rencana dinas tidak valid.');
  }
  if (
    requireEditFields &&
    (typeof input.occurrenceId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,180}$/.test(input.occurrenceId) ||
      !Number.isInteger(input.expectedRevision) ||
      Number(input.expectedRevision) < 1)
  ) {
    throw new HttpError(400, 'ID shift atau revisi edit tidak valid.');
  }
  if (!Array.isArray(input.assignments) || input.assignments.length > 20) {
    throw new HttpError(400, 'Daftar penugasan tidak valid.');
  }

  const validPostIds = new Set<string>(SATPAM_POSTS.map((post) => post.id));
  const validAssignmentTypes = new Set<string>([
    'Harian',
    'Jumat & Libur',
    'Lembur Sendiri',
    'Lembur Cover',
  ]);
  const assignments = input.assignments.map((rawAssignment) => {
    if (!rawAssignment || typeof rawAssignment !== 'object' || Array.isArray(rawAssignment)) {
      throw new HttpError(400, 'Baris penugasan tidak valid.');
    }
    const assignment = rawAssignment as Record<string, unknown>;
    if (
      typeof assignment.postId !== 'string' ||
      !validPostIds.has(assignment.postId) ||
      typeof assignment.employeeId !== 'string' ||
      !assignment.employeeId.trim()
    ) {
      throw new HttpError(400, 'Data pos atau petugas tidak valid.');
    }
    if (
      assignment.shiftType !== undefined &&
      (typeof assignment.shiftType !== 'string' ||
        !validAssignmentTypes.has(assignment.shiftType))
    ) {
      throw new HttpError(400, 'Jenis shift penugasan tidak valid.');
    }
    if (
      assignment.coveredEmployeeId !== undefined &&
      typeof assignment.coveredEmployeeId !== 'string'
    ) {
      throw new HttpError(400, 'Petugas yang digantikan tidak valid.');
    }
    if (
      assignment.overtimeReason !== undefined &&
      (typeof assignment.overtimeReason !== 'string' ||
        assignment.overtimeReason.length > 500)
    ) {
      throw new HttpError(400, 'Alasan lembur tidak valid.');
    }
    return {
      postId: assignment.postId as SatpamPostId,
      employeeId: assignment.employeeId.trim(),
      ...(assignment.shiftType !== undefined
        ? {
            shiftType: assignment.shiftType as Exclude<SatpamPayType, 'Off-Duty'>,
          }
        : {}),
      ...(typeof assignment.coveredEmployeeId === 'string' &&
      assignment.coveredEmployeeId.trim()
        ? { coveredEmployeeId: assignment.coveredEmployeeId.trim() }
        : {}),
      ...(typeof assignment.overtimeReason === 'string'
        ? { overtimeReason: assignment.overtimeReason.trim() }
        : {}),
      ...parsePhotoFields(assignment, ketuaShiftId),
    };
  });

  let extraAssignment: ShiftCommand['extraAssignment'];
  if (input.extraAssignment !== undefined) {
    if (
      !input.extraAssignment ||
      typeof input.extraAssignment !== 'object' ||
      Array.isArray(input.extraAssignment)
    ) {
      throw new HttpError(400, 'Penugasan tambahan tidak valid.');
    }
    const extra = input.extraAssignment as Record<string, unknown>;
    if (
      typeof extra.postId !== 'string' ||
      !validPostIds.has(extra.postId) ||
      typeof extra.employeeId !== 'string' ||
      !extra.employeeId.trim() ||
      typeof extra.overtimeReason !== 'string' ||
      extra.overtimeReason.length > 500
    ) {
      throw new HttpError(400, 'Data Lembur Sendiri tidak valid.');
    }
    extraAssignment = {
      postId: extra.postId as SatpamPostId,
      employeeId: extra.employeeId.trim(),
      overtimeReason: extra.overtimeReason.trim(),
      ...parsePhotoFields(extra, ketuaShiftId),
    };
  }

  if (assignments.length === 0 && !extraAssignment) {
    throw new HttpError(
      400,
      'Pilih sedikitnya satu petugas. Pos lain boleh dibiarkan kosong.',
    );
  }

  return {
    requestId: input.requestId,
    dutyDate: input.dutyDate,
    shiftName: input.shiftName as SatpamShiftName | undefined,
    ...(typeof input.dutyPlanId === 'string'
      ? { dutyPlanId: input.dutyPlanId }
      : {}),
    ...(Number.isInteger(input.dutyPlanRevision)
      ? { dutyPlanRevision: Number(input.dutyPlanRevision) }
      : {}),
    assignments,
    ...(extraAssignment ? { extraAssignment } : {}),
    ...(requireEditFields
      ? {
          occurrenceId: input.occurrenceId as string,
          expectedRevision: Number(input.expectedRevision),
        }
      : {}),
  };
}

function isActiveSatpam(data: FirebaseFirestore.DocumentData | undefined): boolean {
  return Boolean(
    data &&
      data.employment?.jobCategory === 'SATPAM' &&
      (data.employment?.status === 'active' || data.flags?.isActive === true),
  );
}

async function getKetuaTeam(linkedEmployeeId: string) {
  const teamQuery = await adminDb
    .collection('SatpamShiftTeams')
    .where('ketuaShiftId', '==', linkedEmployeeId)
    .limit(2)
    .get();
  if (teamQuery.size !== 1) {
    throw new HttpError(409, 'Konfigurasi regu Ketua Shift harus tepat satu.');
  }
  const teamSnapshot = teamQuery.docs[0];
  const teamNumber = Number(teamSnapshot.id.split('_')[1]);
  if (![1, 2, 3].includes(teamNumber)) {
    throw new HttpError(409, 'Nomor regu Satpam tidak valid.');
  }
  return { teamSnapshot, teamNumber };
}

function buildAssignmentRecords(input: {
  command: ShiftCommand;
  roster: string[];
  employeeById: Map<string, FirebaseFirestore.DocumentSnapshot>;
  ketuaShiftId: string;
  regularPayType: 'Harian' | 'Jumat & Libur';
  planDay: SatpamDutyPlanDay | null;
  canonicalPlanEnabled: boolean;
  pos9GuardIds: ReadonlySet<string>;
}): AssignmentRecord[] {
  if (input.canonicalPlanEnabled) {
    const classified = classifySatpamDutyAssignments({
      planDay: input.planDay,
      primaryAssignments: input.command.assignments.map((assignment) => ({
        postId: assignment.postId,
        employeeId: assignment.employeeId,
        shiftType: assignment.shiftType,
        coveredEmployeeId: assignment.coveredEmployeeId || null,
      })),
      extraAssignment: input.command.extraAssignment
        ? {
            postId: input.command.extraAssignment.postId,
            employeeId: input.command.extraAssignment.employeeId,
          }
        : null,
      regularPayType: input.regularPayType,
      teamRosterEmployeeIds: new Set(input.roster),
      ketuaShiftId: input.ketuaShiftId,
      pos9GuardIds: input.pos9GuardIds,
    });
    return classified.assignments.map((assignment, index) => {
      const source =
        assignment.assignmentKind === 'extra'
          ? input.command.extraAssignment!
          : input.command.assignments[index];
      const employee = input.employeeById.get(assignment.employeeId);
      const plannedEmployeeId =
        assignment.assignmentKind === 'primary'
          ? input.planDay?.assignments.find(
              (planned) => planned.postId === assignment.postId,
            )?.employeeId || null
          : null;
      return {
        assignmentKey:
          assignment.assignmentKind === 'extra'
            ? `extra_${assignment.postId}`
            : `primary_${assignment.postId}_${index}`,
        assignmentKind: assignment.assignmentKind,
        postId: assignment.postId,
        employeeId: assignment.employeeId,
        employeeName: String(
          employee?.data()?.name || assignment.employeeId,
        ),
        plannedEmployeeId,
        plannedEmployeeName: plannedEmployeeId
          ? String(
              input.employeeById.get(plannedEmployeeId)?.data()?.name ||
                plannedEmployeeId,
            )
          : null,
        payType: assignment.payType,
        coveredEmployeeId: assignment.coveredEmployeeId,
        overtimeReason:
          assignment.payType === 'Lembur Cover'
            ? 'Pengganti petugas sesuai rencana dinas'
            : assignment.assignmentKind === 'extra'
              ? source.overtimeReason?.trim() || null
              : null,
        photoUrl: source.photoUrl || null,
        photoAuditMetadata: source.photoAuditMetadata || null,
        scheduleRelation: assignment.scheduleRelation,
      };
    });
  }
  const primary = input.command.assignments.map((assignment, index) => {
    const isExternal = !input.roster.includes(assignment.employeeId);
    const isKetua = assignment.employeeId === input.ketuaShiftId;
    const isCrossTeamPos9 =
      assignment.postId === 'Pos 9' &&
      input.pos9GuardIds.has(assignment.employeeId) &&
      isExternal;
    const isDesignatedPos9 =
      assignment.postId === 'Pos 9' &&
      input.pos9GuardIds.has(assignment.employeeId);
    const payType = isCrossTeamPos9
      ? resolveCrossTeamPos9PayType(assignment.shiftType)
      : isExternal
        ? resolveExternalSatpamPayType(assignment.shiftType)
        : isDesignatedPos9
          ? resolveDesignatedPos9PayType(
              assignment.shiftType,
              input.regularPayType,
            )
        : isKetua
            ? resolveKetuaSatpamPayType(assignment.shiftType)
            : resolveSatpamAssignmentPayType(
                assignment.shiftType,
                false,
                input.regularPayType,
              );
    const employee = input.employeeById.get(assignment.employeeId);
    return {
      assignmentKey: `primary_${assignment.postId}_${index}`,
      assignmentKind: 'primary' as const,
      postId: assignment.postId,
      employeeId: assignment.employeeId,
      employeeName: String(employee?.data()?.name || assignment.employeeId),
      plannedEmployeeId: null,
      plannedEmployeeName: null,
      payType,
      coveredEmployeeId:
        payType === 'Lembur Cover' ? assignment.coveredEmployeeId || null : null,
      overtimeReason:
        payType === 'Lembur Cover' ? assignment.overtimeReason?.trim() || null : null,
      photoUrl: assignment.photoUrl || null,
      photoAuditMetadata: assignment.photoAuditMetadata || null,
      scheduleRelation: isCrossTeamPos9
        ? 'cross_team_pos9'
        : isDesignatedPos9
          ? 'designated_pos9'
          : null,
    };
  });
  if (!input.command.extraAssignment) return primary;
  const extra = input.command.extraAssignment;
  const employee = input.employeeById.get(extra.employeeId);
  return [
    ...primary,
    {
      assignmentKey: `extra_${extra.postId}`,
      assignmentKind: 'extra' as const,
      postId: extra.postId,
      employeeId: extra.employeeId,
      employeeName: String(employee?.data()?.name || extra.employeeId),
      plannedEmployeeId: null,
      plannedEmployeeName: null,
      payType: 'Lembur Sendiri' as const,
      coveredEmployeeId: null,
      overtimeReason: extra.overtimeReason?.trim() || null,
      photoUrl: extra.photoUrl || null,
      photoAuditMetadata: extra.photoAuditMetadata || null,
      scheduleRelation: null,
    },
  ];
}

function buildAnomalies(input: {
  command: ShiftCommand;
  suggestedShiftName: SatpamShiftName;
  reportedShiftName: SatpamShiftName;
  ketuaShiftId: string;
  roster: string[];
  employeeById: Map<string, FirebaseFirestore.DocumentSnapshot>;
  holidayCalendarConfigured: boolean;
  pos9GuardIds: ReadonlySet<string>;
}): SatpamShiftAnomaly[] {
  const activeSatpamIds = new Set(
    Array.from(input.employeeById.entries())
      .filter(([, snapshot]) => snapshot.exists && isActiveSatpam(snapshot.data()))
      .map(([employeeId]) => employeeId),
  );
  const normalizedAssignments = input.command.assignments.map((assignment) => ({
    ...assignment,
    // An outside-team guard is a valid substitution and starts as Harian.
    // Preserve an explicit Lembur Cover choice so the analyzer can require
    // the covered guard details instead of silently rewriting the request.
    ...(!input.roster.includes(assignment.employeeId) &&
    !(assignment.postId === 'Pos 9' && input.pos9GuardIds.has(assignment.employeeId)) &&
    !assignment.shiftType
      ? { shiftType: 'Harian' as const }
      : {}),
  }));
  const anomalies = analyzeSatpamShiftSubmission({
    dutyDate: input.command.dutyDate,
    reportedShiftName: input.reportedShiftName,
    suggestedShiftName: input.suggestedShiftName,
    ketuaShiftId: input.ketuaShiftId,
    assignments: normalizedAssignments,
    activeSatpamIds,
    pos9GuardIds: input.pos9GuardIds,
    holidayCalendarConfigured: input.holidayCalendarConfigured,
  });

  const extra = input.command.extraAssignment;
  if (extra) {
    if (
      normalizedAssignments.some(
        (assignment) => assignment.employeeId === extra.employeeId,
      )
    ) {
      anomalies.push({
        code: 'DUPLICATE_GUARD',
        severity: 'blocking',
        message: 'Petugas tambahan juga tercatat pada pos utama.',
      });
    }
    if (!activeSatpamIds.has(extra.employeeId)) {
      anomalies.push({
        code: 'INACTIVE_OR_MISMATCHED_GUARD',
        severity: 'blocking',
        message: 'Petugas tambahan belum memiliki status Satpam aktif yang sesuai.',
      });
    }
    if (!extra.photoUrl) {
      const photoAnomaly = anomalies.find((item) => item.code === 'MISSING_PHOTO');
      if (photoAnomaly) {
        photoAnomaly.message = 'Ada penugasan yang tidak memiliki foto bukti.';
      } else {
        anomalies.push({
          code: 'MISSING_PHOTO',
          severity: 'warning',
          message: 'Petugas tambahan tidak memiliki foto bukti.',
        });
      }
    }
  }

  return anomalies.filter(
    (anomaly, index, list) =>
      list.findIndex((candidate) => candidate.code === anomaly.code) === index,
  );
}

function assignmentReportData(input: {
  record: AssignmentRecord;
  occurrenceId: string;
  revision: number;
  dutyDate: string;
  period: string;
  suggestedShiftName: SatpamShiftName;
  reportedShiftName: SatpamShiftName;
  startsAt: FirebaseFirestore.Timestamp;
  endsAt: FirebaseFirestore.Timestamp;
  ketuaShiftId: string;
  ketuaShiftName: string;
  holidayCalendarVersion: string | null;
  calendarRevision: number;
  anomalyCodes: string[];
  dutyPlanId: string | null;
  dutyPlanRevision: number | null;
  now: FirebaseFirestore.FieldValue;
}) {
  const post = SATPAM_POSTS.find((item) => item.id === input.record.postId)!;
  const shiftTimes = SHIFT_TIMES[input.reportedShiftName];
  return {
    employeeId: input.record.employeeId,
    employeeName: input.record.employeeName,
    jobCategory: 'SATPAM',
    reportKind: 'satpam_shift_assignment',
    period: input.period,
    payrollPeriod: input.period,
    activityName: `Pengamanan di ${post.id}: ${post.name}`,
    activityType: 'Lainnya',
    activityDate: input.dutyDate,
    dutyDate: input.dutyDate,
    timeStart: shiftTimes.start,
    timeEnd: shiftTimes.end,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    status: 'pending',
    fee: SATPAM_RATES[input.record.payType],
    shiftType: input.record.payType,
    assignmentKind: input.record.assignmentKind,
    assignmentKey: input.record.assignmentKey,
    postId: post.id,
    postName: `${post.id}: ${post.name}`,
    photoUrl: input.record.photoUrl,
    photoAuditMetadata: input.record.photoAuditMetadata,
    shiftName: input.reportedShiftName,
    reportedShiftName: input.reportedShiftName,
    suggestedShiftName: input.suggestedShiftName,
    submittedDutyDate: input.dutyDate,
    submittedShiftName: input.reportedShiftName,
    submittedPostId: post.id,
    submittedEmployeeId: input.record.employeeId,
    submittedPayType: input.record.payType,
    plannedEmployeeId: input.record.plannedEmployeeId,
    plannedEmployeeName: input.record.plannedEmployeeName,
    coveredEmployeeId: input.record.coveredEmployeeId,
    scheduleRelation: input.record.scheduleRelation,
    overtimeReason: input.record.overtimeReason,
    ketuaShiftId: input.ketuaShiftId,
    ketuaShiftName: input.ketuaShiftName,
    sourceOccurrenceId: input.occurrenceId,
    sourceOccurrenceRevision: input.revision,
    sourceLedgerEntryId: activityReportId(
      input.occurrenceId,
      input.record.employeeId,
      input.record.assignmentKey,
    ),
    anomalyCodes: input.anomalyCodes,
    auditorActionAt: null,
    rateVersion: SATPAM_RATE_VERSION,
    holidayCalendarVersion: input.holidayCalendarVersion,
    calendarRevision: input.calendarRevision,
    dutyPlanId: input.dutyPlanId,
    dutyPlanRevision: input.dutyPlanRevision,
    submittedAt: input.now,
    schemaVersion: 3,
  };
}

async function mutateShift(
  request: NextRequest,
  mode: 'create' | 'edit',
) {
  const actor = await requireAuthenticatedProfile(request);
  requireRole(actor, ['ketua_shift_satpam']);
  if (!actor.linkedEmployeeId) {
    throw new HttpError(409, 'Akun Ketua Shift belum terhubung ke data Satpam.');
  }
  const command = parseCommand(
    await request.json(),
    actor.linkedEmployeeId,
    mode === 'edit',
  );
  const { teamSnapshot, teamNumber } = await getKetuaTeam(actor.linkedEmployeeId);
  const team = teamSnapshot.data();
  const members = Array.isArray(team.memberEmployeeIds)
    ? team.memberEmployeeIds.filter((id): id is string => typeof id === 'string')
    : [];
  const roster = Array.from(new Set([actor.linkedEmployeeId, ...members]));
  const suggestedShiftName = getSatpamShiftForTeam(teamNumber, command.dutyDate);
  const reportedShiftName = command.shiftName || suggestedShiftName;
  const flexibilityEnabled = isSatpamFlexibilityEnabled(teamSnapshot.id);
  if (!flexibilityEnabled) {
    const today = getTodayDateString();
    const uniquePosts = new Set(
      command.assignments.map((assignment) => assignment.postId),
    );
    const assignedEmployees = command.assignments.map(
      (assignment) => assignment.employeeId,
    );
    if (
      command.dutyDate !== today ||
      reportedShiftName !== suggestedShiftName ||
      command.assignments.length !== SATPAM_POSTS.length ||
      uniquePosts.size !== SATPAM_POSTS.length ||
      new Set(assignedEmployees).size !== assignedEmployees.length ||
      !assignedEmployees.includes(actor.linkedEmployeeId) ||
      command.assignments.some((assignment) => !roster.includes(assignment.employeeId))
    ) {
      throw new HttpError(
        409,
        'Alur fleksibel belum diaktifkan untuk regu ini. Gunakan tanggal dan roster hari ini sesuai jadwal.',
      );
    }
  }
  const occurrenceId =
    mode === 'edit'
      ? command.occurrenceId!
      : shiftOccurrenceId(teamSnapshot.id, command.dutyDate, reportedShiftName);
  const period = payrollPeriodForDutyDate(command.dutyDate);
  const requestHash = stableHash({
    occurrenceId,
    expectedRevision: command.expectedRevision || null,
    dutyDate: command.dutyDate,
    shiftName: reportedShiftName,
    assignments: command.assignments,
    extraAssignment: command.extraAssignment || null,
    dutyPlanId: command.dutyPlanId || null,
    dutyPlanRevision: command.dutyPlanRevision || null,
  });

  return adminDb.runTransaction(async (transaction) => {
    const occurrenceRef = adminDb.collection('ShiftOccurrences').doc(occurrenceId);
    const periodRef = adminDb.collection('PayrollPeriods').doc(period);
    const holidayRef = adminDb
      .collection('PayrollHolidayCalendars')
      .doc(command.dutyDate.slice(0, 4));
    const idempotencyRef = adminDb
      .collection('FinancialIdempotencyKeys')
      .doc(`${actor.uid}__${command.requestId}`);
    const dutyPlanRef = adminDb
      .collection(SATPAM_DUTY_PLANS_COLLECTION)
      .doc(satpamDutyPlanId(period, teamSnapshot.id));
    const pos9PlansQuery = adminDb
      .collection(SATPAM_DUTY_PLANS_COLLECTION)
      .where('period', '==', period);
    const selectedEmployeeIds = Array.from(
      new Set([
        ...roster,
        ...command.assignments.map((assignment) => assignment.employeeId),
        ...(command.extraAssignment ? [command.extraAssignment.employeeId] : []),
      ]),
    );
    const employeeRefs = selectedEmployeeIds.map((employeeId) =>
      adminDb.collection('Employees_BlueCollar').doc(employeeId),
    );

    const [
      occurrenceSnapshot,
      periodSnapshot,
      holidaySnapshot,
      idempotencySnapshot,
      dutyPlanSnapshot,
      pos9PlanSnapshots,
      ...employeeSnapshots
    ] = await Promise.all([
      transaction.get(occurrenceRef),
      transaction.get(periodRef),
      transaction.get(holidayRef),
      transaction.get(idempotencyRef),
      transaction.get(dutyPlanRef),
      transaction.get(pos9PlansQuery),
      ...employeeRefs.map((ref) => transaction.get(ref)),
    ]);

    if (idempotencySnapshot.exists) {
      const previous = idempotencySnapshot.data()!;
      if (
        previous.requestHash !== requestHash ||
        previous.entityId !== occurrenceId
      ) {
        throw new HttpError(409, 'requestId sudah digunakan untuk perubahan berbeda.');
      }
      return {
        occurrenceId,
        revision: Number(previous.revision || 1),
        anomalies: previous.anomalies || [],
        idempotent: true,
      };
    }
    if (isPeriodClosed(periodSnapshot.data())) {
      throw new HttpError(
        409,
        'Tanggal ini berada di periode payroll yang sudah ditutup permanen.',
      );
    }
    const canonicalPlanEnabled = isSatpamDutyPlanRequired(
      period,
      periodSnapshot.data() || null,
    );
    const dutyPlan = dutyPlanSnapshot.exists ? dutyPlanSnapshot.data()! : null;
    if (
      canonicalPlanEnabled &&
      dutyPlan &&
      command.dutyPlanRevision !== undefined &&
      Number(dutyPlan.revision || 0) !== command.dutyPlanRevision
    ) {
      throw new HttpError(
        409,
        'Rencana dinas telah berubah. Muat ulang agar draf Anda tidak hilang.',
      );
    }
    if (
      canonicalPlanEnabled &&
      command.dutyPlanId &&
      command.dutyPlanId !== dutyPlanRef.id
    ) {
      throw new HttpError(409, 'Rencana dinas laporan tidak sesuai regu.');
    }
    const planDay: SatpamDutyPlanDay | null =
      dutyPlan && Array.isArray(dutyPlan.generatedDays)
        ? dutyPlan.generatedDays.find(
            (day: SatpamDutyPlanDay) => day.dutyDate === command.dutyDate,
          ) || null
        : null;
    if (mode === 'create' && occurrenceSnapshot.exists) {
      throw new HttpError(
        409,
        'Laporan shift untuk tanggal dan jam ini sudah ada. Gunakan tombol Ubah Laporan.',
      );
    }
    const before = occurrenceSnapshot.exists ? occurrenceSnapshot.data()! : null;
    if (mode === 'edit') {
      if (!occurrenceSnapshot.exists) {
        throw new HttpError(404, 'Laporan shift yang akan diubah tidak ditemukan.');
      }
      if (
        before?.ketuaShiftId !== actor.linkedEmployeeId ||
        before?.teamId !== teamSnapshot.id
      ) {
        throw new HttpError(403, 'Laporan shift ini bukan milik regu Anda.');
      }
      const editConflict = satpamKetuaEditConflict({
        status: before?.status,
        auditorActionAt: before?.auditorActionAt,
        revision: before?.revision,
        expectedRevision: command.expectedRevision!,
      });
      if (editConflict === 'auditor_locked') {
        throw new HttpError(
          409,
          'Auditor sudah mengambil tindakan. Laporan tidak dapat diubah lagi.',
        );
      }
      if (editConflict === 'stale_revision') {
        throw new HttpError(
          409,
          'Laporan telah berubah di perangkat lain. Muat ulang sebelum menyimpan.',
        );
      }
    }

    const employeeById = new Map(
      employeeSnapshots.map((snapshot) => [snapshot.id, snapshot]),
    );
    const pos9GuardIds = new Set<string>(
      pos9PlanSnapshots.docs
        .filter((snapshot) => snapshot.data()?.status !== 'stale')
        .map((snapshot) => String(snapshot.data()?.fixedPost9EmployeeId || ''))
        .filter(Boolean),
    );
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
    const holidayDates = new Set<string>(periodCalendar.premiumDates);
    const regularPayType = getRegularSatpamPayType(command.dutyDate, holidayDates);
    const records = buildAssignmentRecords({
      command,
      roster,
      employeeById,
      ketuaShiftId: actor.linkedEmployeeId!,
      regularPayType,
      planDay,
      canonicalPlanEnabled,
      pos9GuardIds,
    });
    const anomalies = buildAnomalies({
      command,
      suggestedShiftName,
      reportedShiftName,
      ketuaShiftId: actor.linkedEmployeeId!,
      roster,
      employeeById,
      holidayCalendarConfigured:
        Boolean(periodSnapshot.data()?.workCalendar) || holidaySnapshot.exists,
      pos9GuardIds,
    });
    if (canonicalPlanEnabled) {
      const classification = classifySatpamDutyAssignments({
        planDay,
        primaryAssignments: command.assignments.map((assignment) => ({
          postId: assignment.postId,
          employeeId: assignment.employeeId,
          shiftType: assignment.shiftType,
          coveredEmployeeId: assignment.coveredEmployeeId || null,
        })),
        extraAssignment: command.extraAssignment
          ? {
              postId: command.extraAssignment.postId,
              employeeId: command.extraAssignment.employeeId,
            }
          : null,
        regularPayType,
        teamRosterEmployeeIds: new Set(roster),
        ketuaShiftId: actor.linkedEmployeeId!,
        pos9GuardIds,
      });
      for (const code of classification.anomalyCodes) {
        if (anomalies.some((anomaly) => anomaly.code === code)) continue;
          const blocking = [
            'DUTY_PLAN_STALE',
            'EXTRA_NOT_OFF_DUTY',
          'EXTRA_WITH_INCOMPLETE_PRIMARY_ROSTER',
          'ABSENCE_WORK_CONFLICT',
        ].includes(code);
        anomalies.push({
          code,
          severity: blocking ? 'blocking' : 'warning',
          message:
            code === 'DUTY_PLAN_MISSING'
              ? 'Rencana dinas belum tersedia. Laporan tetap diterima dan harus direkonsiliasi.'
              : code === 'ACTUAL_ROSTER_DIFFERS'
                ? 'Petugas aktual berbeda dari rencana dinas.'
                : code === 'POS9_GUARD_MISMATCH'
                  ? 'Pos 9 diisi petugas pengganti. Kepala SatKer perlu memeriksa substitusi ini.'
                  : code === 'EXTRA_NOT_OFF_DUTY'
                    ? 'Petugas tambahan bukan anggota yang dijadwalkan Libur.'
                    : 'Penugasan tambahan belum memiliki sembilan pos utama yang unik.',
        });
      }
      if (
        dutyPlan &&
        Array.isArray(dutyPlan.lateBackfillDates) &&
        dutyPlan.lateBackfillDates.includes(command.dutyDate) &&
        !anomalies.some(
          (anomaly) => anomaly.code === 'DUTY_PLAN_BACKFILL_PENDING',
        )
      ) {
        anomalies.push({
          code: 'DUTY_PLAN_BACKFILL_PENDING',
          severity: 'warning',
          message: 'Rencana dinas diterbitkan setelah tanggal ini dimulai (backfill).',
        });
      }
      if (
        dutyPlan &&
        dutyPlan.status === 'stale' &&
        Array.isArray(dutyPlan.staleDates) &&
        dutyPlan.staleDates.includes(command.dutyDate) &&
        !anomalies.some((anomaly) => anomaly.code === 'DUTY_PLAN_STALE')
      ) {
        anomalies.push({
          code: 'DUTY_PLAN_STALE',
          severity: 'blocking',
          message:
            'Susunan regu berubah. Tanggal ini perlu dibuat ulang pada rencana dinas sebelum dapat disetujui.',
        });
      }
    }
    const revision = mode === 'edit' ? Number(before?.revision || 1) + 1 : 1;
    const { startsAtIso, endsAtIso } = getShiftIsoBounds(
      command.dutyDate,
      reportedShiftName,
    );
    const startsAt = admin.firestore.Timestamp.fromDate(new Date(startsAtIso));
    const endsAt = admin.firestore.Timestamp.fromDate(new Date(endsAtIso));
    const now = admin.firestore.FieldValue.serverTimestamp();
    const reportIds = records.map((record) =>
      activityReportId(occurrenceId, record.employeeId, record.assignmentKey),
    );

    const oldReportIds: string[] =
      mode === 'edit' && Array.isArray(before?.reportIds)
        ? before.reportIds.filter((id: unknown): id is string => typeof id === 'string')
        : [];
    const oldReportSnapshots = await Promise.all(
      oldReportIds.map((reportId) =>
        transaction.get(adminDb.collection('ActivityReports').doc(reportId)),
      ),
    );
    if (
      oldReportSnapshots.some(
        (snapshot) => snapshot.exists && snapshot.data()?.status !== 'pending',
      )
    ) {
      throw new HttpError(
        409,
        'Salah satu penugasan sudah diaudit dan tidak dapat diubah.',
      );
    }

    oldReportIds.forEach((reportId) => {
      transaction.delete(adminDb.collection('ActivityReports').doc(reportId));
    });
    records.forEach((record, index) => {
      transaction.set(
        adminDb.collection('ActivityReports').doc(reportIds[index]),
        assignmentReportData({
          record,
          occurrenceId,
          revision,
          dutyDate: command.dutyDate,
          period,
          suggestedShiftName,
          reportedShiftName,
          startsAt,
          endsAt,
          ketuaShiftId: actor.linkedEmployeeId!,
          ketuaShiftName: String(team.ketuaShiftName || actor.displayName),
          holidayCalendarVersion: holidaySnapshot.exists
            ? `PERIOD-${period}-R${periodCalendar.revision}`
            : periodCalendar.annualVersion,
          calendarRevision: periodCalendar.revision,
          anomalyCodes: anomalies.map((anomaly) => anomaly.code),
          dutyPlanId: dutyPlanSnapshot.exists ? dutyPlanRef.id : null,
          dutyPlanRevision: dutyPlanSnapshot.exists
            ? Number(dutyPlan?.revision || 0)
            : null,
          now,
        }),
      );
    });

    const latestSnapshot = {
      dutyDate: command.dutyDate,
      reportedShiftName,
      suggestedShiftName,
      assignments: records.map((record) => ({
        assignmentKey: record.assignmentKey,
        assignmentKind: record.assignmentKind,
        postId: record.postId,
        employeeId: record.employeeId,
        payType: record.payType,
        coveredEmployeeId: record.coveredEmployeeId,
        overtimeReason: record.overtimeReason,
        photoUrl: record.photoUrl,
        photoAuditMetadata: record.photoAuditMetadata,
        scheduleRelation: record.scheduleRelation,
      })),
    };
    const occurrenceData = {
      teamId: teamSnapshot.id,
      dutyDate: command.dutyDate,
      payrollPeriod: period,
      shiftName: reportedShiftName,
      reportedShiftName,
      suggestedShiftName,
      startsAt,
      endsAt,
      timeZone: 'Asia/Jakarta',
      status: 'pending_review',
      reviewStatus: 'pending',
      revision,
      auditorActionAt: null,
      reviewOwnerUid: null,
      anomalyCodes: anomalies.map((anomaly) => anomaly.code),
      anomalies,
      blockingAnomalyCount: anomalies.filter(
        (anomaly) => anomaly.severity === 'blocking',
      ).length,
      warningAnomalyCount: anomalies.filter(
        (anomaly) => anomaly.severity === 'warning',
      ).length,
      pendingAssignmentCount: records.length,
      approvedAssignmentCount: 0,
      declinedAssignmentCount: 0,
      requestId: command.requestId,
      requestHash,
      submittedByUid: actor.uid,
      ketuaShiftId: actor.linkedEmployeeId,
      ketuaShiftName: String(team.ketuaShiftName || actor.displayName),
      rateVersion: SATPAM_RATE_VERSION,
      holidayCalendarVersion: holidaySnapshot.exists
        ? `PERIOD-${period}-R${periodCalendar.revision}`
        : periodCalendar.annualVersion,
      calendarRevision: periodCalendar.revision,
      regularPayType,
      dutyPlanId: dutyPlanSnapshot.exists ? dutyPlanRef.id : null,
      dutyPlanRevision: dutyPlanSnapshot.exists
        ? Number(dutyPlan?.revision || 0)
        : null,
      plannedAssignmentSnapshot: planDay,
      actualAssignmentSnapshot: latestSnapshot.assignments,
      assignmentCount: records.length,
      reportIds,
      pendingReportIds: reportIds,
      latestSubmitterSnapshot: latestSnapshot,
      ...(mode === 'create' ? { initialSubmissionSnapshot: latestSnapshot } : {}),
      createdAt: before?.createdAt || now,
      updatedAt: now,
      schemaVersion: 2,
    };
    transaction.set(occurrenceRef, occurrenceData, { merge: mode === 'edit' });
    transaction.create(
      newFinancialAuditRef(),
      buildFinancialAuditRecord(actor, {
        action:
          mode === 'edit'
            ? 'SATPAM_SHIFT_RESUBMITTED'
            : 'SATPAM_SHIFT_SUBMITTED',
        entityType: 'ShiftOccurrence',
        entityId: occurrenceId,
        reason:
          mode === 'edit'
            ? 'Perubahan laporan oleh Ketua Shift sebelum tindakan auditor'
            : 'Pelaporan shift fleksibel oleh Ketua Shift',
        requestId: command.requestId,
        before,
        after: occurrenceData,
        metadata: {
          revision,
          anomalyCodes: anomalies.map((anomaly) => anomaly.code),
        },
      }),
    );
    transaction.create(idempotencyRef, {
      actorUid: actor.uid,
      requestId: command.requestId,
      requestHash,
      entityType: 'ShiftOccurrence',
      entityId: occurrenceId,
      revision,
      anomalies,
      createdAt: now,
    });

    return { occurrenceId, revision, anomalies, idempotent: false };
  });
}

export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['ketua_shift_satpam']);
    if (!actor.linkedEmployeeId) {
      throw new HttpError(409, 'Akun Ketua Shift belum terhubung ke data Satpam.');
    }
    const dutyDate = request.nextUrl.searchParams.get('dutyDate') || '';
    try {
      assertDateOnly(dutyDate);
    } catch {
      throw new HttpError(400, 'Tanggal laporan tidak valid.');
    }
    const snapshot = await adminDb
      .collection('ShiftOccurrences')
      .where('ketuaShiftId', '==', actor.linkedEmployeeId)
      .get();
    const latestBefore = request.nextUrl.searchParams.get('latestBefore') === 'true';
    const occurrences: Array<
      { id: string } & FirebaseFirestore.DocumentData
    > = snapshot.docs
      .map((document) => ({ id: document.id, ...document.data() }));
    const occurrence = occurrences
      .filter((item) =>
        latestBefore ? String(item.dutyDate || '') < dutyDate : item.dutyDate === dutyDate,
      )
      .sort((left, right) =>
        latestBefore
          ? String(right.dutyDate || '').localeCompare(String(left.dutyDate || ''))
          : Number(right.revision || 0) - Number(left.revision || 0),
      )[0];
    if (!occurrence) {
      return Response.json(
        { occurrence: null, assignments: [] },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
    const reportIds = Array.isArray(occurrence.reportIds)
      ? occurrence.reportIds.filter((id): id is string => typeof id === 'string')
      : [];
    const reportSnapshots = await Promise.all(
      reportIds.map((reportId) =>
        adminDb.collection('ActivityReports').doc(reportId).get(),
      ),
    );
    const assignments = reportSnapshots
      .filter((report) => report.exists)
      .map((report) => ({ id: report.id, ...report.data() }));
    return Response.json(
      { occurrence, assignments },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const result = await mutateShift(request, 'create');
    return Response.json(result, {
      status: result.idempotent ? 200 : 201,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const result = await mutateShift(request, 'edit');
    return Response.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
