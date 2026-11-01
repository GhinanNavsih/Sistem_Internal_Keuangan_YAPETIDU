/**
 * Repairs saved LoyalisPresence rows labelled CUTI / GANTI LIBUR whose
 * `duration` is still 0.
 *
 * `applyApprovedPaidLeaveToLoyalisEntry` used to keep the replaced absence's
 * `duration: 0` on the credited row (fixed in src/lib/payroll/loyalisPaidLeave.ts),
 * so a paid day read "0 menit / Rp 0" in the daily table, the employee payslip
 * and the XLSX export, while the entry totals (`minutes`, `absenceMinutes`,
 * strata) already counted it. Only the row's `duration` is written; no total,
 * status, scan time or other row changes, and `updatedAt` is left alone.
 *
 * Off-day credits stay at 0 (the table shows them as "Tidak dihitung").
 *
 * Dry run is the default:
 *   npx tsx scripts/fixLoyalisCreditRowDuration.ts
 *
 * Apply only after reviewing the output:
 *   npx tsx scripts/fixLoyalisCreditRowDuration.ts --apply
 */
import { adminDb } from '../src/lib/firebase-admin';
import { LOYALIS_DAY_CREDIT_WORK_STATUS } from '../src/lib/payroll/loyalisPaidLeave';

const APPLY = process.argv.includes('--apply');
const CREDIT_STATUSES = new Set(Object.values(LOYALIS_DAY_CREDIT_WORK_STATUS));

type DailyLog = Record<string, unknown>;

/** Entry id → corrected dailyLogs, plus the dates changed, for one presence document. */
function repairEntries(data: FirebaseFirestore.DocumentData) {
  const expectedMinutes = Math.max(0, Number(data.expectedHours || 6.5) * 60);
  const fixes: Record<string, { dailyLogs: DailyLog[]; dates: string[] }> = {};
  for (const [employeeId, entry] of Object.entries<{ dailyLogs?: DailyLog[] }>(
    data.entries || {},
  )) {
    const dates: string[] = [];
    const dailyLogs = (entry.dailyLogs || []).map((log) => {
      const status = String(log['Jam kerja'] || '').trim().toUpperCase();
      const wanted = log.isOffDay ? 0 : expectedMinutes;
      if (!CREDIT_STATUSES.has(status) || log.duration === wanted) return log;
      dates.push(String(log.Tanggal));
      return { ...log, duration: wanted };
    });
    if (dates.length > 0) fixes[employeeId] = { dailyLogs, dates };
  }
  return fixes;
}

async function main() {
  console.log(APPLY ? 'APPLY mode' : 'DRY RUN (pass --apply to write)');
  const snapshot = await adminDb.collection('LoyalisPresence').get();
  let rows = 0;
  for (const doc of snapshot.docs) {
    const fixes = repairEntries(doc.data());
    const count = Object.values(fixes).reduce((sum, fix) => sum + fix.dates.length, 0);
    if (count === 0) continue;
    rows += count;
    for (const [employeeId, fix] of Object.entries(fixes)) {
      console.log(doc.id, employeeId, fix.dates.join(', '));
    }
    if (!APPLY) continue;
    // Re-derive inside the transaction so a save that lands in between is not overwritten.
    await adminDb.runTransaction(async (transaction) => {
      const current = await transaction.get(doc.ref);
      const latest = repairEntries(current.data() || {});
      for (const [employeeId, fix] of Object.entries(latest)) {
        transaction.update(doc.ref, { [`entries.${employeeId}.dailyLogs`]: fix.dailyLogs });
      }
    });
  }
  console.log(`${APPLY ? 'Repaired' : 'Would repair'} ${rows} row(s).`);
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
