import { normalizeAttendanceTime } from './attendance';
import {
  getRegularSatpamPayType,
  hasSatpamShiftEnded,
  type SatpamShiftName,
} from './domain';
import { defaultSatpamScanTimes } from './satpamAttendance';
import { satpamOfficialLeavePayment } from './satpamOfficialLeave';

/**
 * Day-by-day Satpam attendance for the "Semua Pekarya" review cards. Satpam
 * pay comes from approved shift reports and approved scheduled leave, never
 * from the scans themselves, so a row joins what was scheduled, what was
 * reported, what was approved and what the fingerprint machine recorded.
 * Pure, so the API and the tests share one definition.
 */

export type SatpamAttendanceDetailStatus =
  | 'leave'
  | 'complete'
  | 'late'
  | 'partial'
  | 'no_scan'
  | 'pending'
  | 'declined'
  | 'covered'
  | 'absent'
  | 'upcoming'
  | 'scan_only';

export interface SatpamAttendanceDetailRow {
  key: string;
  date: string;
  shiftName: SatpamShiftName | null;
  /** Pay type of the duty: what was reported or approved, else what is expected. */
  payType: string | null;
  expectedScanIn: string | null;
  expectedScanOut: string | null;
  scanIn: string | null;
  scanOut: string | null;
  amount: number;
  status: SatpamAttendanceDetailStatus;
  /** Name of the guard who covered this duty, when the duty was handed over. */
  coveredByName: string | null;
  /** A leave or scan request on this date still waiting for a decision. */
  pendingAbsenceId: string | null;
  /**
   * The shift report to open when checking this row: the report's shift (an
   * occurrence) and the guard whose card to highlight there. Null when no
   * report for this duty exists yet, so there is nothing to check.
   */
  review: { occurrenceId: string; employeeId: string } | null;
}

export interface SatpamAttendanceDetailEmployee {
  employeeId: string;
  name: string;
  nipy: string;
  category: 'SATPAM';
  harianCount: number;
  jumatLiburCount: number;
  lemburCount: number;
  harianAmount: number;
  jumatLiburAmount: number;
  lemburAmount: number;
  totalAmount: number;
  paidDays: number;
  /** Paid duties whose scans are missing or one-sided. */
  incompleteDays: number;
  days: SatpamAttendanceDetailRow[];
}

export interface SatpamDetailPlanDay {
  dutyDate: string;
  shiftName: string;
  /** The duty's shift report occurrence, only when one has been submitted. */
  occurrenceId?: string | null;
}

export interface SatpamDetailReport {
  id: string;
  employeeId: string;
  dutyDate: string;
  shiftName: string | null;
  shiftType: string | null;
  status: string;
  fee: number;
  coveredEmployeeId: string | null;
  sourceOccurrenceId?: string | null;
}

export interface SatpamDetailAbsence {
  id: string;
  dutyDate: string;
  shiftName: string | null;
  status: string;
  reportType: 'scan' | 'izin_resmi';
  /** `isPayableSatpamOfficialLeave` for this request, decided by the caller. */
  payable: boolean;
  approvedPayType: string | null;
  approvedAmount: number;
}

export interface SatpamDetailScanDay {
  scanIn: string | null;
  scanOut: string | null;
}

export interface BuildSatpamAttendanceDetailInput {
  employee: { employeeId: string; name: string; nipy: string };
  planDays: readonly SatpamDetailPlanDay[];
  /** The employee's own shift reports, whatever their status. */
  reports: readonly SatpamDetailReport[];
  /** Other guards' reports that name this employee as the one covered. */
  coverReports: readonly SatpamDetailReport[];
  absences: readonly SatpamDetailAbsence[];
  scanDays: ReadonlyMap<string, SatpamDetailScanDay>;
  premiumDates: ReadonlySet<string>;
  /** Closed period or sealed slip: a leave only counts at its recorded amount. */
  preserveRecordedPayment: boolean;
  employeeNames: ReadonlyMap<string, string>;
  now: Date;
}

const SHIFT_ORDER: Record<string, number> = { Pagi: 0, Sore: 1, Malam: 2 };
const EXTRA_PAY_TYPES = new Set(['Lembur Sendiri', 'Lembur Cover']);
// Mirrors the registrations the rest of the Satpam code treats as no longer
// standing: they never pay, so the row reads as declined.
const TERMINAL_REPORT_STATUSES = new Set([
  'declined',
  'rejected',
  'withdrawn',
  'voided',
  'cancelled',
  'superseded',
]);

function asShiftName(value: unknown): SatpamShiftName | null {
  return value === 'Pagi' || value === 'Sore' || value === 'Malam' ? value : null;
}

function isExtraReport(report: SatpamDetailReport): boolean {
  return EXTRA_PAY_TYPES.has(String(report.shiftType || ''));
}

function reportRank(report: SatpamDetailReport): number {
  if (report.status === 'approved') return 0;
  return TERMINAL_REPORT_STATUSES.has(report.status) ? 2 : 1;
}

