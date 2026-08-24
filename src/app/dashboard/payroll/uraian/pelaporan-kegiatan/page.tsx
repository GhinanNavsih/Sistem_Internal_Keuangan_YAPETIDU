"use client"

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  Loader2, CheckCircle2, FileText, AlertCircle, Trash2, Eye, Plus, Save,
  Building2, Code2, PlusCircle, Check, X, Building, Users, Receipt, Layers,
  ToggleLeft, ToggleRight, ChevronDown, ChevronRight, ArrowLeft
} from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import {
  collection, getDocs, doc, setDoc, deleteDoc, getDoc, serverTimestamp, query, where, onSnapshot
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { MONTHS_ID } from '@/utils/rekapConfig';
import { generatePelaporanKegiatanPdf } from '@/utils/generatePelaporanKegiatanPdf';

export default function PelaporanKegiatanPage() {
  const { profile } = useAuth();
  const searchParams = useSearchParams();

  // Read params from URL search parameters
  const month = parseInt(searchParams.get('month') || String(new Date().getMonth() + 1), 10);
  const year = parseInt(searchParams.get('year') || String(new Date().getFullYear()), 10);

  const periodToken = `${year}-${String(month).padStart(2, '0')}`;

  // ── States ──
  const [pelaporanList, setPelaporanList] = useState<any[]>([]);
  const [loadingPelaporan, setLoadingPelaporan] = useState(false);

  // Editor States
  const [selectedPelaporanId, setSelectedPelaporanId] = useState<string | null>(null);
  const [pelaporanReportName, setPelaporanReportName] = useState('');
  const [pelaporanDept, setPelaporanDept] = useState('');
  const [pelaporanSignatures, setPelaporanSignatures] = useState<{
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
  const [savingPelaporan, setSavingPelaporan] = useState(false);
  const [activePelaporanSuggestionIndex, setActivePelaporanSuggestionIndex] = useState<number>(0);

  // Section enable toggles
  const [realisasiEnabled, setRealisasiEnabled] = useState(true);
  const [vakasiPengujiEnabled, setVakasiPengujiEnabled] = useState(true);
  const [kepanitiaaanEnabled, setKepanitiaaanEnabled] = useState(true);
  const [receiptEnabled, setReceiptEnabled] = useState(false);

  // Accordion expanded states
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    realisasi: true,
    vakasiPenguji: false,
    kepanitiaan: false,
    kwitansi: false
  });

  const toggleSection = (key: string) => setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));

  // Section 1: Realisasi Keuangan (Pemasukan, Pengembangan, Pengeluaran)
  const [realisasiTitle, setRealisasiTitle] = useState('REALISASI ');
  const [pemasukanRows, setPemasukanRows] = useState<{
    uraian: string;
    rincianQty: string;
    rincianRate: number;
    realisasi: number;
  }[]>([{ uraian: '', rincianQty: '', rincianRate: 0, realisasi: 0 }]);
  const [yayasanPercentage, setYayasanPercentage] = useState(20);
  const [unipduPercentage, setUnipduPercentage] = useState(20);
  const [pengeluaranRows, setPengeluaranRows] = useState<{
    type: 'item' | 'group_header';
    uraian: string;
    rincianQty: string;
    rincianRate: number;
    realisasi: number;
  }[]>([{ type: 'group_header', uraian: '', rincianQty: '', rincianRate: 0, realisasi: 0 }]);
  const [kepanitiaaanPercentage, setKepanitiaaanPercentage] = useState(10);

  // Section 2: Vakasi Penguji
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

  // Section 3: Vakasi Kepanitiaan
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

  // Section 4: Kwitansi / Receipts
  const [receiptTitle, setReceiptTitle] = useState('KWITANSI PEMBELIAN ');
  const [receiptRows, setReceiptRows] = useState<{
    itemName: string;
    qty: number;
    unitPrice: number;
  }[]>([{ itemName: '', qty: 1, unitPrice: 0 }]);

  // Auto-save state
  const [autoSaveStatus, setAutoSaveStatus] = useState<'saved' | 'saving' | 'error' | 'idle'>('idle');

  // Load employee suggestions
  const [loyalisEmployees, setLoyalisEmployees] = useState<any[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);

  // Keyboard navigation target
  const [focusTarget, setFocusTarget] = useState<{ table: string; row: number; col: number } | null>(null);
  const [activeInsertMenuIdx, setActiveInsertMenuIdx] = useState<number | null>(null);

  // Fetch departments on mount
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

  // Fetch Loyalis employees for suggestions
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

  // Live Sync Pelaporan Kegiatan reports
  useEffect(() => {
    if (!profile) return;
    setLoadingPelaporan(true);
    const q = query(
      collection(db, 'PelaporanKegiatan'),
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

      setPelaporanList(list);
      setLoadingPelaporan(false);
    }, (err) => {
      console.error('Error listening to PelaporanKegiatan:', err);
      setLoadingPelaporan(false);
    });

    return () => unsubscribe();
  }, [periodToken, profile]);

  const resetPelaporanForm = () => {
    setSelectedPelaporanId(null);
    setPelaporanReportName('');
    setPelaporanDept('');
    setRealisasiEnabled(true);
    setVakasiPengujiEnabled(true);
    setKepanitiaaanEnabled(true);
    setReceiptEnabled(false);
    setRealisasiTitle('REALISASI ');
    setPemasukanRows([{ uraian: '', rincianQty: '', rincianRate: 0, realisasi: 0 }]);
    setYayasanPercentage(20);
    setUnipduPercentage(20);
    setPengeluaranRows([{ type: 'group_header', uraian: '', rincianQty: '', rincianRate: 0, realisasi: 0 }]);
    setKepanitiaaanPercentage(10);
    setVakasiPengujiTitle('VAKASI PENGUJI ');
    setVakasiRoles([{ name: 'Ketua', rate: 200000 }, { name: 'Penguji', rate: 175000 }, { name: 'Sekretaris', rate: 125000 }]);
    setVakasiPengujiRows([{ employeeId: '', employeeName: '', roleQtys: {}, searchText: '', showDropdown: false }]);
    setKepanitiaaanTitle('VAKASI KEPANITIAAN ');
    setKepanitiaaanPhases([{ name: 'Persiapan' }, { name: 'Pelaksanaan' }, { name: 'Kepanitiaan' }]);
    setKepanitiaaanRows([{ name: '', phaseAmounts: {}, searchText: '', showDropdown: false }]);
    setReceiptTitle('KWITANSI PEMBELIAN ');
    setReceiptRows([{ itemName: '', qty: 1, unitPrice: 0 }]);
    setPelaporanSignatures([
      { label: '', name: '', title: 'Wakil Rektor Bid. Keuangan, SDM dan Umum', searchText: '', showDropdown: false },
      { label: '', name: '', title: '', searchText: '', showDropdown: false },
      { label: '', name: '', title: 'Direktur', searchText: '', showDropdown: false },
    ]);
    setExpandedSections({ realisasi: true, vakasiPenguji: false, kepanitiaan: false, kwitansi: false });
  };

  const loadPelaporanFromData = (rpt: any) => {
    setSelectedPelaporanId(rpt.id);
    setPelaporanReportName(rpt.reportName || rpt.title || '');
    setPelaporanDept(rpt.departmentUnit || '');
    setRealisasiEnabled(rpt.realisasiEnabled !== false);
    setVakasiPengujiEnabled(rpt.vakasiPengujiEnabled !== false);
    setKepanitiaaanEnabled(rpt.kepanitiaaanEnabled !== false);
    setReceiptEnabled(rpt.receiptEnabled === true);
    setRealisasiTitle(rpt.realisasiTitle || 'REALISASI ');

    let parsedPemasukan: any[] = [];
    let parsedPengeluaran: any[] = [];
    let parsedYayasanPct = 20;
    let parsedUnipduPct = 20;

    if (rpt.pemasukanRows && rpt.pengeluaranRows) {
      parsedPemasukan = rpt.pemasukanRows;
      parsedPengeluaran = rpt.pengeluaranRows;
      parsedYayasanPct = rpt.yayasanPercentage ?? 20;
      parsedUnipduPct = rpt.unipduPercentage ?? 20;
    } else if (rpt.realisasiRows) {
      let currentSection: 'pemasukan' | 'pengembangan' | 'pengeluaran' = 'pemasukan';
      rpt.realisasiRows.forEach((row: any) => {
        if (row.type === 'group_header') {
          const lowerUraian = row.uraian.toLowerCase();
          if (lowerUraian.includes('pengembangan')) currentSection = 'pengembangan';
          else if (lowerUraian.includes('operasional') || lowerUraian.includes('pengeluaran')) {
            currentSection = 'pengeluaran';
            parsedPengeluaran.push(row);
          } else if (lowerUraian.includes('pemasukan')) currentSection = 'pemasukan';
          else {
            if (currentSection === 'pemasukan') parsedPemasukan.push(row);
            else parsedPengeluaran.push(row);
          }
        } else {
          if (currentSection === 'pemasukan') parsedPemasukan.push(row);
          else if (currentSection === 'pengembangan') {
            const lowerUraian = row.uraian.toLowerCase();
            const pct = parseFloat(row.rincianQty) || 20;
            if (lowerUraian.includes('yayasan')) parsedYayasanPct = pct;
            else if (lowerUraian.includes('unipdu')) parsedUnipduPct = pct;
          } else {
            parsedPengeluaran.push(row);
          }
        }
      });
    }

    if (parsedPemasukan.length === 0) parsedPemasukan = [{ uraian: '', rincianQty: '', rincianRate: 0, realisasi: 0 }];
    if (parsedPengeluaran.length === 0) parsedPengeluaran = [{ type: 'item', uraian: '', rincianQty: '', rincianRate: 0, realisasi: 0 }];

    setPemasukanRows(parsedPemasukan);
    setPengeluaranRows(parsedPengeluaran);
    setYayasanPercentage(parsedYayasanPct);
    setUnipduPercentage(parsedUnipduPct);
    setKepanitiaaanPercentage(rpt.kepanitiaaanPercentage ?? 10);
    setVakasiPengujiTitle(rpt.vakasiPengujiTitle || 'VAKASI PENGUJI ');
    setVakasiRoles(rpt.vakasiRoles?.length > 0 ? rpt.vakasiRoles : [{ name: 'Ketua', rate: 200000 }, { name: 'Penguji', rate: 175000 }, { name: 'Sekretaris', rate: 125000 }]);
    setVakasiPengujiRows(rpt.vakasiPengujiRows?.length > 0 ? rpt.vakasiPengujiRows.map((r: any) => ({ ...r, searchText: r.employeeName || '', showDropdown: false })) : [{ employeeId: '', employeeName: '', roleQtys: {}, searchText: '', showDropdown: false }]);
    setKepanitiaaanTitle(rpt.kepanitiaaanTitle || 'VAKASI KEPANITIAAN ');
    setKepanitiaaanPhases(rpt.kepanitiaaanPhases?.length > 0 ? rpt.kepanitiaaanPhases : [{ name: 'Persiapan' }, { name: 'Pelaksanaan' }, { name: 'Kepanitiaan' }]);
    setKepanitiaaanRows(rpt.kepanitiaaanRows?.length > 0 ? rpt.kepanitiaaanRows.map((r: any) => ({ ...r, searchText: r.name || '', showDropdown: false })) : [{ name: '', phaseAmounts: {}, searchText: '', showDropdown: false }]);
    setReceiptTitle(rpt.receiptTitle || 'KWITANSI PEMBELIAN ');
    setReceiptRows(rpt.receiptRows?.length > 0 ? rpt.receiptRows : [{ itemName: '', qty: 1, unitPrice: 0 }]);
    setPelaporanSignatures(rpt.signatures?.length > 0 ? rpt.signatures.map((s: any) => ({ ...s, searchText: s.name || '', showDropdown: false })) : [
      { label: '', name: '', title: 'Wakil Rektor Bid. Keuangan, SDM dan Umum', searchText: '', showDropdown: false },
      { label: '', name: '', title: '', searchText: '', showDropdown: false },
      { label: '', name: '', title: 'Direktur', searchText: '', showDropdown: false },
    ]);
    setExpandedSections({ realisasi: true, vakasiPenguji: false, kepanitiaan: false, kwitansi: false });
  };

  const handleTableKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, table: 'pemasukan' | 'pengeluaran', rowIdx: number, colIdx: number) => {
    let nextRow = rowIdx;
    let nextCol = colIdx;
    let shouldMove = false;

    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey || e.altKey) {
        if (table === 'pemasukan') {
          setPemasukanRows(prev => {
            const c = [...prev];
            c.splice(rowIdx + 1, 0, { uraian: '', rincianQty: '', rincianRate: 0, realisasi: 0 });
            return c;
          });
          setFocusTarget({ table: 'pemasukan', row: rowIdx + 1, col: 0 });
        } else {
          setPengeluaranRows(prev => {
            const c = [...prev];
            c.splice(rowIdx + 1, 0, { type: 'item', uraian: '', rincianQty: '', rincianRate: 0, realisasi: 0 });
            return c;
          });
          setFocusTarget({ table: 'pengeluaran', row: rowIdx + 1, col: 0 });
        }
        return;
      }
      nextRow = rowIdx + 1;
      shouldMove = true;
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      nextRow = rowIdx + 1;
      shouldMove = true;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      nextRow = rowIdx - 1;
      shouldMove = true;
    } else if (e.key === 'ArrowRight') {
      const target = e.target as HTMLInputElement;
      if (target.selectionStart === target.value.length) {
        e.preventDefault();
        nextCol = colIdx + 1;
        shouldMove = true;
      }
    } else if (e.key === 'ArrowLeft') {
      const target = e.target as HTMLInputElement;
      if (target.selectionStart === 0) {
        e.preventDefault();
        nextCol = colIdx - 1;
        shouldMove = true;
      }
    }

    if (shouldMove) {
      setTimeout(() => {
        const nextEl = document.querySelector(`[data-table="${table}"][data-row="${nextRow}"][data-col="${nextCol}"]`) as HTMLInputElement;
        if (nextEl) {
          nextEl.focus();
          nextEl.select();
        }
      }, 50);
    }
  };

  useEffect(() => {
    if (focusTarget) {
      const nextEl = document.querySelector(`[data-table="${focusTarget.table}"][data-row="${focusTarget.row}"][data-col="${focusTarget.col}"]`) as HTMLInputElement;
      if (nextEl) {
        nextEl.focus();
        nextEl.select();
      }
      setFocusTarget(null);
    }
  }, [focusTarget]);

  const handleSavePelaporan = async () => {
    if (savingPelaporan) return;
    if (!pelaporanReportName.trim()) {
      alert('Nama Laporan harus diisi.');
      return;
    }
    if (!pelaporanDept) {
      alert('Unit Kerja harus dipilih.');
      return;
    }

    setSavingPelaporan(true);
    try {
      const docId = selectedPelaporanId || `${periodToken}_${pelaporanDept}_${Math.random().toString(36).substring(2, 8)}`;

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

      const totalPemasukanAnggaran = pemasukanRows.reduce((sum, r) => sum + (parseQty(r.rincianQty) * r.rincianRate), 0);
      const totalPemasukanRealisasi = pemasukanRows.reduce((sum, r) => sum + r.realisasi, 0);

      const unifiedRealisasiRows: any[] = [
        { type: 'group_header', uraian: 'Pemasukan', rincianQty: '', rincianRate: 0, realisasi: 0 },
        ...pemasukanRows.filter(r => r.uraian.trim()).map(r => ({ type: 'item', ...r })),
        { type: 'group_header', uraian: 'Dana Pengembangan', rincianQty: '', rincianRate: 0, realisasi: 0 },
        { type: 'item', uraian: 'Yayasan', rincianQty: `${yayasanPercentage}%`, rincianRate: totalPemasukanAnggaran, realisasi: totalPemasukanRealisasi * (yayasanPercentage / 100) },
        { type: 'item', uraian: 'UNIPDU', rincianQty: `${unipduPercentage}%`, rincianRate: totalPemasukanAnggaran, realisasi: totalPemasukanRealisasi * (unipduPercentage / 100) },
        { type: 'group_header', uraian: 'Dana Operasional', rincianQty: '', rincianRate: 0, realisasi: 0 },
        { type: 'group_header', uraian: 'A. Pengeluaran', rincianQty: '', rincianRate: 0, realisasi: 0 },
        ...pengeluaranRows.filter(r => r.uraian.trim() || r.type === 'group_header')
      ];

      const payload: any = {
        reportName: pelaporanReportName,
        title: pelaporanReportName,
        period: periodToken,
        departmentUnit: pelaporanDept,
        realisasiEnabled,
        vakasiPengujiEnabled,
        kepanitiaaanEnabled,
        receiptEnabled,
        realisasiTitle,
        pemasukanRows: pemasukanRows.filter(r => r.uraian.trim()),
        pengeluaranRows: pengeluaranRows.filter(r => r.uraian.trim() || r.type === 'group_header'),
        yayasanPercentage,
        unipduPercentage,
        realisasiRows: unifiedRealisasiRows,
        kepanitiaaanPercentage,
        vakasiPengujiTitle,
        vakasiRoles,
        vakasiPengujiRows: vakasiPengujiRows.filter(r => r.employeeId).map(r => ({
          employeeId: r.employeeId,
          employeeName: r.employeeName,
          roleQtys: r.roleQtys,
        })),
        kepanitiaaanTitle,
        kepanitiaaanPhases,
        kepanitiaaanRows: kepanitiaaanRows.filter(r => r.name.trim()).map(r => ({
          name: r.name,
          employeeId: r.employeeId || null,
          phaseAmounts: r.phaseAmounts,
        })),
        receiptTitle,
        receiptRows: receiptRows.filter(r => r.itemName.trim()),
        signatures: pelaporanSignatures.map(s => ({
          label: s.label || '',
          name: s.name || '',
          title: s.title || '',
        })),
        submittedBy: profile?.uid || null,
        submittedByName: profile?.displayName || null,
        updatedAt: serverTimestamp(),
      };

      if (!selectedPelaporanId) {
        payload.createdAt = serverTimestamp();
      }

      await setDoc(doc(db, 'PelaporanKegiatan', docId), payload, { merge: true });
      setSelectedPelaporanId(docId);
      setAutoSaveStatus('saved');
      alert('Laporan Kegiatan berhasil disimpan.');
    } catch (err) {
      console.error('Error saving PelaporanKegiatan:', err);
      alert('Gagal menyimpan Laporan Kegiatan.');
    } finally {
      setSavingPelaporan(false);
    }
  };

  const handleDeletePelaporan = async (id: string) => {
    void id;
    alert('Penghapusan laporan dinonaktifkan agar riwayat tetap utuh. Gunakan alur koreksi.');
  };

  const handlePrintPelaporan = () => {
    const periodLabel = `${MONTHS_ID[month - 1]} ${year}`;
    generatePelaporanKegiatanPdf({
      reportName: pelaporanReportName,
      period: periodLabel,
      departmentUnit: pelaporanDept,
      signatures: pelaporanSignatures,
      realisasiEnabled,
      vakasiPengujiEnabled,
      kepanitiaaanEnabled,
      receiptEnabled,
      realisasiTitle,
      pemasukanRows: pemasukanRows.filter(r => r.uraian.trim()),
      pengeluaranRows: pengeluaranRows.filter(r => r.uraian.trim() || r.type === 'group_header'),
      yayasanPercentage,
      unipduPercentage,
      kepanitiaaanPercentage,
      vakasiPengujiTitle,
      vakasiRoles,
      vakasiPengujiRows: vakasiPengujiRows.filter(r => r.employeeId),
      kepanitiaaanTitle,
      kepanitiaaanPhases,
      kepanitiaaanRows: kepanitiaaanRows.filter(r => r.name.trim()),
      receiptTitle,
      receiptRows: receiptRows.filter(r => r.itemName.trim()),
    });
  };

  // Debounced auto-save effect
  useEffect(() => {
    if (!profile) return;
    if (!pelaporanReportName.trim() || !pelaporanDept) return;

    const timer = setTimeout(async () => {
      setAutoSaveStatus('saving');
      try {
        const docId = selectedPelaporanId || `${periodToken}_${pelaporanDept}_${Math.random().toString(36).substring(2, 8)}`;

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

        const totalPemasukanAnggaran = pemasukanRows.reduce((sum, r) => sum + (parseQty(r.rincianQty) * r.rincianRate), 0);
        const totalPemasukanRealisasi = pemasukanRows.reduce((sum, r) => sum + r.realisasi, 0);

        const unifiedRealisasiRows: any[] = [
          { type: 'group_header', uraian: 'Pemasukan', rincianQty: '', rincianRate: 0, realisasi: 0 },
          ...pemasukanRows.filter(r => r.uraian.trim()).map(r => ({ type: 'item', ...r })),
          { type: 'group_header', uraian: 'Dana Pengembangan', rincianQty: '', rincianRate: 0, realisasi: 0 },
          { type: 'item', uraian: 'Yayasan', rincianQty: `${yayasanPercentage}%`, rincianRate: totalPemasukanAnggaran, realisasi: totalPemasukanRealisasi * (yayasanPercentage / 100) },
          { type: 'item', uraian: 'UNIPDU', rincianQty: `${unipduPercentage}%`, rincianRate: totalPemasukanAnggaran, realisasi: totalPemasukanRealisasi * (unipduPercentage / 100) },
          { type: 'group_header', uraian: 'Dana Operasional', rincianQty: '', rincianRate: 0, realisasi: 0 },
          { type: 'group_header', uraian: 'A. Pengeluaran', rincianQty: '', rincianRate: 0, realisasi: 0 },
          ...pengeluaranRows.filter(r => r.uraian.trim() || r.type === 'group_header')
        ];

        const payload: any = {
          reportName: pelaporanReportName,
          title: pelaporanReportName,
          period: periodToken,
          departmentUnit: pelaporanDept,
          realisasiEnabled,
          vakasiPengujiEnabled,
          kepanitiaaanEnabled,
          receiptEnabled,
          realisasiTitle,
          pemasukanRows: pemasukanRows.filter(r => r.uraian.trim()),
          pengeluaranRows: pengeluaranRows.filter(r => r.uraian.trim() || r.type === 'group_header'),
          yayasanPercentage,
          unipduPercentage,
          realisasiRows: unifiedRealisasiRows,
          kepanitiaaanPercentage,
          vakasiPengujiTitle,
          vakasiRoles,
          vakasiPengujiRows: vakasiPengujiRows.filter(r => r.employeeId).map(r => ({
            employeeId: r.employeeId,
            employeeName: r.employeeName,
            roleQtys: r.roleQtys,
          })),
          kepanitiaaanTitle,
          kepanitiaaanPhases,
          kepanitiaaanRows: kepanitiaaanRows.filter(r => r.name.trim()).map(r => ({
            name: r.name,
            employeeId: r.employeeId || null,
            phaseAmounts: r.phaseAmounts,
          })),
          receiptTitle,
          receiptRows: receiptRows.filter(r => r.itemName.trim()),
          signatures: pelaporanSignatures.map(s => ({
            label: s.label || '',
            name: s.name || '',
            title: s.title || '',
          })),
          submittedBy: profile?.uid || null,
          submittedByName: profile?.displayName || null,
          updatedAt: serverTimestamp(),
        };

        if (!selectedPelaporanId) {
          payload.createdAt = serverTimestamp();
          setSelectedPelaporanId(docId);
        }

        await setDoc(doc(db, 'PelaporanKegiatan', docId), payload, { merge: true });
        setAutoSaveStatus('saved');
      } catch (err) {
        console.error('Auto-save error:', err);
        setAutoSaveStatus('error');
      }
    }, 2000);

    return () => clearTimeout(timer);
  }, [
    profile,
    pelaporanReportName,
    pelaporanDept,
    realisasiEnabled,
    vakasiPengujiEnabled,
    kepanitiaaanEnabled,
    receiptEnabled,
    realisasiTitle,
    pemasukanRows,
    yayasanPercentage,
    unipduPercentage,
    pengeluaranRows,
    kepanitiaaanPercentage,
    vakasiPengujiTitle,
    vakasiRoles,
    vakasiPengujiRows,
    kepanitiaaanTitle,
    kepanitiaaanPhases,
    kepanitiaaanRows,
    receiptTitle,
    receiptRows,
    pelaporanSignatures,
    periodToken,
    selectedPelaporanId
  ]);

  const fmtRp = (n: number) => 'Rp\u00a0' + Math.round(n).toLocaleString('id-ID');

  return (
    <div className="flex flex-col gap-8">
      {/* Top Section: Daftar Laporan Kegiatan Grid */}
      <Card className="bg-white rounded-[20px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-none p-6">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h3 className="font-bold text-slate-800 text-sm">Daftar Laporan Kegiatan</h3>
            <p className="text-slate-400 text-xs mt-0.5">Pilih laporan di bawah untuk mengedit, mencetak, atau menghapus.</p>
          </div>
        </div>
        {loadingPelaporan ? (
          <div className="py-12 flex justify-center text-slate-400"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {/* Buat Baru Card */}
            <div
              onClick={() => resetPelaporanForm()}
              className="p-4 rounded-2xl border-2 border-dashed border-slate-200 hover:border-indigo-450 hover:bg-indigo-50/10 transition-all cursor-pointer flex flex-col items-center justify-center min-h-[110px] gap-2 text-center group"
            >
              <Plus className="w-5 h-5 text-slate-455 group-hover:text-indigo-500 group-hover:scale-110 transition-all" />
              <span className="text-xs font-bold text-slate-500 group-hover:text-indigo-600">Buat Laporan Baru</span>
            </div>
            {/* Draft card */}
            {!selectedPelaporanId && (
              <div className="p-4 rounded-2xl border bg-indigo-50/30 border-indigo-200 shadow-sm flex flex-col justify-between min-h-[110px] scale-[1.02]">
                <div>
                  <p className="font-bold text-indigo-600 text-sm line-clamp-1 italic">
                    {pelaporanReportName.trim() !== '' ? pelaporanReportName : 'Laporan Baru (Tanpa Judul)'}
                  </p>
                  <p className="text-[10px] text-indigo-400 font-bold mt-1 uppercase tracking-wider">{pelaporanDept || 'Belum Pilih Unit'}</p>
                </div>
                <div className="flex items-center justify-between mt-3">
                  <span className="text-[10px] text-indigo-400 font-bold bg-indigo-50/50 px-2 py-0.5 rounded border border-indigo-100">
                    {[realisasiEnabled, vakasiPengujiEnabled, kepanitiaaanEnabled, receiptEnabled].filter(Boolean).length} Seksi Aktif
                  </span>
                </div>
              </div>
            )}
            {pelaporanList.map(rpt => {
              const isActive = selectedPelaporanId === rpt.id;
              return (
                <div
                  key={rpt.id}
                  onClick={() => loadPelaporanFromData(rpt)}
                  className={`p-4 rounded-2xl border transition-all cursor-pointer outline-none focus:outline-none flex flex-col justify-between min-h-[110px] ${isActive
                    ? 'bg-indigo-50/50 border-indigo-300 shadow-md ring-1 ring-indigo-300/25 scale-[1.02]'
                    : 'bg-white border-slate-100 hover:border-indigo-150 hover:shadow-sm'
                    }`}
                >
                  <div>
                    <p className="font-bold text-slate-800 text-sm line-clamp-1">{rpt.reportName || rpt.title}</p>
                    <p className="text-[10px] text-slate-400 font-bold mt-1 uppercase tracking-wider">{rpt.departmentUnit}</p>
                  </div>
                  <div className="flex items-center justify-between mt-3">
                    <span className="text-[10px] text-slate-400 font-bold bg-slate-50 px-2 py-0.5 rounded border border-slate-100">
                      {[rpt.realisasiEnabled !== false, rpt.vakasiPengujiEnabled !== false, rpt.kepanitiaaanEnabled !== false, rpt.receiptEnabled === true].filter(Boolean).length} Seksi
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Editor Form Card */}
      <Card className="bg-white rounded-[20px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-none overflow-visible p-4 md:p-6 space-y-5 animate-in fade-in duration-500">
        {/* Header */}
        <div className="flex justify-between items-center border-b border-slate-50 pb-4">
          <div>
            <h3 className="font-bold text-slate-800 text-xs md:text-sm flex items-center gap-2">
              <Plus className="w-4 h-4 text-indigo-500" />
              {selectedPelaporanId ? 'Ubah Laporan Kegiatan' : 'Buat Laporan Kegiatan Baru'}
            </h3>
            <p className="text-slate-400 text-[10px] md:text-xs mt-0.5">Laporan kegiatan multi-seksi dengan realisasi, vakasi, kepanitiaan, and kwitansi.</p>
          </div>
        </div>

        {/* Letterhead Preview */}
        <div className="border border-slate-200/80 rounded-2xl p-4 bg-slate-50/40 relative overflow-hidden flex items-center gap-4">
          <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-50/30 rounded-full blur-2xl pointer-events-none" />
          <img src="/Logo UNIPDU.png" alt="UNIPDU" className="w-12 h-12 shrink-0 object-contain" />
          <div className="space-y-0.5">
            <h4 className="text-xs font-black text-slate-800 tracking-wide uppercase">UNIVERSITAS PESANTREN TINGGI DARUL 'ULUM</h4>
            <p className="text-[10px] text-slate-500 font-medium">Pusat Pengisian Gaji & Administrasi Keuangan Kepegawaian</p>
          </div>
        </div>

        {/* Report Name & Department */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Nama Laporan</label>
            <Input
              type="text"
              placeholder="E.g., Ujian Proposal Tesis Pascasarjana..."
              value={pelaporanReportName}
              onChange={(e) => setPelaporanReportName(e.target.value)}
              className="rounded-xl border-slate-200 font-bold text-slate-900 text-xs h-11 w-full"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Unit Kerja (Department)</label>
            <Select value={pelaporanDept} onValueChange={(val) => setPelaporanDept(val || '')}>
              <SelectTrigger className={`rounded-xl text-sm font-bold h-11 border focus:ring-4 focus:ring-indigo-100 ${pelaporanDept ? 'bg-indigo-50/60 border-indigo-200 text-indigo-700' : 'bg-white border-slate-200 text-slate-400'}`}>
                <div className="flex items-center gap-2 min-w-0">
                  <Building2 className="w-4 h-4 shrink-0" />
                  <SelectValue placeholder="Pilih Unit Kerja..." />
                </div>
              </SelectTrigger>
              <SelectContent className="rounded-2xl border border-slate-100 shadow-2xl bg-white p-1.5 max-h-64 overflow-y-auto w-max min-w-[var(--radix-select-trigger-width)]">
                {departments.map(dept => (
                  <SelectItem key={dept} value={dept} className="rounded-xl text-xs font-bold uppercase text-slate-900 data-[highlighted]:bg-indigo-50 data-[highlighted]:text-indigo-700 cursor-pointer">{dept}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Section Toggles */}
        <div className="flex flex-wrap gap-3 pt-2">
          {[
            { key: 'realisasi', label: 'Realisasi Keuangan', enabled: realisasiEnabled, toggle: setRealisasiEnabled, icon: <Receipt className="w-3.5 h-3.5" /> },
            { key: 'vakasiPenguji', label: 'Vakasi Penguji', enabled: vakasiPengujiEnabled, toggle: setVakasiPengujiEnabled, icon: <Users className="w-3.5 h-3.5" /> },
            { key: 'kepanitiaan', label: 'Vakasi Kepanitiaan', enabled: kepanitiaaanEnabled, toggle: setKepanitiaaanEnabled, icon: <Layers className="w-3.5 h-3.5" /> },
            { key: 'kwitansi', label: 'Kwitansi', enabled: receiptEnabled, toggle: setReceiptEnabled, icon: <Receipt className="w-3.5 h-3.5" /> },
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

        {/* SECTION 1: REALISASI KEUANGAN */}
        {realisasiEnabled && (() => {
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
                if (cleanPart.includes('%')) val = val / 100;
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

          const totalPemasukanAnggaran = pemasukanRows.reduce((sum, r) => sum + (parseQty(r.rincianQty) * r.rincianRate), 0);
          const totalPemasukanRealisasi = pemasukanRows.reduce((sum, r) => sum + r.realisasi, 0);

          const yayasanAnggaran = totalPemasukanAnggaran * (yayasanPercentage / 100);
          const yayasanRealisasi = totalPemasukanRealisasi * (yayasanPercentage / 100);
          const unipduAnggaran = totalPemasukanAnggaran * (unipduPercentage / 100);
          const unipduRealisasi = totalPemasukanRealisasi * (unipduPercentage / 100);
          const totalPengembanganAnggaran = yayasanAnggaran + unipduAnggaran;
          const totalPengembanganRealisasi = yayasanRealisasi + unipduRealisasi;

          const danaOperasionalAnggaran = totalPemasukanAnggaran - totalPengembanganAnggaran;
          const danaOperasionalRealisasi = totalPemasukanRealisasi - totalPengembanganRealisasi;

          const expItems = pengeluaranRows.filter(r => r.type === 'item' && r.uraian.trim());
          const jumlahPengeluaranAnggaran = expItems.reduce((sum, r) => sum + (parseQty(r.rincianQty) * r.rincianRate), 0);
          const jumlahPengeluaranRealisasi = expItems.reduce((sum, r) => sum + r.realisasi, 0);

          const kepanitiaaanAnggaran = jumlahPengeluaranAnggaran * (kepanitiaaanPercentage / 100);
          const kepanitiaaanRealisasi = jumlahPengeluaranAnggaran * (kepanitiaaanPercentage / 100);

          const totalPengeluaranAnggaran = jumlahPengeluaranAnggaran + kepanitiaaanAnggaran;
          const totalPengeluaranRealisasi = jumlahPengeluaranRealisasi + kepanitiaaanRealisasi;

          const sisaAnggaran = danaOperasionalAnggaran - totalPengeluaranAnggaran;
          const sisaRealisasi = danaOperasionalRealisasi - totalPengeluaranRealisasi;

          return (
            <div className="border border-slate-150 rounded-2xl overflow-hidden">
              <button type="button" onClick={() => toggleSection('realisasi')} className="w-full flex items-center justify-between px-5 py-3.5 bg-gradient-to-r from-emerald-50 to-emerald-50/40 hover:from-emerald-100/60 transition-all cursor-pointer">
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
                    <Input type="text" placeholder="REALISASI UJIAN PROPOSAL TESIS..." value={realisasiTitle} onChange={(e) => setRealisasiTitle(e.target.value)} className="rounded-xl border-slate-200 font-bold text-slate-900 text-xs h-10 w-full uppercase" />
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
                            <th className="px-2.5 py-1.5 text-[10px] font-bold text-slate-500 uppercase w-12 text-center">NO</th>
                            <th className="px-2.5 py-1.5 text-[10px] font-bold text-slate-500 uppercase w-[35%]">URAIAN PEMASUKAN</th>
                            <th className="px-2.5 py-1.5 text-[10px] font-bold text-slate-500 uppercase w-[150px] text-center">QTY</th>
                            <th className="px-2.5 py-1.5 text-[10px] font-bold text-slate-500 uppercase w-[120px] text-center">RATE</th>
                            <th className="px-2.5 py-1.5 text-[10px] font-bold text-slate-500 uppercase w-[160px] text-right">ANGGARAN</th>
                            <th className="px-2.5 py-1.5 text-[10px] font-bold text-slate-500 uppercase w-[160px] text-right">REALISASI</th>
                            <th className="px-2.5 py-1.5 w-20 text-center"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {pemasukanRows.map((row, idx) => {
                            const anggaran = parseQty(row.rincianQty) * row.rincianRate;
                            return (
                              <tr key={idx} className="border-b border-slate-50 hover:bg-slate-50/30 transition-colors">
                                <td className="px-2.5 py-1 text-xs font-bold text-slate-400 text-center">{idx + 1}</td>
                                <td className="px-2.5 py-1"><Input type="text" placeholder="Biaya Test, Kontribusi, dll..." value={row.uraian} onChange={(e) => { const val = e.target.value; setPemasukanRows(prev => { const c = [...prev]; c[idx] = { ...c[idx], uraian: val }; return c; }); }} onKeyDown={(e) => handleTableKeyDown(e, 'pemasukan', idx, 0)} data-table="pemasukan" data-row={idx} data-col={0} className="rounded-lg border-slate-200 font-medium text-slate-900 text-xs h-7.5 w-full" /></td>
                                <td className="px-2.5 py-1"><Input type="text" placeholder="250 Siswa" value={row.rincianQty} onChange={(e) => { const val = e.target.value; setPemasukanRows(prev => { const c = [...prev]; const oldAnggaran = parseQty(c[idx].rincianQty) * c[idx].rincianRate; const isRealisasiMatching = c[idx].realisasi === oldAnggaran || c[idx].realisasi === 0; c[idx] = { ...c[idx], rincianQty: val }; if (isRealisasiMatching) { c[idx].realisasi = parseQty(val) * c[idx].rincianRate; } return c; }); }} onKeyDown={(e) => handleTableKeyDown(e, 'pemasukan', idx, 1)} data-table="pemasukan" data-row={idx} data-col={1} className="rounded-lg border-slate-200 font-bold text-slate-900 text-xs h-7.5 w-full text-center" /></td>
                                <td className="px-2.5 py-1"><Input type="text" inputMode="numeric" placeholder="0" value={row.rincianRate > 0 ? fmtRp(row.rincianRate) : ''} onChange={(e) => { const val = parseInt(e.target.value.replace(/\D/g, ''), 10) || 0; setPemasukanRows(prev => { const c = [...prev]; const oldAnggaran = parseQty(c[idx].rincianQty) * c[idx].rincianRate; const isRealisasiMatching = c[idx].realisasi === oldAnggaran || c[idx].realisasi === 0; c[idx] = { ...c[idx], rincianRate: val }; if (isRealisasiMatching) { c[idx].realisasi = parseQty(c[idx].rincianQty) * val; } return c; }); }} onKeyDown={(e) => handleTableKeyDown(e, 'pemasukan', idx, 2)} data-table="pemasukan" data-row={idx} data-col={2} className="rounded-lg border-slate-200 font-bold text-slate-900 text-xs h-7.5 w-full text-right" /></td>
                                <td className="px-2.5 py-1 text-xs font-bold text-slate-600 text-right font-mono">{fmtRp(anggaran)}</td>
                                <td className="px-2.5 py-1"><Input type="text" inputMode="numeric" placeholder="0" value={row.realisasi > 0 ? fmtRp(row.realisasi) : ''} onChange={(e) => { const val = parseInt(e.target.value.replace(/\D/g, ''), 10) || 0; setPemasukanRows(prev => { const c = [...prev]; c[idx] = { ...c[idx], realisasi: val }; return c; }); }} onKeyDown={(e) => handleTableKeyDown(e, 'pemasukan', idx, 3)} data-table="pemasukan" data-row={idx} data-col={3} className="rounded-lg border-slate-200 font-bold text-slate-900 text-xs h-7.5 w-full text-right" /></td>
                                <td className="px-2.5 py-1 text-center">
                                  <div className="flex items-center justify-center gap-1">
                                    <Button type="button" variant="ghost" size="icon" title="Sisipkan baris di bawah (Shift+Enter)" onClick={() => {
                                      setPemasukanRows(prev => {
                                        const c = [...prev];
                                        c.splice(idx + 1, 0, { uraian: '', rincianQty: '', rincianRate: 0, realisasi: 0 });
                                        return c;
                                      });
                                      setFocusTarget({ table: 'pemasukan', row: idx + 1, col: 0 });
                                    }} className="h-7 w-7 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg cursor-pointer">
                                      <Plus className="w-3.5 h-3.5" />
                                    </Button>
                                    <Button type="button" variant="ghost" size="icon" title="Hapus baris" onClick={() => setPemasukanRows(prev => prev.filter((_, i) => i !== idx))} className="h-7 w-7 text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer">
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                          <tr className="border-b border-slate-100 hover:bg-slate-50/10 transition-colors">
                            <td></td>
                            <td colSpan={6} className="px-2.5 py-1.5">
                              <Button type="button" size="sm" onClick={() => {
                                setPemasukanRows(prev => [...prev, { uraian: '', rincianQty: '', rincianRate: 0, realisasi: 0 }]);
                                setFocusTarget({ table: 'pemasukan', row: pemasukanRows.length, col: 0 });
                              }} className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold rounded-xl text-xs flex items-center gap-1 cursor-pointer">
                                <Plus className="w-3.5 h-3.5" /> Tambah Pemasukan
                              </Button>
                            </td>
                          </tr>
                          <tr className="bg-slate-50 border-t border-slate-200 font-semibold">
                            <td colSpan={4} className="px-2.5 py-2 text-xs font-bold text-slate-900 text-right">Total Pemasukan</td>
                            <td className="px-2.5 py-2 text-xs font-black text-slate-800 text-right font-mono">{fmtRp(totalPemasukanAnggaran)}</td>
                            <td className="px-2.5 py-2 text-xs font-black text-slate-800 text-right font-mono">{fmtRp(totalPemasukanRealisasi)}</td>
                            <td></td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* PART B: DANA PENGEMBANGAN & DANA OPERASIONAL (AUTOMATIC) */}
                  <div className="bg-slate-50/55 border border-slate-150 rounded-2xl p-4 md:p-5 space-y-4">
                    <span className="text-xs font-bold text-slate-850 uppercase tracking-wider bg-white px-2.5 py-1 rounded-lg border border-slate-200 shadow-2xs block w-fit font-sans">2. Alokasi Dana Pengembangan & Operasional</span>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1.5 bg-white p-3.5 rounded-xl border border-slate-200/60">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1 font-sans">Dana Pengembangan Yayasan (%)</label>
                        <div className="flex items-center gap-2">
                          <Input type="number" min={0} max={100} value={yayasanPercentage} onChange={(e) => setYayasanPercentage(parseFloat(e.target.value) || 0)} className="rounded-lg border-slate-200 font-bold text-slate-900 text-xs h-8 w-20 text-center" />
                          <span className="text-xs font-bold text-slate-500">%</span>
                          <div className="text-right ml-auto text-xs font-semibold text-slate-600">
                            Anggaran: <span className="font-bold text-slate-900 font-mono">{fmtRp(yayasanAnggaran)}</span>
                            <br />
                            Realisasi: <span className="font-bold text-slate-900 font-mono">{fmtRp(yayasanRealisasi)}</span>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-1.5 bg-white p-3.5 rounded-xl border border-slate-200/60">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1 font-sans">Dana Pengembangan UNIPDU (%)</label>
                        <div className="flex items-center gap-2">
                          <Input type="number" min={0} max={100} value={unipduPercentage} onChange={(e) => setUnipduPercentage(parseFloat(e.target.value) || 0)} className="rounded-lg border-slate-200 font-bold text-slate-900 text-xs h-8 w-20 text-center" />
                          <span className="text-xs font-bold text-slate-500">%</span>
                          <div className="text-right ml-auto text-xs font-semibold text-slate-600">
                            Anggaran: <span className="font-bold text-slate-900 font-mono">{fmtRp(unipduAnggaran)}</span>
                            <br />
                            Realisasi: <span className="font-bold text-slate-900 font-mono">{fmtRp(unipduRealisasi)}</span>
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
                          <span className="text-base font-black font-mono">{fmtRp(danaOperasionalAnggaran)}</span>
                        </div>
                        <div className="border-l border-indigo-800/60 hidden md:block"></div>
                        <div>
                          <span className="text-[10px] uppercase tracking-wider text-indigo-300 block font-sans">Realisasi Operasional</span>
                          <span className="text-base font-black font-mono">{fmtRp(danaOperasionalRealisasi)}</span>
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
                            <th className="px-2.5 py-1.5 text-[10px] font-bold text-slate-500 uppercase w-12 text-center">NO</th>
                            <th className="px-2.5 py-1.5 text-[10px] font-bold text-slate-500 uppercase w-[35%]">URAIAN PENGELUARAN</th>
                            <th className="px-2.5 py-1.5 text-[10px] font-bold text-slate-500 uppercase w-[150px] text-center">QTY</th>
                            <th className="px-2.5 py-1.5 text-[10px] font-bold text-slate-500 uppercase w-[120px] text-center">RATE</th>
                            <th className="px-2.5 py-1.5 text-[10px] font-bold text-slate-500 uppercase w-[160px] text-right">ANGGARAN</th>
                            <th className="px-2.5 py-1.5 text-[10px] font-bold text-slate-500 uppercase w-[160px] text-right">REALISASI</th>
                            <th className="px-2.5 py-1.5 w-20 text-center"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {pengeluaranRows.map((row, idx) => {
                            const lastHeaderIdx = pengeluaranRows.slice(0, idx + 1).findLastIndex(r => r.type === 'group_header');
                            const itemNum = row.type === 'item'
                              ? pengeluaranRows.slice(lastHeaderIdx === -1 ? 0 : lastHeaderIdx, idx + 1).filter(r => r.type === 'item').length
                              : null;
                            if (row.type === 'group_header') {
                              return (
                                <tr key={idx} className="bg-slate-50/60 border-b border-slate-100">
                                  <td className="px-2.5 py-1.5 text-xs font-bold text-slate-400 text-center"></td>
                                  <td colSpan={5} className="px-2.5 py-1.5"><Input type="text" placeholder="Nama grup (e.g., A. Pengeluaran)..." value={row.uraian} onChange={(e) => { const val = e.target.value; setPengeluaranRows(prev => { const c = [...prev]; c[idx] = { ...c[idx], uraian: val }; return c; }); }} onKeyDown={(e) => handleTableKeyDown(e, 'pengeluaran', idx, 0)} data-table="pengeluaran" data-row={idx} data-col={0} className="rounded-lg border-slate-200 font-bold text-slate-800 text-xs h-7.5 w-full bg-transparent border-none focus:ring-0" /></td>
                                  <td className="px-2.5 py-1.5 text-center">
                                    <div className="flex items-center justify-center gap-1">
                                      <Button type="button" variant="ghost" size="icon" title="Sisipkan baris di bawah (Shift+Enter)" onClick={() => {
                                        setPengeluaranRows(prev => {
                                          const c = [...prev];
                                          c.splice(idx + 1, 0, { type: 'item', uraian: '', rincianQty: '', rincianRate: 0, realisasi: 0 });
                                          return c;
                                        });
                                        setFocusTarget({ table: 'pengeluaran', row: idx + 1, col: 0 });
                                      }} className="h-7 w-7 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg cursor-pointer">
                                        <Plus className="w-3.5 h-3.5" />
                                      </Button>
                                      <Button type="button" variant="ghost" size="icon" title="Hapus grup" onClick={() => setPengeluaranRows(prev => prev.filter((_, i) => i !== idx))} className="h-7 w-7 text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer">
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
                                <td className="px-2.5 py-1 text-xs font-bold text-slate-400 text-center">{itemNum}</td>
                                <td className="px-2.5 py-1"><Input type="text" placeholder="Uraian pengeluaran..." value={row.uraian} onChange={(e) => { const val = e.target.value; setPengeluaranRows(prev => { const c = [...prev]; c[idx] = { ...c[idx], uraian: val }; return c; }); }} onKeyDown={(e) => handleTableKeyDown(e, 'pengeluaran', idx, 0)} data-table="pengeluaran" data-row={idx} data-col={0} className="rounded-lg border-slate-200 font-medium text-slate-900 text-xs h-7.5 w-full" /></td>
                                <td className="px-2.5 py-1"><Input type="text" placeholder="Nilai / Presentase" value={row.rincianQty} onChange={(e) => { const val = e.target.value; setPengeluaranRows(prev => { const c = [...prev]; const oldAnggaran = parseQty(c[idx].rincianQty) * c[idx].rincianRate; const isRealisasiMatching = c[idx].realisasi === oldAnggaran || c[idx].realisasi === 0; c[idx] = { ...c[idx], rincianQty: val }; if (isRealisasiMatching) { c[idx].realisasi = parseQty(val) * c[idx].rincianRate; } return c; }); }} onKeyDown={(e) => handleTableKeyDown(e, 'pengeluaran', idx, 1)} data-table="pengeluaran" data-row={idx} data-col={1} className="rounded-lg border-slate-200 font-bold text-slate-900 text-xs h-7.5 w-full text-center" /></td>
                                <td className="px-2.5 py-1"><Input type="text" inputMode="numeric" placeholder="0" value={row.rincianRate > 0 ? fmtRp(row.rincianRate) : ''} onChange={(e) => { const val = parseInt(e.target.value.replace(/\D/g, ''), 10) || 0; setPengeluaranRows(prev => { const c = [...prev]; const oldAnggaran = parseQty(c[idx].rincianQty) * c[idx].rincianRate; const isRealisasiMatching = c[idx].realisasi === oldAnggaran || c[idx].realisasi === 0; c[idx] = { ...c[idx], rincianRate: val }; if (isRealisasiMatching) { c[idx].realisasi = parseQty(c[idx].rincianQty) * val; } return c; }); }} onKeyDown={(e) => handleTableKeyDown(e, 'pengeluaran', idx, 2)} data-table="pengeluaran" data-row={idx} data-col={2} className="rounded-lg border-slate-200 font-bold text-slate-900 text-xs h-7.5 w-full text-right" /></td>
                                <td className="px-2.5 py-1 text-xs font-bold text-slate-600 text-right font-mono">{fmtRp(anggaran)}</td>
                                <td className="px-2.5 py-1"><Input type="text" inputMode="numeric" placeholder="0" value={row.realisasi > 0 ? fmtRp(row.realisasi) : ''} onChange={(e) => { const val = parseInt(e.target.value.replace(/\D/g, ''), 10) || 0; setPengeluaranRows(prev => { const c = [...prev]; c[idx] = { ...c[idx], realisasi: val }; return c; }); }} onKeyDown={(e) => handleTableKeyDown(e, 'pengeluaran', idx, 3)} data-table="pengeluaran" data-row={idx} data-col={3} className="rounded-lg border-slate-200 font-bold text-slate-900 text-xs h-7.5 w-full text-right" /></td>
                                <td className="px-2.5 py-1 text-center">
                                  <div className="flex items-center justify-center gap-1">
                                    <div className="relative">
                                      <Button type="button" variant="ghost" size="icon" title="Sisipkan baris di bawah" onClick={() => setActiveInsertMenuIdx(activeInsertMenuIdx === idx ? null : idx)} className="h-7 w-7 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg cursor-pointer">
                                        <Plus className="w-3.5 h-3.5" />
                                      </Button>
                                      {activeInsertMenuIdx === idx && (
                                        <>
                                          <div className="fixed inset-0 z-40" onClick={() => setActiveInsertMenuIdx(null)} />
                                          <div className="absolute right-0 bottom-8 z-50 w-44 bg-white border border-slate-150 rounded-xl shadow-xl py-1.5 animate-in fade-in slide-in-from-bottom-2 duration-150 text-left">
                                            <button type="button" onClick={() => { setPengeluaranRows(prev => { const c = [...prev]; c.splice(idx + 1, 0, { type: 'item', uraian: '', rincianQty: '', rincianRate: 0, realisasi: 0 }); return c; }); setFocusTarget({ table: 'pengeluaran', row: idx + 1, col: 0 }); setActiveInsertMenuIdx(null); }} className="w-full px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-indigo-50 hover:text-indigo-600 flex items-center gap-2 transition-colors cursor-pointer"><FileText className="w-3.5 h-3.5 text-indigo-500" /><span>Baris Biasa</span></button>
                                            <button type="button" onClick={() => { setPengeluaranRows(prev => { const c = [...prev]; c.splice(idx + 1, 0, { type: 'group_header', uraian: '', rincianQty: '', rincianRate: 0, realisasi: 0 }); return c; }); setFocusTarget({ table: 'pengeluaran', row: idx + 1, col: 0 }); setActiveInsertMenuIdx(null); }} className="w-full px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-indigo-50 hover:text-indigo-600 flex items-center gap-2 transition-colors cursor-pointer"><Layers className="w-3.5 h-3.5 text-indigo-500" /><span>Header Grup</span></button>
                                          </div>
                                        </>
                                      )}
                                    </div>
                                    <Button type="button" variant="ghost" size="icon" title="Hapus baris" onClick={() => setPengeluaranRows(prev => prev.filter((_, i) => i !== idx))} className="h-7 w-7 text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer">
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
                                <Button type="button" size="sm" onClick={() => {
                                  setPengeluaranRows(prev => [...prev, { type: 'item', uraian: '', rincianQty: '', rincianRate: 0, realisasi: 0 }]);
                                  setFocusTarget({ table: 'pengeluaran', row: pengeluaranRows.length, col: 0 });
                                }} className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold rounded-xl text-xs flex items-center gap-1 cursor-pointer">
                                  <Plus className="w-3.5 h-3.5" /> Tambah Baris
                                </Button>
                                <Button type="button" size="sm" onClick={() => {
                                  setPengeluaranRows(prev => [...prev, { type: 'group_header', uraian: '', rincianQty: '', rincianRate: 0, realisasi: 0 }]);
                                  setFocusTarget({ table: 'pengeluaran', row: pengeluaranRows.length, col: 0 });
                                }} variant="outline" className="border-indigo-200 text-indigo-600 font-bold rounded-xl text-xs flex items-center gap-1 cursor-pointer">
                                  <Layers className="w-3.5 h-3.5" /> Tambah Header Grup
                                </Button>
                              </div>
                            </td>
                          </tr>
                          <tr className="bg-slate-50 border-t border-slate-200">
                            <td colSpan={4} className="px-3 py-2.5 text-xs font-bold text-slate-900 text-right">Jumlah Pengeluaran</td>
                            <td className="px-3 py-2.5 text-xs font-black text-slate-800 text-right font-mono">{fmtRp(jumlahPengeluaranAnggaran)}</td>
                            <td className="px-3 py-2.5 text-xs font-black text-slate-800 text-right font-mono">{fmtRp(jumlahPengeluaranRealisasi)}</td>
                            <td></td>
                          </tr>
                          <tr className="bg-slate-50/50">
                            <td colSpan={3} className="px-3 py-2 text-xs font-bold text-slate-650 text-right">Kepanitiaan</td>
                            <td className="px-3 py-2"><div className="flex items-center gap-1 justify-end"><Input type="number" value={kepanitiaaanPercentage} onChange={(e) => setKepanitiaaanPercentage(parseFloat(e.target.value) || 0)} className="rounded-lg border-slate-200 font-bold text-slate-900 text-xs h-7 w-16 text-center" /><span className="text-xs font-bold text-slate-550">%</span></div></td>
                            <td className="px-3 py-2 text-xs font-bold text-slate-600 text-right font-mono">{fmtRp(kepanitiaaanAnggaran)}</td>
                            <td className="px-3 py-2 text-xs font-bold text-slate-600 text-right font-mono">{fmtRp(kepanitiaaanRealisasi)}</td>
                            <td></td>
                          </tr>
                          <tr className="bg-slate-50 border-t border-slate-200 font-semibold">
                            <td colSpan={4} className="px-3 py-2.5 text-xs font-black text-slate-900 text-right uppercase">Total Pengeluaran</td>
                            <td className="px-3 py-2.5 text-xs font-black text-slate-800 text-right font-mono">{fmtRp(totalPengeluaranAnggaran)}</td>
                            <td className="px-3 py-2.5 text-xs font-black text-slate-800 text-right font-mono">{fmtRp(totalPengeluaranRealisasi)}</td>
                            <td></td>
                          </tr>
                          <tr className={`border-t-2 border-slate-200 ${sisaAnggaran >= 0 ? 'bg-emerald-50/40' : 'bg-rose-50/40'}`}>
                            <td colSpan={4} className={`px-3 py-3 text-xs font-black text-right uppercase ${sisaAnggaran >= 0 ? 'text-emerald-800' : 'text-rose-800'}`}>Sisa / Defisit Dana Operasional</td>
                            <td className={`px-3 py-3 text-xs font-black text-right font-mono ${sisaAnggaran >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{sisaAnggaran < 0 ? '-' : ''}{fmtRp(Math.abs(sisaAnggaran))}</td>
                            <td className={`px-3 py-3 text-xs font-black text-right font-mono ${sisaRealisasi >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{sisaRealisasi < 0 ? '-' : ''}{fmtRp(Math.abs(sisaRealisasi))}</td>
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

        {/* SECTION 2: VAKASI PENGUJI */}
        {vakasiPengujiEnabled && (
          <div className="border border-slate-150 rounded-2xl overflow-hidden">
            <button type="button" onClick={() => toggleSection('vakasiPenguji')} className="w-full flex items-center justify-between px-5 py-3.5 bg-gradient-to-r from-blue-50 to-blue-50/40 hover:from-blue-100/60 transition-all cursor-pointer">
              <div className="flex items-center gap-2.5">
                <Users className="w-4 h-4 text-blue-600" />
                <span className="font-bold text-blue-800 text-xs uppercase tracking-wider">Seksi 2: Vakasi Penguji</span>
              </div>
              {expandedSections.vakasiPenguji ? <ChevronDown className="w-4 h-4 text-blue-500" /> : <ChevronRight className="w-4 h-4 text-blue-500" />}
            </button>
            {expandedSections.vakasiPenguji && (
              <div className="p-4 md:p-5 space-y-4 bg-white">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Judul Seksi (di PDF)</label>
                  <Input type="text" placeholder="VAKASI PENGUJI UJIAN PROPOSAL TESIS..." value={vakasiPengujiTitle} onChange={(e) => setVakasiPengujiTitle(e.target.value)} className="rounded-xl border-slate-200 font-bold text-slate-900 text-xs h-10 w-full uppercase" />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Daftar Role & Tarif</span>
                    <Button type="button" size="sm" onClick={() => setVakasiRoles(prev => [...prev, { name: '', rate: 0 }])} className="bg-blue-50 hover:bg-blue-100 text-blue-600 font-bold rounded-xl text-xs flex items-center gap-1 cursor-pointer"><Plus className="w-3.5 h-3.5" /> Tambah Role</Button>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {vakasiRoles.map((role, rIdx) => (
                      <div key={rIdx} className="flex items-center gap-2 p-2.5 rounded-xl border border-blue-100 bg-blue-50/20">
                        <Input type="text" placeholder="Nama Role" value={role.name} onChange={(e) => { const val = e.target.value; setVakasiRoles(prev => { const c = [...prev]; c[rIdx] = { ...c[rIdx], name: val }; return c; }); }} className="rounded-lg border-slate-200 font-bold text-slate-900 text-xs h-8 w-28" />
                        <Input type="text" inputMode="numeric" placeholder="Tarif" value={role.rate > 0 ? fmtRp(role.rate) : ''} onChange={(e) => { const val = parseInt(e.target.value.replace(/\D/g, ''), 10) || 0; setVakasiRoles(prev => { const c = [...prev]; c[rIdx] = { ...c[rIdx], rate: val }; return c; }); }} className="rounded-lg border-slate-200 font-bold text-slate-900 text-xs h-8 w-28 text-right" />
                        {vakasiRoles.length > 1 && <Button type="button" variant="ghost" size="icon" onClick={() => setVakasiRoles(prev => prev.filter((_, i) => i !== rIdx))} className="h-7 w-7 text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer"><X className="w-3.5 h-3.5" /></Button>}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Tabel Pegawai</span>
                </div>
                <div className="border border-slate-150 rounded-2xl shadow-sm overflow-x-auto bg-white">
                  <table className="w-full text-left border-collapse min-w-[700px]">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-100">
                        <th className="px-3 py-2.5 text-[10px] font-bold text-slate-500 uppercase w-10 text-center">NO</th>
                        <th className="px-3 py-2.5 text-[10px] font-bold text-slate-500 uppercase w-[180px]">NAMA</th>
                        {vakasiRoles.map((role, rIdx) => (
                          <th key={rIdx} className="px-3 py-2.5 text-[10px] font-bold text-blue-600 uppercase text-center">{role.name || `Role ${rIdx + 1}`}<br /><span className="text-slate-400 font-normal">@{fmtRp(role.rate)}</span></th>
                        ))}
                        <th className="px-3 py-2.5 text-[10px] font-bold text-slate-500 uppercase w-[120px] text-right">JUMLAH</th>
                        <th className="px-3 py-2.5 w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {vakasiPengujiRows.map((row, idx) => {
                        const rowTotal = vakasiRoles.reduce((sum, role) => sum + ((row.roleQtys[role.name] || 0) * role.rate), 0);
                        const handleEmpSearch = (text: string) => { setVakasiPengujiRows(prev => { const c = [...prev]; c[idx] = { ...c[idx], searchText: text, showDropdown: true }; return c; }); setActivePelaporanSuggestionIndex(0); };
                        const selectEmp = (emp: any) => { setVakasiPengujiRows(prev => { const c = [...prev]; c[idx] = { ...c[idx], employeeId: emp.id, employeeName: emp.name, searchText: emp.name, showDropdown: false }; return c; }); };
                        return (
                          <tr key={idx} className={`border-b border-slate-50 hover:bg-slate-50/30 transition-colors ${row.showDropdown ? 'relative z-50' : 'relative z-0'}`}>
                            <td className="px-3 py-2 text-xs font-bold text-slate-400 text-center">{idx + 1}</td>
                            <td className="px-3 py-2 relative">
                              <div className="relative">
                                <Input type="text" placeholder="Cari nama..." value={row.searchText || ''} onChange={(e) => handleEmpSearch(e.target.value)}
                                  onFocus={() => { setVakasiPengujiRows(prev => { const c = [...prev]; c[idx] = { ...c[idx], showDropdown: true }; return c; }); setActivePelaporanSuggestionIndex(0); }}
                                  onBlur={() => { setTimeout(() => { setVakasiPengujiRows(prev => { const c = [...prev]; if (c[idx]) c[idx] = { ...c[idx], showDropdown: false }; return c; }); }, 200); }}
                                  className="rounded-lg border-slate-200 font-bold text-slate-900 text-xs h-8 w-full" />
                                {row.showDropdown && (
                                  <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-2xl z-[999] max-h-48 overflow-y-auto divide-y divide-slate-50">
                                    {(() => {
                                      const otherIds = vakasiPengujiRows.filter((_, i) => i !== idx).map(w => w.employeeId).filter(Boolean);
                                      const filtered = loyalisEmployees.filter(emp => !otherIds.includes(emp.id)).filter(emp => emp.name.toLowerCase().includes((row.searchText || '').toLowerCase()));
                                      if (filtered.length === 0) return <div className="p-3 text-center text-slate-400 text-xs font-semibold">Tidak ditemukan</div>;
                                      return filtered.map((emp, empIdx) => (
                                        <div key={emp.id} onClick={() => selectEmp(emp)} className={`px-3 py-2 text-xs font-semibold cursor-pointer transition-colors text-left ${empIdx === activePelaporanSuggestionIndex ? 'bg-blue-50 text-blue-600 font-bold' : 'hover:bg-blue-50 hover:text-blue-600 text-slate-900'}`}>
                                          <p>{emp.name}</p><p className="text-[9px] text-slate-400 mt-0.5">{emp.role} · {emp.id}</p>
                                        </div>
                                      ));
                                    })()}
                                  </div>
                                )}
                              </div>
                            </td>
                            {vakasiRoles.map((role, rIdx) => (
                              <td key={rIdx} className="px-3 py-2 text-center">
                                <Input type="number" min={0} placeholder="0" value={row.roleQtys[role.name] || ''} onChange={(e) => { const val = parseInt(e.target.value) || 0; setVakasiPengujiRows(prev => { const c = [...prev]; c[idx] = { ...c[idx], roleQtys: { ...c[idx].roleQtys, [role.name]: val } }; return c; }); }} className="rounded-lg border-slate-200 font-bold text-slate-900 text-xs h-8 w-16 text-center mx-auto" />
                              </td>
                            ))}
                            <td className="px-3 py-2 text-xs font-black text-slate-900 text-right font-mono">{fmtRp(rowTotal)}</td>
                            <td className="px-3 py-2 text-center"><Button type="button" variant="ghost" size="icon" onClick={() => setVakasiPengujiRows(prev => prev.filter((_, i) => i !== idx))} className="h-7 w-7 text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer"><Trash2 className="w-3.5 h-3.5" /></Button></td>
                          </tr>
                        );
                      })}
                      {/* Action Row inside Table Body */}
                      <tr className="border-b border-slate-100 hover:bg-slate-50/10 transition-colors">
                        <td></td>
                        <td colSpan={1 + vakasiRoles.length} className="px-3 py-2.5">
                          <Button type="button" size="sm" onClick={() => setVakasiPengujiRows(prev => [...prev, { employeeId: '', employeeName: '', roleQtys: {}, searchText: '', showDropdown: false }])} className="bg-blue-50 hover:bg-blue-100 text-blue-600 font-bold rounded-xl text-xs flex items-center gap-1 cursor-pointer">
                            <Plus className="w-3.5 h-3.5" /> Tambah Pegawai
                          </Button>
                        </td>
                        <td colSpan={2}></td>
                      </tr>
                      <tr className="bg-blue-50/50 border-t-2 border-blue-200">
                        <td colSpan={2 + vakasiRoles.length} className="px-3 py-2.5 text-xs font-black text-blue-800 text-right uppercase">Grand Total</td>
                        <td className="px-3 py-2.5 text-xs font-black text-blue-700 text-right font-mono">{fmtRp(vakasiPengujiRows.reduce((sum, row) => sum + vakasiRoles.reduce((s, role) => s + ((row.roleQtys[role.name] || 0) * role.rate), 0), 0))}</td>
                        <td></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* SECTION 3: VAKASI KEPANITIAAN */}
        {kepanitiaaanEnabled && (
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
                  <Input type="text" placeholder="VAKASI KEPANITIAAN UJIAN PROPOSAL TESIS..." value={kepanitiaaanTitle} onChange={(e) => setKepanitiaaanTitle(e.target.value)} className="rounded-xl border-slate-200 font-bold text-slate-900 text-xs h-10 w-full uppercase" />
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
                        return (
                          <tr key={idx} className={`border-b border-slate-50 hover:bg-slate-50/30 transition-colors ${row.showDropdown ? 'relative z-50' : 'relative z-0'}`}>
                            <td className="px-3 py-2 text-xs font-bold text-slate-400 text-center">{idx + 1}</td>
                            <td className="px-3 py-2 relative">
                              <div className="relative">
                                <Input type="text" placeholder="Cari / ketik nama..." value={row.searchText || ''}
                                  onChange={(e) => { const text = e.target.value; setKepanitiaaanRows(prev => { const c = [...prev]; c[idx] = { ...c[idx], name: text, searchText: text, showDropdown: true }; return c; }); setActivePelaporanSuggestionIndex(0); }}
                                  onFocus={() => { setKepanitiaaanRows(prev => { const c = [...prev]; c[idx] = { ...c[idx], showDropdown: true }; return c; }); setActivePelaporanSuggestionIndex(0); }}
                                  onBlur={() => { setTimeout(() => { setKepanitiaaanRows(prev => { const c = [...prev]; if (c[idx]) c[idx] = { ...c[idx], showDropdown: false }; return c; }); }, 200); }}
                                  className="rounded-lg border-slate-200 font-bold text-slate-900 text-xs h-8 w-full" />
                                {row.showDropdown && (row.searchText || '').length > 0 && (
                                  <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-2xl z-[999] max-h-48 overflow-y-auto divide-y divide-slate-50">
                                    {(() => {
                                      const filtered = loyalisEmployees.filter(emp => emp.name.toLowerCase().includes((row.searchText || '').toLowerCase()));
                                      if (filtered.length === 0) return null;
                                      return filtered.slice(0, 8).map((emp, empIdx) => (
                                        <div key={emp.id} onClick={() => { setKepanitiaaanRows(prev => { const c = [...prev]; c[idx] = { ...c[idx], name: emp.name, employeeId: emp.id, searchText: emp.name, showDropdown: false }; return c; }); }}
                                          className={`px-3 py-2 text-xs font-semibold cursor-pointer transition-colors text-left ${empIdx === activePelaporanSuggestionIndex ? 'bg-violet-50 text-violet-600 font-bold' : 'hover:bg-violet-50 hover:text-violet-600 text-slate-900'}`}>
                                          <p>{emp.name}</p><p className="text-[9px] text-slate-400 mt-0.5">{emp.role} · {emp.id}</p>
                                        </div>
                                      ));
                                    })()}
                                  </div>
                                )}
                              </div>
                            </td>
                            {kepanitiaaanPhases.map((phase, pIdx) => (
                              <td key={pIdx} className="px-3 py-2 text-center">
                                <Input type="text" inputMode="numeric" placeholder="0" value={(row.phaseAmounts[phase.name] || 0) > 0 ? fmtRp(row.phaseAmounts[phase.name] || 0) : ''} onChange={(e) => { const val = parseInt(e.target.value.replace(/\D/g, ''), 10) || 0; setKepanitiaaanRows(prev => { const c = [...prev]; c[idx] = { ...c[idx], phaseAmounts: { ...c[idx].phaseAmounts, [phase.name]: val } }; return c; }); }} className="rounded-lg border-slate-200 font-bold text-slate-900 text-xs h-8 w-24 text-right mx-auto" />
                              </td>
                            ))}
                            <td className="px-3 py-2 text-xs font-black text-slate-900 text-right font-mono">{fmtRp(rowTotal)}</td>
                            <td className="px-3 py-2 text-center"><Button type="button" variant="ghost" size="icon" onClick={() => setKepanitiaaanRows(prev => prev.filter((_, i) => i !== idx))} className="h-7 w-7 text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer"><Trash2 className="w-3.5 h-3.5" /></Button></td>
                          </tr>
                        );
                      })}
                      {/* Action Row inside Table Body */}
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

        {/* SECTION 4: KWITANSI */}
        {receiptEnabled && (
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
                  <Input type="text" placeholder="KWITANSI PEMBELIAN KONSUMSI..." value={receiptTitle} onChange={(e) => setReceiptTitle(e.target.value)} className="rounded-xl border-slate-200 font-bold text-slate-900 text-xs h-10 w-full uppercase" />
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
                      {/* Action Row inside Table Body */}
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

        {/* Shared Signature Config */}
        <div className="space-y-4 pt-2 border-t border-slate-100">
          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Konfigurasi Tanda Tangan (Maks 3)</span>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {pelaporanSignatures.map((sig, sIdx) => {
              const updateSig = (field: 'label' | 'name' | 'title', val: string) => {
                setPelaporanSignatures(prev => {
                  const c = [...prev];
                  c[sIdx] = { ...c[sIdx], [field]: val };
                  return c;
                });
              };
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
                          setPelaporanSignatures(prev => {
                            const c = [...prev];
                            c[sIdx] = { ...c[sIdx], searchText: text, name: '', showDropdown: true };
                            return c;
                          });
                          setActivePelaporanSuggestionIndex(0);
                        }}
                        onFocus={() => {
                          setPelaporanSignatures(prev => {
                            const c = [...prev];
                            c[sIdx] = { ...c[sIdx], showDropdown: true };
                            return c;
                          });
                          setActivePelaporanSuggestionIndex(0);
                        }}
                        onBlur={() => {
                          setTimeout(() => {
                            setPelaporanSignatures(prev => {
                              const c = [...prev];
                              if (c[sIdx]) c[sIdx] = { ...c[sIdx], showDropdown: false };
                              return c;
                            });
                          }, 200);
                        }}
                        className={`rounded-lg text-xs h-8 w-full pr-8 font-bold transition-all ${sig.name
                            ? 'bg-emerald-50/40 border-emerald-300 text-emerald-900 placeholder-emerald-400 focus:ring-emerald-100'
                            : 'bg-white border-slate-200 text-slate-900 placeholder-slate-400 focus:ring-indigo-100'
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
                                  setPelaporanSignatures(prev => {
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
                    <Input type="text" placeholder="Jabatan/Titel" value={sig.title} onChange={(e) => updateSig('title', e.target.value)} className="rounded-lg border-slate-200 text-xs h-8 font-medium text-slate-800" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap justify-between gap-3 pt-6 border-t border-slate-100 mt-auto">
          <div>
            {selectedPelaporanId && (
              <Button type="button" variant="outline" onClick={() => handleDeletePelaporan(selectedPelaporanId)} className="rounded-xl border-rose-200 text-rose-600 bg-rose-50/50 hover:bg-rose-50 text-xs font-bold flex items-center gap-1.5 h-10 cursor-pointer">
                <Trash2 className="w-4 h-4" /> Hapus Laporan
              </Button>
            )}
          </div>
          <div className="flex gap-2 items-center flex-wrap">
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
            <Button type="button" onClick={handleSavePelaporan} disabled={savingPelaporan} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl px-6 text-xs flex items-center gap-1.5 shadow-md h-10 cursor-pointer">
              {savingPelaporan ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Simpan Laporan
            </Button>
            <Button type="button" onClick={handlePrintPelaporan} disabled={!pelaporanReportName.trim() || !pelaporanDept} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl px-6 text-xs flex items-center gap-1.5 shadow-md h-10 cursor-pointer">
              <FileText className="w-4 h-4" /> Cetak PDF
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
