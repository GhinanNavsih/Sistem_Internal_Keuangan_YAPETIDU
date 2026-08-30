/**
 * Corrects the 10 SATPAM shift-assignment reports identified during the
 * August 2026 Pos 9 / Ketua Shift investigation: the reporting form seeded
 * 'Harian' for the Ketua Shift's own post and for a designated Pos 9 guard
 * regardless of date (fixed in src/lib/payroll/domain.ts,
 * defaultSatpamAssignmentPayType), so on a real Friday/national holiday the
 * server honoured that as a deliberate override of the calendar and paid the
 * ordinary rate instead of Jumat & Libur.
 *
 * This is a fixed, hardcoded allowlist of report IDs — it does not scan for
 * or touch anything outside this exact list, even if other reports carry the
 * same bug pattern.
 *
 * Two thirds of the targets are 'approved' and mirror the transaction in
 * POST /api/satpam/shifts/admin-pay-type exactly (idempotency key, period-open
 * check, slip-immutability check, ledger sync, financial audit log), followed
 * by the same syncSatpamDutyReconciliation call that route makes. The rest are
 * still 'pending' review: the approve/decline handler
 * (src/app/api/satpam/shifts/review/route.ts) reads shiftType straight off the
 * stored report at approval time rather than recomputing it, so correcting the
 * field now is sufficient — the eventual approval will derive the right fee
 * and ledger entry on its own. Every write, pending or approved, still gets a
 * FinancialAuditLogs entry.
 *
 * Every target is re-read immediately before writing and skipped (not
 * force-corrected) if it no longer matches the expected pre-state — e.g. one
 * of the original 10 (team_3__20260814__pagi-BC_015) was already corrected by
 * someone else between the investigation and this script being run.
 *
 * Dry run is the default:
 *   npx tsx scripts/fixSatpamPos9KetuaPremiumRate.ts
 *
 * Apply only after reviewing the JSON output:
 *   npx tsx scripts/fixSatpamPos9KetuaPremiumRate.ts --apply
 */
import { createHash } from 'node:crypto';
import admin, { adminDb } from '../src/lib/firebase-admin';
import {
  isImmutablePayrollStatus,
  SATPAM_RATES,
  type SatpamPayType,
} from '../src/lib/payroll/domain';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '../src/lib/server/audit';
import type { AuthenticatedProfile } from '../src/lib/server/auth';
import { assertPeriodAcceptsInput } from '../src/lib/server/payrollPeriod';
import { syncSatpamDutyReconciliation } from '../src/lib/server/satpamDutyPlan';

const PERIOD = '2026-08';
const REASON =
  "Koreksi bug default upah: form Ketua Shift/Pos 9 menetapkan 'Harian' " +
  'tanpa memandang tanggal, sehingga Jumat/hari libur nasional Agustus 2026 ' +
  'terbayar dengan tarif biasa. Lihat defaultSatpamAssignmentPayType di ' +
  'src/lib/payroll/domain.ts.';

const TARGET_REPORT_IDS: readonly string[] = [
  'SAT-team_1__20260807__pagi-BC_028-primary_Pos_2_1',
  'SAT-team_1__20260807__pagi-BC_034-primary_Pos_9_8',
  'SAT-team_2__20260807__malam-BC_016-primary_Pos_2_1',
  'SAT-team_3__20260807__sore-BC_015-primary_Pos_2_1',
  'SAT-team_1__20260814__malam-BC_034-primary_Pos_9_8',
  'SAT-team_3__20260814__pagi-BC_015-primary_Pos_2_1',
  'SAT-team_3__20260814__pagi-BC_036-primary_Pos_9_8',
  'SAT-team_1__20260817__sore-BC_028-primary_Pos_2_1',
  'SAT-team_1__20260817__sore-BC_034-primary_Pos_9_8',
  'SAT-team_1__20260821__sore-BC_034-primary_Pos_9_8',
];

const TARGET_PAY_TYPE: Exclude<SatpamPayType, 'Off-Duty'> = 'Jumat & Libur';

function requestIdFor(reportId: string): string {
  return `fix-satpam-pos9-ketua-${createHash('sha256').update(reportId).digest('hex').slice(0, 24)}`;
}

