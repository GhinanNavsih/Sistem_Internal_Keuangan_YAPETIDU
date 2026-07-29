export const PAYROLL_TIME_ZONE = 'Asia/Jakarta';
export const SATPAM_RATE_VERSION = 'SATPAM-2026-V1';
export const SATPAM_HOLIDAY_CALENDAR_VERSION = 'ID-UNIPDU-2026-V1';

export const SATPAM_POSTS = [
  { id: 'Pos 1', name: 'Pos IC' },
  { id: 'Pos 2', name: 'Pos Stasiun' },
  { id: 'Pos 3', name: 'Pos ATM Graha' },
  { id: 'Pos 4', name: 'Pos Plaza' },
  { id: 'Pos 5', name: 'Pos Masjid Induk' },
  { id: 'Pos 6', name: 'Pos Gor' },
  { id: 'Pos 7', name: 'Pos Saintek' },
  { id: 'Pos 8', name: 'Pos Parkiran FIK' },
  { id: 'Pos 9', name: 'Pos Hurun-inn' },
] as const;

export type SatpamPostId = (typeof SATPAM_POSTS)[number]['id'];
export type SatpamShiftName = 'Pagi' | 'Sore' | 'Malam';
export type SatpamPayType =
  | 'Harian'
  | 'Jumat & Libur'
  | 'Lembur Sendiri'
  | 'Lembur Cover'
  | 'Off-Duty';

export type PayrollStatus =
  | 'draft'
  | 'finance_verified'
  | 'kbu_approved'
  | 'locked'
  | 'payment_created'
  | 'paid';

export interface MoneyField {
  label: string;
  amount: number;
}

/** Immutable audit evidence captured from the original image before upload compression. */
export interface PhotoAuditMetadata {
  capturedAt: string | null;
  latitude: number | null;
  longitude: number | null;
  deviceName: string | null;
  hasExif: boolean;
  locationName: string | null;
  locationAddress: string | null;
  locationPlaceId: string | null;
}

export interface PhotoEvidence {
  url: string;
  auditMetadata: PhotoAuditMetadata;
}

export interface SatpamPrimaryAssignmentInput {
  postId: SatpamPostId;
  employeeId: string;
  shiftType?: SatpamPayType;
  coveredEmployeeId?: string;
  overtimeReason?: string;
  photoUrl?: string;
  photoAuditMetadata?: PhotoAuditMetadata;
}

export interface SatpamExtraAssignmentInput {
  postId: SatpamPostId;
  employeeId: string;
  overtimeReason: string;
  photoUrl?: string;
  photoAuditMetadata?: PhotoAuditMetadata;
}

export interface SubmitSatpamShiftInput {
  requestId: string;
  dutyDate: string;
  assignments: SatpamPrimaryAssignmentInput[];
  extraAssignment?: SatpamExtraAssignmentInput;
}

export interface SatpamActivityLike {
  id?: string;
  employeeId?: string;
  activityDate?: string;
  shiftName?: string;
  postName?: string;
  shiftType?: string;
  sourceOccurrenceId?: string;
  sourceLedgerEntryId?: string;
  fee?: number;
  status?: string;
}

export const SATPAM_RATES: Readonly<Record<SatpamPayType, number>> = Object.freeze({
  Harian: 12_500,
  'Jumat & Libur': 25_000,
  'Lembur Sendiri': 30_000,
  'Lembur Cover': 50_000,
  'Off-Duty': 0,
});

export const SHIFT_TIMES: Readonly<
  Record<SatpamShiftName, { start: string; end: string; endDayOffset: 0 | 1 }>
> = Object.freeze({
  Pagi: { start: '08:00', end: '14:00', endDayOffset: 0 },
  Sore: { start: '14:00', end: '22:00', endDayOffset: 0 },
  Malam: { start: '22:00', end: '08:00', endDayOffset: 1 },
});

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const SAFE_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;

export function assertDateOnly(value: string): void {
  const match = DATE_RE.exec(value);
  if (!match) {
    throw new Error('Tanggal wajib menggunakan format YYYY-MM-DD.');
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error('Tanggal kalender tidak valid.');
  }
}

export function assertRequestId(value: string): void {
  if (!SAFE_ID_RE.test(value)) {
    throw new Error('ID permintaan tidak valid.');
  }
}

/**
 * Storage prefix for guard-post proof photos. Keyed by the uploading Ketua
 * Shift so Storage rules can verify ownership without the ShiftOccurrence
 * document existing yet — photos are taken while the form is still a draft.
 */
