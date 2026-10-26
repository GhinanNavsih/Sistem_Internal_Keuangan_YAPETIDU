import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import { FINANCE_ROLES } from '@/lib/payroll/roles';
import { errorResponse, HttpError, requireAuthenticatedProfile, requireRole } from '@/lib/server/auth';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '@/lib/server/audit';
import { finishProposalPayrollSync, prepareProposalPayroll, proposalOperationRef } from '@/lib/server/proposalPayroll';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, FINANCE_ROLES);
    const raw = await request.json();
    if (!raw || typeof raw !== 'object') throw new HttpError(400, 'Perintah persetujuan LPJ tidak valid.');
    const { proposalId, expectedRevision, requestId } = raw;
    const note = typeof raw.note === 'string' ? raw.note.trim().slice(0, 2000) : '';
    if (typeof proposalId !== 'string' || !/^[A-Za-z0-9_-]{1,150}$/.test(proposalId) ||
      !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 ||
      typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(requestId))
      throw new HttpError(400, 'ID, revisi, dan requestId persetujuan LPJ wajib valid.');
    const requestHash = createHash('sha256').update(JSON.stringify({ proposalId, expectedRevision, note, action: 'approve_lpj' })).digest('hex');
    const operationRef = proposalOperationRef(actor.uid, requestId);
    const proposalRef = adminDb.collection('ProposalKegiatan').doc(proposalId);
    await adminDb.runTransaction(async transaction => {
      const [snapshot, prior] = await transaction.getAll(proposalRef, operationRef);
      if (prior.exists) {
        if (prior.data()!.requestHash !== requestHash) throw new HttpError(409, 'requestId sudah digunakan untuk perintah lain.');
        return;
      }
      if (!snapshot.exists) throw new HttpError(404, 'Proposal kegiatan tidak ditemukan.');
      const before = snapshot.data()!;
      const period = before.period;
      if (typeof period !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new HttpError(400, 'Periode proposal tidak valid.');
      const payrollPeriod = await transaction.get(adminDb.collection('PayrollPeriods').doc(period));
      if (payrollPeriod.data()?.attendanceStatus === 'closed') throw new HttpError(409, 'Periode payroll sudah ditutup.');
      const revision = Number(before.revision || 0);
      if (revision !== expectedRevision) throw new HttpError(409, 'LPJ berubah di sesi lain. Muat ulang sebelum menyetujui.');
      if (before.status !== 'lpj_submitted') throw new HttpError(409, 'LPJ harus berada pada antrean pemeriksaan sebelum disetujui.');
      const payroll = await prepareProposalPayroll(transaction, { proposalId, proposal: before, approved: true, revision: revision + 1, actor, requestId });
      const now = admin.firestore.FieldValue.serverTimestamp();
      const result = { proposalId, status: 'lpj_approved', revision: revision + 1, payrollReportIds: payroll.payrollReportIds,
        syncedReports: payroll.syncedReports, staleReports: payroll.staleReports, totalPayout: payroll.totalPayout };
      payroll.write();
      transaction.update(proposalRef, {
        status: 'lpj_approved', revision: revision + 1, reviewedBy: actor.uid, reviewedByName: actor.displayName,
        reviewedAt: now, reviewNote: note || null, updatedAt: now,
        payrollReportIds: payroll.payrollReportIds, payrollReportIdsByReport: payroll.payrollReportIdsByReport, payrollSyncedAt: now, payrollSyncedBy: actor.uid,
        payrollSyncStatus: 'pending', payrollSyncOperationId: operationRef.id,
      });
      transaction.create(operationRef, { requestHash, actorUid: actor.uid, entityType: 'ProposalKegiatan', entityId: proposalId,
        period, employeeIds: payroll.employeeIds, result, payrollSyncStatus: 'pending', createdAt: now });
      transaction.create(newFinancialAuditRef(), buildFinancialAuditRecord(actor, {
        action: 'PROPOSAL_KEGIATAN_APPROVE_LPJ', entityType: 'ProposalKegiatan', entityId: proposalId, requestId,
        reason: note || 'LPJ disetujui dan pembayaran pegawai diterbitkan',
        before: { status: before.status, revision }, after: result,
      }));
    });
    return Response.json(await finishProposalPayrollSync(actor, operationRef.id), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}