async function correctApproved(
  actor: AuthenticatedProfile,
  reportId: string,
): Promise<{ outcome: string; detail: string }> {
  const requestId = requestIdFor(reportId);
  const requestHash = createHash('sha256')
    .update(JSON.stringify({ reportId, payType: TARGET_PAY_TYPE, reason: REASON }))
    .digest('hex');

  return adminDb.runTransaction(async (transaction) => {
    const reportRef = adminDb.collection('ActivityReports').doc(reportId);
    const idempotencyRef = adminDb
      .collection('FinancialIdempotencyKeys')
      .doc(`${actor.uid}__${requestId}`);
    const [reportSnapshot, idempotencySnapshot] = await Promise.all([
      transaction.get(reportRef),
      transaction.get(idempotencyRef),
    ]);

    if (idempotencySnapshot.exists) {
      return { outcome: 'skipped', detail: 'requestId sudah pernah diterapkan sebelumnya.' };
    }
    if (!reportSnapshot.exists) {
      return { outcome: 'skipped', detail: 'Laporan tidak ditemukan.' };
    }
    const before = reportSnapshot.data()!;
    if (before.status !== 'approved') {
      return {
        outcome: 'skipped',
        detail: `Status sudah berubah menjadi '${before.status}', bukan lagi 'approved'.`,
      };
    }
    if (before.shiftType === TARGET_PAY_TYPE) {
      return { outcome: 'skipped', detail: 'Sudah benar sebelum skrip berjalan; tidak diubah.' };
    }
    if (before.shiftType !== 'Harian') {
      return {
        outcome: 'skipped',
        detail: `shiftType sudah '${before.shiftType}', bukan 'Harian' yang diharapkan.`,
      };
    }

    const employeeId = String(before.employeeId || '');
    const periodRef = adminDb.collection('PayrollPeriods').doc(PERIOD);
    const slipRef = adminDb
      .collection('PayrollSlipStates')
      .doc(`${PERIOD.replace('-', '_')}_${employeeId}`);
    const ledgerRef = adminDb.collection('PayrollLedgerEntries').doc(reportId);
    const [periodSnapshot, slipSnapshot, ledgerSnapshot] = await Promise.all([
      transaction.get(periodRef),
      transaction.get(slipRef),
      transaction.get(ledgerRef),
    ]);

    assertPeriodAcceptsInput(
      periodSnapshot.data(),
      'Periode payroll sudah ditutup; kategori upah tidak dapat diubah.',
    );
    if (slipSnapshot.exists && isImmutablePayrollStatus(slipSnapshot.data()?.status)) {
      return {
        outcome: 'skipped',
        detail: 'Slip pegawai sudah dikunci/dibayar; perlu alur koreksi finansial terpisah.',
      };
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const amount = SATPAM_RATES[TARGET_PAY_TYPE];
    const after = {
      ...before,
      shiftType: TARGET_PAY_TYPE,
      fee: amount,
      coveredEmployeeId: null,
      payTypeCorrectedAt: now,
      payTypeCorrectedBy: actor.uid,
      payTypeCorrectedFrom: String(before.shiftType || ''),
      reviewRevision: Number(before.reviewRevision || 0) + 1,
    };
    transaction.set(reportRef, after);

    if (ledgerSnapshot.exists) {
      transaction.update(ledgerRef, {
        payType: TARGET_PAY_TYPE,
        amount,
        correctedAt: now,
        correctedBy: actor.uid,
      });
    }

    transaction.create(
      newFinancialAuditRef(),
      buildFinancialAuditRecord(actor, {
        action: 'SATPAM_SHIFT_ASSIGNMENT_PAY_TYPE_CORRECTED',
        entityType: 'ActivityReport',
        entityId: reportId,
        reason: REASON,
        requestId,
        before,
        after,
        metadata: {
          employeeId,
          period: PERIOD,
          occurrenceId: before.sourceOccurrenceId,
          previousPayType: before.shiftType,
          newPayType: TARGET_PAY_TYPE,
          previousFee: Number(before.fee || 0),
          newFee: amount,
        },
      }),
    );
    transaction.create(idempotencyRef, {
      requestHash,
      entityId: reportId,
      employeeId,
      period: PERIOD,
      resultingStatus: 'approved',
      createdAt: now,
    });

    return {
      outcome: 'corrected',
      detail: `fee ${Number(before.fee || 0)} -> ${amount}; ledger disinkronkan: ${ledgerSnapshot.exists}.`,
    };
  });
}

async function correctPending(
  actor: AuthenticatedProfile,
  reportId: string,
): Promise<{ outcome: string; detail: string }> {
  return adminDb.runTransaction(async (transaction) => {
    const reportRef = adminDb.collection('ActivityReports').doc(reportId);
    const reportSnapshot = await transaction.get(reportRef);
    if (!reportSnapshot.exists) {
      return { outcome: 'skipped', detail: 'Laporan tidak ditemukan.' };
    }
    const before = reportSnapshot.data()!;
    if (before.status !== 'pending') {
      return {
        outcome: 'skipped',
        detail: `Status sudah berubah menjadi '${before.status}', bukan lagi 'pending'.`,
      };
    }
    if (before.shiftType === TARGET_PAY_TYPE) {
      return { outcome: 'skipped', detail: 'Sudah benar sebelum skrip berjalan; tidak diubah.' };
    }
    if (before.shiftType !== 'Harian') {
      return {
        outcome: 'skipped',
        detail: `shiftType sudah '${before.shiftType}', bukan 'Harian' yang diharapkan.`,
      };
    }

    const ledgerRef = adminDb.collection('PayrollLedgerEntries').doc(reportId);
    const ledgerSnapshot = await transaction.get(ledgerRef);
    if (ledgerSnapshot.exists) {
      // A pending report should never already have a ledger entry — those are
      // only created at approval. Bail rather than guess how it got one.
      return {
        outcome: 'skipped',
        detail: 'Laporan pending ini sudah memiliki entri ledger; perlu diperiksa manual.',
      };
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const amount = SATPAM_RATES[TARGET_PAY_TYPE];
    const after = {
      ...before,
      shiftType: TARGET_PAY_TYPE,
      fee: amount,
      payTypeCorrectedAt: now,
      payTypeCorrectedBy: actor.uid,
      payTypeCorrectedFrom: String(before.shiftType || ''),
    };
    transaction.set(reportRef, after);

    transaction.create(
      newFinancialAuditRef(),
      buildFinancialAuditRecord(actor, {
        action: 'SATPAM_SHIFT_ASSIGNMENT_PAY_TYPE_CORRECTED',
        entityType: 'ActivityReport',
        entityId: reportId,
        reason: REASON,
        requestId: requestIdFor(reportId),
        before,
        after,
        metadata: {
          employeeId: String(before.employeeId || ''),
          period: PERIOD,
          occurrenceId: before.sourceOccurrenceId,
          previousPayType: before.shiftType,
          newPayType: TARGET_PAY_TYPE,
          previousFee: Number(before.fee || 0),
          newFee: amount,
          reportStatusAtCorrection: 'pending',
        },
      }),
    );

    return {
      outcome: 'corrected',
      detail: `fee ${Number(before.fee || 0)} -> ${amount} (masih pending, belum ada ledger).`,
    };
  });
}

async function main() {
  const apply = process.argv.includes('--apply');
  const actor: AuthenticatedProfile = {
    uid: 'script:fixSatpamPos9KetuaPremiumRate',
    email: null,
    role: 'super_admin',
    displayName: 'fixSatpamPos9KetuaPremiumRate script',
    permittedCategories: [],
  };

  const snapshots = await adminDb.getAll(
    ...TARGET_REPORT_IDS.map((id) => adminDb.collection('ActivityReports').doc(id)),
  );

  console.log(`mode: ${apply ? 'APPLY' : 'DRY_RUN'}`);
  console.log('current state immediately before this run:');
  for (const snapshot of snapshots) {
    const data = snapshot.data();
    console.log(
      `  ${snapshot.id} | status=${data?.status ?? '(missing)'} | shiftType=${data?.shiftType ?? '(missing)'} | fee=${data?.fee ?? '(missing)'}`,
    );
  }

  const results: Array<{ id: string; outcome: string; detail: string }> = [];
  let touchedApproved = false;

  for (const snapshot of snapshots) {
    const data = snapshot.data();
    if (!data) {
      results.push({ id: snapshot.id, outcome: 'skipped', detail: 'Laporan tidak ditemukan.' });
      continue;
    }
    if (data.shiftType === TARGET_PAY_TYPE) {
      results.push({
        id: snapshot.id,
        outcome: 'skipped',
        detail: 'Sudah benar; tidak diubah.',
      });
      continue;
    }
    if (data.shiftType !== 'Harian') {
      results.push({
        id: snapshot.id,
        outcome: 'skipped',
        detail: `shiftType tidak terduga: '${data.shiftType}'.`,
      });
      continue;
    }
    if (data.status !== 'approved' && data.status !== 'pending') {
      results.push({
        id: snapshot.id,
        outcome: 'skipped',
        detail: `status tidak terduga: '${data.status}'.`,
      });
      continue;
    }

    if (!apply) {
      results.push({
        id: snapshot.id,
        outcome: 'would-correct',
        detail: `status=${data.status}; fee ${Number(data.fee || 0)} -> ${SATPAM_RATES[TARGET_PAY_TYPE]}.`,
      });
      continue;
    }

    const result =
      data.status === 'approved'
        ? await correctApproved(actor, snapshot.id)
        : await correctPending(actor, snapshot.id);
    if (result.outcome === 'corrected' && data.status === 'approved') touchedApproved = true;
    results.push({ id: snapshot.id, ...result });
  }

  if (apply && touchedApproved) {
    await syncSatpamDutyReconciliation(PERIOD, actor.uid);
    console.log('\nsyncSatpamDutyReconciliation dijalankan untuk periode 2026-08.');
  }

  console.log('\nhasil:');
  for (const result of results) {
    console.log(`  ${result.id} -> ${result.outcome}: ${result.detail}`);
  }
  const correctedCount = results.filter((r) => r.outcome === 'corrected').length;
  const wouldCorrectCount = results.filter((r) => r.outcome === 'would-correct').length;
  console.log(
    `\n${apply ? 'dikoreksi' : 'akan dikoreksi jika --apply'}: ${apply ? correctedCount : wouldCorrectCount} / ${TARGET_REPORT_IDS.length}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
