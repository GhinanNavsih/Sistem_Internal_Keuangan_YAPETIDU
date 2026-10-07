"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Clock,
  ExternalLink,
  Eye,
  FileText,
  Loader2,
  RefreshCw,
  Save,
  UserRoundX,
  X,
  ZoomIn,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { FloatingSnackbar } from '@/components/ui/floating-snackbar';
import { formatPresenceDate } from '@/lib/payroll/presenceCorrections';
import { useAuth } from '@/lib/AuthContext';
import {
  authenticatedJson,
  createFinancialRequestId,
  propagateUraianToSlips,
} from '@/lib/payroll/client';
import { EvidenceLightbox } from '@/components/EvidenceLightbox';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AnnualPaidLeaveRequest } from '@/lib/payroll/annualPaidLeave';
import {
  gantiLiburDeclineSuggestion,
  gantiLiburVerdictLabel,
  type GantiLiburAttendanceCheck,
  type GantiLiburRequest,
} from '@/lib/payroll/gantiLibur';
import { GantiLiburAttachmentLinks } from '@/components/GantiLiburAttachmentLinks';
import {
  isValidAttendanceScanRange,
  pekaryaAttendanceReportType,
  type PekaryaAttendanceReportType,
  type PekaryaOfficialLeaveRequest,
} from '@/lib/payroll/pekaryaOfficialLeave';
import {
  defaultSatpamScanTimes,
  isValidSatpamAttendanceScanRange,
  satpamAttendanceReportType,
  type SatpamAttendanceReportType,
} from '@/lib/payroll/satpamAttendance';
import { ALL_BLUE_COLLAR_CATEGORY } from '@/lib/payroll/pekaryaSpj';
import { attendanceWorkedSeconds } from '@/lib/payroll/attendance';
import { SatpamAttendanceDetailCard } from '@/components/satpam/SatpamAttendanceDetailCard';
import { UnroutedAttendanceRows } from '@/components/attendance/UnroutedAttendanceRows';
import { SatpamAttendanceFindings } from '@/components/satpam/SatpamAttendanceFindings';
import type { PekaryaPresenceBonus } from '@/lib/payroll/pekaryaPresenceBonus';
import type { SatpamAttendanceDetailEmployee } from '@/lib/payroll/satpamAttendanceDetail';

function isSatpamShiftName(value: string | undefined): value is 'Pagi' | 'Sore' | 'Malam' {
  return value === 'Pagi' || value === 'Sore' || value === 'Malam';
}

const SATPAM_ABSENCE_TYPE_OPTIONS = [
  { value: 'sakit', label: 'Sakit' },
  { value: 'izin_resmi', label: 'Izin Resmi' },
  { value: 'darurat', label: 'Keperluan Darurat' },
  { value: 'lainnya', label: 'Lainnya' },
] as const;

type AttendanceDay = {
  date: string;
  workStatus: string;
  scanIn: string | null;
  scanOut: string | null;
  scanInAuto: boolean;
  scanOutAuto: boolean;
  present: boolean;
  completePunch: boolean;
  corrected: boolean;
  correctionRevision: number;
  sourceRows: number[];
  issues: string[];
  payType: 'Harian' | 'Jumat & Libur' | null;
  amount: number;
  /** Which sides of the day an approved driver journey supplied. */
  journeyCredit?: { scanIn: boolean; scanOut: boolean; journeyIds: string[] };
};

type EmployeeAttendance = {
  employeeId: string;
  name: string;
  nipy: string;
  category: string;
  publishBlocked: boolean;
  warnings: string[];
  harianCount: number;
  jumatLiburCount: number;
  harianAmount: number;
  jumatLiburAmount: number;
  workedSeconds: number;
  totalAmount: number;
  payableDays: number;
  incompletePunchCount: number;
  correctedDayCount: number;
  days: AttendanceDay[];
  /** Bonus Presensi for Kebersihan and Teknisi; null for other categories. */
  presenceBonus: PekaryaPresenceBonus | null;
};

type DepartmentUnmatchedRow = {
  sourceKey: string;
  sourceNipy: string;
  sourceName: string;
  department: string;
  dates: string[];
  /** True for a row with no department, which no page owns by routing. */
  unrouted?: boolean;
};

type LinkCandidate = {
  employeeId: string;
  name: string;
  nipy: string;
  category: string;
};

type AttendanceView = {
  period: string;
  category: string;
  importRevision: number;
  importRevisionId: string;
  calendarRevision: number;
  publication: null | {
    state?: string;
    stale?: boolean;
    publicationRevision?: number;
  };
  employees: EmployeeAttendance[];
  linkCandidates: LinkCandidate[];
  /** Every blue-collar employee a department-less row may be linked to. */
  unroutedLinkCandidates?: LinkCandidate[];
  exceptions: {
    unmatchedNipys: string[];
    departmentUnmatched: DepartmentUnmatchedRow[];
    unroutedUnmatched?: DepartmentUnmatchedRow[];
    duplicateNipys: string[];
    missingNipyEmployeeIds: string[];
    incompletePunches: number;
    correctedDays: number;
    duplicateEmployeeDays: number;
  };
  correctionHistory: Array<{
    id: string;
    employeeName?: string;
    date?: string;
    revision?: number;
    reason?: string;
    actorUid?: string;
    actorName?: string;
  }>;
  officialLeaves: PekaryaOfficialLeaveRequest[];
  /** Review-only Satpam cards, present on "Semua Pekarya" for accounts that may see Satpam. */
  satpamAttendance?: { employees: SatpamAttendanceDetailEmployee[] } | null;
};

type SatpamAbsenceAdminView = {
  requests: Array<{
    id: string;
    employeeId: string;
    employeeName?: string;
    dutyDate: string;
    shiftName?: string | null;
    postId?: string | null;
    teamId?: string | null;
    scheduleRelation?: string;
    reportType?: SatpamAttendanceReportType;
    scanIn?: string | null;
    scanOut?: string | null;
    absenceType?: string;
    reason?: string;
    status: string;
    late?: boolean;
    revision: number;
    decisionReason?: string;
    approvedAmount?: number;
    payrollExcludedFromHarian?: boolean;
    payrollExclusionReason?: string | null;
    hasShiftRegistrationConflict?: boolean;
    shiftRegistrationConflicts?: Array<{
      id: string;
      shiftName: string | null;
      postId: string | null;
      postName: string | null;
      shiftType: string | null;
      status: string;
      ketuaShiftName: string | null;
      sourceOccurrenceId?: string | null;
    }>;
  }>;
};

type CorrectionState = {
  employee: EmployeeAttendance;
  date: string;
  present: boolean;
  scanIn: string;
  scanOut: string;
  reason: string;
  expectedRevision: number;
};

/**
 * Longest the page waits for a period's results. Past it the request is
 * cancelled and an error with a working "Muat Ulang" replaces the placeholder,
 * so one stalled request can never leave the page loading until it is restarted.
 */
const LOAD_TIMEOUT_MS = 60_000;

const warningLabel: Record<string, string> = {
  NIPY_MISSING: 'NIPY belum diisi',
  NIPY_DUPLICATE: 'NIPY tidak unik',
  MISSING_ATTENDANCE: 'Tidak ada hari hadir',
  INCOMPLETE_PUNCH: 'Scan tidak lengkap',
  CORRECTED_ATTENDANCE: 'Ada koreksi',
  NO_IMPORTED_ROWS: 'Tidak ditemukan di file',
};

function durationLabel(seconds: number) {
  if (seconds <= 0) return '—';
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return `${hours}j ${String(minutes).padStart(2, '0')}m`;
}

/** Time between the two scans, as the reviewer reads it on the row. */
function workedDuration(day: AttendanceDay) {
  return durationLabel(attendanceWorkedSeconds(day.scanIn, day.scanOut));
}

/**
 * A scan time, flagged when it was generated rather than recorded — the
 * employee forgot this side, so it was filled in 150 minutes off the side
 * that was scanned. Mirrors the "Auto" badge Loyalis presence already uses
 * for the same situation.
 */
/**
 * A scan time cell. Editable cells are uncontrolled and keyed on the current
 * value, so the input resets to the latest server value whenever it changes
 * (after a save, or after `load()` brings in someone else's edit) without
 * needing a parallel piece of edit-buffer state. While a save is in flight the
 * input is read-only rather than disabled: a disabled input drops keyboard
 * focus, so tabbing from one scan cell to the next would lose its place.
 */
const JOURNEY_TAG_TITLE =
  'Dihitung dari perjalanan dinas yang disetujui, karena sisi ini tidak ter-scan.';

function JourneyTag() {
  return (
    <span
      className="inline-flex shrink-0 select-none items-center rounded-sm border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[9px] font-extrabold uppercase text-indigo-700 cursor-help"
      title={JOURNEY_TAG_TITLE}
    >
      Perjalanan
    </span>
  );
}

function ScanCell({
  value,
  auto,
  journey,
  editable,
  disabled,
  onCommit,
}: {
  value: string | null;
  auto: boolean;
  /** This side came from an approved driver journey, not from a scan. */
  journey?: boolean;
  editable?: boolean;
  disabled?: boolean;
  onCommit?: (value: string) => void;
}) {
  if (editable) {
    return (
      <span className="inline-flex items-center gap-1">
        <input
          key={value || ''}
          type="time"
          step="1"
          defaultValue={value || ''}
          readOnly={disabled}
          onBlur={(event) => {
            if (!disabled) onCommit?.(event.target.value);
          }}
          className={`h-8 w-28 rounded-sm border px-2 text-xs font-mono read-only:opacity-60 ${
            auto
              ? 'border-amber-300 bg-amber-50/10 font-bold text-amber-700 ring-2 ring-amber-100/50'
              : 'border-slate-200 bg-white text-slate-700'
          }`}
        />
        {auto && (
          <span
            className="inline-flex shrink-0 select-none items-center rounded-sm bg-amber-50 px-1.5 py-0.5 text-[9px] font-extrabold uppercase text-amber-700 border border-amber-200 cursor-help"
            title="Diisi otomatis (150 menit dari scan yang tercatat) karena satu sisi lupa discan."
          >
            Auto
          </span>
        )}
        {journey && <JourneyTag />}
      </span>
    );
  }
  if (!value) return <span>—</span>;
  if (journey) {
    return (
      <span className="inline-flex items-center gap-1">
        <span className="font-mono text-indigo-700 font-semibold">{value}</span>
        <JourneyTag />
      </span>
    );
  }
  if (!auto) return <span>{value}</span>;
  return (
    <span className="inline-flex items-center gap-1">
      <span className="font-mono text-amber-700 font-semibold">{value}</span>
      <span
        className="inline-flex px-1.5 py-0.5 rounded-sm text-[9px] font-extrabold uppercase bg-amber-50 text-amber-700 border border-amber-200 select-none shrink-0 cursor-help"
        title="Diisi otomatis (150 menit dari scan yang tercatat) karena satu sisi lupa discan."
      >
        Auto
      </span>
    </span>
  );
}

/** Why the Bonus Presensi came out as it did, for the reviewer. */
function presenceBonusReason(bonus: PekaryaPresenceBonus): string {
  const dates = (list: readonly string[]) =>
    list.map((date) => Number(date.slice(8))).join(', ');
  const absent = `${bonus.absentDates.length} hari kerja (tgl ${dates(bonus.absentDates)})`;
  switch (bonus.tier) {
    case 'perfect':
      return `Hadir pada semua ${bonus.workingDays} hari kerja dan tidak pernah telat.`;
    case 'full':
      return `Hadir pada semua ${bonus.workingDays} hari kerja, tetapi telat ${bonus.lateDates.length} hari (tgl ${dates(bonus.lateDates)}).`;
    case 'one_absence':
    case 'two_absences':
      return `Tidak hadir ${absent}.`;
    default:
      return `Tidak hadir ${absent}; bonus hanya berlaku untuk maksimal dua hari tidak hadir.`;
  }
}

function money(value: number) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(value);
}

function statusText(view: AttendanceView) {
  if (
    view.category === ALL_BLUE_COLLAR_CATEGORY &&
    view.publication?.state === 'partial'
  ) {
    return 'Sebagian kategori sudah dipublikasikan';
  }
  if (!view.publication) return 'Belum dipublikasikan';
  if (view.publication.stale) return 'Perlu dipublikasikan ulang';
  return view.publication.state === 'published'
    ? `Dipublikasikan · revisi ${view.publication.publicationRevision || 1}`
    : 'Belum dipublikasikan';
}

function decisionStatusLabel(status: string): string {
  return {
    pending: 'Menunggu keputusan',
    approved: 'Disetujui',
    declined: 'Ditolak',
    withdrawn: 'Ditarik',
  }[status] || 'Status tidak diketahui';
}

function satpamAbsenceTypeLabel(absenceType: string | undefined): string {
  return (
    {
      sakit: 'Sakit',
      izin_resmi: 'Izin resmi',
      darurat: 'Keperluan darurat',
      lainnya: 'Lainnya',
    }[absenceType || ''] || 'Izin'
  );
}

function checkClass(check: GantiLiburAttendanceCheck): string {
  if (check.verdict === 'eligible') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (check.verdict === 'awaiting_upload') return 'border-slate-200 bg-slate-50 text-slate-600';
  if (check.verdict === 'absent') return 'border-rose-200 bg-rose-50 text-rose-800';
  return 'border-amber-200 bg-amber-50 text-amber-800';
}

function categoryLabel(category: string): string {
  return (
    {
      [ALL_BLUE_COLLAR_CATEGORY]: 'Semua Pekarya',
      SATPAM: 'Satpam',
      SOPIR: 'Sopir',
      PEKARYA: 'Pekarya',
      TEKNISI: 'Teknisi',
      KEBERSIHAN: 'Kebersihan',
      KEBERSIHAN_PONTI: 'Kebersihan Ponti',
      PONTI: 'Ponti',
    }[category] || 'Kategori'
  );
}

