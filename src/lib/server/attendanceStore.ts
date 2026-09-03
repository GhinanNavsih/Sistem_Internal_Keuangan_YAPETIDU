import { createHash } from 'node:crypto';
import { adminDb } from '@/lib/firebase-admin';
import {
  AttendanceDayCorrection,
  AttendanceNormalizedRow,
  attendanceDayKey,
  classifyAttendanceDepartment,
  consolidateAttendanceDays,
  normalizeNipy,
  resolveEmployeeAttendanceNipy,
} from '@/lib/payroll/attendance';
import { periodCalendarFromData } from '@/lib/payroll/calendar';
import { MANUAL_OVERRIDES, normalizeName } from '@/lib/payroll/employeeNames';

export const ATTENDANCE_IMPORTS_COLLECTION = 'AttendanceImports';
export const ATTENDANCE_REVISIONS_COLLECTION = 'AttendanceImportRevisions';
export const ATTENDANCE_ROWS_COLLECTION = 'AttendanceImportRows';
export const ATTENDANCE_IDENTITIES_COLLECTION = 'AttendanceIdentityIndex';
export const PEKARYA_NIPY_SEQUENCES_COLLECTION = 'PekaryaNipySequences';
export const PEKARYA_CORRECTIONS_COLLECTION = 'PekaryaAttendanceCorrections';
export const PEKARYA_CORRECTION_HEADS_COLLECTION = 'PekaryaAttendanceCorrectionHeads';
export const PEKARYA_PUBLICATIONS_COLLECTION = 'PekaryaAttendancePublications';
export const ATTENDANCE_MANUAL_LINKS_COLLECTION = 'AttendanceManualLinks';

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

/**
 * The key a manual link is filed under: the raw identifier the scanner
 * exported for that worker, falling back to their name when the identifier
 * column is empty. Both are normalized so the same worker always resolves to
 * one link regardless of casing or spacing in the source file.
 */
export function attendanceManualLinkKey(
  sourceNipy: string,
  sourceName: string,
): string {
  const nipy = normalizeNipy(sourceNipy);
  if (nipy) return `nipy:${nipy}`;
  return `name:${String(sourceName || '').trim().toUpperCase()}`;
}

export function attendanceManualLinkId(period: string, sourceKey: string): string {
  return createHash('sha256').update(`${period}|${sourceKey}`).digest('hex');
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
  byName: Map<string, AttendanceEmployeeIdentity[]>;
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
          ? data.employment.jobCategory.trim().toUpperCase()
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
  const byName = new Map<string, AttendanceEmployeeIdentity[]>();
  for (const identity of identities) {
    if (identity.nipy) {
      const existing = byNipy.get(identity.nipy) || [];
      existing.push(identity);
      byNipy.set(identity.nipy, existing);
    }
    const normalized = normalizeName(identity.name || '');
    if (!normalized) continue;
    const existingNames = byName.get(normalized) || [];
    existingNames.push(identity);
    byName.set(normalized, existingNames);
  }
  return { identities, byNipy, byName };
}

export type AttendanceIdentityIndex = Awaited<
  ReturnType<typeof loadAttendanceEmployeeIdentities>
>;

export function isActiveBlueCollar(identity: AttendanceEmployeeIdentity) {
  return identity.employeeCollection === 'Employees_BlueCollar' && identity.active;
}

const ATTENDANCE_SYNTHETIC_NIPY_PREFIX = 'LINKED:';

/**
 * The value a resolved employee's attendance rows join on. A real NIPY is
 * used when they have one; otherwise a stable per-employee token stands in,
 * so their attendance can still be reviewed even before HR assigns a real
 * NIPY. The prefix can never collide with a real NIPY (always digits), and
 * is never shown to a user — callers must restore the employee's real
 * (possibly empty) NIPY before returning data that reaches the UI.
 */
export function attendanceJoinNipy(identity: {
  employeeId: string;
  nipy: string;
}): string {
  return identity.nipy || `${ATTENDANCE_SYNTHETIC_NIPY_PREFIX}${identity.employeeId}`;
}

/** True when a nipy value is a join token from {@link attendanceJoinNipy}, not a real NIPY. */
export function isAttendanceSyntheticNipy(nipy: string): boolean {
  return nipy.startsWith(ATTENDANCE_SYNTHETIC_NIPY_PREFIX);
}

/**
 * Resolves the person a source row names, for rows whose identifier the file
 * got wrong. Mirrors the Loyalis matcher — exact name, then the hand-kept
 * override list, then a containment match — but only accepts a tier when it
 * names exactly one employee. An ambiguous name is left for a manual link
 * rather than guessed at, because guessing moves a month of pay to the wrong
 * person silently.
 */
export function resolveIdentityByName(
  index: AttendanceIdentityIndex,
  sourceName: string,
  eligible: (identity: AttendanceEmployeeIdentity) => boolean,
): AttendanceEmployeeIdentity | null {
  const cleaned = normalizeName(sourceName || '');
  if (!cleaned) return null;

  const uniqueMatch = (candidates: AttendanceEmployeeIdentity[] | undefined) => {
    const eligibleOnes = (candidates || []).filter(eligible);
    return eligibleOnes.length === 1 ? eligibleOnes[0] : null;
  };

  const exact = uniqueMatch(index.byName.get(cleaned));
  if (exact) return exact;

  const overridden = MANUAL_OVERRIDES[sourceName.trim()];
  if (overridden) {
    const viaOverride = uniqueMatch(index.byName.get(normalizeName(overridden)));
    if (viaOverride) return viaOverride;
  }

  const contained: AttendanceEmployeeIdentity[] = [];
  for (const [name, candidates] of index.byName) {
    if (name.includes(cleaned) || cleaned.includes(name)) {
      contained.push(...candidates);
    }
  }
  return uniqueMatch(contained);
}

