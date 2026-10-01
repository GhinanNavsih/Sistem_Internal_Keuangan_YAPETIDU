import { createHash, randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import admin, { adminDb, adminStorage } from '@/lib/firebase-admin';
import { todayInJakarta, type DependentLevel } from '@/lib/payroll/familyAllowance';
import {
  applyRequestedEnrollment,
  assertActiveEnrollment,
  FAMILY_ALLOWANCE_REQUESTS_COLLECTION,
  FAMILY_PROOF_MAX_BYTES,
  NEW_CHILD_TARGET,
} from '@/lib/payroll/familyAllowanceRequests';
import { gantiLiburAttachmentContentType } from '@/lib/payroll/gantiLiburAttachments';
import { errorResponse, HttpError, requireAuthenticatedProfile } from '@/lib/server/auth';
import { familyRequestChildOptions, parseFamilyRequestId, requireSelfLoyalisProfile, serializeFamilyRequest } from '@/lib/server/familyAllowanceRequests';
import { saveUploadedFile, sanitizePathSegment } from '@/lib/server/storageUpload';

export const dynamic = 'force-dynamic';

const responseHeaders = { 'Cache-Control': 'no-store' };

export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    const employee = await requireSelfLoyalisProfile(actor);
    const snapshot = await adminDb.collection(FAMILY_ALLOWANCE_REQUESTS_COLLECTION)
      .where('employeeId', '==', employee.id).get();
    const today = todayInJakarta();
    return Response.json({
      employeeId: employee.id,
      employeeName: String(employee.data()?.personal_info?.name || actor.displayName || ''),
      children: familyRequestChildOptions(employee.data()?.family_allowance_metrics, today),
      requests: snapshot.docs
        .map(doc => serializeFamilyRequest(doc.id, doc.data()))
        .sort((left, right) => right.submittedAt.localeCompare(left.submittedAt)),
    }, { headers: responseHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  let uploadedPath = '';
  try {
    const actor = await requireAuthenticatedProfile(request);
    const employee = await requireSelfLoyalisProfile(actor);
    const form = await request.formData();
    const requestId = parseFamilyRequestId(form.get('requestId'));
    const targetChildId = String(form.get('targetChildId') || '').trim();
    const level = form.get('level');
    // SD is tracked by birth date: the allowance starts at birth, so the date
    // the employee sends is also the allowance start (`enrolledAt`).
    const birthDate = level === 'SD' ? form.get('birthDate') : undefined;
    const enrolledAt = level === 'SD' ? birthDate : form.get('enrolledAt');
    const file = form.get('file');
    const today = todayInJakarta();

    if (!targetChildId || targetChildId.length > 128 || !/^[A-Za-z0-9_-]+$/.test(targetChildId)) {
      throw new HttpError(400, 'Anak yang diajukan tidak valid.');
    }
    try {
      assertActiveEnrollment(level, enrolledAt, today, birthDate);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : 'Data sekolah tidak valid.');
    }
    if (!(file instanceof File) || file.size < 1 || file.size > FAMILY_PROOF_MAX_BYTES) {
      throw new HttpError(400, level === 'SD'
        ? 'Bukti tanggal lahir anak wajib berupa berkas maksimal 5 MB.'
        : 'Bukti pertama masuk sekolah wajib berupa berkas maksimal 5 MB.');
    }
    const contentType = gantiLiburAttachmentContentType(file.name, file.type);
    if (!contentType) {
      throw new HttpError(400, 'Bukti harus berupa foto atau PDF, bukan SVG.');
    }
    const fileBytes = Buffer.from(await file.arrayBuffer());
    const fingerprint = createHash('sha256').update(JSON.stringify({ targetChildId, level, enrolledAt, birthDate }))
      .update(fileBytes).digest('hex');
    const requestRef = adminDb.collection(FAMILY_ALLOWANCE_REQUESTS_COLLECTION).doc(requestId);
    const existing = await requestRef.get();
    if (existing.exists) {
      const data = existing.data() || {};
      if (data.employeeId === employee.id && data.fingerprint === fingerprint) {
        return Response.json({ requestId, status: data.status, idempotent: true }, { headers: responseHeaders });
      }
      throw new HttpError(409, 'ID pengajuan sudah digunakan. Coba kirim ulang dari halaman ini.');
    }

    try {
      applyRequestedEnrollment(employee.data()?.family_allowance_metrics, {
        targetChildId, level: level as DependentLevel, enrolledAt: enrolledAt as string,
          birthDate: birthDate as string | undefined, stageId: requestId,
      }, today);
    } catch (error) {
      throw new HttpError(409, error instanceof Error ? error.message : 'Data anak telah berubah.');
    }

    const pendingQuery = adminDb.collection(FAMILY_ALLOWANCE_REQUESTS_COLLECTION)
      .where('employeeId', '==', employee.id);
    const pendingSnapshot = await pendingQuery.get();
    if (targetChildId !== NEW_CHILD_TARGET && pendingSnapshot.docs.some(doc =>
      doc.data().status === 'pending' && doc.data().requestedChildId === targetChildId)) {
      throw new HttpError(409, 'Anak ini sudah memiliki pengajuan yang menunggu keputusan admin.');
    }

    const extension = contentType === 'application/pdf' ? 'pdf' :
      (file.name.split('.').pop() || contentType.split('/')[1] || 'img').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
    const safeName = sanitizePathSegment(file.name.replace(/\.[^/.]+$/, ''), 60) || 'bukti';
    uploadedPath = `family_allowance_requests/${employee.id}/${Date.now()}_${randomUUID().slice(0, 12)}_${safeName}.${extension}`;
    const proofUrl = await saveUploadedFile(uploadedPath, file, actor.uid, {
      contentType,
      customMetadata: { originalName: file.name.trim().slice(0, 180) },
    });

    const result = await adminDb.runTransaction(async transaction => {
      const [latestRequest, latestEmployee, requestsForEmployee] = await Promise.all([
        transaction.get(requestRef),
        transaction.get(employee.ref),
        transaction.get(pendingQuery),
      ]);
      if (latestRequest.exists) throw new HttpError(409, 'Pengajuan ini sudah tersimpan. Muat ulang daftar pengajuan.');
      if (!latestEmployee.exists || latestEmployee.data()?.personal_info?.status !== 'AKTIF') {
        throw new HttpError(409, 'Data Loyalis aktif tidak ditemukan.');
      }
      if (targetChildId !== NEW_CHILD_TARGET && requestsForEmployee.docs.some(doc =>
        doc.data().status === 'pending' && doc.data().requestedChildId === targetChildId)) {
        throw new HttpError(409, 'Anak ini sudah memiliki pengajuan yang menunggu keputusan admin.');
      }
      try {
        applyRequestedEnrollment(latestEmployee.data()?.family_allowance_metrics, {
          targetChildId, level: level as DependentLevel, enrolledAt: enrolledAt as string,
          birthDate: birthDate as string | undefined, stageId: requestId,
        }, today);
      } catch (error) {
        throw new HttpError(409, error instanceof Error ? error.message : 'Data anak telah berubah.');
      }
      transaction.create(requestRef, {
        employeeId: employee.id,
        employeeName: String(latestEmployee.data()?.personal_info?.name || actor.displayName || ''),
        submitterUid: actor.uid,
        requestedChildId: targetChildId,
        level,
        enrolledAt,
        ...(birthDate ? { birthDate } : {}),
        proofName: file.name.trim().slice(0, 180),
        proofPath: uploadedPath,
        proofUrl,
        proofContentType: contentType,
        proofSize: file.size,
        fingerprint,
        status: 'pending',
        revision: 1,
        submittedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { requestId, status: 'pending' };
    });
    uploadedPath = '';
    return Response.json(result, { status: 201, headers: responseHeaders });
  } catch (error) {
    if (uploadedPath) {
      await adminStorage.bucket().file(uploadedPath).delete({ ignoreNotFound: true }).catch(cause =>
        console.error('Failed to remove unused family allowance proof:', cause));
    }
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    const employee = await requireSelfLoyalisProfile(actor);
    const requestId = parseFamilyRequestId(request.nextUrl.searchParams.get('requestId'));
    const requestRef = adminDb.collection(FAMILY_ALLOWANCE_REQUESTS_COLLECTION).doc(requestId);
    const result = await adminDb.runTransaction(async transaction => {
      const snapshot = await transaction.get(requestRef);
      if (!snapshot.exists || snapshot.data()?.employeeId !== employee.id) {
        throw new HttpError(404, 'Pengajuan tidak ditemukan.');
      }
      if (snapshot.data()?.status === 'withdrawn') return { requestId, status: 'withdrawn' };
      if (snapshot.data()?.status !== 'pending') {
        throw new HttpError(409, 'Hanya pengajuan yang menunggu dapat ditarik.');
      }
      transaction.update(requestRef, {
        status: 'withdrawn',
        revision: Number(snapshot.data()?.revision || 1) + 1,
        withdrawnAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { requestId, status: 'withdrawn' };
    });
    return Response.json(result, { headers: responseHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}
