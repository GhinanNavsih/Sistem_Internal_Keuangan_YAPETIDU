import { pekaryaPayrollWindow } from './pekaryaSpj';

export const ATTENDANCE_PAYROLL_START_PERIOD = '2026-08';
export const PEKARYA_ATTENDANCE_RATES = Object.freeze({
  Harian: 12_500,
  'Jumat & Libur': 25_000,
});

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
  totalAmount: number;
  payableDays: number;
  incompletePunchCount: number;
  correctedDayCount: number;
  days: Array<
    EffectiveAttendanceDay & {
      payType: 'Harian' | 'Jumat & Libur' | null;
      amount: number;
    }
  >;
}

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

export function normalizeNipy(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
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
  const isMasuk = workStatus === 'MASUK';
  if (isMasuk && !scanIn && !scanOut) issues.push('MASUK_WITHOUT_SCAN');
  if (!isMasuk && (scanIn || scanOut)) issues.push('SCAN_WITHOUT_MASUK');
  if (isMasuk && Boolean(scanIn) !== Boolean(scanOut)) issues.push('INCOMPLETE_PUNCH');

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
      const present =
        correction && typeof correction.present === 'boolean'
          ? correction.present
          : workStatus === 'MASUK' && Boolean(scanIn || scanOut);
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

export function summarizePekaryaAttendance(
  nipy: string,
  days: readonly EffectiveAttendanceDay[],
  premiumDates: ReadonlySet<string>,
): PekaryaAttendanceSummary {
  const normalizedNipy = normalizeNipy(nipy);
  let harianCount = 0;
  let jumatLiburCount = 0;
  const summarizedDays = days
    .filter((day) => day.nipy === normalizedNipy)
    .map((day) => {
      if (!day.present) {
        return { ...day, payType: null, amount: 0 };
      }
      const payType = isPremiumAttendanceDate(day.date, premiumDates)
        ? ('Jumat & Libur' as const)
        : ('Harian' as const);
      if (payType === 'Jumat & Libur') jumatLiburCount += 1;
      else harianCount += 1;
      return {
        ...day,
        payType,
        amount: PEKARYA_ATTENDANCE_RATES[payType],
      };
    });

  return {
    nipy: normalizedNipy,
    harianCount,
    jumatLiburCount,
    totalAmount:
      harianCount * PEKARYA_ATTENDANCE_RATES.Harian +
      jumatLiburCount * PEKARYA_ATTENDANCE_RATES['Jumat & Libur'],
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
