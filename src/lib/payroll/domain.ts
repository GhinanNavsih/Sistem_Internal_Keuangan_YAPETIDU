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

export type SatpamReportKind =
  | 'satpam_spj'
  | 'satpam_found_item'
  | 'satpam_reprimand'
  | 'satpam_shift_assignment';

export function isSatpamPersonalSpjReportKind(
  value: unknown,
): value is Extract<
  SatpamReportKind,
  'satpam_spj' | 'satpam_found_item' | 'satpam_reprimand'
> {
  return (
    value === 'satpam_spj' ||
    value === 'satpam_found_item' ||
    value === 'satpam_reprimand'
  );
}

export type SatpamShiftAnomalyCode =
  | 'MISSING_POSTS'
  | 'DUPLICATE_POST'
  | 'DUPLICATE_GUARD'
  | 'KETUA_NOT_ASSIGNED'
  | 'ROTA_MISMATCH'
  | 'COVER_DETAILS_INCOMPLETE'
  | 'MISSING_PHOTO'
  | 'INACTIVE_OR_MISMATCHED_GUARD'
  | 'HOLIDAY_CALENDAR_MISSING'
  | 'PAY_CLASSIFICATION_MISMATCH'
  | 'DUTY_PLAN_MISSING'
  | 'DUTY_PLAN_STALE'
  | 'DUTY_PLAN_BACKFILL_PENDING'
  | 'ACTUAL_ROSTER_DIFFERS'
  | 'POS9_GUARD_MISMATCH'
  | 'EXTRA_NOT_OFF_DUTY'
  | 'EXTRA_WITH_INCOMPLETE_PRIMARY_ROSTER'
  | 'ABSENCE_WORK_CONFLICT'
  | 'DUTY_PLAN_CHANGED_AFTER_REPORT';

export interface SatpamShiftAnomaly {
  code: SatpamShiftAnomalyCode;
  severity: 'warning' | 'blocking';
  message: string;
  assignmentIndexes?: number[];
}

export type PayrollStatus =
  | 'draft'
  | 'locked'
  | 'payment_created'
  | 'paid';

export interface MoneyField {
  label: string;
  amount: number;
}

/**
 * A `PayrollSlipStates/{period}_{employeeId}` document.
 *
 * This collection holds the slip's money rows, not just its status, and had no
 * type at all — every route handled it as an untyped record. The fields here
 * are the ones the writers actually produce (slips/route.ts save_draft,
 * create_payment and mark_paid, payrollKoperasiSaga.verifyAndLockWithKoperasi,
 * the uraian/profile propagation routes, send-email and
 * historical-spj-correction). It is deliberately open-ended: it describes
 * documents rather than constraining them, so it can be adopted incrementally
 * without forcing a data migration.
 *
 * On `status`: PayrollStatus covers everything currently writable, but slips
 * predating it can still carry `'confirmed'`, which is why
 * isImmutablePayrollStatus and the employee payslip query both still accept it.
 * Treat that value as read-only legacy, never as a new target state.
 */
export interface PayrollSlipStateDocument {
  employeeId?: string;
  period?: string;
  status?: PayrollStatus | 'confirmed';
  earnings?: MoneyField[];
  deductions?: MoneyField[];
  totalEarnings?: number;
  totalDeductions?: number;
  netSalary?: number;
  revision?: number;
  generatedAt?: unknown;
  updatedAt?: unknown;
  updatedBy?: string;
  verifiedAt?: unknown;
  verifiedBy?: string;
  lockedAt?: unknown;
  lockedBy?: string;
  lockedSnapshotHash?: string;
  lockedSnapshot?: unknown;
  paymentBatchId?: string;
  paymentCreatedAt?: unknown;
  paymentCreatedBy?: string;
  bankReference?: string;
  paidAt?: unknown;
  paidBy?: string;
  /** Owned solely by POST /api/payroll/send-email. */
  emailSent?: boolean;
  emailSentAt?: unknown;
  emailSentBy?: string;
  koperasiInstallmentPlan?: unknown;
  koperasiProgressionReceipt?: unknown;
  closureRepair?: unknown;
  lastHistoricalCorrection?: unknown;
  schemaVersion?: number;
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
  shiftType?: Exclude<SatpamPayType, 'Off-Duty'>;
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
  shiftName?: SatpamShiftName;
  occurrenceId?: string;
  expectedRevision?: number;
  dutyPlanId?: string;
  dutyPlanRevision?: number;
  assignments: SatpamPrimaryAssignmentInput[];
  extraAssignment?: SatpamExtraAssignmentInput;
}

