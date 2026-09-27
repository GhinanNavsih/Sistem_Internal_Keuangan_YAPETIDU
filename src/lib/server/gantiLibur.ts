import { createHash } from 'node:crypto';
import { adminDb, adminStorage } from '@/lib/firebase-admin';
import type { AuthenticatedProfile } from '@/lib/server/auth';
import { HttpError } from '@/lib/server/auth';
import {
  attendanceJoinNipy,
  loadAttendanceEmployeeIdentities,
  loadEffectiveAttendanceDays,
  loadPeriodPremiumDates,
} from '@/lib/server/attendanceStore';
import { storageDownloadUrl } from '@/lib/server/storageUpload';
import { isFridayDate } from '@/lib/payroll/attendance';
import {
  gantiLiburAttendanceCheck,
  evaluateGantiLiburAttendance,
  gantiLiburEmployeeKind,
  gantiLiburPeriod,
  type GantiLiburAttendanceCheck,
  type GantiLiburRequest,
} from '@/lib/payroll/gantiLibur';
import type { AnnualPaidLeaveEmployeeKind } from '@/lib/payroll/annualPaidLeave';
import { shiftPeriod } from '@/lib/server/payrollPeriod';
import {
  coerceGantiLiburAttachments,
  type GantiLiburAttachment,
} from '@/lib/payroll/gantiLiburAttachments';

export const GANTI_LIBUR_REQUESTS_COLLECTION = 'GantiLiburRequests';
export const GANTI_LIBUR_REVISIONS_COLLECTION = 'GantiLiburRequestRevisions';

export interface GantiLiburEmployee {
  id: string;
  name: string;
  kind: AnnualPaidLeaveEmployeeKind;
  category: string;
  collection: 'Employees_Loyalis' | 'Employees_BlueCollar';
}

function isActiveLoyalis(data: FirebaseFirestore.DocumentData | undefined): boolean {
  return String(data?.personal_info?.status || '').trim().toUpperCase() === 'AKTIF';
}

export function gantiLiburEmployeeFromData(
  employeeId: string,
  data: FirebaseFirestore.DocumentData | undefined,
  kind: AnnualPaidLeaveEmployeeKind = 'loyalis',
): GantiLiburEmployee | null {
  if (!data) return null;
  const loyalis = kind === 'loyalis';
  const category = loyalis ? 'LOYALIS' : String(data.employment?.jobCategory || '').trim().toUpperCase();
  const active = loyalis ? isActiveLoyalis(data) :
    data.employment?.status === 'active' && data.flags?.isActive !== false &&
    data.flags?.isPayrollEligible !== false && Boolean(category);
  if (!active) return null;
  return {
    id: employeeId,
    name: String((loyalis ? data.personal_info?.name : data.name) || '').trim(),
    kind,
    category,
    collection: loyalis ? 'Employees_Loyalis' : 'Employees_BlueCollar',
  };
}

export async function requireSelfGantiLiburEmployee(
  actor: AuthenticatedProfile,
): Promise<GantiLiburEmployee> {
  if (!['loyalis', 'honorer', 'ketua_shift_satpam'].includes(actor.role)) {
    throw new HttpError(403, 'Ganti libur hanya tersedia untuk pegawai Loyalis dan Pekarya.');
  }
  if (!actor.linkedEmployeeId) {
    throw new HttpError(403, 'Akun belum terhubung ke data pegawai.');
  }
  const kind = actor.role === 'loyalis' ? 'loyalis' : 'blue_collar';
  const snapshot = await adminDb
    .collection(kind === 'loyalis' ? 'Employees_Loyalis' : 'Employees_BlueCollar')
    .doc(actor.linkedEmployeeId)
    .get();
  const employee = gantiLiburEmployeeFromData(snapshot.id, snapshot.data(), kind);
  if (!snapshot.exists || !employee) {
    throw new HttpError(409, 'Data pegawai aktif tidak ditemukan.');
  }
  return employee;
}

/** One document per worked holiday: a holiday can earn only one day off. */
export function gantiLiburDocumentId(employeeId: string, workedDate: string): string {
  return createHash('sha256')
    .update(`ganti-libur|${employeeId}|${workedDate}`)
    .digest('hex');
}

