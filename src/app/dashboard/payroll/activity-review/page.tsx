"use client";

import React, { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import { FloatingSnackbar } from '@/components/ui/floating-snackbar';
import GlobalHeader from '@/components/GlobalHeader';
import UraianNavToggles from '@/components/UraianNavToggles';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import SatkerPekaryaNavBar from '@/components/SatkerPekaryaNavBar';
import { ImageExifViewer } from '@/components/ImageExifViewer';
import type { PhotoAuditMetadata, PhotoEvidence } from '@/lib/payroll/domain';
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

  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  Info,
  AlertTriangle,
  Search,
  Filter,
  Banknote,
  Users,
  CalendarDays,
  ClipboardCheck,
  ShieldCheck,
  Eye,
  ThumbsUp,
  ThumbsDown,
  RefreshCw,
  ChevronRight,
  Compass,
  Trash2,
  Plus,
  Lock,
  Edit2,
  MapPin,
  Maximize2,
  Camera,
  PackageSearch,
  Images,
} from 'lucide-react';

import { db } from '@/lib/firebase';
import {
  collection,
  getDocs,
  query,
  where,
  onSnapshot,
  type DocumentData,
  type QueryConstraint,
  type QuerySnapshot,
} from 'firebase/firestore';
import { MONTHS_ID } from '@/utils/rekapConfig';
import { syncActivityToPayslip } from '@/utils/payslipSync';
import { authenticatedJson, createFinancialRequestId } from '@/lib/payroll/client';
import {
  pekaryaPayrollPeriodForDate,
  pekaryaPayrollWindow,
} from '@/lib/payroll/pekaryaSpj';
import { calculateDriverNetWage } from '@/lib/payroll/driverJourney';
import {
  DriverJourneyAuditDialog,
  type DriverReviewPayload,
} from '@/components/DriverJourneyAuditDialog';

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
  dateStart?: string;
  dateEnd?: string;
  isMultiDay?: boolean;
  status: 'pending' | 'approved' | 'declined';
  fee: number;
  hasUangMakan?: boolean;
  declineReason?: string;
  submittedAt?: any;
  reviewedAt?: any;
  reviewedBy?: string;
  // SOPIR specific fields
  tripType?: 'Dalam Kota' | 'Luar Kota';
  vehicleType?: string;
  nightCount?: number;
  fuelFee?: number;
  tollParkingFee?: number;
  points?: string[];
  distanceKm?: number;
  durationHours?: number;
  journeyId?: string;
  fuelReceiptUrl?: string;
  tollReceiptUrl?: string;
  fuelReceiptEvidence?: PhotoEvidence[];
  tollReceiptEvidence?: PhotoEvidence[];
  upahBersih?: number;
  extraMealAllowance?: number;
  extraFuelCost?: number;
  extraTollCost?: number;
  extraDistanceKm?: number;
  extraOperationalCost?: number;
  actualMealAllowance?: number;
  ndalemMealMoneyReceived?: number;
  positiveReimburseDelta?: number;
  extraActivities?: any[];
  vehicleRate?: number;
  baseOperationalCost?: number;
  fuelProcurementMode?: 'hold_accumulate' | 'procure_release' | 'standard_direct';
  heldFuelAmount?: number;
  procuredAccumulatedAmount?: number;
  fuelAllowanceForSettlement?: number;
  fuelTotalAllocation?: number;
  mealAllowance?: number;
  preAuthorizedMeal?: number;
  preAuthorizedToll?: number;
  totalOperationalCost?: number;
  totalPreAuthorizedAllowance?: number;
  totalActualSpent?: number;
  reimburseDelta?: number;
  unspentCash?: number;
  remainingUnspentCash?: number;
  baseDriverWage?: number;
  submittedFeeEstimate?: number;
  componentJarak?: number;
  componentWaktu?: number;
  nightPremium?: number;
  customDurationPP?: number;
  startPoint?: string;
  endPoint?: string;
  // SATPAM specific fields
  reportKind?:
    | 'satpam_spj'
    | 'satpam_found_item'
    | 'satpam_reprimand'
    | 'satpam_shift_assignment'
    | string;
  identityAnomalies?: string[];
  payrollPeriod?: string;
  sourceOccurrenceId?: string;
  sourceOccurrenceRevision?: number;
  anomalyCodes?: string[];
  reportedShiftName?: string;
  suggestedShiftName?: string;
  submittedDutyDate?: string;
  submittedShiftName?: string;
  submittedPostId?: string;
  submittedEmployeeId?: string;
  submittedPayType?: string;
  plannedEmployeeId?: string | null;
  plannedEmployeeName?: string | null;
  auditorActionAt?: any;
  shiftName?: string;
  shiftType?: string;
  postId?: string;
  postName?: string;
  photoUrl?: string | null;
  photoAuditMetadata?: PhotoAuditMetadata | null;
  itemName?: string;
  proofPhotos?: PhotoEvidence[];
  submittedFeeRecommendation?: number;
  submissionRevision?: number;
  dutyDate?: string;
  ketuaShiftId?: string;
  ketuaShiftName?: string;
  assignmentKind?: 'primary' | 'extra';
  coveredEmployeeId?: string | null;
  overtimeReason?: string | null;
  absenceKind?: string;
  scheduleRelation?: string | null;
}

interface SatpamShiftGroup {
  occurrenceId: string;
  dutyDate: string;
  shiftName: string;
  ketuaShiftName: string;
  /** Paid post assignments the Kepala SatKer must audit. */
  assignments: ActivityReport[];
  /** Rest-day / covered-absence rows, informational only (fee 0). */
  offDuty: ActivityReport[];
  pendingCount: number;
  approvedCount: number;
  declinedCount: number;
  photoCount: number;
  totalFee: number;
  revision: number;
  suggestedShiftName: string;
  submittedDutyDate: string;
  submittedShiftName: string;
  anomalyCodes: string[];
  hasAuditorEdit: boolean;
}

interface SatpamAuditorEditRow {
  reportId?: string;
  assignmentKind: 'primary' | 'extra';
  postId: string;
  employeeId: string;
  shiftType: string;
  coveredEmployeeId?: string;
  overtimeReason?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isWeekend(dateStr: string): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const day = d.getDay(); // 0 = Sunday, 6 = Saturday
  return day === 0 || day === 6;
}

function calculateSopirDefaultFee(
  _tripType?: string,
  _vehicleType?: string,
  nightCount = 0,
  _activityDate?: string,
  _fuelFee?: number,
  _tollParkingFee?: number,
  distanceKm?: number,
  durationHours?: number
): number {
  return calculateDriverNetWage(distanceKm || 0, durationHours || 0, nightCount);
}

function fmtRp(val: number): string {
  return 'Rp' + val.toLocaleString('id-ID');
}

function formatPayrollWindowLabel(period: string): string {
  const [periodYear, periodMonth] = period.split('-').map(Number);
  const { startsOn, endsOn } = pekaryaPayrollWindow(period);
  const [startYear, startMonth, startDay] = startsOn.split('-').map(Number);
  const [endYear, endMonth, endDay] = endsOn.split('-').map(Number);
  const monthName = MONTHS_ID[periodMonth - 1] || period;
  const startMonthName = MONTHS_ID[startMonth - 1]?.slice(0, 3) || String(startMonth);
  const endMonthName = MONTHS_ID[endMonth - 1]?.slice(0, 3) || String(endMonth);
  const startWithYear = startYear !== periodYear ? `${startDay} ${startMonthName} ${startYear}` : `${startDay} ${startMonthName}`;
  const endWithYear = endYear !== periodYear ? `${endDay} ${endMonthName} ${endYear}` : `${endDay} ${endMonthName}`;
  const range = startMonth === endMonth && startYear === endYear
    ? `${startDay} – ${endDay} ${endMonthName}`
    : `${startWithYear} – ${endWithYear}`;
  return `${monthName} (${range})`;
}

