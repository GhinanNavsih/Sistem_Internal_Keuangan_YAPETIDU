import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  isBlueCollarFacilityDashboardUser,
  MAX_FACILITY_PHOTO_BYTES,
} from '@/lib/facilityReports';
import { errorResponse, HttpError, requireAuthenticatedProfile } from '@/lib/server/auth';
import { assertValidProofFile, saveUploadedFile } from '@/lib/server/storageUpload';

const FACILITY_REPAIR_PROOF_CACHE_CONTROL = 'private, max-age=31536000, immutable';

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    if (!isBlueCollarFacilityDashboardUser(actor)) {
      throw new HttpError(403, 'Hanya Teknisi dan Kebersihan yang dapat mengunggah bukti perbaikan.');
    }

    const form = await request.formData();
    const employeeId = String(form.get('employeeId') || '');
    const file = form.get('file');

    if (!employeeId) {
      throw new HttpError(400, 'ID pegawai wajib diisi.');
    }
    if (!actor.linkedEmployeeId || actor.linkedEmployeeId !== employeeId) {
      throw new HttpError(403, 'Anda tidak memiliki kewenangan untuk mengunggah bukti ini.');
    }
    assertValidProofFile(file, MAX_FACILITY_PHOTO_BYTES);

    const storagePath = `facility_report_proofs/${employeeId}/${Date.now()}_${randomUUID().slice(0, 8)}.jpg`;
    const url = await saveUploadedFile(storagePath, file, actor.uid, {
      cacheControl: FACILITY_REPAIR_PROOF_CACHE_CONTROL,
    });
    return NextResponse.json({ url });
  } catch (error) {
    return errorResponse(error);
  }
}
