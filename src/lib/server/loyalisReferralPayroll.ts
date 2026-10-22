import admin, { adminDb } from '@/lib/firebase-admin';
import { REFERRAL_AMOUNT, REFERRAL_LABEL, REFERRAL_SOURCE, type ReferralDelivery } from '@/lib/loyalis-referral-contract';
import { calculatePayrollTotals, validateMoneyFields, type MoneyField } from '@/lib/payroll/domain';
import { recalculateSlipTaxes } from '@/lib/payroll/payrollTax';
import { HttpError, type AuthenticatedProfile } from './auth';
import { buildFinancialAuditRecord, newFinancialAuditRef } from './audit';
import { annualCalendarRef, annualDatesFrom, buildPeriodMaterialization, isPeriodClosed, jakartaToday, shiftPeriod } from './payrollPeriod';

export const REFERRAL_BONUSES = 'LoyalisReferralBonuses';
export const REFERRAL_RECOVERIES = 'LoyalisReferralRecoveries';
export const REFERRAL_EVENT_PREFIX = 'BONUS_REKOMENDASI_';
const SYSTEM = { uid: 'system:loyalis_referral', role: 'super_admin', displayName: 'Integrasi PMB', email: null, permittedCategories: [] } as AuthenticatedProfile;
const periodOf = (iso: string) => jakartaToday(new Date(iso)).slice(0, 7);
const slipRef = (period: string, id: string) => adminDb.collection('PayrollSlipStates').doc(`${period.replace('-', '_')}_${id}`);
const eventRef = (period: string) => adminDb.collection('VakasiTambahan').doc(`${REFERRAL_EVENT_PREFIX}${period}`);
const normalize = (s: string) => s.trim().toLocaleLowerCase('id-ID');
export const recoveryLabel = (claimId: string) => `Pengembalian Bonus Rekomendasi (${claimId})`;

function writeSlip(tx: FirebaseFirestore.Transaction, ref: FirebaseFirestore.DocumentReference, before: FirebaseFirestore.DocumentData, earnings: MoneyField[], deductions: MoneyField[], actor = SYSTEM) {
  const taxes = recalculateSlipTaxes(before, earnings, deductions);
  const after = { ...before, earnings, deductions, taxes, ...calculatePayrollTotals(earnings, deductions, taxes), revision: Number(before.revision || 0) + 1, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: actor.uid };
  tx.set(ref, after);
  tx.create(newFinancialAuditRef(), buildFinancialAuditRecord(actor, { action: 'LOYALIS_REFERRAL_PAYROLL', entityType: 'PayrollSlipState', entityId: ref.id, reason: 'Sinkronisasi bonus atau pengembalian rekomendasi PMB', before, after }));
}
async function editableTarget(tx: FirebaseFirestore.Transaction, employeeId: string, start: string, requireSlip = false) {
  let period = start;
  for (let i = 0; i < 24; i++, period = shiftPeriod(period, 1)) {
    const [calendar, slip] = await tx.getAll(adminDb.collection('PayrollPeriods').doc(period), slipRef(period, employeeId));
    if (!isPeriodClosed(calendar.data()) && (!slip.exists || slip.get('status') === 'draft')) {
      if (requireSlip && !slip.exists) continue;
      return { period, slip, calendar };
    }
  }
  return null;
}
function writeEmployeeEvent(tx: FirebaseFirestore.Transaction, snapshot: FirebaseFirestore.DocumentSnapshot, employeeId: string, employeeName: string, delta: number, period: string, claimId: string, state: string, detail: ReferralDelivery) {
  const before = snapshot.data() || {};
  if (snapshot.exists && before.sourceKind !== REFERRAL_SOURCE) throw new HttpError(409, 'ID kegiatan sudah dipakai sumber lain.');
  const workers = { ...(before.eventWorkers || {}) };
  const amount = Number(workers[employeeId]?.payGiven || 0) + delta;
  if (amount < 0) throw new HttpError(409, 'Saldo bonus rekomendasi tidak konsisten.');
  if (amount > 0) workers[employeeId] = { employeeName, employeeCollection: 'Employees_Loyalis', payGiven: amount, recommendationCount: amount / REFERRAL_AMOUNT };
  else delete workers[employeeId];
  const labels = { ...(before.ownedEarningLabelsByEmployee || {}), [employeeId]: [REFERRAL_LABEL] };
  const now = admin.firestore.FieldValue.serverTimestamp();
  const after = { ...before, eventName: REFERRAL_LABEL, period, sourceKind: REFERRAL_SOURCE, isEndOfMonth: true, departmentUnit: null,
    eventWorkers: workers, ownedEarningLabelsByEmployee: labels, totalPayout: Object.values(workers).reduce((sum: number, w) => sum + Number((w as {payGiven: number}).payGiven), 0),
    status: Object.keys(workers).length ? 'approved' : 'pending_review', revision: Number(before.revision || 0) + 1,
    referralDetails: { ...(before.referralDetails || {}), [claimId]: { employeeName, prospectName: detail.prospectName, cycleId: detail.cycleId, qualifiedAt: detail.qualifiedAt, ...(detail.payrollTest ? { payrollTest: true } : {}) } },
    referralStates: { ...(before.referralStates || {}), [claimId]: state }, createdAt: before.createdAt || now, createdBy: before.createdBy || SYSTEM.uid,
    submittedBy: SYSTEM.uid, submittedByName: 'Integrasi PMB', updatedAt: now, updatedBy: SYSTEM.uid, schemaVersion: 3 };
  tx.set(snapshot.ref, after);
  tx.create(newFinancialAuditRef(), buildFinancialAuditRecord(SYSTEM, { action: 'LOYALIS_REFERRAL_EVENT', entityType: 'VakasiTambahan', entityId: snapshot.id, reason: 'Perubahan hak bonus rekomendasi PMB', before: snapshot.exists ? before : null, after }));
  return amount;
}

