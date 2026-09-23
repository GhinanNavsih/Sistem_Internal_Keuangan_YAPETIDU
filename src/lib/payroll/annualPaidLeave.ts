export const ANNUAL_PAID_LEAVE_DAYS = 6 as const;
export const ANNUAL_PAID_LEAVE_MIN_YEARS = 10 as const;
export const ANNUAL_PAID_LEAVE_SCAN_IN = '07:30:00' as const;
export const ANNUAL_PAID_LEAVE_SCAN_OUT = '14:00:00' as const;

export type AnnualPaidLeaveEmployeeKind = 'loyalis' | 'blue_collar';
export type AnnualPaidLeaveStatus =
  | 'pending'
  | 'approved'
  | 'declined'
  | 'withdrawn';
export type AnnualPaidLeavePayType = 'Harian' | 'Jumat & Libur';

export interface AnnualPaidLeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeKind: AnnualPaidLeaveEmployeeKind;
  employeeCollection: 'Employees_Loyalis' | 'Employees_BlueCollar';
  category: string;
  leaveDate: string;
  year: number;
  period: string;
  reason: string;
  serviceDate: string;
  qualifyingDate: string;
  status: AnnualPaidLeaveStatus;
  revision: number;
  decisionReason?: string;
  approvedPayType?: AnnualPaidLeavePayType | null;
  approvedAmount?: number;
}

export interface AnnualPaidLeaveBalance {
  entitlementDays: number;
  reservedDays: number;
  usedDays: number;
  availableDays: number;
}

export type AnnualPaidLeaveIdempotencyState = 'new' | 'replay' | 'conflict';

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isDateOnly(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = DATE_ONLY_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return (
    year >= 1900 &&
    year <= 9999 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month)
  );
}

export function assertAnnualPaidLeaveDate(value: unknown): asserts value is string {
  if (!isDateOnly(value)) {
    throw new Error('Tanggal cuti wajib menggunakan format YYYY-MM-DD yang valid.');
  }
}

export function annualPaidLeaveYear(date: string): number {
  assertAnnualPaidLeaveDate(date);
  return Number(date.slice(0, 4));
}

/** Adds calendar years and clamps 29 February to the last day of February. */
export function addCalendarYears(date: string, years: number): string {
  assertAnnualPaidLeaveDate(date);
  if (!Number.isInteger(years)) throw new Error('Jumlah tahun harus berupa bilangan bulat.');
  const year = Number(date.slice(0, 4)) + years;
  const month = Number(date.slice(5, 7));
  const day = Math.min(Number(date.slice(8, 10)), daysInMonth(year, month));
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function annualPaidLeaveQualifyingDate(serviceDate: string): string {
  return addCalendarYears(serviceDate, ANNUAL_PAID_LEAVE_MIN_YEARS);
}

export function completedServiceYears(serviceDate: string, onDate: string): number {
  assertAnnualPaidLeaveDate(serviceDate);
  assertAnnualPaidLeaveDate(onDate);
  const serviceYear = Number(serviceDate.slice(0, 4));
  const onYear = Number(onDate.slice(0, 4));
  let years = onYear - serviceYear;
  if (onDate.slice(5) < serviceDate.slice(5)) years -= 1;
  return Math.max(0, years);
}

export function isAnnualPaidLeaveEligible(
  serviceDate: string,
  leaveDate: string,
): boolean {
  return leaveDate >= annualPaidLeaveQualifyingDate(serviceDate);
}

export function annualPaidLeaveRequestId(
  employeeId: string,
  leaveDate: string,
): string {
  assertAnnualPaidLeaveDate(leaveDate);
  const safeEmployeeId = employeeId.trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(safeEmployeeId)) {
    throw new Error('ID pegawai tidak valid.');
  }
  return `${safeEmployeeId}__${leaveDate}`;
}

export function annualPaidLeaveBalanceId(employeeId: string, year: number): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(employeeId) || !Number.isInteger(year)) {
    throw new Error('Identitas saldo cuti tidak valid.');
  }
  return `${employeeId}__${year}`;
}

export function annualPaidLeaveIdempotencyState(
  storedRequestHash: unknown,
  requestHash: string,
): AnnualPaidLeaveIdempotencyState {
  if (storedRequestHash === undefined || storedRequestHash === null) return 'new';
  return storedRequestHash === requestHash ? 'replay' : 'conflict';
}

export function isAnnualPaidLeaveRequestOwner(
  requestEmployeeId: unknown,
  authenticatedEmployeeId: string,
): boolean {
  return (
    typeof requestEmployeeId === 'string' &&
    requestEmployeeId === authenticatedEmployeeId
  );
}

export function calculateAnnualPaidLeaveBalance(
  requests: readonly Pick<AnnualPaidLeaveRequest, 'status'>[],
  entitlementDays: number = ANNUAL_PAID_LEAVE_DAYS,
  manualUsedDays: number = 0,
): AnnualPaidLeaveBalance {
  const reservedDays = requests.filter((request) => request.status === 'pending').length;
  const approvedDays = requests.filter((request) => request.status === 'approved').length;
  const priorUsedDays = Number.isFinite(manualUsedDays)
    ? Math.max(0, Math.floor(manualUsedDays))
    : 0;
  const usedDays = approvedDays + priorUsedDays;
  return {
    entitlementDays,
    reservedDays,
    usedDays,
    availableDays: Math.max(0, entitlementDays - reservedDays - approvedDays - priorUsedDays),
  };
}

export function annualPaidLeavePayType(isPremiumDate: boolean): AnnualPaidLeavePayType {
  return isPremiumDate ? 'Jumat & Libur' : 'Harian';
}

export function annualPaidLeaveAttendanceCorrection() {
  return {
    present: true,
    workStatus: 'CUTI',
    scanIn: ANNUAL_PAID_LEAVE_SCAN_IN,
    scanOut: ANNUAL_PAID_LEAVE_SCAN_OUT,
  } as const;
}

export function canReviewAnnualPaidLeave(
  reviewer: { role: string; permittedCategories: readonly string[] },
  employee: { kind: AnnualPaidLeaveEmployeeKind; category: string },
): boolean {
  if (reviewer.role === 'super_admin') return true;
  if (employee.kind === 'loyalis') {
    return reviewer.role === 'loyalis_presence_admin';
  }
  return (
    reviewer.role === 'satker_head' &&
    reviewer.permittedCategories
      .map((category) => category.trim().toUpperCase())
      .includes(employee.category.trim().toUpperCase())
  );
}

export type AnnualPaidLeaveDecisionIssue =
  | 'period_closed'
  | 'immutable_slip'
  | 'revision_conflict'
  | 'not_pending'
  | 'reserved_balance_missing'
  | 'payroll_post_exists'
  | 'attendance_conflict';

export function annualPaidLeaveDecisionIssue(input: {
  expectedRevision: number;
  currentRevision: number;
  status: AnnualPaidLeaveStatus;
  reservedDays: number;
  periodClosed: boolean;
  immutableSlip: boolean;
  payrollPostExists: boolean;
  approving: boolean;
  attendanceConflict: boolean;
}): AnnualPaidLeaveDecisionIssue | null {
  if (input.approving && input.periodClosed) return 'period_closed';
  if (input.approving && input.immutableSlip) return 'immutable_slip';
  if (input.currentRevision !== input.expectedRevision) return 'revision_conflict';
  if (input.status !== 'pending') return 'not_pending';
  if (input.reservedDays < 1) return 'reserved_balance_missing';
  if (input.payrollPostExists) return 'payroll_post_exists';
  if (input.approving && input.attendanceConflict) return 'attendance_conflict';
  return null;
}
