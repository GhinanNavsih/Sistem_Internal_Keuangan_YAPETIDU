import { pekaryaPayrollWindow } from './pekaryaSpj';

export const ATTENDANCE_PAYROLL_START_PERIOD = '2026-08';

/**
 * Blue-collar attendance is paid by measured time on site rather than by a flat
 * daily figure. The rate reproduces the previous flat amounts exactly at the
 * durations they stood for — 6.5 hours pays Rp 12.500 and 13 hours pays
 * Rp 25.000 — so a normal day is unchanged while longer and shorter days are
 * now paid for what they actually were.
 *
 * Satpam is not paid from this rate at all: their wage comes from the Ketua
 * Shift duty reports, and their scans are only ever used as verification.
 */
export const PEKARYA_ATTENDANCE_RATE_PER_SECOND = 0.53418803418;

/** Friday and holiday work is paid at the premium rate for the same seconds. */
export const PEKARYA_ATTENDANCE_PREMIUM_RATE_PER_SECOND = 1.06837606838;

/**
 * The official work window. Time scanned before 07:30 or after 14:00 is not
 * counted, so the most a single day can pay is the 6.5 hours between them.
 * Loyalis presence measures against this same window.
 */
export const ATTENDANCE_WORK_WINDOW_START_MINUTES = 7 * 60 + 30;
export const ATTENDANCE_WORK_WINDOW_END_MINUTES = 14 * 60;

/**
 * A forgotten scan is filled in 150 minutes off the one that was recorded,
 * rather than treated as zero time worked. Loyalis presence has used this
 * convention from the start; Pekarya attendance now shares it.
 */
export const ATTENDANCE_SINGLE_SCAN_AUTO_FILL_MINUTES = 150;

export type AttendanceIdentifierSource = 'NIPY' | 'PIN';

export type AttendanceIssueCode =
  | 'IDENTIFIER_MISSING'
  | 'IDENTIFIER_CONFLICT'
  | 'DATE_INVALID'
  | 'TIME_INVALID'
  | 'OUTSIDE_PERIOD'
  | 'DUPLICATE_EMPLOYEE_DAY'
  | 'INCOMPLETE_PUNCH'
  | 'MASUK_WITHOUT_SCAN'
  | 'SCAN_WITHOUT_MASUK';

export interface AttendanceNormalizedRow {
  rowNumber: number;
  nipy: string;
  identifierSource: AttendanceIdentifierSource | null;
  sourcePin: string | null;
  sourceNipy: string | null;
  name: string;
  department: string;
  date: string;
  workStatus: string;
  scanIn: string | null;
  scanOut: string | null;
  issues: AttendanceIssueCode[];
}

export interface AttendanceDayCorrection {
  present?: boolean;
  workStatus?: string;
  scanIn?: string | null;
  scanOut?: string | null;
}

export interface EffectiveAttendanceDay {
  nipy: string;
  date: string;
  name: string;
  department: string;
  workStatus: string;
  scanIn: string | null;
  scanOut: string | null;
  present: boolean;
  completePunch: boolean;
  corrected: boolean;
  sourceRows: number[];
  issues: AttendanceIssueCode[];
}

export interface PekaryaAttendanceSummary {
  nipy: string;
  harianCount: number;
  jumatLiburCount: number;
  harianAmount: number;
  jumatLiburAmount: number;
  workedSeconds: number;
  totalAmount: number;
  payableDays: number;
  incompletePunchCount: number;
  correctedDayCount: number;
  days: Array<
    EffectiveAttendanceDay & {
      payType: 'Harian' | 'Jumat & Libur' | null;
      amount: number;
      scanInAuto: boolean;
      scanOutAuto: boolean;
    }
  >;
}

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

export function normalizeNipy(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase();
}

export type AttendanceRoutingSystem = 'pekarya' | 'loyalis';

/**
 * Departments the source scanner exports for blue-collar workers. Their rows
 * belong to the Pekarya review page; every other department (faculty codes,
 * bureaus, and blanks) belongs to the Loyalis page.
 */
const PEKARYA_ROUTING_DEPARTMENTS = new Set([
  'TEKNISI',
  'CS',
  'SECURITY',
  'DRIVER',
]);

/**
 * Decides which review page owns an imported attendance row.
 *
 * The scanner's NIPY column is unreliable — every TEKNISI/CS/SECURITY worker
 * carries the machine's own short PIN instead of a payroll NIPY — so routing
 * must not depend on a successful employee match. The department string is
 * present on every row and is stable, which lets a row reach the right
 * reviewer even when nobody can be identified from its NIPY.
 */
