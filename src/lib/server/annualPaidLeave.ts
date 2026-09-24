import { createHash } from 'node:crypto';
import { adminDb } from '@/lib/firebase-admin';
import type { AuthenticatedProfile } from '@/lib/server/auth';
import { HttpError } from '@/lib/server/auth';
import {
  annualPaidLeaveBalanceId,
  annualPaidLeaveQualifyingDate,
  canReviewAnnualPaidLeave,
  type AnnualPaidLeaveEmployeeKind,
  type AnnualPaidLeaveRequest,
} from '@/lib/payroll/annualPaidLeave';
import { pekaryaPayrollPeriodForDate } from '@/lib/payroll/pekaryaSpj';
import { isFridayDate } from '@/lib/payroll/attendance';
import {
  applyApprovedPaidLeaveToLoyalisEntry,
  type LoyalisPaidLeaveEntry,
} from '@/lib/payroll/loyalisPaidLeave';
import { loadApprovedGantiLiburDayOffs } from '@/lib/server/gantiLibur';

export const ANNUAL_PAID_LEAVE_REQUESTS_COLLECTION =
  'AnnualPaidLeaveRequests';
export const ANNUAL_PAID_LEAVE_BALANCES_COLLECTION =
  'AnnualPaidLeaveBalances';
export const ANNUAL_PAID_LEAVE_REVISIONS_COLLECTION =
  'AnnualPaidLeaveRequestRevisions';
export const ANNUAL_PAID_LEAVE_BALANCE_REVISIONS_COLLECTION =
  'AnnualPaidLeaveBalanceRevisions';
export const ANNUAL_PAID_LEAVE_PAYROLL_POSTS_COLLECTION =
  'AnnualPaidLeavePayrollPosts';

export interface AnnualPaidLeaveEmployee {
  id: string;
  name: string;
  kind: AnnualPaidLeaveEmployeeKind;
  collection: 'Employees_Loyalis' | 'Employees_BlueCollar';
  category: string;
  serviceDate: string;
  qualifyingDate: string;
  active: boolean;
  raw: FirebaseFirestore.DocumentData;
}

export function annualPaidLeaveEmployeeDataMatches(
  employee: AnnualPaidLeaveEmployee,
  data: FirebaseFirestore.DocumentData,
): boolean {
  const isLoyalis = employee.kind === 'loyalis';
  const serviceDate = dateValueToIso(
    isLoyalis
      ? data.employment_profile?.date_recognized
      : data.employment?.startDate,
  );
  const category = isLoyalis
    ? 'LOYALIS'
    : normalizeCategory(data.employment?.jobCategory);
  const active = isLoyalis
    ? normalizeCategory(data.personal_info?.status) === 'AKTIF'
    : data.employment?.status === 'active' &&
      data.flags?.isActive !== false &&
      data.flags?.isPayrollEligible !== false;
  return (
    active &&
    serviceDate === employee.serviceDate &&
    category === employee.category
  );
}

function dateValueToIso(value: unknown): string {
  let date: Date | null = null;
  if (value instanceof Date) {
    date = value;
  } else if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as { toDate?: unknown }).toDate === 'function'
  ) {
    date = (value as { toDate: () => Date }).toDate();
  } else if (typeof value === 'string') {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
    if (match) return match[1];
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) date = parsed;
  }
  if (!date || !Number.isFinite(date.getTime())) return '';
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function normalizeCategory(value: unknown): string {
  return String(value || '').trim().toUpperCase();
}

