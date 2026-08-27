import { NextRequest } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import {
  assertDateOnly,
  assertRequestId,
  assertSatpamPhotoUrl,
  payrollPeriodForDutyDate,
  SATPAM_POSTS,
  satpamKetuaEditConflict,
  shiftOccurrenceId,
  type PhotoAuditMetadata,
  type SatpamPayType,
  type SatpamShiftName,
} from '@/lib/payroll/domain';
import {
  SATPAM_SHIFT_DRAFT_SCHEMA_VERSION,
  SATPAM_SHIFT_DRAFTS_COLLECTION,
  satpamShiftDraftDocumentId,
  type SatpamShiftDraftAssignment,
  type SatpamShiftPendingDraft,
} from '@/lib/satpamShiftDraft';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';
import { isPeriodClosed } from '@/lib/server/payrollPeriod';

export const dynamic = 'force-dynamic';

interface DraftCommand {
  clientSessionId: string;
  clientSequence: number;
  payload: SatpamShiftPendingDraft['payload'] & {
    shiftName: SatpamShiftName;
    hasUserChanges: true;
  };
}

const VALID_POST_IDS = new Set<string>(SATPAM_POSTS.map((post) => post.id));
const VALID_SHIFT_TYPES = new Set<Exclude<SatpamPayType, 'Off-Duty'>>([
  'Harian',
  'Jumat & Libur',
  'Lembur Sendiri',
  'Lembur Cover',
]);
const SAFE_OCCURRENCE_ID = /^[A-Za-z0-9_-]{1,180}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parsePhotoAuditMetadata(value: unknown): PhotoAuditMetadata {
  if (!isRecord(value)) {
    throw new HttpError(400, 'Metadata audit foto draf tidak valid.');
  }
  const stringOrNull = (key: string, maxLength: number): string | null => {
    const field = value[key];
    if (field === null) return null;
    if (typeof field !== 'string' || field.trim().length > maxLength) {
      throw new HttpError(400, `Metadata ${key} tidak valid.`);
    }
    return field.trim() || null;
  };
  const numberOrNull = (
    key: string,
    minimum: number,
    maximum: number,
  ): number | null => {
    const field = value[key];
    if (field === null) return null;
    if (
      typeof field !== 'number' ||
      !Number.isFinite(field) ||
      field < minimum ||
      field > maximum
    ) {
      throw new HttpError(400, `Metadata ${key} tidak valid.`);
    }
    return field;
  };
  if (typeof value.hasExif !== 'boolean') {
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
    hasExif: value.hasExif,
    locationName: stringOrNull('locationName', 200),
    locationAddress: stringOrNull('locationAddress', 500),
    locationPlaceId: stringOrNull('locationPlaceId', 200),
  };
}

function optionalBoundedString(
  value: Record<string, unknown>,
  key: string,
  maxLength: number,
): string | undefined {
  const field = value[key];
  if (field === undefined) return undefined;
  if (typeof field !== 'string' || field.length > maxLength) {
    throw new HttpError(400, `${key} pada draf tidak valid.`);
  }
  return field;
}

