/**
 * Read-only sweep for SOPIR reports carrying an overnight count their own
 * clock times cannot justify.
 *
 * The journey-report form used to seed `dateEnd`/`isMultiDay` from
 * `activityDate < today`, so a sopir who filed the report a day or more after
 * the trip opened it with the lintas-hari toggle already on and the end date
 * pushed to the day the form was opened. Where that end date survived to
 * submission, the stored `nightCount` — and the Upah Bersih built on it —
 * gained nights that never happened.
 *
 * The related audit-dialog defect (a stale `isMultiDay` flag on same-day dates
 * conjuring a next-day arrival) is fixed in `calculateEditableDriverJourneyTimeline`
 * and needs no data repair, so a lone stale flag is deliberately not reported
 * here. This script looks only for a stored end date or night count that the
 * journey's own times contradict.
 *
 * This script intentionally contains no Firestore write calls.
 * Usage: npm run audit:driver-seed-date
 *
 * Review its JSON before running the companion fix script; the ids listed
 * under `candidates` are what that script expects in its --ids allowlist.
 */
import './initEnv';
import { adminDb } from '../src/lib/firebase-admin';
import { isImmutablePayrollStatus } from '../src/lib/payroll/domain';
import {
  calculateEditableDriverJourneyTimeline,
  calculateNightPremium,
  getShortTripMealWageComponent,
  getMealAllowanceForDuration,
} from '../src/lib/payroll/driverJourney';

export interface DriverReport {
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
  nightCount?: number;
  nightPremium?: number;
  durationHours?: number;
  vehicleType?: string;
  ndalemMealMoneyReceived?: number;
  preAuthorizedMeal?: number;
  actualMealAllowance?: number;
  extraMealAllowance?: number;
  journeyId?: string;
  baseDriverWage?: number;
  submittedFeeEstimate?: number;
  upahBersih?: number;
  fee?: number;
  submittedAt?: FirebaseFirestore.Timestamp;
  firstSubmittedAt?: FirebaseFirestore.Timestamp;
}

export function reportPeriod(report: DriverReport): string {
  return String(report.payrollPeriod || report.period || '');
}

/**
 * The buggy seed used `new Date().toISOString()`, so a corrupted `dateEnd`
 * carries the UTC date of the moment the form was opened. Matching it against
 * the submission stamp is what separates a bug artefact from a deliberate
 * multi-day entry; a one-day window covers a form opened before midnight UTC
 * and sent after it.
 */
function looksSeededFromSubmissionDate(report: DriverReport, storedDateEnd: string): boolean {
  const stamp = report.firstSubmittedAt || report.submittedAt;
  if (!stamp || typeof stamp.toDate !== 'function') return false;
  const submittedMs = stamp.toDate().getTime();
  const storedMs = new Date(`${storedDateEnd}T00:00:00Z`).getTime();
  if (Number.isNaN(submittedMs) || Number.isNaN(storedMs)) return false;
  const submittedDayMs = new Date(
    new Date(submittedMs).toISOString().slice(0, 10) + 'T00:00:00Z',
  ).getTime();
  return Math.abs(submittedDayMs - storedMs) <= 24 * 60 * 60 * 1000;
}

export interface SeedDateCandidate {
  report: DriverReport;
  row: Record<string, unknown>;
  wageDelta: number;
  mealAllowanceShifted: boolean;
  correctedDateEnd: string;
  correctedIsMultiDay: boolean;
  correctedNightCount: number;
  correctedDurationHours: number;
  correctedNightPremium: number;
}

/**
 * Rebuilds the timeline from the only values the bug never touched — the
 * journey's own clock times — and reports every field that drifted from it.
 * `isMultiDay: false` is passed deliberately so the stored (suspect) flag
 * cannot vote on its own correctness; the arrival-before-departure rule
 * inside the shared helper is the sole authority here.
 */
