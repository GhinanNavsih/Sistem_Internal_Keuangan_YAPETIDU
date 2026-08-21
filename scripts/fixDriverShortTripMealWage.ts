/**
 * Repairs SOPIR reports whose stored `durationHours` holds the route/one-way
 * duration instead of the elapsed clock time (jam berangkat → jam tiba).
 *
 * Submissions before the elapsed-duration fix stored the wrong value, which
 * wrongly triggered the ≤2-hour short-trip meal component (Rp 5.000) inside
 * Upah Bersih for trips that actually ran longer than 2 hours. Those trips
 * already receive their proper meal allowance as a separate reimbursement
 * (`actualMealAllowance`), so the wage component is pure double-payment.
 *
 * This is why such a report shows one Upah Bersih in the activity-review table
 * (stored, stale) and a different one in the audit dialog (recomputed live
 * from the times) — the audit figure is the correct one.
 *
 * Dry run is the default:
 *   npm run fix:driver-short-trip-meal
 *
 * Apply only after reviewing the JSON output:
 *   npm run fix:driver-short-trip-meal -- --apply
 *
 * Reports whose PayrollSlipStates doc is already immutable (confirmed/locked/
 * payment_created/paid) are never rewritten; they are emitted as
 * correction-workflow items for manual payroll adjustment instead.
 *
 * Only the short-trip meal component is adjusted. The rest of the settlement
 * (BBM, tol, uang makan, reimburse delta) is left exactly as approved, so the
 * fix is a precise ±Rp 5.000 correction rather than a full recomputation.
 */
import './initEnv';
import { adminDb } from '../src/lib/firebase-admin';
import { isImmutablePayrollStatus } from '../src/lib/payroll/domain';
import {
  calculateJourneyDateTimeTimings,
  getShortTripMealWageComponent,
} from '../src/lib/payroll/driverJourney';

interface DriverReport {
  id: string;
  employeeId?: string;
  employeeName?: string;
  status?: string;
  payrollPeriod?: string;
  period?: string;
  activityDate?: string;
  dateStart?: string;
  dateEnd?: string;
  timeStart?: string;
  timeEnd?: string;
  isMultiDay?: boolean;
  durationHours?: number;
  journeyId?: string;
  baseDriverWage?: number;
  submittedFeeEstimate?: number;
  upahBersih?: number;
  fee?: number;
}

