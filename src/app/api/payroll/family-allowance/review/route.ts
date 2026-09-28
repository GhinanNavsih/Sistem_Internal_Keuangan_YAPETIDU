import { NextRequest } from 'next/server';
import { POST as propagateEmployeeProfile } from '@/app/api/payroll/employee-profile-propagation/route';
import admin, { adminDb, adminStorage } from '@/lib/firebase-admin';
import { eligibleFamilyMetrics, familyAllowancePercentage, familyAllowancePeriodDate, todayInJakarta } from '@/lib/payroll/familyAllowance';
import { applyRequestedEnrollment, FAMILY_ALLOWANCE_REQUESTS_COLLECTION } from '@/lib/payroll/familyAllowanceRequests';
import { EMPLOYEE_PROFILE_EDITOR_ROLES } from '@/lib/payroll/roles';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '@/lib/server/audit';
import { errorResponse, HttpError, requireAuthenticatedProfile, requireRole } from '@/lib/server/auth';
import { familyRequestChildOptions, parseFamilyRequestId, serializeFamilyRequest } from '@/lib/server/familyAllowanceRequests';

export const dynamic = 'force-dynamic';

const responseHeaders = { 'Cache-Control': 'no-store' };

export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, EMPLOYEE_PROFILE_EDITOR_ROLES);
    const snapshot = await adminDb.collection(FAMILY_ALLOWANCE_REQUESTS_COLLECTION)
      .where('status', '==', 'pending').get();
    const employeeIds = [...new Set(snapshot.docs.map(doc => String(doc.data().employeeId || '')))]
      .filter(id => /^[A-Za-z0-9_-]{1,128}$/.test(id));
    const employees = employeeIds.length > 0
      ? await adminDb.getAll(...employeeIds.map(id => adminDb.collection('Employees_Loyalis').doc(id)))
      : [];
    const childrenByEmployeeId = Object.fromEntries(employees.map(employee => [
      employee.id,
      familyRequestChildOptions(employee.data()?.family_allowance_metrics, todayInJakarta()),
    ]));
    return Response.json({ requests: snapshot.docs
      .map(doc => serializeFamilyRequest(doc.id, doc.data()))
      .sort((left, right) => left.submittedAt.localeCompare(right.submittedAt)),
      childrenByEmployeeId,
    }, { headers: responseHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, EMPLOYEE_PROFILE_EDITOR_ROLES);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new HttpError(400, 'Keputusan pengajuan tidak valid.');
    const familyRequestId = parseFamilyRequestId(body.familyRequestId);
    const decisionId = parseFamilyRequestId(body.decisionId);
    const action = body.action;
    const expectedRevision = Number(body.expectedRevision);
    const reviewReason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (action !== 'approve' && action !== 'reject') {
      throw new HttpError(400, 'Keputusan pengajuan tidak valid.');
    }
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
      throw new HttpError(400, 'Revisi pengajuan tidak valid.');
    }
    if (reviewReason.length > 500) {
      throw new HttpError(400, 'Catatan keputusan maksimal 500 karakter.');
    }
    const requestRef = adminDb.collection(FAMILY_ALLOWANCE_REQUESTS_COLLECTION).doc(familyRequestId);
    const initial = await requestRef.get();
    if (!initial.exists) throw new HttpError(404, 'Pengajuan tidak ditemukan.');
    const initialData = initial.data() || {};
    const employeeId = String(initialData.employeeId || '');
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(employeeId)) {
      throw new HttpError(409, 'ID Loyalis pada pengajuan tidak valid.');
    }
    const submittedTarget = String(initialData.requestedChildId || '');
    const targetChildId = body.targetChildId === undefined
      ? submittedTarget : String(body.targetChildId || '').trim();
    if (action === 'approve' && (!targetChildId || targetChildId.length > 128 || !/^[A-Za-z0-9_-]+$/.test(targetChildId))) {
      throw new HttpError(400, 'Anak tujuan tidak valid.');
    }
    const proofPath = String(initialData.proofPath || '');
    if (action === 'approve') {
      if (!proofPath.startsWith(`family_allowance_requests/${employeeId}/`) ||
        !/^[A-Za-z0-9_./-]+$/.test(proofPath)) {
        throw new HttpError(409, 'Bukti masuk sekolah tidak valid.');
      }
      const [exists] = await adminStorage.bucket().file(proofPath).exists();
      if (!exists) throw new HttpError(409, 'Bukti masuk sekolah tidak ditemukan.');
    }

    const employeeRef = adminDb.collection('Employees_Loyalis').doc(employeeId);
    const today = todayInJakarta();
    const result = await adminDb.runTransaction(async transaction => {
      const [requestSnapshot, employeeSnapshot] = await Promise.all([
        transaction.get(requestRef), transaction.get(employeeRef),
      ]);
      if (!requestSnapshot.exists) throw new HttpError(404, 'Pengajuan tidak ditemukan.');
      const current = requestSnapshot.data() || {};
      if (current.status !== 'pending') {
        if (current.decisionId === decisionId &&
          current.status === (action === 'approve' ? 'approved' : 'rejected')) {
          return { familyRequestId, employeeId, status: current.status, appliedChildId: current.appliedChildId || null, idempotent: true };
        }
        throw new HttpError(409, 'Pengajuan sudah berubah atau diputuskan. Muat ulang daftar.');
      }
      if (Number(current.revision || 1) !== expectedRevision) {
        throw new HttpError(409, 'Revisi pengajuan berubah. Muat ulang daftar.');
      }
      if (!employeeSnapshot.exists || (action === 'approve' && employeeSnapshot.data()?.personal_info?.status !== 'AKTIF')) {
        throw new HttpError(409, 'Data Loyalis aktif tidak ditemukan.');
      }
      if (current.employeeId !== employeeId || current.proofPath !== proofPath) {
        throw new HttpError(409, 'Pengajuan berubah. Muat ulang daftar.');
      }
      const oldMetrics = employeeSnapshot.data()?.family_allowance_metrics || {};
      let appliedChildId: string | null = null;
      let nextMetrics = oldMetrics;
      if (action === 'approve') {
        try {
          const applied = applyRequestedEnrollment(oldMetrics, {
            targetChildId,
            level: current.level,
            enrolledAt: current.enrolledAt,
            stageId: familyRequestId,
          }, today);
          nextMetrics = applied.metrics;
          appliedChildId = applied.childId;
        } catch (error) {
          throw new HttpError(409, error instanceof Error ? error.message : 'Data anak telah berubah.');
        }
        transaction.update(employeeRef, {
          family_allowance_metrics: nextMetrics,
          'audit.updatedAt': admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      const status = action === 'approve' ? 'approved' : 'rejected';
      transaction.update(requestRef, {
        status,
        revision: expectedRevision + 1,
        reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
        reviewedBy: actor.uid,
        reviewReason: reviewReason || null,
        decisionId,
        appliedChildId,
      });
      const asOf = familyAllowancePeriodDate(today.slice(0, 7));
      transaction.create(newFinancialAuditRef(), buildFinancialAuditRecord(actor, {
        action: action === 'approve' ? 'FAMILY_ALLOWANCE_REQUEST_APPROVED' : 'FAMILY_ALLOWANCE_REQUEST_REJECTED',
        entityType: 'FamilyAllowanceRequest',
        entityId: familyRequestId,
        reason: reviewReason || (action === 'approve' ? 'Bukti sekolah diterima' : 'Bukti sekolah ditolak'),
        requestId: decisionId,
        before: { requestStatus: current.status, familyAllowanceMetrics: oldMetrics },
        after: { requestStatus: status, familyAllowanceMetrics: nextMetrics },
        metadata: {
          employeeId,
          requestedChildId: current.requestedChildId,
          appliedChildId,
          level: current.level,
          enrolledAt: current.enrolledAt,
          proofPath,
          payImpact: 'Tunjangan Keluarga',
          percentageBefore: familyAllowancePercentage(eligibleFamilyMetrics(oldMetrics, asOf)),
          percentageAfter: familyAllowancePercentage(eligibleFamilyMetrics(nextMetrics, asOf)),
        },
      }));
      return { familyRequestId, employeeId, status, appliedChildId, idempotent: false };
    });
    if (result.status !== 'approved') {
      return Response.json(result, { headers: responseHeaders });
    }
    // Reuse the existing guarded profile-to-slip routine. The profile commit
    // happens first; a failed sync is reported for retry without undoing the
    // admin's decision or touching a verified/locked slip.
    try {
      const propagationRequest = new NextRequest(
        new URL('/api/payroll/employee-profile-propagation', request.url),
        {
          method: 'POST',
          headers: {
            authorization: request.headers.get('authorization') || '',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            employeeId: result.employeeId,
            requestId: decisionId,
            changedFields: ['family_allowance_metrics.dependents'],
          }),
        },
      );
      const propagationResponse = await propagateEmployeeProfile(propagationRequest);
      const propagation = await propagationResponse.json();
      return Response.json({
        ...result,
        propagation: propagationResponse.ok
          ? { ok: true, results: propagation.results || [] }
          : { ok: false, error: propagation.error || 'Slip draf gagal disinkronkan.' },
      }, { headers: responseHeaders });
    } catch (error) {
      console.error('Family allowance profile propagation failed:', error);
      return Response.json({ ...result, propagation: { ok: false, error: 'Slip draf gagal disinkronkan.' } },
        { headers: responseHeaders });
    }
  } catch (error) {
    return errorResponse(error);
  }
}