export async function applyReferralDelivery(payload: ReferralDelivery) {
  if (payload.amount !== REFERRAL_AMOUNT || !Number.isSafeInteger(payload.version) || payload.version < 1 || !/^RL-\d{4}-[A-F0-9]{16}$/.test(payload.claimId) || payload.claimId !== payload.letterId || !/^[A-Za-z0-9_-]{1,128}$/.test(payload.employeeId) || !['qualified', 'cancelled'].includes(payload.state) || !Number.isFinite(Date.parse(payload.occurredAt)) || (payload.state === 'qualified' && !Number.isFinite(Date.parse(payload.qualifiedAt || '')))) throw new HttpError(400, 'Data bonus rekomendasi tidak valid.');
  const ref = adminDb.collection(REFERRAL_BONUSES).doc(payload.claimId);
  return adminDb.runTransaction(async tx => {
    const [snapshot, employee, receipt] = await tx.getAll(ref, adminDb.collection('Employees_Loyalis').doc(payload.employeeId), adminDb.collection('LoyalisReferralReceipts').doc(payload.claimId));
    const before = snapshot.data();
    if (!snapshot.exists && receipt.exists) throw new HttpError(409, 'Ledger bonus hilang setelah pernah diakui. Finance perlu memeriksa jejak payroll sebelum pemulihan.');
    if (before && (before.employeeId !== payload.employeeId || before.applicationId !== payload.applicationId || before.letterId !== payload.letterId || before.cycleId !== payload.cycleId || before.payable !== payload.payable)) throw new HttpError(409, 'Identitas klaim rekomendasi berubah.');
    if (before?.version === payload.version && (before.state !== payload.state || before.qualifiedAt !== payload.qualifiedAt)) throw new HttpError(409, 'Versi klaim sama memiliki isi berbeda.');
    if (before && before.version >= payload.version) return { claimId: payload.claimId, version: before.version, status: before.status };
    const next: FirebaseFirestore.DocumentData = { ...payload, postedPeriod: before?.postedPeriod || null, manualSettlement: before?.manualSettlement || null, status: 'cancelled', updatedAt: admin.firestore.FieldValue.serverTimestamp() };
    if (!payload.payable) next.status = 'test_skipped';
    else if (payload.state === 'qualified') {
      if (before?.state === 'cancelled') throw new HttpError(409, 'Klaim yang dibatalkan tidak dapat diaktifkan kembali.');
      if (before?.postedPeriod) { next.status = before.status; }
      else {
        const target = employee.get('personal_info.status') === 'AKTIF' ? await editableTarget(tx, payload.employeeId, periodOf(payload.qualifiedAt!)) : null;
        if (!target) next.status = 'finance_review';
        else {
          const [event, annual] = await tx.getAll(eventRef(target.period), annualCalendarRef(target.period));
          const materialized = buildPeriodMaterialization({ period: target.period, periodData: target.calendar.data(), annualDates: annualDatesFrom(annual), actorUid: SYSTEM.uid, reason: 'Bonus rekomendasi PMB' });
          if (materialized) tx.set(target.calendar.ref, materialized, { merge: true });
          const amount = writeEmployeeEvent(tx, event, payload.employeeId, payload.employeeName, REFERRAL_AMOUNT, target.period, payload.claimId, 'qualified', payload);
          if (target.slip.exists) {
            const slip = target.slip.data()!;
            const earnings = validateMoneyFields(slip.earnings || [], 'earnings').filter(row => normalize(row.label) !== normalize(REFERRAL_LABEL));
            earnings.push({ label: REFERRAL_LABEL, amount });
            writeSlip(tx, target.slip.ref, slip, earnings, validateMoneyFields(slip.deductions || [], 'deductions'));
          }
          next.postedPeriod = target.period; next.status = 'posted';
        }
      }
    } else if (before?.postedPeriod) {
      const period = before.postedPeriod as string;
      const [calendar, slip, event, recovery] = await tx.getAll(adminDb.collection('PayrollPeriods').doc(period), slipRef(period, payload.employeeId), eventRef(period), adminDb.collection(REFERRAL_RECOVERIES).doc(payload.claimId));
      if (!isPeriodClosed(calendar.data()) && (!slip.exists || slip.get('status') === 'draft')) {
        const amount = writeEmployeeEvent(tx, event, payload.employeeId, payload.employeeName, -REFERRAL_AMOUNT, period, payload.claimId, 'cancelled', payload);
        if (slip.exists) {
          const current = slip.data()!;
          const earnings = validateMoneyFields(current.earnings || [], 'earnings').filter(row => normalize(row.label) !== normalize(REFERRAL_LABEL));
          if (amount) earnings.push({ label: REFERRAL_LABEL, amount });
          writeSlip(tx, slip.ref, current, earnings, validateMoneyFields(current.deductions || [], 'deductions'));
        }
      } else {
        next.status = 'recovery_required';
        if (!recovery.exists) tx.create(recovery.ref, { claimId: payload.claimId, employeeId: payload.employeeId, employeeName: payload.employeeName, prospectName: payload.prospectName, amount: REFERRAL_AMOUNT, originalPeriod: period,
          targetFrom: periodOf(payload.occurredAt), status: 'pending', reason: payload.reason, createdAt: admin.firestore.FieldValue.serverTimestamp() });
        if (event.exists) tx.update(event.ref, { [`referralStates.${payload.claimId}`]: 'recovery_required' });
      }
    }
    if (payload.payable && payload.state === 'cancelled' && before?.manualSettlement) {
      const recovery = await tx.get(adminDb.collection(REFERRAL_RECOVERIES).doc(payload.claimId));
      if (!recovery.exists) tx.create(recovery.ref, { claimId: payload.claimId, employeeId: payload.employeeId, employeeName: payload.employeeName, prospectName: payload.prospectName, amount: REFERRAL_AMOUNT,
        originalPeriod: periodOf(before.qualifiedAt), targetFrom: periodOf(payload.occurredAt), status: 'pending', reason: payload.reason, createdAt: admin.firestore.FieldValue.serverTimestamp() });
      next.status = 'recovery_required';
    }
    tx.set(ref, next);
    tx.create(newFinancialAuditRef(), buildFinancialAuditRecord(SYSTEM, { action: 'LOYALIS_REFERRAL_DELIVERY', entityType: REFERRAL_BONUSES, entityId: payload.claimId, reason: payload.reason || 'Kualifikasi rekomendasi PMB', before: before || null, after: next }));
    return { claimId: payload.claimId, version: payload.version, status: next.status };
  });
}

