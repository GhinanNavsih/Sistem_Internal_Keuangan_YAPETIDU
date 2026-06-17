"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/lib/AuthContext';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Loader2,
  LogOut,
  Plus,
  Clock,
  CalendarDays,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ClipboardList,
  Pencil,
  Send,
  Banknote,
  ChevronDown,
  ChevronUp,
  Timer,
  Sparkles,
} from 'lucide-react';
import { db } from '@/lib/firebase';
import {
  collection,
  getDocs,
  addDoc,
  setDoc,
  doc,
  updateDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
  Timestamp,
  onSnapshot,
} from 'firebase/firestore';
import { MONTHS_ID } from '@/utils/rekapConfig';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ActivityReport {
  id: string;
  employeeId: string;
  employeeName: string;
  jobCategory: string;
  period: string;
  activityName: string;
  activityType?: 'Piket' | 'Standby' | 'Ro\'an' | 'Lainnya';
  activityDate: string;
  timeStart: string;
  timeEnd: string;
  status: 'pending' | 'approved' | 'declined';
  fee: number;
  declineReason?: string;
  submittedAt?: any;
  reviewedAt?: any;
  reviewedBy?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtRp(val: number): string {
  return 'Rp' + val.toLocaleString('id-ID');
}

function calculateDefaultFee(timeStart: string, timeEnd: string, activityType?: string, activityName?: string): number {
  if (!timeStart || !timeEnd) return 0;
  
  // Parse HH:MM format
  const [sh, sm] = timeStart.split(':').map(Number);
  const [eh, em] = timeEnd.split(':').map(Number);
  
  if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) return 0;
  
  const minutes = (eh * 60 + em) - (sh * 60 + sm);
  if (minutes < 0) return 0;
  
  const halfHours = Math.round(minutes / 30);
  
  // Determine activity type
  let type = activityType;
  if (!type && activityName) {
    const nameLower = activityName.toLowerCase();
    if (nameLower === 'piket' || nameLower.startsWith('piket ')) {
      type = 'Piket';
    } else if (nameLower === 'standby' || nameLower.startsWith('standby ')) {
      type = 'Standby';
    } else if (nameLower === 'ro\'an' || nameLower === 'roan' || nameLower.startsWith('ro\'an ') || nameLower.startsWith('roan ')) {
      type = 'Ro\'an';
    } else {
      type = 'Lainnya';
    }
  }
  
  if (!type) {
    type = 'Lainnya';
  }
  
  const isPiketOrStandby = type === 'Piket' || type === 'Standby';
  const rate = isPiketOrStandby ? 2000 : 2500;
  
  let fee = halfHours * rate;
  if (halfHours >= 4) {
    fee += 7500;
  }
  
  return fee;
}

function getStatusConfig(status: string) {
  switch (status) {
    case 'approved':
      return {
        label: 'Disetujui',
        icon: CheckCircle2,
        bgClass: 'bg-emerald-50',
        textClass: 'text-emerald-700',
        borderClass: 'border-emerald-200',
        dotClass: 'bg-emerald-500',
      };
    case 'declined':
      return {
        label: 'Ditolak',
        icon: XCircle,
        bgClass: 'bg-rose-50',
        textClass: 'text-rose-700',
        borderClass: 'border-rose-200',
        dotClass: 'bg-rose-500',
      };
    default:
      return {
        label: 'Menunggu',
        icon: Clock,
        bgClass: 'bg-amber-50',
        textClass: 'text-amber-700',
        borderClass: 'border-amber-200',
        dotClass: 'bg-amber-500',
      };
  }
}