export function satpamPhotoFolder(ketuaShiftId: string): string {
  return `satpam_shifts/${safeDocumentPart(ketuaShiftId)}`;
}

/** Storage prefix for proof images attached to a regular Pekarya SPJ. */
export function pekaryaActivityProofFolder(employeeId: string): string {
  return `activity_proofs/${safeDocumentPart(employeeId)}`;
}

/**
 * Guard-post photos are optional, but any URL that is supplied must point at
 * the submitting Ketua Shift's own Storage folder. This stops a forged payload
 * from attaching an arbitrary remote image as evidence.
 */
export function assertSatpamPhotoUrl(value: string, ketuaShiftId: string): void {
  if (typeof value !== 'string' || value.length > 1500) {
    throw new Error('URL foto bukti tidak valid.');
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('URL foto bukti tidak valid.');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('URL foto bukti wajib menggunakan HTTPS.');
  }
  if (!/(^|\.)googleapis\.com$/.test(parsed.hostname)) {
    throw new Error('Foto bukti wajib diunggah ke Firebase Storage.');
  }
  // Firebase download URLs percent-encode the object path, e.g.
  // /o/satpam_shifts%2FEMP001%2Fpos-1.jpg?alt=media&token=...
  const objectPath = decodeURIComponent(parsed.pathname);
  if (!objectPath.includes(`/o/${satpamPhotoFolder(ketuaShiftId)}/`)) {
    throw new Error('Foto bukti berada di luar folder Ketua Shift ini.');
  }
}

export function assertPekaryaActivityProofUrl(value: string, employeeId: string): void {
  if (typeof value !== 'string' || value.length > 1500) {
    throw new Error('URL foto bukti tidak valid.');
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('URL foto bukti tidak valid.');
  }
  if (parsed.protocol !== 'https:' || !/(^|\.)googleapis\.com$/.test(parsed.hostname)) {
    throw new Error('Foto bukti wajib diunggah ke Firebase Storage.');
  }
  if (!decodeURIComponent(parsed.pathname).includes(`/o/${pekaryaActivityProofFolder(employeeId)}/`)) {
    throw new Error('Foto bukti berada di luar folder Pekarya ini.');
  }
}

