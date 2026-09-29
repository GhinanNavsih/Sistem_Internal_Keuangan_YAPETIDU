/**
 * Takes back an APPROVED annual leave (Ambil Cuti) of a regular Pekarya (not
 * Satpam, not Loyalis) after the Kepala SatKer approved the wrong date, and
 * returns the day to the employee's balance.
 *
 * Approval (`/api/payroll/paid-leave/review`) leaves four things behind, and
 * this script undoes exactly those, in one transaction:
 *   1. the request (`AnnualPaidLeaveRequests`, status approved) becomes
 *      `withdrawn` (shown to the employee as "Ditarik") with a new revision, a
 *      revision record and a FinancialAuditLogs entry;
 *   2. the balance (`AnnualPaidLeaveBalances`) loses one usedDays and gets a new
 *      balanceRevision, so the day is available (or, if the employee has
 *      another pending request, still held by that one) again;
 *   3. the payroll post (`AnnualPaidLeavePayrollPosts`) is deleted, otherwise it
 *      would block a later approval of the same date;
 *   4. the attendance correction head (`PekaryaAttendanceCorrectionHeads`, the
 *      CUTI day the approval wrote) is deleted, so the date no longer counts as
 *      a paid day. The correction record it points to stays as history and is
 *      marked revoked.
 *
 * It refuses, and changes nothing, when the approval may have reached further
 * than those four things: the period is closed, the employee already has a
 * slip for the period, the category's Uraian publication is published (the
 * approval would then have edited the Uraian rekap), the head was replaced by
 * a later correction, or the request is not in the state the approval leaves.
 * Everything is re-read inside the transaction, so a stale dry run cannot
 * write anything the state no longer justifies.
 *
 * Dry run is the default:
 *   npx tsx scripts/revokeAnnualPaidLeave.ts --employee BC_008 --date 2026-09-29
 *
 * Apply after reviewing the plan (a reason is required, and is shown to the
 * employee under the request):
 *   npx tsx scripts/revokeAnnualPaidLeave.ts --employee BC_008 --date 2026-09-29 \
 *     --reason "Salah memilih tanggal; seharusnya 26 September 2026." --apply
 */
import './initEnv';
import admin, { adminDb } from '../src/lib/firebase-admin';
import {
  annualPaidLeaveYear,
  isDateOnly,
  nextAnnualPaidLeaveBalanceRevision,
} from '../src/lib/payroll/annualPaidLeave';
import { isImmutablePayrollStatus } from '../src/lib/payroll/domain';
import {
  PEKARYA_CORRECTIONS_COLLECTION,
  PEKARYA_CORRECTION_HEADS_COLLECTION,
  PEKARYA_PUBLICATIONS_COLLECTION,
  attendanceCorrectionHeadId,
  pekaryaPublicationId,
} from '../src/lib/server/attendanceStore';
import {
  ANNUAL_PAID_LEAVE_BALANCES_COLLECTION,
  ANNUAL_PAID_LEAVE_PAYROLL_POSTS_COLLECTION,
  ANNUAL_PAID_LEAVE_REQUESTS_COLLECTION,
  ANNUAL_PAID_LEAVE_REVISIONS_COLLECTION,
  annualPaidLeaveBalanceDocumentId,
  annualPaidLeaveDocumentId,
} from '../src/lib/server/annualPaidLeave';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '../src/lib/server/audit';
import type { AuthenticatedProfile } from '../src/lib/server/auth';
import { isPeriodClosed } from '../src/lib/server/payrollPeriod';

type Doc = FirebaseFirestore.DocumentData;
type Snapshot = FirebaseFirestore.DocumentSnapshot;
type Ref = FirebaseFirestore.DocumentReference;

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || '').trim() : '';
}

/** Timestamps as ISO strings, so a document prints as plain JSON. */
function plain(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, item) =>
      item && typeof item === 'object' && typeof item.toDate === 'function'
        ? item.toDate().toISOString()
        : item,
    ),
  );
}

interface Targets {
  requestRef: Ref;
  balanceRef: Ref;
  postRef: Ref;
  headRef: Ref;
  periodRef: Ref;
  slipRef: Ref;
  publicationRef: Ref;
}

interface Evaluation {
  problems: string[];
  request?: Doc;
  balance?: Doc;
  post?: Doc;
  head?: Doc;
  correctionRef?: Ref;
}

