/**
 * Puts approved Loyalis izin resmi / scan corrections back into the saved
 * LoyalisPresence documents they were lost from.
 *
 * Approving a correction edits the saved presence once. A scanner file loaded
 * afterwards, or a page save from a table that predates the approval, replaced
 * those rows, so the request stayed "approved" while its effect on attendance
 * (and pay) was gone. The presence page and the slip routes now re-apply
 * approved corrections themselves (src/lib/payroll/loyalisCorrectionOverlay.ts);
 * this script writes the same result into the saved document so views that read
 * it directly agree immediately.
 *
 * Only months from LOYALIS_CORRECTION_OVERLAY_START_PERIOD that are not closed
 * are touched. Only employees whose entry actually changes are written, and
 * `updatedAt` plus `sourceImportStale` are left alone.
 *
 * Dry run is the default:
 *   npx tsx scripts/restoreApprovedLoyalisCorrections.ts
 *
 * Apply only after reviewing the output:
 *   npx tsx scripts/restoreApprovedLoyalisCorrections.ts --apply
 */
import { adminDb } from '../src/lib/firebase-admin';
import { applyApprovedLoyalisCorrectionsToPresence } from '../src/lib/server/loyalisCorrections';

const APPLY = process.argv.includes('--apply');

type Entry = { dailyLogs?: Array<Record<string, unknown>> } & Record<string, unknown>;

function restoredDates(before: Entry | undefined, after: Entry): string[] {
  const had = new Set(
    (before?.dailyLogs || [])
      .filter((log) => log.appliedCorrectionId)
      .map((log) => String(log.Tanggal)),
  );
  return (after.dailyLogs || [])
    .filter((log) => log.appliedCorrectionId && !had.has(String(log.Tanggal)))
    .map((log) => String(log.Tanggal));
}

async function main() {
  console.log(APPLY ? 'APPLY mode' : 'DRY RUN (pass --apply to write)');
  const snapshot = await adminDb.collection('LoyalisPresence').get();
  let employees = 0;
  let days = 0;
  for (const doc of snapshot.docs) {
    const match = /^(\d{4})[-_](\d{2})$/.exec(doc.id);
    if (!match) continue;
    const period = `${match[1]}-${match[2]}`;
    const saved = doc.data();
    const effective = await applyApprovedLoyalisCorrectionsToPresence(period, saved);
    if (!effective || effective === saved) continue;

    const before = (saved.entries || {}) as Record<string, Entry>;
    const after = (effective.entries || {}) as Record<string, Entry>;
    const updates: Record<string, Entry> = {};
    for (const [employeeId, entry] of Object.entries(after)) {
      if (entry === before[employeeId]) continue;
      const dates = restoredDates(before[employeeId], entry);
      if (dates.length === 0) continue;
      console.log(`${doc.id} ${employeeId}  restored: ${dates.join(', ')}`);
      updates[`entries.${employeeId}`] = entry;
      employees += 1;
      days += dates.length;
    }
    if (APPLY && Object.keys(updates).length > 0) {
      // Re-derive inside the transaction so a save that lands in between is not overwritten.
      await adminDb.runTransaction(async (transaction) => {
        const current = await transaction.get(doc.ref);
        const latest = await applyApprovedLoyalisCorrectionsToPresence(period, current.data() || {});
        const latestEntries = (latest?.entries || {}) as Record<string, Entry>;
        const writes: Record<string, Entry> = {};
        for (const key of Object.keys(updates)) {
          const employeeId = key.slice('entries.'.length);
          if (latestEntries[employeeId]) writes[key] = latestEntries[employeeId];
        }
        transaction.update(doc.ref, writes);
      });
    }
  }
  console.log(
    `${APPLY ? 'Restored' : 'Would restore'} ${days} day(s) across ${employees} employee entr${employees === 1 ? 'y' : 'ies'}.`,
  );
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
