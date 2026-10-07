import { createHash, randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { adminStorage } from '@/lib/firebase-admin';
import {
  BANSOS_DEFAULT_AMOUNTS,
  validateBansosSubmission,
} from '@/lib/payroll/bansos';
import { detectUploadFileType, MAX_UPLOAD_BYTES } from '@/lib/uploadFileTypes';
import { errorResponse, HttpError, requireAuthenticatedProfile } from '@/lib/server/auth';
import {
  createBansosRequest,
  listOwnBansosRequests,
  parseBansosId,
  requireSelfBansosEmployee,
  withdrawBansosRequest,
} from '@/lib/server/bansos';
import { jakartaToday } from '@/lib/server/payrollPeriod';
import { saveUploadedFile, sanitizePathSegment } from '@/lib/server/storageUpload';

export const dynamic = 'force-dynamic';

const responseHeaders = { 'Cache-Control': 'no-store' };

export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    const employee = await requireSelfBansosEmployee(actor);
    return Response.json({
      employeeId: employee.id,
      employeeName: employee.name,
      employeeClass: employee.employeeClass,
      defaultAmounts: {
        duka: BANSOS_DEFAULT_AMOUNTS.duka[employee.employeeClass],
        melahirkan: BANSOS_DEFAULT_AMOUNTS.melahirkan[employee.employeeClass],
      },
      requests: await listOwnBansosRequests(employee.id),
    }, { headers: responseHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  let uploadedPath = '';
  try {
    const actor = await requireAuthenticatedProfile(request);
    const employee = await requireSelfBansosEmployee(actor);
    const form = await request.formData();
    const requestId = parseBansosId(form.get('requestId'));
    const fields = Object.fromEntries(
      ['kind', 'eventDate', 'subjectName', 'relationship', 'relationshipOther', 'note']
        .map((key) => [key, form.get(key) ?? undefined]),
    );
    let submission;
    try {
      submission = validateBansosSubmission(fields, jakartaToday());
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : 'Data ajuan tidak valid.');
    }

    const file = form.get('file');
    if (!(file instanceof File) || file.size < 1) {
      throw new HttpError(400, 'Bukti wajib dilampirkan.');
    }
    if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(400, 'Ukuran bukti maksimal 5 MB.');
    const bytes = Buffer.from(await file.arrayBuffer());
    // Decided by the file's own bytes, never the declared type or the name.
    const fileType = detectUploadFileType(bytes);
    if (!fileType) {
      throw new HttpError(400, 'Bukti harus berupa foto (JPG, PNG, HEIC, dan lainnya) atau PDF.');
    }
    const fingerprint = createHash('sha256').update(JSON.stringify(submission)).update(bytes).digest('hex');

    const safeName = sanitizePathSegment(file.name.replace(/\.[^/.]+$/, ''), 60) || 'bukti';
    uploadedPath = `bansos_requests/${employee.id}/${Date.now()}_${randomUUID().slice(0, 12)}_${safeName}.${fileType.extension}`;
    const proofUrl = await saveUploadedFile(uploadedPath, file, actor.uid, {
      contentType: fileType.mime,
      customMetadata: { originalName: file.name.trim().slice(0, 180) },
    });

    const result = await createBansosRequest(actor, employee, {
      requestId,
      submission,
      fingerprint,
      proof: {
        name: file.name.trim().slice(0, 180) || `bukti.${fileType.extension}`,
        path: uploadedPath,
        url: proofUrl,
        contentType: fileType.mime,
        size: file.size,
      },
    });
    if (result.idempotent) {
      // The first attempt already stored its own copy of the proof.
      await adminStorage.bucket().file(uploadedPath).delete({ ignoreNotFound: true }).catch(() => undefined);
    }
    uploadedPath = '';
    return Response.json(result, { status: result.idempotent ? 200 : 201, headers: responseHeaders });
  } catch (error) {
    if (uploadedPath) {
      await adminStorage.bucket().file(uploadedPath).delete({ ignoreNotFound: true }).catch((cause) =>
        console.error('Failed to remove unused BanSos proof:', cause));
    }
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    const employee = await requireSelfBansosEmployee(actor);
    const requestId = parseBansosId(request.nextUrl.searchParams.get('requestId'));
    return Response.json(
      await withdrawBansosRequest(actor, employee, requestId),
      { headers: responseHeaders },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