function targetsFor(employeeId: string, date: string, request?: Doc): Targets {
  const period = String(request?.period || date.slice(0, 7));
  const category = String(request?.category || '');
  const requestId = annualPaidLeaveDocumentId(employeeId, date);
  return {
    requestRef: adminDb.collection(ANNUAL_PAID_LEAVE_REQUESTS_COLLECTION).doc(requestId),
    balanceRef: adminDb
      .collection(ANNUAL_PAID_LEAVE_BALANCES_COLLECTION)
      .doc(annualPaidLeaveBalanceDocumentId(employeeId, annualPaidLeaveYear(date))),
    postRef: adminDb.collection(ANNUAL_PAID_LEAVE_PAYROLL_POSTS_COLLECTION).doc(requestId),
    headRef: adminDb
      .collection(PEKARYA_CORRECTION_HEADS_COLLECTION)
      .doc(attendanceCorrectionHeadId(period, employeeId, date)),
    periodRef: adminDb.collection('PayrollPeriods').doc(period),
    slipRef: adminDb
      .collection('PayrollSlipStates')
      .doc(`${period.replace('-', '_')}_${employeeId}`),
    publicationRef: adminDb
      .collection(PEKARYA_PUBLICATIONS_COLLECTION)
      .doc(pekaryaPublicationId(period, category)),
  };
}

/**
 * Reads everything the revoke depends on through `get` (a plain read for the
 * dry run, a transaction read for the write) and lists what stands in the way.
 */
async function evaluate(
  employeeId: string,
  date: string,
  get: (ref: Ref) => Promise<Snapshot>,
): Promise<Evaluation & { targets: Targets }> {
  const first = targetsFor(employeeId, date);
  const requestSnapshot = await get(first.requestRef);
  const request = requestSnapshot.data();
  const targets = targetsFor(employeeId, date, request);
  const problems: string[] = [];

  if (!request) {
    return { problems: ['Pengajuan cuti tidak ditemukan untuk pegawai dan tanggal ini.'], targets };
  }
  if (request.employeeId !== employeeId || request.leaveDate !== date) {
    problems.push('Pengajuan tidak cocok dengan pegawai atau tanggal yang diminta.');
  }
  if (request.status !== 'approved') {
    problems.push(`Status pengajuan "${request.status}", bukan "approved"; tidak ada yang perlu dibatalkan.`);
  }
  if (request.employeeKind !== 'blue_collar' || request.category === 'SATPAM') {
    problems.push('Skrip ini hanya untuk Pekarya non-Satpam; cuti Loyalis/Satpam meninggalkan jejak lain.');
  }

  const [balanceSnapshot, postSnapshot, headSnapshot, periodSnapshot, slipSnapshot, publicationSnapshot] =
    await Promise.all([
      get(targets.balanceRef),
      get(targets.postRef),
      get(targets.headRef),
      get(targets.periodRef),
      get(targets.slipRef),
      get(targets.publicationRef),
    ]);
  const balance = balanceSnapshot.data();
  const post = postSnapshot.data();
  const head = headSnapshot.data();

  if (!balance || Number(balance.usedDays || 0) < 1) {
    problems.push('Saldo cuti tidak mencatat hari terpakai; tidak ada yang bisa dikembalikan.');
  }
  if (!post || post.status !== 'posted' || post.payrollMode !== 'pekarya_attendance_correction') {
    problems.push('Posting payroll cuti tidak ada atau bukan posting koreksi presensi Pekarya.');
  }
  if (!head) {
    problems.push('Koreksi presensi (head) untuk tanggal ini tidak ditemukan.');
  } else if (head.sourceType !== 'annual_paid_leave' || head.sourceId !== requestSnapshot.id) {
    problems.push(
      `Koreksi presensi tanggal ini kini berasal dari "${head.sourceType}", bukan cuti tahunan ini; batalkan secara manual.`,
    );
  }
  if (isPeriodClosed(periodSnapshot.data())) {
    problems.push(`Periode ${request.period} sudah ditutup.`);
  }
  if (slipSnapshot.exists) {
    const status = String(slipSnapshot.data()?.status || '');
    problems.push(
      `Slip ${request.period} pegawai sudah ada (status ${status || 'tanpa status'}${
        isImmutablePayrollStatus(status) ? ', final' : ''
      }); persetujuan mungkin sudah masuk ke slip.`,
    );
  }
  if (
    publicationSnapshot.data()?.state === 'published' &&
    publicationSnapshot.data()?.stale !== true
  ) {
    problems.push('Rekap Uraian kategori ini sudah dipublikasikan; persetujuan ikut mengubah rekap.');
  }

  return {
    problems,
    request,
    balance,
    post,
    head,
    correctionRef: head?.correctionId
      ? adminDb.collection(PEKARYA_CORRECTIONS_COLLECTION).doc(String(head.correctionId))
      : undefined,
    targets,
  };
}

