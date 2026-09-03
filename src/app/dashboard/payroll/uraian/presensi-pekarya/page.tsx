"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Eye,
  RefreshCw,
  Save,
  ShieldCheck,
  UserRoundX,
} from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { authenticatedJson, createFinancialRequestId } from '@/lib/payroll/client';
import { ImageExifViewer } from '@/components/ImageExifViewer';
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
  isValidAttendanceScanRange,
  pekaryaAttendanceReportType,
  type PekaryaOfficialLeaveRequest,
} from '@/lib/payroll/pekaryaOfficialLeave';
import {
  satpamAttendanceReportType,
  type SatpamAttendanceReportType,
} from '@/lib/payroll/satpamAttendance';
import { ALL_BLUE_COLLAR_CATEGORY } from '@/lib/payroll/pekaryaSpj';
import { attendanceWorkedSeconds } from '@/lib/payroll/attendance';

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
};

type DepartmentUnmatchedRow = {
  sourceKey: string;
  sourceNipy: string;
  sourceName: string;
  department: string;
  dates: string[];
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
  exceptions: {
    unmatchedNipys: string[];
    departmentUnmatched: DepartmentUnmatchedRow[];
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
};

type SatpamView = {
  period: string;
  category: 'SATPAM';
  importRevision: number;
  importRevisionId: string;
  calendarRevision: number;
  paymentSource: string;
  departmentUnmatched: DepartmentUnmatchedRow[];
  linkCandidates: LinkCandidate[];
  mismatches: Array<{
    code: string;
    employeeId: string | null;
    employeeName: string;
    nipy: string;
    dutyDate: string;
    reportId: string | null;
    message: string;
  }>;
};

type SatpamDutyPlanAdminView = {
  enabled: boolean;
  plans: Array<{
    id: string;
    teamId: string;
    status: string;
    revision?: number;
    lateBackfillDates?: string[];
    rosterSnapshot?: Array<{
      employeeId: string;
      name: string;
    }>;
    generatedDays?: Array<{
      dutyDate: string;
      shiftName: string;
      offDutyEmployeeId: string;
      assignments: Array<{ postId: string; employeeId: string }>;
    }>;
  }>;
};

type SatpamAbsenceAdminView = {
  requests: Array<{
    id: string;
    employeeId: string;
    employeeName?: string;
    dutyDate: string;
    shiftName?: string;
    postId?: string;
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
    }>;
  }>;
};

type SatpamReconciliationView = {
  periodComplete: boolean;
  pendingAbsenceCount: number;
  conflictCount: number;
  blockers: string[];
  unassignedExternalEmployees: Array<{
    employeeId: string;
    employeeName: string;
    extraDuties: number;
    eligibleForBonus: false;
    bonusAmount: 0;
  }>;
  plans: Array<{
    planId: string;
    teamId: string;
    status: string;
    revision: number;
    lateBackfillDates: string[];
    missingOccurrenceDates: string[];
    pendingOccurrenceDates: string[];
    employees: Array<{
      employeeId: string;
      employeeName: string;
      requiredDuties: number;
      fulfilledDuties: number;
      fulfilledByWork: number;
      fulfilledByAbsence: number;
      missedDuties: number;
      pendingDuties: number;
      conflictingDuties: number;
      extraDuties: number;
      eligibleForBonus: boolean;
      bonusAmount: number;
    }>;
  }>;
};

