import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import {
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
  satpamDutyPlanId,
  validateAndGenerateSatpamDutyPlan,
  validateSatpamDutyPlanDay,
  type SatpamDutyPlanDay,
  type SatpamDutyPlanSeedDay,
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

function parseSeedDays(value: unknown): SatpamDutyPlanSeedDay[] {
  if (!Array.isArray(value) || value.length !== 10) {
    throw new HttpError(400, 'Pola awal wajib berisi tepat sepuluh hari.');
  }
  const validPostIds = new Set(SATPAM_POSTS.map((post) => post.id));
  return value.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new HttpError(400, `Pola hari ke-${index + 1} tidak valid.`);
    }
    const day = raw as Record<string, unknown>;
    if (
      typeof day.dutyDate !== 'string' ||
      !['Pagi', 'Sore', 'Malam'].includes(String(day.shiftName)) ||
      typeof day.offDutyEmployeeId !== 'string' ||
      !Array.isArray(day.assignments)
    ) {
      throw new HttpError(400, `Pola hari ke-${index + 1} belum lengkap.`);
    }
    const assignments = day.assignments.map((rawAssignment) => {
      if (
        !rawAssignment ||
        typeof rawAssignment !== 'object' ||
        Array.isArray(rawAssignment)
      ) {
        throw new HttpError(400, 'Baris penugasan pola tidak valid.');
      }
      const assignment = rawAssignment as Record<string, unknown>;
      if (
        typeof assignment.postId !== 'string' ||
        !validPostIds.has(assignment.postId as SatpamPostId) ||
        typeof assignment.employeeId !== 'string'
      ) {
        throw new HttpError(400, 'Pos atau petugas pola tidak valid.');
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
  });
}

function parseDay(value: unknown): SatpamDutyPlanSeedDay {
  const parsed = parseSeedDays(
    Array.from({ length: 10 }, () => value),
  );
  return parsed[0];
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
    if (!periodSnapshot.exists && !advancePlanning) {
      throw new HttpError(404, 'Periode payroll tidak ditemukan.');
    }
    let teamIds: string[] = [];
    if (actor.role === 'ketua_shift_satpam') {
      if (!actor.linkedEmployeeId) {
        throw new HttpError(409, 'Akun belum terhubung ke data Satpam.');
      }
      teamIds = [(await teamForKetua(actor.linkedEmployeeId)).id];
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
    return Response.json(
      {
        period,
        enabled:
          advancePlanning ||
          isSatpamDutyPlanRequired(
            period,
            periodSnapshot.data() || null,
          ),
        attendanceStatus:
          periodSnapshot.data()?.attendanceStatus ||
          (advancePlanning ? 'advance_planning' : null),
        advancePlanning,
        window: pekaryaPayrollWindow(period),
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
    const seedDays = parseSeedDays(body.seedDays);
    const teamSnapshot = await teamForKetua(actor.linkedEmployeeId);
    const rosterEmployeeIds = rosterIdsFromTeam(teamSnapshot);
    const teamNumber = Number(teamSnapshot.id.split('_')[1]);
    if (![1, 2, 3].includes(teamNumber)) {
      throw new HttpError(409, 'Nomor regu Satpam tidak valid.');
    }
    const window = pekaryaPayrollWindow(period);
    let generatedDays: SatpamDutyPlanDay[];
    try {
      generatedDays = validateAndGenerateSatpamDutyPlan({
        periodStart: window.startsOn,
        periodEnd: window.endsOn,
        rosterEmployeeIds,
        seedDays,
        shiftNameForDate: (dutyDate) =>
          getSatpamShiftForTeam(teamNumber, dutyDate),
      });
    } catch (error) {
      throw new HttpError(
        400,
        error instanceof Error ? error.message : 'Pola rencana dinas tidak valid.',
      );
    }
    if (action === 'preview') {
      const previewNow = new Date();
      return Response.json({
        period,
        teamId: teamSnapshot.id,
        window,
        generatedDays,
        lateBackfillDates: generatedDays
          .filter((day) => isSatpamPlanDayStarted(day, previewNow))
          .map((day) => day.dutyDate),
        previewHash: stableHash({
          period,
          teamId: teamSnapshot.id,
          rosterEmployeeIds,
          seedDays,
        }),
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
    const previewHash = stableHash({
      period,
      teamId: teamSnapshot.id,
      rosterEmployeeIds,
      seedDays,
    });
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
    const advancePlanning = isSatpamAdvancePlanningPeriod(period);
    const openCanonicalPeriod =
      periodSnapshot.exists &&
      periodSnapshot.data()?.attendanceStatus === 'open' &&
      isSatpamDutyPlanRequired(period, periodSnapshot.data() || null);
    if (
      !openCanonicalPeriod &&
      !(
        advancePlanning &&
        periodSnapshot.data()?.attendanceStatus !== 'closed'
      )
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
    const result = await adminDb.runTransaction(async (transaction) => {
      const [planBefore, idempotencyBefore, reportedOccurrences] =
        await Promise.all([
        transaction.get(planRef),
        transaction.get(idempotencyRef),
        transaction.get(reportedOccurrencesQuery),
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
        rosterEmployeeIds,
        reconciliationEmployeeIds,
        rosterSnapshot: employeeRoster,
        seedDays: generatedDays.slice(0, 10),
        generatedDays: finalGeneratedDays,
        status,
        revision,
        lateBackfillDates: effectiveLateBackfillDates,
        acknowledgedBackfillDates,
        staleDates: [],
        publishedAt: now,
        publishedBy: actor.uid,
        updatedAt: now,
        advancePublished:
          !periodSnapshot.exists ||
          periodSnapshot.data()?.attendanceStatus !== 'open',
        schemaVersion: 1,
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
          reason: 'Ketua Shift menerbitkan pola rencana dinas sepuluh hari.',
          before: planBefore.exists ? planBefore.data() : null,
          after,
          metadata: {
            lateBackfillDates: effectiveLateBackfillDates,
            preservedLockedDates,
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
    const advancePlanning = isSatpamAdvancePlanningPeriod(period);
    if (
      periodSnapshot.data()?.attendanceStatus !== 'open' &&
      !(
        advancePlanning &&
        periodSnapshot.data()?.attendanceStatus !== 'closed'
      )
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
