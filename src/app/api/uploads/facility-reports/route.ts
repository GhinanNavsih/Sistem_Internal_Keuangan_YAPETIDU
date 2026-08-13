import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { MAX_FACILITY_PHOTO_BYTES } from '@/lib/facilityReports';
import { errorResponse, HttpError, requireAuthenticatedProfile } from '@/lib/server/auth';
import { assertValidProofFile, saveUploadedFile } from '@/lib/server/storageUpload';

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    const form = await request.formData();
    const employeeId = String(form.get('employeeId') || '');
    const file = form.get('file');

    if (!employeeId) {
      throw new HttpError(400, 'ID pegawai wajib diisi.');
    }
    assertValidProofFile(file, MAX_FACILITY_PHOTO_BYTES);

    // The photo is uploaded before the report document exists, so it is scoped
    // to the reporting employee rather than to a report id.
    if (!actor.linkedEmployeeId || actor.linkedEmployeeId !== employeeId) {
      throw new HttpError(403, 'Anda tidak memiliki kewenangan untuk mengunggah berkas ini.');
    }

    // A short random suffix (not just Date.now()) keeps concurrent uploads of
    // multiple photos for the same report from colliding on the same path.
    const storagePath = `facility_reports/${employeeId}/${Date.now()}_${randomUUID().slice(0, 8)}.jpg`;
    const url = await saveUploadedFile(storagePath, file, actor.uid);
    return NextResponse.json({ url });
  } catch (error) {
    return errorResponse(error);
  }
}