type SatpamOperations = {
  dutyPlans: SatpamDutyPlanAdminView;
  absences: SatpamAbsenceAdminView;
  reconciliation: SatpamReconciliationView;
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

type PlanCorrectionState = {
  plan: SatpamDutyPlanAdminView['plans'][number];
  day: NonNullable<
    SatpamDutyPlanAdminView['plans'][number]['generatedDays']
  >[number];
  reason: string;
};

function isSatpamView(
  value: AttendanceView | SatpamView,
): value is SatpamView {
  return 'mismatches' in value;
}

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
 * needing a parallel piece of edit-buffer state.
 */
function ScanCell({
  value,
  auto,
  editable,
  disabled,
  onCommit,
}: {
  value: string | null;
  auto: boolean;
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
          disabled={disabled}
          onBlur={(event) => onCommit?.(event.target.value)}
          className={`h-8 w-28 rounded-lg border px-2 text-xs font-mono disabled:opacity-60 ${
            auto
              ? 'border-amber-300 bg-amber-50/10 font-bold text-amber-700 ring-2 ring-amber-100/50'
              : 'border-slate-200 bg-white text-slate-700'
          }`}
        />
        {auto && (
          <span
            className="inline-flex shrink-0 select-none items-center rounded bg-amber-50 px-1.5 py-0.5 text-[9px] font-extrabold uppercase text-amber-700 border border-amber-200 cursor-help"
            title="Diisi otomatis (150 menit dari scan yang tercatat) karena satu sisi lupa discan."
          >
            Auto
          </span>
        )}
      </span>
    );
  }
  if (!value) return <span>—</span>;
  if (!auto) return <span>{value}</span>;
  return (
    <span className="inline-flex items-center gap-1">
      <span className="font-mono text-amber-700 font-semibold">{value}</span>
      <span
        className="inline-flex px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase bg-amber-50 text-amber-700 border border-amber-200 select-none shrink-0 cursor-help"
        title="Diisi otomatis (150 menit dari scan yang tercatat) karena satu sisi lupa discan."
      >
        Auto
      </span>
    </span>
  );
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

function satpamPlanStatusLabel(status: string): string {
  return (
    {
      missing: 'Belum dibuat',
      draft: 'Draf',
      published: 'Diterbitkan',
      pending_backfill_review: 'Menunggu pemeriksaan backfill',
      stale: 'Perlu diperbarui',
    }[status] || 'Status tidak diketahui'
  );
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

export default function PekaryaAttendancePage() {
  const searchParams = useSearchParams();
  const { profile } = useAuth();
  const month = Number(searchParams.get('month') || new Date().getMonth() + 1);
  const year = Number(searchParams.get('year') || new Date().getFullYear());
  const permittedAttendanceCategory = profile?.permittedCategories?.find(
    (item) => item.trim().toUpperCase() !== 'SATPAM',
  );
  const category = (
    searchParams.get('category') ||
    (year === 2026 &&
    month === 7 &&
    (['super_admin', 'finance_verifier'].includes(
      profile?.role || '',
    ) ||
      profile?.permittedCategories?.includes('SATPAM'))
      ? 'SATPAM'
      : '') ||
    (profile?.role === 'satker_head'
      ? permittedAttendanceCategory
        ? ALL_BLUE_COLLAR_CATEGORY
        : profile.permittedCategories?.[0]
      : ['super_admin', 'finance_verifier'].includes(profile?.role || '')
        ? ALL_BLUE_COLLAR_CATEGORY
        : '') ||
    ''
  ).toUpperCase();
  const period = `${year}-${String(month).padStart(2, '0')}`;
  const [data, setData] = useState<AttendanceView | SatpamView | null>(null);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [selectedEvidence, setSelectedEvidence] = useState<{
    url: string;
    title: string;
    activityDate: string;
    auditMetadata?: PekaryaOfficialLeaveRequest['evidenceAuditMetadata'];
  } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [correction, setCorrection] = useState<CorrectionState | null>(null);
  const correctionTimeRangeInvalid = Boolean(
    correction?.present &&
      correction.scanIn &&
      correction.scanOut &&
      !isValidAttendanceScanRange(correction.scanIn, correction.scanOut),
  );
  const [planCorrection, setPlanCorrection] =
    useState<PlanCorrectionState | null>(null);
  const [satpamOperations, setSatpamOperations] =
    useState<SatpamOperations | null>(null);
  const [satpamTab, setSatpamTab] = useState<
    'plans' | 'absences' | 'reconciliation' | 'mismatches'
  >('plans');
  const [satpamAttendanceNotice, setSatpamAttendanceNotice] = useState('');
  const [linkTarget, setLinkTarget] = useState<DepartmentUnmatchedRow | null>(null);
  const [linkEmployeeId, setLinkEmployeeId] = useState('');
  const [linkSearch, setLinkSearch] = useState('');
  const canEdit = profile?.role === 'satker_head';
  // The manual-link endpoint accepts super_admin as well as satker_head (it
  // follows this app's usual write-permission pattern), so the button that
  // triggers it must be visible to both, not just to canEdit's satker_head.
  const canLinkAttendance =
    profile?.role === 'satker_head' || profile?.role === 'super_admin';
  // Same authority as manual linking — the corrections endpoint accepts both.
  const canEditScans = canLinkAttendance;

  const load = useCallback(async () => {
    if (
      !category ||
      (period < '2026-08' && category !== 'SATPAM')
    ) {
      setData(null);
      return;
    }
    setLoading(true);
    setError('');
    try {
      if (category === 'SATPAM') {
        setSatpamAttendanceNotice('');
        const attendancePromise = authenticatedJson<SatpamView>(
          `/api/attendance/pekarya?period=${encodeURIComponent(period)}&category=SATPAM`,
        ).catch((cause): SatpamView => {
          setSatpamAttendanceNotice(
            cause instanceof Error
              ? cause.message
              : 'Import presensi belum tersedia.',
          );
          return {
            period,
            category: 'SATPAM',
            importRevision: 0,
            importRevisionId: '',
            calendarRevision: 0,
            paymentSource: 'Ketua Shift',
            departmentUnmatched: [],
            linkCandidates: [],
            mismatches: [],
          };
        });
        const [attendance, dutyPlans, absences, reconciliation] =
          await Promise.all([
            attendancePromise,
            authenticatedJson<SatpamDutyPlanAdminView>(
              `/api/satpam/duty-plans?period=${encodeURIComponent(period)}`,
            ),
            authenticatedJson<SatpamAbsenceAdminView>(
              `/api/satpam/absences?period=${encodeURIComponent(period)}`,
            ),
            authenticatedJson<SatpamReconciliationView>(
              `/api/satpam/duty-reconciliation?period=${encodeURIComponent(period)}&refresh=${canEdit ? 'true' : 'false'}`,
            ),
          ]);
        setData(attendance);
        setSatpamOperations({ dutyPlans, absences, reconciliation });
      } else {
        setSatpamAttendanceNotice('');
        const result = await authenticatedJson<AttendanceView>(
          `/api/attendance/pekarya?period=${encodeURIComponent(period)}&category=${encodeURIComponent(category)}`,
        );
        setData(result);
        setSatpamOperations(null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Gagal memuat presensi Pekarya.');
    } finally {
      setLoading(false);
    }
  }, [canEdit, category, period]);

  const reviewAbsence = async (
    absence: SatpamAbsenceAdminView['requests'][number],
    action: 'approve' | 'decline' | 'supersede_approve' | 'supersede_decline',
  ) => {
    const reportType = satpamAttendanceReportType(absence);
    setWorking(true);
    setError('');
    try {
      const reviewResult = await authenticatedJson<{
        payrollExcludedFromHarian?: boolean;
      }>('/api/satpam/absences/review', {
        method: 'POST',
        body: JSON.stringify({
          requestId: createFinancialRequestId('satpam-absence-review'),
          absenceRequestId: absence.id,
          action,
          expectedRevision: absence.revision,
        }),
      });
      setMessage(
        reportType === 'scan'
          ? action === 'approve'
            ? 'Laporan scan disetujui dan presensi Satpam telah diperbarui.'
            : 'Laporan scan ditolak.'
          : action.endsWith('approve')
            ? reviewResult.payrollExcludedFromHarian === true
              ? 'Izin disetujui tanpa tambahan Harian karena pegawai telah terdaftar shift pada tanggal tersebut.'
              : 'Izin disetujui. Hak Rp12.500 dan rekonsiliasi telah diperbarui.'
            : 'Izin ditolak dan rekonsiliasi telah diperbarui.',
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Gagal memutuskan izin.');
    } finally {
      setWorking(false);
    }
  };

  const saveManualLink = async () => {
    if (!linkTarget || !linkEmployeeId) return;
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
      setLinkTarget(null);
      setLinkEmployeeId('');
      setLinkSearch('');
      setMessage(
        `Baris presensi dihubungkan. ${linkTarget.dates.length} hari kini dihitung untuk pegawai tersebut.`,
      );
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Gagal menghubungkan baris presensi.',
      );
    } finally {
      setWorking(false);
    }
  };

  const reviewOfficialLeave = async (
    leave: PekaryaOfficialLeaveRequest,
    action: 'approve' | 'decline',
  ) => {
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
      await load();
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

  const savePlanCorrection = async () => {
    if (!planCorrection) return;
    const reason = planCorrection.reason.trim();
    if (reason.length < 8) {
      setError('Alasan koreksi rencana minimal delapan karakter.');
      return;
    }
    setWorking(true);
    setError('');
    try {
      await authenticatedJson('/api/satpam/duty-plans', {
        method: 'PATCH',
        body: JSON.stringify({
          requestId: createFinancialRequestId('satpam-plan-correction'),
          action: 'edit_day',
          period,
          teamId: planCorrection.plan.teamId,
          expectedRevision: planCorrection.plan.revision,
          reason,
          day: planCorrection.day,
        }),
      });
      setPlanCorrection(null);
      setMessage(
        'Koreksi rencana tersimpan. Laporan yang terdampak dibuka kembali untuk pemeriksaan finansial.',
      );
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Koreksi rencana dinas gagal disimpan.',
      );
    } finally {
      setWorking(false);
    }
  };

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  const totals = useMemo(() => {
    if (!data || isSatpamView(data)) return null;
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
    return isSatpamView(data)
      ? data.departmentUnmatched || []
      : data.exceptions.departmentUnmatched || [];
  }, [data]);

  // One list holding both sides of the reconciliation: the employees the import
  // resolved, and the rows it could not, so a reviewer sees the whole period in
  // a single place instead of two disconnected lists.
  const attendanceRows = useMemo(() => {
    if (!data || isSatpamView(data)) return [];
    const linked = data.employees.map((employee) => ({
      key: `employee:${employee.employeeId}`,
      employee,
      unlinked: null as DepartmentUnmatchedRow | null,
    }));
    const unlinked = departmentUnmatched.map((row) => ({
      key: `unlinked:${row.sourceKey}`,
      employee: null as EmployeeAttendance | null,
      unlinked: row,
    }));
    return [...linked, ...unlinked];
  }, [data, departmentUnmatched]);

  const linkCandidates = useMemo(() => {
    const candidates = data?.linkCandidates || [];
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
      await load();
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
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Gagal memperbarui waktu scan.',
      );
    } finally {
      setWorking(false);
    }
  };

  const publish = async () => {
    if (!data || isSatpamView(data)) return;
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
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Gagal mempublikasikan presensi.');
    } finally {
      setWorking(false);
    }
  };

  if (period < '2026-08' && category !== 'SATPAM') {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
        Presensi Pekarya otomatis mulai berlaku pada periode Agustus 2026.
        Periode sebelumnya tetap memakai perhitungan historis.
      </div>
    );
  }

  return (
    <div className="space-y-5 text-[16px]">
      {(error || message) && (
        <div
          role="status"
          className={`rounded-xl border p-4 ${
            error
              ? 'border-rose-200 bg-rose-50 text-rose-800'
              : 'border-emerald-200 bg-emerald-50 text-emerald-800'
          }`}
        >
          {error || message}
        </div>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
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
          <Button
            variant="outline"
            className="min-h-12 gap-2"
            onClick={() => void load()}
            disabled={loading || !category}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Muat Ulang
          </Button>
        </div>
      </section>

      {data && !data.importRevisionId && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-900">
          <p className="font-bold">Import presensi aktif belum tersedia</p>
          <p className="mt-1 text-sm">
            Muat ulang halaman ini setelah import presensi terpadu diaktifkan.
            Data pegawai tetap ditampilkan, tetapi belum dapat dipublikasikan ke Rekap Uraian.
          </p>
        </div>
      )}

      {data &&
        !isSatpamView(data) &&
        category === ALL_BLUE_COLLAR_CATEGORY && (
          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5 text-blue-900">
            <p className="font-bold">Semua pegawai blue collar</p>
            <p className="mt-1 text-sm">
              Daftar ini menggabungkan seluruh kategori yang memakai upah
              presensi. Satpam tetap diperiksa melalui kategori Satpam karena
              pembayarannya bersumber dari laporan Ketua Shift.
            </p>
          </div>
        )}

      {loading && (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500">
          Memuat hasil presensi…
        </div>
      )}

      {/* On the payable categories these rows sit inside the employee table
          itself, next to the people they belong with. Satpam has no such table
          — it is a verification view — so they are listed on their own there. */}
      {!loading && data && isSatpamView(data) && departmentUnmatched.length > 0 && (
        <section className="overflow-hidden rounded-2xl border border-amber-200 bg-white shadow-sm">
          <div className="border-b border-amber-100 bg-amber-50 p-5 text-amber-900">
            <p className="flex items-center gap-2 font-bold">
              <UserRoundX className="h-5 w-5" />
              {departmentUnmatched.length} baris presensi belum dikenali
            </p>
            <p className="mt-1 text-sm">
              Baris ini berasal dari departemen blue collar, tetapi kolom
              NIPY-nya berisi PIN mesin presensi sehingga tidak cocok dengan
              pegawai mana pun. Hubungkan setiap baris ke pegawai yang benar
              agar hari kerjanya ikut dihitung.
            </p>
          </div>
          <div className="divide-y divide-slate-100">
            {departmentUnmatched.map((row) => (
              <div
                key={row.sourceKey}
                className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-bold text-slate-900">
                    {row.sourceName || 'Tanpa nama'}
                  </p>
                  <p className="text-sm text-slate-500">
                    {row.department} · PIN {row.sourceNipy || 'kosong'} ·{' '}
                    {row.dates.length} hari presensi
                  </p>
                </div>
                {canLinkAttendance && (
                  <Button
                    variant="outline"
                    className="min-h-12 shrink-0"
                    onClick={() => {
                      setLinkTarget(row);
                      setLinkEmployeeId('');
                      setLinkSearch(row.sourceName || '');
                      setError('');
                    }}
                  >
                    Hubungkan Pegawai
                  </Button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {!loading && data && isSatpamView(data) && (
        <>
          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5 text-blue-900">
            <div className="flex gap-3">
              <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0" />
              <div>
                <p className="font-bold">Presensi Satpam hanya untuk verifikasi</p>
                <p className="mt-1 text-sm">
                  Upah tetap mengikuti laporan Ketua Shift. Peringatan di bawah
                  tidak menambah atau mengurangi pembayaran shift.
                </p>
              </div>
            </div>
            {satpamAttendanceNotice && (
              <p className="mt-3 rounded-xl border border-blue-200 bg-white/70 p-3 text-sm">
                Presensi belum dapat dibandingkan: {satpamAttendanceNotice}
                {' '}
                Rencana dinas, izin, dan rekonsiliasi tetap dapat diperiksa.
              </p>
            )}
          </div>

          {satpamOperations && (
            <div
              className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm lg:grid-cols-4"
              role="tablist"
              aria-label="Pemeriksaan Satpam"
            >
              {[
                ['plans', 'Rencana Dinas'],
                [
                  'absences',
                  `Pengajuan (${satpamOperations.absences.requests.filter((request) => request.status === 'pending').length})`,
                ],
                ['reconciliation', 'Bonus & Kewajiban'],
                ['mismatches', `Presensi (${data.mismatches.length})`],
              ].map(([tab, label]) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={satpamTab === tab}
                  className={`min-h-12 rounded-xl px-3 py-2 text-sm font-bold ${
                    satpamTab === tab
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
                  }`}
                  onClick={() =>
                    setSatpamTab(
                      tab as
                        | 'plans'
                        | 'absences'
                        | 'reconciliation'
                        | 'mismatches',
                    )
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {satpamOperations && satpamTab === 'plans' && (
            <section className="space-y-3">
              {!satpamOperations.dutyPlans.enabled && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-slate-700">
                  Periode ini masih memakai alur Satpam lama. Rencana dinas
                  kanonis berlaku untuk periode pertama yang dibuka setelah
                  fitur diterapkan.
                </div>
              )}
              {satpamOperations.dutyPlans.plans.map((plan) => {
                const backfillDates = plan.lateBackfillDates || [];
                return (
                  <article
                    key={plan.id}
                    className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                  >
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <h2 className="font-bold text-slate-900">
                          {plan.teamId} · {plan.status === 'missing'
                            ? 'Belum dibuat'
                            : `Revisi ${plan.revision || 1}`}
                        </h2>
                        <p className="mt-1 text-sm text-slate-500">
                          Status: {satpamPlanStatusLabel(plan.status)} ·{' '}
                          {plan.generatedDays?.length || 0} tanggal dihasilkan
                        </p>
                        {backfillDates.length > 0 && (
                          <p className="mt-2 text-sm font-semibold text-amber-700">
                            Backfill (diterbitkan setelah shift dimulai): {backfillDates.join(', ')}
                          </p>
                        )}
                      </div>
                    </div>
                    {(plan.generatedDays?.length || 0) > 0 && (
                      <details className="mt-4 rounded-xl border border-slate-200 bg-slate-50">
                        <summary className="min-h-12 cursor-pointer p-3 font-semibold text-slate-700">
                          Lihat dan koreksi tanggal rencana
                        </summary>
                        <div className="max-h-96 divide-y divide-slate-200 overflow-y-auto border-t border-slate-200">
                          {plan.generatedDays!.map((day) => (
                            <div
                              key={day.dutyDate}
                              className="flex flex-col gap-3 bg-white p-3 sm:flex-row sm:items-center sm:justify-between"
                            >
                              <div>
                                <p className="font-semibold text-slate-900">
                                  {day.dutyDate} · {day.shiftName}
                                </p>
                                <p className="text-sm text-slate-500">
                                  Off-duty:{' '}
                                  {plan.rosterSnapshot?.find(
                                    (employee) =>
                                      employee.employeeId ===
                                      day.offDutyEmployeeId,
                                  )?.name || day.offDutyEmployeeId}
                                </p>
                              </div>
                              {canEdit && (
                                <Button
                                  variant="outline"
                                  className="min-h-12"
                                  onClick={() =>
                                    setPlanCorrection({
                                      plan,
                                      day: JSON.parse(JSON.stringify(day)),
                                      reason: '',
                                    })
                                  }
                                >
                                  Koreksi Kepala
                                </Button>
                              )}
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </article>
                );
              })}
            </section>
          )}

          {satpamOperations && satpamTab === 'absences' && (
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 p-5">
                <h2 className="font-bold">Pengajuan Presensi &amp; Izin Satpam</h2>
                <p className="text-sm text-slate-500">
                  Laporan scan memperbaiki bukti presensi tanpa mengubah upah
                  shift. Izin disetujui menambah Harian Rp12.500 hanya jika
                  tidak ada shift terdaftar pada tanggal yang sama.
                </p>
              </div>
              <div className="divide-y divide-slate-100">
                {satpamOperations.absences.requests.length === 0 ? (
                  <div className="p-8 text-center text-slate-500">
                    Belum ada pengajuan presensi atau izin.
                  </div>
                ) : (
                  satpamOperations.absences.requests.map((absence) => {
                    const requestType = satpamAttendanceReportType(absence);
                    const approveAction =
                      absence.status === 'pending'
                        ? 'approve'
                        : 'supersede_approve';
                    const declineAction =
                      absence.status === 'pending'
                        ? 'decline'
                        : 'supersede_decline';
                    const payrollExcludedFromHarian =
                      absence.payrollExcludedFromHarian === true;
                    return (
                      <article key={absence.id} className="space-y-3 p-5">
                        <div>
                          <p className="font-bold text-slate-900">
                            {absence.employeeName || absence.employeeId} ·{' '}
                            {absence.dutyDate}
                          </p>
                          <p className="text-sm font-semibold text-indigo-700">
                            {requestType === 'scan'
                              ? `Scan Masuk & Scan Keluar · ${absence.scanIn?.slice(0, 5) || '--:--'}–${absence.scanOut?.slice(0, 5) || '--:--'}`
                              : satpamAbsenceTypeLabel(absence.absenceType)}
                            {absence.shiftName ? ` · ${absence.shiftName}` : ''}
                            {absence.postId ? ` · ${absence.postId}` : ''}
                          </p>
                          {requestType === 'izin_resmi' &&
                            (absence.hasShiftRegistrationConflict === true ||
                              (absence.shiftRegistrationConflicts?.length || 0) > 0) && (
                            <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
                              <p className="font-bold">⚠ Shift sudah terdaftar pada tanggal ini</p>
                              <p className="mt-1 text-xs">
                                {absence.status === 'approved' && payrollExcludedFromHarian
                                  ? 'Izin telah disetujui tanpa tambahan Harian karena shift ini sudah terdaftar.'
                                  : 'Jika izin disetujui, pengajuan tidak akan menambah hitungan Harian.'}
                              </p>
                              {absence.shiftRegistrationConflicts?.map((registration) => (
                                <p key={registration.id} className="mt-1 text-xs">
                                  {registration.shiftName || 'Shift'}{registration.postId ? ` · ${registration.postId}` : ''}
                                  {registration.shiftType ? ` · ${registration.shiftType}` : ''}
                                  {registration.ketuaShiftName ? ` · Ketua: ${registration.ketuaShiftName}` : ''}
                                </p>
                              ))}
                            </div>
                          )}
                          <p className="text-sm text-slate-600">
                            {absence.reason}
                          </p>
                          <p className="mt-1 text-xs font-semibold uppercase text-slate-400">
                            {decisionStatusLabel(absence.status)}
                            {absence.late ? ' · diajukan terlambat' : ''}
                            {requestType === 'izin_resmi' &&
                            absence.status === 'approved'
                              ? payrollExcludedFromHarian
                                ? ' · tanpa tambahan Harian'
                                : ` · ${money(absence.approvedAmount || 12_500)}`
                              : ''}
                          </p>
                        </div>
                        {canEdit &&
                          (requestType === 'izin_resmi' ||
                            absence.status === 'pending') && (
                          <div className="flex flex-wrap justify-end gap-2">
                            {absence.status !== 'approved' &&
                              (requestType === 'izin_resmi' ||
                                absence.status === 'pending') && (
                              <Button
                                className="min-h-12 bg-emerald-600 hover:bg-emerald-700"
                                disabled={working}
                                onClick={() =>
                                  void reviewAbsence(absence, approveAction)
                                }
                              >
                                Setujui
                              </Button>
                            )}
                            {absence.status !== 'declined' &&
                              (requestType === 'izin_resmi' ||
                                absence.status === 'pending') && (
                              <Button
                                variant="outline"
                                className="min-h-12 border-rose-200 text-rose-700"
                                disabled={working}
                                onClick={() =>
                                  void reviewAbsence(absence, declineAction)
                                }
                              >
                                Tolak
                              </Button>
                            )}
                          </div>
                        )}
                      </article>
                    );
                  })
                )}
              </div>
            </section>
          )}

          {satpamOperations && satpamTab === 'reconciliation' && (
            <section className="space-y-4">
              <div
                className={`rounded-2xl border p-5 ${
                  satpamOperations.reconciliation.blockers.length > 0
                    ? 'border-amber-200 bg-amber-50 text-amber-900'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-900'
                }`}
              >
                <p className="font-bold">
                  {satpamOperations.reconciliation.blockers.length > 0
                    ? 'Rekonsiliasi belum siap ditutup'
                    : 'Rekonsiliasi tidak memiliki konflik'}
                </p>
                {satpamOperations.reconciliation.blockers.map((blocker) => (
                  <p key={blocker} className="mt-1 text-sm">
                    • {blocker}
                  </p>
                ))}
              </div>
              {satpamOperations.reconciliation.plans.map((plan) => (
                <article
                  key={plan.planId}
                  className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
                >
                  <div className="border-b border-slate-200 p-5">
                    <h2 className="font-bold">{plan.teamId}</h2>
                    <p className="text-sm text-slate-500">
                      {plan.missingOccurrenceDates.length} laporan belum ada ·{' '}
                      {plan.pendingOccurrenceDates.length} laporan masih diperiksa
                    </p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[860px] text-sm">
                      <thead>
                        <tr className="border-b text-left text-slate-500">
                          <th className="p-3">Satpam</th>
                          <th className="p-3">Wajib</th>
                          <th className="p-3">Terpenuhi</th>
                          <th className="p-3">Kerja</th>
                          <th className="p-3">Izin</th>
                          <th className="p-3">Ekstra</th>
                          <th className="p-3">Konflik</th>
                          <th className="p-3">Bonus</th>
                        </tr>
                      </thead>
                      <tbody>
                        {plan.employees.map((employee) => (
                          <tr
                            key={employee.employeeId}
                            className="border-b border-slate-100"
                          >
                            <td className="p-3 font-semibold">
                              {employee.employeeName}
                            </td>
                            <td className="p-3">{employee.requiredDuties}</td>
                            <td className="p-3">{employee.fulfilledDuties}</td>
                            <td className="p-3">{employee.fulfilledByWork}</td>
                            <td className="p-3">{employee.fulfilledByAbsence}</td>
                            <td className="p-3">{employee.extraDuties}</td>
                            <td className="p-3">{employee.conflictingDuties}</td>
                            <td className="p-3 font-bold">
                              {employee.eligibleForBonus
                                ? money(employee.bonusAmount)
                                : 'Belum berhak'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </article>
              ))}
              {satpamOperations.reconciliation.unassignedExternalEmployees
                .length > 0 && (
                <article className="rounded-2xl border border-blue-200 bg-blue-50 p-5 text-blue-900">
                  <h2 className="font-bold">
                    Pengganti eksternal tanpa regu
                  </h2>
                  <p className="mt-1 text-sm">
                    Upah Cover tetap dihitung. Mereka tidak memiliki kewajiban
                    rencana dan tidak berhak atas bonus sampai masuk regu.
                  </p>
                  <div className="mt-3 space-y-2">
                    {satpamOperations.reconciliation.unassignedExternalEmployees.map(
                      (employee) => (
                        <div
                          key={employee.employeeId}
                          className="rounded-xl bg-white/80 p-3 font-semibold"
                        >
                          {employee.employeeName} · {employee.extraDuties}{' '}
                          penugasan ekstra
                        </div>
                      ),
                    )}
                  </div>
                </article>
              )}
            </section>
          )}

          {(!satpamOperations || satpamTab === 'mismatches') && (
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 p-5">
              <h2 className="font-bold">Perbedaan yang perlu diperiksa</h2>
              <p className="text-sm text-slate-500">
                {data.mismatches.length} temuan
              </p>
            </div>
            <div className="divide-y divide-slate-100">
              {data.mismatches.length === 0 ? (
                <div className="p-8 text-center text-slate-500">
                  Tidak ada perbedaan yang ditemukan.
                </div>
              ) : (
                data.mismatches.map((item, index) => (
                  <div key={`${item.code}-${item.dutyDate}-${index}`} className="p-5">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                      <div>
                        <p className="font-semibold text-slate-900">
                          {item.employeeName || 'Identitas belum cocok'} · {item.dutyDate}
                        </p>
                        <p className="text-sm text-slate-600">{item.message}</p>
                        <p className="mt-1 text-xs font-semibold text-slate-400">
                          {item.code} {item.nipy ? `· NIPY ${item.nipy}` : ''}
                        </p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
          )}
        </>
      )}

      {!loading && data && !isSatpamView(data) && totals && (
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
              <div key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-sm text-slate-500">{label}</p>
                <p className="mt-1 text-xl font-bold text-slate-900">{value}</p>
              </div>
            ))}
          </div>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
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
                  className="min-h-12 gap-2 bg-indigo-600 hover:bg-indigo-700"
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
            {data.employees.some((employee) => employee.publishBlocked) && (
              <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
                Publikasi ditahan sampai semua pegawai aktif memiliki NIPY yang
                unik. Peringatan scan satu sisi tidak menghalangi publikasi.
              </div>
            )}
          </section>

          <section className="overflow-hidden rounded-2xl border border-indigo-200 bg-white shadow-sm">
            <div className="border-b border-indigo-100 bg-indigo-50/50 p-5">
              <h2 className="font-bold text-slate-900">Pengajuan Presensi Pekarya</h2>
              <p className="mt-1 text-sm text-slate-600">
                Laporan scan yang disetujui memakai jam yang diajukan. Izin resmi
                dicatat sebagai presensi penuh 07:30–14:00 dan dihitung sesuai
                kalender upah.
              </p>
            </div>
            <div className="divide-y divide-slate-100">
              {(data.officialLeaves || []).length === 0 ? (
                <div className="p-6 text-center text-slate-500">
                  Belum ada pengajuan presensi pada periode ini.
                </div>
              ) : (
                data.officialLeaves.map((leave) => {
                  const reportType = pekaryaAttendanceReportType(leave);
                  return (
                    <article key={leave.id} className="space-y-3 p-5">
                      <div>
                        <p className="font-bold text-slate-900">
                          {leave.employeeName || leave.employeeId} · {leave.date}
                        </p>
                        <p className="text-sm font-semibold text-indigo-700">
                          {category === ALL_BLUE_COLLAR_CATEGORY
                            ? `${categoryLabel(leave.category)} · `
                            : ''}
                          {reportType === 'scan'
                            ? `Scan Masuk & Scan Keluar · ${leave.scanIn?.slice(0, 5) || '--:--'}–${leave.scanOut?.slice(0, 5) || '--:--'}`
                            : 'Izin Resmi · 07:30–14:00'}
                        </p>
                        <p className="text-sm text-slate-600">{leave.reason}</p>
                        <p className="mt-1 text-xs font-semibold uppercase text-slate-400">
                          {decisionStatusLabel(leave.status)}
                          {leave.status === 'approved' && leave.approvedAmount
                            ? ` · ${money(leave.approvedAmount)}`
                            : ''}
                        </p>
                        {leave.evidenceUrl && (
                          <button
                            type="button"
                            onClick={() =>
                              setSelectedEvidence({
                                url: leave.evidenceUrl!,
                                title: `Foto Bukti Presensi ${leave.employeeName || leave.employeeId}`,
                                activityDate: leave.date,
                                auditMetadata: leave.evidenceAuditMetadata,
                              })
                            }
                            className="mt-2 flex min-h-10 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-blue-700"
                          >
                            <Eye className="h-4 w-4" />
                            Lihat Foto Bukti
                          </button>
                        )}
                      </div>
                      {canEdit && leave.status === 'pending' && (
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button
                            className="min-h-12 bg-emerald-600 hover:bg-emerald-700"
                            disabled={working}
                            onClick={() => void reviewOfficialLeave(leave, 'approve')}
                          >
                            Setujui
                          </Button>
                          <Button
                            variant="outline"
                            className="min-h-12 border-rose-200 text-rose-700"
                            disabled={working}
                            onClick={() => void reviewOfficialLeave(leave, 'decline')}
                          >
                            Tolak
                          </Button>
                        </div>
                      )}
                    </article>
                  );
                })
              )}
            </div>
          </section>

          <div className="flex justify-between items-center px-1">
            <span className="text-[11px] text-slate-500 font-bold">
              Menampilkan{' '}
              <strong className="text-indigo-600 font-mono">
                {attendanceRows.length}
              </strong>{' '}
              data ({data.employees.length} Terhubung
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
              return (
                <article
                  key={row.key}
                  className={`border-2 rounded-2xl shadow-sm bg-white transition-all hover:border-indigo-300 overflow-hidden ${
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
                      <div className="w-8 h-8 rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-500 font-mono shrink-0">
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
                            <span className="inline-flex text-[9px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full shrink-0">
                              {categoryLabel(employee.category)}
                            </span>
                          )}
                          {unlinked && (
                            <span className="inline-flex items-center gap-1 text-[9px] font-bold text-rose-600 bg-rose-50 border border-rose-200/80 px-2 py-0.5 rounded-full shrink-0">
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
                              className="text-left px-2 py-1 rounded-lg border transition-all text-[9px] font-bold flex items-center gap-1 cursor-pointer bg-rose-50 border-rose-200/80 text-rose-700 hover:bg-rose-100/60"
                            >
                              <span className="truncate max-w-[190px]">
                                Hubungkan Pegawai Manual…
                              </span>
                            </button>
                          ) : (
                            <span className="inline-flex items-center gap-0.5 text-rose-500 bg-rose-50 border border-rose-100 text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0">
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
                            <span className="inline-flex items-center gap-1 text-[9px] text-amber-600 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-full font-bold">
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
                            className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-mono text-slate-600"
                          >
                            {date}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {isExpanded && employee && (
                    <div className="border-t border-slate-200 bg-white p-4">
                      <div className="mb-4 flex justify-end">
                        {canEdit && (
                          <Button
                            variant="outline"
                            className="min-h-12"
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
                                    className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${
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
                                      : day.completePunch
                                        ? 'Lengkap'
                                        : day.present
                                          ? 'Scan satu sisi'
                                          : 'Tidak hadir'}
                                  </span>
                                </td>
                                {canEdit && (
                                  <td className="p-3">
                                    <Button
                                      variant="outline"
                                      className="min-h-12"
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

          {data.correctionHistory.length > 0 && (
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 p-5">
                <h2 className="font-bold">Riwayat Koreksi</h2>
                <p className="text-sm text-slate-500">
                  Catatan bersifat append-only dan tidak dapat dihapus.
                </p>
              </div>
              <div className="divide-y divide-slate-100">
                {data.correctionHistory.map((item) => (
                  <div key={item.id} className="p-4">
                    <p className="font-semibold text-slate-900">
                      {item.employeeName || 'Pegawai'} · {item.date} · revisi{' '}
                      {item.revision || 1}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">{item.reason}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      Pelaku: {item.actorName || item.actorUid || '—'}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <Dialog
        open={Boolean(planCorrection)}
        onOpenChange={(open) => !open && setPlanCorrection(null)}
      >
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Koreksi Rencana Dinas Satpam</DialogTitle>
            <DialogDescription>
              Koreksi Kepala SatKer disimpan sebagai revisi baru dengan
              sebelum/sesudah. Laporan yang sudah disetujui akan dibuka kembali
              tanpa menghapus bukti awal.
            </DialogDescription>
          </DialogHeader>
          {planCorrection && (
            <div className="space-y-4">
              <div>
                <p className="font-bold">
                  {planCorrection.plan.teamId} ·{' '}
                  {planCorrection.day.dutyDate}
                </p>
                <p className="text-sm text-slate-500">
                  Rencana revisi {planCorrection.plan.revision}
                </p>
              </div>
              <div className="space-y-2">
                <Label>Shift yang dilaporkan</Label>
                <select
                  className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3"
                  value={planCorrection.day.shiftName}
                  onChange={(event) =>
                    setPlanCorrection({
                      ...planCorrection,
                      day: {
                        ...planCorrection.day,
                        shiftName: event.target.value,
                      },
                    })
                  }
                >
                  <option value="Pagi">Pagi</option>
                  <option value="Sore">Sore</option>
                  <option value="Malam">Malam</option>
                </select>
              </div>
              {planCorrection.day.assignments.map((assignment, index) => (
                <div key={assignment.postId} className="space-y-2">
                  <Label>{assignment.postId}</Label>
                  <select
                    className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3"
                    value={assignment.employeeId}
                    onChange={(event) =>
                      setPlanCorrection({
                        ...planCorrection,
                        day: {
                          ...planCorrection.day,
                          assignments:
                            planCorrection.day.assignments.map(
                              (candidate, candidateIndex) =>
                                candidateIndex === index
                                  ? {
                                      ...candidate,
                                      employeeId: event.target.value,
                                    }
                                  : candidate,
                            ),
                        },
                      })
                    }
                  >
                    {(planCorrection.plan.rosterSnapshot || []).map(
                      (employee) => (
                        <option
                          key={employee.employeeId}
                          value={employee.employeeId}
                        >
                          {employee.name}
                        </option>
                      ),
                    )}
                  </select>
                </div>
              ))}
              <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
                <Label>Off-duty</Label>
                <select
                  className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3"
                  value={planCorrection.day.offDutyEmployeeId}
                  onChange={(event) =>
                    setPlanCorrection({
                      ...planCorrection,
                      day: {
                        ...planCorrection.day,
                        offDutyEmployeeId: event.target.value,
                      },
                    })
                  }
                >
                  {(planCorrection.plan.rosterSnapshot || []).map(
                    (employee) => (
                      <option
                        key={employee.employeeId}
                        value={employee.employeeId}
                      >
                        {employee.name}
                      </option>
                    ),
                  )}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="plan-correction-reason">Alasan wajib</Label>
                <textarea
                  id="plan-correction-reason"
                  className="min-h-24 w-full rounded-xl border border-slate-300 p-3"
                  value={planCorrection.reason}
                  onChange={(event) =>
                    setPlanCorrection({
                      ...planCorrection,
                      reason: event.target.value,
                    })
                  }
                  placeholder="Contoh: Pertukaran jadwal telah dikonfirmasi oleh kedua petugas."
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              className="min-h-12"
              onClick={() => setPlanCorrection(null)}
            >
              Batal
            </Button>
            <Button
              className="min-h-12"
              disabled={
                working ||
                !planCorrection ||
                planCorrection.reason.trim().length < 8
              }
              onClick={() => void savePlanCorrection()}
            >
              Simpan Koreksi
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(linkTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setLinkTarget(null);
            setLinkEmployeeId('');
            setLinkSearch('');
            setError('');
          }
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Hubungkan Baris Presensi</DialogTitle>
            <DialogDescription>
              Penghubungan berlaku untuk periode ini saja dan tercatat dalam
              audit. Seluruh hari presensi baris ini akan dihitung untuk pegawai
              yang dipilih.
            </DialogDescription>
          </DialogHeader>
          {linkTarget && (
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="font-bold text-slate-900">
                  {linkTarget.sourceName || 'Tanpa nama'}
                </p>
                <p className="text-sm text-slate-500">
                  {linkTarget.department} · PIN {linkTarget.sourceNipy || 'kosong'} ·{' '}
                  {linkTarget.dates.length} hari
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="manual-link-search">Cari pegawai</Label>
                <Input
                  id="manual-link-search"
                  value={linkSearch}
                  onChange={(event) => setLinkSearch(event.target.value)}
                  placeholder="Nama atau NIPY pegawai"
                />
              </div>
              <div className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
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
              {error && (
                <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                  {error}
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              className="min-h-12"
              onClick={() => {
                setLinkTarget(null);
                setLinkEmployeeId('');
                setLinkSearch('');
              }}
            >
              Batal
            </Button>
            <Button
              className="min-h-12 gap-2"
              disabled={working || !linkEmployeeId}
              onClick={() => void saveManualLink()}
            >
              <CheckCircle2 className="h-4 w-4" />
              Hubungkan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(correction)} onOpenChange={(open) => !open && setCorrection(null)}>
        <DialogContent className="max-w-lg">
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
                <Input
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
              <label className="flex min-h-12 items-center gap-3 rounded-xl border p-3">
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
                  <Input
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
                  <Input
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
                <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                  Scan pulang harus lebih lambat dari scan masuk.
                </p>
              )}
              <div className="space-y-2">
                <Label htmlFor="correction-reason">Alasan wajib</Label>
                <textarea
                  id="correction-reason"
                  className="min-h-24 w-full rounded-xl border border-slate-300 p-3"
                  value={correction.reason}
                  onChange={(event) =>
                    setCorrection({ ...correction, reason: event.target.value })
                  }
                  placeholder="Contoh: Surat tugas kegiatan universitas telah diperiksa."
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              className="min-h-12"
              onClick={() => setCorrection(null)}
            >
              Batal
            </Button>
            <Button
              className="min-h-12 gap-2"
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

      {selectedEvidence && (
        <ImageExifViewer
          imageUrl={selectedEvidence.url}
          title={selectedEvidence.title}
          activityDate={selectedEvidence.activityDate}
          auditMetadata={selectedEvidence.auditMetadata}
          isOpen={Boolean(selectedEvidence)}
          onClose={() => setSelectedEvidence(null)}
        />
      )}
    </div>
  );
}
