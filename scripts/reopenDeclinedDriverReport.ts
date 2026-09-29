/**
 * Takes back a DECLINE the Kepala SatKer made by mistake on a SOPIR journey
 * report, so the report waits for review again and can be approved through the
 * normal Audit Perjalanan dialog.
 *
 * It deliberately does NOT write "approved" itself. Approval
 * (`/api/pekarya/activities/review`, action `approve_driver`) prices the trip
 * from the auditor's figures (distance, nights, meal, fuel, vehicle) and writes
 * the payroll ledger entry; a script that re-implemented that would be a second
 * copy of the wage rules. Decline overwrote `fee`/`upahBersih` to 0 and marked
 * the journey `declined`, so this script puts back exactly what the decline
 * changed, and nothing else:
 *   1. the ActivityReport returns to `pending`, with the review fields it had
 *      before the decline (read from the PEKARYA_ACTIVITY_DECLINED audit entry);
 *   2. the DriverJourney returns to `submitted` with its submitted wage
 *      estimate, and the decline reason is cleared;
 *   3. a FinancialAuditLogs entry records the reversal.
 *
 * It refuses, and changes nothing, unless the decline left nothing more behind:
 * the report must still be `declined` by a satker_head, there must be no ledger
 * entry or immutable slip, the period must be open, and the journey must be a
 * Standard-direct one with no fuel reservation (a decline of a held/reserved
 * journey released BBM balance, which this script does not re-reserve).
 * Everything is re-read inside the transaction.
 *
 * Dry run is the default:
 *   npx tsx scripts/reopenDeclinedDriverReport.ts \
 *     --report PEK-BC_007-driver_activity_submit_414085b2a55b4d6095089c17d5553896
 *
 * Apply after reviewing the plan (a reason is required):
 *   npx tsx scripts/reopenDeclinedDriverReport.ts --report <id> \
 *     --reason "Ditolak tidak sengaja oleh Kepala SatKer." --apply
 */
import './initEnv';
import admin, { adminDb } from '../src/lib/firebase-admin';
import { isImmutablePayrollStatus } from '../src/lib/payroll/domain';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '../src/lib/server/audit';
import type { AuthenticatedProfile } from '../src/lib/server/auth';
import { isPeriodClosed } from '../src/lib/server/payrollPeriod';

type Doc = FirebaseFirestore.DocumentData;
type Snapshot = FirebaseFirestore.DocumentSnapshot;
type Ref = FirebaseFirestore.DocumentReference;

const DECLINE_ACTION = 'PEKARYA_ACTIVITY_DECLINED';
// What the decline (and only the decline) rewrote on the report.
const REVIEW_FIELDS = [
  'status',
  'fee',
  'upahBersih',
  'declineReason',
  'reviewedAt',
  'reviewedBy',
  'reviewedByRole',
  'reviewRevision',
] as const;

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

interface Evaluation {
  problems: string[];
  report?: Doc;
  journey?: Doc;
  declineBefore?: Doc;
  reportRef: Ref;
  journeyRef?: Ref;
}

/**
 * Reads everything the reversal depends on through `get` (a plain read for the
 * dry run, a transaction read for the write) and lists what stands in the way.
 */
async function evaluate(
  reportId: string,
  get: (ref: Ref) => Promise<Snapshot>,
  getDeclineLogs: () => Promise<FirebaseFirestore.QuerySnapshot>,
): Promise<Evaluation> {
  const reportRef = adminDb.collection('ActivityReports').doc(reportId);
  const report = (await get(reportRef)).data();
  if (!report) {
    return { problems: ['Laporan tidak ditemukan.'], reportRef };
  }
  const problems: string[] = [];
  if (report.jobCategory !== 'SOPIR') {
    problems.push('Skrip ini hanya untuk laporan SOPIR.');
  }
  if (report.status !== 'declined') {
    problems.push(`Status laporan "${report.status}", bukan "declined"; tidak ada yang perlu dibatalkan.`);
  }
  if (report.reviewedByRole !== 'satker_head') {
    problems.push(`Penolakan bukan dari satker_head (${report.reviewedByRole || 'tanpa peran'}).`);
  }

  const period = String(report.payrollPeriod || String(report.activityDate || '').slice(0, 7));
  const employeeId = String(report.employeeId || '');
  const [periodSnapshot, slipSnapshot, ledgerSnapshot] = await Promise.all([
    get(adminDb.collection('PayrollPeriods').doc(period)),
    get(adminDb.collection('PayrollSlipStates').doc(`${period.replace('-', '_')}_${employeeId}`)),
    get(adminDb.collection('PayrollLedgerEntries').doc(`SPJ_ACTIVITY__${reportId}`)),
  ]);
  if (isPeriodClosed(periodSnapshot.data())) {
    problems.push(`Periode ${period} sudah ditutup.`);
  }
  if (slipSnapshot.exists && isImmutablePayrollStatus(slipSnapshot.data()?.status)) {
    problems.push(`Slip ${period} pegawai sudah dikunci (${slipSnapshot.data()?.status}).`);
  }
  if (ledgerSnapshot.exists) {
    problems.push('Sudah ada entri ledger SPJ untuk laporan ini; keadaannya bukan hasil penolakan biasa.');
  }

  // The last decline's "before" is the report as the sopir submitted it.
  const declineLogs = (await getDeclineLogs()).docs
    .map((log) => log.data())
    .filter((log) => log.action === DECLINE_ACTION)
    .sort((a, b) => Number(b.occurredAt?.toMillis?.() ?? 0) - Number(a.occurredAt?.toMillis?.() ?? 0));
  const declineBefore = declineLogs[0]?.before as Doc | undefined;
  if (!declineBefore) {
    problems.push(`Catatan audit ${DECLINE_ACTION} tidak ditemukan; keadaan sebelum ditolak tidak diketahui.`);
  } else if (declineBefore.status !== 'pending') {
    problems.push(`Keadaan sebelum ditolak "${declineBefore.status}", bukan "pending".`);
  }

  let journey: Doc | undefined;
  let journeyRef: Ref | undefined;
  if (!report.journeyId) {
    problems.push('Laporan tidak terhubung ke perjalanan (journeyId kosong).');
  } else {
    journeyRef = adminDb.collection('DriverJourneys').doc(String(report.journeyId));
    journey = (await get(journeyRef)).data();
    if (!journey) {
      problems.push('Dokumen perjalanan tidak ditemukan.');
    } else {
      if (journey.status !== 'declined') {
        problems.push(`Status perjalanan "${journey.status}", bukan "declined".`);
      }
      if (journey.activityDocId !== reportId) {
        problems.push('Perjalanan menunjuk laporan lain (activityDocId berbeda).');
      }
      if (journey.fuelProcurementMode !== 'standard_direct' || journey.fuelReservationState !== 'none') {
        problems.push(
          `BBM perjalanan (${journey.fuelProcurementMode}/${journey.fuelReservationState}) bukan Standard langsung tanpa reservasi; penolakan mungkin melepas saldo BBM.`,
        );
      }
      if (typeof journey.submittedUpahEstimate !== 'number') {
        problems.push('Perjalanan tidak menyimpan submittedUpahEstimate untuk dipulihkan.');
      }
    }
  }

  return { problems, report, journey, declineBefore, reportRef, journeyRef };
}

