export type PresenceCorrectionType =
  | 'tap_in'
  | 'tap_out'
  | 'both'
  | 'izin_resmi';

export type PresenceCorrectionStatus = 'pending' | 'approved' | 'rejected';

export interface PresenceCorrectionRequest {
  id: string;
  period?: string;
  date: string;
  type: PresenceCorrectionType;
  checkInTime?: string | null;
  checkOutTime?: string | null;
  reason?: string;
  proofUrl?: string;
  status: PresenceCorrectionStatus;
  employeeId: string;
  employeeName?: string;
  rejectionReason?: string | null;
  resolvedBy?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface LoyalisRawLog {
  [key: string]: string | number | boolean | null | undefined;
  Tanggal?: string;
}

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isPresenceCorrectionType(value: unknown): value is PresenceCorrectionType {
  return value === 'tap_in' || value === 'tap_out' || value === 'both' || value === 'izin_resmi';
}

export function asPresenceCorrectionRequest(
  id: string,
  data: Record<string, unknown>,
): PresenceCorrectionRequest {
  return { id, ...data } as PresenceCorrectionRequest;
}

export function parseDateOnly(value: unknown): Date | null {
  if (typeof value !== 'string') return null;

  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) return null;

  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (
    date.getFullYear() !== Number(match[1]) ||
    date.getMonth() !== Number(match[2]) - 1 ||
    date.getDate() !== Number(match[3])
  ) {
    return null;
  }

  return date;
}

export function formatPresenceDate(
  value: unknown,
  options: Intl.DateTimeFormatOptions,
): string {
  const date = parseDateOnly(value);
  return date ? date.toLocaleDateString('id-ID', options) : '-';
}

export function formatCreatedAt(value: unknown): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toLocaleString('id-ID');
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString('id-ID') : '-';
  }

  if (typeof value === 'object' && value !== null) {
    const timestamp = value as {
      toDate?: () => Date;
      seconds?: number;
      nanoseconds?: number;
    };

    if (typeof timestamp.toDate === 'function') {
      const date = timestamp.toDate();
      return date instanceof Date && Number.isFinite(date.getTime())
        ? date.toLocaleString('id-ID')
        : '-';
    }

    if (typeof timestamp.seconds === 'number' && Number.isFinite(timestamp.seconds)) {
      const milliseconds = timestamp.seconds * 1000 + (timestamp.nanoseconds || 0) / 1_000_000;
      const date = new Date(milliseconds);
      return Number.isFinite(date.getTime()) ? date.toLocaleString('id-ID') : '-';
    }
  }

  return '-';
}

export function timestampToMillis(value: unknown): number {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.getTime() : 0;
  }

  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const milliseconds = Date.parse(value);
    return Number.isFinite(milliseconds) ? milliseconds : 0;
  }

  if (typeof value === 'object' && value !== null) {
    const timestamp = value as { toMillis?: () => number; seconds?: number; nanoseconds?: number };
    if (typeof timestamp.toMillis === 'function') {
      const milliseconds = timestamp.toMillis();
      return Number.isFinite(milliseconds) ? milliseconds : 0;
    }
    if (typeof timestamp.seconds === 'number' && Number.isFinite(timestamp.seconds)) {
      return timestamp.seconds * 1000 + (timestamp.nanoseconds || 0) / 1_000_000;
    }
  }

  return 0;
}

export function parseDateKey(value: unknown): number {
  if (typeof value !== 'string') return Number.POSITIVE_INFINITY;
  const [day, month, year] = value.split('-').map(Number);
  if (![day, month, year].every(Number.isFinite)) return Number.POSITIVE_INFINITY;
  return new Date(year, month - 1, day).getTime();
}

export function parseDateToDDMMYYYY(value: unknown): string {
  if (typeof value !== 'string') return '';
  const match = DATE_ONLY_PATTERN.exec(value);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : '';
}

export function correctionTypeLabel(type: PresenceCorrectionType): string {
  switch (type) {
    case 'izin_resmi':
      return 'Izin Resmi (Hari Penuh)';
    case 'both':
      return 'Masuk & Pulang';
    case 'tap_in':
      return 'Masuk Saja';
    case 'tap_out':
      return 'Pulang Saja';
  }
}

export function correctionTimeLabel(request: PresenceCorrectionRequest): string {
  if (request.type === 'izin_resmi') return '07:30 — 14:00 (Hari Penuh)';
  if (request.type === 'tap_out') return request.checkOutTime || '--:--';
  if (request.type === 'tap_in') return request.checkInTime || '--:--';
  return `${request.checkInTime || '--:--'} — ${request.checkOutTime || '--:--'}`;
}
