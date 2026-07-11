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
  Loader2, CheckCircle2, FileText, AlertCircle, Trash2, Plus, Save, Edit,
  Calendar, Check, ShieldCheck, FileSpreadsheet, Users, Info, Settings, Clock, Upload,
  ChevronDown, ChevronUp
} from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import {
  collection, getDocs, doc, setDoc, deleteDoc, getDoc, serverTimestamp, query, where, orderBy
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { MONTHS_ID, REKAP_COLUMNS, SUPPORTED_CATEGORIES } from '@/utils/rekapConfig';
import { normalizeName, MANUAL_OVERRIDES } from '@/utils/payrollLogic';
import * as XLSX from 'xlsx';

import Link from 'next/link'; const normalizeExcelDate = (val: any): string => {
  if (val === undefined || val === null) return '';
  const str = String(val).trim();
  if (!str) return '';

  // 1. If it's a numeric string or number (Excel serialized date)
  if (/^\d+(\.\d+)?$/.test(str)) {
    const num = Math.floor(parseFloat(str));
    const base = Date.UTC(1899, 11, 30);
    const target = new Date(base + num * 24 * 60 * 60 * 1000);
    if (!isNaN(target.getTime())) {
      const day = String(target.getUTCDate()).padStart(2, '0');
      const month = String(target.getUTCMonth() + 1).padStart(2, '0');
      const year = target.getUTCFullYear();
      return `${day}-${month}-${year}`;
    }
  }

  // 2. Try to parse ISO date string (YYYY-MM-DD or YYYY/MM/DD)
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(str)) {
    const parts = str.split(/[-/]/);
    if (parts.length >= 3) {
      const y = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      const d = parseInt(parts[2], 10);
      const day = String(d).padStart(2, '0');
      const month = String(m).padStart(2, '0');
      const year = y < 100 ? (y < 50 ? 2000 + y : 1900 + y) : y;
      return `${day}-${month}-${year}`;
    }
  }

  // 3. Try to parse DD-MM-YYYY or DD/MM/YYYY or DD.MM.YYYY or DD-MM-YY
  if (/^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/.test(str)) {
    const parts = str.split(/[-/.]/);
    if (parts.length >= 3) {
      const d = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      const y = parseInt(parts[2], 10);
      const day = String(d).padStart(2, '0');
      const month = String(m).padStart(2, '0');
      const year = y < 100 ? (y < 50 ? 2000 + y : 1900 + y) : y;
      return `${day}-${month}-${year}`;
    }
  }

  // 4. Try parsing solid numeric patterns ddmmyy or ddmmyyyy
  if (/^\d{6}$/.test(str)) {
    const d = parseInt(str.substring(0, 2), 10);
    const m = parseInt(str.substring(2, 4), 10);
    const y = parseInt(str.substring(4, 6), 10);
    const day = String(d).padStart(2, '0');
    const month = String(m).padStart(2, '0');
    const year = 2000 + y;
    return `${day}-${month}-${year}`;
  }
  if (/^\d{8}$/.test(str)) {
    const d = parseInt(str.substring(0, 2), 10);
    const m = parseInt(str.substring(2, 4), 10);
    const y = parseInt(str.substring(4, 8), 10);
    const day = String(d).padStart(2, '0');
    const month = String(m).padStart(2, '0');
    return `${day}-${month}-${y}`;
  }

  // Fallback: try JS Native Date parsing
  const parsedMs = Date.parse(str);
  if (!isNaN(parsedMs)) {
    const d = new Date(parsedMs);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${day}-${month}-${d.getFullYear()}`;
  }

  return str;
};

const parseDateToDDMMYYYY = (dateStr: string) => {
  if (!dateStr || !dateStr.includes('-')) return dateStr;
  const [y, m, d] = dateStr.split('-');
  return `${d}-${m}-${y}`;
};

const recalculateSummary = (dailyLogs: any[], expHours: number) => {
  let totalWorkedMinutes = 0;
  let activeDaysCount = 0;
  let incompleteDaysCount = 0;
  let absentDaysCount = 0;

  const updatedLogs = dailyLogs.map(dayRow => {
    const status = String(dayRow['Jam kerja'] || '').trim();
    const statusUpper = status.toUpperCase();
    let inStr = dayRow['Scan masuk'] ? String(dayRow['Scan masuk']).trim() : '';
    let outStr = dayRow['Scan pulang'] ? String(dayRow['Scan pulang']).trim() : '';

    let dailyDuration = 0;
    let scanMasukAuto = dayRow.scanMasukAuto || false;
    let scanPulangAuto = dayRow.scanPulangAuto || false;

    if (statusUpper === 'MASUK') {
      if (inStr && outStr) {
        const [hIn, mIn, sIn = 0] = inStr.split(':').map(Number);
        const [hOut, mOut, sOut = 0] = outStr.split(':').map(Number);

        if (!isNaN(hIn) && !isNaN(hOut)) {
          const minutesIn = hIn * 60 + mIn + sIn / 60;
          const minutesOut = hOut * 60 + mOut + sOut / 60;
          const duration = Math.max(0, minutesOut - minutesIn);
          dailyDuration = Math.ceil(Math.min(expHours * 60, duration));
          totalWorkedMinutes += dailyDuration;
          activeDaysCount += 1;
        } else {
          incompleteDaysCount += 1;
        }
      } else if (inStr && !outStr) {
        if (dayRow.scanPulangAuto !== false) {
          const [hIn, mIn, sIn = 0] = inStr.split(':').map(Number);
          if (!isNaN(hIn)) {
            const totalSecondsIn = hIn * 3600 + mIn * 60 + sIn;
            const totalSecondsOut = totalSecondsIn + 9000;
            const hOut = Math.floor(totalSecondsOut / 3600) % 24;
            const mOut = Math.floor((totalSecondsOut % 3600) / 60);
            const sOut = totalSecondsOut % 60;
            outStr = `${String(hOut).padStart(2, '0')}:${String(mOut).padStart(2, '0')}:${String(sOut).padStart(2, '0')}`;
            scanPulangAuto = true;
            dailyDuration = Math.min(expHours * 60, 150);
            totalWorkedMinutes += dailyDuration;
            activeDaysCount += 1;
          } else {
            incompleteDaysCount += 1;
          }
        } else {
          incompleteDaysCount += 1;
        }
      } else if (!inStr && outStr) {
        if (dayRow.scanMasukAuto !== false) {
          const [hOut, mOut, sOut = 0] = outStr.split(':').map(Number);
          if (!isNaN(hOut)) {
            const totalSecondsOut = hOut * 3600 + mOut * 60 + sOut;
            let totalSecondsIn = totalSecondsOut - 9000;
            if (totalSecondsIn < 0) totalSecondsIn = 0;
            const hIn = Math.floor(totalSecondsIn / 3600) % 24;
            const mIn = Math.floor((totalSecondsIn % 3600) / 60);
            const sIn = totalSecondsIn % 60;
            inStr = `${String(hIn).padStart(2, '0')}:${String(mIn).padStart(2, '0')}:${String(sIn).padStart(2, '0')}`;
            scanMasukAuto = true;
            dailyDuration = Math.min(expHours * 60, 150);
            totalWorkedMinutes += dailyDuration;
            activeDaysCount += 1;
          } else {
            incompleteDaysCount += 1;
          }
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
      'Scan masuk': inStr,
      'Scan pulang': outStr,
      scanMasukAuto,
      scanPulangAuto,
      duration: dailyDuration
    };
  });

  return {
    minutes: totalWorkedMinutes,
    activeDaysCount,
    incompleteDaysCount,
    absentDaysCount,
    dailyLogs: updatedLogs
  };
};

export default function PresensiLoyalisRawPage() {
  const { profile } = useAuth();
  const searchParams = useSearchParams();

  // Read params from URL search parameters
  const month = parseInt(searchParams.get('month') || String(new Date().getMonth() + 1), 10);
  const year = parseInt(searchParams.get('year') || String(new Date().getFullYear()), 10);

  const periodToken = `${year}_${String(month).padStart(2, '0')}`;

  // ── States ──
  const [loyalisEmployees, setLoyalisEmployees] = useState<any[]>([]);
  const [loadingLoyalis, setLoadingLoyalis] = useState(false);
  const [uploadedData, setUploadedData] = useState<any[] | null>(null);
  const [calcMode, setCalcMode] = useState<'worked' | 'absent'>('worked');
  const [workingDays, setWorkingDays] = useState<number | ''>(25);
  const activeWorkingDays = Number(workingDays) || 0;
  const [expectedHours, setExpectedHours] = useState<number>(6.5);
  const [savingPresence, setSavingPresence] = useState(false);
  const [existingPresence, setExistingPresence] = useState<any>(null);
  const [loadingPresence, setLoadingPresence] = useState(false);
  const [expandedRowIdx, setExpandedRowIdx] = useState<number | null>(null);

  // ── Pekarya Presence Utility States ──
  const [presensiTargetType, setPresensiTargetType] = useState<'loyalis' | 'pekarya'>('loyalis');
  const [pekaryaWorkingDays, setPekaryaWorkingDays] = useState<number>(25);
  const [pekaryaHolidays, setPekaryaHolidays] = useState<number>(0);
  const [selectedPekaryaCategory, setSelectedPekaryaCategory] = useState<string>('SATPAM');
  const [dynamicCategories, setDynamicCategories] = useState<string[]>(SUPPORTED_CATEGORIES);

  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [activeSearchRowIdx, setActiveSearchRowIdx] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Sync Categories from DB Blue Collar
  useEffect(() => {
    const fetchCats = async () => {
      try {
        const allEmpSnap = await getDocs(collection(db, 'Employees_BlueCollar'));
        const cats = new Set<string>(SUPPORTED_CATEGORIES);
        allEmpSnap.docs.forEach(d => {
          const cat = d.data()?.employment?.jobCategory;
          if (cat) cats.add(cat);
        });
        setDynamicCategories(Array.from(cats).sort());
      } catch (err) {
        console.error(err);
      }
    };
    fetchCats();
  }, []);

  // ── Fetch Loyalis Employees ──
  useEffect(() => {
    const fetchLoyalis = async () => {
      setLoadingLoyalis(true);
      try {
        const q = query(
          collection(db, 'Employees_Loyalis'),
          where('personal_info.status', '==', 'AKTIF')
        );
        const snap = await getDocs(q);
        const list = snap.docs.map(d => {
          const data = d.data();
          return {
            id: d.id,
            name: data.personal_info?.name || '',
            role: data.employment_profile?.job_role || '',
            department: data.employment_profile?.department_unit || '',
          };
        }).sort((a, b) => a.name.localeCompare(b.name));
        setLoyalisEmployees(list);
      } catch (err) {
        console.error('Error fetching Loyalis employees:', err);
      } finally {
        setLoadingLoyalis(false);
      }
    };
    fetchLoyalis();
  }, []);

  // ── Fetch Existing Loyalis Presence Data ──
  const fetchExistingPresence = useCallback(async () => {
    setLoadingPresence(true);
    try {
      const docRef = doc(db, 'LoyalisPresence', periodToken);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const data = docSnap.data();
        setExistingPresence(data);
        if (data.mode) setCalcMode(data.mode);
        if (data.workingDays) setWorkingDays(data.workingDays);
        if (data.expectedHours) setExpectedHours(data.expectedHours);
      } else {
        setExistingPresence(null);
      }
    } catch (err) {
      console.error('Error fetching existing presence:', err);
    } finally {
      setLoadingPresence(false);
    }
  }, [periodToken]);

  useEffect(() => {
    fetchExistingPresence();
  }, [fetchExistingPresence]);

  // ── Fetch Correction Requests for Active Month ──
  const [corrections, setCorrections] = useState<any[]>([]);
  const [loadingCorrections, setLoadingCorrections] = useState(false);
  const [pendingResolutionUpdates, setPendingResolutionUpdates] = useState<Record<string, { status: 'approved' | 'rejected'; rejectionReason?: string }>>({});
  const [activeDeclineId, setActiveDeclineId] = useState<string | null>(null);
  const [declineReasonInput, setDeclineReasonInput] = useState<Record<string, string>>({});

  const fetchCorrections = useCallback(async () => {
    setLoadingCorrections(true);
    try {
      const q = query(
        collection(db, 'LoyalisPresenceCorrections'),
        orderBy('createdAt', 'desc')
      );
      const snap = await getDocs(q);
      const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      const periodPrefix = `${year}-${String(month).padStart(2, '0')}`;
      const filtered = list.filter((req: any) => req.date && req.date.startsWith(periodPrefix));

      setCorrections(filtered);
    } catch (err) {
      console.error('Error fetching corrections:', err);
    } finally {
      setLoadingCorrections(false);
    }
  }, [month, year]);

  useEffect(() => {
    fetchCorrections();
  }, [fetchCorrections]);

  const matchExcelName = useCallback((excelName: string, employees: any[]) => {
    if (!excelName) return null;
    const cleanExcel = normalizeName(excelName);
    let found = employees.find(emp => normalizeName(emp.name) === cleanExcel);
    if (found) return found;

    const overridden = MANUAL_OVERRIDES[excelName.trim()];
    if (overridden) {
      const cleanOverridden = normalizeName(overridden);
      found = employees.find(emp => normalizeName(emp.name) === cleanOverridden);
      if (found) return found;
    }

    found = employees.find(emp => {
      const dbNorm = normalizeName(emp.name);
      return dbNorm.includes(cleanExcel) || cleanExcel.includes(dbNorm);
    });

    return found || null;
  }, []);

  const calculatePresenceStratum = useCallback((
    minutes: number,
    mode: 'worked' | 'absent',
    days: number,
    hours: number
  ) => {
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
  }, []);

  const handleUpdateMinutes = useCallback((excelName: string, minutes: number) => {
    setUploadedData(prev => {
      if (!prev) return null;
      return prev.map(r => r.excelName === excelName ? { ...r, minutes } : r);
    });
  }, []);

  const handleLinkEmployee = useCallback((excelName: string, employeeId: string) => {
    const emp = loyalisEmployees.find(e => e.id === employeeId);
    setUploadedData(prev => {
      if (!prev) return null;
      return prev.map(r => r.excelName === excelName ? {
        ...r,
        employeeId: employeeId || null,
        employeeName: emp ? emp.name : "",
      } : r);
    });
  }, [loyalisEmployees]);

  const handleAcceptCorrection = useCallback((employeeId: string, req: any) => {
    setUploadedData(prev => {
      if (!prev) return null;
      return prev.map(emp => {
        if (emp.employeeId !== employeeId) return emp;

        const dateKey = parseDateToDDMMYYYY(req.date);
        const dailyLogs = [...(emp.dailyLogs || [])];
        const dayIdx = dailyLogs.findIndex(log => log.Tanggal === dateKey);

        if (dayIdx > -1) {
          dailyLogs[dayIdx] = {
            ...dailyLogs[dayIdx],
            'Jam kerja': 'MASUK',
            'Scan masuk': req.type === 'izin_resmi' ? '07:30' : (req.type !== 'tap_out' ? req.checkInTime : (dailyLogs[dayIdx]['Scan masuk'] || '')),
            'Scan pulang': req.type === 'izin_resmi' ? '14:00' : (req.type !== 'tap_in' ? req.checkOutTime : (dailyLogs[dayIdx]['Scan pulang'] || '')),
            scanMasukAuto: (req.type === 'izin_resmi' || req.type !== 'tap_out') ? false : (dailyLogs[dayIdx].scanMasukAuto || false),
            scanPulangAuto: (req.type === 'izin_resmi' || req.type !== 'tap_in') ? false : (dailyLogs[dayIdx].scanPulangAuto || false),
          };
        } else {
          dailyLogs.push({
            Tanggal: dateKey,
            'Jam kerja': 'MASUK',
            'Scan masuk': req.type === 'izin_resmi' ? '07:30' : (req.type !== 'tap_out' ? req.checkInTime : ''),
            'Scan pulang': req.type === 'izin_resmi' ? '14:00' : (req.type !== 'tap_in' ? req.checkOutTime : ''),
            scanMasukAuto: false,
            scanPulangAuto: false,
          });
        }

        dailyLogs.sort((a, b) => {
          const [d1, m1, y1] = a.Tanggal.split('-').map(Number);
          const [d2, m2, y2] = b.Tanggal.split('-').map(Number);
          return (y1 * 365 + m1 * 31 + d1) - (y2 * 365 + m2 * 31 + d2);
        });

        const summary = recalculateSummary(dailyLogs, expectedHours);

        return {
          ...emp,
          ...summary,
          dailyLogs
        };
      });
    });

    setPendingResolutionUpdates(prev => ({
      ...prev,
      [req.id]: { status: 'approved' }
    }));

    setMessage({
      type: 'success',
      text: `Koreksi presensi ${req.employeeName} tanggal ${parseDateToDDMMYYYY(req.date)} berhasil diterapkan ke logs sementara. Silakan simpan untuk memperbarui database.`
    });
  }, [expectedHours]);

  const handleDeclineCorrection = useCallback((reqId: string, reason: string) => {
    setPendingResolutionUpdates(prev => ({
      ...prev,
      [reqId]: { status: 'rejected', rejectionReason: reason }
    }));

    setMessage({
      type: 'success',
      text: `Koreksi presensi berhasil ditolak sementara. Silakan simpan untuk memperbarui database.`
    });
  }, []);

  const handleStartEdit = useCallback(() => {
    if (!existingPresence?.entries) return;
    const entriesList = Object.values(existingPresence.entries).map((entry: any) => ({
      excelName: entry.excelName || '-',
      employeeId: entry.isNotFoundInExcel ? null : entry.employeeId,
      employeeName: entry.isNotFoundInExcel ? null : entry.employeeName,
      minutes: Math.ceil(entry.minutes || 0),
      activeDaysCount: entry.activeDaysCount || 0,
      incompleteDaysCount: entry.incompleteDaysCount || 0,
      absentDaysCount: entry.absentDaysCount || 0,
      dailyLogs: entry.dailyLogs || [],
    }));
    setUploadedData(entriesList);
    setMessage({ type: 'success', text: 'Mode edit diaktifkan. Anda sekarang dapat mengubah data logs presensi dan menghubungkan pegawai.' });
  }, [existingPresence]);

  const displayRows = useMemo(() => {
    if (uploadedData) {
      const matchedIds = new Set(uploadedData.map(r => r.employeeId).filter(Boolean));
      const matchedRows: any[] = [];
      const unmatchedExcelRows: any[] = [];

      uploadedData.forEach((row) => {
        const calc = calculatePresenceStratum(row.minutes, calcMode, activeWorkingDays, expectedHours);
        const mappedRow = {
          excelName: row.excelName,
          employeeId: row.employeeId,
          employeeName: row.employeeName,
          minutes: row.minutes,
          absenceMinutes: calc.absenceMinutes,
          stratum: calc.stratum,
          deduction: calc.deduction,
          netBonus: calc.netBonus,
          isMatched: !!row.employeeId,
          isNotFoundInExcel: false,
          activeDaysCount: row.activeDaysCount || 0,
          incompleteDaysCount: row.incompleteDaysCount || 0,
          absentDaysCount: row.absentDaysCount || 0,
          dailyLogs: row.dailyLogs || [],
          corrections: row.employeeId ? corrections.filter((c: any) => c.employeeId === row.employeeId) : [],
        };

        if (row.employeeId) matchedRows.push(mappedRow);
        else unmatchedExcelRows.push(mappedRow);
      });

      matchedRows.sort((a, b) => (a.employeeName || '').localeCompare(b.employeeName || ''));
      unmatchedExcelRows.sort((a, b) => (a.excelName || '').localeCompare(b.excelName || ''));

      const unmatchedDbRows = loyalisEmployees
        .filter(emp => !matchedIds.has(emp.id))
        .map((emp) => ({
          excelName: '-',
          employeeId: emp.id,
          employeeName: emp.name,
          minutes: 0,
          absenceMinutes: activeWorkingDays * expectedHours * 60,
          stratum: 5,
          deduction: 250000,
          netBonus: 0,
          isMatched: true,
          isNotFoundInExcel: true,
          activeDaysCount: 0,
          incompleteDaysCount: 0,
          absentDaysCount: 0,
          dailyLogs: [],
          corrections: corrections.filter((c: any) => c.employeeId === emp.id),
        }))
        .sort((a, b) => (a.employeeName || '').localeCompare(b.employeeName || ''));

      const combined = [...matchedRows, ...unmatchedExcelRows, ...unmatchedDbRows];
      return combined.map((row, idx) => ({ ...row, idx }));
    }
    if (existingPresence && existingPresence.entries) {
      const entriesList = Object.values(existingPresence.entries).map((entry: any) => ({
        excelName: entry.excelName,
        employeeId: entry.employeeId,
        employeeName: entry.employeeName,
        minutes: Math.ceil(entry.minutes || 0),
        absenceMinutes: entry.absenceMinutes,
        stratum: entry.stratum,
        deduction: entry.deduction,
        netBonus: entry.netBonus,
        isMatched: true,
        isNotFoundInExcel: !!entry.isNotFoundInExcel,
        activeDaysCount: entry.activeDaysCount || 0,
        incompleteDaysCount: entry.incompleteDaysCount || 0,
        absentDaysCount: entry.absentDaysCount || 0,
        dailyLogs: entry.dailyLogs || [],
        corrections: entry.employeeId ? corrections.filter((c: any) => c.employeeId === entry.employeeId) : [],
      }));

      const matched = entriesList.filter(e => !e.isNotFoundInExcel).sort((a, b) => (a.employeeName || '').localeCompare(b.employeeName || ''));
      const unmatched = entriesList.filter(e => e.isNotFoundInExcel).sort((a, b) => (a.employeeName || '').localeCompare(b.employeeName || ''));

      return [...matched, ...unmatched].map((row, idx) => ({ ...row, idx }));
    }
    return null;
  }, [uploadedData, loyalisEmployees, existingPresence, calcMode, workingDays, expectedHours, calculatePresenceStratum, corrections]);

  const handleExcelUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = evt.target?.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(worksheet) as any[];

        if (rows.length === 0) {
          setMessage({ type: 'error', text: 'File Excel kosong.' });
          return;
        }

        // Validate raw headers
        const sampleRow = rows[0];
        if (!sampleRow || !('Nama' in sampleRow) || !('Jam kerja' in sampleRow)) {
          setMessage({ type: 'error', text: 'Format Excel tidak cocok. Pastikan memiliki kolom "Nama" dan "Jam kerja".' });
          return;
        }

        // Auto-detect working days count from the uploaded raw logs using robust algorithm:
        // - A date is NOT a working day if:
        //   1) All employees recorded on that date have "Tidak Hadir" status.
        //   2) At least half of the employees recorded on that date have "Libur Rutin" status.
        // - Otherwise, it is a working day.
        const dateStats: Record<string, { total: number; tidakHadir: number; liburRutin: number }> = {};
        rows.forEach(row => {
          const tgl = normalizeExcelDate(row['Tanggal']);
          const jk = String(row['Jam kerja'] || '').trim().toUpperCase();
          if (!tgl) return;
          if (!dateStats[tgl]) {
            dateStats[tgl] = { total: 0, tidakHadir: 0, liburRutin: 0 };
          }
          dateStats[tgl].total += 1;
          if (jk === 'TIDAK HADIR') {
            dateStats[tgl].tidakHadir += 1;
          } else if (jk === 'LIBUR RUTIN') {
            dateStats[tgl].liburRutin += 1;
          }
        });

        let deducedDays = 0;
        Object.entries(dateStats).forEach(([_, stats]) => {
          const isAllTidakHadir = stats.tidakHadir >= stats.total * 0.95;
          const isHalfLiburRutin = stats.liburRutin >= stats.total / 2;
          if (!isAllTidakHadir && !isHalfLiburRutin) {
            deducedDays += 1;
          }
        });

        if (deducedDays > 0) {
          setWorkingDays(deducedDays);
        }

        // Group rows by Excel Name
        const grouped: Record<string, any[]> = {};
        rows.forEach(row => {
          const name = String(row['Nama'] || '').trim();
          if (!name) return;
          if (!grouped[name]) {
            grouped[name] = [];
          }
          grouped[name].push(row);
        });

        const parsedData: any[] = [];
        Object.entries(grouped).forEach(([excelName, empRows]) => {
          const dailyLogs: any[] = [];
          empRows.forEach(dayRow => {
            dailyLogs.push({
              Tanggal: normalizeExcelDate(dayRow['Tanggal']),
              'Jam kerja': String(dayRow['Jam kerja'] || ''),
              'Scan masuk': dayRow['Scan masuk'] ? String(dayRow['Scan masuk']).trim() : '',
              'Scan pulang': dayRow['Scan pulang'] ? String(dayRow['Scan pulang']).trim() : '',
            });
          });

          // Sort logs by date DD-MM-YYYY
          dailyLogs.sort((a, b) => {
            const [d1, m1, y1] = a.Tanggal.split('-').map(Number);
            const [d2, m2, y2] = b.Tanggal.split('-').map(Number);
            return (y1 * 365 + m1 * 31 + d1) - (y2 * 365 + m2 * 31 + d2);
          });

          // Run recalculation to get total worked minutes, active days, etc.
          const summary = recalculateSummary(dailyLogs, expectedHours);
          const match = matchExcelName(excelName, loyalisEmployees);

          parsedData.push({
            excelName,
            employeeId: match?.id || null,
            employeeName: match?.name || null,
            ...summary,
          });
        });

        setUploadedData(parsedData);
        setMessage({
          type: 'success',
          text: `Berhasil mengunggah ${parsedData.length} data pegawai dari logs presensi. Jumlah hari kerja otomatis diatur menjadi ${deducedDays} hari.`
        });
      } catch (err) {
        console.error(err);
        setMessage({ type: 'error', text: 'Gagal membaca file Excel. Pastikan format benar.' });
      }
    };
    reader.readAsBinaryString(file);
  }, [loyalisEmployees, expectedHours, matchExcelName]);

  const handleUpdateDailyLog = useCallback((excelName: string, dateStr: string, field: string, value: any) => {
    setUploadedData(prev => {
      if (!prev) return null;
      return prev.map(emp => {
        if (emp.excelName !== excelName) return emp;

        const updatedLogs = (emp.dailyLogs || []).map((log: any) => {
          if (log.Tanggal !== dateStr) return log;
          const updatedItem = {
            ...log,
            [field]: value
          };
          if (field === 'Scan masuk') {
            updatedItem.scanMasukAuto = false;
          }
          if (field === 'Scan pulang') {
            updatedItem.scanPulangAuto = false;
          }
          if (field === 'Jam kerja' && value !== 'MASUK') {
            updatedItem.scanMasukAuto = false;
            updatedItem.scanPulangAuto = false;
          }
          return updatedItem;
        });

        const summary = recalculateSummary(updatedLogs, expectedHours);
        return {
          ...emp,
          ...summary
        };
      });
    });
  }, [expectedHours]);

  const handleSaveWorkingDaysConfig = async () => {
    setSavingPresence(true);
    try {
      const existingEntries = existingPresence?.entries || {};
      const payload = {
        period: periodToken,
        workingDays: activeWorkingDays,
        expectedHours,
        mode: calcMode,
        entries: existingEntries,
        updatedAt: serverTimestamp(),
      };

      await setDoc(doc(db, 'LoyalisPresence', periodToken), payload, { merge: true });
      setMessage({ type: 'success', text: `Konfigurasi hari kerja (${activeWorkingDays} hari) berhasil disimpan.` });
      fetchExistingPresence();
    } catch (err) {
      console.error(err);
      setMessage({ type: 'error', text: 'Gagal menyimpan konfigurasi hari kerja.' });
    } finally {
      setSavingPresence(false);
    }
  };

  const handleSavePresence = async () => {
    if (!uploadedData || uploadedData.length === 0) return;
    setSavingPresence(true);
    try {
      const entriesMap: Record<string, any> = {};

      uploadedData.forEach(row => {
        if (!row.employeeId) return;
        const calc = calculatePresenceStratum(row.minutes, calcMode, activeWorkingDays, expectedHours);
        entriesMap[row.employeeId] = {
          employeeId: row.employeeId,
          employeeName: row.employeeName,
          excelName: row.excelName,
          minutes: row.minutes,
          absenceMinutes: calc.absenceMinutes,
          stratum: calc.stratum,
          deduction: calc.deduction,
          netBonus: calc.netBonus,
          isNotFoundInExcel: false,
          activeDaysCount: row.activeDaysCount || 0,
          incompleteDaysCount: row.incompleteDaysCount || 0,
          absentDaysCount: row.absentDaysCount || 0,
          dailyLogs: row.dailyLogs || [],
        };
      });

      const matchedIds = new Set(uploadedData.map(r => r.employeeId).filter(Boolean));
      loyalisEmployees.forEach(emp => {
        if (!matchedIds.has(emp.id)) {
          entriesMap[emp.id] = {
            employeeId: emp.id,
            employeeName: emp.name,
            excelName: '-',
            minutes: 0,
            absenceMinutes: activeWorkingDays * expectedHours * 60,
            stratum: 5,
            deduction: 250000,
            netBonus: 0,
            isNotFoundInExcel: true,
            activeDaysCount: 0,
            incompleteDaysCount: 0,
            absentDaysCount: 0,
            dailyLogs: [],
          };
        }
      });

      const payload = {
        period: periodToken,
        workingDays: activeWorkingDays,
        expectedHours,
        mode: calcMode,
        entries: entriesMap,
        updatedAt: serverTimestamp(),
      };

      await setDoc(doc(db, 'LoyalisPresence', periodToken), payload);

      // Automatically update any existing saved slip states in PayrollSlipStates
      try {
        const updatePromises = Object.keys(entriesMap).map(async (empId) => {
          const slipRef = doc(db, 'PayrollSlipStates', `${periodToken}_${empId}`);
          const slipSnap = await getDoc(slipRef);
          if (slipSnap.exists()) {
            const slipData = slipSnap.data();
            const currentDeductions = slipData.deductions || [];

            const entry = entriesMap[empId];
            const newPresensiDeduct = Math.round(((entry.absenceMinutes || 0) / 60) * 1650);
            const newPresenceBonusDeduct = entry.deduction || 0;

            let updatedDeductions = [...currentDeductions];

            const presensiIdx = updatedDeductions.findIndex(d => d.label === 'Potongan Presensi');
            if (presensiIdx > -1) {
              updatedDeductions[presensiIdx] = { ...updatedDeductions[presensiIdx], amount: newPresensiDeduct };
            } else {
              updatedDeductions.push({ label: 'Potongan Presensi', amount: newPresensiDeduct });
            }

            const presenceIdx = updatedDeductions.findIndex(d => d.label === 'Potongan Bonus Presensi');
            if (presenceIdx > -1) {
              updatedDeductions[presenceIdx] = { ...updatedDeductions[presenceIdx], amount: newPresenceBonusDeduct };
            } else {
              updatedDeductions.push({ label: 'Potongan Bonus Presensi', amount: newPresenceBonusDeduct });
            }

            await setDoc(slipRef, { deductions: updatedDeductions }, { merge: true });
          }
        });
        await Promise.all(updatePromises);
      } catch (err) {
        console.error("Gagal memperbarui slip gaji secara otomatis:", err);
      }

      // Update correction requests
      try {
        const updateCorrectionPromises = Object.entries(pendingResolutionUpdates).map(async ([reqId, update]) => {
          const reqRef = doc(db, 'LoyalisPresenceCorrections', reqId);
          await setDoc(reqRef, {
            status: update.status,
            rejectionReason: update.rejectionReason || null,
            resolvedBy: profile?.email || 'Admin',
            updatedAt: serverTimestamp()
          }, { merge: true });
        });
        await Promise.all(updateCorrectionPromises);
        setPendingResolutionUpdates({});
        fetchCorrections();
      } catch (err) {
        console.error("Gagal memperbarui status pengajuan koreksi presensi:", err);
      }

      setMessage({ type: 'success', text: 'Data bonus presensi berhasil disimpan.' });
      setUploadedData(null);
      fetchExistingPresence();
    } catch (err) {
      console.error(err);
      setMessage({ type: 'error', text: 'Gagal menyimpan data presensi.' });
    } finally {
      setSavingPresence(false);
    }
  };

  const handleDeletePresence = async () => {
    if (!confirm('Apakah Anda yakin ingin menghapus data presensi periode ini?')) return;
    setSavingPresence(true);
    try {
      await deleteDoc(doc(db, 'LoyalisPresence', periodToken));

      // Reset deductions in PayrollSlipStates when presence is deleted
      try {
        const resetPromises = loyalisEmployees.map(async (emp) => {
          const slipRef = doc(db, 'PayrollSlipStates', `${periodToken}_${emp.id}`);
          const slipSnap = await getDoc(slipRef);
          if (slipSnap.exists()) {
            const slipData = slipSnap.data();
            const currentDeductions = slipData.deductions || [];

            let updatedDeductions = [...currentDeductions];

            const presensiIdx = updatedDeductions.findIndex(d => d.label === 'Potongan Presensi');
            if (presensiIdx > -1) {
              updatedDeductions[presensiIdx] = { ...updatedDeductions[presensiIdx], amount: 0 };
            }

            const presenceIdx = updatedDeductions.findIndex(d => d.label === 'Potongan Bonus Presensi');
            if (presenceIdx > -1) {
              updatedDeductions[presenceIdx] = { ...updatedDeductions[presenceIdx], amount: 0 };
            }

            await setDoc(slipRef, { deductions: updatedDeductions }, { merge: true });
          }
        });
        await Promise.all(resetPromises);
      } catch (err) {
        console.error("Gagal menyetel ulang slip gaji secara otomatis:", err);
      }

      setMessage({ type: 'success', text: 'Data presensi berhasil dihapus.' });
      setExistingPresence(null);
    } catch (err) {
      console.error(err);
      setMessage({ type: 'error', text: 'Gagal menghapus data presensi.' });
    } finally {
      setSavingPresence(false);
    }
  };

  const handleApplyPekaryaPresence = async () => {
    setSavingPresence(true);
    try {
      const q = query(
        collection(db, 'Employees_BlueCollar'),
        where('employment.status', '==', 'active'),
        where('employment.jobCategory', '==', selectedPekaryaCategory)
      );
      const snap = await getDocs(q);
      const empsList = snap.docs.map(d => ({ employeeId: d.id, name: d.data().name || '' }));
      if (empsList.length === 0) {
        setMessage({ type: 'error', text: 'Tidak ada data pegawai yang ditemukan untuk kategori ini.' });
        return;
      }

      const docId = `${year}_${String(month).padStart(2, '0')}_${selectedPekaryaCategory}`;
      const docRef = doc(db, 'UraianGaji', docId);
      const docSnap = await getDoc(docRef);

      const existingData = docSnap.exists() ? docSnap.data() : { entries: {} };
      const updatedEntries = { ...existingData.entries };

      empsList.forEach(emp => {
        const prevEntry = updatedEntries[emp.employeeId] || { values: {}, counts: {} };
        const newValues = {
          ...prevEntry.values,
          harian: pekaryaWorkingDays,
          jumatLibur: pekaryaHolidays,
        };
        const newCounts = {
          ...prevEntry.counts,
          harian: pekaryaWorkingDays,
          jumatLibur: pekaryaHolidays,
        };
        updatedEntries[emp.employeeId] = {
          employeeId: emp.employeeId,
          name: emp.name,
          values: newValues,
          counts: newCounts,
        };
      });

      const payload = {
        ...existingData,
        period: `${year}-${String(month).padStart(2, '0')}`,
        periodLabel: `${MONTHS_ID[month - 1]} ${year}`,
        jobCategory: selectedPekaryaCategory,
        entries: updatedEntries,
        updatedAt: serverTimestamp()
      };

      await setDoc(docRef, payload, { merge: true });
      setMessage({
        type: 'success',
        text: `Berhasil menerapkan presensi (Hari Kerja: ${pekaryaWorkingDays}, Hari Libur: ${pekaryaHolidays}) untuk ${empsList.length} pegawai pada Uraian ${selectedPekaryaCategory}.`
      });
    } catch (err) {
      console.error('Error applying Pekarya presence:', err);
      setMessage({ type: 'error', text: 'Gagal menerapkan presensi Pekarya.' });
    } finally {
      setSavingPresence(false);
    }
  };

  const fmtRp = (n: number) => 'Rp\u00a0' + Math.round(n).toLocaleString('id-ID');

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Target Type Toggle */}
      {profile?.role !== 'loyalis_presence_admin' && (
        <div className="flex bg-white p-1 rounded-xl w-fit shadow-sm border border-slate-200/60">
          <button
            type="button"
            onClick={() => setPresensiTargetType('loyalis')}
            className={`px-5 py-2.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${presensiTargetType === 'loyalis'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
              }`}
          >
            <Users className="w-4 h-4" />
            Loyalis
          </button>
          <button
            type="button"
            onClick={() => setPresensiTargetType('pekarya')}
            className={`px-5 py-2.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${presensiTargetType === 'pekarya'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
              }`}
          >
            <Users className="w-4 h-4" />
            Pekarya
          </button>
        </div>
      )}

      {message && (
        <div className={`flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium ${message.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {message.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />} {message.text}
        </div>
      )}

      {presensiTargetType === 'pekarya' && profile?.role !== 'loyalis_presence_admin' ? (
        <Card className="bg-white rounded-[20px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-none p-6 space-y-6">
          <div className="flex justify-between items-center border-b border-slate-50 pb-4">
            <div>
              <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-indigo-500" />
                Kalkulator Presensi Pekarya
              </h3>
              <p className="text-slate-400 text-xs mt-0.5">
                Input jumlah hari kerja dan hari libur untuk mengisi kolom Harian serta Jumat & Libur secara otomatis.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Satuan Kerja Pekarya</label>
              <Select
                value={selectedPekaryaCategory}
                onValueChange={(val) => val && setSelectedPekaryaCategory(val)}
              >
                <SelectTrigger className="w-full bg-white shadow-sm border-slate-200 rounded-xl font-semibold hover:border-indigo-300 transition-all">
                  <SelectValue placeholder="Pilih Satker..." />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-slate-100 shadow-xl bg-white">
                  {dynamicCategories.map(c => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Jumlah Hari Kerja</label>
              <Input
                type="number"
                min={0}
                max={31}
                value={pekaryaWorkingDays}
                onChange={(e) => setPekaryaWorkingDays(Math.max(0, parseInt(e.target.value, 10) || 0))}
                className="rounded-xl border-slate-200 font-bold text-slate-700 text-xs h-10 w-full"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Jumlah Hari Libur</label>
              <Input
                type="number"
                min={0}
                max={31}
                value={pekaryaHolidays}
                onChange={(e) => setPekaryaHolidays(Math.max(0, parseInt(e.target.value, 10) || 0))}
                className="rounded-xl border-slate-200 font-bold text-slate-700 text-xs h-10 w-full"
              />
            </div>
          </div>

          <div className="flex justify-end pt-4 border-t border-slate-50">
            <Button
              type="button"
              onClick={handleApplyPekaryaPresence}
              disabled={savingPresence || !selectedPekaryaCategory}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl px-6 text-xs flex items-center gap-2 shadow-md active:scale-95 transition-all cursor-pointer"
            >
              {savingPresence ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Terapkan Presensi Pekarya Massal
            </Button>
          </div>
        </Card>
      ) : (
        profile?.role !== 'satker_head_loyalis' && (
          <Card className="bg-white rounded-[20px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-none p-6 space-y-6">
            <div className="flex justify-between items-center border-b border-slate-50 pb-4">
              <div>
                <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-emerald-500" />
                  Kalkulator Bonus Presensi Loyalis via Raw Excel Log
                </h3>
                <p className="text-slate-400 text-xs mt-0.5">Unggah data daily raw logs kehadiran bulanan untuk menghitung presensi. Klik baris pegawai untuk mengedit logs harian.</p>
              </div>
              <div className="flex items-center gap-2">
                {existingPresence && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleDeletePresence}
                    disabled={savingPresence}
                    className="text-rose-500 hover:text-rose-600 hover:bg-rose-50 rounded-xl h-9 px-3"
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Hapus Data
                  </Button>
                )}
              </div>
            </div>

            {existingPresence && Object.keys(existingPresence.entries || {}).length === 0 && !uploadedData && (
              <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 flex items-start gap-3">
                <Calendar className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-blue-800 text-xs font-bold">Hari Kerja Telah Dikonfigurasi</h4>
                  <p className="text-blue-600/90 text-[11px] mt-0.5 leading-relaxed">
                    Jumlah hari kerja periode ini ({MONTHS_ID[month - 1]} {year}) telah diatur sebanyak <strong>{existingPresence.workingDays || 25} hari</strong>.
                    Silakan pilih dan unggah file Excel daily raw logs di bawah untuk melengkapi perhitungan bonus presensi pegawai.
                  </p>
                </div>
              </div>
            )}

            {existingPresence && Object.keys(existingPresence.entries || {}).length > 0 && !uploadedData && (
              <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                <div className="space-y-3 w-full">
                  <div>
                    <h4 className="text-emerald-800 text-xs font-bold">Data Presensi Telah Disimpan</h4>
                    <p className="text-emerald-600/90 text-[11px] mt-0.5 leading-relaxed">
                      Periode ini ({MONTHS_ID[month - 1]} {year}) sudah memiliki data presensi dengan {Object.keys(existingPresence.entries || {}).length} pegawai terdaftar.
                      Jika ingin memperbarui data, silakan klik tombol Ubah Data di bawah atau hapus data saat ini.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    <div className="flex flex-wrap gap-4 text-[10px] text-emerald-700 font-bold bg-white/50 px-3 py-1.5 rounded-xl border border-emerald-100/50 w-fit">
                      <span>Hari Kerja: {existingPresence.workingDays || 25} hari</span>
                      <span>Target: {expectedHours} jam/hari (Capped)</span>
                    </div>
                    <Button
                      type="button"
                      onClick={handleStartEdit}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs h-9 px-4 flex items-center gap-1.5 shadow-md active:scale-95 transition-all cursor-pointer"
                    >
                      <Edit className="w-4 h-4" />
                      Ubah Data
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {(!existingPresence || Object.keys(existingPresence.entries || {}).length === 0 || !!uploadedData) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-end">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Jumlah Hari Kerja (n)</label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      min={0}
                      max={31}
                      value={workingDays}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === '') {
                          setWorkingDays('');
                        } else {
                          const parsed = parseInt(val, 10);
                          setWorkingDays(isNaN(parsed) ? 0 : Math.max(0, parsed));
                        }
                      }}
                      className="rounded-xl border-slate-200 font-bold text-slate-700 text-xs h-10 w-full"
                    />
                    <Button
                      type="button"
                      onClick={handleSaveWorkingDaysConfig}
                      disabled={savingPresence}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs h-10 px-4 rounded-xl shadow-md transition-all flex items-center gap-1.5 shrink-0"
                    >
                      <Save className="w-4 h-4" />
                      <span>Simpan</span>
                    </Button>
                  </div>
                </div>

                <div className="relative">
                  <Input
                    type="file"
                    accept=".xlsx, .xls"
                    id="presence-excel-file"
                    onChange={handleExcelUpload}
                    className="hidden"
                  />
                  <Button
                    type="button"
                    onClick={() => document.getElementById('presence-excel-file')?.click()}
                    className="w-full bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-xl text-xs font-bold h-10 flex items-center justify-center gap-2 transition-all"
                  >
                    <Upload className="w-4 h-4 text-slate-400" />
                    Pilih File Excel Daily Raw Log
                  </Button>
                </div>
              </div>
            )}

            {displayRows && (
              <div className="space-y-4 pt-4 border-t border-slate-100 animate-in fade-in">
                <div className="flex flex-wrap justify-between items-center gap-4">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                      {uploadedData ? 'Preview Hasil Perhitungan Presensi (Raw Daily Logs)' : 'Data Perhitungan Presensi Tersimpan'}
                    </span>
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      <span className="text-[10px] bg-slate-50 text-slate-600 border border-slate-200/60 px-2 py-0.5 rounded-full font-semibold">
                        Target Menit Kerja Kehadiran Penuh: {(activeWorkingDays * expectedHours * 60).toLocaleString('id-ID')} menit
                      </span>
                    </div>
                  </div>
                  <span className="text-[10px] text-slate-400 font-semibold">
                    Total Data: {displayRows.length} baris ({displayRows.filter(r => r.employeeId).length} Terhubung)
                  </span>
                </div>

                <div className="space-y-3.5 pr-1">
                  {displayRows.map((row, idx) => {
                    const isExpanded = expandedRowIdx === idx;
                    return (
                      <Card
                        key={idx}
                        className={`border-2 rounded-2xl shadow-sm transition-all hover:border-indigo-300 ${isExpanded ? 'ring-4 ring-indigo-50 border-indigo-400 bg-indigo-50/40' : 'border-indigo-200/80 bg-indigo-50/20'
                          } ${activeSearchRowIdx === row.idx ? 'overflow-visible z-30 relative' : 'overflow-hidden'}`}
                      >
                        <div
                          onClick={() => setExpandedRowIdx(isExpanded ? null : idx)}
                          className="p-4 flex flex-wrap items-center justify-between gap-4 cursor-pointer hover:bg-slate-50/20 transition-colors"
                        >
                          {/* Left: Index & Name */}
                          <div className="flex items-center gap-3 min-w-[240px]">
                            <div className="w-8 h-8 rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-500 font-mono shrink-0">
                              {idx + 1}
                            </div>
                            <div className="space-y-0.5">
                              <h4 className="font-bold text-slate-800 text-xs tracking-wide">{row.excelName}</h4>
                              <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                                {uploadedData && row.excelName !== '-' ? (
                                  activeSearchRowIdx === row.idx ? (
                                    <div className="relative w-full max-w-[200px] z-20">
                                      <Input
                                        type="text"
                                        placeholder="Cari nama pegawai..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        autoFocus
                                        onBlur={() => {
                                          setTimeout(() => {
                                            setActiveSearchRowIdx(null);
                                          }, 200);
                                        }}
                                        className="h-7 rounded-lg border-indigo-300 font-semibold text-slate-800 text-[10px] w-full bg-white pr-7"
                                      />
                                      <div className="absolute left-0 right-0 top-8 max-h-40 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-xl z-50 divide-y divide-slate-50">
                                        {(() => {
                                          const search = searchQuery.toLowerCase();
                                          const filtered = loyalisEmployees.filter(emp =>
                                            emp.name.toLowerCase().includes(search)
                                          );
                                          return (
                                            <>
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  handleLinkEmployee(row.excelName, "");
                                                  setActiveSearchRowIdx(null);
                                                }}
                                                className="w-full text-left px-2.5 py-1.5 hover:bg-slate-50 text-[9px] font-bold text-rose-500 block"
                                              >
                                                -- Putuskan Hubungan --
                                              </button>
                                              {filtered.length === 0 ? (
                                                <div className="p-2 text-[9px] text-slate-400">Pegawai tidak ditemukan</div>
                                              ) : (
                                                filtered.map(emp => (
                                                  <button
                                                    key={emp.id}
                                                    type="button"
                                                    onClick={() => {
                                                      handleLinkEmployee(row.excelName, emp.id);
                                                      setActiveSearchRowIdx(null);
                                                    }}
                                                    className="w-full text-left px-2.5 py-1.5 hover:bg-slate-50 text-[9px] font-semibold text-slate-700 block truncate"
                                                  >
                                                    {emp.name}
                                                  </button>
                                                ))
                                              )}
                                            </>
                                          );
                                        })()}
                                      </div>
                                    </div>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setActiveSearchRowIdx(row.idx);
                                        setSearchQuery(row.employeeName || "");
                                      }}
                                      className={`text-left px-2 py-1 rounded-lg border transition-all text-[9px] font-bold flex items-center gap-1 cursor-pointer ${row.isMatched
                                          ? 'bg-indigo-50/40 text-indigo-700 border-indigo-100/50 hover:bg-indigo-50 hover:border-indigo-200'
                                          : 'bg-rose-50 border-rose-100 text-rose-600 hover:bg-rose-100/50'
                                        }`}
                                    >
                                      <span className="truncate max-w-[150px]">
                                        {row.isMatched ? row.employeeName : "Hubungkan Pegawai..."}
                                      </span>
                                      <Edit className="w-2.5 h-2.5 opacity-60 shrink-0" />
                                    </button>
                                  )
                                ) : row.isMatched ? (
                                  <div className="flex items-center gap-1">
                                    <span className="font-bold text-indigo-600 text-[10px]">{row.employeeName}</span>
                                    <span className="text-[9px] text-slate-400 font-mono">(ID: {row.employeeId})</span>
                                  </div>
                                ) : (
                                  <span className="inline-flex items-center gap-0.5 text-rose-500 bg-rose-50 border border-rose-100 text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                                    <AlertCircle className="w-2.5 h-2.5" />
                                    Tidak cocok
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Middle: Metrics */}
                          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                            {/* Hari Aktif */}
                            <div className="flex flex-col text-center min-w-[70px]">
                              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Hari Aktif</span>
                              <span className="text-xs font-bold text-slate-700 mt-0.5 font-mono">{row.activeDaysCount} hari</span>
                            </div>

                            {/* Punch Tidak Lengkap */}
                            <div className="flex flex-col text-center min-w-[120px]">
                              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Hari Tidak Lengkap</span>
                              <div className="mt-0.5 font-mono">
                                {row.incompleteDaysCount > 0 ? (
                                  <span className="inline-flex items-center gap-1 text-[9px] text-amber-600 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-full font-bold">
                                    <AlertCircle className="w-3 h-3 shrink-0" />
                                    {row.incompleteDaysCount} hari
                                  </span>
                                ) : (
                                  <span className="text-xs text-slate-400 font-semibold">-</span>
                                )}
                              </div>
                            </div>

                            {/* Total Menit Kerja */}
                            <div className="flex flex-col text-center min-w-[120px]" onClick={(e) => e.stopPropagation()}>
                              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Total Menit Kerja</span>
                              <div className="mt-0.5">
                                {uploadedData && row.excelName !== '-' ? (
                                  <div className="flex items-center justify-center gap-1">
                                    <Input
                                      type="number"
                                      min={0}
                                      value={row.minutes}
                                      onChange={(e) => handleUpdateMinutes(row.excelName, Math.max(0, parseInt(e.target.value, 10) || 0))}
                                      className="w-16 text-center font-bold font-mono h-7 rounded-lg border-slate-200 text-[10px] p-1 bg-white"
                                    />
                                    <span className="text-slate-400 text-[9px]">min</span>
                                  </div>
                                ) : (
                                  <span className="text-xs font-bold text-slate-700 font-mono">{row.minutes} menit</span>
                                )}
                              </div>
                            </div>

                            {/* Kekurangan */}
                            <div className="flex flex-col text-center min-w-[110px]">
                              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Kekurangan (Menit)</span>
                              <span className="text-xs font-bold text-slate-700 mt-0.5 font-mono">
                                {row.isMatched ? `${row.absenceMinutes} menit` : '-'}
                              </span>
                            </div>
                          </div>

                          {/* Right: Expand Icon */}
                          <div className="flex items-center gap-2">
                            {isExpanded ? (
                              <ChevronUp className="w-4 h-4 text-slate-400 hover:text-slate-600" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-slate-400 hover:text-slate-600" />
                            )}
                          </div>
                        </div>

                        {/* Expanded Daily Logs */}
                        {isExpanded && (
                          <div className="border-t border-slate-100 p-4 bg-slate-50/20 space-y-4">
                            {row.corrections && row.corrections.length > 0 && (
                              <div className="space-y-3 p-4 bg-indigo-50/30 border border-indigo-150/60 rounded-2xl">
                                <h5 className="text-[11px] font-bold text-indigo-750 uppercase tracking-wider flex items-center gap-1.5">
                                  <Clock className="w-3.5 h-3.5 text-indigo-500 shrink-0 animate-pulse" />
                                  Pengajuan Koreksi Presensi Pegawai ({row.corrections.filter((c: any) => !pendingResolutionUpdates[c.id] && c.status === 'pending').length} Tertunda)
                                </h5>
                                <div className="space-y-2">
                                  {row.corrections.map((c: any) => {
                                    const resolution = pendingResolutionUpdates[c.id];
                                    const isApproved = resolution?.status === 'approved' || c.status === 'approved';
                                    const isRejected = resolution?.status === 'rejected' || c.status === 'rejected';
                                    const currentStatus = resolution ? resolution.status : c.status;

                                    return (
                                      <div key={c.id} className="bg-white border border-slate-100 rounded-xl p-3.5 text-xs flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                                        <div className="space-y-1 text-left">
                                          <div className="flex items-center gap-2 flex-wrap">
                                            <span className="font-extrabold text-slate-700">
                                              {new Date(c.date).toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })}
                                            </span>
                                            <span className={`inline-flex px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${currentStatus === 'approved' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' :
                                                currentStatus === 'rejected' ? 'bg-rose-50 text-rose-700 border border-rose-100' :
                                                  'bg-amber-50 text-amber-700 border border-amber-100'
                                              }`}>
                                              {currentStatus === 'approved' ? 'Disetujui' : currentStatus === 'rejected' ? 'Ditolak' : 'Tertunda'} {resolution && '(Belum Disimpan)'}
                                            </span>
                                            <span className="text-[10px] font-bold text-indigo-750 bg-indigo-50 border border-indigo-100 px-2.5 py-0.5 rounded-full">
                                              {c.type === 'izin_resmi' ? 'Izin Resmi (Hari Penuh)' : c.type === 'both' ? 'Masuk & Pulang' : c.type === 'tap_in' ? 'Masuk Saja' : 'Pulang Saja'}
                                            </span>
                                          </div>
                                          <div className="text-[11px] text-slate-650 font-semibold space-y-0.5 mt-1">
                                            {c.type === 'izin_resmi' ? (
                                              <div>Izin Resmi: <span className="font-mono font-bold text-emerald-600 bg-emerald-50/50 px-1.5 py-0.5 rounded">07:30 — 14:00 (Hari Penuh)</span></div>
                                            ) : (
                                              <>
                                                {c.type !== 'tap_out' && <div>Koreksi Masuk: <span className="font-mono font-bold text-indigo-600 bg-indigo-50/50 px-1.5 py-0.5 rounded">{c.checkInTime || '--:--'}</span></div>}
                                                {c.type !== 'tap_in' && <div>Koreksi Pulang: <span className="font-mono font-bold text-indigo-600 bg-indigo-50/50 px-1.5 py-0.5 rounded">{c.checkOutTime || '--:--'}</span></div>}
                                              </>
                                            )}
                                            <div className="italic text-slate-500 mt-1 font-medium">"Alasan: {c.reason}"</div>
                                            {c.proofUrl && (
                                              <div className="mt-1">
                                                <a href={c.proofUrl} target="_blank" rel="noreferrer" className="text-indigo-500 hover:underline font-bold inline-flex items-center gap-1 cursor-pointer">
                                                  <FileText className="w-3.5 h-3.5" /> Lihat Bukti Lampiran
                                                </a>
                                              </div>
                                            )}
                                            {isRejected && (c.rejectionReason || resolution?.rejectionReason) && (
                                              <div className="text-rose-600 font-bold mt-1">Alasan Penolakan: {resolution?.rejectionReason || c.rejectionReason}</div>
                                            )}
                                          </div>
                                        </div>

                                        {/* Actions */}
                                        {currentStatus === 'pending' && (
                                          <div className="flex flex-col sm:flex-row items-end sm:items-center gap-2 shrink-0">
                                            {!uploadedData ? (
                                              <span className="text-[10px] text-slate-400 font-semibold italic">Aktifkan edit untuk memproses</span>
                                            ) : activeDeclineId === c.id ? (
                                              <div className="flex items-center gap-2">
                                                <Input
                                                  placeholder="Alasan penolakan..."
                                                  value={declineReasonInput[c.id] || ''}
                                                  onChange={(e) => setDeclineReasonInput(prev => ({ ...prev, [c.id]: e.target.value }))}
                                                  className="h-8 text-xs rounded-lg w-48 bg-white border-slate-200"
                                                />
                                                <Button
                                                  size="sm"
                                                  onClick={() => {
                                                    const reason = declineReasonInput[c.id] || '';
                                                    if (!reason.trim()) {
                                                      alert('Alasan penolakan wajib diisi!');
                                                      return;
                                                    }
                                                    handleDeclineCorrection(c.id, reason);
                                                    setActiveDeclineId(null);
                                                  }}
                                                  className="bg-rose-600 hover:bg-rose-700 text-white font-bold h-8 rounded-lg text-xs"
                                                >
                                                  Kirim
                                                </Button>
                                                <Button
                                                  size="sm"
                                                  variant="ghost"
                                                  onClick={() => setActiveDeclineId(null)}
                                                  className="h-8 rounded-lg text-xs text-slate-500"
                                                >
                                                  Batal
                                                </Button>
                                              </div>
                                            ) : (
                                              <>
                                                <Button
                                                  size="sm"
                                                  variant="outline"
                                                  onClick={() => setActiveDeclineId(c.id)}
                                                  className="text-rose-600 border-rose-200 hover:bg-rose-50 rounded-lg text-xs font-extrabold h-8 px-3"
                                                >
                                                  Tolak
                                                </Button>
                                                <Button
                                                  size="sm"
                                                  onClick={() => handleAcceptCorrection(row.employeeId, c)}
                                                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold rounded-lg text-xs h-8 px-4"
                                                >
                                                  Setujui & Terapkan
                                                </Button>
                                              </>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            <div className="bg-white border border-slate-100 rounded-xl p-4 shadow-sm space-y-3">
                              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                                <Clock className="w-4 h-4 text-slate-400" />
                                Logs Presensi Harian: {row.employeeName || row.excelName}
                              </h4>
                              {row.dailyLogs && row.dailyLogs.length > 0 ? (
                                <div className="border border-slate-100 rounded-xl">
                                  <table className="w-full text-left border-collapse text-[11px]">
                                    <thead className="bg-slate-50 sticky top-0 shadow-[0_1px_0_0_rgba(241,245,249,1)]">
                                      <tr className="border-b border-slate-100">
                                        <th className="px-3 py-2 font-bold text-slate-500 w-12 text-center">NO</th>
                                        <th className="px-3 py-2 font-bold text-slate-500">TANGGAL</th>
                                        <th className="px-3 py-2 font-bold text-slate-500 w-44">STATUS</th>
                                        <th className="px-3 py-2 font-bold text-slate-500 w-40 text-center">SCAN MASUK</th>
                                        <th className="px-3 py-2 font-bold text-slate-500 w-40 text-center">SCAN PULANG</th>
                                        <th className="px-3 py-2 font-bold text-slate-500 w-32 text-center">DURASI</th>
                                        <th className="px-3 py-2 font-bold text-slate-500 w-36 text-center">PENDAPATAN</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {row.dailyLogs.map((log: any, logIdx: number) => {
                                        const isEditable = !!uploadedData && row.excelName !== '-';
                                        return (
                                          <tr key={logIdx} className="border-b border-slate-50 hover:bg-slate-50/40">
                                            <td className="px-3 py-2 text-slate-400 text-center font-mono">{logIdx + 1}</td>
                                            <td className="px-3 py-2 font-bold text-slate-600 font-mono">{log.Tanggal}</td>
                                            <td className="px-3 py-2">
                                              {isEditable ? (
                                                <Select
                                                  value={log['Jam kerja'] || 'MASUK'}
                                                  onValueChange={(val) => handleUpdateDailyLog(row.excelName, log.Tanggal, 'Jam kerja', val)}
                                                >
                                                  <SelectTrigger className="h-8 text-[11px] rounded-lg border-slate-200 bg-white">
                                                    <SelectValue />
                                                  </SelectTrigger>
                                                  <SelectContent className="bg-white rounded-lg border border-slate-100 shadow-lg">
                                                    <SelectItem value="MASUK">MASUK</SelectItem>
                                                    <SelectItem value="Tidak Hadir">Tidak Hadir</SelectItem>
                                                    <SelectItem value="Libur Rutin">Libur Rutin</SelectItem>
                                                  </SelectContent>
                                                </Select>
                                              ) : (
                                                <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${log['Jam kerja'] === 'MASUK' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' :
                                                    log['Jam kerja'] === 'Tidak Hadir' ? 'bg-rose-50 text-rose-600 border border-rose-100' :
                                                      'bg-slate-50 text-slate-600 border border-slate-100'
                                                  }`}>
                                                  {log['Jam kerja']}
                                                </span>
                                              )}
                                            </td>
                                            <td className="px-3 py-2 text-center">
                                              {isEditable && (log['Jam kerja'] === 'MASUK') ? (
                                                <div className="flex items-center gap-1.5 justify-center">
                                                  <Input
                                                    type="time"
                                                    step="1"
                                                    value={log['Scan masuk'] || ''}
                                                    onChange={(e) => handleUpdateDailyLog(row.excelName, log.Tanggal, 'Scan masuk', e.target.value)}
                                                    className={`h-8 rounded-lg text-center font-mono text-[11px] w-32 bg-white ${
                                                      log.scanMasukAuto ? 'border-amber-300 ring-2 ring-amber-100/50 text-amber-750 font-bold bg-amber-50/10' : 'border-slate-200'
                                                    }`}
                                                  />
                                                  {log.scanMasukAuto && (
                                                    <span className="inline-flex px-1.5 py-0.5 rounded text-[8px] font-extrabold uppercase bg-amber-50 text-amber-700 border border-amber-200 select-none shrink-0 cursor-help" title="Diisi otomatis (150 menit sebelum scan pulang)">
                                                      Auto
                                                    </span>
                                                  )}
                                                </div>
                                              ) : (
                                                <div className="flex items-center gap-1 justify-center">
                                                  <span className={`font-mono ${log.scanMasukAuto ? 'text-amber-700 font-extrabold bg-amber-50/40 px-1.5 py-0.5 rounded border border-amber-100' : 'text-slate-600'}`}>
                                                    {log['Scan masuk'] || '-'}
                                                  </span>
                                                  {log.scanMasukAuto && (
                                                    <span className="inline-flex px-1.5 py-0.5 rounded text-[8px] font-extrabold uppercase bg-amber-50 text-amber-700 border border-amber-200 select-none shrink-0 cursor-help" title="Diisi otomatis (150 menit sebelum scan pulang)">
                                                      Auto
                                                    </span>
                                                  )}
                                                </div>
                                              )}
                                            </td>
                                            <td className="px-3 py-2 text-center">
                                              {isEditable && (log['Jam kerja'] === 'MASUK') ? (
                                                <div className="flex items-center gap-1.5 justify-center">
                                                  <Input
                                                    type="time"
                                                    step="1"
                                                    value={log['Scan pulang'] || ''}
                                                    onChange={(e) => handleUpdateDailyLog(row.excelName, log.Tanggal, 'Scan pulang', e.target.value)}
                                                    className={`h-8 rounded-lg text-center font-mono text-[11px] w-32 bg-white ${
                                                      log.scanPulangAuto ? 'border-amber-300 ring-2 ring-amber-100/50 text-amber-750 font-bold bg-amber-50/10' : 'border-slate-200'
                                                    }`}
                                                  />
                                                  {log.scanPulangAuto && (
                                                    <span className="inline-flex px-1.5 py-0.5 rounded text-[8px] font-extrabold uppercase bg-amber-50 text-amber-700 border border-amber-200 select-none shrink-0 cursor-help" title="Diisi otomatis (150 menit setelah scan masuk)">
                                                      Auto
                                                    </span>
                                                  )}
                                                </div>
                                              ) : (
                                                <div className="flex items-center gap-1 justify-center">
                                                  <span className={`font-mono ${log.scanPulangAuto ? 'text-amber-700 font-extrabold bg-amber-50/40 px-1.5 py-0.5 rounded border border-amber-100' : 'text-slate-600'}`}>
                                                    {log['Scan pulang'] || '-'}
                                                  </span>
                                                  {log.scanPulangAuto && (
                                                    <span className="inline-flex px-1.5 py-0.5 rounded text-[8px] font-extrabold uppercase bg-amber-50 text-amber-700 border border-amber-200 select-none shrink-0 cursor-help" title="Diisi otomatis (150 menit setelah scan masuk)">
                                                      Auto
                                                    </span>
                                                  )}
                                                </div>
                                              )}
                                            </td>
                                            <td className="px-3 py-2 text-center font-mono font-bold text-slate-600">
                                              {log['Jam kerja'] === 'MASUK' && log.duration !== undefined ? `${log.duration} menit` : '-'}
                                            </td>
                                            <td className="px-3 py-2 text-center font-mono font-bold text-indigo-600">
                                              {log['Jam kerja'] === 'MASUK' && log.duration !== undefined ? fmtRp(log.duration * 27.5) : '-'}
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              ) : (
                                <p className="text-xs text-slate-400 text-center py-4 bg-slate-50/50 rounded-xl">Tidak ada log kehadiran harian untuk pegawai ini.</p>
                              )}
                            </div>
                          </div>
                        )}
                      </Card>
                    );
                  })}
                </div>

                {/* Actions Footer */}
                {uploadedData && (
                  <div className="flex justify-end gap-3 pt-4 border-t border-slate-50">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setUploadedData(null)}
                      className="rounded-xl border-slate-200 text-slate-600 text-xs font-bold"
                    >
                      Batal
                    </Button>
                    <Button
                      type="button"
                      onClick={handleSavePresence}
                      disabled={savingPresence || uploadedData.filter(r => r.employeeId).length === 0}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl px-6 text-xs flex items-center gap-2 shadow-md active:scale-95 transition-all cursor-pointer"
                    >
                      {savingPresence ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                      Simpan Data Presensi
                    </Button>
                  </div>
                )}
              </div>
            )}
          </Card>
        )
      )}
    </div>
  );
}
