/**
 * Recomputes Komponen Waktu (and everything derived from it) for existing
 * SOPIR ActivityReports so it reflects cumulative Google Directions travel
 * time between destinations instead of elapsed departure-to-arrival clock
 * time. Elapsed clock time (durationHours) is left untouched everywhere —
 * it still governs the uang makan meal-allowance strata.
 *
 * Dry run is the default (nothing is written, only a JSON diff is printed):
 *   npm run recompute:driver-komponen-waktu
 *
 * Apply only after reviewing the dry-run output:
 *   npm run recompute:driver-komponen-waktu -- --apply
 *
 * Optional flags:
 *   --period 2026-07   Restrict to one payroll period.
 *   --limit 20         Cap how many reports are processed (Directions API calls cost quota).
 *
 * Reports whose `PayrollSlipStates` doc is already immutable (confirmed,
 * locked, payment_created, or paid — see `isImmutablePayrollStatus`) are
 * never financially rewritten here — they're listed under `correctionWorkflow`
 * for manual reconciliation instead, mirroring reconcileSatpamFlexibleReports.ts.
 * Everything else (no slip doc yet, or a slip still in a draft/editable
 * status) is safe to update directly, whether the report itself is pending
 * or already approved — approval alone doesn't mean the slip was finalized.
 */
import './initEnv';
import { adminDb } from '../src/lib/firebase-admin';
import { driverJourneyRoutePoints } from '../src/lib/payroll/driverJourney';
import { isImmutablePayrollStatus } from '../src/lib/payroll/domain';

interface DriverReport {
  id: string;
  jobCategory?: string;
  employeeId?: string;
  status?: string;
  payrollPeriod?: string;
  period?: string;
  journeyId?: string;
  points?: string[];
  startPoint?: string;
  mainDestinations?: string[];
  endPoint?: string;
  componentWaktu?: number;
  baseDriverWage?: number;
  upahBersih?: number;
  fee?: number;
  submittedFeeEstimate?: number;
  routeDurationHours?: number;
}

function optionalArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  return process.argv[index + 1] || null;
}

function reportPeriod(report: DriverReport): string {
  return String(report.payrollPeriod || report.period || '');
}

function reportRoutePoints(report: DriverReport): string[] {
  if (Array.isArray(report.points) && report.points.length >= 2) return report.points;
  return driverJourneyRoutePoints(report.startPoint, report.mainDestinations, report.endPoint, true);
}

