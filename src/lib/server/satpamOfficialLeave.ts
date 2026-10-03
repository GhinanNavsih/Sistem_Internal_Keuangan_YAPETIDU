import admin, { adminDb } from '@/lib/firebase-admin';
import { isSatpamShiftPayReport } from '@/lib/payroll/satpamOfficialLeave';

/** Read before any transaction writes. Retain the work review and its evidence. */
export async function readSatpamLeaveWorkEntries(
  transaction: FirebaseFirestore.Transaction,
  reports: FirebaseFirestore.QueryDocumentSnapshot[],
  dutyDate: string,
  absenceRequestId: string,
) {
  const overlapping = reports.filter((snapshot) => {
    const report = snapshot.data();
    return String(report.dutyDate || report.activityDate || '') === dutyDate &&
      ((report.status === 'approved' && isSatpamShiftPayReport(report)) ||
        report.payrollExclusionAbsenceRequestId === absenceRequestId);
  });
  return Promise.all(overlapping.map(async (snapshot) => {
    const report = snapshot.data();
    const ledgerRef = adminDb.collection('PayrollLedgerEntries').doc(String(report.sourceLedgerEntryId || snapshot.id));
    const ledger = await transaction.get(ledgerRef);
    return { snapshot, report, ledgerRef, ledger: ledger.data() };
  }));
}

export function writeSatpamLeaveWorkExclusions(
  transaction: FirebaseFirestore.Transaction,
  entries: Awaited<ReturnType<typeof readSatpamLeaveWorkEntries>>,
  absenceRequestId: string,
  payable: boolean,
  actorUid: string,
) {
  const now = admin.firestore.FieldValue.serverTimestamp();
  for (const entry of entries) {
    const { snapshot, report, ledgerRef, ledger } = entry;
    if (payable && report.status === 'approved') {
      const before = report.payrollBeforeApprovedLeave || {
        fee: Number(report.fee || 0),
        ledgerStatus: ledger?.status || null,
        ledgerAmount: Number(ledger?.amount || 0),
      };
      transaction.update(snapshot.ref, {
        fee: 0,
        payrollExcludedByApprovedLeave: true,
        payrollExclusionAbsenceRequestId: absenceRequestId,
        payrollBeforeApprovedLeave: before,
        updatedAt: now,
      });
      transaction.set(ledgerRef, {
        ...(ledger || {}),
        employeeId: report.employeeId,
        payrollPeriod: String(report.period || report.payrollPeriod || report.dutyDate?.slice(0, 7)),
        sourceType: 'satpam_shift',
        sourceId: snapshot.id,
        payType: report.shiftType,
        currency: 'IDR',
        status: 'voided',
        amount: 0,
        voidedReason: 'APPROVED_OFFICIAL_LEAVE',
        absenceRequestId,
        voidedBy: actorUid,
        updatedAt: now,
      });
    } else if (report.payrollExclusionAbsenceRequestId === absenceRequestId) {
      const before = report.payrollBeforeApprovedLeave;
      // Reversing leave restores only work that remains approved.
      const restoreWork = report.status === 'approved' && before;
      transaction.update(snapshot.ref, {
        ...(restoreWork ? { fee: Number(before.fee || 0) } : {}),
        payrollExcludedByApprovedLeave: false,
        payrollExclusionAbsenceRequestId: admin.firestore.FieldValue.delete(),
        payrollBeforeApprovedLeave: admin.firestore.FieldValue.delete(),
        updatedAt: now,
      });
      if (restoreWork && before.ledgerStatus === 'posted') {
        transaction.set(ledgerRef, {
          status: 'posted', amount: Number(before.ledgerAmount || 0),
          voidedReason: admin.firestore.FieldValue.delete(),
          voidedBy: admin.firestore.FieldValue.delete(),
          voidedAt: admin.firestore.FieldValue.delete(),
          absenceRequestId: admin.firestore.FieldValue.delete(),
          restoredBy: actorUid, updatedAt: now,
        }, { merge: true });
      }
    }
  }
}