export function annualPaidLeaveEmployeeFromData(
  employeeId: string,
  kind: AnnualPaidLeaveEmployeeKind,
  data: FirebaseFirestore.DocumentData,
): AnnualPaidLeaveEmployee | null {
  const isLoyalis = kind === 'loyalis';
  const serviceDate = dateValueToIso(
    isLoyalis
      ? data.employment_profile?.date_recognized
      : data.employment?.startDate,
  );
  if (!serviceDate) return null;
  return {
    id: employeeId,
    name: String((isLoyalis ? data.personal_info?.name : data.name) || '').trim(),
    kind,
    collection: isLoyalis ? 'Employees_Loyalis' : 'Employees_BlueCollar',
    category: isLoyalis ? 'LOYALIS' : normalizeCategory(data.employment?.jobCategory),
    serviceDate,
    qualifyingDate: annualPaidLeaveQualifyingDate(serviceDate),
    active: isLoyalis
      ? normalizeCategory(data.personal_info?.status) === 'AKTIF'
      : data.employment?.status === 'active' &&
        data.flags?.isActive !== false &&
        data.flags?.isPayrollEligible !== false,
    raw: data,
  };
}

export async function loadAnnualPaidLeaveEmployee(
  employeeId: string,
  preferredKind?: AnnualPaidLeaveEmployeeKind,
): Promise<AnnualPaidLeaveEmployee | null> {
  const loyalisRef = adminDb.collection('Employees_Loyalis').doc(employeeId);
  const blueRef = adminDb.collection('Employees_BlueCollar').doc(employeeId);
  const refs = preferredKind === 'loyalis'
    ? [loyalisRef]
    : preferredKind === 'blue_collar'
      ? [blueRef]
      : [loyalisRef, blueRef];
  const snapshots = await adminDb.getAll(...refs);
  for (const snapshot of snapshots) {
    if (!snapshot.exists) continue;
    const data = snapshot.data() || {};
    const isLoyalis = snapshot.ref.parent.id === 'Employees_Loyalis';
    const employee = annualPaidLeaveEmployeeFromData(
      snapshot.id,
      isLoyalis ? 'loyalis' : 'blue_collar',
      data,
    );
    if (!employee) {
      throw new HttpError(
        409,
        isLoyalis
          ? 'Tanggal pengakuan masa kerja Loyalis belum diisi.'
          : 'Tanggal mulai kerja Pekarya belum diisi.',
      );
    }
    return employee;
  }
  return null;
}

export async function requireSelfAnnualPaidLeaveEmployee(
  actor: AuthenticatedProfile,
): Promise<AnnualPaidLeaveEmployee> {
  if (!actor.linkedEmployeeId) {
    throw new HttpError(403, 'Akun belum terhubung ke data pegawai.');
  }
  const kind = actor.role === 'loyalis'
    ? 'loyalis'
    : actor.role === 'honorer' || actor.role === 'ketua_shift_satpam'
      ? 'blue_collar'
      : null;
  if (!kind) {
    throw new HttpError(403, 'Peran ini tidak dapat mengajukan cuti tahunan.');
  }
  const employee = await loadAnnualPaidLeaveEmployee(actor.linkedEmployeeId, kind);
  if (!employee || !employee.active) {
    throw new HttpError(409, 'Data pegawai aktif tidak ditemukan.');
  }
  if (employee.kind === 'blue_collar' && !employee.category) {
    throw new HttpError(409, 'Kategori pekerjaan Pekarya belum diisi.');
  }
  return employee;
}

export function annualPaidLeavePeriod(
  employeeKind: AnnualPaidLeaveEmployeeKind,
  leaveDate: string,
): string {
  return employeeKind === 'loyalis'
    ? leaveDate.slice(0, 7)
    : pekaryaPayrollPeriodForDate(leaveDate);
}

export function annualPaidLeaveDocumentId(employeeId: string, leaveDate: string): string {
  return createHash('sha256').update(`${employeeId}|${leaveDate}`).digest('hex');
}

export function annualPaidLeaveBalanceDocumentId(
  employeeId: string,
  year: number,
): string {
  return annualPaidLeaveBalanceId(employeeId, year);
}

export async function loadEmployeeAnnualPaidLeaveRequests(
  employeeId: string,
  year: number,
): Promise<AnnualPaidLeaveRequest[]> {
  const snapshot = await adminDb
    .collection(ANNUAL_PAID_LEAVE_REQUESTS_COLLECTION)
    .where('employeeId', '==', employeeId)
    .get();
  return snapshot.docs
    .map((document) => {
      const data = document.data();
      return {
        id: document.id,
        ...data,
        qualifyingDate: annualPaidLeaveQualifyingDate(String(data.serviceDate || '')),
      } as AnnualPaidLeaveRequest;
    })
    .filter((request) => request.year === year)
    .sort((left, right) => right.leaveDate.localeCompare(left.leaveDate));
}

