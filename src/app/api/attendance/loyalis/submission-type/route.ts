import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import { assertRequestId, isImmutablePayrollStatus } from '@/lib/payroll/domain';
import {
  annualPaidLeaveBalanceEntitlementForYear, annualPaidLeaveEntitlementDays,
  isDateOnly, nextAnnualPaidLeaveBalanceRevision,
} from '@/lib/payroll/annualPaidLeave';
import { coerceGantiLiburAttachments, isGantiLiburAttachmentPath } from '@/lib/payroll/gantiLiburAttachments';
import { gantiLiburEmployeeKind, gantiLiburSubmitIssue } from '@/lib/payroll/gantiLibur';
import { isLoyalisLeaveType, loyalisLeaveTypeKind, loyalisLeaveTypeLabel, type LoyalisSubmissionKind } from '@/lib/payroll/loyalisLeaveTypes';
import { timestampVersion } from '@/lib/payroll/presenceCorrections';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '@/lib/server/audit';
import {
  annualPaidLeaveBalanceDocumentId, annualPaidLeaveDocumentId, annualPaidLeaveEmployeeFromData,
} from '@/lib/server/annualPaidLeave';
import { errorResponse, HttpError, requireAuthenticatedProfile, requireRole } from '@/lib/server/auth';
import { gantiLiburDocumentId, gantiLiburRequestFromData, loadLoyalisOffDayChecker } from '@/lib/server/gantiLibur';
import { assertPeriodAcceptsInput, jakartaToday } from '@/lib/server/payrollPeriod';

export const dynamic = 'force-dynamic';

const COLLECTIONS = {
  correction: 'LoyalisPresenceCorrections', paid_leave: 'AnnualPaidLeaveRequests', ganti_libur: 'GantiLiburRequests',
} as const;
const REVISIONS = {
  correction: 'LoyalisPresenceCorrectionRevisions', paid_leave: 'AnnualPaidLeaveRequestRevisions', ganti_libur: 'GantiLiburRequestRevisions',
} as const;

function sourceDate(kind: LoyalisSubmissionKind, data: FirebaseFirestore.DocumentData): string {
  return String(kind === 'correction' ? data.date : kind === 'paid_leave' ? data.leaveDate : data.dayOffDate);
}
function sourceType(kind: LoyalisSubmissionKind, data: FirebaseFirestore.DocumentData): string {
  return kind === 'correction' ? String(data.type) : kind === 'paid_leave' ? 'cuti_tahunan' : 'ganti_libur';
}
function dayCount(value: unknown): number {
  const count = Number(value || 0);
  if (!Number.isSafeInteger(count) || count < 0) throw new HttpError(409, 'Saldo cuti tidak valid; periksa saldo sebelum mengubah jenis.');
  return count;
}