export function classifyAttendanceDepartment(
  department: unknown,
): AttendanceRoutingSystem {
  const normalized = String(department ?? '')
    .trim()
    .toUpperCase();
  return PEKARYA_ROUTING_DEPARTMENTS.has(normalized) ? 'pekarya' : 'loyalis';
}

export function resolveEmployeeAttendanceNipy(
  data: Record<string, unknown>,
): string {
  const dedicatedNipy = normalizeNipy(data.nipy);
  if (dedicatedNipy) return dedicatedNipy;
  const personalInfo =
    data.personal_info && typeof data.personal_info === 'object'
      ? (data.personal_info as Record<string, unknown>)
      : {};
  return normalizeNipy(personalInfo.employee_id_niy);
}

function validDateOnly(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return '';
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function normalizeAttendanceDate(value: unknown): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return validDateOnly(
      value.getUTCFullYear(),
      value.getUTCMonth() + 1,
      value.getUTCDate(),
    );
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const excelEpoch = Date.UTC(1899, 11, 30);
    const date = new Date(excelEpoch + Math.floor(value) * 86_400_000);
    return validDateOnly(
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      date.getUTCDate(),
    );
  }

  const source = String(value ?? '').trim();
  if (!source) return '';

  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(source);
  if (match) {
    return validDateOnly(Number(match[1]), Number(match[2]), Number(match[3]));
  }

  match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?:\D|$)/.exec(source);
  if (match) {
    const rawYear = Number(match[3]);
    const year = rawYear < 100 ? (rawYear < 50 ? 2000 + rawYear : 1900 + rawYear) : rawYear;
    return validDateOnly(year, Number(match[2]), Number(match[1]));
  }

  return '';
}

export function normalizeAttendanceTime(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;

  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return [
      value.getUTCHours(),
      value.getUTCMinutes(),
      value.getUTCSeconds(),
    ].map((part) => String(part).padStart(2, '0')).join(':');
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const secondsInDay = 86_400;
    const seconds = Math.round(((value % 1) + 1) % 1 * secondsInDay) % secondsInDay;
    const hours = Math.floor(seconds / 3_600);
    const minutes = Math.floor((seconds % 3_600) / 60);
    const remainingSeconds = seconds % 60;
    return [hours, minutes, remainingSeconds]
      .map((part) => String(part).padStart(2, '0'))
      .join(':');
  }

  const source = String(value).trim();
  const match = TIME_RE.exec(source);
  if (!match) return null;
  return `${match[1]}:${match[2]}:${match[3] || '00'}`;
}

function normalizedHeaderMap(row: Record<string, unknown>): Map<string, unknown> {
  return new Map(
    Object.entries(row).map(([key, value]) => [key.trim().toUpperCase(), value]),
  );
}

export function normalizeAttendanceWorkbookRow(
  row: Record<string, unknown>,
  rowNumber: number,
  period?: string,
): AttendanceNormalizedRow {
  const fields = normalizedHeaderMap(row);
  const sourceNipy = normalizeNipy(fields.get('NIPY')) || null;
  const sourcePin = normalizeNipy(fields.get('PIN')) || null;
  const issues: AttendanceIssueCode[] = [];
  if (sourceNipy && sourcePin && sourceNipy !== sourcePin) {
    issues.push('IDENTIFIER_CONFLICT');
  }
  const nipy = sourceNipy || sourcePin || '';
  if (!nipy) issues.push('IDENTIFIER_MISSING');

  const date = normalizeAttendanceDate(fields.get('TANGGAL'));
  if (!date) issues.push('DATE_INVALID');
  if (date && period) {
    const window = pekaryaPayrollWindow(period);
    if (date < window.startsOn || date > window.endsOn) {
      issues.push('OUTSIDE_PERIOD');
    }
  }

  const rawScanIn = fields.get('SCAN MASUK');
  const rawScanOut = fields.get('SCAN PULANG');
  const scanIn = normalizeAttendanceTime(rawScanIn);
  const scanOut = normalizeAttendanceTime(rawScanOut);
  if (rawScanIn !== undefined && rawScanIn !== null && rawScanIn !== '' && !scanIn) {
    issues.push('TIME_INVALID');
  }
  if (rawScanOut !== undefined && rawScanOut !== null && rawScanOut !== '' && !scanOut) {
    issues.push('TIME_INVALID');
  }

  const workStatus = String(fields.get('JAM KERJA') ?? '').trim().toUpperCase();
  // The status column carries a role label ("STAFF", "CS", "SATPAM") for a day
  // worked and "TIDAK HADIR" for an absence, so presence is the absence of an
  // explicit absence rather than a literal "MASUK".
  const isPresentStatus = Boolean(workStatus) && workStatus !== 'TIDAK HADIR';
  if (isPresentStatus && !scanIn && !scanOut) issues.push('MASUK_WITHOUT_SCAN');
  if (!isPresentStatus && (scanIn || scanOut)) issues.push('SCAN_WITHOUT_MASUK');
  if (isPresentStatus && Boolean(scanIn) !== Boolean(scanOut)) {
    issues.push('INCOMPLETE_PUNCH');
  }

  return {
    rowNumber,
    nipy,
    identifierSource: sourceNipy ? 'NIPY' : sourcePin ? 'PIN' : null,
    sourcePin,
    sourceNipy,
    name: String(fields.get('NAMA') ?? '').trim(),
    department: String(fields.get('DEPARTEMEN') ?? '').trim(),
    date,
    workStatus,
    scanIn,
    scanOut,
    issues: Array.from(new Set(issues)),
  };
}