function satpamShiftReviewHref(
  absence: SatpamAbsenceAdminView['requests'][number],
): string {
  const params = new URLSearchParams({
    reportType: 'shift',
    category: 'SATPAM',
    status: 'all',
  });
  const periodDate = /^(\d{4})-(\d{2})-\d{2}$/.exec(absence.dutyDate);
  if (periodDate) {
    params.set('year', periodDate[1]);
    params.set('month', String(Number(periodDate[2])));
  }
  const registration = absence.shiftRegistrationConflicts?.find(
    (item) => item.sourceOccurrenceId,
  );
  if (registration?.sourceOccurrenceId) {
    params.set('occurrenceId', registration.sourceOccurrenceId);
  }
  if (absence.employeeId) {
    params.set('employeeId', absence.employeeId);
  }
  return `/dashboard/payroll/activity-review?${params.toString()}`;
}

function satpamShiftMismatchReviewHref(
  period: string,
  sourceOccurrenceId: string,
  employeeId: string,
): string {
  const params = new URLSearchParams({
    reportType: 'shift',
    category: 'SATPAM',
    status: 'all',
  });
  const periodParts = /^(\d{4})-(\d{2})$/.exec(period);
  if (periodParts) {
    params.set('year', periodParts[1]);
    params.set('month', String(Number(periodParts[2])));
  }
  params.set('occurrenceId', sourceOccurrenceId);
  params.set('employeeId', employeeId);
  return `/dashboard/payroll/activity-review?${params.toString()}`;
}

