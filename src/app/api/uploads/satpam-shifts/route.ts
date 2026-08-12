import { NextRequest, NextResponse } from 'next/server';
import { errorResponse, HttpError, requireAuthenticatedProfile } from '@/lib/server/auth';
import { assertValidProofFile, saveUploadedFile, sanitizePathSegment } from '@/lib/server/storageUpload';

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    const form = await request.formData();
    const ketuaShiftId = String(form.get('ketuaShiftId') || '');
    const filenameHint = String(form.get('filenameHint') || '');
    const file = form.get('file');

    if (!ketuaShiftId) {
      throw new HttpError(400, 'ID Ketua Shift wajib diisi.');
    }
    assertValidProofFile(file, 5 * 1024 * 1024);

    if (!actor.linkedEmployeeId || actor.linkedEmployeeId !== ketuaShiftId) {
      throw new HttpError(403, 'Anda tidak memiliki kewenangan untuk mengunggah berkas ini.');
    }

    const hint = filenameHint ? `${sanitizePathSegment(filenameHint)}_` : '';
    const storagePath = `satpam_shifts/${ketuaShiftId}/${hint}${Date.now()}.jpg`;
    const url = await saveUploadedFile(storagePath, file, actor.uid);
    return NextResponse.json({ url });
  } catch (error) {
    return errorResponse(error);
  }
}
