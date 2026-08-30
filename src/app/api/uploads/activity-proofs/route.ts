import { NextRequest, NextResponse } from 'next/server';
import { errorResponse, HttpError, requireAuthenticatedProfile } from '@/lib/server/auth';
import { assertValidProofFile, saveUploadedFile, sanitizePathSegment } from '@/lib/server/storageUpload';

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    const form = await request.formData();
    const employeeId = String(form.get('employeeId') || '');
    const filenameHint = String(form.get('filenameHint') || '');
    const file = form.get('file');

    if (!employeeId) {
      throw new HttpError(400, 'ID pegawai wajib diisi.');
    }
    assertValidProofFile(file, 5 * 1024 * 1024, { allowPdf: true });

    if (!actor.linkedEmployeeId || actor.linkedEmployeeId !== employeeId) {
      throw new HttpError(403, 'Anda tidak memiliki kewenangan untuk mengunggah berkas ini.');
    }

    const hint = filenameHint ? `${sanitizePathSegment(filenameHint)}_` : '';
    const extension = file.type === 'application/pdf' ? 'pdf' : 'jpg';
    const storagePath = `activity_proofs/${employeeId}/${hint}${Date.now()}.${extension}`;
    const url = await saveUploadedFile(storagePath, file, actor.uid);
    return NextResponse.json({ url });
  } catch (error) {
    return errorResponse(error);
  }
}
