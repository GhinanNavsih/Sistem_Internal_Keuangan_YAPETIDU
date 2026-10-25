import { NextRequest } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '@/lib/server/audit';
import { errorResponse, HttpError, requireAuthenticatedProfile } from '@/lib/server/auth';
import {
  canEditProposalStage,
  LPJ_FIELDS,
  proposalContent,
  type ProposalAction,
  type ProposalStage,
} from '@/lib/payroll/proposalLifecycle';
import { parseProposalQty, sanitizeForFirestore } from '@/lib/payroll/proposalExpenseReports';

export const dynamic = 'force-dynamic';

const ACTIONS: ProposalAction[] = [
  'save_draft',
  'save_lpj',
  'submit_proposal',
  'submit_lpj',
  'review',
];
const REVIEW_STATUSES = ['proposal_approved', 'proposal_revision', 'lpj_revision'];

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    if (!['super_admin', 'finance_verifier', 'satker_head_loyalis'].includes(actor.role)) {
      throw new HttpError(403, 'Akun ini tidak memiliki akses proposal kegiatan.');
    }
    const raw = await request.json();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new HttpError(400, 'Perintah proposal tidak valid.');
    if (raw.actorUid !== actor.uid) {
      throw new HttpError(
        403,
        'Akun aktif berubah. Draft tetap disimpan untuk akun asal; masuk kembali dengan akun tersebut untuk melanjutkan.',
      );
    }
    const { proposalId, period, action, expectedRevision, requestId } = raw;
    if (
      typeof proposalId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,150}$/.test(proposalId) ||
      typeof period !== 'string' ||
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(period) ||
      !ACTIONS.includes(action) ||
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 0 ||
      typeof requestId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,100}$/.test(requestId)
    ) {
      throw new HttpError(400, 'Perintah penyimpanan proposal tidak valid.');
    }
    const stage: ProposalStage = raw.stage === 'lpj' ? 'lpj' : 'proposal';
    const data =
      raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data) ? raw.data : {};
    const isFinance = actor.role === 'super_admin' || actor.role === 'finance_verifier';
    const decision = typeof raw.decision === 'string' ? raw.decision : '';
    if (action === 'review' && (!isFinance || !REVIEW_STATUSES.includes(decision))) {
      throw new HttpError(403, 'Keputusan review tidak diizinkan.');
    }
    const ref = adminDb.collection('ProposalKegiatan').doc(proposalId);
    const result = await adminDb.runTransaction(async (tx) => {
      const [snapshot, payrollPeriod] = await Promise.all([
        tx.get(ref),
        tx.get(adminDb.collection('PayrollPeriods').doc(period)),
      ]);
      if (payrollPeriod.data()?.attendanceStatus === 'closed')
        throw new HttpError(409, 'Periode payroll sudah ditutup.');
      const before = snapshot.data();
      if (before && before.period !== period)
        throw new HttpError(409, 'Periode proposal tidak boleh berubah.');
      if (before && !isFinance && before.submittedBy !== actor.uid) {
        throw new HttpError(403, 'Proposal ini bukan milik akun Anda.');
      }
      if (before?.lastWriteId === requestId) {
        return {
          proposalId,
          revision: Number(before.revision || 0),
          status: String(before.status),
          ...(typeof before.proposalQueueNumber === 'number'
            ? { proposalQueueNumber: before.proposalQueueNumber }
            : {}),
        };
      }
      const revision = Number(before?.revision || 0);
      const ownPredecessor =
        action === 'save_draft' &&
        before?.lastWriteActorUid === actor.uid &&
        Array.isArray(raw.predecessorRequestIds) &&
        raw.predecessorRequestIds.length <= 100 &&
        raw.predecessorRequestIds.includes(before.lastWriteId);
      if (revision !== expectedRevision && !ownPredecessor) {
        throw new HttpError(
          409,
          'Proposal sudah diperbarui di sesi lain. Draft lokal tetap disimpan; buka versi terbaru sebelum melanjutkan.',
        );
      }
      let status = String(before?.status || 'proposal_draft');
      if (!before && !['save_draft', 'submit_proposal'].includes(action))
        throw new HttpError(404, 'Proposal tidak ditemukan.');
      const contentStage = action === 'save_lpj' || action === 'submit_lpj' ? 'lpj' : stage;
      if (action !== 'review' && !canEditProposalStage(actor.role, status, contentStage)) {
        throw new HttpError(
          409,
          'Tahap ini sudah diajukan atau disetujui sehingga tidak dapat ditimpa oleh draft.',
        );
      }
      const patch: Record<string, unknown> =
        action === 'review' ? {} : proposalContent(data, contentStage);
      // A recovered copy may also contain unfinished LPJ data. Preserve it on
      // creation while keeping the new record in the proposal draft stage.
      if (!before) for (const key of LPJ_FIELDS) if (key in data) patch[key] = data[key];
      if (!before || action === 'submit_proposal') {
        if (typeof data.reportName !== 'string' || !data.reportName.trim())
          throw new HttpError(400, 'Nama kegiatan wajib diisi.');
      }
      let queueNumber = before?.proposalQueueNumber;
      if (action === 'submit_proposal') {
        if (!['proposal_draft', 'proposal_revision'].includes(status))
          throw new HttpError(409, 'Proposal sudah diajukan.');
        if (!data.departmentUnit || typeof data.departmentUnit !== 'string')
          throw new HttpError(400, 'Pilih SatKer pelaksana sebelum mengajukan proposal.');
        const counterRef = adminDb.collection('ProposalKegiatanQueueCounters').doc(period);
        const [counter, existing] = await Promise.all([
          tx.get(counterRef),
          tx.get(adminDb.collection('ProposalKegiatan').where('period', '==', period)),
        ]);
        queueNumber =
          Math.max(
            Number(counter.data()?.lastNumber || 0),
            ...existing.docs.map((doc) => Number(doc.data().proposalQueueNumber || 0)),
          ) + 1;
        tx.set(counterRef, { lastNumber: queueNumber });
        Object.assign(patch, {
          proposalQueueNumber: queueNumber,
          proposalSubmittedAt: admin.firestore.FieldValue.serverTimestamp(),
          reviewNote: null,
        });
        status = 'proposal_submitted';
      } else if (action === 'submit_lpj') {
        status = 'lpj_submitted';
        Object.assign(patch, {
          lpjSubmittedAt: admin.firestore.FieldValue.serverTimestamp(),
          reviewNote: null,
        });
      } else if (action === 'save_lpj' && status === 'proposal_approved') {
        status = 'lpj_draft';
      } else if (action === 'review') {
        if (decision === 'proposal_approved' && !status.startsWith('proposal_'))
          throw new HttpError(409, 'Proposal sudah masuk tahap LPJ.');
        if (decision === 'lpj_revision' && !['lpj_submitted', 'lpj_approved'].includes(status))
          throw new HttpError(409, 'LPJ belum masuk antrean review.');
        if (decision === 'proposal_approved') {
          for (const [source, target] of [
            ['pemasukanRows', 'lpjPemasukanRows'],
            ['pengeluaranRows', 'lpjPengeluaranRows'],
          ] as const) {
            const existingRows = before?.[target];
            if (
              Array.isArray(existingRows) &&
              existingRows.some((row) => String(row.uraian || '').trim())
            )
              continue;
            patch[target] = (Array.isArray(before?.[source]) ? before[source] : []).map(
              (row: Record<string, unknown>) => ({
                ...row,
                realisasi:
                  row.type === 'group_header'
                    ? 0
                    : parseProposalQty(String(row.rincianQty || '')) * Number(row.rincianRate || 0),
              }),
            );
          }
        }
        status = decision;
        Object.assign(patch, {
          reviewedBy: actor.uid,
          reviewedByName: actor.displayName,
          reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
          reviewNote: typeof raw.note === 'string' ? raw.note.trim().slice(0, 2000) || null : null,
        });
      }
      if (!before)
        Object.assign(patch, {
          period,
          submittedBy: actor.uid,
          submittedByName: actor.displayName,
          submittedByEmail: actor.email,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      Object.assign(patch, {
        status,
        revision: revision + 1,
        lastWriteId: requestId,
        lastWriteActorUid: actor.uid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      tx.set(ref, sanitizeForFirestore(patch), { merge: true });
      tx.create(
        newFinancialAuditRef(),
        buildFinancialAuditRecord(actor, {
          action: `PROPOSAL_KEGIATAN_${action.toUpperCase()}`,
          entityType: 'ProposalKegiatan',
          entityId: proposalId,
          reason: typeof raw.note === 'string' ? raw.note.slice(0, 2000) : action,
          before: before
            ? {
                submittedBy: before.submittedBy || null,
                status: before.status || 'proposal_draft',
                revision,
              }
            : null,
          after: { submittedBy: before?.submittedBy || actor.uid, status, revision: revision + 1 },
        }),
      );
      return {
        proposalId,
        revision: revision + 1,
        status,
        ...(typeof queueNumber === 'number' ? { proposalQueueNumber: queueNumber } : {}),
      };
    });
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
