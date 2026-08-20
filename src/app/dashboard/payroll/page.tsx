"use client";

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { FloatingSnackbar } from '@/components/ui/floating-snackbar';
import GlobalHeader from '@/components/GlobalHeader';
import Link from 'next/link';
import { calculateYearsOfService, calculateGapok, matchFunctionalAllowance, normalizeName, MANUAL_OVERRIDES } from '@/utils/payrollLogic';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  CheckCircle2,
  CalendarDays,
  Pencil,
  AlertCircle,
  Globe,
  MessageCircle,
  Share2,
  FileText,
  Hexagon,
  TrendingUp,
  Users,
  UserCircle,
  Lightbulb,
  Briefcase,
  Loader2,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Printer,
  Eye,
  CircleCheck,
  ScanLine,
  Upload,
  LogOut,
  UserCog,
  Award,
  FileSpreadsheet,
  Banknote,
  ChevronRight,
  Search,
  Mail,
  SlidersHorizontal,
  X,
  RefreshCw,
  Pause,
  Play,
  CheckCheck,
  RotateCcw,
} from 'lucide-react';
import { collection, getDocs, doc, getDoc, setDoc, query, where, writeBatch } from 'firebase/firestore';
import { db, secondaryDb } from '@/lib/firebase';
import { useAuth } from '@/lib/AuthContext';
import { useDashboardData } from '@/lib/DashboardDataContext';
import { useBulkEmail, ESTIMATED_SECONDS_PER_EMAIL, type QueueItem } from '@/lib/BulkEmailContext';
import { Employee, SalaryMatrix, BlueCollarEmployee, UraianGajiDocument, UraianEntry } from '@/types';
import PaySlipDialog, { SlipState, buildInitialEarnings, buildInitialDeductions } from '@/components/PaySlipDialog';
import * as XLSX from 'xlsx';
import LegalitasPimpinanDialog from '@/components/LegalitasPimpinanDialog';
import CetakPayrollDialog from '@/components/CetakPayrollDialog';
import CetakTunjanganJabatanDialog from '@/components/CetakTunjanganJabatanDialog';
import CetakVakasiPimpinanStafDialog from '@/components/CetakVakasiPimpinanStafDialog';
import CetakVakasiLainLainDialog from '@/components/CetakVakasiLainLainDialog';
import CetakPotonganGajiDialog from '@/components/CetakPotonganGajiDialog';
import CetakGabunganDialog from '@/components/CetakGabunganDialog';
import { generateWhatsAppPaySlipUrl, uploadPaySlipPdf } from '@/utils/whatsappHelper';
import { generatePaySlipPdf, generateMultiPaySlipPdf, PaySlipData, PaySlipField } from '@/utils/generatePaySlipPdf';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { generateRekapGajiPdf, RekapGajiData, RekapCategoryData } from '@/utils/generateRekapGajiPdf';
import { generateRekapGajiPekaryaXlsx } from '@/utils/generateRekapGajiPekaryaXlsx';
import { generateKebutuhanDanaGajiXlsx } from '@/utils/generateKebutuhanDanaGajiXlsx';
import { generateKebutuhanDanaGajiPdf } from '@/utils/generateKebutuhanDanaGajiPdf';
import CetakRekapDialog from '@/components/CetakRekapDialog';
import CetakKebutuhanDanaGajiDialog from '@/components/CetakKebutuhanDanaGajiDialog';
import { generatePayrollStatementPdf, PayrollStatementData, PayrollStatementEmployee } from '@/utils/generatePayrollStatementPdf';
import { authenticatedJson, createFinancialRequestId } from '@/lib/payroll/client';
import {
  defaultPayrollPeriodToken,
  isTransferEligibleStatus,
  previousPayrollPeriodToken,
} from '@/lib/payroll/domain';
import {
  buildDashboardSlipData,
  DashboardPayrollCollar,
} from '@/lib/payroll/dashboardSlipData';
import { buildKoperasiPayrollAmountMaps } from '@/lib/payroll/koperasiAmounts';
import { isPayrollEmployeeEligible } from '@/lib/payroll/payrollRoster';
import { isPayableVakasiTambahan } from '@/lib/payroll/vakasiTambahan';

import {
  calculateTotalEarnings,
  calculateTotalDeductions,
  calculateNetSalary
} from '@/utils/salaryCalculator';

function SortIcon({ active, direction }: { active: boolean; direction: 'asc' | 'desc' | null }) {
  if (!active || !direction) return <ChevronsUpDown className="w-3 h-3 text-slate-300" />;
  return direction === 'asc' ? <ChevronUp className="w-3 h-3 text-indigo-500" /> : <ChevronDown className="w-3 h-3 text-indigo-500" />;
}
// ... [rest of imports and sorting logic unchanged until TableHead]
// (Wait, I need to update the handleSort and getFilteredAndSortedEmployees logic too)


// Format currency
const formatIDR = (amount: number) => {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

// ─── Payroll period helper ──────────────────────────────────────
const MONTHS_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

function getPayrollPeriod(date: Date): string {
  return `${MONTHS_ID[date.getMonth()]} ${date.getFullYear()}`;
}

// ─── Extended employee with raw data ────────────────────────────
interface EmployeeRow extends Employee {
  raw: any;
  rowIndex: number;
}

interface PayrollTarget {
  id: string;
  name: string;
  collar: DashboardPayrollCollar;
  raw: EmployeeRow['raw'];
}

interface BulkPayrollProgress {
  phase: 'preparing' | 'sealing' | 'locking';
  completed: number;
  total: number;
}

interface BulkChange {
  employeeId: string;
  employeeName: string;
  isLocked: boolean;
  diffs: {
    type: 'earnings' | 'deductions';
    label: string;
    oldValue: number | null;
    newValue: number | null;
  }[];
  currentEarnings: PaySlipField[];
  currentDeductions: PaySlipField[];
  freshEarnings: PaySlipField[];
  freshDeductions: PaySlipField[];
}

interface KoperasiLockReceipt {
  status: 'applied' | 'not_applicable';
  loans: Array<{
    loanId: string;
    outcome: 'advanced' | 'paid_off' | 'already_applied';
    paidAfter: number;
    tenor: number;
  }>;
}

interface VerifyAndLockResponse {
  status: 'locked';
  koperasi: KoperasiLockReceipt;
}

function koperasiReceiptMessage(receipt: KoperasiLockReceipt): string {
  if (!receipt.loans.length) return 'Tidak ada pinjaman Koperasi aktif.';
  const paidOff = receipt.loans.filter((loan) => loan.outcome === 'paid_off').length;
  const alreadyApplied = receipt.loans.filter((loan) => loan.outcome === 'already_applied').length;
  const advanced = receipt.loans.length - alreadyApplied;
  return [
    `${advanced} cicilan Koperasi diproses`,
    paidOff > 0 ? `${paidOff} pinjaman lunas` : '',
    alreadyApplied > 0 ? `${alreadyApplied} sudah tercatat sebelumnya` : '',
  ].filter(Boolean).join('; ') + '.';
}

async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const runners = Array.from(
    { length: Math.min(Math.max(1, concurrency), items.length) },
    async () => {
      while (nextIndex < items.length) {
        const item = items[nextIndex++];
        await worker(item);
      }
    },
  );
  await Promise.all(runners);
}

function replaceClientKoperasiDeduction(
  deductions: readonly PaySlipField[],
  amount: number,
): PaySlipField[] {
  const labels = new Set([
    'PINJAMAN KOP. UNIPDU',
    'PINJAMAN KOP UNIPDU',
    'PINJAMAN KOPERASI',
    'PINJAMAN KOPERASI UNIPDU',
  ]);
  let replaced = false;
  const next = deductions.map((field) => {
    const normalized = field.label.trim().replace(/\s+/g, ' ').toUpperCase();
    if (!labels.has(normalized)) return { ...field };
    if (replaced) return { ...field, amount: 0 };
    replaced = true;
    return { ...field, amount };
  });
  if (!replaced) next.push({ label: 'Pinjaman Kop. UNIPDU', amount });
  return next;
}