function calculateDefaultFee(
  timeStart: string,
  timeEnd: string,
  activityType?: string,
  activityName?: string,
  jobCategory?: string,
  tripType?: 'Dalam Kota' | 'Luar Kota',
  vehicleType?: string,
  nightCount?: number,
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
      nightCount,
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

  let minutes = (eh * 60 + em) - (sh * 60 + sm);
  if (minutes < 0) minutes += 24 * 60;

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
const CLEANING_CATEGORIES = ['KEBERSIHAN', 'TEKNISI', 'SOPIR', 'KEBERSIHAN_PONTI', 'SATPAM', 'PEKARYA', 'PONTI'];
const JOB_CATEGORY_LABELS: Record<string, string> = {
  KEBERSIHAN: 'Kebersihan',
  TEKNISI: 'Teknisi',
  SOPIR: 'Sopir',
  KEBERSIHAN_PONTI: 'Kebersihan Ponti',
  SATPAM: 'Satpam',
  PEKARYA: 'Pekarya (Umum)',
  PONTI: 'Ponti',
};
const SATPAM_POST_OPTIONS = [
  'Pos 1',
  'Pos 2',
  'Pos 3',
  'Pos 4',
  'Pos 5',
  'Pos 6',
  'Pos 7',
  'Pos 8',
  'Pos 9',
];

const SATPAM_ANOMALY_LABELS: Record<string, string> = {
  MISSING_POSTS: 'Pos belum lengkap',
  DUPLICATE_POST: 'Pos ganda',
  DUPLICATE_GUARD: 'Petugas ganda',
  KETUA_NOT_ASSIGNED: 'Ketua tidak tercantum',
  ROTA_MISMATCH: 'Berbeda dari rota',
  COVER_DETAILS_INCOMPLETE: 'Detail cover belum lengkap',
  MISSING_PHOTO: 'Foto tidak lengkap',
  INACTIVE_OR_MISMATCHED_GUARD: 'Status/kategori perlu diselesaikan',
  HOLIDAY_CALENDAR_MISSING: 'Kalender upah belum tersedia',
  PAY_CLASSIFICATION_MISMATCH: 'Klasifikasi upah perlu diperbaiki',
  DUTY_PLAN_MISSING: 'Rencana dinas belum ada',
  DUTY_PLAN_STALE: 'Rencana dinas perlu diperbarui',
  DUTY_PLAN_BACKFILL_PENDING: 'Rencana dinas backfill (terbit setelah shift mulai)',
  ACTUAL_ROSTER_DIFFERS: 'Petugas beda dari rencana',
  POS9_GUARD_MISMATCH: 'Pos 9 memakai petugas pengganti',
  EXTRA_NOT_OFF_DUTY: 'Lembur di luar hari libur',
  EXTRA_WITH_INCOMPLETE_PRIMARY_ROSTER: 'Lembur saat regu belum lengkap',
  ABSENCE_WORK_CONFLICT: 'Konflik izin & tugas',
  DUTY_PLAN_CHANGED_AFTER_REPORT: 'Rencana diubah setelah laporan',
};

// ─── Inline Photo with Stored Audit Metadata Overlay ──────────────────────────

function InlinePhotoWithExif({
  photoUrl,
  title,
  activityDate,
  auditMetadata,
  onZoom,
  className,
}: {
  photoUrl: string;
  title: string;
  activityDate?: string;
  auditMetadata?: PhotoAuditMetadata | null;
  onZoom: () => void;
  className?: string;
}) {
  const dateMismatch = Boolean(
    auditMetadata?.capturedAt && activityDate && auditMetadata.capturedAt.split('T')[0] !== activityDate,
  );
  const hasCoordinates = auditMetadata?.latitude !== null && auditMetadata?.latitude !== undefined &&
    auditMetadata?.longitude !== null && auditMetadata?.longitude !== undefined;
  const capturedDate = auditMetadata?.capturedAt
    ? auditMetadata.capturedAt.replace('T', ' ').slice(0, 19)
    : null;
  const mapsUrl = hasCoordinates
    ? `https://www.google.com/maps?q=${auditMetadata.latitude!.toFixed(6)},${auditMetadata.longitude!.toFixed(6)}`
    : undefined;

  return (
    <div className={`relative group rounded-xl overflow-hidden border border-slate-200 bg-slate-950 shadow-xs ${className || 'aspect-[4/3]'}`}>
      {/* Photo Image */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photoUrl}
        alt={title}
        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 cursor-pointer"
        onClick={onZoom}
        loading="lazy"
      />

      {/* Semi-transparent Glass Pill Overlay for Datetime & Location (Top Left) */}
      <div className="absolute top-2 left-2 right-2 pointer-events-none flex flex-col items-start gap-1 z-10 max-w-[95%]">
        {auditMetadata ? (
          <>
            {/* Datetime Pill */}
            {capturedDate ? (
              <div
                className={`flex items-center gap-1 text-[9.5px] px-2.5 py-0.5 rounded-full backdrop-blur-md border shadow-md ${
                  dateMismatch
                    ? 'bg-amber-950/40 text-amber-200 border-amber-500/50 font-black'
                    : 'bg-black/40 text-white border-white/25 font-bold'
                }`}
                title={dateMismatch ? `Tanggal foto (${capturedDate}) beda dengan SPJ (${activityDate})` : capturedDate}
              >
                {dateMismatch ? (
                  <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                ) : (
                  <Clock className="w-3 h-3 text-emerald-400 shrink-0" />
                )}
                <span className="truncate">
                  {dateMismatch ? `${capturedDate.slice(0, 10)} (Beda Tgl)` : capturedDate}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1 text-[8.5px] font-bold text-slate-300 bg-black/35 backdrop-blur-md border border-white/15 px-2 py-0.5 rounded-full shadow-md">
                <Clock className="w-2.5 h-2.5 text-slate-400 shrink-0" />
                <span>Tanpa Waktu Foto</span>
              </div>
            )}

            {/* GPS Location Pill */}
            {hasCoordinates ? (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="pointer-events-auto flex items-center gap-1 text-[9px] font-extrabold text-sky-300 hover:text-white bg-black/40 hover:bg-black/65 backdrop-blur-md border border-sky-400/35 px-2.5 py-0.5 rounded-full shadow-md transition-colors truncate max-w-full"
                title={auditMetadata.locationAddress || 'Buka lokasi di Google Maps'}
              >
                <MapPin className="w-2.5 h-2.5 text-sky-400 shrink-0" />
                <span className="truncate">{auditMetadata.locationName || `${auditMetadata.latitude!.toFixed(4)}, ${auditMetadata.longitude!.toFixed(4)}`} ↗</span>
              </a>
            ) : (
              <div className="flex items-center gap-1 text-[8.5px] font-bold text-slate-300 bg-black/35 backdrop-blur-md border border-white/15 px-2 py-0.5 rounded-full shadow-md">
                <Compass className="w-2.5 h-2.5 text-slate-400 shrink-0" />
                <span>Tanpa GPS</span>
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center gap-1 text-[8.5px] font-bold text-slate-300 bg-black/35 backdrop-blur-md border border-white/15 px-2 py-0.5 rounded-full shadow-md">
            <Info className="w-2.5 h-2.5 text-slate-400 shrink-0" />
            <span>Metadata Belum Direkam</span>
          </div>
        )}
      </div>

      {/* Hover Zoom Overlay */}
      <div
        onClick={onZoom}
        className="absolute inset-0 bg-slate-950/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center p-2 cursor-pointer z-20"
      >
        <button
          type="button"
          onClick={onZoom}
          className="px-2.5 py-1.5 bg-white/95 hover:bg-white text-slate-900 rounded-lg font-extrabold text-[10px] flex items-center gap-1 shadow-md transition-all backdrop-blur-xs cursor-pointer"
        >
          <Eye className="w-3 h-3 text-indigo-600" /> Perbesar & Metadata
        </button>
      </div>

      {/* Quick Zoom Pill (Bottom Right) */}
      <button
        type="button"
        onClick={onZoom}
        className="absolute bottom-1.5 right-1.5 bg-black/40 hover:bg-black/70 backdrop-blur-md text-white rounded-full text-[8.5px] font-extrabold px-2 py-0.5 flex items-center gap-1 cursor-pointer z-10 border border-white/20 shadow-xs transition-colors"
      >
        <Maximize2 className="w-2.5 h-2.5 text-slate-300" /> Zoom
      </button>
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ActivityReviewPage() {
  const router = useRouter();
  const { profile, user } = useAuth();

  // ── Period ──
  // Default to the current month, but interpret the selected month using the
  // shared Pekarya payroll window. July 2026 is the transition period from
  // 26 June through 31 July rather than a calendar month.
  const [month, setMonth] = useState(() => new Date().getMonth() + 1);
  const [year, setYear] = useState(() => new Date().getFullYear());

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
  const [reportTypeFilter, setReportTypeFilter] = useState<
    'all' | 'activity' | 'found_item' | 'reprimand' | 'shift'
  >('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // ── Row Fees (Inline input values) ──
  const [rowFees, setRowFees] = useState<Record<string, string>>({});
  const [rowUangMakan, setRowUangMakan] = useState<Record<string, boolean>>({});
  const [foundItemAdjustmentReasons, setFoundItemAdjustmentReasons] = useState<
    Record<string, string>
  >({});
  const [activityRevisionHistory, setActivityRevisionHistory] = useState<
    Record<
      string,
      Array<{
        revision: number;
        submittedAt: string | null;
        itemName: string;
        activityDate: string;
        photoCount: number;
      }>
    >
  >({});
  const [loadingActivityRevisionId, setLoadingActivityRevisionId] = useState<string | null>(null);

  // ── Decline Modal ──
  const [declineTarget, setDeclineTarget] = useState<ActivityReport | null>(null);
  const [declineReason, setDeclineReason] = useState('');

  // ── Admin Delete Modal (super_admin only, approved/declined reports) ──
  const [deleteTarget, setDeleteTarget] = useState<ActivityReport | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [deletingActivity, setDeletingActivity] = useState(false);

  // ── Driver (Sopir) Audit Modal State ──
  // The audit form itself lives in <DriverJourneyAuditDialog>, shared with the
  // Driver Journeys page so both entry points settle pay identically.
  const [auditActivity, setAuditActivity] = useState<ActivityReport | null>(null);
  const [selectedExifImage, setSelectedExifImage] = useState<{ url: string; title: string; activityDate?: string; auditMetadata?: PhotoAuditMetadata | null } | null>(null);

  // ── Satpam Shift Audit State ──
  const [expandedShiftIds, setExpandedShiftIds] = useState<Set<string>>(new Set());
  // Per-assignment verdicts, keyed by report id. Absent means "approve".
  const [shiftDecisions, setShiftDecisions] = useState<Record<string, 'approve' | 'decline'>>({});
  const [shiftDeclineReasons, setShiftDeclineReasons] = useState<Record<string, string>>({});
  const [shiftReviewNotes, setShiftReviewNotes] = useState<Record<string, string>>({});
  const [submittingShiftId, setSubmittingShiftId] = useState<string | null>(null);
  const [auditorEditShift, setAuditorEditShift] = useState<SatpamShiftGroup | null>(null);
  const [auditorEditDate, setAuditorEditDate] = useState('');
  const [auditorEditShiftName, setAuditorEditShiftName] = useState('Pagi');
  const [auditorEditReason, setAuditorEditReason] = useState('');
  const [auditorEditRows, setAuditorEditRows] = useState<SatpamAuditorEditRow[]>([]);
  const [satpamEmployeeDirectory, setSatpamEmployeeDirectory] = useState<Array<{ id: string; name: string; isActive: boolean }>>([]);
  const [savingAuditorEdit, setSavingAuditorEdit] = useState(false);

  const handleOpenAuditSopir = (activity: ActivityReport) => {
    setAuditActivity(activity);
  };

  const handleApproveSopirAudit = async (driverReview: DriverReviewPayload) => {
    if (!auditActivity || !user) return;
    setActionLoading(true);
    try {
      await authenticatedJson('/api/pekarya/activities/review', {
        method: 'POST',
        body: JSON.stringify({
          requestId: createFinancialRequestId('driver_review'),
          action: 'approve_driver',
          reason: 'Audit dan persetujuan perjalanan oleh Kepala SatKer',
          items: [{ reportId: auditActivity.id, driverReview }],
        }),
      });

      setSuccessMsg(`Laporan perjalanan dinas ${auditActivity.employeeName} berhasil diaudit dan disetujui.`);
      setAuditActivity(null);
      fetchActivities();
      try {
        await syncActivityToPayslip(
          db,
          auditActivity.employeeId,
          pekaryaPayrollPeriodForDate(auditActivity.activityDate),
        );
      } catch (syncErr) {
        console.error('Error syncing payslip in handleApproveSopirAudit:', syncErr);
      }
    } catch (err) {
      console.error('Error approving driver audit:', err);
      setErrorMsg(
        err instanceof Error ? err.message : 'Gagal menyetujui laporan perjalanan dinas.',
      );
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

    if (profile?.role !== 'super_admin' && allowedCategories.length === 0) {
      setActivities([]);
      setLoading(false);
      return;
    }

    const payrollWindow = pekaryaPayrollWindow(periodToken);
    const snapshots = new Map<string, QuerySnapshot<DocumentData>>();
    const settledPeriods = new Set<string>();
    let cancelled = false;

    const applySnapshots = () => {
      if (cancelled) return;
      const reportsById = new Map<string, ActivityReport>();
      snapshots.forEach((snap) => {
        snap.docs.forEach((document) => {
          const report = {
            id: document.id,
            ...document.data(),
          } as ActivityReport;
          if (
            report.activityDate >= payrollWindow.startsOn &&
            report.activityDate <= payrollWindow.endsOn
          ) {
            reportsById.set(report.id, report);
          }
        });
      });
      const list = Array.from(reportsById.values());

      // Sort ascending by submittedAt (oldest submission first)
      list.sort((a, b) => {
        const getMs = (ts: any): number => {
          if (!ts) return 0;
          if (typeof ts.toMillis === 'function') return ts.toMillis();
          if (typeof ts.seconds === 'number') return ts.seconds * 1000;
          return 0;
        };
        const diff = getMs(a.submittedAt) - getMs(b.submittedAt);
        if (diff !== 0) return diff;
        // Fallback: older activity date first
        return a.activityDate.localeCompare(b.activityDate);
      });

      // Prefill pending activities with default calculated fees, merging with existing inputs
      setRowFees(prev => {
        const newFees = { ...prev };
        list.forEach(a => {
          if (a.status === 'pending') {
            if (newFees[a.id] === undefined) {
              const defaultFee =
                a.reportKind === 'satpam_found_item'
                  ? a.submittedFeeRecommendation || 5_000
                  : a.reportKind === 'satpam_reprimand'
                    ? a.submittedFeeRecommendation || 15_000
                    : calculateDefaultFee(
                      a.timeStart,
                      a.timeEnd,
                      a.activityType,
                      a.activityName,
                      a.jobCategory,
                      a.tripType,
                      a.vehicleType,
                      a.nightCount,
                      a.activityDate,
                      a.fuelFee,
                      a.tollParkingFee,
                      a.distanceKm,
                      a.durationHours,
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
      if (settledPeriods.size === payrollWindow.sourceMonths.length) setLoading(false);
    };

    const unsubscribes = payrollWindow.sourceMonths.map((sourcePeriod) => {
      const constraints: QueryConstraint[] = [
        where('period', '==', sourcePeriod),
        ...(profile?.role === 'super_admin'
          ? []
          : [where('jobCategory', 'in', allowedCategories)]),
      ];
      const q = query(collection(db, 'ActivityReports'), ...constraints);
      return onSnapshot(
        q,
        (snap) => {
          snapshots.set(sourcePeriod, snap);
          settledPeriods.add(sourcePeriod);
          applySnapshots();
        },
        (err) => {
          console.error(`Error listening to ${sourcePeriod} activity reports:`, err);
          settledPeriods.add(sourcePeriod);
          setErrorMsg('Gagal memuat data laporan kegiatan.');
          if (settledPeriods.size === payrollWindow.sourceMonths.length) setLoading(false);
        },
      );
    });

    return () => {
      cancelled = true;
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    };
  }, [hasAccess, periodToken, profile?.role, allowedCategories, refreshTrigger]);

  // ── Filtered activities ──
  const filteredActivities = useMemo(() => {
    let filtered = activities;
    if (statusFilter !== 'all') {
      filtered = filtered.filter(a => a.status === statusFilter);
    }
    if (reportTypeFilter === 'found_item') {
      filtered = filtered.filter((activity) => activity.reportKind === 'satpam_found_item');
    } else if (reportTypeFilter === 'reprimand') {
      filtered = filtered.filter((activity) => activity.reportKind === 'satpam_reprimand');
    } else if (reportTypeFilter === 'shift') {
      filtered = filtered.filter((activity) => Boolean(activity.sourceOccurrenceId));
    } else if (reportTypeFilter === 'activity') {
      filtered = filtered.filter(
        (activity) =>
          activity.reportKind !== 'satpam_found_item' &&
          activity.reportKind !== 'satpam_reprimand' &&
          !activity.sourceOccurrenceId,
      );
    }
    if (categoryFilter !== 'all') {
      filtered = filtered.filter((activity) => activity.jobCategory === categoryFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(a =>
        a.employeeName.toLowerCase().includes(q) ||
        a.activityName.toLowerCase().includes(q)
      );
    }
    return filtered;
  }, [activities, reportTypeFilter, categoryFilter, statusFilter, searchQuery]);

  // ── Satpam shift grouping ──
  // Satpam reports are audited as a whole shift occurrence rather than as ten
  // unrelated rows, so the Kepala SatKer can compare each post photo against
  // the guard the Ketua Shift claims was standing there.
  const satpamShiftGroups = useMemo(() => {
    const groups = new Map<string, SatpamShiftGroup>();
    filteredActivities.forEach((activity) => {
      if (activity.jobCategory !== 'SATPAM') return;
      const occurrenceId = activity.sourceOccurrenceId;
      // Legacy Satpam rows predate shift occurrences; they fall through to the
      // flat table so historical periods still render.
      if (!occurrenceId) return;

      let group = groups.get(occurrenceId);
      if (!group) {
        group = {
          occurrenceId,
          dutyDate: activity.dutyDate || activity.activityDate,
          shiftName: activity.shiftName || '',
          ketuaShiftName: activity.ketuaShiftName || '',
          assignments: [],
          offDuty: [],
          pendingCount: 0,
          approvedCount: 0,
          declinedCount: 0,
          photoCount: 0,
          totalFee: 0,
          revision: Number(activity.sourceOccurrenceRevision || 1),
          suggestedShiftName: activity.suggestedShiftName || activity.shiftName || '',
          submittedDutyDate: activity.submittedDutyDate || activity.dutyDate || activity.activityDate,
          submittedShiftName: activity.submittedShiftName || activity.reportedShiftName || activity.shiftName || '',
          anomalyCodes: [],
          hasAuditorEdit: Boolean(activity.auditorActionAt),
        };
        groups.set(occurrenceId, group);
      }

      if (activity.shiftType === 'Off-Duty') {
        group.offDuty.push(activity);
        return;
      }

      group.assignments.push(activity);
      group.revision = Math.max(group.revision, Number(activity.sourceOccurrenceRevision || 1));
      group.hasAuditorEdit = group.hasAuditorEdit || Boolean(activity.auditorActionAt);
      for (const code of activity.anomalyCodes || []) {
        if (!group.anomalyCodes.includes(code)) group.anomalyCodes.push(code);
      }
      if (activity.status === 'pending') group.pendingCount += 1;
      if (activity.status === 'approved') {
        group.approvedCount += 1;
        group.totalFee += activity.fee || 0;
      }
      if (activity.status === 'declined') group.declinedCount += 1;
      if (activity.photoUrl) group.photoCount += 1;
    });

    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        assignments: group.assignments.sort((a, b) =>
          (a.postId || a.postName || '').localeCompare(b.postId || b.postName || '', undefined, {
            numeric: true,
          }),
        ),
      }))
      .sort((a, b) =>
        a.dutyDate.localeCompare(b.dutyDate) ||
        a.shiftName.localeCompare(b.shiftName),
      );
  }, [filteredActivities]);

  const groupedSatpamIds = useMemo(() => {
    const ids = new Set<string>();
    satpamShiftGroups.forEach((group) => {
      group.assignments.forEach((item) => ids.add(item.id));
      group.offDuty.forEach((item) => ids.add(item.id));
    });
    return ids;
  }, [satpamShiftGroups]);

  const ungroupedActivities = useMemo(
    () =>
      filteredActivities
        .filter((activity) => !groupedSatpamIds.has(activity.id))
        .sort((left, right) => {
          const dateA = left.activityDate || left.dutyDate || '';
          const dateB = right.activityDate || right.dutyDate || '';
          const dateDiff = dateA.localeCompare(dateB);
          if (dateDiff !== 0) return dateDiff;
          const getMs = (ts: any): number => {
            if (!ts) return 0;
            if (typeof ts.toMillis === 'function') return ts.toMillis();
            if (typeof ts.seconds === 'number') return ts.seconds * 1000;
            return 0;
          };
          return getMs(left.submittedAt) - getMs(right.submittedAt);
        }),
    [filteredActivities, groupedSatpamIds],
  );

  type ReviewTableItem =
    | { type: 'satpam_group'; id: string; date: string; group: SatpamShiftGroup }
    | { type: 'activity'; id: string; date: string; activity: ActivityReport };

  const combinedTableItems = useMemo(() => {
    const items: ReviewTableItem[] = [];

    satpamShiftGroups.forEach((group) => {
      items.push({
        type: 'satpam_group',
        id: group.occurrenceId,
        date: group.dutyDate || group.submittedDutyDate || '',
        group,
      });
    });

    ungroupedActivities.forEach((activity) => {
      items.push({
        type: 'activity',
        id: activity.id,
        date: activity.activityDate || activity.dutyDate || '',
        activity,
      });
    });

    const getTimestampMs = (item: ReviewTableItem): number => {
      if (item.type === 'activity') {
        const ts = item.activity.submittedAt;
        if (ts) {
          if (typeof ts.toMillis === 'function') return ts.toMillis();
          if (typeof ts.seconds === 'number') return ts.seconds * 1000;
        }
      } else if (item.type === 'satpam_group') {
        let minMs = Infinity;
        item.group.assignments.forEach((a) => {
          const ts = a.submittedAt;
          if (ts) {
            const ms = typeof ts.toMillis === 'function' ? ts.toMillis() : typeof ts.seconds === 'number' ? ts.seconds * 1000 : 0;
            if (ms > 0 && ms < minMs) minMs = ms;
          }
        });
        if (minMs !== Infinity) return minMs;
      }
      return 0;
    };

    items.sort((a, b) => {
      // Primary sort: Date ascending (oldest date to latest date)
      const dateDiff = a.date.localeCompare(b.date);
      if (dateDiff !== 0) return dateDiff;

      // Secondary sort: Submitted timestamp ascending
      const timeA = getTimestampMs(a);
      const timeB = getTimestampMs(b);
      if (timeA !== 0 && timeB !== 0 && timeA !== timeB) {
        return timeA - timeB;
      }

      return a.id.localeCompare(b.id);
    });

    return items;
  }, [satpamShiftGroups, ungroupedActivities]);

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
  // Grouped Satpam shifts are audited through their own endpoint, so they must
  // never be swept into the bulk pekarya review (which rejects SATPAM anyway).
  const pendingInView = ungroupedActivities.filter(
    (activity) =>
      activity.status === 'pending' &&
      activity.reportKind !== 'satpam_found_item' &&
      activity.reportKind !== 'satpam_reprimand',
  );
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
    const isFoundItem = activity.reportKind === 'satpam_found_item';
    const isReprimand = activity.reportKind === 'satpam_reprimand';
    const isPhotoOnlyReport = isFoundItem || isReprimand;
    const adjustmentReason = (foundItemAdjustmentReasons[activity.id] || '').trim();

    isActionLoadingRef.current = true;
    setActionLoading(true);
    try {
      await authenticatedJson('/api/pekarya/activities/review', {
        method: 'POST',
        body: JSON.stringify({
          requestId: createFinancialRequestId('activity_approve'),
          action: 'approve',
          reason: isPhotoOnlyReport
            ? adjustmentReason ||
              (isReprimand
                ? 'Persetujuan teguran pengendara oleh Kepala SatKer'
                : 'Persetujuan penemuan barang oleh Kepala SatKer')
            : 'Persetujuan kegiatan oleh Kepala SatKer',
          items: [{
            reportId: activity.id,
            fee: feeVal,
            hasUangMakan: isPhotoOnlyReport ? false : !!rowUangMakan[activity.id],
            ...(isPhotoOnlyReport && adjustmentReason
              ? { reason: adjustmentReason }
              : {}),
          }],
        }),
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
      setFoundItemAdjustmentReasons((current) => {
        const next = { ...current };
        delete next[activity.id];
        return next;
      });

      fetchActivities();
      try {
        await syncActivityToPayslip(
          db,
          activity.employeeId,
          pekaryaPayrollPeriodForDate(activity.activityDate),
        );
      } catch (syncErr) {
        console.error('Error syncing payslip in handleApproveRow:', syncErr);
      }
    } catch (err) {
      console.error('Error approving activity:', err);
      setErrorMsg(err instanceof Error ? err.message : 'Gagal menyetujui kegiatan.');
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
      const reason = declineReason.trim();
      await authenticatedJson('/api/pekarya/activities/review', {
        method: 'POST',
        body: JSON.stringify({
          requestId: createFinancialRequestId('activity_decline'),
          action: 'decline',
          reason,
          items: [{ reportId: declineTarget.id, reason }],
        }),
      });
      setSuccessMsg(`Kegiatan "${declineTarget.activityName}" oleh ${declineTarget.employeeName} telah ditolak.`);
      setDeclineTarget(null);
      setDeclineReason('');
      fetchActivities();
      try {
        await syncActivityToPayslip(
          db,
          declineTarget.employeeId,
          pekaryaPayrollPeriodForDate(declineTarget.activityDate),
        );
      } catch (syncErr) {
        console.error('Error syncing payslip in handleDecline:', syncErr);
      }
    } catch (err) {
      console.error('Error declining activity:', err);
      setErrorMsg(err instanceof Error ? err.message : 'Gagal menolak kegiatan.');
    } finally {
      isActionLoadingRef.current = false;
      setActionLoading(false);
    }
  };

  // ── Admin Delete Handler (super_admin only; already-reviewed reports) ──
  const handleDeleteActivity = async () => {
    if (isActionLoadingRef.current || !deleteTarget || !user) return;
    const reason = deleteReason.trim();
    if (reason.length < 8) {
      setErrorMsg('Isi alasan penghapusan sekurang-kurangnya 8 karakter.');
      return;
    }

    isActionLoadingRef.current = true;
    setDeletingActivity(true);
    try {
      await authenticatedJson('/api/pekarya/activities/admin-delete', {
        method: 'POST',
        body: JSON.stringify({
          requestId: createFinancialRequestId('activity_admin_delete'),
          reportId: deleteTarget.id,
          reason,
        }),
      });
      setSuccessMsg(`Laporan "${deleteTarget.activityName}" oleh ${deleteTarget.employeeName} berhasil dihapus.`);
      const employeeId = deleteTarget.employeeId;
      const dutyDate = deleteTarget.dutyDate || deleteTarget.activityDate;
      const period = deleteTarget.payrollPeriod || (dutyDate ? pekaryaPayrollPeriodForDate(dutyDate) : '');
      setDeleteTarget(null);
      setDeleteReason('');
      fetchActivities();
      try {
        if (period) await syncActivityToPayslip(db, employeeId, period);
      } catch (syncErr) {
        console.error('Error syncing payslip after admin delete:', syncErr);
      }
    } catch (err) {
      console.error('Error deleting activity:', err);
      setErrorMsg(err instanceof Error ? err.message : 'Gagal menghapus laporan.');
    } finally {
      isActionLoadingRef.current = false;
      setDeletingActivity(false);
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
      await authenticatedJson('/api/pekarya/activities/review', {
        method: 'POST',
        body: JSON.stringify({
          requestId: createFinancialRequestId('activities_approve'),
          action: 'approve',
          reason: 'Persetujuan massal kegiatan oleh Kepala SatKer',
          items: updates.map((update) => ({
            reportId: update.id,
            fee: update.fee,
            hasUangMakan: !!rowUangMakan[update.id],
          })),
        }),
      });
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
          if (act && act.employeeId && act.activityDate) {
            uniqueKeys.add(
              `${act.employeeId}::${pekaryaPayrollPeriodForDate(act.activityDate)}`,
            );
          }
        });

        // Sequential on purpose: employees sharing a jobCategory+period all sync
        // into the same UraianGaji document, and firing these concurrently
        // causes Firestore transactions to collide on that one document.
        for (const key of uniqueKeys) {
          const [empId, per] = key.split('::');
          await syncActivityToPayslip(db, empId, per);
        }
      } catch (syncErr) {
        console.error('Error syncing payslips in handleBulkApprove:', syncErr);
      }
    } catch (err) {
      console.error('Error bulk approving activities:', err);
      setErrorMsg(
        err instanceof Error ? err.message : 'Gagal menyetujui kegiatan secara massal.',
      );
    } finally {
      isActionLoadingRef.current = false;
      setActionLoading(false);
    }
  };

  // ── Satpam Shift & Activity Audit Handlers ──
  const [expandedActivityIds, setExpandedActivityIds] = useState<Set<string>>(new Set());

  const loadActivityRevisionHistory = async (activity: ActivityReport) => {
    if (activityRevisionHistory[activity.id]) return;
    setLoadingActivityRevisionId(activity.id);
    try {
      const response = await authenticatedJson<{
        revisions: Array<{
          revision: number;
          submittedAt: string | null;
          itemName: string;
          activityDate: string;
          photoCount: number;
        }>;
      }>(
        `/api/pekarya/activities?revisions=true&reportId=${encodeURIComponent(activity.id)}`,
        { method: 'GET' },
      );
      setActivityRevisionHistory((current) => ({
        ...current,
        [activity.id]: response.revisions,
      }));
    } catch (error) {
      console.error('Error loading activity revision history:', error);
      setErrorMsg(
        error instanceof Error
          ? error.message
          : 'Gagal memuat riwayat revisi laporan.',
      );
    } finally {
      setLoadingActivityRevisionId(null);
    }
  };

  const toggleActivityExpanded = (activity: ActivityReport) => {
    if (activity.jobCategory === 'SOPIR') return;
    const isOpening = !expandedActivityIds.has(activity.id);
    setExpandedActivityIds(prev =>
      prev.has(activity.id) ? new Set() : new Set([activity.id]),
    );
    setExpandedShiftIds(new Set());
    if (
      isOpening &&
      (activity.reportKind === 'satpam_found_item' || activity.reportKind === 'satpam_reprimand')
    ) {
      void loadActivityRevisionHistory(activity);
    }
  };

  const toggleShiftExpanded = (occurrenceId: string) => {
    setExpandedShiftIds(prev => (prev.has(occurrenceId) ? new Set() : new Set([occurrenceId])));
    setExpandedActivityIds(new Set());
  };

  const setAssignmentVerdict = (reportId: string, verdict: 'approve' | 'decline') => {
    setShiftDecisions(prev => ({ ...prev, [reportId]: verdict }));
  };

  const handleBulkSetShiftVerdict = (group: SatpamShiftGroup, verdict: 'approve' | 'decline') => {
    setShiftDecisions(prev => {
      const updated = { ...prev };
      group.assignments.forEach(item => {
        if (item.status === 'pending') {
          updated[item.id] = verdict;
        }
      });
      return updated;
    });
  };

  const openAuditorShiftEdit = async (group: SatpamShiftGroup) => {
    setErrorMsg('');
    try {
      if (satpamEmployeeDirectory.length === 0) {
        const directory = await authenticatedJson<{
          employees: Array<{ id: string; name: string; isActive: boolean }>;
        }>('/api/satpam/shifts/review', { method: 'GET' });
        setSatpamEmployeeDirectory(directory.employees);
      }
      setAuditorEditShift(group);
      setAuditorEditDate(group.dutyDate);
      setAuditorEditShiftName(group.shiftName || 'Pagi');
      setAuditorEditReason('');
      setAuditorEditRows(
        group.assignments
          .filter((assignment) => assignment.status === 'pending')
          .map((assignment) => ({
            reportId: assignment.id,
            assignmentKind: assignment.assignmentKind || 'primary',
            postId: assignment.postId || 'Pos 1',
            employeeId: assignment.employeeId,
            shiftType: assignment.shiftType || 'Harian',
            coveredEmployeeId: assignment.coveredEmployeeId || undefined,
            overtimeReason: assignment.overtimeReason || undefined,
          })),
      );
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Data Satpam gagal dimuat.');
    }
  };

  const updateAuditorEditRow = (
    index: number,
    patch: Partial<SatpamAuditorEditRow>,
  ) => {
    setAuditorEditRows((rows) =>
      rows.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row,
      ),
    );
  };

  const handleSaveAuditorShiftEdit = async () => {
    if (!auditorEditShift || savingAuditorEdit) return;
    if (auditorEditRows.length < 1) {
      setErrorMsg('Sisakan sekurang-kurangnya satu penugasan untuk disimpan.');
      return;
    }
    if (auditorEditReason.trim().length < 8) {
      setErrorMsg('Alasan edit auditor wajib diisi sekurang-kurangnya 8 karakter.');
      return;
    }
    setSavingAuditorEdit(true);
    setErrorMsg('');
    try {
      await authenticatedJson('/api/satpam/shifts/review', {
        method: 'PUT',
        body: JSON.stringify({
          requestId: createFinancialRequestId('satpam_shift_auditor_edit'),
          occurrenceId: auditorEditShift.occurrenceId,
          expectedRevision: auditorEditShift.revision,
          dutyDate: auditorEditDate,
          shiftName: auditorEditShiftName,
          reason: auditorEditReason.trim(),
          assignments: auditorEditRows,
        }),
      });
      setSuccessMsg('Koreksi auditor tersimpan. Ketua Shift tidak dapat mengubah laporan ini lagi.');
      setAuditorEditShift(null);
      setAuditorEditRows([]);
      fetchActivities();
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Koreksi auditor gagal disimpan.');
    } finally {
      setSavingAuditorEdit(false);
    }
  };

  const handleSubmitShiftReview = async (group: SatpamShiftGroup) => {
    if (submittingShiftId || !user) return;

    const pendingAssignments = group.assignments.filter(item => item.status === 'pending');
    if (pendingAssignments.length === 0) return;

    const note = (shiftReviewNotes[group.occurrenceId] || '').trim();

    const decisions = pendingAssignments.map(item => {
      const verdict = shiftDecisions[item.id] || 'approve';
      return {
        reportId: item.id,
        action: verdict,
        ...(verdict === 'decline'
          ? { reason: (shiftDeclineReasons[item.id] || '').trim() }
          : {}),
      };
    });

    const needsNote = decisions.some((decision) => decision.action === 'decline');
    if (needsNote && note.length < 8) {
      setErrorMsg('Isi catatan auditor sekurang-kurangnya 8 karakter untuk menolak laporan.');
      return;
    }



    setSubmittingShiftId(group.occurrenceId);
    setErrorMsg('');
    try {
      await authenticatedJson('/api/satpam/shifts/review', {
        method: 'POST',
        body: JSON.stringify({
          requestId: createFinancialRequestId('satpam_shift_review'),
          occurrenceId: group.occurrenceId,
          reason: note,
          decisions,
        }),
      });

      const declinedTotal = decisions.filter(d => d.action === 'decline').length;
      setSuccessMsg(
        declinedTotal === 0
          ? `Shift ${group.shiftName} ${group.dutyDate} disetujui sepenuhnya (${decisions.length} penugasan).`
          : `Shift ${group.shiftName} ${group.dutyDate} diaudit: ${decisions.length - declinedTotal} disetujui, ${declinedTotal} ditolak.`,
      );

      setShiftReviewNotes(prev => {
        const next = { ...prev };
        delete next[group.occurrenceId];
        return next;
      });
      fetchActivities();

      // Refresh each affected guard's payslip so approved fees land immediately.
      // Satpam periods come straight off the report: they use a calendar-month
      // boundary, not the pekarya day-25 cutoff, so deriving the period here
      // would sync the wrong month for duty dates after the 25th.
      try {
        const uniqueKeys = new Set<string>();
        pendingAssignments.forEach(item => {
          const dutyDate = item.dutyDate || item.activityDate || '';
          const itemPeriod =
            item.payrollPeriod || (dutyDate ? pekaryaPayrollPeriodForDate(dutyDate) : '');
          if (item.employeeId && itemPeriod) {
            uniqueKeys.add(`${item.employeeId}::${itemPeriod}`);
          }
        });
        // Sequential on purpose: a whole shift's guards share one jobCategory
        // and period, so they all sync into the same UraianGaji document.
        // Firing these concurrently (e.g. after "Setujui Semua Pos") causes
        // Firestore transactions to collide on that one document and some
        // guards' fees never land.
        for (const key of uniqueKeys) {
          const [empId, per] = key.split('::');
          await syncActivityToPayslip(db, empId, per);
        }
      } catch (syncErr) {
        console.error('Error syncing payslips after Satpam shift review:', syncErr);
      }
    } catch (err) {
      console.error('Error reviewing Satpam shift:', err);
      setErrorMsg(err instanceof Error ? err.message : 'Gagal mengaudit shift Satpam.');
    } finally {
      setSubmittingShiftId(null);
    }
  };

  // ── Bulk Decline Handler ──
  const handleBulkDecline = async () => {
    if (isActionLoadingRef.current || !user || selectedIds.size === 0) return;
    if (!confirm(`Apakah Anda yakin ingin menolak ${selectedIds.size} kegiatan yang dipilih?`)) return;

    isActionLoadingRef.current = true;
    setActionLoading(true);
    try {
      await authenticatedJson('/api/pekarya/activities/review', {
        method: 'POST',
        body: JSON.stringify({
          requestId: createFinancialRequestId('activities_decline'),
          action: 'decline',
          reason: 'Ditolak secara massal oleh Kepala SatKer.',
          items: Array.from(selectedIds).map((reportId) => ({
            reportId,
            reason: 'Ditolak secara massal oleh Kepala SatKer.',
          })),
        }),
      });
      setSuccessMsg(`${selectedIds.size} kegiatan berhasil ditolak.`);
      setSelectedIds(new Set());
      fetchActivities();
      try {
        const uniqueKeys = new Set<string>();
        selectedIds.forEach(id => {
          const act = activities.find(a => a.id === id);
          if (act && act.employeeId && act.activityDate) {
            uniqueKeys.add(
              `${act.employeeId}::${pekaryaPayrollPeriodForDate(act.activityDate)}`,
            );
          }
        });

        // Sequential on purpose: employees sharing a jobCategory+period all sync
        // into the same UraianGaji document, and firing these concurrently
        // causes Firestore transactions to collide on that one document.
        for (const key of uniqueKeys) {
          const [empId, per] = key.split('::');
          await syncActivityToPayslip(db, empId, per);
        }
      } catch (syncErr) {
        console.error('Error syncing payslips in handleBulkDecline:', syncErr);
      }
    } catch (err) {
      console.error('Error bulk declining:', err);
      setErrorMsg(
        err instanceof Error ? err.message : 'Gagal menolak kegiatan secara massal.',
      );
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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/80 to-slate-100 font-sans selection:bg-indigo-100 relative text-slate-800">
      {/* Subtle decorative blobs */}
      <div className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full bg-indigo-100/40 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] rounded-full bg-purple-100/30 blur-[100px] pointer-events-none" />

      {/* ── Top Navigation ─────────────────────────────────────────── */}
      {profile?.role === 'super_admin' ? (
        <GlobalHeader />
      ) : profile?.role === 'satker_head' ? (
        <Suspense fallback={null}>
          <SatkerPekaryaNavBar />
        </Suspense>
      ) : null}

      <div className="max-w-[1600px] mx-auto p-6 lg:p-8 space-y-6 relative z-10">

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-50 flex items-center justify-center text-teal-600 shadow-inner">
              <ClipboardCheck className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl lg:text-3xl font-bold text-slate-900 tracking-tight">Review Laporan Kegiatan</h1>
              <p className="text-slate-500 text-sm">Tinjau, setujui, atau tolak kegiatan yang dilaporkan oleh pekarya.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Select value={String(month)} onValueChange={(v) => v && setMonth(parseInt(v))}>
              <SelectTrigger className="w-44 bg-white shadow-sm border-slate-200 rounded-xl font-semibold hover:border-indigo-300 transition-all">
                <SelectValue>
                  {formatPayrollWindowLabel(periodToken)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="rounded-xl border-slate-100 shadow-xl bg-white">
                {MONTHS_ID.map((_, i) => {
                  const now = new Date();
                  const currentYear = now.getFullYear();
                  const currentMonth = now.getMonth() + 1;
                  const monthVal = i + 1;
                  if (year === currentYear && monthVal > currentMonth) return null;
                  if (profile?.role !== 'super_admin' && year === 2026 && monthVal < 7) return null;
                  return (
                    <SelectItem key={i + 1} value={String(i + 1)}>
                      {formatPayrollWindowLabel(`${year}-${String(monthVal).padStart(2, '0')}`)}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <Select value={String(year)} onValueChange={(v) => v && setYear(parseInt(v))}>
              <SelectTrigger className="w-28 bg-white shadow-sm border-slate-200 rounded-xl font-semibold hover:border-indigo-300 transition-all">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl border-slate-100 shadow-xl bg-white">
                {YEARS.map(y => {
                  const now = new Date();
                  const currentYear = now.getFullYear();
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
        </div>

        {/* ── Uraian Navigation Toggles (Super Admin) ──────────────────── */}
        <UraianNavToggles />

        {/* ── Notifications ──────────────────────────────────────────── */}
        <FloatingSnackbar
          message={errorMsg
            ? { type: 'error', text: errorMsg }
            : successMsg
              ? { type: 'success', text: successMsg }
              : null}
        />

        {/* ── Filters Row ────────────────────────────────────────────── */}
        <Card className="bg-white rounded-2xl shadow-sm border-none">
          <CardContent className="p-4">
            <div className="flex flex-col md:flex-row md:items-center gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <Filter className="h-4 w-4 shrink-0 text-slate-400" />
                <Select
                  value={reportTypeFilter}
                  onValueChange={(value) =>
                    value &&
                    setReportTypeFilter(
                      value as 'all' | 'activity' | 'found_item' | 'reprimand' | 'shift',
                    )
                  }
                >
                  <SelectTrigger className="h-12 w-full min-w-56 rounded-xl border-slate-200 bg-white text-base font-bold md:w-64">
                    <SelectValue>
                      {reportTypeFilter === 'all' && 'Semua Jenis Laporan'}
                      {reportTypeFilter === 'activity' && 'SPJ / Kegiatan Pribadi'}
                      {reportTypeFilter === 'found_item' && 'Penemuan Barang'}
                      {reportTypeFilter === 'reprimand' && 'Teguran Pengendara'}
                      {reportTypeFilter === 'shift' && 'Shift Regu Satpam'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="rounded-xl bg-white">
                    <SelectItem value="all" className="min-h-11 text-base">Semua Jenis Laporan</SelectItem>
                    <SelectItem value="activity" className="min-h-11 text-base">SPJ / Kegiatan Pribadi</SelectItem>
                    <SelectItem value="found_item" className="min-h-11 text-base">Penemuan Barang</SelectItem>
                    <SelectItem value="reprimand" className="min-h-11 text-base">Teguran Pengendara</SelectItem>
                    <SelectItem value="shift" className="min-h-11 text-base">Shift Regu Satpam</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {profile?.role === 'super_admin' && (
                <div className="flex min-w-0 items-center gap-2">
                  <Select
                    value={categoryFilter}
                    onValueChange={(value) => value && setCategoryFilter(value)}
                  >
                    <SelectTrigger className="h-12 w-full min-w-56 rounded-xl border-slate-200 bg-white text-base font-bold md:w-56">
                      <SelectValue>
                        {categoryFilter === 'all'
                          ? 'Semua Kategori'
                          : JOB_CATEGORY_LABELS[categoryFilter] || categoryFilter}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent className="rounded-xl bg-white">
                      <SelectItem value="all" className="min-h-11 text-base">Semua Kategori</SelectItem>
                      {CLEANING_CATEGORIES.map((category) => (
                        <SelectItem key={category} value={category} className="min-h-11 text-base">
                          {JOB_CATEGORY_LABELS[category] || category}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
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
            className={`rounded-2xl shadow-sm text-center p-4 transition-all cursor-pointer ${statusFilter === 'pending'
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
            className={`rounded-2xl shadow-sm text-center p-4 transition-all cursor-pointer ${statusFilter === 'approved'
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
            className={`rounded-2xl shadow-sm text-center p-4 transition-all cursor-pointer ${statusFilter === 'declined'
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
            className={`rounded-2xl shadow-sm text-center p-4 transition-all cursor-pointer ${statusFilter === 'all'
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
                  <TableHeader className="bg-slate-50/60 sticky top-0 z-20">
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
                      <TableHead className="font-bold text-slate-500">Waktu & Tanggal</TableHead>
                      <TableHead className="font-bold text-slate-500">Fee</TableHead>
                      <TableHead className="font-bold text-slate-500">Uang Makan</TableHead>
                      <TableHead className="font-bold text-slate-500 text-right pr-6 sticky right-0 bg-slate-50 z-20 shadow-[-8px_0_12px_-4px_rgba(0,0,0,0.06)]">
                        Aksi
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {combinedTableItems.map((item) => {
                      if (item.type === 'satpam_group') {
                        const group = item.group;
                        const isExpanded = expandedShiftIds.has(group.occurrenceId);
                        const isPending = group.pendingCount > 0;
                        const isSubmitting = submittingShiftId === group.occurrenceId;
                        const noteValue = shiftReviewNotes[group.occurrenceId] || '';
                        const missingPhotos = group.assignments.length - group.photoCount;

                        const displayShiftFee = group.assignments.reduce((sum, assignItem) => {
                          // Pending rows use the auditor's in-progress local choice
                          // ('approve'/'decline'); decided rows use the persisted
                          // status ('approved'/'declined') — the two vocabularies
                          // differ by a trailing "d", so they can't share one check.
                          const isApproved =
                            assignItem.status === 'pending'
                              ? (shiftDecisions[assignItem.id] || 'approve') === 'approve'
                              : assignItem.status === 'approved';
                          return isApproved ? sum + (assignItem.fee || 0) : sum;
                        }, 0);

                      return (
                        <React.Fragment key={group.occurrenceId}>
                          <TableRow
                            onClick={() => toggleShiftExpanded(group.occurrenceId)}
                            className={`border-slate-100 cursor-pointer transition-colors ${
                              isExpanded ? 'bg-indigo-50/50' : 'hover:bg-slate-50/60'
                            }`}
                          >
                            <TableCell className="pl-4 w-8" />
                            <TableCell className="font-bold text-slate-800 text-sm py-3.5">
                              <div className="flex items-center gap-2">
                                <ShieldCheck className="w-4 h-4 text-indigo-600 shrink-0" />
                                <span>Shift {group.shiftName || '—'}</span>
                              </div>
                              <span className="block text-[10px] font-semibold text-slate-400 mt-0.5">
                                Ketua: {group.ketuaShiftName || '—'}
                              </span>
                            </TableCell>
                            <TableCell className="text-sm text-slate-700 font-medium">
                              <span className="font-semibold">
                                {group.assignments.length} penugasan pos
                              </span>
                              <div className="flex flex-wrap gap-1 mt-1">
                                <Badge
                                  variant="outline"
                                  className={`text-[9px] px-1.5 py-0 h-4 font-bold ${
                                    missingPhotos === 0
                                      ? 'border-emerald-200 text-emerald-700 bg-emerald-50'
                                      : 'border-amber-200 text-amber-700 bg-amber-50'
                                  }`}
                                >
                                  {group.photoCount}/{group.assignments.length} berfoto
                                </Badge>
                                {group.offDuty.length > 0 && (
                                  <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 border-slate-200 text-slate-500 font-medium">
                                    {group.offDuty.length} libur
                                  </Badge>
                                )}
                                {group.anomalyCodes.length > 0 && (
                                  <Badge className="text-[9px] px-1.5 py-0 h-4 border-none bg-rose-100 text-rose-800 font-bold">
                                    {group.anomalyCodes.length} pengecualian
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-sm text-slate-600 font-medium">
                              <span className="font-semibold text-slate-800 block">{group.dutyDate}</span>
                              {statusFilter === 'all' && (
                                <div className="mt-0.5">
                                  {isPending ? (
                                    <Badge className="bg-amber-100 text-amber-800 border-none font-bold text-[10px]">
                                      {group.pendingCount} Menunggu Audit
                                    </Badge>
                                  ) : group.declinedCount > 0 ? (
                                    <Badge className="bg-rose-100 text-rose-800 border-none font-bold text-[10px]">
                                      {group.approvedCount} Disetujui · {group.declinedCount} Ditolak
                                    </Badge>
                                  ) : (
                                    <Badge className="bg-emerald-100 text-emerald-800 border-none font-bold text-[10px]">
                                      Disetujui
                                    </Badge>
                                  )}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="font-bold text-slate-800 text-sm">
                              {fmtRp(displayShiftFee)}
                            </TableCell>
                            <TableCell className="text-sm text-slate-400">—</TableCell>
                            <TableCell className="text-right pr-6 sticky right-0 bg-white group-hover:bg-slate-50/60 z-10 shadow-[-8px_0_12px_-4px_rgba(0,0,0,0.06)]">
                              <div className="flex items-center justify-end gap-2">
                                <ChevronRight
                                  className={`w-4 h-4 text-slate-400 transition-transform shrink-0 ${isExpanded ? 'rotate-90 text-indigo-600' : ''}`}
                                />
                                <span className="text-[11px] font-bold text-indigo-600">
                                  {isExpanded ? 'Tutup' : 'Audit Shift'}
                                </span>
                              </div>
                            </TableCell>
                          </TableRow>

                          {isExpanded && (
                            <TableRow className="border-slate-100 hover:bg-transparent">
                              <TableCell colSpan={7} className="bg-slate-50/70 p-4 sm:p-5">
                                <div className="space-y-3.5">
                                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-1 border-b border-slate-200/80">
                                    <div className="flex items-center gap-2 text-[11px] font-black text-slate-700 uppercase tracking-wider">
                                      <ShieldCheck className="w-4 h-4 text-indigo-600" />
                                      <span>Audit Bukti Foto Per Pos ({group.assignments.length} Pos)</span>
                                    </div>

                                    {/* Bulk Action Buttons */}
                                    {group.assignments.some(item => item.status === 'pending') && (
                                      <div className="flex items-center gap-2">
                                        <button
                                          type="button"
                                          onClick={() => openAuditorShiftEdit(group)}
                                          className="px-3 py-1.5 rounded-xl text-[10px] font-extrabold bg-indigo-100 hover:bg-indigo-200 text-indigo-800 transition-colors cursor-pointer flex items-center gap-1.5 shadow-xs"
                                        >
                                          <Edit2 className="w-3.5 h-3.5" /> Edit Auditor
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleBulkSetShiftVerdict(group, 'approve')}
                                          className="px-3 py-1.5 rounded-xl text-[10px] font-extrabold bg-emerald-100 hover:bg-emerald-200 text-emerald-800 transition-colors cursor-pointer flex items-center gap-1.5 shadow-xs"
                                        >
                                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Setujui Semua Pos
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleBulkSetShiftVerdict(group, 'decline')}
                                          className="px-3 py-1.5 rounded-xl text-[10px] font-extrabold bg-rose-100 hover:bg-rose-200 text-rose-800 transition-colors cursor-pointer flex items-center gap-1.5 shadow-xs"
                                        >
                                          <XCircle className="w-3.5 h-3.5 text-rose-600" /> Tolak Semua Pos
                                        </button>
                                      </div>
                                    )}
                                  </div>

                                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                    <div className="rounded-xl border border-slate-200 bg-white p-3">
                                      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Nilai Dikirim</p>
                                      <p className="mt-1 text-sm font-bold text-slate-800">{group.submittedDutyDate} · Shift {group.submittedShiftName || '—'}</p>
                                    </div>
                                    <div className="rounded-xl border border-blue-200 bg-blue-50 p-3">
                                      <p className="text-[10px] font-black uppercase tracking-wider text-blue-500">Saran Sistem</p>
                                      <p className="mt-1 text-sm font-bold text-blue-900">{group.dutyDate} · Shift {group.suggestedShiftName || '—'}</p>
                                    </div>
                                    <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3">
                                      <p className="text-[10px] font-black uppercase tracking-wider text-indigo-500">Nilai Auditor</p>
                                      <p className="mt-1 text-sm font-bold text-indigo-900">
                                        {group.dutyDate} · Shift {group.shiftName || '—'}
                                        {group.hasAuditorEdit ? ' · sudah dikoreksi' : ' · belum diubah'}
                                      </p>
                                    </div>
                                  </div>

                                  {group.anomalyCodes.length > 0 && (
                                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                                      <p className="text-xs font-bold text-amber-950">Pengecualian yang perlu diperiksa</p>
                                      <div className="mt-2 flex flex-wrap gap-1.5">
                                        {group.anomalyCodes.map((code) => (
                                          <Badge key={code} variant="outline" className="border-amber-300 bg-white text-amber-900 text-[10px]">
                                            {SATPAM_ANOMALY_LABELS[code] || code}
                                          </Badge>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
                                    {group.assignments.map((item) => {
                                      const verdict = shiftDecisions[item.id] || 'approve';
                                      const rowPending = item.status === 'pending';
                                      return (
                                        <div
                                          key={item.id}
                                          className={`p-3 rounded-2xl border bg-white space-y-2.5 flex flex-col justify-between transition-all ${
                                            rowPending && verdict === 'decline'
                                              ? 'border-rose-300 ring-2 ring-rose-100'
                                              : rowPending && verdict === 'approve'
                                                ? 'border-emerald-300 ring-1 ring-emerald-100/60'
                                                : 'border-slate-200'
                                          }`}
                                        >
                                          <div className="space-y-2">
                                            <div className="flex items-start justify-between gap-2">
                                              <div className="min-w-0">
                                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block truncate">
                                                  {item.postId || item.postName || 'Pos'}
                                                  {item.assignmentKind === 'extra' && ' · Lembur Sendiri'}
                                                </span>
                                                <h5 className="text-xs sm:text-sm font-extrabold text-slate-900 truncate">
                                                  {item.employeeName}
                                                </h5>
                                                <p className="text-[10px] font-bold text-slate-500 mt-0.5">
                                                  {item.shiftType} · {fmtRp(item.fee || 0)}
                                                </p>
                                                {item.plannedEmployeeId &&
                                                  item.plannedEmployeeId !== item.employeeId && (
                                                  <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] font-semibold text-amber-900">
                                                    Rencana: {item.plannedEmployeeName || item.plannedEmployeeId}
                                                    <span className="block font-bold">
                                                      Aktual: {item.employeeName}
                                                    </span>
                                                  </div>
                                                )}
                                                {item.postId === 'Pos 2' && (
                                                  <span className="mt-1 block text-[10px] font-bold text-blue-700">
                                                    Ketua Shift / Keliling
                                                  </span>
                                                )}
                                                {item.postId === 'Pos 9' && (
                                                  <span className="mt-1 block text-[10px] font-bold text-violet-700">
                                                    Pos 9 Satpam Regu
                                                  </span>
                                                )}
                                                {item.scheduleRelation === 'cross_team_pos9' && (
                                                  <span className="mt-1 block text-[10px] font-bold text-amber-700">
                                                    Pengganti lintas regu — periksa klasifikasi
                                                  </span>
                                                )}
                                              </div>
                                              {!rowPending && (
                                                <div className="flex shrink-0 items-center gap-1">
                                                  <Badge
                                                    className={`border-none font-bold text-[9px] ${
                                                      item.status === 'approved'
                                                        ? 'bg-emerald-100 text-emerald-800'
                                                        : 'bg-rose-100 text-rose-800'
                                                    }`}
                                                  >
                                                    {item.status === 'approved' ? 'Disetujui' : 'Ditolak'}
                                                  </Badge>
                                                  {profile?.role === 'super_admin' && (
                                                    <button
                                                      type="button"
                                                      title="Hapus laporan ini"
                                                      disabled={deletingActivity}
                                                      onClick={() => { setDeleteTarget(item); setDeleteReason(''); }}
                                                      className="flex h-5 w-5 items-center justify-center rounded-md text-rose-500 transition-colors hover:bg-rose-50 cursor-pointer"
                                                    >
                                                      <Trash2 className="h-3 w-3" />
                                                    </button>
                                                  )}
                                                </div>
                                              )}
                                            </div>


                                            {/* Direct Inline Photo Preview with EXIF Pills */}
                                            {item.photoUrl ? (
                                              <InlinePhotoWithExif
                                                photoUrl={item.photoUrl}
                                                title={`${item.postId || item.postName} — ${item.employeeName}`}
                                                activityDate={item.dutyDate || item.activityDate}
                                                auditMetadata={item.photoAuditMetadata}
                                                onZoom={() =>
                                                  setSelectedExifImage({
                                                    url: item.photoUrl!,
                                                    title: `${item.postId || item.postName} — ${item.employeeName}`,
                                                    activityDate: item.dutyDate || item.activityDate,
                                                    auditMetadata: item.photoAuditMetadata,
                                                  })
                                                }
                                              />
                                            ) : (
                                              <div className="w-full aspect-[4/3] bg-amber-50 border border-amber-200 text-amber-800 rounded-xl font-bold text-[11px] flex flex-col items-center justify-center gap-1 p-3 text-center">
                                                <AlertTriangle className="w-5 h-5 text-amber-600" />
                                                <span>Tanpa Bukti Foto</span>
                                              </div>
                                            )}
                                          </div>

                                          {/* Verdict Toggle Controls */}
                                          {rowPending && (
                                            <div className="space-y-2 pt-1">
                                              <div className="grid grid-cols-2 gap-1.5">
                                                <button
                                                  type="button"
                                                  onClick={() => setAssignmentVerdict(item.id, 'approve')}
                                                  className={`px-2 py-1.5 rounded-lg text-[11px] font-extrabold border transition-all cursor-pointer flex items-center justify-center gap-1 ${
                                                    verdict === 'approve'
                                                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                                                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                                                  }`}
                                                >
                                                  <CheckCircle2 className="w-3.5 h-3.5" /> Setujui
                                                </button>
                                                <button
                                                  type="button"
                                                  onClick={() => setAssignmentVerdict(item.id, 'decline')}
                                                  className={`px-2 py-1.5 rounded-lg text-[11px] font-extrabold border transition-all cursor-pointer flex items-center justify-center gap-1 ${
                                                    verdict === 'decline'
                                                      ? 'bg-rose-600 text-white border-rose-600 shadow-xs'
                                                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                                                  }`}
                                                >
                                                  <XCircle className="w-3.5 h-3.5" /> Tolak
                                                </button>
                                              </div>
                                              {verdict === 'decline' && (
                                                <Input
                                                  value={shiftDeclineReasons[item.id] || ''}
                                                  onChange={(e) =>
                                                    setShiftDeclineReasons(prev => ({
                                                      ...prev,
                                                      [item.id]: e.target.value,
                                                    }))
                                                  }
                                                  placeholder="Alasan penolakan"
                                                  className="h-8 rounded-lg text-[11px] bg-rose-50/60 border-rose-200"
                                                />
                                              )}
                                            </div>
                                          )}
                                          {!rowPending && item.declineReason && (
                                            <p className="text-[10px] font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1.5">
                                              {item.declineReason}
                                            </p>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>

                                  {group.offDuty.length > 0 && (
                                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                        Libur / Digantikan:
                                      </span>
                                      {group.offDuty.map(item => (
                                        <Badge
                                          key={item.id}
                                          variant="outline"
                                          className="text-[9px] px-1.5 py-0 h-4 border-slate-200 text-slate-500 font-medium"
                                        >
                                          {item.employeeName}
                                        </Badge>
                                      ))}
                                    </div>
                                  )}

                                  {isPending && (
                                    <div className="pt-2 border-t border-slate-200/80 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                                      <div className="flex-1 min-w-0">
                                        <Input
                                          value={noteValue}
                                          onChange={(e) =>
                                            setShiftReviewNotes(prev => ({
                                              ...prev,
                                              [group.occurrenceId]: e.target.value,
                                            }))
                                          }
                                          placeholder="Catatan audit shift (wajib jika menolak)"
                                          className="h-10 rounded-xl text-xs bg-white border-slate-200 w-full"
                                        />
                                      </div>
                                      <Button
                                        type="button"
                                        disabled={isSubmitting}
                                        onClick={() => handleSubmitShiftReview(group)}
                                        className="w-full sm:w-auto rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs h-9 px-5 gap-1.5 cursor-pointer"
                                      >
                                        {isSubmitting ? (
                                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                        ) : (
                                          <ClipboardCheck className="w-3.5 h-3.5" />
                                        )}
                                        <span>
                                          Simpan Audit ({group.pendingCount} penugasan)
                                        </span>
                                      </Button>
                                    </div>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </React.Fragment>
                      );
                    }

                    const activity = item.activity;
                    const sc = getStatusConfig(activity.status);
                      const isSelected = selectedIds.has(activity.id);
                      const isDriver = activity.jobCategory === 'SOPIR';
                      const isExpanded = !isDriver && expandedActivityIds.has(activity.id);
                      const isFoundItem = activity.reportKind === 'satpam_found_item';
                      const isReprimand = activity.reportKind === 'satpam_reprimand';
                      const isPhotoOnlyReport = isFoundItem || isReprimand;

                      return (
                        <React.Fragment key={activity.id}>
                          <TableRow
                            onClick={() => {
                              if (!isDriver) toggleActivityExpanded(activity);
                            }}
                            className={`border-slate-50 hover:bg-slate-50/40 transition-colors ${
                              !isDriver ? 'cursor-pointer' : ''
                            } ${
                              isExpanded ? 'bg-indigo-50/40' : isSelected ? 'bg-indigo-50/30' : ''
                            }`}
                          >
                            <TableCell className="pl-4">
                              {activity.status === 'pending' &&
                                activity.reportKind !== 'satpam_found_item' &&
                                activity.reportKind !== 'satpam_reprimand' && (
                                <Checkbox
                                  checked={isSelected}
                                  onCheckedChange={() => toggleSelect(activity.id)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="rounded border-slate-300 data-[state=checked]:bg-indigo-600"
                                />
                              )}
                            </TableCell>
                            <TableCell className="font-bold text-slate-800 text-sm py-3.5">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span>{activity.employeeName}</span>
                                {statusFilter === 'all' && (
                                  <Badge className={`${sc.bgClass} ${sc.textClass} border ${sc.borderClass} text-[9px] font-bold rounded-lg px-1.5 py-0`}>
                                    {sc.label}
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-sm text-slate-700 font-medium max-w-[220px]">
                              <span className="truncate block font-semibold">{activity.activityName}</span>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {activity.photoUrl ? (
                                  <Badge
                                    variant="outline"
                                    className="text-[9px] px-1.5 py-0 h-4 border-emerald-200 text-emerald-700 bg-emerald-50 font-bold inline-flex items-center gap-1"
                                  >
                                    <Camera className="w-2.5 h-2.5" /> Berfoto
                                  </Badge>
                                ) : (
                                  <Badge
                                    variant="outline"
                                    className="text-[9px] px-1.5 py-0 h-4 border-slate-200 text-slate-400 font-medium inline-flex items-center gap-1"
                                  >
                                    Tanpa Bukti Foto
                                  </Badge>
                                )}
                                {activity.reportKind === 'satpam_spj' && (
                                  <Badge className="text-[9px] px-1.5 py-0 h-4 border-none bg-teal-100 text-teal-800 font-bold">
                                    SPJ Pribadi Satpam
                                  </Badge>
                                )}
                                {activity.reportKind === 'satpam_found_item' && (
                                  <Badge className="inline-flex h-5 items-center gap-1 border-none bg-amber-100 px-2 py-0 text-[10px] font-bold text-amber-900">
                                    <PackageSearch className="h-3 w-3" /> Penemuan Barang
                                  </Badge>
                                )}
                                {activity.reportKind === 'satpam_reprimand' && (
                                  <Badge className="inline-flex h-5 items-center gap-1 border-none bg-amber-100 px-2 py-0 text-[10px] font-bold text-amber-900">
                                    <PackageSearch className="h-3 w-3" /> Teguran Pengendara
                                  </Badge>
                                )}
                                {(activity.reportKind === 'satpam_found_item' || activity.reportKind === 'satpam_reprimand') && (
                                  <Badge variant="outline" className="inline-flex h-5 items-center gap-1 border-amber-200 bg-white px-2 py-0 text-[10px] font-bold text-amber-800">
                                    <Images className="h-3 w-3" /> {activity.proofPhotos?.length || (activity.photoUrl ? 1 : 0)} foto
                                  </Badge>
                                )}
                                {(activity.identityAnomalies || []).length > 0 && (
                                  <Badge className="text-[9px] px-1.5 py-0 h-4 border-none bg-rose-100 text-rose-800 font-bold">
                                    Identitas perlu diselesaikan
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-sm text-slate-600 font-medium whitespace-nowrap">
                              <span className="font-semibold text-slate-800 block">{activity.activityDate}</span>
                              <span className="text-xs text-slate-400 font-medium">
                                {activity.reportKind === 'satpam_found_item' || activity.reportKind === 'satpam_reprimand'
                                  ? `Versi ${activity.submissionRevision || 1}`
                                  : `${activity.timeStart} – ${activity.timeEnd}`}
                              </span>
                            </TableCell>
                            <TableCell className="text-sm font-bold text-slate-700 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                              {activity.jobCategory === 'SOPIR' ? (
                                <div className="flex flex-col">
                                  <span className="text-sm font-black text-emerald-600">
                                    {fmtRp(
                                      activity.status === 'approved'
                                        ? (activity.upahBersih || 0)
                                        : (activity.submittedFeeEstimate ?? activity.baseDriverWage ?? calculateDriverNetWage(activity.distanceKm || 0, activity.durationHours || 0, activity.nightCount || 0))
                                    )}
                                  </span>
                                  {(activity.reimburseDelta || 0) > 0 && (
                                    <span className="text-[10px] text-blue-600 font-bold">
                                      +Reimburse: {fmtRp(activity.reimburseDelta || 0)}
                                    </span>
                                  )}
                                </div>
                              ) : activity.status === 'approved' && activity.fee > 0
                                ? fmtRp(activity.fee)
                                : activity.status === 'pending' ? (
                                  <div className="flex flex-col items-center gap-1">
                                    {(activity.reportKind === 'satpam_found_item' || activity.reportKind === 'satpam_reprimand') && (
                                      <span className="text-[10px] font-bold text-amber-700">
                                        Saran {fmtRp(
                                          activity.submittedFeeRecommendation ||
                                            (activity.reportKind === 'satpam_reprimand' ? 15_000 : 5_000),
                                        )}
                                      </span>
                                    )}
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
                                      className="w-32 h-8 text-center font-bold text-sm bg-slate-50 border-slate-200 focus:border-emerald-400 focus:ring-emerald-400/20 rounded-xl px-3"
                                      disabled={actionLoading}
                                    />
                                  </div>
                                ) : (
                                  <span className="text-slate-300">—</span>
                                )
                              }
                            </TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              {activity.jobCategory === 'SOPIR' ? (
                                <span className="text-[10px] font-bold text-slate-400">SOPIR SPJ</span>
                              ) : activity.status === 'pending' ? (
                                (() => {
                                  if (activity.reportKind === 'satpam_found_item' || activity.reportKind === 'satpam_reprimand') {
                                    return <span className="text-[10px] font-bold text-slate-400">Tidak berlaku</span>;
                                  }
                                  const [sh, sm] = activity.timeStart.split(':').map(Number);
                                  const [eh, em] = activity.timeEnd.split(':').map(Number);
                                  let minutes = (eh * 60 + em) - (sh * 60 + sm);
                                  if (minutes < 0) minutes += 24 * 60;
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
                                      className={`h-7 px-2.5 rounded-lg font-bold text-[10px] cursor-pointer transition-colors ${isAdded
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
                            <TableCell className={`text-right pr-6 sticky right-0 z-10 shadow-[-8px_0_12px_-4px_rgba(0,0,0,0.06)] ${
                              isExpanded ? 'bg-indigo-50/90' : isSelected ? 'bg-indigo-50/90' : 'bg-white group-hover:bg-slate-50/90'
                            }`} onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-end gap-2">
                                {!isDriver && (
                                  <ChevronRight
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggleActivityExpanded(activity);
                                    }}
                                    className={`w-4 h-4 text-slate-400 transition-transform cursor-pointer shrink-0 ${
                                      isExpanded ? 'rotate-90 text-indigo-600 font-bold' : 'hover:text-slate-600'
                                    }`}
                                  />
                                )}
                                {activity.status === 'pending' && (
                                  <>
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
                                  </>
                                )}
                                {activity.jobCategory === 'SOPIR' && activity.status !== 'pending' && (
                                  <Button
                                    size="sm"
                                    onClick={() => handleOpenAuditSopir(activity)}
                                    className="h-7 px-2.5 rounded-lg bg-slate-50 text-slate-600 hover:bg-slate-100 font-bold text-[11px] border border-slate-200 cursor-pointer"
                                  >
                                    Lihat Detail
                                  </Button>
                                )}
                                {profile?.role === 'super_admin' &&
                                  !isDriver &&
                                  activity.status !== 'pending' && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={deletingActivity}
                                    onClick={() => { setDeleteTarget(activity); setDeleteReason(''); }}
                                    className="h-7 px-2.5 rounded-lg text-rose-600 hover:bg-rose-50 font-bold text-[11px] border-rose-200 cursor-pointer"
                                  >
                                    <Trash2 className="w-3 h-3 mr-1" />
                                    Hapus
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>

                          {isExpanded && (
                            <TableRow className="border-slate-100 hover:bg-transparent">
                              <TableCell colSpan={7} className="bg-slate-50/70 p-4 sm:p-5">
                                <div className="space-y-3.5">
                                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2 border-b border-slate-200/80">
                                    <div className="flex items-center gap-2 text-xs font-black text-slate-700 uppercase tracking-wider">
                                      {isPhotoOnlyReport ? (
                                        <PackageSearch className="h-4 w-4 text-amber-600" />
                                      ) : (
                                        <Camera className="w-4 h-4 text-indigo-600" />
                                      )}
                                      <span>
                                        {isReprimand
                                          ? 'Audit Teguran Pengendara'
                                          : isFoundItem
                                            ? 'Audit Penemuan Barang'
                                            : 'Audit Bukti Foto Kegiatan'}{' '}
                                        — {activity.activityName} ({activity.employeeName})
                                      </span>
                                    </div>
                                    <Badge className="w-fit border-none bg-indigo-100 text-[10px] font-bold text-indigo-800">
                                      {activity.jobCategory || 'PEKARYA'} · Tanggal: {activity.activityDate}
                                      {!isPhotoOnlyReport &&
                                        ` (${activity.timeStart}${activity.timeEnd ? ` – ${activity.timeEnd}` : ''})`}
                                    </Badge>
                                  </div>

                                  {/* Main content layout: Shrunk photo on left matching combined cards height, cards on right */}
                                  <div className="flex flex-col lg:flex-row items-start gap-4">
                                    {/* Left: Shrunk photo(s) constrained to 280px height matching right cards */}
                                    <div className="shrink-0 space-y-1">
                                      <div className={isPhotoOnlyReport && (activity.proofPhotos?.length || 0) > 1 ? 'flex flex-wrap gap-3' : ''}>
                                        {(isPhotoOnlyReport && activity.proofPhotos?.length
                                          ? activity.proofPhotos
                                          : activity.photoUrl
                                            ? [{ url: activity.photoUrl, auditMetadata: activity.photoAuditMetadata }]
                                            : []
                                        ).length > 0 ? (
                                          (isPhotoOnlyReport && activity.proofPhotos?.length
                                            ? activity.proofPhotos
                                            : [{ url: activity.photoUrl!, auditMetadata: activity.photoAuditMetadata }]
                                          ).map((photo, index) => (
                                            <div key={photo.url} className="space-y-1">
                                              {isPhotoOnlyReport && (
                                                <p className="text-xs font-bold text-slate-500">Foto {index + 1}</p>
                                              )}
                                              <InlinePhotoWithExif
                                                photoUrl={photo.url}
                                                title={`${activity.activityName} — Foto ${index + 1}`}
                                                activityDate={activity.activityDate}
                                                auditMetadata={photo.auditMetadata}
                                                className="h-[280px] aspect-[4/3] max-w-full rounded-2xl"
                                                onZoom={() =>
                                                  setSelectedExifImage({
                                                    url: photo.url,
                                                    title: `${activity.activityName} — Foto ${index + 1}`,
                                                    activityDate: activity.activityDate,
                                                    auditMetadata: photo.auditMetadata,
                                                  })
                                                }
                                              />
                                            </div>
                                          ))
                                        ) : (
                                          <div className="h-[280px] aspect-[4/3] max-w-full bg-amber-50 border border-amber-200 text-amber-800 rounded-2xl font-bold text-xs flex flex-col items-center justify-center gap-1.5 p-4 text-center">
                                            <AlertTriangle className="w-6 h-6 text-amber-600 mb-0.5" />
                                            <span>Laporan kegiatan ini tidak melampirkan foto bukti.</span>
                                          </div>
                                        )}
                                      </div>
                                    </div>

                                    {/* Right Column: Audit controls & history filling remaining width */}
                                    <div className="flex-1 min-w-0 space-y-3 w-full">
                                      {isPhotoOnlyReport ? (
                                        <div className="rounded-2xl border border-amber-200 bg-white p-4 space-y-3.5 shadow-xs flex-1 flex flex-col justify-between h-[280px] overflow-hidden">
                                          {/* Section 1: Nominal Audit */}
                                          <div className="space-y-1.5 rounded-xl border border-amber-200/80 bg-amber-50/70 p-3">
                                            <p className="text-xs font-bold uppercase tracking-wider text-amber-700">Nominal Audit</p>
                                            <p className="text-xs sm:text-sm font-semibold text-amber-950">
                                              Rekomendasi sistem: <strong>{fmtRp(activity.submittedFeeRecommendation || (isReprimand ? 15_000 : 5_000))}</strong>
                                            </p>
                                            <p className="text-[11px] text-amber-800">Nominal akhir dapat diubah langsung oleh Kepala SatKer.</p>
                                          </div>

                                          {/* Section 2: Riwayat Pengajuan */}
                                          <div className="space-y-2 pt-1 border-t border-slate-100">
                                            <div className="flex items-center justify-between gap-3">
                                              <div>
                                                <p className="text-xs font-black uppercase tracking-wider text-slate-700">Riwayat Pengajuan</p>
                                                <p className="text-[10px] text-slate-500">Setiap versi disimpan terpisah dan tidak ditimpa.</p>
                                              </div>
                                              <Badge variant="outline" className="border-slate-200 text-[10px] font-bold text-slate-600">
                                                Versi {activity.submissionRevision || 1}
                                              </Badge>
                                            </div>
                                            {loadingActivityRevisionId === activity.id ? (
                                              <div className="flex min-h-10 items-center justify-center gap-2 text-xs text-slate-500">
                                                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Memuat riwayat…
                                              </div>
                                            ) : (activityRevisionHistory[activity.id] || []).length > 0 ? (
                                              <div className="space-y-1.5 max-h-28 overflow-y-auto pr-1">
                                                {activityRevisionHistory[activity.id].map((revision) => (
                                                  <div key={revision.revision} className="flex flex-col gap-1 rounded-xl border border-slate-100 bg-slate-50 px-3 py-1.5 text-xs sm:flex-row sm:items-center sm:justify-between">
                                                    <span className="font-bold text-slate-800">
                                                      Versi {revision.revision} · {revision.itemName}
                                                    </span>
                                                    <span className="text-slate-500 text-[11px]">
                                                      {revision.activityDate} · {revision.photoCount} foto
                                                      {revision.submittedAt
                                                        ? ` · ${new Date(revision.submittedAt).toLocaleString('id-ID')}`
                                                        : ''}
                                                    </span>
                                                  </div>
                                                ))}
                                              </div>
                                            ) : (
                                              <p className="rounded-xl bg-slate-50 p-2 text-[11px] text-slate-500">
                                                Riwayat versi lama belum tersedia untuk laporan ini.
                                              </p>
                                            )}
                                          </div>
                                        </div>
                                      ) : (
                                        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
                                          <p className="text-xs font-black uppercase tracking-wider text-slate-700">Detail Audit Kegiatan</p>
                                          <div className="space-y-2 text-xs text-slate-600">
                                            <div className="flex justify-between border-b border-slate-100 pb-1.5">
                                              <span className="font-semibold text-slate-500">Nama Kegiatan</span>
                                              <span className="font-bold text-slate-800">{activity.activityName}</span>
                                            </div>
                                            <div className="flex justify-between border-b border-slate-100 pb-1.5">
                                              <span className="font-semibold text-slate-500">Pegawai</span>
                                              <span className="font-bold text-slate-800">{activity.employeeName} ({activity.jobCategory || 'PEKARYA'})</span>
                                            </div>
                                            <div className="flex justify-between border-b border-slate-100 pb-1.5">
                                              <span className="font-semibold text-slate-500">Waktu & Tanggal</span>
                                              <span className="font-bold text-slate-800">{activity.activityDate} · {activity.timeStart} – {activity.timeEnd}</span>
                                            </div>
                                            <div className="flex justify-between border-b border-slate-100 pb-1.5">
                                              <span className="font-semibold text-slate-500">Status Foto</span>
                                              <span className="font-bold text-slate-800">{activity.photoUrl ? 'Foto Terlampir' : 'Tanpa Bukti Foto'}</span>
                                            </div>
                                            {activity.fee > 0 && (
                                              <div className="flex justify-between pt-0.5">
                                                <span className="font-semibold text-slate-500">Fee / Kompensasi</span>
                                                <span className="font-bold text-emerald-600">{fmtRp(activity.fee)}</span>
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </React.Fragment>
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
              <CardDescription className="text-xs">Total fee disetujui per karyawan untuk periode {formatPayrollWindowLabel(periodToken)}.</CardDescription>
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
              {declineTarget?.reportKind === 'satpam_found_item'
                ? 'Tolak Penemuan Barang'
                : declineTarget?.reportKind === 'satpam_reprimand'
                  ? 'Tolak Teguran Pengendara'
                  : 'Tolak Kegiatan'}
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
                <span className="text-slate-400 font-semibold">
                  {declineTarget?.reportKind === 'satpam_found_item' || declineTarget?.reportKind === 'satpam_reprimand' ? 'Bukti' : 'Waktu'}
                </span>
                <span className="font-bold text-slate-700">
                  {declineTarget?.reportKind === 'satpam_found_item' || declineTarget?.reportKind === 'satpam_reprimand'
                    ? `${declineTarget.proofPhotos?.length || (declineTarget.photoUrl ? 1 : 0)} foto`
                    : declineTarget?.activityType === 'Buang Sampah' || declineTarget?.activityName === 'Buang Sampah'
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

      {/* ── Admin Delete Modal (super_admin only) ─────────────────────── */}
      <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open && !deletingActivity) setDeleteTarget(null); }}>
        <DialogContent className="sm:max-w-md rounded-3xl border-none shadow-2xl bg-white p-6">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold flex items-center gap-2 text-slate-900">
              <Trash2 className="w-5 h-5 text-rose-600" />
              Hapus Laporan
            </DialogTitle>
            <DialogDescription className="text-slate-500">
              Menghapus laporan <strong>“{deleteTarget?.activityName}”</strong> oleh <strong>{deleteTarget?.employeeName}</strong> secara permanen.
              Data slip gaji dan rekapitulasi periode ini akan dihitung ulang setelah penghapusan.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-100 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <p className="text-xs font-semibold text-rose-800">
                Tindakan ini tidak dapat dibatalkan. Laporan yang sudah dibayarkan (slip terkunci) tidak dapat dihapus lewat sini.
              </p>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400 font-semibold">Tanggal</span>
                <span className="font-bold text-slate-700">{deleteTarget?.dutyDate || deleteTarget?.activityDate}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400 font-semibold">Status Saat Ini</span>
                <span className="font-bold text-slate-700">
                  {deleteTarget?.status === 'approved' ? 'Disetujui' : 'Ditolak'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400 font-semibold">Fee</span>
                <span className="font-bold text-slate-700">{fmtRp(deleteTarget?.fee || 0)}</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-500 uppercase">Alasan Penghapusan (Wajib)</Label>
              <Input
                type="text"
                placeholder="Contoh: Laporan duplikat, salah input pos"
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                className="rounded-xl border-slate-200 focus:border-rose-400 focus:ring-rose-400/20 text-sm"
                autoFocus
              />
              <p className="text-[10px] font-semibold text-slate-400">Minimal 8 karakter. Dicatat pada log audit finansial.</p>
            </div>
          </div>
          <DialogFooter className="gap-3">
            <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deletingActivity} className="rounded-xl font-bold text-slate-500">
              Batal
            </Button>
            <Button
              onClick={handleDeleteActivity}
              disabled={deletingActivity || deleteReason.trim().length < 8}
              className="rounded-xl bg-rose-600 text-white font-bold hover:bg-rose-700 shadow-md shadow-rose-100"
            >
              {deletingActivity ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Trash2 className="w-4 h-4 mr-2" />}
              Hapus Permanen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Driver (Sopir) Audit & Edit Modal ─────────────────────────── */}
      <DriverJourneyAuditDialog
        report={auditActivity}
        onOpenChange={(open) => { if (!open) setAuditActivity(null); }}
        actionLoading={actionLoading}
        onApprove={handleApproveSopirAudit}
        onDecline={() => {
          setDeclineTarget(auditActivity);
          setDeclineReason('');
          setAuditActivity(null);
        }}
        onOpenPhoto={(image) => setSelectedExifImage(image)}
      />

      {/* ── Satpam Auditor Correction Dialog ───────────────────────────── */}
      <Dialog
        open={Boolean(auditorEditShift)}
        onOpenChange={(open) => {
          if (!open && !savingAuditorEdit) setAuditorEditShift(null);
        }}
      >
        <DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-900">
              <Edit2 className="w-5 h-5 text-indigo-600" />
              Edit Auditor Laporan Shift
            </DialogTitle>
            <DialogDescription>
              Perubahan pertama langsung mengunci laporan dari Ketua Shift. Foto asli tetap disimpan.
            </DialogDescription>
          </DialogHeader>

          {auditorEditShift && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div>
                  <p className="text-[10px] font-black uppercase text-slate-400">Dikirim Ketua</p>
                  <p className="mt-1 text-sm font-bold">{auditorEditShift.submittedDutyDate} · {auditorEditShift.submittedShiftName}</p>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase text-blue-500">Saran Sistem</p>
                  <p className="mt-1 text-sm font-bold text-blue-900">{auditorEditShift.dutyDate} · {auditorEditShift.suggestedShiftName}</p>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase text-indigo-500">Nilai Auditor</p>
                  <p className="mt-1 text-sm font-bold text-indigo-900">{auditorEditDate} · {auditorEditShiftName}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="auditorShiftDate">Tanggal dinas</Label>
                  <Input
                    id="auditorShiftDate"
                    type="date"
                    value={auditorEditDate}
                    onChange={(event) => setAuditorEditDate(event.target.value)}
                    className="h-11 rounded-xl"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Shift yang benar</Label>
                  <Select value={auditorEditShiftName} onValueChange={(value) => value && setAuditorEditShiftName(value)}>
                    <SelectTrigger className="h-11 rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Pagi">Pagi</SelectItem>
                      <SelectItem value="Sore">Sore</SelectItem>
                      <SelectItem value="Malam">Malam</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                {auditorEditRows.map((row, index) => (
                  <div key={`${row.reportId || 'new'}-${index}`} className="grid grid-cols-1 md:grid-cols-12 gap-2 rounded-xl border border-slate-200 p-3">
                    <div className="md:col-span-2">
                      <Select value={row.postId} onValueChange={(value) => value && updateAuditorEditRow(index, { postId: value })}>
                        <SelectTrigger className="h-10 rounded-lg"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {SATPAM_POST_OPTIONS.map((post) => <SelectItem key={post} value={post}>{post}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="md:col-span-4">
                      <Select value={row.employeeId} onValueChange={(value) => value && updateAuditorEditRow(index, { employeeId: value })}>
                        <SelectTrigger className="h-10 rounded-lg">
                          <span className="truncate">
                            {satpamEmployeeDirectory.find((employee) => employee.id === row.employeeId)?.name || row.employeeId}
                          </span>
                        </SelectTrigger>
                        <SelectContent className="max-h-72">
                          {satpamEmployeeDirectory.map((employee) => (
                            <SelectItem key={employee.id} value={employee.id}>
                              {employee.name}{employee.isActive ? '' : ' · tidak aktif'}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="md:col-span-3">
                      <Select value={row.shiftType} onValueChange={(value) => value && updateAuditorEditRow(index, { shiftType: value })}>
                        <SelectTrigger className="h-10 rounded-lg"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Harian">Harian</SelectItem>
                          <SelectItem value="Jumat & Libur">Jumat & Libur</SelectItem>
                          <SelectItem value="Lembur Sendiri">Lembur Sendiri</SelectItem>
                          <SelectItem value="Lembur Cover">Lembur Cover</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="md:col-span-2">
                      <Select
                        value={row.assignmentKind}
                        onValueChange={(value) => value && updateAuditorEditRow(index, { assignmentKind: value as 'primary' | 'extra' })}
                      >
                        <SelectTrigger className="h-10 rounded-lg">
                          <SelectValue>
                            {row.assignmentKind === 'primary' ? 'Pos utama' : 'Tambahan'}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="primary">Pos utama</SelectItem>
                          <SelectItem value="extra">Tambahan</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="md:col-span-1 flex justify-end">
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setAuditorEditRows((rows) => rows.filter((_, rowIndex) => rowIndex !== index))}
                        className="h-10 w-10 p-0 text-rose-600"
                        aria-label="Hapus penugasan"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                    {row.shiftType === 'Lembur Cover' && (
                      <>
                        <div className="md:col-span-5">
                          <Select
                            value={row.coveredEmployeeId || 'none'}
                            onValueChange={(value) => updateAuditorEditRow(index, { coveredEmployeeId: value === 'none' ? undefined : value || undefined })}
                          >
                            <SelectTrigger className="h-10 rounded-lg"><SelectValue placeholder="Petugas yang digantikan" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Belum ditentukan</SelectItem>
                              {satpamEmployeeDirectory.map((employee) => <SelectItem key={employee.id} value={employee.id}>{employee.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="md:col-span-7">
                          <Input
                            value={row.overtimeReason || ''}
                            onChange={(event) => updateAuditorEditRow(index, { overtimeReason: event.target.value })}
                            placeholder="Catatan cover"
                            className="h-10 rounded-lg"
                          />
                        </div>
                      </>
                    )}
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setAuditorEditRows((rows) => [
                      ...rows,
                      {
                        assignmentKind: 'primary',
                        postId: 'Pos 1',
                        employeeId: satpamEmployeeDirectory[0]?.id || '',
                        shiftType: 'Harian',
                      },
                    ])
                  }
                  className="rounded-xl gap-2"
                >
                  <Plus className="w-4 h-4" /> Tambah Penugasan
                </Button>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="auditorEditReason">Alasan perubahan (wajib)</Label>
                <Input
                  id="auditorEditReason"
                  value={auditorEditReason}
                  onChange={(event) => setAuditorEditReason(event.target.value)}
                  placeholder="Contoh: memperbaiki petugas ganda sesuai daftar hadir"
                  className="h-11 rounded-xl"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" disabled={savingAuditorEdit} onClick={() => setAuditorEditShift(null)}>
              Batal
            </Button>
            <Button
              disabled={savingAuditorEdit || auditorEditRows.length < 1}
              onClick={handleSaveAuditorShiftEdit}
              className="bg-indigo-600 hover:bg-indigo-700 gap-2"
            >
              {savingAuditorEdit ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
              Simpan dan Ambil Alih
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* EXIF Metadata Audit Modal for Kepala SatKer */}
      {selectedExifImage && (
        <ImageExifViewer
          imageUrl={selectedExifImage.url}
          title={selectedExifImage.title}
          activityDate={selectedExifImage.activityDate ?? auditActivity?.activityDate}
          auditMetadata={selectedExifImage.auditMetadata}
          isOpen={Boolean(selectedExifImage)}
          onClose={() => setSelectedExifImage(null)}
        />
      )}
    </div>
  );
}