function parseAssignment(
  raw: unknown,
  ketuaShiftId: string,
  assignmentKind: 'primary' | 'extra',
): SatpamShiftDraftAssignment {
  if (!isRecord(raw)) {
    throw new HttpError(400, 'Baris penugasan draf tidak valid.');
  }
  const postId = typeof raw.postId === 'string' ? raw.postId : '';
  if (
    (assignmentKind === 'primary' && !VALID_POST_IDS.has(postId)) ||
    (assignmentKind === 'extra' && postId !== '' && !VALID_POST_IDS.has(postId))
  ) {
    throw new HttpError(400, 'Pos pada draf tidak valid.');
  }
  if (typeof raw.employeeId !== 'string' || raw.employeeId.length > 180) {
    throw new HttpError(400, 'Petugas pada draf tidak valid.');
  }
  if (
    raw.shiftType !== undefined &&
    (typeof raw.shiftType !== 'string' ||
      !VALID_SHIFT_TYPES.has(raw.shiftType as Exclude<SatpamPayType, 'Off-Duty'>))
  ) {
    throw new HttpError(400, 'Jenis shift pada draf tidak valid.');
  }
  const coveredEmployeeId = optionalBoundedString(
    raw,
    'coveredEmployeeId',
    180,
  );
  const overtimeReason = optionalBoundedString(raw, 'overtimeReason', 500);
  const photoUrl = optionalBoundedString(raw, 'photoUrl', 1500);
  let photoAuditMetadata: PhotoAuditMetadata | undefined;
  if (photoUrl) {
    try {
      assertSatpamPhotoUrl(photoUrl, ketuaShiftId);
    } catch (error) {
      throw new HttpError(
        400,
        error instanceof Error ? error.message : 'URL foto draf tidak valid.',
      );
    }
    if (raw.photoAuditMetadata !== undefined) {
      photoAuditMetadata = parsePhotoAuditMetadata(raw.photoAuditMetadata);
    }
  } else if (raw.photoAuditMetadata !== undefined) {
    throw new HttpError(400, 'Metadata foto draf membutuhkan URL foto.');
  }
  return {
    postId,
    employeeId: raw.employeeId,
    ...(typeof raw.shiftType === 'string' ? { shiftType: raw.shiftType } : {}),
    ...(coveredEmployeeId !== undefined ? { coveredEmployeeId } : {}),
    ...(overtimeReason !== undefined ? { overtimeReason } : {}),
    ...(photoUrl !== undefined ? { photoUrl } : {}),
    ...(photoAuditMetadata ? { photoAuditMetadata } : {}),
  };
}

