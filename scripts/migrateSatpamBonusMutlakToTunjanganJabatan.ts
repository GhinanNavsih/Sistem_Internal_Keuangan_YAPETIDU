/**
 * Consolidates the legacy SATPAM Bonus Presensi Mutlak field into
 * Tunjangan Jabatan in UraianGaji.
 *
 * The default mode is read-only. Use --apply only after reviewing the summary:
 *   npm run migrate:satpam-bonus -- --apply
 *
 * PayrollSlipStates are deliberately not changed here. Locked/payment
 * snapshots are immutable financial artifacts; the application normalizes
 * their display without rewriting their historical source document.
 */
import admin, { adminDb } from '../src/lib/firebase-admin';
import {
  isSatpamLegacyBonusColumn,
  normalizeSatpamUraianEntry,
} from '../src/lib/payroll/satpamCompensation';
import type { RekapColumn, UraianEntry } from '../src/types';

const APPLY = process.argv.includes('--apply');

function isSatpamUraian(
  snapshot: FirebaseFirestore.QueryDocumentSnapshot,
): boolean {
  const data = snapshot.data();
  return data.jobCategory === 'SATPAM' || snapshot.id.endsWith('_SATPAM');
}

function hasLegacyEntryField(entry: UraianEntry): boolean {
  return (
    Object.prototype.hasOwnProperty.call(entry.values || {}, 'bonusMutlak') ||
    Object.prototype.hasOwnProperty.call(entry.counts || {}, 'bonusMutlak')
  );
}

function entryNeedsUpdate(
  original: UraianEntry,
  normalized: UraianEntry,
): boolean {
  if (hasLegacyEntryField(original)) return true;
  if (
    Number(original.values?.tunjanganJabatan) !==
    Number(normalized.values?.tunjanganJabatan)
  ) {
    return true;
  }
  return Boolean(
    original.counts &&
      Object.keys(original.counts).length === 0 &&
      !normalized.counts,
  );
}

async function main(): Promise<void> {
  const [uraianSnapshot, teamSnapshot] = await Promise.all([
    adminDb.collection('UraianGaji').get(),
    adminDb.collection('SatpamShiftTeams').get(),
  ]);
  const ketuaShiftIds = new Set(
    teamSnapshot.docs
      .map((snapshot) => String(snapshot.data()?.ketuaShiftId || '').trim())
      .filter(Boolean),
  );

  const updates: Array<{
    snapshot: FirebaseFirestore.QueryDocumentSnapshot;
    entries?: Record<string, UraianEntry>;
    customColumns?: RekapColumn[];
    entryCount: number;
    removedCustomColumnCount: number;
  }> = [];

  for (const snapshot of uraianSnapshot.docs) {
    if (!isSatpamUraian(snapshot)) continue;
    const data = snapshot.data();
    const rawEntries = (data.entries || {}) as Record<string, UraianEntry>;
    const normalizedEntries: Record<string, UraianEntry> = { ...rawEntries };
    let entryCount = 0;

    for (const [employeeId, rawEntry] of Object.entries(rawEntries)) {
      if (!rawEntry) continue;
      const normalized = normalizeSatpamUraianEntry(
        rawEntry,
        ketuaShiftIds.has(employeeId),
      );
      if (entryNeedsUpdate(rawEntry, normalized)) {
        normalizedEntries[employeeId] = normalized;
        entryCount += 1;
      }
    }

    const rawCustomColumns = Array.isArray(data.customColumns)
      ? (data.customColumns as RekapColumn[])
      : [];
    const customColumns = rawCustomColumns.filter(
      (column) => !isSatpamLegacyBonusColumn(column),
    );
    const removedCustomColumnCount =
      rawCustomColumns.length - customColumns.length;

    if (entryCount > 0 || removedCustomColumnCount > 0) {
      updates.push({
        snapshot,
        ...(entryCount > 0 ? { entries: normalizedEntries } : {}),
        ...(removedCustomColumnCount > 0 ? { customColumns } : {}),
        entryCount,
        removedCustomColumnCount,
      });
    }
  }

  const summary = {
    mode: APPLY ? 'APPLY' : 'DRY_RUN',
    scannedUraianDocuments: uraianSnapshot.size,
    satpamDocuments: uraianSnapshot.docs.filter(isSatpamUraian).length,
    documentsToUpdate: updates.length,
    entriesToUpdate: updates.reduce((sum, update) => sum + update.entryCount, 0),
    customColumnsToRemove: updates.reduce(
      (sum, update) => sum + update.removedCustomColumnCount,
      0,
    ),
    documentIds: updates.map((update) => update.snapshot.id),
  };

  if (!APPLY) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  let batch = adminDb.batch();
  let batchCount = 0;
  for (const update of updates) {
    const payload: Record<string, unknown> = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (update.entries) payload.entries = update.entries;
    if (update.customColumns) payload.customColumns = update.customColumns;
    batch.update(update.snapshot.ref, payload);
    batchCount += 1;
    if (batchCount === 400) {
      await batch.commit();
      batch = adminDb.batch();
      batchCount = 0;
    }
  }
  if (batchCount > 0) await batch.commit();
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error) => {
  console.error('SATPAM bonus migration failed:', error);
  process.exitCode = 1;
});
