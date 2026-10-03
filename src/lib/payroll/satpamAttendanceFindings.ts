import type {
  SatpamAttendanceDetailEmployee,
  SatpamAttendanceDetailRow,
} from './satpamAttendanceDetail';

/**
 * The problems to look into across all Satpam in a period, as one list. Each
 * comes from a guard's day rows (or the guard themself), so the list and the
 * cards always agree. Pay is never affected: Satpam wages follow approved shift
 * reports and approved leave, and these are only discrepancies to check.
 */
export type SatpamFindingKind =
  | 'report_without_scan'
  | 'scan_without_report'
  | 'one_sided_scan'
  | 'leave_conflict'
  | 'identity';

export const SATPAM_FINDING_LABELS: Record<SatpamFindingKind, string> = {
  report_without_scan: 'Laporan tanpa scan',
  scan_without_report: 'Scan tanpa laporan',
  one_sided_scan: 'Scan satu sisi',
  leave_conflict: 'Izin bentrok',
  identity: 'NIPY',
};

export interface SatpamFinding {
  key: string;
  kind: SatpamFindingKind;
  employeeId: string;
  employeeName: string;
  /** Null for a finding about the guard rather than a day. */
  date: string | null;
  shiftName: SatpamAttendanceDetailRow['shiftName'];
  message: string;
  review: SatpamAttendanceDetailRow['review'];
}

const ROW_MESSAGES = {
  report_without_scan:
    'Ada laporan shift, tetapi tidak ditemukan scan pada tanggal bukti yang diizinkan.',
  scan_without_report:
    'Ada scan kehadiran, tetapi tidak ada laporan shift pada tanggal ini.',
  one_sided_scan: 'Scan masuk atau scan pulang tidak lengkap.',
} as const;

function rowFindingKind(
  row: SatpamAttendanceDetailRow,
): keyof typeof ROW_MESSAGES | null {
  if (row.status === 'no_scan') return 'report_without_scan';
  if (row.status === 'scan_only') return 'scan_without_report';
  if (row.status === 'partial') return 'one_sided_scan';
  return null;
}

export function collectSatpamFindings(
  employees: readonly SatpamAttendanceDetailEmployee[],
): SatpamFinding[] {
  const findings: SatpamFinding[] = [];
  for (const employee of employees) {
    if (employee.identityIssue) {
      findings.push({
        key: `${employee.employeeId}:identity`,
        kind: 'identity',
        employeeId: employee.employeeId,
        employeeName: employee.name,
        date: null,
        shiftName: null,
        message: employee.identityIssue,
        review: null,
      });
    }
    for (const row of employee.days) {
      const kind = rowFindingKind(row);
      if (kind) {
        findings.push({
          key: `${row.key}:${kind}`,
          kind,
          employeeId: employee.employeeId,
          employeeName: employee.name,
          date: row.date,
          shiftName: row.shiftName,
          message: ROW_MESSAGES[kind],
          review: row.review,
        });
      }
      if (row.warning) {
        findings.push({
          key: `${row.key}:leave_conflict`,
          kind: 'leave_conflict',
          employeeId: employee.employeeId,
          employeeName: employee.name,
          date: row.date,
          shiftName: row.shiftName,
          message: row.warning,
          review: row.review,
        });
      }
    }
  }
  return findings.sort(
    (left, right) =>
      (left.date ?? '').localeCompare(right.date ?? '') ||
      left.employeeName.localeCompare(right.employeeName, 'id'),
  );
}