export async function loadActiveAttendanceRows(
  period: string,
  options: { allowMissingActiveImport?: boolean } = {},
): Promise<{
  importData: Record<string, unknown>;
  revisionData: Record<string, unknown>;
  rows: AttendanceNormalizedRow[];
}> {
  const importSnapshot = await adminDb
    .collection(ATTENDANCE_IMPORTS_COLLECTION)
    .doc(period)
    .get();
  if (!importSnapshot.exists || !importSnapshot.data()?.activeRevisionId) {
    if (options.allowMissingActiveImport) {
      return { importData: {}, revisionData: {}, rows: [] };
    }
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
  // Periods are open by default. An unmaterialized month still resolves a
  // correct calendar: Fridays are derived automatically and nationally declared
  // dates come from the annual accumulator below.
  const periodData = periodSnapshot.exists ? periodSnapshot.data()! : {};
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

export interface AttendanceManualLink {
  employeeId: string;
  employeeCollection: string;
  nipy: string;
  sourceNipy: string;
  sourceName: string;
}

/**
 * Manual identity links recorded for one period, keyed by
 * {@link attendanceManualLinkKey}. A link exists because the scanner's
 * identifier could not be resolved on its own — most blue-collar workers are
 * exported with the machine's short PIN rather than their payroll NIPY.
 */
export async function loadAttendanceManualLinks(
  period: string,
): Promise<Map<string, AttendanceManualLink>> {
  const snapshot = await adminDb
    .collection(ATTENDANCE_MANUAL_LINKS_COLLECTION)
    .where('period', '==', period)
    .get();
  const bySourceKey = new Map<string, AttendanceManualLink>();
  for (const doc of snapshot.docs) {
    const data = doc.data();
    const sourceKey = String(data.sourceKey || '');
    const employeeId = String(data.employeeId || '');
    if (!sourceKey || !employeeId) continue;
    bySourceKey.set(sourceKey, {
      employeeId,
      employeeCollection: String(data.employeeCollection || ''),
      nipy: normalizeNipy(data.nipy),
      sourceNipy: String(data.sourceNipy || ''),
      sourceName: String(data.sourceName || ''),
    });
  }
  return bySourceKey;
}

export async function loadEffectiveAttendanceDays(
  period: string,
  options: {
    allowMissingActiveImport?: boolean;
    /**
     * Supplying the identity index turns on the name fallback for rows the
     * file mis-identifies. Only the Pekarya pipeline passes it.
     */
    identities?: AttendanceIdentityIndex;
  } = {},
) {
  const [{ rows, importData, revisionData }, correctionsSnapshot, manualLinks] =
    await Promise.all([
      loadActiveAttendanceRows(period, options),
      adminDb
        .collection(PEKARYA_CORRECTION_HEADS_COLLECTION)
        .where('period', '==', period)
        .get(),
      loadAttendanceManualLinks(period),
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
  // Rows the file mis-identifies are rewritten to the canonical NIPY of the
  // person they belong to, before consolidation. Everything downstream joins on
  // `nipy`, so a rewritten row behaves exactly as if the file had carried the
  // right identifier all along. Precedence runs from most to least deliberate:
  // a manual link is somebody's decision, a matching NIPY is the file's own
  // claim, and only then is the name used to recover an unresolved row.
  const identities = options.identities;
  const resolveByName = (row: AttendanceNormalizedRow) => {
    if (!identities) return null;
    if (classifyAttendanceDepartment(row.department) !== 'pekarya') return null;
    if ((identities.byNipy.get(row.nipy) || []).some(isActiveBlueCollar)) {
      return null;
    }
    return resolveIdentityByName(identities, row.name, isActiveBlueCollar);
  };
  const linkedRows =
    manualLinks.size === 0 && !identities
      ? rows
      : rows.map((row) => {
          const link = manualLinks.get(
            attendanceManualLinkKey(row.nipy, row.name),
          );
          // A manual link's stored `nipy` is already a real-or-synthetic join
          // value (resolved once, at link time). A name match is resolved
          // fresh here, so it needs the same treatment.
          const matched = link ? null : resolveByName(row);
          const resolvedNipy = link?.nipy || (matched ? attendanceJoinNipy(matched) : '');
          if (!resolvedNipy || resolvedNipy === row.nipy) return row;
          return {
            ...row,
            nipy: resolvedNipy,
            issues: row.issues.filter(
              (issue) =>
                issue !== 'IDENTIFIER_MISSING' && issue !== 'IDENTIFIER_CONFLICT',
            ),
          };
        });
  return {
    days: consolidateAttendanceDays(
      linkedRows.filter(
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
    rows: linkedRows,
    importData,
    revisionData,
    corrections,
    correctionRevisions,
  };
}
