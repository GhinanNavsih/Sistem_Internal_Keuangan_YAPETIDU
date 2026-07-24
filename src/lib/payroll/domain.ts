export const PAYROLL_TIME_ZONE = 'Asia/Jakarta';
export const SATPAM_RATE_VERSION = 'SATPAM-2026-V1';
export const SATPAM_HOLIDAY_CALENDAR_VERSION = 'ID-UNIPDU-2026-V1';

export const SATPAM_POSTS = [
  { id: 'Pos 1', name: 'Pos IC' },
  { id: 'Pos 2', name: 'Pos Stasiun' },
  { id: 'Pos 3', name: 'Pos ATM Graha' },
  { id: 'Pos 4', name: 'Pos Plaza' },
  { id: 'Pos 5', name: 'Pos Masjid Induk' },
  { id: 'Pos 6', name: 'Pos Gor' },
  { id: 'Pos 7', name: 'Pos Saintek' },
  { id: 'Pos 8', name: 'Pos Parkiran FIK' },
  { id: 'Pos 9', name: 'Pos Hurun-inn' },
] as const;

export type SatpamPostId = (typeof SATPAM_POSTS)[number]['id'];
export type SatpamShiftName = 'Pagi' | 'Sore' | 'Malam';
export type SatpamPayType =
  | 'Harian'
  | 'Jumat & Libur'
  | 'Lembur Sendiri'
  | 'Lembur Cover'
  | 'Off-Duty';

export type PayrollStatus =
  | 'draft'
  | 'finance_verified'
  | 'kbu_approved'
  | 'locked'
  | 'payment_created'
  | 'paid';

export interface MoneyField {
  label: string;
  amount: number;
}

export interface SatpamPrimaryAssignmentInput {
  postId: SatpamPostId;
  employeeId: string;
  coveredEmployeeId?: string;
  overtimeReason?: string;
}

export interface SatpamExtraAssignmentInput {
  postId: SatpamPostId;
  employeeId: string;
  overtimeReason: string;
}

export interface SubmitSatpamShiftInput {
  requestId: string;
  dutyDate: string;
  assignments: SatpamPrimaryAssignmentInput[];
  extraAssignment?: SatpamExtraAssignmentInput;
}

export interface SatpamActivityLike {
  id?: string;
  employeeId?: string;
  activityDate?: string;
  shiftName?: string;
  postName?: string;
  shiftType?: string;
  sourceOccurrenceId?: string;
  sourceLedgerEntryId?: string;
  fee?: number;
  status?: string;
}

export const SATPAM_RATES: Readonly<Record<SatpamPayType, number>> = Object.freeze({
  Harian: 12_500,
  'Jumat & Libur': 25_000,
  'Lembur Sendiri': 30_000,
  'Lembur Cover': 50_000,
  'Off-Duty': 0,
});

export const SHIFT_TIMES: Readonly<
  Record<SatpamShiftName, { start: string; end: string; endDayOffset: 0 | 1 }>
> = Object.freeze({
  Pagi: { start: '08:00', end: '14:00', endDayOffset: 0 },
  Sore: { start: '14:00', end: '22:00', endDayOffset: 0 },
  Malam: { start: '22:00', end: '08:00', endDayOffset: 1 },
});

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const SAFE_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;

export function assertDateOnly(value: string): void {
  const match = DATE_RE.exec(value);
  if (!match) {
    throw new Error('Tanggal wajib menggunakan format YYYY-MM-DD.');
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error('Tanggal kalender tidak valid.');
  }
}

export function assertRequestId(value: string): void {
  if (!SAFE_ID_RE.test(value)) {
    throw new Error('ID permintaan tidak valid.');
  }
}

