"use client";

import React, { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import SatkerPekaryaNavBar from '@/components/SatkerPekaryaNavBar';
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
  Compass,
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
import { syncActivityToPayslip } from '@/utils/payslipSync';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ActivityReport {
  id: string;
  employeeId: string;
  employeeName: string;
  jobCategory: string;
  period: string;
  activityName: string;
  activityType?: 'Piket' | 'Standby' | 'Ro\'an' | 'Lainnya' | 'Buang Sampah';
  activityDate: string;
  timeStart: string;
  timeEnd: string;
  status: 'pending' | 'approved' | 'declined';
  fee: number;
  hasUangMakan?: boolean;
  declineReason?: string;
  submittedAt?: any;
  reviewedAt?: any;
  reviewedBy?: string;
  // SOPIR specific fields
  tripType?: 'Dalam Kota' | 'Luar Kota';
  vehicleType?: 'Mobil Kecil' | 'Bus/Truk';
  isOvernight?: boolean;
  fuelFee?: number;
  tollParkingFee?: number;
  points?: string[];
  distanceKm?: number;
  durationHours?: number;
  journeyId?: string;
  fuelReceiptUrl?: string;
  tollReceiptUrl?: string;
  upahBersih?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isWeekend(dateStr: string): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const day = d.getDay(); // 0 = Sunday, 6 = Saturday
  return day === 0 || day === 6;
}

function calculateSopirDefaultFee(
  tripType?: string,
  vehicleType?: string,
  isOvernight?: boolean,
  activityDate?: string,
  fuelFee?: number,
  tollParkingFee?: number,
  distanceKm?: number,
  durationHours?: number
): number {
  const VEHICLE_RATES: Record<string, number> = {
    'Bis': 850,
    'Elf': 680,
    'Kijang LGX': 567,
    'Innova Hitam': 1000,
    'Innova Matic': 1250,
    'Suzuki': 741,
    'Suzuki XL7': 741,
    'Ndalem': 0,
  };

  let fee = 0;
  
  if (distanceKm && distanceKm > 0) {
    // New Google Maps route journey calculation:
    // PP distance * rate + 20% meal allowance
    const rate = vehicleType === 'Ndalem' ? 0 : (VEHICLE_RATES[vehicleType || 'Suzuki'] || 741);
    const baseCost = distanceKm * 2 * rate;
    fee = vehicleType === 'Ndalem' ? 0 : baseCost * 1.20; // Includes 20% meal allowance
  } else {
    // Legacy fallback (no distance recorded)
    if (vehicleType === 'Bus/Truk' || vehicleType === 'Bis') {
      fee = 50000;
    } else if (vehicleType === 'Ndalem') {
      fee = 0;
    } else {
      fee = 30000;
    }
  }

  // Overnight allowance (+Rp50.000)
  if (isOvernight) {
    fee += 50000;
  }

  // Weekend premium removed

  // Actual reimbursements
  if (fuelFee && fuelFee > 0) {
    fee += fuelFee;
  }
  if (tollParkingFee && tollParkingFee > 0) {
    fee += tollParkingFee;
  }

  return Math.round(fee);
}

function fmtRp(val: number): string {
  return 'Rp' + val.toLocaleString('id-ID');
}

function calculateDefaultFee(
  timeStart: string,
  timeEnd: string,
  activityType?: string,
  activityName?: string,
  jobCategory?: string,
  tripType?: 'Dalam Kota' | 'Luar Kota',
  vehicleType?: 'Mobil Kecil' | 'Bus/Truk',
  isOvernight?: boolean,
  activityDate?: string,
  fuelFee?: number,
  tollParkingFee?: number,
  distanceKm?: number,
  durationHours?: number
): number {
  if (jobCategory === 'SOPIR') {
    return calculateSopirDefaultFee(
      tripType,
      vehicleType,
      isOvernight,
      activityDate,
      fuelFee,
      tollParkingFee,
      distanceKm,
      durationHours
    );
  }

  if (activityType === 'Buang Sampah' || activityName === 'Buang Sampah') {
    return 5000;
  }
  
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
  
  return halfHours * rate;
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
const CLEANING_CATEGORIES = ['KEBERSIHAN', 'KEBERSIHAN_IC', 'TEKNISI', 'SOPIR', 'KEBERSIHAN_PONTI', 'SATPAM', 'PEKARYA', 'PONTI'];

// ─── Component ───────────────────────────────────────────────────────────────

export default function ActivityReviewPage() {
  const router = useRouter();
  const { profile, user } = useAuth();

  // ── Period ──
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());

  // Enforce no future periods
  useEffect(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    if (year > currentYear) {
      setYear(currentYear);
      setMonth(currentMonth);
    } else if (year === currentYear && month > currentMonth) {
      setMonth(currentMonth);
    }
  }, [year, month]);
  const periodToken = useMemo(() => `${year}-${String(month).padStart(2, '0')}`, [year, month]);

  // ── Data ──
  const [activities, setActivities] = useState<ActivityReport[]>([]);
  const [loading, setLoading] = useState(true);

  // ── UI State ──
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'declined'>('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // ── Row Fees (Inline input values) ──
  const [rowFees, setRowFees] = useState<Record<string, string>>({});
  const [rowUangMakan, setRowUangMakan] = useState<Record<string, boolean>>({});

  // ── Decline Modal ──
  const [declineTarget, setDeclineTarget] = useState<ActivityReport | null>(null);
  const [declineReason, setDeclineReason] = useState('');

  // ── Driver (Sopir) Audit Modal State ──
  const [auditActivity, setAuditActivity] = useState<ActivityReport | null>(null);
  const [auditDistanceKm, setAuditDistanceKm] = useState<number>(0);
  const [auditDurationHours, setAuditDurationHours] = useState<number>(0);
  const [auditFuelFee, setAuditFuelFee] = useState<number>(0);
  const [auditTollParkingFee, setAuditTollParkingFee] = useState<number>(0);
  const [auditVehicleType, setAuditVehicleType] = useState<string>('Suzuki XL7');
  const [auditIsOvernight, setAuditIsOvernight] = useState<boolean>(false);

  const handleOpenAuditSopir = (activity: ActivityReport) => {
    setAuditActivity(activity);
    setAuditDistanceKm(activity.distanceKm || 0);
    setAuditDurationHours(activity.durationHours || 0);
    setAuditFuelFee(activity.fuelFee || 0);
    setAuditTollParkingFee(activity.tollParkingFee || 0);
    setAuditVehicleType(activity.vehicleType || 'Suzuki XL7');
    setAuditIsOvernight(!!activity.isOvernight);
  };

  const getVehicleRate = (vType: string) => {
    const VEHICLE_RATES: Record<string, number> = {
      'Bis': 850,
      'Elf': 680,
      'Kijang LGX': 567,
      'Innova Hitam': 1000,
      'Innova Matic': 1250,
      'Suzuki': 741,
      'Suzuki XL7': 741,
      'Ndalem': 0,
    };
    return vType === 'Ndalem' ? 0 : (VEHICLE_RATES[vType] || 741);
  };

  const getMealAllowanceForHours = (hours: number) => {
    if (hours >= 2 && hours <= 6) return 20000;
    if (hours > 6 && hours <= 12) return 40000;
    if (hours > 12) return 60000;
    return 0;
  };

  const auditCalc = useMemo(() => {
    if (!auditActivity) return null;
    const rate = getVehicleRate(auditVehicleType);
    const baselineBBM = Math.ceil(auditDistanceKm * 2 * rate);
    const baselineMeal = auditVehicleType === 'Ndalem' ? 0 : getMealAllowanceForHours(auditDurationHours);
    const totalBaseline = baselineBBM + baselineMeal;
    const deltaFuel = auditVehicleType === 'Ndalem' ? 0 : Math.max(0, auditFuelFee - baselineBBM);
    const actualMeal = auditVehicleType === 'Ndalem' ? 0 : getMealAllowanceForHours(auditDurationHours);
    const componentJarak = Math.ceil(auditDistanceKm * 200);
    const componentWaktu = Math.ceil(auditDurationHours * 5000);
    const premiumWeekend = 0;
    const premiumOvernight = auditIsOvernight ? 50000 : 0;
    const upahBersih = componentJarak + componentWaktu + premiumWeekend + premiumOvernight;
    const fuelComponent = auditVehicleType === 'Ndalem' ? 0 : Math.max(baselineBBM, auditFuelFee);
    const operationalCost = Math.ceil(fuelComponent + actualMeal + auditTollParkingFee);
    
    return {
      rate,
      baselineBBM,
      baselineMeal,
      totalBaseline,
      deltaFuel,
      componentJarak,
      componentWaktu,
      premiumWeekend,
      premiumOvernight,
      upahBersih,
      operationalCost,
    };
  }, [auditActivity, auditDistanceKm, auditDurationHours, auditFuelFee, auditTollParkingFee, auditVehicleType, auditIsOvernight]);

  const handleApproveSopirAudit = async () => {
    if (!auditActivity || !auditCalc || !user) return;
    setActionLoading(true);
    try {
      await updateDoc(doc(db, 'ActivityReports', auditActivity.id), {
        status: 'approved',
        fee: auditCalc.operationalCost,
        upahBersih: auditCalc.upahBersih,
        distanceKm: auditDistanceKm,
        durationHours: auditDurationHours,
        fuelFee: auditFuelFee,
        tollParkingFee: auditTollParkingFee,
        vehicleType: auditVehicleType,
        isOvernight: auditIsOvernight,
        tripType: auditDistanceKm > 50 ? 'Luar Kota' : 'Dalam Kota',
        reviewedAt: serverTimestamp(),
        reviewedBy: user.uid,
      });

      if (auditActivity.journeyId) {
        await updateDoc(doc(db, 'DriverJourneys', auditActivity.journeyId), {
          status: 'completed',
          upahBersih: auditCalc.upahBersih,
          newTotalDistanceKm: auditDistanceKm,
          newTotalDurationHours: auditDurationHours,
          fuelFee: auditFuelFee,
          tollParkingFee: auditTollParkingFee,
          vehicleName: auditVehicleType,
          isOvernight: auditIsOvernight,
        });
      }

      setSuccessMsg(`Laporan perjalanan dinas ${auditActivity.employeeName} berhasil diaudit dan disetujui.`);
      setAuditActivity(null);
      fetchActivities();
      try {
        await syncActivityToPayslip(db, auditActivity.employeeId, auditActivity.period);
      } catch (syncErr) {
        console.error('Error syncing payslip in handleApproveSopirAudit:', syncErr);
      }
    } catch (err) {
      console.error('Error approving driver audit:', err);
      setErrorMsg('Gagal menyetujui laporan perjalanan dinas.');
    } finally {
      setActionLoading(false);
    }
  };

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
    // satker_head: show exactly the categories they have been granted access to
    return (profile.permittedCategories ?? []).filter(c => CLEANING_CATEGORIES.includes(c));
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

      // Sort descending by submittedAt (newest submission first)
      list.sort((a, b) => {
        const getMs = (ts: any): number => {
          if (!ts) return 0;
          if (typeof ts.toMillis === 'function') return ts.toMillis();
          if (typeof ts.seconds === 'number') return ts.seconds * 1000;
          return 0;
        };
        const diff = getMs(b.submittedAt) - getMs(a.submittedAt);
        if (diff !== 0) return diff;
        // Fallback: newer activity date first
        return b.activityDate.localeCompare(a.activityDate);
      });

      // Prefill pending activities with default calculated fees, merging with existing inputs
      setRowFees(prev => {
        const newFees = { ...prev };
        list.forEach(a => {
          if (a.status === 'pending') {
            if (newFees[a.id] === undefined) {
              const defaultFee = calculateDefaultFee(
                a.timeStart,
                a.timeEnd,
                a.activityType,
                a.activityName,
                a.jobCategory,
                a.tripType,
                a.vehicleType,
                a.isOvernight,
                a.activityDate,
                a.fuelFee,
                a.tollParkingFee,
                a.distanceKm,
                a.durationHours
              );
              newFees[a.id] = String(defaultFee);
            }
          } else {
            delete newFees[a.id];
          }
        });
        return newFees;
      });

      setRowUangMakan(prev => {
        const next = { ...prev };
        list.forEach(a => {
          if (a.status !== 'pending') {
            delete next[a.id];
          }
        });
        return next;
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

  const handleToggleUangMakan = (
    activityId: string,
    timeStart: string,
    timeEnd: string,
    activityType?: string,
    activityName?: string
  ) => {
    const isCurrentlyAdded = !!rowUangMakan[activityId];
    const nextAdded = !isCurrentlyAdded;

    // Calculate default base fee (without the 7500)
    const baseFee = calculateDefaultFee(timeStart, timeEnd, activityType, activityName);

    // Update state
    setRowUangMakan(prev => ({ ...prev, [activityId]: nextAdded }));

    // Update fee input
    setRowFees(prev => {
      const currentVal = parseInt((prev[activityId] || '').replace(/\D/g, ''), 10) || baseFee;
      const newVal = nextAdded ? currentVal + 7500 : Math.max(0, currentVal - 7500);
      return { ...prev, [activityId]: String(newVal) };
    });
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
        hasUangMakan: !!rowUangMakan[activity.id],
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
      setRowUangMakan(prev => {
        const next = { ...prev };
        delete next[activity.id];
        return next;
      });

      fetchActivities();
      try {
        await syncActivityToPayslip(db, activity.employeeId, activity.period);
      } catch (syncErr) {
        console.error('Error syncing payslip in handleApproveRow:', syncErr);
      }
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
      try {
        await syncActivityToPayslip(db, declineTarget.employeeId, declineTarget.period);
      } catch (syncErr) {
        console.error('Error syncing payslip in handleDecline:', syncErr);
      }
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
          hasUangMakan: !!rowUangMakan[upd.id],
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
      setRowUangMakan(prev => {
        const next = { ...prev };
        selectedIds.forEach(id => delete next[id]);
        return next;
      });
      setSelectedIds(new Set());
      fetchActivities();
      try {
        const uniqueKeys = new Set<string>();
        updates.forEach(upd => {
          const act = activities.find(a => a.id === upd.id);
          if (act && act.employeeId && act.period) {
            uniqueKeys.add(`${act.employeeId}::${act.period}`);
          }
        });

        await Promise.all(
          Array.from(uniqueKeys).map(async key => {
            const [empId, per] = key.split('::');
            await syncActivityToPayslip(db, empId, per);
          })
        );
      } catch (syncErr) {
        console.error('Error syncing payslips in handleBulkApprove:', syncErr);
      }
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
      try {
        const uniqueKeys = new Set<string>();
        selectedIds.forEach(id => {
          const act = activities.find(a => a.id === id);
          if (act && act.employeeId && act.period) {
            uniqueKeys.add(`${act.employeeId}::${act.period}`);
          }
        });

        await Promise.all(
          Array.from(uniqueKeys).map(async key => {
            const [empId, per] = key.split('::');
            await syncActivityToPayslip(db, empId, per);
          })
        );
      } catch (syncErr) {
        console.error('Error syncing payslips in handleBulkDecline:', syncErr);
      }
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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/80 to-slate-100 p-6 lg:p-8 font-sans selection:bg-indigo-100 relative overflow-hidden text-slate-800">
      {/* Subtle decorative blobs */}
      <div className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full bg-indigo-100/40 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] rounded-full bg-purple-100/30 blur-[100px] pointer-events-none" />
      <div className="max-w-[1600px] mx-auto space-y-6 relative z-10">

        {/* ── SatKer Pekarya NavBar ─────────────────────────────────── */}
        {profile?.role === 'satker_head' && (
          <Suspense fallback={null}>
            <SatkerPekaryaNavBar />
          </Suspense>
        )}

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            {profile?.role === 'super_admin' && (
              <Link href={`/dashboard/payroll/uraian?month=${month}&year=${year}`}>
                <Button variant="ghost" className="group -ml-2 mb-2 text-slate-500 hover:text-indigo-600 transition-colors">
                  <ArrowLeft className="w-4 h-4 mr-2 group-hover:-translate-x-1 transition-transform" />
                  Kembali ke Uraian
                </Button>
              </Link>
            )}
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
                    {MONTHS_ID.map((m, i) => {
                      const now = new Date();
                      const currentYear = now.getFullYear();
                      const currentMonth = now.getMonth() + 1;
                      const monthVal = i + 1;
                      // Hide future months for the current year
                      if (year === currentYear && monthVal > currentMonth) return null;
                      // Hide months before July for 2026 (except super_admin)
                      if (profile?.role !== 'super_admin' && year === 2026 && monthVal < 7) return null;
                      return (
                        <SelectItem key={i + 1} value={String(i + 1)}>
                          {m}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                <Select value={String(year)} onValueChange={(v) => v && setYear(parseInt(v))}>
                  <SelectTrigger className="w-24 bg-slate-50 border-slate-200 rounded-xl text-sm font-bold text-slate-700 h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl border-slate-100 shadow-xl bg-white">
                    {YEARS.map(y => {
                      const now = new Date();
                      const currentYear = now.getFullYear();
                      // Hide future years and years before 2026 (except super_admin)
                      if (y > currentYear) return null;
                      if (profile?.role !== 'super_admin' && y < 2026) return null;
                      return (
                        <SelectItem key={y} value={String(y)}>
                          {y}
                        </SelectItem>
                      );
                    })}
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

        {/* ── Stats Cards (clickable filters) ──────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {/* Menunggu */}
          <button
            onClick={() => setStatusFilter(statusFilter === 'pending' ? 'all' : 'pending')}
            className={`rounded-2xl shadow-sm text-center p-4 transition-all cursor-pointer ${
              statusFilter === 'pending'
                ? 'bg-amber-50 ring-2 ring-amber-400 shadow-amber-100'
                : 'bg-white hover:bg-amber-50/40 hover:ring-1 hover:ring-amber-200'
            }`}
          >
            <div className="text-2xl font-extrabold text-amber-500">{stats.pending}</div>
            <div className={`text-[11px] font-semibold mt-0.5 ${statusFilter === 'pending' ? 'text-amber-600' : 'text-slate-400'}`}>Menunggu</div>
          </button>

          {/* Disetujui */}
          <button
            onClick={() => setStatusFilter(statusFilter === 'approved' ? 'all' : 'approved')}
            className={`rounded-2xl shadow-sm text-center p-4 transition-all cursor-pointer ${
              statusFilter === 'approved'
                ? 'bg-emerald-50 ring-2 ring-emerald-400 shadow-emerald-100'
                : 'bg-white hover:bg-emerald-50/40 hover:ring-1 hover:ring-emerald-200'
            }`}
          >
            <div className="text-2xl font-extrabold text-emerald-500">{stats.approved}</div>
            <div className={`text-[11px] font-semibold mt-0.5 ${statusFilter === 'approved' ? 'text-emerald-600' : 'text-slate-400'}`}>Disetujui</div>
          </button>

          {/* Ditolak */}
          <button
            onClick={() => setStatusFilter(statusFilter === 'declined' ? 'all' : 'declined')}
            className={`rounded-2xl shadow-sm text-center p-4 transition-all cursor-pointer ${
              statusFilter === 'declined'
                ? 'bg-rose-50 ring-2 ring-rose-400 shadow-rose-100'
                : 'bg-white hover:bg-rose-50/40 hover:ring-1 hover:ring-rose-200'
            }`}
          >
            <div className="text-2xl font-extrabold text-rose-500">{stats.declined}</div>
            <div className={`text-[11px] font-semibold mt-0.5 ${statusFilter === 'declined' ? 'text-rose-600' : 'text-slate-400'}`}>Ditolak</div>
          </button>

          {/* Total (show all) */}
          <button
            onClick={() => setStatusFilter('all')}
            className={`rounded-2xl shadow-sm text-center p-4 transition-all cursor-pointer ${
              statusFilter === 'all'
                ? 'bg-slate-100 ring-2 ring-slate-400'
                : 'bg-white hover:bg-slate-50 hover:ring-1 hover:ring-slate-200'
            }`}
          >
            <div className="text-2xl font-extrabold text-slate-700">{stats.total}</div>
            <div className={`text-[11px] font-semibold mt-0.5 ${statusFilter === 'all' ? 'text-slate-600' : 'text-slate-400'}`}>Total Laporan</div>
          </button>

          {/* Total Fee (non-clickable) */}
          <div className="bg-gradient-to-br from-teal-500 to-cyan-600 rounded-2xl shadow-lg shadow-teal-200/30 col-span-2 lg:col-span-1 p-4 text-center">
            <div className="text-2xl font-extrabold text-white">{fmtRp(stats.totalFee)}</div>
            <div className="text-[11px] font-semibold text-teal-100 mt-0.5">Total Fee Disetujui</div>
          </div>
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
                  className="rounded-xl bg-emerald-500 text-white font-bold hover:bg-emerald-600 shadow-sm animate-pulse"
                >
                  <ThumbsUp className="w-3.5 h-3.5 mr-1.5" />
                  Setujui Terpilih
                </Button>
                <Button
                  onClick={handleBulkDecline}
                  size="sm"
                  variant="outline"
                  disabled={actionLoading}
                  className="rounded-xl border-rose-200 text-rose-600 hover:bg-rose-50 font-bold"
                >
                  <ThumbsDown className="w-3.5 h-3.5 mr-1.5" />
                  Tolak Terpilih
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
                      <TableHead className="font-bold text-slate-500">Uang Makan</TableHead>
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
                            <span className="truncate block font-semibold">{activity.activityName}</span>
                            {activity.jobCategory === 'SOPIR' && (
                              <div className="flex flex-col gap-1 mt-1.5">
                                {activity.points && activity.points.length > 0 && (
                                  <div className="text-[10px] text-slate-500 font-semibold bg-slate-50 border border-slate-200/50 p-1 px-1.5 rounded-lg leading-relaxed max-w-[240px] whitespace-normal">
                                    📍 {activity.points.join(' → ')}
                                  </div>
                                )}
                                <div className="flex flex-wrap gap-1">
                                  <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-slate-200 text-slate-500 font-medium">
                                    {activity.vehicleType || 'Mobil Kecil'}
                                  </Badge>
                                  <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-slate-200 text-slate-500 font-medium">
                                    {activity.tripType || 'Dalam Kota'}
                                  </Badge>
                                  {activity.distanceKm && activity.distanceKm > 0 ? (
                                    <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-emerald-200 bg-emerald-50 text-emerald-700 font-bold">
                                      {activity.distanceKm} km ({activity.durationHours || 0} jam)
                                    </Badge>
                                  ) : null}
                                  {activity.isOvernight && (
                                    <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 border-amber-200 bg-amber-50 text-amber-700 font-bold">
                                      Menginap
                                    </Badge>
                                  )}
                                  {activity.fuelFee && activity.fuelFee > 0 ? (
                                    <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-teal-200 bg-teal-50 text-teal-700 font-bold">
                                      BBM: {fmtRp(activity.fuelFee)}
                                    </Badge>
                                  ) : null}
                                  {activity.tollParkingFee && activity.tollParkingFee > 0 ? (
                                    <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-cyan-200 bg-cyan-50 text-cyan-700 font-bold">
                                      Tol: {fmtRp(activity.tollParkingFee)}
                                    </Badge>
                                  ) : null}
                                </div>
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-slate-600 font-medium whitespace-nowrap">
                            {activity.activityDate}
                          </TableCell>
                          <TableCell className="text-sm text-slate-600 font-medium whitespace-nowrap">
                            {activity.activityType === 'Buang Sampah' || activity.activityName === 'Buang Sampah'
                              ? activity.timeStart
                              : `${activity.timeStart} – ${activity.timeEnd}`}
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
                          <TableCell>
                            {activity.jobCategory === 'SOPIR' ? (
                              <span className="text-[10px] font-bold text-slate-400">SOPIR SPJ</span>
                            ) : activity.status === 'pending' ? (
                              (() => {
                                const [sh, sm] = activity.timeStart.split(':').map(Number);
                                const [eh, em] = activity.timeEnd.split(':').map(Number);
                                const minutes = (eh * 60 + em) - (sh * 60 + sm);
                                const halfHours = Math.round(minutes / 30);
                                const qualifies = halfHours > 4 && activity.activityType !== 'Buang Sampah' && activity.activityName !== 'Buang Sampah';
                                
                                if (!qualifies) return <span className="text-slate-300">—</span>;
                                
                                const isAdded = !!rowUangMakan[activity.id];
                                return (
                                  <Button
                                    size="sm"
                                    type="button"
                                    disabled={actionLoading}
                                    onClick={() => handleToggleUangMakan(activity.id, activity.timeStart, activity.timeEnd, activity.activityType, activity.activityName)}
                                    className={`h-7 px-2.5 rounded-lg font-bold text-[10px] cursor-pointer transition-colors ${
                                      isAdded 
                                        ? 'bg-amber-100 text-amber-800 hover:bg-amber-200 border border-amber-300' 
                                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200 border border-slate-300'
                                    }`}
                                  >
                                    {isAdded ? '✓ Uang Makan' : '+ Uang Makan'}
                                  </Button>
                                );
                              })()
                            ) : activity.status === 'approved' && activity.hasUangMakan ? (
                              <Badge className="bg-amber-50 text-amber-800 hover:bg-amber-50 border border-amber-200 text-[10px] font-bold rounded-lg px-2 py-0.5 whitespace-nowrap">
                                +Rp7.500
                              </Badge>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right pr-6">
                            {activity.status === 'pending' && (
                              <div className="flex justify-end gap-1.5">
                                {activity.jobCategory === 'SOPIR' ? (
                                  <Button
                                    size="sm"
                                    disabled={actionLoading}
                                    onClick={() => handleOpenAuditSopir(activity)}
                                    className="h-7 px-2.5 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-bold text-[11px] border border-indigo-200 cursor-pointer"
                                  >
                                    <ClipboardCheck className="w-3 h-3 mr-1" />
                                    Audit & Edit
                                  </Button>
                                ) : (
                                  <Button
                                    size="sm"
                                    disabled={actionLoading}
                                    onClick={() => handleApproveRow(activity, rowFees[activity.id] || '')}
                                    className="h-7 px-2.5 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-bold text-[11px] border border-emerald-200 cursor-pointer"
                                  >
                                    <ThumbsUp className="w-3 h-3 mr-1" />
                                    Setujui
                                  </Button>
                                )}
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
                            {activity.jobCategory === 'SOPIR' && activity.status !== 'pending' && (
                              <div className="flex justify-end">
                                <Button
                                  size="sm"
                                  onClick={() => handleOpenAuditSopir(activity)}
                                  className="h-7 px-2.5 rounded-lg bg-slate-50 text-slate-600 hover:bg-slate-100 font-bold text-[11px] border border-slate-200 cursor-pointer"
                                >
                                  Lihat Detail
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
                <span className="font-bold text-slate-700">
                  {declineTarget?.activityType === 'Buang Sampah' || declineTarget?.activityName === 'Buang Sampah'
                    ? declineTarget?.timeStart
                    : `${declineTarget?.timeStart} – ${declineTarget?.timeEnd}`}
                </span>
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

      {/* ── Driver (Sopir) Audit & Edit Modal ─────────────────────────── */}
      <Dialog open={auditActivity !== null} onOpenChange={(open) => { if (!open) setAuditActivity(null); }}>
        <DialogContent className="sm:max-w-xl rounded-[28px] border-none shadow-2xl bg-white p-6 max-h-[90vh] overflow-y-auto">
          <DialogHeader className="pb-2 border-b border-slate-100">
            <DialogTitle className="text-lg font-extrabold flex items-center gap-2.5 text-slate-800">
              <Compass className="w-5.5 h-5.5 text-indigo-500 shrink-0" />
              <span>{auditActivity?.status === 'pending' ? 'Audit & Edit Perjalanan Sopir' : 'Detail Audit Perjalanan Sopir'}</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-400">
              Verifikasi rute, BBM, uang makan, dan hitung delta serta upah bersih sopir.
            </DialogDescription>
          </DialogHeader>

          {auditActivity && auditCalc && (
            <div className="space-y-5 py-4">
              {/* Profile / Basic Info Card */}
              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-100 space-y-1.5 text-xs text-slate-600">
                <div className="flex justify-between">
                  <span className="font-semibold text-slate-400">Nama Sopir:</span>
                  <span className="font-extrabold text-slate-700">{auditActivity.employeeName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-semibold text-slate-400">Keperluan:</span>
                  <span className="font-extrabold text-slate-700">{auditActivity.activityName.split(' (')[0]}</span>
                </div>
                {auditActivity.points && auditActivity.points.length > 0 && (
                  <div className="flex flex-col gap-0.5 pt-1 border-t border-slate-200/60 mt-1">
                    <span className="font-semibold text-slate-400 text-[10px] uppercase block tracking-wider">Rute Perjalanan:</span>
                    <span className="font-bold text-slate-700 text-xs pl-0.5 leading-relaxed bg-white border border-slate-100 p-1.5 rounded-lg mt-0.5">
                      📍 {auditActivity.points.join(' → ')}
                    </span>
                  </div>
                )}
              </div>

              {/* Editable Fields (Only if pending, otherwise view-only) */}
              <div className="space-y-3.5">
                <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest block">Parameter Audit Perjalanan</span>
                
                <div className="grid grid-cols-2 gap-3.5">
                  <div className="space-y-1">
                    <Label className="text-[10px] font-bold text-slate-400 uppercase">Jarak Tempuh PP (KM)</Label>
                    <Input
                      type="number"
                      value={auditDistanceKm || ''}
                      onChange={(e) => setAuditDistanceKm(Math.max(0, parseFloat(e.target.value) || 0))}
                      disabled={auditActivity.status !== 'pending' || actionLoading}
                      className="rounded-xl border-slate-200 focus:border-indigo-400 focus:ring-indigo-400/20 text-xs font-bold"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] font-bold text-slate-400 uppercase">Durasi PP (JAM)</Label>
                    <Input
                      type="number"
                      value={auditDurationHours || ''}
                      onChange={(e) => setAuditDurationHours(Math.max(0, parseFloat(e.target.value) || 0))}
                      disabled={auditActivity.status !== 'pending' || actionLoading}
                      className="rounded-xl border-slate-200 focus:border-indigo-400 focus:ring-indigo-400/20 text-xs font-bold"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3.5">
                  <div className="space-y-1">
                    <Label className="text-[10px] font-bold text-slate-400 uppercase">Reimburse BBM (Rp)</Label>
                    <Input
                      type="number"
                      value={auditFuelFee || ''}
                      onChange={(e) => setAuditFuelFee(Math.max(0, parseInt(e.target.value, 10) || 0))}
                      disabled={auditActivity.status !== 'pending' || actionLoading}
                      className="rounded-xl border-slate-200 focus:border-indigo-400 focus:ring-indigo-400/20 text-xs font-bold"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] font-bold text-slate-400 uppercase">Reimburse Tol & Parkir (Rp)</Label>
                    <Input
                      type="number"
                      value={auditTollParkingFee || ''}
                      onChange={(e) => setAuditTollParkingFee(Math.max(0, parseInt(e.target.value, 10) || 0))}
                      disabled={auditActivity.status !== 'pending' || actionLoading}
                      className="rounded-xl border-slate-200 focus:border-indigo-400 focus:ring-indigo-400/20 text-xs font-bold"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3.5 items-center">
                  <div className="space-y-1">
                    <Label className="text-[10px] font-bold text-slate-400 uppercase">Jenis Kendaraan</Label>
                    {auditActivity.status === 'pending' ? (
                      <Select value={auditVehicleType} onValueChange={(v) => setAuditVehicleType(v || 'Suzuki XL7')}>
                        <SelectTrigger className="text-xs font-bold text-slate-700 bg-white rounded-xl border border-slate-200 h-9 px-3">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl border-slate-100 shadow-xl bg-white text-xs">
                          {['Suzuki XL7', 'Bis', 'Elf', 'Kijang LGX', 'Innova Hitam', 'Innova Matic', 'Ndalem'].map(v => (
                            <SelectItem key={v} value={v}>{v}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        type="text"
                        value={auditVehicleType}
                        disabled
                        className="rounded-xl bg-slate-50 border-slate-200 text-xs font-bold"
                      />
                    )}
                  </div>

                  <div className="flex items-center gap-2 pt-5">
                    <input
                      type="checkbox"
                      id="auditIsOvernight"
                      checked={auditIsOvernight}
                      onChange={(e) => setAuditIsOvernight(e.target.checked)}
                      disabled={auditActivity.status !== 'pending' || actionLoading}
                      className="w-4.5 h-4.5 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500"
                    />
                    <label htmlFor="auditIsOvernight" className="text-xs font-bold text-slate-600 select-none cursor-pointer">
                      Menginap (Overnight)
                    </label>
                  </div>
                </div>
              </div>

              {/* Comprehensive Audited Costs Breakdown */}
              <div className="space-y-3.5 pt-4 border-t border-slate-100">
                <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest block">Hasil Perhitungan Audit</span>

                {/* Earning / Wage Split Rows */}
                <div className="p-3.5 rounded-2xl bg-indigo-50/40 border border-indigo-100/50 space-y-2.5">
                  <span className="text-[9px] font-bold text-indigo-500 uppercase tracking-wider block">Komponen Earning (Upah Bersih)</span>
                  <div className="flex justify-between text-xs font-medium text-slate-600">
                    <span>Komponen Jarak ({auditDistanceKm} km x Rp200)</span>
                    <span className="font-extrabold text-slate-700">{fmtRp(auditCalc.componentJarak)}</span>
                  </div>
                  <div className="flex justify-between text-xs font-medium text-slate-600">
                    <span>Komponen Waktu ({auditDurationHours} jam x Rp5.000)</span>
                    <span className="font-extrabold text-slate-700">{fmtRp(auditCalc.componentWaktu)}</span>
                  </div>
                  {auditCalc.premiumWeekend > 0 && (
                    <div className="flex justify-between text-xs font-medium text-slate-600">
                      <span>Weekend Premium (Hari Libur)</span>
                      <span className="font-extrabold text-slate-700">+{fmtRp(auditCalc.premiumWeekend)}</span>
                    </div>
                  )}
                  {auditCalc.premiumOvernight > 0 && (
                    <div className="flex justify-between text-xs font-medium text-slate-600">
                      <span>Overnight Premium (Menginap)</span>
                      <span className="font-extrabold text-slate-700">+{fmtRp(auditCalc.premiumOvernight)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm font-extrabold text-slate-800 pt-2 border-t border-indigo-100/60">
                    <span>Upah Bersih Sopir (Net Wage)</span>
                    <span className="font-black text-emerald-600">{fmtRp(auditCalc.upahBersih)}</span>
                  </div>
                </div>

                {/* Operational Cost Breakdown */}
                <div className="p-3.5 rounded-2xl bg-blue-50/30 border border-blue-150 space-y-2.5">
                  <span className="text-[9px] font-bold text-blue-600 uppercase tracking-wider block">Biaya Operasional (SPJ)</span>
                  <div className="flex justify-between text-xs font-medium text-slate-600">
                    <span>Jatah BBM / Leg Cost (Jarak PP x {getVehicleRate(auditVehicleType)}/km)</span>
                    <span className="font-extrabold text-blue-600">{fmtRp(auditCalc.baselineBBM)}</span>
                  </div>
                  <div className="flex justify-between text-xs font-medium text-slate-600">
                    <span>Uang Makan Stratum ({auditDurationHours} jam)</span>
                    <span className="font-extrabold text-blue-600">{fmtRp(auditCalc.baselineMeal)}</span>
                  </div>
                  <div className="flex justify-between text-xs font-medium text-slate-600">
                    <span>Reimburse BBM Terbeli (Input)</span>
                    <span className="font-extrabold text-blue-600">{fmtRp(auditFuelFee)}</span>
                  </div>
                  <div className="flex justify-between text-xs font-medium text-slate-600">
                    <span>Kelebihan Pembelian BBM (Delta)</span>
                    <span className="font-extrabold text-blue-600">+{fmtRp(auditCalc.deltaFuel)}</span>
                  </div>
                  <div className="flex justify-between text-xs font-medium text-slate-600">
                    <span>Reimburse Tol & Parkir (Input)</span>
                    <span className="font-extrabold text-blue-600">+{fmtRp(auditTollParkingFee)}</span>
                  </div>
                  <div className="flex justify-between text-sm font-extrabold text-slate-800 pt-2 border-t border-blue-100">
                    <span>Total Operational Cost (Biaya SPJ)</span>
                    <span className="font-black text-blue-600">{fmtRp(auditCalc.operationalCost)}</span>
                  </div>
                </div>
              </div>

              {/* Receipt URLs (Clickable references) */}
              {(auditActivity.fuelReceiptUrl || auditActivity.tollReceiptUrl) && (
                <div className="flex gap-2 pt-2 text-xs">
                  {auditActivity.fuelReceiptUrl && (
                    <a
                      href={auditActivity.fuelReceiptUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 border border-indigo-100 px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5"
                    >
                      📄 Lihat Bukti BBM
                    </a>
                  )}
                  {auditActivity.tollReceiptUrl && (
                    <a
                      href={auditActivity.tollReceiptUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 border border-indigo-100 px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5"
                    >
                      📄 Lihat Bukti Tol
                    </a>
                  )}
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-3 border-t border-slate-100 pt-4">
            <Button variant="ghost" onClick={() => setAuditActivity(null)} className="rounded-xl font-bold text-slate-500">
              Kembali
            </Button>
            {auditActivity?.status === 'pending' && (
              <>
                <Button
                  onClick={() => {
                    setDeclineTarget(auditActivity);
                    setDeclineReason('');
                    setAuditActivity(null);
                  }}
                  disabled={actionLoading}
                  className="rounded-xl bg-rose-50 border border-rose-200 text-rose-600 hover:bg-rose-100 font-bold"
                >
                  Tolak Perjalanan
                </Button>
                <Button
                  onClick={handleApproveSopirAudit}
                  disabled={actionLoading}
                  className="rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white font-bold hover:shadow-lg shadow-indigo-100"
                >
                  {actionLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                  Audit & Setujui
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
