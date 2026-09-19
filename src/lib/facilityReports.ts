import type { PhotoEvidence } from '@/lib/payroll/domain';

export const FACILITY_REPORTS_COLLECTION = 'FacilityReports';

export const EMPLOYEE_FACILITY_REPORTS_PATH = '/employee/facility-reports';
export const FACILITY_REPORT_DASHBOARD_PATH = '/dashboard/payroll/facility-reports';

const FACILITY_REPORT_DASHBOARD_CATEGORIES = ['TEKNISI', 'KEBERSIHAN'] as const;

export interface FacilityReportNavigationProfile {
  role?: string | null;
  permittedCategories?: readonly string[] | null;
}

/**
 * Teknisi and Kebersihan honorer employees use the shared facility dashboard
 * to carry out repairs. Keep this rule based on the server-backed user profile
 * categories so the employee menu, route guard, and repair API agree.
 */
export function isBlueCollarFacilityDashboardUser(
  profile: FacilityReportNavigationProfile | null | undefined,
): boolean {
  if (profile?.role !== 'honorer') return false;
  return (profile.permittedCategories || []).some((category) => {
    const normalizedCategory = category.trim().toUpperCase();
    return (FACILITY_REPORT_DASHBOARD_CATEGORIES as readonly string[]).includes(
      normalizedCategory,
    );
  });
}

/**
 * Report creation is kept for employees who discover facility problems.
 * Teknisi and Kebersihan are the repairers for those reports, so they may
 * view and close an existing report but must not create another one.
 */
export function canSubmitFacilityReport(
  profile: FacilityReportNavigationProfile | null | undefined,
): boolean {
  if (!profile) return false;
  if (profile.role === 'loyalis' || profile.role === 'ketua_shift_satpam') return true;
  return profile.role === 'honorer' && !isBlueCollarFacilityDashboardUser(profile);
}

export function getFacilityReportsPath(
  profile: FacilityReportNavigationProfile | null | undefined,
): string {
  return isBlueCollarFacilityDashboardUser(profile)
    ? FACILITY_REPORT_DASHBOARD_PATH
    : EMPLOYEE_FACILITY_REPORTS_PATH;
}

/**
 * The reporting form offers this fixed list of campus areas plus "Lainnya",
 * which reveals a free-text field instead. `place` on the report itself
 * stays a plain string either way — one of these areas, or whatever the
 * reporter typed under "Lainnya".
 */
export const FACILITY_AREAS = [
  'Rektorat',
  'Gedung Utama',
  'Gedung FIK & Auditorium',
  'Graha Pascasarjana',
  "Gelora Abi As'ad",
  "Islamic Center",
  'Apartemen Mahasiswa',
  'Lainnya',
] as const;

export type FacilityArea = (typeof FACILITY_AREAS)[number];

export const DEFAULT_FACILITY_AREA: FacilityArea = 'Gedung Utama';

export const FACILITY_AREA_OTHER: FacilityArea = 'Lainnya';

export function isFacilityArea(value: unknown): value is FacilityArea {
  return typeof value === 'string' && (FACILITY_AREAS as readonly string[]).includes(value);
}

/**
 * A report starts `pending`. An authorized Teknisi/Kebersihan repairer can
 * close it as `resolved` after the work, while the Kepala SatKer can resolve
 * or decline it during review. `declined` always carries a reason.
 */
export const FACILITY_REPORT_STATUSES = [
  'pending',
  'resolved',
  'declined',
] as const;

export type FacilityReportStatus = (typeof FACILITY_REPORT_STATUSES)[number];

export const FACILITY_REPORT_STATUS_LABELS: Record<FacilityReportStatus, string> = {
  pending: 'Menunggu',
  resolved: 'Selesai',
  declined: 'Ditolak',
};

/** Terminal states can no longer be edited or withdrawn by the reporter. */
export const FACILITY_REPORT_OPEN_STATUSES: readonly FacilityReportStatus[] = [
  'pending',
];

export const MAX_FACILITY_PLACE_LENGTH = 160;
export const MAX_FACILITY_DESCRIPTION_LENGTH = 2000;
export const MAX_FACILITY_REVIEW_NOTE_LENGTH = 500;
export const MIN_FACILITY_DECLINE_REASON_LENGTH = 8;

/** Each photo is compressed client-side to this cap before upload, so a
 * report with several photos still stays cheap to store and quick to load. */
export const MAX_FACILITY_PHOTO_BYTES = 1 * 1024 * 1024;
export const MAX_FACILITY_PHOTOS = 5;

export interface FacilityReport {
  id: string;
  employeeId: string;
  employeeName: string;
  reportedByUid: string;
  place: string;
  description: string;
  photos?: PhotoEvidence[];
  /** Photos captured by a Teknisi/Kebersihan repairer after fixing the issue. */
  resolutionPhotos?: PhotoEvidence[];
  status: FacilityReportStatus;
  reportedAt?: unknown;
  /** ISO date (YYYY-MM-DD) of submission, kept for grouping and filtering. */
  reportedDate: string;
  reviewNote?: string | null;
  reviewedByUid?: string | null;
  reviewedByName?: string | null;
  reviewedAt?: unknown;
  resolvedByUid?: string | null;
  resolvedByName?: string | null;
  resolvedAt?: unknown;
  updatedAt?: unknown;
}

export function isFacilityReportStatus(value: unknown): value is FacilityReportStatus {
  return (
    typeof value === 'string' &&
    (FACILITY_REPORT_STATUSES as readonly string[]).includes(value)
  );
}

export function isFacilityReportOpen(status: unknown): boolean {
  return (
    isFacilityReportStatus(status) &&
    FACILITY_REPORT_OPEN_STATUSES.includes(status)
  );
}

/**
 * The workflow has one open state: a pending report is closed directly as
 * either resolved or declined. Both the reviewer and authorized repairer use
 * the same transition guard for the resolved outcome.
 */
export function canTransitionFacilityReport(
  from: FacilityReportStatus,
  to: FacilityReportStatus,
): boolean {
  return from === 'pending' && (to === 'resolved' || to === 'declined');
}

export function facilityReportStatusTone(status: FacilityReportStatus): string {
  switch (status) {
    case 'resolved':
      return 'bg-emerald-100 text-emerald-800';
    case 'declined':
      return 'bg-rose-100 text-rose-800';
    default:
      return 'bg-amber-100 text-amber-900';
  }
}
