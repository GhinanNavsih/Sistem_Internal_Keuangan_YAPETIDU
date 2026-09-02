import { NextRequest } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{1,180}$/;
const CORRECTIONS_COLLECTION = 'LoyalisPresenceCorrections';

/**
 * Hide the request only from the employee's own history. The original
 * document and all of its correction data stay available to Finance/admin.
 */
export async function DELETE(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['loyalis']);

    if (!actor.linkedEmployeeId) {
      throw new HttpError(409, 'Akun Anda belum terhubung ke data Pegawai.');
    }

    const requestId = request.nextUrl.searchParams.get('requestId')?.trim() || '';
    if (!SAFE_REQUEST_ID.test(requestId)) {
      throw new HttpError(400, 'ID pengajuan tidak valid.');
    }

    const requestRef = adminDb.collection(CORRECTIONS_COLLECTION).doc(requestId);
    const requestSnapshot = await requestRef.get();
    if (!requestSnapshot.exists) {
      throw new HttpError(404, 'Pengajuan koreksi tidak ditemukan.');
    }

    const requestData = requestSnapshot.data() || {};
    if (String(requestData.employeeId || '') !== actor.linkedEmployeeId) {
      throw new HttpError(403, 'Anda hanya dapat menghapus pengajuan milik Anda sendiri.');
    }

    // Make the operation idempotent so a repeated request cannot alter the
    // original audit data or create a second history event.
    if (requestData.hiddenFromEmployee === true) {
      return Response.json(
        { requestId, hiddenFromEmployee: true },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }

    await requestRef.update({
      hiddenFromEmployee: true,
      hiddenAt: admin.firestore.FieldValue.serverTimestamp(),
      hiddenByUid: actor.uid,
      hiddenByRole: actor.role,
    });

    return Response.json(
      { requestId, hiddenFromEmployee: true },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