export interface SatpamActivityLike {
  id?: string;
  employeeId?: string;
  reportKind?: string;
  sourceType?: string;
  assignmentKind?: string;
  activityDate?: string;
  shiftName?: string;
  postId?: string;
  postName?: string;
  shiftType?: string;
  ketuaShiftId?: string;
  sourceOccurrenceId?: string;
  sourceLedgerEntryId?: string;
  fee?: number;
  status?: string;
}

/**
 * Migration-only classification for legacy Satpam reports. New writes must
 * always persist reportKind explicitly.
 */
export function inferLegacySatpamReportKind(
  report: SatpamActivityLike,
): SatpamReportKind {
  if (
    report.reportKind === 'satpam_spj' ||
    report.reportKind === 'satpam_found_item' ||
    report.reportKind === 'satpam_reprimand' ||
    report.reportKind === 'satpam_shift_assignment'
  ) {
    return report.reportKind;
  }
  return report.sourceOccurrenceId ||
    report.sourceType === 'satpam_shift' ||
    report.assignmentKind ||
    report.postId ||
    report.postName ||
    report.ketuaShiftId ||
    report.shiftName ||
    report.shiftType
    ? 'satpam_shift_assignment'
    : 'satpam_spj';
}

export interface SatpamPayrollContribution {
  personalSpj: number;
  harianCount: number;
  jumatLiburCount: number;
  lemburSendiriCount: number;
  lemburCoverCount: number;
}

export function summarizeApprovedSatpamReports(
  input: readonly SatpamActivityLike[],
): SatpamPayrollContribution {
  const summary: SatpamPayrollContribution = {
    personalSpj: 0,
    harianCount: 0,
    jumatLiburCount: 0,
    lemburSendiriCount: 0,
    lemburCoverCount: 0,
  };
  for (const report of dedupeSatpamActivityReports(input)) {
    if (report.status !== 'approved') continue;
    if (
      isSatpamPersonalSpjReportKind(inferLegacySatpamReportKind(report))
    ) {
      const fee = Number(report.fee || 0);
      if (Number.isFinite(fee) && fee > 0) summary.personalSpj += fee;
      continue;
    }
    if (report.shiftType === 'Harian') summary.harianCount += 1;
    if (report.shiftType === 'Jumat & Libur') summary.jumatLiburCount += 1;
    if (report.shiftType === 'Lembur Sendiri') summary.lemburSendiriCount += 1;
    if (report.shiftType === 'Lembur Cover') summary.lemburCoverCount += 1;
  }
  return summary;
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

/**
 * Payment falls on the 5th, so during the first days of a month the operator is
 * still compiling the month that just ended. The payroll page therefore opens
 * on the previous period until the 6th — unless that period has already been
 * closed permanently, in which case the current month is the one still live.
 */
export const PAYROLL_COMPILATION_CUTOFF_DAY = 6;

export function defaultPayrollPeriodToken(
  now: Date,
  previousPeriodClosed: boolean,
): string {
  const currentToken = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (now.getDate() >= PAYROLL_COMPILATION_CUTOFF_DAY || previousPeriodClosed) {
    return currentToken;
  }
  const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, '0')}`;
}

export function previousPayrollPeriodToken(now: Date): string {
  const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, '0')}`;
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
 * An external Satpam substitution defaults to the ordinary `Harian` rate.
 * The Ketua Shift may explicitly choose `Lembur Cover` when the assignment
 * is genuinely covering a missing team member. The request is still treated
 * as untrusted: no other client-supplied rate can override the calendar.
 */