function isImageProofUrl(value?: string | null): boolean {
  if (!value) return false;
  const normalized = value.toLowerCase();
  return (
    /\.(?:jpe?g|png|gif|webp)(?:[?#]|$)/.test(normalized) ||
    normalized.includes('image%2f') ||
    normalized.includes('image/')
  );
}

function submissionStatusLabel(status: string): string {
  switch (status) {
    case 'approved':
      return 'DISETUJUI';
    case 'declined':
    case 'rejected':
      return 'DITOLAK';
    case 'withdrawn':
      return 'DITARIK';
    case 'pending':
    default:
      return 'TERTUNDA';
  }
}

type SubmissionStatusFilter = 'pending' | 'approved' | 'rejected' | 'all';

const SUBMISSION_FILTER_LABELS: Record<
  Exclude<SubmissionStatusFilter, 'all'>,
  string
> = {
  pending: 'Tertunda',
  approved: 'Disetujui',
  rejected: 'Ditolak',
};

/** Which filter tab a submission status belongs to; a withdrawn request shows under Semua only. */
function submissionStatusMatches(
  status: string,
  selected: SubmissionStatusFilter,
): boolean {
  if (selected === 'all') return true;
  if (selected === 'rejected') return status === 'rejected' || status === 'declined';
  return status === selected;
}

interface BlueCollarSubmissionItem {
  id: string;
  key: string;
  kind: 'official_leave' | 'satpam_absence' | 'paid_leave' | 'ganti_libur';
  employeeId: string;
  employeeName: string;
  category: string;
  date: string;
  title: string;
  subtitle: string;
  reason: string;
  status: string;
  evidenceUrl?: string | null;
  attachments?: GantiLiburRequest['attachments'];
  approvedAmount?: number;
  decisionReason?: string | null;
  shiftName?: string | null;
  postId?: string | null;
  isUnassignedSatpam?: boolean;
  hasShiftRegistrationConflict?: boolean;
  shiftRegistrationConflicts?: Array<{
    id: string;
    shiftName?: string | null;
    postId?: string | null;
    shiftType?: string | null;
    ketuaShiftName?: string | null;
  }>;
  payrollExcludedFromHarian?: boolean;
  payrollExclusionReason?: string | null;
  attendanceCheck?: GantiLiburAttendanceCheck | null;
  raw: any;
}

function BlueCollarSubmissionsCard({
  category,
  canViewSatpamCategory,
  canEdit,
  working,
  profileRole,
  satpamSubmissionNotice,
  officialLeaves = [],
  satpamRequests = [],
  paidLeaves = [],
  gantiLiburs = [],
  onReviewOfficialLeave,
  onReviewSatpamAbsence,
  onReviewPaidLeave,
  onReviewGantiLibur,
  openDeclineDialog,
  onBulkApprove,
  setSelectedEvidence,
  onReload,
}: {
  category: string;
  canViewSatpamCategory: boolean;
  canEdit: boolean;
  working: boolean;
  profileRole?: string;
  satpamSubmissionNotice?: string;
  officialLeaves?: PekaryaOfficialLeaveRequest[];
  satpamRequests?: SatpamAbsenceAdminView['requests'];
  paidLeaves?: AnnualPaidLeaveRequest[];
  gantiLiburs?: GantiLiburRequest[];
  onReviewOfficialLeave: (
    leave: PekaryaOfficialLeaveRequest,
    action: 'approve' | 'decline',
    reason?: string,
  ) => Promise<void>;
  onReviewSatpamAbsence: (
    absence: SatpamAbsenceAdminView['requests'][number],
    action: 'approve' | 'decline' | 'supersede_approve' | 'supersede_decline',
    reason?: string,
  ) => Promise<void>;
  onReviewPaidLeave: (
    leave: AnnualPaidLeaveRequest,
    action: 'approve' | 'decline',
    reason?: string,
  ) => Promise<void>;
  onReviewGantiLibur: (
    gl: GantiLiburRequest,
    action: 'approve' | 'decline',
    reason?: string,
  ) => Promise<void>;
  openDeclineDialog: (
    type: 'official_leave' | 'satpam_absence' | 'paid_leave' | 'ganti_libur',
    item: any,
    title: string,
    defaultReason?: string,
  ) => void;
  onBulkApprove: (items: BlueCollarSubmissionItem[]) => Promise<void>;
  setSelectedEvidence: (evidence: { url: string; title: string }) => void;
  onReload?: () => Promise<void>;
}) {
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] =
    useState<SubmissionStatusFilter>('pending');

  const [editingTypeKey, setEditingTypeKey] = useState<string | null>(null);
  const [editingReportType, setEditingReportType] = useState<PekaryaAttendanceReportType>('scan');
  const [editingScanIn, setEditingScanIn] = useState('08:00');
  const [editingScanOut, setEditingScanOut] = useState('14:00');
  const [editingAbsenceType, setEditingAbsenceType] = useState('izin_resmi');
  const [typeActionLoading, setTypeActionLoading] = useState<string | null>(null);

  const startTypeEdit = (item: BlueCollarSubmissionItem) => {
    const reportType =
      item.kind === 'official_leave'
        ? pekaryaAttendanceReportType(item.raw)
        : satpamAttendanceReportType(item.raw);
    const satpamShiftName =
      item.kind === 'satpam_absence'
        ? item.raw.shiftName || undefined
        : undefined;
    const defaultTimes =
      isSatpamShiftName(satpamShiftName) && item.kind === 'satpam_absence'
        ? defaultSatpamScanTimes(item.raw.dutyDate, satpamShiftName)
        : { scanIn: '08:00', scanOut: '14:00' };

    setEditingTypeKey(item.key);
    setEditingReportType(reportType);
    setEditingScanIn(item.raw.scanIn?.slice(0, 5) || defaultTimes.scanIn);
    setEditingScanOut(item.raw.scanOut?.slice(0, 5) || defaultTimes.scanOut);
    setEditingAbsenceType(
      item.kind === 'satpam_absence' && reportType === 'izin_resmi'
        ? item.raw.absenceType || 'izin_resmi'
        : 'izin_resmi',
    );
  };

  const cancelTypeEdit = () => {
    setEditingTypeKey(null);
  };

  const handleChangeType = async (item: BlueCollarSubmissionItem) => {
    if (item.status !== 'pending') return;
    const isSatpam = item.kind === 'satpam_absence';
    const satpamShiftName = isSatpam ? item.raw.shiftName || undefined : undefined;
    const scanRangeValid = isSatpam
      ? isSatpamShiftName(satpamShiftName) &&
        isValidSatpamAttendanceScanRange(editingScanIn, editingScanOut, satpamShiftName)
      : isValidAttendanceScanRange(editingScanIn, editingScanOut);

    if (editingReportType === 'scan' && !scanRangeValid) {
      alert('Scan masuk dan scan pulang harus valid, dengan scan pulang lebih lambat.');
      return;
    }

    setTypeActionLoading(item.key);
    try {
      await authenticatedJson(
        isSatpam
          ? '/api/satpam/absences/review'
          : '/api/attendance/pekarya/official-leave/review',
        {
          method: 'POST',
          body: JSON.stringify({
            ...(isSatpam
              ? { absenceRequestId: item.raw.id }
              : { officialLeaveRequestId: item.raw.id }),
            action: 'change_type',
            reportType: editingReportType,
            scanIn: editingReportType === 'scan' ? editingScanIn : null,
            scanOut: editingReportType === 'scan' ? editingScanOut : null,
            ...(isSatpam
              ? {
                  absenceType:
                    editingReportType === 'izin_resmi' ? editingAbsenceType : null,
                }
              : {}),
            reason: 'Perubahan jenis ajuan oleh auditor.',
            requestId: createFinancialRequestId(
              isSatpam ? 'satpam-absence-type' : 'pekarya-official-leave-type',
            ),
            expectedRevision: item.raw.revision,
          }),
        },
      );
      setEditingTypeKey(null);
      if (onReload) await onReload();
    } catch (err: unknown) {
      console.error(err);
      alert(err instanceof Error ? err.message : 'Gagal mengubah jenis ajuan.');
    } finally {
      setTypeActionLoading(null);
    }
  };

  const unifiedItems: BlueCollarSubmissionItem[] = useMemo(() => {
    const items: BlueCollarSubmissionItem[] = [];

    for (const leave of officialLeaves) {
      const reportType = pekaryaAttendanceReportType(leave);
      items.push({
        id: leave.id,
        key: `official_leave:${leave.id}`,
        kind: 'official_leave',
        employeeId: leave.employeeId,
        employeeName: leave.employeeName || leave.employeeId || '—',
        category: leave.category,
        date: leave.date,
        title: reportType === 'scan' ? 'Koreksi Scan' : 'Izin Resmi',
        subtitle:
          reportType === 'scan'
            ? `Scan ${leave.scanIn?.slice(0, 5) || '--:--'} – ${leave.scanOut?.slice(0, 5) || '--:--'}`
            : '07:30 – 14:00',
        reason: leave.reason || 'Tanpa keterangan',
        status: leave.status,
        evidenceUrl: leave.evidenceUrl,
        approvedAmount: leave.approvedAmount,
        decisionReason: (leave as any).decisionReason,
        raw: leave,
      });
    }

    for (const absence of satpamRequests) {
      const reqType = satpamAttendanceReportType(absence);
      const isUnassignedSatpam =
        absence.scheduleRelation === 'unassigned' || !absence.teamId;
      const shiftConflicts = absence.shiftRegistrationConflicts || [];
      const hasConflict =
        reqType === 'izin_resmi' &&
        !isUnassignedSatpam &&
        (absence.hasShiftRegistrationConflict === true || shiftConflicts.length > 0);

      const subtitleParts: string[] = [];
      if (reqType === 'scan') {
        subtitleParts.push(
          `Scan ${absence.scanIn?.slice(0, 5) || '--:--'} – ${absence.scanOut?.slice(0, 5) || '--:--'}`,
        );
      } else {
        if (absence.shiftName) subtitleParts.push(`Shift ${absence.shiftName}`);
        if (absence.postId) subtitleParts.push(absence.postId);
        if (isUnassignedSatpam) subtitleParts.push('Tanpa regu');
      }

      items.push({
        id: absence.id,
        key: `satpam_absence:${absence.id}`,
        kind: 'satpam_absence',
        employeeId: absence.employeeId,
        employeeName: absence.employeeName || absence.employeeId || '—',
        category: 'SATPAM',
        date: absence.dutyDate,
        title:
          reqType === 'scan'
            ? 'Koreksi Scan'
            : satpamAbsenceTypeLabel(absence.absenceType),
        subtitle: subtitleParts.join(' · '),
        reason: absence.reason || 'Tanpa keterangan',
        status: absence.status,
        evidenceUrl: (absence as any).evidenceUrl || (absence as any).proofUrl,
        approvedAmount: absence.approvedAmount,
        decisionReason: (absence as any).decisionReason,
        shiftName: absence.shiftName,
        postId: absence.postId,
        isUnassignedSatpam,
        hasShiftRegistrationConflict: hasConflict,
        shiftRegistrationConflicts: shiftConflicts,
        payrollExcludedFromHarian: absence.payrollExcludedFromHarian === true,
        payrollExclusionReason: absence.payrollExclusionReason,
        raw: absence,
      });
    }

    for (const pl of paidLeaves) {
      items.push({
        id: pl.id,
        key: `paid_leave:${pl.id}`,
        kind: 'paid_leave',
        employeeId: pl.employeeId,
        employeeName: pl.employeeName || pl.employeeId || '—',
        category: pl.category,
        date: pl.leaveDate,
        title: 'Cuti Tahunan',
        subtitle: 'Dibayar Penuh',
        reason: pl.reason || 'Tanpa alasan tertulis',
        status: pl.status,
        evidenceUrl: (pl as any).evidenceUrl || null,
        approvedAmount: pl.approvedAmount,
        decisionReason: pl.decisionReason,
        raw: pl,
      });
    }

    for (const gl of gantiLiburs) {
      items.push({
        id: gl.id,
        key: `ganti_libur:${gl.id}`,
        kind: 'ganti_libur',
        employeeId: gl.employeeId,
        employeeName: gl.employeeName || gl.employeeId || '—',
        category: gl.category || 'PEKARYA',
        date: gl.dayOffDate,
        title: 'Ganti Libur',
        subtitle: `Masuk kerja: ${gl.workedDate}`,
        reason: gl.reason || 'Tanpa keterangan',
        status: gl.status,
        evidenceUrl:
          gl.attachments && gl.attachments.length > 0 ? gl.attachments[0].url : undefined,
        attachments: gl.attachments,
        decisionReason: gl.decisionReason,
        attendanceCheck: gl.attendanceCheck,
        raw: gl,
      });
    }

    items.sort((a, b) => b.date.localeCompare(a.date));
    return items;
  }, [officialLeaves, satpamRequests, paidLeaves, gantiLiburs]);

  const visibleItems = useMemo(
    () =>
      unifiedItems.filter((item) =>
        submissionStatusMatches(item.status, selectedStatus),
      ),
    [unifiedItems, selectedStatus],
  );

  const stats = useMemo(
    () => ({
      pending: unifiedItems.filter((i) => submissionStatusMatches(i.status, 'pending')).length,
      approved: unifiedItems.filter((i) => submissionStatusMatches(i.status, 'approved')).length,
      rejected: unifiedItems.filter((i) => submissionStatusMatches(i.status, 'rejected')).length,
      total: unifiedItems.length,
    }),
    [unifiedItems],
  );

  // Only the pending rows on screen can be picked, so a bulk approval never
  // reaches a request the reviewer cannot see.
  const pendingItems = useMemo(
    () => visibleItems.filter((i) => i.status === 'pending'),
    [visibleItems],
  );

  const allPendingSelected =
    pendingItems.length > 0 &&
    pendingItems.every((item) => selectedKeys.has(item.key));

  const toggleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedKeys(new Set(pendingItems.map((i) => i.key)));
    } else {
      setSelectedKeys(new Set());
    }
  };

  const toggleSelect = (key: string, checked: boolean) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
  };

  const selectedPendingItems = useMemo(
    () => pendingItems.filter((item) => selectedKeys.has(item.key)),
    [pendingItems, selectedKeys],
  );

  return (
    <Card className="overflow-hidden rounded-md border-none bg-white shadow-[0_8px_30px_rgb(0,0,0,0.02)]">
      <div className="border-b border-slate-100 px-5 py-4 lg:px-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-bold text-slate-800">
              {category === ALL_BLUE_COLLAR_CATEGORY
                ? 'Pengajuan Koreksi & Izin Blue Collar'
                : `Pengajuan Koreksi & Izin ${categoryLabel(category)}`}
            </h2>
            <p className="text-xs text-slate-500">
              {category === ALL_BLUE_COLLAR_CATEGORY
                ? 'Semua kategori Blue Collar aktif ditampilkan di sini, termasuk Pekarya dan Satpam.'
                : `Pengajuan presensi, izin resmi, cuti tahunan, dan ganti libur ${categoryLabel(category)}.`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-md bg-slate-100/80 p-1 text-xs font-semibold">
              {(
                [
                  ['pending', 'Tertunda', 'text-amber-700', 'bg-amber-100 text-amber-800'],
                  ['approved', 'Disetujui', 'text-emerald-700', 'bg-emerald-100 text-emerald-800'],
                  ['rejected', 'Ditolak', 'text-rose-700', 'bg-rose-100 text-rose-800'],
                ] as const
              ).map(([value, label, activeText, badge]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setSelectedStatus(value)}
                  className={`flex items-center gap-1.5 rounded-sm px-2.5 py-1 transition-all ${
                    selectedStatus === value
                      ? `bg-white ${activeText} shadow-sm`
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {label}
                  {stats[value] > 0 && (
                    <span className={`rounded-sm px-1.5 text-[10px] font-bold ${badge}`}>
                      {stats[value]}
                    </span>
                  )}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setSelectedStatus('all')}
                className={`flex items-center gap-1.5 rounded-sm px-2.5 py-1 transition-all ${
                  selectedStatus === 'all'
                    ? 'bg-white text-slate-800 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Semua
                <span className="text-[10px] font-bold text-slate-400">({stats.total})</span>
              </button>
            </div>
            <span className="inline-flex w-fit items-center rounded-sm border border-emerald-100 bg-emerald-50 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
              {profileRole === 'super_admin' ? 'Review oleh Super Admin' : 'Review oleh Kepala SatKer'}
            </span>
            {/* Always rendered, hidden when nothing is approvable, so the header
                keeps its size when the filter changes. */}
            {canEdit && (
              <Button
                type="button"
                onClick={() => void onBulkApprove(selectedPendingItems)}
                disabled={working || selectedPendingItems.length === 0}
                aria-hidden={pendingItems.length === 0}
                tabIndex={pendingItems.length === 0 ? -1 : undefined}
                className={`h-9 min-w-48 justify-center rounded-sm bg-emerald-600 px-3 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 ${
                  pendingItems.length === 0 ? 'invisible' : ''
                }`}
              >
                {working ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="mr-1.5 h-3.5 w-3.5" />
                )}
                Setujui Izin Terpilih ({selectedPendingItems.length})
              </Button>
            )}
          </div>
        </div>
      </div>

      {category === ALL_BLUE_COLLAR_CATEGORY &&
        canViewSatpamCategory &&
        satpamSubmissionNotice && (
          <div className="border-b border-amber-100 bg-amber-50/70 p-4 text-xs font-semibold text-amber-800">
            Pengajuan Satpam: {satpamSubmissionNotice}
          </div>
        )}

      <CardContent className="p-0">
        {unifiedItems.length === 0 ? (
          <div className="flex flex-col items-center p-16 text-center text-slate-400">
            <Clock className="mb-4 h-12 w-12 opacity-20" />
            <h4 className="text-base font-bold text-slate-700">Tidak Ada Data</h4>
            <p className="mt-1 max-w-xs text-xs text-slate-400">
              Belum ada pengajuan presensi, izin, cuti, atau ganti libur pada periode ini.
            </p>
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="flex flex-col items-center p-16 text-center text-slate-400">
            <Clock className="mb-4 h-12 w-12 opacity-20" />
            <h4 className="text-base font-bold text-slate-700">Tidak Ada Pengajuan</h4>
            <p className="mt-1 max-w-xs text-xs text-slate-400">
              Belum ada pengajuan dengan status{' '}
              {selectedStatus === 'all'
                ? 'apa pun'
                : SUBMISSION_FILTER_LABELS[selectedStatus]}{' '}
              pada periode ini.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader className="sticky top-0 z-20 bg-slate-50/60">
              <TableRow className="border-slate-100">
                <TableHead className="w-12 pl-5">
                  <Checkbox
                    checked={allPendingSelected}
                    onCheckedChange={(checked) => toggleSelectAll(checked === true)}
                    disabled={pendingItems.length === 0 || working}
                    aria-label="Pilih semua pengajuan tertunda"
                  />
                  <span className="sr-only">Pilih pengajuan</span>
                </TableHead>
                <TableHead className="font-bold text-slate-500">Nama Pegawai</TableHead>
                <TableHead className="font-bold text-slate-500">Tanggal</TableHead>
                <TableHead className="font-bold text-slate-500">Koreksi</TableHead>
                <TableHead className="font-bold text-slate-500">Status</TableHead>
                <TableHead className="pr-6 text-right font-bold text-slate-500">Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleItems.map((item) => {
                const isExpanded = expandedId === item.key;
                const isSatpam = item.kind === 'satpam_absence';
                const isSupersede =
                  isSatpam && item.status !== 'pending' && item.status !== 'withdrawn';
                const canReview = item.status === 'pending' || isSupersede;
                const approveAction = isSupersede ? 'supersede_approve' : 'approve';

                return (
                  <React.Fragment key={item.key}>
                    <TableRow
                      role="button"
                      tabIndex={0}
                      aria-expanded={isExpanded}
                      onClick={() =>
                        setExpandedId((curr) => (curr === item.key ? null : item.key))
                      }
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setExpandedId((curr) => (curr === item.key ? null : item.key));
                        }
                      }}
                      className={`cursor-pointer border-slate-100 transition-colors ${
                        isExpanded ? 'bg-indigo-50/50' : 'hover:bg-slate-50/60'
                      }`}
                    >
                      <TableCell
                        className="w-12 pl-5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {item.status === 'pending' && (
                          <Checkbox
                            checked={selectedKeys.has(item.key)}
                            onCheckedChange={(checked) =>
                              toggleSelect(item.key, checked === true)
                            }
                            disabled={working}
                            aria-label={`Pilih pengajuan ${item.employeeName}`}
                          />
                        )}
                      </TableCell>
                      <TableCell className="min-w-48">
                        <div className="font-bold text-slate-800">{item.employeeName}</div>
                        <div className="mt-1 inline-flex items-center rounded-sm border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-[10px] font-bold uppercase text-indigo-700">
                          {item.category === 'SATPAM' ? 'SATPAM' : categoryLabel(item.category)}
                        </div>
                      </TableCell>
                      <TableCell className="min-w-36">
                        <div className="flex items-center gap-2 font-mono text-xs font-bold text-slate-700">
                          <Calendar className="h-4 w-4 text-slate-400" />
                          {formatPresenceDate(item.date, {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })}
                        </div>
                      </TableCell>
                      <TableCell className="min-w-52">
                        <div className="text-xs font-bold text-indigo-700">{item.title}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[10px] font-semibold text-slate-500">
                          <span>{item.subtitle}</span>
                          {item.isUnassignedSatpam && (
                            <span className="inline-flex items-center rounded-sm border border-indigo-200 bg-indigo-50 px-2 py-0.5 font-bold text-indigo-700">
                              Tanpa regu
                            </span>
                          )}
                          {item.hasShiftRegistrationConflict && (
                            <span className="inline-flex items-center rounded-sm border border-amber-200 bg-amber-50 px-2 py-0.5 font-bold text-amber-800">
                              ⚠ Shift sudah terdaftar
                            </span>
                          )}
                          {item.attendanceCheck && (
                            <span
                              className={`inline-flex rounded-sm border px-1.5 py-0.5 text-[9px] font-semibold ${checkClass(
                                item.attendanceCheck,
                              )}`}
                            >
                              {gantiLiburVerdictLabel(item.attendanceCheck.verdict)}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex items-center gap-1 rounded-sm px-2.5 py-1 text-[10px] font-bold uppercase ${
                            item.status === 'approved'
                              ? 'border border-emerald-100 bg-emerald-50 text-emerald-700'
                              : item.status === 'declined' || item.status === 'rejected'
                                ? 'border border-rose-100 bg-rose-50 text-rose-700'
                                : item.status === 'withdrawn'
                                  ? 'border border-slate-200 bg-slate-100 text-slate-500'
                                  : 'border border-amber-100 bg-amber-50 text-amber-700'
                          }`}
                        >
                          {submissionStatusLabel(item.status)}
                        </span>
                      </TableCell>
                      <TableCell className="pr-6 text-right">
                        {isExpanded ? (
                          <ChevronUp className="ml-auto h-5 w-5 text-slate-400" />
                        ) : (
                          <ChevronDown className="ml-auto h-5 w-5 text-slate-400" />
                        )}
                      </TableCell>
                    </TableRow>

                    {isExpanded && (
                      <TableRow className="border-slate-100 bg-white">
                        <TableCell colSpan={6} className="whitespace-normal p-0">
                          <div className="space-y-5 p-5 animate-in fade-in slide-in-from-top-1 duration-200 lg:p-6">
                            <div className="space-y-2">
                              <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                Detail Pengajuan
                              </span>
                              <div className="grid grid-cols-1 gap-4 text-left md:grid-cols-2">
                                <div className="space-y-2 rounded-md border border-slate-100 bg-slate-50 p-4">
                                  <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                    Data Presensi
                                  </span>
                                  <div className="space-y-1.5 text-xs font-semibold text-slate-700">
                                    <div className="flex items-center justify-between gap-3 border-b border-slate-100/50 pb-1">
                                      <span>Jenis:</span>
                                      <div className="flex items-center gap-2">
                                        <span className="text-right text-[10px] font-bold text-indigo-600">
                                          {item.title}
                                        </span>
                                        {canEdit &&
                                          item.status === 'pending' &&
                                          (item.kind === 'official_leave' ||
                                            (item.kind === 'satpam_absence' &&
                                              !item.isUnassignedSatpam &&
                                              Boolean(item.shiftName))) && (
                                            <Button
                                              type="button"
                                              variant="outline"
                                              onClick={(event) => {
                                                event.stopPropagation();
                                                if (editingTypeKey === item.key) {
                                                  cancelTypeEdit();
                                                } else {
                                                  startTypeEdit(item);
                                                }
                                              }}
                                              disabled={typeActionLoading !== null}
                                              className="h-6 rounded-sm border-indigo-200 px-2 text-[10px] font-bold text-indigo-700 hover:bg-indigo-50"
                                            >
                                              {editingTypeKey === item.key ? 'Tutup' : 'Ubah'}
                                            </Button>
                                          )}
                                      </div>
                                    </div>
                                    {editingTypeKey === item.key && (
                                      <div className="mt-3 space-y-3 rounded-md border border-indigo-100 bg-indigo-50/60 p-3 text-left">
                                        <div>
                                          <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-700">
                                            Ubah Jenis Ajuan
                                          </span>
                                          <p className="mt-0.5 text-[11px] font-semibold text-indigo-900">
                                            Perubahan berlaku sebelum pengajuan diputuskan.
                                          </p>
                                        </div>
                                        <Select
                                          value={editingReportType}
                                          onValueChange={(value) => {
                                            if (value === 'scan' || value === 'izin_resmi') {
                                              setEditingReportType(value);
                                            }
                                          }}
                                        >
                                          <SelectTrigger className="h-9 rounded-sm border-indigo-200 bg-white text-xs font-bold text-slate-800">
                                            <SelectValue>
                                              {editingReportType === 'scan' ? 'Koreksi Scan' : 'Izin Resmi'}
                                            </SelectValue>
                                          </SelectTrigger>
                                          <SelectContent className="rounded-md bg-white">
                                            <SelectItem value="scan" className="text-xs font-semibold">
                                              Koreksi Scan
                                            </SelectItem>
                                            <SelectItem value="izin_resmi" className="text-xs font-semibold">
                                              Izin Resmi
                                            </SelectItem>
                                          </SelectContent>
                                        </Select>
                                        {editingReportType === 'scan' && (
                                          <div className="grid grid-cols-2 gap-2">
                                            <label className="space-y-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                                              Scan masuk
                                              <Input
                                                type="time"
                                                value={editingScanIn}
                                                onChange={(event) => setEditingScanIn(event.target.value)}
                                                className="h-8 rounded-sm bg-white font-mono text-xs"
                                              />
                                            </label>
                                            <label className="space-y-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                                              Scan pulang
                                              <Input
                                                type="time"
                                                value={editingScanOut}
                                                onChange={(event) => setEditingScanOut(event.target.value)}
                                                className="h-8 rounded-sm bg-white font-mono text-xs"
                                              />
                                            </label>
                                          </div>
                                        )}
                                        {item.kind === 'satpam_absence' && editingReportType === 'izin_resmi' && (
                                          <Select
                                            value={editingAbsenceType}
                                            onValueChange={(value) => {
                                              if (value) setEditingAbsenceType(value);
                                            }}
                                          >
                                            <SelectTrigger className="h-9 rounded-sm border-indigo-200 bg-white text-xs font-bold text-slate-800">
                                              <SelectValue>Jenis alasan izin</SelectValue>
                                            </SelectTrigger>
                                            <SelectContent className="rounded-md bg-white">
                                              {SATPAM_ABSENCE_TYPE_OPTIONS.map((option) => (
                                                <SelectItem key={option.value} value={option.value} className="text-xs font-semibold">
                                                  {option.label}
                                                </SelectItem>
                                              ))}
                                            </SelectContent>
                                          </Select>
                                        )}
                                        <div className="flex justify-end gap-2 pt-1">
                                          <Button
                                            type="button"
                                            variant="outline"
                                            onClick={cancelTypeEdit}
                                            disabled={typeActionLoading !== null}
                                            className="h-7 rounded-sm bg-white px-2.5 text-[10px] font-bold"
                                          >
                                            Batal
                                          </Button>
                                          <Button
                                            type="button"
                                            onClick={() => void handleChangeType(item)}
                                            disabled={typeActionLoading !== null}
                                            className="h-7 rounded-sm bg-indigo-600 px-3 text-[10px] font-bold text-white hover:bg-indigo-700"
                                          >
                                            {typeActionLoading === item.key && (
                                              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                            )}
                                            Simpan Jenis
                                          </Button>
                                        </div>
                                      </div>
                                    )}
                                    <div className="flex items-center justify-between gap-3">
                                      <span>Kategori:</span>
                                      <span className="text-slate-900">
                                        {categoryLabel(item.category)}
                                      </span>
                                    </div>
                                    {item.kind === 'satpam_absence' && item.shiftName && (
                                      <div className="flex items-center justify-between gap-3">
                                        <span>Shift / Pos:</span>
                                        <span className="text-slate-900">
                                          {item.shiftName}
                                          {item.postId ? ` · ${item.postId}` : ''}
                                        </span>
                                      </div>
                                    )}
                                    {item.isUnassignedSatpam && (
                                      <div className="flex items-center justify-between gap-3">
                                        <span>Penjadwalan:</span>
                                        <span className="font-bold text-indigo-700">
                                          Tanpa regu / jadwal dinas
                                        </span>
                                      </div>
                                    )}
                                    {item.hasShiftRegistrationConflict && (
                                      <div className="space-y-1 rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900">
                                        <p className="font-bold">
                                          ⚠ Pegawai sudah terdaftar pada shift tanggal ini
                                        </p>
                                        <p className="text-[11px] font-semibold">
                                          {item.isUnassignedSatpam
                                            ? 'Izin tanpa regu atau jadwal dinas tidak menambah pembayaran shift.'
                                            : item.status === 'approved'
                                            ? 'Izin disetujui menjadi dasar pembayaran. Perbaiki laporan shift yang masih mencantumkan pegawai ini.'
                                            : 'Jika izin disetujui, pembayaran mengikuti izin dan dihitung satu kali meskipun ada laporan shift.'}
                                        </p>
                                        {item.shiftRegistrationConflicts?.map((reg) => (
                                          <p key={reg.id} className="text-[11px] font-semibold">
                                            {reg.shiftName || 'Shift'}
                                            {reg.postId ? ` · ${reg.postId}` : ''}
                                            {reg.shiftType ? ` · ${reg.shiftType}` : ''}
                                            {reg.ketuaShiftName
                                              ? ` · Ketua: ${reg.ketuaShiftName}`
                                              : ''}
                                          </p>
                                        ))}
                                        <Link
                                          href={satpamShiftReviewHref(item.raw)}
                                          className="mt-2 inline-flex min-h-8 items-center gap-1.5 rounded-sm border border-amber-300 bg-white px-2.5 text-xs font-bold text-amber-800 transition-colors hover:bg-amber-100"
                                        >
                                          <ExternalLink className="h-3.5 w-3.5" />
                                          Check Shift
                                        </Link>
                                      </div>
                                    )}
                                    {item.attendanceCheck && (
                                      <div className="flex items-center justify-between gap-3">
                                        <span>Verifikasi Kehadiran:</span>
                                        <span
                                          className={`inline-flex rounded-sm border px-2 py-0.5 text-xs font-semibold ${checkClass(
                                            item.attendanceCheck,
                                          )}`}
                                        >
                                          {gantiLiburVerdictLabel(item.attendanceCheck.verdict)}
                                          {item.attendanceCheck.scanIn || item.attendanceCheck.scanOut
                                            ? ` (${item.attendanceCheck.scanIn || '--:--'} – ${item.attendanceCheck.scanOut || '--:--'})`
                                            : ''}
                                        </span>
                                      </div>
                                    )}
                                    <div className="mt-3 border-t border-slate-100/50 pt-3">
                                      <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                        Alasan Pengajuan
                                      </span>
                                      <p className="mt-1.5 text-xs font-semibold leading-relaxed text-slate-700">
                                        {item.reason}
                                      </p>
                                    </div>
                                    {item.decisionReason && (
                                      <div className="mt-2 border-t border-slate-100/50 pt-2 text-xs text-slate-500">
                                        <span className="font-semibold text-slate-600">
                                          Catatan keputusan:
                                        </span>{' '}
                                        {item.decisionReason}
                                      </div>
                                    )}
                                    {item.approvedAmount !== undefined && item.status === 'approved' && (
                                      <p className="pt-2 text-xs font-bold text-emerald-700">
                                        Nilai disetujui: {money(item.approvedAmount)}
                                      </p>
                                    )}
                                    {item.payrollExcludedFromHarian &&
                                      item.status === 'approved' && (
                                        <p className="pt-2 text-xs font-bold text-amber-700">
                                          {item.payrollExclusionReason === 'NO_SCHEDULED_DUTY'
                                            ? 'Disetujui tanpa tambahan Harian karena pegawai belum memiliki regu atau jadwal dinas.'
                                            : 'Nilai payroll historis mengikuti keputusan sebelumnya.'}
                                        </p>
                                      )}
                                  </div>
                                </div>

                                <div className="text-left">
                                  <span className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                    Dokumen Pendukung
                                  </span>
                                  {item.evidenceUrl ? (
                                    isImageProofUrl(item.evidenceUrl) ? (
                                      <div className="h-[calc(100%-1.25rem)] overflow-hidden rounded-md border border-slate-100 bg-slate-50 p-2">
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setSelectedEvidence({
                                              url: item.evidenceUrl!,
                                              title: `Foto Bukti ${item.employeeName} · ${item.date}`,
                                            })
                                          }
                                          className="group relative block h-full w-full cursor-zoom-in"
                                        >
                                          {/* eslint-disable-next-line @next/next/no-img-element */}
                                          <img
                                            src={item.evidenceUrl}
                                            alt="Bukti Pendukung"
                                            className="h-full max-h-[280px] w-full rounded-sm object-contain transition-opacity hover:opacity-90"
                                          />
                                          <div className="absolute inset-0 flex items-center justify-center gap-1 rounded-sm bg-black/40 text-[10px] font-bold text-white opacity-0 transition-opacity group-hover:opacity-100">
                                            <ZoomIn className="h-3.5 w-3.5" /> Perbesar Gambar
                                          </div>
                                        </button>
                                      </div>
                                    ) : (
                                      <a
                                        href={item.evidenceUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-bold text-indigo-500 hover:underline"
                                      >
                                        <FileText className="h-4 w-4" /> Buka Lampiran Bukti
                                        (PDF/Dokumen)
                                      </a>
                                    )
                                  ) : item.attachments && item.attachments.length > 0 ? (
                                    <div className="rounded-md border border-slate-100 bg-slate-50 p-3">
                                      <GantiLiburAttachmentLinks
                                        attachments={item.attachments}
                                      />
                                    </div>
                                  ) : (
                                    <div className="flex h-[calc(100%-1.25rem)] min-h-[160px] items-center justify-center rounded-md border border-dashed border-slate-200 text-xs font-semibold text-slate-400">
                                      Tidak ada dokumen pendukung
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>

                            {canEdit && canReview && (
                              <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
                                <Button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (item.kind === 'paid_leave') {
                                      openDeclineDialog(
                                        'paid_leave',
                                        item.raw,
                                        `Tolak Cuti Tahunan - ${item.employeeName}`,
                                      );
                                    } else if (item.kind === 'ganti_libur') {
                                      openDeclineDialog(
                                        'ganti_libur',
                                        item.raw,
                                        `Tolak Ganti Libur - ${item.employeeName}`,
                                        item.attendanceCheck
                                          ? gantiLiburDeclineSuggestion(
                                              item.attendanceCheck.verdict,
                                            )
                                          : '',
                                      );
                                    } else if (item.kind === 'official_leave') {
                                      openDeclineDialog(
                                        'official_leave',
                                        item.raw,
                                        `Tolak Izin / Presensi - ${item.employeeName}`,
                                      );
                                    } else if (item.kind === 'satpam_absence') {
                                      openDeclineDialog(
                                        'satpam_absence',
                                        item.raw,
                                        `Tolak Pengajuan Satpam - ${item.employeeName}`,
                                      );
                                    }
                                  }}
                                  disabled={working}
                                  variant="outline"
                                  className="flex h-9 cursor-pointer items-center gap-1.5 rounded-sm border-rose-200 bg-white px-4 text-xs font-bold text-rose-600 shadow-sm hover:bg-rose-50"
                                >
                                  <X className="h-3.5 w-3.5" /> {isSupersede ? 'Tolak Ulang' : 'Tolak'}
                                </Button>
                                <Button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (item.kind === 'paid_leave') {
                                      void onReviewPaidLeave(item.raw, 'approve');
                                    } else if (item.kind === 'ganti_libur') {
                                      void onReviewGantiLibur(item.raw, 'approve');
                                    } else if (item.kind === 'official_leave') {
                                      void onReviewOfficialLeave(item.raw, 'approve');
                                    } else if (item.kind === 'satpam_absence') {
                                      void onReviewSatpamAbsence(item.raw, approveAction);
                                    }
                                  }}
                                  disabled={working}
                                  className="flex h-9 cursor-pointer items-center gap-1.5 rounded-sm bg-indigo-600 px-5 text-xs font-bold text-white shadow-md transition-all hover:bg-indigo-700 active:scale-95"
                                >
                                  <Check className="h-3.5 w-3.5" />
                                  {isSupersede ? 'Setujui Ulang' : 'Setujui'}
                                </Button>
                              </div>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export default function PekaryaAttendancePage() {
  const searchParams = useSearchParams();
  const { profile } = useAuth();
  const month = Number(searchParams.get('month') || new Date().getMonth() + 1);
  const year = Number(searchParams.get('year') || new Date().getFullYear());
  // Whether this account can see Satpam data at all — mirrors the check the
  // review endpoints themselves use, so the toggle never offers a tab that
  // would just come back empty/forbidden.
  const canViewSatpamCategory =
    ['super_admin', 'finance_verifier', 'loyalis_admin'].includes(profile?.role || '') ||
    Boolean(profile?.permittedCategories?.includes('SATPAM'));
  // Satpam is reviewed in this same list, so there is one view: every
  // blue-collar category together. An older link with ?category=SATPAM simply
  // opens it.
  const category = ALL_BLUE_COLLAR_CATEGORY;
  const period = `${year}-${String(month).padStart(2, '0')}`;
  const [data, setData] = useState<AttendanceView | null>(null);
  // `loading` is the blocking first load of a period/category (the results are
  // swapped for a placeholder). `refreshing` is every reload after an action:
  // the results stay on screen and update in place, because collapsing them to
  // a placeholder shrinks the page and the browser throws the scroll position
  // back to the top.
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const loadSequence = useRef(0);
  const loadAbort = useRef<AbortController | null>(null);
  // A page that is left mid-load stops asking the server for results nobody sees.
  useEffect(() => () => loadAbort.current?.abort(), []);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  // An object per message so showing the same text twice in a row still
  // restarts the toast's timer.
  const [messageNotice, setMessageNotice] = useState<{ text: string } | null>(null);
  const setMessage = useCallback(
    (text: string) => setMessageNotice(text ? { text } : null),
    [],
  );
  const notice = useMemo(
    () =>
      error
        ? { type: 'error' as const, text: error }
        : messageNotice
          ? { type: 'success' as const, text: messageNotice.text }
          : null,
    [error, messageNotice],
  );
  const [selectedEvidence, setSelectedEvidence] = useState<{
    url: string;
    title: string;
  } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [correction, setCorrection] = useState<CorrectionState | null>(null);
  const correctionTimeRangeInvalid = Boolean(
    correction?.present &&
      correction.scanIn &&
      correction.scanOut &&
      !isValidAttendanceScanRange(correction.scanIn, correction.scanOut),
  );
  const [satpamSubmissions, setSatpamSubmissions] =
    useState<SatpamAbsenceAdminView | null>(null);
  const [satpamSubmissionNotice, setSatpamSubmissionNotice] = useState('');
  const [paidLeaves, setPaidLeaves] = useState<AnnualPaidLeaveRequest[]>([]);
  const [gantiLiburs, setGantiLiburs] = useState<GantiLiburRequest[]>([]);
  const [declineTarget, setDeclineTarget] = useState<{
    type: 'official_leave' | 'satpam_absence' | 'paid_leave' | 'ganti_libur';
    item: any;
    title: string;
    defaultReason?: string;
  } | null>(null);
  const [declineReason, setDeclineReason] = useState('');
  const [linkTarget, setLinkTarget] = useState<DepartmentUnmatchedRow | null>(null);
  const [linkEmployeeId, setLinkEmployeeId] = useState('');
  const [linkSearch, setLinkSearch] = useState('');
  // The dialog shows the form, then what is happening, then how it ended.
  const [linkPhase, setLinkPhase] = useState<'form' | 'saving' | 'success' | 'error'>('form');
  const [linkResult, setLinkResult] = useState<{ detail: string } | null>(null);
  const canEdit =
    profile?.role === 'satker_head' || profile?.role === 'super_admin';
  // The manual-link endpoint accepts super_admin as well as satker_head (it
  // follows this app's usual write-permission pattern), so the button that
  // triggers it must be visible to both, not just to canEdit's satker_head.
  const canLinkAttendance =
    profile?.role === 'satker_head' || profile?.role === 'super_admin';
  // Same authority as manual linking — the corrections endpoint accepts both.
  const canEditScans = canLinkAttendance;

  const load = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    // A newer load supersedes this one: only the latest may write results or
    // clear the loading flags, so a slow reload finishing late can never put
    // a previous category's data back on screen.
    const sequence = ++loadSequence.current;
    // A newer load replaces the previous request outright: it is cancelled
    // rather than left running on the server beside the new one.
    loadAbort.current?.abort();
    const controller = new AbortController();
    loadAbort.current = controller;
    const { signal } = controller;
    if (period < '2026-08') {
      setData(null);
      setPaidLeaves([]);
      setGantiLiburs([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    if (silent) {
      setRefreshing(true);
    } else {
      setRefreshing(false);
      setLoading(true);
    }
    setError('');
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, LOAD_TIMEOUT_MS);
    try {
      const paidLeavesPromise = authenticatedJson<{ requests: AnnualPaidLeaveRequest[] }>(
        `/api/payroll/paid-leave/review?year=${year}&period=${encodeURIComponent(period)}&status=all`,
        { signal },
      ).catch(() => ({ requests: [] }));

      const gantiLibursPromise = authenticatedJson<{ requests: GantiLiburRequest[] }>(
        `/api/payroll/ganti-libur/review?dayOffPeriod=${encodeURIComponent(period)}&status=all`,
        { signal },
      ).catch(() => ({ requests: [] }));

      let submissionNotice = '';
      const satpamSubmissionsPromise: Promise<SatpamAbsenceAdminView | null> =
        canViewSatpamCategory
          ? authenticatedJson<SatpamAbsenceAdminView>(
              `/api/satpam/absences?period=${encodeURIComponent(period)}`,
              { signal },
            ).catch((cause): SatpamAbsenceAdminView => {
              submissionNotice =
                cause instanceof Error
                  ? cause.message
                  : 'Gagal memuat pengajuan Satpam.';
              return { requests: [] };
            })
          : Promise.resolve(null);
      const [result, submissions, paidLeavesRes, gantiLibursRes] = await Promise.all([
        authenticatedJson<AttendanceView>(
          `/api/attendance/pekarya?period=${encodeURIComponent(period)}&category=${encodeURIComponent(category)}`,
          { signal },
        ),
        satpamSubmissionsPromise,
        paidLeavesPromise,
        gantiLibursPromise,
      ]);
      if (sequence !== loadSequence.current) return;
      setData(result);
      setSatpamSubmissionNotice(submissionNotice);
      setSatpamSubmissions(submissions);
      setPaidLeaves(paidLeavesRes.requests || []);
      setGantiLiburs(gantiLibursRes.requests || []);
      // Opening the page used to refresh the saved Satpam rekap (shift counts
      // and the monthly bonus) from the reconciliation. That now happens here,
      // in the background, so the page does not wait on it.
      if (!silent && canViewSatpamCategory && canEdit) {
        void authenticatedJson(
          `/api/satpam/duty-reconciliation?period=${encodeURIComponent(period)}&refresh=true`,
        ).catch((cause) => console.error('Satpam rekap refresh failed', cause));
      }
    } catch (cause) {
      if (sequence !== loadSequence.current) return;
      // Cancelled because the page was left: nothing is waiting for an answer.
      if (signal.aborted && !timedOut) return;
      setError(
        timedOut
          ? 'Memuat presensi terlalu lama. Periksa koneksi, lalu tekan Muat Ulang.'
          : cause instanceof Error
            ? cause.message
            : 'Gagal memuat presensi Pekarya.',
      );
    } finally {
      window.clearTimeout(timeout);
      if (sequence === loadSequence.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [canEdit, canViewSatpamCategory, category, period, year]);

  // Reload after an action: keeps the results on screen and updates them in
  // place instead of collapsing the page to the loading placeholder.
  const refresh = useCallback(() => load({ silent: true }), [load]);

  const reviewAbsence = async (
    absence: SatpamAbsenceAdminView['requests'][number],
    action: 'approve' | 'decline' | 'supersede_approve' | 'supersede_decline',
    reason = '',
  ) => {
    if (action.endsWith('decline') && !reason.trim()) {
      setError('Alasan penolakan pengajuan satpam wajib diisi.');
      return;
    }
    const reportType = satpamAttendanceReportType(absence);
    setWorking(true);
    setError('');
    try {
      const reviewResult = await authenticatedJson<{
        payrollExcludedFromHarian?: boolean;
        payrollExclusionReason?: string | null;
        amount?: number;
      }>('/api/satpam/absences/review', {
        method: 'POST',
        body: JSON.stringify({
          requestId: createFinancialRequestId('satpam-absence-review'),
          absenceRequestId: absence.id,
          action,
          expectedRevision: absence.revision,
          reason: reason.trim() || undefined,
        }),
      });
      const isUnassignedSatpam =
        absence.scheduleRelation === 'unassigned' || !absence.teamId;
      setMessage(
        reportType === 'scan'
          ? action === 'approve'
            ? 'Laporan scan disetujui dan presensi Satpam telah diperbarui.'
            : 'Laporan scan ditolak.'
          : action.endsWith('approve')
            ? reviewResult.payrollExclusionReason === 'NO_SCHEDULED_DUTY' ||
              (isUnassignedSatpam && reviewResult.payrollExcludedFromHarian === true)
              ? 'Izin disetujui tanpa tambahan Harian karena pegawai belum memiliki regu atau jadwal dinas.'
              : `Izin disetujui. Hak ${money(reviewResult.amount || 0)} dan rekonsiliasi telah diperbarui.`
            : 'Izin ditolak dan rekonsiliasi telah diperbarui.',
      );
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Gagal memutuskan izin.');
    } finally {
      setWorking(false);
    }
  };

  const resetLinkDialog = () => {
    setLinkTarget(null);
    setLinkEmployeeId('');
    setLinkSearch('');
    setLinkPhase('form');
    setLinkResult(null);
    setError('');
  };

  const saveManualLink = async () => {
    if (!linkTarget || !linkEmployeeId) return;
    const chosen = (
      linkTarget.unrouted ? data?.unroutedLinkCandidates : data?.linkCandidates
    )?.find((candidate) => candidate.employeeId === linkEmployeeId);
    setLinkPhase('saving');
    setWorking(true);
    setError('');
    try {
      await authenticatedJson('/api/attendance/pekarya/manual-link', {
        method: 'POST',
        body: JSON.stringify({
          requestId: createFinancialRequestId('attendance-manual-link'),
          period,
          sourceKey: linkTarget.sourceKey,
          employeeId: linkEmployeeId,
        }),
      });
      setLinkResult({
        detail: `${linkTarget.sourceName || 'Baris presensi'} dihubungkan ke ${
          chosen?.name || 'pegawai terpilih'
        }. ${linkTarget.dates.length} hari presensi kini dihitung untuk pegawai tersebut. Jika presensi periode ini sudah dipublikasikan, publikasikan ulang agar upahnya ikut diperbarui.${
          chosen && !chosen.nipy
            ? ' Upah pegawai ini baru dapat dipublikasikan setelah NIPY-nya dilengkapi.'
            : ''
        }`,
      });
      setLinkPhase('success');
      // The list reloads behind the dialog; it does not hold up the result.
      void refresh();
    } catch (cause) {
      setLinkResult({
        detail:
          cause instanceof Error
            ? cause.message
            : 'Gagal menghubungkan baris presensi.',
      });
      setLinkPhase('error');
    } finally {
      setWorking(false);
    }
  };

  const reviewOfficialLeave = async (
    leave: PekaryaOfficialLeaveRequest,
    action: 'approve' | 'decline',
    reason = '',
  ) => {
    if (action === 'decline' && !reason.trim()) {
      setError('Alasan penolakan izin resmi wajib diisi.');
      return;
    }
    setWorking(true);
    setError('');
    try {
      await authenticatedJson('/api/attendance/pekarya/official-leave/review', {
        method: 'POST',
        body: JSON.stringify({
          requestId: createFinancialRequestId('pekarya-official-leave-review'),
          officialLeaveRequestId: leave.id,
          action,
          expectedRevision: leave.revision,
          reason: reason.trim() || undefined,
        }),
      });
      setMessage(
        action === 'approve'
          ? pekaryaAttendanceReportType(leave) === 'scan'
            ? 'Laporan scan disetujui dan presensi telah diperbarui.'
            : 'Izin resmi disetujui dan presensi hari penuh telah diperbarui.'
          : pekaryaAttendanceReportType(leave) === 'scan'
            ? 'Laporan scan ditolak.'
            : 'Izin resmi ditolak.',
      );
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Gagal memutuskan pengajuan presensi.',
      );
    } finally {
      setWorking(false);
    }
  };

  const reviewPaidLeave = async (
    item: AnnualPaidLeaveRequest,
    action: 'approve' | 'decline',
    reason = '',
  ) => {
    if (action === 'decline' && !reason.trim()) {
      setError('Alasan penolakan cuti tahunan wajib diisi.');
      return;
    }
    setWorking(true);
    setError('');
    try {
      await authenticatedJson('/api/payroll/paid-leave/review', {
        method: 'POST',
        body: JSON.stringify({
          requestId: createFinancialRequestId(`annual-paid-leave-${action}`),
          annualPaidLeaveRequestId: item.id,
          action,
          expectedRevision: item.revision,
          reason: reason.trim(),
        }),
      });
      if (action === 'approve') {
        try {
          await propagateUraianToSlips({
            scope: 'pekarya',
            period: item.period,
            jobCategory: item.category,
          });
        } catch (propagateError) {
          console.error('Annual paid leave propagation failed:', propagateError);
        }
      }
      setMessage(
        action === 'approve'
          ? `Cuti tahunan ${item.employeeName || item.employeeId} disetujui.`
          : `Cuti tahunan ${item.employeeName || item.employeeId} ditolak.`,
      );
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Gagal memutuskan pengajuan cuti tahunan.',
      );
    } finally {
      setWorking(false);
    }
  };

  const reviewGantiLibur = async (
    item: GantiLiburRequest,
    action: 'approve' | 'decline',
    reason = '',
  ) => {
    if (action === 'decline' && !reason.trim()) {
      setError('Alasan penolakan ganti libur wajib diisi.');
      return;
    }
    setWorking(true);
    setError('');
    try {
      const res = await authenticatedJson<{ payrollWarning?: string }>(
        '/api/payroll/ganti-libur/review',
        {
          method: 'POST',
          body: JSON.stringify({
            requestId: createFinancialRequestId(`ganti-libur-${action}`),
            gantiLiburRequestId: item.id,
            action,
            expectedRevision: item.revision,
            reason: reason.trim(),
          }),
        },
      );
      if (action === 'approve') {
        try {
          await propagateUraianToSlips({
            scope: 'pekarya',
            period: item.dayOffPeriod,
            jobCategory: item.category,
          });
        } catch (propagateError) {
          console.error('Ganti libur propagation failed:', propagateError);
        }
      }
      setMessage(
        `${
          action === 'approve'
            ? `Ganti libur ${item.employeeName || item.employeeId} disetujui.`
            : `Ganti libur ${item.employeeName || item.employeeId} ditolak.`
        }${res.payrollWarning ? ` ${res.payrollWarning}` : ''}`,
      );
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Gagal memutuskan pengajuan ganti libur.',
      );
    } finally {
      setWorking(false);
    }
  };

  const openDeclineDialog = (
    type: 'official_leave' | 'satpam_absence' | 'paid_leave' | 'ganti_libur',
    item: any,
    title: string,
    defaultReason = '',
  ) => {
    setDeclineTarget({ type, item, title, defaultReason });
    setDeclineReason(defaultReason);
  };

  const handleConfirmDecline = async () => {
    if (!declineTarget) return;
    const reason = declineReason.trim();
    if (!reason) {
      setError('Alasan penolakan wajib diisi.');
      return;
    }
    const target = declineTarget;
    setDeclineTarget(null);
    setDeclineReason('');
    if (target.type === 'paid_leave') {
      await reviewPaidLeave(target.item as AnnualPaidLeaveRequest, 'decline', reason);
    } else if (target.type === 'ganti_libur') {
      await reviewGantiLibur(target.item as GantiLiburRequest, 'decline', reason);
    } else if (target.type === 'official_leave') {
      await reviewOfficialLeave(target.item as PekaryaOfficialLeaveRequest, 'decline', reason);
    } else if (target.type === 'satpam_absence') {
      const absence = target.item as SatpamAbsenceAdminView['requests'][number];
      const declineAction = absence.status === 'pending' ? 'decline' : 'supersede_decline';
      await reviewAbsence(absence, declineAction, reason);
    }
  };

  const handleBulkApproveSubmissions = async (items: BlueCollarSubmissionItem[]) => {
    if (items.length === 0) return;
    setWorking(true);
    setError('');
    setMessage('');
    let successCount = 0;
    const errors: string[] = [];

    for (const item of items) {
      try {
        if (item.kind === 'official_leave') {
          await authenticatedJson('/api/attendance/pekarya/official-leave/review', {
            method: 'POST',
            body: JSON.stringify({
              requestId: createFinancialRequestId('pekarya-official-leave-bulk-approve'),
              officialLeaveRequestId: item.id,
              action: 'approve',
              expectedRevision: item.raw.revision,
            }),
          });
        } else if (item.kind === 'satpam_absence') {
          await authenticatedJson('/api/satpam/absences/review', {
            method: 'POST',
            body: JSON.stringify({
              requestId: createFinancialRequestId('satpam-absence-bulk-approve'),
              absenceRequestId: item.id,
              action: 'approve',
              expectedRevision: item.raw.revision,
            }),
          });
        } else if (item.kind === 'paid_leave') {
          await authenticatedJson('/api/payroll/paid-leave/review', {
            method: 'POST',
            body: JSON.stringify({
              requestId: createFinancialRequestId('annual-paid-leave-bulk-approve'),
              annualPaidLeaveRequestId: item.id,
              action: 'approve',
              expectedRevision: item.raw.revision,
            }),
          });
          try {
            await propagateUraianToSlips({
              scope: 'pekarya',
              period: item.raw.period,
              jobCategory: item.raw.category,
            });
          } catch (e) {
            console.error('Paid leave propagation error:', e);
          }
        } else if (item.kind === 'ganti_libur') {
          await authenticatedJson('/api/payroll/ganti-libur/review', {
            method: 'POST',
            body: JSON.stringify({
              requestId: createFinancialRequestId('ganti-libur-bulk-approve'),
              gantiLiburRequestId: item.id,
              action: 'approve',
              expectedRevision: item.raw.revision,
            }),
          });
          try {
            await propagateUraianToSlips({
              scope: 'pekarya',
              period: item.raw.dayOffPeriod,
              jobCategory: item.raw.category,
            });
          } catch (e) {
            console.error('Ganti libur propagation error:', e);
          }
        }
        successCount++;
      } catch (cause) {
        errors.push(
          `${item.employeeName} (${item.date}): ${cause instanceof Error ? cause.message : 'Gagal menyetujui'}`,
        );
      }
    }

    setWorking(false);
    if (errors.length > 0) {
      setError(`Berhasil menyetujui ${successCount} pengajuan, tetapi ada kegagalan:\n${errors.join('\n')}`);
    } else {
      setMessage(`Berhasil menyetujui ${successCount} pengajuan sekaligus.`);
    }
    await refresh();
  };

  const displayPaidLeaves = useMemo(() => {
    return paidLeaves.filter((item) => {
      if (item.employeeKind === 'loyalis') return false;
      if (category === ALL_BLUE_COLLAR_CATEGORY) {
        return canViewSatpamCategory ? true : item.category !== 'SATPAM';
      }
      return item.category === category;
    });
  }, [category, paidLeaves, canViewSatpamCategory]);

  const displayGantiLiburs = useMemo(() => {
    return gantiLiburs.filter((item) => {
      if (item.employeeKind === 'loyalis') return false;
      if (category === ALL_BLUE_COLLAR_CATEGORY) {
        return canViewSatpamCategory ? true : item.category !== 'SATPAM';
      }
      return item.category === category;
    });
  }, [category, gantiLiburs, canViewSatpamCategory]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  const totals = useMemo(() => {
    if (!data) return null;
    return data.employees.reduce(
      (acc, employee) => ({
        employees: acc.employees + 1,
        harian: acc.harian + employee.harianCount,
        premium: acc.premium + employee.jumatLiburCount,
        harianAmount: acc.harianAmount + employee.harianAmount,
        premiumAmount: acc.premiumAmount + employee.jumatLiburAmount,
        workedSeconds: acc.workedSeconds + employee.workedSeconds,
        amount: acc.amount + employee.totalAmount,
      }),
      {
        employees: 0,
        harian: 0,
        premium: 0,
        harianAmount: 0,
        premiumAmount: 0,
        workedSeconds: 0,
        amount: 0,
      },
    );
  }, [data]);

  const departmentUnmatched = useMemo(() => {
    if (!data) return [];
    return data.exceptions.departmentUnmatched || [];
  }, [data]);

  // One list holding both sides of the reconciliation: the employees the import
  // resolved, and the rows it could not, so a reviewer sees the whole period in
  // a single place instead of two disconnected lists.
  const attendanceRows = useMemo(() => {
    if (!data) return [];
    const linked = data.employees.map((employee) => ({
      key: `employee:${employee.employeeId}`,
      employee: employee as EmployeeAttendance | null,
      unlinked: null as DepartmentUnmatchedRow | null,
      satpam: null as SatpamAttendanceDetailEmployee | null,
    }));
    const satpam = (data.satpamAttendance?.employees || []).map((guard) => ({
      key: `satpam:${guard.employeeId}`,
      employee: null as EmployeeAttendance | null,
      unlinked: null as DepartmentUnmatchedRow | null,
      satpam: guard as SatpamAttendanceDetailEmployee | null,
    }));
    const unlinked = departmentUnmatched.map((row) => ({
      key: `unlinked:${row.sourceKey}`,
      employee: null as EmployeeAttendance | null,
      unlinked: row as DepartmentUnmatchedRow | null,
      satpam: null as SatpamAttendanceDetailEmployee | null,
    }));
    const nameOf = (row: (typeof linked)[number] | (typeof satpam)[number]) =>
      row.employee?.name || row.satpam?.name || '';
    return [
      ...[...linked, ...satpam].sort((left, right) =>
        nameOf(left).localeCompare(nameOf(right), 'id'),
      ),
      ...unlinked,
    ];
  }, [data, departmentUnmatched]);

  // Rows with no department and no matching employee.
  const unroutedUnmatched = useMemo(() => {
    if (!data) return [];
    return data.exceptions.unroutedUnmatched || [];
  }, [data]);

  const linkCandidates = useMemo(() => {
    // Any row may belong to Satpam as well as the payable categories, so the
    // dialog offers every blue-collar employee this account may link to. The
    // payable categories alone are the fallback for accounts that may not link.
    const candidates = data?.unroutedLinkCandidates?.length
      ? data.unroutedLinkCandidates
      : data?.linkCandidates || [];
    const search = linkSearch.trim().toLowerCase();
    if (!search) return candidates;
    return candidates.filter(
      (candidate) =>
        candidate.name.toLowerCase().includes(search) ||
        candidate.nipy.toLowerCase().includes(search),
    );
  }, [data, linkSearch]);

  const openCorrection = (employee: EmployeeAttendance, day?: AttendanceDay) => {
    setCorrection({
      employee,
      date: day?.date || `${period}-01`,
      present: day?.present ?? true,
      scanIn: day?.scanIn || '',
      scanOut: day?.scanOut || '',
      reason: '',
      expectedRevision: day?.correctionRevision || 0,
    });
  };

  const saveCorrection = async () => {
    if (!correction) return;
    if (correctionTimeRangeInvalid) {
      setError('Scan pulang harus lebih lambat dari scan masuk.');
      return;
    }
    setWorking(true);
    setError('');
    try {
      await authenticatedJson('/api/attendance/pekarya/corrections', {
        method: 'POST',
        body: JSON.stringify({
          requestId: createFinancialRequestId('attendance-correction'),
          period,
          category: correction.employee.category,
          employeeId: correction.employee.employeeId,
          date: correction.date,
          present: correction.present,
          workStatus: correction.present ? 'MASUK' : 'TIDAK MASUK',
          scanIn: correction.scanIn || null,
          scanOut: correction.scanOut || null,
          reason: correction.reason,
          expectedRevision: correction.expectedRevision,
        }),
      });
      setCorrection(null);
      setMessage('Koreksi tersimpan sebagai catatan baru dan hasil upah sudah diperbarui.');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Gagal menyimpan koreksi.');
    } finally {
      setWorking(false);
    }
  };

  /**
   * Commits an inline edit of one scan cell as a correction, without asking
   * for a reason — a fixed, honest one is recorded instead so the audit trail
   * (Riwayat Koreksi) still says how the change was made.
   */
  const saveScanCellEdit = async (
    employee: EmployeeAttendance,
    day: AttendanceDay,
    field: 'scanIn' | 'scanOut',
    rawValue: string,
  ) => {
    const nextValue = rawValue || null;
    const currentScanIn = day.scanIn || null;
    const currentScanOut = day.scanOut || null;
    const nextScanIn = field === 'scanIn' ? nextValue : currentScanIn;
    const nextScanOut = field === 'scanOut' ? nextValue : currentScanOut;
    if (nextScanIn === currentScanIn && nextScanOut === currentScanOut) return;
    if (
      nextScanIn &&
      nextScanOut &&
      !isValidAttendanceScanRange(nextScanIn, nextScanOut)
    ) {
      setError('Scan pulang harus lebih lambat dari scan masuk.');
      return;
    }
    setWorking(true);
    setError('');
    try {
      await authenticatedJson('/api/attendance/pekarya/corrections', {
        method: 'POST',
        body: JSON.stringify({
          requestId: createFinancialRequestId('attendance-correction'),
          period,
          category: employee.category,
          employeeId: employee.employeeId,
          date: day.date,
          present: Boolean(nextScanIn || nextScanOut),
          workStatus: nextScanIn || nextScanOut ? 'MASUK' : 'TIDAK MASUK',
          scanIn: nextScanIn,
          scanOut: nextScanOut,
          reason: 'Diedit langsung dari tabel presensi harian.',
          expectedRevision: day.correctionRevision,
        }),
      });
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Gagal memperbarui waktu scan.',
      );
    } finally {
      setWorking(false);
    }
  };

  const publish = async () => {
    if (!data) return;
    const warnings = Array.from(
      new Set(
        data.employees.flatMap((employee) =>
          employee.warnings.filter(
            (warning) =>
              warning !== 'NIPY_MISSING' && warning !== 'NIPY_DUPLICATE',
          ),
        ),
      ),
    );
    if (
      warnings.length > 0 &&
      !window.confirm(
        `Publikasikan dengan peringatan berikut?\n${warnings
          .map((warning) => `• ${warningLabel[warning] || warning}`)
          .join('\n')}`,
      )
    ) {
      return;
    }
    setWorking(true);
    setError('');
    try {
      await authenticatedJson('/api/attendance/pekarya/publish', {
        method: 'POST',
        body: JSON.stringify({
          requestId: createFinancialRequestId('attendance-publish'),
          period,
          category,
          acknowledgedWarnings: warnings,
        }),
      });
      setMessage('Presensi berhasil dipublikasikan ke Rekap Uraian.');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Gagal mempublikasikan presensi.');
    } finally {
      setWorking(false);
    }
  };

  if (period < '2026-08') {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-6 text-amber-900">
        Presensi Pekarya otomatis mulai berlaku pada periode Agustus 2026.
        Periode sebelumnya tetap memakai perhitungan historis.
      </div>
    );
  }

  return (
    <div className="space-y-5 text-[16px]">
      {/* Floats above the page (portal, fixed) — an in-flow banner pushes every
          row down and moves whatever the reviewer is looking at. */}
      <FloatingSnackbar
        message={notice}
        duration={error ? 12000 : undefined}
        onDismiss={() => {
          setError('');
          setMessageNotice(null);
        }}
      />

      <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="font-bold text-slate-900">
              {category ? categoryLabel(category) : 'Pilih kategori'} · {period}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {data
                ? `Import revisi ${data.importRevision} · Kalender revisi ${data.calendarRevision}`
                : 'Pilih kategori untuk melihat hasil presensi.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              className="rounded-sm min-h-12 gap-2"
              onClick={() => void refresh()}
              disabled={loading || refreshing || !category}
            >
              <RefreshCw className={`h-4 w-4 ${loading || refreshing ? 'animate-spin' : ''}`} />
              Muat Ulang
            </Button>
          </div>
        </div>
      </section>

      {data && (
          <div className="rounded-md border border-blue-200 bg-blue-50 p-5 text-blue-900">
            <p className="font-bold">Semua pegawai blue collar</p>
            <p className="mt-1 text-sm">
              Daftar ini menggabungkan seluruh kategori yang memakai upah
              presensi beserta seluruh pengajuan presensi, cuti, dan ganti libur (termasuk Satpam) dalam satu card utama.
              Pembayaran shift Satpam mengikuti laporan Ketua Shift atau izin resmi disetujui. Izin disetujui menjadi dasar pembayaran jika keduanya ada pada tanggal yang sama.
            </p>
          </div>
        )}

      {loading && (
        <div className="rounded-md border border-slate-200 bg-white p-8 text-center text-slate-500">
          Memuat hasil presensi…
        </div>
      )}

      {!loading && data && canLinkAttendance && unroutedUnmatched.length > 0 && (
        <UnroutedAttendanceRows
          rows={unroutedUnmatched}
          candidates={data.unroutedLinkCandidates || []}
          disabled={working}
          onLink={(row, suggestion) => {
            setLinkTarget({ ...row, department: '', unrouted: true });
            setLinkEmployeeId('');
            setLinkSearch(suggestion?.name || row.sourceName || '');
            setError('');
          }}
        />
      )}

      {!loading && data && totals && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              ['Pegawai', totals.employees],
              [
                'Harian',
                `${money(totals.harianAmount)} · ${totals.harian} hari`,
              ],
              [
                'Jumat & Libur',
                `${money(totals.premiumAmount)} · ${totals.premium} hari`,
              ],
              ['Total', money(totals.amount)],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-sm text-slate-500">{label}</p>
                <p className="mt-1 text-xl font-bold text-slate-900">{value}</p>
              </div>
            ))}
          </div>

          <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="flex items-center gap-2 font-bold text-slate-900">
                  <ClipboardCheck className="h-5 w-5 text-indigo-600" />
                  {statusText(data)}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {data.exceptions.incompletePunches} scan tidak lengkap ·{' '}
                  {data.exceptions.correctedDays} hari dikoreksi ·{' '}
                  {data.exceptions.duplicateEmployeeDays} hari duplikat ·{' '}
                  {data.exceptions.unmatchedNipys.length} NIPY file tidak dikenal
                </p>
              </div>
              {canEdit && (
                <Button
                  className="rounded-sm min-h-12 gap-2 bg-indigo-600 hover:bg-indigo-700"
                  onClick={() => void publish()}
                  disabled={
                    working ||
                    !data.importRevisionId ||
                    data.employees.some((employee) => employee.publishBlocked)
                  }
                >
                  <Save className="h-4 w-4" />
                  {data.publication
                    ? category === ALL_BLUE_COLLAR_CATEGORY
                      ? 'Publikasikan Ulang Semua'
                      : 'Publikasikan Ulang'
                    : category === ALL_BLUE_COLLAR_CATEGORY
                      ? 'Publikasikan Semua ke Rekap'
                      : 'Publikasikan ke Rekap'}
                </Button>
              )}
            </div>
            {!data.importRevisionId && (
              <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                Publikasi menunggu presensi bulanan diimpor. Menyetujui atau
                menolak pengajuan di bawah tetap bisa dilakukan sekarang — begitu
                presensi bulanan diimpor, keputusan yang sudah diambil ikut
                terhitung otomatis dan publikasi bisa dilanjutkan.
              </div>
            )}
            {data.employees.some((employee) => employee.publishBlocked) && (
              <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
                Publikasi ditahan sampai semua pegawai aktif memiliki NIPY yang
                unik. Peringatan scan satu sisi tidak menghalangi publikasi.
              </div>
            )}
          </section>

          <BlueCollarSubmissionsCard
            category={category}
            canViewSatpamCategory={canViewSatpamCategory}
            canEdit={canEdit}
            working={working}
            profileRole={profile?.role}
            satpamSubmissionNotice={satpamSubmissionNotice}
            officialLeaves={data.officialLeaves || []}
            satpamRequests={
              category === ALL_BLUE_COLLAR_CATEGORY && canViewSatpamCategory
                ? satpamSubmissions?.requests || []
                : []
            }
            paidLeaves={displayPaidLeaves}
            gantiLiburs={displayGantiLiburs}
            onReviewOfficialLeave={reviewOfficialLeave}
            onReviewSatpamAbsence={reviewAbsence}
            onReviewPaidLeave={reviewPaidLeave}
            onReviewGantiLibur={reviewGantiLibur}
            openDeclineDialog={openDeclineDialog}
            onBulkApprove={handleBulkApproveSubmissions}
            setSelectedEvidence={setSelectedEvidence}
            onReload={refresh}
          />

          <div className="flex justify-between items-center px-1">
            <span className="text-[11px] text-slate-500 font-bold">
              Menampilkan{' '}
              <strong className="text-indigo-600 font-mono">
                {attendanceRows.length}
              </strong>{' '}
              data ({data.employees.length + (data.satpamAttendance?.employees.length || 0)} Terhubung
              {departmentUnmatched.length > 0
                ? `, ${departmentUnmatched.length} Belum Terhubung`
                : ''}
              )
            </span>
          </div>

          <section className="space-y-3.5">
            {attendanceRows.map((row, idx) => {
              const employee = row.employee;
              const unlinked = row.unlinked;
              const isExpanded = expanded.has(row.key);
              if (row.satpam) {
                const pendingRequests = satpamSubmissions?.requests || [];
                const findPendingRequest = (absenceId: string) =>
                  pendingRequests.find(
                    (request) =>
                      request.id === absenceId && request.status === 'pending',
                  );
                return (
                  <SatpamAttendanceDetailCard
                    key={row.key}
                    employee={row.satpam}
                    index={idx}
                    expanded={isExpanded}
                    onToggle={() =>
                      setExpanded((current) => {
                        const next = new Set(current);
                        if (next.has(row.key)) next.delete(row.key);
                        else next.add(row.key);
                        return next;
                      })
                    }
                    canEdit={canEdit}
                    working={working}
                    reviewHref={(day) =>
                      day.review
                        ? satpamShiftMismatchReviewHref(
                            period,
                            day.review.occurrenceId,
                            day.review.employeeId,
                          )
                        : null
                    }
                    canReviewAbsence={(absenceId) =>
                      Boolean(findPendingRequest(absenceId))
                    }
                    onApproveAbsence={(absenceId) => {
                      const request = findPendingRequest(absenceId);
                      if (request) void reviewAbsence(request, 'approve');
                    }}
                    onDeclineAbsence={(absenceId, employeeName) => {
                      const request = findPendingRequest(absenceId);
                      if (request) {
                        openDeclineDialog(
                          'satpam_absence',
                          request,
                          `Tolak Pengajuan Satpam - ${employeeName}`,
                        );
                      }
                    }}
                  />
                );
              }
              return (
                <article
                  key={row.key}
                  className={`border-2 rounded-md shadow-sm bg-white transition-all hover:border-indigo-300 overflow-hidden ${
                    isExpanded
                      ? 'ring-4 ring-indigo-50 border-indigo-400 bg-indigo-50/40'
                      : unlinked
                        ? 'border-rose-200/80 bg-rose-50/20'
                        : 'border-indigo-200/80 bg-indigo-50/20'
                  }`}
                >
                  <div
                    onClick={() =>
                      setExpanded((current) => {
                        const next = new Set(current);
                        if (next.has(row.key)) next.delete(row.key);
                        else next.add(row.key);
                        return next;
                      })
                    }
                    className="p-4 flex flex-wrap lg:flex-nowrap items-center justify-between gap-4 cursor-pointer hover:bg-slate-50/20 transition-colors"
                  >
                    {/* Left: Index & Identity */}
                    <div className="flex items-center gap-3 w-full lg:w-[280px] xl:w-[300px] shrink-0 min-w-0">
                      <div className="w-8 h-8 rounded-sm bg-slate-50 border border-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-500 font-mono shrink-0">
                        {idx + 1}
                      </div>
                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4
                            className="font-bold text-slate-800 text-xs tracking-wide truncate max-w-full"
                            title={employee ? employee.name : unlinked!.sourceName}
                          >
                            {employee
                              ? employee.name
                              : unlinked!.sourceName || 'Tanpa nama'}
                          </h4>
                          {category === ALL_BLUE_COLLAR_CATEGORY && employee && (
                            <span className="inline-flex text-[9px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-sm shrink-0">
                              {categoryLabel(employee.category)}
                            </span>
                          )}
                          {unlinked && (
                            <span className="inline-flex items-center gap-1 text-[9px] font-bold text-rose-600 bg-rose-50 border border-rose-200/80 px-2 py-0.5 rounded-sm shrink-0">
                              <AlertTriangle className="w-3 h-3 text-rose-500 shrink-0" />
                              Belum Terhubung
                            </span>
                          )}
                          {employee?.publishBlocked && (
                            <UserRoundX className="h-4 w-4 text-rose-600 shrink-0" />
                          )}
                        </div>
                        <div
                          className="flex items-center gap-1.5 min-w-0"
                          onClick={(event) => event.stopPropagation()}
                        >
                          {employee ? (
                            <div className="flex items-center gap-1 min-w-0 truncate">
                              <span className="text-[9px] text-slate-400 font-mono shrink-0">
                                (ID: {employee.employeeId})
                              </span>
                              <span className="text-[9px] text-emerald-600 font-mono shrink-0">
                                NIPY {employee.nipy || 'belum diisi'}
                              </span>
                            </div>
                          ) : canLinkAttendance ? (
                            <button
                              type="button"
                              onClick={() => {
                                setLinkTarget(unlinked!);
                                setLinkEmployeeId('');
                                setLinkSearch(unlinked!.sourceName || '');
                                setError('');
                              }}
                              className="text-left px-2 py-1 rounded-sm border transition-all text-[9px] font-bold flex items-center gap-1 cursor-pointer bg-rose-50 border-rose-200/80 text-rose-700 hover:bg-rose-100/60"
                            >
                              <span className="truncate max-w-[190px]">
                                Hubungkan Pegawai Manual…
                              </span>
                            </button>
                          ) : (
                            <span className="inline-flex items-center gap-0.5 text-rose-500 bg-rose-50 border border-rose-100 text-[9px] font-bold px-1.5 py-0.5 rounded-sm shrink-0">
                              PIN {unlinked!.sourceNipy || 'kosong'} tidak cocok
                            </span>
                          )}
                        </div>
                        {employee && employee.warnings.length > 0 && (
                          <p className="text-[9px] font-bold text-amber-700 truncate">
                            {employee.warnings
                              .map((warning) => warningLabel[warning] || warning)
                              .join(' · ')}
                          </p>
                        )}
                        {unlinked && (
                          <p className="text-[9px] font-semibold text-slate-500 truncate">
                            {unlinked.department} · PIN{' '}
                            {unlinked.sourceNipy || 'kosong'}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Middle: Metrics */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-2 gap-y-2 flex-1 items-center justify-items-center min-w-0">
                      <div className="flex flex-col text-center w-full">
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">
                          Hari Aktif
                        </span>
                        <span className="text-xs font-bold text-slate-700 mt-0.5 font-mono">
                          {employee ? employee.payableDays : unlinked!.dates.length} hari
                        </span>
                      </div>

                      <div className="flex flex-col text-center w-full">
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">
                          Hari Tidak Lengkap
                        </span>
                        <div className="mt-0.5 font-mono flex justify-center">
                          {employee && employee.incompletePunchCount > 0 ? (
                            <span className="inline-flex items-center gap-1 text-[9px] text-amber-600 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-sm font-bold">
                              <AlertTriangle className="w-3 h-3 shrink-0" />
                              {employee.incompletePunchCount} hari
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400 font-semibold">-</span>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col text-center w-full">
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">
                          Total Jam Kerja
                        </span>
                        <span className="text-xs font-bold text-slate-700 mt-0.5 font-mono">
                          {employee ? durationLabel(employee.workedSeconds) : '-'}
                        </span>
                      </div>

                      <div className="flex flex-col text-center w-full">
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">
                          Harian
                        </span>
                        <span className="text-xs font-bold text-slate-700 mt-0.5 font-mono">
                          {employee ? money(employee.harianAmount) : '-'}
                        </span>
                        {employee && (
                          <span className="text-[9px] text-slate-400 font-semibold">
                            {employee.harianCount} hari
                          </span>
                        )}
                      </div>

                      <div className="flex flex-col text-center w-full">
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">
                          Jumat &amp; Libur
                        </span>
                        <span className="text-xs font-bold text-slate-700 mt-0.5 font-mono">
                          {employee ? money(employee.jumatLiburAmount) : '-'}
                        </span>
                        {employee && (
                          <span className="text-[9px] text-slate-400 font-semibold">
                            {employee.jumatLiburCount} hari
                          </span>
                        )}
                      </div>

                      <div className="flex flex-col text-center w-full">
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">
                          Total Upah Presensi
                        </span>
                        <span className="text-xs font-bold text-indigo-700 mt-0.5 font-mono">
                          {employee ? money(employee.totalAmount) : '-'}
                        </span>
                      </div>
                    </div>

                    {/* Right: Expand Icon */}
                    <div className="flex items-center justify-end shrink-0 pl-1">
                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4 text-slate-400" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-slate-400" />
                      )}
                    </div>
                  </div>

                  {isExpanded && unlinked && (
                    <div className="border-t border-slate-200 bg-white p-4">
                      <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                        Tanggal presensi menunggu penghubungan
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {unlinked.dates.length} hari tercatat atas PIN{' '}
                        {unlinked.sourceNipy || 'kosong'}. Hubungkan ke pegawai agar
                        jam kerjanya ikut dihitung.
                      </p>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {unlinked.dates.map((date) => (
                          <span
                            key={date}
                            className="rounded-sm border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-mono text-slate-600"
                          >
                            {date}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {isExpanded && employee && (
                    <div className="border-t border-slate-200 bg-white p-4">
                      {employee.presenceBonus && (
                        <div className="mb-4 rounded-md border border-indigo-100 bg-indigo-50 p-3 text-sm text-indigo-900">
                          <p className="font-bold">
                            Bonus Presensi: {money(employee.presenceBonus.amount)}
                          </p>
                          <p className="mt-0.5 text-xs">
                            {presenceBonusReason(employee.presenceBonus)}
                          </p>
                        </div>
                      )}
                      <div className="mb-4 flex justify-end">
                        {canEdit && (
                          <Button
                            variant="outline"
                            className="rounded-sm min-h-12"
                            onClick={() => openCorrection(employee)}
                          >
                            Tambah Hari Tanpa Scan
                          </Button>
                        )}
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[700px] text-sm">
                          <thead>
                            <tr className="border-b text-left text-slate-500">
                              <th className="p-3">Tanggal</th>
                              <th className="p-3">Scan Masuk</th>
                              <th className="p-3">Scan Pulang</th>
                              <th className="p-3">Durasi</th>
                              <th className="p-3">Upah</th>
                              <th className="p-3">Status</th>
                              {canEdit && <th className="p-3">Tindakan</th>}
                            </tr>
                          </thead>
                          <tbody>
                            {employee.days.map((day) => (
                              <tr key={day.date} className="border-b border-slate-100">
                                <td className="p-3 font-semibold">{day.date}</td>
                                <td className="p-3">
                                  <ScanCell
                                    value={day.scanIn}
                                    auto={day.scanInAuto}
                                    journey={day.journeyCredit?.scanIn}
                                    editable={canEditScans}
                                    disabled={working}
                                    onCommit={(value) =>
                                      void saveScanCellEdit(employee, day, 'scanIn', value)
                                    }
                                  />
                                </td>
                                <td className="p-3">
                                  <ScanCell
                                    value={day.scanOut}
                                    auto={day.scanOutAuto}
                                    journey={day.journeyCredit?.scanOut}
                                    editable={canEditScans}
                                    disabled={working}
                                    onCommit={(value) =>
                                      void saveScanCellEdit(employee, day, 'scanOut', value)
                                    }
                                  />
                                </td>
                                <td className="p-3">{workedDuration(day)}</td>
                                <td className="p-3">
                                  {day.payType ? (
                                    <>
                                      <span className="font-semibold">
                                        {money(day.amount)}
                                      </span>
                                      <span className="block text-xs text-slate-500">
                                        {day.payType}
                                      </span>
                                    </>
                                  ) : (
                                    'Tidak dibayar'
                                  )}
                                </td>
                                <td className="p-3">
                                  <span
                                    className={`inline-flex items-center gap-1 rounded-sm px-2 py-1 text-xs font-semibold ${
                                      day.present
                                        ? day.completePunch
                                          ? 'bg-emerald-50 text-emerald-700'
                                          : 'bg-amber-50 text-amber-700'
                                        : 'bg-slate-100 text-slate-600'
                                    }`}
                                  >
                                    {day.workStatus === 'IZIN RESMI'
                                      ? 'Izin Resmi'
                                      : day.corrected
                                      ? 'Dikoreksi'
                                      : day.present
                                        ? day.completePunch ? 'Lengkap' : 'Scan satu sisi'
                                        : 'Tidak hadir'}
                                  </span>
                                  {day.journeyCredit && (
                                    <span className="mt-1 block text-xs font-semibold text-indigo-700">
                                      Perjalanan dinas
                                    </span>
                                  )}
                                </td>
                                {canEdit && (
                                  <td className="p-3">
                                    <Button
                                      variant="outline"
                                      className="rounded-sm min-h-12"
                                      onClick={() => openCorrection(employee, day)}
                                    >
                                      Koreksi
                                    </Button>
                                  </td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </section>

          {data.satpamAttendance && (
            <SatpamAttendanceFindings
              employees={data.satpamAttendance.employees}
              attendanceImported={Boolean(data.importRevisionId)}
              reviewHref={(finding) =>
                finding.review
                  ? satpamShiftMismatchReviewHref(
                      period,
                      finding.review.occurrenceId,
                      finding.review.employeeId,
                    )
                  : null
              }
            />
          )}
        </>
      )}

      <Dialog
        open={Boolean(linkTarget)}
        onOpenChange={(open) => {
          // Closing mid-save would hide whether the link was made.
          if (!open && linkPhase !== 'saving') resetLinkDialog();
        }}
      >
        <DialogContent className="rounded-md max-h-[90vh] max-w-lg overflow-y-auto">
          {linkPhase === 'saving' && (
            <>
              <DialogHeader>
                <DialogTitle>Menghubungkan Baris Presensi</DialogTitle>
                <DialogDescription>
                  Mohon tunggu, jangan tutup halaman ini.
                </DialogDescription>
              </DialogHeader>
              <div
                role="status"
                className="flex flex-col items-center gap-3 py-8 text-slate-600"
              >
                <Loader2 className="h-10 w-10 animate-spin text-indigo-600" />
                <p className="font-semibold">Menyimpan penghubungan…</p>
              </div>
            </>
          )}
          {linkPhase === 'success' && (
            <>
              <DialogHeader>
                <DialogTitle>Berhasil Dihubungkan</DialogTitle>
                <DialogDescription>
                  Penghubungan tercatat dalam audit.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <CheckCircle2 className="h-12 w-12 text-emerald-600" />
                <p className="text-sm text-slate-700">{linkResult?.detail}</p>
              </div>
              <DialogFooter className="rounded-b-md">
                <Button className="rounded-sm min-h-12" onClick={resetLinkDialog}>
                  Selesai
                </Button>
              </DialogFooter>
            </>
          )}
          {linkPhase === 'error' && (
            <>
              <DialogHeader>
                <DialogTitle>Gagal Menghubungkan</DialogTitle>
                <DialogDescription>
                  Tidak ada yang berubah. Anda dapat mencoba lagi.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <AlertTriangle className="h-12 w-12 text-rose-600" />
                <p className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                  {linkResult?.detail}
                </p>
              </div>
              <DialogFooter className="rounded-b-md">
                <Button
                  variant="outline"
                  className="rounded-sm min-h-12"
                  onClick={resetLinkDialog}
                >
                  Tutup
                </Button>
                <Button
                  className="rounded-sm min-h-12"
                  onClick={() => setLinkPhase('form')}
                >
                  Coba Lagi
                </Button>
              </DialogFooter>
            </>
          )}
          {linkPhase === 'form' && (
            <>
              <DialogHeader>
                <DialogTitle>Hubungkan Baris Presensi</DialogTitle>
                <DialogDescription>
                  Penghubungan berlaku untuk periode ini saja dan tercatat dalam
                  audit. Seluruh hari presensi baris ini akan dihitung untuk
                  pegawai yang dipilih.
                </DialogDescription>
              </DialogHeader>
              {linkTarget && (
                <div className="space-y-4">
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                    <p className="font-bold text-slate-900">
                      {linkTarget.sourceName || 'Tanpa nama'}
                    </p>
                    <p className="text-sm text-slate-500">
                      {linkTarget.department || 'Tanpa departemen'} · PIN{' '}
                      {linkTarget.sourceNipy || 'kosong'} · {linkTarget.dates.length} hari
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="manual-link-search">Cari pegawai</Label>
                    <Input className="rounded-sm"
                      id="manual-link-search"
                      value={linkSearch}
                      onChange={(event) => setLinkSearch(event.target.value)}
                      placeholder="Nama atau NIPY pegawai"
                    />
                  </div>
                  <div className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200">
                    {linkCandidates.length === 0 ? (
                      <p className="p-4 text-center text-sm text-slate-500">
                        Pegawai tidak ditemukan.
                      </p>
                    ) : (
                      linkCandidates.map((candidate) => {
                        // A candidate without a NIPY can still be linked — the row
                        // joins on a stable per-employee token instead — but that
                        // employee's pay stays unpublishable until a real NIPY
                        // exists, the same rule already applied elsewhere on this
                        // page. Surfaced here so the choice is informed, not blocked.
                        const missingNipy = !candidate.nipy;
                        return (
                          <button
                            key={candidate.employeeId}
                            type="button"
                            onClick={() => setLinkEmployeeId(candidate.employeeId)}
                            className={`flex min-h-14 w-full flex-col items-start justify-center px-4 py-2 text-left ${
                              linkEmployeeId === candidate.employeeId
                                ? 'bg-indigo-50'
                                : 'hover:bg-slate-50'
                            }`}
                          >
                            <span className="font-semibold text-slate-900">
                              {candidate.name}
                            </span>
                            <span
                              className={`text-sm ${missingNipy ? 'font-semibold text-amber-600' : 'text-slate-500'}`}
                            >
                              {categoryLabel(candidate.category)} · NIPY{' '}
                              {candidate.nipy || 'belum diisi'}
                              {missingNipy &&
                                ' — publikasi upah tertunda hingga NIPY dilengkapi'}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
              <DialogFooter className="rounded-b-md">
                <Button
                  variant="outline"
                  className="rounded-sm min-h-12"
                  onClick={resetLinkDialog}
                >
                  Batal
                </Button>
                <Button
                  className="rounded-sm min-h-12 gap-2"
                  disabled={working || !linkEmployeeId}
                  onClick={() => void saveManualLink()}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Hubungkan
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(correction)} onOpenChange={(open) => !open && setCorrection(null)}>
        <DialogContent className="rounded-md max-w-lg">
          <DialogHeader>
            <DialogTitle>Koreksi Presensi</DialogTitle>
            <DialogDescription>
              Baris import asli tetap disimpan. Perubahan ini menjadi lapisan
              koreksi baru dengan riwayat audit.
            </DialogDescription>
          </DialogHeader>
          {correction && (
            <div className="space-y-4">
              <div>
                <p className="font-bold">{correction.employee.name}</p>
                <p className="text-sm text-slate-500">NIPY {correction.employee.nipy}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="correction-date">Tanggal</Label>
                <Input className="rounded-sm"
                  id="correction-date"
                  type="date"
                  min={`${period}-01`}
                  max={`${period}-${String(
                    new Date(year, month, 0).getDate(),
                  ).padStart(2, '0')}`}
                  value={correction.date}
                  onChange={(event) => {
                    const day = correction.employee.days.find(
                      (candidate) => candidate.date === event.target.value,
                    );
                    setCorrection({
                      ...correction,
                      date: event.target.value,
                      present: day?.present ?? true,
                      scanIn: day?.scanIn || '',
                      scanOut: day?.scanOut || '',
                      expectedRevision: day?.correctionRevision || 0,
                    });
                  }}
                />
              </div>
              <label className="flex min-h-12 items-center gap-3 rounded-md border p-3">
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  checked={correction.present}
                  onChange={(event) => {
                    const present = event.target.checked;
                    setCorrection({
                      ...correction,
                      present,
                      ...(present ? {} : { scanIn: '', scanOut: '' }),
                    });
                  }}
                />
                <span className="font-semibold">Anggap hadir penuh pada tanggal ini</span>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="scan-in">Scan masuk (opsional)</Label>
                  <Input className="rounded-sm"
                    id="scan-in"
                    type="time"
                    step="1"
                    disabled={!correction.present}
                    value={correction.scanIn}
                    onChange={(event) =>
                      setCorrection({ ...correction, scanIn: event.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="scan-out">Scan pulang (opsional)</Label>
                  <Input className="rounded-sm"
                    id="scan-out"
                    type="time"
                    step="1"
                    disabled={!correction.present}
                    value={correction.scanOut}
                    onChange={(event) =>
                      setCorrection({ ...correction, scanOut: event.target.value })
                    }
                  />
                </div>
              </div>
              {correctionTimeRangeInvalid && (
                <p className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                  Scan pulang harus lebih lambat dari scan masuk.
                </p>
              )}
              <div className="space-y-2">
                <Label htmlFor="correction-reason">Alasan wajib</Label>
                <textarea
                  id="correction-reason"
                  className="min-h-24 w-full rounded-sm border border-slate-300 p-3"
                  value={correction.reason}
                  onChange={(event) =>
                    setCorrection({ ...correction, reason: event.target.value })
                  }
                  placeholder="Contoh: Surat tugas kegiatan universitas telah diperiksa."
                />
              </div>
            </div>
          )}
          <DialogFooter className="rounded-b-md">
            <Button
              variant="outline"
              className="rounded-sm min-h-12"
              onClick={() => setCorrection(null)}
            >
              Batal
            </Button>
            <Button
              className="rounded-sm min-h-12 gap-2"
              onClick={() => void saveCorrection()}
              disabled={
                working ||
                !correction ||
                correction.reason.trim().length < 8 ||
                correctionTimeRangeInvalid
              }
            >
              <CheckCircle2 className="h-4 w-4" />
              Simpan Koreksi
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(declineTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setDeclineTarget(null);
            setDeclineReason('');
          }
        }}
      >
        <DialogContent className="rounded-md max-w-md">
          <DialogHeader>
            <DialogTitle>{declineTarget?.title || 'Tolak Pengajuan'}</DialogTitle>
            <DialogDescription>
              Masukkan alasan penolakan. Alasan ini akan tercatat dan dapat dilihat oleh pemohon.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="decline-reason">Alasan Penolakan</Label>
              <textarea
                id="decline-reason"
                rows={3}
                maxLength={500}
                className="w-full rounded-sm border border-slate-300 p-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                placeholder="Contoh: Hari kerja pengganti tidak memenuhi ketentuan."
                value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter className="rounded-b-md">
            <Button
              type="button"
              variant="outline"
              className="rounded-sm min-h-12"
              onClick={() => {
                setDeclineTarget(null);
                setDeclineReason('');
              }}
            >
              Batal
            </Button>
            <Button
              type="button"
              className="rounded-sm min-h-12 bg-rose-600 text-white hover:bg-rose-700"
              disabled={working || !declineReason.trim()}
              onClick={() => void handleConfirmDecline()}
            >
              Konfirmasi Tolak
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {selectedEvidence && (
        <EvidenceLightbox
          imageUrl={selectedEvidence.url}
          title={selectedEvidence.title}
          isOpen={Boolean(selectedEvidence)}
          onClose={() => setSelectedEvidence(null)}
        />
      )}
    </div>
  );
}
