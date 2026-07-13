"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/lib/AuthContext';
import Link from 'next/link';
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
  Trash2,
  MapPin,
  ArrowRight,
  Compass,
  Car,
} from 'lucide-react';
import { db, storage } from '@/lib/firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
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
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isWeekend(dateStr: string): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const day = d.getDay(); // 0 = Sunday, 6 = Saturday
  return day === 0 || day === 6;
}

function calculateSopirDefaultFee(
  tripType?: 'Dalam Kota' | 'Luar Kota',
  vehicleType?: 'Mobil Kecil' | 'Bus/Truk',
  isOvernight?: boolean,
  activityDate?: string,
  fuelFee?: number,
  tollParkingFee?: number,
  distanceKm?: number,
  durationHours?: number
): number {
  let fee = 0;
  // Base rates
  if (vehicleType === 'Bus/Truk') {
    fee = 50000;
  } else { // default 'Mobil Kecil'
    fee = 30000;
  }

  // Distance Rate (Rp1.000/km)
  if (distanceKm && distanceKm > 0) {
    fee += distanceKm * 1000;
  }

  // Duration Rate (Rp5.000/hour)
  if (durationHours && durationHours > 0) {
    fee += durationHours * 5000;
  }

  // Overnight allowance
  if (isOvernight) {
    fee += 50000;
  }

  // Weekend premium
  if (activityDate && isWeekend(activityDate)) {
    fee += 20000;
  }

  // Operational reimbursements
  if (fuelFee && fuelFee > 0) {
    fee += fuelFee;
  }
  if (tollParkingFee && tollParkingFee > 0) {
    fee += tollParkingFee;
  }

  return fee;
}

function fmtRp(val: number): string {
  return 'Rp' + val.toLocaleString('id-ID');
}

