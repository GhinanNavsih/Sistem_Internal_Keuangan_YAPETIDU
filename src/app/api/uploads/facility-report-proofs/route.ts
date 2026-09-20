import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  canUploadFacilityRepairProof,
  MAX_FACILITY_PHOTO_BYTES,
} from '@/lib/facilityReports';
import { errorResponse, HttpError, requireAuthenticatedProfile } from '@/lib/server/auth';
import { assertValidProofFile, saveUploadedFile } from '@/lib/server/storageUpload';

const FACILITY_REPAIR_PROOF_CACHE_CONTROL = 'private, max-age=31536000, immutable';

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    if (!canUploadFacilityRepairProof(actor)) {
      throw new HttpError(
        403,
        'Hanya Teknisi, Kebersihan, dan Kepala SatKer yang dapat mengunggah bukti perbaikan.',
      );
    }

    const form = await request.formData();
    const providedId = String(form.get('employeeId') || form.get('uploaderId') || '').trim();
    const file = form.get('file');

    const expectedId = actor.linkedEmployeeId || actor.uid;
    if (!providedId) {
      throw new HttpError(400, 'ID pengunggah wajib diisi.');
    }
    if (providedId !== actor.linkedEmployeeId && providedId !== actor.uid) {
      throw new HttpError(403, 'Anda tidak memiliki kewenangan untuk mengunggah bukti ini.');
    }
    assertValidProofFile(file, MAX_FACILITY_PHOTO_BYTES);

    const storagePath = `facility_report_proofs/${expectedId}/${Date.now()}_${randomUUID().slice(0, 8)}.jpg`;
    const url = await saveUploadedFile(storagePath, file, actor.uid, {
      cacheControl: FACILITY_REPAIR_PROOF_CACHE_CONTROL,
    });
    return NextResponse.json({ url });
  } catch (error) {
    return errorResponse(error);
  }
}
