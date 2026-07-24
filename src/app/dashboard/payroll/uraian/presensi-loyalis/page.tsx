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
  Calendar, Check, ShieldCheck, FileSpreadsheet, Users, Info, Settings, Clock, Upload
} from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import {
  collection, getDocs, doc, setDoc, deleteDoc, getDoc, serverTimestamp, query, where
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { MONTHS_ID, REKAP_COLUMNS, SUPPORTED_CATEGORIES } from '@/utils/rekapConfig';
import { normalizeName, MANUAL_OVERRIDES } from '@/utils/payrollLogic';
import * as XLSX from 'xlsx';

export default function PresensiLoyalisPage() {
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

  const handleStartEdit = useCallback(() => {
    if (!existingPresence?.entries) return;
    const entriesList = Object.values(existingPresence.entries).map((entry: any) => ({
      excelName: entry.excelName || '-',
      employeeId: entry.isNotFoundInExcel ? null : entry.employeeId,
      employeeName: entry.isNotFoundInExcel ? null : entry.employeeName,
      minutes: Math.ceil(entry.minutes || 0),
    }));
    setUploadedData(entriesList);
    setMessage({ type: 'success', text: 'Mode edit diaktifkan. Anda sekarang dapat mengubah data menit kerja dan menghubungkan pegawai.' });
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
      }));

      const matched = entriesList.filter(e => !e.isNotFoundInExcel).sort((a, b) => (a.employeeName || '').localeCompare(b.employeeName || ''));
      const unmatched = entriesList.filter(e => e.isNotFoundInExcel).sort((a, b) => (a.employeeName || '').localeCompare(b.employeeName || ''));

      return [...matched, ...unmatched].map((row, idx) => ({ ...row, idx }));
    }
    return null;
  }, [uploadedData, loyalisEmployees, existingPresence, calcMode, workingDays, expectedHours, calculatePresenceStratum]);

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
        const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

        if (rows.length === 0) {
          setMessage({ type: 'error', text: 'File Excel kosong.' });
          return;
        }

        let nameColIndex = 0;
        let minColIndex = 1;

        for (let r = 0; r < Math.min(rows.length, 10); r++) {
          const row = rows[r];
          if (!row) continue;
          const nameIdx = row.findIndex(cell => typeof cell === 'string' && cell.trim().length > 2 && isNaN(Number(cell)));
          const valIdx = row.findIndex(cell => typeof cell === 'number' || (typeof cell === 'string' && !isNaN(Number(cell.trim())) && cell.trim() !== ''));
          if (nameIdx !== -1 && valIdx !== -1 && nameIdx !== valIdx) {
            nameColIndex = nameIdx;
            minColIndex = valIdx;
            break;
          }
        }

        const parsedData: any[] = [];
        rows.forEach((row) => {
          if (!row) return;
          const nameVal = row[nameColIndex];
          const minVal = row[minColIndex];

          if (!nameVal) return;
          const nameStr = String(nameVal).trim();
          const lowerName = nameStr.toLowerCase();
          if (/^(nama|staff|employee|total|rekap)/i.test(lowerName) || lowerName === 'nama/nik' || lowerName === 'nama / nik') {
            return;
          }

          const minutes = Math.ceil(Number(minVal) || 0);
          const match = matchExcelName(nameStr, loyalisEmployees);

          parsedData.push({
            excelName: nameStr,
            employeeId: match?.id || null,
            employeeName: match?.name || null,
            minutes,
          });
        });

        if (parsedData.length === 0) {
          setMessage({ type: 'error', text: 'Tidak ada data pegawai yang dapat diproses di Excel ini.' });
          return;
        }

        setUploadedData(parsedData);
        setMessage({ type: 'success', text: `Berhasil mengunggah ${parsedData.length} baris data.` });
      } catch (err) {
        console.error(err);
        setMessage({ type: 'error', text: 'Gagal membaca file Excel. Pastikan format benar.' });
      }
    };
    reader.readAsBinaryString(file);
  }, [loyalisEmployees, matchExcelName]);

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

      // Do not mutate PayrollSlipStates here. Finance refreshes and saves draft
      // snapshots through the protected API after reviewing attendance changes.

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
    setMessage({
      type: 'error',
      text: 'Penghapusan data presensi dinonaktifkan. Gunakan koreksi beralasan agar riwayat tetap utuh.',
    });
  };

  // Direct-to-Firestore Pekarya Presence Applier (substitute for local state binding)
  const handleApplyPekaryaPresence = async () => {
    setSavingPresence(true);
    try {
      // 1. Fetch active employees in selected category
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

      // 2. Fetch or initialize the target UraianGaji document
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
            className={`px-5 py-2.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
              presensiTargetType === 'loyalis'
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
            className={`px-5 py-2.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
              presensiTargetType === 'pekarya'
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
            {/* 1. Category Selector */}
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

            {/* 2. Jumlah Hari Kerja */}
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

            {/* 3. Jumlah Hari Libur */}
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
                  Kalkulator Bonus Presensi Loyalis via Excel
                </h3>
                <p className="text-slate-400 text-xs mt-0.5">Unggah data rekap kehadiran bulanan untuk menghitung strata dan bonus presensi.</p>
              </div>
              {existingPresence && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDeletePresence}
                  disabled={savingPresence}
                  className="text-rose-500 hover:text-rose-600 hover:bg-rose-50 rounded-xl"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Hapus Data
                </Button>
              )}
            </div>

            {/* Status Indicator for pre-configured working days */}
            {existingPresence && Object.keys(existingPresence.entries || {}).length === 0 && !uploadedData && (
              <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 flex items-start gap-3">
                <Calendar className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-blue-800 text-xs font-bold">Hari Kerja Telah Dikonfigurasi</h4>
                  <p className="text-blue-600/90 text-[11px] mt-0.5 leading-relaxed">
                    Jumlah hari kerja periode ini ({MONTHS_ID[month - 1]} {year}) telah diatur sebanyak <strong>{existingPresence.workingDays || 25} hari</strong>.
                    Silakan pilih dan unggah file Excel rekap kehadiran di bawah untuk melengkapi perhitungan bonus presensi pegawai.
                  </p>
                </div>
              </div>
            )}

            {/* Status Indicator for complete data */}
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
                      <span>Target: 390 menit/hari</span>
                      <span>Mode Input: {existingPresence.mode === 'worked' ? 'Menit Kerja' : 'Menit Absen'}</span>
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

            {/* Settings and File Upload Input */}
            {(!existingPresence || Object.keys(existingPresence.entries || {}).length === 0 || !!uploadedData) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-end">
                {/* 1. Working Days */}
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

                {/* 2. File Upload */}
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
                    Pilih File Excel
                  </Button>
                </div>
              </div>
            )}

            {/* Review Table */}
            {displayRows && (
              <div className="space-y-4 pt-4 border-t border-slate-100 animate-in fade-in">
                <div className="flex flex-wrap justify-between items-center gap-4">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                      {uploadedData ? 'Preview Hasil Perhitungan Strata' : 'Data Perhitungan Strata Tersimpan'}
                    </span>
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      <span className="text-[10px] bg-slate-50 text-slate-600 border border-slate-200/60 px-2 py-0.5 rounded-full font-semibold">
                        Total Menit Kerja Kehadiran Penuh: {(activeWorkingDays * expectedHours * 60).toLocaleString('id-ID')} menit
                      </span>
                      <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-100 px-2 py-0.5 rounded-full font-semibold">
                        Gaji Standar Presensi: {fmtRp(activeWorkingDays * expectedHours * 1650)}
                      </span>
                    </div>
                  </div>
                  <span className="text-[10px] text-slate-400 font-semibold">
                    Total Data: {displayRows.length} baris ({displayRows.filter(r => r.employeeId).length} Terhubung)
                  </span>
                </div>

                <div className="border border-slate-100 rounded-2xl overflow-auto shadow-sm max-h-[800px] bg-white">
                  <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 bg-slate-50 z-10 shadow-[0_1px_0_0_rgba(241,245,249,1)]">
                      <tr className="bg-slate-50 border-b border-slate-100">
                        <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase w-12 text-center">NO</th>
                        <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase">NAMA EXCEL</th>
                        <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase">PEGAWAI TERHUBUNG</th>
                        <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase w-32 text-center font-mono">MENIT KERJA EXCEL</th>
                        <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase w-32 text-center font-mono">ABSEN (MENIT)</th>
                        <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase w-24 text-center">STRATA</th>
                        <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase w-36 text-right font-mono">NET PRESENSI</th>
                        <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase w-32 text-right">NET BONUS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayRows.map((row, idx) => {
                        return (
                          <tr key={idx} className={`border-b border-slate-50 hover:bg-slate-50/50 transition-colors ${activeSearchRowIdx === row.idx ? 'relative z-30' : ''}`}>
                            <td className="px-4 py-3 text-xs text-slate-400 text-center font-mono">{idx + 1}</td>
                            <td className="px-4 py-3 text-xs font-bold text-slate-700">{row.excelName}</td>
                            <td className="px-4 py-3 text-xs">
                              {uploadedData && row.excelName !== '-' ? (
                                activeSearchRowIdx === row.idx ? (
                                  <div className="relative w-full max-w-[220px]">
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
                                      className="h-8 rounded-lg border-indigo-300 font-semibold text-slate-800 text-xs w-full bg-white pr-7"
                                    />
                                    <div className="absolute left-0 right-0 top-9 max-h-40 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-xl z-50 divide-y divide-slate-50">
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
                                              className="w-full text-left px-3 py-2 hover:bg-slate-50 text-[10px] font-bold text-rose-500"
                                            >
                                              -- Putuskan Hubungan --
                                            </button>
                                            {filtered.length === 0 ? (
                                              <div className="p-2.5 text-[10px] text-slate-400">Pegawai tidak ditemukan</div>
                                            ) : (
                                              filtered.map(emp => (
                                                <button
                                                  key={emp.id}
                                                  type="button"
                                                  onClick={() => {
                                                    handleLinkEmployee(row.excelName, emp.id);
                                                    setActiveSearchRowIdx(null);
                                                  }}
                                                  className="w-full text-left px-3 py-2 hover:bg-slate-50 text-[10px] font-semibold text-slate-700 block truncate"
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
                                    className={`text-left w-full max-w-[220px] px-3 py-1.5 rounded-lg border transition-all text-xs font-semibold flex items-center justify-between cursor-pointer ${
                                      row.isMatched
                                        ? 'bg-indigo-50/40 text-indigo-700 border-indigo-100 hover:bg-indigo-50 hover:border-indigo-200'
                                        : 'bg-rose-50 border-rose-100 text-rose-600 hover:bg-rose-100/50'
                                    }`}
                                  >
                                    <span className="truncate max-w-[170px]">
                                      {row.isMatched ? row.employeeName : "Klik untuk Hubungkan..."}
                                    </span>
                                    <Edit className="w-3.5 h-3.5 opacity-60 hover:opacity-100 shrink-0 ml-1" />
                                  </button>
                                )
                              ) : row.isMatched ? (
                                <div>
                                  <p className="font-bold text-indigo-600">{row.employeeName}</p>
                                  <p className="text-[10px] text-slate-400 font-mono">ID: {row.employeeId}</p>
                                </div>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-rose-500 bg-rose-50 border border-rose-100 text-[10px] font-bold px-2 py-0.5 rounded-full">
                                  <AlertCircle className="w-3 h-3" />
                                  Tidak cocok
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-xs font-bold text-slate-600 text-center font-mono">
                              {uploadedData && row.excelName !== '-' ? (
                                <Input
                                  type="number"
                                  min={0}
                                  value={row.minutes}
                                  onChange={(e) => handleUpdateMinutes(row.excelName, Math.max(0, parseInt(e.target.value, 10) || 0))}
                                  className="w-24 text-center font-bold font-mono h-8 rounded-lg border-slate-200 text-xs mx-auto"
                                />
                              ) : (
                                row.minutes
                              )}
                            </td>
                            <td className="px-4 py-3 text-xs text-slate-600 text-center font-mono">{row.isMatched ? row.absenceMinutes : 0}</td>
                            <td className="px-4 py-3 text-center">
                              {row.isMatched ? (
                                <span className={`inline-flex text-[10px] font-bold px-2 py-0.5 rounded-full ${row.stratum === 1 ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' :
                                    row.stratum === 2 ? 'bg-blue-50 text-blue-600 border border-blue-100' :
                                      row.stratum === 3 ? 'bg-amber-50 text-amber-600 border border-amber-100' :
                                        row.stratum === 4 ? 'bg-orange-50 text-orange-600 border border-orange-100' :
                                          'bg-rose-50 text-rose-600 border border-rose-100'
                                  }`}>
                                  Strata {row.stratum}
                                </span>
                              ) : '-'}
                            </td>
                            <td className="px-4 py-3 text-xs font-bold text-indigo-600 text-right font-mono">
                              {row.isMatched
                                ? fmtRp(Math.max(0, (activeWorkingDays * expectedHours * 60 - row.absenceMinutes) / 60 * 1650))
                                : fmtRp(0)}
                            </td>
                            <td className="px-4 py-3 text-xs font-black text-indigo-600 text-right font-mono">
                              {row.isMatched ? fmtRp(row.netBonus) : fmtRp(0)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
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
