import { normalizeAttendanceTime } from './attendance';
import { satpamShiftTimes, type SatpamShiftName } from './domain';

export type SatpamAttendanceReportType = 'scan' | 'izin_resmi';

export function satpamAttendanceReportType(request: {
  reportType?: unknown;
}): SatpamAttendanceReportType {
  return request.reportType === 'scan' ? 'scan' : 'izin_resmi';
}

/** The shift's own start and end, which change from October 2026. */
export function defaultSatpamScanTimes(
  dutyDate: string,
  shiftName: SatpamShiftName,
): { scanIn: string; scanOut: string } {
  const { start, end } = satpamShiftTimes(dutyDate, shiftName);
  return { scanIn: start, scanOut: end };
}

export function isValidSatpamAttendanceScanRange(
  scanIn: unknown,
  scanOut: unknown,
  shiftName: SatpamShiftName,
): boolean {
  const normalizedScanIn = normalizeAttendanceTime(scanIn);
  const normalizedScanOut = normalizeAttendanceTime(scanOut);
  if (!normalizedScanIn || !normalizedScanOut) return false;

  const toSeconds = (value: string): number => {
    const [hours, minutes, seconds] = value.split(':').map(Number);
    return hours * 3_600 + minutes * 60 + seconds;
  };
  const startSeconds = toSeconds(normalizedScanIn);
  let endSeconds = toSeconds(normalizedScanOut);
  if (shiftName === 'Malam' && endSeconds <= startSeconds) {
    endSeconds += 24 * 3_600;
  }
  return endSeconds > startSeconds && endSeconds - startSeconds < 24 * 3_600;
}
