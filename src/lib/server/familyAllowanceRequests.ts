import { adminDb } from '@/lib/firebase-admin';
import { dependentChildren, graduationDate, isDateOnly, isDependentEligible, nextDependentLevel, type FamilyAllowanceMetrics } from '@/lib/payroll/familyAllowance';
import { type FamilyAllowanceRequest } from '@/lib/payroll/familyAllowanceRequests';
import { assertRequestId } from '@/lib/payroll/domain';
import { HttpError, requireRole, type AuthenticatedProfile } from './auth';

export function parseFamilyRequestId(value: unknown): string {
  const id = typeof value === 'string' ? value.trim() : '';
  try {
    assertRequestId(id);
  } catch {
    throw new HttpError(400, 'ID pengajuan tidak valid.');
  }
  return id;
}

export async function requireSelfLoyalisProfile(actor: AuthenticatedProfile) {
  requireRole(actor, ['loyalis']);
  const employeeId = actor.linkedEmployeeId?.trim() || '';
  if (!employeeId) throw new HttpError(409, 'Akun Anda belum terhubung ke data Loyalis.');
  const snapshot = await adminDb.collection('Employees_Loyalis').doc(employeeId).get();
  if (!snapshot.exists || snapshot.data()?.personal_info?.status !== 'AKTIF') {
    throw new HttpError(409, 'Data Loyalis aktif tidak ditemukan.');
  }
  return snapshot;
}

function timestampToIso(value: unknown): string {
  if (value && typeof value === 'object' && 'toDate' in value &&
    typeof (value as { toDate?: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return typeof value === 'string' ? value : '';
}

export function serializeFamilyRequest(id: string, data: FirebaseFirestore.DocumentData): FamilyAllowanceRequest {
  return {
    id,
    employeeId: String(data.employeeId || ''),
    employeeName: String(data.employeeName || ''),
    requestedChildId: String(data.requestedChildId || 'new'),
    level: data.level,
    enrolledAt: String(data.enrolledAt || ''),
    proofName: String(data.proofName || ''),
    proofPath: String(data.proofPath || ''),
    proofUrl: String(data.proofUrl || ''),
    proofContentType: String(data.proofContentType || ''),
    proofSize: Number(data.proofSize || 0),
    status: data.status,
    revision: Number(data.revision || 1),
    submittedAt: timestampToIso(data.submittedAt),
    ...(data.reviewedAt ? { reviewedAt: timestampToIso(data.reviewedAt) } : {}),
    ...(data.reviewedBy ? { reviewedBy: String(data.reviewedBy) } : {}),
    ...(data.reviewReason ? { reviewReason: String(data.reviewReason) } : {}),
    ...(data.appliedChildId ? { appliedChildId: String(data.appliedChildId) } : {}),
  };
}

export function familyRequestChildOptions(metrics: FamilyAllowanceMetrics | null | undefined, today: string) {
  return dependentChildren(metrics).map((child, index) => {
    const latest = child.latest;
    const graduation = latest.level !== 'PT' && isDateOnly(latest.enrolled_at)
      ? graduationDate(latest.enrolled_at, latest.level)
      : '';
    return {
      id: child.id,
      number: index + 1,
      level: latest.level,
      enrolledAt: latest.enrolled_at || '',
      graduatedAt: graduation,
      eligibleToday: isDependentEligible(latest, today),
      requestable: !latest.ended_at && (!isDateOnly(latest.enrolled_at) ||
        (!isDependentEligible(latest, today) && !!nextDependentLevel(latest.level))),
    };
  });
}
