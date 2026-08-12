import { NextRequest, NextResponse } from 'next/server';
import { errorResponse, HttpError, requireAuthenticatedProfile } from '@/lib/server/auth';
import { assertValidProofFile, saveUploadedFile, sanitizePathSegment } from '@/lib/server/storageUpload';

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    const form = await request.formData();
    const employeeId = String(form.get('employeeId') || '');
    const file = form.get('file');

    if (!employeeId) {
      throw new HttpError(400, 'ID pegawai wajib diisi.');
    }
    assertValidProofFile(file, 5 * 1024 * 1024);

    const isOwner = Boolean(actor.linkedEmployeeId) && actor.linkedEmployeeId === employeeId;
    if (actor.role !== 'loyalis_presence_admin' && !isOwner) {
      throw new HttpError(403, 'Anda tidak memiliki kewenangan untuk mengunggah berkas ini.');
    }

    const safeName = sanitizePathSegment(file.name.replace(/\.[^/.]+$/, '')) || 'bukti';
    const ext = file.name.split('.').pop() || 'jpg';
    const storagePath = `presence_corrections/${employeeId}/${Date.now()}_${safeName}.${ext}`;
    const url = await saveUploadedFile(storagePath, file, actor.uid);
    return NextResponse.json({ url });
  } catch (error) {
    return errorResponse(error);
  }
}
