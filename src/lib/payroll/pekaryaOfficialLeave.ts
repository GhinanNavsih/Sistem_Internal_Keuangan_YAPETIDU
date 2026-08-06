import {
  isPekaryaJobCategory,
  type PekaryaJobCategory,
} from './pekaryaSpj';

export const PEKARYA_OFFICIAL_LEAVE_TYPE = 'izin_resmi' as const;
export const PEKARYA_OFFICIAL_LEAVE_SCAN_IN = '07:30:00' as const;
export const PEKARYA_OFFICIAL_LEAVE_SCAN_OUT = '14:00:00' as const;

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
  leaveType: typeof PEKARYA_OFFICIAL_LEAVE_TYPE;
  reason: string;
  evidenceUrl?: string | null;
  status: PekaryaOfficialLeaveStatus;
  revision: number;
  decisionReason?: string;
  approvedPayType?: 'Harian' | 'Jumat & Libur' | null;
  approvedAmount?: number;
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
