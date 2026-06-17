"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ArrowLeft,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  AlertTriangle,
  Search,
  Filter,
  Banknote,
  Users,
  CalendarDays,
  ClipboardCheck,
  ThumbsUp,
  ThumbsDown,
  RefreshCw,
  ChevronRight,
} from 'lucide-react';
import { db } from '@/lib/firebase';
import {
  collection,
  getDocs,
  doc,
  updateDoc,
  query,
  where,
  serverTimestamp,
  writeBatch,
  onSnapshot,
} from 'firebase/firestore';
import { MONTHS_ID } from '@/utils/rekapConfig';

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
      return { label: 'Disetujui', bgClass: 'bg-emerald-50', textClass: 'text-emerald-700', borderClass: 'border-emerald-200', dotClass: 'bg-emerald-500' };
    case 'declined':
      return { label: 'Ditolak', bgClass: 'bg-rose-50', textClass: 'text-rose-700', borderClass: 'border-rose-200', dotClass: 'bg-rose-500' };
    default:
      return { label: 'Menunggu', bgClass: 'bg-amber-50', textClass: 'text-amber-700', borderClass: 'border-amber-200', dotClass: 'bg-amber-500' };
  }
}

const YEARS = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);
const CLEANING_CATEGORIES = ['KEBERSIHAN', 'KEBERSIHAN_IC'];

// ─── Component ───────────────────────────────────────────────────────────────