function timeToSeconds(value: string | null): number | null {
  const normalized = normalizeAttendanceTime(value);
  if (!normalized) return null;
  const [hours, minutes, seconds] = normalized.split(':').map(Number);
  return hours * 3_600 + minutes * 60 + (seconds || 0);
}

/**
 * How the scans read against the shift. A complete pair is "late" when the
 * scan-in is even one second past the shift's start. This only changes the
 * label: pay follows the approved report or leave, never the scan.
 */
function scanStatus(
  scan: SatpamDetailScanDay | undefined,
  expectedScanIn: string | null,
): 'complete' | 'late' | 'partial' | 'no_scan' {
  if (!scan?.scanIn && !scan?.scanOut) return 'no_scan';
  if (!scan.scanIn || !scan.scanOut) return 'partial';
  const actual = timeToSeconds(scan.scanIn);
  const expected = timeToSeconds(expectedScanIn);
  return actual !== null && expected !== null && actual > expected
    ? 'late'
    : 'complete';
}

function expectedTimes(date: string, shiftName: SatpamShiftName | null) {
  if (!shiftName) return { expectedScanIn: null, expectedScanOut: null };
  const { scanIn, scanOut } = defaultSatpamScanTimes(date, shiftName);
  return { expectedScanIn: scanIn, expectedScanOut: scanOut };
}

function leaveAmount(
  absence: SatpamDetailAbsence,
  date: string,
  premiumDates: ReadonlySet<string>,
  preserveRecordedPayment: boolean,
) {
  const payment = satpamOfficialLeavePayment(date, premiumDates);
  const recorded = Number(absence.approvedAmount || 0);
  if (preserveRecordedPayment) {
    return { payType: absence.approvedPayType || payment.payType, amount: recorded };
  }
  return {
    payType: payment.payType,
    amount: payment.amount,
  };
}

