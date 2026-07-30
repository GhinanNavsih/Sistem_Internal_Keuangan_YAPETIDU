import { pekaryaPayrollWindow } from './pekaryaSpj';
import { isFridayDate } from './attendance';

export interface PeriodWorkCalendar {
  revision: number;
  annualVersion: string | null;
  premiumDates: string[];
}

function addCalendarDays(dateOnly: string, days: number): string {
  const [year, month, day] = dateOnly.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

export function periodDateRange(period: string): string[] {
  const window = pekaryaPayrollWindow(period);
  const result: string[] = [];
  for (
    let current = window.startsOn;
    current <= window.endsOn;
    current = addCalendarDays(current, 1)
  ) {
    result.push(current);
  }
  return result;
}

export function periodFridayDates(period: string): string[] {
  return periodDateRange(period).filter(isFridayDate);
}

export function normalizePeriodPremiumDates(
  period: string,
  dates: readonly string[],
): string[] {
  const window = pekaryaPayrollWindow(period);
  const accepted = dates.filter(
    (date) =>
      /^\d{4}-\d{2}-\d{2}$/.test(date) &&
      date >= window.startsOn &&
      date <= window.endsOn,
  );
  return Array.from(new Set([...accepted, ...periodFridayDates(period)])).sort();
}

export function periodCalendarFromData(
  period: string,
  data: Record<string, unknown> | null | undefined,
  annualDates: readonly string[] = [],
): PeriodWorkCalendar {
  const nested =
    data?.workCalendar && typeof data.workCalendar === 'object'
      ? (data.workCalendar as Record<string, unknown>)
      : null;
  const nestedDates = Array.isArray(nested?.premiumDates)
    ? nested.premiumDates.filter((date): date is string => typeof date === 'string')
    : [];
  const legacyDates = Array.isArray(data?.holidays)
    ? data.holidays.filter((date): date is string => typeof date === 'string')
    : [];
  return {
    revision: Math.max(1, Number(nested?.revision || 1)),
    annualVersion:
      typeof nested?.annualVersion === 'string'
        ? nested.annualVersion
        : typeof data?.holidayCalendarVersion === 'string'
          ? data.holidayCalendarVersion
          : null,
    premiumDates: normalizePeriodPremiumDates(
      period,
      nestedDates.length > 0 ? nestedDates : [...annualDates, ...legacyDates],
    ),
  };
}