function getTodayISO(): string {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// ─── Component ───────────────────────────────────────────────────────────────

const YEARS = Array.from({ length: 3 }, (_, i) => new Date().getFullYear() - i);

export default function EmployeeActivitiesPage() {
  const { profile, logout, user } = useAuth();

  // ── Period ──
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const periodToken = useMemo(() => `${year}-${String(month).padStart(2, '0')}`, [year, month]);

  // ── Activities ──
  const [activities, setActivities] = useState<ActivityReport[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Form state ──
  const [showForm, setShowForm] = useState(false);
  const [editingActivity, setEditingActivity] = useState<ActivityReport | null>(null);
  const [formActivityType, setFormActivityType] = useState<'Piket' | 'Standby' | 'Ro\'an' | 'Lainnya'>('Piket');
  const [formName, setFormName] = useState('Piket');
  const [formCustomName, setFormCustomName] = useState('');
  const [formDate, setFormDate] = useState(getTodayISO());
  const [formTimeStart, setFormTimeStart] = useState('');
  const [formTimeEnd, setFormTimeEnd] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const isSubmittingRef = React.useRef(false);

  // ── Notifications ──
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // ── Filter ──
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'declined'>('all');

  // ── Expandable activity cards ──
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // ── Fetch Activities (dummy/refresh trigger for backward compatibility) ──
  const fetchActivities = useCallback(() => {
    setRefreshTrigger(prev => prev + 1);
  }, []);

  // ── Real-time Listener for Employee Activities ──
  useEffect(() => {
    if (!profile?.linkedEmployeeId) return;
    setLoading(true);

    const q = query(
      collection(db, 'ActivityReports'),
      where('employeeId', '==', profile.linkedEmployeeId),
      where('period', '==', periodToken),
    );

    const unsubscribe = onSnapshot(q, (snap) => {
      const list: ActivityReport[] = snap.docs.map(d => ({
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
      console.error('Error listening to employee activities:', err);
      setMessage({ type: 'error', text: 'Gagal memuat data kegiatan.' });
      setLoading(false);
    });

    return () => unsubscribe();
  }, [profile?.linkedEmployeeId, periodToken, refreshTrigger]);

  // ── Filtered activities ──
  const filteredActivities = useMemo(() => {
    if (statusFilter === 'all') return activities;
    return activities.filter(a => a.status === statusFilter);
  }, [activities, statusFilter]);

  // ── Stats ──
  const stats = useMemo(() => {
    const pending = activities.filter(a => a.status === 'pending').length;
    const approved = activities.filter(a => a.status === 'approved');
    const declined = activities.filter(a => a.status === 'declined').length;
    const totalApprovedFee = approved.reduce((sum, a) => sum + (a.fee || 0), 0);
    return { pending, approved: approved.length, declined, totalApprovedFee };
  }, [activities]);

  // ── Form Handlers ──
  const resetForm = () => {
    setFormActivityType('Piket');
    setFormName('Piket');
    setFormCustomName('');
    setFormDate(getTodayISO());
    setFormTimeStart('');
    setFormTimeEnd('');
    setEditingActivity(null);
    setShowForm(false);
  };

  const openEditForm = (activity: ActivityReport) => {
    setEditingActivity(activity);
    const type = activity.activityType || (['Piket', 'Standby', 'Ro\'an'].includes(activity.activityName) ? activity.activityName : 'Lainnya');
    setFormActivityType(type as any);
    if (type === 'Lainnya') {
      setFormCustomName(activity.activityName);
      setFormName(activity.activityName);
    } else {
      setFormName(activity.activityName);
      setFormCustomName('');
    }
    setFormDate(activity.activityDate);
    setFormTimeStart(activity.timeStart);
    setFormTimeEnd(activity.timeEnd);
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.linkedEmployeeId || isSubmittingRef.current) return;

    if (!formName.trim()) {
      setMessage({ type: 'error', text: 'Jenis kegiatan harus diisi.' });
      return;
    }
    if (!formDate) {
      setMessage({ type: 'error', text: 'Tanggal kegiatan harus diisi.' });
      return;
    }
    if (!formTimeStart || !formTimeEnd) {
      setMessage({ type: 'error', text: 'Waktu mulai dan selesai harus diisi.' });
      return;
    }
    if (formTimeEnd <= formTimeStart) {
      setMessage({ type: 'error', text: 'Waktu selesai harus lebih dari waktu mulai.' });
      return;
    }

    isSubmittingRef.current = true;
    setSubmitting(true);
    try {
      if (editingActivity) {
        // Re-submit / edit a declined activity → reset to pending
        await updateDoc(doc(db, 'ActivityReports', editingActivity.id), {
          activityName: formName.trim(),
          activityType: formActivityType,
          activityDate: formDate,
          timeStart: formTimeStart,
          timeEnd: formTimeEnd,
          status: 'pending',
          fee: 0,
          declineReason: '',
          submittedAt: serverTimestamp(),
        });
        setMessage({ type: 'success', text: 'Kegiatan berhasil diperbarui dan diajukan ulang.' });
      } else {
        // New submission
        // Determine the period from the activity date
        const activityPeriod = formDate.substring(0, 7); // "YYYY-MM"

        // Generate unique, identifiable document ID: ACT-[employeeId]-[date]-[4CharRandomSuffix]
        const employeeIdSanitized = (profile.linkedEmployeeId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '');
        const dateSanitized = formDate.replace(/-/g, '');
        const randomSuffix = Array.from({ length: 4 }, () =>
          'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.charAt(Math.floor(Math.random() * 36))
        ).join('');
        const customDocId = `ACT-${employeeIdSanitized}-${dateSanitized}-${randomSuffix}`;

        await setDoc(doc(db, 'ActivityReports', customDocId), {
          employeeId: profile.linkedEmployeeId,
          employeeName: profile.displayName || '',
          jobCategory: profile.permittedCategories?.[0] || '',
          period: activityPeriod,
          activityName: formName.trim(),
          activityType: formActivityType,
          activityDate: formDate,
          timeStart: formTimeStart,
          timeEnd: formTimeEnd,
          status: 'pending',
          fee: 0,
          submittedAt: serverTimestamp(),
        });
        setMessage({ type: 'success', text: 'Kegiatan berhasil dilaporkan.' });
      }

      resetForm();
      fetchActivities();
    } catch (err) {
      console.error('Error submitting activity:', err);
      setMessage({ type: 'error', text: 'Gagal menyimpan kegiatan. Silakan coba lagi.' });
    } finally {
      isSubmittingRef.current = false;
      setSubmitting(false);
    }
  };

  // ── Loading State ──
  if (!profile) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-teal-500 animate-spin" />
      </div>
    );
  }

  if (!profile.linkedEmployeeId) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-teal-50/40 via-white to-cyan-50/40 flex items-center justify-center p-6">
        <Card className="max-w-md w-full rounded-3xl border-none shadow-xl bg-white">
          <CardContent className="p-8 text-center space-y-4">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-rose-50 flex items-center justify-center">
              <AlertCircle className="w-8 h-8 text-rose-500" />
            </div>
            <h2 className="text-xl font-bold text-slate-900">Akun Belum Terhubung</h2>
            <p className="text-sm text-slate-500 leading-relaxed">
              Akun Anda belum dihubungkan dengan data pegawai di sistem. Silakan hubungi administrator BAK untuk konfigurasi akun.
            </p>
            <Button
              onClick={() => logout()}
              variant="outline"
              className="rounded-xl mt-4"
            >
              <LogOut className="w-4 h-4 mr-2" />
              Keluar
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50/40 via-white to-cyan-50/40 font-sans selection:bg-teal-100 text-slate-800">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-30 bg-white/80 backdrop-blur-xl border-b border-slate-100 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center shadow-lg shadow-teal-200/50">
              <ClipboardList className="w-4.5 h-4.5 text-white" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-slate-900 leading-tight">Laporan Kegiatan</h1>
              <p className="text-[11px] text-slate-400 font-medium">{profile.displayName || 'Karyawan'}</p>
            </div>
          </div>
          <Button
            onClick={() => logout()}
            variant="ghost"
            size="sm"
            className="text-slate-400 hover:text-rose-500 rounded-xl h-8 px-2.5"
          >
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-5 space-y-5">

        {/* ── Notifications ────────────────────────────────────────────── */}
        {message && (
          <div className={`flex items-center gap-2.5 px-4 py-3 rounded-2xl text-sm font-semibold shadow-sm animate-in fade-in slide-in-from-top-2 duration-300 ${message.type === 'success'
            ? 'bg-emerald-50 text-emerald-800 border border-emerald-100'
            : 'bg-rose-50 text-rose-800 border border-rose-100'
            }`}>
            {message.type === 'success'
              ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              : <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            }
            <span>{message.text}</span>
          </div>
        )}

        {/* ── Period Selector ──────────────────────────────────────────── */}
        <Card className="bg-white rounded-2xl shadow-sm border-none">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <CalendarDays className="w-4 h-4 text-teal-500 shrink-0" />
              <div className="flex items-center gap-2 flex-1">
                <Select value={String(month)} onValueChange={(v) => v && setMonth(parseInt(v))}>
                  <SelectTrigger className="text-sm font-bold text-slate-700 bg-slate-50 rounded-xl border border-slate-200 h-10 px-3 flex-1">
                    <SelectValue />
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
                    <SelectValue />
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
          <Card className="bg-white rounded-2xl shadow-sm border-none">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-extrabold text-teal-600">{stats.approved + stats.pending + stats.declined}</div>
              <div className="text-[11px] font-semibold text-slate-400 mt-0.5">Total Kegiatan</div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-teal-500 to-cyan-600 rounded-2xl shadow-lg shadow-teal-200/40 border-none">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-extrabold text-white">{fmtRp(stats.totalApprovedFee)}</div>
              <div className="text-[11px] font-semibold text-teal-100 mt-0.5">Total SPJ Disetujui</div>
            </CardContent>
          </Card>
        </div>

        {/* ── Mini Stats Row ──────────────────────────────────────────── */}
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

        {/* ── Activity List ────────────────────────────────────────────── */}
        {loading ? (
          <div className="py-16 flex flex-col items-center text-slate-400">
            <Loader2 className="w-8 h-8 animate-spin text-teal-500 mb-3" />
            <span className="text-sm font-medium animate-pulse">Memuat kegiatan...</span>
          </div>
        ) : filteredActivities.length === 0 ? (
          <Card className="bg-white rounded-2xl shadow-sm border-none">
            <CardContent className="py-16 flex flex-col items-center text-center">
              <div className="w-16 h-16 rounded-2xl bg-slate-50 flex items-center justify-center mb-4">
                <ClipboardList className="w-8 h-8 text-slate-300" />
              </div>
              <h3 className="text-base font-bold text-slate-700">Belum Ada Kegiatan</h3>
              <p className="text-xs text-slate-400 max-w-xs mt-1.5 leading-relaxed">
                {statusFilter !== 'all'
                  ? `Tidak ada kegiatan berstatus "${getStatusConfig(statusFilter).label}" pada periode ini.`
                  : 'Tekan tombol "+" di bawah untuk menambahkan kegiatan baru.'
                }
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2.5">
            {filteredActivities.map((activity) => {
              const sc = getStatusConfig(activity.status);
              const StatusIcon = sc.icon;
              const isExpanded = expandedId === activity.id;
              const canEdit = activity.status === 'declined' || activity.status === 'pending';

              return (
                <Card
                  key={activity.id}
                  className={`bg-white rounded-2xl shadow-sm border-none overflow-hidden transition-all duration-200 ${isExpanded ? 'ring-2 ring-teal-200/60' : ''
                    }`}
                >
                  <CardContent className="p-0">
                    {/* Main row — tap to expand */}
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : activity.id)}
                      className="w-full flex items-center gap-3 p-4 text-left hover:bg-slate-50/50 transition-colors"
                    >
                      {/* Status dot */}
                      <div className={`w-2.5 h-2.5 rounded-full ${sc.dotClass} shrink-0`} />

                      {/* Activity info */}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold text-slate-800 truncate">{activity.activityName}</div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[11px] text-slate-400 font-medium">{activity.activityDate}</span>
                          <span className="text-[11px] text-slate-300">•</span>
                          <span className="text-[11px] text-slate-400 font-medium">{activity.timeStart} – {activity.timeEnd}</span>
                        </div>
                      </div>

                      {/* Status badge */}
                      <Badge className={`${sc.bgClass} ${sc.textClass} border ${sc.borderClass} text-[10px] font-bold rounded-lg px-2 py-0.5 shrink-0`}>
                        {sc.label}
                      </Badge>

                      {/* Chevron */}
                      {isExpanded
                        ? <ChevronUp className="w-4 h-4 text-slate-300 shrink-0" />
                        : <ChevronDown className="w-4 h-4 text-slate-300 shrink-0" />
                      }
                    </button>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div className="px-4 pb-4 pt-1 border-t border-slate-50 space-y-3 animate-in slide-in-from-top-2 duration-200">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <span className="text-[10px] font-bold text-slate-400 uppercase">Tanggal</span>
                            <p className="text-sm font-semibold text-slate-700 mt-0.5">{activity.activityDate}</p>
                          </div>
                          <div>
                            <span className="text-[10px] font-bold text-slate-400 uppercase">Waktu</span>
                            <p className="text-sm font-semibold text-slate-700 mt-0.5">
                              {activity.timeStart} – {activity.timeEnd}
                            </p>
                          </div>
                        </div>

                        {activity.status === 'approved' && activity.fee > 0 && (
                          <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50 border border-emerald-100">
                            <Banknote className="w-4 h-4 text-emerald-600" />
                            <span className="text-sm font-bold text-emerald-700">{fmtRp(activity.fee)}</span>
                          </div>
                        )}

                        {activity.status === 'pending' && (
                          <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200">
                            <Banknote className="w-4 h-4 text-amber-600" />
                            <span className="text-sm font-bold text-amber-700">
                              Estimasi Upah: {fmtRp(calculateDefaultFee(activity.timeStart, activity.timeEnd, activity.activityType, activity.activityName))}
                            </span>
                          </div>
                        )}

                        {activity.status === 'declined' && activity.declineReason && (
                          <div className="p-3 rounded-xl bg-rose-50 border border-rose-100">
                            <span className="text-[10px] font-bold text-rose-400 uppercase block mb-1">Alasan Penolakan</span>
                            <p className="text-sm text-rose-700 font-medium">{activity.declineReason}</p>
                          </div>
                        )}

                        {/* Edit / Re-submit action */}
                        {canEdit && (
                          <Button
                            onClick={() => openEditForm(activity)}
                            variant="outline"
                            size="sm"
                            className="w-full rounded-xl border-teal-200 text-teal-600 hover:bg-teal-50 font-bold text-xs"
                          >
                            <Pencil className="w-3.5 h-3.5 mr-1.5" />
                            {activity.status === 'declined' ? 'Edit & Ajukan Ulang' : 'Edit Kegiatan'}
                          </Button>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Bottom spacer for FAB */}
        <div className="h-20" />
      </div>

      {/* ── Floating Action Button ─────────────────────────────────────── */}
      <button
        onClick={() => {
          resetForm();
          setShowForm(true);
        }}
        className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-600 text-white shadow-xl shadow-teal-300/40 hover:shadow-2xl hover:shadow-teal-300/50 hover:scale-105 active:scale-95 transition-all duration-200 flex items-center justify-center"
      >
        <Plus className="w-6 h-6" />
      </button>

      {/* ── Add / Edit Activity Dialog ─────────────────────────────────── */}
      <Dialog open={showForm} onOpenChange={(open) => { if (!open) resetForm(); }}>
        <DialogContent className="sm:max-w-md max-w-[calc(100%-2rem)] rounded-3xl border-none shadow-2xl bg-white p-0 overflow-hidden">
          <div className="bg-gradient-to-r from-teal-500 to-cyan-600 p-5 pb-4">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold text-white flex items-center gap-2">
                {editingActivity
                  ? <><Pencil className="w-4.5 h-4.5" /> Edit Kegiatan</>
                  : <><Sparkles className="w-4.5 h-4.5" /> Lapor Kegiatan Baru</>
                }
              </DialogTitle>
              <DialogDescription className="text-teal-100 text-xs mt-1">
                {editingActivity
                  ? 'Perbarui detail dan ajukan ulang kegiatan ini.'
                  : 'Masukkan detail kegiatan yang telah Anda selesaikan hari ini.'
                }
              </DialogDescription>
            </DialogHeader>
          </div>

          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            {/* Activity Type Selection */}
            <div className="space-y-1.5">
              <Label htmlFor="activityType" className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Jenis Kegiatan
              </Label>
              <Select
                value={formActivityType}
                onValueChange={(val: any) => {
                  setFormActivityType(val);
                  if (val !== 'Lainnya') {
                    setFormName(val);
                  } else {
                    setFormName(formCustomName || '');
                  }
                }}
                modal={false}
              >
                <SelectTrigger className="w-full text-sm font-bold text-slate-700 bg-white rounded-xl border border-slate-200 h-10 px-3">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-slate-100 shadow-xl bg-white">
                  <SelectItem value="Piket">Piket</SelectItem>
                  <SelectItem value="Standby">Standby</SelectItem>
                  <SelectItem value="Ro'an">Ro'an</SelectItem>
                  <SelectItem value="Lainnya">Lainnya</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Custom Activity Name (shown only if 'Lainnya' is selected) */}
            {formActivityType === 'Lainnya' && (
              <div className="space-y-1.5 animate-in fade-in slide-in-from-top-2 duration-200">
                <Label htmlFor="activityCustomName" className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Jenis Kegiatan Kustom
                </Label>
                <Input
                  id="activityCustomName"
                  placeholder="Contoh: Memindahkan Barang"
                  value={formCustomName}
                  onChange={(e) => {
                    setFormCustomName(e.target.value);
                    setFormName(e.target.value);
                  }}
                  className="rounded-xl border-slate-200 focus:border-teal-400 focus:ring-teal-400/20 text-sm"
                  required
                  autoFocus
                  autoComplete="off"
                />
              </div>
            )}

            {/* Date */}
            <div className="space-y-1.5">
              <Label htmlFor="activityDate" className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Tanggal Kegiatan
              </Label>
              <Input
                id="activityDate"
                type="date"
                value={formDate}
                onChange={(e) => setFormDate(e.target.value)}
                className="rounded-xl border-slate-200 focus:border-teal-400 focus:ring-teal-400/20 text-sm"
                required
              />
            </div>

            {/* Time Range */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="timeStart" className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Waktu Mulai
                </Label>
                <div className="relative">
                  <Timer className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  <Input
                    id="timeStart"
                    type="time"
                    value={formTimeStart}
                    onChange={(e) => setFormTimeStart(e.target.value)}
                    className="pl-9 rounded-xl border-slate-200 focus:border-teal-400 focus:ring-teal-400/20 text-sm"
                    required
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="timeEnd" className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Waktu Selesai
                </Label>
                <div className="relative">
                  <Timer className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  <Input
                    id="timeEnd"
                    type="time"
                    value={formTimeEnd}
                    onChange={(e) => setFormTimeEnd(e.target.value)}
                    className="pl-9 rounded-xl border-slate-200 focus:border-teal-400 focus:ring-teal-400/20 text-sm"
                    required
                  />
                </div>
              </div>
            </div>

            {/* Submit */}
            <div className="flex gap-3 pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={resetForm}
                className="flex-1 rounded-xl font-bold text-slate-500 hover:bg-slate-50"
              >
                Batal
              </Button>
              <Button
                type="submit"
                disabled={submitting}
                className="flex-1 rounded-xl bg-gradient-to-r from-teal-500 to-cyan-600 text-white font-bold shadow-md shadow-teal-200 hover:shadow-lg transition-all"
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <Send className="w-4 h-4 mr-2" />
                )}
                {editingActivity ? 'Ajukan Ulang' : 'Laporkan'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
