import admin, { adminDb } from '@/lib/firebase-admin';
import { isImmutablePayrollStatus } from '@/lib/payroll/domain';
import { jobCategoryForPayrollPeriod } from '@/lib/payroll/blueCollarCategory';
import { periodCalendarFromData } from '@/lib/payroll/calendar';
import { isPayableSatpamOfficialLeave, satpamOfficialLeavePayment } from '@/lib/payroll/satpamOfficialLeave';
import { satpamDutyPlanId } from '@/lib/payroll/satpamDutyPlan';
import { annualCalendarRef, annualDatesFrom, buildPeriodMaterialization, isPeriodClosed } from './payrollPeriod';
import { readSatpamLeaveWorkEntries, writeSatpamLeaveWorkExclusions } from './satpamOfficialLeave';
import { annualPaidLeaveDocumentId, ANNUAL_PAID_LEAVE_REQUESTS_COLLECTION } from './annualPaidLeave';
import { hasGantiLiburDayOff } from '@/lib/payroll/gantiLibur';

const ACTOR = 'system:satpam-approved-leave-pay-v2';
const REASON = 'Approved scheduled official leave is the payroll source, at the scheduled duty rate.';

/** Repair derived payroll data only; preserve the administrator's leave decision. */
export async function repairSatpamApprovedLeavePay(id: string, expectedRevision: number, commit = false) {
  const absenceRef = adminDb.collection('SatpamAbsenceRequests').doc(id);
  return adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(absenceRef);
    const before = snapshot.data();
    if (!before || Number(before.revision || 0) !== expectedRevision) throw new Error(`Stale leave revision: ${id}`);
    if (!isPayableSatpamOfficialLeave(before)) return { id, status: 'skipped', reason: 'Not approved scheduled official leave' };
    const period = String(before.period);
    const employeeId = String(before.employeeId);
    const date = String(before.dutyDate);
    const periodRef = adminDb.collection('PayrollPeriods').doc(period);
    const entitlementRef = adminDb.collection('SatpamAbsenceEntitlements').doc(id);
    const ledgerRef = adminDb.collection('PayrollLedgerEntries').doc(`ABS-${id}`);
    const [periodDoc, holidayDoc, slipDoc, planDoc, employeeDoc, reports, entitlementDoc, ledgerDoc, annualLeaveDoc, gantiLiburDocs] = await Promise.all([
      transaction.get(periodRef), transaction.get(annualCalendarRef(period)),
      transaction.get(adminDb.doc(`PayrollSlipStates/${period.replace('-', '_')}_${employeeId}`)),
      transaction.get(adminDb.doc(`SatpamDutyPlans/${satpamDutyPlanId(period, String(before.teamId))}`)),
      transaction.get(adminDb.doc(`Employees_BlueCollar/${employeeId}`)),
      transaction.get(adminDb.collection('ActivityReports').where('employeeId', '==', employeeId)),
      transaction.get(entitlementRef), transaction.get(ledgerRef),
      transaction.get(adminDb.collection(ANNUAL_PAID_LEAVE_REQUESTS_COLLECTION).doc(annualPaidLeaveDocumentId(employeeId, date))),
      transaction.get(adminDb.collection('GantiLiburRequests').where('employeeId', '==', employeeId)),
    ]);
    if (isPeriodClosed(periodDoc.data()) || isImmutablePayrollStatus(slipDoc.data()?.status)) {
      return { id, period, status: 'blocked', reason: 'Closed period or immutable slip' };
    }
    const plan = planDoc.data();
    const day = plan?.generatedDays?.find((day: { dutyDate: string }) => day.dutyDate === date);
    const employee = employeeDoc.data();
    if (!day?.assignments?.some((assignment: { employeeId: string }) => assignment.employeeId === employeeId) ||
      !employee || jobCategoryForPayrollPeriod(employee, date.slice(0, 7)) !== 'SATPAM' ||
      employee.employment?.status !== 'active' || employee.flags?.isActive === false || employee.flags?.isPayrollEligible === false) {
      return { id, period, status: 'blocked', reason: 'Scheduled active employee could not be verified' };
    }
    if (annualLeaveDoc.data()?.status === 'approved' || hasGantiLiburDayOff(gantiLiburDocs.docs.map((doc) => doc.data()), date, true)) {
      return { id, period, status: 'blocked', reason: 'Another approved paid leave exists' };
    }
    const calendar = periodCalendarFromData(period, periodDoc.data(), annualDatesFrom(holidayDoc));
    const payment = satpamOfficialLeavePayment(date, new Set(calendar.premiumDates));
    const work = await readSatpamLeaveWorkEntries(transaction, reports.docs, date, id);
    const requestChanged = before.approvedAmount !== payment.amount || before.approvedPayType !== payment.payType ||
      before.payrollExcludedFromHarian === true || Boolean(before.payrollExclusionReason) || Boolean(before.payrollExclusionShiftReportId);
    const financialChanged = [entitlementDoc, ledgerDoc].some((doc) => doc.data()?.status !== 'posted' ||
      doc.data()?.amount !== payment.amount || doc.data()?.payType !== payment.payType);
    const workChanged = work.some(({ report, ledger }) => report.status === 'approved' &&
      (report.payrollExclusionAbsenceRequestId !== id || Number(report.fee || 0) !== 0 || ledger?.status !== 'voided' || Number(ledger?.amount || 0) !== 0));
    const result = {
      id, period, employeeName: String(before.employeeName || employeeId), dutyDate: date,
      previousAmount: Number(before.approvedAmount || 0), amount: payment.amount, payType: payment.payType,
      replacedWorkAmount: work.filter(({ report }) => report.status === 'approved').reduce((total, { report }) => total + Number(report.fee || 0), 0),
      status: requestChanged || financialChanged || workChanged ? (commit ? 'repaired' : 'would_repair') : 'unchanged',
    };
    if (!commit || result.status === 'unchanged') return result;
    const now = admin.firestore.FieldValue.serverTimestamp();
    const revision = expectedRevision + 1;
    const requestId = `satpam-leave-pay-v2__${id}__r${expectedRevision}`;
    const after = { ...before, revision, approvedAmount: payment.amount, approvedPayType: payment.payType,
      payrollExcludedFromHarian: false, payrollExclusionReason: null, payrollExclusionShiftReportId: null,
      payrollPolicyVersion: 2, payrollCorrectedAt: now, payrollCorrectedBy: ACTOR, updatedAt: now };
    const materialization = buildPeriodMaterialization({ period, periodData: periodDoc.data(),
      annualDates: annualDatesFrom(holidayDoc), actorUid: ACTOR, reason: REASON });
    if (materialization) transaction.set(periodRef, materialization, { merge: true });
    transaction.set(absenceRef, after);
    transaction.create(adminDb.doc(`SatpamAbsenceRequestRevisions/${id}__r${revision}`), {
      absenceRequestId: id, revision, action: 'repair_payroll', before, after, actorUid: ACTOR, requestId, reason: REASON, createdAt: now,
    });
    transaction.set(entitlementRef, {
      ...(entitlementDoc.data() || {}), absenceRequestId: id, employeeId, employeeName: result.employeeName,
      dutyDate: date, period, teamId: before.teamId, planId: planDoc.id, planRevision: Number(plan?.revision || 0),
      status: 'posted', count: 1, amount: payment.amount, payType: payment.payType,
      sourceType: 'satpam_approved_absence', revision, payrollPolicyVersion: 2,
      payrollExcludedFromHarian: false, payrollExclusionReason: null, payrollExclusionShiftReportId: null,
      updatedAt: now, updatedBy: ACTOR,
      voidedReason: admin.firestore.FieldValue.delete(), voidedAt: admin.firestore.FieldValue.delete(), voidedBy: admin.firestore.FieldValue.delete(),
    }, { merge: true });
    transaction.set(ledgerRef, {
      ...(ledgerDoc.data() || {}), employeeId, payrollPeriod: period, dutyDate: date,
      sourceType: 'satpam_approved_absence', sourceId: id, status: 'posted', amount: payment.amount, payType: payment.payType, currency: 'IDR',
      payrollExcludedFromHarian: false, payrollExclusionReason: null, payrollExclusionShiftReportId: null,
      updatedAt: now, updatedBy: ACTOR, payrollPolicyVersion: 2,
      voidedReason: admin.firestore.FieldValue.delete(), voidedAt: admin.firestore.FieldValue.delete(), voidedBy: admin.firestore.FieldValue.delete(),
    }, { merge: true });
    writeSatpamLeaveWorkExclusions(transaction, work, id, true, ACTOR);
    transaction.create(adminDb.collection('FinancialAuditLogs').doc(), {
      action: 'SATPAM_APPROVED_LEAVE_PAY_REPAIRED', entityType: 'SatpamAbsenceRequest', entityId: id,
      actorUid: ACTOR, actorRole: 'system', actorEmail: null, requestId, reason: REASON, before, after,
      metadata: { ...result, previousEntitlement: entitlementDoc.data() || null, previousLedger: ledgerDoc.data() || null,
        overlappingWork: work.map(({ snapshot, report, ledger }) => ({ reportId: snapshot.id, report, ledger: ledger || null })) },
      occurredAt: now, schemaVersion: 1,
    });
    transaction.create(adminDb.doc(`FinancialIdempotencyKeys/${requestId}`), { entityId: id, revision, actorUid: ACTOR, requestId, createdAt: now });
    return result;
  });
}