export function normalizeAttendanceWorkbookRows(
  rows: readonly Record<string, unknown>[],
  period?: string,
): AttendanceNormalizedRow[] {
  return rows.map((row, index) =>
    normalizeAttendanceWorkbookRow(row, index + 2, period),
  );
}

export function attendanceDayKey(nipy: string, date: string): string {
  return `${normalizeNipy(nipy)}__${date}`;
}

export function consolidateAttendanceDays(
  rows: readonly AttendanceNormalizedRow[],
  corrections: ReadonlyMap<string, AttendanceDayCorrection> = new Map(),
): EffectiveAttendanceDay[] {
  const grouped = new Map<string, AttendanceNormalizedRow[]>();
  for (const row of rows) {
    if (!row.nipy || !DATE_ONLY_RE.test(row.date)) continue;
    const key = attendanceDayKey(row.nipy, row.date);
    const existing = grouped.get(key) || [];
    existing.push(row);
    grouped.set(key, existing);
  }
  for (const key of corrections.keys()) {
    if (grouped.has(key)) continue;
    const separator = key.lastIndexOf('__');
    const nipy = separator >= 0 ? key.slice(0, separator) : '';
    const date = separator >= 0 ? key.slice(separator + 2) : '';
    if (!nipy || !DATE_ONLY_RE.test(date)) continue;
    grouped.set(key, [
      {
        rowNumber: 0,
        nipy,
        identifierSource: null,
        sourcePin: null,
        sourceNipy: nipy,
        name: '',
        department: '',
        date,
        workStatus: '',
        scanIn: null,
        scanOut: null,
        issues: [],
      },
    ]);
  }

  return Array.from(grouped.entries())
    .map(([key, dayRows]) => {
      const correction = corrections.get(key);
      const chosen =
        dayRows.find(
          (row) => row.workStatus === 'MASUK' && Boolean(row.scanIn || row.scanOut),
        ) || dayRows[0];
      const baseScanIn =
        dayRows.map((row) => row.scanIn).filter((value): value is string => Boolean(value)).sort()[0] ||
        null;
      const baseScanOuts = dayRows
        .map((row) => row.scanOut)
        .filter((value): value is string => Boolean(value))
        .sort();
      const baseScanOut = baseScanOuts[baseScanOuts.length - 1] || null;
      const workStatus = correction?.workStatus?.trim().toUpperCase() || chosen.workStatus;
      const scanIn = correction && 'scanIn' in correction ? correction.scanIn || null : baseScanIn;
      const scanOut =
        correction && 'scanOut' in correction ? correction.scanOut || null : baseScanOut;
      // The scanner writes a role label in the status column — "STAFF", "CS",
      // "SATPAM" — and reserves "TIDAK HADIR" for a real absence. Anything that
      // is not an explicit absence, and that carries a scan, is a day on site.
      const present =
        correction && typeof correction.present === 'boolean'
          ? correction.present
          : Boolean(workStatus) &&
            workStatus !== 'TIDAK HADIR' &&
            Boolean(scanIn || scanOut);
      const issues = Array.from(
        new Set<AttendanceIssueCode>([
          ...dayRows.flatMap((row) => row.issues),
          ...(dayRows.length > 1 ? ['DUPLICATE_EMPLOYEE_DAY' as const] : []),
          ...(present && Boolean(scanIn) !== Boolean(scanOut)
            ? ['INCOMPLETE_PUNCH' as const]
            : []),
        ]),
      );

      return {
        nipy: chosen.nipy,
        date: chosen.date,
        name: chosen.name,
        department: chosen.department,
        workStatus,
        scanIn,
        scanOut,
        present,
        completePunch: Boolean(scanIn && scanOut),
        corrected: Boolean(correction),
        sourceRows: dayRows.map((row) => row.rowNumber),
        issues,
      };
    })
    .sort((left, right) =>
      left.nipy.localeCompare(right.nipy) || left.date.localeCompare(right.date),
    );
}