export function reviewerCanAccessAnnualPaidLeave(
  actor: AuthenticatedProfile,
  employee: Pick<AnnualPaidLeaveEmployee, 'kind' | 'category'>,
): boolean {
  return canReviewAnnualPaidLeave(actor, employee);
}

export interface AnnualPaidLeavePayrollPost {
  employeeId: string;
  employeeKind: AnnualPaidLeaveEmployeeKind;
  category: string;
  leaveDate: string;
  period: string;
  payType: string;
  status: string;
}

export async function loadApprovedAnnualPaidLeavePosts(
  period: string,
  employeeId?: string,
): Promise<AnnualPaidLeavePayrollPost[]> {
  const snapshot = await adminDb
    .collection(ANNUAL_PAID_LEAVE_PAYROLL_POSTS_COLLECTION)
    .where('period', '==', period)
    .get();
  return snapshot.docs
    .map((document) => document.data() as AnnualPaidLeavePayrollPost)
    .filter(
      (post) =>
        post.status === 'posted' &&
        (!employeeId || post.employeeId === employeeId),
    );
}

export async function loadAnnualPaidLeaveHolidayDates(
  year: number,
): Promise<Set<string>> {
  const snapshot = await adminDb
    .collection('PayrollHolidayCalendars')
    .doc(String(year))
    .get();
  const dates = snapshot.data()?.dates;
  return new Set(
    Array.isArray(dates)
      ? dates.filter((date: unknown): date is string => typeof date === 'string')
      : [],
  );
}

/**
 * Overlays every approved full-day credit of the period onto a saved Loyalis
 * presence document: annual leave (CUTI) and ganti libur days off.
 */
export async function applyApprovedLoyalisDayCreditsToPresence<
  T extends Record<string, unknown>,
>(period: string, presence: T | null): Promise<T | null> {
  if (!presence) return null;
  const [posts, gantiLiburDayOffs] = await Promise.all([
    loadApprovedAnnualPaidLeavePosts(period),
    loadApprovedGantiLiburDayOffs(period),
  ]);
  const credits = [
    ...posts
      .filter((post) => post.employeeKind === 'loyalis')
      .map((post) => ({
        employeeId: post.employeeId,
        date: post.leaveDate,
        kind: 'annual_leave' as const,
      })),
    ...gantiLiburDayOffs.map((dayOff) => ({
      employeeId: dayOff.employeeId,
      date: dayOff.dayOffDate,
      kind: 'ganti_libur' as const,
    })),
  ];
  if (credits.length === 0) return presence;
  const holidays = await loadAnnualPaidLeaveHolidayDates(Number(period.slice(0, 4)));
  const entries = presence.entries && typeof presence.entries === 'object'
    ? { ...(presence.entries as Record<string, LoyalisPaidLeaveEntry>) }
    : {};
  const workingDays = Number(presence.workingDays || 25);
  const expectedHours = Number(presence.expectedHours || 6.5);
  for (const credit of credits) {
    const entry = entries[credit.employeeId] || {
      employeeId: credit.employeeId,
      minutes: 0,
      absenceMinutes: workingDays * expectedHours * 60,
      stratum: 5,
      deduction: 250_000,
      netBonus: 0,
      activeDaysCount: 0,
      incompleteDaysCount: 0,
      absentDaysCount: 0,
      dailyLogs: [],
    };
    entries[credit.employeeId] = applyApprovedPaidLeaveToLoyalisEntry({
      entry,
      leaveDate: credit.date,
      expectedHours,
      workingDays,
      isOffDay: isFridayDate(credit.date) || holidays.has(credit.date),
      kind: credit.kind,
    });
  }
  return { ...presence, entries };
}
