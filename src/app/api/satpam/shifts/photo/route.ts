import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import {
  assertRequestId,
  SATPAM_POSTS,
  type PhotoAuditMetadata,
  type SatpamPostId,
} from '@/lib/payroll/domain';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '@/lib/server/audit';
import { errorResponse, HttpError, requireAuthenticatedProfile } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

interface PhotoCommand {
  requestId: string;
  occurrenceId: string;
  assignmentKind: 'primary' | 'extra';
  postId: SatpamPostId;
  photoUrl: string;
  photoAuditMetadata?: PhotoAuditMetadata;
}

function parseCommand(raw: unknown): PhotoCommand {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new HttpError(400, 'Perintah unggah foto tidak valid.');
  }
  const value = raw as Record<string, unknown>;
  if (typeof value.requestId !== 'string') {
    throw new HttpError(400, 'requestId wajib diisi.');
  }
  try {
    assertRequestId(value.requestId);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : 'requestId tidak valid.');
  }
  if (
    typeof value.occurrenceId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,180}$/.test(value.occurrenceId)
  ) {
    throw new HttpError(400, 'ID shift tidak valid.');
  }
  if (!['primary', 'extra'].includes(String(value.assignmentKind))) {
    throw new HttpError(400, 'Jenis penugasan tidak valid.');
  }
  const validPosts = new Set<string>(SATPAM_POSTS.map((post) => post.id));
  if (typeof value.postId !== 'string' || !validPosts.has(value.postId)) {
    throw new HttpError(400, 'Pos tidak valid.');
  }
  if (
    typeof value.photoUrl !== 'string' ||
    !value.photoUrl.trim() ||
    value.photoUrl.length > 2000
  ) {
    throw new HttpError(400, 'URL foto tidak valid.');
  }
  return {
    requestId: value.requestId,
    occurrenceId: value.occurrenceId,
    assignmentKind: value.assignmentKind as 'primary' | 'extra',
    postId: value.postId as SatpamPostId,
    photoUrl: value.photoUrl.trim(),
    photoAuditMetadata:
      value.photoAuditMetadata && typeof value.photoAuditMetadata === 'object'
        ? (value.photoAuditMetadata as PhotoAuditMetadata)
        : undefined,
  };
}

/**
 * Once an auditor acts on a shift occurrence, the Ketua Shift's own edit
 * route (satpamKetuaEditConflict) locks out every further change — including
 * a post that was added by the auditor's own "Edit Auditor" correction and
 * has no proof photo yet, since that tool has no photo field. This endpoint
 * is a narrow, deliberate carve-out: the Ketua Shift may still attach a
 * *missing* proof photo to their own report after the lock, but nothing
 * else — no employee, post, or pay-type change, and never a *replacement*
 * photo (that would let them swap evidence out from under a review already
 * in progress).
 */
export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    const command = parseCommand(await request.json());
    const requestHash = createHash('sha256').update(JSON.stringify(command)).digest('hex');

    const result = await adminDb.runTransaction(async (transaction) => {
      const idempotencyRef = adminDb
        .collection('FinancialIdempotencyKeys')
        .doc(`${actor.uid}__${command.requestId}`);
      const occurrenceRef = adminDb.collection('ShiftOccurrences').doc(command.occurrenceId);
      const reportsQuery = adminDb
        .collection('ActivityReports')
        .where('sourceOccurrenceId', '==', command.occurrenceId)
        .where('assignmentKind', '==', command.assignmentKind)
        .where('postId', '==', command.postId)
        .limit(1);

      const [idempotencySnapshot, occurrenceSnapshot, reportSnapshot] = await Promise.all([
        transaction.get(idempotencyRef),
        transaction.get(occurrenceRef),
        transaction.get(reportsQuery),
      ]);

      if (idempotencySnapshot.exists) {
        const previous = idempotencySnapshot.data()!;
        if (previous.requestHash !== requestHash) {
          throw new HttpError(409, 'requestId sudah digunakan untuk unggahan berbeda.');
        }
        return { reportId: String(previous.entityId || ''), idempotent: true };
      }
      if (!occurrenceSnapshot.exists) {
        throw new HttpError(404, 'Shift tidak ditemukan.');
      }
      const occurrence = occurrenceSnapshot.data()!;
      if (
        !actor.linkedEmployeeId ||
        actor.linkedEmployeeId !== String(occurrence.ketuaShiftId || '')
      ) {
        throw new HttpError(
          403,
          'Hanya Ketua Shift pemilik laporan ini yang dapat mengunggah foto.',
        );
      }
      if (reportSnapshot.empty) {
        throw new HttpError(
          404,
          'Penugasan untuk pos ini belum tercatat; muat ulang laporan sebelum mengunggah foto.',
        );
      }
      const reportDoc = reportSnapshot.docs[0];
      const report = reportDoc.data();
      if (report.photoUrl) {
        throw new HttpError(
          409,
          'Pos ini sudah memiliki foto bukti. Hubungi auditor untuk menggantinya.',
        );
      }

      const now = admin.firestore.FieldValue.serverTimestamp();
      const after = {
        ...report,
        photoUrl: command.photoUrl,
        photoAuditMetadata: command.photoAuditMetadata || null,
        photoAddedAfterLockAt: now,
        photoAddedAfterLockBy: actor.uid,
      };
      transaction.update(reportDoc.ref, {
        photoUrl: command.photoUrl,
        photoAuditMetadata: command.photoAuditMetadata || null,
        photoAddedAfterLockAt: now,
        photoAddedAfterLockBy: actor.uid,
      });
      transaction.create(
        newFinancialAuditRef(),
        buildFinancialAuditRecord(actor, {
          action: 'SATPAM_SHIFT_PHOTO_ADDED_AFTER_LOCK',
          entityType: 'ActivityReport',
          entityId: reportDoc.id,
          reason: 'Foto bukti diunggah Ketua Shift setelah laporan dikunci auditor.',
          requestId: command.requestId,
          before: report,
          after,
          metadata: {
            occurrenceId: command.occurrenceId,
            assignmentKind: command.assignmentKind,
            postId: command.postId,
          },
        }),
      );
      transaction.create(idempotencyRef, {
        actorUid: actor.uid,
        requestId: command.requestId,
        requestHash,
        entityType: 'ActivityReport',
        entityId: reportDoc.id,
        createdAt: now,
      });
      return { reportId: reportDoc.id, idempotent: false };
    });

    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