export function addCalendarDays(dateOnly: string, days: number): string {
  assertDateOnly(dateOnly);
  const [year, month, day] = dateOnly.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

export function isFridayDutyDate(dateOnly: string): boolean {
  assertDateOnly(dateOnly);
  const [year, month, day] = dateOnly.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() === 5;
}

/**
 * The single payroll-period rule for every Pekarya category, Satpam included:
 * - through June 2026: the 26th of the previous month through the 25th,
 * - July 2026 transition: 26 June through 31 July,
 * - August 2026 onward: the plain calendar month.
 *
 * Payment always falls on the 5th of the month after the period closes.
 *
 * This lives in the base module so `pekaryaPayrollPeriodForDate` can delegate
 * to it. Satpam previously sliced the calendar month here, which silently
 * dropped duties on the 26th-31st out of the payroll window they belonged to.
 */
export function payrollPeriodForDutyDate(dateOnly: string): string {
  assertDateOnly(dateOnly);
  if (dateOnly >= '2026-06-26' && dateOnly <= '2026-07-31') return '2026-07';
  if (dateOnly >= '2026-08-01') return dateOnly.slice(0, 7);

  const [year, month, day] = dateOnly.split('-').map(Number);
  if (day <= 25) return `${year}-${String(month).padStart(2, '0')}`;
  const next = new Date(Date.UTC(year, month, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function getRegularSatpamPayType(
  dateOnly: string,
  nationalHolidayDates: ReadonlySet<string>,
): 'Harian' | 'Jumat & Libur' {
  return isFridayDutyDate(dateOnly) || nationalHolidayDates.has(dateOnly)
    ? 'Jumat & Libur'
    : 'Harian';
}

/**
 * Server-side authority for what a single post assignment actually gets paid.
 * A Ketua Shift may only toggle between the guard's ordinary duty rate
 * (`regularPayType`, itself derived from the real dutyDate + holiday calendar
 * by `getRegularSatpamPayType`) and 'Lembur Cover' when a documented
 * substitution is attached — never an arbitrary rate. `requestedShiftType`
 * comes straight from client input and must be treated as untrusted: any
 * value other than the literal string 'Lembur Cover' is ignored.
 *
 * `isExternalGuard` (the assignee is not one of this team's 10 roster
 * members) always forces 'Lembur Cover' regardless of what was requested,
 * since an external guard's presence is itself proof of a substitution.
 */
export function resolveSatpamAssignmentPayType(
  requestedShiftType: string | undefined,
  isExternalGuard: boolean,
  regularPayType: 'Harian' | 'Jumat & Libur',
): SatpamPayType {
  const isCoverAssignment = isExternalGuard || requestedShiftType === 'Lembur Cover';
  return isCoverAssignment ? 'Lembur Cover' : regularPayType;
}

export function getShiftIsoBounds(
  dutyDate: string,
  shiftName: SatpamShiftName,
): { startsAtIso: string; endsAtIso: string } {
  assertDateOnly(dutyDate);
  const shift = SHIFT_TIMES[shiftName];
  const endDate = addCalendarDays(dutyDate, shift.endDayOffset);
  return {
    startsAtIso: `${dutyDate}T${shift.start}:00+07:00`,
    endsAtIso: `${endDate}T${shift.end}:00+07:00`,
  };
}

function safeDocumentPart(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_');
}

export function shiftOccurrenceId(
  teamId: string,
  dutyDate: string,
  shiftName: SatpamShiftName,
): string {
  assertDateOnly(dutyDate);
  return `${safeDocumentPart(teamId)}__${dutyDate.replaceAll('-', '')}__${shiftName.toLowerCase()}`;
}

export function guardDutyIndexId(
  dutyDate: string,
  shiftName: SatpamShiftName,
  employeeId: string,
): string {
  return `${dutyDate.replaceAll('-', '')}__${shiftName.toLowerCase()}__${safeDocumentPart(employeeId)}`;
}

export function activityReportId(
  occurrenceId: string,
  employeeId: string,
  assignmentKey: string,
): string {
  return `SAT-${safeDocumentPart(occurrenceId)}-${safeDocumentPart(employeeId)}-${safeDocumentPart(assignmentKey)}`;
}

export function validateMoneyFields(fields: unknown, fieldName: string): MoneyField[] {
  if (!Array.isArray(fields) || fields.length > 100) {
    throw new Error(`${fieldName} tidak valid.`);
  }
  return fields.map((field, index) => {
    if (!field || typeof field !== 'object') {
      throw new Error(`${fieldName}[${index}] tidak valid.`);
    }
    const candidate = field as Partial<MoneyField>;
    const label = typeof candidate.label === 'string' ? candidate.label.trim() : '';
    const amount = candidate.amount;
    if (!label || label.length > 120) {
      throw new Error(`${fieldName}[${index}].label tidak valid.`);
    }
    if (
      typeof amount !== 'number' ||
      !Number.isSafeInteger(amount) ||
      amount < 0 ||
      amount > 100_000_000_000
    ) {
      throw new Error(`${fieldName}[${index}].amount tidak valid.`);
    }
    return { label, amount };
  });
}

export function calculatePayrollTotals(
  earnings: readonly MoneyField[],
  deductions: readonly MoneyField[],
): { totalEarnings: number; totalDeductions: number; netSalary: number } {
  const totalEarnings = earnings.reduce((total, item) => total + item.amount, 0);
  const totalDeductions = deductions.reduce((total, item) => total + item.amount, 0);
  if (!Number.isSafeInteger(totalEarnings) || !Number.isSafeInteger(totalDeductions)) {
    throw new Error('Total payroll melampaui batas bilangan aman.');
  }
  const netSalary = totalEarnings - totalDeductions;
  if (netSalary < 0) {
    throw new Error('Gaji bersih tidak boleh negatif.');
  }
  return { totalEarnings, totalDeductions, netSalary };
}

/**
 * Read-only compatibility guard for legacy records. It never changes Firestore.
 * New records are unique by source ledger ID. Legacy records fall back to the
 * smallest stable financial identity available in the historical schema.
 */
export function dedupeSatpamActivityReports<T extends SatpamActivityLike>(
  reports: readonly T[],
): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const report of reports) {
    const key =
      report.sourceLedgerEntryId ||
      [
        'legacy',
        report.employeeId || '',
        report.activityDate || '',
        report.shiftName || '',
        report.postName || '',
        report.shiftType || '',
      ].join('|');

    if (seen.has(key)) continue;
    seen.add(key);
    result.push(report);
  }
  return result;
}

export function isImmutablePayrollStatus(status: unknown): boolean {
  return (
    status === 'confirmed' ||
    status === 'locked' ||
    status === 'payment_created' ||
    status === 'paid'
  );
}

export function isTransferEligibleStatus(status: unknown): boolean {
  return isImmutablePayrollStatus(status);
}
