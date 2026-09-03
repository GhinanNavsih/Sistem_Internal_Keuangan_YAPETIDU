import {
  isSatpamPersonalSpjReportKind,
  payrollPeriodForDutyDate,
} from './domain';

export const SATPAM_FOUND_ITEM_RECOMMENDED_FEE = 5_000;
export const SATPAM_REPRIMAND_RECOMMENDED_FEE = 15_000;

/** Shared by both found-item and reprimand reports, which use the same 1-5 photo evidence rule. */
export function assertSatpamFoundItemPhotoCount(count: number): void {
  if (!Number.isInteger(count) || count < 1 || count > 5) {
    throw new Error('Laporan wajib memiliki 1 sampai 5 foto.');
  }
}

export function satpamFoundItemFeeNeedsAdjustmentReason(
  _fee: number,
): boolean {
  return false;
}

export const PEKARYA_JOB_CATEGORIES = [
  'SATPAM',
  'SOPIR',
  'PEKARYA',
  'TEKNISI',
  'KEBERSIHAN',
  'KEBERSIHAN_PONTI',
  'PONTI',
] as const;

// UI/API sentinel for the combined attendance view. It is deliberately not a
// job category and must never be written to an employee or payroll record.
export const ALL_BLUE_COLLAR_CATEGORY = 'ALL';

export type PekaryaJobCategory = (typeof PEKARYA_JOB_CATEGORIES)[number];

export const PEKARYA_ACTIVITY_TYPES = [
  'Piket',
  'Standby',
  "Ro'an",
  'Lainnya',
  'Buang Sampah',
] as const;

export type PekaryaActivityType = (typeof PEKARYA_ACTIVITY_TYPES)[number];

export interface PekaryaActivityFinancialLike {
  id?: string;
  employeeId?: string;
  jobCategory?: string;
  reportKind?: string;
  sourceOccurrenceId?: string;
  sourceType?: string;
  assignmentKind?: string;
  shiftName?: string;
  shiftType?: string;
  postId?: string;
  postName?: string;
  ketuaShiftId?: string;
  activityDate?: string;
  period?: string;
  payrollPeriod?: string;
  status?: string;
  fee?: number;
  upahBersih?: number;
  sourceLedgerEntryId?: string;
}