export async function settleUnpaidReferral(claimId: string, reference: string, actor: AuthenticatedProfile) {
  const ref = adminDb.collection(REFERRAL_BONUSES).doc(claimId);
  return adminDb.runTransaction(async tx => {
    const before = (await tx.get(ref)).data();
    if (!before || before.state !== 'qualified' || before.status !== 'finance_review') throw new HttpError(409, 'Bonus tidak lagi menunggu penyelesaian manual.');
    const after = { ...before, status: 'manual_settled', manualSettlement: { reference, actor: actor.uid, at: new Date().toISOString() } };
    tx.set(ref, after); tx.create(newFinancialAuditRef(), buildFinancialAuditRecord(actor, { action: 'LOYALIS_REFERRAL_MANUAL_PAYMENT', entityType: REFERRAL_BONUSES, entityId: claimId, reason: reference, before, after }));
    return after;
  });
}

export async function referralEarningForSlip(tx: FirebaseFirestore.Transaction, period: string, employeeId: string) {
  const event = await tx.get(eventRef(period.replace('_', '-')));
  return event.get('status') === 'approved' ? Number(event.get(`eventWorkers.${employeeId}.payGiven`) || 0) : 0;
}
export function assertReferralEarning(rows: readonly MoneyField[], expected: number) {
  const matches = rows.filter(row => normalize(row.label) === normalize(REFERRAL_LABEL));
  if (expected ? matches.length !== 1 || matches[0].amount !== expected : matches.length > 0) throw new HttpError(409, 'Bonus Rekommendasi harus sesuai kegiatan otomatis dari PMB. Muat ulang sumber penghasilan.');
}