export function resolveSatpamAssignmentPayType(
  requestedShiftType: string | undefined,
  isExternalGuard: boolean,
  regularPayType: 'Harian' | 'Jumat & Libur',
): SatpamPayType {
  if (isExternalGuard) return resolveExternalSatpamPayType(requestedShiftType);
  const isCoverAssignment = requestedShiftType === 'Lembur Cover';
  return isCoverAssignment ? 'Lembur Cover' : regularPayType;
}

/**
 * Pay classification for a Satpam who is not in the Ketua Shift's roster.
 * Cross-team substitutions are intentionally flexible: they begin as
 * Harian, while a Ketua may opt into Lembur Cover. Lembur Sendiri remains a
 * Pos 9-only exception and is handled by `resolveCrossTeamPos9PayType`.
 */
export function resolveExternalSatpamPayType(
  requestedShiftType: string | undefined,
): Exclude<SatpamPayType, 'Off-Duty'> {
  return requestedShiftType === 'Lembur Cover' ? 'Lembur Cover' : 'Harian';
}

/**
 * The Ketua Shift's own primary assignment follows the same Friday/holiday
 * calendar rate as an ordinary guard's post, with an explicit choice of
 * Harian or Lembur Sendiri overriding that calendar suggestion.
 */
export function resolveKetuaSatpamPayType(
  requestedShiftType: string | undefined,
  regularPayType: 'Harian' | 'Jumat & Libur',
): 'Harian' | 'Jumat & Libur' | 'Lembur Sendiri' {
  if (requestedShiftType === 'Lembur Sendiri') return 'Lembur Sendiri';
  if (requestedShiftType === 'Harian') return 'Harian';
  return regularPayType;
}

/**
 * A designated Pos 9 Satpam may use Lembur Sendiri on their own Pos 9
 * assignment. When no explicit choice is supplied, retain the calendar rate;
 * an explicit Harian choice remains Harian even on a premium date.
 */
export function resolveDesignatedPos9PayType(
  requestedShiftType: string | undefined,
  regularPayType: 'Harian' | 'Jumat & Libur',
): 'Harian' | 'Jumat & Libur' | 'Lembur Sendiri' {
  if (requestedShiftType === 'Lembur Sendiri') return 'Lembur Sendiri';
  if (requestedShiftType === 'Harian') return 'Harian';
  return regularPayType;
}

/**
 * Pos 9 is staffed by one guard from each published team plan. If a Ketua
 * selects one of the other teams' Pos 9 guards, the form defaults to Harian,
 * but the guard may explicitly be paid as Lembur Sendiri or Lembur Cover.
 * This exception retains the Pos 9-only Lembur Sendiri option while all
 * other external substitutions use Harian or Lembur Cover.
 */
export function resolveCrossTeamPos9PayType(
  requestedShiftType: string | undefined,
): Exclude<SatpamPayType, 'Off-Duty'> {
  if (requestedShiftType === 'Lembur Sendiri') return 'Lembur Sendiri';
  return resolveExternalSatpamPayType(requestedShiftType);
}

/**
 * The pay type a reporting form must seed for a post assignment before the
 * Ketua Shift makes any explicit choice.
 *
 * Reporting forms have to send *some* shiftType, and every resolver above
 * treats an explicit 'Harian' as a deliberate override that beats the work
 * calendar. A form that seeds 'Harian' on a Friday or national holiday
 * therefore does not merely show the wrong default — it silently pays the
 * ordinary rate to a guard who earned the premium one. Seeding must go through
 * here so the form and the resolvers cannot drift apart.
 *
 * A guard from outside the regu, including a cross-team Pos 9 guard, is paid on
 * the substitution ladder, which has no 'Jumat & Libur' rung, so Harian is
 * genuinely their default. Everyone on ordinary duty follows the calendar —
 * the Ketua Shift's own post and an in-roster designated Pos 9 included,
 * because `resolveKetuaSatpamPayType` and `resolveDesignatedPos9PayType` both
 * fall back to `regularPayType`.
 */
