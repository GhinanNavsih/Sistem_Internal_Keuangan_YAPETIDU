import { createHash } from 'node:crypto';
import { adminDb } from '@/lib/firebase-admin';
import {
  AttendanceDayCorrection,
  AttendanceNormalizedRow,
  attendanceDayKey,
  consolidateAttendanceDays,
  normalizeNipy,
  resolveEmployeeAttendanceNipy,
} from '@/lib/payroll/attendance';
import { periodCalendarFromData } from '@/lib/payroll/calendar';

export const ATTENDANCE_IMPORTS_COLLECTION = 'AttendanceImports';
export const ATTENDANCE_REVISIONS_COLLECTION = 'AttendanceImportRevisions';
export const ATTENDANCE_ROWS_COLLECTION = 'AttendanceImportRows';
export const ATTENDANCE_IDENTITIES_COLLECTION = 'AttendanceIdentityIndex';
export const PEKARYA_NIPY_SEQUENCES_COLLECTION = 'PekaryaNipySequences';
export const PEKARYA_CORRECTIONS_COLLECTION = 'PekaryaAttendanceCorrections';
export const PEKARYA_CORRECTION_HEADS_COLLECTION = 'PekaryaAttendanceCorrectionHeads';
export const PEKARYA_PUBLICATIONS_COLLECTION = 'PekaryaAttendancePublications';

export interface AttendanceEmployeeIdentity {
  employeeId: string;
  employeeCollection: 'Employees_BlueCollar' | 'Employees_Loyalis' | 'Employees_WhiteCollar';
  name: string;
  nipy: string;
  active: boolean;
  jobCategory: string | null;
}

export function attendanceIdentityDocumentId(nipy: string): string {
  return createHash('sha256').update(normalizeNipy(nipy)).digest('hex');
}

export function attendanceImportRevisionId(period: string, revision: number): string {
  return `${period.replace('-', '_')}__r${String(revision).padStart(4, '0')}`;
}

export function pekaryaPublicationId(period: string, category: string): string {
  return `${period.replace('-', '_')}__${category.replace(/[^A-Za-z0-9_-]/g, '_')}`;
}

export function attendanceCorrectionHeadId(
  period: string,
  employeeId: string,
  date: string,
): string {
  return createHash('sha256')
    .update(`${period}|${employeeId}|${date}`)
    .digest('hex');
}

export function employeeNipy(data: Record<string, unknown>): string {
  return resolveEmployeeAttendanceNipy(data);
}

export async function loadAttendanceEmployeeIdentities(): Promise<{
  identities: AttendanceEmployeeIdentity[];
  byNipy: Map<string, AttendanceEmployeeIdentity[]>;
}> {
  const [blueSnapshot, loyalisSnapshot, whiteSnapshot] = await Promise.all([
    adminDb.collection('Employees_BlueCollar').get(),
    adminDb.collection('Employees_Loyalis').get(),
    adminDb.collection('Employees_WhiteCollar').get(),
  ]);
  const identities: AttendanceEmployeeIdentity[] = [];
  for (const snapshot of blueSnapshot.docs) {
    const data = snapshot.data();
    identities.push({
      employeeId: snapshot.id,
      employeeCollection: 'Employees_BlueCollar',
      name: String(data.name || ''),
      nipy: employeeNipy(data),
      active:
        data.employment?.status === 'active' &&
        data.flags?.isActive !== false &&
        data.flags?.isPayrollEligible !== false,
      jobCategory:
        typeof data.employment?.jobCategory === 'string'
          ? data.employment.jobCategory
          : null,
    });
  }
  for (const snapshot of loyalisSnapshot.docs) {
    const data = snapshot.data();
    identities.push({
      employeeId: snapshot.id,
      employeeCollection: 'Employees_Loyalis',
      name: String(data.personal_info?.name || ''),
      nipy: employeeNipy(data),
      active: data.personal_info?.status === 'AKTIF',
      jobCategory: 'LOYALIS',
    });
  }
  for (const snapshot of whiteSnapshot.docs) {
    const data = snapshot.data();
    identities.push({
      employeeId: snapshot.id,
      employeeCollection: 'Employees_WhiteCollar',
      name: String(data.name || data.personal_info?.name || ''),
      nipy: employeeNipy(data),
      active:
        data.employment?.status === 'active' ||
        data.personal_info?.status === 'AKTIF',
      jobCategory: null,
    });
  }
  const byNipy = new Map<string, AttendanceEmployeeIdentity[]>();
  for (const identity of identities) {
    if (!identity.nipy) continue;
    const existing = byNipy.get(identity.nipy) || [];
    existing.push(identity);
    byNipy.set(identity.nipy, existing);
  }
  return { identities, byNipy };
}

