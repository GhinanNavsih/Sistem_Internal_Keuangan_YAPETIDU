"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { FloatingSnackbar } from '@/components/ui/floating-snackbar';
import { GantiLiburAttachmentLinks } from '@/components/GantiLiburAttachmentLinks';
import {
  GANTI_LIBUR_ATTENDANCE_CONFIRMATION_REQUIRED,
  parseGantiLiburAttendanceConfirmation,
  gantiLiburDeclineSuggestion,
  gantiLiburEmployeeKind,
  gantiLiburVerdictLabel,
  type GantiLiburAttendanceCheck,
  type GantiLiburRequest,
} from '@/lib/payroll/gantiLibur';
import type { AnnualPaidLeaveRequest } from '@/lib/payroll/annualPaidLeave';
import { isLoyalisLeaveType, loyalisLeaveTypeLabel } from '@/lib/payroll/loyalisLeaveTypes';
import { useAuth } from '@/lib/AuthContext';
import { db } from '@/lib/firebase';
import { useQueryClient } from '@tanstack/react-query';
import { getDoc, doc } from 'firebase/firestore';
import {
  useLoyalisPresenceCorrections,
  usePayrollCacheInvalidation,
} from '@/lib/queries/hooks';
import { loyalisPresenceCorrectionsKeys } from '@/lib/queries/keys';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ApiError,
  authenticatedJson,
  createFinancialRequestId,
  propagateUraianToSlips,
} from '@/lib/payroll/client';
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
  FileText,
  Check,
  X,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  ZoomIn,
  ZoomOut,
  RotateCw,
  ExternalLink,
  ClipboardCheck,
} from 'lucide-react';
import {
  asPresenceCorrectionRequest,
  correctionTimeLabel,
  correctionTypeLabel,
  formatCreatedAt,
  formatPresenceDate,
  isPresenceCorrectionType,
  parseDateOnly,
  parseDateToDDMMYYYY,
  timestampVersion,
  type LoyalisRawLog,
  type PresenceCorrectionRequest,
  type PresenceCorrectionStatus,
  type PresenceCorrectionType,
} from '@/lib/payroll/presenceCorrections';

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

export type LoyalisReviewItem =
  | { kind: 'correction'; request: PresenceCorrectionRequest }
  | { kind: 'paid_leave'; request: AnnualPaidLeaveRequest }
  | { kind: 'ganti_libur'; request: GantiLiburRequest };

interface ReviewProgressState {
  status: 'processing' | 'success' | 'error';
  scope: 'single' | 'bulk';
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  message: string;
  currentLabel?: string;
  errors?: string[];
}

const STATUS_LABELS: Record<PresenceCorrectionStatus, string> = {
  pending: 'Tertunda',
  approved: 'Disetujui',
  rejected: 'Ditolak',
};

function statusMatches(value: string, selected: PresenceCorrectionStatus | 'all'): boolean {
  if (selected === 'all') return true;
  if (selected === 'rejected') return value === 'rejected' || value === 'declined';
  return value === selected;
}

function loyalisItemKey(item: LoyalisReviewItem): string {
  return `${item.kind}:${item.request.id}`;
}

function loyalisItemDate(item: LoyalisReviewItem): string {
  if (item.kind === 'correction') return item.request.date;
  if (item.kind === 'paid_leave') return item.request.leaveDate;
  return item.request.dayOffDate;
}

function loyalisItemStatus(item: LoyalisReviewItem): string {
  return item.request.typeChangedTo ? 'type_changed' : item.request.status;
}

function requiresCanonicalLeave(item: LoyalisReviewItem): boolean {
  return item.kind === 'correction' && (item.request.type === 'cuti_tahunan' || item.request.type === 'ganti_libur');
}

function loyalisItemEmployeeName(item: LoyalisReviewItem): string {
  return item.request.employeeName || item.request.employeeId || '—';
}

function loyalisItemLabel(item: LoyalisReviewItem): string {
  return `${loyalisItemEmployeeName(item)} · ${formatPresenceDate(loyalisItemDate(item), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })}`;
}

