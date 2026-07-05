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
  Loader2, CheckCircle2, FileText, AlertCircle, Trash2, Plus, Save,
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
  const [workingDays, setWorkingDays] = useState<number>(25);
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

  const displayRows = useMemo(() => {
    if (uploadedData) {
      const matchedIds = new Set(uploadedData.map(r => r.employeeId).filter(Boolean));
      const matchedRows: any[] = [];
      const unmatchedExcelRows: any[] = [];

      uploadedData.forEach((row) => {
        const calc = calculatePresenceStratum(row.minutes, calcMode, workingDays, expectedHours);
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
          absenceMinutes: 0,
          stratum: 5,
          deduction: 0,
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
        minutes: entry.minutes,
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

          const minutes = Number(minVal) || 0;
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
        workingDays,
        expectedHours,
        mode: calcMode,
        entries: existingEntries,
        updatedAt: serverTimestamp(),
      };

      await setDoc(doc(db, 'LoyalisPresence', periodToken), payload, { merge: true });
      setMessage({ type: 'success', text: `Konfigurasi hari kerja (${workingDays} hari) berhasil disimpan.` });
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
        const calc = calculatePresenceStratum(row.minutes, calcMode, workingDays, expectedHours);
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
            absenceMinutes: 0,
            stratum: 5,
            deduction: 0,
            netBonus: 0,
            isNotFoundInExcel: true,
          };
        }
      });

      const payload = {
        period: periodToken,
        workingDays,
        expectedHours,
        mode: calcMode,
        entries: entriesMap,
        updatedAt: serverTimestamp(),
      };

      await setDoc(doc(db, 'LoyalisPresence', periodToken), payload);
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
      setMessage({ type: 'success', text: 'Data presensi berhasil dihapus.' });
      setExistingPresence(null);
    } catch (err) {
      console.error(err);
      setMessage({ type: 'error', text: 'Gagal menghapus data presensi.' });
    } finally {
      setSavingPresence(false);
    }
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
    <div className="space-y-6 animate-in fade-in duration-500">
      
      {/* Target Selector */}
      <div className="flex bg-white p-1 rounded-xl w-fit shadow-sm border border-slate-200/60">
        <button
          onClick={() => setPresensiTargetType('loyalis')}
          className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
            presensiTargetType === 'loyalis' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          Presensi Loyalis
        </button>
        <button
          onClick={() => setPresensiTargetType('pekarya')}
          className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
            presensiTargetType === 'pekarya' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          Quick Apply Pekarya
        </button>
      </div>

      {message && (
        <div className={`flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium ${message.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {message.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />} {message.text}
        </div>
      )}

      {presensiTargetType === 'loyalis' ? (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
          
          {/* Config Card */}
          <div className="xl:col-span-4 space-y-6">
            <Card className="bg-white rounded-[20px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-none p-6 space-y-6">
              <h3 className="font-bold text-slate-800 text-sm">Konfigurasi & Impor Excel</h3>
              
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Mode Kalkulasi</label>
                  <Select value={calcMode} onValueChange={(v: any) => setCalcMode(v)}>
                    <SelectTrigger className="w-full bg-white border-slate-200 rounded-xl font-semibold text-xs h-10"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="worked">Akumulasi Menit Kerja</SelectItem>
                      <SelectItem value="absent">Akumulasi Menit Absen</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Hari Kerja (Hari)</label>
                    <Input type="number" value={workingDays} onChange={(e) => setWorkingDays(parseInt(e.target.value, 10) || 0)} className="rounded-xl border-slate-200 font-semibold text-slate-800 text-sm text-center" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Jam Kerja (Jam/Hari)</label>
                    <Input type="number" step="0.5" value={expectedHours} onChange={(e) => setExpectedHours(parseFloat(e.target.value) || 0)} className="rounded-xl border-slate-200 font-semibold text-slate-800 text-sm text-center" />
                  </div>
                </div>

                <Button onClick={handleSaveWorkingDaysConfig} disabled={savingPresence} className="w-full rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold shadow-sm h-10 flex items-center justify-center gap-1.5">
                  {savingPresence ? <Loader2 className="w-4 h-4 animate-spin" /> : <Settings className="w-4 h-4" />} Simpan Konfigurasi
                </Button>
              </div>

              <div className="relative p-6 border-2 border-dashed border-slate-200 hover:border-indigo-300 rounded-[20px] text-center bg-white cursor-pointer transition-colors" onClick={() => document.getElementById('excel-upload-input')?.click()}>
                <Upload className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                <h4 className="text-slate-900 font-bold text-xs mb-1">Unggah Excel Presensi</h4>
                <p className="text-[10px] text-slate-400 mb-4 px-2">Unggah rekap absensi untuk auto-kalkulasi strata bonus</p>
                <input id="excel-upload-input" type="file" className="hidden" accept=".xlsx,.xls" onChange={handleExcelUpload} />
                <Button variant="outline" className="rounded-xl border-slate-200 text-[10px] font-semibold">Pilih Berkas</Button>
              </div>
            </Card>
          </div>

          {/* Table Preview */}
          <div className="xl:col-span-8">
            <Card className="bg-white rounded-[20px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-none overflow-hidden min-h-[400px] flex flex-col">
              <div className="p-5 flex items-center justify-between border-b border-slate-100 bg-white/50 backdrop-blur-sm z-10">
                <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">Preview Bonus Presensi — {MONTHS_ID[month - 1]} {year}</h2>
                <div className="flex gap-2">
                  {displayRows && displayRows.length > 0 && (
                    <Button onClick={handleSavePresence} disabled={savingPresence || !uploadedData} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl px-5 text-xs flex items-center gap-1.5 shadow-md h-9">
                      {savingPresence ? <Loader2 className="w-4.5 h-4.5 animate-spin" /> : <Save className="w-4.5 h-4.5" />} Simpan Presensi
                    </Button>
                  )}
                  {existingPresence && (
                    <Button onClick={handleDeletePresence} disabled={savingPresence} variant="ghost" className="rounded-xl text-rose-500 hover:text-rose-700 hover:bg-rose-50 font-bold px-4 text-xs h-9">
                      Hapus
                    </Button>
                  )}
                </div>
              </div>

              {loadingPresence ? (
                <div className="p-20 flex-1 flex flex-col items-center justify-center text-slate-400"><Loader2 className="w-8 h-8 animate-spin mb-3" /><p className="font-medium">Memuat data presensi...</p></div>
              ) : !displayRows || displayRows.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-slate-400 space-y-3">
                  <FileSpreadsheet className="w-12 h-12 opacity-30" />
                  <div className="space-y-1">
                    <p className="font-bold text-slate-700 text-sm">Belum Ada Data Presensi</p>
                    <p className="text-xs text-slate-400">Silakan unggah rekap Excel di sebelah kiri untuk melihat preview data.</p>
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                  <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 z-20 bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="px-6 py-4 text-[10px] font-bold uppercase text-slate-500 tracking-wider">Nama Pegawai (Excel)</th>
                        <th className="px-4 py-4 text-[10px] font-bold uppercase text-slate-500 tracking-wider text-center">Menit {calcMode === 'worked' ? 'Kerja' : 'Absen'}</th>
                        <th className="px-4 py-4 text-[10px] font-bold uppercase text-slate-500 tracking-wider text-center">Menit Absen</th>
                        <th className="px-4 py-4 text-[10px] font-bold uppercase text-slate-500 tracking-wider text-center">Strata</th>
                        <th className="px-4 py-4 text-[10px] font-bold uppercase text-slate-500 tracking-wider text-right">Potongan</th>
                        <th className="px-6 py-4 text-[10px] font-bold uppercase text-slate-500 tracking-wider text-right">Bonus Bersih</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {displayRows.map((row) => (
                        <tr key={row.idx} className="hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-4">
                            <div className="text-xs font-bold text-slate-800 leading-none">{row.employeeName || row.excelName}</div>
                            {row.isNotFoundInExcel && <span className="text-[9px] font-bold text-rose-500 bg-rose-50 border border-rose-100 px-1.5 py-0.5 rounded mt-1.5 inline-block">Tidak Terdaftar Absen</span>}
                            {!row.isMatched && <span className="text-[9px] font-bold text-amber-500 bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded mt-1.5 inline-block">Unmatched (Excel name)</span>}
                          </td>
                          <td className="px-4 py-4 text-xs font-bold text-slate-600 text-center">{row.minutes} m</td>
                          <td className="px-4 py-4 text-xs font-bold text-slate-600 text-center">{row.absenceMinutes} m</td>
                          <td className="px-4 py-4 text-center">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                              row.stratum === 1 ? 'bg-emerald-50 text-emerald-700' :
                              row.stratum === 5 ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'
                            }`}>Strata {row.stratum}</span>
                          </td>
                          <td className="px-4 py-4 text-xs font-bold text-rose-600 text-right">{fmtRp(row.deduction)}</td>
                          <td className="px-6 py-4 text-xs font-bold text-slate-700 text-right">{fmtRp(row.netBonus)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>

        </div>
      ) : (
        /* Quick Apply Pekarya Card */
        <Card className="bg-white rounded-[20px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-none p-6 max-w-2xl">
          <h3 className="font-bold text-slate-800 text-sm mb-2">Terapkan Presensi Pekarya Massal</h3>
          <p className="text-xs text-slate-500 mb-6">Mengatur data hari kerja dan libur secara massal untuk seluruh pegawai di kategori satuan kerja terpilih.</p>

          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Kategori Satuan Kerja</label>
                <Select value={selectedPekaryaCategory} onValueChange={(v) => setSelectedPekaryaCategory(v || '')}>
                  <SelectTrigger className="w-full bg-white border-slate-200 rounded-xl font-semibold text-xs h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {dynamicCategories.map(c => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Hari Kerja</label>
                  <Input type="number" value={pekaryaWorkingDays} onChange={(e) => setPekaryaWorkingDays(parseInt(e.target.value, 10) || 0)} className="rounded-xl border-slate-200 font-semibold text-slate-800 text-sm text-center" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Libur/Jumat</label>
                  <Input type="number" value={pekaryaHolidays} onChange={(e) => setPekaryaHolidays(parseInt(e.target.value, 10) || 0)} className="rounded-xl border-slate-200 font-semibold text-slate-800 text-sm text-center" />
                </div>
              </div>
            </div>

            <Button onClick={handleApplyPekaryaPresence} disabled={savingPresence} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl h-11 flex items-center justify-center gap-1.5 shadow-md">
              {savingPresence ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Terapkan & Simpan Presensi Pekarya
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
