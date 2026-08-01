import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import {
  addCalendarDays,
  assertRequestId,
  guardDutyIndexId,
  isImmutablePayrollStatus,
  SATPAM_POSTS,
  type SatpamPostId,
  type SatpamShiftName,
} from '@/lib/payroll/domain';
import { pekaryaPayrollWindow } from '@/lib/payroll/pekaryaSpj';
import {
  isSatpamAdvancePlanningPeriod,
  isSatpamDutyPlanRequired,
  isSatpamPlanDayStarted,
  nextSatpamRotationAssignments,
  satpamDutyPlanId,
  SATPAM_DUTY_PLAN_ROTATION_VERSION,
  SATPAM_DUTY_PLAN_SCHEMA_VERSION,
  SATPAM_ROTATION_SLOTS,
  validateAndGenerateSatpamDutyPlan,
  validateSatpamDutyPlanDay,
  type SatpamDutyPlanDay,
  type SatpamDutyPlanSeedDay,
  type SatpamRotationSlot,
  type SatpamRotationSlotAssignment,
} from '@/lib/payroll/satpamDutyPlan';
import {
  SATPAM_DUTY_PLANS_COLLECTION,
  SATPAM_DUTY_PLAN_REVISIONS_COLLECTION,
  syncSatpamDutyReconciliation,
} from '@/lib/server/satpamDutyPlan';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '@/lib/server/audit';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
  type AuthenticatedProfile,
} from '@/lib/server/auth';
import { getSatpamShiftForTeam } from '@/utils/satpamRotation';
import { isPeriodClosed, jakartaToday } from '@/lib/server/payrollPeriod';
import { pekaryaPayrollPeriodForDate } from '@/lib/payroll/pekaryaSpj';

export const dynamic = 'force-dynamic';

const AUDITOR_ROLES = [
  'super_admin',
  'finance_verifier',
  'payroll_authorizer',
  'satker_head',
] as const;

function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function assertPeriod(period: string) {
  if (!/^\d{4}-\d{2}$/.test(period)) {
    throw new HttpError(400, 'Periode wajib menggunakan format YYYY-MM.');
  }
}

function requireSatpamScope(actor: AuthenticatedProfile) {
  if (
    actor.role === 'satker_head' &&
    !actor.permittedCategories.includes('SATPAM')
  ) {
    throw new HttpError(403, 'Anda tidak memiliki akses kategori SATPAM.');
  }
}

async function teamForKetua(employeeId: string) {
  const query = await adminDb
    .collection('SatpamShiftTeams')
    .where('ketuaShiftId', '==', employeeId)
    .limit(2)
    .get();
  if (query.size !== 1) {
    throw new HttpError(409, 'Konfigurasi regu Ketua Shift harus tepat satu.');
  }
  return query.docs[0];
}

function rosterIdsFromTeam(team: FirebaseFirestore.DocumentSnapshot): string[] {
  const data = team.data() || {};
  return Array.from(
    new Set<string>([
      String(data.ketuaShiftId || ''),
      ...(Array.isArray(data.memberEmployeeIds)
        ? data.memberEmployeeIds.filter(
            (value: unknown): value is string => typeof value === 'string',
          )
        : []),
    ]),
  ).filter(Boolean);
}

function parseFirstDayAssignments(value: unknown): SatpamRotationSlotAssignment[] {
  if (!Array.isArray(value) || value.length !== SATPAM_ROTATION_SLOTS.length) {
    throw new HttpError(
      400,
      'Susunan tanggal pertama wajib berisi tujuh pos dan satu Libur.',
    );
  }
  const validSlots = new Set<string>(SATPAM_ROTATION_SLOTS);
  return value.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new HttpError(400, `Slot rotasi ke-${index + 1} tidak valid.`);
    }
    const assignment = raw as Record<string, unknown>;
    if (
      typeof assignment.slot !== 'string' ||
      !validSlots.has(assignment.slot) ||
      typeof assignment.employeeId !== 'string' ||
      !assignment.employeeId.trim()
    ) {
      throw new HttpError(400, `Slot rotasi ke-${index + 1} belum lengkap.`);
    }
    return {
      slot: assignment.slot as SatpamRotationSlot,
      employeeId: assignment.employeeId.trim(),
    };
  });
}