function isImageProofUrl(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    /\.(?:jpe?g|png|gif|webp)(?:[?#]|$)/.test(normalized) ||
    normalized.includes('image%2f') ||
    normalized.includes('image/')
  );
}

function checkClass(check: GantiLiburAttendanceCheck): string {
  if (check.verdict === 'eligible') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (check.verdict === 'awaiting_upload') return 'border-slate-200 bg-slate-50 text-slate-600';
  if (check.verdict === 'absent') return 'border-rose-200 bg-rose-50 text-rose-800';
  return 'border-amber-200 bg-amber-50 text-amber-800';
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatMonth(value: string): string {
  const date = new Date(`${value}-01T00:00:00`);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(date)
    : value;
}

function formatDateDisplay(value: string): string {
  return formatPresenceDate(value, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function AttendanceCheckBadge({
  check,
  workedDate,
}: {
  check: GantiLiburAttendanceCheck;
  workedDate: string;
}) {
  const scans =
    check.scanIn || check.scanOut
      ? ` · Scan ${check.scanIn || '--:--'} – ${check.scanOut || '--:--'}`
      : '';
  return (
    <div
      className={`mt-2 inline-flex items-center rounded-sm border px-3 py-1.5 text-xs font-semibold ${checkClass(
        check,
      )}`}
    >
      {check.verdict === 'awaiting_upload'
        ? `Menunggu data presensi ${formatMonth(workedDate.slice(0, 7))}`
        : `${gantiLiburVerdictLabel(check.verdict)}${scans}`}
    </div>
  );
}

export interface LoyalisPresenceCorrectionsCardProps {
  /** Period token in format "YYYY-MM" (e.g. "2026-08") */
  period: string;
  /** Optional callback fired when a review action succeeds so parent can refresh data */
  onResolved?: () => void | Promise<void>;
}

export function LoyalisPresenceCorrectionsCard({
  period,
  onResolved,
}: LoyalisPresenceCorrectionsCardProps) {
  const { profile } = useAuth();
  const canAuditLoyalis = profile?.role === 'super_admin' || profile?.role === 'loyalis_admin';
  const queryClient = useQueryClient();
  const { invalidateLoyalisPresenceCorrections } = usePayrollCacheInvalidation();

  const [paidLeaves, setPaidLeaves] = useState<AnnualPaidLeaveRequest[]>([]);
  const [gantiLiburs, setGantiLiburs] = useState<GantiLiburRequest[]>([]);
  const [loadingExtra, setLoadingExtra] = useState(false);
  // The period whose paid-leave / ganti-libur lists have arrived at least once.
  // Only that first arrival replaces the list with a spinner; every reload
  // after an approve/decline updates the list in place, since swapping it for
  // a spinner collapses the page and the browser resets the scroll position.
  const [loadedExtraPeriod, setLoadedExtraPeriod] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<
    'pending' | 'approved' | 'rejected' | 'all'
  >('pending');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Rejection dialog states
  const [rejectingReqId, setRejectingReqId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [selectedLoyalisRequestIds, setSelectedLoyalisRequestIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [reviewProgress, setReviewProgress] = useState<ReviewProgressState | null>(null);
  const [gantiLiburConfirmation, setGantiLiburConfirmation] = useState<{
    period: string;
    scope: 'single' | 'bulk';
    items: LoyalisReviewItem[];
    checks: Array<{ request: GantiLiburRequest; check: GantiLiburAttendanceCheck }>;
  } | null>(null);

  // Type changing state
  const [editingLoyalisItem, setEditingLoyalisItem] = useState<LoyalisReviewItem | null>(null);
  const [editingLoyalisType, setEditingLoyalisType] = useState<PresenceCorrectionType>('izin_resmi');
  const [editingWorkedDate, setEditingWorkedDate] = useState('');
  const [editingLoyalisScanIn, setEditingLoyalisScanIn] = useState('07:30');
  const [editingLoyalisScanOut, setEditingLoyalisScanOut] = useState('14:00');

  // Expandable row & raw log comparison
  const [expandedReqId, setExpandedReqId] = useState<string | null>(null);
  const [rawLogsMap, setRawLogsMap] = useState<Record<string, LoyalisRawLog | null>>({});
  const [loadingRawMap, setLoadingRawMap] = useState<Record<string, boolean>>({});
  const fetchSequence = useRef(0);

  // Lightbox
  const [lightboxImageUrl, setLightboxImageUrl] = useState<string | null>(null);
  const [lightboxZoom, setLightboxZoom] = useState(1);
  const [lightboxRotation, setLightboxRotation] = useState(0);
  const [lightboxPan, setLightboxPan] = useState({ x: 0, y: 0 });
  const [isPanningLightbox, setIsPanningLightbox] = useState(false);
  const lightboxPanRef = useRef<{
    startX: number;
    startY: number;
    panX: number;
    panY: number;
    moved: boolean;
  } | null>(null);

  const openImageLightbox = (url: string) => {
    setLightboxImageUrl(url);
    setLightboxZoom(1);
    setLightboxRotation(0);
    setLightboxPan({ x: 0, y: 0 });
  };
  const closeImageLightbox = () => setLightboxImageUrl(null);

  useEffect(() => {
    if (lightboxZoom <= 1) setLightboxPan({ x: 0, y: 0 });
  }, [lightboxZoom]);

  const handleLightboxPointerDown = (event: React.PointerEvent<HTMLImageElement>) => {
    lightboxPanRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      panX: lightboxPan.x,
      panY: lightboxPan.y,
      moved: false,
    };
    setIsPanningLightbox(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleLightboxPointerMove = (event: React.PointerEvent<HTMLImageElement>) => {
    const pan = lightboxPanRef.current;
    if (!pan) return;
    const dx = event.clientX - pan.startX;
    const dy = event.clientY - pan.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) pan.moved = true;
    setLightboxPan({ x: pan.panX + dx, y: pan.panY + dy });
  };

  const handleLightboxPointerUp = (event: React.PointerEvent<HTMLImageElement>) => {
    const pan = lightboxPanRef.current;
    setIsPanningLightbox(false);
    if (pan && !pan.moved) {
      setLightboxZoom((z) => (z > 1 ? 1 : 2));
    }
    lightboxPanRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const patchCachedCorrection = useCallback(
    (requestId: string, patch: Partial<PresenceCorrectionRequest>) => {
      queryClient.setQueryData(
        loyalisPresenceCorrectionsKeys.all,
        (current: any[] | undefined) =>
          current?.map((row) => (row.id === requestId ? { ...row, ...patch } : row)),
      );
    },
    [queryClient],
  );

  useEffect(() => {
    setSelectedLoyalisRequestIds(new Set());
  }, [period, selectedStatus]);

  const loyalisCorrectionsQuery = useLoyalisPresenceCorrections(canAuditLoyalis);
  const allCorrections = useMemo<PresenceCorrectionRequest[]>(
    () =>
      (loyalisCorrectionsQuery.data || []).map((row: any) =>
        asPresenceCorrectionRequest(row.id, row),
      ),
    [loyalisCorrectionsQuery.data],
  );

  const fetchExtraRequests = useCallback(async () => {
    if (!canAuditLoyalis) {
      setPaidLeaves([]);
      setGantiLiburs([]);
      return;
    }
    const sequence = ++fetchSequence.current;
    setLoadingExtra(true);
    const year = period ? Number(period.slice(0, 4)) : new Date().getFullYear();

    try {
      const [paidLeavesRes, gantiLibursRes] = await Promise.all([
        authenticatedJson<{ requests: AnnualPaidLeaveRequest[] }>(
          `/api/payroll/paid-leave/review?year=${year}&period=${encodeURIComponent(period)}&status=all`,
        ).catch((err) => {
          console.error('Error fetching paid leave requests:', err);
          return { requests: [] };
        }),
        authenticatedJson<{ requests: GantiLiburRequest[] }>(
          `/api/payroll/ganti-libur/review?dayOffPeriod=${encodeURIComponent(period)}&status=all`,
        ).catch((err) => {
          console.error('Error fetching ganti libur requests:', err);
          return { requests: [] };
        }),
      ]);

      if (sequence !== fetchSequence.current) return;
      setPaidLeaves(paidLeavesRes.requests || []);
      setGantiLiburs(gantiLibursRes.requests || []);
      setLoadedExtraPeriod(period);
    } finally {
      if (sequence === fetchSequence.current) {
        setLoadingExtra(false);
      }
    }
  }, [canAuditLoyalis, period]);

  useEffect(() => {
    if (profile && canAuditLoyalis) {
      void fetchExtraRequests();
    }
  }, [fetchExtraRequests, profile, canAuditLoyalis]);

  const allLoyalisItems = useMemo<LoyalisReviewItem[]>(() => {
    const items: LoyalisReviewItem[] = [];
    allCorrections.forEach((req) => {
      items.push({ kind: 'correction', request: req });
    });
    paidLeaves
      .filter((pl) => pl.employeeKind === 'loyalis')
      .forEach((pl) => {
        items.push({ kind: 'paid_leave', request: pl });
      });
    gantiLiburs
      .filter((gl) => gantiLiburEmployeeKind(gl) === 'loyalis')
      .forEach((gl) => {
        items.push({ kind: 'ganti_libur', request: gl });
      });
    items.sort((a, b) => loyalisItemDate(b).localeCompare(loyalisItemDate(a)));
    return items;
  }, [allCorrections, paidLeaves, gantiLiburs]);

  const periodLoyalisItems = useMemo(
    () =>
      allLoyalisItems.filter((item) => {
        const date = loyalisItemDate(item);
        return !period || date.slice(0, 7) === period;
      }),
    [allLoyalisItems, period],
  );

  const visibleRequests = useMemo(
    () =>
      periodLoyalisItems.filter((item) => statusMatches(loyalisItemStatus(item), selectedStatus)),
    [periodLoyalisItems, selectedStatus],
  );

  const stats = useMemo(
    () => ({
      pending: periodLoyalisItems.filter((item) => loyalisItemStatus(item) === 'pending').length,
      approved: periodLoyalisItems.filter((item) => loyalisItemStatus(item) === 'approved').length,
      rejected: periodLoyalisItems.filter(
        (item) => loyalisItemStatus(item) === 'rejected' || loyalisItemStatus(item) === 'declined',
      ).length,
      total: periodLoyalisItems.length,
    }),
    [periodLoyalisItems],
  );

  const bulkEligibleLoyalisRequests = useMemo(
    () =>
      periodLoyalisItems.filter(
        (item) =>
          (selectedStatus === 'pending' || selectedStatus === 'all') &&
          loyalisItemStatus(item) === 'pending' && !requiresCanonicalLeave(item),
      ),
    [periodLoyalisItems, selectedStatus],
  );

  const selectedBulkLoyalisRequests = useMemo(
    () =>
      bulkEligibleLoyalisRequests.filter((item) =>
        selectedLoyalisRequestIds.has(loyalisItemKey(item)),
      ),
    [bulkEligibleLoyalisRequests, selectedLoyalisRequestIds],
  );

  const allBulkLoyalisRequestsSelected =
    bulkEligibleLoyalisRequests.length > 0 &&
    selectedBulkLoyalisRequests.length === bulkEligibleLoyalisRequests.length;

  const toggleLoyalisRequestSelection = (item: LoyalisReviewItem, checked: boolean) => {
    const key = loyalisItemKey(item);
    setSelectedLoyalisRequestIds((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const toggleAllLoyalisRequestSelection = (checked: boolean) => {
    setSelectedLoyalisRequestIds((current) => {
      const next = new Set(current);
      bulkEligibleLoyalisRequests.forEach((item) => {
        const key = loyalisItemKey(item);
        if (checked) next.add(key);
        else next.delete(key);
      });
      return next;
    });
  };

  const handleExpandToggle = async (item: LoyalisReviewItem) => {
    const key = loyalisItemKey(item);
    const isExpanding = expandedReqId !== key;
    setExpandedReqId(isExpanding ? key : null);

    if (item.kind !== 'correction') return;
    const req = item.request;
    const hasLoadedRawLog = Object.prototype.hasOwnProperty.call(rawLogsMap, req.id);
    if (isExpanding && !hasLoadedRawLog) {
      setLoadingRawMap((prev) => ({ ...prev, [req.id]: true }));
      try {
        const dateKey = parseDateToDDMMYYYY(req.date);
        if (!dateKey || !parseDateOnly(req.date)) {
          setRawLogsMap((prev) => ({ ...prev, [req.id]: null }));
          return;
        }

        const periodToken = req.date.slice(0, 7).replace('-', '_'); // e.g. "2026_07"
        const presenceRef = doc(db, 'LoyalisPresence', periodToken);
        const presenceSnap = await getDoc(presenceRef);
        if (presenceSnap.exists()) {
          const data = presenceSnap.data() as LoyalisPresenceDocument;
          const empEntry = data.entries?.[req.employeeId];
          const matchedLog = empEntry?.dailyLogs?.find((log) => log.Tanggal === dateKey);
          setRawLogsMap((prev) => ({ ...prev, [req.id]: matchedLog || null }));
        } else {
          setRawLogsMap((prev) => ({ ...prev, [req.id]: null }));
        }
      } catch (err) {
        console.error('Error fetching raw presence log:', err);
        setRawLogsMap((prev) => ({ ...prev, [req.id]: null }));
      } finally {
        setLoadingRawMap((prev) => ({ ...prev, [req.id]: false }));
      }
    }
  };

  const startLoyalisTypeEdit = (item: LoyalisReviewItem) => {
    setEditingLoyalisItem(item);
    setEditingLoyalisType(item.kind === 'correction' ? item.request.type : item.kind === 'paid_leave' ? 'cuti_tahunan' : 'ganti_libur');
    setEditingLoyalisScanIn(item.kind === 'correction' ? item.request.checkInTime?.slice(0, 5) || '07:30' : '07:30');
    setEditingLoyalisScanOut(item.kind === 'correction' ? item.request.checkOutTime?.slice(0, 5) || '14:00' : '14:00');
    setEditingWorkedDate(item.kind === 'ganti_libur' ? item.request.workedDate : '');
    setMessage(null);
  };

  const cancelLoyalisTypeEdit = () => {
    setEditingLoyalisItem(null);
  };

  const handleChangeLoyalisType = async () => {
    const item = editingLoyalisItem;
    if (!item || loyalisItemStatus(item) !== 'pending') return;
    const actionKey = `loyalis_type:${loyalisItemKey(item)}`;
    setActionLoading(actionKey);
    setMessage(null);
    try {
      let successText = 'Jenis pengajuan berhasil diubah.';
      if (isLoyalisLeaveType(editingLoyalisType)) {
        const res = await authenticatedJson<{ message: string; target: { kind: string; id: string } }>(
          '/api/attendance/loyalis/submission-type', {
            method: 'POST', body: JSON.stringify({
              requestId: createFinancialRequestId('loyalis-leave-type'), sourceKind: item.kind,
              sourceRequestId: item.request.id, type: editingLoyalisType,
              expectedRevision: item.request.revision || 0,
              ...(item.kind === 'correction' ? { expectedUpdatedAt: timestampVersion(item.request.updatedAt) } : {}),
              ...(editingLoyalisType === 'ganti_libur' ? { workedDate: editingWorkedDate } : {}),
            }),
          },
        );
        successText = res.message;
        setExpandedReqId(`${res.target.kind}:${res.target.id}`);
      } else if (item.kind === 'correction') {
        const nextIn = editingLoyalisType === 'both' || editingLoyalisType === 'tap_in' ? editingLoyalisScanIn : null;
        const nextOut = editingLoyalisType === 'both' || editingLoyalisType === 'tap_out' ? editingLoyalisScanOut : null;
        const res = await authenticatedJson<{ message: string }>('/api/attendance/loyalis/review', {
          method: 'POST', body: JSON.stringify({ requestId: item.request.id, action: 'change_type',
            type: editingLoyalisType, checkInTime: nextIn, checkOutTime: nextOut }),
        });
        patchCachedCorrection(item.request.id, { type: editingLoyalisType, checkInTime: nextIn, checkOutTime: nextOut });
        successText = res.message;
      }
      setEditingLoyalisItem(null);
      setMessage({
        type: 'success',
        text: successText,
      });
      await Promise.all([invalidateLoyalisPresenceCorrections(), fetchExtraRequests()]);
    } catch (err: unknown) {
      console.error(err);
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal mengubah jenis pengajuan.',
      });
    } finally {
      setActionLoading(null);
    }
  };

  const applyLoyalisApproval = async (req: PresenceCorrectionRequest) => {
    const dateKey = parseDateToDDMMYYYY(req.date);
    if (!dateKey || !parseDateOnly(req.date)) {
      throw new Error('Tanggal koreksi tidak valid.');
    }

    const res = await authenticatedJson<{ success: boolean; message: string }>(
      '/api/attendance/loyalis/review',
      {
        method: 'POST',
        body: JSON.stringify({
          requestId: req.id,
          action: 'approve',
        }),
      },
    );

    patchCachedCorrection(req.id, {
      status: 'approved',
      resolvedBy: profile?.email || 'Admin',
    });

    return {
      dateKey,
      successText:
        res.message ||
        `Koreksi presensi ${req.employeeName || req.employeeId} untuk tanggal ${dateKey} berhasil disetujui dan diterapkan.`,
    };
  };

  const approvePaidLeaveItem = async (item: AnnualPaidLeaveRequest) => {
    await authenticatedJson('/api/payroll/paid-leave/review', {
      method: 'POST',
      body: JSON.stringify({
        requestId: createFinancialRequestId('annual-paid-leave-approve'),
        annualPaidLeaveRequestId: item.id,
        action: 'approve',
        expectedRevision: item.revision,
        reason: '',
      }),
    });
    try {
      if (item.employeeKind === 'loyalis') {
        await propagateUraianToSlips({ scope: 'loyalis', period: item.period });
      }
    } catch (propagateError) {
      console.error('Annual paid leave propagation failed:', propagateError);
    }
  };

  const declinePaidLeaveItem = async (item: AnnualPaidLeaveRequest, reason: string) => {
    await authenticatedJson('/api/payroll/paid-leave/review', {
      method: 'POST',
      body: JSON.stringify({
        requestId: createFinancialRequestId('annual-paid-leave-decline'),
        annualPaidLeaveRequestId: item.id,
        action: 'decline',
        expectedRevision: item.revision,
        reason: reason.trim(),
      }),
    });
  };

  const approveGantiLiburItem = async (
    item: GantiLiburRequest,
    attendanceConfirmation?: GantiLiburAttendanceCheck,
  ) => {
    await authenticatedJson('/api/payroll/ganti-libur/review', {
      method: 'POST',
      body: JSON.stringify({
        requestId: createFinancialRequestId('ganti-libur-approve'),
        gantiLiburRequestId: item.id,
        action: 'approve',
        expectedRevision: item.revision,
        reason: '',
        ...(attendanceConfirmation ? { attendanceConfirmation } : {}),
      }),
    });
  };

  const declineGantiLiburItem = async (item: GantiLiburRequest, reason: string) => {
    await authenticatedJson('/api/payroll/ganti-libur/review', {
      method: 'POST',
      body: JSON.stringify({
        requestId: createFinancialRequestId('ganti-libur-decline'),
        gantiLiburRequestId: item.id,
        action: 'decline',
        expectedRevision: item.revision,
        reason: reason.trim(),
      }),
    });
  };

  const handleApproveLoyalisItem = async (
    item: LoyalisReviewItem,
    attendanceConfirmation?: GantiLiburAttendanceCheck,
  ) => {
    if (requiresCanonicalLeave(item)) {
      startLoyalisTypeEdit(item);
      return;
    }
    if (item.kind === 'ganti_libur' && !attendanceConfirmation &&
      item.request.attendanceCheck && item.request.attendanceCheck.verdict !== 'eligible') {
      setGantiLiburConfirmation({
        period, scope: 'single', items: [item],
        checks: [{ request: item.request, check: item.request.attendanceCheck }],
      });
      return;
    }
    const key = loyalisItemKey(item);
    setActionLoading(key);
    setMessage(null);
    setReviewProgress({
      status: 'processing',
      scope: 'single',
      total: 1,
      completed: 0,
      succeeded: 0,
      failed: 0,
      currentLabel: loyalisItemLabel(item),
      message: 'Menyimpan persetujuan pengajuan Loyalis.',
    });
    try {
      let successText = '';
      if (item.kind === 'correction') {
        const result = await applyLoyalisApproval(item.request);
        await invalidateLoyalisPresenceCorrections();
        successText = result.successText;
      } else if (item.kind === 'paid_leave') {
        await approvePaidLeaveItem(item.request);
        await fetchExtraRequests();
        successText = `Cuti tahunan ${loyalisItemEmployeeName(item)} berhasil disetujui.`;
      } else if (item.kind === 'ganti_libur') {
        await approveGantiLiburItem(item.request, attendanceConfirmation);
        const slipMessage = await propagateUraianToSlips({
          scope: 'loyalis', period: item.request.dayOffPeriod,
        });
        await fetchExtraRequests();
        successText = `Ganti libur ${loyalisItemEmployeeName(item)} berhasil disetujui.${slipMessage}`;
      }
      setMessage({ type: 'success', text: successText });
      setReviewProgress({
        status: 'success',
        scope: 'single',
        total: 1,
        completed: 1,
        succeeded: 1,
        failed: 0,
        message: successText,
      });
      if (onResolved) await onResolved();
    } catch (err: unknown) {
      if (item.kind === 'ganti_libur' && err instanceof ApiError &&
        err.code === GANTI_LIBUR_ATTENDANCE_CONFIRMATION_REQUIRED) {
        const details = err.details as { attendanceCheck?: unknown } | undefined;
        const check = parseGantiLiburAttendanceConfirmation(details?.attendanceCheck);
        if (check) {
          setReviewProgress(null);
          setGantiLiburConfirmation({
            period, scope: 'single', items: [item], checks: [{ request: item.request, check }],
          });
          return;
        }
      }
      console.error(err);
      const errorText = err instanceof Error ? err.message : 'Gagal menyetujui pengajuan Loyalis.';
      setMessage({
        type: 'error',
        text: errorText,
      });
      setReviewProgress({
        status: 'error',
        scope: 'single',
        total: 1,
        completed: 1,
        succeeded: 0,
        failed: 1,
        message: errorText,
        errors: [errorText],
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleBulkApproveLoyalisRequests = async (
    confirmedItems?: LoyalisReviewItem[],
    attendanceConfirmations?: Map<string, GantiLiburAttendanceCheck>,
  ) => {
    const selectedItems = confirmedItems || bulkEligibleLoyalisRequests.filter((item) =>
      selectedLoyalisRequestIds.has(loyalisItemKey(item)),
    );
    if (selectedItems.length === 0) {
      setMessage({ type: 'error', text: 'Pilih minimal satu pengajuan Loyalis untuk disetujui.' });
      return;
    }

    if (!confirmedItems) {
      const checks = selectedItems.flatMap((item) =>
        item.kind === 'ganti_libur' && item.request.attendanceCheck &&
          item.request.attendanceCheck.verdict !== 'eligible'
          ? [{ request: item.request, check: item.request.attendanceCheck }] : [],
      );
      if (checks.length > 0) {
        setGantiLiburConfirmation({ period, scope: 'bulk', items: selectedItems, checks });
        return;
      }
    }

    setActionLoading('bulk-loyalis-approve');
    setMessage(null);
    setReviewProgress({
      status: 'processing',
      scope: 'bulk',
      total: selectedItems.length,
      completed: 0,
      succeeded: 0,
      failed: 0,
      currentLabel: loyalisItemLabel(selectedItems[0]),
      message: `Menyimpan ${selectedItems.length} persetujuan pengajuan Loyalis.`,
    });

    let succeeded = 0;
    const errors: string[] = [];
    const gantiLiburPeriods = new Set<string>();
    try {
      for (let index = 0; index < selectedItems.length; index += 1) {
        const item = selectedItems[index];
        setReviewProgress((current) =>
          current
            ? {
                ...current,
                currentLabel: loyalisItemLabel(item),
                message: `Menyimpan persetujuan ${index + 1} dari ${selectedItems.length}.`,
              }
            : current,
        );
        try {
          if (item.kind === 'correction') {
            await applyLoyalisApproval(item.request);
          } else if (item.kind === 'paid_leave') {
            await approvePaidLeaveItem(item.request);
          } else if (item.kind === 'ganti_libur') {
            await approveGantiLiburItem(item.request, attendanceConfirmations?.get(item.request.id));
            gantiLiburPeriods.add(item.request.dayOffPeriod);
          }
          succeeded += 1;
        } catch (err: unknown) {
          const errorText =
            err instanceof Error ? err.message : 'Gagal menyetujui pengajuan Loyalis.';
          errors.push(`${loyalisItemLabel(item)}: ${errorText}`);
          console.error('Error bulk approving Loyalis request:', err);
        }
        setReviewProgress((current) =>
          current
            ? {
                ...current,
                completed: index + 1,
                succeeded,
                failed: index + 1 - succeeded,
              }
            : current,
        );
      }

      setSelectedLoyalisRequestIds(new Set());
      await Promise.all([invalidateLoyalisPresenceCorrections(), fetchExtraRequests()]);
      if (onResolved) await onResolved();

      let slipMessage = '';
      for (const dayOffPeriod of gantiLiburPeriods) {
        slipMessage += await propagateUraianToSlips({ scope: 'loyalis', period: dayOffPeriod });
      }
      const failed = errors.length;
      const summaryMessage = (
        failed === 0
          ? `${succeeded} pengajuan Loyalis berhasil disetujui dan disimpan.`
          : `${succeeded} pengajuan Loyalis berhasil disetujui; ${failed} pengajuan gagal diproses.`
      ) + slipMessage;
      setReviewProgress({
        status: failed === 0 ? 'success' : 'error',
        scope: 'bulk',
        total: selectedItems.length,
        completed: selectedItems.length,
        succeeded,
        failed,
        message: summaryMessage,
        errors: failed > 0 ? errors : undefined,
      });
      setMessage({
        type: failed === 0 ? 'success' : 'error',
        text: summaryMessage,
      });
    } catch (err: unknown) {
      const errorText =
        err instanceof Error ? err.message : 'Gagal menyelesaikan persetujuan massal Loyalis.';
      console.error('Error finishing bulk Loyalis approval:', err);
      setReviewProgress({
        status: 'error',
        scope: 'bulk',
        total: selectedItems.length,
        completed: succeeded,
        succeeded,
        failed: selectedItems.length - succeeded,
        message: errorText,
        errors: [...errors, errorText],
      });
      setMessage({ type: 'error', text: errorText });
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectingReqId) return;
    if (!rejectionReason.trim()) {
      setMessage({ type: 'error', text: 'Masukkan alasan penolakan pengajuan.' });
      return;
    }

    const key = rejectingReqId;
    setActionLoading(key);
    try {
      const loyalisItem = allLoyalisItems.find((item) => loyalisItemKey(item) === key);

      if (loyalisItem) {
        if (loyalisItem.kind === 'correction') {
          await authenticatedJson<{ success: boolean; message: string }>(
            '/api/attendance/loyalis/review',
            {
              method: 'POST',
              body: JSON.stringify({
                requestId: loyalisItem.request.id,
                action: 'decline',
                rejectionReason: rejectionReason.trim(),
              }),
            },
          );
          patchCachedCorrection(loyalisItem.request.id, {
            status: 'rejected',
            rejectionReason: rejectionReason.trim(),
            resolvedBy: profile?.email || 'Admin',
          });
          await invalidateLoyalisPresenceCorrections();
        } else if (loyalisItem.kind === 'paid_leave') {
          await declinePaidLeaveItem(loyalisItem.request, rejectionReason);
          await fetchExtraRequests();
        } else if (loyalisItem.kind === 'ganti_libur') {
          await declineGantiLiburItem(loyalisItem.request, rejectionReason);
          await fetchExtraRequests();
        }
        setMessage({ type: 'success', text: 'Pengajuan Loyalis berhasil ditolak.' });
        if (onResolved) await onResolved();
      }
      setRejectingReqId(null);
      setRejectionReason('');
    } catch (err: unknown) {
      console.error(err);
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal menolak pengajuan.',
      });
    } finally {
      setActionLoading(null);
    }
  };

  const loading = loyalisCorrectionsQuery.isFetching || loadingExtra;
  const initialLoading =
    loyalisCorrectionsQuery.isLoading ||
    (loadingExtra && loadedExtraPeriod !== period);

  if (!canAuditLoyalis) return null;

  return (
    <>
      <FloatingSnackbar message={message} />

      <Card className="bg-white rounded-md shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-none overflow-hidden">
        {/* Header */}
        <div className="border-b border-slate-100 px-5 py-4 lg:px-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <ClipboardCheck className="w-5 h-5 text-indigo-600" />
                <h2 className="font-bold text-slate-800 text-sm sm:text-base">
                  Pengajuan Koreksi Presensi Loyalis
                </h2>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Review koreksi scan presensi, cuti tahunan, dan ganti libur pegawai Loyalis untuk
                periode <span className="font-semibold text-slate-700">{period}</span>.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Quick Status Pill Filters */}
              <div className="inline-flex rounded-md bg-slate-100/80 p-1 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setSelectedStatus('pending')}
                  className={`flex items-center gap-1.5 rounded-sm px-2.5 py-1 transition-all ${
                    selectedStatus === 'pending'
                      ? 'bg-white text-amber-700 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Tertunda
                  {stats.pending > 0 && (
                    <span className="rounded-sm bg-amber-100 px-1.5 py-0.2 text-[10px] font-bold text-amber-800">
                      {stats.pending}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedStatus('approved')}
                  className={`flex items-center gap-1.5 rounded-sm px-2.5 py-1 transition-all ${
                    selectedStatus === 'approved'
                      ? 'bg-white text-emerald-700 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Disetujui
                  {stats.approved > 0 && (
                    <span className="rounded-sm bg-emerald-100 px-1.5 py-0.2 text-[10px] font-bold text-emerald-800">
                      {stats.approved}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedStatus('rejected')}
                  className={`flex items-center gap-1.5 rounded-sm px-2.5 py-1 transition-all ${
                    selectedStatus === 'rejected'
                      ? 'bg-white text-rose-700 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Ditolak
                  {stats.rejected > 0 && (
                    <span className="rounded-sm bg-rose-100 px-1.5 py-0.2 text-[10px] font-bold text-rose-800">
                      {stats.rejected}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedStatus('all')}
                  className={`flex items-center gap-1.5 rounded-sm px-2.5 py-1 transition-all ${
                    selectedStatus === 'all'
                      ? 'bg-white text-slate-800 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Semua
                  <span className="text-[10px] text-slate-400 font-bold">({stats.total})</span>
                </button>
              </div>

              {/* Refresh Button */}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  void invalidateLoyalisPresenceCorrections();
                  void fetchExtraRequests();
                }}
                disabled={loading}
                className="h-8 rounded-sm border-slate-200 bg-white text-slate-600 hover:bg-slate-50 text-xs"
              >
                <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
                Segarkan
              </Button>

              {/* Bulk Approve Button: always rendered, hidden when nothing is
                  approvable, so the header keeps its size when the filter changes. */}
              <Button
                type="button"
                onClick={() => void handleBulkApproveLoyalisRequests()}
                disabled={actionLoading !== null || selectedBulkLoyalisRequests.length === 0}
                aria-hidden={bulkEligibleLoyalisRequests.length === 0}
                tabIndex={bulkEligibleLoyalisRequests.length === 0 ? -1 : undefined}
                className={`h-8 min-w-40 justify-center rounded-sm bg-indigo-600 px-3 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 ${
                  bulkEligibleLoyalisRequests.length === 0 ? 'invisible' : ''
                }`}
              >
                {actionLoading === 'bulk-loyalis-approve' ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="mr-1.5 h-3.5 w-3.5" />
                )}
                Setujui Terpilih ({selectedBulkLoyalisRequests.length})
              </Button>
            </div>
          </div>
        </div>

        {/* Content Table */}
        <CardContent className="p-0">
          {initialLoading ? (
            <div className="p-20 flex flex-col items-center text-slate-400">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mb-3" />
              <p className="font-semibold text-xs animate-pulse">Memuat daftar pengajuan Loyalis...</p>
            </div>
          ) : visibleRequests.length === 0 ? (
            <div className="p-16 flex flex-col items-center text-center text-slate-400">
              <Clock className="w-10 h-10 mb-3 opacity-25" />
              <h4 className="text-slate-700 font-bold text-sm">Tidak Ada Pengajuan</h4>
              <p className="text-xs text-slate-400 max-w-xs mt-1">
                Belum ada pengajuan koreksi presensi Loyalis untuk periode {period} dengan status{' '}
                {selectedStatus === 'all' ? 'apapun' : STATUS_LABELS[selectedStatus]}.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-slate-50/70 sticky top-0 z-20">
                <TableRow className="border-slate-100">
                  <TableHead className="w-12 pl-5">
                    <Checkbox
                      checked={allBulkLoyalisRequestsSelected}
                      onCheckedChange={(checked) =>
                        toggleAllLoyalisRequestSelection(checked === true)
                      }
                      disabled={bulkEligibleLoyalisRequests.length === 0 || actionLoading !== null}
                      aria-label="Pilih semua pengajuan Loyalis tertunda"
                    />
                    <span className="sr-only">Pilih pengajuan Loyalis</span>
                  </TableHead>
                  <TableHead className="font-bold text-slate-500 text-xs">Nama Pegawai</TableHead>
                  <TableHead className="font-bold text-slate-500 text-xs">Tanggal</TableHead>
                  <TableHead className="font-bold text-slate-500 text-xs">Koreksi</TableHead>
                  <TableHead className="font-bold text-slate-500 text-xs">Status</TableHead>
                  <TableHead className="font-bold text-slate-500 text-right pr-6 text-xs">
                    Detail
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRequests.map((item) => {
                  const key = loyalisItemKey(item);
                  const isExpanded = expandedReqId === key;
                  const employeeName = loyalisItemEmployeeName(item);
                  const date = loyalisItemDate(item);
                  const status = loyalisItemStatus(item);
                  const statusLbl = status === 'type_changed' ? 'Jenis Diubah' : STATUS_LABELS[status as PresenceCorrectionStatus] || status;
                  const req = item.kind === 'correction' ? item.request : null;
                  const rawLog = req ? rawLogsMap[req.id] : null;
                  const loadingRaw = req ? !!loadingRawMap[req.id] : false;

                  return (
                    <React.Fragment key={key}>
                      <TableRow
                        role="button"
                        tabIndex={0}
                        aria-expanded={isExpanded}
                        onClick={() => void handleExpandToggle(item)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            void handleExpandToggle(item);
                          }
                        }}
                        className={`border-slate-100 cursor-pointer transition-colors ${
                          isExpanded ? 'bg-indigo-50/40' : 'hover:bg-slate-50/60'
                        }`}
                      >
                        <TableCell
                          className="w-12 pl-5"
                          onClick={(event) => event.stopPropagation()}
                        >
                          {status === 'pending' && !requiresCanonicalLeave(item) && (
                            <Checkbox
                              checked={selectedLoyalisRequestIds.has(key)}
                              onCheckedChange={(checked) =>
                                toggleLoyalisRequestSelection(item, checked === true)
                              }
                              disabled={actionLoading !== null}
                              aria-label={`Pilih pengajuan Loyalis ${employeeName}`}
                            />
                          )}
                        </TableCell>
                        <TableCell className="min-w-48">
                          <div className="font-bold text-slate-800 text-xs sm:text-sm">
                            {employeeName}
                          </div>
                          {item.kind === 'correction' ? (
                            <div className="text-[10px] text-slate-400 font-semibold mt-0.5">
                              Diajukan {formatCreatedAt(item.request.createdAt)}
                            </div>
                          ) : item.kind === 'paid_leave' ? (
                            <div className="mt-0.5 inline-flex items-center rounded-sm border border-emerald-100 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                              Cuti Tahunan · Periode {item.request.period}
                            </div>
                          ) : (
                            <div className="mt-0.5 inline-flex items-center rounded-sm border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700">
                              Ganti Libur · {item.request.category || 'LOYALIS'}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="min-w-36">
                          <div className="flex items-center gap-2 text-xs font-bold text-slate-700 font-mono">
                            <Calendar className="w-3.5 h-3.5 text-slate-400" />
                            {formatPresenceDate(date, {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                            })}
                          </div>
                        </TableCell>
                        <TableCell className="min-w-48">
                          {item.kind === 'correction' ? (
                            <>
                              <div className="text-xs font-bold text-indigo-700">
                                {correctionTypeLabel(item.request.type)}
                              </div>
                              <div className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500 font-mono mt-0.5">
                                <Clock className="w-3 h-3 text-indigo-400" />
                                {correctionTimeLabel(item.request)}
                              </div>
                            </>
                          ) : item.kind === 'paid_leave' ? (
                            <>
                              <div className="text-xs font-bold text-emerald-700">Cuti Tahunan</div>
                              <div className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500 font-mono mt-0.5">
                                <Calendar className="w-3 h-3 text-emerald-500" />
                                Hak cuti: {formatDateDisplay(item.request.qualifyingDate)}
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="text-xs font-bold text-indigo-700">Ganti Libur</div>
                              <div className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500 font-mono mt-0.5">
                                <Clock className="w-3 h-3 text-indigo-400" />
                                Kerja: {formatDateDisplay(item.request.workedDate)}
                              </div>
                            </>
                          )}
                        </TableCell>
                        <TableCell>
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-sm text-[10px] font-bold uppercase ${
                              status === 'approved'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                                : status === 'rejected' || status === 'declined'
                                  ? 'bg-rose-50 text-rose-700 border border-rose-100'
                                  : status === 'withdrawn' || status === 'type_changed'
                                    ? 'bg-slate-100 text-slate-500 border border-slate-200'
                                    : 'bg-amber-50 text-amber-700 border border-amber-100'
                            }`}
                          >
                            {statusLbl}
                          </span>
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          {isExpanded ? (
                            <ChevronUp className="w-4 h-4 text-slate-400 ml-auto" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-slate-400 ml-auto" />
                          )}
                        </TableCell>
                      </TableRow>

                      {isExpanded && (
                        <TableRow className="border-slate-100 bg-white">
                          <TableCell colSpan={6} className="p-0 whitespace-normal">
                            <div className="p-5 lg:p-6 space-y-5 animate-in fade-in slide-in-from-top-1 duration-200">
                              {item.kind === 'correction' ? (
                                <>
                                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                                    <div className="space-y-4">
                                      <div className="space-y-2">
                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                                          Bandingkan Data Presensi
                                        </span>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-left">
                                          <div className="bg-slate-50 rounded-md border border-slate-100 p-4 space-y-2">
                                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                                              Data Log Asli (Excel)
                                            </span>
                                            {loadingRaw ? (
                                              <div className="py-3 flex items-center gap-2 text-slate-400 text-xs">
                                                <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-500" />{' '}
                                                Memuat data...
                                              </div>
                                            ) : rawLog ? (
                                              <div className="space-y-1.5 text-xs font-semibold text-slate-650">
                                                <div className="flex items-center justify-between border-b border-slate-100/50 pb-1">
                                                  <span>Status Log:</span>
                                                  <span className="text-indigo-600 uppercase text-[10px] font-bold">
                                                    {String(rawLog['Jam kerja'] || 'MASUK')}
                                                  </span>
                                                </div>
                                                <div className="flex items-center justify-between">
                                                  <span>Scan Masuk:</span>
                                                  <span className="font-mono text-slate-500">
                                                    {String(rawLog['Scan masuk'] || '--:--')}
                                                  </span>
                                                </div>
                                                <div className="flex items-center justify-between">
                                                  <span>Scan Pulang:</span>
                                                  <span className="font-mono text-slate-500">
                                                    {String(rawLog['Scan pulang'] || '--:--')}
                                                  </span>
                                                </div>
                                              </div>
                                            ) : (
                                              <div className="text-xs font-medium text-slate-400 py-3">
                                                Tidak ada scan logs asli di sistem untuk tanggal ini.
                                              </div>
                                            )}
                                          </div>

                                          <div className="bg-indigo-50/20 rounded-md border border-indigo-100/50 p-4 space-y-2">
                                            <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider block">
                                              Koreksi yang Diajukan
                                            </span>
                                            <div className="space-y-1.5 text-xs font-semibold text-slate-700">
                                              <div className="flex items-center justify-between border-b border-indigo-100/30 pb-1 gap-3">
                                                <span>Tipe Koreksi:</span>
                                                <div className="flex items-center gap-2">
                                                  <span className="text-indigo-600 text-[10px] font-bold text-right">
                                                    {correctionTypeLabel(item.request.type)}
                                                  </span>
                                                  {status === 'pending' &&
                                                    canAuditLoyalis && (
                                                      <Button
                                                        type="button"
                                                        variant="outline"
                                                        onClick={(event) => {
                                                          event.stopPropagation();
                                                          startLoyalisTypeEdit(item);
                                                        }}
                                                        disabled={actionLoading !== null}
                                                        className="h-6 rounded-sm border-indigo-200 px-2 text-[10px] font-bold text-indigo-700 hover:bg-indigo-50"
                                                      >
                                                        Ubah
                                                      </Button>
                                                    )}
                                                </div>
                                              </div>
                                              <div className="flex items-center justify-between">
                                                <span>Koreksi Masuk:</span>
                                                <span className="font-mono text-slate-900">
                                                  {item.request.checkInTime || '--:--'}
                                                </span>
                                              </div>
                                              <div className="flex items-center justify-between">
                                                <span>Koreksi Pulang:</span>
                                                <span className="font-mono text-slate-900">
                                                  {item.request.checkOutTime || '--:--'}
                                                </span>
                                              </div>
                                            </div>

                                          </div>
                                        </div>
                                      </div>

                                      <div className="space-y-1.5 bg-slate-50/50 p-4 rounded-md border border-slate-100 text-left">
                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                                          Alasan Pengajuan
                                        </span>
                                        <p className="text-xs text-slate-650 font-semibold leading-relaxed mt-1">
                                          {item.request.reason || '—'}
                                        </p>
                                      </div>
                                    </div>

                                    <div className="text-left">
                                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-2">
                                        Dokumen Pendukung
                                      </span>
                                      {item.request.attachments?.length ? (
                                        <GantiLiburAttachmentLinks attachments={item.request.attachments} />
                                      ) : item.request.proofUrl ? (
                                        isImageProofUrl(item.request.proofUrl) ? (
                                          <div className="border border-slate-100 rounded-md overflow-hidden bg-slate-50 p-2 h-[calc(100%-1.25rem)]">
                                            <button
                                              type="button"
                                              onClick={() =>
                                                openImageLightbox(item.request.proofUrl as string)
                                              }
                                              className="group block relative cursor-zoom-in h-full w-full"
                                            >
                                              {/* eslint-disable-next-line @next/next/no-img-element */}
                                              <img
                                                src={item.request.proofUrl}
                                                alt="Bukti Pendukung"
                                                className="h-full max-h-[280px] object-contain rounded-sm w-full hover:opacity-90 transition-opacity"
                                              />
                                              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white text-[10px] font-bold gap-1 rounded-sm">
                                                <ZoomIn className="w-3.5 h-3.5" /> Perbesar Gambar
                                              </div>
                                            </button>
                                          </div>
                                        ) : (
                                          <a
                                            href={item.request.proofUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="inline-flex items-center gap-1.5 text-xs text-indigo-500 font-bold hover:underline cursor-pointer"
                                          >
                                            <FileText className="w-4 h-4" /> Buka Lampiran Bukti
                                            (PDF/Dokumen)
                                          </a>
                                        )
                                      ) : (
                                        <div className="h-[calc(100%-1.25rem)] min-h-[160px] flex items-center justify-center rounded-md border border-dashed border-slate-200 text-xs font-semibold text-slate-400">
                                          Tidak ada dokumen pendukung
                                        </div>
                                      )}
                                      {item.request.attachments?.length && item.request.proofUrl &&
                                        !item.request.attachments.some((attachment) => attachment.url === item.request.proofUrl) ? (
                                        <a href={item.request.proofUrl} target="_blank" rel="noopener noreferrer"
                                          className="mt-2 inline-flex text-xs font-medium text-indigo-600 underline">Lihat bukti terbaru</a>
                                      ) : null}
                                    </div>
                                  </div>

                                  {status === 'rejected' &&
                                    item.request.rejectionReason && (
                                      <div className="bg-rose-50 border border-rose-100 rounded-md p-4 text-xs text-rose-800 font-medium text-left">
                                        <strong>Catatan Penolakan Admin:</strong>{' '}
                                        {item.request.rejectionReason}
                                      </div>
                                    )}

                                  {item.request.status === 'approved' && item.request.resolvedBy && (
                                    <div className="bg-emerald-50 border border-emerald-100 rounded-md p-4 text-xs text-emerald-800 font-medium text-left">
                                      <strong>Disetujui dan Diterapkan oleh:</strong>{' '}
                                      {item.request.resolvedBy}
                                    </div>
                                  )}
                                </>
                              ) : item.kind === 'paid_leave' ? (
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                                  <div className="space-y-4">
                                    <div className="bg-slate-50 rounded-md border border-slate-100 p-4 space-y-2 text-left">
                                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                                        Detail Cuti Tahunan
                                      </span>
                                      <div className="space-y-2 text-xs font-semibold text-slate-700">
                                        <div className="flex items-center justify-between border-b border-slate-100/50 pb-1">
                                          <span>Periode / Tahun:</span>
                                          <span className="font-bold text-slate-900">
                                            {item.request.period} (Tahun {item.request.year})
                                          </span>
                                        </div>
                                        <div className="flex items-center justify-between border-b border-slate-100/50 pb-1">
                                          <span>Tanggal Cuti:</span>
                                          <span className="font-mono text-slate-900">
                                            {formatDateDisplay(item.request.leaveDate)}
                                          </span>
                                        </div>
                                        <div className="flex items-center justify-between border-b border-slate-100/50 pb-1">
                                          <span>Mulai Kerja:</span>
                                          <span className="font-mono text-slate-900">
                                            {formatDateDisplay(item.request.serviceDate)}
                                          </span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                          <span>Hak Cuti Mulai:</span>
                                          <span className="font-mono text-slate-900">
                                            {formatDateDisplay(item.request.qualifyingDate)}
                                          </span>
                                        </div>
                                      </div>
                                      {item.request.status === 'approved' && (
                                        <div className="mt-2 pt-2 border-t border-slate-100/50 text-xs font-bold text-emerald-700">
                                          {item.request.approvedPayType || 'Cuti'}
                                          {item.request.approvedAmount
                                            ? ` · ${formatMoney(item.request.approvedAmount)}`
                                            : ''}
                                        </div>
                                      )}
                                    </div>

                                    <div className="space-y-1.5 bg-slate-50/50 p-4 rounded-md border border-slate-100 text-left">
                                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                                        Alasan Pengajuan
                                      </span>
                                      <p className="text-xs text-slate-650 font-semibold leading-relaxed mt-1">
                                        {item.request.reason || '—'}
                                      </p>
                                    </div>
                                  </div>

                                  <div className="text-left space-y-4">
                                    <div className="space-y-2">
                                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                                        Informasi &amp; Catatan
                                      </span>
                                      <div className="rounded-md border border-slate-100 bg-slate-50 p-4 text-xs font-medium text-slate-600 space-y-2">
                                        <p>
                                          Persetujuan cuti tahunan Loyalis membuat presensi
                                          berbayar penuh pada tanggal pengajuan.
                                        </p>
                                        <p>
                                          Penolakan akan melepaskan reservasi saldo cuti tanpa
                                          memotong kuota.
                                        </p>
                                      </div>
                                    </div>
                                    {item.request.decisionReason && (
                                      <div
                                        className={`p-4 rounded-md border text-xs font-medium text-left ${
                                          item.request.status === 'approved'
                                            ? 'bg-emerald-50 border-emerald-100 text-emerald-800'
                                            : 'bg-rose-50 border-rose-100 text-rose-800'
                                        }`}
                                      >
                                        <strong>Catatan Keputusan:</strong>{' '}
                                        {item.request.decisionReason}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ) : (
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                                  <div className="space-y-4">
                                    <div className="bg-slate-50 rounded-md border border-slate-100 p-4 space-y-2 text-left">
                                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                                        Detail Ganti Libur
                                      </span>
                                      <div className="space-y-2 text-xs font-semibold text-slate-700">
                                        <div className="flex items-center justify-between border-b border-slate-100/50 pb-1">
                                          <span>Tanggal Libur:</span>
                                          <span className="font-mono text-slate-900">
                                            {formatDateDisplay(item.request.dayOffDate)}
                                          </span>
                                        </div>
                                        <div className="flex items-center justify-between border-b border-slate-100/50 pb-1">
                                          <span>Masuk Hari Libur:</span>
                                          <span className="font-mono text-slate-900">
                                            {formatDateDisplay(item.request.workedDate)}
                                          </span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                          <span>Kategori:</span>
                                          <span className="text-slate-900">
                                            {item.request.category || 'LOYALIS'}
                                          </span>
                                        </div>
                                      </div>
                                      {item.request.attendanceCheck && (
                                        <AttendanceCheckBadge
                                          check={item.request.attendanceCheck}
                                          workedDate={item.request.workedDate}
                                        />
                                      )}
                                      {item.request.status === 'approved' && item.request.attendanceOverride && (
                                        <p className="text-xs text-amber-800">
                                          Disetujui dengan konfirmasi presensi oleh{' '}
                                          {item.request.attendanceOverride.confirmedByName || 'admin'}.
                                        </p>
                                      )}
                                    </div>

                                    <div className="space-y-1.5 bg-slate-50/50 p-4 rounded-md border border-slate-100 text-left">
                                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                                        Alasan Pengajuan
                                      </span>
                                      <p className="text-xs text-slate-650 font-semibold leading-relaxed mt-1">
                                        {item.request.reason || '—'}
                                      </p>
                                    </div>
                                  </div>

                                  <div className="text-left space-y-4">
                                    <div>
                                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-2">
                                        Dokumen / Surat Resmi
                                      </span>
                                      {item.request.attachments &&
                                      item.request.attachments.length > 0 ? (
                                        <div className="rounded-md border border-slate-100 bg-slate-50 p-4">
                                          <div className="text-xs font-semibold text-slate-500 mb-2">
                                            Surat resmi ({item.request.attachments.length})
                                          </div>
                                          <GantiLiburAttachmentLinks
                                            attachments={item.request.attachments}
                                          />
                                        </div>
                                      ) : (
                                        <div className="h-28 flex items-center justify-center rounded-md border border-dashed border-slate-200 text-xs font-semibold text-slate-400">
                                          Tanpa surat resmi
                                        </div>
                                      )}
                                    </div>
                                    {item.request.decisionReason && (
                                      <div
                                        className={`p-4 rounded-md border text-xs font-medium text-left ${
                                          item.request.status === 'approved'
                                            ? 'bg-emerald-50 border-emerald-100 text-emerald-800'
                                            : 'bg-rose-50 border-rose-100 text-rose-800'
                                        }`}
                                      >
                                        <strong>Catatan Keputusan:</strong>{' '}
                                        {item.request.decisionReason}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}

                              {(item.request.typeChangedFrom || item.request.typeChangedTo) && (
                                <p className="rounded-md border border-indigo-100 bg-indigo-50 p-3 text-xs text-indigo-800">
                                  {item.request.typeChangedTo
                                    ? `Jenis pengajuan diubah menjadi ${loyalisLeaveTypeLabel(item.request.typeChangedTo.type)}.`
                                    : `Pengajuan dialihkan dari ${loyalisLeaveTypeLabel(item.request.typeChangedFrom!.type)} oleh admin.`}
                                </p>
                              )}

                              {item.kind !== 'correction' && item.request.proofUrl && !item.request.attachments?.length && (
                                <a href={item.request.proofUrl} target="_blank" rel="noopener noreferrer"
                                  className="inline-flex text-xs font-medium text-indigo-600 underline">Lihat bukti pengajuan</a>
                              )}
                              {item.kind === 'paid_leave' && Boolean(item.request.attachments?.length) && (
                                <GantiLiburAttachmentLinks attachments={item.request.attachments} />
                              )}

                              {status === 'pending' && (
                                <div className="flex justify-end gap-3 pt-4 border-t border-slate-50">
                                  {rejectingReqId === key ? (
                                    <form
                                      onSubmit={handleReject}
                                      className="flex gap-2 w-full max-w-md items-center"
                                    >
                                      <Input
                                        type="text"
                                        value={rejectionReason}
                                        onChange={(event) => setRejectionReason(event.target.value)}
                                        placeholder="Masukkan alasan penolakan..."
                                        required
                                        className="rounded-sm border-slate-200 text-xs h-9 bg-white w-full"
                                      />
                                      <Button
                                        type="submit"
                                        disabled={actionLoading === key}
                                        className="bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-sm text-xs h-9 px-3 shrink-0 flex items-center gap-1 cursor-pointer"
                                      >
                                        {actionLoading === key ? (
                                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                        ) : (
                                          <X className="w-3.5 h-3.5" />
                                        )}
                                        Kirim
                                      </Button>
                                      <Button
                                        type="button"
                                        onClick={() => {
                                          setRejectingReqId(null);
                                          setRejectionReason('');
                                        }}
                                        variant="ghost"
                                        className="rounded-sm text-slate-450 hover:bg-slate-200/50 text-xs h-9 px-3 shrink-0 cursor-pointer"
                                      >
                                        Batal
                                      </Button>
                                    </form>
                                  ) : (
                                    <>
                                      {item.kind !== 'correction' && (
                                        <Button type="button" variant="outline"
                                          onClick={() => startLoyalisTypeEdit(item)} disabled={actionLoading !== null}
                                          className="h-9 rounded-sm px-4 text-xs">
                                          Ubah jenis
                                        </Button>
                                      )}
                                      <Button
                                        type="button"
                                        onClick={() => {
                                          setRejectingReqId(key);
                                          setRejectionReason(
                                            item.kind === 'ganti_libur' &&
                                              item.request.attendanceCheck?.verdict
                                              ? gantiLiburDeclineSuggestion(
                                                  item.request.attendanceCheck.verdict,
                                                ) || ''
                                              : '',
                                          );
                                        }}
                                        disabled={actionLoading !== null}
                                        variant="outline"
                                        className="text-rose-600 border-rose-200 hover:bg-rose-50 rounded-sm text-xs h-9 px-4 font-bold flex items-center gap-1.5 cursor-pointer shadow-sm bg-white"
                                      >
                                        <X className="w-3.5 h-3.5" /> Tolak
                                      </Button>
                                      <Button
                                        type="button"
                                        onClick={() => void handleApproveLoyalisItem(item)}
                                        disabled={actionLoading !== null}
                                        className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-sm text-xs h-9 px-5 font-bold flex items-center gap-1.5 cursor-pointer shadow-md active:scale-95 transition-all"
                                      >
                                        {actionLoading === key ? (
                                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                        ) : (
                                          <Check className="w-3.5 h-3.5" />
                                        )}
                                        Setujui &amp; Terapkan
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

      <Dialog
        open={editingLoyalisItem !== null && loyalisItemDate(editingLoyalisItem).slice(0, 7) === period}
        onOpenChange={(open) => { if (!open && actionLoading === null) cancelLoyalisTypeEdit(); }}
      >
        <DialogContent className="rounded-md sm:max-w-lg" showCloseButton={actionLoading === null}>
          <DialogHeader>
            <DialogTitle>Ubah Jenis Pengajuan</DialogTitle>
            <DialogDescription>
              {editingLoyalisItem && loyalisItemLabel(editingLoyalisItem)}.
              Pengajuan tetap menunggu persetujuan setelah jenisnya diubah.
            </DialogDescription>
          </DialogHeader>
          <label htmlFor="loyalis-submission-type" className="space-y-2 text-sm font-medium">
            <span>Jenis Pengajuan</span>
            <Select value={editingLoyalisType} disabled={actionLoading !== null}
              onValueChange={(value) => { if (isPresenceCorrectionType(value)) setEditingLoyalisType(value); }}>
              <SelectTrigger id="loyalis-submission-type" className="w-full"><SelectValue>{correctionTypeLabel(editingLoyalisType)}</SelectValue></SelectTrigger>
              <SelectContent>
                <SelectItem value="izin_resmi">Izin Resmi (Hari Penuh)</SelectItem>
                <SelectItem value="cuti_tahunan">Cuti Tahunan</SelectItem>
                <SelectItem value="ganti_libur">Ganti Libur</SelectItem>
                {editingLoyalisItem?.kind === 'correction' && <>
                  <SelectItem value="tap_in">Scan Masuk</SelectItem>
                  <SelectItem value="tap_out">Scan Pulang</SelectItem>
                  <SelectItem value="both">Scan Masuk &amp; Pulang</SelectItem>
                </>}
              </SelectContent>
            </Select>
          </label>
          {editingLoyalisType === 'ganti_libur' && editingLoyalisItem?.kind !== 'ganti_libur' && (
            <label className="space-y-2 text-sm font-medium">
              <span>Masuk Hari Libur</span>
              <Input type="date" value={editingWorkedDate} disabled={actionLoading !== null}
                onChange={(event) => setEditingWorkedDate(event.target.value)} />
              <p className="text-xs font-normal text-slate-500">Tanggal pegawai bekerja pada Jumat atau tanggal merah.</p>
            </label>
          )}
          {editingLoyalisType === 'cuti_tahunan' && (
            <p className="text-sm text-slate-600">Satu hari saldo Cuti Tahunan akan direservasi sampai pengajuan diputuskan.</p>
          )}
          {editingLoyalisItem?.kind === 'paid_leave' && editingLoyalisType !== 'cuti_tahunan' && (
            <p className="text-sm text-slate-600">Reservasi satu hari Cuti Tahunan akan dikembalikan.</p>
          )}
          {(editingLoyalisType === 'tap_in' || editingLoyalisType === 'both') && (
            <label className="space-y-2 text-sm font-medium">Scan Masuk
              <Input type="time" value={editingLoyalisScanIn} disabled={actionLoading !== null}
                onChange={(event) => setEditingLoyalisScanIn(event.target.value)} />
            </label>
          )}
          {(editingLoyalisType === 'tap_out' || editingLoyalisType === 'both') && (
            <label className="space-y-2 text-sm font-medium">Scan Pulang
              <Input type="time" value={editingLoyalisScanOut} disabled={actionLoading !== null}
                onChange={(event) => setEditingLoyalisScanOut(event.target.value)} />
            </label>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={actionLoading !== null} onClick={cancelLoyalisTypeEdit}>Batal</Button>
            <Button disabled={actionLoading !== null || (editingLoyalisType === 'ganti_libur' && !editingWorkedDate) ||
              (editingLoyalisItem?.kind === 'paid_leave' && editingLoyalisType === 'cuti_tahunan') ||
              (editingLoyalisItem?.kind === 'ganti_libur' && editingLoyalisType === 'ganti_libur') ||
              (editingLoyalisItem?.kind === 'correction' && editingLoyalisItem.request.type === 'izin_resmi' && editingLoyalisType === 'izin_resmi')}
              onClick={() => void handleChangeLoyalisType()}>
              {actionLoading?.startsWith('loyalis_type:') && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Simpan jenis
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={gantiLiburConfirmation?.period === period}
        onOpenChange={(open) => { if (!open) setGantiLiburConfirmation(null); }}
      >
        <DialogContent className="rounded-md sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Konfirmasi Persetujuan Ganti Libur</DialogTitle>
            <DialogDescription>
              Presensi Masuk Hari Libur berikut belum terdeteksi atau belum memenuhi
              jam kerja penuh 07.30–14.00 WIB. Periksa pengajuan dan dokumen pendukung
              sebelum melanjutkan.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-72 space-y-3 overflow-y-auto">
            {gantiLiburConfirmation?.checks.map(({ request, check }) => (
              <div key={request.id} className="space-y-1 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
                <p className="font-semibold">{request.employeeName}</p>
                <p>Masuk Hari Libur: {formatDateDisplay(request.workedDate)}</p>
                <p>Tanggal Libur: {formatDateDisplay(request.dayOffDate)}</p>
                <p>{gantiLiburVerdictLabel(check.verdict)}</p>
                <p>Scan masuk: {check.scanIn || '—'} · Scan pulang: {check.scanOut || '—'}</p>
              </div>
            ))}
          </div>
          {gantiLiburConfirmation?.scope === 'bulk' && (
            <p className="text-sm font-medium text-slate-700">
              Seluruh {gantiLiburConfirmation.items.length} pengajuan yang dipilih
              akan diproses, termasuk {gantiLiburConfirmation.checks.length} ganti
              libur yang memerlukan konfirmasi presensi.
            </p>
          )}
          <p className="text-sm text-slate-600">
            Jika dilanjutkan, ganti libur akan disetujui dan tanggal libur dihitung
            sebagai presensi berbayar penuh. Konfirmasi admin akan dicatat dalam
            riwayat keputusan.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGantiLiburConfirmation(null)}>
              Batal
            </Button>
            <Button
              className="bg-indigo-600 text-white hover:bg-indigo-700"
              onClick={() => {
                const confirmation = gantiLiburConfirmation;
                if (!confirmation || confirmation.period !== period) return;
                setGantiLiburConfirmation(null);
                if (confirmation.scope === 'single') {
                  void handleApproveLoyalisItem(confirmation.items[0], confirmation.checks[0].check);
                } else {
                  void handleBulkApproveLoyalisRequests(confirmation.items, new Map(
                    confirmation.checks.map(({ request, check }) => [request.id, check]),
                  ));
                }
              }}
            >
              Tetap setujui &amp; terapkan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Progress Dialog for Approvals */}
      <Dialog
        open={reviewProgress !== null}
        onOpenChange={(open) => {
          if (!open && reviewProgress?.status !== 'processing') {
            setReviewProgress(null);
          }
        }}
      >
        <DialogContent className="max-w-md rounded-md bg-white p-6">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-800">
              {reviewProgress?.status === 'processing'
                ? 'Memproses Persetujuan'
                : reviewProgress?.status === 'success'
                  ? 'Persetujuan Selesai'
                  : 'Persetujuan Gagal'}
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              {reviewProgress?.message}
            </DialogDescription>
          </DialogHeader>

          {reviewProgress?.status === 'processing' ? (
            <div className="space-y-4 py-4 text-center">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-indigo-600" />
              {reviewProgress.currentLabel && (
                <p className="text-xs font-semibold text-slate-700">
                  {reviewProgress.currentLabel}
                </p>
              )}
              {reviewProgress.scope === 'bulk' && (
                <div className="space-y-1">
                  <div className="h-2 w-full overflow-hidden rounded-sm bg-slate-100">
                    <div
                      className="h-full bg-indigo-600 transition-all duration-300"
                      style={{
                        width: `${Math.round(
                          (reviewProgress.completed / Math.max(reviewProgress.total, 1)) * 100,
                        )}%`,
                      }}
                    />
                  </div>
                  <p className="text-[11px] font-semibold text-slate-400">
                    {reviewProgress.completed} dari {reviewProgress.total} diproses
                  </p>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="space-y-1 text-xs font-semibold text-slate-500">
                <p>
                  {reviewProgress?.succeeded || 0} berhasil
                  {reviewProgress?.failed ? ` · ${reviewProgress.failed} gagal` : ''}
                </p>
                {reviewProgress?.errors && reviewProgress.errors.length > 0 && (
                  <div className="max-h-24 overflow-y-auto rounded-md bg-rose-50 p-3 text-left text-[11px] text-rose-700">
                    {reviewProgress.errors.slice(0, 4).map((error, index) => (
                      <p key={`${error}-${index}`}>{error}</p>
                    ))}
                    {reviewProgress.errors.length > 4 && (
                      <p className="mt-1">
                        +{reviewProgress.errors.length - 4} kegagalan lainnya
                      </p>
                    )}
                  </div>
                )}
              </div>
              <DialogFooter className="rounded-b-md pt-2 sm:justify-center">
                <Button
                  type="button"
                  onClick={() => setReviewProgress(null)}
                  className={`rounded-sm px-6 font-bold text-white ${
                    reviewProgress?.status === 'success'
                      ? 'bg-emerald-600 hover:bg-emerald-700'
                      : 'bg-rose-600 hover:bg-rose-700'
                  }`}
                >
                  Selesai
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Lightbox for Evidence Images */}
      {lightboxImageUrl && (
        <div
          className="fixed inset-0 bg-slate-900/80 backdrop-blur-md z-[9999] flex flex-col items-center justify-center p-4 sm:p-6"
          onClick={closeImageLightbox}
        >
          <div
            className="relative max-w-5xl w-full h-[88vh] flex flex-col bg-slate-900/95 p-4 rounded-md border border-white/10 shadow-2xl overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between w-full pb-3 mb-3 border-b border-white/10 px-2 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0 pr-4">
                <FileText className="w-5 h-5 text-indigo-400 shrink-0" />
                <span className="text-white font-semibold text-xs sm:text-sm truncate">
                  Dokumen Pendukung
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    setLightboxZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))))
                  }
                  disabled={lightboxZoom <= 0.5}
                  className="text-slate-300 hover:text-white hover:bg-white/10 rounded-sm h-8 w-8 transition-colors disabled:opacity-30"
                >
                  <ZoomOut className="w-4 h-4" />
                </Button>
                <span className="text-slate-300 text-[11px] font-bold w-10 text-center select-none">
                  {Math.round(lightboxZoom * 100)}%
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    setLightboxZoom((z) => Math.min(4, Number((z + 0.25).toFixed(2))))
                  }
                  disabled={lightboxZoom >= 4}
                  className="text-slate-300 hover:text-white hover:bg-white/10 rounded-sm h-8 w-8 transition-colors disabled:opacity-30"
                >
                  <ZoomIn className="w-4 h-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setLightboxRotation((r) => (r + 90) % 360)}
                  className="text-slate-300 hover:text-white hover:bg-white/10 rounded-sm h-8 w-8 transition-colors"
                >
                  <RotateCw className="w-4 h-4" />
                </Button>
                <a
                  href={lightboxImageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-all shadow-md ml-1"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Buka di Tab Baru</span>
                </a>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={closeImageLightbox}
                  className="text-slate-400 hover:text-white hover:bg-white/10 rounded-sm h-8 w-8 transition-colors ml-1"
                >
                  <X className="w-5 h-5" />
                </Button>
              </div>
            </div>

            <div className="w-full flex-1 flex items-center justify-center overflow-hidden rounded-md bg-slate-950/60">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={lightboxImageUrl}
                alt="Bukti Pendukung"
                draggable={false}
                onPointerDown={handleLightboxPointerDown}
                onPointerMove={handleLightboxPointerMove}
                onPointerUp={handleLightboxPointerUp}
                className={`max-w-none rounded-sm object-contain shadow-2xl select-none touch-none ${
                  isPanningLightbox ? '' : 'transition-transform duration-150'
                } ${
                  lightboxZoom <= 1
                    ? 'cursor-zoom-in'
                    : isPanningLightbox
                      ? 'cursor-grabbing'
                      : 'cursor-zoom-out'
                }`}
                style={{
                  transform: `translate(${lightboxPan.x}px, ${lightboxPan.y}px) scale(${lightboxZoom}) rotate(${lightboxRotation}deg)`,
                  maxHeight: lightboxRotation % 180 === 0 ? '82vh' : '65vw',
                  maxWidth: lightboxRotation % 180 === 0 ? '100%' : '82vh',
                }}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
export default LoyalisPresenceCorrectionsCard;
