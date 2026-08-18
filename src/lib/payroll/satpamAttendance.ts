import { normalizeAttendanceTime } from './attendance';
import type { SatpamShiftName } from './domain';

export type SatpamAttendanceReportType = 'scan' | 'izin_resmi';

const DEFAULT_SCAN_TIMES: Record<
  SatpamShiftName,
  { scanIn: string; scanOut: string }
> = {
  Pagi: { scanIn: '08:00', scanOut: '14:00' },
  Sore: { scanIn: '14:00', scanOut: '22:00' },
  Malam: { scanIn: '22:00', scanOut: '08:00' },
};

export function satpamAttendanceReportType(request: {
  reportType?: unknown;
}): SatpamAttendanceReportType {
  return request.reportType === 'scan' ? 'scan' : 'izin_resmi';
}

export function defaultSatpamScanTimes(
  shiftName: SatpamShiftName,
): { scanIn: string; scanOut: string } {
  return DEFAULT_SCAN_TIMES[shiftName];
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