function parseCommand(raw: unknown, ketuaShiftId: string): DraftCommand {
  if (!isRecord(raw) || !isRecord(raw.payload)) {
    throw new HttpError(400, 'Payload draf shift tidak valid.');
  }
  if (typeof raw.clientSessionId !== 'string') {
    throw new HttpError(400, 'Sesi penyimpanan draf tidak valid.');
  }
  try {
    assertRequestId(raw.clientSessionId);
  } catch (error) {
    throw new HttpError(
      400,
      error instanceof Error ? error.message : 'Sesi draf tidak valid.',
    );
  }
  if (
    !Number.isSafeInteger(raw.clientSequence) ||
    Number(raw.clientSequence) < 1
  ) {
    throw new HttpError(400, 'Urutan penyimpanan draf tidak valid.');
  }

  const payload = raw.payload;
  if (typeof payload.dutyDate !== 'string') {
    throw new HttpError(400, 'Tanggal draf wajib diisi.');
  }
  try {
    assertDateOnly(payload.dutyDate);
  } catch (error) {
    throw new HttpError(
      400,
      error instanceof Error ? error.message : 'Tanggal draf tidak valid.',
    );
  }
  if (!['Pagi', 'Sore', 'Malam'].includes(String(payload.shiftName))) {
    throw new HttpError(400, 'Nama shift draf tidak valid.');
  }
  if (payload.hasUserChanges !== true) {
    throw new HttpError(400, 'Draf tanpa perubahan pengguna tidak disimpan.');
  }
  if (!Array.isArray(payload.assignments) || payload.assignments.length > 9) {
    throw new HttpError(400, 'Daftar penugasan draf tidak valid.');
  }
  const assignments = payload.assignments.map((assignment) =>
    parseAssignment(assignment, ketuaShiftId, 'primary'),
  );
  if (new Set(assignments.map((assignment) => assignment.postId)).size !== assignments.length) {
    throw new HttpError(400, 'Satu pos hanya boleh muncul sekali dalam draf.');
  }
  const completeSnapshot = payload.completeSnapshot === true;
  if (completeSnapshot && assignments.length !== SATPAM_POSTS.length) {
    throw new HttpError(400, 'Snapshot lengkap harus memuat kesembilan pos.');
  }

  let extraAssignment: SatpamShiftDraftAssignment | undefined;
  if (payload.extraAssignment !== undefined) {
    extraAssignment = parseAssignment(
      payload.extraAssignment,
      ketuaShiftId,
      'extra',
    );
  }
  const extraVisible =
    payload.extraVisible === true ||
    Boolean(
      extraAssignment &&
        (extraAssignment.postId ||
          extraAssignment.employeeId.trim() ||
          extraAssignment.overtimeReason?.trim() ||
          extraAssignment.photoUrl?.trim()),
    );

  const hasBaseOccurrenceId = payload.baseOccurrenceId !== undefined;
  const hasBaseOccurrenceRevision = payload.baseOccurrenceRevision !== undefined;
  if (hasBaseOccurrenceId !== hasBaseOccurrenceRevision) {
    throw new HttpError(
      400,
      'ID dan revisi laporan dasar draf harus diisi bersama.',
    );
  }
  if (
    hasBaseOccurrenceId &&
    (typeof payload.baseOccurrenceId !== 'string' ||
      !SAFE_OCCURRENCE_ID.test(payload.baseOccurrenceId))
  ) {
    throw new HttpError(400, 'ID laporan dasar draf tidak valid.');
  }
  if (
    hasBaseOccurrenceRevision &&
    (!Number.isSafeInteger(payload.baseOccurrenceRevision) ||
      Number(payload.baseOccurrenceRevision) < 1)
  ) {
    throw new HttpError(400, 'Revisi laporan dasar draf tidak valid.');
  }
  if (
    payload.dutyPlanId !== undefined &&
    (typeof payload.dutyPlanId !== 'string' ||
      !SAFE_OCCURRENCE_ID.test(payload.dutyPlanId))
  ) {
    throw new HttpError(400, 'ID rencana dinas draf tidak valid.');
  }
  if (
    payload.dutyPlanRevision !== undefined &&
    (!Number.isSafeInteger(payload.dutyPlanRevision) ||
      Number(payload.dutyPlanRevision) < 1)
  ) {
    throw new HttpError(400, 'Revisi rencana dinas draf tidak valid.');
  }

  return {
    clientSessionId: raw.clientSessionId,
    clientSequence: Number(raw.clientSequence),
    payload: {
      dutyDate: payload.dutyDate,
      shiftName: payload.shiftName as SatpamShiftName,
      hasUserChanges: true,
      ...(completeSnapshot ? { completeSnapshot: true } : {}),
      ...(extraVisible ? { extraVisible: true } : {}),
      ...(typeof payload.baseOccurrenceId === 'string'
        ? {
            baseOccurrenceId: payload.baseOccurrenceId,
            baseOccurrenceRevision: Number(payload.baseOccurrenceRevision),
          }
        : {}),
      ...(typeof payload.dutyPlanId === 'string'
        ? { dutyPlanId: payload.dutyPlanId }
        : {}),
      ...(Number.isSafeInteger(payload.dutyPlanRevision)
        ? { dutyPlanRevision: Number(payload.dutyPlanRevision) }
        : {}),
      assignments,
      ...(extraAssignment ? { extraAssignment } : {}),
    },
  };
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
  return teamQuery.docs[0];
}