export function gantiLiburRequestFromData(
  id: string,
  data: FirebaseFirestore.DocumentData,
): GantiLiburRequest {
  return {
    id,
    employeeId: String(data.employeeId || ''),
    employeeName: String(data.employeeName || ''),
    employeeKind: gantiLiburEmployeeKind(data),
    category: String(data.category || (gantiLiburEmployeeKind(data) === 'loyalis' ? 'LOYALIS' : '')),
    workedDate: String(data.workedDate || ''),
    workedPeriod: String(data.workedPeriod || ''),
    dayOffDate: String(data.dayOffDate || ''),
    dayOffPeriod: String(data.dayOffPeriod || ''),
    reason: String(data.reason || ''),
    status: data.status,
    revision: Number(data.revision || 0),
    decisionReason: data.decisionReason ?? null,
    attendanceCheck: data.attendanceCheck ?? null,
    attachments: coerceGantiLiburAttachments(data.attachments),
  };
}

/**
 * Builds the attachments of a submission from the Storage objects themselves
 * rather than from anything the browser reports, so a request can only carry
 * files this employee really uploaded. `paths` must already have passed
 * parseGantiLiburAttachmentPaths.
 */
export async function loadGantiLiburAttachments(
  paths: readonly string[],
): Promise<GantiLiburAttachment[]> {
  const bucket = adminStorage.bucket();
  return Promise.all(
    paths.map(async (path) => {
      const missing = new HttpError(
        400,
        'Berkas surat resmi tidak ditemukan. Unggah ulang berkasnya.',
      );
      let metadata: Record<string, unknown>;
      try {
        [metadata] = await bucket.file(path).getMetadata();
      } catch (error) {
        if ((error as { code?: unknown }).code === 404) throw missing;
        throw error;
      }
      const custom = (metadata.metadata || {}) as Record<string, unknown>;
      const token = String(custom.firebaseStorageDownloadTokens || '').split(',')[0].trim();
      if (!token) throw missing;
      return {
        name: String(custom.originalName || path.split('/').pop() || 'surat-resmi'),
        path,
        url: storageDownloadUrl(bucket.name, path, token),
        contentType: String(metadata.contentType || 'application/octet-stream'),
        size: Number(metadata.size) || 0,
      };
    }),
  );
}

export function sortGantiLiburRequests(requests: GantiLiburRequest[]): GantiLiburRequest[] {
  return requests.sort(
    (left, right) =>
      right.dayOffDate.localeCompare(left.dayOffDate) ||
      right.workedDate.localeCompare(left.workedDate),
  );
}

export function employeeGantiLiburQuery(employeeId: string) {
  return adminDb
    .collection(GANTI_LIBUR_REQUESTS_COLLECTION)
    .where('employeeId', '==', employeeId);
}

export async function loadEmployeeGantiLiburRequests(
  employeeId: string,
  kind?: AnnualPaidLeaveEmployeeKind,
): Promise<GantiLiburRequest[]> {
  const snapshot = await employeeGantiLiburQuery(employeeId).get();
  return sortGantiLiburRequests(
    snapshot.docs.map((document) => gantiLiburRequestFromData(document.id, document.data()))
      .filter((request) => !kind || gantiLiburEmployeeKind(request) === kind),
  );
}

/**
 * Loyalis non-working days (every Jumat plus the Tanggal Merah set in the
 * period calendar) for the given months, the same set the presence
 * calculator leaves out of its totals.
 */
export async function loadLoyalisOffDayDates(months: readonly string[]): Promise<Set<string>> {
  const calendars = await Promise.all(
    // Legacy Pekarya calendars ran from the 26th to the 25th; include
    // the next period when resolving historical calendar-month requests.
    Array.from(new Set(months.flatMap((month) => [month, shiftPeriod(month, 1)])))
      .map((month) => loadPeriodPremiumDates(month)),
  );
  const dates = new Set<string>();
  for (const calendar of calendars) {
    for (const date of calendar.premiumDates) dates.add(date);
  }
  return dates;
}

export async function loadLoyalisOffDayChecker(
  dates: readonly string[],
): Promise<(date: string) => boolean> {
  const offDays = await loadLoyalisOffDayDates(dates.map((date) => date.slice(0, 7)));
  return (date) => isFridayDate(date) || offDays.has(date);
}

/**
 * The saved `LoyalisPresence` documents for a month, in the order the rest of
 * the app reads them: the calculator's `YYYY_MM` document first, then the
 * canonical `YYYY-MM` one.
 */
export function loyalisPresenceRefs(month: string) {
  return Array.from(new Set([month.replace('-', '_'), month])).map((id) =>
    adminDb.collection('LoyalisPresence').doc(id),
  );
}

