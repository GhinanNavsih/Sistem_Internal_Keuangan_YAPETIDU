"use client";

import React, { useState, useEffect, useMemo, useRef, Suspense } from 'react';
import { FloatingSnackbar } from '@/components/ui/floating-snackbar';
import { useAuth } from '@/lib/AuthContext';
import { useConfirmLogout } from '@/components/LogoutConfirmProvider';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button, buttonVariants } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DetailList, DetailRow } from '@/components/ui/detail-list';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { StatusDot, type StatusTone } from '@/components/ui/status-dot';
import { cn } from '@/lib/utils';
import {
  LogOut,
  Compass,
  ArrowLeft,
  Pencil,
  MoreHorizontal,
} from 'lucide-react';
import EmployeeNavigationMenu from '@/components/EmployeeNavigationMenu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { db } from '@/lib/firebase';
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  getDoc,
  deleteDoc,
  updateDoc,
  deleteField,
  serverTimestamp,
} from 'firebase/firestore';
import { MONTHS_ID } from '@/utils/rekapConfig';
import {
  calculateDriverNetWage,
  calculateDriverReimbursementSettlement,
  DEFAULT_FUEL_PROCUREMENT_MODE,
  isFuelProcurementMode,
  formatDurationHoursAsJamMenit,
} from '@/lib/payroll/driverJourney';
import { authenticatedJson } from '@/lib/payroll/client';
import AssignedSpjHistoryPanel from '@/components/employee/activities/AssignedSpjHistoryPanel';
import {
  fetchAssignedSpjEvents,
  type AssignedSpjEvent,
} from '@/lib/payroll/assignedSpjEvents';
import {
  EMPLOYEE_ACTIVITY_PATHS,
  SOPIR_JOURNEY_REPORT_PATH,
  getEmployeeActivitiesPath,
  getEmployeeActivityWorkflow,
} from '@/lib/employeeActivities';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DriverHistoryJourneyListSkeleton, DriverHistoryPageSkeleton } from '@/components/DriverHistorySkeleton';

interface ActivityReport {
  id: string;
  employeeId: string;
  employeeName: string;
  jobCategory: string;
  period: string;
  activityName: string;
  activityDate: string;
  timeStart: string;
  timeEnd: string;
  status: 'pending' | 'approved' | 'declined';
  fee: number;
  hasUangMakan?: boolean;
  declineReason?: string;
  submittedAt?: any;
  // Driver specific
  vehicleType?: string;
  tripType?: string;
  nightCount?: number;
  fuelFee?: number;
  tollParkingFee?: number;
  points?: string[];
  distanceKm?: number;
  durationHours?: number;
  routeDurationHours?: number;
  upahBersih?: number;
  submittedFeeEstimate?: number;
  baseDriverWage?: number;
  journeyId?: string;
  extraMealAllowance?: number;
  extraFuelCost?: number;
  extraTollCost?: number;
  extraOperationalCost?: number;
  fuelReceiptUrl?: string;
  tollReceiptUrl?: string;
  reimburseDelta?: number;
  unspentCash?: number;
  remainingUnspentCash?: number;
  vehicleRate?: number;
  baseOperationalCost?: number;
  fuelProcurementMode?: 'hold_accumulate' | 'procure_release' | 'standard_direct';
  procuredAccumulatedAmount?: number;
  mealAllowance?: number;
  preAuthorizedMeal?: number;
  preAuthorizedToll?: number;
  totalOperationalCost?: number;
  authorizedAt?: any;
  journeyDate?: string;
  claimedAt?: any;
  completedAt?: any;
  // Detail fields, only needed for the read-only "Tinjau" review dialog
  componentJarak?: number;
  componentWaktu?: number;
  nightPremium?: number;
  actualMealAllowance?: number;
  isSelfAuthorizedWithoutPiket?: boolean;
}

const YEARS = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i);

function fmtRp(val: number): string {
  return 'Rp' + Math.ceil(val).toLocaleString('id-ID');
}

function isWeekend(dateStr: string): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const day = d.getDay();
  return day === 0 || day === 6;
}

function getStatusConfig(status?: string): { label: string; tone: StatusTone } {
  switch (status) {
    case 'approved':
      return { label: 'Disetujui', tone: 'success' };
    case 'declined':
      return { label: 'Ditolak', tone: 'danger' };
    default:
      return { label: 'Menunggu', tone: 'warning' };
  }
}

