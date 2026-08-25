/**
 * Repairs SOPIR reports that the journey-report seeding bug marked as lintas
 * hari, stripping the premium malam they were never owed.
 *
 * Detection is shared with `auditDriverJourneySeedDateBug.ts` — read that
 * script's JSON first. Because a single record here can move several payable
 * fields at once, this script refuses to write anything without an explicit
 * id allowlist curated from that output.
 *
 * Dry run is the default:
 *   npm run fix:driver-seed-date
 *
 * Apply only the reports you reviewed:
 *   npm run fix:driver-seed-date -- --apply --ids abc123,def456
 *
 * Reports whose PayrollSlipStates doc is already immutable (confirmed/locked/
 * payment_created/paid), and those whose uang makan also shifts, are never
 * rewritten; they surface as correction-workflow items for manual payroll
 * adjustment instead.
 *
 * Only the timeline fields and the wage components that ride on them are
 * touched. The rest of the settlement (BBM, tol, uang makan, reimburse delta)
 * is left exactly as approved.
 */
import './initEnv';
import { adminDb } from '../src/lib/firebase-admin';
import {
  findLockedReportIds,
  inspectReport,
  loadDriverReports,
  type SeedDateCandidate,
} from './auditDriverJourneySeedDateBug';

function requestedIds(): Set<string> {
  const index = process.argv.indexOf('--ids');
  const raw = index >= 0 ? process.argv[index + 1] : '';
  return new Set(
    String(raw || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

async function updateInChunks(operations: Array<(batch: FirebaseFirestore.WriteBatch) => void>) {
  for (let offset = 0; offset < operations.length; offset += 400) {
    const batch = adminDb.batch();
    operations.slice(offset, offset + 400).forEach((operation) => operation(batch));
    await batch.commit();
  }
}

async function main() {
  const apply = process.argv.includes('--apply');
  const allowlist = requestedIds();
  if (apply && allowlist.size === 0) {
    throw new Error(
      'Gunakan --apply bersama --ids <id1,id2,...> hasil tinjauan npm run audit:driver-seed-date. Tidak ada data yang diubah.',
    );
  }

  const reports = await loadDriverReports();
  const candidates = reports
    .map((report) => inspectReport(report))
    .filter((candidate): candidate is SeedDateCandidate => candidate !== null);
  const lockedReportIds = await findLockedReportIds(candidates.map((c) => c.report));

  const updated: Array<Record<string, unknown>> = [];
  const skipped: Array<Record<string, unknown>> = [];
  const correctionWorkflow: Array<Record<string, unknown>> = [];
  const operations: Array<(batch: FirebaseFirestore.WriteBatch) => void> = [];
  let totalWageDelta = 0;

  for (const candidate of candidates) {
    const report = candidate.report;

    if (lockedReportIds.has(report.id)) {
      correctionWorkflow.push({
        ...candidate.row,
        reason:
          'Slip payroll pegawai untuk periode ini sudah confirmed/locked/dibayar. Buat koreksi payroll manual.',
      });
      continue;
    }
    if (candidate.mealAllowanceShifted) {
      correctionWorkflow.push({
        ...candidate.row,
        reason:
          'Uang makan ikut berubah, sehingga settlement reimburse harus ditinjau auditor secara manual.',
      });
      continue;
    }
    if (allowlist.size > 0 && !allowlist.has(report.id)) {
      skipped.push({ ...candidate.row, reason: 'Tidak termasuk dalam --ids.' });
      continue;
    }

    updated.push(candidate.row);
    totalWageDelta += candidate.wageDelta;

    const wageDelta = candidate.wageDelta;
    const oldBaseWage = Number(report.baseDriverWage || 0);
    const oldUpah = Number(report.upahBersih || 0);
    const oldEstimate = Number(report.submittedFeeEstimate || 0);

    const reportRef = adminDb.collection('ActivityReports').doc(report.id);
    const reportUpdate: Record<string, unknown> = {
      dateEnd: candidate.correctedDateEnd,
      isMultiDay: candidate.correctedIsMultiDay,
      nightCount: candidate.correctedNightCount,
      nightPremium: candidate.correctedNightPremium,
      durationHours: candidate.correctedDurationHours,
      actualJourneyDurationHours: candidate.correctedDurationHours,
      baseDriverWage: Math.max(0, oldBaseWage + wageDelta),
    };
    if (oldEstimate > 0) reportUpdate.submittedFeeEstimate = Math.max(0, oldEstimate + wageDelta);
    if (oldUpah > 0) {
      reportUpdate.upahBersih = Math.max(0, oldUpah + wageDelta);
      // An approved report's payable `fee` mirrors its Upah Bersih.
      if (report.status === 'approved') reportUpdate.fee = Math.max(0, oldUpah + wageDelta);
    }
    operations.push((batch) => batch.update(reportRef, reportUpdate));

    if (report.journeyId) {
      const journeyRef = adminDb.collection('DriverJourneys').doc(report.journeyId);
      const journeySnapshot = await journeyRef.get();
      if (journeySnapshot.exists) {
        const journeyData = journeySnapshot.data() || {};
        const journeyUpdate: Record<string, unknown> = {
          dateEnd: candidate.correctedDateEnd,
          isMultiDay: candidate.correctedIsMultiDay,
          nightCount: candidate.correctedNightCount,
        };
        if (Number(journeyData.baseDriverWage || 0) > 0) {
          journeyUpdate.baseDriverWage = Math.max(
            0,
            Number(journeyData.baseDriverWage) + wageDelta,
          );
        }
        if (Number(journeyData.upahBersih || 0) > 0) {
          journeyUpdate.upahBersih = Math.max(0, Number(journeyData.upahBersih) + wageDelta);
        }
        if (Number(journeyData.submittedUpahEstimate || 0) > 0) {
          journeyUpdate.submittedUpahEstimate = Math.max(
            0,
            Number(journeyData.submittedUpahEstimate) + wageDelta,
          );
        }
        if (Number(journeyData.submittedDurationHours || 0) > 0) {
          journeyUpdate.submittedDurationHours = candidate.correctedDurationHours;
        }
        operations.push((batch) => batch.update(journeyRef, journeyUpdate));
      }
    }
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        mode: apply ? 'APPLY' : 'DRY_RUN',
        scanned: reports.length,
        candidateCount: candidates.length,
        updatedCount: updated.length,
        skippedCount: skipped.length,
        totalWageDeltaRp: totalWageDelta,
        manualReviewCount: correctionWorkflow.length,
        updated,
        skipped,
        correctionWorkflow,
      },
      null,
      2,
    )}\n`,
  );

  if (!apply) return;
  await updateInChunks(operations);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
