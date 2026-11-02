import admin, { adminDb } from '@/lib/firebase-admin';
import { isImmutablePayrollStatus } from '@/lib/payroll/domain';
import { jobCategoryForPayrollPeriod } from '@/lib/payroll/blueCollarCategory';
import { nextAnnualPaidLeaveBalanceRevision } from '@/lib/payroll/annualPaidLeave';
import { annualPaidLeaveDocumentId, annualPaidLeaveBalanceDocumentId } from './annualPaidLeave';
import { buildFinancialAuditRecord, newFinancialAuditRef } from './audit';
import { HttpError, type AuthenticatedProfile } from './auth';
import { isPeriodClosed } from './payrollPeriod';

export type AutomaticLeaveActor = Omit<AuthenticatedProfile, 'role'> & { role: string };

export function autoLeaveStateRef(period: string, category: string) {
  return adminDb.collection('PekaryaAutoLeaveStates').doc(`${period.replace('-', '_')}__${category}`);
}

export function markAutoLeaveDirty(transaction: FirebaseFirestore.Transaction, period: string, category: string) {
  if (period < '2026-09') return;
  transaction.set(autoLeaveStateRef(period, category), {
    period, category, dirty: true, revision: admin.firestore.FieldValue.increment(1),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

/** Request/post history is shared by reconciliation and actual-attendance commands. */
export function writeAutomaticLeaveWithdrawal(
  transaction: FirebaseFirestore.Transaction,
  reference: FirebaseFirestore.DocumentReference,
  before: FirebaseFirestore.DocumentData,
  actor: AutomaticLeaveActor,
  reason: string,
) {
  const revision = Number(before.revision || 0) + 1;
  const now = admin.firestore.FieldValue.serverTimestamp();
  const after = { ...before, revision, status: 'withdrawn', approvedAmount: 0, approvedPayType: null,
    decisionReason: reason, revokedAt: now, revokedBy: actor.uid, revokedFromStatus: 'approved', updatedAt: now };
  transaction.set(reference, after);
  transaction.delete(adminDb.collection('AnnualPaidLeavePayrollPosts').doc(reference.id));
  transaction.create(adminDb.collection('AnnualPaidLeaveRequestRevisions').doc(`${reference.id}__r${revision}`), {
    annualPaidLeaveRequestId: reference.id, revision, action: 'auto_release', before, after,
    actorUid: actor.uid, reason, createdAt: now,
  });
  transaction.create(newFinancialAuditRef(), buildFinancialAuditRecord(actor, {
    action: 'ANNUAL_PAID_LEAVE_AUTO_RELEASED', entityType: 'AnnualPaidLeaveRequest', entityId: reference.id,
    reason, before, after, metadata: { employeeId: before.employeeId, period: before.period },
  }));
  markAutoLeaveDirty(transaction, String(before.period), String(before.category));
}

/** Read in the caller's read phase; write only after every other read is done. */
export async function prepareAutomaticLeaveRefund(
  transaction: FirebaseFirestore.Transaction, employeeId: string, date: string,
) {
  const requestRef = adminDb.collection('AnnualPaidLeaveRequests').doc(annualPaidLeaveDocumentId(employeeId, date));
  const request = await transaction.get(requestRef);
  const before = request.data();
  if (before?.status !== 'approved' || before.source !== 'auto_absence' || before.employeeKind !== 'blue_collar') return null;
  const balanceRef = adminDb.collection('AnnualPaidLeaveBalances').doc(annualPaidLeaveBalanceDocumentId(employeeId, Number(before.year)));
  const [balance, period, slip] = await Promise.all([
    transaction.get(balanceRef), transaction.get(adminDb.doc(`PayrollPeriods/${before.period}`)),
    transaction.get(adminDb.doc(`PayrollSlipStates/${String(before.period).replace('-', '_')}_${employeeId}`)),
  ]);
  if (isPeriodClosed(period.data()) || isImmutablePayrollStatus(slip.data()?.status)) {
    throw new HttpError(409, 'Cuti otomatis pada slip final atau periode tertutup tidak dapat diubah.');
  }
  return { requestRef, before, balanceRef, balance: balance.data() || {} };
}
export type PreparedAutomaticLeaveRefund = Awaited<ReturnType<typeof prepareAutomaticLeaveRefund>>;

export function writeAutomaticLeaveRefund(
  transaction: FirebaseFirestore.Transaction, prepared: PreparedAutomaticLeaveRefund,
  actor: AutomaticLeaveActor,
) {
  if (!prepared) return;
  writeAutomaticLeaveWithdrawal(transaction, prepared.requestRef, prepared.before, actor,
    'Cuti otomatis dikembalikan karena bukti kehadiran telah dikonfirmasi.');
  const revision = nextAnnualPaidLeaveBalanceRevision(prepared.balance.balanceRevision);
  const after = {
    usedDays: Math.max(0, Number(prepared.balance.usedDays || 0) - 1),
    balanceRevision: revision,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  transaction.set(prepared.balanceRef, after, { merge: true });
  transaction.create(adminDb.doc(`AnnualPaidLeaveBalanceRevisions/${prepared.balanceRef.id}__r${revision}`), {
    employeeId: prepared.before.employeeId, year: prepared.before.year, revision, action: 'auto_refund',
    before: prepared.balance, after: { ...prepared.balance, ...after }, actorUid: actor.uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

export async function assertAutoLeaveReady(period: string, categories: readonly string[]) {
  const snapshots = await Promise.all([...new Set(categories)].map((category) => autoLeaveStateRef(period, category).get()));
  if (snapshots.some((snapshot) => snapshot.data()?.dirty === true)) {
    throw new HttpError(409, 'Rekonsiliasi cuti otomatis belum selesai. Muat ulang presensi sebelum memperbarui atau mengunci slip.');
  }
  return snapshots;
}

export async function assertSlipAutoLeaveReady(transaction: FirebaseFirestore.Transaction,
  employee: FirebaseFirestore.DocumentSnapshot, period: string) {
  if (!employee.exists) return;
  const category = jobCategoryForPayrollPeriod(employee.data()!, period).trim().toUpperCase();
  if ((await transaction.get(autoLeaveStateRef(period, category))).data()?.dirty === true) {
    throw new HttpError(409, 'Rekonsiliasi cuti otomatis belum selesai; slip belum dapat dikunci.');
  }
}
