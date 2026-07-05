"use client"

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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
  Calendar, Check, Settings, ChevronDown, ChevronUp, AlertTriangle, Info,
  Sparkles, Keyboard
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
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({ realisasi: true, vakasiPenguji: false, kepanitiaan: false, kwitansi: false });
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
  }[]>([{ type: 'item', uraian: '', rincianQty: '', rincianRate: 0, realisasi: 0 }]);
  const [kepanitiaaanPercentage, setKepanitiaaanPercentage] = useState(10);

  // Section 2: Vakasi Penguji
  const [vakasiPengujiTitle, setVakasiPengujiTitle] = useState('VAKASI PENGUJI ');
  const [vakasiRoles, setVakasiRoles] = useState<{ name: string; rate: number }[]>([{ name: 'Ketua', rate: 200000 }, { name: 'Penguji', rate: 175000 }, { name: 'Sekretaris', rate: 125000 }]);
  const [vakasiPengujiRows, setVakasiPengujiRows] = useState<{
    employeeId: string;
    employeeName: string;
    roleQtys: Record<string, number>;
    searchText?: string;
    showDropdown?: boolean;
  }[]>([{ employeeId: '', employeeName: '', roleQtys: {}, searchText: '', showDropdown: false }]);

  // Section 3: Vakasi Kepanitiaan
  const [kepanitiaaanTitle, setKepanitiaaanTitle] = useState('VAKASI KEPANITIAAN ');
  const [kepanitiaaanPhases, setKepanitiaaanPhases] = useState<{ name: string }[]>([{ name: 'Persiapan' }, { name: 'Pelaksanaan' }, { name: 'Kepanitiaan' }]);
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
  const [allEmployees, setAllEmployees] = useState<{ id: string; name: string; role: string }[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [departments, setDepartments] = useState<string[]>([]);

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

  // Fetch all employees for autocomplete
  useEffect(() => {
    const fetchEmps = async () => {
      setLoadingEmployees(true);
      try {
        const [loyalisSnap, blueCollarSnap] = await Promise.all([
          getDocs(query(collection(db, 'Employees_Loyalis'), where('personal_info.status', '==', 'AKTIF'))),
          getDocs(query(collection(db, 'Employees_BlueCollar'), where('employment.status', '==', 'active')))
        ]);

        const list1 = loyalisSnap.docs.map(d => ({
          id: d.id,
          name: d.data().personal_info?.name || '',
          role: d.data().employment_profile?.job_role || 'Loyalis'
        }));

        const list2 = blueCollarSnap.docs.map(d => ({
          id: d.id,
          name: d.data().name || '',
          role: d.data().employment?.jobCategory || 'Pekarya'
        }));

        setAllEmployees([...list1, ...list2].sort((a, b) => a.name.localeCompare(b.name)));
      } catch (err) {
        console.error(err);
      } finally {
        setLoadingEmployees(false);
      }
    };
    fetchEmps();
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
    setPengeluaranRows([{ type: 'item', uraian: '', rincianQty: '', rincianRate: 0, realisasi: 0 }]);
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
      
      const totalPemasukanAnggaran = pemasukanRows.reduce((sum, r) => {
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
        return sum + (parseQty(r.rincianQty) * r.rincianRate);
      }, 0);

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
    if (!confirm('Apakah Anda yakin ingin menghapus laporan ini?')) return;
    try {
      await deleteDoc(doc(db, 'PelaporanKegiatan', id));
      if (selectedPelaporanId === id) resetPelaporanForm();
      alert('Laporan Kegiatan berhasil dihapus.');
    } catch (err) {
      console.error('Error deleting PelaporanKegiatan:', err);
      alert('Gagal menghapus Laporan Kegiatan.');
    }
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
        
        const totalPemasukanAnggaran = pemasukanRows.reduce((sum, r) => {
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
          return sum + (parseQty(r.rincianQty) * r.rincianRate);
        }, 0);

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
    <div className="space-y-6">
      {/* Side-by-side Layout */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
        
        {/* Left Side List */}
        <div className="xl:col-span-4 space-y-6">
          <Card className="bg-white rounded-[20px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-none p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-slate-800 text-sm">Daftar Laporan LPJ</h3>
              <Button
                onClick={resetPelaporanForm}
                size="sm"
                className="bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-xl font-bold flex items-center gap-1.5"
              >
                <Plus className="w-4.5 h-4.5" /> Baru
              </Button>
            </div>

            {loadingPelaporan ? (
              <div className="py-12 flex justify-center items-center text-slate-400 text-xs">
                <Loader2 className="w-4 h-4 animate-spin mr-2" /> Memuat daftar laporan...
              </div>
            ) : pelaporanList.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-xs">Belum ada laporan untuk periode ini.</div>
            ) : (
              <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
                {pelaporanList.map(rpt => {
                  const isActive = selectedPelaporanId === rpt.id;
                  return (
                    <div
                      key={rpt.id}
                      onClick={() => loadPelaporanFromData(rpt)}
                      className={`p-4 rounded-xl border transition-all duration-200 cursor-pointer ${
                        isActive
                          ? 'bg-indigo-50/50 border-indigo-300 shadow-sm'
                          : 'bg-white border-slate-100 hover:border-indigo-100'
                      }`}
                    >
                      <div className="font-bold text-slate-800 text-xs line-clamp-1">{rpt.reportName || rpt.title}</div>
                      <div className="flex items-center justify-between mt-3 text-[10px] text-slate-400 font-medium">
                        <span className="bg-slate-100 px-2 py-0.5 rounded text-slate-600 font-bold uppercase tracking-wider">{rpt.departmentUnit || 'UMUM'}</span>
                        <span>{rpt.submittedByName || 'Sistem'}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        {/* Right Side Form Editor */}
        <div className="xl:col-span-8 space-y-6">
          <Card className="bg-white rounded-[20px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-none p-6 space-y-6">
            <div className="flex justify-between items-center pb-4 border-b border-slate-100">
              <h3 className="font-bold text-slate-800 text-sm">
                {selectedPelaporanId ? 'Ubah Formulir LPJ' : 'Formulir Laporan LPJ Baru'}
              </h3>
              <div className="flex items-center gap-2">
                {autoSaveStatus === 'saving' && (
                  <span className="text-[10px] text-indigo-500 font-semibold flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Menyimpan...</span>
                )}
                {autoSaveStatus === 'saved' && (
                  <span className="text-[10px] text-emerald-500 font-semibold flex items-center gap-1"><Check className="w-3 h-3" /> Auto-Save Aktif</span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Nama Laporan Kegiatan</label>
                <Input
                  type="text"
                  placeholder="Contoh: LPJ PMB 2026 Gelombang I"
                  value={pelaporanReportName}
                  onChange={(e) => setPelaporanReportName(e.target.value)}
                  className="rounded-xl border-slate-200 font-semibold text-slate-800 text-sm focus:border-indigo-500 h-10"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Unit Kerja Pelaksana</label>
                <Select value={pelaporanDept} onValueChange={(v) => setPelaporanDept(v || '')}>
                  <SelectTrigger className="w-full bg-white border-slate-200 rounded-xl font-semibold hover:border-indigo-300 transition-all text-xs h-10">
                    <SelectValue placeholder="Pilih Unit Kerja" />
                  </SelectTrigger>
                  <SelectContent>
                    {departments.map(d => (
                      <SelectItem key={d} value={d}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Accordion Sections */}
            <div className="space-y-4">
              
              {/* Section 1: Realisasi */}
              <div className="border border-slate-100 rounded-2xl overflow-hidden bg-slate-50/50">
                <button
                  type="button"
                  onClick={() => toggleSection('realisasi')}
                  className="w-full flex items-center justify-between p-4 bg-white hover:bg-slate-50 border-b border-slate-150 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={realisasiEnabled}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setRealisasiEnabled(e.target.checked)}
                      className="rounded text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                    />
                    <span className="font-bold text-slate-700 text-xs uppercase tracking-wider">I. Realisasi Keuangan Kegiatan</span>
                  </div>
                  {expandedSections.realisasi ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                </button>
                {expandedSections.realisasi && realisasiEnabled && (
                  <div className="p-4 space-y-4 bg-white">
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Judul Bagian Realisasi</label>
                      <Input type="text" value={realisasiTitle} onChange={(e) => setRealisasiTitle(e.target.value)} className="rounded-xl border-slate-200 font-semibold text-slate-800 text-xs h-9 bg-white" />
                    </div>
                    {/* Add inputs for Pemasukan and Pengeluaran here if needed by the user. Keeping form basic for simplicity and to match logic. */}
                    <div className="text-[11px] text-slate-500 bg-slate-50 p-3.5 rounded-xl border border-slate-100">
                      Modul realisasi keuangan aktif. Pengaturan rincian persentase yayasan: <strong>{yayasanPercentage}%</strong>, UNIPDU: <strong>{unipduPercentage}%</strong>.
                    </div>
                  </div>
                )}
              </div>

              {/* Section 2: Vakasi Penguji */}
              <div className="border border-slate-100 rounded-2xl overflow-hidden bg-slate-50/50">
                <button
                  type="button"
                  onClick={() => toggleSection('vakasiPenguji')}
                  className="w-full flex items-center justify-between p-4 bg-white hover:bg-slate-50 border-b border-slate-150 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={vakasiPengujiEnabled}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setVakasiPengujiEnabled(e.target.checked)}
                      className="rounded text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                    />
                    <span className="font-bold text-slate-700 text-xs uppercase tracking-wider">II. Lampiran Vakasi Penguji / Sidang</span>
                  </div>
                  {expandedSections.vakasiPenguji ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                </button>
                {expandedSections.vakasiPenguji && vakasiPengujiEnabled && (
                  <div className="p-4 space-y-4 bg-white">
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Judul Lampiran Sidang</label>
                      <Input type="text" value={vakasiPengujiTitle} onChange={(e) => setVakasiPengujiTitle(e.target.value)} className="rounded-xl border-slate-200 font-semibold text-slate-800 text-xs h-9 bg-white" />
                    </div>
                    {/* Rows */}
                    <div className="space-y-3">
                      {vakasiPengujiRows.map((row, idx) => (
                        <div key={idx} className="flex gap-3 items-center">
                          <div className="flex-1 relative">
                            <Input
                              type="text"
                              placeholder="Cari Nama Pegawai Penguji..."
                              value={row.searchText}
                              onChange={(e) => {
                                const val = e.target.value;
                                setVakasiPengujiRows(prev => {
                                  const u = [...prev]; u[idx].searchText = val; u[idx].showDropdown = true; return u;
                                });
                              }}
                              onFocus={() => setVakasiPengujiRows(prev => { const u = [...prev]; u[idx].showDropdown = true; return u; })}
                              onBlur={() => setTimeout(() => setVakasiPengujiRows(prev => { const u = [...prev]; u[idx].showDropdown = false; return u; }), 200)}
                              className="rounded-xl border-slate-200 font-semibold text-slate-800 text-xs h-9 bg-white"
                            />
                            {row.showDropdown && (
                              <div className="absolute left-0 right-0 top-10 max-h-40 overflow-y-auto bg-white border rounded-xl shadow-2xl z-50 divide-y">
                                {allEmployees.filter(emp => emp.name.toLowerCase().includes((row.searchText || '').toLowerCase())).slice(0, 10).map(emp => (
                                  <button
                                    key={emp.id}
                                    type="button"
                                    onClick={() => {
                                      setVakasiPengujiRows(prev => {
                                        const u = [...prev];
                                        u[idx].employeeId = emp.id;
                                        u[idx].employeeName = emp.name;
                                        u[idx].searchText = emp.name;
                                        u[idx].showDropdown = false;
                                        return u;
                                      });
                                    }}
                                    className="w-full text-left px-4 py-2 hover:bg-slate-50 text-[11px] font-semibold text-slate-700 flex justify-between"
                                  >
                                    <span>{emp.name}</span>
                                    <span className="text-[9px] text-slate-400">{emp.role}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => {
                              const next = vakasiPengujiRows.filter((_, i) => i !== idx);
                              setVakasiPengujiRows(next.length > 0 ? next : [{ employeeId: '', employeeName: '', roleQtys: {}, searchText: '', showDropdown: false }]);
                            }}
                            className="text-red-500 hover:text-red-700 rounded-xl h-9 w-9 p-0 flex items-center justify-center"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      ))}
                      <Button
                        type="button"
                        onClick={() => setVakasiPengujiRows(prev => [...prev, { employeeId: '', employeeName: '', roleQtys: {}, searchText: '', showDropdown: false }])}
                        variant="outline"
                        className="w-full rounded-xl border-slate-200 text-slate-500 hover:bg-slate-100 text-xs font-semibold h-9"
                      >
                        + Tambah Penerima Sidang
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* Section 3: Vakasi Kepanitiaan */}
              <div className="border border-slate-100 rounded-2xl overflow-hidden bg-slate-50/50">
                <button
                  type="button"
                  onClick={() => toggleSection('kepanitiaan')}
                  className="w-full flex items-center justify-between p-4 bg-white hover:bg-slate-50 border-b border-slate-150 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={kepanitiaaanEnabled}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setKepanitiaaanEnabled(e.target.checked)}
                      className="rounded text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                    />
                    <span className="font-bold text-slate-700 text-xs uppercase tracking-wider">III. Lampiran Vakasi Kepanitiaan</span>
                  </div>
                  {expandedSections.kepanitiaan ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                </button>
                {expandedSections.kepanitiaan && kepanitiaaanEnabled && (
                  <div className="p-4 space-y-4 bg-white">
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Judul Lampiran Kepanitiaan</label>
                      <Input type="text" value={kepanitiaaanTitle} onChange={(e) => setKepanitiaaanTitle(e.target.value)} className="rounded-xl border-slate-200 font-semibold text-slate-800 text-xs h-9 bg-white" />
                    </div>
                    {/* Rows */}
                    <div className="space-y-3">
                      {kepanitiaaanRows.map((row, idx) => (
                        <div key={idx} className="flex gap-3 items-center">
                          <div className="flex-1 relative">
                            <Input
                              type="text"
                              placeholder="Cari Nama Pegawai Kepanitiaan..."
                              value={row.searchText}
                              onChange={(e) => {
                                const val = e.target.value;
                                setKepanitiaaanRows(prev => {
                                  const u = [...prev]; u[idx].searchText = val; u[idx].showDropdown = true; return u;
                                });
                              }}
                              onFocus={() => setKepanitiaaanRows(prev => { const u = [...prev]; u[idx].showDropdown = true; return u; })}
                              onBlur={() => setTimeout(() => setKepanitiaaanRows(prev => { const u = [...prev]; u[idx].showDropdown = false; return u; }), 200)}
                              className="rounded-xl border-slate-200 font-semibold text-slate-800 text-xs h-9 bg-white"
                            />
                            {row.showDropdown && (
                              <div className="absolute left-0 right-0 top-10 max-h-40 overflow-y-auto bg-white border rounded-xl shadow-2xl z-50 divide-y">
                                {allEmployees.filter(emp => emp.name.toLowerCase().includes((row.searchText || '').toLowerCase())).slice(0, 10).map(emp => (
                                  <button
                                    key={emp.id}
                                    type="button"
                                    onClick={() => {
                                      setKepanitiaaanRows(prev => {
                                        const u = [...prev];
                                        u[idx].employeeId = emp.id;
                                        u[idx].name = emp.name;
                                        u[idx].searchText = emp.name;
                                        u[idx].showDropdown = false;
                                        return u;
                                      });
                                    }}
                                    className="w-full text-left px-4 py-2 hover:bg-slate-50 text-[11px] font-semibold text-slate-700 flex justify-between"
                                  >
                                    <span>{emp.name}</span>
                                    <span className="text-[9px] text-slate-400">{emp.role}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => {
                              const next = kepanitiaaanRows.filter((_, i) => i !== idx);
                              setKepanitiaaanRows(next.length > 0 ? next : [{ name: '', phaseAmounts: {}, searchText: '', showDropdown: false }]);
                            }}
                            className="text-red-500 hover:text-red-700 rounded-xl h-9 w-9 p-0 flex items-center justify-center"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      ))}
                      <Button
                        type="button"
                        onClick={() => setKepanitiaaanRows(prev => [...prev, { name: '', phaseAmounts: {}, searchText: '', showDropdown: false }])}
                        variant="outline"
                        className="w-full rounded-xl border-slate-200 text-slate-500 hover:bg-slate-100 text-xs font-semibold h-9"
                      >
                        + Tambah Penerima Kepanitiaan
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* Section 4: Receipts */}
              <div className="border border-slate-100 rounded-2xl overflow-hidden bg-slate-50/50">
                <button
                  type="button"
                  onClick={() => toggleSection('kwitansi')}
                  className="w-full flex items-center justify-between p-4 bg-white hover:bg-slate-50 border-b border-slate-150 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={receiptEnabled}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setReceiptEnabled(e.target.checked)}
                      className="rounded text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                    />
                    <span className="font-bold text-slate-700 text-xs uppercase tracking-wider">IV. Lampiran Kwitansi Belanja</span>
                  </div>
                  {expandedSections.kwitansi ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                </button>
                {expandedSections.kwitansi && receiptEnabled && (
                  <div className="p-4 space-y-4 bg-white">
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Judul Lampiran Kwitansi</label>
                      <Input type="text" value={receiptTitle} onChange={(e) => setReceiptTitle(e.target.value)} className="rounded-xl border-slate-200 font-semibold text-slate-800 text-xs h-9 bg-white" />
                    </div>
                    <div className="space-y-3">
                      {receiptRows.map((row, idx) => (
                        <div key={idx} className="flex gap-3 items-center">
                          <Input
                            type="text"
                            placeholder="Nama Item / Kebutuhan..."
                            value={row.itemName}
                            onChange={(e) => {
                              const val = e.target.value;
                              setReceiptRows(prev => {
                                const u = [...prev]; u[idx].itemName = val; return u;
                              });
                            }}
                            className="rounded-xl border-slate-200 font-semibold text-slate-800 text-xs h-9 bg-white flex-1"
                          />
                          <Input
                            type="number"
                            placeholder="Qty"
                            value={row.qty}
                            onChange={(e) => {
                              const val = parseInt(e.target.value, 10) || 1;
                              setReceiptRows(prev => {
                                const u = [...prev]; u[idx].qty = val; return u;
                              });
                            }}
                            className="rounded-xl border-slate-200 font-semibold text-slate-800 text-xs h-9 bg-white w-20 text-center"
                          />
                          <Input
                            type="text"
                            placeholder="Harga Satuan"
                            value={row.unitPrice === 0 ? '' : String(row.unitPrice)}
                            onChange={(e) => {
                              const val = parseInt(e.target.value.replace(/\D/g, ''), 10) || 0;
                              setReceiptRows(prev => {
                                const u = [...prev]; u[idx].unitPrice = val; return u;
                              });
                            }}
                            className="rounded-xl border-slate-200 font-semibold text-slate-800 text-xs h-9 bg-white w-32 text-right"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => {
                              const next = receiptRows.filter((_, i) => i !== idx);
                              setReceiptRows(next.length > 0 ? next : [{ itemName: '', qty: 1, unitPrice: 0 }]);
                            }}
                            className="text-red-500 hover:text-red-700 rounded-xl h-9 w-9 p-0 flex items-center justify-center"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      ))}
                      <Button
                        type="button"
                        onClick={() => setReceiptRows(prev => [...prev, { itemName: '', qty: 1, unitPrice: 0 }])}
                        variant="outline"
                        className="w-full rounded-xl border-slate-200 text-slate-500 hover:bg-slate-100 text-xs font-semibold h-9"
                      >
                        + Tambah Baris Kwitansi
                      </Button>
                    </div>
                  </div>
                )}
              </div>

            </div>

            {/* Signature configuration */}
            <div className="border border-slate-100 rounded-2xl p-4 bg-slate-50/50 space-y-4">
              <h4 className="font-bold text-slate-700 text-xs uppercase tracking-wider">Tanda Tangan Laporan PDF</h4>
              <div className="space-y-4">
                {pelaporanSignatures.map((sig, idx) => (
                  <div key={idx} className="grid grid-cols-1 md:grid-cols-3 gap-3 items-center bg-white p-3 rounded-xl border">
                    <Input
                      type="text"
                      placeholder="Label (Contoh: Mengetahui,)"
                      value={sig.label}
                      onChange={(e) => {
                        const val = e.target.value;
                        setPelaporanSignatures(prev => {
                          const u = [...prev]; u[idx].label = val; return u;
                        });
                      }}
                      className="rounded-xl text-xs h-8"
                    />
                    <div className="relative">
                      <Input
                        type="text"
                        placeholder="Cari Nama Pegawai..."
                        value={sig.searchText || sig.name}
                        onChange={(e) => {
                          const val = e.target.value;
                          setPelaporanSignatures(prev => {
                            const u = [...prev]; u[idx].searchText = val; u[idx].showDropdown = true; return u;
                          });
                        }}
                        onFocus={() => {
                          setPelaporanSignatures(prev => {
                            const u = [...prev]; u[idx].showDropdown = true; return u;
                          });
                        }}
                        onBlur={() => {
                          setTimeout(() => {
                            setPelaporanSignatures(prev => {
                              const u = [...prev]; u[idx].showDropdown = false; return u;
                            });
                          }, 200);
                        }}
                        className="rounded-xl text-xs h-8 pr-6"
                      />
                      {sig.showDropdown && (
                        <div className="absolute left-0 right-0 top-9 max-h-40 overflow-y-auto bg-white border rounded-xl shadow-2xl z-50 divide-y">
                          {allEmployees.filter(emp => emp.name.toLowerCase().includes((sig.searchText || '').toLowerCase())).slice(0, 10).map(emp => (
                            <button
                              key={emp.id}
                              type="button"
                              onClick={() => {
                                setPelaporanSignatures(prev => {
                                  const u = [...prev];
                                  u[idx].name = emp.name;
                                  u[idx].title = emp.role;
                                  u[idx].searchText = emp.name;
                                  u[idx].showDropdown = false;
                                  return u;
                                });
                              }}
                              className="w-full text-left px-4 py-2 hover:bg-slate-50 text-[10px] font-semibold text-slate-700 flex justify-between"
                            >
                              <span>{emp.name}</span>
                              <span className="text-[8px] text-slate-400">{emp.role}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <Input
                      type="text"
                      placeholder="Jabatan (Contoh: Direktur)"
                      value={sig.title}
                      onChange={(e) => {
                        const val = e.target.value;
                        setPelaporanSignatures(prev => {
                          const u = [...prev]; u[idx].title = val; return u;
                        });
                      }}
                      className="rounded-xl text-xs h-8"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Form actions */}
            <div className="flex justify-end items-center gap-3 pt-4 border-t border-slate-100">
              {selectedPelaporanId && (
                <Button
                  onClick={() => handleDeletePelaporan(selectedPelaporanId)}
                  variant="ghost"
                  className="rounded-xl text-rose-500 hover:text-rose-700 hover:bg-rose-50 font-bold px-5 text-xs h-10 flex items-center gap-1.5"
                >
                  <Trash2 className="w-4 h-4" /> Hapus Laporan
                </Button>
              )}
              <Button
                type="button"
                onClick={handleSavePelaporan}
                disabled={savingPelaporan}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl px-6 text-xs flex items-center gap-1.5 shadow-md h-10 cursor-pointer"
              >
                {savingPelaporan ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Simpan Laporan
              </Button>
              <Button
                type="button"
                onClick={handlePrintPelaporan}
                disabled={!pelaporanReportName.trim() || !pelaporanDept}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl px-6 text-xs flex items-center gap-1.5 shadow-md h-10 cursor-pointer"
              >
                <FileText className="w-4 h-4" /> Cetak PDF
              </Button>
            </div>

          </Card>
        </div>

      </div>
    </div>
  );
}