export function addCalendarDays(dateOnly: string, days: number): string {
  assertDateOnly(dateOnly);
  const [year, month, day] = dateOnly.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

export function isFridayDutyDate(dateOnly: string): boolean {
  assertDateOnly(dateOnly);
  const [year, month, day] = dateOnly.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() === 5;
}

export function payrollPeriodForDutyDate(dateOnly: string): string {
  assertDateOnly(dateOnly);
  return dateOnly.slice(0, 7);
}

export function getRegularSatpamPayType(
  dateOnly: string,
  nationalHolidayDates: ReadonlySet<string>,
): 'Harian' | 'Jumat & Libur' {
  return isFridayDutyDate(dateOnly) || nationalHolidayDates.has(dateOnly)
    ? 'Jumat & Libur'
    : 'Harian';
}

export function getShiftIsoBounds(
  dutyDate: string,
  shiftName: SatpamShiftName,
): { startsAtIso: string; endsAtIso: string } {
  assertDateOnly(dutyDate);
  const shift = SHIFT_TIMES[shiftName];
  const endDate = addCalendarDays(dutyDate, shift.endDayOffset);
  return {
    startsAtIso: `${dutyDate}T${shift.start}:00+07:00`,
    endsAtIso: `${endDate}T${shift.end}:00+07:00`,
  };
}

function safeDocumentPart(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_');
}

export function shiftOccurrenceId(
  teamId: string,
  dutyDate: string,
  shiftName: SatpamShiftName,
): string {
  assertDateOnly(dutyDate);
  return `${safeDocumentPart(teamId)}__${dutyDate.replaceAll('-', '')}__${shiftName.toLowerCase()}`;
}

export function guardDutyIndexId(
  dutyDate: string,
  shiftName: SatpamShiftName,
  employeeId: string,
): string {
  return `${dutyDate.replaceAll('-', '')}__${shiftName.toLowerCase()}__${safeDocumentPart(employeeId)}`;
}

export function activityReportId(
  occurrenceId: string,
  employeeId: string,
  assignmentKey: string,
): string {
  return `SAT-${safeDocumentPart(occurrenceId)}-${safeDocumentPart(employeeId)}-${safeDocumentPart(assignmentKey)}`;
}

export function validateMoneyFields(fields: unknown, fieldName: string): MoneyField[] {
  if (!Array.isArray(fields) || fields.length > 100) {
    throw new Error(`${fieldName} tidak valid.`);
  }
  return fields.map((field, index) => {
    if (!field || typeof field !== 'object') {
      throw new Error(`${fieldName}[${index}] tidak valid.`);
    }
    const candidate = field as Partial<MoneyField>;
    const label = typeof candidate.label === 'string' ? candidate.label.trim() : '';
    const amount = candidate.amount;
    if (!label || label.length > 120) {
      throw new Error(`${fieldName}[${index}].label tidak valid.`);
    }
    if (
      typeof amount !== 'number' ||
      !Number.isSafeInteger(amount) ||
      amount < 0 ||
      amount > 100_000_000_000
    ) {
      throw new Error(`${fieldName}[${index}].amount tidak valid.`);
    }
    return { label, amount };
  });
}

export function calculatePayrollTotals(
  earnings: readonly MoneyField[],
  deductions: readonly MoneyField[],
): { totalEarnings: number; totalDeductions: number; netSalary: number } {
  const totalEarnings = earnings.reduce((total, item) => total + item.amount, 0);
  const totalDeductions = deductions.reduce((total, item) => total + item.amount, 0);
  if (!Number.isSafeInteger(totalEarnings) || !Number.isSafeInteger(totalDeductions)) {
    throw new Error('Total payroll melampaui batas bilangan aman.');
  }
  const netSalary = totalEarnings - totalDeductions;
  if (netSalary < 0) {
    throw new Error('Gaji bersih tidak boleh negatif.');
  }
  return { totalEarnings, totalDeductions, netSalary };
}

/**
 * Read-only compatibility guard for legacy records. It never changes Firestore.
 * New records are unique by source ledger ID. Legacy records fall back to the
 * smallest stable financial identity available in the historical schema.
 */
export function dedupeSatpamActivityReports<T extends SatpamActivityLike>(
  reports: readonly T[],
): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const report of reports) {
    const key =
      report.sourceLedgerEntryId ||
      [
        'legacy',
        report.employeeId || '',
        report.activityDate || '',
        report.shiftName || '',
        report.postName || '',
        report.shiftType || '',
      ].join('|');

    if (seen.has(key)) continue;
    seen.add(key);
    result.push(report);
  }
  return result;
}

export function isImmutablePayrollStatus(status: unknown): boolean {
  return (
    status === 'confirmed' ||
    status === 'locked' ||
    status === 'payment_created' ||
    status === 'paid'
  );
}

export function isTransferEligibleStatus(status: unknown): boolean {
  return isImmutablePayrollStatus(status);
}
