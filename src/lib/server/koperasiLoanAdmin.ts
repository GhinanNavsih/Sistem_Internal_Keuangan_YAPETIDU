import admin from '@/lib/firebase-admin';
import { koperasiAdminDb, KOPERASI_LOANS_COLLECTION } from '@/lib/koperasi-admin';
import { resolveKoperasiLoanStatus } from '@/lib/payroll/koperasiLoan';
import {
  canAdminDeclineKoperasiLoan,
  isKoperasiAdminDeclinableStatus,
  validateKoperasiDeclineReason,
  KOPERASI_ADMIN_DECLINE_STATUS,
} from '@/lib/payroll/koperasiLoanApplication';
import { HttpError, type AuthenticatedProfile } from './auth';
import {
  documentId, finishOperation, operation, prepareOperation, previousResult,
  requestId, requireKoperasiAdmin,
} from './koperasiMembers';

type Data = Record<string, unknown>;

const PENDING_RESTRUCTURING_STATUS = 'Menunggu Persetujuan Restrukturisasi';

function historyEntry(status: string, actor: AuthenticatedProfile, notes: string) {
  return {
    status,
    timestamp: admin.firestore.Timestamp.now(),
    updatedBy: `internal-bak:${actor.uid}`,
    notes,
  };
}

/**
 * Super Admin declines an application that has not been paid out yet. The
 * write mirrors the Koperasi app's own rejection (status, reason, history, and
 * handing a restructured parent back its active status), so both apps read the
 * result the same way and the member can apply again.
 */
export async function declineKoperasiLoan(actor: AuthenticatedProfile, body: Data) {
  requireKoperasiAdmin();
  const loanId = documentId(body.loanId, 'ID pinjaman');
  const id = requestId(body);
  const expectedStatus = typeof body.expectedStatus === 'string' ? body.expectedStatus : '';
  if (!isKoperasiAdminDeclinableStatus(expectedStatus)) {
    throw new HttpError(400, 'Status pinjaman ini tidak dapat ditolak.');
  }
  const reasonError = validateKoperasiDeclineReason(body.reason);
  if (reasonError) throw new HttpError(400, reasonError);
  const reason = String(body.reason).trim();

  const op = operation(actor, id, { action: 'decline-loan', loanId, expectedStatus, reason });
  const receipt = await op.ref.get();
  const replay = previousResult(receipt, op);
  if (replay) return replay;
  // A pending receipt means this same request already crossed to Koperasi once.
  const resuming = receipt.exists;
  const prepared = await prepareOperation(op, { loanId, expectedStatus, reason });
  if (prepared.completed) return prepared.completed;

  const db = koperasiAdminDb();
  const loans = db.collection(KOPERASI_LOANS_COLLECTION);
  const outcome = await db.runTransaction(async transaction => {
    const loanRef = loans.doc(loanId);
    const snapshot = await transaction.get(loanRef);
    if (!snapshot.exists) throw new HttpError(404, 'Pinjaman tidak ditemukan.');
    const current = snapshot.data() || {};

    // A retry after a lost response (or a SAKU audit outage) does not reapply the
    // write. A fresh request on an already-declined loan falls through to 409.
    if (resuming && current.status === KOPERASI_ADMIN_DECLINE_STATUS && current.alasanPenolakan === reason) {
      return { alreadyApplied: true, parentReverted: false };
    }
    const status = resolveKoperasiLoanStatus({ id: loanId, ...current });
    if (status !== expectedStatus || !canAdminDeclineKoperasiLoan({ id: loanId, ...current })) {
      throw new HttpError(409, 'Status pinjaman sudah berubah, muat ulang data.');
    }

    const parentId = typeof current.restructuredFromLoanId === 'string' ? current.restructuredFromLoanId : '';
    const parentRef = parentId ? loans.doc(parentId) : null;
    const parentSnapshot = parentRef ? await transaction.get(parentRef) : null;

    transaction.update(loanRef, {
      status: KOPERASI_ADMIN_DECLINE_STATUS,
      alasanPenolakan: reason,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      history: admin.firestore.FieldValue.arrayUnion(
        historyEntry(KOPERASI_ADMIN_DECLINE_STATUS, actor, `Ditolak dengan alasan: ${reason}`),
      ),
    });

    // Hand the old loan back its active status, otherwise the member is left
    // with no payable loan. Skip a parent already waiting on a different request.
    const parent = parentSnapshot?.exists ? parentSnapshot.data() || {} : null;
    const parentReverted = Boolean(
      parentRef && parent && parent.status === PENDING_RESTRUCTURING_STATUS &&
      (!parent.restructuredToLoanId || parent.restructuredToLoanId === loanId),
    );
    if (parentRef && parentReverted) {
      transaction.update(parentRef, {
        status: 'Disetujui dan Aktif',
        restructuredToLoanId: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        history: admin.firestore.FieldValue.arrayUnion(
          historyEntry(
            'Disetujui dan Aktif',
            actor,
            `Pengajuan restrukturisasi #${loanId.substring(0, 8)} ditolak. Pinjaman dikembalikan ke status aktif.`,
          ),
        ),
      });
    }
    return { alreadyApplied: false, parentReverted };
  });

  return finishOperation(actor, op, {
    action: 'KOPERASI_LOAN_DECLINED', entityType: 'KoperasiLoan', entityId: loanId,
    requestId: id, reason,
    before: { status: expectedStatus }, after: { status: KOPERASI_ADMIN_DECLINE_STATUS },
    metadata: { parentReverted: outcome.parentReverted, recoveredFromExpected: outcome.alreadyApplied },
  }, { loanId, status: KOPERASI_ADMIN_DECLINE_STATUS, parentReverted: outcome.parentReverted });
}