function calculateDefaultFee(timeStart: string, timeEnd: string, activityType?: string, activityName?: string): number {
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

function getActivityFeeBreakdown(timeStart: string, timeEnd: string, activityType?: string, activityName?: string): string {
  if (activityType === 'Buang Sampah' || activityName === 'Buang Sampah') {
    return 'Tarif Flat';
  }

  if (!timeStart || !timeEnd) return '';

  const [sh, sm] = timeStart.split(':').map(Number);
  const [eh, em] = timeEnd.split(':').map(Number);

  if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) return '';

  const minutes = (eh * 60 + em) - (sh * 60 + sm);
  if (minutes < 0) return '';

  const halfHours = Math.round(minutes / 30);

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

  return `${halfHours} × Rp${rate.toLocaleString('id-ID')}/30m`;
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
  const fuelFileInputRef = React.useRef<HTMLInputElement>(null);
  const tollFileInputRef = React.useRef<HTMLInputElement>(null);

  const userJobCategory = profile?.permittedCategories?.[0] || '';
  const isKebersihan = userJobCategory === 'KEBERSIHAN' || userJobCategory === 'KEBERSIHAN_IC';
  const isSopir = userJobCategory === 'SOPIR';

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
  const [formActivityType, setFormActivityType] = useState<'Piket' | 'Standby' | 'Ro\'an' | 'Lainnya' | 'Buang Sampah'>('Piket');
  const [formName, setFormName] = useState('Piket');
  const [formCustomName, setFormCustomName] = useState('');
  const [formDate, setFormDate] = useState(getTodayISO());
  const [formTimeStart, setFormTimeStart] = useState('');
  const [formTimeEnd, setFormTimeEnd] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const isSubmittingRef = React.useRef(false);

  // ── SOPIR specific form states ──
  const [formTripType, setFormTripType] = useState<'Dalam Kota' | 'Luar Kota'>('Dalam Kota');
  const [formVehicleType, setFormVehicleType] = useState<'Mobil Kecil' | 'Bus/Truk'>('Mobil Kecil');
  const [formIsOvernight, setFormIsOvernight] = useState<boolean>(false);
  const [formFuelFee, setFormFuelFee] = useState<string>('');
  const [formTollParkingFee, setFormTollParkingFee] = useState<string>('');
  const [formFuelReceiptUrl, setFormFuelReceiptUrl] = useState<string>('');
  const [formTollReceiptUrl, setFormTollReceiptUrl] = useState<string>('');
  const [uploadingFuelReceipt, setUploadingFuelReceipt] = useState<boolean>(false);
  const [uploadingTollReceipt, setUploadingTollReceipt] = useState<boolean>(false);
  const [formPoints, setFormPoints] = useState<string[]>(['Pool Unipdu', '']);
  const [calculatedDistanceKm, setCalculatedDistanceKm] = useState<number>(0);
  const [calculatedDurationHours, setCalculatedDurationHours] = useState<number>(0);
  const [isCalculatingRoute, setIsCalculatingRoute] = useState<boolean>(false);
  const [routeError, setRouteError] = useState<string>('');
  const [routeCalculatedPoints, setRouteCalculatedPoints] = useState<string[]>([]);

  // ── Journey claiming & completion states ──
  const [unassignedJourneys, setUnassignedJourneys] = useState<any[]>([]);
  const [myClaimedJourneys, setMyClaimedJourneys] = useState<any[]>([]);
  const [loadingJourneys, setLoadingJourneys] = useState(false);
  const [activeReportingJourney, setActiveReportingJourney] = useState<any | null>(null);

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

  // ── Real-time listener for Driver Journeys (Sopir only) ──
  useEffect(() => {
    if (!isSopir || !profile?.linkedEmployeeId) return;

    setLoadingJourneys(true);
    // 1. Unassigned journeys
    const qUnassigned = query(
      collection(db, 'DriverJourneys'),
      where('status', '==', 'unassigned')
    );
    const unsubUnassigned = onSnapshot(qUnassigned, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setUnassignedJourneys(list);
      setLoadingJourneys(false);
    }, (err) => {
      console.error('Error listening to unassigned journeys:', err);
      setLoadingJourneys(false);
    });

    // 2. Active claimed journeys for this driver
    const qMyClaimed = query(
      collection(db, 'DriverJourneys'),
      where('employeeId', '==', profile.linkedEmployeeId),
      where('status', '==', 'claimed')
    );
    const unsubMyClaimed = onSnapshot(qMyClaimed, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setMyClaimedJourneys(list);
    }, (err) => {
      console.error('Error listening to claimed journeys:', err);
    });

    return () => {
      unsubUnassigned();
      unsubMyClaimed();
    };
  }, [isSopir, profile?.linkedEmployeeId]);

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
    const defaultType = isKebersihan ? 'Piket' : 'Lainnya';
    const defaultName = isKebersihan ? 'Piket' : (isSopir ? 'Perjalanan Dinas' : '');
    setFormActivityType(defaultType);
    setFormName(defaultName);
    setFormCustomName('');
    setFormDate(getTodayISO());
    setFormTimeStart('');
    setFormTimeEnd('');
    setFormTripType('Dalam Kota');
    setFormVehicleType('Mobil Kecil');
    setFormIsOvernight(false);
    setFormFuelFee('');
    setFormTollParkingFee('');
    setFormFuelReceiptUrl('');
    setFormTollReceiptUrl('');
    setUploadingFuelReceipt(false);
    setUploadingTollReceipt(false);
    setFormPoints(['Pool Unipdu', '']);
    setCalculatedDistanceKm(0);
    setCalculatedDurationHours(0);
    setRouteError('');
    setRouteCalculatedPoints([]);
    setEditingActivity(null);
    setShowForm(false);
  };

  const openEditForm = (activity: ActivityReport) => {
    const cleanName = activity.activityName.replace(/\s*\(.*\)\s*$/, '');
    setEditingActivity(activity);
    const type = isKebersihan
      ? (activity.activityType || (['Piket', 'Standby', 'Ro\'an', 'Buang Sampah'].includes(cleanName) ? cleanName : 'Lainnya'))
      : 'Lainnya';
    setFormActivityType(type as any);
    if (type === 'Lainnya') {
      setFormCustomName(cleanName);
      setFormName(cleanName);
    } else {
      setFormName(cleanName);
      setFormCustomName('');
    }
    setFormDate(activity.activityDate);
    setFormTimeStart(activity.timeStart);
    setFormTimeEnd(activity.timeEnd);

    // SOPIR fields prefill
    setFormTripType(activity.tripType || 'Dalam Kota');
    setFormVehicleType(activity.vehicleType || 'Mobil Kecil');
    setFormIsOvernight(!!activity.isOvernight);
    setFormFuelFee(activity.fuelFee ? String(activity.fuelFee) : '');
    setFormTollParkingFee(activity.tollParkingFee ? String(activity.tollParkingFee) : '');
    setFormPoints(activity.points || ['Pool Unipdu', '']);
    setCalculatedDistanceKm(activity.distanceKm || 0);
    setCalculatedDurationHours(activity.durationHours || 0);
    setRouteCalculatedPoints(activity.points || ['Pool Unipdu', '']);

    setShowForm(true);
  };

  const handleCalculateRoute = async () => {
    const activePoints = formPoints.map(p => p.trim()).filter(Boolean);
    if (activePoints.length < 2) {
      setRouteError('Minimal 2 lokasi rute harus diisi.');
      return;
    }

    setIsCalculatingRoute(true);
    setRouteError('');
    try {
      const response = await fetch('/api/calculate-route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ points: activePoints }),
      });
      const resData = await response.json();

      if (!response.ok || !resData.success) {
        throw new Error(resData.error || 'Gagal menghitung rute.');
      }

      setCalculatedDistanceKm(resData.distanceKm);
      setCalculatedDurationHours(resData.durationHours);
      setRouteCalculatedPoints([...formPoints]);
      setMessage({ type: 'success', text: `Rute berhasil dihitung: ${resData.distanceKm} km | ${resData.durationHours} jam` });
    } catch (err: any) {
      console.error(err);
      setRouteError(err.message || 'Terjadi kesalahan saat menghitung rute.');
      setCalculatedDistanceKm(0);
      setCalculatedDurationHours(0);
      setRouteCalculatedPoints([]);
    } finally {
      setIsCalculatingRoute(false);
    }
  };

  const handleClaimJourney = async (journeyId: string) => {
    if (!profile?.linkedEmployeeId) return;
    if (myClaimedJourneys.length > 0) {
      setMessage({
        type: 'error',
        text: 'Anda memiliki perjalanan aktif yang sedang berjalan. Selesaikan perjalanan tersebut terlebih dahulu.',
      });
      return;
    }
    try {
      await updateDoc(doc(db, 'DriverJourneys', journeyId), {
        status: 'claimed',
        employeeId: profile.linkedEmployeeId,
        employeeName: profile.displayName || '',
        claimedAt: serverTimestamp(),
      });
      setMessage({ type: 'success', text: 'Perjalanan berhasil diambil. Silakan laporkan setelah selesai.' });
    } catch (err) {
      console.error('Error claiming journey:', err);
      setMessage({ type: 'error', text: 'Gagal mengambil perjalanan.' });
    }
  };

  const handleCancelJourney = async (journeyId: string) => {
    if (!confirm('Apakah Anda yakin ingin membatalkan klaim perjalanan ini? Perjalanan akan tersedia kembali untuk sopir lain.')) {
      return;
    }
    try {
      await updateDoc(doc(db, 'DriverJourneys', journeyId), {
        status: 'unassigned',
        employeeId: null,
        employeeName: null,
        claimedAt: null,
      });
      setMessage({ type: 'success', text: 'Klaim perjalanan berhasil dibatalkan.' });
    } catch (err) {
      console.error('Error cancelling journey claim:', err);
      setMessage({ type: 'error', text: 'Gagal membatalkan klaim perjalanan.' });
    }
  };

  const handleUploadReceipt = async (file: File, type: 'bbm' | 'toll') => {
    if (!activeReportingJourney) return;
    const isBbm = type === 'bbm';
    if (isBbm) {
      setUploadingFuelReceipt(true);
    } else {
      setUploadingTollReceipt(true);
    }

    try {
      const extension = file.name.split('.').pop() || 'jpg';
      const fileRef = ref(storage, `receipts/${activeReportingJourney.id}/${type}_${Date.now()}.${extension}`);
      await uploadBytes(fileRef, file);
      const downloadUrl = await getDownloadURL(fileRef);
      if (isBbm) {
        setFormFuelReceiptUrl(downloadUrl);
      } else {
        setFormTollReceiptUrl(downloadUrl);
      }
      setMessage({ type: 'success', text: `Bukti ${isBbm ? 'BBM' : 'Tol & Parkir'} berhasil diunggah.` });
    } catch (err: any) {
      console.error(`Error uploading ${type} receipt:`, err);
      setMessage({ type: 'error', text: `Gagal mengunggah bukti ${isBbm ? 'BBM' : 'Tol & Parkir'}. Coba lagi.` });
    } finally {
      if (isBbm) {
        setUploadingFuelReceipt(false);
      } else {
        setUploadingTollReceipt(false);
      }
    }
  };

  const handleCompleteJourneySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeReportingJourney || !profile?.linkedEmployeeId || isSubmittingRef.current) return;

    if (!formDate) {
      setMessage({ type: 'error', text: 'Tanggal perjalanan harus diisi.' });
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
      const fuelVal = formFuelFee ? (parseInt(formFuelFee.replace(/\D/g, ''), 10) || 0) : 0;
      const tollVal = formTollParkingFee ? (parseInt(formTollParkingFee.replace(/\D/g, ''), 10) || 0) : 0;

      if (fuelVal > 0 && !formFuelReceiptUrl) {
        setMessage({ type: 'error', text: 'Mohon unggah bukti reimburse BBM terlebih dahulu.' });
        isSubmittingRef.current = false;
        setSubmitting(false);
        return;
      }
      if (tollVal > 0 && !formTollReceiptUrl) {
        setMessage({ type: 'error', text: 'Mohon unggah bukti tol & parkir terlebih dahulu.' });
        isSubmittingRef.current = false;
        setSubmitting(false);
        return;
      }

      // 1. Update the Journey document
      const journeyRef = doc(db, 'DriverJourneys', activeReportingJourney.id);
      await updateDoc(journeyRef, {
        status: 'completed',
        fuelFee: fuelVal,
        tollParkingFee: tollVal,
        fuelReceiptUrl: formFuelReceiptUrl || '',
        tollReceiptUrl: formTollReceiptUrl || '',
        isOvernight: formIsOvernight,
        activityDate: formDate,
        timeStart: formTimeStart,
        timeEnd: formTimeEnd,
        completedAt: serverTimestamp(),
      });

      // 2. Calculate Final Pay
      let finalFee = (activeReportingJourney.totalOperationalCost || 0) + fuelVal + tollVal;
      if (formIsOvernight) {
        finalFee += 50000;
      }
      if (isWeekend(formDate)) {
        finalFee += 20000;
      }

      // 3. Create the ActivityReport document
      const employeeIdSanitized = profile.linkedEmployeeId.replace(/[^a-zA-Z0-9_-]/g, '');
      const dateSanitized = formDate.replace(/-/g, '');
      const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
      const customDocId = `ACT-${employeeIdSanitized}-${dateSanitized}-${randomSuffix}`;

      const routeText = ` (${activeReportingJourney.startPoint.split(',')[0]} → ${activeReportingJourney.endPoint})`;
      const finalActivityName = activeReportingJourney.activityName + routeText;

      const activityPeriod = formDate.substring(0, 7);

      await setDoc(doc(db, 'ActivityReports', customDocId), {
        employeeId: profile.linkedEmployeeId,
        employeeName: profile.displayName || '',
        jobCategory: 'SOPIR',
        period: activityPeriod,
        activityName: finalActivityName,
        activityType: 'Lainnya',
        activityDate: formDate,
        timeStart: formTimeStart,
        timeEnd: formTimeEnd,
        status: 'pending',
        fee: finalFee,
        submittedAt: serverTimestamp(),
        tripType: activeReportingJourney.distanceKm > 50 ? 'Luar Kota' : 'Dalam Kota',
        vehicleType: activeReportingJourney.vehicleName,
        isOvernight: formIsOvernight,
        fuelFee: fuelVal,
        tollParkingFee: tollVal,
        fuelReceiptUrl: formFuelReceiptUrl || '',
        tollReceiptUrl: formTollReceiptUrl || '',
        points: [activeReportingJourney.startPoint, activeReportingJourney.endPoint],
        distanceKm: activeReportingJourney.distanceKm,
        durationHours: activeReportingJourney.durationHours,
        journeyId: activeReportingJourney.id,
      });

      setMessage({ type: 'success', text: 'Perjalanan dinas berhasil dilaporkan.' });

      setActiveReportingJourney(null);
      resetForm();
      fetchActivities();
    } catch (err) {
      console.error('Error reporting journey completion:', err);
      setMessage({ type: 'error', text: 'Gagal mengirimkan laporan perjalanan.' });
    } finally {
      isSubmittingRef.current = false;
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.linkedEmployeeId || isSubmittingRef.current) return;

    const isBuangSampah = formActivityType === 'Buang Sampah';

    if (!formName.trim()) {
      setMessage({ type: 'error', text: 'Jenis kegiatan harus diisi.' });
      return;
    }
    if (!formDate) {
      setMessage({ type: 'error', text: 'Tanggal kegiatan harus diisi.' });
      return;
    }
    if (!formTimeStart) {
      setMessage({ type: 'error', text: 'Waktu mulai harus diisi.' });
      return;
    }
    if (!isBuangSampah) {
      if (!formTimeEnd) {
        setMessage({ type: 'error', text: 'Waktu selesai harus diisi.' });
        return;
      }
      if (formTimeEnd <= formTimeStart) {
        setMessage({ type: 'error', text: 'Waktu selesai harus lebih dari waktu mulai.' });
        return;
      }
    }

    // Google Maps Route Verification for Drivers
    const isRouteChanged = JSON.stringify(formPoints) !== JSON.stringify(routeCalculatedPoints);
    if (isSopir) {
      if (calculatedDistanceKm <= 0 || isRouteChanged) {
        setMessage({ type: 'error', text: 'Silakan klik "Cek Rute & Jarak" terlebih dahulu untuk memverifikasi rute.' });
        return;
      }
    }

    const routeSummary = isSopir ? ` (${formPoints.map(p => p.trim()).filter(Boolean).join(' → ')})` : '';
    const finalActivityName = isSopir ? formName.trim().replace(/\s*\(.*\)\s*$/, '') + routeSummary : formName.trim();

    const driverFields = isSopir ? {
      tripType: formTripType,
      vehicleType: formVehicleType,
      isOvernight: formIsOvernight,
      fuelFee: formFuelFee ? (parseInt(formFuelFee.replace(/\D/g, ''), 10) || 0) : 0,
      tollParkingFee: formTollParkingFee ? (parseInt(formTollParkingFee.replace(/\D/g, ''), 10) || 0) : 0,
      points: formPoints.map(p => p.trim()).filter(Boolean),
      distanceKm: calculatedDistanceKm,
      durationHours: calculatedDurationHours,
    } : {};

    isSubmittingRef.current = true;
    setSubmitting(true);
    try {
      if (editingActivity) {
        // Re-submit / edit a declined activity → reset to pending
        await updateDoc(doc(db, 'ActivityReports', editingActivity.id), {
          activityName: finalActivityName,
          activityType: formActivityType,
          activityDate: formDate,
          timeStart: formTimeStart,
          timeEnd: isBuangSampah ? '' : formTimeEnd,
          status: 'pending',
          fee: 0,
          declineReason: '',
          submittedAt: serverTimestamp(),
          ...driverFields,
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
          activityName: finalActivityName,
          activityType: formActivityType,
          activityDate: formDate,
          timeStart: formTimeStart,
          timeEnd: isBuangSampah ? '' : formTimeEnd,
          status: 'pending',
          fee: 0,
          submittedAt: serverTimestamp(),
          ...driverFields,
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
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/80 to-slate-100 flex items-center justify-center relative overflow-hidden">
        {/* Subtle decorative blobs */}
        <div className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full bg-indigo-100/40 blur-[120px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] rounded-full bg-purple-100/30 blur-[100px] pointer-events-none" />
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin relative z-10" />
      </div>
    );
  }

  if (!profile.linkedEmployeeId) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/80 to-slate-100 flex items-center justify-center p-6 relative overflow-hidden">
        {/* Subtle decorative blobs */}
        <div className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full bg-indigo-100/40 blur-[120px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] rounded-full bg-purple-100/30 blur-[100px] pointer-events-none" />
        <Card className="max-w-md w-full rounded-3xl border-none shadow-xl bg-white relative z-10">
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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/80 to-slate-100 font-sans selection:bg-indigo-100 relative overflow-hidden text-slate-800">
      {/* Subtle decorative blobs */}
      <div className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full bg-indigo-100/40 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] rounded-full bg-purple-100/30 blur-[100px] pointer-events-none" />

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-30 bg-white/80 backdrop-blur-xl border-b border-slate-100 shadow-sm relative z-20">
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
          <div className="flex items-center gap-1.5 sm:gap-2">
            <Link href="/employee/payslip">
              <Button
                variant="ghost"
                size="sm"
                className="text-slate-500 hover:text-indigo-600 hover:bg-slate-50 rounded-xl h-8 px-2.5 flex items-center gap-1.5 font-bold text-xs cursor-pointer"
                title="Lihat Slip Gaji"
              >
                <Banknote className="w-4 h-4 text-emerald-600" />
                <span>Slip Gaji</span>
              </Button>
            </Link>

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
      </div>

      <div className="max-w-2xl mx-auto px-4 py-5 space-y-5 relative z-10">

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

        {/* ── Driver Journeys Panel (Sopir only) ───────────────────────── */}
        {isSopir && (
          <div className="space-y-4">
            {/* 1. Active claimed journeys */}
            {myClaimedJourneys.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-bold text-indigo-700 uppercase tracking-wider pl-1">
                  Perjalanan Aktif Anda
                </h3>
                {myClaimedJourneys.map((j) => (
                  <Card key={j.id} className="bg-gradient-to-br from-indigo-600 to-indigo-700 text-white rounded-2xl shadow-lg border-none overflow-hidden relative">
                    <div className="absolute top-0 right-0 w-32 h-32 rounded-full bg-white/5 -translate-y-6 translate-x-6 blur-md pointer-events-none" />
                    <CardContent className="p-4 sm:p-5 space-y-3.5 relative z-10">
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-bold tracking-widest text-indigo-200 uppercase bg-indigo-500/50 px-2 py-0.5 rounded-md">
                            Dalam Perjalanan
                          </span>
                          <span className="text-[10px] font-bold text-indigo-200">
                            {j.vehicleName} ({fmtRp(j.vehicleRate)}/km)
                          </span>
                        </div>
                        <h4 className="text-sm font-bold mt-1 text-white leading-snug">
                          {j.activityName}
                        </h4>
                      </div>

                      <div className="p-2.5 rounded-xl bg-white/10 text-white text-xs font-medium space-y-1">
                        <div className="flex items-center gap-1.5 text-indigo-100">
                          <MapPin className="w-4 h-4 text-indigo-200 shrink-0" />
                          <span className="font-semibold text-white/95">Tujuan utama:</span>
                          <span className="truncate flex-1 font-extrabold text-white" title={j.endPoint}>{j.endPoint}</span>
                        </div>
                        <div className="flex justify-between pt-1 border-t border-white/10 text-[10px] text-indigo-100">
                          <span>Estimasi Jarak (PP): <strong>{j.distanceKm * 2} km</strong></span>
                          <span>Biaya Operasional: <strong>{fmtRp(j.totalOperationalCost)}</strong></span>
                        </div>
                        {(() => {
                          const baseWage = (j.distanceKm * 2 * 200) + ((j.durationHours || 0) * 2 * 5000);
                          const maxWage = baseWage * 1.9;
                          return (
                            <div className="pt-1.5 border-t border-white/10 text-[10px] text-indigo-100 flex justify-between items-center">
                              <span>Estimasi Upah Sopir:</span>
                              <span className="font-black text-amber-300">{fmtRp(baseWage)} - {fmtRp(maxWage)}</span>
                            </div>
                          );
                        })()}
                      </div>

                      <div className="flex flex-col gap-2">
                        <Button
                          onClick={() => {
                            setActiveReportingJourney(j);
                            setFormDate(new Date().toISOString().slice(0, 10));
                            setFormTimeStart('08:00');
                            setFormTimeEnd('17:00');
                            setFormIsOvernight(false);
                            setFormFuelFee('');
                            setFormTollParkingFee('');
                          }}
                          className="w-full rounded-xl bg-white text-indigo-700 hover:bg-slate-100 hover:text-indigo-800 transition-all font-extrabold text-xs h-9.5 gap-1.5 cursor-pointer shadow-sm border-none"
                        >
                          <CheckCircle2 className="w-4.5 h-4.5" />
                          Laporkan Perjalanan Selesai
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => handleCancelJourney(j.id)}
                          className="w-full rounded-xl text-white/90 hover:text-white hover:bg-white/10 transition-all font-bold text-xs h-8.5 gap-1.5 cursor-pointer border border-white/20"
                        >
                          <XCircle className="w-4 h-4 text-white/90 shrink-0" />
                          Batalkan Klaim Perjalanan
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* 2. Open / Unassigned Journeys */}
            <div className="space-y-2">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider pl-1 flex items-center gap-1.5">
                <Compass className="w-4.5 h-4.5 text-slate-400" />
                Pemesanan Perjalanan Terbuka
              </h3>
              {loadingJourneys ? (
                <div className="p-6 text-center text-slate-400 bg-white border border-slate-100 rounded-2xl flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
                  <span className="text-xs font-medium">Memuat perjalanan terbuka...</span>
                </div>
              ) : unassignedJourneys.length === 0 ? (
                <div className="p-6 text-center text-slate-400 bg-white/50 border border-dashed border-slate-200 rounded-2xl">
                  <span className="text-xs font-medium">Belum ada perjalanan dinas baru yang ditugaskan.</span>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2.5">
                  {myClaimedJourneys.length > 0 && (
                    <div className="p-3.5 text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-2xl font-bold flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>Anda memiliki perjalanan aktif. Selesaikan atau laporkan terlebih dahulu sebelum mengambil perjalanan baru.</span>
                    </div>
                  )}
                  {unassignedJourneys.map((j) => (
                    <Card key={j.id} className="bg-white hover:border-slate-300 transition-all rounded-2xl shadow-sm border border-slate-200/70 overflow-hidden">
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-emerald-500" />
                            <span className="text-[10px] font-extrabold text-emerald-600 bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 rounded-md">
                              Tersedia
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            {j.activityDate && (
                              <span className="text-[10px] font-extrabold text-indigo-600 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded-md">
                                {new Date(j.activityDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                              </span>
                            )}
                            <span className="text-[10px] font-bold text-slate-400 bg-slate-50 border border-slate-100 px-1.5 py-0.5 rounded-md">
                              {j.vehicleName} ({fmtRp(j.vehicleRate)}/km)
                            </span>
                          </div>
                        </div>

                        <div>
                          <h4 className="text-xs sm:text-sm font-extrabold text-slate-800 leading-snug">{j.activityName}</h4>
                          <div className="flex items-center gap-1 mt-1 text-[10px] text-slate-500 font-semibold">
                            <MapPin className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                            <span className="truncate flex-1 font-extrabold text-slate-700" title={j.endPoint}>{j.endPoint}</span>
                          </div>
                        </div>

                        <div className="flex justify-between items-center pt-2.5 border-t border-slate-100">
                          <div className="flex gap-4">
                            <div>
                              <span className="block text-[8px] text-slate-400 font-extrabold uppercase leading-tight">Biaya Operasional</span>
                              <span className="text-xs font-black text-indigo-600">{fmtRp(j.totalOperationalCost)}</span>
                            </div>
                            {(() => {
                              const baseWage = (j.distanceKm * 2 * 200) + ((j.durationHours || 0) * 2 * 5000);
                              const maxWage = baseWage * 1.9;
                              return (
                                <div>
                                  <span className="block text-[8px] text-slate-400 font-extrabold uppercase leading-tight">Upah Bersih</span>
                                  <span className="text-xs font-black text-emerald-600">{fmtRp(baseWage)} - {fmtRp(maxWage)}</span>
                                </div>
                              );
                            })()}
                          </div>

                          <Button
                            disabled={myClaimedJourneys.length > 0}
                            onClick={() => handleClaimJourney(j.id)}
                            className="rounded-xl bg-indigo-50 hover:bg-indigo-600 border border-indigo-100 hover:border-indigo-600 text-indigo-700 hover:text-white font-bold text-xs h-8 px-3.5 transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:bg-slate-50 disabled:text-slate-400 disabled:border-slate-100 disabled:cursor-not-allowed"
                          >
                            Ambil Perjalanan
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

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
                          <span className="text-[11px] text-slate-400 font-medium">
                            {activity.activityType === 'Buang Sampah' || activity.activityName === 'Buang Sampah'
                              ? activity.timeStart
                              : `${activity.timeStart} – ${activity.timeEnd}`}
                          </span>
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
                              {activity.activityType === 'Buang Sampah' || activity.activityName === 'Buang Sampah'
                                ? activity.timeStart
                                : `${activity.timeStart} – ${activity.timeEnd}`}
                            </p>
                          </div>
                        </div>

                        {/* Driver details section */}
                        {activity.jobCategory === 'SOPIR' && (
                          <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 space-y-1.5 text-xs text-slate-600">
                            {activity.points && activity.points.length > 0 && (
                              <div className="space-y-0.5 pb-1.5 border-b border-slate-200/60">
                                <span className="font-semibold text-slate-400 text-[10px] uppercase block tracking-wider">Rute Perjalanan:</span>
                                <div className="font-bold text-slate-700 text-xs pl-0.5 leading-relaxed">
                                  {activity.points.join(' → ')}
                                </div>
                              </div>
                            )}
                            <div className="flex justify-between">
                              <span className="font-semibold text-slate-400">Jenis Kendaraan:</span>
                              <span className="font-bold text-slate-700">{activity.vehicleType || 'Mobil Kecil'}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="font-semibold text-slate-400">Tipe Perjalanan:</span>
                              <span className="font-bold text-slate-700">{activity.tripType || 'Dalam Kota'}</span>
                            </div>
                            {activity.distanceKm && activity.distanceKm > 0 ? (
                              <div className="flex justify-between">
                                <span className="font-semibold text-slate-400">Jarak / Waktu Tempuh:</span>
                                <span className="font-bold text-slate-700">{activity.distanceKm} km ({activity.durationHours || 0} jam)</span>
                              </div>
                            ) : null}
                            <div className="flex justify-between">
                              <span className="font-semibold text-slate-400">Menginap (Overnight):</span>
                              <span className="font-bold text-slate-700">{activity.isOvernight ? 'Ya' : 'Tidak'}</span>
                            </div>
                            {((activity.fuelFee && activity.fuelFee > 0) || (activity.tollParkingFee && activity.tollParkingFee > 0)) && (
                              <div className="pt-1.5 border-t border-slate-200/60 mt-1.5 space-y-1">
                                {activity.fuelFee && activity.fuelFee > 0 && (
                                  <div className="flex justify-between">
                                    <span className="font-semibold text-slate-400">Reimburse BBM:</span>
                                    <span className="font-bold text-slate-700">{fmtRp(activity.fuelFee)}</span>
                                  </div>
                                )}
                                {activity.tollParkingFee && activity.tollParkingFee > 0 && (
                                  <div className="flex justify-between">
                                    <span className="font-semibold text-slate-400">Reimburse Tol & Parkir:</span>
                                    <span className="font-bold text-slate-700">{fmtRp(activity.tollParkingFee)}</span>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {activity.status === 'approved' && activity.fee > 0 && (
                          <div className="flex flex-col gap-1 p-3 rounded-xl bg-emerald-50 border border-emerald-100">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              <div className="flex items-center gap-2">
                                <Banknote className="w-4 h-4 text-emerald-600" />
                                <span className="text-sm font-bold text-emerald-700">{fmtRp(activity.fee)}</span>
                              </div>
                              {activity.jobCategory === 'SOPIR' ? (
                                <span className="text-xs text-emerald-600/70 font-medium">
                                  (Termasuk Biaya SPJ & Reimburse)
                                </span>
                              ) : (
                                (() => {
                                  const breakdown = getActivityFeeBreakdown(activity.timeStart, activity.timeEnd, activity.activityType, activity.activityName);
                                  return breakdown && (
                                    <span className="text-xs text-emerald-600/70 font-medium">
                                      ({breakdown}{activity.hasUangMakan ? ' + Rp7.500 Uang Makan' : ''})
                                    </span>
                                  );
                                })()
                              )}
                              {activity.jobCategory !== 'SOPIR' && activity.hasUangMakan && (
                                <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-none text-[10px] font-bold rounded-lg px-2 py-0.5">
                                  + Uang Makan
                                </Badge>
                              )}
                            </div>
                          </div>
                        )}

                        {activity.status === 'pending' && (
                          activity.jobCategory === 'SOPIR' ? (
                            (() => {
                              const est = calculateSopirDefaultFee(
                                activity.tripType,
                                activity.vehicleType,
                                activity.isOvernight,
                                activity.activityDate,
                                activity.fuelFee,
                                activity.tollParkingFee
                              );
                              return (
                                <div className="flex flex-col gap-1 p-3 rounded-xl bg-amber-50 border border-amber-200">
                                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                    <div className="flex items-center gap-2">
                                      <Banknote className="w-4 h-4 text-amber-600" />
                                      <span className="text-sm font-bold text-amber-700">
                                        Estimasi SPJ: {fmtRp(est)}
                                      </span>
                                    </div>
                                    <span className="text-xs text-amber-600/70 font-medium">
                                      (Menunggu persetujuan SatKer)
                                    </span>
                                  </div>
                                </div>
                              );
                            })()
                          ) : (
                            (() => {
                              const baseFee = calculateDefaultFee(activity.timeStart, activity.timeEnd, activity.activityType, activity.activityName);

                              // Calculate if it qualifies for Uang Makan
                              const [sh, sm] = activity.timeStart.split(':').map(Number);
                              const [eh, em] = activity.timeEnd.split(':').map(Number);
                              const minutes = (eh * 60 + em) - (sh * 60 + sm);
                              const halfHours = Math.round(minutes / 30);
                              const qualifies = halfHours > 4 && activity.activityType !== 'Buang Sampah' && activity.activityName !== 'Buang Sampah';

                              const totalEstimated = qualifies ? baseFee + 7500 : baseFee;
                              const breakdown = getActivityFeeBreakdown(activity.timeStart, activity.timeEnd, activity.activityType, activity.activityName);

                              // Format breakdown with asterisk if qualifies
                              const breakdownStr = breakdown
                                ? (qualifies ? `(${breakdown} + *Rp7.500*)` : `(${breakdown})`)
                                : '';

                              return (
                                <div className="flex flex-col gap-1 p-3 rounded-xl bg-amber-50 border border-amber-200">
                                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                    <div className="flex items-center gap-2">
                                      <Banknote className="w-4 h-4 text-amber-600" />
                                      <span className="text-sm font-bold text-amber-700">
                                        Estimasi Upah: {fmtRp(totalEstimated)}
                                      </span>
                                    </div>
                                    {breakdownStr && (
                                      <span className="text-xs text-amber-600/70 font-medium">
                                        {breakdownStr}
                                      </span>
                                    )}
                                  </div>
                                  {qualifies && (
                                    <span className="text-xs text-amber-600 font-medium ml-6">
                                      * Uang Makan jika disetujui oleh Kepala SatKer
                                    </span>
                                  )}
                                </div>
                              );
                            })()
                          )
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
            {isKebersihan ? (
              <>
                {/* Activity Type Selection */}
                <div className="space-y-1.5">
                  <Label htmlFor="activityType" className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                    Jenis Kegiatan
                  </Label>
                  {/* Native select on mobile for bug-free scrolling/zooming */}
                  <div className="block sm:hidden">
                    <select
                      value={formActivityType}
                      onChange={(e) => {
                        const val = e.target.value as any;
                        setFormActivityType(val);
                        if (val !== 'Lainnya') {
                          setFormName(val);
                        } else {
                          setFormName(formCustomName || '');
                        }
                      }}
                      className="w-full text-base font-bold text-slate-700 bg-white rounded-xl border border-slate-200 h-10 px-3 pr-10 appearance-none focus:outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-400/20"
                      style={{
                        backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 24 24\' stroke=\'%2394a3b8\'%3E%3Cpath stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'2\' d=\'M19 9l-7 7-7-7\'/%3E%3C/svg%3E")',
                        backgroundPosition: 'right 12px center',
                        backgroundSize: '16px 16px',
                        backgroundRepeat: 'no-repeat',
                      }}
                    >
                      <option value="Piket">Piket</option>
                      <option value="Standby">Standby</option>
                      <option value="Ro'an">Ro'an</option>
                      <option value="Buang Sampah">Buang Sampah</option>
                      <option value="Lainnya">Lainnya</option>
                    </select>
                  </div>

                  {/* Custom select on larger screens (tablet/desktop) */}
                  <div className="hidden sm:block">
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
                    >
                      <SelectTrigger className="w-full text-sm font-bold text-slate-700 bg-white rounded-xl border border-slate-200 h-10 px-3">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl border-slate-100 shadow-xl bg-white">
                        <SelectItem value="Piket">Piket</SelectItem>
                        <SelectItem value="Standby">Standby</SelectItem>
                        <SelectItem value="Ro'an">Ro'an</SelectItem>
                        <SelectItem value="Buang Sampah">Buang Sampah</SelectItem>
                        <SelectItem value="Lainnya">Lainnya</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
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
                      className="rounded-xl border-slate-200 focus:border-teal-400 focus:ring-teal-400/20 text-base sm:text-sm"
                      required
                      autoFocus
                      autoComplete="off"
                    />
                  </div>
                )}
              </>
            ) : isSopir ? (
              <div className="space-y-4 animate-in fade-in duration-200">
                {/* Nama Kegiatan */}
                <div className="space-y-1.5">
                  <Label htmlFor="activityNameInput" className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                    Keperluan / Catatan Perjalanan
                  </Label>
                  <Input
                    id="activityNameInput"
                    placeholder="Contoh: Mengantar Rektor Dinas ke Surabaya"
                    value={formName}
                    onChange={(e) => {
                      setFormName(e.target.value);
                      setFormCustomName(e.target.value);
                    }}
                    className="rounded-xl border-slate-200 focus:border-teal-400 focus:ring-teal-400/20 text-base sm:text-sm"
                    required
                    autoFocus
                    autoComplete="off"
                  />
                </div>

                {/* Rute Perjalanan (Destinasi) */}
                <div className="space-y-2">
                  <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">
                    Rute Perjalanan (Destinasi)
                  </Label>
                  <div className="space-y-2">
                    {formPoints.map((point, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-slate-400 w-16 text-right select-none">
                          {idx === 0 ? 'Mulai (Pool)' : idx === formPoints.length - 1 ? 'Tujuan Akhir' : `Singgah ${idx}`}
                        </span>
                        <div className="relative flex-1">
                          <Input
                            placeholder={idx === 0 ? 'Contoh: Pool Unipdu, Jombang' : 'Nama kota/gedung/lokasi'}
                            value={point}
                            onChange={(e) => {
                              const val = e.target.value;
                              setFormPoints(prev => {
                                const copy = [...prev];
                                copy[idx] = val;
                                return copy;
                              });
                              setCalculatedDistanceKm(0);
                              setCalculatedDurationHours(0);
                              setRouteError('');
                            }}
                            className="rounded-xl border-slate-200 focus:border-teal-400 focus:ring-teal-400/20 text-base sm:text-sm pr-2 h-10"
                            required
                            autoComplete="off"
                          />
                        </div>
                        {formPoints.length > 2 && idx > 0 && idx < formPoints.length - 1 && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setFormPoints(prev => prev.filter((_, i) => i !== idx));
                              setCalculatedDistanceKm(0);
                              setCalculatedDurationHours(0);
                              setRouteError('');
                            }}
                            className="h-8 w-8 p-0 text-slate-400 hover:text-rose-500 rounded-xl"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="flex gap-2 pt-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setFormPoints(prev => {
                          const copy = [...prev];
                          copy.splice(copy.length - 1, 0, '');
                          return copy;
                        });
                        setCalculatedDistanceKm(0);
                        setCalculatedDurationHours(0);
                        setRouteError('');
                      }}
                      className="text-[11px] font-bold border-slate-200 rounded-xl hover:bg-slate-50 text-slate-600 px-3 h-8"
                    >
                      + Tambah Titik Singgah
                    </Button>

                    <Button
                      type="button"
                      size="sm"
                      disabled={isCalculatingRoute || formPoints.some(p => !p.trim())}
                      onClick={handleCalculateRoute}
                      className="text-[11px] font-bold bg-teal-600 hover:bg-teal-700 text-white rounded-xl px-3 h-8 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isCalculatingRoute ? 'Menghitung...' : '✓ Cek Rute & Jarak'}
                    </Button>
                  </div>
                </div>

                {routeError && (
                  <div className="p-3 text-xs bg-rose-50 border border-rose-200 text-rose-700 rounded-xl font-medium">
                    ⚠️ {routeError}
                  </div>
                )}

                {calculatedDistanceKm > 0 && JSON.stringify(formPoints) === JSON.stringify(routeCalculatedPoints) && (
                  <div className="p-3.5 bg-emerald-50 border border-emerald-100 rounded-xl space-y-1.5 animate-in fade-in duration-200">
                    <div className="flex justify-between text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                      <span>Rincian Rute Terverifikasi</span>
                      <span className="text-emerald-600 font-extrabold">Terhitung</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <div className="bg-white p-2 rounded-lg border border-slate-100 text-center">
                        <span className="block text-[9px] text-slate-400 font-bold uppercase">Jarak Tempuh</span>
                        <span className="text-sm font-extrabold text-slate-800">{calculatedDistanceKm} km</span>
                      </div>
                      <div className="bg-white p-2 rounded-lg border border-slate-100 text-center">
                        <span className="block text-[9px] text-slate-400 font-bold uppercase">Estimasi Waktu</span>
                        <span className="text-sm font-extrabold text-slate-800">{calculatedDurationHours} jam</span>
                      </div>
                    </div>
                    <div className="pt-2 text-center border-t border-dashed border-slate-200">
                      <span className="text-[9px] font-bold text-slate-400 uppercase block">Estimasi Uang SPJ</span>
                      <span className="text-sm font-black text-teal-600">
                        {fmtRp(calculateSopirDefaultFee(
                          formTripType,
                          formVehicleType,
                          formIsOvernight,
                          formDate,
                          formFuelFee ? (parseInt(formFuelFee.replace(/\D/g, ''), 10) || 0) : 0,
                          formTollParkingFee ? (parseInt(formTollParkingFee.replace(/\D/g, ''), 10) || 0) : 0,
                          calculatedDistanceKm,
                          calculatedDurationHours
                        ))}
                      </span>
                    </div>
                  </div>
                )}

                {calculatedDistanceKm > 0 && JSON.stringify(formPoints) !== JSON.stringify(routeCalculatedPoints) && (
                  <div className="p-3 text-xs bg-amber-50 border border-amber-200 text-amber-700 rounded-xl font-medium">
                    ⚠️ Rute telah diubah. Silakan klik "Cek Rute & Jarak" kembali sebelum mengirim.
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  {/* Tipe Perjalanan */}
                  <div className="space-y-1.5">
                    <Label htmlFor="tripType" className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                      Tipe Perjalanan
                    </Label>
                    <Select
                      value={formTripType}
                      onValueChange={(val: any) => setFormTripType(val)}
                    >
                      <SelectTrigger className="w-full text-sm font-bold text-slate-700 bg-white rounded-xl border border-slate-200 h-10 px-3">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl border-slate-100 shadow-xl bg-white">
                        <SelectItem value="Dalam Kota">Dalam Kota</SelectItem>
                        <SelectItem value="Luar Kota">Luar Kota</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Jenis Kendaraan */}
                  <div className="space-y-1.5">
                    <Label htmlFor="vehicleType" className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                      Jenis Kendaraan
                    </Label>
                    <Select
                      value={formVehicleType}
                      onValueChange={(val: any) => setFormVehicleType(val)}
                    >
                      <SelectTrigger className="w-full text-sm font-bold text-slate-700 bg-white rounded-xl border border-slate-200 h-10 px-3">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl border-slate-100 shadow-xl bg-white">
                        <SelectItem value="Mobil Kecil">Mobil Kecil</SelectItem>
                        <SelectItem value="Bus/Truk">Bus / Truk</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Menginap Checkbox */}
                <div className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <Checkbox
                    id="isOvernight"
                    checked={formIsOvernight}
                    onCheckedChange={(checked) => setFormIsOvernight(!!checked)}
                    className="rounded border-slate-300 data-[state=checked]:bg-teal-600 data-[state=checked]:border-teal-600"
                  />
                  <Label htmlFor="isOvernight" className="text-xs font-bold text-slate-600 cursor-pointer select-none">
                    Perjalanan Menginap (Overnight)
                  </Label>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {/* Biaya BBM */}
                  <div className="space-y-1.5">
                    <Label htmlFor="fuelFee" className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                      BBM (Reimburse)
                    </Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 pointer-events-none">Rp</span>
                      <Input
                        id="fuelFee"
                        type="text"
                        placeholder="0"
                        value={formFuelFee}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '');
                          setFormFuelFee(val ? Number(val).toLocaleString('id-ID') : '');
                        }}
                        className="pl-8 rounded-xl border-slate-200 focus:border-teal-400 focus:ring-teal-400/20 text-base sm:text-sm font-semibold text-slate-700"
                      />
                    </div>
                  </div>

                  {/* Biaya Tol & Parkir */}
                  <div className="space-y-1.5">
                    <Label htmlFor="tollParkingFee" className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                      Tol & Parkir (Reimburse)
                    </Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 pointer-events-none">Rp</span>
                      <Input
                        id="tollParkingFee"
                        type="text"
                        placeholder="0"
                        value={formTollParkingFee}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '');
                          setFormTollParkingFee(val ? Number(val).toLocaleString('id-ID') : '');
                        }}
                        className="pl-8 rounded-xl border-slate-200 focus:border-teal-400 focus:ring-teal-400/20 text-base sm:text-sm font-semibold text-slate-700"
                      />
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* Free text input for other job categories */
              <div className="space-y-1.5 animate-in fade-in duration-200">
                <Label htmlFor="activityNameInput" className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Nama Kegiatan
                </Label>
                <Input
                  id="activityNameInput"
                  placeholder="Masukkan nama kegiatan..."
                  value={formName}
                  onChange={(e) => {
                    setFormName(e.target.value);
                    setFormCustomName(e.target.value);
                  }}
                  className="rounded-xl border-slate-200 focus:border-teal-400 focus:ring-teal-400/20 text-base sm:text-sm"
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
                className="rounded-xl border-slate-200 focus:border-teal-400 focus:ring-teal-400/20 text-base sm:text-sm"
                required
              />
            </div>

            {/* Time Range */}
            <div className={formActivityType === 'Buang Sampah' ? 'grid grid-cols-1' : 'grid grid-cols-2 gap-3'}>
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
                    className="pl-9 rounded-xl border-slate-200 focus:border-teal-400 focus:ring-teal-400/20 text-base sm:text-sm"
                    required
                  />
                </div>
              </div>
              {formActivityType !== 'Buang Sampah' && (
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
                      className="pl-9 rounded-xl border-slate-200 focus:border-teal-400 focus:ring-teal-400/20 text-base sm:text-sm"
                      required
                    />
                  </div>
                </div>
              )}
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
                disabled={submitting || (isSopir && (calculatedDistanceKm <= 0 || JSON.stringify(formPoints) !== JSON.stringify(routeCalculatedPoints)))}
                className="flex-1 rounded-xl bg-gradient-to-r from-teal-500 to-cyan-600 text-white font-bold shadow-md shadow-teal-200 hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
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

      {/* ── Complete Driver Journey Dialog ─────────────────────────────── */}
      <Dialog open={activeReportingJourney !== null} onOpenChange={(open) => { if (!open) setActiveReportingJourney(null); }}>
        <DialogContent className="sm:max-w-md max-w-[calc(100%-2rem)] rounded-3xl border-none shadow-2xl bg-white p-0 overflow-hidden">
          <div className="bg-gradient-to-r from-indigo-600 to-indigo-700 p-5 pb-4">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold text-white flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-white" /> Report Selesai Perjalanan
              </DialogTitle>
              <DialogDescription className="text-indigo-100 text-xs mt-1">
                Masukkan rincian nyata perjalanan Anda untuk melengkapi laporan pertanggungjawaban (SPJ).
              </DialogDescription>
            </DialogHeader>
          </div>

          <form onSubmit={handleCompleteJourneySubmit} className="p-5 space-y-4">
            {/* Keperluan & Info Mobil */}
            {activeReportingJourney && (
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-100 text-slate-600 text-xs space-y-1 font-medium">
                <div>Keperluan: <strong className="text-slate-800">{activeReportingJourney.activityName}</strong></div>
                <div>Rute Jalan: <strong className="text-slate-800">{activeReportingJourney.startPoint.split(',')[0]} → {activeReportingJourney.endPoint}</strong></div>
                <div>Kendaraan: <strong className="text-slate-800">{activeReportingJourney.vehicleName}</strong></div>
                <div>Tanggal: <strong className="text-slate-800">{activeReportingJourney.activityDate ? new Date(activeReportingJourney.activityDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}</strong></div>
                <div className="pt-1.5 border-t border-slate-200/60 mt-1.5 flex justify-between font-bold text-indigo-600">
                  <span>Biaya Operasional</span>
                  <span>{fmtRp(activeReportingJourney.totalOperationalCost)}</span>
                </div>
              </div>
            )}

            {/* Jam Berangkat / Tiba */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="journeyTimeStart" className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Jam Berangkat
                </Label>
                <Input
                  id="journeyTimeStart"
                  type="time"
                  value={formTimeStart}
                  onChange={(e) => setFormTimeStart(e.target.value)}
                  className="rounded-xl border-slate-200 focus:border-indigo-400 focus:ring-indigo-400/20 text-sm h-10 px-3"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="journeyTimeEnd" className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Jam Tiba / Selesai
                </Label>
                <Input
                  id="journeyTimeEnd"
                  type="time"
                  value={formTimeEnd}
                  onChange={(e) => setFormTimeEnd(e.target.value)}
                  className="rounded-xl border-slate-200 focus:border-indigo-400 focus:ring-indigo-400/20 text-sm h-10 px-3"
                  required
                />
              </div>
            </div>

            {/* Reimburse BBM Row */}
            <div className="space-y-1.5">
              <Label htmlFor="journeyFuel" className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Reimburse BBM
              </Label>
              <div className="grid grid-cols-4 gap-2 items-end">
                <div className="col-span-3 relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">Rp</span>
                  <Input
                    id="journeyFuel"
                    placeholder="0"
                    value={formFuelFee}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, '');
                      setFormFuelFee(val ? Number(val).toLocaleString('id-ID') : '');
                    }}
                    className="pl-8 rounded-xl border-slate-200 focus:border-indigo-400 focus:ring-indigo-400/20 text-xs h-10 w-full"
                  />
                </div>
                <div className="col-span-1">
                  <input
                    type="file"
                    ref={fuelFileInputRef}
                    accept="image/*,application/pdf"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleUploadReceipt(f, 'bbm');
                    }}
                    className="hidden"
                  />
                  <Button
                    type="button"
                    onClick={() => fuelFileInputRef.current?.click()}
                    disabled={uploadingFuelReceipt}
                    className={`w-full rounded-xl text-xs font-bold h-10 border transition-all ${
                      formFuelReceiptUrl
                        ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200'
                        : 'bg-slate-50 hover:bg-slate-100 text-slate-600 border-slate-200'
                    }`}
                  >
                    {uploadingFuelReceipt ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin mx-auto text-slate-500" />
                    ) : formFuelReceiptUrl ? (
                      '✓ Bukti'
                    ) : (
                      'Bukti'
                    )}
                  </Button>
                </div>
              </div>
            </div>

            {/* Tol & Parkir Row */}
            <div className="space-y-1.5">
              <Label htmlFor="journeyToll" className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Tol & Parkir
              </Label>
              <div className="grid grid-cols-4 gap-2 items-end">
                <div className="col-span-3 relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">Rp</span>
                  <Input
                    id="journeyToll"
                    placeholder="0"
                    value={formTollParkingFee}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, '');
                      setFormTollParkingFee(val ? Number(val).toLocaleString('id-ID') : '');
                    }}
                    className="pl-8 rounded-xl border-slate-200 focus:border-indigo-400 focus:ring-indigo-400/20 text-xs h-10 w-full"
                  />
                </div>
                <div className="col-span-1">
                  <input
                    type="file"
                    ref={tollFileInputRef}
                    accept="image/*,application/pdf"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleUploadReceipt(f, 'toll');
                    }}
                    className="hidden"
                  />
                  <Button
                    type="button"
                    onClick={() => tollFileInputRef.current?.click()}
                    disabled={uploadingTollReceipt}
                    className={`w-full rounded-xl text-xs font-bold h-10 border transition-all ${
                      formTollReceiptUrl
                        ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200'
                        : 'bg-slate-50 hover:bg-slate-100 text-slate-600 border-slate-200'
                    }`}
                  >
                    {uploadingTollReceipt ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin mx-auto text-slate-500" />
                    ) : formTollReceiptUrl ? (
                      '✓ Bukti'
                    ) : (
                      'Bukti'
                    )}
                  </Button>
                </div>
              </div>
            </div>

            {/* Menginap */}
            <div className="flex items-center gap-2 pt-1">
              <input
                id="journeyOvernight"
                type="checkbox"
                checked={formIsOvernight}
                onChange={(e) => setFormIsOvernight(e.target.checked)}
                className="rounded text-indigo-600 focus:ring-indigo-500 h-4 w-4"
              />
              <Label htmlFor="journeyOvernight" className="text-xs font-bold text-slate-600 cursor-pointer">
                Menginap (Overnight Allowance: +Rp50.000)
              </Label>
            </div>

            <div className="flex gap-3 pt-3 border-t border-slate-100">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setActiveReportingJourney(null)}
                className="flex-1 rounded-xl font-bold text-slate-500 hover:bg-slate-50 text-xs h-10.5"
              >
                Batal
              </Button>
              <Button
                type="submit"
                disabled={submitting}
                className="flex-1 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-700 text-white font-bold text-xs h-10.5 shadow-md shadow-indigo-200"
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : null}
                Kirim Laporan
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