/** "2026-09-26" -> "26 Sep 2026". */
function formatActivityDate(dateStr?: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr.includes('T') ? dateStr : `${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

function getActivityReimburseDelta(activity: ActivityReport): number {
  if (activity.reimburseDelta !== undefined) return activity.reimburseDelta;
  const fuelMode = isFuelProcurementMode(activity.fuelProcurementMode)
    ? activity.fuelProcurementMode
    : DEFAULT_FUEL_PROCUREMENT_MODE;
  return calculateDriverReimbursementSettlement({
    fuelAllowance: activity.vehicleType === 'Ndalem' ? 0 : Number(activity.baseOperationalCost || 0),
    fuelSpent: activity.vehicleType === 'Ndalem'
      ? 0
      : activity.fuelFee !== undefined
        ? Number(activity.fuelFee || 0)
        : Number(activity.baseOperationalCost || 0) + Number(activity.extraFuelCost || 0),
    tollAllowance: Number(activity.preAuthorizedToll || 0),
    tollSpent: activity.tollParkingFee !== undefined
      ? Number(activity.tollParkingFee || 0)
      : Number(activity.preAuthorizedToll || 0) + Number(activity.extraTollCost || 0),
    additionalReimbursement: Number(activity.extraMealAllowance || 0) + Number(activity.extraOperationalCost || 0),
    fuelProcurementMode: fuelMode,
    procuredAccumulatedAmount: fuelMode === 'procure_release'
      ? Number(activity.procuredAccumulatedAmount || 0)
      : 0,
  }).reimburseDelta;
}

function DriverHistoryContent() {
  const { profile: rawProfile, activeProfile } = useAuth();
  const requestLogout = useConfirmLogout();
  const profile = activeProfile || rawProfile;
  const router = useRouter();
  const searchParams = useSearchParams();

  const [month, setMonth] = useState<number>(() => {
    const m = searchParams.get('month');
    return m ? parseInt(m, 10) : new Date().getMonth() + 1;
  });
  const [year, setYear] = useState<number>(() => {
    const y = searchParams.get('year');
    return y ? parseInt(y, 10) : new Date().getFullYear();
  });

  const [activities, setActivities] = useState<ActivityReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [assignedSpjEvents, setAssignedSpjEvents] = useState<AssignedSpjEvent[]>([]);
  const [loadingAssignedSpjEvents, setLoadingAssignedSpjEvents] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'declined'>('all');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [targetDeleteActivity, setTargetDeleteActivity] = useState<ActivityReport | null>(null);
  const [reviewActivity, setReviewActivity] = useState<ActivityReport | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  // Focus opens on the dialog's title, not its only button at the bottom, so the
  // review starts at the top instead of scrolled to the end.
  const reviewHeaderRef = useRef<HTMLDivElement>(null);

  const handleConfirmDeleteActivity = async () => {
    if (!targetDeleteActivity || isDeleting) return;

    setIsDeleting(true);
    try {
      await authenticatedJson(
        `/api/pekarya/activities?reportId=${encodeURIComponent(targetDeleteActivity.id)}${targetDeleteActivity.journeyId ? `&journeyId=${encodeURIComponent(targetDeleteActivity.journeyId)}` : ''}`,
        { method: 'DELETE' }
      );

      if (typeof window !== 'undefined' && targetDeleteActivity.journeyId) {
        localStorage.removeItem(`journey_draft_${targetDeleteActivity.journeyId}`);
      }

      setMessage({ type: 'success', text: 'Laporan perjalanan berhasil dihapus.' });
      setTargetDeleteActivity(null);
    } catch (err: any) {
      console.error('Error deleting activity report:', err);
      setMessage({ type: 'error', text: err.message || 'Gagal menghapus laporan perjalanan.' });
    } finally {
      setIsDeleting(false);
    }
  };

  const periodToken = useMemo(() => `${year}-${String(month).padStart(2, '0')}`, [year, month]);
  const isSopir = getEmployeeActivityWorkflow(profile || {}) === 'sopir';

  // Fetch driver reported activities from Firestore
  useEffect(() => {
    if (!profile?.linkedEmployeeId || !isSopir) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const q = query(
      collection(db, 'ActivityReports'),
      where('employeeId', '==', profile.linkedEmployeeId),
      where('period', '==', periodToken)
    );

    const unsubscribe = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({
        id: d.id,
        ...d.data(),
      } as ActivityReport));

      // Sort by date desc, then by submittedAt desc
      list.sort((a, b) => {
        const dateCmp = b.activityDate.localeCompare(a.activityDate);
        if (dateCmp !== 0) return dateCmp;
        const aTime = a.submittedAt?.toDate?.()?.getTime?.() ?? 0;
        const bTime = b.submittedAt?.toDate?.()?.getTime?.() ?? 0;
        return bTime - aTime;
      });

      setActivities(list);
      setLoading(false);
    }, (err) => {
      console.error('Error listening to driver activities:', err);
      setMessage({ type: 'error', text: 'Gagal memuat data riwayat perjalanan.' });
      setLoading(false);
    });

    return () => unsubscribe();
  }, [profile?.linkedEmployeeId, periodToken, isSopir]);

  useEffect(() => {
    if (!profile?.linkedEmployeeId || !isSopir) {
      setAssignedSpjEvents([]);
      setLoadingAssignedSpjEvents(false);
      return;
    }

    let active = true;
    setLoadingAssignedSpjEvents(true);
    fetchAssignedSpjEvents(periodToken)
      .then((events) => {
        if (!active) return;
        setAssignedSpjEvents(events);
      })
      .catch((error) => {
        if (!active) return;
        console.error('Error loading assigned SPJ history:', error);
        setAssignedSpjEvents([]);
      })
      .finally(() => {
        if (active) setLoadingAssignedSpjEvents(false);
      });

    return () => {
      active = false;
    };
  }, [profile?.linkedEmployeeId, periodToken, isSopir]);

  const filteredActivities = useMemo(() => {
    if (statusFilter === 'all') return activities;
    return activities.filter(a => a.status === statusFilter);
  }, [activities, statusFilter]);

  const stats = useMemo(() => {
    const pending = activities.filter(a => a.status === 'pending').length;
    const approved = activities.filter(a => a.status === 'approved');
    const declined = activities.filter(a => a.status === 'declined').length;
    const totalApprovedWage = approved.reduce((sum, a) => sum + (a.upahBersih || 0), 0);
    const totalApprovedReimburse = approved.reduce((sum, a) => sum + getActivityReimburseDelta(a), 0);
    return { pending, approved: approved.length, declined, totalApprovedWage, totalApprovedReimburse };
  }, [activities]);

  const reviewWageBreakdown = useMemo(() => {
    if (!reviewActivity) return null;
    const componentJarak = reviewActivity.componentJarak ?? Math.ceil((reviewActivity.distanceKm || 0) * 300);
    const componentWaktu = reviewActivity.componentWaktu ?? Math.ceil(
      (reviewActivity.routeDurationHours ?? reviewActivity.durationHours ?? 0) * 5000,
    );
    const nightPremium = reviewActivity.nightPremium ?? ((reviewActivity.nightCount || 0) * 50000);
    return { componentJarak, componentWaktu, nightPremium };
  }, [reviewActivity]);

  if (!profile?.linkedEmployeeId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white p-4">
        <div className="w-full max-w-sm space-y-4 text-center">
          <h1 className="text-base font-semibold text-slate-900">Akun belum terhubung</h1>
          <p className="text-sm leading-relaxed text-slate-600">
            Akun Anda belum dihubungkan dengan data pegawai. Hubungi administrator BAK untuk mengaturnya.
          </p>
          <Button onClick={requestLogout} variant="outline" size="lg" className="w-full">
            <LogOut />
            Keluar
          </Button>
        </div>
      </div>
    );
  }

  if (!isSopir) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white p-4">
        <div className="w-full max-w-sm space-y-4 text-center">
          <h1 className="text-base font-semibold text-slate-900">Akses ditolak</h1>
          <p className="text-sm leading-relaxed text-slate-600">
            Halaman ini khusus pegawai berkategori Sopir.
          </p>
          <Link
            href={getEmployeeActivitiesPath(profile)}
            className={cn(buttonVariants({ variant: 'accent', size: 'lg' }), 'w-full')}
          >
            Kembali
          </Link>
        </div>
      </div>
    );
  }

  const statusTabs = [
    { value: 'all', label: 'Semua', count: activities.length },
    { value: 'pending', label: 'Menunggu', count: stats.pending },
    { value: 'approved', label: 'Disetujui', count: stats.approved },
    { value: 'declined', label: 'Ditolak', count: stats.declined },
  ] as const;

  const reviewStatus = getStatusConfig(reviewActivity?.status);
  // A month with no reimbursement has nothing to show under that label.
  const showReimburseTotal = stats.totalApprovedReimburse !== 0;

  return (
    <div className="min-h-screen bg-white pb-12 font-sans text-sm text-slate-700">
      {/* ── Top bar ───────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4">
          <div className="flex items-center gap-1">
            <Link
              href={EMPLOYEE_ACTIVITY_PATHS.sopir}
              aria-label="Kembali"
              title="Kembali"
              className={buttonVariants({ variant: 'ghost', size: 'icon' })}
            >
              <ArrowLeft />
            </Link>
            <h1 className="text-base font-semibold text-slate-900">Riwayat perjalanan</h1>
          </div>
          <div className="flex items-center gap-2">
            <EmployeeNavigationMenu />
            <Button
              onClick={requestLogout}
              variant="ghost"
              size="icon"
              aria-label="Keluar"
              title="Keluar"
              className="text-slate-500"
            >
              <LogOut />
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-5 px-4 py-5">
        <FloatingSnackbar message={message} />

        {/* ── Period ───────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2">
          <Select value={String(month)} onValueChange={(v) => v && setMonth(parseInt(v))}>
            <SelectTrigger aria-label="Bulan" className="h-10 w-40 px-3 text-sm text-slate-900">
              <SelectValue>{MONTHS_ID[month - 1]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {MONTHS_ID.map((m, i) => (
                <SelectItem key={i + 1} value={String(i + 1)}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(year)} onValueChange={(v) => v && setYear(parseInt(v))}>
            <SelectTrigger aria-label="Tahun" className="h-10 w-28 px-3 text-sm text-slate-900">
              <SelectValue>{year}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {YEARS.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <AssignedSpjHistoryPanel
          assignedSpjEvents={assignedSpjEvents}
          loadingAssignedSpjEvents={loadingAssignedSpjEvents}
        />

        {/* ── Totals ───────────────────────────────────────────────────── */}
        {showReimburseTotal ? (
          <dl className="grid grid-cols-2 divide-x divide-slate-200 border-y border-slate-200">
            <div className="py-4 pr-4">
              <dt className="text-xs text-slate-500">Upah bersih disetujui</dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums text-emerald-700">{fmtRp(stats.totalApprovedWage)}</dd>
            </div>
            <div className="py-4 pl-4">
              <dt className="text-xs text-slate-500">Total reimburse</dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{fmtRp(stats.totalApprovedReimburse)}</dd>
            </div>
          </dl>
        ) : (
          // One figure fills the row: label on the left, amount on the right.
          <dl className="flex items-baseline justify-between gap-4 border-y border-slate-200 py-4">
            <dt className="text-sm text-slate-500">Upah bersih disetujui</dt>
            <dd className="text-lg font-semibold tabular-nums text-emerald-700">{fmtRp(stats.totalApprovedWage)}</dd>
          </dl>
        )}

        {/* ── Status tabs ──────────────────────────────────────────────── */}
        <div
          role="tablist"
          aria-label="Filter status"
          className="-mx-4 flex overflow-x-auto overflow-y-hidden border-b border-slate-200 px-4 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {statusTabs.map((tab) => {
            const active = statusFilter === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setStatusFilter(tab.value)}
                className={cn(
                  '-mb-px shrink-0 border-b-2 px-2 py-2.5 text-[13px]! transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-600',
                  active
                    ? 'border-blue-600 font-medium text-slate-900'
                    : 'border-transparent text-slate-500 hover:text-slate-900',
                )}
              >
                {tab.label}
                <span className="ml-1 tabular-nums text-slate-400">{tab.count}</span>
              </button>
            );
          })}
        </div>

        {/* ── Journey list ─────────────────────────────────────────────── */}
        {loading ? (
          <DriverHistoryJourneyListSkeleton />
        ) : filteredActivities.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <Compass className="size-8 text-slate-300" />
            <p className="text-sm text-slate-500">
              {statusFilter !== 'all'
                ? `Tidak ada perjalanan berstatus ${getStatusConfig(statusFilter).label.toLowerCase()} di periode ini.`
                : 'Belum ada perjalanan di periode ini.'}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {filteredActivities.map((activity) => {
              const sc = getStatusConfig(activity.status);
              const reimburseDelta = getActivityReimburseDelta(activity);
              const upahBersihShown =
                activity.status === 'approved'
                  ? (activity.upahBersih || 0)
                  : (activity.submittedFeeEstimate ?? activity.baseDriverWage ?? calculateDriverNetWage({
                      distanceKm: activity.distanceKm || 0,
                      travelTimeHours: activity.routeDurationHours ?? activity.durationHours ?? 0,
                      elapsedDurationHours: activity.durationHours || 0,
                      nightCount: activity.nightCount || 0,
                    }));
              const routeSummary = activity.activityName.includes(' (')
                ? activity.activityName.split(' (')[1].replace(')', '')
                : '';
              const editHref = activity.journeyId
                ? `${SOPIR_JOURNEY_REPORT_PATH}?id=${activity.journeyId}&editReportId=${activity.id}`
                : `${EMPLOYEE_ACTIVITY_PATHS.sopir}?editReportId=${activity.id}`;
              const activityTitle = activity.activityName.split(' (')[0];

              return (
                <li key={activity.id} className="space-y-3 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-medium leading-snug text-slate-900">{activityTitle}</h3>
                      {routeSummary && (
                        <p className="mt-0.5 truncate text-[13px] text-slate-500" title={routeSummary}>{routeSummary}</p>
                      )}
                      <p className="mt-0.5 text-[13px] tabular-nums text-slate-500">
                        {formatActivityDate(activity.activityDate)} · {activity.timeStart}–{activity.timeEnd}
                        {activity.vehicleType ? ` · ${activity.vehicleType}` : ''}
                      </p>
                    </div>
                    <StatusDot tone={sc.tone} className="shrink-0">{sc.label}</StatusDot>
                  </div>

                  {activity.status === 'declined' && activity.declineReason && (
                    <Callout tone="error">Alasan penolakan: {activity.declineReason}</Callout>
                  )}

                  <div className="flex items-center justify-between gap-3">
                    <p className="min-w-0 flex-1 truncate text-[13px] tabular-nums text-slate-500">
                      <span className="text-base font-semibold text-emerald-700">{fmtRp(upahBersihShown)}</span>
                      {' upah bersih'}
                      {reimburseDelta !== 0 && ` · ${fmtRp(reimburseDelta)} reimburse`}
                    </p>

                    <div className="flex shrink-0 items-center gap-1">
                      {(activity.status === 'pending' || activity.status === 'declined') && (
                        <>
                          <Link href={editHref} className={buttonVariants({ variant: 'outline' })}>
                            <Pencil />
                            Edit
                          </Link>
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              render={
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`Aksi lain untuk ${activityTitle}`}
                                  title="Aksi lain"
                                  className="text-slate-500"
                                />
                              }
                            >
                              <MoreHorizontal />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent>
                              <DropdownMenuItem
                                className="text-sm font-medium text-red-600 data-highlighted:bg-red-50"
                                onClick={() => setTargetDeleteActivity(activity)}
                              >
                                Hapus laporan
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </>
                      )}
                      {activity.status === 'approved' && (
                        <Button type="button" variant="outline" onClick={() => setReviewActivity(activity)}>
                          Tinjau
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ── Delete confirmation ─────────────────────────────────────── */}
      <ConfirmDialog
        open={Boolean(targetDeleteActivity)}
        onOpenChange={(open) => !open && setTargetDeleteActivity(null)}
        title="Hapus laporan perjalanan?"
        description={
          <>
            Laporan <span className="font-medium text-slate-900">{targetDeleteActivity?.activityName.split(' (')[0]}</span> dihapus permanen dan tidak bisa dikembalikan.
          </>
        }
        confirmLabel="Hapus laporan"
        destructive
        loading={isDeleting}
        onConfirm={handleConfirmDeleteActivity}
      />

      {/* ── Journey review (read-only) ──────────────────────────────── */}
      <Dialog open={Boolean(reviewActivity)} onOpenChange={(open) => !open && setReviewActivity(null)}>
        <DialogContent
          showCloseButton={false}
          initialFocus={reviewHeaderRef}
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
        >
          <DialogHeader ref={reviewHeaderRef} tabIndex={-1} className="outline-none">
            <DialogTitle className="text-base font-semibold leading-snug text-slate-900">
              {reviewActivity?.activityName.split(' (')[0]}
            </DialogTitle>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-slate-500">
              <StatusDot tone={reviewStatus.tone} className="text-[13px]">{reviewStatus.label}</StatusDot>
              {reviewActivity?.vehicleType && <span>· {reviewActivity.vehicleType}</span>}
              {reviewActivity?.isSelfAuthorizedWithoutPiket && <span>· SPJ mandiri (tanpa piket)</span>}
            </div>
          </DialogHeader>

          <div className="space-y-5">
            {reviewActivity?.points && reviewActivity.points.length > 0 && (
              <section className="space-y-2">
                <h2 className="text-sm font-semibold text-slate-900">Rute</h2>
                <ol className="relative ml-1.5 space-y-3 border-l border-dashed border-slate-300 pl-5">
                  {reviewActivity.points.map((point, idx) => (
                    <li key={idx} className="relative text-sm text-slate-700">
                      <span aria-hidden className="absolute -left-[26px] top-1.5 size-2.5 rounded-full bg-blue-600" />
                      {point}
                    </li>
                  ))}
                </ol>
              </section>
            )}

            <DetailList>
              <DetailRow label="Tanggal">{formatActivityDate(reviewActivity?.activityDate)}</DetailRow>
              <DetailRow label="Waktu">{reviewActivity?.timeStart}–{reviewActivity?.timeEnd}</DetailRow>
              <DetailRow label="Jarak tempuh">{(reviewActivity?.distanceKm || 0).toFixed(1)} km</DetailRow>
              <DetailRow label="Waktu tempuh">
                {formatDurationHoursAsJamMenit(reviewActivity?.routeDurationHours ?? reviewActivity?.durationHours ?? 0)}
              </DetailRow>
            </DetailList>

            <section className="space-y-1">
              <h2 className="text-sm font-semibold text-slate-900">Upah bersih sopir</h2>
              <DetailList>
                <DetailRow label="Komponen jarak">{fmtRp(reviewWageBreakdown?.componentJarak || 0)}</DetailRow>
                <DetailRow label="Komponen waktu">{fmtRp(reviewWageBreakdown?.componentWaktu || 0)}</DetailRow>
                {(reviewWageBreakdown?.nightPremium || 0) > 0 && (
                  <DetailRow label={`Insentif menginap (${reviewActivity?.nightCount || 0}×)`}>
                    +{fmtRp(reviewWageBreakdown?.nightPremium || 0)}
                  </DetailRow>
                )}
                <DetailRow label="Upah bersih" emphasis>
                  <span className="text-emerald-700">{fmtRp(reviewActivity?.upahBersih || 0)}</span>
                </DetailRow>
              </DetailList>
            </section>

            <section className="space-y-1">
              <h2 className="text-sm font-semibold text-slate-900">Operasional dan reimburse</h2>
              <DetailList>
                <DetailRow label="BBM">{fmtRp(reviewActivity?.fuelFee || 0)}</DetailRow>
                <DetailRow label="Tol & parkir">{fmtRp(reviewActivity?.tollParkingFee || 0)}</DetailRow>
                <DetailRow label="Uang makan">
                  {fmtRp(reviewActivity?.actualMealAllowance ?? reviewActivity?.mealAllowance ?? 0)}
                </DetailRow>
                <DetailRow label="Total reimburse" emphasis>
                  {fmtRp(reviewActivity ? getActivityReimburseDelta(reviewActivity) : 0)}
                </DetailRow>
              </DetailList>
            </section>

            {(reviewActivity?.fuelReceiptUrl || reviewActivity?.tollReceiptUrl) && (
              <div className="flex gap-2">
                {reviewActivity?.fuelReceiptUrl && (
                  <a
                    href={reviewActivity.fuelReceiptUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'flex-1')}
                  >
                    Lihat bukti BBM
                  </a>
                )}
                {reviewActivity?.tollReceiptUrl && (
                  <a
                    href={reviewActivity.tollReceiptUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'flex-1')}
                  >
                    Lihat bukti tol
                  </a>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" size="lg" onClick={() => setReviewActivity(null)}>
              Tutup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function DriverHistoryPage() {
  return (
    <Suspense fallback={<DriverHistoryPageSkeleton />}>
      <DriverHistoryContent />
    </Suspense>
  );
}