export async function PUT(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['ketua_shift_satpam']);
    if (!actor.linkedEmployeeId) {
      throw new HttpError(409, 'Akun Ketua Shift belum terhubung ke data Satpam.');
    }
    const command = parseCommand(await request.json(), actor.linkedEmployeeId);
    const teamSnapshot = await getKetuaTeam(actor.linkedEmployeeId);
    const period = payrollPeriodForDutyDate(command.payload.dutyDate);
    const draftId = satpamShiftDraftDocumentId(
      actor.linkedEmployeeId,
      command.payload.dutyDate,
    );
    const draftRef = adminDb
      .collection(SATPAM_SHIFT_DRAFTS_COLLECTION)
      .doc(draftId);
    const occurrenceId =
      command.payload.baseOccurrenceId ||
      shiftOccurrenceId(
        teamSnapshot.id,
        command.payload.dutyDate,
        command.payload.shiftName,
      );
    const occurrenceRef = adminDb
      .collection('ShiftOccurrences')
      .doc(occurrenceId);
    const periodRef = adminDb.collection('PayrollPeriods').doc(period);

    const result = await adminDb.runTransaction(async (transaction) => {
      const [draftSnapshot, occurrenceSnapshot, periodSnapshot] =
        await Promise.all([
          transaction.get(draftRef),
          transaction.get(occurrenceRef),
          transaction.get(periodRef),
        ]);
      if (isPeriodClosed(periodSnapshot.data())) {
        throw new HttpError(
          409,
          'Periode payroll sudah ditutup; draf shift tidak dapat diubah.',
        );
      }

      if (occurrenceSnapshot.exists) {
        if (!command.payload.baseOccurrenceId) {
          throw new HttpError(
            409,
            'Laporan shift sudah tersimpan. Muat ulang sebelum melanjutkan perubahan.',
          );
        }
        const occurrence = occurrenceSnapshot.data()!;
        if (
          occurrence.ketuaShiftId !== actor.linkedEmployeeId ||
          occurrence.teamId !== teamSnapshot.id
        ) {
          throw new HttpError(403, 'Laporan dasar draf bukan milik regu Anda.');
        }
        if (occurrence.dutyDate !== command.payload.dutyDate) {
          throw new HttpError(
            409,
            'Tanggal laporan dasar tidak sama dengan tanggal draf.',
          );
        }
        const conflict = satpamKetuaEditConflict({
          status: occurrence.status,
          auditorActionAt: occurrence.auditorActionAt,
          revision: occurrence.revision,
          expectedRevision: command.payload.baseOccurrenceRevision!,
        });
        if (conflict === 'auditor_locked') {
          throw new HttpError(
            409,
            'Auditor sudah menangani laporan ini sehingga draf tidak dapat diubah.',
          );
        }
        if (conflict === 'stale_revision') {
          throw new HttpError(
            409,
            'Laporan sudah berubah. Muat ulang sebelum menyimpan draf berikutnya.',
          );
        }
      } else if (command.payload.baseOccurrenceId) {
        throw new HttpError(
          409,
          'Laporan dasar draf tidak ditemukan. Muat ulang halaman.',
        );
      }

      const previous = draftSnapshot.exists ? draftSnapshot.data()! : null;
      if (
        previous?.clientSessionId === command.clientSessionId &&
        Number(previous.clientSequence || 0) >= command.clientSequence
      ) {
        return {
          draftId,
          revision: Number(previous.revision || 1),
          stale: true,
        };
      }

      const revision = Number(previous?.revision || 0) + 1;
      const now = admin.firestore.FieldValue.serverTimestamp();
      transaction.set(draftRef, {
        ketuaShiftId: actor.linkedEmployeeId,
        submittedByUid: actor.uid,
        teamId: teamSnapshot.id,
        dutyDate: command.payload.dutyDate,
        payrollPeriod: period,
        shiftName: command.payload.shiftName,
        payload: command.payload,
        clientSessionId: command.clientSessionId,
        clientSequence: command.clientSequence,
        revision,
        createdAt: previous?.createdAt || now,
        updatedAt: now,
        schemaVersion: SATPAM_SHIFT_DRAFT_SCHEMA_VERSION,
      });
      return { draftId, revision, stale: false };
    });

    return Response.json(
      { ...result, savedAt: new Date().toISOString() },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
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
      throw new HttpError(400, 'Tanggal draf tidak valid.');
    }
    const draftRef = adminDb
      .collection(SATPAM_SHIFT_DRAFTS_COLLECTION)
      .doc(satpamShiftDraftDocumentId(actor.linkedEmployeeId, dutyDate));
    const snapshot = await draftRef.get();
    if (
      snapshot.exists &&
      snapshot.data()?.ketuaShiftId !== actor.linkedEmployeeId
    ) {
      throw new HttpError(403, 'Draf ini bukan milik akun Anda.');
    }
    await draftRef.delete();
    return Response.json(
      { deleted: snapshot.exists },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
