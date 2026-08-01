import admin, { adminDb } from '@/lib/firebase-admin';
import { HttpError } from './auth';
import { normalizePeriodPremiumDates } from '@/lib/payroll/calendar';
import { ATTENDANCE_PAYROLL_START_PERIOD } from '@/lib/payroll/attendance';
import { pekaryaPayrollPeriodForDate } from '@/lib/payroll/pekaryaSpj';

export function jakartaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function shiftPeriod(period: string, months: number): string {
  const [year, month] = period.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + months, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * The months a client should offer for reporting: the payroll period covering
 * today, plus one on each side so month-boundary and late submissions work
 * without an administrator having touched the period first.
 */
export function livePeriodWindow(now: Date = new Date()): string[] {
  const current = pekaryaPayrollPeriodForDate(jakartaToday(now));
  return [shiftPeriod(current, -1), current, shiftPeriod(current, 1)];
}

type PeriodData = Record<string, unknown> | null | undefined;

const CLOSED_MESSAGE =
  'Periode payroll sudah ditutup permanen; gunakan proses koreksi resmi.';

/**
 * Payroll periods accept input by default.
 *
 * An absent `PayrollPeriods/{YYYY-MM}` document means the month has simply not
 * been materialized yet, not that it is unavailable. Only an explicit permanent
 * closure ends collection, so field reporting is never blocked waiting for an
 * administrator to open the next month.
 */
export function isPeriodClosed(data: PeriodData): boolean {
  return data?.attendanceStatus === 'closed';
}

export function assertPeriodAcceptsInput(
  data: PeriodData,
  message: string = CLOSED_MESSAGE,
): void {
  if (isPeriodClosed(data)) {
    throw new HttpError(409, message);
  }
}

/**
 * A period is materialized once it owns a frozen `workCalendar` snapshot. That
 * snapshot is what stops a later premium-date edit from silently re-rating work
 * already approved against the previous calendar, so it must be written before
 * any money is committed against the period.
 */
export function isPeriodMaterialized(data: PeriodData): boolean {
  const calendar = data?.workCalendar;
  return Boolean(calendar && typeof calendar === 'object');
}

export function annualCalendarRef(period: string) {
  return adminDb.collection('PayrollHolidayCalendars').doc(period.slice(0, 4));
}

export function annualDatesFrom(
  snapshot: FirebaseFirestore.DocumentSnapshot | null | undefined,
): string[] {
  const dates = snapshot?.data()?.dates;
  return Array.isArray(dates)
    ? dates.filter((date: unknown): date is string => typeof date === 'string')
    : [];
}

export interface PeriodMaterializationInput {
  period: string;
  periodData: PeriodData;
  annualDates: readonly string[];
  actorUid: string;
  reason: string;
  /** Explicit premium dates, used when a Superadmin edits the month calendar. */
  premiumDates?: readonly string[];
}

/**
 * Builds the fields that freeze a period's pay calendar, or `null` when the
 * period is already materialized and must not be rewritten.
 *
 * Fridays are always premium regardless of configuration, so a month that was
 * never touched by an administrator still rates correctly; only nationally
 * declared holidays depend on the annual accumulator or an explicit edit.
 */
export function buildPeriodMaterialization(
  input: PeriodMaterializationInput,
): Record<string, unknown> | null {
  if (isPeriodMaterialized(input.periodData)) return null;

  const legacyDates = Array.isArray(input.periodData?.holidays)
    ? (input.periodData!.holidays as unknown[]).filter(
        (date): date is string => typeof date === 'string',
      )
    : [];
  const premiumDates = normalizePeriodPremiumDates(
    input.period,
    input.premiumDates ?? [...input.annualDates, ...legacyDates],
  );
  const annualVersion =
    typeof input.periodData?.holidayCalendarVersion === 'string'
      ? input.periodData.holidayCalendarVersion
      : `ID-${input.period.slice(0, 4)}-V1`;

  return {
    period: input.period,
    holidays: premiumDates,
    datePolicy: 'shift_start_date',
    timeZone: 'Asia/Jakarta',
    holidayCalendarVersion: annualVersion,
    workCalendar: {
      revision: 1,
      annualVersion,
      premiumDates,
      reason: input.reason,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: input.actorUid,
    },
    calendarReconciliationStatus: 'complete',
    // Duty planning belongs to the attendance-payroll regime. Materializing a
    // legacy month must not retroactively impose it.
    ...(input.period >= ATTENDANCE_PAYROLL_START_PERIOD
      ? { satpamDutyPlanRequired: true, satpamDutyPlanSchemaVersion: 1 }
      : {}),
    materializedAt: admin.firestore.FieldValue.serverTimestamp(),
    materializedBy: input.actorUid,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: input.actorUid,
    schemaVersion: 1,
  };
}
