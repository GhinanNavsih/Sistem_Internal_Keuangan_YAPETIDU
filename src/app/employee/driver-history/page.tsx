"use client";

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { FloatingSnackbar } from '@/components/ui/floating-snackbar';
import { useAuth } from '@/lib/AuthContext';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  Card,
  CardContent,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Loader2,
  LogOut,
  Clock,
  CheckCircle2,
  XCircle,
  ClipboardList,
  Banknote,
  Compass,
  MapPin,
  CalendarDays,
  ArrowLeft,
  Pencil,
  Trash2,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
} from '@/lib/payroll/driverJourney';
import { authenticatedJson } from '@/lib/payroll/client';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

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
  preAuthorizedToll?: number;
  totalOperationalCost?: number;
  authorizedAt?: any;
  journeyDate?: string;
  claimedAt?: any;
  completedAt?: any;
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

function getStatusConfig(status?: string) {
  switch (status) {
    case 'approved':
      return {
        label: 'Disetujui',
        dotClass: 'bg-emerald-500',
        bgClass: 'bg-emerald-50',
        textClass: 'text-emerald-700',
        borderClass: 'border-emerald-200',
      };
    case 'declined':
      return {
        label: 'Ditolak',
        dotClass: 'bg-rose-500',
        bgClass: 'bg-rose-50',
        textClass: 'text-rose-700',
        borderClass: 'border-rose-200',
      };
    default:
      return {
        label: 'Menunggu',
        dotClass: 'bg-amber-500',
        bgClass: 'bg-amber-50',
        textClass: 'text-amber-700',
        borderClass: 'border-amber-200',
      };
  }
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
  const { profile: rawProfile, activeProfile, logout } = useAuth();
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
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'declined'>('all');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [targetDeleteActivity, setTargetDeleteActivity] = useState<ActivityReport | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

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
  const userJobCategory = profile?.permittedCategories?.[0] || '';
  const isSopir = userJobCategory === 'SOPIR';

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

  if (!profile?.linkedEmployeeId) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50">
        <Card className="max-w-md w-full bg-white rounded-3xl shadow-xl border-none">
          <CardContent className="p-6 text-center space-y-4">
            <h2 className="text-xl font-bold text-slate-900">Akun Belum Terhubung</h2>
            <p className="text-sm text-slate-500 leading-relaxed">
              Akun Anda belum dihubungkan dengan data pegawai di sistem. Silakan hubungi administrator BAK untuk konfigurasi akun.
            </p>
            <Button onClick={() => logout()} variant="outline" className="rounded-xl mt-4 w-full">
              <LogOut className="w-4 h-4 mr-2" />
              Keluar
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!isSopir) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50">
        <Card className="max-w-md w-full bg-white rounded-3xl shadow-xl border-none">
          <CardContent className="p-6 text-center space-y-4">
            <h2 className="text-xl font-bold text-slate-900">Akses Ditolak</h2>
            <p className="text-sm text-slate-500 leading-relaxed">
              Halaman ini dikhususkan bagi Pegawai dengan kategori jabatan **Sopir**.
            </p>
            <Link href="/employee/activities" className="block w-full">
              <Button className="rounded-xl w-full bg-indigo-600 hover:bg-indigo-700">
                Kembali ke Dashboard
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/80 to-slate-100 font-sans relative overflow-hidden text-slate-800 pb-12">
      {/* Subtle decorative blobs */}
      <div className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full bg-indigo-100/40 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] rounded-full bg-purple-100/30 blur-[100px] pointer-events-none" />

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-30 bg-white/80 backdrop-blur-xl border-b border-slate-100 shadow-sm relative z-20">
        <div className="max-w-2xl mx-auto px-4 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/employee/activities">
              <Button variant="ghost" size="icon" className="rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-50 h-8.5 w-8.5">
                <ArrowLeft className="w-5 h-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-sm font-bold text-slate-900 leading-tight">Riwayat Perjalanan</h1>
              <p className="text-[11px] text-slate-400 font-medium">{profile.displayName || 'Sopir'}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <Link href="/employee/payslip">
              <Button
                variant="outline"
                size="icon"
                className="text-slate-600 hover:text-indigo-650 hover:bg-slate-50 border border-slate-200 bg-white rounded-xl h-9 w-9 flex items-center justify-center shadow-sm cursor-pointer"
                title="Slip Gaji"
              >
                <Banknote className="w-4.5 h-4.5 text-emerald-600" />
              </Button>
            </Link>

            <Button
              onClick={() => logout()}
              variant="ghost"
              size="icon"
              className="text-slate-400 hover:text-rose-500 rounded-xl h-9 w-9 border border-slate-150/40 bg-white shadow-sm flex items-center justify-center cursor-pointer"
              title="Keluar"
            >
              <LogOut className="w-4.5 h-4.5" />
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-5 space-y-5 relative z-10">
        <FloatingSnackbar message={message} />

        {/* ── Period Selector ──────────────────────────────────────────── */}
        <Card className="bg-white rounded-2xl shadow-sm border border-slate-100">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <CalendarDays className="w-4 h-4 text-indigo-500 shrink-0" />
              <div className="flex items-center gap-2 flex-1">
                <Select value={String(month)} onValueChange={(v) => v && setMonth(parseInt(v))}>
                  <SelectTrigger className="text-sm font-bold text-slate-700 bg-slate-50 rounded-xl border border-slate-200 h-10 px-3 flex-1">
                    <SelectValue>{MONTHS_ID[month - 1]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent className="rounded-xl border-slate-100 shadow-xl bg-white">
                    {MONTHS_ID.map((m, i) => (
                      <SelectItem key={i + 1} value={String(i + 1)}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={String(year)} onValueChange={(v) => v && setYear(parseInt(v))}>
                  <SelectTrigger className="text-sm font-bold text-slate-700 bg-slate-50 rounded-xl border border-slate-200 h-10 px-3 w-24">
                    <SelectValue>{year}</SelectValue>
                  </SelectTrigger>
                  <SelectContent className="rounded-xl border-slate-100 shadow-xl bg-white">
                    {YEARS.map(y => (
                      <SelectItem key={y} value={String(y)}>
                        {y}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Stats Summary ────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3">
          <Card className="bg-white rounded-2xl shadow-sm border border-slate-100">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-extrabold text-indigo-600">{fmtRp(stats.totalApprovedReimburse)}</div>
              <div className="text-[11px] font-semibold text-slate-400 mt-0.5">Total Reimburse Didapatkan</div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl shadow-lg shadow-indigo-200/40 border-none">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-extrabold text-white">{fmtRp(stats.totalApprovedWage)}</div>
              <div className="text-[11px] font-semibold text-indigo-100 mt-0.5">Upah Bersih Disetujui</div>
            </CardContent>
          </Card>
        </div>

        {/* ── Filter Buttons ──────────────────────────────────────────── */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setStatusFilter('all')}
            className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all ${statusFilter === 'all'
              ? 'bg-slate-800 text-white shadow-md'
              : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'
              }`}
          >
            Semua ({activities.length})
          </button>
          <button
            onClick={() => setStatusFilter('pending')}
            className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all ${statusFilter === 'pending'
              ? 'bg-amber-500 text-white shadow-md'
              : 'bg-white text-amber-600 border border-amber-200 hover:bg-amber-50'
              }`}
          >
            Menunggu ({stats.pending})
          </button>
          <button
            onClick={() => setStatusFilter('approved')}
            className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all ${statusFilter === 'approved'
              ? 'bg-emerald-500 text-white shadow-md'
              : 'bg-white text-emerald-600 border border-emerald-200 hover:bg-emerald-50'
              }`}
          >
            Disetujui ({stats.approved})
          </button>
          <button
            onClick={() => setStatusFilter('declined')}
            className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all ${statusFilter === 'declined'
              ? 'bg-rose-500 text-white shadow-md'
              : 'bg-white text-rose-600 border border-rose-200 hover:bg-rose-50'
              }`}
          >
            Ditolak ({stats.declined})
          </button>
        </div>

        {/* ── Journey History List ────────────────────────────────────── */}
        {loading ? (
          <div className="py-16 flex flex-col items-center text-slate-400">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mb-3" />
            <span className="text-sm font-medium animate-pulse">Memuat riwayat perjalanan...</span>
          </div>
        ) : filteredActivities.length === 0 ? (
          <Card className="bg-white rounded-2xl shadow-sm border border-slate-100">
            <CardContent className="py-16 flex flex-col items-center text-center">
              <div className="w-16 h-16 rounded-2xl bg-slate-50 flex items-center justify-center mb-4">
                <Compass className="w-8 h-8 text-slate-300" />
              </div>
              <h3 className="text-base font-bold text-slate-700">Belum Ada Riwayat Perjalanan</h3>
              <p className="text-xs text-slate-400 max-w-xs mt-1.5 leading-relaxed">
                {statusFilter !== 'all'
                  ? `Tidak ada riwayat perjalanan berstatus "${getStatusConfig(statusFilter).label}" pada periode ini.`
                  : 'Perjalanan dinas yang Anda ambil dan laporkan akan muncul di sini.'
                }
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2.5">
            {filteredActivities.map((activity) => {
              const sc = getStatusConfig(activity.status);
              const reimburseDelta = getActivityReimburseDelta(activity);

              return (
                <Card key={activity.id} className="bg-white rounded-2xl shadow-sm border border-slate-200/60 overflow-hidden hover:border-slate-300 transition-all animate-in fade-in duration-150">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-2.5 h-2.5 rounded-full ${sc.dotClass}`} />
                        <span className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded-md ${sc.bgClass || ''} ${sc.textClass || ''} border ${sc.borderClass || ''}`}>
                          {sc.label}
                        </span>
                      </div>
                      <span className="text-[10px] font-bold text-slate-400 bg-slate-50 border border-slate-100 px-1.5 py-0.5 rounded-md">
                        {activity.vehicleType || 'Kendaraan'}
                      </span>
                    </div>

                    <div>
                      <h4 className="text-xs sm:text-sm font-extrabold text-slate-800 leading-snug">
                        {activity.activityName.split(' (')[0]}
                      </h4>
                      {activity.activityName.includes(' (') && (
                        <div className="flex items-center gap-1 mt-1.5 text-[10px] text-slate-500 font-semibold bg-slate-50/60 p-2 rounded-lg border border-slate-100">
                          <Compass className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                          <span className="truncate flex-1 text-slate-700 font-extrabold">
                            {activity.activityName.split(' (')[1].replace(')', '')}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center gap-2.5 mt-2 text-[10px] text-slate-400 font-bold">
                        <span className="flex items-center gap-1">📅 {activity.activityDate}</span>
                        <span>•</span>
                        <span className="flex items-center gap-1">⏱️ {activity.timeStart} – {activity.timeEnd}</span>
                      </div>
                    </div>

                    {activity.status === 'declined' && activity.declineReason && (
                      <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-100 text-xs">
                        <span className="text-[9px] font-bold text-rose-500 uppercase block mb-0.5">Alasan Penolakan:</span>
                        <p className="text-rose-700 font-semibold">{activity.declineReason}</p>
                      </div>
                    )}

                    <div className="flex justify-between items-center pt-2.5 border-t border-slate-100">
                      <div className="flex gap-4">
                        <div>
                          <span className="block text-[8px] text-slate-400 font-extrabold uppercase leading-tight">Total Reimburse (Delta)</span>
                          <span className="text-xs font-black text-blue-600">{fmtRp(reimburseDelta)}</span>
                        </div>
                        <div>
                          <span className="block text-[8px] text-slate-400 font-extrabold uppercase leading-tight">Upah Bersih</span>
                          <span className="text-xs font-black text-emerald-600">
                            {fmtRp(
                              activity.status === 'approved'
                                ? (activity.upahBersih || 0)
                                : (activity.submittedFeeEstimate ?? activity.baseDriverWage ?? calculateDriverNetWage({
                                    distanceKm: activity.distanceKm || 0,
                                    travelTimeHours: activity.routeDurationHours ?? activity.durationHours ?? 0,
                                    elapsedDurationHours: activity.durationHours || 0,
                                    nightCount: activity.nightCount || 0,
                                  }))
                            )}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {(activity.status === 'pending' || activity.status === 'declined') && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setTargetDeleteActivity(activity)}
                              className="rounded-lg border-rose-200 text-rose-600 hover:bg-rose-50 font-bold text-xs h-7 px-2.5 gap-1 cursor-pointer"
                              title="Hapus Laporan Perjalanan"
                            >
                              <Trash2 className="w-3 h-3 text-rose-500" />
                              <span>Hapus</span>
                            </Button>

                            <Link href={activity.journeyId ? `/employee/activities/journey-report?id=${activity.journeyId}&editReportId=${activity.id}` : `/employee/activities?editReportId=${activity.id}`}>
                              <Button
                                variant="outline"
                                size="sm"
                                className="rounded-lg border-indigo-200 text-indigo-700 hover:bg-indigo-50 font-bold text-xs h-7 px-2.5 gap-1 cursor-pointer"
                              >
                                <Pencil className="w-3 h-3 text-indigo-600" />
                                <span>Edit</span>
                              </Button>
                            </Link>
                          </>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Delete Confirmation Dialog ─────────────────────────── */}
      <Dialog open={Boolean(targetDeleteActivity)} onOpenChange={(open) => !open && setTargetDeleteActivity(null)}>
        <DialogContent className="rounded-3xl max-w-sm p-6 bg-white shadow-2xl border-none">
          <DialogHeader className="space-y-2">
            <DialogTitle className="text-base font-extrabold text-slate-900 flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-rose-500" />
              Hapus Laporan Perjalanan?
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 leading-relaxed">
              Laporan perjalanan <strong className="text-slate-800">{targetDeleteActivity?.activityName}</strong> akan dihapus secara permanen dari sistem.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex items-center gap-2 mt-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setTargetDeleteActivity(null)}
              disabled={isDeleting}
              className="flex-1 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 cursor-pointer"
            >
              Batal
            </Button>
            <Button
              type="button"
              onClick={handleConfirmDeleteActivity}
              disabled={isDeleting}
              className="flex-1 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white gap-1.5 cursor-pointer"
            >
              {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Ya, Hapus'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function DriverHistoryPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
      </div>
    }>
      <DriverHistoryContent />
    </Suspense>
  );
}