function presenceEntry(
  data: FirebaseFirestore.DocumentData | undefined,
  employeeId: string,
): { dailyLogs?: unknown } | null {
  const entries = data?.entries;
  if (!entries || typeof entries !== 'object') return null;
  if (!Array.isArray(entries) && entries[employeeId]) return entries[employeeId];
  const list = Array.isArray(entries) ? entries : Object.values(entries);
  return (
    (list.find(
      (entry) =>
        entry && typeof entry === 'object' && (entry as { employeeId?: unknown }).employeeId === employeeId,
    ) as { dailyLogs?: unknown } | undefined) || null
  );
}

/** Checks the worked holiday against the first saved presence document that has this employee. */
export function gantiLiburAttendanceCheckFromSnapshots(
  snapshots: readonly FirebaseFirestore.DocumentSnapshot[],
  employeeId: string,
  workedDate: string,
): GantiLiburAttendanceCheck {
  for (const snapshot of snapshots) {
    if (!snapshot.exists) continue;
    const entry = presenceEntry(snapshot.data(), employeeId);
    if (entry && Array.isArray(entry.dailyLogs) && entry.dailyLogs.length > 0) {
      return gantiLiburAttendanceCheck(entry, workedDate);
    }
  }
  return gantiLiburAttendanceCheck(null, workedDate);
}

/** Live checks for many requests, reading each month's presence only once. */
export async function loadGantiLiburAttendanceChecks(
  requests: readonly Pick<GantiLiburRequest, 'id' | 'employeeId' | 'workedDate' | 'employeeKind'>[],
): Promise<Map<string, GantiLiburAttendanceCheck>> {
  const loyalisRequests = requests.filter((request) => gantiLiburEmployeeKind(request) === 'loyalis');
  const months = Array.from(new Set(loyalisRequests.map((request) => request.workedDate.slice(0, 7))));
  const snapshotsByMonth = new Map(
    await Promise.all(
      months.map(async (month) => {
        const refs = loyalisPresenceRefs(month);
        return [month, await adminDb.getAll(...refs)] as const;
      }),
    ),
  );
  const checks = new Map(
    loyalisRequests.map((request) => [
      request.id,
      gantiLiburAttendanceCheckFromSnapshots(
        snapshotsByMonth.get(request.workedDate.slice(0, 7)) || [],
        request.employeeId,
        request.workedDate,
      ),
    ]),
  );
  const blueRequests = requests.filter((request) => gantiLiburEmployeeKind(request) === 'blue_collar');
  if (blueRequests.length) {
    const identities = await loadAttendanceEmployeeIdentities();
    const periods = [...new Set(blueRequests.map((item) => gantiLiburPeriod('blue_collar', item.workedDate)))];
    const sources = new Map(await Promise.all(periods.map(async (period) => [
      period,
      await loadEffectiveAttendanceDays(period, { identities, allowMissingActiveImport: true }),
    ] as const)));
    for (const request of blueRequests) {
      const source = sources.get(gantiLiburPeriod('blue_collar', request.workedDate))!;
      const employee = identities.identities.find((item) => item.employeeId === request.employeeId &&
        item.employeeCollection === 'Employees_BlueCollar');
      const day = employee && source.days.find((item) =>
        item.nipy === attendanceJoinNipy(employee) && item.date === request.workedDate);
      const attendanceUploaded = source.importData.activeRevisionId && employee &&
        source.rows.some((row) => row.nipy === attendanceJoinNipy(employee) && row.date >= request.workedDate);
      checks.set(request.id, attendanceUploaded
        ? evaluateGantiLiburAttendance(day?.present ? {
          'Jam kerja': day.workStatus, 'Scan masuk': day.scanIn, 'Scan pulang': day.scanOut,
        } : null)
        : { verdict: 'awaiting_upload', scanIn: '', scanOut: '' });
    }
  }
  return checks;
}

/** Approved ganti libur days off in a Loyalis payroll period (a calendar month). */
export async function loadApprovedGantiLiburDayOffs(
  period: string,
  employeeId?: string,
): Promise<Array<{ employeeId: string; dayOffDate: string }>> {
  const snapshot = await adminDb
    .collection(GANTI_LIBUR_REQUESTS_COLLECTION)
    .where('dayOffPeriod', '==', period)
    .get();
  return snapshot.docs
    .map((document) => document.data())
    .filter(
      (data) =>
        data.status === 'approved' &&
        gantiLiburEmployeeKind(data) === 'loyalis' &&
        typeof data.dayOffDate === 'string' &&
        (!employeeId || data.employeeId === employeeId),
    )
    .map((data) => ({
      employeeId: String(data.employeeId || ''),
      dayOffDate: String(data.dayOffDate),
    }));
}