export default function PayrollValidationDashboard() {
  const { user, profile, logout } = useAuth();
  const {
    sendingBulkEmail,
    isBulkEmailActive,
    isBulkEmailPaused,
    startBulkEmailJob,
    bulkEmailProgress,
    emailTargetCount,
    bulkEmailResults,
    setShowBulkDetailModal,
  } = useBulkEmail();
  const {
    employeesLoyalis,
    employeesBlueCollar,
    salaryMatrixBlue,
    salaryMatrixWhite,
    functionalAllowanceMap: contextFunctionalAllowanceMap,
    kepangkatanAllowanceMap: contextKepangkatanAllowanceMap,
    koperasiDeductions: contextKoperasiDeductions,
    koperasiSavings: contextKoperasiSavings,
    koperasiLoans,
    koperasiUsers,
    loading: contextLoading
  } = useDashboardData();

  const getLoyalisPresenceBonus = (empId: string): number => {
    if (loyalisPresenceData?.entries && Object.keys(loyalisPresenceData.entries).length > 0) {
      const entry = loyalisPresenceData.entries[empId];
      if (!entry) return 0;
    }
    return 250000;
  };

  const getLoyalisPresenceDeduction = (empId: string): number => {
    if (loyalisPresenceData?.entries && Object.keys(loyalisPresenceData.entries).length > 0) {
      const entry = loyalisPresenceData.entries[empId];
      if (entry) {
        return entry.deduction || 0;
      }
    }
    return 0;
  };

  const getLoyalisPresensiEarning = (empId: string): number => {
    const workingDays = loyalisPresenceData?.workingDays || 25;
    const expectedHours = loyalisPresenceData?.expectedHours || 6.5;
    if (loyalisPresenceData?.entries && Object.keys(loyalisPresenceData.entries).length > 0) {
      const entry = loyalisPresenceData.entries[empId];
      if (!entry) return 0;
    }
    return Math.round(workingDays * expectedHours * 1650);
  };

  const getLoyalisPresensiDeduction = (empId: string): number => {
    if (loyalisPresenceData?.entries && Object.keys(loyalisPresenceData.entries).length > 0) {
      const entry = loyalisPresenceData.entries[empId];
      if (entry) {
        const absenceMinutes = entry.absenceMinutes || 0;
        return Math.round((absenceMinutes / 60) * 1650);
      }
    }
    return 0;
  };

  const [targetDate, setTargetDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [attendancePeriodStatus, setAttendancePeriodStatus] =
    useState<'unconfigured' | 'open' | 'closed'>('unconfigured');
  // Runs once: the landing period is resolved from the previous period's
  // closure, and an operator's own choice must never be overwritten by it.
  const defaultPeriodResolvedRef = useRef(false);
  const [notification, setNotification] = useState<{
    show: boolean;
    type: 'success' | 'error';
    message: string;
  }>({ show: false, type: 'success', message: '' });
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const isSavingRef = useRef(false);
  const [uploadingWa, setUploadingWa] = useState<Record<string, boolean>>({});
  const [salaryMatrix, setSalaryMatrix] = useState<SalaryMatrix>({});
  const [kepangkatanDesignations, setKepangkatanDesignations] = useState<Record<number, string>>({});
  const [localLoading, setLocalLoading] = useState(false);
  const [confirmingBulk, setConfirmingBulk] = useState(false);
  const [preparingAllDrafts, setPreparingAllDrafts] = useState(false);
  const [bulkPayrollProgress, setBulkPayrollProgress] =
    useState<BulkPayrollProgress | null>(null);
  const loading = contextLoading || localLoading;
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' | null }>({ key: '', direction: null });

  // Collar type state (Lapangan / Blue Collar vs Kantor / White Collar Loyalis)
  const [payrollCollar, setPayrollCollar] = useState<'blue' | 'loyalis'>('loyalis');

  // ─── Filters ───────────────────────────────────────────────────
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Reset category filter when switching collars
  useEffect(() => {
    setCategoryFilter('all');
  }, [payrollCollar]);

  // ─── Slip status state (keyed by employeeId) ───────────────────
  // NOTE: slipStates is used ONLY for status tracking (confirmed/draft/printed,
  // emailSent, etc). Earnings/deductions are always recalculated from current
  // employee data to ensure they stay in sync with profile changes.
  const [slipStates, setSlipStates] = useState<Record<string, SlipState>>({});

  // ─── UraianGaji state (keyed by docId e.g. "2026_05_KEBERSIHAN") ──
  const [uraianMap, setUraianMap] = useState<Record<string, UraianGajiDocument>>({});

  // ─── VakasiTambahan state (keyed by employeeId) ─────────────────
  const [vakasiTambahanMap, setVakasiTambahanMap] = useState<Record<string, number>>({});
  const [vakasiTambahanListMap, setVakasiTambahanListMap] = useState<Record<string, { eventName: string; payGiven: number; isEndOfMonth?: boolean }[]>>({});
  const [functionalAllowanceMap, setFunctionalAllowanceMap] = useState<Record<string, number>>({});
  const [kepangkatanAllowanceMap, setKepangkatanAllowanceMap] = useState<Record<string, number>>({});
  const selectedKoperasiAmounts = useMemo(() => {
    const payrollPeriod = `${targetDate.getFullYear()}-${String(
      targetDate.getMonth() + 1,
    ).padStart(2, '0')}`;
    const allEmployees = [...employeesLoyalis, ...employeesBlueCollar];
    if (koperasiLoans.length === 0 && koperasiUsers.length === 0) {
      return {
        deductions: contextKoperasiDeductions,
        savings: contextKoperasiSavings,
      };
    }
    return buildKoperasiPayrollAmountMaps(
      payrollPeriod,
      allEmployees,
      koperasiLoans,
      koperasiUsers,
    );
  }, [
    targetDate,
    employeesLoyalis,
    employeesBlueCollar,
    koperasiLoans,
    koperasiUsers,
    contextKoperasiDeductions,
    contextKoperasiSavings,
  ]);
  const koperasiDeductions = selectedKoperasiAmounts.deductions;
  const koperasiSavings = selectedKoperasiAmounts.savings;
  const [loyalisPresenceData, setLoyalisPresenceData] = useState<any | null>(null);

  const allPayrollTargets = useMemo<PayrollTarget[]>(() => [
    ...employeesLoyalis
      .filter((employee) =>
        isPayrollEmployeeEligible('Employees_Loyalis', employee),
      )
      .map((employee) => ({
        id: employee.id,
        name: String(employee.personal_info?.name || employee.id),
        collar: 'loyalis' as const,
        raw: employee,
      })),
    ...employeesBlueCollar
      .filter((employee) =>
        isPayrollEmployeeEligible('Employees_BlueCollar', employee),
      )
      .map((employee) => ({
        id: employee.id,
        name: String(employee.name || employee.id),
        collar: 'pekarya' as const,
        raw: employee,
      })),
  ].sort((left, right) =>
    left.name.localeCompare(right.name, 'id') || left.id.localeCompare(right.id),
  ), [employeesLoyalis, employeesBlueCollar]);

  const missingPayrollDraftCount = allPayrollTargets.filter(
    (target) => !slipStates[target.id],
  ).length;
  const pendingPayrollLockCount = allPayrollTargets.filter((target) => {
    const status = slipStates[target.id]?.status;
    return !status || status === 'draft';
  }).length;

  // Cooperative matched deductions/savings are pre-calculated at layout context level.

  // ─── Dialog state ──────────────────────────────────────────────
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeRow | null>(null);

  // ─── Open Period Modal State ─────────────────────────────────────
  const [showOpenPeriodModal, setShowOpenPeriodModal] = useState(false);
  const [calendarEditMode, setCalendarEditMode] = useState(false);
  const [calendarRevision, setCalendarRevision] = useState(1);
  const [calendarEditReason, setCalendarEditReason] = useState('');
  const [selectedHolidays, setSelectedHolidays] = useState<Set<string>>(new Set());
  const [isSubmittingModal, setIsSubmittingModal] = useState(false);

  const modalYear = targetDate.getFullYear();
  const modalMonth = targetDate.getMonth(); // 0-indexed
  const modalDaysInMonth = new Date(modalYear, modalMonth + 1, 0).getDate();
  const modalStartOffset = (new Date(modalYear, modalMonth, 1).getDay() + 6) % 7; // Monday-first grid

  // Pre-select all Fridays whenever modal opens
  useEffect(() => {
    if (showOpenPeriodModal && !calendarEditMode) {
      const yearStr = String(modalYear);
      const monthStr = String(modalMonth + 1).padStart(2, '0');
      const initialHolidays = new Set<string>();

      for (let day = 1; day <= modalDaysInMonth; day++) {
        const dateObj = new Date(modalYear, modalMonth, day);
        if (dateObj.getDay() === 5) { // 5 = Friday
          const dayStr = String(day).padStart(2, '0');
          initialHolidays.add(`${yearStr}-${monthStr}-${dayStr}`);
        }
      }
      setSelectedHolidays(initialHolidays);
    }
  }, [showOpenPeriodModal, calendarEditMode, modalYear, modalMonth, modalDaysInMonth]);

  // Land on the month being compiled: before the 6th that is still the previous
  // period, unless it has already been closed permanently.
  useEffect(() => {
    if (defaultPeriodResolvedRef.current) return;
    if (!profile || !['super_admin', 'finance_verifier'].includes(profile.role)) {
      return;
    }
    const now = new Date();
    const previousPeriod = previousPayrollPeriodToken(now);
    if (defaultPayrollPeriodToken(now, false) !== previousPeriod) {
      // Past the cutoff day; the current month is already the right landing.
      defaultPeriodResolvedRef.current = true;
      return;
    }
    // The ref is only marked resolved once this specific fetch actually lands
    // (below). Firebase Auth can fire onAuthStateChanged more than once in
    // production (token refresh, multi-tab negotiation — see AuthContext),
    // each time producing a new `profile` object that re-runs this effect. If
    // the ref were set here, a re-run before this getDoc resolves would see
    // "already resolved" and skip retrying, while this call's own result gets
    // silently dropped by the cancelled check below — permanently stuck on
    // the initial month.
    let cancelled = false;
    getDoc(doc(db, 'PayrollPeriods', previousPeriod))
      .then((snapshot) => {
        if (cancelled) return;
        defaultPeriodResolvedRef.current = true;
        const previousClosed = snapshot.data()?.attendanceStatus === 'closed';
        if (defaultPayrollPeriodToken(now, previousClosed) !== previousPeriod) return;
        const [year, month] = previousPeriod.split('-').map(Number);
        setTargetDate((current) => {
          const currentToken = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`;
          const nowToken = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
          // The operator may already have picked a period while this resolved.
          return currentToken === nowToken ? new Date(year, month - 1, 1) : current;
        });
      })
      .catch(() => {
        if (cancelled) return;
        // Closure state unknown: stay on the current month rather than guess,
        // and leave the ref unset so a later re-run (e.g. the next auth
        // callback) can retry instead of getting stuck.
      });
    return () => {
      cancelled = true;
    };
  }, [profile]);

  useEffect(() => {
    if (!profile || !['super_admin', 'finance_verifier'].includes(profile.role)) {
      return;
    }
    let cancelled = false;
    const period = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}`;
    getDoc(doc(db, 'PayrollPeriods', period))
      .then((snapshot) => {
        if (cancelled) return;
        // Anything that is not an explicit permanent closure is collecting,
        // including a month with no period document at all.
        setAttendancePeriodStatus(
          snapshot.data()?.attendanceStatus === 'closed' ? 'closed' : 'open',
        );
      })
      .catch(() => {
        if (!cancelled) setAttendancePeriodStatus('open');
      });
    return () => {
      cancelled = true;
    };
  }, [profile, targetDate]);

  const handleSetAttendancePeriod = async (_attendanceStatus: 'closed') => {
    const period = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}`;
    if (missingPayrollDraftCount > 0) {
      alert(
        `${missingPayrollDraftCount} pegawai payroll belum memiliki draf. Klik “Siapkan Semua Draf” dan selesaikan seluruh kegagalan sebelum menutup periode.`,
      );
      return;
    }
    if (!window.confirm(`Apakah Anda yakin ingin menutup periode ${period} secara permanen?`)) return;

    try {
      await authenticatedJson('/api/payroll/periods', {
        method: 'POST',
        body: JSON.stringify({ period, attendanceStatus: 'closed' }),
      });
      setAttendancePeriodStatus('closed');
      setNotification({
        show: true,
        type: 'success',
        message: `Periode ${period} ditutup permanen; verifikasi payroll kini dapat dimulai.`,
      });
    } catch (error: any) {
      setNotification({
        show: true,
        type: 'error',
        message: error.message || 'Gagal menutup periode.',
      });
    }
  };

  const handleOpenCalendarEditor = async () => {
    const period = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}`;
    setIsSubmittingModal(true);
    try {
      const result = await authenticatedJson<{
        calendar: { revision: number; premiumDates: string[] };
      }>(`/api/payroll/periods/${period}/calendar`);
      setCalendarRevision(result.calendar.revision);
      setSelectedHolidays(new Set(result.calendar.premiumDates));
      setCalendarEditReason('');
      setCalendarEditMode(true);
      setShowOpenPeriodModal(true);
    } catch (error: any) {
      setNotification({
        show: true,
        type: 'error',
        message: error.message || 'Gagal memuat kalender periode.',
      });
    } finally {
      setIsSubmittingModal(false);
    }
  };

  const handleConfirmCalendarEdit = async () => {
    const period = `${modalYear}-${String(modalMonth + 1).padStart(2, '0')}`;
    if (calendarEditReason.trim().length < 8) {
      setNotification({
        show: true,
        type: 'error',
        message: 'Alasan perubahan kalender wajib diisi minimal 8 karakter.',
      });
      return;
    }
    setIsSubmittingModal(true);
    try {
      const premiumDates = Array.from(selectedHolidays).sort();
      const preview = await authenticatedJson<{
        impact: {
          changedDates: string[];
          affectedPublicationCount: number;
          affectedOccurrenceCount: number;
          affectedPendingRegularAssignments: number;
          affectedApprovedRegularAssignments: number;
        };
      }>(`/api/payroll/periods/${period}/calendar`, {
        method: 'POST',
        body: JSON.stringify({ premiumDates }),
      });
      const impact = preview.impact;
      const confirmed = window.confirm(
        [
          `Ubah ${impact.changedDates.length} tanggal kalender?`,
          `${impact.affectedPublicationCount} publikasi presensi akan ditandai perlu diproses ulang.`,
          `${impact.affectedPendingRegularAssignments + impact.affectedApprovedRegularAssignments} penugasan Satpam pada ${impact.affectedOccurrenceCount} shift akan direkonsiliasi.`,
          'Riwayat perubahan akan disimpan permanen.',
        ].join('\n'),
      );
      if (!confirmed) return;
      const result = await authenticatedJson<{ revision: number }>(
        `/api/payroll/periods/${period}/calendar`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            requestId: createFinancialRequestId('period-calendar'),
            expectedRevision: calendarRevision,
            premiumDates,
            reason: calendarEditReason.trim(),
          }),
        },
      );
      setCalendarRevision(result.revision);
      setShowOpenPeriodModal(false);
      setCalendarEditMode(false);
      setNotification({
        show: true,
        type: 'success',
        message: `Kalender periode ${period} diperbarui ke revisi ${result.revision}.`,
      });
    } catch (error: any) {
      setNotification({
        show: true,
        type: 'error',
        message: error.message || 'Gagal memperbarui kalender periode.',
      });
    } finally {
      setIsSubmittingModal(false);
    }
  };

  const handleConfirmOpenPeriod = async () => {
    setIsSubmittingModal(true);
    const period = `${modalYear}-${String(modalMonth + 1).padStart(2, '0')}`;
    try {
      await authenticatedJson('/api/payroll/periods', {
        method: 'POST',
        body: JSON.stringify({
          period,
          attendanceStatus: 'open',
          holidays: Array.from(selectedHolidays),
        }),
      });
      setAttendancePeriodStatus('open');
      setShowOpenPeriodModal(false);
      setNotification({
        show: true,
        type: 'success',
        message: `Periode ${period} berhasil dibuka dengan ${selectedHolidays.size} tanggal merah.`,
      });
    } catch (error: any) {
      setNotification({
        show: true,
        type: 'error',
        message: error.message || 'Gagal membuka periode.',
      });
    } finally {
      setIsSubmittingModal(false);
    }
  };



  const [legalitasDialogOpen, setLegalitasDialogOpen] = useState(false);
  const [cetakPayrollDialogOpen, setCetakPayrollDialogOpen] = useState(false);
  const [cetakRekapDialogOpen, setCetakRekapDialogOpen] = useState(false);
  const [tunjanganJabatanDialogOpen, setTunjanganJabatanDialogOpen] = useState(false);
  const [vakasiPimpinanStafDialogOpen, setVakasiPimpinanStafDialogOpen] = useState(false);
  const [vakasiLainLainDialogOpen, setVakasiLainLainDialogOpen] = useState(false);
  const [potonganGajiDialogOpen, setPotonganGajiDialogOpen] = useState(false);
  const [gabunganDialogOpen, setGabunganDialogOpen] = useState(false);
  const [cetakKebutuhanDanaGajiDialogOpen, setCetakKebutuhanDanaGajiDialogOpen] = useState(false);
  const [printSelectorOpen, setPrintSelectorOpen] = useState(false);

  // New States for Email & Cetak/Kirim Fallbacks
  const [cetakKirimOpen, setCetakKirimOpen] = useState(false);
  const [sendingSingleEmail, setSendingSingleEmail] = useState(false);
  const [bulkConfirmDialogOpen, setBulkConfirmDialogOpen] = useState(false);
  // Recipients are resolved once when the dialog opens, so the confirmation the
  // operator reads is exactly the queue that gets sent.
  const [bulkEmailPlan, setBulkEmailPlan] = useState<{
    items: QueueItem[];
    skipped: string[];
  }>({ items: [], skipped: [] });

  // States for Bulk Refresh feature
  const [bulkRefreshDialogOpen, setBulkRefreshDialogOpen] = useState(false);
  const [bulkChanges, setBulkChanges] = useState<BulkChange[]>([]);
  const [refreshingBulk, setRefreshingBulk] = useState(false);
  const [selectedBulkRefreshEmployeeIds, setSelectedBulkRefreshEmployeeIds] = useState<Set<string>>(new Set());
  const [selectedBulkRefreshFields, setSelectedBulkRefreshFields] = useState<Record<string, Set<string>>>({});

  const handleExportExcel = () => {
    const filteredEmployees = getFilteredAndSortedEmployees();

    if (filteredEmployees.length === 0) {
      alert("Tidak ada data untuk diekspor.");
      return;
    }

    const allEarningLabelsSet = new Set<string>();
    const allDeductionLabelsSet = new Set<string>();

    const rowsData = filteredEmployees.map((emp, idx) => {
      const years = calculateYearsOfService(emp.joinDate, targetDate);
      const gapok = calculateGapok(emp, salaryMatrix, targetDate);

      const roleKey = payrollCollar === 'loyalis' ? emp.role : emp.raw.employment?.jobCategory;
      const periodKey = `${targetDate.getFullYear()}_${String(targetDate.getMonth() + 1).padStart(2, '0')}`;
      const uraianDoc = uraianMap[`${periodKey}_${roleKey}`];
      const uraianEntry = uraianDoc?.entries?.[emp.id];

      const freshData = buildFreshSlipData(emp);
      const earningsList = freshData.earnings;
      const deductionsList = freshData.deductions;

      earningsList.forEach(e => allEarningLabelsSet.add(e.label));
      deductionsList.forEach(d => allDeductionLabelsSet.add(d.label));

      const totalEarnings = earningsList.reduce((sum, e) => sum + e.amount, 0);
      const totalDeductions = deductionsList.reduce((sum, d) => sum + d.amount, 0);
      const netSalary = totalEarnings - totalDeductions;

      return {
        no: idx + 1,
        id: emp.id,
        nik_niy: payrollCollar === 'loyalis' ? (emp.raw.personal_info?.employee_id_niy || '') : (emp.raw.nik || ''),
        name: emp.name,
        role: emp.role,
        gradeLevel: emp.gradeLevel,
        joinDate: emp.joinDate ? new Date(emp.joinDate).toLocaleDateString('id-ID') : '',
        status: emp.isActive ? 'AKTIF' : 'KELUAR',
        earningsMap: earningsList.reduce((acc, curr) => ({ ...acc, [curr.label]: curr.amount }), {} as Record<string, number>),
        deductionsMap: deductionsList.reduce((acc, curr) => ({ ...acc, [curr.label]: curr.amount }), {} as Record<string, number>),
        totalEarnings,
        totalDeductions,
        netSalary
      };
    });

    const earningLabels = Array.from(allEarningLabelsSet);
    const deductionLabels = Array.from(allDeductionLabelsSet);

    const headers = [
      'NO',
      payrollCollar === 'loyalis' ? 'NIY' : 'NIK',
      'NAMA',
      payrollCollar === 'loyalis' ? 'DEPARTEMEN / UNIT' : 'JABATAN',
      'GOLONGAN',
      'TANGGAL MASUK',
      'STATUS',
      ...earningLabels,
      'TOTAL PENDAPATAN',
      ...deductionLabels,
      'TOTAL POTONGAN',
      'GAJI BERSIH'
    ];

    const dataRows: any[][] = [];

    rowsData.forEach(row => {
      const dataRow: any[] = [
        row.no,
        row.nik_niy,
        row.name,
        row.role,
        row.gradeLevel,
        row.joinDate,
        row.status
      ];

      earningLabels.forEach(label => {
        dataRow.push(row.earningsMap[label] || 0);
      });

      dataRow.push(row.totalEarnings);

      deductionLabels.forEach(label => {
        dataRow.push(row.deductionsMap[label] || 0);
      });

      dataRow.push(row.totalDeductions);
      dataRow.push(row.netSalary);

      dataRows.push(dataRow);
    });

    const totalRow: any[] = [
      '',
      '',
      'JUMLAH',
      '',
      '',
      '',
      ''
    ];

    earningLabels.forEach(label => {
      const sum = rowsData.reduce((acc, curr) => acc + (curr.earningsMap[label] || 0), 0);
      totalRow.push(sum);
    });

    totalRow.push(rowsData.reduce((acc, curr) => acc + curr.totalEarnings, 0));

    deductionLabels.forEach(label => {
      const sum = rowsData.reduce((acc, curr) => acc + (curr.deductionsMap[label] || 0), 0);
      totalRow.push(sum);
    });

    totalRow.push(rowsData.reduce((acc, curr) => acc + curr.totalDeductions, 0));
    totalRow.push(rowsData.reduce((acc, curr) => acc + curr.netSalary, 0));

    const periodString = getPayrollPeriod(targetDate);
    const title = payrollCollar === 'loyalis' ? 'LAPORAN PAYROLL STAF LOYALIS' : 'LAPORAN PAYROLL PEKARYA';
    
    const worksheetData = [
      [title],
      [`PERIODE: ${periodString.toUpperCase()}`],
      [],
      headers,
      ...dataRows,
      [],
      totalRow
    ];

    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

    const colWidths = headers.map((header, colIndex) => {
      let maxLen = header.length;
      worksheetData.forEach(r => {
        if (r[colIndex] !== undefined && r[colIndex] !== null) {
          const valStr = String(r[colIndex]);
          if (valStr.length > maxLen) {
            maxLen = valStr.length;
          }
        }
      });
      return { wch: maxLen + 3 };
    });
    worksheet['!cols'] = colWidths;

    const workbook = XLSX.utils.book_new();
    const sheetName = payrollCollar === 'loyalis' ? 'Payroll Loyalis' : 'Payroll Pekarya';
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

    const filename = `Payroll_${sheetName.replace(/\s+/g, '_')}_${periodString.replace(/\s+/g, '_')}.xlsx`;
    XLSX.writeFile(workbook, filename);
  };

  const handleExportKebutuhanDanaGaji = () => {
    if (payrollCollar !== 'loyalis') {
      alert("Laporan Kebutuhan Dana Gaji hanya tersedia untuk Karyawan Loyalis.");
      return;
    }

    const activeLoyalis = employees.filter(emp => emp.isActive || slipStates[emp.id]?.status === 'locked');
    if (activeLoyalis.length === 0) {
      alert("Tidak ada data karyawan aktif.");
      return;
    }

    const reportsEmployees = activeLoyalis.map(emp => {
      const fresh = buildFreshSlipData(emp);
      return {
        id: emp.id,
        name: emp.name,
        departmentUnit: emp.role,
        earnings: fresh.earnings,
        deductions: fresh.deductions
      };
    });

    generateKebutuhanDanaGajiXlsx({
      period: payrollPeriod,
      employees: reportsEmployees
    });
  };

  const handleExportKebutuhanDanaGajiPdf = () => {
    if (payrollCollar !== 'loyalis') {
      alert("Laporan Kebutuhan Dana Gaji hanya tersedia untuk Karyawan Loyalis.");
      return;
    }

    const activeLoyalis = employees.filter(emp => emp.isActive || slipStates[emp.id]?.status === 'locked');
    if (activeLoyalis.length === 0) {
      alert("Tidak ada data karyawan aktif.");
      return;
    }

    const reportsEmployees = activeLoyalis.map(emp => {
      const fresh = buildFreshSlipData(emp);
      return {
        id: emp.id,
        name: emp.name,
        departmentUnit: emp.role,
        earnings: fresh.earnings,
        deductions: fresh.deductions
      };
    });

    generateKebutuhanDanaGajiPdf({
      period: payrollPeriod,
      employees: reportsEmployees
    });
  };

  const handlePrintRekap = async (format: 'pdf' | 'xlsx') => {
    const sanitizeDeductionLabel = (label: string): string => {
      const clean = label.trim();
      const lower = clean.toLowerCase();

      if (lower.includes('bpjs')) {
        return 'BPJS';
      }
      if (lower.includes('rochmad')) {
        return 'Koperasi Rochmad';
      }
      if (lower.includes('unipdu') || lower.includes('rejoso') || lower.includes('gemilang')) {
        return 'Kop. Rejoso Gemilang';
      }
      if (lower.includes('sosial') || lower.includes('ziz') || lower.includes('zakat') || lower.includes('infaq') || lower.includes('sodaqoh')) {
        return 'Dana Sosial';
      }
      if (lower.includes('pinlu') || lower.includes('tagihan')) {
        return 'Pinlu/Tagihan';
      }
      if (lower.includes('tht') || lower.includes('simponi') || lower.includes('hari tua')) {
        return 'Tabungan Hari Tua BNI Simponi';
      }
      if (lower.includes('tunai')) {
        return 'Tunai';
      }

      // Title Case for any other custom label
      return clean
        .split(/\s+/)
        .map(word => {
          if (!word) return '';
          return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        })
        .join(' ');
    };

    const getEmployeeDeductions = (emp: any, slip?: any, collar?: 'blue' | 'loyalis'): { label: string; amount: number }[] => {
      if (slip && slip.deductions) {
        return slip.deductions.map((d: any) => ({
          label: d.label,
          amount: d.amount || 0,
        }));
      }

      const deductions: { label: string; amount: number }[] = [];
      const kopUnipduAmount = koperasiDeductions[emp.id] || 0;
      if (collar === 'loyalis') {
        deductions.push({ label: 'Koperasi Rochmad', amount: emp.raw?.deductions?.koperasiRochmad || 0 });
        deductions.push({ label: 'BPJS', amount: emp.raw?.bpjs?.deductionAmount || 0 });
        deductions.push({ label: 'Tabungan Hari Tua BNI Simponi', amount: emp.raw?.tht?.deductionAmount || 0 });
        deductions.push({ label: 'Tabungan', amount: emp.raw?.savings?.deductionAmount || 0 });
        deductions.push({ label: 'Zakat Infaq Sodaqoh', amount: emp.raw?.ziz?.deductionAmount || 0 });
        deductions.push({ label: 'Revisi Gaji', amount: 0 });
        deductions.push({ label: 'Pinlu/Tagihan', amount: emp.raw?.pinlu?.deductionAmount || 0 });
        deductions.push({ label: 'Pinjaman Kop. UNIPDU', amount: kopUnipduAmount });
        deductions.push({ label: 'Potongan Presensi', amount: getLoyalisPresensiDeduction(emp.id) });
        deductions.push({ label: 'Potongan Bonus Presensi', amount: getLoyalisPresenceDeduction(emp.id) });
      } else {
        const bpjsAmount = emp.raw?.bpjs?.deductionAmount ? Math.round(emp.raw.bpjs.deductionAmount) : 0;
        const kopRochmadAmount = emp.raw?.deductions?.koperasiRochmad || 0;

        deductions.push({ label: 'BPJS', amount: bpjsAmount });
        deductions.push({ label: 'Kop. Rochmad', amount: kopRochmadAmount });
        deductions.push({ label: 'Pinjaman Kop. UNIPDU', amount: kopUnipduAmount });
      }
      return deductions;
    };

    const activeEmployees = employees.filter(e => e.isActive || slipStates[e.id]?.status === 'locked');

    // Collect all unique deduction keys across all active employees
    const customKeysSet = new Set<string>();
    const standardKeys = ['BPJS', 'Koperasi Rochmad', 'Kop. Rejoso Gemilang', 'Tunai', 'Dana Sosial'];

    activeEmployees.forEach(emp => {
      const slip = slipStates[emp.id];
      const deductionsList = getEmployeeDeductions(emp, slip, payrollCollar);

      deductionsList.forEach(d => {
        const sanitized = sanitizeDeductionLabel(d.label);
        if (!standardKeys.includes(sanitized) && d.amount > 0) {
          customKeysSet.add(sanitized);
        }
      });
    });

    const customDeductionKeys = Array.from(customKeysSet).sort();
    const allDeductionKeys = [...standardKeys, ...customDeductionKeys];

    const categoriesMap: Record<string, RekapCategoryData> = {};

    categories.forEach(cat => {
      const deductionsInit: Record<string, number> = {};
      allDeductionKeys.forEach(key => {
        deductionsInit[key] = 0;
      });

      categoriesMap[cat] = {
        categoryName: payrollCollar === 'loyalis' ? `STAF ${cat}` : `VAKASI ${cat}`,
        totalEarnings: 0,
        deductions: deductionsInit,
        totalDeductions: 0,
        netSalary: 0,
      };
    });

    activeEmployees.forEach(emp => {
      const cat = emp.role;
      const freshData = buildFreshSlipData(emp);
      const earnings = freshData.earnings.reduce((sum, e) => sum + e.amount, 0);
      let totalDeductions = 0;

      // Temporary local map for this employee's deductions
      const empDeductions: Record<string, number> = {};
      allDeductionKeys.forEach(key => {
        empDeductions[key] = 0;
      });

      const defaultDeductions = freshData.deductions;
      defaultDeductions.forEach(d => {
        const sanitized = sanitizeDeductionLabel(d.label);
        const amount = d.amount || 0;
        totalDeductions += amount;
        if (empDeductions[sanitized] !== undefined) {
          empDeductions[sanitized] += amount;
        } else {
          empDeductions[sanitized] = amount;
        }
      });

      const netSalary = earnings - totalDeductions;

      if (categoriesMap[cat]) {
        categoriesMap[cat].totalEarnings += earnings;
        categoriesMap[cat].totalDeductions += totalDeductions;
        categoriesMap[cat].netSalary += netSalary;

        allDeductionKeys.forEach(key => {
          categoriesMap[cat].deductions[key] += empDeductions[key] || 0;
        });
      }
    });

    const data: RekapGajiData = {
      period: getPayrollPeriod(targetDate),
      categories: Object.values(categoriesMap).filter(c => c.totalEarnings > 0),
      deductionKeys: allDeductionKeys,
      isLoyalis: payrollCollar === 'loyalis',
    };

    if (format === 'pdf') {
      await generateRekapGajiPdf(data);
    } else {
      generateRekapGajiPekaryaXlsx(data);
    }
  };

  const handlePrintPayrollStatement = () => {
    const isSuperAdmin = profile?.role === 'super_admin';
    const activeEmployees = employees.filter(e =>
      isSuperAdmin ? e.isActive : isTransferEligibleStatus(slipStates[e.id]?.status),
    );
    if (activeEmployees.length === 0) {
      alert('Tidak ada slip karyawan yang dapat dimasukkan ke surat pengantar transfer.');
      return;
    }

    const roleOrder = payrollCollar === 'loyalis'
      ? [
        'REKTORAT',
        'FAK. AGAMA ISLAM',
        'FAK. BISNIS, BAHASA DAN PENDIDIKAN',
        'FAK. ILMU KESEHATAN',
        'FAK. SAINS DAN TEKNOLOGI',
        'PASCASARJANA',
        'UPT & LEMBAGA'
      ]
      : ['SATPAM', 'SOPIR', 'PEKARYA', 'TEKNISI', 'KEBERSIHAN', 'KEBERSIHAN_PONTI', 'PONTI'];
    const sortedEmployees = [...activeEmployees].sort((a, b) => {
      const roleA = roleOrder.indexOf(a.role) !== -1 ? roleOrder.indexOf(a.role) : 99;
      const roleB = roleOrder.indexOf(b.role) !== -1 ? roleOrder.indexOf(b.role) : 99;
      if (roleA !== roleB) return roleA - roleB;
      return a.name.localeCompare(b.name);
    });

    let totalNetSalary = 0;
    const stmtEmployees: PayrollStatementEmployee[] = sortedEmployees.map((emp, idx) => {
      const cat = emp.role;
      const freshData = buildFreshSlipData(emp);
      const totalEarnings = freshData.earnings.reduce((sum, e) => sum + e.amount, 0);
      const totalDeductions = (freshData.deductions || []).reduce((sum, d) => sum + d.amount, 0);
      const netSalary = totalEarnings - totalDeductions;

      totalNetSalary += netSalary;

      let satker = cat;
      if (satker === 'KEBERSIHAN_PT') satker = 'KEBERSIHAN PONDOK TINGGI';
      if (satker === 'KEBERSIHAN_PONTI') satker = 'KEBERSIHAN PONTI';

      return {
        no: idx + 1,
        name: emp.name,
        satker: satker,
        accountNumber: payrollCollar === 'loyalis' ? (emp.raw.banking_info?.account_number || '') : (emp.raw.bankAccount?.accountNumber || ''),
        netSalary
      };
    });

    const data: PayrollStatementData = {
      period: getPayrollPeriod(targetDate),
      employees: stmtEmployees,
      totalNetSalary,
      title: payrollCollar === 'loyalis' ? 'PAYROLL STAF LOYALIS' : 'PAYROLL PEKARYA'
    };

    generatePayrollStatementPdf(data);
  };

  const handleSort = (key: string) => {
    let direction: 'asc' | 'desc' | null = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    } else if (sortConfig.key === key && sortConfig.direction === 'desc') {
      direction = null;
    }
    setSortConfig({ key, direction });
  };

  // Helper: build fresh earnings/deductions from current employee data
  // Used by PDF, WhatsApp, email, and multi-print flows to always
  // reflect the latest profile data, salary matrix, and vakasi tambahan.
  const buildFreshSlipData = (emp: EmployeeRow) => {
    // If there is already a saved slip state, return its saved earnings and deductions
    const savedSlip = slipStates[emp.id];
    if (savedSlip && savedSlip.earnings && savedSlip.earnings.length > 0) {
      return {
        earnings: savedSlip.earnings,
        deductions: savedSlip.deductions || [],
      };
    }

    const gapok = calculateGapok(emp, salaryMatrix, targetDate);
    const cat = payrollCollar === 'loyalis' ? emp.role : emp.raw.employment?.jobCategory;
    const period = `${targetDate.getFullYear()}_${String(targetDate.getMonth() + 1).padStart(2, '0')}`;
    const uraianEntry = uraianMap[`${period}_${cat}`]?.entries?.[emp.id];

    const earnings = buildInitialEarnings(
      emp.raw,
      gapok,
      payrollCollar,
      uraianEntry,
      vakasiTambahanMap[emp.id] ?? 0,
      vakasiTambahanListMap[emp.id] ?? [],
      functionalAllowanceMap[emp.id] ?? 0,
      kepangkatanAllowanceMap[emp.id] ?? 0,
      [],
      getLoyalisPresenceBonus(emp.id),
      getLoyalisPresensiEarning(emp.id)
    );

    const deductions = buildInitialDeductions(
      emp.raw,
      payrollCollar,
      koperasiDeductions[emp.id] || 0,
      getLoyalisPresenceDeduction(emp.id),
      getLoyalisPresensiDeduction(emp.id),
      koperasiSavings[emp.id] || 0
    );

    return { earnings, deductions };
  };

  /**
   * The single source of truth for every PDF this dashboard produces — single
   * download, WhatsApp, single email, bulk email, and multi-slip print.
   *
   * The lampiran ("Panduan & Perhitungan") renders the *variables* behind each
   * subtotal (masa kerja, pendidikan, KUM, menit presensi, daftar vakasi), so
   * omitting them here silently degrades the document to bare subtotals with
   * "-" placeholders. Building them in one place keeps the emailed slip byte-
   * identical to the one a Loyalis downloads from /employee/payslip.
   */
  const buildPaySlipDocument = (
    emp: EmployeeRow,
    fields: { earnings: PaySlipField[]; deductions: PaySlipField[] },
  ): PaySlipData => {
    const isLoyalis = payrollCollar === 'loyalis';
    const creditVal = Number(emp.raw.kepangkatan?.cummulativeCredit) || 0;
    const recognitionDate = emp.dateRecognized || emp.joinDate;
    const presenceEntry = loyalisPresenceData?.entries?.[emp.id];

    return {
      employeeName: isLoyalis ? (emp.raw.personal_info?.name || emp.name) : emp.name,
      employeeNo: emp.rowIndex,
      period: payrollPeriod.toUpperCase(),
      jobCategory: isLoyalis
        ? `STAF ${emp.raw.employment_profile?.department_unit || 'STAF'}`
        : `VAKASI ${emp.raw.employment?.jobCategory || ''}`,
      earnings: fields.earnings,
      deductions: fields.deductions,
      isLoyalis,
      niy: isLoyalis ? emp.raw.personal_info?.employee_id_niy || '' : '',
      npwp: isLoyalis ? emp.raw.personal_info?.tax_id_npwp || '' : '',
      familyMetrics: isLoyalis ? emp.raw.family_allowance_metrics : undefined,
      gradeLevel: isLoyalis ? (emp.raw.academic_and_tier?.level_code || emp.gradeLevel || '') : '',
      yearsOfService: isLoyalis ? calculateYearsOfService(recognitionDate, targetDate) : 0,
      baseDate: isLoyalis && recognitionDate ? recognitionDate.toISOString() : '',
      educationLevel: isLoyalis ? (emp.raw.academic_and_tier?.education_level || '') : '',
      functionalTier: isLoyalis ? (emp.raw.academic_and_tier?.functional_tier || '') : '',
      cummulativeCredit: isLoyalis ? creditVal : 0,
      designation: isLoyalis ? (kepangkatanDesignations[creditVal] || 'Tidak Ditemukan') : '',
      // Same figures the Loyalis presence run feeds into the slip, so the
      // lampiran shows the real menit kerja instead of the 25 hari / 6,5 jam
      // fallback baked into the PDF generator.
      presenceInfo: isLoyalis
        ? {
          workingDays: loyalisPresenceData?.workingDays || 25,
          expectedHours: loyalisPresenceData?.expectedHours || 6.5,
          absenceMinutes: presenceEntry?.absenceMinutes || 0,
          bonusDeduction: getLoyalisPresenceDeduction(emp.id),
        }
        : null,
      vakasiEvents: isLoyalis
        ? (vakasiTambahanListMap[emp.id] ?? []).map(event => ({
          eventName: event.eventName,
          payGiven: event.payGiven,
        }))
        : [],
    };
  };

  const buildPayrollTargetDraftData = (
    target: PayrollTarget,
    states: Record<string, SlipState>,
  ) => buildDashboardSlipData(
    { ...target.raw, id: target.id },
    target.collar,
    states[target.id],
    {
      targetDate,
      salaryMatrix:
        target.collar === 'loyalis' ? salaryMatrixWhite : salaryMatrixBlue,
      uraianMap,
      vakasiTambahanMap,
      vakasiTambahanListMap,
      functionalAllowanceMap,
      kepangkatanAllowanceMap,
      koperasiDeductions,
      koperasiSavings,
      loyalisPresenceData,
    },
  );

  const getFilteredAndSortedEmployees = () => {
    let filtered = [...employees];

    // Only show active employees
    filtered = filtered.filter(emp => emp.isActive || slipStates[emp.id]?.status === 'locked');

    // Category Filter
    if (categoryFilter !== 'all') {
      filtered = filtered.filter(emp => emp.role === categoryFilter);
    }

    // Search Query Filter
    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(emp =>
        emp.name.toLowerCase().includes(q) ||
        emp.id.toLowerCase().includes(q)
      );
    }

    // Sorting
    if (!sortConfig.direction || !sortConfig.key) return filtered;

    return filtered.sort((a, b) => {
      let aValue: any;
      let bValue: any;

      switch (sortConfig.key) {
        case 'name':
          aValue = a.name.toLowerCase();
          bValue = b.name.toLowerCase();
          break;
        case 'role':
          aValue = a.role.toLowerCase();
          bValue = b.role.toLowerCase();
          break;
        case 'earnings': {
          const dataA = buildFreshSlipData(a);
          const dataB = buildFreshSlipData(b);
          aValue = dataA.earnings.reduce((sum, e) => sum + e.amount, 0);
          bValue = dataB.earnings.reduce((sum, e) => sum + e.amount, 0);
          break;
        }
        case 'deductions': {
          const dataA = buildFreshSlipData(a);
          const dataB = buildFreshSlipData(b);
          aValue = dataA.deductions.reduce((sum, d) => sum + d.amount, 0);
          bValue = dataB.deductions.reduce((sum, d) => sum + d.amount, 0);
          break;
        }
        case 'net': {
          const dataA = buildFreshSlipData(a);
          const dataB = buildFreshSlipData(b);
          const earningsA = dataA.earnings.reduce((sum, e) => sum + e.amount, 0);
          const deductionsA = dataA.deductions.reduce((sum, d) => sum + d.amount, 0);
          aValue = earningsA - deductionsA;

          const earningsB = dataB.earnings.reduce((sum, e) => sum + e.amount, 0);
          const deductionsB = dataB.deductions.reduce((sum, d) => sum + d.amount, 0);
          bValue = earningsB - deductionsB;
          break;
        }
        default:
          return 0;
      }

      if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  };

  const displayEmployees = getFilteredAndSortedEmployees();



  const payrollTotals = useMemo(() => {
    let totalGross = 0;
    let totalDeductions = 0;
    let totalNet = 0;

    displayEmployees.forEach((emp) => {
      const freshData = buildFreshSlipData(emp);
      const earnings = freshData.earnings.reduce((sum, e) => sum + e.amount, 0);
      const deductions = freshData.deductions.reduce((sum, d) => sum + d.amount, 0);

      totalGross += earnings;
      totalDeductions += deductions;
      totalNet += (earnings - deductions);
    });

    return {
      totalGross,
      totalDeductions,
      totalNet
    };
  }, [
    displayEmployees,
    slipStates,
    salaryMatrix,
    targetDate,
    uraianMap,
    vakasiTambahanMap,
    functionalAllowanceMap,
    koperasiDeductions,
    koperasiSavings,
    loyalisPresenceData
  ]);

  // Get all unique categories for filter
  const categories = Array.from(new Set(employees.map(emp => emp.role))).sort((a, b) => {
    const roleOrder = payrollCollar === 'loyalis'
      ? [
        'REKTORAT',
        'FAK. AGAMA ISLAM',
        'FAK. BISNIS, BAHASA DAN PENDIDIKAN',
        'FAK. ILMU KESEHATAN',
        'FAK. SAINS DAN TEKNOLOGI',
        'PASCASARJANA',
        'UPT & LEMBAGA'
      ]
      : ['SATPAM', 'SOPIR', 'PEKARYA', 'TEKNISI', 'KEBERSIHAN', 'KEBERSIHAN_PONTI', 'PONTI'];
    const idxA = roleOrder.indexOf(a);
    const idxB = roleOrder.indexOf(b);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.localeCompare(b);
  });

  useEffect(() => {
    if (!profile || !['super_admin', 'finance_verifier'].includes(profile.role)) return;

    const isLoyalis = payrollCollar === 'loyalis';
    const list = isLoyalis ? employeesLoyalis : employeesBlueCollar;
    const matrix = isLoyalis ? salaryMatrixWhite : salaryMatrixBlue;

    let index = 1;
    const empList = list.map(data => {
      const joinDateVal = isLoyalis
        ? (data.employment_profile?.date_of_hire?.toDate?.() || (data.employment_profile?.date_of_hire ? new Date(data.employment_profile.date_of_hire) : new Date()))
        : (data.employment?.startDate ? new Date(data.employment.startDate) : new Date());

      const dateRecognizedVal = isLoyalis
        ? (data.employment_profile?.date_recognized?.toDate?.() || (data.employment_profile?.date_recognized ? new Date(data.employment_profile.date_recognized) : undefined))
        : undefined;

      const row: EmployeeRow = {
        id: data.id,
        name: isLoyalis ? (data.personal_info?.name || '') : (data.name || ''),
        role: isLoyalis ? (data.employment_profile?.department_unit || 'Staf') : (data.employment?.jobCategory || ''),
        gradeLevel: isLoyalis ? (data.academic_and_tier?.level_code || '') : (data.salaryProfile?.salaryGradeCode || ''),
        joinDate: joinDateVal,
        dateRecognized: dateRecognizedVal,
        isActive: isLoyalis ? (data.personal_info?.status === 'AKTIF') : (data.flags?.isActive ?? true),
        phoneNumber: isLoyalis ? (data.personal_info?.phone || '') : (data.phoneNumber || ''),
        email: isLoyalis ? (data.personal_info?.email || '') : (data.email || ''),
        raw: { ...data, employeeId: data.id },
        rowIndex: index++,
      };
      return row;
    });

    setEmployees(empList);
    setSalaryMatrix(matrix);
    setFunctionalAllowanceMap(contextFunctionalAllowanceMap);
    setKepangkatanAllowanceMap(contextKepangkatanAllowanceMap);
  }, [payrollCollar, employeesLoyalis, employeesBlueCollar, salaryMatrixWhite, salaryMatrixBlue, contextFunctionalAllowanceMap, contextKepangkatanAllowanceMap, profile]);

  // ─── Fetch UraianGaji & persisted SlipStates for current period ──
  useEffect(() => {
    if (!profile || !['super_admin', 'finance_verifier'].includes(profile.role)) return;
    const fetchPeriodData = async () => {
      try {
        const period = `${targetDate.getFullYear()}_${String(targetDate.getMonth() + 1).padStart(2, '0')}`;

        // 1. Fetch UraianGaji
        const snapshot = await getDocs(collection(db, 'UraianGaji'));
        const map: Record<string, UraianGajiDocument> = {};
        snapshot.docs.forEach(d => {
          if (d.id.startsWith(period)) {
            map[d.id] = d.data() as UraianGajiDocument;
          }
        });
        setUraianMap(map);

        // 2. Fetch persisted SlipStates for the current period
        const slipStatesSnapshot = await getDocs(collection(db, 'PayrollSlipStates'));
        const persistedStates: Record<string, SlipState> = {};
        slipStatesSnapshot.docs.forEach(d => {
          // Document ID format: {period}_{employeeId}
          if (d.id.startsWith(period + '_')) {
            const data = d.data();
            const empId = d.id.substring(period.length + 1);
            
            // Legacy confirmed records remain read-only and are never rewritten.
            const status = data.status === 'confirmed' ? 'locked' : (data.status || 'draft');
            
            persistedStates[empId] = {
              status: status,
              earnings: data.earnings || [],
              deductions: data.deductions || [],
              generatedAt: data.generatedAt,
              lockedAt: data.lockedAt || data.confirmedAt,
              emailSent: data.emailSent || false,
              emailSentAt: data.emailSentAt || undefined,
            };
          }
        });
        setSlipStates(persistedStates);

        // 3. Fetch LoyalisPresence document
        const presenceDocRef = doc(db, 'LoyalisPresence', period);
        const presenceSnap = await getDoc(presenceDocRef);
        if (presenceSnap.exists()) {
          setLoyalisPresenceData(presenceSnap.data());
        } else {
          setLoyalisPresenceData(null);
        }
      } catch (err) {
        console.error('Error fetching period data:', err);
      }
    };
    fetchPeriodData();
  }, [targetDate, profile]);

  // ─── Fetch VakasiTambahan for current period (Loyalis Only) ───
  useEffect(() => {
    if (!profile || !['super_admin', 'finance_verifier'].includes(profile.role)) return;
    const fetchVakasiAndSpj = async () => {
      try {
        const periodToken = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}`;

        // Fetch Loyalis VakasiTambahan collection
        const snapshotLoyalis = await getDocs(collection(db, 'VakasiTambahan'));

        const sumMap: Record<string, number> = {};
        const listMap: Record<string, { eventName: string; payGiven: number; isEndOfMonth?: boolean }[]> = {};

        const processDocs = (docs: any[]) => {
          docs.forEach(d => {
            const data = d.data();
            if (data.period === periodToken && isPayableVakasiTambahan(data)) {
              const eventNameVal = data.eventName || '';
              const workers = data.eventWorkers || {};
              Object.entries(workers).forEach(([empId, w]: [string, any]) => {
                sumMap[empId] = (sumMap[empId] || 0) + (w.payGiven || 0);

                if (!listMap[empId]) {
                  listMap[empId] = [];
                }
                listMap[empId].push({
                  eventName: eventNameVal,
                  payGiven: w.payGiven || 0,
                  isEndOfMonth: !!data.isEndOfMonth,
                });
              });
            }
          });
        };

        processDocs(snapshotLoyalis.docs);

        setVakasiTambahanMap(sumMap);
        setVakasiTambahanListMap(listMap);
      } catch (err) {
        console.error('Error fetching VakasiTambahan:', err);
      }
    };
    fetchVakasiAndSpj();
  }, [targetDate, profile]);

  // ─── Slip Handlers ─────────────────────────────────────────────

  const openEditDialog = (emp: EmployeeRow) => {
    setSelectedEmployee(emp);
    setDialogOpen(true);
  };

  const handleSendWhatsApp = async (emp: EmployeeRow, slip: any) => {
    const phone = emp.phoneNumber || emp.raw.phoneNumber || '';
    if (!phone) {
      alert(`Karyawan "${emp.name}" tidak memiliki nomor WhatsApp/telepon yang terdaftar.`);
      return;
    }
    if (!slip || !isTransferEligibleStatus(slip.status) || !slip.earnings) {
      alert(`Slip gaji untuk "${emp.name}" belum dikunci.`);
      return;
    }

    // Pre-open the window immediately on user click to bypass the browser's popup blocker
    const newTab = window.open('about:blank', '_blank');

    setUploadingWa(prev => ({ ...prev, [emp.id]: true }));

    try {
      const freshData = {
        earnings: slip.earnings,
        deductions: slip.deductions || [],
      };
      const slipData = buildPaySlipDocument(emp, freshData);

      let pdfUrl: string | undefined = undefined;
      try {
        // 1. Upload PDF and get download URL with a 5-second timeout race (false = don't trigger browser save)
        const dbPeriod = `${targetDate.getFullYear()}_${String(targetDate.getMonth() + 1).padStart(2, '0')}`;
        const uploadPromise = uploadPaySlipPdf(slipData, emp.id, dbPeriod);

        // Attach a silent catch handler to prevent unhandled rejection overlays in Next.js development mode
        uploadPromise.catch((err) => {
          console.warn('Background Firebase upload failed/aborted after timeout:', err.message);
        });

        const timeoutPromise = new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), 5000)
        );

        const result = await Promise.race([uploadPromise, timeoutPromise]);
        if (result === null) {
          console.warn('Firebase Storage upload timed out');
          const confirmSendWithoutPdf = window.confirm(
            'Gagal mengunggah file PDF slip gaji ke cloud (Firebase Storage terblokir/timeout).\n\nApakah Anda ingin tetap mengirimkan rincian slip gaji via WhatsApp tanpa link file PDF?'
          );
          if (!confirmSendWithoutPdf) {
            if (newTab) newTab.close();
            return;
          }
        } else {
          pdfUrl = result;
        }
      } catch (uploadErr) {
        console.error('Failed to upload payslip PDF to storage (error):', uploadErr);
        const confirmSendWithoutPdf = window.confirm(
          'Gagal mengunggah file PDF slip gaji ke cloud (Firebase Storage terblokir/error).\n\nApakah Anda ingin tetap mengirimkan rincian slip gaji via WhatsApp tanpa link file PDF?'
        );
        if (!confirmSendWithoutPdf) {
          if (newTab) newTab.close();
          return;
        }
      }

      // 2. Generate WhatsApp prefilled message with PDF URL included (or undefined if failed)
      const totalEarnings = freshData.earnings.reduce((sum: number, e: any) => sum + e.amount, 0);
      const totalDeductions = freshData.deductions.reduce((sum: number, d: any) => sum + d.amount, 0);
      const netSalary = totalEarnings - totalDeductions;

      const waUrl = generateWhatsAppPaySlipUrl(
        phone,
        emp.name,
        payrollPeriod,
        freshData.earnings,
        freshData.deductions,
        netSalary,
        pdfUrl
      );

      if (newTab) {
        newTab.location.href = waUrl;
      } else {
        window.open(waUrl, '_blank');
      }
    } catch (err) {
      console.error('Failed to process WhatsApp payslip:', err);
      alert('Terjadi kesalahan saat memproses slip gaji.');
      if (newTab) newTab.close();
    } finally {
      setUploadingWa(prev => ({ ...prev, [emp.id]: false }));
    }
  };

  const handleSendSingleEmail = async (emp: EmployeeRow) => {
    const email = emp.email || emp.raw.personal_info?.email || emp.raw.email || '';
    if (!email) {
      alert(`Karyawan "${emp.name}" tidak memiliki alamat email yang terdaftar.`);
      return;
    }

    const slip = slipStates[emp.id];
    if (!slip || !isTransferEligibleStatus(slip.status)) {
      alert(`Slip gaji untuk "${emp.name}" belum dikunci.`);
      return;
    }

    setSendingSingleEmail(true);

    try {
      const freshData = {
        earnings: slip.earnings || [],
        deductions: slip.deductions || [],
      };
      const slipData = buildPaySlipDocument(emp, freshData);

      const pdfDoc = generatePaySlipPdf(slipData, false);
      const pdfBase64 = pdfDoc.output('datauristring').split(',')[1];

      // 2. Format a clean text breakdown
      const totalEarnings = freshData.earnings.reduce((sum: number, e: any) => sum + e.amount, 0);
      const totalDeductions = freshData.deductions.reduce((sum: number, d: any) => sum + d.amount, 0);
      const netSalary = totalEarnings - totalDeductions;

      const formatIDR = (amount: number): string => {
        return new Intl.NumberFormat('id-ID', {
          style: 'currency',
          currency: 'IDR',
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }).format(amount);
      };

      let textBreakdown = `PENDAPATAN:\n`;
      freshData.earnings.forEach((e: any) => {
        textBreakdown += `• ${e.label}: ${formatIDR(e.amount)}\n`;
      });
      textBreakdown += `Total Pendapatan: ${formatIDR(totalEarnings)}\n\n`;

      textBreakdown += `POTONGAN:\n`;
      if (freshData.deductions.length > 0) {
        freshData.deductions.forEach((d: any) => {
          textBreakdown += `• ${d.label}: ${formatIDR(d.amount)}\n`;
        });
        textBreakdown += `Total Potongan: ${formatIDR(totalDeductions)}\n\n`;
      } else {
        textBreakdown += `• Tidak ada potongan\n\n`;
      }
      textBreakdown += `GAJI BERSIH (Diterima): ${formatIDR(netSalary)}`;

      // 3. Post to backend API
      const period = `${targetDate.getFullYear()}_${String(targetDate.getMonth() + 1).padStart(2, '0')}`;
      await authenticatedJson('/api/payroll/send-email', {
        method: 'POST',
        body: JSON.stringify({
          employeeId: emp.id,
          dbPeriod: period,
          requestId: createFinancialRequestId('email'),
          pdfBase64,
        }),
      });

      // Update local state in real-time
      setSlipStates(prev => ({
        ...prev,
        [emp.id]: {
          ...prev[emp.id],
          emailSent: true,
          emailSentAt: new Date().toISOString()
        }
      }));

      alert(`Email slip gaji berhasil dikirim ke "${emp.name}" (${email})!`);
      setCetakKirimOpen(false);
    } catch (err: any) {
      console.error('Failed to send single email:', err);
      alert(err.message || 'Terjadi kesalahan saat mengirim email.');
    } finally {
      setSendingSingleEmail(false);
    }
  };

  const handleBulkEmail = () => {
    if (isBulkEmailActive) {
      // A job is still running (or paused) — surface it instead of queueing a
      // second run over the same roster.
      setShowBulkDetailModal(true);
      return;
    }

    const resolveEmail = (emp: EmployeeRow) =>
      (emp.email || emp.raw.personal_info?.email || emp.raw.email || '').trim();

    // Locked employees in the active filter list; those without an email are
    // reported rather than silently dropped from the count.
    const lockedEmployees = displayEmployees.filter(emp => {
      const slip = slipStates[emp.id];
      return slip && isTransferEligibleStatus(slip.status);
    });
    const skipped = lockedEmployees.filter(emp => !resolveEmail(emp)).map(emp => emp.name);
    const recipients = lockedEmployees.filter(emp => resolveEmail(emp));

    if (recipients.length === 0) {
      setNotification({
        show: true,
        type: 'error',
        message: skipped.length > 0
          ? `${skipped.length} karyawan terkunci belum memiliki email terdaftar, tidak ada slip yang dapat dikirim.`
          : 'Tidak ada karyawan terkunci dengan email terdaftar untuk dikirimi slip gaji.',
      });
      setTimeout(() => setNotification(prev => ({ ...prev, show: false })), 5000);
      return;
    }

    const items: QueueItem[] = recipients.map(emp => {
      const slipData = buildPaySlipDocument(emp, buildFreshSlipData(emp));
      return {
        employeeId: emp.id,
        employeeName: slipData.employeeName,
        email: resolveEmail(emp),
        slipData,
        status: 'pending' as const,
      };
    });

    setBulkEmailPlan({ items, skipped });
    setBulkConfirmDialogOpen(true);
  };

  const confirmBulkEmail = () => {
    if (bulkEmailPlan.items.length === 0) return;
    const dbPeriodKey = `${targetDate.getFullYear()}_${String(targetDate.getMonth() + 1).padStart(2, '0')}`;
    setBulkConfirmDialogOpen(false);
    startBulkEmailJob(bulkEmailPlan.items, payrollPeriod, dbPeriodKey, {
      // Keep the "email terkirim" marker on the row after the job is dismissed,
      // matching what a single send does.
      onSent: (employeeId: string) => {
        setSlipStates(prev => (
          prev[employeeId]
            ? {
              ...prev,
              [employeeId]: {
                ...prev[employeeId],
                emailSent: true,
                emailSentAt: new Date().toISOString(),
              },
            }
            : prev
        ));
      },
    });
  };

  const handleBulkPdf = () => {
    const isLoyalis = payrollCollar === 'loyalis';

    // We only compile slips for employees who have locked states
    const lockedEmployees = displayEmployees.filter(emp => {
      const slip = slipStates[emp.id];
      return slip && isTransferEligibleStatus(slip.status);
    });

    if (lockedEmployees.length === 0) {
      alert('Tidak ada karyawan terkunci untuk dicetak slip gajinya.');
      return;
    }

    const slipsToDraw: PaySlipData[] = lockedEmployees.map(emp => buildPaySlipDocument(emp, {
      earnings: slipStates[emp.id].earnings,
      deductions: slipStates[emp.id].deductions || [],
    }));

    const categoryLabel = isLoyalis ? 'Staf_Loyalis' : `Vakasi_${categoryFilter !== 'all' ? categoryFilter : 'Pekarya'}`;
    const filename = `Multi_Slip_Gaji_${categoryLabel}_${payrollPeriod.replace(/\s+/g, '_')}.pdf`;

    alert(`Memulai proses penggabungan ${slipsToDraw.length} slip gaji menjadi 1 file PDF. Silakan tunggu sebentar.`);
    generateMultiPaySlipPdf(slipsToDraw, filename, true);
  };

  const handleSlipSave = async (employeeId: string, earnings: PaySlipField[], deductions: PaySlipField[]) => {
    if (attendancePeriodStatus === 'closed') {
      throw new Error('Periode payroll sudah ditutup; draf tidak dapat diubah.');
    }
    if (isSavingRef.current) return;
    isSavingRef.current = true;
    try {
      const period = `${targetDate.getFullYear()}_${String(targetDate.getMonth() + 1).padStart(2, '0')}`;
      const result = await authenticatedJson<{
        koperasiPlan?: { loanCount: number; expectedDeduction: number; matchType: string };
      }>('/api/payroll/slips', {
        method: 'POST',
        body: JSON.stringify({
          action: 'save_draft',
          employeeId,
          period,
          requestId: createFinancialRequestId('save_draft'),
          earnings,
          deductions,
        }),
      });
      const newState: SlipState = {
        status: 'draft',
        earnings: [...earnings],
        deductions: [...deductions],
        generatedAt: new Date().toISOString(),
      };
      setSlipStates(prev => ({ ...prev, [employeeId]: newState }));

      setNotification({
        show: true,
        type: 'success',
        message: result.koperasiPlan
          ? `Draf berhasil disimpan. Rencana Koperasi: ${result.koperasiPlan.loanCount} pinjaman, Rp${result.koperasiPlan.expectedDeduction.toLocaleString('id-ID')}.`
          : 'Draf slip gaji berhasil disimpan!'
      });
      setTimeout(() => {
        setNotification(prev => ({ ...prev, show: false }));
      }, 3000);
    } catch (err: any) {
      console.error('Error saving draft payslip state to Firestore:', err);
      setNotification({
        show: true,
        type: 'error',
        message: `Gagal menyimpan data: ${err.message || 'Terjadi kesalahan sistem'}`
      });
      setTimeout(() => {
        setNotification(prev => ({ ...prev, show: false }));
      }, 5000);
    } finally {
      isSavingRef.current = false;
    }
  };

  const handleSlipVerifyAndLock = async (employeeId: string, reason: string) => {
    if (isSavingRef.current) return;
    isSavingRef.current = true;
    try {
      const period = `${targetDate.getFullYear()}_${String(targetDate.getMonth() + 1).padStart(2, '0')}`;
      const result = await authenticatedJson<VerifyAndLockResponse>('/api/payroll/slips', {
        method: 'POST',
        body: JSON.stringify({
          action: 'verify_and_lock',
          employeeId,
          period,
          requestId: createFinancialRequestId('verify_lock'),
          reason,
        }),
      });
      setSlipStates(prev => ({
        ...prev,
        [employeeId]: {
          ...prev[employeeId],
          status: 'locked',
          verifiedAt: new Date().toISOString(),
          verifiedBy: user?.uid,
          lockedAt: new Date().toISOString(),
          lockedBy: user?.uid,
        },
      }));
      setNotification({
        show: true,
        type: 'success',
        message: `Slip berhasil diverifikasi dan dikunci. ${koperasiReceiptMessage(result.koperasi)}`,
      });
    } catch (err: any) {
      setNotification({ show: true, type: 'error', message: err.message || 'Verifikasi dan penguncian gagal.' });
      throw err;
    } finally {
      isSavingRef.current = false;
    }
  };

  const handleCreatePayment = async (
    employeeId: string,
    paymentBatchId: string,
    reason: string,
  ) => {
    const period = `${targetDate.getFullYear()}_${String(targetDate.getMonth() + 1).padStart(2, '0')}`;
    await authenticatedJson('/api/payroll/slips', {
      method: 'POST',
      body: JSON.stringify({
        action: 'create_payment',
        employeeId,
        period,
        paymentBatchId,
        reason,
        requestId: createFinancialRequestId('payment'),
      }),
    });
    setSlipStates((previous) => ({
      ...previous,
      [employeeId]: {
        ...previous[employeeId],
        status: 'payment_created',
        paymentBatchId,
      },
    }));
    setNotification({
      show: true,
      type: 'success',
      message: 'Instruksi pembayaran dibuat secara idempoten.',
    });
  };

  const handleMarkPaid = async (
    employeeId: string,
    bankReference: string,
    reason: string,
  ) => {
    const period = `${targetDate.getFullYear()}_${String(targetDate.getMonth() + 1).padStart(2, '0')}`;
    await authenticatedJson('/api/payroll/slips', {
      method: 'POST',
      body: JSON.stringify({
        action: 'mark_paid',
        employeeId,
        period,
        bankReference,
        reason,
        requestId: createFinancialRequestId('paid'),
      }),
    });
    setSlipStates((previous) => ({
      ...previous,
      [employeeId]: {
        ...previous[employeeId],
        status: 'paid',
        bankReference,
      },
    }));
    setNotification({
      show: true,
      type: 'success',
      message: 'Pembayaran tercatat dengan referensi bank dan audit log.',
    });
  };

  const handleSlipCorrectionRequest = async (employeeId: string, reason: string) => {
    const period = `${targetDate.getFullYear()}_${String(targetDate.getMonth() + 1).padStart(2, '0')}`;
    await authenticatedJson('/api/payroll/slips', {
      method: 'POST',
      body: JSON.stringify({
        action: 'request_correction',
        employeeId,
        period,
        requestId: createFinancialRequestId('correction'),
        reason,
      }),
    });
    setNotification({
      show: true,
      type: 'success',
      message: 'Permintaan koreksi tercatat tanpa mengubah snapshot historis.',
    });
  };

  const handleBulkRefresh = async () => {
    if (attendancePeriodStatus === 'closed') {
      alert('Periode payroll sudah ditutup. Data draf telah dibekukan.');
      return;
    }
    if (displayEmployees.length === 0) {
      alert("Tidak ada karyawan untuk direfresh.");
      return;
    }
    setRefreshingBulk(true);
    try {
      const period = `${targetDate.getFullYear()}_${String(targetDate.getMonth() + 1).padStart(2, '0')}`;
      const periodToken = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}`;
      const isLoyalisTab = payrollCollar === 'loyalis';

      // 1. Fetch configs and matrices in parallel
      const matrixCollection = isLoyalisTab ? 'SalaryMatrix_WhiteCollar' : 'SalaryMatrix';
      
      const [
        matrixConfigSnap,
        fConfigSnap,
        kepConfigSnap,
        presenceSnap,
        vakasiSnap,
        loanSnapshot,
        userSnapshot,
        uraianSnap,
        slipStatesSnapshot
      ] = await Promise.all([
        getDoc(doc(db, matrixCollection, '_config')),
        getDoc(doc(db, 'SalaryMatrix_Functional', '_config')),
        getDoc(doc(db, 'SalaryMatrix_Kepangkatan', '_config')),
        getDoc(doc(db, 'LoyalisPresence', period)),
        getDocs(collection(db, 'VakasiTambahan')),
        getDocs(collection(secondaryDb, 'simpanPinjam')),
        getDocs(collection(secondaryDb, 'users')),
        getDocs(collection(db, 'UraianGaji')),
        getDocs(collection(db, 'PayrollSlipStates'))
      ]);

      const activeMatrixVersion = matrixConfigSnap.exists() ? (matrixConfigSnap.data()?.activeVersion || '2026_v1') : '2026_v1';
      const activeFunctionalVersion = fConfigSnap.exists() ? (fConfigSnap.data()?.activeVersion || '2026_v1') : '2026_v1';
      const activeKepVersion = kepConfigSnap.exists() ? (kepConfigSnap.data()?.activeVersion || '2026_v1') : '2026_v1';

      const [matrixSnap, fSnap, kepSnap] = await Promise.all([
        getDocs(collection(db, matrixCollection, activeMatrixVersion, 'rows')),
        getDocs(collection(db, 'SalaryMatrix_Functional', activeFunctionalVersion, 'rows')),
        getDocs(collection(db, 'SalaryMatrix_Kepangkatan', activeKepVersion, 'rows'))
      ]);

      // Parse matrices
      const freshMatrix: any = {};
      matrixSnap.docs.forEach(d => {
        const data = d.data();
        const tahun = data.tahun;
        const salaries = data.salaries || {};
        Object.entries(salaries).forEach(([grade, amount]) => {
          if (!freshMatrix[grade]) freshMatrix[grade] = {};
          freshMatrix[grade][tahun] = amount as number;
        });
      });

      const freshFMatrix: Record<string, { base_value: number; functional_tiers: Record<string, number> }> = {};
      fSnap.docs.forEach(fDoc => {
        const data = fDoc.data();
        freshFMatrix[fDoc.id] = {
          base_value: data.base_value || 0,
          functional_tiers: data.functional_tiers || {},
        };
      });

      const freshKepMatrix: Record<number, number> = {};
      const freshKepDesignations: Record<number, string> = {};
      kepSnap.docs.forEach(d => {
        const data = d.data();
        const credit = Number(data.credit_score) || 0;
        const allowance = Number(data.allowance) || 0;
        freshKepMatrix[credit] = allowance;
        freshKepDesignations[credit] = data.designation || '';
      });
      setKepangkatanDesignations(freshKepDesignations);

      let freshPresenceData = presenceSnap.exists() ? presenceSnap.data() : null;
      setLoyalisPresenceData(freshPresenceData);

      // Map UraianGaji documents
      const freshUraianMap: Record<string, UraianGajiDocument> = {};
      uraianSnap.docs.forEach(d => {
        freshUraianMap[d.id] = d.data() as UraianGajiDocument;
      });

      // Map fresh slip states
      const freshSlipStates: Record<string, SlipState> = {};
      slipStatesSnapshot.docs.forEach(d => {
        if (d.id.startsWith(period + '_')) {
          const data = d.data();
          const empId = d.id.substring(period.length + 1);
          const status = data.status === 'confirmed' ? 'locked' : (data.status || 'draft');
          freshSlipStates[empId] = {
            status,
            earnings: data.earnings || [],
            deductions: data.deductions || [],
            generatedAt: data.generatedAt,
            lockedAt: data.lockedAt || data.confirmedAt,
            emailSent: data.emailSent || false,
            emailSentAt: data.emailSentAt || undefined,
          };
        }
      });

      const changes: BulkChange[] = [];

      // Loop through all displayEmployees
      for (const emp of displayEmployees) {
        const freshRaw = emp.raw;
        
        // Parse dates and gradeLevel
        let freshJoinDate = isLoyalisTab
          ? (freshRaw.employment_profile?.date_of_hire?.toDate?.() || (freshRaw.employment_profile?.date_of_hire ? new Date(freshRaw.employment_profile.date_of_hire) : new Date()))
          : (freshRaw.employment?.startDate ? new Date(freshRaw.employment.startDate) : new Date());

        let freshDateRecognized = isLoyalisTab
          ? (freshRaw.employment_profile?.date_recognized?.toDate?.() || (freshRaw.employment_profile?.date_recognized ? new Date(freshRaw.employment_profile.date_recognized) : undefined))
          : undefined;

        let freshGradeLevel = isLoyalisTab
          ? (freshRaw.academic_and_tier?.level_code || '')
          : (freshRaw.salaryProfile?.salaryGradeCode || '');

        const freshEmployee: any = {
          id: freshRaw.id,
          name: isLoyalisTab ? (freshRaw.personal_info?.name || '') : (freshRaw.name || ''),
          role: isLoyalisTab ? (freshRaw.employment_profile?.department_unit || 'Staf') : (freshRaw.employment?.jobCategory || ''),
          gradeLevel: freshGradeLevel,
          joinDate: freshJoinDate,
          dateRecognized: freshDateRecognized,
          isActive: isLoyalisTab ? (freshRaw.personal_info?.status === 'AKTIF') : (freshRaw.flags?.isActive ?? true),
          email: isLoyalisTab ? (freshRaw.personal_info?.email || '') : (freshRaw.email || ''),
          phoneNumber: isLoyalisTab ? (freshRaw.personal_info?.phone || '') : (freshRaw.phoneNumber || ''),
          raw: freshRaw,
          rowIndex: 0
        };

        // Calculations helper local implementations
        const getFreshPresenceBonus = (empId: string): number => {
          if (freshPresenceData?.entries && Object.keys(freshPresenceData.entries).length > 0) {
            const entry = freshPresenceData.entries[empId];
            if (!entry) return 0;
          }
          return 250000;
        };

        const getFreshPresenceDeduction = (empId: string): number => {
          if (freshPresenceData?.entries && Object.keys(freshPresenceData.entries).length > 0) {
            const entry = freshPresenceData.entries[empId];
            if (entry) {
              return entry.deduction || 0;
            }
          }
          return 0;
        };

        const getFreshPresensiEarning = (empId: string): number => {
          const workingDays = freshPresenceData?.workingDays || 25;
          const expectedHours = freshPresenceData?.expectedHours || 6.5;
          if (freshPresenceData?.entries && Object.keys(freshPresenceData.entries).length > 0) {
            const entry = freshPresenceData.entries[empId];
            if (!entry) return 0;
          }
          return Math.round(workingDays * expectedHours * 1650);
        };

        const getFreshPresensiDeduction = (empId: string): number => {
          if (freshPresenceData?.entries && Object.keys(freshPresenceData.entries).length > 0) {
            const entry = freshPresenceData.entries[empId];
            if (entry) {
              const absenceMinutes = entry.absenceMinutes || 0;
              return Math.round((absenceMinutes / 60) * 1650);
            }
          }
          return 0;
        };

        // VakasiTambahan sum & list
        let freshVakasiSum = 0;
        const freshVakasiList: { eventName: string; payGiven: number }[] = [];
        vakasiSnap.docs.forEach(d => {
          const data = d.data();
          if (data.period === periodToken && isPayableVakasiTambahan(data)) {
            const eventName = data.eventName || '';
            const worker = data.eventWorkers?.[emp.id];
            if (worker && worker.payGiven) {
              freshVakasiSum += worker.payGiven;
              freshVakasiList.push({ eventName, payGiven: worker.payGiven });
            }
          }
        });

        // Coop matching
        const empName = isLoyalisTab ? (freshRaw.personal_info?.name || '') : (freshRaw.name || '');

        let freshKoperasiDeduction = 0;
        const targetYear = targetDate.getFullYear();
        const targetMonth = targetDate.getMonth() + 1;
        const activeLoans = loanSnapshot.docs
          .map(d => d.data() as any)
          .filter(loan => {
            if ((loan.sisaHutang || 0) <= 0) return false;

            // 1. Verify that the latest history entry status is 'Disetujui dan Aktif'
            if (!loan.history || !Array.isArray(loan.history) || loan.history.length === 0) {
              return false;
            }
            const sortedHistory = [...loan.history].sort((a, b) => {
              const tA = (a.timestamp as any)?.toMillis ? (a.timestamp as any).toMillis() : (a.timestamp?.seconds ? a.timestamp.seconds * 1000 : 0);
              const tB = (b.timestamp as any)?.toMillis ? (b.timestamp as any).toMillis() : (b.timestamp?.seconds ? b.timestamp.seconds * 1000 : 0);
              return tB - tA; // Latest first
            });
            const latestEntry = sortedHistory[0];
            const isActiveStatus = loan.status === 'Disetujui dan Aktif' || (latestEntry && (latestEntry.status === 'Disetujui dan Aktif' || latestEntry.status === 'Pembayaran Cicilan'));
            if (!isActiveStatus) {
              return false;
            }

            // 2. Determine activation date from tanggalDisetujui, falling back to history entry timestamp
            let activationDate: Date | null = null;
            if (loan.tanggalDisetujui) {
              activationDate = (loan.tanggalDisetujui as any).toDate ? (loan.tanggalDisetujui as any).toDate() : (loan.tanggalDisetujui.seconds ? new Date(loan.tanggalDisetujui.seconds * 1000) : null);
            }
            if (!activationDate && latestEntry.timestamp) {
              activationDate = (latestEntry.timestamp as any).toDate ? (latestEntry.timestamp as any).toDate() : (latestEntry.timestamp.seconds ? new Date(latestEntry.timestamp.seconds * 1000) : null);
            }

            if (!activationDate) return false;

            const activationYear = activationDate.getFullYear();
            const activationMonth = activationDate.getMonth() + 1;

            // Deduction starts on or after the activation month and year
            if (targetYear < activationYear) return false;
            if (targetYear === activationYear && targetMonth < activationMonth) return false;

            return true;
          });
        activeLoans.forEach(loan => {
          const spName = loan.userData?.namaLengkap || '';
          const isUidMatch = freshRaw.koperasiAuthUid && freshRaw.koperasiAuthUid === loan.userId;
          const isNameMatch = empName && normalizeName(spName) === normalizeName(empName);
          const isOverrideMatch = empName && MANUAL_OVERRIDES[spName.trim()] === empName;

          if (isUidMatch || isNameMatch || isOverrideMatch) {
            const cicilan = Math.round(loan.jumlahPinjaman / loan.tenor);
            freshKoperasiDeduction += cicilan;
          }
        });

        let freshKoperasiSaving = 0;
        userSnapshot.docs.forEach(userDoc => {
          const uData = userDoc.data();
          const uName = uData.nama || '';
          const uUid = uData.uid || userDoc.id;

          const isUidMatch = (freshRaw.koperasiUserId && freshRaw.koperasiUserId === userDoc.id) || (freshRaw.koperasiAuthUid && freshRaw.koperasiAuthUid === uUid);
          const isNameMatch = empName && normalizeName(uName) === normalizeName(empName);
          const isOverrideMatch = empName && MANUAL_OVERRIDES[uName.trim()] === empName;

          if (isUidMatch || isNameMatch || isOverrideMatch) {
            const isApproved = uData.status === 'approved' || uData.membershipStatus === 'approved';
            if (!isApproved) return;

            const isYayasanSubsidy = uData.paymentStatus === 'Yayasan Subsidy';
            freshKoperasiSaving = isYayasanSubsidy ? 0 : 25000;
          }
        });

        const freshGapok = calculateGapok(freshEmployee, freshMatrix, targetDate);
        const edLevel = freshRaw.academic_and_tier?.education_level;
        const fTier = freshRaw.academic_and_tier?.functional_tier;
        const freshFunctionalAllowance = matchFunctionalAllowance(edLevel, fTier, freshFMatrix);

        const credit = Number(freshRaw.kepangkatan?.cummulativeCredit) || 0;
        const freshKepangkatanAllowance = freshKepMatrix[credit] || 0;

        const cat = isLoyalisTab ? freshEmployee.role : freshEmployee.raw.employment?.jobCategory;
        const freshUraianEntry = freshUraianMap[`${period}_${cat}`]?.entries?.[emp.id] ?? undefined;

        const freshEarnings = buildInitialEarnings(
          freshRaw,
          freshGapok,
          payrollCollar,
          freshUraianEntry,
          freshVakasiSum,
          freshVakasiList,
          freshFunctionalAllowance,
          freshKepangkatanAllowance,
          [],
          getFreshPresenceBonus(emp.id),
          getFreshPresensiEarning(emp.id)
        );

        const freshDeductions = buildInitialDeductions(
          freshRaw,
          payrollCollar,
          freshKoperasiDeduction,
          getFreshPresenceDeduction(emp.id),
          getFreshPresensiDeduction(emp.id),
          freshKoperasiSaving
        );

        // Get current slip state
        const currentSlip = freshSlipStates[emp.id];
        let currentEarnings: PaySlipField[] = [];
        let currentDeductions: PaySlipField[] = [];

        if (currentSlip && currentSlip.earnings && currentSlip.earnings.length > 0) {
          currentEarnings = currentSlip.earnings;
          currentDeductions = currentSlip.deductions || [];
        } else {
          const defaultFresh = buildFreshSlipData(emp);
          currentEarnings = defaultFresh.earnings;
          currentDeductions = defaultFresh.deductions;
        }

        const diffs: any[] = [];
        
        // Earnings comparison
        freshEarnings.forEach(f => {
          const cur = currentEarnings.find(c => c.label === f.label);
          if (!cur) {
            diffs.push({ type: 'earnings', label: f.label, oldValue: null, newValue: f.amount });
          } else if (cur.amount !== f.amount) {
            diffs.push({ type: 'earnings', label: f.label, oldValue: cur.amount, newValue: f.amount });
          }
        });
        currentEarnings.forEach(c => {
          const f = freshEarnings.find(fresh => fresh.label === c.label);
          if (!f) {
            diffs.push({ type: 'earnings', label: c.label, oldValue: c.amount, newValue: null });
          }
        });

        // Deductions comparison
        freshDeductions.forEach(f => {
          const cur = currentDeductions.find(c => c.label === f.label);
          if (!cur) {
            diffs.push({ type: 'deductions', label: f.label, oldValue: null, newValue: f.amount });
          } else if (cur.amount !== f.amount) {
            diffs.push({ type: 'deductions', label: f.label, oldValue: cur.amount, newValue: f.amount });
          }
        });
        currentDeductions.forEach(c => {
          const f = freshDeductions.find(fresh => fresh.label === c.label);
          if (!f) {
            diffs.push({ type: 'deductions', label: c.label, oldValue: c.amount, newValue: null });
          }
        });

        if (diffs.length > 0) {
          changes.push({
            employeeId: emp.id,
            employeeName: empName,
            isLocked: currentSlip?.status === 'locked',
            diffs,
            currentEarnings,
            currentDeductions,
            freshEarnings,
            freshDeductions
          });
        }
      }

      if (changes.length === 0) {
        alert("Semua draf slip gaji sudah sesuai dengan data terbaru di database.");
      } else {
        setBulkChanges(changes);
        setSelectedBulkRefreshEmployeeIds(new Set(changes.map(c => c.employeeId)));
        
        // Initialize fields selection state
        const initialFields: Record<string, Set<string>> = {};
        changes.forEach(change => {
          initialFields[change.employeeId] = new Set(change.diffs.map(d => `${d.type}::${d.label}`));
        });
        setSelectedBulkRefreshFields(initialFields);

        setBulkRefreshDialogOpen(true);
      }
    } catch (err) {
      console.error("Gagal memproses bulk refresh:", err);
      alert("Terjadi kesalahan saat memproses bulk refresh.");
    } finally {
      setRefreshingBulk(false);
    }
  };

  const handleToggleSelectEmployee = (employeeId: string) => {
    setSelectedBulkRefreshEmployeeIds(prev => {
      const next = new Set(prev);
      if (next.has(employeeId)) {
        next.delete(employeeId);
        setSelectedBulkRefreshFields(prevFields => ({
          ...prevFields,
          [employeeId]: new Set()
        }));
      } else {
        next.add(employeeId);
        const change = bulkChanges.find(c => c.employeeId === employeeId);
        const allFields = change ? new Set(change.diffs.map((d: any) => `${d.type}::${d.label}`)) : new Set<string>();
        setSelectedBulkRefreshFields(prevFields => ({
          ...prevFields,
          [employeeId]: allFields
        }));
      }
      return next;
    });
  };

  const handleToggleSelectAll = () => {
    setSelectedBulkRefreshEmployeeIds(prev => {
      if (prev.size === bulkChanges.length) {
        setSelectedBulkRefreshFields({});
        return new Set();
      } else {
        const allIds = new Set(bulkChanges.map(c => c.employeeId));
        const allFields: Record<string, Set<string>> = {};
        bulkChanges.forEach(change => {
          allFields[change.employeeId] = new Set(change.diffs.map((d: any) => `${d.type}::${d.label}`));
        });
        setSelectedBulkRefreshFields(allFields);
        return allIds;
      }
    });
  };

  const handleToggleSelectField = (employeeId: string, fieldKey: string) => {
    setSelectedBulkRefreshFields(prev => {
      const currentFields = new Set(prev[employeeId] || []);
      if (currentFields.has(fieldKey)) {
        currentFields.delete(fieldKey);
      } else {
        currentFields.add(fieldKey);
      }

      setSelectedBulkRefreshEmployeeIds(prevIds => {
        const nextIds = new Set(prevIds);
        if (currentFields.size > 0) {
          nextIds.add(employeeId);
        } else {
          nextIds.delete(employeeId);
        }
        return nextIds;
      });

      return {
        ...prev,
        [employeeId]: currentFields
      };
    });
  };

  const handleApplyBulkRefresh = async () => {
    if (attendancePeriodStatus === 'closed') {
      alert('Periode payroll sudah ditutup. Draf tidak dapat diubah.');
      return;
    }
    const selectedChanges = bulkChanges.filter(c =>
      selectedBulkRefreshEmployeeIds.has(c.employeeId) &&
      slipStates[c.employeeId]?.status === 'draft',
    );
    if (selectedChanges.length === 0) {
      alert("Tidak ada draf terpilih. Slip yang sudah diverifikasi/final tidak dapat direfresh.");
      return;
    }
    setRefreshingBulk(true);
    try {
      const period = `${targetDate.getFullYear()}_${String(targetDate.getMonth() + 1).padStart(2, '0')}`;
      const newSlipStates = { ...slipStates };

      for (const change of selectedChanges) {
        const checkedFields = selectedBulkRefreshFields[change.employeeId] || new Set();
        const mergedEarnings = [...change.currentEarnings];
        const mergedDeductions = [...change.currentDeductions];

        change.diffs.forEach((diff: any) => {
          const fieldKey = `${diff.type}::${diff.label}`;
          if (!checkedFields.has(fieldKey)) return;

          if (diff.type === 'earnings') {
            const idx = mergedEarnings.findIndex(e => e.label === diff.label);
            if (diff.newValue === null) {
              if (idx > -1) mergedEarnings.splice(idx, 1);
            } else {
              if (idx > -1) {
                mergedEarnings[idx] = { ...mergedEarnings[idx], amount: diff.newValue };
              } else {
                mergedEarnings.push({ label: diff.label, amount: diff.newValue });
              }
            }
          } else {
            const idx = mergedDeductions.findIndex(d => d.label === diff.label);
            if (diff.newValue === null) {
              if (idx > -1) mergedDeductions.splice(idx, 1);
            } else {
              if (idx > -1) {
                mergedDeductions[idx] = { ...mergedDeductions[idx], amount: diff.newValue };
              } else {
                mergedDeductions.push({ label: diff.label, amount: diff.newValue });
              }
            }
          }
        });

        await authenticatedJson('/api/payroll/slips', {
          method: 'POST',
          body: JSON.stringify({
            action: 'save_draft',
            employeeId: change.employeeId,
            period,
            requestId: createFinancialRequestId('bulk_refresh'),
            earnings: mergedEarnings,
            deductions: mergedDeductions,
          }),
        });
        newSlipStates[change.employeeId] = {
          status: 'draft',
          earnings: mergedEarnings,
          deductions: mergedDeductions,
          generatedAt: new Date().toISOString(),
          emailSent: slipStates[change.employeeId]?.emailSent || false,
          emailSentAt: slipStates[change.employeeId]?.emailSentAt || undefined,
        };
      }

      setSlipStates(newSlipStates);
      setBulkRefreshDialogOpen(false);
      setNotification({
        show: true,
        type: 'success',
        message: `Berhasil memperbarui ${selectedChanges.length} slip gaji dari database.`
      });
      setTimeout(() => {
        setNotification(prev => ({ ...prev, show: false }));
      }, 3000);
    } catch (err: any) {
      console.error("Gagal menerapkan bulk refresh:", err);
      alert("Gagal menyimpan perubahan bulk refresh ke database.");
    } finally {
      setRefreshingBulk(false);
    }
  };

  const handleSlipRefresh = async (employeeId: string): Promise<{ earnings: PaySlipField[]; deductions: PaySlipField[] }> => {
    const period = `${targetDate.getFullYear()}_${String(targetDate.getMonth() + 1).padStart(2, '0')}`;
    const periodToken = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}`;
    const isLoyalis = payrollCollar === 'loyalis';
    
    // 1. Fetch fresh employee data
    const empCol = isLoyalis ? 'Employees_Loyalis' : 'Employees_BlueCollar';
    const empSnap = await getDoc(doc(db, empCol, employeeId));
    if (!empSnap.exists()) {
      throw new Error("Data karyawan tidak ditemukan di Firestore.");
    }
    const freshRaw = { id: empSnap.id, ...empSnap.data() } as any;

    // Parse dates and extra fields like in initial load
    let freshJoinDate = isLoyalis
      ? (freshRaw.employment_profile?.date_of_hire?.toDate?.() || (freshRaw.employment_profile?.date_of_hire ? new Date(freshRaw.employment_profile.date_of_hire) : new Date()))
      : (freshRaw.employment?.startDate ? new Date(freshRaw.employment.startDate) : new Date());

    let freshDateRecognized = isLoyalis
      ? (freshRaw.employment_profile?.date_recognized?.toDate?.() || (freshRaw.employment_profile?.date_recognized ? new Date(freshRaw.employment_profile.date_recognized) : undefined))
      : undefined;

    let freshGradeLevel = isLoyalis
      ? (freshRaw.academic_and_tier?.level_code || '')
      : (freshRaw.salaryProfile?.salaryGradeCode || '');

    const freshEmployee: any = {
      id: freshRaw.id,
      name: isLoyalis ? (freshRaw.personal_info?.name || '') : (freshRaw.name || ''),
      role: isLoyalis ? (freshRaw.employment_profile?.department_unit || 'Staf') : (freshRaw.employment?.jobCategory || ''),
      gradeLevel: freshGradeLevel,
      joinDate: freshJoinDate,
      dateRecognized: freshDateRecognized,
      isActive: isLoyalis ? (freshRaw.personal_info?.status === 'AKTIF') : (freshRaw.flags?.isActive ?? true),
      email: isLoyalis ? (freshRaw.personal_info?.email || '') : (freshRaw.email || ''),
      phoneNumber: isLoyalis ? (freshRaw.personal_info?.phone || '') : (freshRaw.phoneNumber || ''),
      raw: freshRaw,
      rowIndex: 0
    };

    // 2. Fetch active Salary Matrix configs
    const matrixCollection = isLoyalis ? 'SalaryMatrix_WhiteCollar' : 'SalaryMatrix';
    let matrixConfigSnap = await getDoc(doc(db, matrixCollection, '_config'));
    let fConfigSnap = await getDoc(doc(db, 'SalaryMatrix_Functional', '_config'));
    let kepConfigSnap = await getDoc(doc(db, 'SalaryMatrix_Kepangkatan', '_config'));

    const activeMatrixVersion = matrixConfigSnap.exists() ? (matrixConfigSnap.data()?.activeVersion || '2026_v1') : '2026_v1';
    const activeFunctionalVersion = fConfigSnap.exists() ? (fConfigSnap.data()?.activeVersion || '2026_v1') : '2026_v1';
    const activeKepVersion = kepConfigSnap.exists() ? (kepConfigSnap.data()?.activeVersion || '2026_v1') : '2026_v1';

    // 3. Load matrix rows
    const [matrixSnap, fSnap, kepSnap] = await Promise.all([
      getDocs(collection(db, matrixCollection, activeMatrixVersion, 'rows')),
      getDocs(collection(db, 'SalaryMatrix_Functional', activeFunctionalVersion, 'rows')),
      getDocs(collection(db, 'SalaryMatrix_Kepangkatan', activeKepVersion, 'rows'))
    ]);

    // Process matrices
    const freshMatrix: any = {};
    matrixSnap.docs.forEach(d => {
      const data = d.data();
      const tahun = data.tahun;
      const salaries = data.salaries || {};
      Object.entries(salaries).forEach(([grade, amount]) => {
        if (!freshMatrix[grade]) freshMatrix[grade] = {};
        freshMatrix[grade][tahun] = amount as number;
      });
    });

    const freshFMatrix: Record<string, { base_value: number; functional_tiers: Record<string, number> }> = {};
    fSnap.docs.forEach(fDoc => {
      const data = fDoc.data();
      freshFMatrix[fDoc.id] = {
        base_value: data.base_value || 0,
        functional_tiers: data.functional_tiers || {},
      };
    });

    const freshKepMatrix: Record<number, number> = {};
    const freshKepDesignations: Record<number, string> = {};
    kepSnap.docs.forEach(d => {
      const data = d.data();
      const credit = Number(data.credit_score) || 0;
      const allowance = Number(data.allowance) || 0;
      freshKepMatrix[credit] = allowance;
      freshKepDesignations[credit] = data.designation || '';
    });
    setKepangkatanDesignations(freshKepDesignations);

    // 4. Fetch Presence data
    const presenceSnap = await getDoc(doc(db, 'LoyalisPresence', period));
    let freshPresenceData = presenceSnap.exists() ? presenceSnap.data() : null;
    setLoyalisPresenceData(freshPresenceData);

    // Presence calculations helpers
    const getFreshPresenceBonus = (empId: string): number => {
      if (freshPresenceData?.entries && Object.keys(freshPresenceData.entries).length > 0) {
        const entry = freshPresenceData.entries[empId];
        if (!entry) return 0;
      }
      return 250000;
    };

    const getFreshPresenceDeduction = (empId: string): number => {
      if (freshPresenceData?.entries && Object.keys(freshPresenceData.entries).length > 0) {
        const entry = freshPresenceData.entries[empId];
        if (entry) {
          return entry.deduction || 0;
        }
      }
      return 0;
    };

    const getFreshPresensiEarning = (empId: string): number => {
      const workingDays = freshPresenceData?.workingDays || 25;
      const expectedHours = freshPresenceData?.expectedHours || 6.5;
      if (freshPresenceData?.entries && Object.keys(freshPresenceData.entries).length > 0) {
        const entry = freshPresenceData.entries[empId];
        if (!entry) return 0;
      }
      return Math.round(workingDays * expectedHours * 1650);
    };

    const getFreshPresensiDeduction = (empId: string): number => {
      if (freshPresenceData?.entries && Object.keys(freshPresenceData.entries).length > 0) {
        const entry = freshPresenceData.entries[empId];
        if (entry) {
          const absenceMinutes = entry.absenceMinutes || 0;
          return Math.round((absenceMinutes / 60) * 1650);
        }
      }
      return 0;
    };

    // 5. Fetch VakasiTambahan
    const vakasiSnap = await getDocs(collection(db, 'VakasiTambahan'));
    let freshVakasiSum = 0;
    const freshVakasiList: { eventName: string; payGiven: number }[] = [];
    vakasiSnap.docs.forEach(d => {
      const data = d.data();
      if (data.period === periodToken && isPayableVakasiTambahan(data)) {
        const eventName = data.eventName || '';
        const worker = data.eventWorkers?.[employeeId];
        if (worker && worker.payGiven) {
          freshVakasiSum += worker.payGiven;
          freshVakasiList.push({ eventName, payGiven: worker.payGiven });
        }
      }
    });

    // 6. Fetch Cooperative Pinjam and Simpanan Wajib
    const [loanSnapshot, userSnapshot] = await Promise.all([
      getDocs(collection(secondaryDb, 'simpanPinjam')),
      getDocs(collection(secondaryDb, 'users'))
    ]);

    const empName = isLoyalis ? (freshRaw.personal_info?.name || '') : (freshRaw.name || '');

    let freshKoperasiDeduction = 0;
    const targetYear = targetDate.getFullYear();
    const targetMonth = targetDate.getMonth() + 1;
    const activeLoans = loanSnapshot.docs
      .map(d => d.data() as any)
      .filter(loan => {
        if ((loan.sisaHutang || 0) <= 0) return false;

        // 1. Verify that the latest history entry status is 'Disetujui dan Aktif'
        if (!loan.history || !Array.isArray(loan.history) || loan.history.length === 0) {
          return false;
        }
        const sortedHistory = [...loan.history].sort((a, b) => {
          const tA = (a.timestamp as any)?.toMillis ? (a.timestamp as any).toMillis() : (a.timestamp?.seconds ? a.timestamp.seconds * 1000 : 0);
          const tB = (b.timestamp as any)?.toMillis ? (b.timestamp as any).toMillis() : (b.timestamp?.seconds ? b.timestamp.seconds * 1000 : 0);
          return tB - tA; // Latest first
        });
        const latestEntry = sortedHistory[0];
        const isActiveStatus = loan.status === 'Disetujui dan Aktif' || (latestEntry && (latestEntry.status === 'Disetujui dan Aktif' || latestEntry.status === 'Pembayaran Cicilan'));
        if (!isActiveStatus) {
          return false;
        }

        // 2. Determine activation date from tanggalDisetujui, falling back to history entry timestamp
        let activationDate: Date | null = null;
        if (loan.tanggalDisetujui) {
          activationDate = (loan.tanggalDisetujui as any).toDate ? (loan.tanggalDisetujui as any).toDate() : (loan.tanggalDisetujui.seconds ? new Date(loan.tanggalDisetujui.seconds * 1000) : null);
        }
        if (!activationDate && latestEntry.timestamp) {
          activationDate = (latestEntry.timestamp as any).toDate ? (latestEntry.timestamp as any).toDate() : (latestEntry.timestamp.seconds ? new Date(latestEntry.timestamp.seconds * 1000) : null);
        }

        if (!activationDate) return false;

        const activationYear = activationDate.getFullYear();
        const activationMonth = activationDate.getMonth() + 1;

        // Deduction starts on or after the activation month and year
        if (targetYear < activationYear) return false;
        if (targetYear === activationYear && targetMonth < activationMonth) return false;

        return true;
      });
    activeLoans.forEach(loan => {
      const spName = loan.userData?.namaLengkap || '';
      const isUidMatch = freshRaw.koperasiAuthUid && freshRaw.koperasiAuthUid === loan.userId;
      const isNameMatch = empName && normalizeName(spName) === normalizeName(empName);
      const isOverrideMatch = empName && MANUAL_OVERRIDES[spName.trim()] === empName;

      if (isUidMatch || isNameMatch || isOverrideMatch) {
        const cicilan = Math.round(loan.jumlahPinjaman / loan.tenor);
        freshKoperasiDeduction += cicilan;
      }
    });

    let freshKoperasiSaving = 0;
    userSnapshot.docs.forEach(userDoc => {
      const uData = userDoc.data();
      const uName = uData.nama || '';
      const uUid = uData.uid || userDoc.id;

      const isUidMatch = (freshRaw.koperasiUserId && freshRaw.koperasiUserId === userDoc.id) || (freshRaw.koperasiAuthUid && freshRaw.koperasiAuthUid === uUid);
      const isNameMatch = empName && normalizeName(uName) === normalizeName(empName);
      const isOverrideMatch = empName && MANUAL_OVERRIDES[uName.trim()] === empName;

      if (isUidMatch || isNameMatch || isOverrideMatch) {
        const isApproved = uData.status === 'approved' || uData.membershipStatus === 'approved';
        if (!isApproved) return;

        const isYayasanSubsidy = uData.paymentStatus === 'Yayasan Subsidy';
        freshKoperasiSaving = isYayasanSubsidy ? 0 : 25000;
      }
    });

    // 7. Recalculate Gaji Pokok (Gapok), Fungsional, Kepangkatan
    const freshGapok = calculateGapok(freshEmployee, freshMatrix, targetDate);
    
    const edLevel = freshRaw.academic_and_tier?.education_level;
    const fTier = freshRaw.academic_and_tier?.functional_tier;
    const freshFunctionalAllowance = matchFunctionalAllowance(edLevel, fTier, freshFMatrix);

    const credit = Number(freshRaw.kepangkatan?.cummulativeCredit) || 0;
    const freshKepangkatanAllowance = freshKepMatrix[credit] || 0;

    // Fetch UraianEntry
    const cat = isLoyalis ? freshEmployee.role : freshEmployee.raw.employment?.jobCategory;
    const uraianDocId = `${period}_${cat}`;
    const uraianDocSnap = await getDoc(doc(db, 'UraianGaji', uraianDocId));
    const freshUraianEntry = uraianDocSnap.exists() ? (uraianDocSnap.data() as UraianGajiDocument)?.entries?.[employeeId] : undefined;

    // 8. Rebuild earnings and deductions lists
    const freshEarnings = buildInitialEarnings(
      freshRaw,
      freshGapok,
      payrollCollar,
      freshUraianEntry,
      freshVakasiSum,
      freshVakasiList,
      freshFunctionalAllowance,
      freshKepangkatanAllowance,
      [], // customColumns
      getFreshPresenceBonus(employeeId),
      getFreshPresensiEarning(employeeId)
    );

    const freshDeductions = buildInitialDeductions(
      freshRaw,
      payrollCollar,
      freshKoperasiDeduction,
      getFreshPresenceDeduction(employeeId),
      getFreshPresensiDeduction(employeeId),
      freshKoperasiSaving
    );

    return {
      earnings: freshEarnings,
      deductions: freshDeductions
    };
  };

  const prepareMissingPayrollDrafts = async (
    action: 'save_draft' | 'repair_missing_draft',
    startingStates: Record<string, SlipState>,
  ): Promise<{
    states: Record<string, SlipState>;
    failures: Array<{ name: string; message: string }>;
  }> => {
    const missingTargets = allPayrollTargets.filter(
      (target) => !startingStates[target.id],
    );
    const nextStates = { ...startingStates };
    const failures: Array<{ name: string; message: string }> = [];
    const period = `${targetDate.getFullYear()}_${String(
      targetDate.getMonth() + 1,
    ).padStart(2, '0')}`;
    let completed = 0;
    setBulkPayrollProgress({
      phase: 'preparing',
      completed,
      total: missingTargets.length,
    });

    await runWithConcurrency(missingTargets, 4, async (target) => {
      try {
        const draftData = buildPayrollTargetDraftData(target, startingStates);
        const result = await authenticatedJson<{
          koperasiPlan?: {
            loanCount: number;
            expectedDeduction: number;
            matchType: string;
            repairedDeduction?: number | null;
          };
        }>('/api/payroll/slips', {
          method: 'POST',
          body: JSON.stringify({
            action,
            employeeId: target.id,
            period,
            requestId: createFinancialRequestId(
              action === 'save_draft' ? 'prepare_draft' : 'repair_draft',
            ),
            reason: action === 'repair_missing_draft'
              ? 'Perbaikan draf payroll Juli 2026 yang hilang sebelum penguncian massal'
              : undefined,
            earnings: draftData.earnings,
            deductions: draftData.deductions,
          }),
        });
        const deductions = result.koperasiPlan
          ? replaceClientKoperasiDeduction(
              draftData.deductions,
              result.koperasiPlan.expectedDeduction,
            )
          : draftData.deductions;
        nextStates[target.id] = {
          status: 'draft',
          earnings: draftData.earnings,
          deductions,
          generatedAt: new Date().toISOString(),
        };
      } catch (error) {
        failures.push({
          name: target.name,
          message: error instanceof Error ? error.message : 'Operasi gagal',
        });
      } finally {
        completed += 1;
        setBulkPayrollProgress({
          phase: 'preparing',
          completed,
          total: missingTargets.length,
        });
      }
    });

    setSlipStates(nextStates);
    return { states: nextStates, failures };
  };

  const showPayrollFailures = (
    title: string,
    failures: Array<{ name: string; message: string }>,
  ) => {
    const visible = failures.slice(0, 20);
    alert(
      `${title}\n\n${visible.map((failure) => `• ${failure.name}: ${failure.message}`).join('\n')}${failures.length > visible.length ? `\n• …dan ${failures.length - visible.length} kegagalan lainnya.` : ''}`,
    );
  };

  const handlePrepareAllDrafts = async () => {
    if (attendancePeriodStatus === 'closed') {
      alert('Periode sudah ditutup; gunakan Verifikasi & Kunci untuk perbaikan transisi Juli 2026.');
      return;
    }
    if (missingPayrollDraftCount === 0) {
      alert('Seluruh pegawai payroll sudah memiliki draf. Periode siap ditutup.');
      return;
    }
    if (!window.confirm(
      `Siapkan ${missingPayrollDraftCount} draf yang belum ada? Draf yang sudah tersimpan tidak akan ditimpa.`,
    )) return;

    setPreparingAllDrafts(true);
    try {
      const result = await prepareMissingPayrollDrafts('save_draft', slipStates);
      if (result.failures.length > 0) {
        setNotification({
          show: true,
          type: 'error',
          message: `${result.failures.length} draf gagal disiapkan; periode belum boleh ditutup.`,
        });
        showPayrollFailures('Sebagian draf gagal disiapkan:', result.failures);
        return;
      }
      setNotification({
        show: true,
        type: 'success',
        message: `${missingPayrollDraftCount} draf berhasil disiapkan. Seluruh roster siap ditutup.`,
      });
    } finally {
      setPreparingAllDrafts(false);
      setBulkPayrollProgress(null);
    }
  };

  const handleBulkVerifyAndLock = async () => {
    if (attendancePeriodStatus !== 'closed') {
      alert('Tutup periode payroll sebelum memverifikasi dan mengunci slip.');
      return;
    }
    if (pendingPayrollLockCount === 0) {
      alert('Seluruh slip roster payroll sudah dikunci atau diproses untuk pembayaran.');
      return;
    }

    const period = `${targetDate.getFullYear()}_${String(
      targetDate.getMonth() + 1,
    ).padStart(2, '0')}`;
    if (missingPayrollDraftCount > 0 && period !== '2026_07') {
      alert(
        `${missingPayrollDraftCount} draf hilang pada periode tertutup. Sistem menolak pembuatan draf setelah penutupan; hubungi Super Admin untuk audit periode.`,
      );
      return;
    }
    const confirmMessage = missingPayrollDraftCount > 0
      ? `Roster berisi ${allPayrollTargets.length} pegawai. Sistem akan memperbaiki ${missingPayrollDraftCount} draf Juli 2026 yang hilang, menyegel roster, lalu memverifikasi dan mengunci seluruh slip. Lanjutkan?`
      : `Verifikasi angka dan kunci seluruh ${allPayrollTargets.filter((target) => slipStates[target.id]?.status === 'draft').length} slip draf pada roster payroll? Tindakan ini tidak dapat dibatalkan.`;
    if (!window.confirm(confirmMessage)) return;

    setConfirmingBulk(true);
    try {
      let workingStates = { ...slipStates };
      if (missingPayrollDraftCount > 0) {
        const repair = await prepareMissingPayrollDrafts(
          'repair_missing_draft',
          workingStates,
        );
        workingStates = repair.states;
        if (repair.failures.length > 0) {
          setNotification({
            show: true,
            type: 'error',
            message: `${repair.failures.length} draf gagal diperbaiki. Tidak ada slip yang dikunci.`,
          });
          showPayrollFailures(
            'Perbaikan roster belum lengkap; tidak ada slip yang dikunci:',
            repair.failures,
          );
          return;
        }
      }

      setBulkPayrollProgress({ phase: 'sealing', completed: 0, total: 1 });
      await authenticatedJson('/api/payroll/periods', {
        method: 'POST',
        body: JSON.stringify({
          period: period.replace('_', '-'),
          attendanceStatus: 'closed',
          reason: 'Penyegelan roster lengkap sebelum Verifikasi & Kunci massal',
        }),
      });
      setBulkPayrollProgress({ phase: 'sealing', completed: 1, total: 1 });

      const unlockableTargets = allPayrollTargets.filter(
        (target) => workingStates[target.id]?.status === 'draft',
      );
      const updatedSlips: Record<string, SlipState> = {};
      const failures: Array<{ name: string; message: string }> = [];
      let progressedLoans = 0;
      let paidOffLoans = 0;
      const nowStr = new Date().toISOString();
      let completed = 0;
      setBulkPayrollProgress({
        phase: 'locking',
        completed,
        total: unlockableTargets.length,
      });

      // Koperasi application is deliberately sequential. Each employee is a
      // resumable saga and a failure must leave only that employee as draft.
      for (const target of unlockableTargets) {
        const prevSlip = workingStates[target.id];
        try {
          const result = await authenticatedJson<VerifyAndLockResponse>('/api/payroll/slips', {
            method: 'POST',
            body: JSON.stringify({
              action: 'verify_and_lock',
              employeeId: target.id,
              period,
              requestId: createFinancialRequestId('bulk_verify_lock'),
              reason: 'Verifikasi angka dan penguncian final seluruh roster oleh Badan Keuangan',
            }),
          });
          progressedLoans += result.koperasi.loans.filter(
            (loan) => loan.outcome !== 'already_applied',
          ).length;
          paidOffLoans += result.koperasi.loans.filter(
            (loan) => loan.outcome === 'paid_off',
          ).length;
          updatedSlips[target.id] = {
            ...prevSlip,
            status: 'locked',
            verifiedAt: nowStr,
            verifiedBy: user?.uid,
            lockedAt: nowStr,
            lockedBy: user?.uid,
          };
        } catch (error) {
          failures.push({
            name: target.name,
            message: error instanceof Error ? error.message : 'Operasi gagal',
          });
        } finally {
          completed += 1;
          setBulkPayrollProgress({
            phase: 'locking',
            completed,
            total: unlockableTargets.length,
          });
        }
      }

      setSlipStates((previous) => ({ ...previous, ...updatedSlips }));
      setNotification({
        show: true,
        type: failures.length > 0 ? 'error' : 'success',
        message: `${Object.keys(updatedSlips).length} slip dikunci; ${progressedLoans} cicilan Koperasi diproses${paidOffLoans > 0 ? `; ${paidOffLoans} pinjaman lunas` : ''}${failures.length > 0 ? `; ${failures.length} slip gagal dan tetap draf` : ''}.`,
      });
      if (failures.length > 0) {
        showPayrollFailures('Sebagian Verifikasi & Kunci gagal:', failures);
      }
    } catch (err: unknown) {
      console.error('Error bulk verify-and-lock:', err);
      alert(`Gagal melakukan verifikasi dan penguncian massal: ${err instanceof Error ? err.message : 'Terjadi kesalahan sistem'}`);
    } finally {
      setConfirmingBulk(false);
      setBulkPayrollProgress(null);
    }
  };

  // ─── Stats ─────────────────────────────────────────────────────

  const totalSlips = displayEmployees.filter(emp => slipStates[emp.id]).length;
  const lockedSlips = displayEmployees.filter(emp =>
    isTransferEligibleStatus(slipStates[emp.id]?.status),
  ).length;

  const payrollPeriod = getPayrollPeriod(targetDate);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/80 to-slate-100 p-8 font-sans selection:bg-indigo-100 relative overflow-hidden text-slate-800">
      {/* Subtle decorative blobs */}
      <div className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full bg-indigo-100/40 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] rounded-full bg-purple-100/30 blur-[100px] pointer-events-none" />
      <div className="max-w-7xl mx-auto relative z-10">
        {/* Header Section */}
        <GlobalHeader />

        {/* Main Card */}
        <Card className="bg-white rounded-[20px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-none overflow-hidden">
          <div className="p-8 pb-0">
            {/* Title & Info */}
            <div className="flex justify-between items-start mb-6">
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex items-center gap-3 filter drop-shadow-sm">
                    <img
                      src="/Logo YAPETIDU (Transparent bg).png"
                      alt="Logo YAPETIDU"
                      className="h-10 w-auto object-contain hover:scale-105 transition-transform duration-300 cursor-pointer"
                    />
                    <div className="w-px h-6 bg-slate-200" />
                    <img
                      src="/Logo UNIPDU.png"
                      alt="Logo UNIPDU"
                      className="h-10 w-auto object-contain hover:scale-105 transition-transform duration-300 cursor-pointer"
                    />
                  </div>
                  <h1 className="text-2xl font-bold tracking-tight ml-2">BAK UNIPDU Payroll</h1>
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500 mt-1"></div>
                </div>

                {/* Filter Controls */}
                <div className="flex flex-wrap items-center gap-4 mb-6">
                  {/* Collar Switch Toggle */}
                  <div className="flex bg-slate-100 p-1 rounded-xl">
                    <button
                      onClick={() => setPayrollCollar('blue')}
                      className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${payrollCollar === 'blue'
                        ? 'bg-white text-indigo-600 shadow-sm font-bold'
                        : 'text-slate-500 hover:text-slate-700'
                        }`}
                    >
                      Pekarya
                    </button>
                    <button
                      onClick={() => setPayrollCollar('loyalis')}
                      className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${payrollCollar === 'loyalis'
                        ? 'bg-white text-indigo-600 shadow-sm font-bold'
                        : 'text-slate-500 hover:text-slate-700'
                        }`}
                    >
                      Loyalis
                    </button>
                  </div>


                  <select
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    className="bg-white border border-slate-200 text-slate-600 text-xs font-semibold rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all cursor-pointer shadow-sm"
                  >
                    <option value="all">Semua Kategori</option>
                    {categories.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>

                  {/* Search Bar Input */}
                  <div className="relative flex-1">
                    <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                      <Search className="w-4 h-4" />
                    </span>
                    <input
                      type="text"
                      placeholder="Cari nama atau ID pegawai..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full bg-white border border-slate-200 text-slate-700 placeholder:text-slate-400 text-xs font-semibold rounded-xl pl-10 pr-4 py-2.5 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 transition-all shadow-sm"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap gap-6 text-sm">
                  <div>
                    <span className="text-slate-500 block mb-1">Periode Payroll</span>
                    <input
                      type="month"
                      value={`${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}`}
                      onChange={(e) => {
                        if (e.target.value) {
                          const [y, m] = e.target.value.split('-');
                          setTargetDate(new Date(Number(y), Number(m) - 1, 1));
                        }
                      }}
                      className="bg-white border border-slate-200 text-slate-700 text-sm font-semibold rounded-xl px-3 py-1 outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all cursor-pointer mt-0.5"
                    />
                  </div>
                  <div>
                    <span className="text-slate-500 block mb-1">Cutoff Kehadiran</span>
                    <div className="flex items-center gap-2">
                      {/* Periods collect input by default; only a permanent
                          closure ends them, so there is no "not configured"
                          state for an operator to act on any more. */}
                      <Badge
                        variant="outline"
                        className={
                          attendancePeriodStatus === 'closed'
                            ? 'border-rose-200 bg-rose-50 text-rose-700'
                            : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        }
                      >
                        {attendancePeriodStatus === 'closed' ? 'DITUTUP' : 'DIBUKA'}
                      </Badge>
                      {(profile?.role === 'super_admin' || profile?.role === 'finance_verifier') &&
                        attendancePeriodStatus !== 'closed' && (
                          <Button
                            type="button"
                            variant="outline"
                            className="h-7 rounded-lg px-2 text-[11px]"
                            onClick={() => handleSetAttendancePeriod('closed')}
                            disabled={preparingAllDrafts || missingPayrollDraftCount > 0}
                          >
                            Tutup Permanen
                          </Button>
                        )}
                      {profile?.role === 'super_admin' &&
                        attendancePeriodStatus !== 'closed' && (
                          <Button
                            type="button"
                            variant="outline"
                            className="h-7 rounded-lg px-2 text-[11px]"
                            onClick={() => void handleOpenCalendarEditor()}
                            disabled={isSubmittingModal}
                          >
                            <CalendarDays className="mr-1 h-3.5 w-3.5" />
                            Tanggal Merah Periode
                          </Button>
                        )}
                    </div>
                  </div>
                  <div>
                    <span className="text-slate-500 block mb-1">Total Karyawan</span>
                    <span className="font-medium">{loading ? '...' : displayEmployees.length}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block mb-1">Terkunci</span>
                    <span className="font-medium text-emerald-600">{lockedSlips} / {displayEmployees.length}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block mb-1">Total Pendapatan</span>
                    <span className="font-medium text-emerald-600">
                      {loading ? '...' : formatIDR(payrollTotals.totalGross)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block mb-1">Total Potongan</span>
                    <span className="font-medium text-rose-600">
                      {loading ? '...' : formatIDR(payrollTotals.totalDeductions)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block mb-1">Total Gaji Bersih</span>
                    <span className="font-bold text-indigo-600">
                      {loading ? '...' : formatIDR(payrollTotals.totalNet)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Table Section */}
          <div className="p-0">
            <div className="px-8 py-4 flex flex-wrap justify-between items-center gap-4 border-b border-slate-100">
              <span className="font-semibold text-lg">Validasi Gaji</span>
              <div className="flex items-center gap-3">
                {attendancePeriodStatus !== 'closed' && (
                  <button
                    type="button"
                    onClick={handlePrepareAllDrafts}
                    disabled={preparingAllDrafts || loading || missingPayrollDraftCount === 0}
                    className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-xl border border-amber-200 text-amber-700 bg-amber-50 hover:bg-amber-100 hover:shadow-sm transition-all duration-150 cursor-pointer shadow-sm ${(preparingAllDrafts || loading || missingPayrollDraftCount === 0) ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {preparingAllDrafts ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin text-amber-600" />
                        Menyiapkan ({bulkPayrollProgress?.completed || 0}/{bulkPayrollProgress?.total || missingPayrollDraftCount})
                      </>
                    ) : (
                      <>
                        <FileText className="w-4 h-4 text-amber-600" />
                        Siapkan Semua Draf ({missingPayrollDraftCount})
                      </>
                    )}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleBulkVerifyAndLock}
                  disabled={confirmingBulk || loading || attendancePeriodStatus !== 'closed'}
                  className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-xl border border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 hover:shadow-sm transition-all duration-150 cursor-pointer shadow-sm ${(confirmingBulk || loading || attendancePeriodStatus !== 'closed') ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {confirmingBulk ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
                      {bulkPayrollProgress?.phase === 'preparing'
                        ? `Memperbaiki draf (${bulkPayrollProgress.completed}/${bulkPayrollProgress.total})`
                        : bulkPayrollProgress?.phase === 'sealing'
                          ? 'Menyegel roster...'
                          : bulkPayrollProgress?.phase === 'locking'
                            ? `Mengunci (${bulkPayrollProgress.completed}/${bulkPayrollProgress.total})`
                            : 'Memproses seluruh roster...'}
                    </>
                  ) : (
                    <>
                      <CheckCheck className="w-4 h-4 text-emerald-600" />
                      Verifikasi &amp; Kunci Semua ({pendingPayrollLockCount})
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleBulkRefresh}
                  disabled={refreshingBulk || loading || attendancePeriodStatus === 'closed'}
                  className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-xl border border-indigo-200 text-indigo-600 bg-indigo-50 hover:bg-indigo-100 hover:shadow-sm transition-all duration-150 cursor-pointer shadow-sm ${(refreshingBulk || loading || attendancePeriodStatus === 'closed') ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {refreshingBulk ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
                      Memproses...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-4 h-4 text-indigo-500" />
                      Refresh Semua
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleBulkEmail}
                  disabled={loading}
                  title={isBulkEmailActive ? 'Pengiriman sedang berjalan — klik untuk melihat detail' : undefined}
                  className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-xl border border-indigo-200 text-indigo-600 bg-indigo-50 hover:bg-indigo-100 hover:shadow-sm transition-all duration-150 cursor-pointer shadow-sm ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {isBulkEmailPaused ? (
                    <>
                      <Pause className="w-4 h-4 text-amber-500" />
                      Dijeda ({bulkEmailProgress}/{emailTargetCount})
                    </>
                  ) : sendingBulkEmail ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
                      Mengirim... ({bulkEmailProgress}/{emailTargetCount})
                    </>
                  ) : (
                    <>
                      <Mail className="w-4 h-4 text-indigo-500" />
                      Kirim Email ke Semua
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setPrintSelectorOpen(true)}
                  disabled={loading}
                  className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-xl border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 hover:shadow-sm transition-all duration-150 cursor-pointer shadow-sm ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <Printer className="w-4 h-4 text-slate-500" />
                  Cetak Dokumen
                </button>
                <button
                  type="button"
                  onClick={handleExportExcel}
                  disabled={loading}
                  className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-xl border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 hover:shadow-sm transition-all duration-150 cursor-pointer shadow-sm ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <FileSpreadsheet className="w-4 h-4 text-emerald-500" />
                  Ekspor Excel
                </button>
              </div>
            </div>
            {loading ? (
              <div className="p-20 flex flex-col items-center justify-center text-slate-400">
                <Loader2 className="w-8 h-8 animate-spin mb-4 text-indigo-500" />
                <p>Memuat data karyawan...</p>
              </div>
            ) : employees.length === 0 ? (
              <div className="p-20 flex flex-col items-center justify-center text-slate-400">
                <Users className="w-12 h-12 mb-4 opacity-20" />
                <p>Belum ada data karyawan.</p>
              </div>
            ) : (
              <Table>
                <TableHeader className="bg-slate-50/50">
                  <TableRow className="border-slate-100">
                    <TableHead className="font-medium text-slate-500 pl-8 cursor-pointer hover:text-indigo-600 transition-colors w-[320px]" onClick={() => handleSort('name')}>
                      <div className="flex items-center gap-1">
                        Nama Karyawan
                        <SortIcon active={sortConfig.key === 'name'} direction={sortConfig.direction} />
                      </div>
                    </TableHead>
                    <TableHead className="font-medium text-slate-500 cursor-pointer hover:text-indigo-600 transition-colors w-[320px]" onClick={() => handleSort('role')}>
                      <div className="flex items-center gap-1">
                        Jabatan / Golongan
                        <SortIcon active={sortConfig.key === 'role'} direction={sortConfig.direction} />
                      </div>
                    </TableHead>
                    <TableHead className="font-medium text-slate-500 cursor-pointer hover:text-indigo-600 transition-colors whitespace-nowrap" onClick={() => handleSort('earnings')}>
                      <div className="flex items-center gap-1">
                        Pendapatan
                        <SortIcon active={sortConfig.key === 'earnings'} direction={sortConfig.direction} />
                      </div>
                    </TableHead>
                    <TableHead className="font-medium text-slate-500 cursor-pointer hover:text-indigo-600 transition-colors whitespace-nowrap" onClick={() => handleSort('deductions')}>
                      <div className="flex items-center gap-1">
                        Potongan
                        <SortIcon active={sortConfig.key === 'deductions'} direction={sortConfig.direction} />
                      </div>
                    </TableHead>
                    <TableHead className="font-medium text-slate-500 cursor-pointer hover:text-indigo-600 transition-colors whitespace-nowrap" onClick={() => handleSort('net')}>
                      <div className="flex items-center gap-1">
                        Gaji Bersih
                        <SortIcon active={sortConfig.key === 'net'} direction={sortConfig.direction} />
                      </div>
                    </TableHead>
                    <TableHead className="font-medium text-slate-500 text-right pr-8">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayEmployees.map((emp) => {
                    const years = calculateYearsOfService(emp.joinDate, targetDate);
                    const gapok = calculateGapok(emp, salaryMatrix, targetDate);
                    const slip = slipStates[emp.id];
                    const emailSentInQueue = bulkEmailResults.find(r => r.employeeId === emp.id)?.status === 'success';
                    const isEmailSent = slip?.emailSent || emailSentInQueue;

                    const freshData = buildFreshSlipData(emp);
                    const totalEarnings = freshData.earnings.reduce((sum, e) => sum + e.amount, 0);
                    const totalDeductions = freshData.deductions.reduce((sum, d) => sum + d.amount, 0);
                    const netSalary = totalEarnings - totalDeductions;

                    return (
                      <TableRow 
                        key={emp.id} 
                        className={`border-slate-100 transition-colors ${
                          slip && isTransferEligibleStatus(slip.status)
                            ? 'bg-emerald-50 hover:bg-emerald-100/60' 
                            : 'hover:bg-slate-50/50'
                        }`}
                      >
                        <TableCell className="font-medium pl-8 py-4 w-[320px] max-w-[320px]">
                          <div className="flex items-center gap-2">
                            {isEmailSent && (
                              <span 
                                className="w-2.5 h-2.5 rounded-full bg-emerald-500 flex-shrink-0 animate-pulse" 
                                title={slip?.emailSentAt ? `Email slip gaji terkirim pada: ${new Date(slip.emailSentAt).toLocaleString('id-ID')}` : 'Email slip gaji terkirim'}
                              />
                            )}
                            <span className="block truncate" title={emp.name}>{emp.name}</span>
                          </div>
                        </TableCell>
                        <TableCell className="py-4 w-[320px] max-w-[320px]">
                          <div className="flex flex-col">
                            <div className="flex items-center gap-2">
                              <span className="block truncate max-w-[280px]" title={emp.role}>{emp.role}</span>
                              {!emp.isActive && (
                                <Badge variant="secondary" className="bg-slate-100 text-slate-500 text-[10px] h-4 px-1.5 font-normal uppercase shrink-0">
                                  Keluar
                                </Badge>
                              )}
                            </div>
                            <span className="text-xs text-slate-500 truncate max-w-[300px]" title={`Golongan ${emp.gradeLevel}`}>Golongan {emp.gradeLevel}</span>
                          </div>
                        </TableCell>
                        <TableCell className="py-4 text-slate-600">
                          {formatIDR(totalEarnings)}
                        </TableCell>
                        <TableCell className="py-4 text-slate-600">
                          {formatIDR(totalDeductions)}
                        </TableCell>
                        <TableCell className="py-4 font-bold text-indigo-700">
                          {formatIDR(netSalary)}
                        </TableCell>
                        <TableCell className="text-right pr-8 py-4">
                          <div className="flex justify-end gap-2 items-center">
                            <button
                              id={`edit-${emp.id}`}
                              onClick={() => openEditDialog(emp)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold
                                bg-amber-50 text-amber-600 border border-amber-200
                                hover:bg-amber-100 hover:border-amber-300 hover:shadow-sm
                                transition-all duration-150 cursor-pointer shadow-sm"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                              Edit
                            </button>
                            
                            <button
                              id={`cetak-kirim-${emp.id}`}
                              disabled={!slip || !isTransferEligibleStatus(slip.status)}
                              onClick={() => {
                                setSelectedEmployee(emp);
                                setCetakKirimOpen(true);
                              }}
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border
                                transition-all duration-150 cursor-pointer shadow-sm
                                ${slip && isTransferEligibleStatus(slip.status)
                                  ? 'bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-100 hover:border-emerald-300 hover:shadow-sm'
                                  : 'bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed opacity-60'}`}
                            >
                              <Share2 className="w-3.5 h-3.5" />
                              Cetak/Kirim
                            </button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        </Card>
      </div>

      {/* ─── Pay Slip Dialog ─────────────────────────────────────── */}
      <PaySlipDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        employee={selectedEmployee?.raw ?? null}
        employeeNo={selectedEmployee?.rowIndex ?? 0}
        gapok={selectedEmployee ? calculateGapok(selectedEmployee, salaryMatrix, targetDate) : 0}
        period={payrollPeriod}
        periodClosed={attendancePeriodStatus === 'closed'}
        slipState={selectedEmployee ? slipStates[selectedEmployee.id] ?? null : null}
        onSave={handleSlipSave}
        onVerifyAndLock={handleSlipVerifyAndLock}
        onCreatePayment={handleCreatePayment}
        onMarkPaid={handleMarkPaid}
        onRequestCorrection={handleSlipCorrectionRequest}
        onRefresh={handleSlipRefresh}
        actorRole={profile?.role}
        activeTab={payrollCollar}
        uraianEntry={(() => {
          if (!selectedEmployee) return undefined;
          const cat = payrollCollar === 'loyalis' ? selectedEmployee.role : selectedEmployee.raw.employment?.jobCategory;
          const period = `${targetDate.getFullYear()}_${String(targetDate.getMonth() + 1).padStart(2, '0')}`;
          const uraianDoc = uraianMap[`${period}_${cat}`];
          return uraianDoc?.entries?.[selectedEmployee.id] ?? undefined;
        })()}
        vakasiTambahanSum={selectedEmployee ? vakasiTambahanMap[selectedEmployee.id] ?? 0 : 0}
        vakasiTambahanList={selectedEmployee ? vakasiTambahanListMap[selectedEmployee.id] ?? [] : []}
        tunjanganFungsional={selectedEmployee ? functionalAllowanceMap[selectedEmployee.id] ?? 0 : 0}
        tunjanganKepangkatan={selectedEmployee ? kepangkatanAllowanceMap[selectedEmployee.id] ?? 0 : 0}
        customColumns={(() => {
          if (!selectedEmployee) return undefined;
          const cat = payrollCollar === 'loyalis' ? selectedEmployee.role : selectedEmployee.raw.employment?.jobCategory;
          const period = `${targetDate.getFullYear()}_${String(targetDate.getMonth() + 1).padStart(2, '0')}`;
          const uraianDoc = uraianMap[`${period}_${cat}`];
          return uraianDoc?.customColumns ?? undefined;
        })()}
        koperasiDeduction={selectedEmployee ? koperasiDeductions[selectedEmployee.id] || 0 : 0}
        koperasiSaving={selectedEmployee ? koperasiSavings[selectedEmployee.id] || 0 : 0}
        presenceBonus={selectedEmployee ? getLoyalisPresenceBonus(selectedEmployee.id) : 0}
        presenceDeduction={selectedEmployee ? getLoyalisPresenceDeduction(selectedEmployee.id) : 0}
        presensiEarning={selectedEmployee ? getLoyalisPresensiEarning(selectedEmployee.id) : 0}
        presensiDeduction={selectedEmployee ? getLoyalisPresensiDeduction(selectedEmployee.id) : 0}
      />

      <LegalitasPimpinanDialog
        open={legalitasDialogOpen}
        onOpenChange={setLegalitasDialogOpen}
        employees={employees}
        categories={categories}
        salaryMatrix={salaryMatrix}
        targetDate={targetDate}
        uraianMap={uraianMap}
        periodName={payrollPeriod}
        vakasiTambahanMap={vakasiTambahanMap}
        functionalAllowanceMap={functionalAllowanceMap}
        kepangkatanAllowanceMap={kepangkatanAllowanceMap}
        slipStates={slipStates}
        koperasiDeductions={koperasiDeductions}
        koperasiSavings={koperasiSavings}
        getLoyalisPresenceBonus={getLoyalisPresenceBonus}
        getLoyalisPresenceDeduction={getLoyalisPresenceDeduction}
        getLoyalisPresensiEarning={getLoyalisPresensiEarning}
        getLoyalisPresensiDeduction={getLoyalisPresensiDeduction}
      />

      <CetakPayrollDialog
        open={cetakPayrollDialogOpen}
        onOpenChange={setCetakPayrollDialogOpen}
        employees={employees}
        salaryMatrix={salaryMatrix}
        targetDate={targetDate}
        uraianMap={uraianMap}
        periodName={payrollPeriod}
        onPrintPdf={handlePrintPayrollStatement}
        vakasiTambahanMap={vakasiTambahanMap}
        functionalAllowanceMap={functionalAllowanceMap}
        kepangkatanAllowanceMap={kepangkatanAllowanceMap}
        slipStates={slipStates}
        koperasiDeductions={koperasiDeductions}
        koperasiSavings={koperasiSavings}
        getLoyalisPresenceBonus={getLoyalisPresenceBonus}
        getLoyalisPresenceDeduction={getLoyalisPresenceDeduction}
        getLoyalisPresensiEarning={getLoyalisPresensiEarning}
        getLoyalisPresensiDeduction={getLoyalisPresensiDeduction}
        isSuperAdmin={profile?.role === 'super_admin'}
        getFreshSlipData={buildFreshSlipData}
      />

      <CetakRekapDialog
        open={cetakRekapDialogOpen}
        onOpenChange={setCetakRekapDialogOpen}
        periodName={payrollPeriod}
        onPrintPdf={() => handlePrintRekap('pdf')}
        onExportXlsx={() => handlePrintRekap('xlsx')}
      />

      <CetakTunjanganJabatanDialog
        open={tunjanganJabatanDialogOpen}
        onOpenChange={setTunjanganJabatanDialogOpen}
        employees={employees}
        categories={categories}
        periodName={payrollPeriod}
        slipStates={slipStates}
      />

      <CetakVakasiPimpinanStafDialog
        open={vakasiPimpinanStafDialogOpen}
        onOpenChange={setVakasiPimpinanStafDialogOpen}
        employees={employees}
        categories={categories}
        periodName={payrollPeriod}
        salaryMatrix={salaryMatrix}
        targetDate={targetDate}
        functionalAllowanceMap={functionalAllowanceMap}
        kepangkatanAllowanceMap={kepangkatanAllowanceMap}
        getLoyalisPresenceBonus={getLoyalisPresenceBonus}
        getLoyalisPresenceDeduction={getLoyalisPresenceDeduction}
        getLoyalisPresensiEarning={getLoyalisPresensiEarning}
        getLoyalisPresensiDeduction={getLoyalisPresensiDeduction}
        loyalisPresenceData={loyalisPresenceData}
        slipStates={slipStates}
      />

      <CetakVakasiLainLainDialog
        open={vakasiLainLainDialogOpen}
        onOpenChange={setVakasiLainLainDialogOpen}
        employees={employees}
        categories={categories}
        periodName={payrollPeriod}
        vakasiTambahanListMap={vakasiTambahanListMap}
        slipStates={slipStates}
      />

      <CetakPotonganGajiDialog
        open={potonganGajiDialogOpen}
        onOpenChange={setPotonganGajiDialogOpen}
        employees={employees}
        categories={categories}
        periodName={payrollPeriod}
        slipStates={slipStates}
        koperasiDeductions={koperasiDeductions}
        koperasiSavings={koperasiSavings}
        getLoyalisPresenceDeduction={getLoyalisPresenceDeduction}
        getLoyalisPresensiDeduction={getLoyalisPresensiDeduction}
        isLoyalis={payrollCollar === 'loyalis'}
      />

      <CetakGabunganDialog
        open={gabunganDialogOpen}
        onOpenChange={setGabunganDialogOpen}
        employees={employees}
        categories={categories}
        periodName={payrollPeriod}
        salaryMatrix={salaryMatrix}
        targetDate={targetDate}
        functionalAllowanceMap={functionalAllowanceMap}
        kepangkatanAllowanceMap={kepangkatanAllowanceMap}
        getLoyalisPresenceBonus={getLoyalisPresenceBonus}
        getLoyalisPresenceDeduction={getLoyalisPresenceDeduction}
        getLoyalisPresensiEarning={getLoyalisPresensiEarning}
        getLoyalisPresensiDeduction={getLoyalisPresensiDeduction}
        loyalisPresenceData={loyalisPresenceData}
        vakasiTambahanListMap={vakasiTambahanListMap}
        slipStates={slipStates}
        koperasiDeductions={koperasiDeductions}
        koperasiSavings={koperasiSavings}
      />

      <CetakKebutuhanDanaGajiDialog
        open={cetakKebutuhanDanaGajiDialogOpen}
        onOpenChange={setCetakKebutuhanDanaGajiDialogOpen}
        periodName={payrollPeriod}
        onPrintPdf={handleExportKebutuhanDanaGajiPdf}
        onExportXlsx={handleExportKebutuhanDanaGaji}
      />

      {/* ─── Print Selection Dialog ─────────────────────────────────── */}
      <Dialog open={printSelectorOpen} onOpenChange={setPrintSelectorOpen}>
        <DialogContent className="sm:max-w-[760px] p-6 rounded-2xl bg-white border border-slate-100 shadow-[0_20px_50px_rgba(0,0,0,0.1)]">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold tracking-tight text-slate-900 flex items-center justify-between gap-2.5 w-full">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-indigo-50 text-indigo-600">
                  <Printer className="w-5 h-5" />
                </div>
                Cetak Dokumen Payroll
              </div>
              <Badge className={payrollCollar === 'loyalis' ? "bg-indigo-600 hover:bg-indigo-600 text-white rounded-lg px-2.5 py-0.5" : "bg-amber-500 hover:bg-amber-500 text-white rounded-lg px-2.5 py-0.5"}>
                {payrollCollar === 'loyalis' ? 'Loyalis' : 'Pekarya'}
              </Badge>
            </DialogTitle>
            <DialogDescription className="text-slate-500 mt-2 text-sm">
              Pilih format dokumen payroll yang ingin Anda cetak atau unduh untuk kelompok <span className="font-bold text-slate-700">{payrollCollar === 'loyalis' ? 'Loyalis' : 'Pekarya'}</span> periode <span className="font-semibold text-slate-700">{payrollPeriod}</span>.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 mt-4">
            {/* Card 1: Cetak Legalitas Pimpinan */}
            {payrollCollar !== 'loyalis' && (
              <button
                onClick={() => {
                  setPrintSelectorOpen(false);
                  setLegalitasDialogOpen(true);
                }}
                className="group flex items-start gap-4 p-4 rounded-2xl border border-slate-100 bg-slate-50/40 hover:bg-indigo-50/30 hover:border-indigo-100 transition-all duration-200 text-left outline-none cursor-pointer"
              >
                <div className="flex-shrink-0 p-3 rounded-xl bg-indigo-50 text-indigo-600 group-hover:bg-indigo-100/70 transition-colors">
                  <Award className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-slate-800 text-[15px] group-hover:text-indigo-900 transition-colors">
                    Legalitas Pimpinan
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                    Cetak slip validasi pimpinan untuk pengesahan resmi.
                  </p>
                </div>
                <div className="flex-shrink-0 self-center pl-2">
                  <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-indigo-500 group-hover:translate-x-1 transition-all duration-200" />
                </div>
              </button>
            )}

            {/* Card 2: Cetak Rekap Gaji */}
            <button
              onClick={() => {
                setPrintSelectorOpen(false);
                setCetakRekapDialogOpen(true);
              }}
              className="group flex items-start gap-4 p-4 rounded-2xl border border-slate-100 bg-slate-50/40 hover:bg-emerald-50/30 hover:border-emerald-100 transition-all duration-200 text-left outline-none cursor-pointer"
            >
              <div className="flex-shrink-0 p-3 rounded-xl bg-emerald-50 text-emerald-600 group-hover:bg-emerald-100/70 transition-colors">
                <FileSpreadsheet className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-slate-800 text-[15px] group-hover:text-emerald-900 transition-colors">
                  Rekapitulasi Gaji
                </h3>
                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                  Unduh laporan rekap total berdasarkan masing-masing divisi.
                </p>
              </div>
              <div className="flex-shrink-0 self-center pl-2">
                <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-emerald-500 group-hover:translate-x-1 transition-all duration-200" />
              </div>
            </button>

            {/* Card 3: Cetak Payroll Statement */}
            <button
              onClick={() => {
                setPrintSelectorOpen(false);
                setCetakPayrollDialogOpen(true);
              }}
              className="group flex items-start gap-4 p-4 rounded-2xl border border-slate-100 bg-slate-50/40 hover:bg-amber-50/30 hover:border-amber-100 transition-all duration-200 text-left outline-none cursor-pointer"
            >
              <div className="flex-shrink-0 p-3 rounded-xl bg-amber-50 text-amber-600 group-hover:bg-amber-100/70 transition-colors">
                <Banknote className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-slate-800 text-[15px] group-hover:text-amber-900 transition-colors">
                  Payroll Statement
                </h3>
                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                  Cetak rincian rekening bank dan surat pengantar transfer.
                </p>
              </div>
              <div className="flex-shrink-0 self-center pl-2">
                <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-amber-500 group-hover:translate-x-1 transition-all duration-200" />
              </div>
            </button>

            {/* Card 4: Cetak Semua Slip Gaji */}
            <button
              onClick={() => {
                setPrintSelectorOpen(false);
                handleBulkPdf();
              }}
              className="group flex items-start gap-4 p-4 rounded-2xl border border-slate-100 bg-slate-50/40 hover:bg-blue-50/30 hover:border-blue-100 transition-all duration-200 text-left outline-none cursor-pointer"
            >
              <div className="flex-shrink-0 p-3 rounded-xl bg-blue-50 text-blue-600 group-hover:bg-blue-100/70 transition-colors">
                <FileText className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-slate-800 text-[15px] group-hover:text-blue-900 transition-colors">
                  Cetak Semua Slip Gaji
                </h3>
                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                  Unduh seluruh slip gaji terkonfirmasi ke dalam satu file PDF.
                </p>
              </div>
              <div className="flex-shrink-0 self-center pl-2">
                <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-blue-500 group-hover:translate-x-1 transition-all duration-200" />
              </div>
            </button>

            {/* Card 5: Laporan Tunjangan Jabatan (Loyalis Only) */}
            {payrollCollar === 'loyalis' && (
              <button
                onClick={() => {
                  setPrintSelectorOpen(false);
                  setTunjanganJabatanDialogOpen(true);
                }}
                className="group flex items-start gap-4 p-4 rounded-2xl border border-slate-100 bg-slate-50/40 hover:bg-purple-50/30 hover:border-purple-100 transition-all duration-200 text-left outline-none cursor-pointer"
              >
                <div className="flex-shrink-0 p-3 rounded-xl bg-purple-50 text-purple-600 group-hover:bg-purple-100/70 transition-colors">
                  <Briefcase className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-slate-800 text-[15px] group-hover:text-purple-900 transition-colors">
                    Tunjangan Jabatan
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                    Cetak rincian tunjangan jabatan struktural dosen dan tendik unit.
                  </p>
                </div>
                <div className="flex-shrink-0 self-center pl-2">
                  <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-purple-500 group-hover:translate-x-1 transition-all duration-200" />
                </div>
              </button>
            )}

            {/* Card 6: Laporan Vakasi Pimpinan & Staf (Loyalis Only) */}
            {payrollCollar === 'loyalis' && (
              <button
                onClick={() => {
                  setPrintSelectorOpen(false);
                  setVakasiPimpinanStafDialogOpen(true);
                }}
                className="group flex items-start gap-4 p-4 rounded-2xl border border-slate-100 bg-slate-50/40 hover:bg-indigo-50/30 hover:border-indigo-100 transition-all duration-200 text-left outline-none cursor-pointer"
              >
                <div className="flex-shrink-0 p-3 rounded-xl bg-indigo-50 text-indigo-600 group-hover:bg-indigo-100/70 transition-colors">
                  <FileText className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-slate-800 text-[15px] group-hover:text-indigo-900 transition-colors">
                    Vakasi Pimpinan & Staf
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                    Cetak rincian vakasi pimpinan dan staf lengkap dengan kehadiran.
                  </p>
                </div>
                <div className="flex-shrink-0 self-center pl-2">
                  <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-indigo-500 group-hover:translate-x-1 transition-all duration-200" />
                </div>
              </button>
            )}

            {/* Card 7: Laporan Vakasi Lain-Lain (Loyalis Only) */}
            {payrollCollar === 'loyalis' && (
              <button
                onClick={() => {
                  setPrintSelectorOpen(false);
                  setVakasiLainLainDialogOpen(true);
                }}
                className="group flex items-start gap-4 p-4 rounded-2xl border border-slate-100 bg-slate-50/40 hover:bg-rose-50/30 hover:border-rose-100 transition-all duration-200 text-left outline-none cursor-pointer"
              >
                <div className="flex-shrink-0 p-3 rounded-xl bg-rose-50 text-rose-600 group-hover:bg-rose-100/70 transition-colors">
                  <FileText className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-slate-800 text-[15px] group-hover:text-rose-900 transition-colors">
                    Vakasi Lain-Lain
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                    Cetak rincian tunjangan struktural, vakasi tambahan, dan potongan.
                  </p>
                </div>
                <div className="flex-shrink-0 self-center pl-2">
                  <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-rose-500 group-hover:translate-x-1 transition-all duration-200" />
                </div>
              </button>
            )}

            {/* Card 8: Laporan Potongan Gaji */}
            <button
              onClick={() => {
                setPrintSelectorOpen(false);
                setPotonganGajiDialogOpen(true);
              }}
              className="group flex items-start gap-4 p-4 rounded-2xl border border-slate-100 bg-slate-50/40 hover:bg-indigo-50/30 hover:border-indigo-100 transition-all duration-200 text-left outline-none cursor-pointer"
            >
              <div className="flex-shrink-0 p-3 rounded-xl bg-indigo-50 text-indigo-600 group-hover:bg-indigo-100/70 transition-colors">
                <FileText className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-slate-800 text-[15px] group-hover:text-indigo-900 transition-colors">
                  Potongan Gaji
                </h3>
                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                  Cetak rincian seluruh potongan gaji karyawan {payrollCollar === 'loyalis' ? 'unit' : 'pekarya'}.
                </p>
              </div>
              <div className="flex-shrink-0 self-center pl-2">
                <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-indigo-500 group-hover:translate-x-1 transition-all duration-200" />
              </div>
            </button>

            {/* Card 9: Laporan Gabungan (Loyalis Only) */}
            {payrollCollar === 'loyalis' && (
              <button
                onClick={() => {
                  setPrintSelectorOpen(false);
                  setGabunganDialogOpen(true);
                }}
                className="group flex items-start gap-4 p-4 rounded-2xl border border-slate-100 bg-slate-50/40 hover:bg-indigo-50/30 hover:border-indigo-100 transition-all duration-200 text-left outline-none cursor-pointer"
              >
                <div className="flex-shrink-0 p-3 rounded-xl bg-indigo-50 text-indigo-600 group-hover:bg-indigo-100/70 transition-colors">
                  <FileText className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-slate-800 text-[15px] group-hover:text-indigo-900 transition-colors">
                    Laporan Gabungan
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                    Cetak rekap gabungan tunjangan jabatan, vakasi, dan potongan gaji.
                  </p>
                </div>
                <div className="flex-shrink-0 self-center pl-2">
                  <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-indigo-500 group-hover:translate-x-1 transition-all duration-200" />
                </div>
              </button>
            )}

            {/* Card 10: Kebutuhan Dana Gaji (Loyalis Only) */}
            {payrollCollar === 'loyalis' && (
              <button
                onClick={() => {
                  setPrintSelectorOpen(false);
                  setCetakKebutuhanDanaGajiDialogOpen(true);
                }}
                className="group flex items-start gap-4 p-4 rounded-2xl border border-slate-100 bg-slate-50/40 hover:bg-emerald-50/30 hover:border-emerald-100 transition-all duration-200 text-left outline-none cursor-pointer"
              >
                <div className="flex-shrink-0 p-3 rounded-xl bg-emerald-50 text-emerald-600 group-hover:bg-emerald-100/70 transition-colors">
                  <FileSpreadsheet className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-slate-800 text-[15px] group-hover:text-emerald-900 transition-colors">
                    Kebutuhan Dana Gaji
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                    Cetak rekap kebutuhan dana gaji per unit dalam format Excel (XLSX) atau PDF.
                  </p>
                </div>
                <div className="flex-shrink-0 self-center pl-2">
                  <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-emerald-500 group-hover:translate-x-1 transition-all duration-200" />
                </div>
              </button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── Cetak & Kirim Dialog ──────────────────────────────────── */}
      <Dialog open={cetakKirimOpen} onOpenChange={setCetakKirimOpen}>
        <DialogContent className="sm:max-w-[460px] p-6 rounded-2xl bg-white border border-slate-100 shadow-[0_20px_50px_rgba(0,0,0,0.1)]">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold tracking-tight text-slate-900 flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600">
                <Share2 className="w-5 h-5" />
              </div>
              Cetak / Kirim Slip Gaji
            </DialogTitle>
            <DialogDescription className="text-slate-500 mt-2 text-sm">
              Pilih metode pengiriman slip gaji untuk <span className="font-semibold text-slate-700">{selectedEmployee?.name}</span> periode <span className="font-semibold text-slate-700">{payrollPeriod}</span>.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3.5 mt-4">
            {/* 1. Kirim via WhatsApp */}
            <button
              type="button"
              disabled={sendingSingleEmail}
              onClick={async () => {
                if (!selectedEmployee) return;
                const slip = slipStates[selectedEmployee.id];
                if (slip) {
                  await handleSendWhatsApp(selectedEmployee, slip);
                }
              }}
              className="group flex items-start gap-4 p-4 rounded-2xl border border-slate-100 bg-slate-50/40 hover:bg-emerald-50/30 hover:border-emerald-100 transition-all duration-200 text-left outline-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <div className="flex-shrink-0 p-3 rounded-xl bg-emerald-50 text-emerald-600 group-hover:bg-emerald-100/70 transition-colors">
                <MessageCircle className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-slate-800 text-[15px] group-hover:text-emerald-900 transition-colors">
                  Kirim via WhatsApp
                </h3>
                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                  Kirim rincian pendapatan & link PDF resmi langsung ke WhatsApp Karyawan.
                </p>
              </div>
              <div className="flex-shrink-0 self-center pl-2">
                <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-emerald-500 group-hover:translate-x-1 transition-all duration-200" />
              </div>
            </button>

            {/* 2. Kirim via Gmail / Email */}
            <button
              type="button"
              disabled={sendingSingleEmail}
              onClick={async () => {
                if (selectedEmployee) {
                  await handleSendSingleEmail(selectedEmployee);
                }
              }}
              className="group flex items-start gap-4 p-4 rounded-2xl border border-slate-100 bg-slate-50/40 hover:bg-indigo-50/30 hover:border-indigo-100 transition-all duration-200 text-left outline-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <div className="flex-shrink-0 p-3 rounded-xl bg-indigo-50 text-indigo-600 group-hover:bg-indigo-100/70 transition-colors">
                {sendingSingleEmail ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Mail className="w-5 h-5" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-slate-800 text-[15px] group-hover:text-indigo-900 transition-colors">
                  Kirim via Email (Gmail)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                  Kirim slip gaji sebagai lampiran file PDF resmi langsung ke alamat email Karyawan.
                </p>
              </div>
              <div className="flex-shrink-0 self-center pl-2">
                <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-indigo-500 group-hover:translate-x-1 transition-all duration-200" />
              </div>
            </button>

            {/* 3. Cetak PDF Mandiri */}
            <button
              type="button"
              disabled={sendingSingleEmail}
              onClick={() => {
                if (!selectedEmployee) return;
                const slipData = buildPaySlipDocument(
                  selectedEmployee,
                  buildFreshSlipData(selectedEmployee),
                );
                generatePaySlipPdf(slipData, true);
                setCetakKirimOpen(false);
              }}
              className="group flex items-start gap-4 p-4 rounded-2xl border border-slate-100 bg-slate-50/40 hover:bg-slate-100 hover:border-slate-300 transition-all duration-200 text-left outline-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <div className="flex-shrink-0 p-3 rounded-xl bg-slate-100 text-slate-600 group-hover:bg-slate-200 transition-colors">
                <Printer className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-slate-800 text-[15px] group-hover:text-slate-900 transition-colors">
                  Unduh / Cetak PDF
                </h3>
                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                  Unduh dokumen PDF slip gaji Karyawan secara langsung ke perangkat Anda.
                </p>
              </div>
              <div className="flex-shrink-0 self-center pl-2">
                <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-600 group-hover:translate-x-1 transition-all duration-200" />
              </div>
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── Snackbar Notification ─────────────────────────── */}
      <FloatingSnackbar
        message={notification.show ? { type: notification.type, text: notification.message } : null}
      />

      {/* ─── Bulk Email Confirmation Dialog ─────────────────── */}
      <Dialog open={bulkConfirmDialogOpen} onOpenChange={setBulkConfirmDialogOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <Mail className="w-5 h-5 text-indigo-600" />
              Konfirmasi Kirim Email Bulk
            </DialogTitle>
            <DialogDescription className="text-slate-500 text-sm pt-2">
              Slip gaji kelompok <strong className="text-slate-700">{payrollCollar === 'loyalis' ? 'Loyalis' : 'Pekarya'}</strong> periode <strong className="text-slate-700">{payrollPeriod}</strong> akan dikirim ke email resmi masing-masing karyawan yang slipnya sudah dikunci.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/70 px-3 py-2.5">
              <p className="text-[11px] font-semibold text-indigo-700">Penerima</p>
              <p className="text-xl font-bold text-indigo-800 tabular-nums leading-tight">
                {bulkEmailPlan.items.length}
              </p>
              <p className="text-[11px] text-indigo-600/80">karyawan terkunci</p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
              <p className="text-[11px] font-semibold text-slate-500">Estimasi waktu</p>
              <p className="text-xl font-bold text-slate-700 tabular-nums leading-tight">
                ± {Math.max(1, Math.ceil((bulkEmailPlan.items.length * ESTIMATED_SECONDS_PER_EMAIL) / 60))} mnt
              </p>
              <p className="text-[11px] text-slate-500">dapat dijeda kapan saja</p>
            </div>
          </div>

          {bulkEmailPlan.skipped.length > 0 && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2.5">
              <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-amber-800">
                  {bulkEmailPlan.skipped.length} karyawan dilewati — email belum terdaftar
                </p>
                <p className="text-[11px] text-amber-700 mt-0.5 leading-relaxed">
                  {bulkEmailPlan.skipped.slice(0, 4).join(', ')}
                  {bulkEmailPlan.skipped.length > 4 ? `, +${bulkEmailPlan.skipped.length - 4} lainnya` : ''}
                </p>
              </div>
            </div>
          )}

          <p className="text-[11px] text-slate-400 leading-relaxed">
            Biarkan tab ini tetap terbuka selama pengiriman berlangsung. Email yang sudah terkirim tidak dapat ditarik kembali.
          </p>

          <div className="flex justify-end gap-3 pt-2">
            <Button
              variant="outline"
              onClick={() => setBulkConfirmDialogOpen(false)}
              className="rounded-xl border-slate-200 text-slate-600 hover:bg-slate-50"
            >
              Batal
            </Button>
            <Button
              onClick={confirmBulkEmail}
              disabled={bulkEmailPlan.items.length === 0}
              className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              <Mail className="w-4 h-4 mr-2" />
              Kirim Sekarang ({bulkEmailPlan.items.length})
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── Bulk Refresh Dialog ─────────────────── */}
      <Dialog open={bulkRefreshDialogOpen} onOpenChange={setBulkRefreshDialogOpen}>
        <DialogContent className="sm:max-w-2xl rounded-2xl max-h-[85vh] flex flex-col p-0 overflow-hidden">
          <DialogHeader className="p-6 pb-2">
            <DialogTitle className="flex items-center gap-2 text-lg text-slate-800">
              <RefreshCw className="w-5 h-5 text-indigo-600" />
              Perbandingan Data Terbaru (Bulk)
            </DialogTitle>
            <DialogDescription className="text-slate-500 text-sm">
              Ditemukan perbedaan antara draf slip saat ini dengan data terbaru di database untuk <strong>{bulkChanges.length} karyawan</strong>. Silakan tinjau sebelum menerapkan perubahan.
            </DialogDescription>
          </DialogHeader>

          {/* Change list */}
          <div className="flex justify-between items-center px-6 pb-3 border-b border-slate-100 mx-6 mb-2">
            <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-500 hover:text-slate-700 transition-colors">
              <input
                type="checkbox"
                checked={selectedBulkRefreshEmployeeIds.size === bulkChanges.length}
                onChange={handleToggleSelectAll}
                className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
              />
              <span>Pilih Semua ({bulkChanges.length})</span>
            </label>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-2 space-y-4 max-h-[50vh]">
            {bulkChanges.map((change) => (
              <div key={change.employeeId} className="border border-slate-100 rounded-xl p-4 bg-slate-50/50">
                <div className="flex justify-between items-center mb-3">
                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedBulkRefreshEmployeeIds.has(change.employeeId)}
                      onChange={() => handleToggleSelectEmployee(change.employeeId)}
                      className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                    />
                    <span className="font-semibold text-sm text-slate-700">{change.employeeName}</span>
                  </label>
                  {change.isLocked ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-full px-2 py-0.5">
                      🔒 Terkunci
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 bg-slate-100 border border-slate-200 rounded-full px-2 py-0.5">
                      🔓 Draf
                    </span>
                  )}
                </div>

                <div className="space-y-1.5 pl-2 border-l-2 border-indigo-100">
                  {change.diffs.map((diff: any, idx: number) => {
                    const isEarning = diff.type === 'earnings';
                    const diffLabel = diff.label;
                    const oldVal = diff.oldValue;
                    const newVal = diff.newValue;
                    const fieldKey = `${diff.type}::${diff.label}`;
                    const isChecked = selectedBulkRefreshFields[change.employeeId]?.has(fieldKey) ?? false;

                    return (
                      <div key={idx} className="flex justify-between items-center text-xs text-slate-600 py-0.5 hover:bg-slate-100/50 rounded px-1 -mx-1 transition-colors">
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => handleToggleSelectField(change.employeeId, fieldKey)}
                            className="w-3.5 h-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                          />
                          <span className={`w-1.5 h-1.5 rounded-full ${isEarning ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                          <span className="text-slate-700">{diffLabel}</span>
                        </label>
                        <div className="flex items-center gap-2">
                          <span className="text-slate-400 line-through">
                            {oldVal === null ? '(baru)' : formatIDR(oldVal)}
                          </span>
                          <span className="text-slate-400">➔</span>
                          <span className={newVal === null ? 'text-rose-600 font-semibold' : 'text-indigo-600 font-semibold'}>
                            {newVal === null ? 'Dihapus' : formatIDR(newVal)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <DialogFooter className="p-6 pt-4 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-3">
            <Button
              variant="outline"
              disabled={refreshingBulk}
              onClick={() => setBulkRefreshDialogOpen(false)}
              className="rounded-xl border-slate-200 text-slate-600 hover:bg-slate-100"
            >
              Batal
            </Button>
            <Button
              disabled={refreshingBulk || selectedBulkRefreshEmployeeIds.size === 0}
              onClick={handleApplyBulkRefresh}
              className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold flex items-center gap-2 shadow-md shadow-indigo-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {refreshingBulk ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                  Menerapkan...
                </>
              ) : (
                <>
                  <CheckCheck className="w-4 h-4 text-white" />
                  Terapkan Perubahan ({selectedBulkRefreshEmployeeIds.size})
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Full-Screen Open Period Calendar Modal */}
      {showOpenPeriodModal && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-md z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-2xl max-w-4xl w-full border border-slate-100 overflow-hidden flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="px-6 py-5 bg-gradient-to-r from-indigo-600 to-indigo-700 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-white/10 rounded-2xl border border-white/20">
                  <CalendarDays className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h2 className="text-lg sm:text-xl font-black tracking-tight">
                    {calendarEditMode
                      ? 'Tanggal Merah Periode'
                      : 'Konfigurasi Tanggal Merah Periode'}
                  </h2>
                  <p className="text-xs text-indigo-100 font-medium mt-0.5">
                    {targetDate.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })}
                    {calendarEditMode ? ` · Revisi ${calendarRevision}` : ''}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowOpenPeriodModal(false)}
                className="p-2 hover:bg-white/20 rounded-xl transition-colors text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body Content */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1">
              {/* Live Metrics Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-slate-200/70 text-slate-700">
                    <CalendarDays className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-[10px] font-extrabold uppercase text-slate-500 tracking-wider">Total Hari</div>
                    <div className="text-lg font-black text-slate-800">{modalDaysInMonth} Hari</div>
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-emerald-50/70 border border-emerald-200/70 flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-emerald-100 text-emerald-700">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-[10px] font-extrabold uppercase text-emerald-600 tracking-wider">Hari Kerja</div>
                    <div className="text-lg font-black text-emerald-900">{modalDaysInMonth - selectedHolidays.size} Hari</div>
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-rose-50/80 border border-rose-200/70 flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-rose-100 text-rose-700">
                    <AlertCircle className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-[10px] font-extrabold uppercase text-rose-600 tracking-wider">Tanggal Merah</div>
                    <div className="text-lg font-black text-rose-900">{selectedHolidays.size} Hari</div>
                  </div>
                </div>
              </div>

              {/* Info Banner */}
              <div className="p-3.5 rounded-2xl bg-amber-50/80 border border-amber-200/80 text-xs font-semibold text-amber-900 flex items-start gap-2.5">
                <span className="text-base leading-none">💡</span>
                <span>
                  Setiap hari <strong>Jumat</strong> otomatis menjadi hari premium dan
                  tidak dapat dihapus. Klik tanggal lain untuk menambah atau mengurangi
                  hari libur periode ini.
                </span>
              </div>

              {/* Interactive Calendar Grid */}
              <div className="space-y-2">
                {/* Day Headers (Senin - Minggu) */}
                <div className="grid grid-cols-7 gap-2 text-center text-xs font-black text-slate-600 uppercase tracking-wider">
                  <span>Sen</span>
                  <span>Sel</span>
                  <span>Rab</span>
                  <span>Kam</span>
                  <span className="text-rose-600">Jum</span>
                  <span>Sab</span>
                  <span className="text-rose-600">Min</span>
                </div>

                {/* Calendar Day Tiles */}
                <div className="grid grid-cols-7 gap-2">
                  {/* Empty Offset Tiles */}
                  {Array.from({ length: modalStartOffset }).map((_, i) => (
                    <div key={`offset-${i}`} className="h-14 sm:h-16 rounded-2xl bg-slate-50/50 border border-slate-100/50" />
                  ))}

                  {/* Actual Day Tiles */}
                  {Array.from({ length: modalDaysInMonth }).map((_, i) => {
                    const dayNum = i + 1;
                    const dateStr = `${modalYear}-${String(modalMonth + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
                    const isFriday = new Date(modalYear, modalMonth, dayNum).getDay() === 5;
                    const isSunday = new Date(modalYear, modalMonth, dayNum).getDay() === 0;
                    const isHoliday = selectedHolidays.has(dateStr);

                    return (
                      <button
                        key={dateStr}
                        type="button"
                        disabled={isFriday}
                        onClick={() => {
                          if (isFriday) return;
                          setSelectedHolidays(prev => {
                            const next = new Set(prev);
                            if (next.has(dateStr)) {
                              next.delete(dateStr);
                            } else {
                              next.add(dateStr);
                            }
                            return next;
                          });
                        }}
                        className={`h-14 sm:h-16 rounded-2xl p-2 flex flex-col justify-between items-start transition-all border text-left relative overflow-hidden group select-none ${
                          isHoliday
                            ? isFriday
                              ? 'bg-rose-600 text-white border-rose-700 shadow-sm cursor-not-allowed'
                              : 'bg-rose-500 text-white border-rose-600 shadow-sm hover:bg-rose-600 cursor-pointer'
                            : 'bg-white text-slate-800 border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/30'
                        }`}
                      >
                        <div className="flex items-center justify-between w-full">
                          <span className="font-extrabold text-sm sm:text-base">{dayNum}</span>
                          {isHoliday && (
                            <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full bg-white/20 text-white">
                              {isFriday ? 'Jumat' : 'Libur'}
                            </span>
                          )}
                        </div>
                        <span className={`text-[9px] font-bold ${isHoliday ? 'text-rose-100' : isSunday || isFriday ? 'text-rose-500' : 'text-slate-400'}`}>
                          {isHoliday ? 'Tanggal Merah' : 'Hari Kerja'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
              {calendarEditMode && (
                <div className="space-y-2">
                  <label
                    htmlFor="calendar-edit-reason"
                    className="text-sm font-bold text-slate-700"
                  >
                    Alasan perubahan kalender
                  </label>
                  <textarea
                    id="calendar-edit-reason"
                    value={calendarEditReason}
                    onChange={(event) => setCalendarEditReason(event.target.value)}
                    className="min-h-24 w-full rounded-2xl border border-slate-300 p-3 text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                    placeholder="Contoh: Rektor menetapkan libur insidental pada 17 Agustus."
                  />
                  <p className="text-xs text-slate-500">
                    Perubahan disimpan dengan nilai sebelum/sesudah, pelaku, waktu,
                    alasan, dan nomor permintaan.
                  </p>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200/80 flex items-center justify-between shrink-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowOpenPeriodModal(false)}
                className="rounded-xl font-bold text-xs h-10 px-4 cursor-pointer"
              >
                Batal
              </Button>
              <Button
                type="button"
                onClick={
                  calendarEditMode
                    ? handleConfirmCalendarEdit
                    : handleConfirmOpenPeriod
                }
                disabled={
                  isSubmittingModal ||
                  (calendarEditMode && calendarEditReason.trim().length < 8)
                }
                className="rounded-xl font-bold text-xs h-10 px-5 bg-indigo-600 hover:bg-indigo-700 text-white gap-2 cursor-pointer shadow-md"
              >
                {isSubmittingModal ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-white" />
                    <span>Memproses...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-white" />
                    <span>
                      {calendarEditMode
                        ? 'Tinjau Dampak & Simpan'
                        : 'Simpan Tanggal Merah'}
                    </span>
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
