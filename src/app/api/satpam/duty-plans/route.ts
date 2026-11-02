import { NextRequest } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import {
  assertDateOnly,
  assertRequestId,
  isImmutablePayrollStatus,
  SATPAM_POSTS,
  shiftOccurrenceId,
  type SatpamPostId,
  type SatpamShiftName,
} from '@/lib/payroll/domain';
import { pekaryaPayrollWindow } from '@/lib/payroll/pekaryaSpj';
import {
  applyLiburDateSwap,
  findFirstUpcomingSwapDate,
  isSatpamAdvancePlanningPeriod,
  isSatpamDutyPlanRequired,
  isSatpamPlanDayStarted,
  satpamDutyPlanId,
  SATPAM_ROTATION_SLOTS,
  validateAndGenerateSatpamDutyPlan,
  validateSatpamDutyPlanDay,
  type SatpamDutyPlanDay,
  type SatpamDutyPlanSeedDay,
  type SatpamRotationSlot,
  type SatpamRotationSlotAssignment,
} from '@/lib/payroll/satpamDutyPlan';
import {
  ensureCurrentSatpamDutyPlans,
  loadSatpamPlanContinuation,
  publishSatpamDutyPlan,
  reopenAffectedOccurrences,
  rosterIdsFromTeam,
  SATPAM_DUTY_PLANS_COLLECTION,
  SATPAM_DUTY_PLAN_REVISIONS_COLLECTION,
  stableHash,
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
  'satker_head',
] as const;

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
    await ensureCurrentSatpamDutyPlans();
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
        ? await loadSatpamPlanContinuation({
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
        ? await loadSatpamPlanContinuation({
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
    const result = await publishSatpamDutyPlan({
      actor,
      period,
      teamId: teamSnapshot.id,
      ketuaShiftId: actor.linkedEmployeeId,
      rosterEmployeeIds,
      fixedPost9EmployeeId,
      rotationStartMode: rotationStartMode as 'manual' | 'continued',
      firstDayAssignments,
      continuation,
      generation,
      requestId: body.requestId,
      requestHash: stableHash({
        action,
        period,
        teamId: teamSnapshot.id,
        expectedRevision,
        previewHash,
      }),
      expectedRevision,
    });
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
    let swapRequest: {
      dateX: string;
      expectedDateY: string;
      guardAId: string;
      guardBId: string;
      postXId: SatpamPostId;
    } | null = null;
    let swapDateY = '';
    let affectedDutyDates: string[] = [];
    let swapOccurrenceRefs: FirebaseFirestore.DocumentReference[] = [];
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
      affectedDutyDates = [dutyDate];
    } else if (action === 'swap_libur_days') {
      const dateX = String(body.dateX || '');
      const expectedDateY = String(body.expectedDateY || '');
      const guardAId = String(body.guardAId || '').trim();
      const guardBId = String(body.guardBId || '').trim();
      const postXId = String(body.postXId || '') as SatpamPostId;
      try {
        assertDateOnly(dateX);
        if (expectedDateY) assertDateOnly(expectedDateY);
      } catch {
        throw new HttpError(400, 'Tanggal penukaran Libur tidak valid.');
      }
      const roster = Array.isArray(current.rosterEmployeeIds)
        ? current.rosterEmployeeIds.filter(
            (value: unknown): value is string => typeof value === 'string',
          )
        : [];
      if (
        !guardAId ||
        !guardBId ||
        guardAId === guardBId ||
        !roster.includes(guardAId) ||
        !roster.includes(guardBId) ||
        !SATPAM_POSTS.some((post) => post.id === postXId)
      ) {
        throw new HttpError(400, 'Petugas atau pos penukaran Libur tidak valid.');
      }
      const currentDays = Array.isArray(current.generatedDays)
        ? (current.generatedDays as SatpamDutyPlanDay[])
        : [];
      swapDateY =
        findFirstUpcomingSwapDate(
          currentDays,
          dateX,
          guardAId,
          guardBId,
        ) || '';
      if (!swapDateY) {
        throw new HttpError(
          409,
          'Tidak ada tanggal Libur tersisa untuk ditukar pada periode ini. Gunakan Lembur Cover.',
        );
      }
      if (expectedDateY && expectedDateY !== swapDateY) {
        throw new HttpError(
          409,
          'Tanggal Libur pengganti telah berubah. Muat ulang rencana lalu coba lagi.',
        );
      }
      let swappedDays: SatpamDutyPlanDay[];
      try {
        swappedDays = applyLiburDateSwap(
          currentDays,
          dateX,
          swapDateY,
          guardAId,
          guardBId,
          postXId,
        );
        for (const changedDate of [dateX, swapDateY]) {
          const changedDay = swappedDays.find(
            (day) => day.dutyDate === changedDate,
          );
          if (!changedDay) throw new Error('Tanggal hasil penukaran tidak ditemukan.');
          validateSatpamDutyPlanDay(changedDay, roster, {
            ketuaShiftId: String(current.ketuaShiftId || ''),
            fixedPost9EmployeeId: String(current.fixedPost9EmployeeId || ''),
          });
        }
      } catch (error) {
        throw new HttpError(
          409,
          error instanceof Error
            ? error.message
            : 'Tanggal Libur tidak dapat ditukar.',
        );
      }
      const [dateXOccurrences, dateYOccurrences] = await Promise.all([
        adminDb
          .collection('ShiftOccurrences')
          .where('payrollPeriod', '==', period)
          .where('teamId', '==', teamId)
          .where('dutyDate', '==', dateX)
          .get(),
        adminDb
          .collection('ShiftOccurrences')
          .where('payrollPeriod', '==', period)
          .where('teamId', '==', teamId)
          .where('dutyDate', '==', swapDateY)
          .get(),
      ]);
      const dateYDay = currentDays.find((day) => day.dutyDate === swapDateY)!;
      if (
        actor.role === 'ketua_shift_satpam' &&
        (!dateXOccurrences.empty ||
          !dateYOccurrences.empty ||
          isSatpamPlanDayStarted(dateYDay))
      ) {
        throw new HttpError(
          409,
          'Tanggal pengganti sudah dimulai atau dilaporkan. Gunakan Lembur Cover untuk laporan ini.',
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
      dutyDate = dateX;
      affectedDutyDates = [dateX, swapDateY];
      if (actor.role === 'ketua_shift_satpam') {
        swapOccurrenceRefs = affectedDutyDates.flatMap((affectedDate) =>
          (['Pagi', 'Sore', 'Malam'] as const).map((shiftName) =>
            adminDb
              .collection('ShiftOccurrences')
              .doc(shiftOccurrenceId(teamId, affectedDate, shiftName)),
          ),
        );
      }
      swapRequest = {
        dateX,
        expectedDateY: swapDateY,
        guardAId,
        guardBId,
        postXId,
      };
    } else {
      throw new HttpError(400, 'Aksi perubahan rencana tidak valid.');
    }

    const requestHash = stableHash({
      action,
      period,
      teamId,
      expectedRevision,
      replacementDay,
      swapRequest,
      reason,
    });
    const idempotencyRef = adminDb
      .collection('FinancialIdempotencyKeys')
      .doc(`${actor.uid}__${requestId}`);
    const result = await adminDb.runTransaction(async (transaction) => {
      const transactionReads = await Promise.all([
        transaction.get(planRef),
        transaction.get(idempotencyRef),
        transaction.get(adminDb.collection('PayrollPeriods').doc(period)),
        ...swapOccurrenceRefs.map((reference) => transaction.get(reference)),
      ]);
      const latestPlan = transactionReads[0] as FirebaseFirestore.DocumentSnapshot;
      const idempotency = transactionReads[1] as FirebaseFirestore.DocumentSnapshot;
      const latestPeriod = transactionReads[2] as FirebaseFirestore.DocumentSnapshot;
      const swapOccurrences = transactionReads.slice(3) as FirebaseFirestore.DocumentSnapshot[];
      if (idempotency.exists) {
        if (idempotency.data()?.requestHash !== requestHash) {
          throw new HttpError(409, 'requestId sudah digunakan untuk perubahan lain.');
        }
        return {
          revision: Number(idempotency.data()?.revision || expectedRevision),
          swapDateY: String(idempotency.data()?.swapDateY || '') || null,
          idempotent: true,
        };
      }
      if (isPeriodClosed(latestPeriod.data())) {
        throw new HttpError(
          409,
          'Periode payroll sudah ditutup; rencana dinas tidak dapat diubah.',
        );
      }
      if (Number(latestPlan.data()?.revision || 0) !== expectedRevision) {
        throw new HttpError(409, 'Rencana telah berubah. Muat ulang lalu coba lagi.');
      }
      if (swapOccurrences.some((snapshot) => snapshot.exists)) {
        throw new HttpError(
          409,
          'Salah satu tanggal sudah dilaporkan. Gunakan Lembur Cover atau muat ulang rencana.',
        );
      }
      const before = latestPlan.data()!;
      const revision = expectedRevision + 1;
      let generatedDays = before.generatedDays || [];
      if (replacementDay) {
        generatedDays = generatedDays.map((day: SatpamDutyPlanDay) =>
          day.dutyDate === replacementDay!.dutyDate
            ? { ...day, ...replacementDay, overridden: true }
            : day,
        );
      } else if (swapRequest) {
        const latestSwapDateY = findFirstUpcomingSwapDate(
          generatedDays,
          swapRequest.dateX,
          swapRequest.guardAId,
          swapRequest.guardBId,
        );
        if (latestSwapDateY !== swapRequest.expectedDateY) {
          throw new HttpError(
            409,
            'Rencana telah berubah. Muat ulang sebelum menukar tanggal Libur.',
          );
        }
        generatedDays = applyLiburDateSwap(
          generatedDays,
          swapRequest.dateX,
          latestSwapDateY,
          swapRequest.guardAId,
          swapRequest.guardBId,
          swapRequest.postXId,
        );
      }
      const after = {
        ...before,
        generatedDays,
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
        dutyDates: affectedDutyDates,
        swap: swapRequest,
        reason:
          reason ||
          (swapRequest
            ? 'Ketua Shift menukar tanggal Libur dua anggota regu.'
            : 'Ketua Shift memperbarui jadwal mendatang.'),
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
            action === 'swap_libur_days'
              ? 'SATPAM_DUTY_PLAN_LIBUR_SWAPPED'
              : 'SATPAM_DUTY_PLAN_DAY_EDITED',
          entityType: 'SatpamDutyPlan',
          entityId: planRef.id,
          requestId,
          reason:
            reason ||
            (swapRequest
              ? 'Penukaran tanggal Libur oleh Ketua Shift.'
              : 'Perubahan jadwal mendatang oleh Ketua Shift.'),
          before,
          after,
          metadata: {
            dutyDate: dutyDate || null,
            dutyDates: affectedDutyDates,
            swap: swapRequest,
            revision,
          },
        }),
      );
      transaction.create(idempotencyRef, {
        actorUid: actor.uid,
        requestId,
        requestHash,
        entityType: 'SatpamDutyPlan',
        entityId: planRef.id,
        revision,
        swapDateY: swapRequest?.expectedDateY || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return {
        revision,
        status: before.status,
        swapDateY: swapRequest?.expectedDateY || null,
        idempotent: false,
      };
    });

    if (
      (replacementDay || swapRequest) &&
      actor.role !== 'ketua_shift_satpam'
    ) {
      await reopenAffectedOccurrences({
        period,
        teamId,
        dutyDates: affectedDutyDates,
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
