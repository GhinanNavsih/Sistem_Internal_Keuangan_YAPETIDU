"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, CalendarDays, Check, Loader2, RefreshCw, X } from 'lucide-react';
import { GantiLiburAttachmentLinks } from '@/components/GantiLiburAttachmentLinks';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/lib/AuthContext';
import {
  authenticatedJson,
  createFinancialRequestId,
  propagateUraianToSlips,
} from '@/lib/payroll/client';
import type {
  AnnualPaidLeaveEmployeeKind,
  AnnualPaidLeavePayType,
  AnnualPaidLeaveStatus,
} from '@/lib/payroll/annualPaidLeave';
import {
  gantiLiburDeclineSuggestion,
  canReviewGantiLibur,
  gantiLiburEmployeeKind,
  gantiLiburVerdictLabel,
  type GantiLiburAttendanceCheck,
  type GantiLiburRequest,
} from '@/lib/payroll/gantiLibur';

interface CutiReviewRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeKind: AnnualPaidLeaveEmployeeKind;
  category: string;
  leaveDate: string;
  year: number;
  period: string;
  reason: string;
  serviceDate: string;
  qualifyingDate: string;
  status: AnnualPaidLeaveStatus;
  revision: number;
  decisionReason?: string | null;
  approvedPayType?: AnnualPaidLeavePayType | null;
  approvedAmount?: number;
}

interface CutiReviewResponse {
  requests: CutiReviewRequest[];
}

interface GantiLiburReviewResponse {
  requests: GantiLiburRequest[];
}

type ReviewStatus = 'pending' | 'approved' | 'declined' | 'withdrawn' | 'all';

const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  pending: 'Menunggu',
  approved: 'Disetujui',
  declined: 'Ditolak',
  withdrawn: 'Ditarik',
  all: 'Semua',
};

function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('id-ID', {
        weekday: 'short',
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      }).format(date)
    : value;
}

function formatCutiDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('id-ID', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      }).format(date)
    : value;
}

function formatMonth(value: string): string {
  const date = new Date(`${value}-01T00:00:00`);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(date)
    : value;
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(value);
}

function checkClass(check: GantiLiburAttendanceCheck): string {
  if (check.verdict === 'eligible') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (check.verdict === 'awaiting_upload') return 'border-slate-200 bg-slate-50 text-slate-600';
  if (check.verdict === 'absent') return 'border-rose-200 bg-rose-50 text-rose-800';
  return 'border-amber-200 bg-amber-50 text-amber-800';
}

function AttendanceCheckBadge({
  check,
  workedDate,
}: {
  check: GantiLiburAttendanceCheck;
  workedDate: string;
}) {
  const scans = check.scanIn || check.scanOut
    ? ` · Scan ${check.scanIn || '--:--'} – ${check.scanOut || '--:--'}`
    : '';
  return (
    <div className={`mt-2 inline-flex rounded-xl border px-3 py-1.5 text-sm font-semibold ${checkClass(check)}`}>
      {check.verdict === 'awaiting_upload'
        ? `Menunggu data presensi ${formatMonth(workedDate.slice(0, 7))}`
        : `${gantiLiburVerdictLabel(check.verdict)}${scans}`}
    </div>
  );
}