/** Transfers pending submissions atomically; approval still happens in the target workflow. */
export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['super_admin', 'loyalis_admin']);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') throw new HttpError(400, 'Payload tidak valid.');
    const kind = String(body.sourceKind) as LoyalisSubmissionKind;
    const sourceId = String(body.sourceRequestId || '');
    const commandId = String(body.requestId || '');
    const expectedRevision = Number(body.expectedRevision);
    const expectedUpdatedAt = String(body.expectedUpdatedAt || '');
    const nextType = body.type;
    if (!Object.hasOwn(COLLECTIONS, kind) || !/^[A-Za-z0-9_-]{1,180}$/.test(sourceId) ||
      !isLoyalisLeaveType(nextType) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 ||
      (kind === 'correction' && !/^(?:s\d+n\d+|ms\d+(?:\.\d+)?)$/.test(expectedUpdatedAt))) {
      throw new HttpError(400, 'Pengajuan, revisi, atau jenis pengajuan tidak valid.');
    }
    try { assertRequestId(commandId); } catch { throw new HttpError(400, 'requestId tidak valid.'); }
    const sourceRef = adminDb.collection(COLLECTIONS[kind]).doc(sourceId);
    const initialSnapshot = await sourceRef.get();
    const initial = initialSnapshot.data();
    if (!initial) throw new HttpError(404, 'Pengajuan tidak ditemukan.');
    const employeeId = String(initial.employeeId || '');
    const leaveDate = sourceDate(kind, initial);
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(employeeId) || !isDateOnly(leaveDate) ||
      (kind !== 'correction' && gantiLiburEmployeeKind(initial) !== 'loyalis')) {
      throw new HttpError(409, 'Ubah jenis pada halaman ini hanya tersedia untuk pengajuan Loyalis yang valid.');
    }
    const workedDate = nextType === 'ganti_libur' ? String(body.workedDate || '') : '';
    if (nextType === 'ganti_libur' && !isDateOnly(workedDate)) {
      throw new HttpError(400, 'Tanggal Masuk Hari Libur wajib diisi.');
    }
    const targetKind = loyalisLeaveTypeKind(nextType);
    const targetId = targetKind === 'paid_leave' ? annualPaidLeaveDocumentId(employeeId, leaveDate)
      : targetKind === 'ganti_libur' ? gantiLiburDocumentId(employeeId, workedDate)
        : createHash('sha256').update(`leave-type|${kind}|${sourceId}|${expectedRevision}`).digest('hex');
    const targetRef = adminDb.collection(COLLECTIONS[targetKind]).doc(targetId);
    const period = leaveDate.slice(0, 7);
    const year = Number(leaveDate.slice(0, 4));
    const isOffDay = targetKind === 'ganti_libur' ? await loadLoyalisOffDayChecker([workedDate, leaveDate]) : () => false;
    const idempotencyRef = adminDb.doc(`FinancialIdempotencyKeys/${actor.uid}__${commandId}`);
    const command = { kind, sourceId, nextType, workedDate, expectedRevision,
      ...(kind === 'correction' ? { expectedUpdatedAt } : {}) };
    const requestHash = createHash('sha256').update(JSON.stringify(command)).digest('hex');
    const balanceRef = adminDb.doc(`AnnualPaidLeaveBalances/${annualPaidLeaveBalanceDocumentId(employeeId, year)}`);

    const result = await adminDb.runTransaction(async (transaction) => {
      const [sourceSnapshot, targetSnapshot, employeeSnapshot, periodSnapshot, slipSnapshot,
        balanceSnapshot, idempotencySnapshot, annualRequests, gantiRequests, correctionRequests] = await Promise.all([
        transaction.get(sourceRef), transaction.get(targetRef), transaction.get(adminDb.doc(`Employees_Loyalis/${employeeId}`)),
        transaction.get(adminDb.doc(`PayrollPeriods/${period}`)), transaction.get(adminDb.doc(`PayrollSlipStates/${period.replace('-', '_')}_${employeeId}`)),
        transaction.get(balanceRef), transaction.get(idempotencyRef),
        transaction.get(adminDb.collection('AnnualPaidLeaveRequests').where('employeeId', '==', employeeId)),
        transaction.get(adminDb.collection('GantiLiburRequests').where('employeeId', '==', employeeId)),
        transaction.get(adminDb.collection('LoyalisPresenceCorrections').where('employeeId', '==', employeeId)),
      ]);
      if (idempotencySnapshot.exists) {
        if (idempotencySnapshot.data()?.requestHash !== requestHash) throw new HttpError(409, 'requestId sudah digunakan untuk perubahan lain.');
        return { ...idempotencySnapshot.data()?.result, idempotent: true };
      }
      const current = sourceSnapshot.data();
      if (!current || current.employeeId !== employeeId || sourceDate(kind, current) !== leaveDate ||
        current.status !== 'pending' || current.typeChangedTo || Number(current.revision || 0) !== expectedRevision ||
        (kind === 'correction' && timestampVersion(current.updatedAt) !== expectedUpdatedAt) ||
        (kind !== 'correction' && gantiLiburEmployeeKind(current) !== 'loyalis')) {
        throw new HttpError(409, 'Pengajuan berubah atau sudah diputuskan. Muat ulang sebelum mengubah jenis.');
      }
      if (kind === targetKind && sourceType(kind, current) === nextType) {
        throw new HttpError(400, 'Pilih jenis pengajuan yang berbeda.');
      }
      if ((kind === 'paid_leave' && (Number(current.year) !== year || current.period !== period)) ||
        (kind === 'ganti_libur' && current.dayOffPeriod !== period)) {
        throw new HttpError(409, 'Periode pengajuan tidak sesuai tanggal; periksa data sebelum mengubah jenis.');
      }
      const employeeData = employeeSnapshot.data() || {};
      if (employeeData.personal_info?.status !== 'AKTIF') throw new HttpError(409, 'Data pegawai aktif tidak ditemukan.');
      assertPeriodAcceptsInput(periodSnapshot.data(), 'Periode payroll sudah ditutup; jenis pengajuan tidak dapat diubah.');
      if (isImmutablePayrollStatus(slipSnapshot.data()?.status)) throw new HttpError(409, 'Slip sudah final; jenis pengajuan tidak dapat diubah.');
      const targetData = targetSnapshot.data();
      if (targetData && ['pending', 'approved'].includes(targetData.status)) throw new HttpError(409, 'Pengajuan jenis tersebut sudah aktif pada tanggal ini.');
      for (const [otherKind, snapshot] of [['paid_leave', annualRequests], ['ganti_libur', gantiRequests], ['correction', correctionRequests]] as const) {
        if (snapshot.docs.some((document) => document.ref.path !== sourceRef.path && document.ref.path !== targetRef.path &&
          sourceDate(otherKind, document.data()) === leaveDate && ['pending', 'approved'].includes(document.data().status))) {
          throw new HttpError(409, 'Tanggal ini memiliki pengajuan atau koreksi aktif lain.');
        }
      }
      if (targetKind === 'ganti_libur') {
        const issue = gantiLiburSubmitIssue({ requestId: targetId, workedDate, dayOffDate: leaveDate, isOffDay,
          requests: gantiRequests.docs.filter((document) => document.ref.path !== sourceRef.path).map((document) => gantiLiburRequestFromData(document.id, document.data())) });
        if (issue) throw new HttpError(409, ({ same_date: 'Tanggal libur harus berbeda dari Masuk Hari Libur.',
          worked_date_not_off_day: 'Masuk Hari Libur harus jatuh pada Jumat atau tanggal merah.',
          day_off_not_working_day: 'Tanggal libur harus jatuh pada hari kerja.',
          worked_date_used: 'Masuk Hari Libur sudah dipakai oleh pengajuan lain.', day_off_taken: 'Tanggal libur sudah diajukan.',
          weekly_limit: 'Batas dua Ganti Libur per minggu sudah tercapai.', invalid_date: 'Tanggal tidak valid.' })[issue]);
      }
      const balanceData = balanceSnapshot.data() || {};
      const changesAnnualBalance = kind === 'paid_leave' || targetKind === 'paid_leave';
      const reserved = changesAnnualBalance ? dayCount(balanceData.reservedDays) : 0;
      const used = changesAnnualBalance ? dayCount(balanceData.usedDays) : 0;
      const manualUsed = changesAnnualBalance ? dayCount(balanceData.manualUsedDays) : 0;
      let nextReserved = reserved;
      let annualEmployee = null;
      let entitlementDays = Number(balanceData.entitlementDays || 0);
      if (kind === 'paid_leave') {
        if (reserved < 1) throw new HttpError(409, 'Reservasi saldo cuti tidak ditemukan; periksa saldo sebelum mengubah jenis.');
        nextReserved -= 1;
      }
      if (targetKind === 'paid_leave') {
        annualEmployee = annualPaidLeaveEmployeeFromData(employeeId, 'loyalis', employeeData);
        if (!annualEmployee || annualPaidLeaveEntitlementDays(annualEmployee.serviceDate, leaveDate) < 1) {
          throw new HttpError(409, 'Masa kerja belum memenuhi hak Cuti Tahunan atau tanggal masa kerja belum diisi.');
        }
        const dateEntitlement = annualPaidLeaveEntitlementDays(annualEmployee.serviceDate, leaveDate);
        if (nextReserved + used + manualUsed >= dateEntitlement) throw new HttpError(409, 'Saldo Cuti Tahunan sudah terpakai atau sedang menunggu keputusan.');
        entitlementDays = annualPaidLeaveBalanceEntitlementForYear(annualEmployee.serviceDate, year, jakartaToday());
        nextReserved += 1;
      }
      const now = admin.firestore.FieldValue.serverTimestamp();
      const previousType = sourceType(kind, current);
      const from = { kind, id: sourceId, type: previousType };
      const to = { kind: targetKind, id: targetId, type: nextType };
      const sourceAfter = { ...current, status: kind === 'correction' ? 'rejected' : 'withdrawn', revision: expectedRevision + 1,
        typeChangedTo: to, typeChangedBy: actor.uid, typeChangedByName: actor.displayName,
        decisionReason: `Jenis diubah menjadi ${loyalisLeaveTypeLabel(nextType)} oleh admin.`,
        ...(kind === 'correction' ? { rejectionReason: `Jenis diubah menjadi ${loyalisLeaveTypeLabel(nextType)} oleh admin.` } : {}),
        updatedAt: now };
      const targetRevision = Number(targetData?.revision || 0) + 1;
      const attachments = coerceGantiLiburAttachments(current.attachments);
      if (attachments.some((attachment) => !['ganti_libur', 'paid_leave', 'presence_corrections'].some(
        (folder) => isGantiLiburAttachmentPath(employeeId, attachment.path, folder),
      ))) throw new HttpError(409, 'Dokumen pendukung tidak sesuai pegawai pengajuan.');
      const common = { id: targetId, employeeId, employeeName: String(current.employeeName || employeeData.personal_info?.name || ''),
        employeeKind: 'loyalis', employeeCollection: 'Employees_Loyalis', category: 'LOYALIS',
        reason: String(current.reason || ''), attachments, proofUrl: String(current.proofUrl || attachments[0]?.url || ''),
        status: 'pending', revision: targetRevision, typeChangedFrom: from,
        submittedBy: current.submittedBy || null, submittedByName: current.submittedByName || null,
        submittedAt: current.submittedAt || current.createdAt || now, createdAt: current.createdAt || now,
        updatedAt: now, typeChangedBy: actor.uid, typeChangedByName: actor.displayName,
        decisionReason: null, decidedAt: null, decidedBy: null, approvedAmount: 0, approvedPayType: null,
      };
      const targetAfter = targetKind === 'correction' ? { ...common, date: leaveDate, period,
        type: 'izin_resmi', checkInTime: '07:30', checkOutTime: '14:00', rejectionReason: null }
        : targetKind === 'paid_leave' ? { ...common, leaveDate, period, year,
          serviceDate: annualEmployee!.serviceDate, qualifyingDate: annualEmployee!.qualifyingDate, schemaVersion: 1 }
          : { ...common, dayOffDate: leaveDate, dayOffPeriod: period, workedDate, workedPeriod: workedDate.slice(0, 7),
            attendanceCheck: null, attendanceOverride: null, schemaVersion: 2 };
      transaction.set(sourceRef, sourceAfter);
      transaction.set(targetRef, targetAfter);
      if (changesAnnualBalance) {
        transaction.set(balanceRef, { employeeId, employeeKind: 'loyalis', employeeCollection: 'Employees_Loyalis', year,
          entitlementDays, reservedDays: nextReserved, usedDays: used, balanceRevision: nextAnnualPaidLeaveBalanceRevision(balanceData.balanceRevision),
          ...(annualEmployee ? { serviceDate: annualEmployee.serviceDate, qualifyingDate: annualEmployee.qualifyingDate } : {}),
          updatedAt: now, schemaVersion: 1 }, { merge: true });
      }
      for (const [revisionKind, ref, revision, before, after] of [
        [kind, sourceRef, expectedRevision + 1, current, sourceAfter],
        [targetKind, targetRef, targetRevision, targetData || null, targetAfter],
      ] as const) {
        transaction.create(adminDb.collection(REVISIONS[revisionKind]).doc(`${ref.id}__r${revision}`), {
          action: 'change_type', revision, before, after, actorUid: actor.uid, requestId: commandId,
          ...(revisionKind === 'paid_leave' ? { annualPaidLeaveRequestId: ref.id }
            : revisionKind === 'ganti_libur' ? { gantiLiburRequestId: ref.id } : { presenceCorrectionRequestId: ref.id }), createdAt: now,
        });
      }
      transaction.create(newFinancialAuditRef(), buildFinancialAuditRecord(actor, {
        action: 'LOYALIS_LEAVE_TYPE_CHANGED', entityType: COLLECTIONS[kind], entityId: sourceId,
        requestId: commandId, reason: sourceAfter.decisionReason, before: current, after: sourceAfter,
        metadata: { employeeId, leaveDate, period, from, to, reservedDaysBefore: reserved, reservedDaysAfter: nextReserved },
      }));
      const result = { success: true, source: from, target: to, revision: targetRevision,
        message: `Jenis pengajuan diubah menjadi ${loyalisLeaveTypeLabel(nextType)}. Pengajuan menunggu persetujuan.`, idempotent: false };
      transaction.create(idempotencyRef, { actorUid: actor.uid, requestId: commandId, requestHash, result, createdAt: now });
      return result;
    });
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}
