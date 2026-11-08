import { NextRequest, NextResponse } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '@/lib/server/audit';
import { errorResponse, HttpError, requireAuthenticatedProfile } from '@/lib/server/auth';
import { createFinancialRequestId } from '@/lib/payroll/client';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    if (!['super_admin', 'finance_verifier', 'satker_head_loyalis'].includes(actor.role)) {
      throw new HttpError(403, 'Akun ini tidak memiliki akses proposal kegiatan.');
    }

    const raw = await request.json();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new HttpError(400, 'Perintah pemindahan proposal tidak valid.');
    }

    const { proposalId, targetPeriod } = raw;
    if (
      typeof proposalId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,150}$/.test(proposalId) ||
      typeof targetPeriod !== 'string' ||
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(targetPeriod)
    ) {
      throw new HttpError(400, 'Parameter pemindahan proposal tidak valid.');
    }

    const isFinance = actor.role === 'super_admin' || actor.role === 'finance_verifier';
    const sourceRef = adminDb.collection('ProposalKegiatan').doc(proposalId);
    const targetPeriodRef = adminDb.collection('PayrollPeriods').doc(targetPeriod);

    const result = await adminDb.runTransaction(async (tx) => {
      const [sourceSnap, targetPeriodSnap] = await Promise.all([
        tx.get(sourceRef),
        tx.get(targetPeriodRef),
      ]);

      if (!sourceSnap.exists) {
        throw new HttpError(404, 'Proposal asal tidak ditemukan.');
      }

      if (targetPeriodSnap.data()?.attendanceStatus === 'closed') {
        throw new HttpError(409, 'Periode tujuan sudah ditutup.');
      }

      const before = sourceSnap.data()!;
      if (!isFinance && before.submittedBy !== actor.uid) {
        throw new HttpError(403, 'Proposal ini bukan milik akun Anda.');
      }

      if (before.status !== 'proposal_draft') {
        throw new HttpError(
          409,
          'Hanya proposal berstatus draft yang dapat dipindahkan ke periode lain.',
        );
      }

      if (before.period === targetPeriod) {
        throw new HttpError(409, 'Proposal sudah berada di periode tujuan.');
      }

      const newProposalId = `${targetPeriod}_${createFinancialRequestId('prop')}`;
      const newRef = adminDb.collection('ProposalKegiatan').doc(newProposalId);

      const newProposalData = {
        ...before,
        id: newProposalId,
        period: targetPeriod,
        status: 'proposal_draft',
        revision: 1,
        lastWriteActorUid: actor.uid,
        lastWriteId: createFinancialRequestId('prop_move'),
        movedFromProposalId: proposalId,
        movedFromPeriod: before.period,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      tx.set(newRef, newProposalData);
      tx.delete(sourceRef);

      const auditRef = newFinancialAuditRef();
      tx.create(
        auditRef,
        buildFinancialAuditRecord(actor, {
          action: 'PROPOSAL_KEGIATAN_MOVE_PERIOD',
          entityType: 'ProposalKegiatan',
          entityId: newProposalId,
          requestId: createFinancialRequestId('audit'),
          reason: `Memindahkan draft proposal "${before.reportName || ''}" dari periode ${before.period} ke periode ${targetPeriod}`,
          before: {
            proposalId,
            period: before.period,
            status: before.status,
            reportName: before.reportName,
          },
          after: {
            proposalId: newProposalId,
            period: targetPeriod,
            status: 'proposal_draft',
            reportName: before.reportName,
          },
          metadata: {
            sourceProposalId: proposalId,
            sourcePeriod: before.period,
            targetPeriod,
          },
        }),
      );

      return {
        success: true,
        newProposalId,
        targetPeriod,
        reportName: before.reportName || '',
      };
    });

    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
