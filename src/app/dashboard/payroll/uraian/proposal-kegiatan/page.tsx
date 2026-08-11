"use client"

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  Loader2, CheckCircle2, FileText, AlertCircle, Trash2, Eye, Plus, Save,
  Building2, PlusCircle, Check, X, Users, Layers, Send, CheckCircle,
  RotateCcw, AlertTriangle, XCircle, Search, Copy, Sparkles, Clock, FileDown, Banknote,
  Lock, Unlock, Receipt, ToggleLeft, ToggleRight, ChevronDown, ChevronRight, ArrowLeft, Link2
} from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import {
  collection, getDocs, doc, setDoc, deleteDoc, getDoc, serverTimestamp, query, where, onSnapshot
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { MONTHS_ID } from '@/utils/rekapConfig';
import { generateProposalKegiatanPdf } from '@/utils/generateProposalKegiatanPdf';
import { generateLpjPdf } from '@/utils/generateLpjPdf';
import { generateLpjExpenseReportPdf } from '@/utils/generateLpjExpenseReportPdf';
import ExpenseReportStage from './ExpenseReportStage';
import {
  createProposalExpenseRow,
  createStableId,
  ensureExpenseRowIds,
  ExpenseReport,
  normalizeExpenseReportLinksToGroups,
  normalizeExpenseReports,
  ProposalExpenseRow,
  sanitizeForFirestore,
} from '@/lib/payroll/proposalExpenseReports';
import { authenticatedJson } from '@/lib/payroll/client';
import { handleRowCellKeyDown } from '@/lib/tableKeyboardNav';

const clearExpenseReportLink = (row: ProposalExpenseRow): ProposalExpenseRow => {
  const cleanRow = { ...row };
  delete cleanRow.reportId;
  delete cleanRow.reportType;
  return cleanRow;
};

const LONG_PRESS_MS = 500;

/** "+" / "Sisipkan baris di bawah" button: a normal press runs `onPress`, holding it down runs `onLongPress` instead (adds a header row). */
function InsertRowButton({
  title,
  onPress,
  onLongPress,
  className,
}: {
  title: string;
  onPress: () => void;
  onLongPress: () => void;
  className?: string;
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedLongPressRef = useRef(false);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const startPress = () => {
    firedLongPressRef.current = false;
    clearTimer();
    timerRef.current = setTimeout(() => {
      firedLongPressRef.current = true;
      onLongPress();
    }, LONG_PRESS_MS);
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      title={title}
      onMouseDown={startPress}
      onMouseUp={clearTimer}
      onMouseLeave={clearTimer}
      onTouchStart={startPress}
      onTouchEnd={clearTimer}
      onContextMenu={(e) => e.preventDefault()}
      onClick={() => {
        if (firedLongPressRef.current) {
          firedLongPressRef.current = false;
          return;
        }
        onPress();
      }}
      className={className}
    >
      <Plus className="w-3.5 h-3.5" />
    </Button>
  );
}

export default function ProposalKegiatanPage() {
  const { profile } = useAuth();
  const searchParams = useSearchParams();

  // Read params from URL search parameters
  const month = parseInt(searchParams.get('month') || String(new Date().getMonth() + 1), 10);
  const year = parseInt(searchParams.get('year') || String(new Date().getFullYear()), 10);

  const periodToken = `${year}-${String(month).padStart(2, '0')}`;

  // ── Main Page State ──
  const [proposalList, setProposalList] = useState<any[]>([]);
  const [loadingProposal, setLoadingProposal] = useState(false);
  const [activeStage, setActiveStage] = useState<'proposal' | 'lpj'>('proposal');
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  const [reportEditorGroupId, setReportEditorGroupId] = useState<string | null>(null);

  // Common Header States
  const [reportName, setReportName] = useState('');
  const [departmentUnit, setDepartmentUnit] = useState('');
  const [saving, setSaving] = useState(false);
  const [printingPdf, setPrintingPdf] = useState(false);
  const [printingReport, setPrintingReport] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [activeInsertMenuIdx, setActiveInsertMenuIdx] = useState<number | null>(null);
  const [activePelaporanSuggestionIndex, setActivePelaporanSuggestionIndex] = useState<number>(0);
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [periodClosed, setPeriodClosed] = useState(false);

  // Proposal Status & Review States
  const [currentProposalStatus, setCurrentProposalStatus] = useState<string | null>(null);
  const [currentReviewNote, setCurrentReviewNote] = useState<string | null>(null);
  const [currentSubmittedByName, setCurrentSubmittedByName] = useState<string | null>(null);
  const [currentSubmittedByEmail, setCurrentSubmittedByEmail] = useState<string | null>(null);
  const [currentProposalQueueNo, setCurrentProposalQueueNo] = useState<number | null>(null);

  // Ref to track loading state and prevent immediate auto-save on select
  const isInitialMount = useRef(true);
  const skipAutoSaveRef = useRef(false);

  // ── Stage 1: Proposal States (Full Mirror of Seksi 1 without Realisasi column) ──
  const [pemasukanRows, setPemasukanRows] = useState<{
    uraian: string;
    rincianQty: string;
    rincianRate: number;
  }[]>([{ uraian: '', rincianQty: '', rincianRate: 0 }]);
  const [yayasanPercentage, setYayasanPercentage] = useState(20);
  const [unipduPercentage, setUnipduPercentage] = useState(20);
  const [pengeluaranRows, setPengeluaranRows] = useState<ProposalExpenseRow[]>([createProposalExpenseRow('group_header')]);
  const [kepanitiaaanPercentage, setKepanitiaaanPercentage] = useState(10);

  const [proposalSignatures, setProposalSignatures] = useState<{
    label: string;
    name: string;
    title: string;
    searchText?: string;
    showDropdown?: boolean;
  }[]>([
    { label: '', name: '', title: 'Wakil Rektor Bid. Keuangan, SDM dan Umum', searchText: '', showDropdown: false },
    { label: '', name: '', title: 'Ketua BAK', searchText: '', showDropdown: false },
    { label: '', name: '', title: 'Kepala SatKer', searchText: '', showDropdown: false },
  ]);

  // ── Stage 2: LPJ / Pelaporan States (Exact 4 Sections like PelaporanKegiatanPage) ──
  const [realisasiEnabled, setRealisasiEnabled] = useState(true);
  // These fields remain in storage and are still passed to the legacy LPJ PDF
  // adapter. The visible workflow now uses generic reports below the LPJ
  // realization table instead of the old example-specific sections.
  const [vakasiPengujiEnabled, setVakasiPengujiEnabled] = useState(false);
  const [kepanitiaaanEnabled, setKepanitiaaanEnabled] = useState(false);
  const [receiptEnabled, setReceiptEnabled] = useState(false);

  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    realisasi: true,
    vakasiPenguji: false,
    kepanitiaan: false,
    kwitansi: false
  });
  const toggleSection = (key: string) => setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));

  // LPJ Seksi 1: Realisasi Keuangan
  const [realisasiTitle, setRealisasiTitle] = useState('REALISASI ');
  const [lpjPemasukanRows, setLpjPemasukanRows] = useState<{
    uraian: string;
    rincianQty: string;
    rincianRate: number;
    realisasi: number;
  }[]>([{ uraian: '', rincianQty: '', rincianRate: 0, realisasi: 0 }]);
  const [lpjPengeluaranRows, setLpjPengeluaranRows] = useState<ProposalExpenseRow[]>([{ ...createProposalExpenseRow('group_header'), realisasi: 0 }]);

  // Generic reports, one per connected LPJ group header.
  const [expenseReports, setExpenseReports] = useState<ExpenseReport[]>([]);

  // LPJ Seksi 2: Vakasi Penguji
  const [vakasiPengujiTitle, setVakasiPengujiTitle] = useState('VAKASI PENGUJI ');
  const [vakasiRoles, setVakasiRoles] = useState<{ name: string; rate: number }[]>([
    { name: 'Ketua', rate: 200000 },
    { name: 'Penguji', rate: 175000 },
    { name: 'Sekretaris', rate: 125000 }
  ]);
  const [vakasiPengujiRows, setVakasiPengujiRows] = useState<{
    employeeId: string;
    employeeName: string;
    roleQtys: Record<string, number>;
    searchText?: string;
    showDropdown?: boolean;
  }[]>([{ employeeId: '', employeeName: '', roleQtys: {}, searchText: '', showDropdown: false }]);

  // LPJ Seksi 3: Vakasi Kepanitiaan
  const [kepanitiaaanTitle, setKepanitiaaanTitle] = useState('VAKASI KEPANITIAAN ');
  const [kepanitiaaanPhases, setKepanitiaaanPhases] = useState<{ name: string }[]>([
    { name: 'Persiapan' },
    { name: 'Pelaksanaan' },
    { name: 'Kepanitiaan' }
  ]);
  const [kepanitiaaanRows, setKepanitiaaanRows] = useState<{
    name: string;
    employeeId?: string;
    phaseAmounts: Record<string, number>;
    searchText?: string;
    showDropdown?: boolean;
  }[]>([{ name: '', phaseAmounts: {}, searchText: '', showDropdown: false }]);

  // LPJ Seksi 4: Kwitansi / Pembelian
  const [receiptTitle, setReceiptTitle] = useState('KWITANSI PEMBELIAN ');
  const [receiptRows, setReceiptRows] = useState<{
    itemName: string;
    qty: number;
    unitPrice: number;
  }[]>([{ itemName: '', qty: 1, unitPrice: 0 }]);

  // LPJ Signatures
  const [lpjSignatures, setLpjSignatures] = useState<{
    label: string;
    name: string;
    title: string;
    searchText?: string;
    showDropdown?: boolean;
  }[]>([
    { label: '', name: '', title: 'Wakil Rektor Bid. Keuangan, SDM dan Umum', searchText: '', showDropdown: false },
    { label: '', name: '', title: '', searchText: '', showDropdown: false },
    { label: '', name: '', title: 'Direktur', searchText: '', showDropdown: false },
  ]);

  // Review Dialog for Super Admin
  const [showReviewDialog, setShowReviewDialog] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<'proposal' | 'lpj'>('proposal');
  const [reviewAction, setReviewAction] = useState<string>('proposal_approved');
  const [reviewNoteInput, setReviewNoteInput] = useState('');

  // Historical Baseline Clone Dialog States
  const [showCloneModal, setShowCloneModal] = useState(false);
  const [historicalItems, setHistoricalItems] = useState<any[]>([]);
  const [loadingHistorical, setLoadingHistorical] = useState(false);
  const [cloneSearchQuery, setCloneSearchQuery] = useState('');

  // Employees & Departments Data
  const [loyalisEmployees, setLoyalisEmployees] = useState<any[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);

  // Qty Parser Utility
  const parseQty = (q: string): number => {
    if (!q) return 0;
    const trimmed = q.trim();
    const parts = trimmed.split(/[xX\*]/);
    if (parts.length > 1) {
      let product = 1;
      for (const part of parts) {
        const cleanPart = part.trim();
        const match = cleanPart.match(/[\d\.]+/);
        if (!match) continue;
        let val = parseFloat(match[0]);
        if (cleanPart.includes('%')) val /= 100;
        product *= val;
      }
      return product;
    }
    if (trimmed.endsWith('%')) {
      const match = trimmed.match(/[\d\.]+/);
      return match ? parseFloat(match[0]) / 100 : 0;
    }
    const match = trimmed.match(/[\d\.]+/);
    return match ? parseFloat(match[0]) : 0;
  };

  const canManageProposal = Boolean(
    profile && ['super_admin', 'finance_verifier', 'satker_head_loyalis'].includes(profile.role),
  );

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    getDoc(doc(db, 'PayrollPeriods', periodToken))
      .then((snapshot) => {
        if (!cancelled) setPeriodClosed(snapshot.data()?.attendanceStatus === 'closed');
      })
      .catch(() => {
        // The rules treat a missing/unreadable period as open by default. The
        // server-side rule remains authoritative for the eventual write.
        if (!cancelled) setPeriodClosed(false);
      });
    return () => {
      cancelled = true;
    };
  }, [periodToken, profile]);

  // Fetch departments
  useEffect(() => {
    const fetchDept = async () => {
      try {
        const deptDoc = await getDoc(doc(db, 'Settings', 'departments'));
        if (deptDoc.exists() && deptDoc.data().list) {
          setDepartments(deptDoc.data().list);
        } else {
          setDepartments(['BAK', 'FEB', 'FBS', 'FIK', 'FIP', 'FKI', 'FSP', 'FT', 'Rektorat', 'Satpam', 'Yayasan'].sort());
        }
      } catch (err) {
        console.error(err);
      }
    };
    fetchDept();
  }, []);

  // Fetch Loyalis employees
  useEffect(() => {
    const fetchLoyalis = async () => {
      try {
        const snap = await getDocs(query(collection(db, 'Employees_Loyalis'), where('personal_info.status', '==', 'AKTIF')));
        const list = snap.docs.map(d => ({
          id: d.id,
          name: d.data().personal_info?.name || '',
          role: d.data().employment_profile?.job_role || 'Pegawai',
          department: d.data().employment_profile?.department_unit || '',
        })).sort((a, b) => a.name.localeCompare(b.name));
        setLoyalisEmployees(list);
      } catch (err) {
        console.error(err);
      }
    };
    fetchLoyalis();
  }, []);

  // Live Sync ProposalKegiatan collection
  useEffect(() => {
    if (!profile || !canManageProposal) return;
    setLoadingProposal(true);
    const q = query(
      collection(db, 'ProposalKegiatan'),
      where('period', '==', periodToken)
    );

    const unsubscribe = onSnapshot(q, (snap) => {
      let list = snap.docs.map(d => ({
        id: d.id,
        ...d.data()
      })) as any[];

      if (profile.role === 'satker_head_loyalis') {
        list = list.filter(evt => evt.submittedBy === profile.uid);
      }

      list.sort((a, b) => {
        const getMs = (val: any) => {
          if (!val) return Date.now();
          if (typeof val.toMillis === 'function') return val.toMillis();
          if (val.seconds) return val.seconds * 1000;
          return 0;
        };
        return getMs(b.updatedAt) - getMs(a.updatedAt);
      });

      setProposalList(list);
      setLoadingProposal(false);
    }, (err) => {
      console.error('Error listening to ProposalKegiatan:', err);
      setLoadingProposal(false);
    });

    return () => unsubscribe();
  }, [canManageProposal, periodToken, profile]);

  const resetForm = () => {
    skipAutoSaveRef.current = true;
    setSelectedProposalId(null);
    setReportEditorGroupId(null);
    setReportName('');
    setDepartmentUnit('');
    setCurrentProposalStatus('proposal_draft');
    setCurrentReviewNote(null);
    setCurrentSubmittedByName(null);
    setCurrentSubmittedByEmail(null);
    setCurrentProposalQueueNo(null);
    setActiveStage('proposal');

    // Stage 1 Reset
    setPemasukanRows([{ uraian: '', rincianQty: '', rincianRate: 0 }]);
    setYayasanPercentage(20);
    setUnipduPercentage(20);
    setPengeluaranRows([createProposalExpenseRow('group_header')]);
    setKepanitiaaanPercentage(10);

    setProposalSignatures([
      { label: '', name: '', title: 'Wakil Rektor Bid. Keuangan, SDM dan Umum', searchText: '', showDropdown: false },
      { label: '', name: '', title: 'Ketua BAK', searchText: '', showDropdown: false },
      { label: '', name: '', title: 'Kepala SatKer', searchText: '', showDropdown: false },
    ]);

    // LPJ Reset
    setRealisasiEnabled(true);
    setVakasiPengujiEnabled(false);
    setKepanitiaaanEnabled(false);
    setReceiptEnabled(false);
    setLpjPemasukanRows([{ uraian: '', rincianQty: '', rincianRate: 0, realisasi: 0 }]);
    setLpjPengeluaranRows([{ ...createProposalExpenseRow('group_header'), realisasi: 0 }]);
    setExpenseReports([]);
    setVakasiPengujiRows([{ employeeId: '', employeeName: '', roleQtys: {}, searchText: '', showDropdown: false }]);
    setKepanitiaaanRows([{ name: '', phaseAmounts: {}, searchText: '', showDropdown: false }]);
    setReceiptRows([{ itemName: '', qty: 1, unitPrice: 0 }]);
    setLpjSignatures([
      { label: '', name: '', title: 'Wakil Rektor Bid. Keuangan, SDM dan Umum', searchText: '', showDropdown: false },
      { label: '', name: '', title: '', searchText: '', showDropdown: false },
      { label: '', name: '', title: 'Direktur', searchText: '', showDropdown: false },
    ]);

    setTimeout(() => {
      skipAutoSaveRef.current = false;
    }, 500);
  };

  const isProposalApproved = useMemo(() => {
    return Boolean(profile?.role === 'super_admin' || currentProposalStatus === 'proposal_approved' || currentProposalStatus?.startsWith('lpj_'));
  }, [currentProposalStatus, profile]);

  const handleSelectProposal = (item: any) => {
    skipAutoSaveRef.current = true;
    setSelectedProposalId(item.id);
    setReportName(item.reportName || item.title || '');
    setDepartmentUnit(item.departmentUnit || '');
    setCurrentProposalStatus(item.status || 'proposal_draft');
    setCurrentReviewNote(item.reviewNote || null);
    setCurrentSubmittedByName(item.submittedByName || null);
    setCurrentSubmittedByEmail(item.submittedByEmail || null);
    setCurrentProposalQueueNo(item.proposalQueueNumber || null);
    setReportEditorGroupId(null);

    if (item.status && item.status.startsWith('lpj_')) {
      setActiveStage('lpj');
    } else {
      setActiveStage('proposal');
    }

    // Load Stage 1 Proposal Data
    if (item.pemasukanRows && item.pemasukanRows.length > 0) {
      setPemasukanRows(item.pemasukanRows);
    } else {
      setPemasukanRows([{ uraian: '', rincianQty: '', rincianRate: 0 }]);
    }
    if (item.yayasanPercentage !== undefined) setYayasanPercentage(item.yayasanPercentage);
    if (item.unipduPercentage !== undefined) setUnipduPercentage(item.unipduPercentage);
    if (item.kepanitiaaanPercentage !== undefined) setKepanitiaaanPercentage(item.kepanitiaaanPercentage);

    const normalizedProposalExpenseRows = item.pengeluaranRows && item.pengeluaranRows.length > 0
      ? ensureExpenseRowIds(item.pengeluaranRows)
      : [createProposalExpenseRow('group_header')];
    if (item.pengeluaranRows && item.pengeluaranRows.length > 0) {
      setPengeluaranRows(normalizedProposalExpenseRows);
    } else {
      setPengeluaranRows(normalizedProposalExpenseRows);
    }
    if (item.signatures && item.signatures.length > 0) {
      setProposalSignatures(item.signatures);
    }

    // Load Stage 2 LPJ Data (if available)
    if (item.lpjPemasukanRows) setLpjPemasukanRows(item.lpjPemasukanRows);
    else if (item.pemasukanRows) setLpjPemasukanRows(item.pemasukanRows.map((r: any) => ({ ...r, realisasi: parseQty(r.rincianQty) * (r.rincianRate || 0) })));

    const normalizedLpjExpenseRows: ProposalExpenseRow[] = item.lpjPengeluaranRows
      ? ensureExpenseRowIds(item.lpjPengeluaranRows).map((row: ProposalExpenseRow, index: number) => {
        const proposalRow = normalizedProposalExpenseRows[index];
        return {
          ...row,
          // Old records sometimes stored links on proposal rows only. Copy
          // that link into LPJ once, then all new edits remain LPJ-scoped.
          rowId: row.rowId || proposalRow?.rowId,
          reportId: row.reportId || proposalRow?.reportId,
          reportType: row.reportType || proposalRow?.reportType,
          realisasi: row.type === 'group_header' ? 0 : (row.realisasi ?? parseQty(row.rincianQty) * (row.rincianRate || 0)),
        };
      })
      : item.pengeluaranRows
        ? normalizedProposalExpenseRows.map((row) => ({
          ...row,
          realisasi: row.type === 'group_header' ? 0 : parseQty(row.rincianQty) * (row.rincianRate || 0),
        }))
        : [{ ...createProposalExpenseRow('group_header'), realisasi: 0 }];
    const normalizedReports = normalizeExpenseReports(item.expenseReports, normalizedLpjExpenseRows);
    const normalizedLinks = normalizeExpenseReportLinksToGroups(normalizedLpjExpenseRows, normalizedReports);
    setLpjPengeluaranRows(normalizedLinks.rows);
    setExpenseReports(normalizedLinks.reports);

    if (item.realisasiEnabled !== undefined) setRealisasiEnabled(item.realisasiEnabled);
    if (item.vakasiPengujiEnabled !== undefined) setVakasiPengujiEnabled(item.vakasiPengujiEnabled);
    if (item.kepanitiaaanEnabled !== undefined) setKepanitiaaanEnabled(item.kepanitiaaanEnabled);
    if (item.receiptEnabled !== undefined) setReceiptEnabled(item.receiptEnabled);

    if (item.vakasiPengujiRows) setVakasiPengujiRows(item.vakasiPengujiRows);
    if (item.kepanitiaaanRows) setKepanitiaaanRows(item.kepanitiaaanRows);
    if (item.receiptRows) setReceiptRows(item.receiptRows);
    if (item.lpjSignatures) setLpjSignatures(item.lpjSignatures);

    setTimeout(() => {
      skipAutoSaveRef.current = false;
    }, 500);
  };

  // ── Stage 1 Proposal Computations ──
  const totalPemasukanAnggaran = useMemo(() => {
    return pemasukanRows.reduce((sum, r) => sum + (parseQty(r.rincianQty) * (r.rincianRate || 0)), 0);
  }, [pemasukanRows]);

  const yayasanAnggaran = useMemo(() => {
    return totalPemasukanAnggaran * (yayasanPercentage / 100);
  }, [totalPemasukanAnggaran, yayasanPercentage]);

  const unipduAnggaran = useMemo(() => {
    return totalPemasukanAnggaran * (unipduPercentage / 100);
  }, [totalPemasukanAnggaran, unipduPercentage]);

  const totalPengembanganAnggaran = useMemo(() => {
    return yayasanAnggaran + unipduAnggaran;
  }, [yayasanAnggaran, unipduAnggaran]);

  const danaOperasionalAnggaran = useMemo(() => {
    return totalPemasukanAnggaran - totalPengembanganAnggaran;
  }, [totalPemasukanAnggaran, totalPengembanganAnggaran]);

  const expItems = useMemo(() => {
    return pengeluaranRows.filter(r => r.type === 'item' && r.uraian.trim());
  }, [pengeluaranRows]);

  const jumlahPengeluaranAnggaran = useMemo(() => {
    return expItems.reduce((sum, r) => sum + (parseQty(r.rincianQty) * (r.rincianRate || 0)), 0);
  }, [expItems]);

  const kepanitiaaanAnggaran = useMemo(() => {
    return jumlahPengeluaranAnggaran * (kepanitiaaanPercentage / 100);
  }, [jumlahPengeluaranAnggaran, kepanitiaaanPercentage]);

  const totalPengeluaranAnggaran = useMemo(() => {
    return jumlahPengeluaranAnggaran + kepanitiaaanAnggaran;
  }, [jumlahPengeluaranAnggaran, kepanitiaaanAnggaran]);

  const sisaAnggaran = useMemo(() => {
    return danaOperasionalAnggaran - totalPengeluaranAnggaran;
  }, [danaOperasionalAnggaran, totalPengeluaranAnggaran]);

  const isProposalReadOnly = periodClosed || (profile?.role !== 'super_admin' && (currentProposalStatus === 'proposal_approved' || currentProposalStatus === 'proposal_submitted' || currentProposalStatus?.startsWith('lpj_')));
  const isLpjReadOnly = periodClosed || currentProposalStatus === 'lpj_submitted' || currentProposalStatus === 'lpj_approved';

  // ── REAL-TIME DEBOUNCED AUTO-SAVE EFFECT ──
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    if (skipAutoSaveRef.current) return;
    if (!profile || !canManageProposal || periodClosed) return;
    if (!reportName.trim() || !departmentUnit) return;
    if (isProposalReadOnly && activeStage === 'proposal') return;

    const timer = setTimeout(async () => {
      setAutoSaveStatus('saving');
      try {
        const docId = selectedProposalId || `${periodToken}_prop_${Date.now()}`;
        const totalBudget = totalPengeluaranAnggaran || totalPemasukanAnggaran;

        const payload: Record<string, any> = {
          reportName,
          departmentUnit,
          period: periodToken,
          totalBudget,
          pemasukanRows,
          yayasanPercentage,
          unipduPercentage,
          pengeluaranRows,
          kepanitiaaanPercentage,
          signatures: proposalSignatures,
          status: currentProposalStatus || 'proposal_draft',
          submittedBy: profile?.uid || null,
          submittedByName: profile?.displayName || null,
          submittedByEmail: profile?.email || null,
          // Stage 2 LPJ Data
          realisasiEnabled,
          vakasiPengujiEnabled,
          kepanitiaaanEnabled,
          receiptEnabled,
          realisasiTitle,
          lpjPemasukanRows,
          lpjPengeluaranRows,
          vakasiPengujiTitle,
          vakasiRoles,
          vakasiPengujiRows,
          kepanitiaaanTitle,
          kepanitiaaanPhases,
          kepanitiaaanRows,
          receiptTitle,
          receiptRows,
          lpjSignatures,
          expenseReports,
          updatedAt: serverTimestamp(),
        };

        await setDoc(doc(db, 'ProposalKegiatan', docId), sanitizeForFirestore(payload), { merge: true });
        if (!selectedProposalId) setSelectedProposalId(docId);
        setAutoSaveStatus('saved');
        setTimeout(() => setAutoSaveStatus('idle'), 3000);
      } catch (err) {
        console.error('Error auto-saving proposal progress:', err);
        setAutoSaveStatus('error');
      }
    }, 1200);

    return () => clearTimeout(timer);
  }, [
    reportName,
    departmentUnit,
    pemasukanRows,
    yayasanPercentage,
    unipduPercentage,
    pengeluaranRows,
    kepanitiaaanPercentage,
    proposalSignatures,
    realisasiEnabled,
    vakasiPengujiEnabled,
    kepanitiaaanEnabled,
    receiptEnabled,
    realisasiTitle,
    lpjPemasukanRows,
    lpjPengeluaranRows,
    vakasiPengujiTitle,
    vakasiRoles,
    vakasiPengujiRows,
    kepanitiaaanTitle,
    kepanitiaaanPhases,
    kepanitiaaanRows,
    receiptTitle,
    receiptRows,
    lpjSignatures,
    expenseReports,
    canManageProposal,
    periodClosed,
  ]);

  // ── Historical Baseline Clone Handler ──
  const fetchHistoricalBaselines = async () => {
    if (!canManageProposal) return;
    setLoadingHistorical(true);
    try {
      const snapProp = await getDocs(collection(db, 'ProposalKegiatan'));
      const snapLpj = await getDocs(collection(db, 'PelaporanKegiatan'));

      const listProp = snapProp.docs.map(d => ({ id: d.id, sourceType: 'PROPOSAL', ...d.data() }));
      const listLpj = snapLpj.docs.map(d => ({ id: d.id, sourceType: 'LPJ', ...d.data() }));

      const combined = [...listProp, ...listLpj].filter((e: any) => (e.reportName || '').trim() !== '');
      combined.sort((a: any, b: any) => (b.period || '').localeCompare(a.period || ''));

      setHistoricalItems(combined);
    } catch (err) {
      console.error('Error fetching historical baselines:', err);
    } finally {
      setLoadingHistorical(false);
    }
  };

  const handleOpenCloneModal = () => {
    if (!canManageProposal) {
      setMessage({ type: 'error', text: 'Akun ini tidak memiliki akses untuk mengkloning proposal.' });
      return;
    }
    setShowCloneModal(true);
    fetchHistoricalBaselines();
  };

  const handleCloneTemplate = (pastItem: any) => {
    resetForm();
    let nextName = pastItem.reportName || '';
    if (nextName.includes('2025')) {
      nextName = nextName.replace('2025', '2026');
    } else if (nextName.includes('2024')) {
      nextName = nextName.replace('2024', '2026');
    } else {
      nextName = `${nextName} ${year}`;
    }

    setReportName(nextName);
    setDepartmentUnit(pastItem.departmentUnit || '');

    if (pastItem.pemasukanRows && pastItem.pemasukanRows.length > 0) {
      setPemasukanRows(pastItem.pemasukanRows);
    }
    if (pastItem.yayasanPercentage !== undefined) setYayasanPercentage(pastItem.yayasanPercentage);
    if (pastItem.unipduPercentage !== undefined) setUnipduPercentage(pastItem.unipduPercentage);
    if (pastItem.kepanitiaaanPercentage !== undefined) setKepanitiaaanPercentage(pastItem.kepanitiaaanPercentage);

    if (pastItem.pengeluaranRows && pastItem.pengeluaranRows.length > 0) {
      const clonedExpenseRows = ensureExpenseRowIds(pastItem.pengeluaranRows).map((row) => ({
        ...clearExpenseReportLink(row),
        rowId: createStableId('expense-row'),
      }));
      setPengeluaranRows(clonedExpenseRows);
      setLpjPengeluaranRows(clonedExpenseRows.map((row) => ({
        ...row,
        realisasi: row.type === 'group_header' ? 0 : parseQty(row.rincianQty) * (row.rincianRate || 0),
      })));
    }

    setExpenseReports([]);
    setReportEditorGroupId(null);

    setShowCloneModal(false);
    setMessage({
      type: 'success',
      text: `Berhasil mengkloning template anggaran dari "${pastItem.reportName}". Silakan sesuaikan rincian proposal.`
    });
  };

  // Save Proposal Draft
  const handleSaveProposalDraft = async () => {
    if (!canManageProposal) {
      setMessage({ type: 'error', text: 'Akun ini tidak memiliki akses untuk menyimpan proposal.' });
      return;
    }
    if (periodClosed) {
      setMessage({ type: 'error', text: 'Periode payroll sudah ditutup sehingga proposal tidak dapat diubah.' });
      return;
    }
    if (!reportName.trim()) {
      setMessage({ type: 'error', text: 'Nama Kegiatan / Proposal wajib diisi.' });
      return;
    }

    setSaving(true);
    try {
      const docId = selectedProposalId || `${periodToken}_prop_${Date.now()}`;

      const payload = {
        reportName,
        departmentUnit,
        period: periodToken,
        totalBudget: totalPengeluaranAnggaran || totalPemasukanAnggaran,
        pemasukanRows,
        yayasanPercentage,
        unipduPercentage,
        pengeluaranRows,
        kepanitiaaanPercentage,
        signatures: proposalSignatures,
        status: currentProposalStatus || 'proposal_draft',
        submittedBy: profile?.uid || null,
        submittedByName: profile?.displayName || null,
        submittedByEmail: profile?.email || null,
        expenseReports,
        updatedAt: serverTimestamp(),
      };

      await setDoc(doc(db, 'ProposalKegiatan', docId), sanitizeForFirestore(payload), { merge: true });
      setSelectedProposalId(docId);
      setMessage({ type: 'success', text: `Draft Proposal "${reportName}" berhasil disimpan.` });
    } catch (err) {
      console.error(err);
      setMessage({ type: 'error', text: 'Gagal menyimpan proposal.' });
    } finally {
      setSaving(false);
    }
  };

  // Delete Proposal Handler
  const handleDeleteProposal = async (id: string) => {
    if (!confirm('Apakah Anda yakin ingin menghapus proposal/laporan event ini? Data yang dihapus tidak dapat dikembalikan.')) return;
    setSaving(true);
    try {
      await deleteDoc(doc(db, 'ProposalKegiatan', id));
      resetForm();
      setMessage({ type: 'success', text: 'Proposal/laporan event berhasil dihapus.' });
    } catch (err) {
      console.error('Gagal menghapus proposal:', err);
      setMessage({ type: 'error', text: 'Gagal menghapus proposal event.' });
    } finally {
      setSaving(false);
    }
  };

  // Keep this callback stable. ExpenseReportStage uses it in its debounced
  // autosave effect; recreating it on every parent render would restart that
  // effect after each autosave and leave the UI stuck on "Menyimpan...".
  const handleUpsertExpenseReport = useCallback((report: ExpenseReport) => {
    setExpenseReports((prev) => [
      ...prev.filter((item) => item.id !== report.id),
      report,
    ]);
    setLpjPengeluaranRows((prev) => prev.map((row) => {
      if (row.type !== 'group_header' || row.rowId !== report.expenseRowId) return row;
      const linkedRow = clearExpenseReportLink(row);
      return { ...linkedRow, reportId: report.id };
    }));
    setMessage({ type: 'success', text: `Laporan untuk header "${report.expenseLabel}" berhasil disimpan.` });
  }, []);

  const handleUnlinkExpenseReport = (reportId: string) => {
    const report = expenseReports.find((item) => item.id === reportId);
    setExpenseReports((prev) => prev.filter((item) => item.id !== reportId));
    setLpjPengeluaranRows((prev) => prev.map((row) => row.reportId === reportId ? clearExpenseReportLink(row) : row));
    setReportEditorGroupId(null);
    setMessage({ type: 'success', text: `Hubungan laporan untuk header "${report?.expenseLabel || 'pengeluaran'}" dilepas.` });
  };

  const handlePrintExpenseReport = async (report: ExpenseReport) => {
    setPrintingReport(true);
    try {
      await generateLpjExpenseReportPdf({
        report,
        reportName: reportName || 'Kegiatan',
        period: `${MONTHS_ID[month - 1]} ${year}`,
        departmentUnit,
        signatures: lpjSignatures,
        expenseRows: lpjPengeluaranRows,
      });
    } catch (error) {
      console.error('Error generating expense report PDF:', error);
      setMessage({ type: 'error', text: 'Gagal membuat PDF laporan. Coba lagi.' });
    } finally {
      setPrintingReport(false);
    }
  };

  // Print PDF Handler
  const handlePrintPdf = async () => {
    if (activeStage === 'proposal') {
      generateProposalKegiatanPdf({
        reportName: reportName || 'Proposal Event',
        period: `${MONTHS_ID[month - 1]} ${year}`,
        departmentUnit,
        queueNumber: currentProposalQueueNo || undefined,
        pemasukanRows,
        yayasanPercentage,
        unipduPercentage,
        pengeluaranRows,
        kepanitiaaanPercentage,
        signatures: proposalSignatures,
      });
      return;
    }
    setPrintingPdf(true);
    try {
      await generateLpjPdf({
        reportName: reportName || 'Laporan Realisasi Event',
        period: `${MONTHS_ID[month - 1]} ${year}`,
        departmentUnit,
        signatures: lpjSignatures,
        realisasiEnabled,
        realisasiTitle,
        pemasukanRows: lpjPemasukanRows,
        pengeluaranRows: lpjPengeluaranRows,
        yayasanPercentage,
        unipduPercentage,
        kepanitiaaanPercentage,
        expenseReports,
      });
    } catch (error) {
      console.error('Error generating LPJ PDF:', error);
      setMessage({ type: 'error', text: 'Gagal membuat PDF LPJ. Coba lagi.' });
    } finally {
      setPrintingPdf(false);
    }
  };

  // Submit Proposal to FIFO Queue
  const handleSubmitProposalToQueue = async () => {
    if (!canManageProposal || periodClosed) {
      setMessage({ type: 'error', text: 'Proposal tidak dapat disimpan pada periode yang sudah ditutup.' });
      return;
    }
    if (!reportName.trim()) {
      setMessage({ type: 'error', text: 'Nama Kegiatan / Proposal wajib diisi.' });
      return;
    }

    setSaving(true);
    try {
      const docId = selectedProposalId || `${periodToken}_prop_${Date.now()}`;

      const existingQueues = proposalList
        .map(p => p.proposalQueueNumber)
        .filter((q): q is number => typeof q === 'number');
      const nextProposalQueueNo = existingQueues.length > 0 ? Math.max(...existingQueues) + 1 : 1;

      const payload = {
        reportName,
        departmentUnit,
        period: periodToken,
        totalBudget: totalPengeluaranAnggaran || totalPemasukanAnggaran,
        pemasukanRows,
        yayasanPercentage,
        unipduPercentage,
        pengeluaranRows,
        kepanitiaaanPercentage,
        signatures: proposalSignatures,
        status: 'proposal_submitted',
        proposalQueueNumber: nextProposalQueueNo,
        submittedBy: profile?.uid || null,
        submittedByName: profile?.displayName || null,
        submittedByEmail: profile?.email || null,
        expenseReports,
        proposalSubmittedAt: serverTimestamp(),
        reviewNote: null,
        reviewedBy: null,
        reviewedAt: null,
        updatedAt: serverTimestamp(),
      };

      await setDoc(doc(db, 'ProposalKegiatan', docId), sanitizeForFirestore(payload), { merge: true });
      setSelectedProposalId(docId);
      setCurrentProposalStatus('proposal_submitted');
      setCurrentProposalQueueNo(nextProposalQueueNo);
      setMessage({
        type: 'success',
        text: `Proposal Anggaran "${reportName}" berhasil disubmit ke antrean verifikasi Super Admin (Antrean #${nextProposalQueueNo}).`
      });
    } catch (err) {
      console.error(err);
      setMessage({ type: 'error', text: 'Gagal mengajukan proposal anggaran.' });
    } finally {
      setSaving(false);
    }
  };

  // Save LPJ Draft
  const handleSaveLpjDraft = async () => {
    if (!canManageProposal || periodClosed) {
      setMessage({ type: 'error', text: 'Draft LPJ tidak dapat disimpan pada periode yang sudah ditutup.' });
      return;
    }
    if (!selectedProposalId) {
      setMessage({ type: 'error', text: 'Pilih atau simpan proposal terlebih dahulu.' });
      return;
    }

    setSaving(true);
    try {
      const payload = {
        realisasiEnabled,
        vakasiPengujiEnabled,
        kepanitiaaanEnabled,
        receiptEnabled,
        realisasiTitle,
        lpjPemasukanRows,
        yayasanPercentage,
        unipduPercentage,
        lpjPengeluaranRows,
        vakasiPengujiTitle,
        vakasiRoles,
        vakasiPengujiRows,
        kepanitiaaanTitle,
        kepanitiaaanPhases,
        kepanitiaaanRows,
        receiptTitle,
        receiptRows,
        lpjSignatures,
        expenseReports,
        status: currentProposalStatus === 'proposal_approved' ? 'lpj_draft' : currentProposalStatus,
        updatedAt: serverTimestamp(),
      };

      await setDoc(doc(db, 'ProposalKegiatan', selectedProposalId), sanitizeForFirestore(payload), { merge: true });
      if (currentProposalStatus === 'proposal_approved') {
        setCurrentProposalStatus('lpj_draft');
      }
      setMessage({ type: 'success', text: `Draft LPJ / Realisasi "${reportName}" berhasil disimpan.` });
    } catch (err) {
      console.error(err);
      setMessage({ type: 'error', text: 'Gagal menyimpan draft LPJ.' });
    } finally {
      setSaving(false);
    }
  };

  // Submit LPJ to Admin
  const handleSubmitLpjToQueue = async () => {
    if (!canManageProposal || periodClosed) {
      setMessage({ type: 'error', text: 'LPJ tidak dapat disimpan pada periode yang sudah ditutup.' });
      return;
    }
    if (!selectedProposalId) {
      setMessage({ type: 'error', text: 'Pilih proposal yang telah disetujui terlebih dahulu.' });
      return;
    }

    setSaving(true);
    try {
      const payload = {
        realisasiEnabled,
        vakasiPengujiEnabled,
        kepanitiaaanEnabled,
        receiptEnabled,
        realisasiTitle,
        lpjPemasukanRows,
        yayasanPercentage,
        unipduPercentage,
        lpjPengeluaranRows,
        vakasiPengujiTitle,
        vakasiRoles,
        vakasiPengujiRows,
        kepanitiaaanTitle,
        kepanitiaaanPhases,
        kepanitiaaanRows,
        receiptTitle,
        receiptRows,
        lpjSignatures,
        expenseReports,
        status: 'lpj_submitted',
        lpjSubmittedAt: serverTimestamp(),
        reviewNote: null,
        updatedAt: serverTimestamp(),
      };

      await setDoc(doc(db, 'ProposalKegiatan', selectedProposalId), sanitizeForFirestore(payload), { merge: true });
      setCurrentProposalStatus('lpj_submitted');
      setMessage({
        type: 'success',
        text: `Laporan Realisasi (LPJ) "${reportName}" berhasil disubmit untuk pemeriksaan akhir BAK & Warek Keuangan.`
      });
    } catch (err) {
      console.error(err);
      setMessage({ type: 'error', text: 'Gagal mengajukan LPJ.' });
    } finally {
      setSaving(false);
    }
  };

  // Super Admin Review Handler
  const handleReviewDecision = async (
    target: 'proposal' | 'lpj',
    action: string,
    note: string
  ) => {
    if (!selectedProposalId) return;
    if (!canManageProposal || periodClosed) {
      setMessage({ type: 'error', text: 'Periode payroll sudah ditutup sehingga status proposal tidak dapat diubah.' });
      return;
    }
    setSaving(true);
    try {
      const updatePayload: Record<string, any> = {
        status: action,
        reviewedBy: profile?.uid || null,
        reviewedAt: serverTimestamp(),
        reviewNote: note || null,
        updatedAt: serverTimestamp(),
      };

      if (action === 'proposal_approved') {
        const defaultLpjPemasukan = pemasukanRows.map((r: any) => ({
          ...r,
          realisasi: parseQty(r.rincianQty) * (r.rincianRate || 0)
        }));
        const defaultLpjPengeluaran = pengeluaranRows.map((r: any) => ({
          ...r,
          realisasi: r.type === 'group_header' ? 0 : parseQty(r.rincianQty) * (r.rincianRate || 0)
        }));
        updatePayload.lpjPemasukanRows = defaultLpjPemasukan;
        updatePayload.lpjPengeluaranRows = defaultLpjPengeluaran;
        setLpjPemasukanRows(defaultLpjPemasukan);
        setLpjPengeluaranRows(defaultLpjPengeluaran);
      }

      if (target === 'lpj' && action === 'lpj_approved') {
        await authenticatedJson('/api/payroll/proposal-kegiatan/approve', {
          method: 'POST',
          body: JSON.stringify({ proposalId: selectedProposalId, note: note || null }),
        });
      } else {
        await setDoc(doc(db, 'ProposalKegiatan', selectedProposalId), sanitizeForFirestore(updatePayload), { merge: true });
      }

      let actionLabel = '';
      if (action === 'proposal_approved') actionLabel = 'Proposal Disetujui (Event Siap & LPJ Terbuka)';
      else if (action === 'proposal_revision') actionLabel = 'Proposal Diminta Revisi';
      else if (action === 'lpj_approved') actionLabel = 'LPJ Disetujui & Nominal Honorarium Cair ke Payroll!';
      else if (action === 'lpj_revision') actionLabel = 'LPJ Diminta Revisi';
      else actionLabel = 'Ditolak';

      setMessage({ type: 'success', text: `Status berhasil diubah: ${actionLabel}.` });

      if (currentSubmittedByEmail) {
        try {
          await fetch('/api/events/notification-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              recipientEmail: currentSubmittedByEmail,
              recipientName: currentSubmittedByName || 'Kepala SatKer',
              eventName: reportName,
              status: action,
              reviewNote: note,
            }),
          });
        } catch (emailErr) {
          console.error('Failed sending email notification:', emailErr);
        }
      }

      setShowReviewDialog(false);
      setReviewNoteInput('');
      setCurrentProposalStatus(action);
      setCurrentReviewNote(note || null);
    } catch (err) {
      console.error(err);
      setMessage({ type: 'error', text: 'Gagal memproses review.' });
    } finally {
      setSaving(false);
    }
  };

  const getStatusBadge = (item?: any) => {
    if (!item) return null;
    const st = typeof item === 'string' ? item : (item.status || 'proposal_draft');
    const qNo = typeof item === 'object' ? item.proposalQueueNumber : null;

    switch (st) {
      case 'proposal_draft':
      case 'draft':
        return <span className="text-[10px] font-bold px-2 py-0.5 rounded border bg-slate-50 text-slate-600 border-slate-200">1. Draft Proposal</span>;
      case 'proposal_submitted':
        return (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded border bg-indigo-50 text-indigo-700 border-indigo-200 animate-pulse flex items-center gap-1">
            <Clock className="w-3 h-3 text-indigo-500" /> Antrean Proposal {qNo ? `#${qNo}` : ''}
          </span>
        );
      case 'proposal_revision':
        return <span className="text-[10px] font-bold px-2 py-0.5 rounded border bg-orange-50 text-orange-700 border-orange-200">Revisi Proposal</span>;
      case 'proposal_approved':
        return (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded border bg-teal-50 text-teal-700 border-teal-200 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3 text-teal-600" /> Proposal Disetujui (LPJ Open)
          </span>
        );
      case 'lpj_draft':
        return <span className="text-[10px] font-bold px-2 py-0.5 rounded border bg-blue-50 text-blue-700 border-blue-200">2. Draft LPJ</span>;
      case 'lpj_submitted':
        return (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded border bg-purple-50 text-purple-700 border-purple-200 animate-pulse flex items-center gap-1">
            <Clock className="w-3 h-3 text-purple-500" /> Antrean LPJ
          </span>
        );
      case 'lpj_revision':
        return <span className="text-[10px] font-bold px-2 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-200">Revisi LPJ</span>;
      case 'lpj_approved':
        return (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded border bg-emerald-50 text-emerald-700 border-emerald-200 flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-emerald-600" /> LPJ Disetujui & Payroll Cair
          </span>
        );
      case 'declined':
        return <span className="text-[10px] font-bold px-2 py-0.5 rounded border bg-rose-50 text-rose-700 border-rose-200">Ditolak</span>;
      default:
        return null;
    }
  };

  const fmtRp = (n: number) => 'Rp\u00a0' + Math.round(n).toLocaleString('id-ID');

  return (
    <div className="space-y-6">
      {/* Messages */}
      {message && (
        <div className={`flex items-center gap-2 px-4 py-3 rounded-2xl text-sm font-medium ${message.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {message.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          <div className="whitespace-pre-line">{message.text}</div>
        </div>
      )}

      {/* ── TOP SECTION: Dedicated Event List Carousel / Cards Grid ── */}
      <Card className="bg-white rounded-[20px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-none p-4 md:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <h3 className="font-bold text-slate-800 text-sm md:text-base flex items-center gap-2">
              <Layers className="w-5 h-5 text-indigo-500" />
              Daftar Event & Proposal Kegiatan Periode {MONTHS_ID[month - 1]} {year}
            </h3>
            <p className="text-slate-400 text-xs mt-0.5">Pilih event untuk mengedit proposal anggaran atau mengisi Laporan LPJ pertanggungjawaban.</p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              onClick={handleOpenCloneModal}
              variant="outline"
              className="rounded-xl border-purple-200 text-purple-700 bg-purple-50 hover:bg-purple-100 transition-all font-semibold flex items-center gap-2 text-xs h-9 cursor-pointer"
            >
              <Copy className="w-4 h-4 text-purple-600" /> Kloning Anggaran Event Lalu
            </Button>
            <Button
              onClick={handlePrintPdf}
              disabled={printingPdf}
              variant="outline"
              className="rounded-xl border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 font-semibold flex items-center gap-2 text-xs h-9 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {printingPdf ? <Loader2 className="w-4 h-4 animate-spin text-indigo-600" /> : <FileDown className="w-4 h-4 text-indigo-600" />} Cetak {activeStage === 'proposal' ? 'Proposal' : 'LPJ'} (PDF)
              </Button>
          </div>
        </div>

        {/* Carousel / Grid list */}
        {loadingProposal ? (
          <div className="py-12 flex justify-center text-slate-400"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {/* Buat Proposal Baru Card */}
            <div
              onClick={() => resetForm()}
              className="p-4 rounded-2xl border-2 border-dashed border-slate-200 hover:border-indigo-400 hover:bg-indigo-50/10 transition-all cursor-pointer flex flex-col items-center justify-center min-h-[110px] gap-2 text-center group"
            >
              <Plus className="w-6 h-6 text-slate-400 group-hover:text-indigo-600 group-hover:scale-110 transition-all" />
              <span className="text-xs font-bold text-slate-600 group-hover:text-indigo-600">Buat Proposal Event Baru</span>
            </div>

            {/* Current Draft Card (If not selected from list) */}
            {!selectedProposalId && (
              <div className="p-4 rounded-2xl border bg-indigo-50/40 border-indigo-200 shadow-sm flex flex-col justify-between min-h-[110px] scale-[1.02]">
                <div>
                  <p className="font-bold text-indigo-700 text-sm line-clamp-1 italic">
                    {reportName.trim() !== '' ? reportName : 'Proposal Baru (Tanpa Judul)'}
                  </p>
                  <p className="text-[10px] text-indigo-500 font-bold mt-1 uppercase tracking-wider">{departmentUnit || 'Belum Pilih Unit'}</p>
                </div>
                <div className="flex items-center justify-between mt-3">
                  <span className="text-[10px] font-bold text-indigo-600 bg-indigo-100/60 px-2 py-0.5 rounded">
                    1. Form Proposal Anggaran
                  </span>
                </div>
              </div>
            )}

            {/* List of Proposals */}
            {proposalList.map(item => {
              const isActive = selectedProposalId === item.id;
              return (
                <div
                  key={item.id}
                  onClick={() => handleSelectProposal(item)}
                  className={`p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between min-h-[110px] ${isActive
                    ? 'bg-indigo-50/60 border-indigo-300 shadow-md ring-1 ring-indigo-300/30 scale-[1.02]'
                    : 'bg-white border-slate-100 hover:border-indigo-150 hover:shadow-sm'
                    }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-1">
                      <p className="font-bold text-slate-800 text-sm line-clamp-1">{item.reportName || item.title}</p>
                    </div>
                    <p className="text-[10px] text-slate-400 font-bold mt-1 uppercase tracking-wider">{item.departmentUnit || 'UMUM'}</p>
                  </div>
                  <div className="flex items-center justify-between mt-3 pt-2 border-t border-slate-100/60">
                    <div>{getStatusBadge(item)}</div>
                    <span className="text-[10px] font-bold text-slate-700">{fmtRp(item.totalBudget || 0)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* ── MAIN SECTION: Full-Width Sequential Creation Card ── */}
      <Card className="bg-white rounded-[20px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-none p-4 md:p-6 space-y-6">
        {/* Header & Stage Selector Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3">
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="font-bold text-slate-800 text-base md:text-lg flex items-center gap-2">
                  {reportName.trim() !== '' ? reportName : 'Form Event & Realisasi Kegiatan'}
                </h2>
                {isProposalReadOnly && activeStage === 'proposal' && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200/80 shadow-2xs">
                    <Lock className="w-3 h-3 text-amber-600" />
                    Terkunci
                  </span>
                )}
              </div>
              <p className="text-slate-400 text-xs mt-0.5">Alur berurutan: Proposal Anggaran ➔ Approval Ketua BAK & WarKu ➔ Pelaporan Realisasi (LPJ).</p>
            </div>

            {/* Real-time Auto-save Indicator Badge */}
            {autoSaveStatus === 'saving' && (
              <span className="flex items-center gap-1.5 text-xs text-indigo-600 font-bold bg-indigo-50 px-3 py-1 rounded-xl animate-pulse border border-indigo-100 shrink-0">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Menyimpan progress...
              </span>
            )}
            {autoSaveStatus === 'saved' && (
              <span className="flex items-center gap-1.5 text-xs text-emerald-700 font-bold bg-emerald-50 px-3 py-1 rounded-xl border border-emerald-100 shrink-0">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Progress tersimpan otomatis
              </span>
            )}
            {autoSaveStatus === 'error' && (
              <span className="flex items-center gap-1.5 text-xs text-rose-700 font-bold bg-rose-50 px-3 py-1 rounded-xl border border-rose-100 shrink-0">
                <AlertCircle className="w-3.5 h-3.5 text-rose-600" /> Gagal simpan otomatis
              </span>
            )}
          </div>

          {/* Sequential Stage Switcher Tabs */}
          <div className="flex items-center bg-slate-100 p-1 rounded-2xl gap-1">
            <button
              onClick={() => setActiveStage('proposal')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${activeStage === 'proposal'
                ? 'bg-white text-indigo-600 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
                }`}
            >
              <span>1. Pengajuan Anggaran (Proposal)</span>
            </button>

            <button
              onClick={() => {
                setActiveStage('lpj');
                if (pemasukanRows && pemasukanRows.length > 0 && pemasukanRows.some(r => r.uraian.trim())) {
                  const isLpjPemasukanEmpty = lpjPemasukanRows.length === 1 && !lpjPemasukanRows[0].uraian;
                  if (isLpjPemasukanEmpty) {
                    setLpjPemasukanRows(pemasukanRows.map(r => ({ ...r, realisasi: parseQty(r.rincianQty) * (r.rincianRate || 0) })));
                  }
                }
                if (pengeluaranRows && pengeluaranRows.length > 0 && pengeluaranRows.some(r => r.uraian.trim())) {
                  const isLpjPengeluaranEmpty = lpjPengeluaranRows.length === 1 && !lpjPengeluaranRows[0].uraian;
                  if (isLpjPengeluaranEmpty) {
                    setLpjPengeluaranRows(pengeluaranRows.map(r => ({ ...r, realisasi: r.type === 'group_header' ? 0 : parseQty(r.rincianQty) * (r.rincianRate || 0) })));
                  }
                }
              }}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${activeStage === 'lpj'
                ? 'bg-white text-indigo-600 shadow-sm'
                : 'text-slate-500 hover:text-slate-800'
                }`}
            >
              {!isProposalApproved ? (
                <Lock className="w-3.5 h-3.5 text-amber-500" />
              ) : (
                <Unlock className="w-3.5 h-3.5 text-teal-600" />
              )}
              <span>2. Pelaporan Realisasi (LPJ)</span>
            </button>

          </div>
        </div>

        {/* Letterhead Banner */}
        <div className="border border-slate-200/80 rounded-2xl p-4 bg-slate-50/40 relative overflow-hidden flex items-center gap-4">
          <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-50/30 rounded-full blur-2xl pointer-events-none" />
          <img src="/Logo UNIPDU.png" alt="UNIPDU" className="w-12 h-12 shrink-0 object-contain" />
          <div className="space-y-0.5">
            <h4 className="text-xs font-black text-slate-800 tracking-wide uppercase">UNIVERSITAS PESANTREN TINGGI DARUL 'ULUM</h4>
            <p className="text-[10px] text-slate-500 font-medium">Pusat Pengisian Gaji & Administrasi Keuangan Kepegawaian</p>
          </div>
        </div>

        {/* Event Meta Inputs */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Nama Event / Kegiatan</label>
            <Input
              type="text"
              placeholder="Contoh: Reuni SainTek 2026"
              value={reportName}
              disabled={isProposalReadOnly}
              onChange={(e) => setReportName(e.target.value)}
              className={`rounded-xl font-bold text-xs h-11 w-full transition-all ${isProposalReadOnly ? 'bg-slate-100/90 border-transparent text-slate-800 disabled:opacity-100 cursor-default shadow-none' : 'border-slate-200 text-slate-900'}`}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Unit Kerja Pelaksana</label>
            <Select
              value={departmentUnit}
              disabled={isProposalReadOnly}
              onValueChange={(v) => setDepartmentUnit(v || '')}
            >
              <SelectTrigger className={`rounded-xl text-sm font-bold h-11 border focus:ring-4 focus:ring-indigo-100 transition-all ${isProposalReadOnly ? 'bg-slate-100/90 border-transparent text-slate-800 disabled:opacity-100 cursor-default shadow-none' : departmentUnit ? 'bg-indigo-50/60 border-indigo-200 text-indigo-700' : 'bg-white border-slate-200 text-slate-400'}`}>
                <div className="flex items-center gap-2 min-w-0">
                  <Building2 className="w-4 h-4 shrink-0" />
                  <SelectValue placeholder="Pilih Unit Kerja..." />
                </div>
              </SelectTrigger>
              <SelectContent className="rounded-2xl border border-slate-100 shadow-2xl bg-white p-1.5 max-h-64 overflow-y-auto w-max min-w-[var(--radix-select-trigger-width)]">
                {departments.map(d => (
                  <SelectItem key={d} value={d} className="rounded-xl text-xs font-bold uppercase text-slate-900 data-[highlighted]:bg-indigo-50 data-[highlighted]:text-indigo-700 cursor-pointer">{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* ── STAGE 1: PROPOSAL ANGGARAN FORM (EXACT UI & UX OF SEKSI 1 WITHOUT REALISASI COLUMN) ── */}
        {activeStage === 'proposal' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            {/* Revision Note Banner */}
            {currentProposalStatus === 'proposal_revision' && currentReviewNote && (
              <div className="p-4 bg-orange-50 border border-orange-200 rounded-2xl flex gap-3 text-orange-900 text-xs shadow-sm">
                <AlertTriangle className="w-5 h-5 text-orange-500 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-orange-800 text-sm mb-1">Catatan Revisi Proposal dari Super Admin</p>
                  <p className="leading-relaxed font-semibold">{currentReviewNote}</p>
                </div>
              </div>
            )}

            {/* Proposal Approved Banner */}
            {isProposalApproved && (
              <div className="p-4 bg-teal-50 border border-teal-200 rounded-2xl flex items-center justify-between gap-3 text-teal-900 text-xs shadow-sm">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-6 h-6 text-teal-600 shrink-0" />
                  <div>
                    <p className="font-bold text-teal-800 text-sm">Proposal Anggaran Disetujui & Ditandatangani!</p>
                    <p className="leading-relaxed font-medium">Ketua BAK dan Wakil Rektor Keuangan telah menyetujui anggaran ini. Pengisian LPJ kini dibuka.</p>
                  </div>
                </div>
                <Button
                  onClick={() => setActiveStage('lpj')}
                  className="rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs h-9 px-4 shrink-0 shadow"
                >
                  Buka Form LPJ <Unlock className="w-3.5 h-3.5 ml-1.5" />
                </Button>
              </div>
            )}

            {/* Section Header */}
            <div className="border border-slate-150 rounded-2xl overflow-hidden bg-white shadow-sm p-4 md:p-5 space-y-6">
              <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
                <Receipt className="w-4 h-4 text-indigo-600" />
                <span className="font-bold text-indigo-900 text-xs uppercase tracking-wider">Proposal Rencana Anggaran Keuangan</span>
              </div>

              {/* PART 1: PEMASUKAN */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-emerald-800 uppercase tracking-wider bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-100 font-sans">1. Pemasukan (Rencana Pendapatan Kegiatan)</span>
                </div>
                <div className="border border-slate-150 rounded-2xl shadow-sm overflow-x-auto bg-white">
                  <table className="w-full text-left border-collapse min-w-[600px]">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-100">
                        <th className="px-3 py-2.5 text-[10px] font-bold text-slate-500 uppercase w-12 text-center">NO</th>
                        <th className="px-3 py-2.5 text-[10px] font-bold text-slate-500 uppercase w-[45%]">URAIAN PEMASUKAN</th>
                        <th className="px-3 py-2.5 text-[10px] font-bold text-slate-500 uppercase w-[150px] text-center">QTY</th>
                        <th className="px-3 py-2.5 text-[10px] font-bold text-slate-500 uppercase w-[140px] text-center">RATE</th>
                        <th className="px-3 py-2.5 text-[10px] font-bold text-slate-500 uppercase w-[180px] text-right">ESTIMASI ANGGARAN</th>
                        <th className="px-3 py-2.5 w-20 text-center"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {pemasukanRows.map((row, idx) => {
                        const anggaran = parseQty(row.rincianQty) * row.rincianRate;
                        const insertPemasukanBelow = () => {
                          setPemasukanRows(prev => {
                            const c = [...prev];
                            c.splice(idx + 1, 0, { uraian: '', rincianQty: '', rincianRate: 0 });
                            return c;
                          });
                        };
                        return (
                          <tr key={idx} className="border-b border-slate-50 hover:bg-slate-50/30 transition-colors">
                            <td className="px-3 py-2 text-xs font-bold text-slate-400 text-center">{idx + 1}</td>
                            <td className="px-3 py-2">
                              <Input
                                type="text"
                                placeholder="Biaya Test, Kontribusi, dll..."
                                value={row.uraian}
                                disabled={isProposalReadOnly}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setPemasukanRows(prev => {
                                    const c = [...prev];
                                    c[idx] = { ...c[idx], uraian: val };
                                    return c;
                                  });
                                }}
                                onKeyDown={(e) => handleRowCellKeyDown(e, isProposalReadOnly ? undefined : insertPemasukanBelow)}
                                className={`rounded-lg font-medium text-xs h-8 w-full transition-all ${isProposalReadOnly ? 'bg-slate-100/90 border-transparent text-slate-800 font-bold disabled:opacity-100 cursor-default shadow-none' : 'border-slate-200 text-slate-900'}`}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <Input
                                type="text"
                                placeholder="250 Siswa"
                                value={row.rincianQty}
                                disabled={isProposalReadOnly}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setPemasukanRows(prev => {
                                    const c = [...prev];
                                    c[idx] = { ...c[idx], rincianQty: val };
                                    return c;
                                  });
                                }}
                                onKeyDown={(e) => handleRowCellKeyDown(e, isProposalReadOnly ? undefined : insertPemasukanBelow)}
                                className={`rounded-lg font-bold text-xs h-8 w-full text-center transition-all ${isProposalReadOnly ? 'bg-slate-100/90 border-transparent text-slate-800 disabled:opacity-100 cursor-default shadow-none' : 'border-slate-200 text-slate-900'}`}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <Input
                                type="text"
                                inputMode="numeric"
                                placeholder="0"
                                value={row.rincianRate > 0 ? fmtRp(row.rincianRate) : ''}
                                disabled={isProposalReadOnly}
                                onChange={(e) => {
                                  const val = parseInt(e.target.value.replace(/\D/g, ''), 10) || 0;
                                  setPemasukanRows(prev => {
                                    const c = [...prev];
                                    c[idx] = { ...c[idx], rincianRate: val };
                                    return c;
                                  });
                                }}
                                onKeyDown={(e) => handleRowCellKeyDown(e, isProposalReadOnly ? undefined : insertPemasukanBelow)}
                                className={`rounded-lg font-bold text-xs h-8 w-full text-right transition-all ${isProposalReadOnly ? 'bg-slate-100/90 border-transparent text-slate-800 disabled:opacity-100 cursor-default shadow-none' : 'border-slate-200 text-slate-900'}`}
                              />
                            </td>
                            <td className="px-3 py-2 text-xs font-bold text-slate-700 text-right font-mono">{fmtRp(anggaran)}</td>
                            <td className="px-3 py-2 text-center">
                              {!isProposalReadOnly && (
                                <div className="flex items-center justify-center gap-1">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    title="Sisipkan baris di bawah"
                                    onClick={() => {
                                      setPemasukanRows(prev => {
                                        const c = [...prev];
                                        c.splice(idx + 1, 0, { uraian: '', rincianQty: '', rincianRate: 0 });
                                        return c;
                                      });
                                    }}
                                    className="h-7 w-7 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg cursor-pointer"
                                  >
                                    <Plus className="w-3.5 h-3.5" />
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    title="Hapus baris"
                                    onClick={() => setPemasukanRows(prev => prev.filter((_, i) => i !== idx))}
                                    className="h-7 w-7 text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {!isProposalReadOnly && (
                        <tr className="border-b border-slate-100 hover:bg-slate-50/10 transition-colors">
                          <td></td>
                          <td colSpan={5} className="px-3 py-2">
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => setPemasukanRows(prev => [...prev, { uraian: '', rincianQty: '', rincianRate: 0 }])}
                              className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold rounded-xl text-xs flex items-center gap-1 cursor-pointer"
                            >
                              <Plus className="w-3.5 h-3.5" /> Tambah Pemasukan
                            </Button>
                          </td>
                        </tr>
                      )}
                      <tr className="bg-slate-50 border-t border-slate-200 font-semibold">
                        <td colSpan={4} className="px-3 py-2.5 text-xs font-bold text-slate-900 text-right">Total Pemasukan Anggaran</td>
                        <td className="px-3 py-2.5 text-xs font-black text-slate-900 text-right font-mono">{fmtRp(totalPemasukanAnggaran)}</td>
                        <td></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* PART 2: DANA PENGEMBANGAN & DANA OPERASIONAL */}
              <div className="bg-slate-50/55 border border-slate-150 rounded-2xl p-4 md:p-5 space-y-4">
                <span className="text-xs font-bold text-slate-850 uppercase tracking-wider bg-white px-2.5 py-1 rounded-lg border border-slate-200 shadow-2xs block w-fit font-sans">2. Alokasi Dana Pengembangan & Operasional</span>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5 bg-white p-3.5 rounded-xl border border-slate-200/60">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1 font-sans">Dana Pengembangan Yayasan (%)</label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={yayasanPercentage}
                        disabled={isProposalReadOnly}
                        onChange={(e) => setYayasanPercentage(parseFloat(e.target.value) || 0)}
                        className={`rounded-lg font-bold text-xs h-8 w-20 text-center transition-all ${isProposalReadOnly ? 'bg-slate-100/90 border-transparent text-slate-800 disabled:opacity-100 cursor-default shadow-none' : 'border-slate-200 text-slate-900'}`}
                      />
                      <span className="text-xs font-bold text-slate-500">%</span>
                      <div className="text-right ml-auto text-xs font-semibold text-slate-600">
                        Anggaran: <span className="font-bold text-slate-900 font-mono">{fmtRp(yayasanAnggaran)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1.5 bg-white p-3.5 rounded-xl border border-slate-200/60">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1 font-sans">Dana Pengembangan UNIPDU (%)</label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={unipduPercentage}
                        disabled={isProposalReadOnly}
                        onChange={(e) => setUnipduPercentage(parseFloat(e.target.value) || 0)}
                        className={`rounded-lg font-bold text-xs h-8 w-20 text-center transition-all ${isProposalReadOnly ? 'bg-slate-100/90 border-transparent text-slate-800 disabled:opacity-100 cursor-default shadow-none' : 'border-slate-200 text-slate-900'}`}
                      />
                      <span className="text-xs font-bold text-slate-500">%</span>
                      <div className="text-right ml-auto text-xs font-semibold text-slate-600">
                        Anggaran: <span className="font-bold text-slate-900 font-mono">{fmtRp(unipduAnggaran)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-indigo-900/95 text-white p-4 rounded-xl border border-indigo-950 flex flex-col md:flex-row items-center justify-between gap-4 shadow-md">
                  <div>
                    <h4 className="text-sm font-bold uppercase tracking-wider text-indigo-200 font-sans">Dana Operasional (Batas Pengeluaran)</h4>
                    <p className="text-[11px] text-indigo-300 mt-0.5 font-sans">Rumus: Pemasukan - (Dana Pengembangan Yayasan + UNIPDU)</p>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] uppercase tracking-wider text-indigo-300 block font-sans">Anggaran Operasional</span>
                    <span className="text-lg font-black font-mono">{fmtRp(danaOperasionalAnggaran)}</span>
                  </div>
                </div>
              </div>

              {/* PART 3: PENGELUARAN */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-indigo-850 uppercase tracking-wider bg-indigo-50 px-2.5 py-1 rounded-lg border border-indigo-100 font-sans">3. Rencana Pengeluaran (Biaya Operasional Kegiatan)</span>
                </div>
                <div className="border border-slate-150 rounded-2xl shadow-sm overflow-x-auto bg-white">
                  <table className="w-full text-left border-collapse min-w-[600px]">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-100">
                        <th className="px-2.5 py-1.5 text-[10px] font-bold text-slate-500 uppercase w-12 text-center">NO</th>
                        <th className="px-2.5 py-1.5 text-[10px] font-bold text-slate-500 uppercase w-[45%]">URAIAN PENGELUARAN</th>
                        <th className="px-2.5 py-1.5 text-[10px] font-bold text-slate-500 uppercase w-[150px] text-center">QTY</th>
                        <th className="px-2.5 py-1.5 text-[10px] font-bold text-slate-500 uppercase w-[140px] text-center">RATE</th>
                        <th className="px-2.5 py-1.5 text-[10px] font-bold text-slate-500 uppercase w-[180px] text-right">ESTIMASI ANGGARAN</th>
                        <th className="px-2.5 py-1.5 w-20 text-center"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {pengeluaranRows.map((row, idx) => {
                        const lastHeaderIdx = pengeluaranRows.slice(0, idx + 1).findLastIndex(r => r.type === 'group_header');
                        const itemNum = row.type === 'item'
                          ? pengeluaranRows.slice(lastHeaderIdx === -1 ? 0 : lastHeaderIdx, idx + 1).filter(r => r.type === 'item').length
                          : null;
                        const insertPengeluaranItemBelow = () => {
                          setPengeluaranRows(prev => {
                            const c = [...prev];
                            c.splice(idx + 1, 0, { type: 'item', uraian: '', rincianQty: '', rincianRate: 0 });
                            return c;
                          });
                        };
                        const insertPengeluaranHeaderBelow = () => {
                          setPengeluaranRows(prev => {
                            const c = [...prev];
                            c.splice(idx + 1, 0, { type: 'group_header', uraian: '', rincianQty: '', rincianRate: 0 });
                            return c;
                          });
                        };
                        if (row.type === 'group_header') {
                          return (
                            <tr key={idx} className="bg-slate-50/60 border-b border-slate-100">
                              <td className="px-2.5 py-1.5 text-xs font-bold text-slate-400 text-center"></td>
                              <td colSpan={4} className="px-2.5 py-1.5">
                                <Input
                                  type="text"
                                  placeholder="Nama grup (e.g., A. Pengeluaran Panitia)..."
                                  value={row.uraian}
                                  disabled={isProposalReadOnly}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setPengeluaranRows(prev => {
                                      const c = [...prev];
                                      c[idx] = { ...c[idx], uraian: val };
                                      return c;
                                    });
                                  }}
                                  onKeyDown={(e) => handleRowCellKeyDown(e, isProposalReadOnly ? undefined : insertPengeluaranItemBelow)}
                                  className={`rounded-lg font-bold text-slate-800 text-xs h-7.5 w-full transition-all ${isProposalReadOnly ? 'bg-slate-100/90 border-transparent text-slate-800 disabled:opacity-100 cursor-default shadow-none' : 'bg-transparent border-none focus:ring-0'}`}
                                />
                              </td>
                              <td className="px-2.5 py-1.5 text-center">
                                {!isProposalReadOnly && (
                                  <div className="flex items-center justify-center gap-1">
                                    <InsertRowButton
                                      title="Sisipkan baris di bawah (tahan untuk tambah header grup)"
                                      onPress={insertPengeluaranItemBelow}
                                      onLongPress={insertPengeluaranHeaderBelow}
                                      className="h-7 w-7 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg cursor-pointer"
                                    />
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      title="Hapus baris"
                                      onClick={() => {
                                        setPengeluaranRows(prev => prev.filter((_, i) => i !== idx));
                                      }}
                                      className="h-7 w-7 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </Button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        }
                        const anggaran = parseQty(row.rincianQty) * row.rincianRate;
                        return (
                          <tr key={idx} className="border-b border-slate-50 hover:bg-slate-50/30 transition-colors">
                            <td className="px-2.5 py-1 text-xs font-bold text-slate-400 text-center">{itemNum}</td>
                            <td className="px-2.5 py-1">
                              <Input
                                type="text"
                                placeholder="Uraian pengeluaran..."
                                value={row.uraian}
                                disabled={isProposalReadOnly}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setPengeluaranRows(prev => {
                                    const c = [...prev];
                                    c[idx] = { ...c[idx], uraian: val };
                                    return c;
                                  });
                                }}
                                onKeyDown={(e) => handleRowCellKeyDown(e, isProposalReadOnly ? undefined : insertPengeluaranItemBelow)}
                                className={`rounded-lg font-medium text-xs h-7.5 w-full transition-all ${isProposalReadOnly ? 'bg-slate-100/90 border-transparent text-slate-800 font-bold disabled:opacity-100 cursor-default shadow-none' : 'border-slate-200 text-slate-900'}`}
                              />
                            </td>
                            <td className="px-2.5 py-1">
                              <Input
                                type="text"
                                placeholder="Nilai / Presentase"
                                value={row.rincianQty}
                                disabled={isProposalReadOnly}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setPengeluaranRows(prev => {
                                    const c = [...prev];
                                    c[idx] = { ...c[idx], rincianQty: val };
                                    return c;
                                  });
                                }}
                                onKeyDown={(e) => handleRowCellKeyDown(e, isProposalReadOnly ? undefined : insertPengeluaranItemBelow)}
                                className={`rounded-lg font-bold text-xs h-7.5 w-full text-center transition-all ${isProposalReadOnly ? 'bg-slate-100/90 border-transparent text-slate-800 disabled:opacity-100 cursor-default shadow-none' : 'border-slate-200 text-slate-900'}`}
                              />
                            </td>
                            <td className="px-2.5 py-1">
                              <Input
                                type="text"
                                inputMode="numeric"
                                placeholder="0"
                                value={row.rincianRate > 0 ? fmtRp(row.rincianRate) : ''}
                                disabled={isProposalReadOnly}
                                onChange={(e) => {
                                  const val = parseInt(e.target.value.replace(/\D/g, ''), 10) || 0;
                                  setPengeluaranRows(prev => {
                                    const c = [...prev];
                                    c[idx] = { ...c[idx], rincianRate: val };
                                    return c;
                                  });
                                }}
                                onKeyDown={(e) => handleRowCellKeyDown(e, isProposalReadOnly ? undefined : insertPengeluaranItemBelow)}
                                className={`rounded-lg font-bold text-xs h-7.5 w-full text-right transition-all ${isProposalReadOnly ? 'bg-slate-100/90 border-transparent text-slate-800 disabled:opacity-100 cursor-default shadow-none' : 'border-slate-200 text-slate-900'}`}
                              />
                            </td>
                            <td className="px-2.5 py-1 text-xs font-bold text-slate-700 text-right font-mono">{fmtRp(anggaran)}</td>
                            <td className="px-2.5 py-1 text-center">
                              {!isProposalReadOnly && (
                                <div className="flex items-center justify-center gap-1">
                                  <div className="relative">
                                    <InsertRowButton
                                      title="Sisipkan baris di bawah (tahan untuk tambah header grup)"
                                      onPress={() => setActiveInsertMenuIdx(activeInsertMenuIdx === idx ? null : idx)}
                                      onLongPress={() => {
                                        setActiveInsertMenuIdx(null);
                                        setPengeluaranRows(prev => {
                                          const c = [...prev];
                                          c.splice(idx + 1, 0, { type: 'group_header', uraian: '', rincianQty: '', rincianRate: 0 });
                                          return c;
                                        });
                                      }}
                                      className="h-7 w-7 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg cursor-pointer"
                                    />
                                    {activeInsertMenuIdx === idx && (
                                      <div className="absolute right-0 top-8 z-30 bg-white rounded-xl shadow-xl border border-slate-150 p-1 min-w-[170px] animate-in fade-in zoom-in-95 duration-150">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setPengeluaranRows(prev => {
                                              const c = [...prev];
                                              c.splice(idx + 1, 0, { type: 'item', uraian: '', rincianQty: '', rincianRate: 0 });
                                              return c;
                                            });
                                            setActiveInsertMenuIdx(null);
                                          }}
                                          className="w-full text-left px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 rounded-lg flex items-center gap-2 cursor-pointer"
                                        >
                                          <Plus className="w-3.5 h-3.5 text-indigo-500" /> Baris Pengeluaran
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setPengeluaranRows(prev => {
                                              const c = [...prev];
                                              c.splice(idx + 1, 0, { type: 'group_header', uraian: '', rincianQty: '', rincianRate: 0 });
                                              return c;
                                            });
                                            setActiveInsertMenuIdx(null);
                                          }}
                                          className="w-full text-left px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-purple-50 hover:text-purple-700 rounded-lg flex items-center gap-2 cursor-pointer"
                                        >
                                          <Plus className="w-3.5 h-3.5 text-purple-500" /> Header Grup Baru
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    title="Hapus baris"
                                    onClick={() => {
                                      setPengeluaranRows(prev => prev.filter((_, i) => i !== idx));
                                    }}
                                    className="h-7 w-7 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {!isProposalReadOnly && (
                        <tr className="border-b border-slate-100 hover:bg-slate-50/10 transition-colors">
                          <td></td>
                          <td colSpan={5} className="px-3 py-3">
                            <div className="flex items-center gap-2">
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => setPengeluaranRows(prev => [...prev, { type: 'item', uraian: '', rincianQty: '', rincianRate: 0 }])}
                                className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold rounded-xl text-xs flex items-center gap-1 cursor-pointer"
                              >
                                <Plus className="w-3.5 h-3.5" /> Tambah Baris
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => setPengeluaranRows(prev => [...prev, { type: 'group_header', uraian: '', rincianQty: '', rincianRate: 0 }])}
                                variant="outline"
                                className="border-indigo-200 text-indigo-600 font-bold rounded-xl text-xs flex items-center gap-1 cursor-pointer"
                              >
                                <Layers className="w-3.5 h-3.5" /> Tambah Header Grup
                              </Button>
                            </div>
                          </td>
                        </tr>
                      )}
                      <tr className="bg-slate-50 border-t border-slate-200">
                        <td colSpan={4} className="px-3 py-2.5 text-xs font-bold text-slate-900 text-right">Jumlah Pengeluaran Operasional</td>
                        <td className="px-3 py-2.5 text-xs font-black text-slate-800 text-right font-mono">{fmtRp(jumlahPengeluaranAnggaran)}</td>
                        <td></td>
                      </tr>
                      <tr className="bg-slate-50/50">
                        <td colSpan={3} className="px-3 py-2 text-xs font-bold text-slate-650 text-right">Kepanitiaan</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1 justify-end">
                            <Input
                              type="number"
                              value={kepanitiaaanPercentage}
                              disabled={isProposalReadOnly}
                              onChange={(e) => setKepanitiaaanPercentage(parseFloat(e.target.value) || 0)}
                              className={`rounded-lg font-bold text-xs h-7 w-16 text-center transition-all ${isProposalReadOnly ? 'bg-slate-100/90 border-transparent text-slate-800 disabled:opacity-100 cursor-default shadow-none' : 'border-slate-200 text-slate-900'}`}
                            />
                            <span className="text-xs font-bold text-slate-550">%</span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-xs font-bold text-slate-800 text-right font-mono">{fmtRp(kepanitiaaanAnggaran)}</td>
                        <td></td>
                      </tr>
                      <tr className="bg-slate-100/80 font-bold border-t border-slate-200">
                        <td colSpan={4} className="px-3 py-2.5 text-xs font-black text-slate-900 text-right uppercase">Total Pengeluaran Kegiatan</td>
                        <td className="px-3 py-2.5 text-xs font-black text-slate-950 text-right font-mono">{fmtRp(totalPengeluaranAnggaran)}</td>
                        <td></td>
                      </tr>
                      <tr className={`font-bold border-t ${sisaAnggaran >= 0 ? 'bg-emerald-50/70 text-emerald-950' : 'bg-rose-50/70 text-rose-950'}`}>
                        <td colSpan={4} className="px-3 py-3 text-xs font-black text-right uppercase">Sisa Dana Operasional</td>
                        <td className="px-3 py-3 text-sm font-black text-right font-mono">{fmtRp(sisaAnggaran)}</td>
                        <td></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Stage 1 Actions */}
            <div className="flex flex-wrap justify-between items-center gap-3 pt-6 border-t border-slate-100 mt-6">
              <div>
                {selectedProposalId && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleDeleteProposal(selectedProposalId)}
                    className="rounded-xl border-rose-200 text-rose-600 bg-rose-50/50 hover:bg-rose-50 text-xs font-bold flex items-center gap-1.5 h-10 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" /> Hapus Laporan
                  </Button>
                )}
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {autoSaveStatus === 'saving' && (
                  <span className="text-slate-400 text-[11px] font-medium flex items-center gap-1.5 animate-pulse mr-2 font-sans">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />
                    Menyimpan draft...
                  </span>
                )}
                {autoSaveStatus === 'saved' && (
                  <span className="text-emerald-600 text-[11px] font-semibold flex items-center gap-1 mr-2 font-sans">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    Draft disimpan otomatis
                  </span>
                )}
                {autoSaveStatus === 'error' && (
                  <span className="text-rose-500 text-[11px] font-semibold flex items-center gap-1 mr-2 font-sans">
                    <AlertCircle className="w-3.5 h-3.5 text-rose-500" />
                    Gagal menyimpan otomatis
                  </span>
                )}

                {!isProposalReadOnly && canManageProposal && (
                  <Button
                    type="button"
                    onClick={handleSaveProposalDraft}
                    disabled={saving}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl px-6 text-xs flex items-center gap-1.5 shadow-md h-10 cursor-pointer"
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Simpan Laporan
                  </Button>
                )}

                <Button
                  type="button"
                  onClick={handlePrintPdf}
                  disabled={printingPdf}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl px-6 text-xs flex items-center gap-1.5 shadow-md h-10 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {printingPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />} {printingPdf ? 'Membuat PDF...' : 'Cetak PDF'}
                </Button>

                {profile?.role === 'satker_head_loyalis' && (!currentProposalStatus || currentProposalStatus === 'proposal_draft' || currentProposalStatus === 'proposal_revision') && (
                  <Button
                    onClick={handleSubmitProposalToQueue}
                    disabled={saving}
                    className="rounded-xl px-6 bg-slate-900 hover:bg-black text-white font-bold text-xs h-10 flex items-center gap-2 shadow-md cursor-pointer"
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    Submit Proposal ke Admin
                  </Button>
                )}

                {/* Super Admin Review Actions for Proposal */}
                {profile?.role === 'super_admin' && selectedProposalId && (
                  <div className="flex gap-2">
                    {currentProposalStatus !== 'proposal_approved' && !currentProposalStatus?.startsWith('lpj_') && (
                      <Button
                        onClick={() => { setReviewTarget('proposal'); setReviewAction('proposal_approved'); handleReviewDecision('proposal', 'proposal_approved', ''); }}
                        disabled={saving}
                        className="rounded-xl px-5 bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs h-10 flex items-center gap-1.5 shadow-md cursor-pointer"
                      >
                        <CheckCircle className="w-4 h-4" /> Setujui Proposal
                      </Button>
                    )}
                    <Button
                      onClick={() => { setReviewTarget('proposal'); setReviewAction('proposal_revision'); setReviewNoteInput(''); setShowReviewDialog(true); }}
                      disabled={saving}
                      className="rounded-xl px-5 bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs h-10 flex items-center gap-1.5 shadow-md cursor-pointer"
                    >
                      <RotateCcw className="w-4 h-4" /> {currentProposalStatus === 'proposal_approved' || currentProposalStatus?.startsWith('lpj_') ? 'Batalkan Persetujuan (Minta Revisi)' : 'Minta Revisi Proposal'}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── STAGE 2: LAPORAN REALISASI (LPJ) FORM (EXACT 4 SECTIONS MATCHING PELAPORAN KEGIATAN PAGE) ── */}
        {activeStage === 'lpj' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            {/* Locked Warning Banner */}
            {!isProposalApproved ? (
              <div className="p-6 bg-amber-50/60 border border-amber-200/80 rounded-2xl text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center mx-auto shadow-sm">
                  <Lock className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="font-bold text-slate-800 text-sm">Pelaporan Realisasi (LPJ) Masih Terkunci</h4>
                  <p className="text-slate-500 text-xs max-w-lg mx-auto mt-1">
                    Proposal Anggaran <span className="font-semibold text-slate-700">"{reportName || 'Event Ini'}"</span> harus disetujui & ditandatangani terlebih dahulu oleh Ketua BAK dan Wakil Rektor Keuangan.
                  </p>
                </div>
                <div className="pt-2">
                  <Button
                    onClick={() => setActiveStage('proposal')}
                    variant="outline"
                    className="rounded-xl border-amber-300 text-amber-800 hover:bg-amber-100 font-bold text-xs h-9 px-4"
                  >
                    <ArrowLeft className="w-4 h-4 mr-1.5" /> Kembali ke Proposal Anggaran
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {/* LPJ Revision Banner */}
                {currentProposalStatus === 'lpj_revision' && currentReviewNote && (
                  <div className="p-4 bg-orange-50 border border-orange-200 rounded-2xl flex gap-3 text-orange-900 text-xs shadow-sm">
                    <AlertTriangle className="w-5 h-5 text-orange-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold text-orange-800 text-sm mb-1">Catatan Revisi LPJ dari Super Admin</p>
                      <p className="leading-relaxed font-semibold">{currentReviewNote}</p>
                    </div>
                  </div>
                )}

                {/* LPJ Approved Banner */}
                {currentProposalStatus === 'lpj_approved' && (
                  <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex gap-3 text-emerald-900 text-xs shadow-sm">
                    <Sparkles className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold text-emerald-800 text-sm mb-0.5">LPJ Disetujui & Pencairan Dana Selesai!</p>
                      <p className="leading-relaxed font-medium">Laporan pertanggungjawaban kegiatan disetujui secara final. Nominal honorarium/vakasi otomatis disinkronkan ke payroll pegawai.</p>
                    </div>
                  </div>
                )}

                {/* Section Toggles Header Bar */}
                <div className="flex flex-wrap gap-3 pt-2">
                  {[
                    { key: 'realisasi', label: 'Realisasi Keuangan', enabled: realisasiEnabled, toggle: setRealisasiEnabled, icon: <Receipt className="w-3.5 h-3.5" /> },
                  ].map(s => (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => s.toggle(!s.enabled)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer border ${s.enabled
                        ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                        : 'bg-slate-50 border-slate-150 text-slate-400'
                        }`}
                    >
                      {s.enabled ? <ToggleRight className="w-4 h-4 text-indigo-500" /> : <ToggleLeft className="w-4 h-4" />}
                      {s.icon}
                      {s.label}
                    </button>
                  ))}
                </div>

                {/* SEKSI 1: REALISASI KEUANGAN (FULL COMPREHENSIVE) */}
                {realisasiEnabled && (() => {
                  const totalPemasukanAnggaranLPJ = lpjPemasukanRows.reduce((sum, r) => sum + (parseQty(r.rincianQty) * r.rincianRate), 0);
                  const totalPemasukanRealisasiLPJ = lpjPemasukanRows.reduce((sum, r) => sum + r.realisasi, 0);

                  const yayasanAnggaranLPJ = totalPemasukanAnggaranLPJ * (yayasanPercentage / 100);
                  const yayasanRealisasiLPJ = totalPemasukanRealisasiLPJ * (yayasanPercentage / 100);
                  const unipduAnggaranLPJ = totalPemasukanAnggaranLPJ * (unipduPercentage / 100);
                  const unipduRealisasiLPJ = totalPemasukanRealisasiLPJ * (unipduPercentage / 100);
                  const totalPengembanganAnggaranLPJ = yayasanAnggaranLPJ + unipduAnggaranLPJ;
                  const totalPengembanganRealisasiLPJ = yayasanRealisasiLPJ + unipduRealisasiLPJ;

                  const danaOperasionalAnggaranLPJ = totalPemasukanAnggaranLPJ - totalPengembanganAnggaranLPJ;
                  const danaOperasionalRealisasiLPJ = totalPemasukanRealisasiLPJ - totalPengembanganRealisasiLPJ;

                  const expItemsLPJ = lpjPengeluaranRows.filter(r => r.type === 'item' && r.uraian.trim());
                  const jumlahPengeluaranAnggaranLPJ = expItemsLPJ.reduce((sum, r) => sum + (parseQty(r.rincianQty) * r.rincianRate), 0);
                  const jumlahPengeluaranRealisasiLPJ = expItemsLPJ.reduce((sum, r) => sum + (r.realisasi || 0), 0);

                  const kepanitiaaanAnggaranLPJ = jumlahPengeluaranAnggaranLPJ * (kepanitiaaanPercentage / 100);
                  const kepanitiaaanRealisasiLPJ = jumlahPengeluaranAnggaranLPJ * (kepanitiaaanPercentage / 100);

                  const totalPengeluaranAnggaranLPJ = jumlahPengeluaranAnggaranLPJ + kepanitiaaanAnggaranLPJ;
                  const totalPengeluaranRealisasiLPJ = jumlahPengeluaranRealisasiLPJ + kepanitiaaanRealisasiLPJ;

                  const sisaAnggaranLPJ = danaOperasionalAnggaranLPJ - totalPengeluaranAnggaranLPJ;
                  const sisaRealisasiLPJ = danaOperasionalRealisasiLPJ - totalPengeluaranRealisasiLPJ;

                  return (
                    <div className="border border-slate-150 rounded-2xl overflow-hidden">
                      <button
                        type="button"
                        onClick={() => toggleSection('realisasi')}
                        className="w-full flex items-center justify-between px-5 py-3.5 bg-gradient-to-r from-emerald-50 to-emerald-50/40 hover:from-emerald-100/60 transition-all cursor-pointer"
                      >
                        <div className="flex items-center gap-2.5">
                          <Receipt className="w-4 h-4 text-emerald-600" />
                          <span className="font-bold text-emerald-800 text-xs uppercase tracking-wider">Seksi 1: Realisasi Keuangan</span>
                        </div>
                        {expandedSections.realisasi ? <ChevronDown className="w-4 h-4 text-emerald-500" /> : <ChevronRight className="w-4 h-4 text-emerald-500" />}
                      </button>

                      {expandedSections.realisasi && (
                        <div className="p-4 md:p-5 space-y-6 bg-white">
                          <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Judul Seksi (di PDF)</label>
                            <Input
                              type="text"
                              placeholder="REALISASI..."
                              value={realisasiTitle}
                              onChange={(e) => setRealisasiTitle(e.target.value)}
                              className="rounded-xl border-slate-200 font-bold text-slate-900 text-xs h-10 w-full uppercase"
                            />
                          </div>

                          {/* PART A: PEMASUKAN */}
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-emerald-800 uppercase tracking-wider bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-100 font-sans">1. Pemasukan (Pendapatan Kegiatan)</span>
                            </div>
                            <div className="border border-slate-150 rounded-2xl shadow-sm overflow-x-auto bg-white">
                              <table className="w-full text-left border-collapse min-w-[700px]">
                                <thead>
                                  <tr className="bg-slate-50 border-b border-slate-100">
                                    <th className="px-3 py-2.5 text-[10px] font-bold text-slate-500 uppercase w-12 text-center">NO</th>
                                    <th className="px-3 py-2.5 text-[10px] font-bold text-slate-500 uppercase w-[35%]">URAIAN PEMASUKAN</th>
                                    <th className="px-3 py-2.5 text-[10px] font-bold text-slate-500 uppercase w-[150px] text-center">QTY</th>
                                    <th className="px-3 py-2.5 text-[10px] font-bold text-slate-500 uppercase w-[120px] text-center">RATE</th>
                                    <th className="px-3 py-2.5 text-[10px] font-bold text-slate-500 uppercase w-[160px] text-right">ANGGARAN</th>
                                    <th className="px-3 py-2.5 text-[10px] font-bold text-slate-500 uppercase w-[160px] text-right">REALISASI</th>
                                    <th className="px-3 py-2.5 w-20 text-center"></th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {lpjPemasukanRows.map((row, idx) => {
                                    const anggaran = parseQty(row.rincianQty) * row.rincianRate;
                                    const insertLpjPemasukanBelow = () => {
                                      setLpjPemasukanRows(prev => { const c = [...prev]; c.splice(idx + 1, 0, { uraian: '', rincianQty: '', rincianRate: 0, realisasi: 0 }); return c; });
                                    };
                                    return (
                                      <tr key={idx} className="border-b border-slate-50 hover:bg-slate-50/30 transition-colors">
                                        <td className="px-3 py-2 text-xs font-bold text-slate-400 text-center">{idx + 1}</td>
                                        <td className="px-3 py-2"><Input type="text" placeholder="Biaya Test, Kontribusi, dll..." value={row.uraian} onChange={(e) => { const val = e.target.value; setLpjPemasukanRows(prev => { const c = [...prev]; c[idx] = { ...c[idx], uraian: val }; return c; }); }} onKeyDown={(e) => handleRowCellKeyDown(e, insertLpjPemasukanBelow)} className="rounded-lg border-slate-200 font-medium text-slate-900 text-xs h-8 w-full" /></td>
                                        <td className="px-3 py-2"><Input type="text" placeholder="250 Siswa" value={row.rincianQty} onChange={(e) => { const val = e.target.value; setLpjPemasukanRows(prev => { const c = [...prev]; const oldAnggaran = parseQty(c[idx].rincianQty) * c[idx].rincianRate; const isRealisasiMatching = c[idx].realisasi === oldAnggaran || c[idx].realisasi === 0; c[idx] = { ...c[idx], rincianQty: val }; if (isRealisasiMatching) { c[idx].realisasi = parseQty(val) * c[idx].rincianRate; } return c; }); }} onKeyDown={(e) => handleRowCellKeyDown(e, insertLpjPemasukanBelow)} className="rounded-lg border-slate-200 font-bold text-slate-900 text-xs h-8 w-full text-center" /></td>
                                        <td className="px-3 py-2"><Input type="text" inputMode="numeric" placeholder="0" value={row.rincianRate > 0 ? fmtRp(row.rincianRate) : ''} onChange={(e) => { const val = parseInt(e.target.value.replace(/\D/g, ''), 10) || 0; setLpjPemasukanRows(prev => { const c = [...prev]; const oldAnggaran = parseQty(c[idx].rincianQty) * c[idx].rincianRate; const isRealisasiMatching = c[idx].realisasi === oldAnggaran || c[idx].realisasi === 0; c[idx] = { ...c[idx], rincianRate: val }; if (isRealisasiMatching) { c[idx].realisasi = parseQty(c[idx].rincianQty) * val; } return c; }); }} onKeyDown={(e) => handleRowCellKeyDown(e, insertLpjPemasukanBelow)} className="rounded-lg border-slate-200 font-bold text-slate-900 text-xs h-8 w-full text-right" /></td>
                                        <td className="px-3 py-2 text-xs font-bold text-slate-600 text-right font-mono">{fmtRp(anggaran)}</td>
                                        <td className="px-3 py-2"><Input type="text" inputMode="numeric" placeholder="0" value={row.realisasi > 0 ? fmtRp(row.realisasi) : ''} onChange={(e) => { const val = parseInt(e.target.value.replace(/\D/g, ''), 10) || 0; setLpjPemasukanRows(prev => { const c = [...prev]; c[idx] = { ...c[idx], realisasi: val }; return c; }); }} onKeyDown={(e) => handleRowCellKeyDown(e, insertLpjPemasukanBelow)} className="rounded-lg border-slate-200 font-bold text-slate-900 text-xs h-8 w-full text-right" /></td>
                                        <td className="px-3 py-2 text-center">
                                          <div className="flex items-center justify-center gap-1">
                                            <Button type="button" variant="ghost" size="icon" title="Sisipkan baris di bawah" onClick={() => { setLpjPemasukanRows(prev => { const c = [...prev]; c.splice(idx + 1, 0, { uraian: '', rincianQty: '', rincianRate: 0, realisasi: 0 }); return c; }); }} className="h-7 w-7 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg cursor-pointer">
                                              <Plus className="w-3.5 h-3.5" />
                                            </Button>
                                            <Button type="button" variant="ghost" size="icon" title="Hapus baris" onClick={() => setLpjPemasukanRows(prev => prev.filter((_, i) => i !== idx))} className="h-7 w-7 text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer">
                                              <Trash2 className="w-3.5 h-3.5" />
                                            </Button>
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                  <tr className="border-b border-slate-100 hover:bg-slate-50/10 transition-colors">
                                    <td></td>
                                    <td colSpan={6} className="px-3 py-2">
                                      <Button type="button" size="sm" onClick={() => setLpjPemasukanRows(prev => [...prev, { uraian: '', rincianQty: '', rincianRate: 0, realisasi: 0 }])} className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold rounded-xl text-xs flex items-center gap-1 cursor-pointer">
                                        <Plus className="w-3.5 h-3.5" /> Tambah Pemasukan
                                      </Button>
                                    </td>
                                  </tr>
                                  <tr className="bg-slate-50 border-t border-slate-200 font-semibold">
                                    <td colSpan={4} className="px-3 py-2.5 text-xs font-bold text-slate-900 text-right">Total Pemasukan</td>
                                    <td className="px-3 py-2.5 text-xs font-black text-slate-800 text-right font-mono">{fmtRp(totalPemasukanAnggaranLPJ)}</td>
                                    <td className="px-3 py-2.5 text-xs font-black text-slate-800 text-right font-mono">{fmtRp(totalPemasukanRealisasiLPJ)}</td>
                                    <td></td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                          </div>

                          {/* PART B: DANA PENGEMBANGAN & DANA OPERASIONAL */}
                          <div className="bg-slate-50/55 border border-slate-150 rounded-2xl p-4 md:p-5 space-y-4">
                            <span className="text-xs font-bold text-slate-850 uppercase tracking-wider bg-white px-2.5 py-1 rounded-lg border border-slate-200 shadow-2xs block w-fit font-sans">2. Alokasi Dana Pengembangan & Operasional</span>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="space-y-1.5 bg-white p-3.5 rounded-xl border border-slate-200/60">
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1 font-sans">Dana Pengembangan Yayasan (%)</label>
                                <div className="flex items-center gap-2">
                                  <Input type="number" min={0} max={100} value={yayasanPercentage} onChange={(e) => setYayasanPercentage(parseFloat(e.target.value) || 0)} className="rounded-lg border-slate-200 font-bold text-slate-900 text-xs h-8 w-20 text-center" />
                                  <span className="text-xs font-bold text-slate-500">%</span>
                                  <div className="text-right ml-auto text-xs font-semibold text-slate-600">
                                    Anggaran: <span className="font-bold text-slate-900 font-mono">{fmtRp(yayasanAnggaranLPJ)}</span>
                                    <br />
                                    Realisasi: <span className="font-bold text-slate-900 font-mono">{fmtRp(yayasanRealisasiLPJ)}</span>
                                  </div>
                                </div>
                              </div>

                              <div className="space-y-1.5 bg-white p-3.5 rounded-xl border border-slate-200/60">
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1 font-sans">Dana Pengembangan UNIPDU (%)</label>
                                <div className="flex items-center gap-2">
                                  <Input type="number" min={0} max={100} value={unipduPercentage} onChange={(e) => setUnipduPercentage(parseFloat(e.target.value) || 0)} className="rounded-lg border-slate-200 font-bold text-slate-900 text-xs h-8 w-20 text-center" />
                                  <span className="text-xs font-bold text-slate-500">%</span>
                                  <div className="text-right ml-auto text-xs font-semibold text-slate-600">
                                    Anggaran: <span className="font-bold text-slate-900 font-mono">{fmtRp(unipduAnggaranLPJ)}</span>
                                    <br />
                                    Realisasi: <span className="font-bold text-slate-900 font-mono">{fmtRp(unipduRealisasiLPJ)}</span>
                                  </div>
                                </div>
                              </div>
                            </div>

                            <div className="bg-indigo-900/95 text-white p-4 rounded-xl border border-indigo-950 flex flex-col md:flex-row items-center justify-between gap-4 shadow-md">
                              <div>
                                <h4 className="text-sm font-bold uppercase tracking-wider text-indigo-200 font-sans">Dana Operasional (Sisa untuk Pengeluaran)</h4>
                                <p className="text-[11px] text-indigo-300 mt-0.5 font-sans">Rumus: Pemasukan - (Dana Pengembangan Yayasan + UNIPDU)</p>
                              </div>
                              <div className="flex gap-6 text-center md:text-right">
                                <div>
                                  <span className="text-[10px] uppercase tracking-wider text-indigo-300 block font-sans">Anggaran Operasional</span>
                                  <span className="text-base font-black font-mono">{fmtRp(danaOperasionalAnggaranLPJ)}</span>
                                </div>
                                <div className="border-l border-indigo-800/60 hidden md:block"></div>
                                <div>
                                  <span className="text-[10px] uppercase tracking-wider text-indigo-300 block font-sans">Realisasi Operasional</span>
                                  <span className="text-base font-black font-mono">{fmtRp(danaOperasionalRealisasiLPJ)}</span>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* PART C: PENGELUARAN */}
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-indigo-850 uppercase tracking-wider bg-indigo-50 px-2.5 py-1 rounded-lg border border-indigo-100 font-sans">3. Pengeluaran (Biaya Operasional Kegiatan)</span>
                            </div>
                            <div className="border border-slate-150 rounded-2xl shadow-sm overflow-x-auto bg-white">
                              <table className="w-full text-left border-collapse min-w-[700px]">
                                <thead>
                                  <tr className="bg-slate-50 border-b border-slate-100">
                                    <th className="px-3 py-2.5 text-[10px] font-bold text-slate-500 uppercase w-12 text-center">NO</th>
                                    <th className="px-3 py-2.5 text-[10px] font-bold text-slate-500 uppercase w-[35%]">URAIAN PENGELUARAN</th>
                                    <th className="px-3 py-2.5 text-[10px] font-bold text-slate-500 uppercase w-[150px] text-center">QTY</th>
                                    <th className="px-3 py-2.5 text-[10px] font-bold text-slate-500 uppercase w-[120px] text-center">RATE</th>
                                    <th className="px-3 py-2.5 text-[10px] font-bold text-slate-500 uppercase w-[160px] text-right">ANGGARAN</th>
                                    <th className="px-3 py-2.5 text-[10px] font-bold text-slate-500 uppercase w-[160px] text-right">REALISASI</th>
                                    <th className="px-3 py-2.5 w-20 text-center"></th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {lpjPengeluaranRows.map((row, idx) => {
                                    const lastHeaderIdx = lpjPengeluaranRows.slice(0, idx + 1).findLastIndex(r => r.type === 'group_header');
                                    const itemNum = row.type === 'item' ? lpjPengeluaranRows.slice(lastHeaderIdx === -1 ? 0 : lastHeaderIdx, idx + 1).filter(r => r.type === 'item').length : null;
                                    const insertLpjPengeluaranItemBelow = () => {
                                      setLpjPengeluaranRows(prev => { const c = [...prev]; c.splice(idx + 1, 0, { ...createProposalExpenseRow('item'), realisasi: 0 }); return c; });
                                    };
                                    const insertLpjPengeluaranHeaderBelow = () => {
                                      setLpjPengeluaranRows(prev => { const c = [...prev]; c.splice(idx + 1, 0, { ...createProposalExpenseRow('group_header'), realisasi: 0 }); return c; });
                                    };
                                    if (row.type === 'group_header') {
                                      return (
                                        <tr key={idx} className="bg-slate-50/60 border-b border-slate-100">
                                          <td className="px-3 py-2.5 text-xs font-bold text-slate-400 text-center"></td>
                                          <td colSpan={5} className="px-3 py-2.5"><Input type="text" placeholder="Nama grup (e.g., A. Pengeluaran Panitia)..." value={row.uraian} onChange={(e) => { const val = e.target.value; setLpjPengeluaranRows(prev => { const c = [...prev]; c[idx] = { ...c[idx], uraian: val }; return c; }); }} onKeyDown={(e) => handleRowCellKeyDown(e, insertLpjPengeluaranItemBelow)} className="rounded-lg border-slate-200 font-bold text-slate-800 text-xs h-8 w-full bg-transparent border-none focus:ring-0" /></td>
                                          <td className="px-3 py-2.5 text-center">
                                            <div className="flex items-center justify-center gap-1">
                                              <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                disabled={(!row.reportId && isLpjReadOnly) || !row.rowId}
                                                onClick={() => setReportEditorGroupId(row.rowId || null)}
                                                className={`h-7 rounded-lg px-2 text-[10px] font-bold ${row.reportId
                                                  ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                                  : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'}`}
                                              >
                                                <Link2 className="mr-1 h-3 w-3" /> {row.reportId ? 'Buka Laporan' : 'Hubungkan Laporan'}
                                              </Button>
                                              <InsertRowButton
                                                title="Sisipkan baris di bawah (tahan untuk tambah header grup)"
                                                onPress={insertLpjPengeluaranItemBelow}
                                                onLongPress={insertLpjPengeluaranHeaderBelow}
                                                className="h-7 w-7 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg cursor-pointer"
                                              />
                                              <Button type="button" variant="ghost" size="icon" title="Hapus grup" onClick={() => { if (row.reportId) setExpenseReports(prev => prev.filter((report) => report.id !== row.reportId)); setLpjPengeluaranRows(prev => prev.filter((_, i) => i !== idx)); }} className="h-7 w-7 text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer">
                                                <Trash2 className="w-3.5 h-3.5" />
                                              </Button>
                                            </div>
                                          </td>
                                        </tr>
                                      );
                                    }
                                    const anggaran = parseQty(row.rincianQty) * row.rincianRate;
                                    return (
                                      <tr key={idx} className="border-b border-slate-50 hover:bg-slate-50/30 transition-colors">
                                        <td className="px-3 py-2 text-xs font-bold text-slate-400 text-center">{itemNum}</td>
                                        <td className="px-3 py-2"><Input type="text" placeholder="Uraian pengeluaran..." value={row.uraian} onChange={(e) => { const val = e.target.value; setLpjPengeluaranRows(prev => { const c = [...prev]; c[idx] = { ...c[idx], uraian: val }; return c; }); }} onKeyDown={(e) => handleRowCellKeyDown(e, insertLpjPengeluaranItemBelow)} className="rounded-lg border-slate-200 font-medium text-slate-900 text-xs h-8 w-full" /></td>
                                        <td className="px-3 py-2"><Input type="text" placeholder="10 / 20%" value={row.rincianQty} onChange={(e) => { const val = e.target.value; setLpjPengeluaranRows(prev => { const c = [...prev]; const oldAnggaran = parseQty(c[idx].rincianQty) * c[idx].rincianRate; const isRealisasiMatching = c[idx].realisasi === oldAnggaran || c[idx].realisasi === 0; c[idx] = { ...c[idx], rincianQty: val }; if (isRealisasiMatching) { c[idx].realisasi = parseQty(val) * c[idx].rincianRate; } return c; }); }} onKeyDown={(e) => handleRowCellKeyDown(e, insertLpjPengeluaranItemBelow)} className="rounded-lg border-slate-200 font-bold text-slate-900 text-xs h-8 w-full text-center" /></td>
                                        <td className="px-3 py-2"><Input type="text" inputMode="numeric" placeholder="0" value={row.rincianRate > 0 ? fmtRp(row.rincianRate) : ''} onChange={(e) => { const val = parseInt(e.target.value.replace(/\D/g, ''), 10) || 0; setLpjPengeluaranRows(prev => { const c = [...prev]; const oldAnggaran = parseQty(c[idx].rincianQty) * c[idx].rincianRate; const isRealisasiMatching = c[idx].realisasi === oldAnggaran || c[idx].realisasi === 0; c[idx] = { ...c[idx], rincianRate: val }; if (isRealisasiMatching) { c[idx].realisasi = parseQty(c[idx].rincianQty) * val; } return c; }); }} onKeyDown={(e) => handleRowCellKeyDown(e, insertLpjPengeluaranItemBelow)} className="rounded-lg border-slate-200 font-bold text-slate-900 text-xs h-8 w-full text-right" /></td>
                                        <td className="px-3 py-2 text-xs font-bold text-slate-600 text-right font-mono">{fmtRp(anggaran)}</td>
                                        <td className="px-3 py-2"><Input type="text" inputMode="numeric" placeholder="0" value={(row.realisasi || 0) > 0 ? fmtRp(row.realisasi || 0) : ''} onChange={(e) => { const val = parseInt(e.target.value.replace(/\D/g, ''), 10) || 0; setLpjPengeluaranRows(prev => { const c = [...prev]; c[idx] = { ...c[idx], realisasi: val }; return c; }); }} onKeyDown={(e) => handleRowCellKeyDown(e, insertLpjPengeluaranItemBelow)} className="rounded-lg border-slate-200 font-bold text-slate-900 text-xs h-8 w-full text-right" /></td>
                                        <td className="px-3 py-2 text-center">
                                          <div className="flex items-center justify-center gap-1">
                                            <div className="relative">
                                              <InsertRowButton
                                                title="Sisipkan baris di bawah (tahan untuk tambah header grup)"
                                                onPress={() => setActiveInsertMenuIdx(activeInsertMenuIdx === idx ? null : idx)}
                                                onLongPress={() => {
                                                  setActiveInsertMenuIdx(null);
                                                  insertLpjPengeluaranHeaderBelow();
                                                }}
                                                className="h-7 w-7 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg cursor-pointer"
                                              />
                                              {activeInsertMenuIdx === idx && (
                                                <>
                                                  <div className="fixed inset-0 z-40" onClick={() => setActiveInsertMenuIdx(null)} />
                                                  <div className="absolute right-0 bottom-8 z-50 w-44 bg-white border border-slate-150 rounded-xl shadow-xl py-1.5 text-left">
                                                    <button type="button" onClick={() => { setLpjPengeluaranRows(prev => { const c = [...prev]; c.splice(idx + 1, 0, { ...createProposalExpenseRow('item'), realisasi: 0 }); return c; }); setActiveInsertMenuIdx(null); }} className="w-full px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-indigo-50 hover:text-indigo-600 flex items-center gap-2 transition-colors cursor-pointer"><FileText className="w-3.5 h-3.5 text-indigo-500" /><span>Baris Biasa</span></button>
                                                    <button type="button" onClick={() => { setLpjPengeluaranRows(prev => { const c = [...prev]; c.splice(idx + 1, 0, { ...createProposalExpenseRow('group_header'), realisasi: 0 }); return c; }); setActiveInsertMenuIdx(null); }} className="w-full px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-indigo-50 hover:text-indigo-600 flex items-center gap-2 transition-colors cursor-pointer"><Layers className="w-3.5 h-3.5 text-indigo-500" /><span>Header Grup</span></button>
                                                  </div>
                                                </>
                                              )}
                                            </div>
                                            <Button type="button" variant="ghost" size="icon" title="Hapus baris" onClick={() => setLpjPengeluaranRows(prev => prev.filter((_, i) => i !== idx))} className="h-7 w-7 text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer">
                                              <Trash2 className="w-3.5 h-3.5" />
                                            </Button>
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                  <tr className="border-b border-slate-100 hover:bg-slate-50/10 transition-colors">
                                    <td></td>
                                    <td colSpan={6} className="px-3 py-3">
                                      <div className="flex items-center gap-2">
                                        <Button type="button" size="sm" onClick={() => setLpjPengeluaranRows(prev => [...prev, { ...createProposalExpenseRow('item'), realisasi: 0 }])} className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold rounded-xl text-xs flex items-center gap-1 cursor-pointer">
                                          <Plus className="w-3.5 h-3.5" /> Tambah Baris
                                        </Button>
                                        <Button type="button" size="sm" onClick={() => setLpjPengeluaranRows(prev => [...prev, { ...createProposalExpenseRow('group_header'), realisasi: 0 }])} variant="outline" className="border-indigo-200 text-indigo-600 font-bold rounded-xl text-xs flex items-center gap-1 cursor-pointer">
                                          <Layers className="w-3.5 h-3.5" /> Tambah Header Grup
                                        </Button>
                                      </div>
                                    </td>
                                  </tr>
                                  <tr className="bg-slate-50 border-t border-slate-200">
                                    <td colSpan={4} className="px-3 py-2.5 text-xs font-bold text-slate-900 text-right">Jumlah Pengeluaran</td>
                                    <td className="px-3 py-2.5 text-xs font-black text-slate-800 text-right font-mono">{fmtRp(jumlahPengeluaranAnggaranLPJ)}</td>
                                    <td className="px-3 py-2.5 text-xs font-black text-slate-800 text-right font-mono">{fmtRp(jumlahPengeluaranRealisasiLPJ)}</td>
                                    <td></td>
                                  </tr>
                                  <tr className="bg-slate-50/50">
                                    <td colSpan={3} className="px-3 py-2 text-xs font-bold text-slate-650 text-right">Kepanitiaan</td>
                                    <td className="px-3 py-2"><div className="flex items-center gap-1 justify-end"><Input type="number" value={kepanitiaaanPercentage} onChange={(e) => setKepanitiaaanPercentage(parseFloat(e.target.value) || 0)} className="rounded-lg border-slate-200 font-bold text-slate-900 text-xs h-7 w-16 text-center" /><span className="text-xs font-bold text-slate-550">%</span></div></td>
                                    <td className="px-3 py-2 text-xs font-bold text-slate-600 text-right font-mono">{fmtRp(kepanitiaaanAnggaranLPJ)}</td>
                                    <td className="px-3 py-2 text-xs font-bold text-slate-600 text-right font-mono">{fmtRp(kepanitiaaanRealisasiLPJ)}</td>
                                    <td></td>
                                  </tr>
                                  <tr className="bg-slate-50 border-t border-slate-200 font-semibold">
                                    <td colSpan={4} className="px-3 py-2.5 text-xs font-black text-slate-900 text-right uppercase">Total Pengeluaran</td>
                                    <td className="px-3 py-2.5 text-xs font-black text-slate-800 text-right font-mono">{fmtRp(totalPengeluaranAnggaranLPJ)}</td>
                                    <td className="px-3 py-2.5 text-xs font-black text-slate-800 text-right font-mono">{fmtRp(totalPengeluaranRealisasiLPJ)}</td>
                                    <td></td>
                                  </tr>
                                  <tr className={`border-t-2 border-slate-200 ${sisaAnggaranLPJ >= 0 ? 'bg-emerald-50/40' : 'bg-rose-50/40'}`}>
                                    <td colSpan={4} className={`px-3 py-3 text-xs font-black text-right uppercase ${sisaAnggaranLPJ >= 0 ? 'text-emerald-800' : 'text-rose-800'}`}>Sisa / Defisit Dana Operasional</td>
                                    <td className={`px-3 py-3 text-xs font-black text-right font-mono ${sisaAnggaranLPJ >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{sisaAnggaranLPJ < 0 ? '-' : ''}{fmtRp(Math.abs(sisaAnggaranLPJ))}</td>
                                    <td className={`px-3 py-3 text-xs font-black text-right font-mono ${sisaRealisasiLPJ >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{sisaRealisasiLPJ < 0 ? '-' : ''}{fmtRp(Math.abs(sisaRealisasiLPJ))}</td>
                                    <td></td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}



                <ExpenseReportStage
                  expenseRows={lpjPengeluaranRows}
                  expenseReports={expenseReports}
                  employees={loyalisEmployees}
                  unlocked={isProposalApproved}
                  readOnly={isLpjReadOnly}
                  openGroupRowId={reportEditorGroupId}
                  onOpenGroupHandled={() => setReportEditorGroupId(null)}
                  onUpsertReport={handleUpsertExpenseReport}
                  onUnlinkReport={handleUnlinkExpenseReport}
                  onPrintReport={handlePrintExpenseReport}
                  printingReport={printingReport}
                  fmtRp={fmtRp}
                  parseQty={parseQty}
                />

                {/* Legacy LPJ fields remain in storage/PDF payloads but are no
                    longer separate user-facing report sections. */}
                {/* SEKSI 3: VAKASI KEPANITIAAN */}
                {false && kepanitiaaanEnabled && (
                  <div className="border border-slate-150 rounded-2xl overflow-hidden">
                    <button type="button" onClick={() => toggleSection('kepanitiaan')} className="w-full flex items-center justify-between px-5 py-3.5 bg-gradient-to-r from-violet-50 to-violet-50/40 hover:from-violet-100/60 transition-all cursor-pointer">
                      <div className="flex items-center gap-2.5">
                        <Layers className="w-4 h-4 text-violet-600" />
                        <span className="font-bold text-violet-800 text-xs uppercase tracking-wider">Seksi 3: Vakasi Kepanitiaan</span>
                      </div>
                      {expandedSections.kepanitiaan ? <ChevronDown className="w-4 h-4 text-violet-500" /> : <ChevronRight className="w-4 h-4 text-violet-500" />}
                    </button>

                    {expandedSections.kepanitiaan && (
                      <div className="p-4 md:p-5 space-y-4 bg-white">
                        <div className="space-y-2">
                          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Judul Seksi (di PDF)</label>
                          <Input type="text" placeholder="VAKASI KEPANITIAAN..." value={kepanitiaaanTitle} onChange={(e) => setKepanitiaaanTitle(e.target.value)} className="rounded-xl border-slate-200 font-bold text-slate-900 text-xs h-10 w-full uppercase" />
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Tahap / Fase</span>
                            <Button type="button" size="sm" onClick={() => setKepanitiaaanPhases(prev => [...prev, { name: '' }])} className="bg-violet-50 hover:bg-violet-100 text-violet-600 font-bold rounded-xl text-xs flex items-center gap-1 cursor-pointer"><Plus className="w-3.5 h-3.5" /> Tambah Fase</Button>
                          </div>
                          <div className="flex flex-wrap gap-3">
                            {kepanitiaaanPhases.map((phase, pIdx) => (
                              <div key={pIdx} className="flex items-center gap-2 p-2.5 rounded-xl border border-violet-100 bg-violet-50/20">
                                <Input type="text" placeholder="Nama Fase" value={phase.name} onChange={(e) => { const val = e.target.value; setKepanitiaaanPhases(prev => { const c = [...prev]; c[pIdx] = { ...c[pIdx], name: val }; return c; }); }} className="rounded-lg border-slate-200 font-bold text-slate-900 text-xs h-8 w-32" />
                                {kepanitiaaanPhases.length > 1 && <Button type="button" variant="ghost" size="icon" onClick={() => setKepanitiaaanPhases(prev => prev.filter((_, i) => i !== pIdx))} className="h-7 w-7 text-rose-450 hover:text-rose-650 hover:bg-rose-50 rounded-lg cursor-pointer"><X className="w-3.5 h-3.5" /></Button>}
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Tabel Anggota</span>
                        </div>
                        <div className="border border-slate-150 rounded-2xl shadow-sm overflow-x-auto bg-white">
                          <table className="w-full text-left border-collapse min-w-[700px]">
                            <thead>
                              <tr className="bg-slate-50 border-b border-slate-100">
                                <th className="px-3 py-2.5 text-[10px] font-bold text-slate-500 uppercase w-10 text-center">NO</th>
                                <th className="px-3 py-2.5 text-[10px] font-bold text-slate-500 uppercase w-[200px]">NAMA</th>
                                {kepanitiaaanPhases.map((phase, pIdx) => (<th key={pIdx} className="px-3 py-2.5 text-[10px] font-bold text-violet-600 uppercase text-center">{phase.name || `Fase ${pIdx + 1}`}</th>))}
                                <th className="px-3 py-2.5 text-[10px] font-bold text-slate-500 uppercase w-[120px] text-right">JUMLAH</th>
                                <th className="px-3 py-2.5 w-10"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {kepanitiaaanRows.map((row, idx) => {
                                const rowTotal = kepanitiaaanPhases.reduce((sum, phase) => sum + (row.phaseAmounts[phase.name] || 0), 0);
                                const addKepanitiaanRow = () => {
                                  setKepanitiaaanRows(prev => [...prev, { name: '', phaseAmounts: {}, searchText: '', showDropdown: false }]);
                                };
                                const kepanitiaanMatches = row.showDropdown && (row.searchText || '').length > 0
                                  ? loyalisEmployees.filter(emp => emp.name.toLowerCase().includes((row.searchText || '').toLowerCase())).slice(0, 8)
                                  : [];
                                const selectKepanitiaanEmployee = (emp: typeof kepanitiaanMatches[number]) => {
                                  setKepanitiaaanRows(prev => { const c = [...prev]; c[idx] = { ...c[idx], name: emp.name, employeeId: emp.id, searchText: emp.name, showDropdown: false }; return c; });
                                };
                                return (
                                  <tr key={idx} className={`border-b border-slate-50 hover:bg-slate-50/30 transition-colors ${row.showDropdown ? 'relative z-50' : 'relative z-0'}`}>
                                    <td className="px-3 py-2 text-xs font-bold text-slate-400 text-center">{idx + 1}</td>
                                    <td className="px-3 py-2 relative">
                                      <div className="relative">
                                        <Input type="text" placeholder="Cari / ketik nama..." value={row.searchText || ''}
                                          onChange={(e) => { const text = e.target.value; setKepanitiaaanRows(prev => { const c = [...prev]; c[idx] = { ...c[idx], name: text, searchText: text, showDropdown: true }; return c; }); setActivePelaporanSuggestionIndex(0); }}
                                          onFocus={() => { setKepanitiaaanRows(prev => { const c = [...prev]; c[idx] = { ...c[idx], showDropdown: true }; return c; }); setActivePelaporanSuggestionIndex(0); }}
                                          onBlur={() => { setTimeout(() => { setKepanitiaaanRows(prev => { const c = [...prev]; if (c[idx]) c[idx] = { ...c[idx], showDropdown: false }; return c; }); }, 200); }}
                                          onKeyDown={(e) => {
                                            if (kepanitiaanMatches.length > 0) {
                                              if (e.key === 'ArrowDown') { e.preventDefault(); setActivePelaporanSuggestionIndex(i => Math.min(i + 1, kepanitiaanMatches.length - 1)); return; }
                                              if (e.key === 'ArrowUp') { e.preventDefault(); setActivePelaporanSuggestionIndex(i => Math.max(i - 1, 0)); return; }
                                              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); const emp = kepanitiaanMatches[activePelaporanSuggestionIndex] ?? kepanitiaanMatches[0]; if (emp) selectKepanitiaanEmployee(emp); return; }
                                            }
                                            handleRowCellKeyDown(e, addKepanitiaanRow);
                                          }}
                                          className="rounded-lg border-slate-200 font-bold text-slate-900 text-xs h-8 w-full" />
                                        {kepanitiaanMatches.length > 0 && (
                                          <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-2xl z-[999] max-h-48 overflow-y-auto divide-y divide-slate-50">
                                            {kepanitiaanMatches.map((emp, empIdx) => (
                                              <div key={emp.id} onClick={() => selectKepanitiaanEmployee(emp)}
                                                onMouseEnter={() => setActivePelaporanSuggestionIndex(empIdx)}
                                                className={`px-3 py-2 text-xs font-semibold cursor-pointer transition-colors text-left ${empIdx === activePelaporanSuggestionIndex ? 'bg-violet-50 text-violet-600 font-bold' : 'hover:bg-violet-50 hover:text-violet-600 text-slate-900'}`}>
                                                <p>{emp.name}</p><p className="text-[9px] text-slate-400 mt-0.5">{emp.role} · {emp.id}</p>
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    </td>
                                    {kepanitiaaanPhases.map((phase, pIdx) => (
                                      <td key={pIdx} className="px-3 py-2 text-center">
                                        <Input type="text" inputMode="numeric" placeholder="0" value={(row.phaseAmounts[phase.name] || 0) > 0 ? fmtRp(row.phaseAmounts[phase.name] || 0) : ''} onChange={(e) => { const val = parseInt(e.target.value.replace(/\D/g, ''), 10) || 0; setKepanitiaaanRows(prev => { const c = [...prev]; c[idx] = { ...c[idx], phaseAmounts: { ...c[idx].phaseAmounts, [phase.name]: val } }; return c; }); }} onKeyDown={(e) => handleRowCellKeyDown(e, addKepanitiaanRow)} className="rounded-lg border-slate-200 font-bold text-slate-900 text-xs h-8 w-24 text-right mx-auto" />
                                      </td>
                                    ))}
                                    <td className="px-3 py-2 text-xs font-black text-slate-900 text-right font-mono">{fmtRp(rowTotal)}</td>
                                    <td className="px-3 py-2 text-center"><Button type="button" variant="ghost" size="icon" onClick={() => setKepanitiaaanRows(prev => prev.filter((_, i) => i !== idx))} className="h-7 w-7 text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer"><Trash2 className="w-3.5 h-3.5" /></Button></td>
                                  </tr>
                                );
                              })}
                              <tr className="border-b border-slate-100 hover:bg-slate-50/10 transition-colors">
                                <td></td>
                                <td colSpan={1 + kepanitiaaanPhases.length} className="px-3 py-2.5">
                                  <Button type="button" size="sm" onClick={() => setKepanitiaaanRows(prev => [...prev, { name: '', phaseAmounts: {}, searchText: '', showDropdown: false }])} className="bg-violet-50 hover:bg-violet-100 text-violet-600 font-bold rounded-xl text-xs flex items-center gap-1 cursor-pointer">
                                    <Plus className="w-3.5 h-3.5" /> Tambah Anggota
                                  </Button>
                                </td>
                                <td colSpan={2}></td>
                              </tr>
                              <tr className="bg-violet-50/50 border-t-2 border-violet-200">
                                <td colSpan={2 + kepanitiaaanPhases.length} className="px-3 py-2.5 text-xs font-black text-violet-800 text-right uppercase">Total</td>
                                <td className="px-3 py-2.5 text-xs font-black text-violet-700 text-right font-mono">{fmtRp(kepanitiaaanRows.reduce((sum, row) => sum + kepanitiaaanPhases.reduce((s, phase) => s + (row.phaseAmounts[phase.name] || 0), 0), 0))}</td>
                                <td></td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* SEKSI 4: KWITANSI / PEMBELIAN */}
                {false && receiptEnabled && (
                  <div className="border border-slate-150 rounded-2xl overflow-hidden">
                    <button type="button" onClick={() => toggleSection('kwitansi')} className="w-full flex items-center justify-between px-5 py-3.5 bg-gradient-to-r from-amber-50 to-amber-50/40 hover:from-amber-100/60 transition-all cursor-pointer">
                      <div className="flex items-center gap-2.5">
                        <Receipt className="w-4 h-4 text-amber-600" />
                        <span className="font-bold text-amber-800 text-xs uppercase tracking-wider">Seksi 4: Kwitansi / Pembelian</span>
                      </div>
                      {expandedSections.kwitansi ? <ChevronDown className="w-4 h-4 text-amber-500" /> : <ChevronRight className="w-4 h-4 text-amber-500" />}
                    </button>

                    {expandedSections.kwitansi && (
                      <div className="p-4 md:p-5 space-y-4 bg-white">
                        <div className="space-y-2">
                          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Judul Seksi (di PDF)</label>
                          <Input type="text" placeholder="KWITANSI..." value={receiptTitle} onChange={(e) => setReceiptTitle(e.target.value)} className="rounded-xl border-slate-200 font-bold text-slate-900 text-xs h-10 w-full uppercase" />
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Daftar Pembelian</span>
                        </div>
                        <div className="border border-slate-150 rounded-2xl shadow-sm overflow-x-auto bg-white">
                          <table className="w-full text-left border-collapse min-w-[700px]">
                            <thead>
                              <tr className="bg-slate-50 border-b border-slate-100">
                                <th className="px-3 py-2.5 text-[10px] font-bold text-slate-500 uppercase w-12 text-center">NO</th>
                                <th className="px-3 py-2.5 text-[10px] font-bold text-slate-500 uppercase w-[45%]">NAMA ITEM</th>
                                <th className="px-3 py-2.5 text-[10px] font-bold text-slate-500 uppercase w-[100px] text-center">QTY</th>
                                <th className="px-3 py-2.5 text-[10px] font-bold text-slate-500 uppercase w-[160px] text-right">HARGA SATUAN</th>
                                <th className="px-3 py-2.5 text-[10px] font-bold text-slate-500 uppercase w-[160px] text-right">TOTAL</th>
                                <th className="px-3 py-2.5 w-12 text-center"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {receiptRows.map((row, idx) => (
                                <tr key={idx} className="border-b border-slate-50 hover:bg-slate-50/30 transition-colors">
                                  <td className="px-3 py-2 text-xs font-bold text-slate-400 text-center">{idx + 1}</td>
                                  <td className="px-3 py-2"><Input type="text" placeholder="Nama barang..." value={row.itemName} onChange={(e) => { const val = e.target.value; setReceiptRows(prev => { const c = [...prev]; c[idx] = { ...c[idx], itemName: val }; return c; }); }} className="rounded-lg border-slate-200 font-medium text-slate-900 text-xs h-8 w-full" /></td>
                                  <td className="px-3 py-2"><Input type="number" min={1} value={row.qty} onChange={(e) => { const val = parseInt(e.target.value) || 1; setReceiptRows(prev => { const c = [...prev]; c[idx] = { ...c[idx], qty: val }; return c; }); }} className="rounded-lg border-slate-200 font-bold text-slate-900 text-xs h-8 w-full text-center" /></td>
                                  <td className="px-3 py-2"><Input type="text" inputMode="numeric" placeholder="0" value={row.unitPrice > 0 ? fmtRp(row.unitPrice) : ''} onChange={(e) => { const val = parseInt(e.target.value.replace(/\D/g, ''), 10) || 0; setReceiptRows(prev => { const c = [...prev]; c[idx] = { ...c[idx], unitPrice: val }; return c; }); }} className="rounded-lg border-slate-200 font-bold text-slate-900 text-xs h-8 w-full text-right" /></td>
                                  <td className="px-3 py-2 text-xs font-black text-slate-900 text-right font-mono">{fmtRp(row.qty * row.unitPrice)}</td>
                                  <td className="px-3 py-2 text-center"><Button type="button" variant="ghost" size="icon" onClick={() => setReceiptRows(prev => prev.filter((_, i) => i !== idx))} className="h-7 w-7 text-rose-450 hover:text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer"><Trash2 className="w-3.5 h-3.5" /></Button></td>
                                </tr>
                              ))}
                              <tr className="border-b border-slate-100 hover:bg-slate-50/10 transition-colors">
                                <td></td>
                                <td colSpan={4} className="px-3 py-2.5">
                                  <Button type="button" size="sm" onClick={() => setReceiptRows(prev => [...prev, { itemName: '', qty: 1, unitPrice: 0 }])} className="bg-amber-50 hover:bg-amber-100 text-amber-700 font-bold rounded-xl text-xs flex items-center gap-1 cursor-pointer">
                                    <Plus className="w-3.5 h-3.5" /> Tambah Item
                                  </Button>
                                </td>
                                <td></td>
                              </tr>
                              <tr className="bg-amber-50/50 border-t-2 border-amber-200">
                                <td colSpan={4} className="px-3 py-2.5 text-xs font-black text-amber-800 text-right uppercase">Grand Total</td>
                                <td className="px-3 py-2.5 text-xs font-black text-amber-700 text-right font-mono">{fmtRp(receiptRows.reduce((sum, r) => sum + (r.qty * r.unitPrice), 0))}</td>
                                <td></td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Shared LPJ Signatures Config */}
                <div className="space-y-4 pt-2 border-t border-slate-100">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Konfigurasi Tanda Tangan LPJ (Maks 3)</span>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {lpjSignatures.map((sig, sIdx) => {
                      return (
                        <div key={sIdx} className="p-4 rounded-2xl border border-slate-150 bg-slate-50/30 space-y-3">
                          <span className="text-[10px] font-bold text-indigo-500 uppercase">Posisi {sIdx + 1}</span>
                          <div className="space-y-2">
                            <div className="relative">
                              <Input
                                type="text"
                                placeholder="Cari nama pegawai..."
                                value={sig.searchText ?? sig.name ?? ''}
                                onChange={(e) => {
                                  const text = e.target.value;
                                  setLpjSignatures(prev => {
                                    const c = [...prev];
                                    c[sIdx] = { ...c[sIdx], searchText: text, name: '', showDropdown: true };
                                    return c;
                                  });
                                  setActivePelaporanSuggestionIndex(0);
                                }}
                                onFocus={() => {
                                  setLpjSignatures(prev => {
                                    const c = [...prev];
                                    c[sIdx] = { ...c[sIdx], showDropdown: true };
                                    return c;
                                  });
                                  setActivePelaporanSuggestionIndex(0);
                                }}
                                onBlur={() => {
                                  setTimeout(() => {
                                    setLpjSignatures(prev => {
                                      const c = [...prev];
                                      if (c[sIdx]) c[sIdx] = { ...c[sIdx], showDropdown: false };
                                      return c;
                                    });
                                  }, 200);
                                }}
                                className={`rounded-lg text-xs h-8 w-full pr-8 font-bold transition-all ${sig.name
                                  ? 'bg-emerald-50/40 border-emerald-300 text-emerald-900 placeholder-emerald-400'
                                  : 'bg-white border-slate-200 text-slate-900 placeholder-slate-400'
                                  }`}
                              />
                              {sig.name && (
                                <CheckCircle2 className="w-4 h-4 text-emerald-600 absolute right-2.5 top-2" />
                              )}
                              {sig.showDropdown && (
                                <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-2xl z-[999] max-h-48 overflow-y-auto divide-y divide-slate-50">
                                  {(() => {
                                    const queryText = (sig.searchText ?? sig.name ?? '').toLowerCase();
                                    const filtered = loyalisEmployees.filter(emp =>
                                      emp.name.toLowerCase().includes(queryText)
                                    );
                                    if (filtered.length === 0) {
                                      return <div className="p-3 text-center text-slate-400 text-xs font-semibold">Tidak ditemukan</div>;
                                    }
                                    return filtered.map((emp, empIdx) => (
                                      <div
                                        key={emp.id}
                                        onClick={() => {
                                          setLpjSignatures(prev => {
                                            const c = [...prev];
                                            c[sIdx] = {
                                              ...c[sIdx],
                                              name: emp.name,
                                              title: emp.role || '',
                                              searchText: emp.name,
                                              showDropdown: false,
                                            };
                                            return c;
                                          });
                                        }}
                                        className={`px-3 py-2 text-xs font-semibold cursor-pointer transition-colors text-left ${empIdx === activePelaporanSuggestionIndex
                                          ? 'bg-indigo-50 text-indigo-600 font-bold'
                                          : 'hover:bg-indigo-50 hover:text-indigo-600 text-slate-900'
                                          }`}
                                      >
                                        <p>{emp.name}</p>
                                        <p className="text-[9px] text-slate-400 mt-0.5">{emp.role} · {emp.id}</p>
                                      </div>
                                    ));
                                  })()}
                                </div>
                              )}
                            </div>
                            <Input
                              type="text"
                              placeholder="Jabatan / Gelar..."
                              value={sig.title}
                              onChange={(e) => {
                                const val = e.target.value;
                                setLpjSignatures(prev => {
                                  const c = [...prev];
                                  c[sIdx] = { ...c[sIdx], title: val };
                                  return c;
                                });
                              }}
                              className="rounded-lg border-slate-200 text-xs h-8 font-medium"
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* LPJ Actions */}
                <div className="flex flex-wrap justify-between items-center gap-3 pt-6 border-t border-slate-100 mt-6">
                  <div>
                    {selectedProposalId && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => handleDeleteProposal(selectedProposalId)}
                        className="rounded-xl border-rose-200 text-rose-600 bg-rose-50/50 hover:bg-rose-50 text-xs font-bold flex items-center gap-1.5 h-10 cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" /> Hapus Laporan
                      </Button>
                    )}
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {autoSaveStatus === 'saving' && (
                      <span className="text-slate-400 text-[11px] font-medium flex items-center gap-1.5 animate-pulse mr-2 font-sans">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />
                        Menyimpan draft...
                      </span>
                    )}
                    {autoSaveStatus === 'saved' && (
                      <span className="text-emerald-600 text-[11px] font-semibold flex items-center gap-1 mr-2 font-sans">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                        Draft disimpan otomatis
                      </span>
                    )}
                    {autoSaveStatus === 'error' && (
                      <span className="text-rose-500 text-[11px] font-semibold flex items-center gap-1 mr-2 font-sans">
                        <AlertCircle className="w-3.5 h-3.5 text-rose-500" />
                        Gagal menyimpan otomatis
                      </span>
                    )}

                    <Button
                      type="button"
                      onClick={handleSaveLpjDraft}
                      disabled={saving || !canManageProposal || periodClosed}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl px-6 text-xs flex items-center gap-1.5 shadow-md h-10 cursor-pointer"
                    >
                      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      Simpan Laporan
                    </Button>

                    <Button
                      type="button"
                      onClick={handlePrintPdf}
                      disabled={printingPdf}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl px-6 text-xs flex items-center gap-1.5 shadow-md h-10 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {printingPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />} {printingPdf ? 'Membuat PDF...' : 'Cetak PDF'}
                    </Button>

                    {profile?.role === 'satker_head_loyalis' && (currentProposalStatus === 'proposal_approved' || currentProposalStatus === 'lpj_draft' || currentProposalStatus === 'lpj_revision') && (
                      <Button
                        onClick={handleSubmitLpjToQueue}
                        disabled={saving || !canManageProposal || periodClosed}
                        className="rounded-xl px-6 bg-slate-900 hover:bg-black text-white font-bold text-xs h-10 flex items-center gap-2 shadow-md cursor-pointer"
                      >
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                        Submit LPJ Pertanggungjawaban
                      </Button>
                    )}

                    {/* Super Admin Review Actions for LPJ */}
                    {profile?.role === 'super_admin' && currentProposalStatus === 'lpj_submitted' && (
                      <div className="flex gap-2">
                        <Button
                          onClick={() => { setReviewTarget('lpj'); setReviewAction('lpj_approved'); handleReviewDecision('lpj', 'lpj_approved', ''); }}
                          disabled={saving}
                          className="rounded-xl px-5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs h-10 flex items-center gap-1.5 shadow-md cursor-pointer"
                        >
                          <Sparkles className="w-4 h-4" /> Setujui LPJ & Sync Payroll
                        </Button>
                        <Button
                          onClick={() => { setReviewTarget('lpj'); setReviewAction('lpj_revision'); setReviewNoteInput(''); setShowReviewDialog(true); }}
                          disabled={saving}
                          className="rounded-xl px-5 bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs h-10 flex items-center gap-1.5 shadow-md cursor-pointer"
                        >
                          <RotateCcw className="w-4 h-4" /> Minta Revisi LPJ
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

      </Card>

      {/* Historical Baseline Clone Dialog */}
      <Dialog open={showCloneModal} onOpenChange={setShowCloneModal}>
        <DialogContent className="sm:max-w-4xl max-w-full overflow-hidden flex flex-col p-0 border-none bg-white shadow-2xl rounded-3xl">
          <DialogHeader className="p-6 pb-4 bg-gradient-to-r from-purple-50 to-indigo-50 border-b border-slate-100">
            <DialogTitle className="text-slate-800 flex items-center gap-2.5 font-bold text-lg">
              <Copy className="w-5 h-5 text-purple-600" /> Kloning Anggaran dari Event Lalu
            </DialogTitle>
            <p className="text-slate-500 text-xs mt-1">Pilih event dari proposal/LPJ sebelumnya untuk mengkloning struktur anggaran & rincian pengeluaran ke proposal baru.</p>
          </DialogHeader>
          <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
              <Input
                type="text"
                placeholder="Cari event historis (contoh: Reuni SainTek 2025)..."
                value={cloneSearchQuery}
                onChange={(e) => setCloneSearchQuery(e.target.value)}
                className="pl-10 rounded-xl border-slate-200 font-semibold text-xs h-10"
              />
            </div>

            {loadingHistorical ? (
              <div className="py-12 flex justify-center items-center text-slate-400 text-xs">
                <Loader2 className="w-5 h-5 animate-spin mr-2 text-purple-600" /> Memuat histori event...
              </div>
            ) : (() => {
              const queryStr = cloneSearchQuery.toLowerCase();
              const filteredList = historicalItems.filter(e =>
                (e.reportName || e.eventName || '').toLowerCase().includes(queryStr) ||
                (e.departmentUnit || '').toLowerCase().includes(queryStr)
              );

              if (filteredList.length === 0) {
                return <div className="py-12 text-center text-slate-400 text-xs">Tidak ada event historis ditemukan.</div>;
              }

              return (
                <div className="space-y-3">
                  {filteredList.map((hItem) => {
                    const name = hItem.reportName || hItem.eventName;
                    return (
                      <div
                        key={hItem.id}
                        className="p-4 rounded-2xl border border-slate-150 bg-slate-50/50 hover:bg-purple-50/40 hover:border-purple-200 transition-all flex items-center justify-between gap-4"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-purple-100 text-purple-700 uppercase">{hItem.sourceType}</span>
                            <h4 className="font-bold text-slate-800 text-xs">{name}</h4>
                          </div>
                          <p className="text-[10px] text-slate-400 font-medium mt-1">
                            Periode {hItem.period || 'Historis'} · {hItem.departmentUnit || 'UMUM'}
                          </p>
                        </div>
                        <Button
                          onClick={() => handleCloneTemplate(hItem)}
                          className="rounded-xl px-4 bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs h-9 flex items-center gap-1.5 shadow-sm shrink-0"
                        >
                          <Sparkles className="w-3.5 h-3.5" /> Gunakan Baseline Ini
                        </Button>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
          <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end shrink-0 rounded-b-3xl">
            <Button variant="ghost" onClick={() => setShowCloneModal(false)} className="rounded-xl text-slate-500">Tutup</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Review Dialog */}
      <Dialog open={showReviewDialog} onOpenChange={setShowReviewDialog}>
        <DialogContent className="sm:max-w-md max-w-full p-0 border-none bg-white shadow-2xl rounded-3xl overflow-hidden">
          <DialogHeader className="p-6 pb-4 bg-gradient-to-r from-orange-50 to-rose-50 border-b border-slate-100">
            <DialogTitle className="text-slate-800 flex items-center gap-2.5 font-bold text-lg">
              <AlertCircle className="w-5 h-5 text-orange-500" /> Minta Revisi {reviewTarget === 'proposal' ? 'Proposal Anggaran' : 'LPJ Pertanggungjawaban'}
            </DialogTitle>
            <p className="text-slate-500 text-xs mt-1">Berikan rincian perbaikan untuk Kepala SatKer.</p>
          </DialogHeader>
          <div className="p-6 space-y-4">
            <textarea
              placeholder={`Catatan revisi ${reviewTarget === 'proposal' ? 'proposal' : 'LPJ'} (contoh: Rincian biaya konsumsi tidak melampirkan perkiraan harga)...`}
              value={reviewNoteInput}
              onChange={(e) => setReviewNoteInput(e.target.value)}
              className="w-full rounded-xl border border-slate-200 p-3 text-xs font-semibold h-28 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-2 rounded-b-3xl">
            <Button variant="ghost" onClick={() => setShowReviewDialog(false)} className="rounded-xl text-slate-500">Batal</Button>
            <Button
              onClick={() => {
                handleReviewDecision(reviewTarget, reviewAction, reviewNoteInput);
              }}
              disabled={saving || !reviewNoteInput.trim()}
              className="rounded-xl px-5 bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs h-9 flex items-center gap-1.5"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />} Konfirmasi & Send Email
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
