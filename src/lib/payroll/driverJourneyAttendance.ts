import {
  ATTENDANCE_WORK_WINDOW_END_MINUTES,
  ATTENDANCE_WORK_WINDOW_START_MINUTES,
  attendanceDayKey,
  type AttendanceIssueCode,
  type EffectiveAttendanceDay,
} from './attendance';
import { calculateEditableDriverJourneyTimeline } from './driverJourney';
import { pekaryaPayrollWindow } from './pekaryaSpj';

/**
 * A driver's attendance is his scans combined with his approved journeys. A
 * journey is time on duty, so the part of it that falls inside the 07:30-14:00
 * work window counts as time on site even when he could not scan: a journey
 * from 07:00 yesterday to 15:00 today makes both days a complete 07:30-14:00.
 *
 * Credits apply from this period on. Earlier months are closed and paid, and
 * must not change retroactively.
 */
export const DRIVER_JOURNEY_ATTENDANCE_START_PERIOD = '2026-09';

const DAY_SECONDS = 24 * 3_600;
const WINDOW_START_SECONDS = ATTENDANCE_WORK_WINDOW_START_MINUTES * 60;
const WINDOW_END_SECONDS = ATTENDANCE_WORK_WINDOW_END_MINUTES * 60;
const CLOCK_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MAX_JOURNEY_DAYS = 366;

export interface DriverJourneyInterval {
  employeeId: string;
  journeyId: string;
  dateStart: string;
  dateEnd?: string;
  timeStart: string;
  timeEnd: string;
  isMultiDay?: boolean;
}

/** The part of one date's work window an employee's journeys cover. */
export interface DriverJourneyDayCredit {
  employeeId: string;
  date: string;
  /** HH:MM:SS, never before 07:30:00. */
  scanIn: string;
  /** HH:MM:SS, never after 14:00:00. */
  scanOut: string;
  journeyIds: string[];
}

function clockToSeconds(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 3_600 + minutes * 60;
}

function secondsToClock(seconds: number): string {
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const rest = Math.floor(seconds % 60);
  return [hours, minutes, rest].map((part) => String(part).padStart(2, '0')).join(':');
}