export function buildSatpamAttendanceDetail(
  input: BuildSatpamAttendanceDetailInput,
): SatpamAttendanceDetailEmployee {
  const { employee, premiumDates, scanDays, now } = input;
  const occurrenceReview = (occurrenceId: string | null | undefined, guardId: string) =>
    occurrenceId ? { occurrenceId, employeeId: guardId } : null;
  const ownReview = (occurrenceId: string | null | undefined) =>
    occurrenceReview(occurrenceId, employee.employeeId);
  const planByDate = new Map(input.planDays.map((day) => [day.dutyDate, day]));
  const regularReportsByDate = new Map<string, SatpamDetailReport[]>();
  const extraReports: SatpamDetailReport[] = [];
  for (const report of input.reports) {
    if (!report.dutyDate) continue;
    if (isExtraReport(report)) {
      extraReports.push(report);
      continue;
    }
    const list = regularReportsByDate.get(report.dutyDate) || [];
    list.push(report);
    regularReportsByDate.set(report.dutyDate, list);
  }
  const leaveByDate = new Map<string, SatpamDetailAbsence>();
  const pendingAbsenceByDate = new Map<string, string>();
  for (const absence of input.absences) {
    if (absence.payable && absence.reportType === 'izin_resmi') {
      leaveByDate.set(absence.dutyDate, absence);
    }
    if (absence.status === 'pending' && !pendingAbsenceByDate.has(absence.dutyDate)) {
      pendingAbsenceByDate.set(absence.dutyDate, absence.id);
    }
  }
  const coverByDate = new Map<string, SatpamDetailReport>();
  for (const cover of input.coverReports) {
    if (TERMINAL_REPORT_STATUSES.has(cover.status)) continue;
    coverByDate.set(cover.dutyDate, cover);
  }

  const rows: SatpamAttendanceDetailRow[] = [];
  const scanClaimed = new Set<string>();
  const extraDates = new Set(extraReports.map((report) => report.dutyDate));
  const dates = new Set<string>([
    ...planByDate.keys(),
    ...regularReportsByDate.keys(),
    ...leaveByDate.keys(),
    ...scanDays.keys(),
  ]);

  for (const date of Array.from(dates).sort()) {
    const plan = planByDate.get(date);
    const leave = leaveByDate.get(date);
    const report = [...(regularReportsByDate.get(date) || [])].sort(
      (left, right) => reportRank(left) - reportRank(right),
    )[0];
    const scan = scanDays.get(date);
    const hasScan = Boolean(scan?.scanIn || scan?.scanOut);
    const shiftName =
      asShiftName(report?.shiftName) ||
      asShiftName(plan?.shiftName) ||
      asShiftName(leave?.shiftName);
    const regularPayType = shiftName
      ? getRegularSatpamPayType(date, new Set(premiumDates))
      : null;
    const base = {
      key: `${employee.employeeId}:${date}`,
      date,
      shiftName,
      ...expectedTimes(date, shiftName),
      scanIn: scan?.scanIn ?? null,
      scanOut: scan?.scanOut ?? null,
      coveredByName: null as string | null,
      pendingAbsenceId: pendingAbsenceByDate.get(date) ?? null,
      review: ownReview(report?.sourceOccurrenceId || plan?.occurrenceId),
    };
    // Nothing scheduled, reported or approved: a bare scan is still shown so a
    // reviewer can see attendance that no report accounts for.
    if (!plan && !report && !leave) {
      // An extra shift reported for the date already owns its scans.
      if (!hasScan || extraDates.has(date)) continue;
      scanClaimed.add(date);
      rows.push({ ...base, payType: null, amount: 0, status: 'scan_only' });
      continue;
    }
    scanClaimed.add(date);
    if (leave) {
      // Approved scheduled leave is the one payment for the duty, even when a
      // work report also exists for the same date.
      const paid = leaveAmount(leave, date, premiumDates, input.preserveRecordedPayment);
      rows.push({ ...base, payType: paid.payType, amount: paid.amount, status: 'leave' });
    } else if (report?.status === 'approved') {
      rows.push({
        ...base,
        payType: report.shiftType || regularPayType,
        amount: Number(report.fee || 0),
        status: scanStatus(scan, base.expectedScanIn),
      });
    } else if (report && TERMINAL_REPORT_STATUSES.has(report.status)) {
      rows.push({ ...base, payType: report.shiftType || regularPayType, amount: 0, status: 'declined' });
    } else if (report) {
      rows.push({ ...base, payType: report.shiftType || regularPayType, amount: 0, status: 'pending' });
    } else {
      const cover = coverByDate.get(date);
      const duty = base.shiftName;
      const status: SatpamAttendanceDetailStatus = cover
        ? 'covered'
        : hasScan
          ? 'scan_only'
          : duty && !hasSatpamShiftEnded(date, duty, now)
            ? 'upcoming'
            : 'absent';
      rows.push({
        ...base,
        payType: regularPayType,
        amount: 0,
        status,
        coveredByName: cover
          ? input.employeeNames.get(cover.employeeId) || cover.employeeId
          : null,
        // A handed-over duty is checked on the guard who covered it.
        review: cover
          ? occurrenceReview(
              cover.sourceOccurrenceId || plan?.occurrenceId,
              cover.employeeId,
            )
          : base.review,
      });
    }
  }

  for (const report of extraReports) {
    const shiftName = asShiftName(report.shiftName);
    const approved = report.status === 'approved';
    // An extra shift shares the date's scans only when no regular duty
    // already shows them.
    const scan = scanClaimed.has(report.dutyDate)
      ? undefined
      : scanDays.get(report.dutyDate);
    rows.push({
      key: `${employee.employeeId}:${report.dutyDate}:${report.id}`,
      date: report.dutyDate,
      shiftName,
      payType: report.shiftType,
      ...expectedTimes(report.dutyDate, shiftName),
      scanIn: scan?.scanIn ?? null,
      scanOut: scan?.scanOut ?? null,
      amount: approved ? Number(report.fee || 0) : 0,
      status: approved
        ? scanStatus(
            scan ?? scanDays.get(report.dutyDate),
            expectedTimes(report.dutyDate, shiftName).expectedScanIn,
          )
        : TERMINAL_REPORT_STATUSES.has(report.status)
          ? 'declined'
          : 'pending',
      coveredByName: null,
      pendingAbsenceId: null,
      review: ownReview(report.sourceOccurrenceId),
    });
  }

  rows.sort(
    (left, right) =>
      left.date.localeCompare(right.date) ||
      (SHIFT_ORDER[left.shiftName || ''] ?? 9) -
        (SHIFT_ORDER[right.shiftName || ''] ?? 9) ||
      left.key.localeCompare(right.key),
  );

  const summary = {
    harianCount: 0,
    jumatLiburCount: 0,
    lemburCount: 0,
    harianAmount: 0,
    jumatLiburAmount: 0,
    lemburAmount: 0,
    paidDays: 0,
    incompleteDays: 0,
  };
  for (const row of rows) {
    const paid = row.status === 'leave' || row.amount > 0;
    if (row.status === 'partial' || row.status === 'no_scan') {
      summary.incompleteDays += 1;
    }
    if (!paid || row.status === 'scan_only') continue;
    summary.paidDays += 1;
    if (row.payType === 'Jumat & Libur') {
      summary.jumatLiburCount += 1;
      summary.jumatLiburAmount += row.amount;
    } else if (EXTRA_PAY_TYPES.has(String(row.payType))) {
      summary.lemburCount += 1;
      summary.lemburAmount += row.amount;
    } else {
      summary.harianCount += 1;
      summary.harianAmount += row.amount;
    }
  }
  return {
    employeeId: employee.employeeId,
    name: employee.name,
    nipy: employee.nipy,
    category: 'SATPAM',
    ...summary,
    totalAmount:
      summary.harianAmount + summary.jumatLiburAmount + summary.lemburAmount,
    days: rows,
  };
}