function parseDay(value: unknown): SatpamDutyPlanSeedDay {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'Penugasan harian tidak valid.');
  }
  const day = value as Record<string, unknown>;
  if (
    typeof day.dutyDate !== 'string' ||
    !['Pagi', 'Sore', 'Malam'].includes(String(day.shiftName)) ||
    typeof day.offDutyEmployeeId !== 'string' ||
    !Array.isArray(day.assignments)
  ) {
    throw new HttpError(400, 'Penugasan harian belum lengkap.');
  }
  const validPostIds = new Set<string>(SATPAM_POSTS.map((post) => post.id));
  const assignments = day.assignments.map((rawAssignment) => {
    if (
      !rawAssignment ||
      typeof rawAssignment !== 'object' ||
      Array.isArray(rawAssignment)
    ) {
      throw new HttpError(400, 'Baris penugasan harian tidak valid.');
    }
    const assignment = rawAssignment as Record<string, unknown>;
    if (
      typeof assignment.postId !== 'string' ||
      !validPostIds.has(assignment.postId) ||
      typeof assignment.employeeId !== 'string'
    ) {
      throw new HttpError(400, 'Pos atau petugas harian tidak valid.');
    }
    return {
      postId: assignment.postId as SatpamPostId,
      employeeId: assignment.employeeId.trim(),
    };
  });
  return {
    dutyDate: day.dutyDate,
    shiftName: day.shiftName as SatpamShiftName,
    assignments,
    offDutyEmployeeId: day.offDutyEmployeeId.trim(),
  };
}