export function isFridayDate(dateOnly: string): boolean {
  const match = DATE_ONLY_RE.exec(dateOnly);
  if (!match) return false;
  return (
    new Date(
      Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
    ).getUTCDay() === 5
  );
}

export function isPremiumAttendanceDate(
  dateOnly: string,
  premiumDates: ReadonlySet<string>,
): boolean {
  return isFridayDate(dateOnly) || premiumDates.has(dateOnly);
}

function attendanceTimeToSeconds(value: string | null): number | null {
  const normalized = normalizeAttendanceTime(value);
  if (!normalized) return null;
  const [hours, minutes, seconds] = normalized.split(':').map(Number);
  return hours * 3_600 + minutes * 60 + (seconds || 0);
}

function clampToAttendanceWorkWindowSeconds(seconds: number): number {
  const windowStart = ATTENDANCE_WORK_WINDOW_START_MINUTES * 60;
  const windowEnd = ATTENDANCE_WORK_WINDOW_END_MINUTES * 60;
  return Math.min(windowEnd, Math.max(windowStart, seconds));
}

function attendanceSecondsToClock(seconds: number): string {
  const clamped = clampToAttendanceWorkWindowSeconds(seconds);
  const hours = Math.floor(clamped / 3_600);
  const minutes = Math.floor((clamped % 3_600) / 60);
  const remainingSeconds = Math.floor(clamped % 60);
  return [hours, minutes, remainingSeconds]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
}

/**
 * Generates the missing side of a single scan, 150 minutes off the one that
 * was recorded, and clamped into the 07:30–14:00 work window. Shared by
 * Loyalis presence (via `autoFillLoyalisScan`) and Pekarya attendance.
 *
 * The recorded scan is clamped into the window *before* the offset is added,
 * not after. An employee who clocks in at 05:54 gets no credit for the time
 * before 07:30 anyway, so the offset is measured from 07:30 — otherwise the
 * generated scan-out lands close to the window's own clamp and most of the
 * 150 minutes is lost to a boundary the employee did nothing wrong to hit.
 */
export function autoFillAttendanceScan(
  scan: string | null,
  missingSide: 'in' | 'out',
): string | null {
  const seconds = attendanceTimeToSeconds(scan);
  if (seconds === null) return null;
  const clamped = clampToAttendanceWorkWindowSeconds(seconds);
  const offset = ATTENDANCE_SINGLE_SCAN_AUTO_FILL_MINUTES * 60;
  const generated = missingSide === 'out' ? clamped + offset : clamped - offset;
  return attendanceSecondsToClock(generated);
}

/**
 * Counted seconds on site: both scans are pulled into the 07:30–14:00 window
 * before measuring, so an early arrival or a late departure adds nothing.
 *
 * A day with only one scan is not treated as zero time worked — the missing
 * side is generated by {@link autoFillAttendanceScan} and counted the same as
 * a real scan, exactly as Loyalis presence already does for a single punch.
 * The day still carries `INCOMPLETE_PUNCH`/`completePunch: false` upstream,
 * so it stays visible for review even though it is no longer unpaid.
 */