export default function ActivityReviewPage() {
  const router = useRouter();
  const { profile, user } = useAuth();

  // ── Period ──
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const periodToken = useMemo(() => `${year}-${String(month).padStart(2, '0')}`, [year, month]);

  // ── Data ──
  const [activities, setActivities] = useState<ActivityReport[]>([]);
  const [loading, setLoading] = useState(true);

  // ── UI State ──
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'declined'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // ── Row Fees (Inline input values) ──
  const [rowFees, setRowFees] = useState<Record<string, string>>({});

  // ── Decline Modal ──
  const [declineTarget, setDeclineTarget] = useState<ActivityReport | null>(null);
  const [declineReason, setDeclineReason] = useState('');

  // ── Action Loading ──
  const [actionLoading, setActionLoading] = useState(false);
  const isActionLoadingRef = React.useRef(false);

  // ── Notifications ──
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (successMsg) { const t = setTimeout(() => setSuccessMsg(null), 5000); return () => clearTimeout(t); }
  }, [successMsg]);
  useEffect(() => {
    if (errorMsg) { const t = setTimeout(() => setErrorMsg(null), 7000); return () => clearTimeout(t); }
  }, [errorMsg]);

  // ── Access Control ──
  const hasAccess = useMemo(() => {
    if (!profile) return false;
    if (profile.role === 'super_admin') return true;
    if (profile.role === 'satker_head') {
      return profile.permittedCategories?.some(c => CLEANING_CATEGORIES.includes(c)) ?? false;
    }
    return false;
  }, [profile]);

  useEffect(() => {
    if (profile && !hasAccess) {
      router.replace('/dashboard/payroll/uraian');
    }
  }, [profile, hasAccess, router]);

  // ── Allowed Categories ──
  const allowedCategories = useMemo(() => {
    if (!profile) return [];
    if (profile.role === 'super_admin') return CLEANING_CATEGORIES;
    return CLEANING_CATEGORIES.filter(c => profile.permittedCategories?.includes(c));
  }, [profile]);



  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // ── Fetch Activities (dummy/refresh trigger for backward compatibility) ──
  const fetchActivities = useCallback(() => {
    setRefreshTrigger(prev => prev + 1);
  }, []);

  // ── Real-time Listener for Activity Reports ──
  useEffect(() => {
    if (!hasAccess) return;
    setLoading(true);
    setSelectedIds(new Set());

    let q;
    if (profile?.role === 'super_admin') {
      q = query(
        collection(db, 'ActivityReports'),
        where('period', '==', periodToken),
      );
    } else {
      if (allowedCategories.length === 0) {
        setActivities([]);
        setLoading(false);
        return;
      }
      q = query(
        collection(db, 'ActivityReports'),
        where('period', '==', periodToken),
        where('jobCategory', 'in', allowedCategories),
      );
    }

    const unsubscribe = onSnapshot(q, (snap) => {
      const list: ActivityReport[] = snap.docs.map(d => ({
        id: d.id,
        ...d.data(),
      } as ActivityReport));

      // Sort by employee name, then date, then time
      list.sort((a, b) => {
        const nameCmp = a.employeeName.localeCompare(b.employeeName);
        if (nameCmp !== 0) return nameCmp;
        const dateCmp = a.activityDate.localeCompare(b.activityDate);
        if (dateCmp !== 0) return dateCmp;
        return a.timeStart.localeCompare(b.timeStart);
      });

      // Prefill pending activities with default calculated fees, merging with existing inputs
      setRowFees(prev => {
        const newFees = { ...prev };
        list.forEach(a => {
          if (a.status === 'pending') {
            if (newFees[a.id] === undefined) {
              const defaultFee = calculateDefaultFee(a.timeStart, a.timeEnd, a.activityType, a.activityName);
              newFees[a.id] = String(defaultFee);
            }
          } else {
            delete newFees[a.id];
          }
        });
        return newFees;
      });

      setActivities(list);
      setLoading(false);
    }, (err) => {
      console.error('Error listening to activity reports:', err);
      setErrorMsg('Gagal memuat data laporan kegiatan.');
      setLoading(false);
    });

    return () => unsubscribe();
  }, [hasAccess, periodToken, profile?.role, allowedCategories, refreshTrigger]);

  // ── Filtered activities ──
  const filteredActivities = useMemo(() => {
    let filtered = activities;
    if (statusFilter !== 'all') {
      filtered = filtered.filter(a => a.status === statusFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(a =>
        a.employeeName.toLowerCase().includes(q) ||
        a.activityName.toLowerCase().includes(q)
      );
    }
    return filtered;
  }, [activities, statusFilter, searchQuery]);

  // ── Stats ──
  const stats = useMemo(() => {
    const pending = activities.filter(a => a.status === 'pending').length;
    const approved = activities.filter(a => a.status === 'approved');
    const declined = activities.filter(a => a.status === 'declined').length;
    const totalFee = approved.reduce((sum, a) => sum + (a.fee || 0), 0);
    return { total: activities.length, pending, approved: approved.length, declined, totalFee };
  }, [activities]);

  // ── Employee Summary ──
  const employeeSummary = useMemo(() => {
    const map = new Map<string, { name: string; approved: number; totalFee: number; pending: number }>();
    activities.forEach(a => {
      const existing = map.get(a.employeeId) || { name: a.employeeName, approved: 0, totalFee: 0, pending: 0 };
      if (a.status === 'approved') {
        existing.approved += 1;
        existing.totalFee += a.fee || 0;
      }
      if (a.status === 'pending') {
        existing.pending += 1;
      }
      existing.name = a.employeeName;
      map.set(a.employeeId, existing);
    });
    return Array.from(map.entries()).sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [activities]);

  // ── Selection Handlers ──
  const pendingInView = filteredActivities.filter(a => a.status === 'pending');
  const allPendingSelected = pendingInView.length > 0 && pendingInView.every(a => selectedIds.has(a.id));

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allPendingSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pendingInView.map(a => a.id)));
    }
  };

  // ── Approve Row Handler (Inline Approval) ──
  const handleApproveRow = async (activity: ActivityReport, feeStr: string) => {
    if (isActionLoadingRef.current || !user) return;
    const feeVal = parseInt(feeStr.replace(/\D/g, ''), 10);
    if (isNaN(feeVal) || feeVal <= 0) {
      setErrorMsg('Masukkan nilai fee yang valid (lebih dari 0).');
      return;
    }

    isActionLoadingRef.current = true;
    setActionLoading(true);
    try {
      await updateDoc(doc(db, 'ActivityReports', activity.id), {
        status: 'approved',
        fee: feeVal,
        reviewedAt: serverTimestamp(),
        reviewedBy: user.uid,
      });
      setSuccessMsg(`Kegiatan "${activity.activityName}" oleh ${activity.employeeName} berhasil disetujui dengan fee ${fmtRp(feeVal)}.`);

      // Clear local state for this row
      setRowFees(prev => {
        const next = { ...prev };
        delete next[activity.id];
        return next;
      });

      fetchActivities();
    } catch (err) {
      console.error('Error approving activity:', err);
      setErrorMsg('Gagal menyetujui kegiatan.');
    } finally {
      isActionLoadingRef.current = false;
      setActionLoading(false);
    }
  };

  // ── Decline Handler ──
  const handleDecline = async () => {
    if (isActionLoadingRef.current || !declineTarget || !user) return;

    isActionLoadingRef.current = true;
    setActionLoading(true);
    try {
      await updateDoc(doc(db, 'ActivityReports', declineTarget.id), {
        status: 'declined',
        fee: 0,
        declineReason: declineReason.trim() || '',
        reviewedAt: serverTimestamp(),
        reviewedBy: user.uid,
      });
      setSuccessMsg(`Kegiatan "${declineTarget.activityName}" oleh ${declineTarget.employeeName} telah ditolak.`);
      setDeclineTarget(null);
      setDeclineReason('');
      fetchActivities();
    } catch (err) {
      console.error('Error declining activity:', err);
      setErrorMsg('Gagal menolak kegiatan.');
    } finally {
      isActionLoadingRef.current = false;
      setActionLoading(false);
    }
  };

  // ── Bulk Approve Individual Handler ──
  const handleBulkApproveIndividual = async () => {
    if (isActionLoadingRef.current || !user || selectedIds.size === 0) return;
    if (!confirm(`Apakah Anda yakin ingin menyetujui ${selectedIds.size} kegiatan yang dipilih?`)) return;

    // Validate that all selected activities have a valid fee input
    const invalidList: { name: string; employee: string }[] = [];
    const updates: { id: string; fee: number }[] = [];

    selectedIds.forEach(id => {
      const rawVal = rowFees[id] || '';
      const feeVal = parseInt(rawVal.replace(/\D/g, ''), 10);
      if (isNaN(feeVal) || feeVal <= 0) {
        const act = activities.find(a => a.id === id);
        if (act) {
          invalidList.push({ name: act.activityName, employee: act.employeeName });
        }
      } else {
        updates.push({ id, fee: feeVal });
      }
    });

    if (invalidList.length > 0) {
      const names = invalidList.map(item => `"${item.name}" oleh ${item.employee}`).join(', ');
      setErrorMsg(`Fee tidak valid untuk kegiatan: ${names}. Pastikan semua fee diisi dengan angka lebih dari 0.`);
      return;
    }

    isActionLoadingRef.current = true;
    setActionLoading(true);
    try {
      const batch = writeBatch(db);
      updates.forEach(upd => {
        const ref = doc(db, 'ActivityReports', upd.id);
        batch.update(ref, {
          status: 'approved',
          fee: upd.fee,
          reviewedAt: serverTimestamp(),
          reviewedBy: user.uid,
        });
      });
      await batch.commit();
      setSuccessMsg(`${updates.length} kegiatan berhasil disetujui.`);
      
      // Clear row fees for approved activities
      setRowFees(prev => {
        const next = { ...prev };
        selectedIds.forEach(id => delete next[id]);
        return next;
      });
      setSelectedIds(new Set());
      fetchActivities();
    } catch (err) {
      console.error('Error bulk approving activities:', err);
      setErrorMsg('Gagal menyetujui kegiatan secara massal.');
    } finally {
      isActionLoadingRef.current = false;
      setActionLoading(false);
    }
  };

  // ── Bulk Decline Handler ──
  const handleBulkDecline = async () => {
    if (isActionLoadingRef.current || !user || selectedIds.size === 0) return;
    if (!confirm(`Apakah Anda yakin ingin menolak ${selectedIds.size} kegiatan yang dipilih?`)) return;

    isActionLoadingRef.current = true;
    setActionLoading(true);
    try {
      const batch = writeBatch(db);
      selectedIds.forEach(id => {
        const ref = doc(db, 'ActivityReports', id);
        batch.update(ref, {
          status: 'declined',
          fee: 0,
          declineReason: 'Ditolak secara massal oleh Kepala SatKer.',
          reviewedAt: serverTimestamp(),
          reviewedBy: user.uid,
        });
      });
      await batch.commit();
      setSuccessMsg(`${selectedIds.size} kegiatan berhasil ditolak.`);
      setSelectedIds(new Set());
      fetchActivities();
    } catch (err) {
      console.error('Error bulk declining:', err);
      setErrorMsg('Gagal menolak kegiatan secara massal.');
    } finally {
      isActionLoadingRef.current = false;
      setActionLoading(false);
    }
  };

  if (!profile || !hasAccess) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50/40 via-white to-purple-50/40 p-6 lg:p-8 font-sans selection:bg-indigo-100 text-slate-800">
      <div className="max-w-[1600px] mx-auto space-y-6">

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <Link href={`/dashboard/payroll/uraian?month=${month}&year=${year}`}>
              <Button variant="ghost" className="group -ml-2 mb-2 text-slate-500 hover:text-indigo-600 transition-colors">
                <ArrowLeft className="w-4 h-4 mr-2 group-hover:-translate-x-1 transition-transform" />
                Kembali ke Uraian
              </Button>
            </Link>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-teal-50 flex items-center justify-center text-teal-600 shadow-inner">
                <ClipboardCheck className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-2xl lg:text-3xl font-bold text-slate-900 tracking-tight">Review Laporan Kegiatan</h1>
                <p className="text-slate-500 text-sm">Tinjau, setujui, atau tolak kegiatan yang dilaporkan oleh karyawan kebersihan.</p>
              </div>
            </div>
          </div>
          <Button
            variant="outline"
            onClick={fetchActivities}
            disabled={loading}
            className="rounded-xl border-slate-200 bg-white text-slate-600 hover:bg-slate-50 shadow-sm"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Segarkan
          </Button>
        </div>

        {/* ── Notifications ──────────────────────────────────────────── */}
        {successMsg && (
          <div className="flex items-center gap-2.5 px-4 py-3.5 rounded-2xl text-sm font-semibold bg-emerald-50 text-emerald-800 border border-emerald-100 shadow-sm animate-in fade-in slide-in-from-top-2 duration-300">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}
        {errorMsg && (
          <div className="flex items-center gap-2.5 px-4 py-3.5 rounded-2xl text-sm font-semibold bg-rose-50 text-rose-800 border border-rose-100 shadow-sm animate-in fade-in slide-in-from-top-2 duration-300">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* ── Filters Row ────────────────────────────────────────────── */}
        <Card className="bg-white rounded-2xl shadow-sm border-none">
          <CardContent className="p-4">
            <div className="flex flex-col md:flex-row md:items-center gap-3">
              {/* Period */}
              <div className="flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-slate-400 shrink-0" />
                <Select value={String(month)} onValueChange={(v) => v && setMonth(parseInt(v))}>
                  <SelectTrigger className="w-36 bg-slate-50 border-slate-200 rounded-xl text-sm font-bold text-slate-700 h-9">
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
                  <SelectTrigger className="w-24 bg-slate-50 border-slate-200 rounded-xl text-sm font-bold text-slate-700 h-9">
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



              {/* Search */}
              <div className="relative flex-1 md:max-w-xs md:ml-auto">
                <Search className="absolute left-3.5 top-2.5 w-4 h-4 text-slate-400" />
                <Input
                  type="text"
                  placeholder="Cari nama pegawai / kegiatan..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 rounded-xl border-slate-200 focus:border-indigo-400 focus:ring-indigo-400/20 text-sm bg-slate-50/50"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Stats Cards ────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <Card className="bg-white rounded-2xl shadow-sm border-none">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-extrabold text-slate-700">{stats.total}</div>
              <div className="text-[11px] font-semibold text-slate-400">Total Laporan</div>
            </CardContent>
          </Card>
          <Card className="bg-white rounded-2xl shadow-sm border-none">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-extrabold text-amber-500">{stats.pending}</div>
              <div className="text-[11px] font-semibold text-slate-400">Menunggu</div>
            </CardContent>
          </Card>
          <Card className="bg-white rounded-2xl shadow-sm border-none">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-extrabold text-emerald-500">{stats.approved}</div>
              <div className="text-[11px] font-semibold text-slate-400">Disetujui</div>
            </CardContent>
          </Card>
          <Card className="bg-white rounded-2xl shadow-sm border-none">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-extrabold text-rose-500">{stats.declined}</div>
              <div className="text-[11px] font-semibold text-slate-400">Ditolak</div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-teal-500 to-cyan-600 rounded-2xl shadow-lg shadow-teal-200/30 border-none col-span-2 lg:col-span-1">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-extrabold text-white">{fmtRp(stats.totalFee)}</div>
              <div className="text-[11px] font-semibold text-teal-100">Total Fee Disetujui</div>
            </CardContent>
          </Card>
        </div>

        {/* ── Status Filter Tabs ──────────────────────────────────────── */}
        <div className="flex items-center gap-2">
          {(['all', 'pending', 'approved', 'declined'] as const).map(st => {
            const labels: Record<string, string> = { all: 'Semua', pending: 'Menunggu', approved: 'Disetujui', declined: 'Ditolak' };
            const counts: Record<string, number> = { all: stats.total, pending: stats.pending, approved: stats.approved, declined: stats.declined };
            const colors: Record<string, string> = {
              all: statusFilter === 'all' ? 'bg-slate-800 text-white shadow-md' : 'bg-white text-slate-500 border border-slate-200',
              pending: statusFilter === 'pending' ? 'bg-amber-500 text-white shadow-md' : 'bg-white text-amber-600 border border-amber-200',
              approved: statusFilter === 'approved' ? 'bg-emerald-500 text-white shadow-md' : 'bg-white text-emerald-600 border border-emerald-200',
              declined: statusFilter === 'declined' ? 'bg-rose-500 text-white shadow-md' : 'bg-white text-rose-600 border border-rose-200',
            };
            return (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${colors[st]}`}
              >
                {labels[st]} ({counts[st]})
              </button>
            );
          })}
        </div>

        {/* ── Bulk Actions Bar ────────────────────────────────────────── */}
        {selectedIds.size > 0 && (
          <Card className="bg-indigo-50 rounded-2xl border border-indigo-100 shadow-sm animate-in fade-in slide-in-from-top-2 duration-200">
            <CardContent className="p-4 flex items-center gap-3 flex-wrap">
              <Badge className="bg-indigo-100 text-indigo-700 border-none font-bold rounded-lg px-3 py-1">
                {selectedIds.size} kegiatan dipilih
              </Badge>
              <div className="flex items-center gap-2 ml-auto">
                <Button
                  onClick={handleBulkApproveIndividual}
                  size="sm"
                  disabled={actionLoading}
                  className="rounded-xl bg-emerald-500 text-white font-bold hover:bg-emerald-600 shadow-sm"
                >
                  <ThumbsUp className="w-3.5 h-3.5 mr-1.5" />
                  Setujui Semua
                </Button>
                <Button
                  onClick={handleBulkDecline}
                  size="sm"
                  variant="outline"
                  disabled={actionLoading}
                  className="rounded-xl border-rose-200 text-rose-600 hover:bg-rose-50 font-bold"
                >
                  <ThumbsDown className="w-3.5 h-3.5 mr-1.5" />
                  Tolak Semua
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Activity Table ─────────────────────────────────────────── */}
        <Card className="bg-white rounded-[24px] shadow-[0_8px_30px_rgb(0,0,0,0.02)] border-none overflow-hidden">
          <CardContent className="p-0">
            {loading ? (
              <div className="p-24 flex flex-col items-center text-slate-400">
                <Loader2 className="w-8 h-8 animate-spin text-teal-500 mb-4" />
                <p className="font-semibold text-sm animate-pulse">Memuat laporan kegiatan...</p>
              </div>
            ) : filteredActivities.length === 0 ? (
              <div className="p-24 flex flex-col items-center text-center text-slate-400">
                <ClipboardCheck className="w-12 h-12 mb-4 opacity-20" />
                <h4 className="text-slate-700 font-bold text-base">Tidak Ada Data</h4>
                <p className="text-xs text-slate-400 max-w-xs mt-1">
                  Belum ada laporan kegiatan untuk periode dan kategori yang dipilih.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-slate-50/60">
                    <TableRow className="border-slate-100">
                      <TableHead className="w-12 pl-4">
                        <Checkbox
                          checked={allPendingSelected}
                          onCheckedChange={toggleSelectAll}
                          className="rounded border-slate-300 data-[state=checked]:bg-indigo-600"
                        />
                      </TableHead>
                      <TableHead className="font-bold text-slate-500">Nama Pegawai</TableHead>
                      <TableHead className="font-bold text-slate-500">Nama Kegiatan</TableHead>
                      <TableHead className="font-bold text-slate-500">Tanggal</TableHead>
                      <TableHead className="font-bold text-slate-500">Waktu</TableHead>
                      <TableHead className="font-bold text-slate-500">Status</TableHead>
                      <TableHead className="font-bold text-slate-500">Fee</TableHead>
                      <TableHead className="font-bold text-slate-500 text-right pr-6">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredActivities.map((activity) => {
                      const sc = getStatusConfig(activity.status);
                      const isSelected = selectedIds.has(activity.id);

                      return (
                        <TableRow
                          key={activity.id}
                          className={`border-slate-50 hover:bg-slate-50/40 transition-colors ${isSelected ? 'bg-indigo-50/30' : ''}`}
                        >
                          <TableCell className="pl-4">
                            {activity.status === 'pending' && (
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={() => toggleSelect(activity.id)}
                                className="rounded border-slate-300 data-[state=checked]:bg-indigo-600"
                              />
                            )}
                          </TableCell>
                          <TableCell className="font-bold text-slate-800 text-sm py-3.5">
                            {activity.employeeName}
                          </TableCell>
                          <TableCell className="text-sm text-slate-700 font-medium max-w-[200px]">
                            <span className="truncate block">{activity.activityName}</span>
                          </TableCell>
                          <TableCell className="text-sm text-slate-600 font-medium whitespace-nowrap">
                            {activity.activityDate}
                          </TableCell>
                          <TableCell className="text-sm text-slate-600 font-medium whitespace-nowrap">
                            {activity.timeStart} – {activity.timeEnd}
                          </TableCell>
                          <TableCell>
                            <Badge className={`${sc.bgClass} ${sc.textClass} border ${sc.borderClass} text-[10px] font-bold rounded-lg px-2 py-0.5`}>
                              {sc.label}
                            </Badge>
                            {activity.status === 'declined' && activity.declineReason && (
                              <p className="text-[10px] text-rose-400 mt-1 max-w-[150px] truncate" title={activity.declineReason}>
                                {activity.declineReason}
                              </p>
                            )}
                          </TableCell>
                          <TableCell className="text-sm font-bold text-slate-700 whitespace-nowrap">
                            {activity.status === 'approved' && activity.fee > 0
                              ? fmtRp(activity.fee)
                              : activity.status === 'pending' ? (
                                <div className="flex">
                                  <Input
                                    type="text"
                                    placeholder="-"
                                    value={rowFees[activity.id] || ''}
                                    onChange={(e) => {
                                      const val = e.target.value.replace(/\D/g, '');
                                      setRowFees(prev => ({ ...prev, [activity.id]: val }));
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        handleApproveRow(activity, rowFees[activity.id] || '');
                                      }
                                    }}
                                    className="w-36 h-8 text-center font-bold text-sm bg-slate-50 border-slate-200 focus:border-emerald-400 focus:ring-emerald-400/20 rounded-xl px-3"
                                    disabled={actionLoading}
                                  />
                                </div>
                              ) : (
                                <span className="text-slate-300">—</span>
                              )
                            }
                          </TableCell>
                          <TableCell className="text-right pr-6">
                            {activity.status === 'pending' && (
                              <div className="flex justify-end gap-1.5">
                                <Button
                                  size="sm"
                                  disabled={actionLoading}
                                  onClick={() => handleApproveRow(activity, rowFees[activity.id] || '')}
                                  className="h-7 px-2.5 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-bold text-[11px] border border-emerald-200 cursor-pointer"
                                >
                                  <ThumbsUp className="w-3 h-3 mr-1" />
                                  Setujui
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={actionLoading}
                                  onClick={() => { setDeclineTarget(activity); setDeclineReason(''); }}
                                  className="h-7 px-2.5 rounded-lg text-rose-500 hover:bg-rose-50 font-bold text-[11px] cursor-pointer"
                                >
                                  <ThumbsDown className="w-3 h-3 mr-1" />
                                  Tolak
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Employee Summary ────────────────────────────────────────── */}
        {employeeSummary.length > 0 && (
          <Card className="bg-white rounded-[24px] shadow-sm border-none">
            <CardHeader className="p-6 pb-4">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <Users className="w-4 h-4 text-teal-500" />
                Ringkasan Per Karyawan
              </CardTitle>
              <CardDescription className="text-xs">Total fee disetujui per karyawan untuk periode {MONTHS_ID[month - 1]} {year}.</CardDescription>
            </CardHeader>
            <CardContent className="px-6 pb-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {employeeSummary.map(([empId, data]) => (
                  <div key={empId} className="flex items-center gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-100">
                    <div className="w-9 h-9 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center font-bold text-sm shrink-0">
                      {data.name.substring(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-slate-800 truncate">{data.name}</div>
                      <div className="text-[11px] text-slate-400">
                        {data.approved} disetujui · {data.pending} menunggu
                      </div>
                    </div>
                    <div className="text-sm font-bold text-teal-600 whitespace-nowrap">{fmtRp(data.totalFee)}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>


      {/* ── Decline Modal ──────────────────────────────────────────────── */}
      <Dialog open={declineTarget !== null} onOpenChange={(open) => { if (!open) setDeclineTarget(null); }}>
        <DialogContent className="sm:max-w-md rounded-3xl border-none shadow-2xl bg-white p-6">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold flex items-center gap-2 text-slate-900">
              <ThumbsDown className="w-5 h-5 text-rose-500" />
              Tolak Kegiatan
            </DialogTitle>
            <DialogDescription className="text-slate-500">
              Tolak kegiatan <strong>"{declineTarget?.activityName}"</strong> oleh <strong>{declineTarget?.employeeName}</strong>.
              Karyawan dapat mengedit dan mengajukan ulang kegiatan yang ditolak.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400 font-semibold">Tanggal</span>
                <span className="font-bold text-slate-700">{declineTarget?.activityDate}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400 font-semibold">Waktu</span>
                <span className="font-bold text-slate-700">{declineTarget?.timeStart} – {declineTarget?.timeEnd}</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-500 uppercase">Alasan Penolakan (Opsional)</Label>
              <Input
                type="text"
                placeholder="Contoh: Kegiatan tidak sesuai jadwal kerja"
                value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value)}
                className="rounded-xl border-slate-200 focus:border-rose-400 focus:ring-rose-400/20 text-sm"
                autoFocus
              />
            </div>
          </div>
          <DialogFooter className="gap-3">
            <Button variant="ghost" onClick={() => setDeclineTarget(null)} className="rounded-xl font-bold text-slate-500">
              Batal
            </Button>
            <Button
              onClick={handleDecline}
              disabled={actionLoading}
              className="rounded-xl bg-rose-500 text-white font-bold hover:bg-rose-600 shadow-md shadow-rose-100"
            >
              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <XCircle className="w-4 h-4 mr-2" />}
              Konfirmasi Tolak
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