export async function applyReferralRecovery(claimId: string, actor: AuthenticatedProfile, manualReference?: string) {
  const ref = adminDb.collection(REFERRAL_RECOVERIES).doc(claimId);
  return adminDb.runTransaction(async tx => {
    const snapshot = await tx.get(ref), data = snapshot.data();
    if (!data) throw new HttpError(404, 'Tagihan pengembalian tidak ditemukan.');
    if (data.status !== 'pending') return data;
    if (manualReference) {
      const after = { ...data, status: 'manual_settled', reference: manualReference, settledBy: actor.uid, settledAt: new Date().toISOString() };
      tx.set(ref, after); tx.update(adminDb.collection(REFERRAL_BONUSES).doc(claimId), { status: 'recovered' }); tx.create(newFinancialAuditRef(), buildFinancialAuditRecord(actor, { action: 'LOYALIS_REFERRAL_MANUAL_RECOVERY', entityType: REFERRAL_RECOVERIES, entityId: claimId, reason: manualReference, before: data, after })); return after;
    }
    const start = [data.targetFrom, jakartaToday().slice(0, 7)].sort().at(-1)!;
    const target = await editableTarget(tx, data.employeeId, start, true);
    if (!target) throw new HttpError(409, 'Slip draf belum tersedia. Flag tetap menunggu Finance.');
    const annual = await tx.get(annualCalendarRef(target.period));
    const materialized = buildPeriodMaterialization({ period: target.period, periodData: target.calendar.data(), annualDates: annualDatesFrom(annual), actorUid: actor.uid, reason: 'Pengembalian bonus rekomendasi PMB' });
    const slip = target.slip.data()!, label = recoveryLabel(claimId);
    const deductions = validateMoneyFields(slip.deductions || [], 'deductions');
    if (deductions.some(row => row.label === label)) throw new HttpError(409, 'Potongan sudah tercantum; periksa rekonsiliasi sumber.');
    deductions.push({ label, amount: data.amount });
    const earnings = validateMoneyFields(slip.earnings || [], 'earnings');
    const totals = calculatePayrollTotals(earnings, deductions, recalculateSlipTaxes(slip, earnings, deductions));
    if (totals.netSalary < 0) throw new HttpError(409, 'Penghasilan belum cukup untuk potongan penuh; flag tetap menunggu Finance.');
    if (materialized) tx.set(target.calendar.ref, materialized, { merge: true });
    writeSlip(tx, target.slip.ref, slip, earnings, deductions, actor);
    const after = { ...data, status: 'applied', targetSlipId: target.slip.id, targetPeriod: target.period, appliedBy: actor.uid, appliedAt: new Date().toISOString() };
    tx.set(ref, after); tx.update(adminDb.collection(REFERRAL_BONUSES).doc(claimId), { status: 'recovery_applied' });
    tx.create(newFinancialAuditRef(), buildFinancialAuditRecord(actor, { action: 'LOYALIS_REFERRAL_RECOVERY_APPLIED', entityType: REFERRAL_RECOVERIES, entityId: claimId, reason: 'Finance menerapkan potongan pengembalian', before: data, after })); return after;
  });
}

// Called by every draft save and by finalization, inside the same transaction.
export async function referralRecoveriesForSlip(tx: FirebaseFirestore.Transaction, slipId: string) {
  return tx.get(adminDb.collection(REFERRAL_RECOVERIES).where('targetSlipId', '==', slipId));
}
export function assertReferralDeductions(rows: readonly MoneyField[], recoveries: FirebaseFirestore.QuerySnapshot) {
  for (const recovery of recoveries.docs) {
    if (!['applied', 'settled'].includes(recovery.get('status'))) continue;
    const matches = rows.filter(row => row.label === recoveryLabel(recovery.id));
    if (matches.length !== 1 || matches[0].amount !== recovery.get('amount')) throw new HttpError(409, 'Potongan pengembalian rekomendasi dikelola Finance dan tidak dapat dihapus atau diubah.');
  }
  for (const row of rows) if (row.label.startsWith('Pengembalian Bonus Rekomendasi (') && !recoveries.docs.some(doc => row.label === recoveryLabel(doc.id))) throw new HttpError(409, 'Potongan rekomendasi harus melalui flag Finance.');
}
export function settleReferralRecoveries(tx: FirebaseFirestore.Transaction, recoveries: FirebaseFirestore.QuerySnapshot) {
  for (const doc of recoveries.docs) if (doc.get('status') === 'applied') {
    tx.update(doc.ref, { status: 'settled', settledAt: admin.firestore.FieldValue.serverTimestamp() });
    tx.update(adminDb.collection(REFERRAL_BONUSES).doc(doc.id), { status: 'recovered' });
  }
}
