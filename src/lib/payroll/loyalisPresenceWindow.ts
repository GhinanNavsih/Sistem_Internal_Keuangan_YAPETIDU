import { normalizeAttendanceTime } from './attendance';

export const LOYALIS_WORK_WINDOW_START_MINUTES = 7 * 60 + 30;
export const LOYALIS_WORK_WINDOW_END_MINUTES = 14 * 60;
export const LOYALIS_SINGLE_SCAN_AUTO_FILL_MINUTES = 150;

const SECONDS_PER_MINUTE = 60;
const WORK_WINDOW_START_SECONDS = LOYALIS_WORK_WINDOW_START_MINUTES * SECONDS_PER_MINUTE;
const WORK_WINDOW_END_SECONDS = LOYALIS_WORK_WINDOW_END_MINUTES * SECONDS_PER_MINUTE;

function parseClockSeconds(value: unknown): number | null {
  const normalized = normalizeAttendanceTime(value);
  if (!normalized) return null;

  const [hours, minutes, seconds] = normalized.split(':').map(Number);
  return hours * 3_600 + minutes * 60 + seconds;
}

function clampToOfficialWorkWindow(seconds: number): number {
  return Math.min(
    WORK_WINDOW_END_SECONDS,
    Math.max(WORK_WINDOW_START_SECONDS, seconds),
  );
}

function formatClockSeconds(seconds: number): string {
  const clampedSeconds = clampToOfficialWorkWindow(seconds);
  const hours = Math.floor(clampedSeconds / 3_600);
  const minutes = Math.floor((clampedSeconds % 3_600) / 60);
  const remainingSeconds = clampedSeconds % 60;

  return [hours, minutes, remainingSeconds]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
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
  const scanSeconds = parseClockSeconds(scan);
  if (scanSeconds === null) return null;

  const autoFillOffset = LOYALIS_SINGLE_SCAN_AUTO_FILL_MINUTES * SECONDS_PER_MINUTE;
  const generatedSeconds =
    missingSide === 'out'
      ? scanSeconds + autoFillOffset
      : scanSeconds - autoFillOffset;

  return formatClockSeconds(generatedSeconds);
}
