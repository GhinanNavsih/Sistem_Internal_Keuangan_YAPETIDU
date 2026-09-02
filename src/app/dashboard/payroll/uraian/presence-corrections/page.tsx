"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { FloatingSnackbar } from '@/components/ui/floating-snackbar';
import { useAuth } from '@/lib/AuthContext';
import { db } from '@/lib/firebase';
import {
  collection,
  getDocs,
  getDoc,
  doc,
  writeBatch,
  serverTimestamp
} from 'firebase/firestore';
import {
  Card,
  CardContent,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { authenticatedJson, createFinancialRequestId } from '@/lib/payroll/client';
import type { SatpamShiftName } from '@/lib/payroll/domain';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Loader2,
  Calendar,
  Clock,
  AlertCircle,
  FileText,
  Check,
  X,
  Filter,
  RefreshCw,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { calculateLoyalisDailyDuration } from '@/lib/payroll/loyalisPresenceWindow';
import {
  asPresenceCorrectionRequest,
  correctionTimeLabel,
  correctionTypeLabel,
  formatCreatedAt,
  formatPresenceDate,
  parseDateKey,
  parseDateOnly,
  parseDateToDDMMYYYY,
  timestampToMillis,
  type LoyalisRawLog,
  type PresenceCorrectionRequest,
  type PresenceCorrectionStatus,
} from '@/lib/payroll/presenceCorrections';
import {
  isValidAttendanceScanRange,
  pekaryaAttendanceReportType,
  type PekaryaAttendanceReportType,
  type PekaryaOfficialLeaveRequest,
} from '@/lib/payroll/pekaryaOfficialLeave';
import {
  defaultSatpamScanTimes,
  isValidSatpamAttendanceScanRange,
  satpamAttendanceReportType,
  type SatpamAttendanceReportType,
} from '@/lib/payroll/satpamAttendance';

interface LoyalisPresenceEntry {
  employeeId?: string;
  employeeName?: string;
  excelName?: string;
  minutes?: number;
  absenceMinutes?: number;
  stratum?: number;
  deduction?: number;
  netBonus?: number;
  isNotFoundInExcel?: boolean;
  activeDaysCount?: number;
  incompleteDaysCount?: number;
  absentDaysCount?: number;
  dailyLogs?: LoyalisRawLog[];
}

interface LoyalisPresenceDocument {
  workingDays?: number;
  expectedHours?: number;
  mode?: 'worked' | 'absent';
  entries?: Record<string, LoyalisPresenceEntry>;
}

interface PresenceSummary {
  minutes: number;
  activeDaysCount: number;
  incompleteDaysCount: number;
  absentDaysCount: number;
  dailyLogs: LoyalisRawLog[];
}

interface SatpamReviewRequest {
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
  evidenceUrl?: string | null;
  status: 'pending' | 'approved' | 'declined' | 'withdrawn';
  revision: number;
  decisionReason?: string;
  approvedAmount?: number;
  payrollExcludedFromHarian?: boolean;
  payrollExclusionReason?: string | null;
  decidedAt?: unknown;
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
}

type BlueCollarReviewItem =
  | { source: 'pekarya'; request: PekaryaOfficialLeaveRequest }
  | { source: 'satpam'; request: SatpamReviewRequest };

type ReviewSource = 'all' | 'loyalis' | 'blue_collar';

const STATUS_LABELS: Record<PresenceCorrectionStatus, string> = {
  pending: 'Tertunda',
  approved: 'Disetujui',
  rejected: 'Ditolak',
};

const statusOptions: Array<{ value: PresenceCorrectionStatus | 'all'; label: string }> = [
  { value: 'pending', label: 'Tertunda (Pending)' },
  { value: 'approved', label: 'Disetujui (Approved)' },
  { value: 'rejected', label: 'Ditolak (Rejected)' },
  { value: 'all', label: 'Semua Status' },
];

const SATPAM_ABSENCE_TYPE_OPTIONS = [
  { value: 'sakit', label: 'Sakit' },
  { value: 'izin_resmi', label: 'Izin Resmi' },
  { value: 'darurat', label: 'Keperluan Darurat' },
  { value: 'lainnya', label: 'Lainnya' },
] as const;

function isCorrectionStatus(value: unknown): value is PresenceCorrectionStatus | 'all' {
  return value === 'pending' || value === 'approved' || value === 'rejected' || value === 'all';
}

function isSatpamShiftName(value: string | undefined): value is SatpamShiftName {
  return value === 'Pagi' || value === 'Sore' || value === 'Malam';
}

function statusMatches(value: string, selected: PresenceCorrectionStatus | 'all'): boolean {
  if (selected === 'all') return true;
  if (selected === 'rejected') return value === 'rejected' || value === 'declined';
  return value === selected;
}

function statusLabel(value: string): string {
  if (value === 'withdrawn') return 'Ditarik';
  return value === 'rejected' || value === 'declined'
    ? 'Ditolak'
    : STATUS_LABELS[value as PresenceCorrectionStatus] || value;
}

function blueCollarRequestDate(item: BlueCollarReviewItem): string {
  return item.source === 'pekarya' ? item.request.date : item.request.dutyDate;
}

function blueCollarRequestStatus(item: BlueCollarReviewItem): string {
  return item.request.status;
}

function satpamAbsenceTypeLabel(value: string | undefined): string {
  return {
    sakit: 'Sakit',
    izin_resmi: 'Izin resmi',
    darurat: 'Keperluan darurat',
    lainnya: 'Lainnya',
  }[value || ''] || 'Izin';
}

function isImageProofUrl(value: string): boolean {
  const normalized = value.toLowerCase();
  return /\.(?:jpe?g|png|gif|webp)(?:[?#]|$)/.test(normalized)
    || normalized.includes('image%2f')
    || normalized.includes('image/');
}

function requestMatchesPeriod(request: PresenceCorrectionRequest, period: string): boolean {
  return !period || (typeof request.date === 'string' && request.date.slice(0, 7) === period);
}

export default function PresenceCorrectionsAdminPage() {
  const { profile } = useAuth();
  const searchParams = useSearchParams();
  const canAuditLoyalis = profile?.role === 'super_admin' || profile?.role === 'loyalis_presence_admin';
  const canAuditBlueCollar = profile?.role === 'super_admin' || profile?.role === 'satker_head';
  const monthParam = searchParams.get('month');
  const yearParam = searchParams.get('year');
  const periodFromUrl =
    monthParam && yearParam && /^\d{1,2}$/.test(monthParam) && /^\d{4}$/.test(yearParam)
      ? `${yearParam}-${monthParam.padStart(2, '0')}`
      : '';
  const [loading, setLoading] = useState(false);
  const [allRequests, setAllRequests] = useState<PresenceCorrectionRequest[]>([]);
  const [blueCollarRequests, setBlueCollarRequests] = useState<BlueCollarReviewItem[]>([]);
  const [selectedStatus, setSelectedStatus] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [selectedPeriod, setSelectedPeriod] = useState(() => periodFromUrl || (() => {
    const now = new Date();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    return `${now.getFullYear()}-${m}`;
  })());
  const [selectedSource, setSelectedSource] = useState<ReviewSource>('all');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Rejection dialog states
  const [rejectingReqId, setRejectingReqId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [editingTypeRequestId, setEditingTypeRequestId] = useState<string | null>(null);
  const [editingReportType, setEditingReportType] = useState<PekaryaAttendanceReportType>('scan');
  const [editingScanIn, setEditingScanIn] = useState('08:00');
  const [editingScanOut, setEditingScanOut] = useState('14:00');
  const [editingAbsenceType, setEditingAbsenceType] = useState('izin_resmi');

  const [expandedReqIds, setExpandedReqIds] = useState<Record<string, boolean>>({});
  const [rawLogsMap, setRawLogsMap] = useState<Record<string, LoyalisRawLog | null>>({});
  const [loadingRawMap, setLoadingRawMap] = useState<Record<string, boolean>>({});
  const fetchSequence = useRef(0);

  useEffect(() => {
    if (!periodFromUrl || periodFromUrl === selectedPeriod) return;
    // The period selector in the uraian layout is URL-backed. Keep this page's
    // local filters aligned when the shared selector changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedPeriod(periodFromUrl);
  }, [periodFromUrl, selectedPeriod]);

  const fetchRequests = useCallback(async (showError = true) => {
    const sequence = ++fetchSequence.current;
    if (!canAuditLoyalis && !canAuditBlueCollar) {
      setAllRequests([]);
      setBlueCollarRequests([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const errors: string[] = [];

    const loyalisTask = canAuditLoyalis
      ? getDocs(collection(db, 'LoyalisPresenceCorrections'))
          .then((snap) => snap.docs
            .map((snapshot) => asPresenceCorrectionRequest(snapshot.id, snapshot.data()))
            .sort((a, b) => timestampToMillis(b.createdAt) - timestampToMillis(a.createdAt)))
          .catch((err) => {
            console.error('Error fetching Loyalis correction requests:', err);
            errors.push('koreksi Loyalis');
            return null;
          })
      : Promise.resolve(null);

    const blueCollarTask = canAuditBlueCollar
      ? Promise.allSettled([
          authenticatedJson<{ requests: PekaryaOfficialLeaveRequest[] }>(
            `/api/attendance/pekarya/official-leave?period=${encodeURIComponent(selectedPeriod)}`,
          ),
          authenticatedJson<{ requests: SatpamReviewRequest[] }>(
            `/api/satpam/absences?period=${encodeURIComponent(selectedPeriod)}`,
          ),
        ]).then(([pekaryaResult, satpamResult]) => {
          const items: BlueCollarReviewItem[] = [];
          if (pekaryaResult.status === 'fulfilled') {
            items.push(...pekaryaResult.value.requests.map((request) => ({
              source: 'pekarya' as const,
              request,
            })));
          } else {
            console.error('Error fetching Pekarya correction requests:', pekaryaResult.reason);
            errors.push('koreksi Pekarya');
          }
          if (satpamResult.status === 'fulfilled') {
            items.push(...satpamResult.value.requests.map((request) => ({
              source: 'satpam' as const,
              request,
            })));
          } else {
            console.error('Error fetching Satpam correction requests:', satpamResult.reason);
            errors.push('koreksi Satpam');
          }
          return items.sort((a, b) =>
            blueCollarRequestDate(b).localeCompare(blueCollarRequestDate(a)),
          );
        })
      : Promise.resolve([] as BlueCollarReviewItem[]);

    const [loyalisResult, blueCollarResult] = await Promise.all([loyalisTask, blueCollarTask]);
    if (sequence !== fetchSequence.current) return;
    if (loyalisResult) setAllRequests(loyalisResult);
    if (canAuditLoyalis && !loyalisResult) setAllRequests([]);
    setBlueCollarRequests(blueCollarResult);
    if (showError && errors.length > 0) {
      setMessage({
        type: 'error',
        text: `Gagal memuat ${errors.join(' dan ')}. Coba segarkan kembali.`,
      });
    }
    if (sequence === fetchSequence.current) {
      setLoading(false);
    }
  }, [canAuditBlueCollar, canAuditLoyalis, selectedPeriod]);

  useEffect(() => {
    // This effect intentionally starts an async data load; the loader updates
    // state when the Firestore request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (profile) void fetchRequests();
  }, [fetchRequests, profile]);

  const requests = useMemo(
    () => allRequests.filter((request) => {
      if (!canAuditLoyalis || (selectedSource !== 'all' && selectedSource !== 'loyalis')) return false;
      if (!statusMatches(request.status, selectedStatus)) return false;
      return requestMatchesPeriod(request, selectedPeriod);
    }),
    [allRequests, canAuditLoyalis, selectedPeriod, selectedSource, selectedStatus],
  );

  const blueCollarPeriodRequests = useMemo(
    () => blueCollarRequests.filter((item) =>
      blueCollarRequestDate(item).slice(0, 7) === selectedPeriod,
    ),
    [blueCollarRequests, selectedPeriod],
  );

  const visibleBlueCollarRequests = useMemo(
    () => blueCollarPeriodRequests.filter((item) =>
      canAuditBlueCollar &&
      (selectedSource === 'all' || selectedSource === 'blue_collar') &&
      statusMatches(blueCollarRequestStatus(item), selectedStatus),
    ),
    [blueCollarPeriodRequests, canAuditBlueCollar, selectedSource, selectedStatus],
  );

  const periodRequests = useMemo(
    () => [
      ...(canAuditLoyalis && (selectedSource === 'all' || selectedSource === 'loyalis')
        ? allRequests.filter((request) => requestMatchesPeriod(request, selectedPeriod))
        : []),
      ...(canAuditBlueCollar && (selectedSource === 'all' || selectedSource === 'blue_collar')
        ? blueCollarPeriodRequests.map((item) => ({ status: blueCollarRequestStatus(item) }))
        : []),
    ],
    [allRequests, blueCollarPeriodRequests, canAuditBlueCollar, canAuditLoyalis, selectedPeriod, selectedSource],
  );

  const stats = useMemo(() => ({
    pending: periodRequests.filter((request) => request.status === 'pending').length,
    approved: periodRequests.filter((request) => request.status === 'approved').length,
    rejected: periodRequests.filter((request) => request.status === 'rejected' || request.status === 'declined').length,
    total: periodRequests.length,
  }), [periodRequests]);

  const handleExpandToggle = async (req: PresenceCorrectionRequest) => {
    const isExpanding = !expandedReqIds[req.id];
    setExpandedReqIds(prev => ({ ...prev, [req.id]: isExpanding }));

    const hasLoadedRawLog = Object.prototype.hasOwnProperty.call(rawLogsMap, req.id);
    if (isExpanding && !hasLoadedRawLog) {
      setLoadingRawMap(prev => ({ ...prev, [req.id]: true }));
      try {
        const dateKey = parseDateToDDMMYYYY(req.date);
        if (!dateKey || !parseDateOnly(req.date)) {
          setRawLogsMap(prev => ({ ...prev, [req.id]: null }));
          return;
        }

        const periodToken = req.date.slice(0, 7).replace('-', '_'); // e.g. "2026_07"
        const presenceRef = doc(db, 'LoyalisPresence', periodToken);
        const presenceSnap = await getDoc(presenceRef);
        if (presenceSnap.exists()) {
          const data = presenceSnap.data() as LoyalisPresenceDocument;
          const empEntry = data.entries?.[req.employeeId];
          const matchedLog = empEntry?.dailyLogs?.find((log) => log.Tanggal === dateKey);
          setRawLogsMap(prev => ({ ...prev, [req.id]: matchedLog || null }));
        } else {
          setRawLogsMap(prev => ({ ...prev, [req.id]: null }));
        }
      } catch (err) {
        console.error('Error fetching raw presence log:', err);
        setRawLogsMap(prev => ({ ...prev, [req.id]: null }));
      } finally {
        setLoadingRawMap(prev => ({ ...prev, [req.id]: false }));
      }
    }
  };

  // Keep correction calculations aligned with the raw Loyalis attendance page.
  const recalculateSummary = (dailyLogs: LoyalisRawLog[], expHours: number): PresenceSummary => {
    let totalWorkedMinutes = 0;
    let activeDaysCount = 0;
    let incompleteDaysCount = 0;
    let absentDaysCount = 0;

    const updatedLogs = dailyLogs.map((dayRow) => {
      const status = String(dayRow['Jam kerja'] || '').trim();
      const statusUpper = status.toUpperCase();
      const inStr = dayRow['Scan masuk'] ? String(dayRow['Scan masuk']).trim() : '';
      const outStr = dayRow['Scan pulang'] ? String(dayRow['Scan pulang']).trim() : '';

      let dailyDuration = 0;
      if (statusUpper === 'MASUK') {
        if (inStr && outStr) {
          const duration = calculateLoyalisDailyDuration(inStr, outStr, expHours);

          if (duration !== null) {
            dailyDuration = duration;
            totalWorkedMinutes += dailyDuration;
            activeDaysCount += 1;
          } else {
            incompleteDaysCount += 1;
          }
        } else {
          incompleteDaysCount += 1;
        }
      } else if (statusUpper === 'TIDAK HADIR') {
        absentDaysCount += 1;
      }

      return {
        ...dayRow,
        duration: dailyDuration
      };
    });

    return {
      minutes: totalWorkedMinutes,
      activeDaysCount,
      incompleteDaysCount,
      absentDaysCount,
      dailyLogs: updatedLogs,
    };
  };

  const calculatePresenceStratum = (minutes: number, mode: 'worked' | 'absent', days: number, hours: number) => {
    const expectedTotal = days * hours * 60;
    let x = 0;
    if (mode === 'worked') {
      x = expectedTotal - minutes;
      if (x < 0) x = 0;
    } else {
      x = minutes;
    }

    let stratum = 5;
    let deduction = 250000;
    let netBonus = 0;

    if (x === 0) {
      stratum = 1;
      deduction = 0;
      netBonus = 250000;
    } else if (x <= days * 30) {
      stratum = 2;
      deduction = 100000;
      netBonus = 150000;
    } else if (x <= days * 35) {
      stratum = 3;
      deduction = 150000;
      netBonus = 100000;
    } else if (x <= days * 40) {
      stratum = 4;
      deduction = 200000;
      netBonus = 50000;
    } else {
      stratum = 5;
      deduction = 250000;
      netBonus = 0;
    }

    return {
      absenceMinutes: x,
      stratum,
      deduction,
      netBonus,
    };
  };

  const handleApprove = async (req: PresenceCorrectionRequest) => {
    setActionLoading(req.id);
    setMessage(null);
    try {
      const dateKey = parseDateToDDMMYYYY(req.date); // e.g. "01-06-2026"
      if (!dateKey || !parseDateOnly(req.date)) {
        throw new Error('Tanggal koreksi tidak valid.');
      }

      const periodToken = req.date.slice(0, 7).replace('-', '_'); // e.g. "2026_06"

      // 1. Retrieve the existing monthly raw presence log document
      const presenceRef = doc(db, 'LoyalisPresence', periodToken);
      const presenceSnap = await getDoc(presenceRef);

      if (!presenceSnap.exists()) {
        throw new Error(`Data presensi untuk periode ${periodToken} belum dikonfigurasi/diunggah. Silakan minta admin mengunggah logs raw Excel terlebih dahulu.`);
      }

      const presenceData = presenceSnap.data() as LoyalisPresenceDocument;
      const workingDays = typeof presenceData.workingDays === 'number' && presenceData.workingDays > 0
        ? presenceData.workingDays
        : 25;
      const expectedHours = typeof presenceData.expectedHours === 'number' && presenceData.expectedHours > 0
        ? presenceData.expectedHours
        : 6.5;
      const calcMode = presenceData.mode === 'absent' ? 'absent' : 'worked';
      const entries = presenceData.entries || {};

      let employeeEntry = entries[req.employeeId];

      if (!employeeEntry) {
        // If employee entry doesn't exist, build a default mock shell
        employeeEntry = {
          employeeId: req.employeeId,
          employeeName: req.employeeName,
          excelName: req.employeeName,
          minutes: 0,
          absenceMinutes: workingDays * expectedHours * 60,
          stratum: 5,
          deduction: 250000,
          netBonus: 0,
          isNotFoundInExcel: true,
          activeDaysCount: 0,
          incompleteDaysCount: 0,
          absentDaysCount: 0,
          dailyLogs: []
        };
      }

      const dailyLogs: LoyalisRawLog[] = [...(employeeEntry.dailyLogs || [])];
      
      // Find matching date log in dailyLogs
      const dayLogIdx = dailyLogs.findIndex(log => log.Tanggal === dateKey);

      if (dayLogIdx > -1) {
        // Update existing daily logs
        dailyLogs[dayLogIdx] = {
          ...dailyLogs[dayLogIdx],
          'Jam kerja': 'MASUK',
          'Scan masuk': req.type === 'izin_resmi' ? '07:30' : (req.type !== 'tap_out' ? req.checkInTime : (dailyLogs[dayLogIdx]['Scan masuk'] || '')),
          'Scan pulang': req.type === 'izin_resmi' ? '14:00' : (req.type !== 'tap_in' ? req.checkOutTime : (dailyLogs[dayLogIdx]['Scan pulang'] || '')),
        };
      } else {
        // Add new log row if date does not exist
        dailyLogs.push({
          Tanggal: dateKey,
          'Jam kerja': 'MASUK',
          'Scan masuk': req.type === 'izin_resmi' ? '07:30' : (req.type !== 'tap_out' ? req.checkInTime : ''),
          'Scan pulang': req.type === 'izin_resmi' ? '14:00' : (req.type !== 'tap_in' ? req.checkOutTime : ''),
        });
      }

      // Sort logs by date again just in case
      dailyLogs.sort((a, b) => parseDateKey(a.Tanggal) - parseDateKey(b.Tanggal));

      // Recalculate summary details
      const summary = recalculateSummary(dailyLogs, expectedHours);
      const stratumCalc = calculatePresenceStratum(summary.minutes, calcMode, workingDays, expectedHours);

      const updatedEmployeeEntry = {
        ...employeeEntry,
        ...summary,
        ...stratumCalc,
        isNotFoundInExcel: false
      };

      // Save updated presence map back to database
      const updatedEntries = {
        ...entries,
        [req.employeeId]: updatedEmployeeEntry
      };

      // Payroll slips are intentionally not mutated here. Finance must refresh
      // and save a draft through the protected lifecycle API; final snapshots
      // remain immutable.

      // Update the attendance document and request together so a network or
      // permission failure cannot leave an applied correction marked pending.
      const requestRef = doc(db, 'LoyalisPresenceCorrections', req.id);
      const batch = writeBatch(db);
      batch.update(presenceRef, {
        entries: updatedEntries,
        updatedAt: serverTimestamp(),
      });
      batch.update(requestRef, {
        period: req.date.slice(0, 7),
        status: 'approved',
        resolvedBy: profile?.email || 'Admin',
        updatedAt: serverTimestamp(),
      });
      await batch.commit();

      setAllRequests((current) => current.map((request) => request.id === req.id
        ? { ...request, status: 'approved', resolvedBy: profile?.email || 'Admin' }
        : request));
      setMessage({ type: 'success', text: `Koreksi presensi ${req.employeeName} untuk tanggal ${dateKey} berhasil disetujui dan diterapkan.` });
      await fetchRequests(false);
    } catch (err: unknown) {
      console.error(err);
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal menyetujui koreksi presensi.',
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectingReqId) return;
    if (!rejectionReason.trim()) {
      setMessage({ type: 'error', text: 'Masukkan alasan penolakan koreksi presensi.' });
      return;
    }

    setActionLoading(rejectingReqId);
    try {
      const request = allRequests.find((item) => item.id === rejectingReqId);
      if (!request) {
        throw new Error('Data koreksi tidak ditemukan.');
      }
      const requestRef = doc(db, 'LoyalisPresenceCorrections', rejectingReqId);
      const batch = writeBatch(db);
      batch.update(requestRef, {
        period: request.date.slice(0, 7),
        status: 'rejected',
        rejectionReason: rejectionReason.trim(),
        resolvedBy: profile?.email || 'Admin',
        updatedAt: serverTimestamp(),
      });
      await batch.commit();

      setAllRequests((current) => current.map((request) => request.id === rejectingReqId
        ? { ...request, status: 'rejected', rejectionReason: rejectionReason.trim(), resolvedBy: profile?.email || 'Admin' }
        : request));
      setMessage({ type: 'success', text: 'Pengajuan koreksi presensi berhasil ditolak.' });
      setRejectingReqId(null);
      setRejectionReason('');
      await fetchRequests(false);
    } catch (err: unknown) {
      console.error(err);
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal menolak koreksi presensi.',
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleReviewBlueCollar = async (
    item: BlueCollarReviewItem,
    action: 'approve' | 'decline' | 'supersede_approve' | 'supersede_decline',
  ) => {
    const reasonKey = `${item.source}:${item.request.id}`;

    setActionLoading(reasonKey);
    setMessage(null);
    try {
      const isSatpam = item.source === 'satpam';
      const reviewResult = await authenticatedJson<{
        payrollExcludedFromHarian?: boolean;
      }>(
        isSatpam
          ? '/api/satpam/absences/review'
          : '/api/attendance/pekarya/official-leave/review',
        {
          method: 'POST',
          body: JSON.stringify({
            requestId: createFinancialRequestId(
              isSatpam ? 'satpam-absence-review' : 'pekarya-official-leave-review',
            ),
            ...(isSatpam
              ? { absenceRequestId: item.request.id }
              : { officialLeaveRequestId: item.request.id }),
            action,
            expectedRevision: item.request.revision,
          }),
        },
      );

      const approved = action.endsWith('approve');
      const requestType = isSatpam
        ? satpamAttendanceReportType(item.request)
        : pekaryaAttendanceReportType(item.request);
      const sourceLabel = isSatpam ? 'Satpam' : 'Pekarya';
      setMessage({
        type: 'success',
        text: approved
          ? isSatpam &&
            requestType === 'izin_resmi' &&
            reviewResult.payrollExcludedFromHarian === true
            ? 'Izin Satpam berhasil disetujui tanpa tambahan Harian karena pegawai sudah terdaftar shift pada tanggal tersebut.'
            : `${requestType === 'scan' ? 'Laporan scan' : 'Izin'} ${sourceLabel} berhasil disetujui dan presensi diperbarui.`
          : `${requestType === 'scan' ? 'Laporan scan' : 'Izin'} ${sourceLabel} berhasil ditolak.`,
      });
      await fetchRequests(false);
    } catch (err: unknown) {
      console.error('Error reviewing Blue Collar request:', err);
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal memutuskan pengajuan Blue Collar.',
      });
    } finally {
      setActionLoading(null);
    }
  };

  const startBlueCollarTypeEdit = (item: BlueCollarReviewItem) => {
    const request = item.request;
    const reportType = item.source === 'satpam'
      ? satpamAttendanceReportType(request)
      : pekaryaAttendanceReportType(request);
    const defaultTimes = item.source === 'satpam' && isSatpamShiftName(item.request.shiftName)
      ? defaultSatpamScanTimes(item.request.shiftName)
      : { scanIn: '08:00', scanOut: '14:00' };
    setEditingTypeRequestId(`${item.source}:${request.id}`);
    setEditingReportType(reportType);
    setEditingScanIn(request.scanIn?.slice(0, 5) || defaultTimes.scanIn);
    setEditingScanOut(request.scanOut?.slice(0, 5) || defaultTimes.scanOut);
    setEditingAbsenceType(
      item.source === 'satpam' && reportType === 'izin_resmi'
        ? item.request.absenceType || 'izin_resmi'
        : 'izin_resmi',
    );
    setMessage(null);
  };

  const cancelBlueCollarTypeEdit = () => {
    setEditingTypeRequestId(null);
  };

  const handleChangeBlueCollarType = async (
    item: BlueCollarReviewItem,
  ) => {
    const request = item.request;
    if (request.status !== 'pending') return;
    const scanRangeValid = item.source === 'satpam'
      ? isSatpamShiftName(item.request.shiftName) &&
        isValidSatpamAttendanceScanRange(
          editingScanIn,
          editingScanOut,
          item.request.shiftName,
        )
      : isValidAttendanceScanRange(editingScanIn, editingScanOut);
    if (editingReportType === 'scan' && !scanRangeValid) {
      setMessage({
        type: 'error',
        text: 'Scan masuk dan scan pulang harus valid, dengan scan pulang lebih lambat.',
      });
      return;
    }
    if (
      item.source === 'satpam' &&
      editingReportType === 'izin_resmi' &&
      !SATPAM_ABSENCE_TYPE_OPTIONS.some((option) => option.value === editingAbsenceType)
    ) {
      setMessage({ type: 'error', text: 'Pilih jenis alasan izin yang valid.' });
      return;
    }

    const actionKey = `type:${item.source}:${request.id}`;
    setActionLoading(actionKey);
    setMessage(null);
    try {
      const isSatpam = item.source === 'satpam';
      await authenticatedJson(
        isSatpam
          ? '/api/satpam/absences/review'
          : '/api/attendance/pekarya/official-leave/review',
        {
          method: 'POST',
          body: JSON.stringify({
            ...(isSatpam
              ? { absenceRequestId: request.id }
              : { officialLeaveRequestId: request.id }),
            action: 'change_type',
            reportType: editingReportType,
            scanIn: editingReportType === 'scan' ? editingScanIn : null,
            scanOut: editingReportType === 'scan' ? editingScanOut : null,
            ...(isSatpam
              ? {
                  absenceType:
                    editingReportType === 'izin_resmi'
                      ? editingAbsenceType
                      : null,
                }
              : {}),
            reason: 'Perubahan jenis ajuan oleh auditor.',
            requestId: createFinancialRequestId(
              isSatpam ? 'satpam-absence-type' : 'pekarya-official-leave-type',
            ),
            expectedRevision: request.revision,
          }),
        },
      );
      setEditingTypeRequestId(null);
      setMessage({
        type: 'success',
        text: `Jenis ajuan ${request.employeeName || request.employeeId} berhasil diubah menjadi ${editingReportType === 'scan' ? 'Koreksi Scan' : 'Izin Resmi'}.`,
      });
      await fetchRequests(false);
    } catch (err: unknown) {
      console.error('Error changing Blue Collar request type:', err);
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal mengubah jenis ajuan Blue Collar.',
      });
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="space-y-6">
      <FloatingSnackbar message={message} />

      {/* ── Filters Row ────────────────────────────────────────────── */}
      <Card className="bg-white rounded-2xl shadow-sm border-none">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row md:items-center gap-3">
            {profile?.role === 'super_admin' ? (
              <div className="flex min-w-0 items-center gap-2">
                <span className="text-sm font-semibold text-slate-500 whitespace-nowrap">Sumber</span>
                <Select
                  value={selectedSource}
                  onValueChange={(value) => {
                    if (value === 'all' || value === 'loyalis' || value === 'blue_collar') {
                      setSelectedSource(value);
                    }
                  }}
                >
                  <SelectTrigger className="h-12 w-full min-w-48 rounded-xl border-slate-200 bg-white text-base font-bold md:w-52">
                    <SelectValue>
                      {selectedSource === 'all'
                        ? 'Semua Pegawai'
                        : selectedSource === 'loyalis'
                          ? 'Loyalis'
                          : 'Blue Collar'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="rounded-xl bg-white">
                    <SelectItem value="all" className="min-h-11 text-base">Semua Pegawai</SelectItem>
                    <SelectItem value="loyalis" className="min-h-11 text-base">Loyalis</SelectItem>
                    <SelectItem value="blue_collar" className="min-h-11 text-base">Blue Collar</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="inline-flex h-12 items-center rounded-xl border border-indigo-100 bg-indigo-50 px-4 text-sm font-bold text-indigo-700">
                Sumber: {canAuditLoyalis ? 'Loyalis' : 'Blue Collar'}
              </div>
            )}
            <div className="flex min-w-0 items-center gap-2">
              <Filter className="h-4 w-4 shrink-0 text-slate-400" />
              <Select
                value={selectedStatus}
                onValueChange={(value) => {
                  if (isCorrectionStatus(value)) setSelectedStatus(value);
                }}
              >
                <SelectTrigger className="h-12 w-full min-w-56 rounded-xl border-slate-200 bg-white text-base font-bold md:w-64">
                  <SelectValue>
                    {statusOptions.find((option) => option.value === selectedStatus)?.label}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="rounded-xl bg-white">
                  {statusOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value} className="min-h-11 text-base">
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2 md:ml-auto">
              <label htmlFor="correction-period" className="text-sm font-semibold text-slate-500 whitespace-nowrap">
                Periode
              </label>
              <Input
                id="correction-period"
                type="month"
                value={selectedPeriod}
                onChange={(event) => setSelectedPeriod(event.target.value)}
                className="h-12 w-full rounded-xl border-slate-200 bg-slate-50/50 text-sm font-semibold md:w-44"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => void fetchRequests()}
                disabled={loading}
                className="h-12 rounded-xl border-slate-200 bg-white text-slate-600 hover:bg-slate-50 shadow-sm"
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                Segarkan
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Stats Cards ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <button
          type="button"
          onClick={() => setSelectedStatus(selectedStatus === 'pending' ? 'all' : 'pending')}
          className={`rounded-2xl shadow-sm text-center p-4 transition-all cursor-pointer ${selectedStatus === 'pending'
            ? 'bg-amber-50 ring-2 ring-amber-400 shadow-amber-100'
            : 'bg-white hover:bg-amber-50/40 hover:ring-1 hover:ring-amber-200'}`}
        >
          <div className="text-2xl font-extrabold text-amber-500">{stats.pending}</div>
          <div className={`text-[11px] font-semibold mt-0.5 ${selectedStatus === 'pending' ? 'text-amber-600' : 'text-slate-400'}`}>Menunggu</div>
        </button>
        <button
          type="button"
          onClick={() => setSelectedStatus(selectedStatus === 'approved' ? 'all' : 'approved')}
          className={`rounded-2xl shadow-sm text-center p-4 transition-all cursor-pointer ${selectedStatus === 'approved'
            ? 'bg-emerald-50 ring-2 ring-emerald-400 shadow-emerald-100'
            : 'bg-white hover:bg-emerald-50/40 hover:ring-1 hover:ring-emerald-200'}`}
        >
          <div className="text-2xl font-extrabold text-emerald-500">{stats.approved}</div>
          <div className={`text-[11px] font-semibold mt-0.5 ${selectedStatus === 'approved' ? 'text-emerald-600' : 'text-slate-400'}`}>Disetujui</div>
        </button>
        <button
          type="button"
          onClick={() => setSelectedStatus(selectedStatus === 'rejected' ? 'all' : 'rejected')}
          className={`rounded-2xl shadow-sm text-center p-4 transition-all cursor-pointer ${selectedStatus === 'rejected'
            ? 'bg-rose-50 ring-2 ring-rose-400 shadow-rose-100'
            : 'bg-white hover:bg-rose-50/40 hover:ring-1 hover:ring-rose-200'}`}
        >
          <div className="text-2xl font-extrabold text-rose-500">{stats.rejected}</div>
          <div className={`text-[11px] font-semibold mt-0.5 ${selectedStatus === 'rejected' ? 'text-rose-600' : 'text-slate-400'}`}>Ditolak</div>
        </button>
        <button
          type="button"
          onClick={() => setSelectedStatus('all')}
          className={`rounded-2xl shadow-sm text-center p-4 transition-all cursor-pointer ${selectedStatus === 'all'
            ? 'bg-slate-100 ring-2 ring-slate-400'
            : 'bg-white hover:bg-slate-50 hover:ring-1 hover:ring-slate-200'}`}
        >
          <div className="text-2xl font-extrabold text-slate-700">{stats.total}</div>
          <div className={`text-[11px] font-semibold mt-0.5 ${selectedStatus === 'all' ? 'text-slate-600' : 'text-slate-400'}`}>Total Pengajuan</div>
        </button>
      </div>

      {/* ── Loyalis Correction Table ───────────────────────────────── */}
      {canAuditLoyalis && (selectedSource === 'all' || selectedSource === 'loyalis') && (
      <Card className="bg-white rounded-[24px] shadow-[0_8px_30px_rgb(0,0,0,0.02)] border-none overflow-hidden">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-24 flex flex-col items-center text-slate-400">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mb-4" />
              <p className="font-semibold text-sm animate-pulse">Memuat daftar pengajuan...</p>
            </div>
          ) : requests.length === 0 ? (
            <div className="p-24 flex flex-col items-center text-center text-slate-400">
              <Clock className="w-12 h-12 mb-4 opacity-20" />
              <h4 className="text-slate-700 font-bold text-base">Tidak Ada Data</h4>
              <p className="text-xs text-slate-400 max-w-xs mt-1">
                Belum ada pengajuan koreksi untuk periode dan status yang dipilih.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-slate-50/60 sticky top-0 z-20">
                <TableRow className="border-slate-100">
                  <TableHead className="font-bold text-slate-500">Nama Pegawai</TableHead>
                  <TableHead className="font-bold text-slate-500">Tanggal</TableHead>
                  <TableHead className="font-bold text-slate-500">Koreksi</TableHead>
                  <TableHead className="font-bold text-slate-500">Status</TableHead>
                  <TableHead className="font-bold text-slate-500 text-right pr-6">Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((req) => {
                  const isExpanded = !!expandedReqIds[req.id];
                  const rawLog = rawLogsMap[req.id];
                  const loadingRaw = !!loadingRawMap[req.id];
                  const statusLabel = STATUS_LABELS[req.status] || req.status;

                  return (
                    <React.Fragment key={req.id}>
                      <TableRow
                        role="button"
                        tabIndex={0}
                        aria-expanded={isExpanded}
                        onClick={() => void handleExpandToggle(req)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            void handleExpandToggle(req);
                          }
                        }}
                        className={`border-slate-100 cursor-pointer transition-colors ${isExpanded ? 'bg-indigo-50/50' : 'hover:bg-slate-50/60'}`}
                      >
                        <TableCell className="min-w-48">
                          <div className="font-bold text-slate-800">{req.employeeName || req.employeeId || '—'}</div>
                          <div className="text-[10px] text-slate-400 font-semibold mt-1">Diajukan {formatCreatedAt(req.createdAt)}</div>
                        </TableCell>
                        <TableCell className="min-w-36">
                          <div className="flex items-center gap-2 text-xs font-bold text-slate-700 font-mono">
                            <Calendar className="w-4 h-4 text-slate-400" />
                            {formatPresenceDate(req.date, { year: 'numeric', month: 'short', day: 'numeric' })}
                          </div>
                        </TableCell>
                        <TableCell className="min-w-48">
                          <div className="text-xs font-bold text-indigo-700">{correctionTypeLabel(req.type)}</div>
                          <div className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500 font-mono mt-1">
                            <Clock className="w-3 h-3 text-indigo-400" />
                            {correctionTimeLabel(req)}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase ${req.status === 'approved'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                            : req.status === 'rejected'
                              ? 'bg-rose-50 text-rose-700 border border-rose-100'
                              : 'bg-amber-50 text-amber-700 border border-amber-100'}`}
                          >
                            {statusLabel}
                          </span>
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          {isExpanded
                            ? <ChevronUp className="w-5 h-5 text-slate-400 ml-auto" />
                            : <ChevronDown className="w-5 h-5 text-slate-400 ml-auto" />}
                        </TableCell>
                      </TableRow>

                      {isExpanded && (
                        <TableRow className="border-slate-100 bg-white">
                          <TableCell colSpan={5} className="p-0 whitespace-normal">
                            <div className="p-5 lg:p-6 space-y-5 animate-in fade-in slide-in-from-top-1 duration-200">
                              <div className="space-y-2">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Bandingkan Data Presensi</span>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-left">
                                  <div className="bg-slate-50 rounded-2xl border border-slate-100 p-4 space-y-2">
                                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Data Log Asli (Excel)</span>
                                    {loadingRaw ? (
                                      <div className="py-3 flex items-center gap-2 text-slate-400 text-xs">
                                        <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-500" /> Memuat data...
                                      </div>
                                    ) : rawLog ? (
                                      <div className="space-y-1.5 text-xs font-semibold text-slate-650">
                                        <div className="flex items-center justify-between border-b border-slate-100/50 pb-1">
                                          <span>Status Log:</span>
                                          <span className="text-indigo-600 uppercase text-[10px] font-bold">{String(rawLog['Jam kerja'] || 'MASUK')}</span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                          <span>Scan Masuk:</span>
                                          <span className="font-mono text-slate-500">{String(rawLog['Scan masuk'] || '--:--')}</span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                          <span>Scan Pulang:</span>
                                          <span className="font-mono text-slate-500">{String(rawLog['Scan pulang'] || '--:--')}</span>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="text-xs font-medium text-slate-400 py-3">
                                        Tidak ada scan logs asli di sistem untuk tanggal ini.
                                      </div>
                                    )}
                                  </div>

                                  <div className="bg-indigo-50/20 rounded-2xl border border-indigo-100/50 p-4 space-y-2">
                                    <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider block">Koreksi yang Diajukan</span>
                                    <div className="space-y-1.5 text-xs font-semibold text-slate-700">
                                      <div className="flex items-center justify-between border-b border-indigo-100/30 pb-1 gap-3">
                                        <span>Tipe Koreksi:</span>
                                        <span className="text-indigo-600 text-[10px] font-bold text-right">{correctionTypeLabel(req.type)}</span>
                                      </div>
                                      <div className="flex items-center justify-between">
                                        <span>Koreksi Masuk:</span>
                                        <span className="font-mono text-slate-900">{req.checkInTime || '--:--'}</span>
                                      </div>
                                      <div className="flex items-center justify-between">
                                        <span>Koreksi Pulang:</span>
                                        <span className="font-mono text-slate-900">{req.checkOutTime || '--:--'}</span>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>

                              <div className="space-y-1.5 bg-slate-50/50 p-4 rounded-2xl border border-slate-100 text-left">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Alasan Pengajuan</span>
                                <p className="text-xs text-slate-650 font-semibold leading-relaxed mt-1">{req.reason || '—'}</p>
                              </div>

                              {req.proofUrl && (
                                <div className="space-y-2 text-left">
                                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Dokumen Pendukung</span>
                                  {isImageProofUrl(req.proofUrl) ? (
                                    <div className="border border-slate-100 rounded-2xl overflow-hidden bg-slate-50 p-2 max-w-sm">
                                      <a href={req.proofUrl} target="_blank" rel="noreferrer" className="group block relative cursor-zoom-in">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={req.proofUrl} alt="Bukti Pendukung" className="max-h-[160px] object-contain rounded-xl w-full hover:opacity-90 transition-opacity" />
                                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white text-[10px] font-bold gap-1 rounded-xl">
                                          <FileText className="w-3.5 h-3.5" /> Buka Ukuran Penuh
                                        </div>
                                      </a>
                                    </div>
                                  ) : (
                                    <a href={req.proofUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs text-indigo-500 font-bold hover:underline cursor-pointer">
                                      <FileText className="w-4 h-4" /> Buka Lampiran Bukti (PDF/Dokumen)
                                    </a>
                                  )}
                                </div>
                              )}

                              {req.status === 'rejected' && req.rejectionReason && (
                                <div className="bg-rose-50 border border-rose-100 rounded-2xl p-4 text-xs text-rose-800 font-medium text-left">
                                  <strong>Catatan Penolakan Admin:</strong> {req.rejectionReason}
                                </div>
                              )}

                              {req.status === 'approved' && req.resolvedBy && (
                                <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 text-xs text-emerald-800 font-medium text-left">
                                  <strong>Disetujui dan Diterapkan oleh:</strong> {req.resolvedBy}
                                </div>
                              )}

                              {req.status === 'pending' && (
                                <div className="flex justify-end gap-3 pt-4 border-t border-slate-50">
                                  {rejectingReqId === req.id ? (
                                    <form onSubmit={handleReject} className="flex gap-2 w-full max-w-md items-center">
                                      <Input
                                        type="text"
                                        value={rejectionReason}
                                        onChange={(event) => setRejectionReason(event.target.value)}
                                        placeholder="Masukkan alasan penolakan..."
                                        required
                                        className="rounded-xl border-slate-200 text-xs h-9 bg-white w-full"
                                      />
                                      <Button
                                        type="submit"
                                        disabled={actionLoading === req.id}
                                        className="bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl text-xs h-9 px-3 shrink-0 flex items-center gap-1 cursor-pointer"
                                      >
                                        {actionLoading === req.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                                        Kirim
                                      </Button>
                                      <Button
                                        type="button"
                                        onClick={() => {
                                          setRejectingReqId(null);
                                          setRejectionReason('');
                                        }}
                                        variant="ghost"
                                        className="rounded-xl text-slate-450 hover:bg-slate-200/50 text-xs h-9 px-3 shrink-0 cursor-pointer"
                                      >
                                        Batal
                                      </Button>
                                    </form>
                                  ) : (
                                    <>
                                      <Button
                                        type="button"
                                        onClick={() => setRejectingReqId(req.id)}
                                        disabled={actionLoading !== null}
                                        variant="outline"
                                        className="text-rose-600 border-rose-200 hover:bg-rose-50 rounded-xl text-xs h-9 px-4 font-bold flex items-center gap-1.5 cursor-pointer shadow-sm bg-white"
                                      >
                                        <X className="w-3.5 h-3.5" /> Tolak
                                      </Button>
                                      <Button
                                        type="button"
                                        onClick={() => void handleApprove(req)}
                                        disabled={actionLoading !== null}
                                        className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs h-9 px-5 font-bold flex items-center gap-1.5 cursor-pointer shadow-md active:scale-95 transition-all"
                                      >
                                        {actionLoading === req.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                                        Setujui & Terapkan
                                      </Button>
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      )}

      {/* ── Blue Collar Correction & Leave Requests ───────────────── */}
      {canAuditBlueCollar && (selectedSource === 'all' || selectedSource === 'blue_collar') && (
        <Card className="bg-white rounded-[24px] shadow-[0_8px_30px_rgb(0,0,0,0.02)] border-none overflow-hidden">
          <div className="border-b border-slate-100 px-5 py-4 lg:px-6">
            <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="font-bold text-slate-800">Pengajuan Koreksi &amp; Izin Blue Collar</h2>
                <p className="text-xs text-slate-500">
                  Semua kategori Blue Collar aktif ditampilkan di sini, termasuk Pekarya dan Satpam.
                </p>
              </div>
              <span className="inline-flex w-fit items-center rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                Review oleh Kepala SatKer
              </span>
            </div>
          </div>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-24 flex flex-col items-center text-slate-400">
                <Loader2 className="w-8 h-8 animate-spin text-emerald-500 mb-4" />
                <p className="font-semibold text-sm animate-pulse">Memuat pengajuan Blue Collar...</p>
              </div>
            ) : visibleBlueCollarRequests.length === 0 ? (
              <div className="p-16 flex flex-col items-center text-center text-slate-400">
                <Clock className="w-12 h-12 mb-4 opacity-20" />
                <h4 className="text-slate-700 font-bold text-base">Tidak Ada Data</h4>
                <p className="text-xs text-slate-400 max-w-xs mt-1">
                  Belum ada pengajuan Blue Collar untuk periode dan status yang dipilih.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader className="bg-slate-50/60 sticky top-0 z-20">
                  <TableRow className="border-slate-100">
                    <TableHead className="font-bold text-slate-500">Nama Pegawai</TableHead>
                    <TableHead className="font-bold text-slate-500">Tanggal</TableHead>
                    <TableHead className="font-bold text-slate-500">Koreksi</TableHead>
                    <TableHead className="font-bold text-slate-500">Status</TableHead>
                    <TableHead className="font-bold text-slate-500 text-right pr-6">Detail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                {visibleBlueCollarRequests.map((item) => {
                  const request = item.request;
                  const isSatpam = item.source === 'satpam';
                  const reportType = isSatpam
                    ? satpamAttendanceReportType(request)
                    : pekaryaAttendanceReportType(request);
                  const status = String(request.status);
                  const reasonKey = `${item.source}:${request.id}`;
                  const isSupersede = isSatpam && status !== 'pending' && status !== 'withdrawn';
                  const canReview = status === 'pending' || isSupersede;
                  const approveAction = isSupersede ? 'supersede_approve' : 'approve';
                  const declineAction = isSupersede ? 'supersede_decline' : 'decline';
                  const date = blueCollarRequestDate(item);
                  const requestTitle = reportType === 'scan'
                    ? `Koreksi Scan · ${request.scanIn?.slice(0, 5) || '--:--'}–${request.scanOut?.slice(0, 5) || '--:--'}`
                    : isSatpam
                      ? satpamAbsenceTypeLabel(item.source === 'satpam' ? item.request.absenceType : undefined)
                      : 'Izin Resmi';
                  const shiftRegistrationConflicts =
                    isSatpam && reportType === 'izin_resmi' && item.source === 'satpam'
                      ? item.request.shiftRegistrationConflicts || []
                      : [];
                  const hasShiftRegistrationConflict =
                    isSatpam &&
                    reportType === 'izin_resmi' &&
                    item.source === 'satpam' &&
                    (item.request.hasShiftRegistrationConflict === true ||
                      shiftRegistrationConflicts.length > 0);
                  const payrollExcludedFromHarian =
                    isSatpam &&
                    item.source === 'satpam' &&
                    item.request.payrollExcludedFromHarian === true;

                  const isExpanded = !!expandedReqIds[reasonKey];
                  const isEditingType = editingTypeRequestId === reasonKey;
                  const typeActionKey = `type:${reasonKey}`;

                  return (
                    <React.Fragment key={reasonKey}>
                      <TableRow
                        role="button"
                        tabIndex={0}
                        aria-expanded={isExpanded}
                        onClick={() => setExpandedReqIds((current) => ({
                          ...current,
                          [reasonKey]: !current[reasonKey],
                        }))}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setExpandedReqIds((current) => ({
                              ...current,
                              [reasonKey]: !current[reasonKey],
                            }));
                          }
                        }}
                        className={`border-slate-100 cursor-pointer transition-colors ${isExpanded ? 'bg-indigo-50/50' : 'hover:bg-slate-50/60'}`}
                      >
                        <TableCell className="min-w-48">
                          <div className="font-bold text-slate-800">{request.employeeName || request.employeeId || '—'}</div>
                          <div className="mt-1 inline-flex items-center rounded-full border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-[10px] font-bold uppercase text-indigo-700">
                            {isSatpam
                              ? 'Satpam'
                              : `Pekarya · ${item.source === 'pekarya' ? item.request.category : ''}`}
                          </div>
                        </TableCell>
                        <TableCell className="min-w-36">
                          <div className="flex items-center gap-2 text-xs font-bold text-slate-700 font-mono">
                            <Calendar className="w-4 h-4 text-slate-400" />
                            {formatPresenceDate(date, { year: 'numeric', month: 'short', day: 'numeric' })}
                          </div>
                        </TableCell>
                        <TableCell className="min-w-52">
                          <div className="text-xs font-bold text-indigo-700">{requestTitle}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[10px] font-semibold text-slate-500">
                            {isSatpam && item.source === 'satpam' && item.request.shiftName && <span>Shift {item.request.shiftName}</span>}
                            {isSatpam && item.source === 'satpam' && item.request.postId && <span>{item.request.postId}</span>}
                            {hasShiftRegistrationConflict && (
                              <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 font-bold text-amber-800">
                                ⚠ Shift sudah terdaftar
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase ${status === 'approved'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                            : status === 'declined' || status === 'rejected'
                              ? 'bg-rose-50 text-rose-700 border border-rose-100'
                              : status === 'withdrawn'
                                ? 'bg-slate-100 text-slate-500 border border-slate-200'
                                : 'bg-amber-50 text-amber-700 border border-amber-100'}`}
                          >
                            {statusLabel(status)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          {isExpanded
                            ? <ChevronUp className="w-5 h-5 text-slate-400 ml-auto" />
                            : <ChevronDown className="w-5 h-5 text-slate-400 ml-auto" />}
                        </TableCell>
                      </TableRow>

                      {isExpanded && (
                        <TableRow className="border-slate-100 bg-white">
                          <TableCell colSpan={5} className="p-0 whitespace-normal">
                            <div className="p-5 lg:p-6 space-y-5 animate-in fade-in slide-in-from-top-1 duration-200">
                              <div className="space-y-2">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Detail Pengajuan</span>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-left">
                                  <div className="bg-slate-50 rounded-2xl border border-slate-100 p-4 space-y-2">
                                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Data Presensi</span>
                                    <div className="space-y-1.5 text-xs font-semibold text-slate-700">
                                      <div className="flex items-center justify-between gap-3 border-b border-slate-100/50 pb-1">
                                        <span>Jenis:</span>
                                        <div className="flex flex-wrap items-center justify-end gap-2">
                                          <span className="text-indigo-600 text-[10px] font-bold text-right">{requestTitle}</span>
                                          {status === 'pending' && (
                                            <Button
                                              type="button"
                                              variant="outline"
                                              onClick={(event) => {
                                                event.stopPropagation();
                                                if (isEditingType) {
                                                  cancelBlueCollarTypeEdit();
                                                } else {
                                                  startBlueCollarTypeEdit(item);
                                                }
                                              }}
                                              disabled={actionLoading !== null}
                                              className="h-7 rounded-lg border-indigo-200 px-2.5 text-[10px] font-bold text-indigo-700 hover:bg-indigo-50"
                                            >
                                              {isEditingType ? 'Tutup' : 'Ubah'}
                                            </Button>
                                          )}
                                        </div>
                                      </div>
                                      <div className="flex items-center justify-between gap-3">
                                        <span>Kategori:</span>
                                        <span className="text-slate-900">{isSatpam ? 'SATPAM' : item.source === 'pekarya' ? item.request.category : '—'}</span>
                                      </div>
                                      {isSatpam && item.source === 'satpam' && item.request.shiftName && (
                                        <div className="flex items-center justify-between gap-3">
                                          <span>Shift / Pos:</span>
                                          <span className="text-slate-900">{item.request.shiftName}{item.request.postId ? ` · ${item.request.postId}` : ''}</span>
                                        </div>
                                      )}
                                      {hasShiftRegistrationConflict && (
                                        <div className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900">
                                          <p className="font-bold">⚠ Pegawai sudah terdaftar pada shift tanggal ini</p>
                                          <p className="text-[11px] font-semibold">
                                            {status === 'approved' && payrollExcludedFromHarian
                                              ? 'Izin telah disetujui tanpa tambahan Harian karena shift ini sudah terdaftar.'
                                              : 'Jika izin disetujui, pengajuan tidak akan menambah hitungan Harian.'}
                                          </p>
                                          {shiftRegistrationConflicts.map((registration) => (
                                            <p key={registration.id} className="text-[11px] font-semibold">
                                              {registration.shiftName || 'Shift'}{registration.postId ? ` · ${registration.postId}` : ''}
                                              {registration.shiftType ? ` · ${registration.shiftType}` : ''}
                                              {registration.ketuaShiftName ? ` · Ketua: ${registration.ketuaShiftName}` : ''}
                                            </p>
                                          ))}
                                        </div>
                                      )}
                                      <div className="mt-3 border-t border-slate-100/50 pt-3">
                                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Alasan Pengajuan</span>
                                        <p className="mt-1.5 text-xs text-slate-700 font-semibold leading-relaxed">{request.reason || '—'}</p>
                                      </div>
                                      {request.approvedAmount && status === 'approved' && (
                                        <p className="pt-2 text-xs font-bold text-emerald-700">
                                          Nilai disetujui: {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(request.approvedAmount)}
                                        </p>
                                      )}
                                      {payrollExcludedFromHarian && status === 'approved' && (
                                        <p className="pt-2 text-xs font-bold text-amber-700">
                                          Disetujui tanpa tambahan Harian karena pegawai telah terdaftar pada shift ini.
                                        </p>
                                      )}
                                    </div>
                                    {isEditingType && (
                                      <div className="mt-3 space-y-3 rounded-xl border border-indigo-100 bg-indigo-50/60 p-3">
                                        <div>
                                          <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-700">
                                            Ubah Jenis Ajuan
                                          </span>
                                          <p className="mt-1 text-[11px] font-semibold text-indigo-900">
                                            Perubahan berlaku sebelum pengajuan diputuskan.
                                          </p>
                                        </div>
                                        <Select
                                          value={editingReportType}
                                          onValueChange={(value) => {
                                            if (value === 'scan' || value === 'izin_resmi') {
                                              setEditingReportType(value);
                                            }
                                          }}
                                        >
                                          <SelectTrigger className="h-10 rounded-lg border-indigo-200 bg-white text-xs font-bold text-slate-800">
                                            <SelectValue>
                                              {editingReportType === 'scan' ? 'Koreksi Scan' : 'Izin Resmi'}
                                            </SelectValue>
                                          </SelectTrigger>
                                          <SelectContent className="rounded-lg bg-white">
                                            <SelectItem value="scan" className="text-xs font-semibold">
                                              Koreksi Scan
                                            </SelectItem>
                                            <SelectItem value="izin_resmi" className="text-xs font-semibold">
                                              Izin Resmi
                                            </SelectItem>
                                          </SelectContent>
                                        </Select>
                                        {editingReportType === 'scan' && (
                                          <div className="grid grid-cols-2 gap-2">
                                            <label className="space-y-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                                              Scan masuk
                                              <Input
                                                type="time"
                                                value={editingScanIn}
                                                onChange={(event) => setEditingScanIn(event.target.value)}
                                                className="h-9 rounded-lg bg-white text-xs font-mono"
                                              />
                                            </label>
                                            <label className="space-y-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                                              Scan pulang
                                              <Input
                                                type="time"
                                                value={editingScanOut}
                                                onChange={(event) => setEditingScanOut(event.target.value)}
                                                className="h-9 rounded-lg bg-white text-xs font-mono"
                                              />
                                            </label>
                                          </div>
                                        )}
                                        {item.source === 'satpam' && editingReportType === 'izin_resmi' && (
                                          <Select
                                            value={editingAbsenceType}
                                            onValueChange={(value) => {
                                              if (value) setEditingAbsenceType(value);
                                            }}
                                          >
                                            <SelectTrigger className="h-10 rounded-lg border-indigo-200 bg-white text-xs font-bold text-slate-800">
                                              <SelectValue>Jenis alasan izin</SelectValue>
                                            </SelectTrigger>
                                            <SelectContent className="rounded-lg bg-white">
                                              {SATPAM_ABSENCE_TYPE_OPTIONS.map((option) => (
                                                <SelectItem key={option.value} value={option.value} className="text-xs font-semibold">
                                                  {option.label}
                                                </SelectItem>
                                              ))}
                                            </SelectContent>
                                          </Select>
                                        )}
                                        <div className="flex justify-end gap-2">
                                          <Button
                                            type="button"
                                            variant="outline"
                                            onClick={cancelBlueCollarTypeEdit}
                                            disabled={actionLoading !== null}
                                            className="h-8 rounded-lg bg-white px-3 text-[10px] font-bold"
                                          >
                                            Batal
                                          </Button>
                                          <Button
                                            type="button"
                                            onClick={() => void handleChangeBlueCollarType(item)}
                                            disabled={actionLoading !== null}
                                            className="h-8 rounded-lg bg-indigo-600 px-3 text-[10px] font-bold text-white hover:bg-indigo-700"
                                          >
                                            {actionLoading === typeActionKey && <Loader2 className="h-3 w-3 animate-spin" />}
                                            Simpan Jenis
                                          </Button>
                                        </div>
                                      </div>
                                    )}
                                  </div>

                                  {request.evidenceUrl && (
                                    <div className="space-y-2 text-left">
                                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Dokumen Pendukung</span>
                                      {isImageProofUrl(request.evidenceUrl) ? (
                                        <div className="border border-slate-100 rounded-2xl overflow-hidden bg-slate-50 p-2">
                                          <a href={request.evidenceUrl} target="_blank" rel="noreferrer" className="group block relative cursor-zoom-in">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img src={request.evidenceUrl} alt="Bukti Pendukung" className="max-h-[240px] object-contain rounded-xl w-full hover:opacity-90 transition-opacity" />
                                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white text-[10px] font-bold gap-1 rounded-xl">
                                              <FileText className="w-3.5 h-3.5" /> Buka Ukuran Penuh
                                            </div>
                                          </a>
                                        </div>
                                      ) : (
                                        <a href={request.evidenceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs text-indigo-500 font-bold hover:underline cursor-pointer">
                                          <FileText className="w-4 h-4" /> Buka Lampiran Bukti (PDF/Dokumen)
                                        </a>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>

                              {canReview && (
                                <div className="flex justify-end gap-3 pt-4 border-t border-slate-50">
                                  <Button
                                    type="button"
                                    onClick={() => void handleReviewBlueCollar(item, declineAction)}
                                    disabled={actionLoading !== null || isEditingType}
                                    variant="outline"
                                    className="text-rose-600 border-rose-200 hover:bg-rose-50 rounded-xl text-xs h-9 px-4 font-bold flex items-center gap-1.5 cursor-pointer shadow-sm bg-white"
                                  >
                                    <X className="w-3.5 h-3.5" /> {isSupersede ? 'Tolak Ulang' : 'Tolak'}
                                  </Button>
                                  <Button
                                    type="button"
                                    onClick={() => void handleReviewBlueCollar(item, approveAction)}
                                    disabled={actionLoading !== null || isEditingType}
                                    className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs h-9 px-5 font-bold flex items-center gap-1.5 cursor-pointer shadow-md active:scale-95 transition-all"
                                  >
                                    {actionLoading === reasonKey ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                                    {isSupersede ? 'Setujui Ulang' : 'Setujui'}
                                  </Button>
                                </div>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  );
                })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {profile && !canAuditLoyalis && !canAuditBlueCollar && (
        <Card className="rounded-2xl border-none bg-white shadow-sm">
          <CardContent className="flex flex-col items-center p-16 text-center">
            <AlertCircle className="mb-3 h-10 w-10 text-amber-500" />
            <h2 className="font-bold text-slate-800">Akses audit tidak tersedia</h2>
            <p className="mt-1 max-w-md text-sm text-slate-500">
              Halaman ini hanya dapat digunakan oleh Super Admin, Kepala SatKer, atau PJ Presensi Loyalis.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