export function inspectReport(report: DriverReport): SeedDateCandidate | null {
  const dateStart = String(report.dateStart || report.activityDate || '');
  const timeStart = String(report.timeStart || '');
  const timeEnd = String(report.timeEnd || '');
  if (!dateStart || !timeStart || !timeEnd) return null;

  const truth = calculateEditableDriverJourneyTimeline({
    dateStart,
    timeStart,
    timeEnd,
    isMultiDay: false,
  });
  if (truth.durationHours <= 0) return null;

  const storedDateEnd = String(report.dateEnd || dateStart);
  const storedIsMultiDay = report.isMultiDay === true;
  const storedNightCount = Number(report.nightCount || 0);
  const storedDuration = Number(report.durationHours || 0);

  // A lone stale `isMultiDay` flag is not drift worth rewriting: the audit
  // helper now normalizes it at read time and the stored wage was already
  // correct. Only a recorded end date or night count that the clock times
  // cannot justify means real money is at stake.
  const timelineDrifted =
    storedDateEnd !== truth.dateEnd || storedNightCount !== truth.nightCount;
  if (!timelineDrifted) return null;

  // Only the night premium and the <=2h short-trip meal component inside Upah
  // Bersih move with the timeline. Komponen jarak and komponen waktu ride on
  // distanceKm/routeDurationHours, which this bug never corrupted.
  const nightPremiumDelta =
    calculateNightPremium(truth.nightCount) - calculateNightPremium(storedNightCount);
  const shortTripMealDelta =
    getShortTripMealWageComponent(truth.durationHours) -
    getShortTripMealWageComponent(storedDuration);
  const wageDelta = nightPremiumDelta + shortTripMealDelta;

  // A shifted meal allowance also moves the reimbursement settlement, which an
  // auditor may have hand-adjusted. Those are flagged, never auto-rewritten.
  const vehicleType = String(report.vehicleType || '');
  const ndalemMealMoneyReceived = Number(report.ndalemMealMoneyReceived ?? 0);
  const storedMealAllowance = Number(report.actualMealAllowance || 0);
  const correctedMealAllowance = getMealAllowanceForDuration(
    truth.durationHours,
    vehicleType,
    ndalemMealMoneyReceived,
  );
  const mealAllowanceShifted =
    storedMealAllowance > 0 && correctedMealAllowance !== storedMealAllowance;

  const oldBaseWage = Number(report.baseDriverWage || 0);
  const oldUpah = Number(report.upahBersih || 0);
  const oldEstimate = Number(report.submittedFeeEstimate || 0);

  const row: Record<string, unknown> = {
    id: report.id,
    employeeId: report.employeeId,
    employeeName: report.employeeName,
    status: report.status,
    period: reportPeriod(report),
    activityDate: report.activityDate,
    time: `${timeStart}-${timeEnd}`,
    confidence: looksSeededFromSubmissionDate(report, storedDateEnd) ? 'HIGH' : 'MEDIUM',
    dateEnd: `${storedDateEnd} -> ${truth.dateEnd}`,
    isMultiDay: `${storedIsMultiDay} -> ${truth.isMultiDay}`,
    nightCount: `${storedNightCount} -> ${truth.nightCount}`,
    durationHours: `${storedDuration} -> ${truth.durationHours}`,
    nightPremiumDelta,
    shortTripMealDelta,
    wageDelta,
    baseDriverWage: `${oldBaseWage} -> ${Math.max(0, oldBaseWage + wageDelta)}`,
    upahBersih: oldUpah > 0 ? `${oldUpah} -> ${Math.max(0, oldUpah + wageDelta)}` : oldUpah,
    submittedFeeEstimate:
      oldEstimate > 0 ? `${oldEstimate} -> ${Math.max(0, oldEstimate + wageDelta)}` : oldEstimate,
    actualMealAllowance: mealAllowanceShifted
      ? `${storedMealAllowance} -> ${correctedMealAllowance}`
      : storedMealAllowance,
    mealAllowanceShifted,
  };

  return {
    report,
    row,
    wageDelta,
    mealAllowanceShifted,
    correctedDateEnd: truth.dateEnd,
    correctedIsMultiDay: truth.isMultiDay,
    correctedNightCount: truth.nightCount,
    correctedDurationHours: truth.durationHours,
    correctedNightPremium: calculateNightPremium(truth.nightCount),
  };
}

export async function loadDriverReports(): Promise<DriverReport[]> {
  const activitySnapshot = await adminDb
    .collection('ActivityReports')
    .where('jobCategory', '==', 'SOPIR')
    .get();

  return activitySnapshot.docs
    .map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }) as DriverReport)
    .filter((report) => report.status === 'pending' || report.status === 'approved')
    .filter((report) => Boolean(report.timeStart && report.timeEnd));
}

export async function findLockedReportIds(reports: DriverReport[]): Promise<Set<string>> {
  if (reports.length === 0) return new Set();
  const slipRefs = reports.map((report) =>
    adminDb
      .collection('PayrollSlipStates')
      .doc(`${reportPeriod(report).replace('-', '_')}_${report.employeeId ?? ''}`),
  );
  const slipSnapshots = await adminDb.getAll(...slipRefs);
  return new Set(
    reports
      .filter((_, index) => isImmutablePayrollStatus(slipSnapshots[index]?.data()?.status))
      .map((report) => report.id),
  );
}

async function main() {
  const reports = await loadDriverReports();
  const candidates = reports
    .map((report) => inspectReport(report))
    .filter((candidate): candidate is SeedDateCandidate => candidate !== null);
  const lockedReportIds = await findLockedReportIds(candidates.map((c) => c.report));

  const correctable: Array<Record<string, unknown>> = [];
  const correctionWorkflow: Array<Record<string, unknown>> = [];
  let totalWageDelta = 0;

  for (const candidate of candidates) {
    if (lockedReportIds.has(candidate.report.id)) {
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
    correctable.push(candidate.row);
    totalWageDelta += candidate.wageDelta;
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        mode: 'READ_ONLY',
        scanned: reports.length,
        candidateCount: candidates.length,
        correctableCount: correctable.length,
        highConfidence: correctable.filter((row) => row.confidence === 'HIGH').length,
        mediumConfidence: correctable.filter((row) => row.confidence === 'MEDIUM').length,
        manualReviewCount: correctionWorkflow.length,
        totalWageDeltaRp: totalWageDelta,
        correctableIds: correctable.map((row) => row.id),
        correctable,
        correctionWorkflow,
      },
      null,
      2,
    )}\n`,
  );
}

if (process.argv[1]?.includes('auditDriverJourneySeedDateBug')) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
  });
}
