import { NextRequest } from 'next/server';
import admin, { adminDb, adminStorage } from '@/lib/firebase-admin';
import { isPresenceCorrectionType, parseDateOnly } from '@/lib/payroll/presenceCorrections';
import { assertPeriodAcceptsInput, jakartaToday } from '@/lib/server/payrollPeriod';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{1,180}$/;
const CORRECTIONS_COLLECTION = 'LoyalisPresenceCorrections';
const CLOCK_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function parseClockTime(value: unknown, label: string): string {
  if (typeof value !== 'string' || !CLOCK_TIME_PATTERN.test(value)) {
    throw new HttpError(400, `${label} tidak valid.`);
  }
  return value;
}

async function validateReplacementProofUrl(
  value: string,
  employeeId: string,
): Promise<void> {
  let url: URL;
  let storagePath: string;
  try {
    url = new URL(value);
    const segments = url.pathname.split('/').filter(Boolean);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'firebasestorage.googleapis.com' ||
      segments.length !== 5 ||
      segments[0] !== 'v0' ||
      segments[1] !== 'b' ||
      segments[3] !== 'o' ||
      decodeURIComponent(segments[2]) !== adminStorage.bucket().name ||
      url.searchParams.get('alt') !== 'media' ||
      !url.searchParams.get('token')
    ) {
      throw new Error('Invalid Firebase Storage URL');
    }
    storagePath = decodeURIComponent(segments[4]);
  } catch {
    throw new HttpError(400, 'Bukti pendukung tidak valid. Unggah ulang berkas tersebut.');
  }

  if (!storagePath.startsWith(`presence_corrections/${employeeId}/`)) {
    throw new HttpError(403, 'Bukti pendukung bukan milik akun ini.');
  }
  const [exists] = await adminStorage.bucket().file(storagePath).exists();
  if (!exists) {
    throw new HttpError(400, 'Berkas bukti pendukung tidak ditemukan. Unggah ulang berkas tersebut.');
  }
}

/** Update a pending/rejected Loyalis request through the authenticated API. */
export async function PUT(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['loyalis']);
    const employeeId = actor.linkedEmployeeId?.trim() || '';
    if (!employeeId) {
      throw new HttpError(409, 'Akun Anda belum terhubung ke data Pegawai.');
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new HttpError(400, 'Data perubahan pengajuan tidak valid.');

    const requestId = String(body.requestId || '').trim();
    if (!SAFE_REQUEST_ID.test(requestId)) {
      throw new HttpError(400, 'ID pengajuan tidak valid.');
    }

    const date = typeof body.date === 'string' ? body.date : '';
    if (!parseDateOnly(date)) {
      throw new HttpError(400, 'Tanggal pengajuan tidak valid.');
    }
    if (!isPresenceCorrectionType(body.type)) {
      throw new HttpError(400, 'Tipe pengajuan tidak valid.');
    }
    const type = body.type;
    const currentPeriod = jakartaToday().slice(0, 7);
    const period = date.slice(0, 7);
    // Izin sakit (izin_resmi) may be edited for any earlier month whose payroll
    // period is still open; the transaction below refuses closed periods.
    // Corrections stay on the current month, and nothing reaches into the future.
    const periodAllowed = type === 'izin_resmi' ? period <= currentPeriod : period === currentPeriod;
    if (!periodAllowed) {
      throw new HttpError(
        400,
        type === 'izin_resmi'
          ? 'Pengajuan izin sakit hanya diizinkan untuk periode payroll yang belum ditutup.'
          : 'Pengajuan koreksi hanya diizinkan untuk periode bulan berjalan.',
      );
    }
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!reason) throw new HttpError(400, 'Keterangan wajib diisi.');

    const checkInTime = type === 'izin_resmi'
      ? '07:30'
      : type === 'tap_out'
        ? null
        : parseClockTime(body.checkInTime, 'Jam masuk');
    const checkOutTime = type === 'izin_resmi'
      ? '14:00'
      : type === 'tap_in'
        ? null
        : parseClockTime(body.checkOutTime, 'Jam pulang');
    if (type === 'both' && checkInTime && checkOutTime) {
      const [inHour, inMinute] = checkInTime.split(':').map(Number);
      const [outHour, outMinute] = checkOutTime.split(':').map(Number);
      if (outHour * 60 + outMinute <= inHour * 60 + inMinute) {
        throw new HttpError(400, 'Jam Pulang harus lebih lambat dari Jam Masuk.');
      }
    }

    const requestRef = adminDb.collection(CORRECTIONS_COLLECTION).doc(requestId);
    const periodRef = adminDb.collection('PayrollPeriods').doc(period);
    const duplicateQuery = adminDb
      .collection(CORRECTIONS_COLLECTION)
      .where('employeeId', '==', employeeId)
      .where('date', '==', date);
    const submittedProofUrl = typeof body.proofUrl === 'string' ? body.proofUrl : undefined;
    const transactionResult = await adminDb.runTransaction(async (transaction) => {
      const [requestSnapshot, periodSnapshot, duplicateSnapshot] = await Promise.all([
        transaction.get(requestRef),
        transaction.get(periodRef),
        transaction.get(duplicateQuery),
      ]);

      if (!requestSnapshot.exists) {
        throw new HttpError(404, 'Pengajuan koreksi tidak ditemukan.');
      }
      const current = requestSnapshot.data() || {};
      if (String(current.employeeId || '') !== employeeId) {
        throw new HttpError(403, 'Anda hanya dapat mengubah pengajuan milik Anda sendiri.');
      }
      if (current.hiddenFromEmployee === true) {
        throw new HttpError(404, 'Pengajuan koreksi tidak ditemukan.');
      }
      if (current.status !== 'pending' && current.status !== 'rejected') {
        throw new HttpError(409, 'Hanya pengajuan menunggu atau ditolak yang dapat diubah.');
      }
      const hasSavedPeriod = Object.prototype.hasOwnProperty.call(current, 'period');
      if (
        (hasSavedPeriod && current.period !== period) ||
        (!hasSavedPeriod && current.date !== date)
      ) {
        throw new HttpError(409, 'Tanggal pengajuan harus tetap pada periode asal.');
      }
      assertPeriodAcceptsInput(
        periodSnapshot.data(),
        'Periode payroll sudah ditutup; pengajuan tidak dapat diubah.',
      );

      const duplicate = duplicateSnapshot.docs.find(
        (document) => document.id !== requestId && document.data().hiddenFromEmployee !== true,
      );
      if (duplicate) {
        throw new HttpError(409, 'Tanggal ini sudah memiliki pengajuan. Pilih tanggal lain.');
      }

      const previousProofUrl = typeof current.proofUrl === 'string' ? current.proofUrl : '';
      const proofUrl = submittedProofUrl ?? previousProofUrl;
      if (proofUrl && proofUrl !== previousProofUrl) {
        // File uploads are owner-checked by the upload endpoint. Revalidate the
        // bucket and employee path before associating a new URL with this request.
        await validateReplacementProofUrl(proofUrl, employeeId);
      }

      transaction.update(requestRef, {
        period,
        date,
        type,
        checkInTime,
        checkOutTime,
        reason,
        proofUrl,
        status: 'pending',
        rejectionReason: null,
        employeeId,
        employeeName: actor.displayName || 'Karyawan',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { requestId, date, status: 'pending' };
    });

    return Response.json(transactionResult, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}

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