export function defaultSatpamAssignmentPayType(
  isExternalGuard: boolean,
  regularPayType: 'Harian' | 'Jumat & Libur',
): 'Harian' | 'Jumat & Libur' {
  return isExternalGuard ? 'Harian' : regularPayType;
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

export function hasSatpamShiftEnded(
  dutyDate: string,
  shiftName: SatpamShiftName,
  now: Date = new Date(),
): boolean {
  const { endsAtIso } = getShiftIsoBounds(dutyDate, shiftName);
  return new Date(endsAtIso).getTime() <= now.getTime();
}

export function hasActivityEnded(
  activityDate: string,
  timeStart: string,
  timeEnd: string,
  now: Date = new Date(),
): boolean {
  assertDateOnly(activityDate);
  if (
    !/^([01]\d|2[0-3]):([0-5]\d)$/.test(timeStart) ||
    !/^([01]\d|2[0-3]):([0-5]\d)$/.test(timeEnd)
  ) {
    return false;
  }
  const endDate = timeEnd <= timeStart ? addCalendarDays(activityDate, 1) : activityDate;
  return new Date(`${endDate}T${timeEnd}:00+07:00`).getTime() <= now.getTime();
}

export function satpamKetuaEditConflict(input: {
  status: unknown;
  auditorActionAt?: unknown;
  revision: unknown;
  expectedRevision: number;
}): 'auditor_locked' | 'stale_revision' | null {
  if (input.auditorActionAt || input.status !== 'pending_review') {
    return 'auditor_locked';
  }
  if (Number(input.revision || 1) !== input.expectedRevision) {
    return 'stale_revision';
  }
  return null;
}

export function analyzeSatpamShiftSubmission(input: {
  dutyDate: string;
  reportedShiftName: SatpamShiftName;
  suggestedShiftName: SatpamShiftName;
  ketuaShiftId: string;
  assignments: readonly SatpamPrimaryAssignmentInput[];
  activeSatpamIds?: ReadonlySet<string>;
  pos9GuardIds?: ReadonlySet<string>;
  holidayCalendarConfigured?: boolean;
}): SatpamShiftAnomaly[] {
  const anomalies: SatpamShiftAnomaly[] = [];
  const postIndexes = new Map<string, number[]>();
  const guardIndexes = new Map<string, number[]>();

  input.assignments.forEach((assignment, index) => {
    if (!postIndexes.has(assignment.postId)) postIndexes.set(assignment.postId, []);
    postIndexes.get(assignment.postId)!.push(index);
    if (!guardIndexes.has(assignment.employeeId)) guardIndexes.set(assignment.employeeId, []);
    guardIndexes.get(assignment.employeeId)!.push(index);
  });

  if (input.pos9GuardIds && input.pos9GuardIds.size > 0) {
    const invalidPos9Indexes = input.assignments.flatMap((assignment, index) =>
      assignment.postId === 'Pos 9' && !input.pos9GuardIds!.has(assignment.employeeId)
        ? [index]
        : [],
    );
    if (invalidPos9Indexes.length > 0) {
      anomalies.push({
        code: 'POS9_GUARD_MISMATCH',
        severity: 'warning',
        message: 'Pos 9 diisi petugas pengganti, bukan salah satu dari tiga Pos 9 Satpam yang ditetapkan dalam rencana regu. Periksa substitusi ini.',
        assignmentIndexes: invalidPos9Indexes,
      });
    }
  }

  const suppliedPosts = new Set(input.assignments.map((assignment) => assignment.postId));
  const missingPosts = SATPAM_POSTS.filter((post) => !suppliedPosts.has(post.id));
  if (missingPosts.length > 0) {
    anomalies.push({
      code: 'MISSING_POSTS',
      severity: 'warning',
      message: `${missingPosts.length} pos belum memiliki petugas.`,
    });
  }

  const duplicatePostIndexes = Array.from(postIndexes.values()).filter(
    (indexes) => indexes.length > 1,
  );
  if (duplicatePostIndexes.length > 0) {
    anomalies.push({
      code: 'DUPLICATE_POST',
      severity: 'blocking',
      message: 'Ada pos yang dicatat lebih dari satu kali.',
      assignmentIndexes: duplicatePostIndexes.flat(),
    });
  }

  const duplicateGuardIndexes = Array.from(guardIndexes.values()).filter(
    (indexes) => indexes.length > 1,
  );
  if (duplicateGuardIndexes.length > 0) {
    anomalies.push({
      code: 'DUPLICATE_GUARD',
      severity: 'blocking',
      message: 'Ada petugas yang dicatat lebih dari satu kali pada shift yang sama.',
      assignmentIndexes: duplicateGuardIndexes.flat(),
    });
  }

  if (
    !input.assignments.some((assignment) => assignment.employeeId === input.ketuaShiftId)
  ) {
    anomalies.push({
      code: 'KETUA_NOT_ASSIGNED',
      severity: 'warning',
      message: 'Ketua Shift tidak tercatat menjaga salah satu pos.',
    });
  }

  if (input.reportedShiftName !== input.suggestedShiftName) {
    anomalies.push({
      code: 'ROTA_MISMATCH',
      severity: 'warning',
      message: `Shift yang dilaporkan (${input.reportedShiftName}) berbeda dari saran rota (${input.suggestedShiftName}).`,
    });
  }

  const incompleteCoverIndexes = input.assignments.flatMap((assignment, index) =>
    assignment.shiftType === 'Lembur Cover' && !assignment.coveredEmployeeId
      ? [index]
      : [],
  );
  if (incompleteCoverIndexes.length > 0) {
    anomalies.push({
      code: 'COVER_DETAILS_INCOMPLETE',
      severity: 'blocking',
      message: 'Ada Lembur Cover yang belum menyebut petugas yang digantikan.',
      assignmentIndexes: incompleteCoverIndexes,
    });
  }

  const missingPhotoIndexes = input.assignments.flatMap((assignment, index) =>
    assignment.photoUrl ? [] : [index],
  );
  if (missingPhotoIndexes.length > 0) {
    anomalies.push({
      code: 'MISSING_PHOTO',
      severity: 'warning',
      message: `${missingPhotoIndexes.length} penugasan tidak memiliki foto bukti.`,
      assignmentIndexes: missingPhotoIndexes,
    });
  }

  if (input.activeSatpamIds) {
    const inactiveIndexes = input.assignments.flatMap((assignment, index) =>
      input.activeSatpamIds!.has(assignment.employeeId) ? [] : [index],
    );
    if (inactiveIndexes.length > 0) {
      anomalies.push({
        code: 'INACTIVE_OR_MISMATCHED_GUARD',
        severity: 'blocking',
        message: 'Ada petugas yang status aktif atau kategori Satpam-nya belum sesuai.',
        assignmentIndexes: inactiveIndexes,
      });
    }
  }

  if (input.holidayCalendarConfigured === false) {
    anomalies.push({
      code: 'HOLIDAY_CALENDAR_MISSING',
      severity: 'blocking',
      message: 'Kalender hari libur belum tersedia sehingga tarif belum dapat dipastikan.',
    });
  }

  return anomalies;
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
      (isSatpamPersonalSpjReportKind(report.reportKind) ||
      (!report.reportKind && !report.sourceOccurrenceId && !report.shiftType)
        ? report.id
        : undefined) ||
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