export default function LeaveAndDayOffReviewCard() {
  const { profile } = useAuth();
  const currentYear = new Date().getFullYear();

  const role = profile?.role || '';
  const canAccessCuti = Boolean(
    profile && ['super_admin', 'satker_head', 'loyalis_admin'].includes(profile.role),
  );
  const canAccessGantiLibur = [
    'super_admin',
    'loyalis_admin',
    'satker_head_loyalis',
    'satker_head',
    'finance_verifier',
  ].includes(role);
  const canDecideGantiLibur = role === 'super_admin' || role === 'loyalis_admin' || role === 'satker_head';

  const [activeTab, setActiveTab] = useState<'cuti' | 'ganti_libur'>(
    canAccessCuti ? 'cuti' : 'ganti_libur',
  );

  // Cuti state
  const [cutiYear, setCutiYear] = useState(currentYear);
  const [cutiStatus, setCutiStatus] = useState<ReviewStatus>('pending');
  const [cutiItems, setCutiItems] = useState<CutiReviewRequest[]>([]);
  const [cutiLoading, setCutiLoading] = useState(false);
  const [cutiDecisionReasons, setCutiDecisionReasons] = useState<Record<string, string>>({});
  const [pendingCutiCount, setPendingCutiCount] = useState<number | null>(null);

  // Ganti Libur state
  const [glStatus, setGlStatus] = useState<ReviewStatus>('pending');
  const [glItems, setGlItems] = useState<GantiLiburRequest[]>([]);
  const [glLoading, setGlLoading] = useState(false);
  const [glDecisionReasons, setGlDecisionReasons] = useState<Record<string, string>>({});
  const [pendingGlCount, setPendingGlCount] = useState<number | null>(null);

  // Unified notifications & progress
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [progress, setProgress] = useState<{
    title: string;
    completed: number;
    total: number;
    detail: string;
  } | null>(null);

  const yearOptions = useMemo(() => [currentYear - 1, currentYear, currentYear + 1], [currentYear]);

  // Load Cuti
  const loadCuti = useCallback(async () => {
    if (!canAccessCuti) return;
    setCutiLoading(true);
    try {
      const response = await authenticatedJson<CutiReviewResponse>(
        `/api/payroll/paid-leave/review?year=${cutiYear}&status=${cutiStatus}`,
      );
      const items = response.requests || [];
      setCutiItems(items);
      if (cutiStatus === 'pending') {
        setPendingCutiCount(items.length);
      }
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Gagal memuat pengajuan cuti tahunan.',
      });
    } finally {
      setCutiLoading(false);
    }
  }, [canAccessCuti, cutiStatus, cutiYear]);

  // Load Ganti Libur
  const loadGantiLibur = useCallback(async () => {
    if (!canAccessGantiLibur) return;
    setGlLoading(true);
    try {
      const response = await authenticatedJson<GantiLiburReviewResponse>(
        `/api/payroll/ganti-libur/review?status=${glStatus}`,
      );
      const items = response.requests || [];
      setGlItems(items);
      if (glStatus === 'pending') {
        setPendingGlCount(items.length);
      }
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Gagal memuat pengajuan ganti libur.',
      });
    } finally {
      setGlLoading(false);
    }
  }, [canAccessGantiLibur, glStatus]);

  // Fetch pending badge counts initially if not loaded
  const refreshBadgeCounts = useCallback(async () => {
    if (canAccessCuti && cutiStatus !== 'pending') {
      try {
        const response = await authenticatedJson<CutiReviewResponse>(
          `/api/payroll/paid-leave/review?year=${cutiYear}&status=pending`,
        );
        setPendingCutiCount(response.requests?.length || 0);
      } catch {
        // Silent badge error
      }
    }
    if (canAccessGantiLibur && glStatus !== 'pending') {
      try {
        const response = await authenticatedJson<GantiLiburReviewResponse>(
          `/api/payroll/ganti-libur/review?status=pending`,
        );
        setPendingGlCount(response.requests?.length || 0);
      } catch {
        // Silent badge error
      }
    }
  }, [canAccessCuti, canAccessGantiLibur, cutiStatus, cutiYear, glStatus]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadCuti();
      void loadGantiLibur();
      void refreshBadgeCounts();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadCuti, loadGantiLibur, refreshBadgeCounts]);

  // Cuti decision handling
  const propagateCuti = async (item: CutiReviewRequest) => {
    if (item.employeeKind === 'loyalis') {
      return propagateUraianToSlips({ scope: 'loyalis', period: item.period });
    }
    return propagateUraianToSlips({
      scope: 'pekarya',
      period: item.period,
      jobCategory: item.category,
    });
  };

  const decideCuti = async (
    item: CutiReviewRequest,
    action: 'approve' | 'decline',
    updateProgress = true,
  ) => {
    const reason = String(cutiDecisionReasons[item.id] || '').trim();
    if (action === 'decline' && !reason) {
      throw new Error('Alasan penolakan wajib diisi.');
    }
    if (updateProgress) {
      setProgress({
        title: action === 'approve' ? 'Menyetujui cuti tahunan' : 'Menolak cuti tahunan',
        completed: 0,
        total: 1,
        detail: `${item.employeeName} · ${formatCutiDate(item.leaveDate)}`,
      });
    }
    const result = await authenticatedJson<{
      status: AnnualPaidLeaveStatus;
      reconciliationWarning?: string | null;
    }>('/api/payroll/paid-leave/review', {
      method: 'POST',
      body: JSON.stringify({
        annualPaidLeaveRequestId: item.id,
        action,
        reason,
        expectedRevision: item.revision,
        requestId: createFinancialRequestId(`annual-paid-leave-${action}`),
      }),
    });
    let propagationWarning = '';
    if (action === 'approve') {
      try {
        await propagateCuti(item);
      } catch (error) {
        console.error('Annual paid leave payroll propagation failed:', error);
        propagationWarning = ' Sinkronisasi slip draf perlu dijalankan ulang.';
      }
    }
    if (updateProgress) {
      setProgress({
        title: action === 'approve' ? 'Cuti tahunan disetujui' : 'Cuti tahunan ditolak',
        completed: 1,
        total: 1,
        detail: `${item.employeeName} · ${formatCutiDate(item.leaveDate)}`,
      });
      setMessage({
        type: result.reconciliationWarning || propagationWarning ? 'error' : 'success',
        text: `${action === 'approve' ? 'Cuti disetujui dan presensi berbayar diterapkan.' : 'Pengajuan cuti ditolak.'}${result.reconciliationWarning ? ` ${result.reconciliationWarning}` : ''}${propagationWarning}`,
      });
      setProgress(null);
      await loadCuti();
      await refreshBadgeCounts();
    }
  };

  const handleCutiDecision = async (item: CutiReviewRequest, action: 'approve' | 'decline') => {
    try {
      await decideCuti(item, action);
    } catch (error) {
      setProgress(null);
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Keputusan cuti gagal diproses.',
      });
    }
  };

  const approveAllCuti = async () => {
    const pending = cutiItems.filter((item) => item.status === 'pending');
    if (pending.length === 0) return;
    let completed = 0;
    const failures: string[] = [];
    setProgress({
      title: 'Menyetujui cuti tahunan',
      completed,
      total: pending.length,
      detail: 'Menyiapkan pemeriksaan...',
    });
    for (const item of pending) {
      setProgress({
        title: 'Menyetujui cuti tahunan',
        completed,
        total: pending.length,
        detail: `${item.employeeName} · ${formatCutiDate(item.leaveDate)}`,
      });
      try {
        await decideCuti(item, 'approve', false);
      } catch (error) {
        failures.push(
          `${item.employeeName}: ${error instanceof Error ? error.message : 'gagal'}`,
        );
      }
      completed += 1;
    }
    setProgress(null);
    setMessage({
      type: failures.length > 0 ? 'error' : 'success',
      text: failures.length > 0
        ? `${completed - failures.length} dari ${pending.length} pengajuan disetujui. ${failures.join('; ')}`
        : `${pending.length} pengajuan cuti berhasil disetujui.`,
    });
    await loadCuti();
    await refreshBadgeCounts();
  };

  // Ganti Libur decision handling
  const glReasonFor = (item: GantiLiburRequest) =>
    glDecisionReasons[item.id] ??
    (item.attendanceCheck ? gantiLiburDeclineSuggestion(item.attendanceCheck.verdict) : '');

  const decideGantiLibur = async (item: GantiLiburRequest, action: 'approve' | 'decline') => {
    if (!canReviewGantiLibur({ role, permittedCategories: profile?.permittedCategories || [] }, item)) {
      throw new Error('Anda tidak berwenang memutuskan pengajuan pegawai ini.');
    }
    const reason = glReasonFor(item).trim();
    if (action === 'decline' && !reason) {
      throw new Error('Alasan penolakan wajib diisi.');
    }
    const result = await authenticatedJson<{ payrollWarning?: string }>('/api/payroll/ganti-libur/review', {
      method: 'POST',
      body: JSON.stringify({
        gantiLiburRequestId: item.id,
        action,
        reason,
        expectedRevision: item.revision,
        requestId: createFinancialRequestId(`ganti-libur-${action}`),
      }),
    });
    if (result.payrollWarning) return ` ${result.payrollWarning}`;
    if (action === 'approve') {
      try {
        await propagateUraianToSlips(gantiLiburEmployeeKind(item) === 'loyalis'
          ? { scope: 'loyalis', period: item.dayOffPeriod }
          : { scope: 'pekarya', period: item.dayOffPeriod, jobCategory: item.category });
      } catch (error) {
        console.error('Ganti libur payroll propagation failed:', error);
        return ' Sinkronisasi slip draf perlu dijalankan ulang.';
      }
    }
    return '';
  };

  const handleGlDecision = async (item: GantiLiburRequest, action: 'approve' | 'decline') => {
    setProgress({
      title: action === 'approve' ? 'Menyetujui ganti libur' : 'Menolak ganti libur',
      completed: 0,
      total: 1,
      detail: `${item.employeeName} · ${formatDate(item.dayOffDate)}`,
    });
    try {
      const warning = await decideGantiLibur(item, action);
      setMessage({
        type: warning ? 'error' : 'success',
        text: `${action === 'approve' ? 'Ganti libur disetujui; tanggal libur dihitung hadir penuh.' : 'Pengajuan ganti libur ditolak.'}${warning}`,
      });
      await loadGantiLibur();
      await refreshBadgeCounts();
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Keputusan ganti libur gagal diproses.',
      });
    } finally {
      setProgress(null);
    }
  };

  const eligiblePendingGl = glItems.filter(
    (item) => item.status === 'pending' && item.attendanceCheck?.verdict === 'eligible' &&
      canReviewGantiLibur({ role, permittedCategories: profile?.permittedCategories || [] }, item),
  );

  const approveAllEligibleGl = async () => {
    if (eligiblePendingGl.length === 0) return;
    let completed = 0;
    const failures: string[] = [];
    let propagationWarning = '';
    for (const item of eligiblePendingGl) {
      setProgress({
        title: 'Menyetujui ganti libur',
        completed,
        total: eligiblePendingGl.length,
        detail: `${item.employeeName} · ${formatDate(item.dayOffDate)}`,
      });
      try {
        const warning = await decideGantiLibur(item, 'approve');
        propagationWarning ||= warning;
      } catch (error) {
        failures.push(`${item.employeeName}: ${error instanceof Error ? error.message : 'gagal'}`);
      }
      completed += 1;
    }
    setProgress(null);
    setMessage({
      type: failures.length > 0 || propagationWarning ? 'error' : 'success',
      text: failures.length > 0
        ? `${completed - failures.length} dari ${eligiblePendingGl.length} pengajuan disetujui. ${failures.join('; ')}${propagationWarning}`
        : `${eligiblePendingGl.length} pengajuan ganti libur disetujui.${propagationWarning}`,
    });
    await loadGantiLibur();
    await refreshBadgeCounts();
  };

  if (!canAccessCuti && !canAccessGantiLibur) return null;

  return (
    <>
      <Card className="border-none bg-white shadow-sm rounded-2xl overflow-hidden">
        <CardContent className="space-y-4 p-5">
          {/* ── Main Unified Header with Navigation Tabs ─────────────────── */}
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between border-b border-slate-100 pb-4">
            <div className="flex items-center gap-3">
              <div
                className={`flex h-11 w-11 items-center justify-center rounded-2xl ${
                  activeTab === 'cuti'
                    ? 'bg-emerald-50 text-emerald-600'
                    : 'bg-indigo-50 text-indigo-600'
                } transition-colors`}
              >
                {activeTab === 'cuti' ? (
                  <CalendarDays className="h-6 w-6" />
                ) : (
                  <CalendarClock className="h-6 w-6" />
                )}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-slate-800">
                    Pengajuan Cuti &amp; Ganti Libur
                  </h2>
                  <span
                    className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                      activeTab === 'cuti'
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-indigo-50 text-indigo-700'
                    }`}
                  >
                    {activeTab === 'cuti' ? 'Cuti Tahunan' : 'Ganti Libur'}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-500">
                  {activeTab === 'cuti'
                    ? 'Persetujuan membuat presensi berbayar; penolakan hanya melepaskan reservasi saldo.'
                    : 'Penggantian hari libur atas kerja di hari libur. Persetujuan membuat presensi berbayar; penolakan melepaskan reservasi hari kerja.'}
                </p>
              </div>
            </div>

            {/* Navigation Tab Buttons */}
            <div className="flex items-center gap-1.5 self-start rounded-2xl bg-slate-100/80 p-1 lg:self-center">
              {canAccessCuti && (
                <button
                  type="button"
                  onClick={() => setActiveTab('cuti')}
                  className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all ${
                    activeTab === 'cuti'
                      ? 'bg-white text-emerald-700 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <CalendarDays className="h-4 w-4 text-emerald-600" />
                  <span>Cuti Tahunan</span>
                  {pendingCutiCount !== null && pendingCutiCount > 0 && (
                    <span className="rounded-full bg-amber-500 px-1.5 py-0.2 text-[10px] font-extrabold text-white">
                      {pendingCutiCount}
                    </span>
                  )}
                </button>
              )}
              {canAccessGantiLibur && (
                <button
                  type="button"
                  onClick={() => setActiveTab('ganti_libur')}
                  className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all ${
                    activeTab === 'ganti_libur'
                      ? 'bg-white text-indigo-700 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <CalendarClock className="h-4 w-4 text-indigo-600" />
                  <span>Ganti Libur</span>
                  {pendingGlCount !== null && pendingGlCount > 0 && (
                    <span className="rounded-full bg-amber-500 px-1.5 py-0.2 text-[10px] font-extrabold text-white">
                      {pendingGlCount}
                    </span>
                  )}
                </button>
              )}
            </div>
          </div>

          {/* ── Tab Controls Row ────────────────────────────────────────── */}
          {activeTab === 'cuti' && canAccessCuti && (
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-slate-500">Tahun:</span>
                <Select
                  value={String(cutiYear)}
                  onValueChange={(value) => setCutiYear(Number(value))}
                >
                  <SelectTrigger className="h-9 w-28 rounded-xl border-slate-200 bg-white text-xs font-semibold">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-white">
                    {yearOptions.map((option) => (
                      <SelectItem key={option} value={String(option)}>{option}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <span className="ml-2 text-xs font-semibold text-slate-500">Status:</span>
                <Select
                  value={cutiStatus}
                  onValueChange={(value) => setCutiStatus(value as ReviewStatus)}
                >
                  <SelectTrigger className="h-9 w-32 rounded-xl border-slate-200 bg-white text-xs font-semibold">
                    <SelectValue>{REVIEW_STATUS_LABELS[cutiStatus]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent className="bg-white">
                    <SelectItem value="pending">{REVIEW_STATUS_LABELS.pending}</SelectItem>
                    <SelectItem value="approved">{REVIEW_STATUS_LABELS.approved}</SelectItem>
                    <SelectItem value="declined">{REVIEW_STATUS_LABELS.declined}</SelectItem>
                    <SelectItem value="withdrawn">{REVIEW_STATUS_LABELS.withdrawn}</SelectItem>
                    <SelectItem value="all">{REVIEW_STATUS_LABELS.all}</SelectItem>
                  </SelectContent>
                </Select>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void loadCuti()}
                  disabled={cutiLoading}
                  className="h-9 rounded-xl text-xs"
                >
                  <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${cutiLoading ? 'animate-spin' : ''}`} />
                  Segarkan
                </Button>
              </div>

              {cutiStatus === 'pending' && cutiItems.length > 1 && (
                <Button
                  size="sm"
                  onClick={() => void approveAllCuti()}
                  disabled={cutiLoading}
                  className="h-9 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-xs font-bold"
                >
                  <Check className="mr-1.5 h-3.5 w-3.5" /> Setujui Semua ({cutiItems.length})
                </Button>
              )}
            </div>
          )}

          {activeTab === 'ganti_libur' && canAccessGantiLibur && (
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-slate-500">Status:</span>
                <Select
                  value={glStatus}
                  onValueChange={(value) => setGlStatus(value as ReviewStatus)}
                >
                  <SelectTrigger className="h-9 w-32 rounded-xl border-slate-200 bg-white text-xs font-semibold">
                    <SelectValue>{REVIEW_STATUS_LABELS[glStatus]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent className="bg-white">
                    {(Object.keys(REVIEW_STATUS_LABELS) as ReviewStatus[]).map((option) => (
                      <SelectItem key={option} value={option}>{REVIEW_STATUS_LABELS[option]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void loadGantiLibur()}
                  disabled={glLoading}
                  className="h-9 rounded-xl text-xs"
                >
                  <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${glLoading ? 'animate-spin' : ''}`} />
                  Segarkan
                </Button>
              </div>

              {canDecideGantiLibur && glStatus === 'pending' && eligiblePendingGl.length > 1 && (
                <Button
                  size="sm"
                  onClick={() => void approveAllEligibleGl()}
                  disabled={glLoading}
                  className="h-9 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-xs font-bold"
                >
                  <Check className="mr-1.5 h-3.5 w-3.5" /> Setujui Semua yang Memenuhi ({eligiblePendingGl.length})
                </Button>
              )}
            </div>
          )}

          {/* ── Status Message Banner ─────────────────────────────────── */}
          {message && (
            <div
              className={`rounded-xl px-4 py-3 text-sm font-medium ${
                message.type === 'success'
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-amber-50 text-amber-800'
              }`}
            >
              {message.text}
            </div>
          )}

          {/* ── Tab Content: Cuti Tahunan ─────────────────────────────── */}
          {activeTab === 'cuti' && canAccessCuti && (
            <div>
              {cutiLoading ? (
                <div className="flex min-h-28 items-center justify-center text-slate-500">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin text-emerald-600" /> Memuat cuti tahunan...
                </div>
              ) : cutiItems.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
                  Tidak ada pengajuan cuti tahunan pada filter ini.
                </div>
              ) : (
                <div className="space-y-3">
                  {cutiItems.map((item) => (
                    <div key={item.id} className="rounded-2xl border border-slate-200 p-4 transition-colors hover:border-slate-300">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <div className="font-bold text-slate-800">{item.employeeName || item.employeeId}</div>
                          <div className="mt-1 text-sm text-slate-500">
                            {item.employeeKind === 'loyalis' ? 'Loyalis' : item.category} · {formatCutiDate(item.leaveDate)} · Periode {item.period}
                          </div>
                          <div className="mt-2 text-sm text-slate-700">
                            Alasan: {item.reason || 'Tidak ada alasan tambahan.'}
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            Mulai kerja {formatCutiDate(item.serviceDate)} · hak pertama mulai {formatCutiDate(item.qualifyingDate)}
                          </div>
                          {item.status === 'approved' && (
                            <div className="mt-2 text-sm font-semibold text-emerald-700">
                              {item.approvedPayType || 'Cuti'}{item.approvedAmount ? ` · ${formatMoney(item.approvedAmount)}` : ''}
                            </div>
                          )}
                          {item.decisionReason && (
                            <div className="mt-2 text-sm text-slate-600">Catatan keputusan: {item.decisionReason}</div>
                          )}
                        </div>
                        {item.status === 'pending' ? (
                          <div className="w-full space-y-2 lg:w-80">
                            <textarea
                              value={cutiDecisionReasons[item.id] || ''}
                              onChange={(event) => setCutiDecisionReasons((current) => ({
                                ...current,
                                [item.id]: event.target.value.slice(0, 500),
                              }))}
                              placeholder="Catatan keputusan; wajib untuk penolakan"
                              className="min-h-20 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                            />
                            <div className="flex justify-end gap-2">
                              <Button variant="outline" size="sm" onClick={() => void handleCutiDecision(item, 'decline')}>
                                <X className="mr-1.5 h-4 w-4" /> Tolak
                              </Button>
                              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => void handleCutiDecision(item, 'approve')}>
                                <Check className="mr-1.5 h-4 w-4" /> Setujui
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <span className="self-start rounded-full bg-slate-100 px-3 py-1 text-xs font-bold uppercase text-slate-600">
                            {REVIEW_STATUS_LABELS[item.status]}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Tab Content: Ganti Libur ──────────────────────────────── */}
          {activeTab === 'ganti_libur' && canAccessGantiLibur && (
            <div>
              {glLoading ? (
                <div className="flex min-h-28 items-center justify-center text-slate-500">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin text-indigo-600" /> Memuat ganti libur...
                </div>
              ) : glItems.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
                  Tidak ada pengajuan ganti libur pada filter ini.
                </div>
              ) : (
                <div className="space-y-3">
                  {glItems.map((item) => {
                    const check = item.attendanceCheck || null;
                    const approvable = check?.verdict === 'eligible';
                    return (
                      <div key={item.id} className="rounded-2xl border border-slate-200 p-4 transition-colors hover:border-slate-300">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0">
                            <div className="font-bold text-slate-800">{item.employeeName || item.employeeId}</div>
                            <div className="text-xs font-semibold text-slate-500">{item.category || 'LOYALIS'}</div>
                            <div className="mt-1 text-sm text-slate-600">
                              Masuk hari libur <span className="font-semibold">{formatDate(item.workedDate)}</span>
                              {' → '}libur <span className="font-semibold">{formatDate(item.dayOffDate)}</span>
                            </div>
                            {item.reason && (
                              <div className="mt-1 text-sm text-slate-500">Keterangan: {item.reason}</div>
                            )}
                            {item.attachments && item.attachments.length > 0 ? (
                              <div className="mt-2">
                                <div className="text-xs font-semibold text-slate-500">
                                  Surat resmi ({item.attachments.length})
                                </div>
                                <GantiLiburAttachmentLinks attachments={item.attachments} className="mt-1" />
                              </div>
                            ) : (
                              <div className="mt-2 text-xs text-slate-400">Tanpa surat resmi</div>
                            )}
                            {check && <AttendanceCheckBadge check={check} workedDate={item.workedDate} />}
                            {item.decisionReason && (
                              <div className="mt-2 text-sm text-slate-600">Catatan keputusan: {item.decisionReason}</div>
                            )}
                          </div>
                          {item.status === 'pending' && canReviewGantiLibur({ role, permittedCategories: profile?.permittedCategories || [] }, item) ? (
                            <div className="w-full space-y-2 lg:w-80">
                              <textarea
                                value={glReasonFor(item)}
                                onChange={(event) => setGlDecisionReasons((current) => ({
                                  ...current,
                                  [item.id]: event.target.value.slice(0, 500),
                                }))}
                                placeholder="Catatan keputusan; wajib untuk penolakan"
                                className="min-h-20 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                              />
                              <div className="flex justify-end gap-2">
                                <Button variant="outline" size="sm" onClick={() => void handleGlDecision(item, 'decline')}>
                                  <X className="mr-1.5 h-4 w-4" /> Tolak
                                </Button>
                                <Button
                                  size="sm"
                                  disabled={!approvable}
                                  title={approvable ? undefined : 'Presensi hari libur belum memenuhi 07.30–14.00 WIB.'}
                                  className="bg-indigo-600 hover:bg-indigo-700 text-white"
                                  onClick={() => void handleGlDecision(item, 'approve')}
                                >
                                  <Check className="mr-1.5 h-4 w-4" /> Setujui
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <span className="self-start rounded-full bg-slate-100 px-3 py-1 text-xs font-bold uppercase text-slate-600">
                              {REVIEW_STATUS_LABELS[item.status]}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Progress Dialog */}
      {progress && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-2xl">
            <Loader2 className="mx-auto h-9 w-9 animate-spin text-indigo-600" />
            <h3 className="mt-4 text-lg font-bold text-slate-900">{progress.title}</h3>
            <p className="mt-2 text-sm text-slate-600">{progress.detail}</p>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-indigo-600 transition-all"
                style={{ width: `${Math.max(5, (progress.completed / progress.total) * 100)}%` }}
              />
            </div>
            <p className="mt-2 text-xs font-semibold text-slate-500">
              {progress.completed} dari {progress.total} selesai. Jangan tutup halaman.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
