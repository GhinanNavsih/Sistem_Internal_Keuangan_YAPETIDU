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

type AttendanceDay = {
  date: string;
  workStatus: string;
  scanIn: string | null;
  scanOut: string | null;
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
  totalAmount: number;
  payableDays: number;
  incompletePunchCount: number;
  correctedDayCount: number;
  days: AttendanceDay[];
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
  exceptions: {
    unmatchedNipys: string[];
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
  const canEdit = profile?.role === 'satker_head';

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
      await authenticatedJson('/api/satpam/absences/review', {
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
            ? 'Izin disetujui. Hak Rp12.500 dan rekonsiliasi telah diperbarui.'
            : 'Izin ditolak dan rekonsiliasi telah diperbarui.',
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Gagal memutuskan izin.');
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
        amount: acc.amount + employee.totalAmount,
      }),
      { employees: 0, harian: 0, premium: 0, amount: 0 },
    );
  }, [data]);

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
                  shift. Izin disetujui memenuhi kewajiban dinas dan membayar
                  tetap Rp12.500.
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
                          <p className="text-sm text-slate-600">
                            {absence.reason}
                          </p>
                          <p className="mt-1 text-xs font-semibold uppercase text-slate-400">
                            {decisionStatusLabel(absence.status)}
                            {absence.late ? ' · diajukan terlambat' : ''}
                            {requestType === 'izin_resmi' &&
                            absence.status === 'approved'
                              ? ` · ${money(absence.approvedAmount || 12_500)}`
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
              ['Harian', totals.harian],
              ['Jumat & Libur', totals.premium],
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

          <section className="space-y-3">
            {data.employees.map((employee) => {
              const isExpanded = expanded.has(employee.employeeId);
              return (
                <article
                  key={employee.employeeId}
                  className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
                >
                  <button
                    type="button"
                    className="flex min-h-16 w-full items-center justify-between gap-3 p-4 text-left hover:bg-slate-50"
                    onClick={() =>
                      setExpanded((current) => {
                        const next = new Set(current);
                        if (next.has(employee.employeeId)) next.delete(employee.employeeId);
                        else next.add(employee.employeeId);
                        return next;
                      })
                    }
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-bold text-slate-900">{employee.name}</p>
                        {category === ALL_BLUE_COLLAR_CATEGORY && (
                          <span className="rounded-full bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700">
                            {categoryLabel(employee.category)}
                          </span>
                        )}
                        {employee.publishBlocked && (
                          <UserRoundX className="h-5 w-5 text-rose-600" />
                        )}
                      </div>
                      <p className="text-sm text-slate-500">
                        NIPY {employee.nipy || 'belum diisi'} · {employee.payableDays} hari ·{' '}
                        {money(employee.totalAmount)}
                      </p>
                      {employee.warnings.length > 0 && (
                        <p className="mt-1 text-xs font-semibold text-amber-700">
                          {employee.warnings
                            .map((warning) => warningLabel[warning] || warning)
                            .join(' · ')}
                        </p>
                      )}
                    </div>
                    {isExpanded ? (
                      <ChevronUp className="h-5 w-5 shrink-0" />
                    ) : (
                      <ChevronDown className="h-5 w-5 shrink-0" />
                    )}
                  </button>

                  {isExpanded && (
                    <div className="border-t border-slate-200 p-4">
                      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                        <div className="rounded-xl bg-slate-50 p-3">
                          <p className="text-xs text-slate-500">Harian</p>
                          <p className="font-bold">{employee.harianCount}</p>
                        </div>
                        <div className="rounded-xl bg-slate-50 p-3">
                          <p className="text-xs text-slate-500">Jumat & Libur</p>
                          <p className="font-bold">{employee.jumatLiburCount}</p>
                        </div>
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
                              <th className="p-3">Upah</th>
                              <th className="p-3">Status</th>
                              {canEdit && <th className="p-3">Tindakan</th>}
                            </tr>
                          </thead>
                          <tbody>
                            {employee.days.map((day) => (
                              <tr key={day.date} className="border-b border-slate-100">
                                <td className="p-3 font-semibold">{day.date}</td>
                                <td className="p-3">{day.scanIn || '—'}</td>
                                <td className="p-3">{day.scanOut || '—'}</td>
                                <td className="p-3">
                                  {day.payType || 'Tidak dibayar'}
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