export async function loadActiveAttendanceRows(period: string): Promise<{
  importData: Record<string, unknown>;
  revisionData: Record<string, unknown>;
  rows: AttendanceNormalizedRow[];
}> {
  const importSnapshot = await adminDb
    .collection(ATTENDANCE_IMPORTS_COLLECTION)
    .doc(period)
    .get();
  if (!importSnapshot.exists || !importSnapshot.data()?.activeRevisionId) {
    throw new Error(`Data presensi aktif untuk periode ${period} belum tersedia.`);
  }
  const importData = importSnapshot.data()!;
  const revisionId = String(importData.activeRevisionId);
  const [revisionSnapshot, rowsSnapshot] = await Promise.all([
    adminDb.collection(ATTENDANCE_REVISIONS_COLLECTION).doc(revisionId).get(),
    adminDb
      .collection(ATTENDANCE_ROWS_COLLECTION)
      .where('revisionId', '==', revisionId)
      .get(),
  ]);
  if (!revisionSnapshot.exists) {
    throw new Error('Metadata revisi presensi aktif tidak ditemukan.');
  }
  return {
    importData,
    revisionData: revisionSnapshot.data()!,
    rows: rowsSnapshot.docs
      .map((snapshot) => snapshot.data() as AttendanceNormalizedRow)
      .sort((left, right) => left.rowNumber - right.rowNumber),
  };
}

export async function loadPeriodPremiumDates(period: string): Promise<{
  revision: number;
  premiumDates: Set<string>;
  calendar: ReturnType<typeof periodCalendarFromData>;
  periodData: Record<string, unknown>;
}> {
  const periodSnapshot = await adminDb.collection('PayrollPeriods').doc(period).get();
  if (!periodSnapshot.exists) {
    throw new Error(`Periode ${period} belum dikonfigurasi.`);
  }
  const periodData = periodSnapshot.data()!;
  const year = period.slice(0, 4);
  const annualSnapshot = await adminDb
    .collection('PayrollHolidayCalendars')
    .doc(year)
    .get();
  const annualDates =
    annualSnapshot.exists && Array.isArray(annualSnapshot.data()?.dates)
      ? annualSnapshot
          .data()!
          .dates.filter((date: unknown): date is string => typeof date === 'string')
      : [];
  const calendar = periodCalendarFromData(period, periodData, annualDates);
  return {
    revision: calendar.revision,
    premiumDates: new Set(calendar.premiumDates),
    calendar,
    periodData,
  };
}

export async function loadEffectiveAttendanceDays(period: string) {
  const [{ rows, importData, revisionData }, correctionsSnapshot] = await Promise.all([
    loadActiveAttendanceRows(period),
    adminDb
      .collection(PEKARYA_CORRECTION_HEADS_COLLECTION)
      .where('period', '==', period)
      .get(),
  ]);
  const corrections = new Map<string, AttendanceDayCorrection>();
  const correctionRevisions = new Map<string, number>();
  for (const snapshot of correctionsSnapshot.docs) {
    const data = snapshot.data();
    const nipy = normalizeNipy(data.nipy);
    const date = String(data.date || '');
    if (!nipy || !date) continue;
    const key = attendanceDayKey(nipy, date);
    corrections.set(key, {
      ...(typeof data.present === 'boolean' ? { present: data.present } : {}),
      ...(typeof data.workStatus === 'string' ? { workStatus: data.workStatus } : {}),
      ...('scanIn' in data
        ? { scanIn: typeof data.scanIn === 'string' ? data.scanIn : null }
        : {}),
      ...('scanOut' in data
        ? { scanOut: typeof data.scanOut === 'string' ? data.scanOut : null }
        : {}),
    });
    correctionRevisions.set(key, Number(data.revision || 0));
  }
  return {
    days: consolidateAttendanceDays(
      rows.filter(
        (row) =>
          row.nipy &&
          row.date &&
          !row.issues.some((issue) =>
            [
              'IDENTIFIER_CONFLICT',
              'IDENTIFIER_MISSING',
              'DATE_INVALID',
              'TIME_INVALID',
              'OUTSIDE_PERIOD',
            ].includes(issue),
          ),
      ),
      corrections,
    ),
    rows,
    importData,
    revisionData,
    corrections,
    correctionRevisions,
  };
}