/** Report fields as they were before the decline; missing ones are removed again. */
function reportRestore(declineBefore: Doc): Record<string, unknown> {
  const restore: Record<string, unknown> = {};
  for (const field of REVIEW_FIELDS) {
    restore[field] =
      declineBefore[field] === undefined ? admin.firestore.FieldValue.delete() : declineBefore[field];
  }
  return restore;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const reportId = argument('--report');
  const reason = argument('--reason');
  if (!reportId) {
    throw new Error('Gunakan --report <id laporan ActivityReports>.');
  }
  if (apply && (reason.length < 8 || reason.length > 400)) {
    throw new Error('--apply memerlukan --reason 8–400 karakter. Tidak ada data yang diubah.');
  }

  const actor: AuthenticatedProfile = {
    uid: 'script:reopenDeclinedDriverReport',
    email: null,
    role: 'super_admin',
    displayName: 'reopenDeclinedDriverReport script',
    permittedCategories: [],
  };
  const declineLogsQuery = () =>
    adminDb.collection('FinancialAuditLogs').where('entityId', '==', reportId).get();

  console.log(`mode: ${apply ? 'APPLY' : 'DRY_RUN'}`);
  const preview = await evaluate(reportId, (ref) => ref.get(), declineLogsQuery);
  if (preview.report) {
    const { report, journey, declineBefore } = preview;
    console.log(`\nlaporan ${reportId}: ${report.employeeName} (${report.employeeId}), ${report.activityDate}`);
    console.log(`  alasan penolakan: ${report.declineReason}`);
    console.log('  laporan sekarang :', JSON.stringify(plain(Object.fromEntries(REVIEW_FIELDS.map((f) => [f, report[f]])))));
    if (declineBefore) {
      console.log('  laporan dipulihkan:', JSON.stringify(plain(Object.fromEntries(REVIEW_FIELDS.map((f) => [f, declineBefore[f]])))));
    }
    if (journey) {
      console.log(
        `  perjalanan ${report.journeyId}: status ${journey.status} → submitted, upahBersih ${journey.upahBersih} → ${journey.submittedUpahEstimate}`,
      );
    }
  }
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
    const state = await evaluate(
      reportId,
      (ref) => transaction.get(ref),
      // Queries cannot be read through the transaction's `get(ref)`; the audit
      // log is append-only, so a plain read is safe here.
      declineLogsQuery,
    );
    if (state.problems.length > 0) {
      throw new Error(`Keadaan berubah sejak dry run: ${state.problems.join(' | ')}`);
    }
    const report = state.report as Doc;
    const journey = state.journey as Doc;
    const now = admin.firestore.FieldValue.serverTimestamp();

    transaction.update(state.reportRef, reportRestore(state.declineBefore as Doc));
    transaction.update(state.journeyRef as Ref, {
      status: 'submitted',
      upahBersih: journey.submittedUpahEstimate,
      declineReason: '',
      reviewedAt: admin.firestore.FieldValue.delete(),
      reviewedBy: admin.firestore.FieldValue.delete(),
      updatedAt: now,
    });
    transaction.create(
      newFinancialAuditRef(),
      buildFinancialAuditRecord(actor, {
        action: 'PEKARYA_ACTIVITY_DECLINE_REVERSED',
        entityType: 'ActivityReport',
        entityId: reportId,
        reason,
        requestId: 'script:reopenDeclinedDriverReport',
        before: report,
        after: {
          ...report,
          ...Object.fromEntries(
            REVIEW_FIELDS.map((field) => [field, (state.declineBefore as Doc)[field] ?? null]),
          ),
        },
        metadata: {
          employeeId: report.employeeId,
          jobCategory: report.jobCategory,
          period: report.payrollPeriod,
          journeyId: report.journeyId,
          declinedReason: report.declineReason,
        },
      }),
    );
    return { reportId, journeyId: report.journeyId, status: 'pending' };
  });

  console.log('\nAPPLIED:', JSON.stringify(outcome));
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