function balanceFigures(balance: Doc | undefined, usedDelta: number) {
  const entitlement = Number(balance?.entitlementDays || 0);
  const reserved = Number(balance?.reservedDays || 0);
  const used = Number(balance?.usedDays || 0) + usedDelta;
  const manual = Number(balance?.manualUsedDays || 0);
  return {
    entitlementDays: entitlement,
    reservedDays: reserved,
    usedDays: used,
    manualUsedDays: manual,
    availableDays: Math.max(0, entitlement - reserved - used - manual),
  };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const employeeId = argument('--employee');
  const date = argument('--date');
  const reason = argument('--reason');
  if (!employeeId || !isDateOnly(date)) {
    throw new Error('Gunakan --employee <id pegawai> --date <YYYY-MM-DD>.');
  }
  if (apply && (reason.length < 8 || reason.length > 400)) {
    throw new Error('--apply memerlukan --reason 8–400 karakter. Tidak ada data yang diubah.');
  }

  const actor: AuthenticatedProfile = {
    uid: 'script:revokeAnnualPaidLeave',
    email: null,
    role: 'super_admin',
    displayName: 'revokeAnnualPaidLeave script',
    permittedCategories: [],
  };

  console.log(`mode: ${apply ? 'APPLY' : 'DRY_RUN'}`);
  const preview = await evaluate(employeeId, date, (ref) => ref.get());
  console.log('\nrequest before:', JSON.stringify(plain(preview.request ?? null), null, 1));
  console.log('\nbalance before → after:');
  console.log(' ', JSON.stringify(balanceFigures(preview.balance, 0)));
  console.log(' ', JSON.stringify(balanceFigures(preview.balance, -1)));
  console.log('\npayroll post to delete:', JSON.stringify(plain(preview.post ?? null)));
  console.log('\nattendance head to delete:', JSON.stringify(plain(preview.head ?? null)));
  if (preview.problems.length > 0) {
    console.log('\nREFUSED — nothing would be changed:');
    preview.problems.forEach((problem) => console.log(` - ${problem}`));
    process.exitCode = 1;
    return;
  }
  if (!apply) {
    console.log('\nDry run only. Re-run with --reason "<alasan>" --apply to write.');
    return;
  }

  const outcome = await adminDb.runTransaction(async (transaction) => {
    const state = await evaluate(employeeId, date, (ref) => transaction.get(ref));
    if (state.problems.length > 0) {
      throw new Error(`Keadaan berubah sejak dry run: ${state.problems.join(' | ')}`);
    }
    const { targets } = state;
    const request = state.request as Doc;
    const balance = state.balance as Doc;
    const now = admin.firestore.FieldValue.serverTimestamp();
    const revision = Number(request.revision || 0) + 1;
    const decisionReason = `Persetujuan dibatalkan oleh administrator: ${reason}`;
    const after = {
      ...request,
      status: 'withdrawn',
      revision,
      decisionReason,
      approvedPayType: null,
      approvedAmount: 0,
      revokedAt: now,
      revokedBy: actor.uid,
      revokedFromStatus: 'approved',
      updatedAt: now,
    };

    transaction.set(targets.requestRef, after);
    transaction.set(
      targets.balanceRef,
      {
        usedDays: Number(balance.usedDays || 0) - 1,
        balanceRevision: nextAnnualPaidLeaveBalanceRevision(balance.balanceRevision),
        updatedAt: now,
      },
      { merge: true },
    );
    transaction.create(
      adminDb
        .collection(ANNUAL_PAID_LEAVE_REVISIONS_COLLECTION)
        .doc(`${targets.requestRef.id}__r${revision}`),
      {
        annualPaidLeaveRequestId: targets.requestRef.id,
        revision,
        action: 'revoke',
        before: request,
        after,
        actorUid: actor.uid,
        requestId: 'script:revokeAnnualPaidLeave',
        reason,
        createdAt: now,
      },
    );
    transaction.delete(targets.postRef);
    transaction.delete(targets.headRef);
    if (state.correctionRef) {
      transaction.update(state.correctionRef, {
        revokedAt: now,
        revokedBy: actor.uid,
        revokedReason: reason,
      });
    }
    transaction.create(
      newFinancialAuditRef(),
      buildFinancialAuditRecord(actor, {
        action: 'ANNUAL_PAID_LEAVE_REVOKED',
        entityType: 'AnnualPaidLeaveRequest',
        entityId: targets.requestRef.id,
        reason,
        before: request,
        after,
        metadata: {
          employeeId,
          leaveDate: date,
          period: request.period,
          removedPost: state.post ?? null,
          removedAttendanceHead: state.head ?? null,
          balanceAfter: balanceFigures(balance, -1),
        },
      }),
    );
    return { revision, balanceAfter: balanceFigures(balance, -1) };
  });

  console.log('\nAPPLIED:', JSON.stringify(outcome));
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