export function attendanceWorkedSeconds(
  scanIn: string | null,
  scanOut: string | null,
): number {
  const filledScanIn = scanIn ?? autoFillAttendanceScan(scanOut, 'in');
  const filledScanOut = scanOut ?? autoFillAttendanceScan(scanIn, 'out');
  const start = attendanceTimeToSeconds(filledScanIn);
  const end = attendanceTimeToSeconds(filledScanOut);
  if (start === null || end === null) return 0;
  const windowStart = ATTENDANCE_WORK_WINDOW_START_MINUTES * 60;
  const windowEnd = ATTENDANCE_WORK_WINDOW_END_MINUTES * 60;
  const effectiveIn = Math.max(windowStart, start);
  const effectiveOut = Math.min(windowEnd, end);
  const elapsed = effectiveOut - effectiveIn;
  return elapsed > 0 ? elapsed : 0;
}

/** Rupiah owed for one day on site, always rounded up to a whole rupiah. */
export function pekaryaAttendanceAmount(
  scanIn: string | null,
  scanOut: string | null,
  premium = false,
): number {
  const rate = premium
    ? PEKARYA_ATTENDANCE_PREMIUM_RATE_PER_SECOND
    : PEKARYA_ATTENDANCE_RATE_PER_SECOND;
  return Math.ceil(attendanceWorkedSeconds(scanIn, scanOut) * rate);
}

export function summarizePekaryaAttendance(
  nipy: string,
  days: readonly EffectiveAttendanceDay[],
  premiumDates: ReadonlySet<string>,
): PekaryaAttendanceSummary {
  const normalizedNipy = normalizeNipy(nipy);
  let harianCount = 0;
  let jumatLiburCount = 0;
  let harianAmount = 0;
  let jumatLiburAmount = 0;
  let workedSeconds = 0;
  const summarizedDays = days
    .filter((day) => day.nipy === normalizedNipy)
    .map((day) => {
      if (!day.present) {
        return { ...day, payType: null, amount: 0, scanInAuto: false, scanOutAuto: false };
      }
      const premium = isPremiumAttendanceDate(day.date, premiumDates);
      const payType = premium
        ? ('Jumat & Libur' as const)
        : ('Harian' as const);
      // A forgotten scan is filled in rather than left blank, so what is shown
      // is exactly what the amount below was paid for.
      const scanInAuto = day.scanIn === null;
      const scanOutAuto = day.scanOut === null;
      const filledScanIn = day.scanIn ?? autoFillAttendanceScan(day.scanOut, 'in');
      const filledScanOut = day.scanOut ?? autoFillAttendanceScan(day.scanIn, 'out');
      const amount = pekaryaAttendanceAmount(filledScanIn, filledScanOut, premium);
      workedSeconds += attendanceWorkedSeconds(filledScanIn, filledScanOut);
      if (payType === 'Jumat & Libur') {
        jumatLiburCount += 1;
        jumatLiburAmount += amount;
      } else {
        harianCount += 1;
        harianAmount += amount;
      }
      return {
        ...day,
        scanIn: filledScanIn,
        scanOut: filledScanOut,
        scanInAuto: scanInAuto && filledScanIn !== null,
        scanOutAuto: scanOutAuto && filledScanOut !== null,
        payType,
        amount,
      };
    });

  return {
    nipy: normalizedNipy,
    harianCount,
    jumatLiburCount,
    harianAmount,
    jumatLiburAmount,
    workedSeconds,
    totalAmount: harianAmount + jumatLiburAmount,
    payableDays: harianCount + jumatLiburCount,
    incompletePunchCount: summarizedDays.filter(
      (day) => day.present && !day.completePunch,
    ).length,
    correctedDayCount: summarizedDays.filter((day) => day.corrected).length,
    days: summarizedDays,
  };
}

function addCalendarDays(dateOnly: string, days: number): string {
  const match = DATE_ONLY_RE.exec(dateOnly);
  if (!match) return '';
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days),
  );
  return date.toISOString().slice(0, 10);
}

export function satpamAttendanceEvidenceDates(
  dutyDate: string,
  shiftName: string,
): string[] {
  return shiftName === 'Malam'
    ? [dutyDate, addCalendarDays(dutyDate, 1)]
    : [dutyDate];
}

export function hasSatpamAttendanceEvidence(
  nipy: string,
  dutyDate: string,
  shiftName: string,
  days: readonly EffectiveAttendanceDay[],
): boolean {
  const normalizedNipy = normalizeNipy(nipy);
  const acceptableDates = new Set(
    satpamAttendanceEvidenceDates(dutyDate, shiftName),
  );
  return days.some(
    (day) =>
      day.nipy === normalizedNipy &&
      acceptableDates.has(day.date) &&
      Boolean(day.scanIn || day.scanOut),
  );
}
