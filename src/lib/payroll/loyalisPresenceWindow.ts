import {
  ATTENDANCE_SINGLE_SCAN_AUTO_FILL_MINUTES,
  ATTENDANCE_WORK_WINDOW_END_MINUTES,
  ATTENDANCE_WORK_WINDOW_START_MINUTES,
  autoFillAttendanceScan,
  normalizeAttendanceTime,
} from './attendance';

// The window and the single-scan fill-in are shared with blue-collar
// attendance, so both are defined once in the attendance kernel and
// re-exported here under the Loyalis names its callers already use.
export const LOYALIS_WORK_WINDOW_START_MINUTES =
  ATTENDANCE_WORK_WINDOW_START_MINUTES;
export const LOYALIS_WORK_WINDOW_END_MINUTES = ATTENDANCE_WORK_WINDOW_END_MINUTES;
export const LOYALIS_SINGLE_SCAN_AUTO_FILL_MINUTES =
  ATTENDANCE_SINGLE_SCAN_AUTO_FILL_MINUTES;

const SECONDS_PER_MINUTE = 60;

function parseClockSeconds(value: unknown): number | null {
  const normalized = normalizeAttendanceTime(value);
  if (!normalized) return null;

  const [hours, minutes, seconds] = normalized.split(':').map(Number);
  return hours * 3_600 + minutes * 60 + seconds;
}

/**
 * Calculates worked minutes after bounding both scans to the official
 * 07:30:00–14:00:00 Loyalis work window.
 *
 * A null result means one of the supplied scans is not a valid time.
 */
export function calculateLoyalisDailyDuration(
  scanIn: unknown,
  scanOut: unknown,
  expectedHours: number,
): number | null {
  const scanInSeconds = parseClockSeconds(scanIn);
  const scanOutSeconds = parseClockSeconds(scanOut);

  if (scanInSeconds === null || scanOutSeconds === null) return null;

  const effectiveIn = Math.max(
    LOYALIS_WORK_WINDOW_START_MINUTES,
    scanInSeconds / SECONDS_PER_MINUTE,
  );
  const effectiveOut = Math.min(
    LOYALIS_WORK_WINDOW_END_MINUTES,
    scanOutSeconds / SECONDS_PER_MINUTE,
  );

  return effectiveOut > effectiveIn
    ? Math.ceil(
        Math.min(expectedHours * SECONDS_PER_MINUTE, effectiveOut - effectiveIn),
      )
    : 0;
}

/**
 * Generates the missing side of a single scan and clamps that generated time
 * to the official work window.
 */
export function autoFillLoyalisScan(
  scan: unknown,
  missingSide: 'in' | 'out',
): string | null {
  return autoFillAttendanceScan(normalizeAttendanceTime(scan), missingSide);
}