async function fetchTravelTimeHours(
  points: string[],
  apiKey: string,
): Promise<{ ok: true; travelTimeHours: number } | { ok: false; reason: string }> {
  if (points.length < 2) return { ok: false, reason: 'not_enough_points' };
  const origin = points[0];
  const routePts = points[points.length - 1] === origin ? points : [...points, origin];
  const destination = routePts[routePts.length - 1];
  const waypoints = routePts.slice(1, -1);

  let url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&key=${apiKey}`;
  if (waypoints.length > 0) {
    url += `&waypoints=${waypoints.map((p) => encodeURIComponent(p)).join('|')}`;
  }

  const response = await fetch(url);
  const data = await response.json();
  if (data.status !== 'OK' || !data.routes?.[0]) {
    return { ok: false, reason: `directions_${String(data.status || 'unknown').toLowerCase()}` };
  }
  const totalSeconds = (data.routes[0].legs as Array<{ duration?: { value?: number } }>).reduce(
    (sum: number, leg) => sum + (leg.duration?.value || 0),
    0,
  );
  return { ok: true, travelTimeHours: totalSeconds / 3600 };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const periodFilter = optionalArg('--period');
  const limitArg = optionalArg('--limit');
  const limit = limitArg ? Number(limitArg) : Infinity;

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_MAPS_API_KEY tidak ditemukan di environment.');
  }

  const activitySnapshot = await adminDb
    .collection('ActivityReports')
    .where('jobCategory', '==', 'SOPIR')
    .get();

  const candidates = activitySnapshot.docs
    .map((snapshot) => ({ id: snapshot.id, ...snapshot.data() } as DriverReport))
    .filter((report) => report.status === 'pending' || report.status === 'approved')
    .filter((report) => !periodFilter || reportPeriod(report) === periodFilter)
    .slice(0, Number.isFinite(limit) ? limit : undefined);

  // Per-employee-per-period slip lock, keyed the same way the review route
  // keys it: `{period.replace('-', '_')}_{employeeId}`.
  const slipRefs = candidates.map((report) =>
    adminDb.collection('PayrollSlipStates').doc(`${reportPeriod(report).replace('-', '_')}_${report.employeeId ?? ''}`),
  );
  const slipSnapshots = slipRefs.length ? await adminDb.getAll(...slipRefs) : [];
  const lockedReportIds = new Set(
    candidates
      .filter((_, index) => isImmutablePayrollStatus(slipSnapshots[index]?.data()?.status))
      .map((report) => report.id),
  );

  const updated: Array<{
    id: string;
    status: string;
    oldComponentWaktu: number;
    newComponentWaktu: number;
    deltaWaktu: number;
    journeyId?: string;
  }> = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  const correctionWorkflow: Array<{
    id: string;
    period: string;
    deltaWaktu: number;
    reason: string;
  }> = [];

  const operations: Array<(batch: FirebaseFirestore.WriteBatch) => void> = [];
  let totalDeltaRp = 0;

  for (const report of candidates) {
    const points = reportRoutePoints(report);
    const result = await fetchTravelTimeHours(points, apiKey);
    // Stay well under Directions API QPS limits across a large backfill.
    await sleep(150);

    if (!result.ok) {
      skipped.push({ id: report.id, reason: result.reason });
      continue;
    }

    const newComponentWaktu = Math.ceil(result.travelTimeHours * 5_000);
    const oldComponentWaktu = report.componentWaktu ?? 0;
    const deltaWaktu = newComponentWaktu - oldComponentWaktu;
    if (deltaWaktu === 0) {
      skipped.push({ id: report.id, reason: 'no_change' });
      continue;
    }

    if (lockedReportIds.has(report.id)) {
      correctionWorkflow.push({
        id: report.id,
        period: reportPeriod(report),
        deltaWaktu,
        reason: 'Slip payroll karyawan untuk periode ini sudah confirmed/locked/dibayar. Buat koreksi payroll manual, jangan tulis ulang laporan ini.',
      });
      continue;
    }

    updated.push({
      id: report.id,
      status: report.status || '',
      oldComponentWaktu,
      newComponentWaktu,
      deltaWaktu,
      journeyId: report.journeyId,
    });
    totalDeltaRp += deltaWaktu;

    const reportRef = adminDb.collection('ActivityReports').doc(report.id);
    if (report.status === 'approved') {
      const newUpahBersih = Math.max(0, (report.upahBersih ?? 0) + deltaWaktu);
      operations.push((batch) =>
        batch.update(reportRef, {
          componentWaktu: newComponentWaktu,
          routeDurationHours: result.travelTimeHours,
          baseDriverWage: (report.baseDriverWage ?? 0) + deltaWaktu,
          upahBersih: newUpahBersih,
          fee: newUpahBersih,
        }),
      );
    } else {
      operations.push((batch) =>
        batch.update(reportRef, {
          componentWaktu: newComponentWaktu,
          routeDurationHours: result.travelTimeHours,
          baseDriverWage: (report.baseDriverWage ?? 0) + deltaWaktu,
          submittedFeeEstimate: (report.submittedFeeEstimate ?? 0) + deltaWaktu,
        }),
      );
    }

    if (report.journeyId) {
      const journeyRef = adminDb.collection('DriverJourneys').doc(report.journeyId);
      const journeySnapshot = await journeyRef.get();
      if (journeySnapshot.exists) {
        const journeyData = journeySnapshot.data() || {};
        const journeyDelta = newComponentWaktu - (journeyData.componentWaktu ?? oldComponentWaktu);
        const journeyUpdate: Record<string, unknown> = {
          componentWaktu: newComponentWaktu,
          routeDurationHours: result.travelTimeHours,
          baseDriverWage: (journeyData.baseDriverWage ?? 0) + journeyDelta,
        };
        if (report.status === 'approved') {
          journeyUpdate.upahBersih = Math.max(0, (journeyData.upahBersih ?? 0) + journeyDelta);
        } else {
          journeyUpdate.upahBersih = Math.max(0, (journeyData.upahBersih ?? 0) + journeyDelta);
          journeyUpdate.submittedUpahEstimate = Math.max(
            0,
            (journeyData.submittedUpahEstimate ?? 0) + journeyDelta,
          );
        }
        operations.push((batch) => batch.update(journeyRef, journeyUpdate));
      }
    }
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        mode: apply ? 'APPLY' : 'DRY_RUN',
        period: periodFilter || 'ALL',
        scanned: candidates.length,
        updatedCount: updated.length,
        totalDeltaRp,
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
