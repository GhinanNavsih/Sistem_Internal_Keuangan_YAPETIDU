export type LoyalisLeaveType = 'izin_resmi' | 'cuti_tahunan' | 'ganti_libur';
export type LoyalisSubmissionKind = 'correction' | 'paid_leave' | 'ganti_libur';

export interface LeaveTypeChangeLink {
  kind: LoyalisSubmissionKind;
  id: string;
  type: string;
}

export interface LeaveTypeChangeHistory {
  typeChangedFrom?: LeaveTypeChangeLink | null;
  typeChangedTo?: LeaveTypeChangeLink | null;
}

export function isLoyalisLeaveType(value: unknown): value is LoyalisLeaveType {
  return value === 'izin_resmi' || value === 'cuti_tahunan' || value === 'ganti_libur';
}

export function loyalisLeaveTypeLabel(type: string): string {
  return ({ izin_resmi: 'Izin Resmi', cuti_tahunan: 'Cuti Tahunan', ganti_libur: 'Ganti Libur' } as Record<string, string>)[type] || type;
}

export function loyalisLeaveTypeKind(type: LoyalisLeaveType): LoyalisSubmissionKind {
  return type === 'izin_resmi' ? 'correction' : type === 'cuti_tahunan' ? 'paid_leave' : 'ganti_libur';
}