function previousPayrollPeriod(period: string): string {
  const [year, month] = period.split('-').map(Number);
  const previous = new Date(Date.UTC(year, month - 2, 1));
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, '0')}`;
}

function sameEmployeeSet(left: unknown, right: readonly string[]): boolean {
  if (!Array.isArray(left)) return false;
  const normalized = left.filter(
    (value): value is string => typeof value === 'string' && Boolean(value),
  );
  return (
    normalized.length === right.length &&
    new Set(normalized).size === right.length &&
    right.every((employeeId) => normalized.includes(employeeId))
  );
}

async function loadContinuation(input: {
  period: string;
  teamId: string;
  ketuaShiftId: string;
  rosterEmployeeIds: readonly string[];
  fixedPost9EmployeeId?: string;
}) {
  const previousPeriod = previousPayrollPeriod(input.period);
  const [previousPlan, previousWindow] = await Promise.all([
    adminDb
      .collection(SATPAM_DUTY_PLANS_COLLECTION)
      .doc(satpamDutyPlanId(previousPeriod, input.teamId))
      .get(),
    Promise.resolve(pekaryaPayrollWindow(previousPeriod)),
  ]);
  if (!previousPlan.exists) return null;
  const data = previousPlan.data()!;
  const currentWindow = pekaryaPayrollWindow(input.period);
  const fixedPost9EmployeeId = String(data.fixedPost9EmployeeId || '');
  const compatible =
    Number(data.schemaVersion || 0) === SATPAM_DUTY_PLAN_SCHEMA_VERSION &&
    data.rotationVersion === SATPAM_DUTY_PLAN_ROTATION_VERSION &&
    data.status !== 'stale' &&
    String(data.ketuaShiftId || '') === input.ketuaShiftId &&
    sameEmployeeSet(data.rosterEmployeeIds, input.rosterEmployeeIds) &&
    addCalendarDays(previousWindow.endsOn, 1) === currentWindow.startsOn &&
    (!input.fixedPost9EmployeeId ||
      input.fixedPost9EmployeeId === fixedPost9EmployeeId);
  const generatedDays = Array.isArray(data.generatedDays)
    ? (data.generatedDays as SatpamDutyPlanDay[])
    : [];
  const previousGeneratedDay = generatedDays.find(
    (day) => day.dutyDate === previousWindow.endsOn,
  );
  const seedDays = Array.isArray(data.seedDays)
    ? (data.seedDays as SatpamDutyPlanDay[])
    : [];
  const previousDay = previousGeneratedDay
    ? seedDays[Number(previousGeneratedDay.sourceSeedIndex)] ||
      previousGeneratedDay
    : null;
  if (!compatible || !previousDay || !fixedPost9EmployeeId) return null;
  return {
    sourcePlanId: previousPlan.id,
    sourceRevision: Number(data.revision || 0),
    fixedPost9EmployeeId,
    firstDayAssignments: nextSatpamRotationAssignments(previousDay),
  };
}

async function rosterSnapshot(rosterEmployeeIds: string[]) {
  const snapshots = await adminDb.getAll(
    ...rosterEmployeeIds.map((employeeId) =>
      adminDb.collection('Employees_BlueCollar').doc(employeeId),
    ),
  );
  const invalid = snapshots.find((snapshot) => {
    const employee = snapshot.data();
    return (
      !snapshot.exists ||
      employee?.employment?.jobCategory !== 'SATPAM' ||
      (employee?.employment?.status !== 'active' &&
        employee?.flags?.isActive !== true)
    );
  });
  if (invalid) {
    throw new HttpError(
      409,
      `Anggota ${invalid.id} tidak aktif atau bukan Satpam.`,
    );
  }
  return snapshots.map((snapshot) => ({
    employeeId: snapshot.id,
    name: String(snapshot.data()?.name || snapshot.id),
    nipy: String(snapshot.data()?.nipy || ''),
  }));
}

export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    const allowed = actor.role === 'ketua_shift_satpam' ||
      (AUDITOR_ROLES as readonly string[]).includes(actor.role);
    if (!allowed) {
      throw new HttpError(403, 'Anda tidak memiliki akses rencana dinas Satpam.');
    }
    requireSatpamScope(actor);
    const period = request.nextUrl.searchParams.get('period') || '';
    assertPeriod(period);
    const periodSnapshot = await adminDb.collection('PayrollPeriods').doc(period).get();
    const advancePlanning = isSatpamAdvancePlanningPeriod(period);
    // Periods are open by default. A month with no PayrollPeriods document has
    // simply never been materialized -- it is still fully reportable, and a
    // closed one stays readable so past plans remain auditable.
    let teamIds: string[] = [];
    let ketuaTeamSnapshot: FirebaseFirestore.DocumentSnapshot | null = null;
    if (actor.role === 'ketua_shift_satpam') {
      if (!actor.linkedEmployeeId) {
        throw new HttpError(409, 'Akun belum terhubung ke data Satpam.');
      }
      ketuaTeamSnapshot = await teamForKetua(actor.linkedEmployeeId);
      teamIds = [ketuaTeamSnapshot.id];
    } else {
      const requestedTeamId = request.nextUrl.searchParams.get('teamId') || '';
      if (requestedTeamId) {
        teamIds = [requestedTeamId];
      } else {
        const teams = await adminDb.collection('SatpamShiftTeams').get();
        teamIds = teams.docs.map((snapshot) => snapshot.id).sort();
      }
    }
    const planSnapshots = await adminDb.getAll(
      ...teamIds.map((teamId) =>
        adminDb
          .collection(SATPAM_DUTY_PLANS_COLLECTION)
          .doc(satpamDutyPlanId(period, teamId)),
      ),
    );
    const plans = planSnapshots.map((snapshot, index) => {
      if (!snapshot.exists) {
        return {
          id: satpamDutyPlanId(period, teamIds[index]),
          teamId: teamIds[index],
          period,
          status: 'missing',
        };
      }
      const data = snapshot.data()!;
      return {
        id: snapshot.id,
        ...data,
        generatedDays: Array.isArray(data.generatedDays)
          ? data.generatedDays.map((day: SatpamDutyPlanDay) => ({
              ...day,
              started: isSatpamPlanDayStarted(day),
            }))
          : [],
      };
    });
    const continuation =
      actor.role === 'ketua_shift_satpam' &&
      actor.linkedEmployeeId &&
      ketuaTeamSnapshot
        ? await loadContinuation({
            period,
            teamId: ketuaTeamSnapshot.id,
            ketuaShiftId: actor.linkedEmployeeId,
            rosterEmployeeIds: rosterIdsFromTeam(ketuaTeamSnapshot),
          })
        : null;
    return Response.json(
      {
        period,
        enabled:
          advancePlanning ||
          isSatpamDutyPlanRequired(
            period,
            periodSnapshot.data() || null,
          ),
        attendanceStatus: isPeriodClosed(periodSnapshot.data())
          ? 'closed'
          : advancePlanning
            ? 'advance_planning'
            : 'open',
        advancePlanning,
        window: pekaryaPayrollWindow(period),
        continuation,
        plans,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['ketua_shift_satpam']);
    if (!actor.linkedEmployeeId) {
      throw new HttpError(409, 'Akun belum terhubung ke data Satpam.');
    }
    const body = await request.json();
    const action = String(body.action || '');
    const period = String(body.period || '');
    assertPeriod(period);
    const teamSnapshot = await teamForKetua(actor.linkedEmployeeId);
    const rosterEmployeeIds = rosterIdsFromTeam(teamSnapshot);
    const fixedPost9EmployeeId = String(body.fixedPost9EmployeeId || '').trim();
    const rotationStartMode = String(body.rotationStartMode || '');
    if (!['manual', 'continued'].includes(rotationStartMode)) {
      throw new HttpError(400, 'Pilih cara memulai rotasi dinas.');
    }
    const teamNumber = Number(teamSnapshot.id.split('_')[1]);
    if (![1, 2, 3].includes(teamNumber)) {
      throw new HttpError(409, 'Nomor regu Satpam tidak valid.');
    }
    const window = pekaryaPayrollWindow(period);
    const continuation =
      rotationStartMode === 'continued'
        ? await loadContinuation({
            period,
            teamId: teamSnapshot.id,
            ketuaShiftId: actor.linkedEmployeeId,
            rosterEmployeeIds,
            fixedPost9EmployeeId,
          })
        : null;
    if (rotationStartMode === 'continued' && !continuation) {
      throw new HttpError(
        409,
        'Rencana sebelumnya tidak lagi cocok. Susun tanggal pertama secara manual.',
      );
    }
    const firstDayAssignments = continuation
      ? continuation.firstDayAssignments
      : parseFirstDayAssignments(body.firstDayAssignments);
    let generation;
    try {
      generation = validateAndGenerateSatpamDutyPlan({
        periodStart: window.startsOn,
        periodEnd: window.endsOn,
        rosterEmployeeIds,
        ketuaShiftId: actor.linkedEmployeeId,
        fixedPost9EmployeeId,
        firstDayAssignments,
        shiftNameForDate: (dutyDate) =>
          getSatpamShiftForTeam(teamNumber, dutyDate),
      });
    } catch (error) {
      throw new HttpError(
        400,
        error instanceof Error ? error.message : 'Pola rencana dinas tidak valid.',
      );
    }
    const { generatedDays, seedDays, rotatingEmployeeIds } = generation;
    const previewInput = {
      period,
      teamId: teamSnapshot.id,
      rosterEmployeeIds,
      fixedPost9EmployeeId,
      rotatingEmployeeIds,
      rotationStartMode,
      firstDayAssignments,
      continuedFromPlanId: continuation?.sourcePlanId || null,
      continuedFromRevision: continuation?.sourceRevision || null,
    };
    if (action === 'preview') {
      const previewNow = new Date();
      return Response.json({
        period,
        teamId: teamSnapshot.id,
        window,
        seedDays,
        generatedDays,
        fixedPost9EmployeeId,
        rotatingEmployeeIds,
        rotationStartMode,
        continuedFromPlanId: continuation?.sourcePlanId || null,
        continuedFromRevision: continuation?.sourceRevision || null,
        lateBackfillDates: generatedDays
          .filter((day) => isSatpamPlanDayStarted(day, previewNow))
          .map((day) => day.dutyDate),
        previewHash: stableHash(previewInput),
      });
    }
    if (action !== 'publish') {
      throw new HttpError(400, 'Aksi rencana dinas tidak valid.');
    }
    if (typeof body.requestId !== 'string') {
      throw new HttpError(400, 'requestId wajib diisi.');
    }
    try {
      assertRequestId(body.requestId);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : 'requestId tidak valid.');
    }
    const expectedRevision = Number(body.expectedRevision || 0);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      throw new HttpError(400, 'Revisi rencana tidak valid.');
    }
    const previewHash = stableHash(previewInput);
    if (body.previewHash !== previewHash) {
      throw new HttpError(409, 'Pratinjau berubah. Periksa kembali sebelum menerbitkan.');
    }
    const [periodSnapshot, employeeRoster, immutableSlipSnapshot] =
      await Promise.all([
      adminDb.collection('PayrollPeriods').doc(period).get(),
      rosterSnapshot(rosterEmployeeIds),
      adminDb
        .collection('PayrollSlipStates')
        .where('period', '==', period.replace('-', '_'))
        .get(),
    ]);
    const currentPeriod = pekaryaPayrollPeriodForDate(jakartaToday());
    const advancePlanning = isSatpamAdvancePlanningPeriod(period);
    // Periods are open by default: the live current period (and any past
    // period nobody has closed yet) accepts a duty plan without ever being
    // explicitly opened. Only the immediately following month is advance-only.
    const openCanonicalPeriod =
      period <= currentPeriod &&
      !isPeriodClosed(periodSnapshot.data()) &&
      isSatpamDutyPlanRequired(period, periodSnapshot.exists ? periodSnapshot.data() : null);
    if (
      !openCanonicalPeriod &&
      !(advancePlanning && !isPeriodClosed(periodSnapshot.data()))
    ) {
      throw new HttpError(
        409,
        'Rencana hanya dapat diterbitkan untuk periode terbuka atau satu periode berikutnya.',
      );
    }
    if (
      immutableSlipSnapshot.docs.some((snapshot) =>
        isImmutablePayrollStatus(snapshot.data().status),
      )
    ) {
      throw new HttpError(
        409,
        'Ada slip immutable pada periode ini; rencana tidak dapat diterbitkan ulang.',
      );
    }
    const nowDate = new Date();
    const lateBackfillDates = generatedDays
      .filter((day) => isSatpamPlanDayStarted(day, nowDate))
      .map((day) => day.dutyDate);
    const requestHash = stableHash({
      action,
      period,
      teamId: teamSnapshot.id,
      expectedRevision,
      previewHash,
    });
    const planRef = adminDb
      .collection(SATPAM_DUTY_PLANS_COLLECTION)
      .doc(satpamDutyPlanId(period, teamSnapshot.id));
    const idempotencyRef = adminDb
      .collection('FinancialIdempotencyKeys')
      .doc(`${actor.uid}__${body.requestId}`);
    const reportedOccurrencesQuery = adminDb
      .collection('ShiftOccurrences')
      .where('payrollPeriod', '==', period);
    const continuationRef = continuation
      ? adminDb
          .collection(SATPAM_DUTY_PLANS_COLLECTION)
          .doc(continuation.sourcePlanId)
      : null;
    const result = await adminDb.runTransaction(async (transaction) => {
      const [
        planBefore,
        idempotencyBefore,
        reportedOccurrences,
        continuationBefore,
      ] =
        await Promise.all([
          transaction.get(planRef),
          transaction.get(idempotencyRef),
          transaction.get(reportedOccurrencesQuery),
          continuationRef
            ? transaction.get(continuationRef)
            : Promise.resolve(null),
        ]);
      if (idempotencyBefore.exists) {
        if (idempotencyBefore.data()?.requestHash !== requestHash) {
          throw new HttpError(409, 'requestId sudah digunakan untuk rencana berbeda.');
        }
        return {
          planId: planRef.id,
          revision: Number(idempotencyBefore.data()?.revision || expectedRevision),
          firstPublication:
            idempotencyBefore.data()?.firstPublication === true,
          lateBackfillDates:
            idempotencyBefore.data()?.lateBackfillDates || [],
          idempotent: true,
        };
      }
      const currentRevision = planBefore.exists
        ? Number(planBefore.data()?.revision || 0)
        : 0;
      if (currentRevision !== expectedRevision) {
        throw new HttpError(409, 'Rencana telah berubah. Muat ulang sebelum menerbitkan.');
      }
      if (
        continuation &&
        (!continuationBefore?.exists ||
          Number(continuationBefore.data()?.revision || 0) !==
            continuation.sourceRevision)
      ) {
        throw new HttpError(
          409,
          'Rencana periode sebelumnya berubah. Periksa kembali kelanjutan rotasi.',
        );
      }
      const current = planBefore.data() || {};
      const currentDays = new Map<string, SatpamDutyPlanDay>(
        Array.isArray(current.generatedDays)
          ? current.generatedDays.map((day: SatpamDutyPlanDay) => [
              day.dutyDate,
              day,
            ])
          : [],
      );
      const reportedDates = new Set(
        reportedOccurrences.docs
          .filter(
            (occurrence) =>
              occurrence.data().teamId === teamSnapshot.id,
          )
          .map((occurrence) =>
            String(occurrence.data().dutyDate || ''),
          ),
      );
      const preservedLockedDates: string[] = [];
      const finalGeneratedDays = generatedDays.map((generatedDay) => {
        const existingDay = currentDays.get(generatedDay.dutyDate);
        if (
          existingDay &&
          (isSatpamPlanDayStarted(existingDay, nowDate) ||
            reportedDates.has(existingDay.dutyDate))
        ) {
          preservedLockedDates.push(existingDay.dutyDate);
          return existingDay;
        }
        return generatedDay;
      });
      const reconciliationEmployeeIds = Array.from(
        new Set([
          ...rosterEmployeeIds,
          ...finalGeneratedDays.flatMap((day) => [
            day.offDutyEmployeeId,
            ...day.assignments.map((assignment) => assignment.employeeId),
          ]),
        ]),
      );
      const revision = currentRevision + 1;
      const effectiveLateBackfillDates = planBefore.exists
        ? Array.isArray(current.lateBackfillDates)
          ? current.lateBackfillDates
          : []
        : lateBackfillDates;
      const acknowledgedBackfillDates =
        planBefore.exists && Array.isArray(current.acknowledgedBackfillDates)
          ? current.acknowledgedBackfillDates
          : [];
      const unresolvedBackfillDates = effectiveLateBackfillDates.filter(
        (date: string) => !acknowledgedBackfillDates.includes(date),
      );
      const status =
        unresolvedBackfillDates.length > 0
          ? 'pending_backfill_review'
          : 'published';
      const now = admin.firestore.FieldValue.serverTimestamp();
      const after = {
        period,
        teamId: teamSnapshot.id,
        periodStart: window.startsOn,
        periodEnd: window.endsOn,
        ketuaShiftId: actor.linkedEmployeeId,
        fixedPost9EmployeeId,
        rotatingEmployeeIds,
        firstDayAssignments,
        rotationVersion: SATPAM_DUTY_PLAN_ROTATION_VERSION,
        rotationStartMode,
        continuedFromPlanId: continuation?.sourcePlanId || null,
        continuedFromRevision: continuation?.sourceRevision || null,
        rosterEmployeeIds,
        reconciliationEmployeeIds,
        rosterSnapshot: employeeRoster.map((employee) => ({
          ...employee,
          dutyRole:
            employee.employeeId === actor.linkedEmployeeId
              ? 'ketua'
              : employee.employeeId === fixedPost9EmployeeId
                ? 'fixed_pos_9'
                : 'rotating',
        })),
        seedDays,
        generatedDays: finalGeneratedDays,
        status,
        revision,
        lateBackfillDates: effectiveLateBackfillDates,
        acknowledgedBackfillDates,
        staleDates: [],
        publishedAt: now,
        publishedBy: actor.uid,
        updatedAt: now,
        advancePublished: !openCanonicalPeriod,
        schemaVersion: SATPAM_DUTY_PLAN_SCHEMA_VERSION,
      };
      transaction.set(planRef, after);
      transaction.create(
        adminDb
          .collection(SATPAM_DUTY_PLAN_REVISIONS_COLLECTION)
          .doc(`${planRef.id}__r${revision}`),
        {
          planId: planRef.id,
          revision,
          action: 'published',
          before: planBefore.exists ? planBefore.data() : null,
          after,
          actorUid: actor.uid,
          requestId: body.requestId,
          createdAt: now,
        },
      );
      transaction.create(
        newFinancialAuditRef(),
        buildFinancialAuditRecord(actor, {
          action: 'SATPAM_DUTY_PLAN_PUBLISHED',
          entityType: 'SatpamDutyPlan',
          entityId: planRef.id,
          requestId: body.requestId,
          reason: 'Ketua Shift menerbitkan pola rotasi dinas delapan hari.',
          before: planBefore.exists ? planBefore.data() : null,
          after,
          metadata: {
            lateBackfillDates: effectiveLateBackfillDates,
            preservedLockedDates,
            rotationStartMode,
            continuedFromPlanId: continuation?.sourcePlanId || null,
            continuedFromRevision: continuation?.sourceRevision || null,
          },
        }),
      );
      transaction.create(idempotencyRef, {
        actorUid: actor.uid,
        requestId: body.requestId,
        requestHash,
        entityType: 'SatpamDutyPlan',
        entityId: planRef.id,
        revision,
        firstPublication: !planBefore.exists,
        lateBackfillDates: effectiveLateBackfillDates,
        createdAt: now,
      });
      return {
        planId: planRef.id,
        revision,
        status,
        preservedLockedDates,
        firstPublication: !planBefore.exists,
        lateBackfillDates: effectiveLateBackfillDates,
        idempotent: false,
      };
    });
    if (result.firstPublication && result.lateBackfillDates.length > 0) {
      await reopenAffectedOccurrences({
        period,
        teamId: teamSnapshot.id,
        dutyDates: result.lateBackfillDates,
        actor,
        requestId: body.requestId,
        reason:
          'Publikasi pertama rencana dinas dilakukan setelah shift dimulai; klasifikasi lama harus diperiksa ulang.',
        dutyPlanRevision: result.revision,
      });
    }
    await syncSatpamDutyReconciliation(period, actor.uid);
    return Response.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    const canEdit =
      actor.role === 'ketua_shift_satpam' ||
      actor.role === 'satker_head';
    if (!canEdit) {
      throw new HttpError(403, 'Anda tidak memiliki kewenangan mengubah rencana.');
    }
    requireSatpamScope(actor);
    const body = await request.json();
    const period = String(body.period || '');
    const teamId = String(body.teamId || '');
    const action = String(body.action || '');
    const requestId = String(body.requestId || '');
    const expectedRevision = Number(body.expectedRevision);
    const reason = String(body.reason || '').trim();
    assertPeriod(period);
    try {
      assertRequestId(requestId);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : 'requestId tidak valid.');
    }
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
      throw new HttpError(400, 'Revisi rencana tidak valid.');
    }
    const planRef = adminDb
      .collection(SATPAM_DUTY_PLANS_COLLECTION)
      .doc(satpamDutyPlanId(period, teamId));
    const planBefore = await planRef.get();
    if (!planBefore.exists) {
      throw new HttpError(404, 'Rencana dinas tidak ditemukan.');
    }
    const current = planBefore.data()!;
    if (
      actor.role === 'ketua_shift_satpam' &&
      current.ketuaShiftId !== actor.linkedEmployeeId
    ) {
      throw new HttpError(403, 'Rencana ini bukan milik regu Anda.');
    }
    if (actor.role !== 'ketua_shift_satpam' && reason.length < 8) {
      throw new HttpError(400, 'Alasan auditor minimal delapan karakter.');
    }
    const periodSnapshot = await adminDb.collection('PayrollPeriods').doc(period).get();
    const currentPeriod = pekaryaPayrollPeriodForDate(jakartaToday());
    const advancePlanning = isSatpamAdvancePlanningPeriod(period);
    const isLiveOrPastPeriod =
      period <= currentPeriod && !isPeriodClosed(periodSnapshot.data());
    if (
      !isLiveOrPastPeriod &&
      !(advancePlanning && !isPeriodClosed(periodSnapshot.data()))
    ) {
      throw new HttpError(
        409,
        'Periode payroll sudah ditutup atau belum tersedia untuk perencanaan.',
      );
    }

    let replacementDay: SatpamDutyPlanSeedDay | null = null;
    let dutyDate = '';
    if (action === 'edit_day') {
      replacementDay = parseDay(body.day);
      dutyDate = replacementDay.dutyDate;
      try {
        validateSatpamDutyPlanDay(
          replacementDay,
          current.rosterEmployeeIds || [],
          {
            ketuaShiftId: String(current.ketuaShiftId || ''),
            fixedPost9EmployeeId: String(current.fixedPost9EmployeeId || ''),
          },
        );
      } catch (error) {
        throw new HttpError(
          400,
          error instanceof Error ? error.message : 'Penugasan harian tidak valid.',
        );
      }
      const existingDay = (current.generatedDays || []).find(
        (day: SatpamDutyPlanDay) => day.dutyDate === dutyDate,
      );
      if (!existingDay) {
        throw new HttpError(400, 'Tanggal berada di luar jendela payroll.');
      }
      const occurrenceQuery = await adminDb
        .collection('ShiftOccurrences')
        .where('payrollPeriod', '==', period)
        .where('teamId', '==', teamId)
        .where('dutyDate', '==', dutyDate)
        .get();
      if (
        actor.role === 'ketua_shift_satpam' &&
        (isSatpamPlanDayStarted(existingDay) || !occurrenceQuery.empty)
      ) {
        throw new HttpError(
          409,
          'Shift sudah dimulai atau dilaporkan. Perubahan tanggal ini harus dilakukan Kepala SatKer.',
        );
      }
      if (actor.role !== 'ketua_shift_satpam') {
        const immutableSlips = await adminDb
          .collection('PayrollSlipStates')
          .where('period', '==', period.replace('-', '_'))
          .get();
        if (
          immutableSlips.docs.some((snapshot) =>
            isImmutablePayrollStatus(snapshot.data().status),
          )
        ) {
          throw new HttpError(
            409,
            'Ada slip immutable; gunakan alur koreksi finansial.',
          );
        }
      }
    } else if (action !== 'acknowledge_backfill') {
      throw new HttpError(400, 'Aksi perubahan rencana tidak valid.');
    }
    if (
      action === 'acknowledge_backfill' &&
      actor.role === 'ketua_shift_satpam'
    ) {
      throw new HttpError(403, 'Backfill hanya dapat dikonfirmasi Kepala SatKer.');
    }

    const requestHash = stableHash({
      action,
      period,
      teamId,
      expectedRevision,
      replacementDay,
      reason,
    });
    const idempotencyRef = adminDb
      .collection('FinancialIdempotencyKeys')
      .doc(`${actor.uid}__${requestId}`);
    const result = await adminDb.runTransaction(async (transaction) => {
      const [latestPlan, idempotency] = await Promise.all([
        transaction.get(planRef),
        transaction.get(idempotencyRef),
      ]);
      if (idempotency.exists) {
        if (idempotency.data()?.requestHash !== requestHash) {
          throw new HttpError(409, 'requestId sudah digunakan untuk perubahan lain.');
        }
        return {
          revision: Number(idempotency.data()?.revision || expectedRevision),
          idempotent: true,
        };
      }
      if (Number(latestPlan.data()?.revision || 0) !== expectedRevision) {
        throw new HttpError(409, 'Rencana telah berubah. Muat ulang lalu coba lagi.');
      }
      const before = latestPlan.data()!;
      const revision = expectedRevision + 1;
      let generatedDays = before.generatedDays || [];
      let acknowledgedBackfillDates = before.acknowledgedBackfillDates || [];
      if (replacementDay) {
        generatedDays = generatedDays.map((day: SatpamDutyPlanDay) =>
          day.dutyDate === replacementDay!.dutyDate
            ? { ...day, ...replacementDay, overridden: true }
            : day,
        );
      } else {
        acknowledgedBackfillDates = Array.from(
          new Set([
            ...acknowledgedBackfillDates,
            ...(before.lateBackfillDates || []),
          ]),
        );
      }
      const unresolvedBackfill = (before.lateBackfillDates || []).filter(
        (date: string) => !acknowledgedBackfillDates.includes(date),
      );
      const after = {
        ...before,
        generatedDays,
        acknowledgedBackfillDates,
        status:
          unresolvedBackfill.length > 0
            ? 'pending_backfill_review'
            : 'published',
        revision,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: actor.uid,
      };
      transaction.set(planRef, after);
      const revisionRef = adminDb
        .collection(SATPAM_DUTY_PLAN_REVISIONS_COLLECTION)
        .doc(`${planRef.id}__r${revision}`);
      transaction.create(revisionRef, {
        planId: planRef.id,
        revision,
        action,
        dutyDate: dutyDate || null,
        reason: reason || 'Ketua Shift memperbarui jadwal mendatang.',
        before,
        after,
        actorUid: actor.uid,
        requestId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      transaction.create(
        newFinancialAuditRef(),
        buildFinancialAuditRecord(actor, {
          action:
            action === 'acknowledge_backfill'
              ? 'SATPAM_DUTY_PLAN_BACKFILL_ACKNOWLEDGED'
              : 'SATPAM_DUTY_PLAN_DAY_EDITED',
          entityType: 'SatpamDutyPlan',
          entityId: planRef.id,
          requestId,
          reason: reason || 'Perubahan jadwal mendatang oleh Ketua Shift.',
          before,
          after,
          metadata: { dutyDate: dutyDate || null, revision },
        }),
      );
      transaction.create(idempotencyRef, {
        actorUid: actor.uid,
        requestId,
        requestHash,
        entityType: 'SatpamDutyPlan',
        entityId: planRef.id,
        revision,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { revision, status: after.status, idempotent: false };
    });

    if (replacementDay && actor.role !== 'ketua_shift_satpam') {
      await reopenAffectedOccurrences({
        period,
        teamId,
        dutyDates: [replacementDay.dutyDate],
        actor,
        requestId,
        reason,
        dutyPlanRevision: result.revision,
      });
    }
    await syncSatpamDutyReconciliation(period, actor.uid);
    return Response.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

async function reopenAffectedOccurrences(input: {
  period: string;
  teamId: string;
  dutyDates: string[];
  actor: AuthenticatedProfile;
  requestId: string;
  reason: string;
  dutyPlanRevision: number;
}) {
  const occurrences = await adminDb
    .collection('ShiftOccurrences')
    .where('payrollPeriod', '==', input.period)
    .get();
  const selectedDates = new Set(input.dutyDates);
  const writer = adminDb.bulkWriter();
  for (const occurrenceSnapshot of occurrences.docs.filter(
    (occurrence) =>
      occurrence.data().teamId === input.teamId &&
      selectedDates.has(String(occurrence.data().dutyDate || '')),
  )) {
    const occurrence = occurrenceSnapshot.data();
    const occurrenceDutyDate = String(occurrence.dutyDate || '');
    const reportIds = Array.isArray(occurrence.reportIds)
      ? occurrence.reportIds.filter(
          (value: unknown): value is string => typeof value === 'string',
        )
      : [];
    const reports =
      reportIds.length > 0
        ? await adminDb.getAll(
            ...reportIds.map((reportId) =>
              adminDb.collection('ActivityReports').doc(reportId),
            ),
          )
        : [];
    const reopenedIds: string[] = [];
    for (const report of reports) {
      if (!report.exists || report.data()?.status !== 'approved') continue;
      const before = report.data()!;
      reopenedIds.push(report.id);
      writer.update(report.ref, {
        status: 'pending',
        dutyPlanRevision: input.dutyPlanRevision,
        dutyPlanReopenedAt: admin.firestore.FieldValue.serverTimestamp(),
        dutyPlanReopenedBy: input.actor.uid,
        dutyPlanReopenedFromApproval: {
          shiftType: before.shiftType || null,
          fee: before.fee || 0,
          approvedAt: before.approvedAt || null,
          approvedBy: before.approvedBy || null,
        },
      });
      writer.delete(adminDb.collection('PayrollLedgerEntries').doc(report.id));
      writer.delete(
        adminDb
          .collection('GuardDutyIndexes')
          .doc(
            guardDutyIndexId(
              occurrenceDutyDate,
              String(
                occurrence.reportedShiftName || occurrence.shiftName || '',
              ) as SatpamShiftName,
              String(before.employeeId || ''),
            ),
          ),
      );
      writer.create(
        newFinancialAuditRef(),
        buildFinancialAuditRecord(input.actor, {
          action: 'SATPAM_SHIFT_REOPENED_FOR_DUTY_PLAN',
          entityType: 'ActivityReport',
          entityId: report.id,
          requestId: input.requestId,
          reason: input.reason,
          before,
          after: {
            status: 'pending',
            dutyPlanRevision: input.dutyPlanRevision,
          },
        }),
      );
    }
    const pendingReportIds = Array.from(
      new Set([
        ...(Array.isArray(occurrence.pendingReportIds)
          ? occurrence.pendingReportIds
          : []),
        ...reopenedIds,
      ]),
    );
    writer.update(occurrenceSnapshot.ref, {
      status: 'pending_review',
      reviewStatus: 'pending',
      dutyPlanRevision: input.dutyPlanRevision,
      dutyPlanStale: true,
      pendingReportIds,
      pendingAssignmentCount: pendingReportIds.length,
      approvedAssignmentCount: Math.max(
        0,
        Number(occurrence.approvedAssignmentCount || 0) - reopenedIds.length,
      ),
      anomalyCodes: Array.from(
        new Set([
          ...(Array.isArray(occurrence.anomalyCodes)
            ? occurrence.anomalyCodes
            : []),
          'DUTY_PLAN_CHANGED_AFTER_REPORT',
        ]),
      ),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  await writer.close();
}
