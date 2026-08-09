import {
  isPekaryaJobCategory,
  type PekaryaJobCategory,
} from './pekaryaSpj';
import { normalizeAttendanceTime } from './attendance';
import type { PhotoAuditMetadata } from './domain';

export const PEKARYA_OFFICIAL_LEAVE_TYPE = 'izin_resmi' as const;
export const PEKARYA_OFFICIAL_LEAVE_SCAN_IN = '07:30:00' as const;
export const PEKARYA_OFFICIAL_LEAVE_SCAN_OUT = '14:00:00' as const;

export type PekaryaAttendanceReportType = 'scan' | 'izin_resmi';

export type PekaryaOfficialLeaveStatus =
  | 'pending'
  | 'approved'
  | 'declined'
  | 'withdrawn';

export interface PekaryaOfficialLeaveRequest {
  id: string;
  employeeId: string;
  employeeName?: string;
  employeeNipy?: string;
  category: string;
  period: string;
  date: string;
  /** `reportType` is present on new records; old records use `leaveType`. */
  reportType?: PekaryaAttendanceReportType;
  leaveType?: typeof PEKARYA_OFFICIAL_LEAVE_TYPE | null;
  scanIn?: string | null;
  scanOut?: string | null;
  reason: string;
  evidenceUrl?: string | null;
  evidenceAuditMetadata?: PhotoAuditMetadata | null;
  status: PekaryaOfficialLeaveStatus;
  revision: number;
  decisionReason?: string;
  approvedPayType?: 'Harian' | 'Jumat & Libur' | null;
  approvedAmount?: number;
}

export function pekaryaAttendanceReportType(
  request: Pick<PekaryaOfficialLeaveRequest, 'reportType' | 'leaveType'>,
): PekaryaAttendanceReportType {
  return request.reportType === 'scan' ? 'scan' : 'izin_resmi';
}

export function isPekaryaOfficialLeaveCategory(
  value: unknown,
): value is Exclude<PekaryaJobCategory, 'SATPAM'> {
  return isPekaryaJobCategory(value) && value !== 'SATPAM';
}

export function officialLeaveAttendanceCorrection() {
  return {
    present: true,
    workStatus: 'IZIN RESMI',
    scanIn: PEKARYA_OFFICIAL_LEAVE_SCAN_IN,
    scanOut: PEKARYA_OFFICIAL_LEAVE_SCAN_OUT,
  } as const;
}

export function scanAttendanceCorrection(scanIn: string, scanOut: string) {
  return {
    present: true,
    workStatus: 'MASUK',
    scanIn,
    scanOut,
  } as const;
}

export function isValidAttendanceScanRange(
  scanIn: unknown,
  scanOut: unknown,
): boolean {
  const normalizedScanIn = normalizeAttendanceTime(scanIn);
  const normalizedScanOut = normalizeAttendanceTime(scanOut);
  if (!normalizedScanIn || !normalizedScanOut) return false;

  const [inHours, inMinutes, inSeconds] = normalizedScanIn
    .split(':')
    .map(Number);
  const [outHours, outMinutes, outSeconds] = normalizedScanOut
    .split(':')
    .map(Number);
  const scanInSeconds = inHours * 3_600 + inMinutes * 60 + inSeconds;
  const scanOutSeconds = outHours * 3_600 + outMinutes * 60 + outSeconds;
  return scanOutSeconds > scanInSeconds;
}