export interface KegiatanSpjFinancialLike {
  id?: string;
  period?: string;
  jobCategory?: string;
  status?: string;
  eventWorkers?: Record<string, { payGiven?: number }>;
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isPekaryaJobCategory(value: unknown): value is PekaryaJobCategory {
  return (
    typeof value === 'string' &&
    (PEKARYA_JOB_CATEGORIES as readonly string[]).includes(value)
  );
}

export function assertPekaryaActivityType(
  value: unknown,
): asserts value is PekaryaActivityType {
  if (
    typeof value !== 'string' ||
    !(PEKARYA_ACTIVITY_TYPES as readonly string[]).includes(value)
  ) {
    throw new Error('Jenis kegiatan tidak valid.');
  }
}

export function activityDurationMinutes(
  timeStart: string,
  timeEnd: string,
  allowCrossMidnight = true,
): number {
  const startMatch = TIME_RE.exec(timeStart);
  const endMatch = TIME_RE.exec(timeEnd);
  if (!startMatch || !endMatch) {
    throw new Error('Waktu kegiatan wajib menggunakan format HH:MM.');
  }
  const start = Number(startMatch[1]) * 60 + Number(startMatch[2]);
  const end = Number(endMatch[1]) * 60 + Number(endMatch[2]);
  let duration = end - start;
  if (duration < 0 && allowCrossMidnight) duration += 24 * 60;
  if (duration <= 0 || duration > 16 * 60) {
    throw new Error('Durasi kegiatan harus lebih dari 0 dan maksimal 16 jam.');
  }
  return duration;
}

export const BUANG_SAMPAH_FLAT_FEE = 5_000;

/**
 * Time-based SPJ rates, held as rupiah per hour rather than per minute: the
 * per-minute figures (Rp83,33… and Rp116,66…) do not terminate, so storing the
 * hourly figure and dividing at the end is what keeps a whole hour landing on a
 * round Rp5.000 / Rp7.000 instead of a cent above or below it.
 */
export const PEKARYA_SPJ_HOURLY_RATES = {
  piketStandby: 5_000,
  lainnya: 7_000,
} as const;

/** Anything shorter than an hour is still paid as a full hour. */
export const PEKARYA_SPJ_MINIMUM_BILLABLE_MINUTES = 60;

/**
 * Superseded 30-minute-block rates. Retained rather than deleted because an
 * activity dated before the cutoff must still price at what it was submitted
 * under, including one still sitting unapproved in the Satker's queue.
 */
export const PEKARYA_SPJ_LEGACY_HALF_HOUR_RATES = {
  piketStandby: 2_000,
  lainnya: 2_500,
} as const;

/**
 * First activity date priced per minute. Activities before it keep the legacy
 * half-hour blocks, so raising the rate never reprices existing SPJ.
 */
export const PEKARYA_SPJ_PER_MINUTE_RATE_START_DATE = '2026-09-04';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * An unparseable or absent date falls back to the legacy regime on purpose: the
 * only records without a usable activityDate are old ones, and under-quoting a
 * new submission is recoverable at review while repricing a settled one is not.
 */
export function usesPerMinuteSpjRate(activityDate?: string): boolean {
  return (
    typeof activityDate === 'string' &&
    ISO_DATE_RE.test(activityDate) &&
    activityDate >= PEKARYA_SPJ_PER_MINUTE_RATE_START_DATE
  );
}

/**
 * Resolves the rate bracket for an activity, falling back to the free-text
 * activity name when no explicit type was recorded (older submissions).
 */
export function resolvePekaryaActivityRateType(
  activityType?: string,
  activityName?: string,
): PekaryaActivityType {
  if (activityType === 'Buang Sampah' || activityName === 'Buang Sampah') {
    return 'Buang Sampah';
  }
  if (
    activityType &&
    (PEKARYA_ACTIVITY_TYPES as readonly string[]).includes(activityType)
  ) {
    return activityType as PekaryaActivityType;
  }

  const nameLower = (activityName ?? '').toLowerCase();
  if (nameLower === 'piket' || nameLower.startsWith('piket ')) return 'Piket';
  if (nameLower === 'standby' || nameLower.startsWith('standby ')) {
    return 'Standby';
  }
  if (
    nameLower === "ro'an" ||
    nameLower === 'roan' ||
    nameLower.startsWith("ro'an ") ||
    nameLower.startsWith('roan ')
  ) {
    return "Ro'an";
  }
  return 'Lainnya';
}

export function pekaryaSpjHourlyRate(activityRateType: PekaryaActivityType): number {
  return activityRateType === 'Piket' || activityRateType === 'Standby'
    ? PEKARYA_SPJ_HOURLY_RATES.piketStandby
    : PEKARYA_SPJ_HOURLY_RATES.lainnya;
}

export function pekaryaSpjLegacyHalfHourRate(
  activityRateType: PekaryaActivityType,
): number {
  return activityRateType === 'Piket' || activityRateType === 'Standby'
    ? PEKARYA_SPJ_LEGACY_HALF_HOUR_RATES.piketStandby
    : PEKARYA_SPJ_LEGACY_HALF_HOUR_RATES.lainnya;
}

/** Applies the one-hour floor. Only the per-minute regime has one. */
export function pekaryaSpjBillableMinutes(durationMinutes: number): number {
  return Math.max(durationMinutes, PEKARYA_SPJ_MINIMUM_BILLABLE_MINUTES);
}

export interface PekaryaSpjRateBasis {
  rateType: PekaryaActivityType;
  /** true = per-minute regime, false = legacy 30-minute blocks. */
  perMinute: boolean;
  /** Rupiah per hour when perMinute, per 30-minute block otherwise. */
  rate: number;
  /** Minutes actually billed (per-minute regime only). */
  billableMinutes: number;
  /** Whether the one-hour floor lifted this submission. */
  minimumApplied: boolean;
  amount: number;
}

/**
 * Resolves which rate regime an activity falls under and what it pays, so the
 * employee card, the Satker review screen and the API cannot drift apart.
 *
 * Per-minute pay is rounded up to the whole rupiah. Integer arithmetic
 * (multiply before dividing, then a ceiling division) keeps an exact hour off
 * floating-point drift, which a literal Rp83,333333/minute constant would
 * otherwise push a rupiah past the round figure.
 */
export function pekaryaSpjRateBasis(
  durationMinutes: number,
  activityType?: string,
  activityName?: string,
  activityDate?: string,
): PekaryaSpjRateBasis {
  const rateType = resolvePekaryaActivityRateType(activityType, activityName);
  if (rateType === 'Buang Sampah') {
    return {
      rateType,
      perMinute: false,
      rate: BUANG_SAMPAH_FLAT_FEE,
      billableMinutes: 0,
      minimumApplied: false,
      amount: BUANG_SAMPAH_FLAT_FEE,
    };
  }

  if (!usesPerMinuteSpjRate(activityDate)) {
    const rate = pekaryaSpjLegacyHalfHourRate(rateType);
    return {
      rateType,
      perMinute: false,
      rate,
      billableMinutes: durationMinutes,
      minimumApplied: false,
      amount: Math.round(durationMinutes / 30) * rate,
    };
  }

  const rate = pekaryaSpjHourlyRate(rateType);
  const billableMinutes = pekaryaSpjBillableMinutes(durationMinutes);
  return {
    rateType,
    perMinute: true,
    rate,
    billableMinutes,
    minimumApplied: billableMinutes > durationMinutes,
    amount: Math.floor((billableMinutes * rate + 59) / 60),
  };
}

/**
 * Calculates the employee-submitted estimate for a non-driver activity.
 *
 * This is only an estimate; the approved amount is still entered by the
 * Kepala SatKer during review. Keeping the calculation here makes the API
 * and employee activity card use the same rate policy.
 */
export function calculateActivitySpjEstimate(
  timeStart: string,
  timeEnd: string,
  activityType?: string,
  activityName?: string,
  activityDate?: string,
): number {
  if (
    resolvePekaryaActivityRateType(activityType, activityName) === 'Buang Sampah'
  ) {
    return BUANG_SAMPAH_FLAT_FEE;
  }

  return pekaryaSpjRateBasis(
    activityDurationMinutes(timeStart, timeEnd),
    activityType,
    activityName,
    activityDate,
  ).amount;
}

/**
 * Historical compatibility policy:
 * - through June 2026: 26th through 25th,
 * - July 2026 transition: 26 June through 31 July,
 * - August 2026 onward: calendar month.
 *
 * Delegates to the base-module rule so Satpam and the other Pekarya categories
 * can never bucket the same duty date into two different payroll periods.
 */
export const pekaryaPayrollPeriodForDate = payrollPeriodForDutyDate;

export function pekaryaPayrollWindow(period: string): {
  startsOn: string;
  endsOn: string;
  sourceMonths: string[];
} {
  if (!/^\d{4}-\d{2}$/.test(period)) {
    throw new Error('Periode wajib menggunakan format YYYY-MM.');
  }
  if (period === '2026-07') {
    return {
      startsOn: '2026-06-26',
      endsOn: '2026-07-31',
      sourceMonths: ['2026-06', '2026-07'],
    };
  }
  if (period >= '2026-08') {
    const [year, month] = period.split('-').map(Number);
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return {
      startsOn: `${period}-01`,
      endsOn: `${period}-${String(lastDay).padStart(2, '0')}`,
      sourceMonths: [period],
    };
  }

  const [year, month] = period.split('-').map(Number);
  const previous = new Date(Date.UTC(year, month - 2, 1));
  const previousMonth = `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, '0')}`;
  return {
    startsOn: `${previousMonth}-26`,
    endsOn: `${period}-25`,
    sourceMonths: [previousMonth, period],
  };
}

/**
 * Sopir and Satpam only started reporting activities in this system after the
 * July 2026 transition period (26 June – 31 July 2026). For that period their
 * SPJ was still accumulated on paper, so the Kepala Satker types the total
 * into the Rekap Uraian and that number — not the activity sum — is
 * authoritative.
 */
export const MANUAL_SPJ_ENTRY_PERIOD = '2026-07';
export const MANUAL_SPJ_ENTRY_CATEGORIES: readonly string[] = [
  'SOPIR',
  'SATPAM',
];

export function allowsManualSpjEntry(
  jobCategory: string,
  period: string,
): boolean {
  return (
    period === MANUAL_SPJ_ENTRY_PERIOD &&
    MANUAL_SPJ_ENTRY_CATEGORIES.includes(jobCategory)
  );
}

/**
 * Two KEBERSIHAN employees were still paid from paper records during the
 * July 2026 transition, even though their current master-data category is
 * KEBERSIHAN. Their sealed Rekap Uraian SPJ values are therefore authoritative
 * for that one payroll period.
 */
export const HISTORICAL_PAPER_SPJ_EMPLOYEE_IDS = new Set([
  'BC_053',
  'BC_054',
]);

export function allowsHistoricalPaperSpjEntry(
  jobCategory: string,
  period: string,
  employeeId: string,
): boolean {
  return (
    period === MANUAL_SPJ_ENTRY_PERIOD &&
    jobCategory === 'KEBERSIHAN' &&
    HISTORICAL_PAPER_SPJ_EMPLOYEE_IDS.has(employeeId)
  );
}

export function approvedActivitySpjAmount(
  report: PekaryaActivityFinancialLike,
): number {
  if (report.status !== 'approved') return 0;
  if (
    report.jobCategory === 'SATPAM' &&
    !isSatpamPersonalSpjReportKind(report.reportKind)
  ) {
    // Explicit classification is authoritative for all new records. The
    // sourceOccurrenceId fallback keeps historical shift rows out of SPJ
    // during the reportKind backfill window.
    if (
      report.reportKind ||
      report.sourceOccurrenceId ||
      report.sourceType === 'satpam_shift' ||
      report.assignmentKind ||
      report.shiftName ||
      report.shiftType ||
      report.postId ||
      report.postName ||
      report.ketuaShiftId
    ) {
      return 0;
    }
  }
  // Driver operational reimbursements are not employee wages. The SPJ earning
  // is the reviewed net wage, with fee retained as a legacy fallback.
  const raw =
    report.jobCategory === 'SOPIR'
      ? report.upahBersih ?? report.fee ?? 0
      : report.fee ?? 0;
  return Number.isSafeInteger(raw) && raw > 0 ? raw : 0;
}

export function activityBelongsToPayrollPeriod(
  report: PekaryaActivityFinancialLike,
  period: string,
): boolean {
  if (report.payrollPeriod) return report.payrollPeriod === period;
  if (!report.activityDate) return report.period === period;
  const window = pekaryaPayrollWindow(period);
  return report.activityDate >= window.startsOn && report.activityDate <= window.endsOn;
}

export function sumApprovedActivitySpj(
  reports: readonly PekaryaActivityFinancialLike[],
  employeeId: string,
  jobCategory: string,
  period: string,
): number {
  const seen = new Set<string>();
  let total = 0;
  for (const report of reports) {
    if (
      report.employeeId !== employeeId ||
      report.jobCategory !== jobCategory ||
      !activityBelongsToPayrollPeriod(report, period)
    ) {
      continue;
    }
    const identity =
      report.sourceLedgerEntryId ||
      report.id ||
      [
        report.employeeId,
        report.activityDate,
        report.jobCategory,
        report.fee,
        report.upahBersih,
      ].join('|');
    if (seen.has(identity)) continue;
    seen.add(identity);
    total += approvedActivitySpjAmount(report);
  }
  return total;
}

export function sumApprovedEventSpj(
  events: readonly KegiatanSpjFinancialLike[],
  employeeId: string,
  jobCategory: string,
  period: string,
): number {
  const seen = new Set<string>();
  let total = 0;
  for (const event of events) {
    if (event.period !== period) continue;
    if (event.status && event.status !== 'approved') continue;
    if (event.jobCategory && event.jobCategory !== jobCategory) continue;
    const identity = event.id || JSON.stringify(event);
    if (seen.has(identity)) continue;
    seen.add(identity);
    const amount = event.eventWorkers?.[employeeId]?.payGiven ?? 0;
    if (Number.isSafeInteger(amount) && amount > 0) total += amount;
  }
  return total;
}

/**
 * Stable idempotency key for an employee activity. Keeping the date, both
 * timestamps, and normalized activity name in the key allows multiple trips
 * on one day while preventing an accidental duplicate of the same report.
 */
export function buildPekaryaActivityIdentity(
  employeeId: string,
  activityDate: string,
  timeStart: string,
  timeEnd: string | undefined,
  activityName: string,
): string {
  const safeEmployeeId = employeeId
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .slice(0, 72);
  return [
    safeEmployeeId,
    activityDate.replaceAll('-', ''),
    timeStart.replace(':', ''),
    (timeEnd || 'none').replace(':', ''),
    normalizeActivityIdentityPart(activityName),
  ].join('__');
}

export function normalizeActivityIdentityPart(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('id-ID')
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}