function nextDate(dateOnly: string): string {
  const parsed = new Date(`${dateOnly}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

/** The period token `delta` months from `period` ('YYYY-MM'). */
export function shiftPeriodToken(period: string, delta: number): string {
  const [year, month] = period.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Per employee and date, the span of the work window the approved journeys
 * cover. Several journeys on one date reach from the earliest start to the
 * latest end, the way a first and last scan do.
 */
export function driverJourneyDayCredits(
  journeys: readonly DriverJourneyInterval[],
  period: string,
): DriverJourneyDayCredit[] {
  if (period < DRIVER_JOURNEY_ATTENDANCE_START_PERIOD) return [];
  const window = pekaryaPayrollWindow(period);
  const credits = new Map<
    string,
    { employeeId: string; date: string; from: number; to: number; ids: Set<string> }
  >();

  for (const journey of journeys) {
    if (
      !journey.employeeId ||
      !journey.dateStart ||
      !CLOCK_PATTERN.test(journey.timeStart) ||
      !CLOCK_PATTERN.test(journey.timeEnd)
    ) {
      continue;
    }
    // The same date inference the audit dialog uses: a trip whose clock wraps
    // past midnight ends the next day, whatever the stored multi-day flag says.
    const timeline = calculateEditableDriverJourneyTimeline({
      dateStart: journey.dateStart,
      dateEnd: journey.dateEnd,
      timeStart: journey.timeStart,
      timeEnd: journey.timeEnd,
      isMultiDay: journey.isMultiDay,
    });
    if (timeline.durationHours <= 0) continue;

    let date = timeline.dateStart;
    for (let guard = 0; date <= timeline.dateEnd && guard < MAX_JOURNEY_DAYS; guard += 1) {
      if (date >= window.startsOn && date <= window.endsOn) {
        const starts = date === timeline.dateStart ? clockToSeconds(journey.timeStart) : 0;
        const ends = date === timeline.dateEnd ? clockToSeconds(journey.timeEnd) : DAY_SECONDS;
        const from = Math.max(starts, WINDOW_START_SECONDS);
        const to = Math.min(ends, WINDOW_END_SECONDS);
        if (to > from) {
          const key = `${journey.employeeId}|${date}`;
          const existing = credits.get(key);
          if (existing) {
            existing.from = Math.min(existing.from, from);
            existing.to = Math.max(existing.to, to);
            existing.ids.add(journey.journeyId);
          } else {
            credits.set(key, {
              employeeId: journey.employeeId,
              date,
              from,
              to,
              ids: new Set([journey.journeyId]),
            });
          }
        }
      }
      date = nextDate(date);
    }
  }

  return Array.from(credits.values())
    .map((credit) => ({
      employeeId: credit.employeeId,
      date: credit.date,
      scanIn: secondsToClock(credit.from),
      scanOut: secondsToClock(credit.to),
      journeyIds: Array.from(credit.ids).sort(),
    }))
    .sort(
      (left, right) =>
        left.employeeId.localeCompare(right.employeeId) ||
        left.date.localeCompare(right.date),
    );
}

const SCAN_ISSUES_RESOLVED_BY_CREDIT: ReadonlySet<AttendanceIssueCode> = new Set([
  'INCOMPLETE_PUNCH',
  'MASUK_WITHOUT_SCAN',
  'SCAN_WITHOUT_MASUK',
]);

/**
 * Merges the credits into the consolidated days: the earlier of the real
 * scan-in and the journey's start, the later of the real scan-out and its end.
 * A day with no file row is created. A date that carries a stored correction
 * (a scan correction, izin resmi, cuti, ganti libur) is left exactly as that
 * decision made it, and a day the real scans already cover is not touched.
 */
export function applyDriverJourneyCredits(input: {
  days: readonly EffectiveAttendanceDay[];
  credits: readonly DriverJourneyDayCredit[];
  joinNipyByEmployeeId: ReadonlyMap<string, string>;
  correctedKeys: ReadonlySet<string>;
}): EffectiveAttendanceDay[] {
  const byKey = new Map(
    input.days.map((day) => [attendanceDayKey(day.nipy, day.date), day] as const),
  );
  let changed = false;

  for (const credit of input.credits) {
    const nipy = input.joinNipyByEmployeeId.get(credit.employeeId);
    if (!nipy) continue;
    const key = attendanceDayKey(nipy, credit.date);
    if (input.correctedKeys.has(key)) continue;

    const existing = byKey.get(key);
    const realIn = existing?.scanIn ?? null;
    const realOut = existing?.scanOut ?? null;
    const scanIn = realIn === null || credit.scanIn < realIn ? credit.scanIn : realIn;
    const scanOut = realOut === null || credit.scanOut > realOut ? credit.scanOut : realOut;
    if (existing?.present && scanIn === realIn && scanOut === realOut) continue;

    const issues = (existing?.issues ?? []).filter(
      (issue) => !SCAN_ISSUES_RESOLVED_BY_CREDIT.has(issue),
    );
    byKey.set(key, {
      nipy,
      date: credit.date,
      name: existing?.name ?? '',
      department: existing?.department ?? '',
      workStatus: existing?.present ? existing.workStatus : 'PERJALANAN DINAS',
      scanIn,
      scanOut,
      present: true,
      completePunch: true,
      corrected: false,
      sourceRows: existing?.sourceRows ?? [],
      issues,
      journeyCredit: {
        scanIn: scanIn !== realIn,
        scanOut: scanOut !== realOut,
        journeyIds: credit.journeyIds,
      },
    });
    changed = true;
  }

  if (!changed) return [...input.days];
  return Array.from(byKey.values()).sort(
    (left, right) =>
      left.nipy.localeCompare(right.nipy) || left.date.localeCompare(right.date),
  );
}