function reportPeriod(report: DriverReport): string {
  return String(report.payrollPeriod || report.period || '');
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

  const activitySnapshot = await adminDb
    .collection('ActivityReports')
    .where('jobCategory', '==', 'SOPIR')
    .get();

  const candidates = activitySnapshot.docs
    .map((snapshot) => ({ id: snapshot.id, ...snapshot.data() } as DriverReport))
    .filter((report) => report.status === 'pending' || report.status === 'approved')
    .filter((report) => Boolean(report.timeStart && report.timeEnd));

  const slipRefs = candidates.map((report) =>
    adminDb
      .collection('PayrollSlipStates')
      .doc(`${reportPeriod(report).replace('-', '_')}_${report.employeeId ?? ''}`),
  );
  const slipSnapshots = slipRefs.length ? await adminDb.getAll(...slipRefs) : [];
  const lockedReportIds = new Set(
    candidates
      .filter((_, index) => isImmutablePayrollStatus(slipSnapshots[index]?.data()?.status))
      .map((report) => report.id),
  );

  const updated: Array<Record<string, unknown>> = [];
  const correctionWorkflow: Array<Record<string, unknown>> = [];
  const operations: Array<(batch: FirebaseFirestore.WriteBatch) => void> = [];
  let totalWageDelta = 0;

  for (const report of candidates) {
    const timings = calculateJourneyDateTimeTimings({
      dateStart: String(report.dateStart || report.activityDate || ''),
      dateEnd: String(report.dateEnd || report.dateStart || report.activityDate || ''),
      timeStart: String(report.timeStart),
      timeEnd: String(report.timeEnd),
      isMultiDay: report.isMultiDay === true,
    });
    const trueElapsed = timings.durationHours;
    if (trueElapsed <= 0) continue;

    const storedElapsed = Number(report.durationHours || 0);
    // The wage only changes when the ≤2h short-trip meal component flips.
    // A durationHours mismatch that does not flip it is left untouched.
    const mealDelta =
      getShortTripMealWageComponent(trueElapsed) - getShortTripMealWageComponent(storedElapsed);
    if (mealDelta === 0) continue;

    const oldBaseWage = Number(report.baseDriverWage || 0);
    const newBaseWage = Math.max(0, oldBaseWage + mealDelta);
    const oldUpah = Number(report.upahBersih || 0);
    const newUpah = oldUpah > 0 ? Math.max(0, oldUpah + mealDelta) : oldUpah;
    const oldEstimate = Number(report.submittedFeeEstimate || 0);
    const newEstimate = oldEstimate > 0 ? Math.max(0, oldEstimate + mealDelta) : oldEstimate;

    const row = {
      id: report.id,
      employeeId: report.employeeId,
      employeeName: report.employeeName,
      status: report.status,
      period: reportPeriod(report),
      activityDate: report.activityDate,
      time: `${report.timeStart}-${report.timeEnd}`,
      storedDurationHours: storedElapsed,
      correctedDurationHours: trueElapsed,
      mealDelta,
      baseDriverWage: `${oldBaseWage} -> ${newBaseWage}`,
      upahBersih: `${oldUpah} -> ${newUpah}`,
      submittedFeeEstimate: `${oldEstimate} -> ${newEstimate}`,
    };

    if (lockedReportIds.has(report.id)) {
      correctionWorkflow.push({
        ...row,
        reason:
          'Slip payroll pegawai untuk periode ini sudah confirmed/locked/dibayar. Buat koreksi payroll manual.',
      });
      continue;
    }

    updated.push(row);
    totalWageDelta += mealDelta;

    const reportRef = adminDb.collection('ActivityReports').doc(report.id);
    const reportUpdate: Record<string, unknown> = {
      durationHours: trueElapsed,
      baseDriverWage: newBaseWage,
    };
    if (oldEstimate > 0) reportUpdate.submittedFeeEstimate = newEstimate;
    if (oldUpah > 0) {
      reportUpdate.upahBersih = newUpah;
      // An approved report's payable `fee` mirrors its Upah Bersih.
      if (report.status === 'approved') reportUpdate.fee = newUpah;
    }
    operations.push((batch) => batch.update(reportRef, reportUpdate));

    if (report.journeyId) {
      const journeyRef = adminDb.collection('DriverJourneys').doc(report.journeyId);
      const journeySnapshot = await journeyRef.get();
      if (journeySnapshot.exists) {
        const journeyData = journeySnapshot.data() || {};
        const journeyUpdate: Record<string, unknown> = {};
        if (Number(journeyData.baseDriverWage || 0) > 0) {
          journeyUpdate.baseDriverWage = Math.max(0, Number(journeyData.baseDriverWage) + mealDelta);
        }
        if (Number(journeyData.upahBersih || 0) > 0) {
          journeyUpdate.upahBersih = Math.max(0, Number(journeyData.upahBersih) + mealDelta);
        }
        if (Number(journeyData.submittedUpahEstimate || 0) > 0) {
          journeyUpdate.submittedUpahEstimate = Math.max(
            0,
            Number(journeyData.submittedUpahEstimate) + mealDelta,
          );
        }
        if (Number(journeyData.submittedDurationHours || 0) > 0) {
          journeyUpdate.submittedDurationHours = trueElapsed;
        }
        if (Object.keys(journeyUpdate).length > 0) {
          operations.push((batch) => batch.update(journeyRef, journeyUpdate));
        }
      }
    }
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        mode: apply ? 'APPLY' : 'DRY_RUN',
        scanned: candidates.length,
        updatedCount: updated.length,
        totalWageDeltaRp: totalWageDelta,
        lockedCount: correctionWorkflow.length,
        updated,
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
