"use client"

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { FloatingSnackbar } from '@/components/ui/floating-snackbar';
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
import { normalizeNipy } from '@/lib/payroll/attendance';
import { parseLoyalisPresenceWorkbook } from '@/lib/payroll/loyalisPresenceWorkbook';
import {
  autoFillLoyalisScan,
  calculateLoyalisDailyDuration,
} from '@/lib/payroll/loyalisPresenceWindow';
import {
  authenticatedFormData,
  authenticatedJson,
  createFinancialRequestId,
  propagateUraianToSlips,
} from '@/lib/payroll/client';

import Link from 'next/link';
import { generatePresensiLoyalisXlsx } from '@/utils/generatePresensiLoyalisXlsx';

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

    if (statusUpper === 'TIDAK HADIR') {
      absentDaysCount += 1;
    } else {
      // Any non-"Tidak Hadir" status (MASUK, or a source-specific label like
      // "Staff") means the employee was present that day — the label just
      // isn't a scan-driven status, so still read the real scan times.
      if (inStr && outStr) {
        const duration = calculateLoyalisDailyDuration(inStr, outStr, expHours);

        if (duration !== null) {
          dailyDuration = duration;
          totalWorkedMinutes += dailyDuration;
          activeDaysCount += 1;
        } else {
          incompleteDaysCount += 1;
        }
      } else if (inStr && !outStr) {
        if (dayRow.scanPulangAuto !== false) {
          const autoFilledOut = autoFillLoyalisScan(inStr, 'out');
          if (autoFilledOut) {
            outStr = autoFilledOut;
            scanPulangAuto = true;
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
        } else {
          incompleteDaysCount += 1;
        }
      } else if (!inStr && outStr) {
        if (dayRow.scanMasukAuto !== false) {
          const autoFilledIn = autoFillLoyalisScan(outStr, 'in');
          if (autoFilledIn) {
            inStr = autoFilledIn;
            scanMasukAuto = true;
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
        } else {
          incompleteDaysCount += 1;
        }
      } else {
        incompleteDaysCount += 1;
      }
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

  const canonicalPeriod = `${year}-${String(month).padStart(2, '0')}`;
  // API commands and document metadata use the canonical YYYY-MM token. The
  // source document ID remains YYYY_MM for compatibility with existing
  // LoyalisPresence records and the payroll dashboard's legacy read path.
  const periodToken = canonicalPeriod;
  const presenceDocId = periodToken.replace('-', '_');
  const usesSharedImport = canonicalPeriod >= '2026-08';

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
  const [activeImport, setActiveImport] = useState<{
    activeRevision?: number;
    activeRevisionId?: string;
  } | null>(null);
  const [activeCalendarRevision, setActiveCalendarRevision] = useState(1);
  const [importHistory, setImportHistory] = useState<
    Array<{
      id: string;
      revision?: number;
      status?: string;
      fileName?: string;
      downloadUrl?: string | null;
    }>
  >([]);
  const [deletingRevisionId, setDeletingRevisionId] = useState<string | null>(null);

  // ── Pekarya Presence Utility States ──
  const [presensiTargetType, setPresensiTargetType] = useState<'loyalis' | 'pekarya'>('loyalis');
  const [pekaryaWorkingDays, setPekaryaWorkingDays] = useState<number>(25);
  const [pekaryaHolidays, setPekaryaHolidays] = useState<number>(0);
  const [selectedPekaryaCategory, setSelectedPekaryaCategory] = useState<string>('SATPAM');
  const [dynamicCategories, setDynamicCategories] = useState<string[]>(SUPPORTED_CATEGORIES);

  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [activeSearchRowIdx, setActiveSearchRowIdx] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [strataFilter, setStrataFilter] = useState<'all' | '1' | '2' | '3' | '4' | '5'>('all');

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
            nipy: normalizeNipy(
              data.nipy || data.personal_info?.employee_id_niy || '',
            ),
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

  const fetchActiveImport = useCallback(async () => {
    if (!usesSharedImport) {
      setActiveImport(null);
      return;
    }
    try {
      const [result, calendarResult] = await Promise.all([
        authenticatedJson<{
          import: {
            activeRevision?: number;
            activeRevisionId?: string;
          } | null;
          revisions: Array<{
            id: string;
            revision?: number;
            status?: string;
            fileName?: string;
            downloadUrl?: string | null;
          }>;
        }>(
          `/api/attendance/imports?period=${encodeURIComponent(canonicalPeriod)}&includeDownload=true`,
        ),
        authenticatedJson<{ calendar: { revision: number } }>(
          `/api/payroll/periods/${encodeURIComponent(canonicalPeriod)}/calendar`,
        ),
      ]);
      setActiveImport(result.import);
      setImportHistory(result.revisions || []);
      setActiveCalendarRevision(calendarResult.calendar.revision);
    } catch (error) {
      console.error('Failed to load shared attendance import:', error);
      setActiveImport(null);
    }
  }, [canonicalPeriod, usesSharedImport]);

  useEffect(() => {
    void fetchActiveImport();
  }, [fetchActiveImport]);

  const handleDeleteRevision = useCallback(async (revisionId: string) => {
    if (!window.confirm('Hapus file presensi ini? File yang gagal/tidak selesai diaktifkan ini akan dihapus permanen beserta baris datanya.')) {
      return;
    }
    setDeletingRevisionId(revisionId);
    try {
      await authenticatedJson(
        `/api/attendance/imports?period=${encodeURIComponent(canonicalPeriod)}&revisionId=${encodeURIComponent(revisionId)}`,
        { method: 'DELETE' },
      );
      setMessage({ type: 'success', text: 'Revisi file presensi berhasil dihapus.' });
      await fetchActiveImport();
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Gagal menghapus revisi file presensi.',
      });
    } finally {
      setDeletingRevisionId(null);
    }
  }, [canonicalPeriod, fetchActiveImport]);

  // ── Fetch Existing Loyalis Presence Data ──
  const fetchExistingPresence = useCallback(async () => {
    setLoadingPresence(true);
    try {
      const docRef = doc(db, 'LoyalisPresence', presenceDocId);
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
  }, [presenceDocId]);

  useEffect(() => {
    fetchExistingPresence();
  }, [fetchExistingPresence]);

  // ── Read the calculation table from the active shared import ──
  // The active file's parsed rows live server-side (AttendanceImportRows)
  // regardless of who uploaded it, and the server is the only place that
  // knows the Loyalis/Pekarya department routing. Both the initial page load
  // and a fresh upload read the table from here so there is exactly one
  // matching implementation.
  const fetchActiveImportLoyalisRows = useCallback(async () => {
    const result = await authenticatedJson<{
      loyalisRows: Array<{
        excelName: string;
        nipy: string;
        employeeId: string | null;
        employeeName: string | null;
        dailyLogs: Array<{ Tanggal: string; 'Jam kerja': string; 'Scan masuk': string; 'Scan pulang': string }>;
      }>;
    }>(`/api/attendance/imports?period=${encodeURIComponent(canonicalPeriod)}&scope=loyalis`);
    return (result.loyalisRows || []).map((entry) => ({
      excelName: entry.excelName,
      nipy: entry.nipy,
      employeeId: entry.employeeId,
      employeeName: entry.employeeName,
      ...recalculateSummary(entry.dailyLogs, expectedHours),
    }));
  }, [canonicalPeriod, expectedHours]);

  useEffect(() => {
    if (!usesSharedImport) return;
    if (!activeImport?.activeRevisionId) return;
    if (loadingPresence) return;
    if (existingPresence && Object.keys(existingPresence.entries || {}).length > 0) return;
    if (uploadedData) return;
    let cancelled = false;
    (async () => {
      try {
        const parsedData = await fetchActiveImportLoyalisRows();
        if (cancelled || parsedData.length === 0) return;
        setUploadedData(parsedData);
      } catch (error) {
        console.error('Gagal memuat data presensi dari file aktif:', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    usesSharedImport,
    activeImport?.activeRevisionId,
    loadingPresence,
    existingPresence,
    uploadedData,
    fetchActiveImportLoyalisRows,
  ]);

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

  // Best-effort name match used to propose a link. The scanner routinely
  // exports its own short PIN in the NIPY column, so the employee name is
  // often the only usable signal for reconnecting a row by hand.
  const suggestEmployeeByName = useCallback((excelName: string, employees: any[]) => {
    if (!excelName || excelName === '-') return null;
    const cleanExcel = normalizeName(excelName).toLowerCase();
    const excelBase = excelName.split(',')[0].trim().toLowerCase();
    const excelWords = excelBase.split(/\s+/).filter((w: string) => w.length >= 3);

    let bestCandidate: any = null;
    let maxScore = 0;

    employees.forEach(emp => {
      const empName = emp.name || '';
      const cleanDb = normalizeName(empName).toLowerCase();
      const dbBase = empName.split(',')[0].trim().toLowerCase();
      const dbWords = dbBase.split(/\s+/).filter((w: string) => w.length >= 3);

      if (excelBase === dbBase || cleanExcel === cleanDb) {
        if (maxScore < 10) {
          maxScore = 10;
          bestCandidate = emp;
        }
        return;
      }

      const matchingWords = excelWords.filter((w: string) =>
        dbWords.some((dw: string) => dw.includes(w) || w.includes(dw))
      );

      if (matchingWords.length > maxScore) {
        maxScore = matchingWords.length;
        bestCandidate = emp;
      }
    });

    return bestCandidate;
  }, []);

  const getUnmatchedReason = useCallback((
    excelName: string,
    sourceNipy: string,
    employees: any[],
    isSharedImport: boolean
  ): { reason: string; detail: string; suggestedEmp: any | null } => {
    if (isSharedImport) {
      const suggestedEmp = suggestEmployeeByName(excelName, employees);
      const suggestionNote = suggestedEmp
        ? ` Berdasarkan nama, kemungkinan pegawai ini adalah "${suggestedEmp.name}".`
        : '';
      if (!sourceNipy) {
        return {
          reason: 'NIPY Kosong di Excel',
          detail: `Kolom NIPY/PIN pada baris Excel ini tidak terisi, sehingga tidak dapat dihubungkan otomatis.${suggestionNote}`,
          suggestedEmp,
        };
      }
      return {
        reason: 'NIPY Tidak Ditemukan',
        detail: `NIPY "${sourceNipy}" dari file Excel tidak cocok dengan data NIPY pegawai Loyalis aktif mana pun di sistem. Nilai ini biasanya merupakan PIN mesin presensi, bukan NIPY.${suggestionNote}`,
        suggestedEmp,
      };
    }

    if (!excelName || excelName === '-') {
      return {
        reason: 'Baris Kosong',
        detail: 'Tidak ada nama pegawai pada baris data ini.',
        suggestedEmp: null,
      };
    }

    const bestCandidate = suggestEmployeeByName(excelName, employees);

    if (bestCandidate) {
      const hasDegreeInExcel = excelName.includes(',');
      const hasDegreeInDb = (bestCandidate.name || '').includes(',');
      let detailMsg = `Nama di Excel "${excelName}" berbeda penulisan dengan data di sistem.`;

      if (hasDegreeInExcel || hasDegreeInDb) {
        detailMsg = `Terdapat perbedaan penulisan gelar/tanda baca antara Excel ("${excelName}") dan master pegawai ("${bestCandidate.name}").`;
      } else {
        detailMsg = `Terdapat perbedaan ejaan/spasi antara Excel ("${excelName}") dan master pegawai ("${bestCandidate.name}").`;
      }

      return {
        reason: 'Perbedaan Gelar / Ejaan Nama',
        detail: detailMsg,
        suggestedEmp: bestCandidate,
      };
    }

    return {
      reason: 'Pegawai Belum Terdaftar / Nama Berbeda',
      detail: `Nama "${excelName}" di file Excel tidak cocok dengan data pegawai Loyalis aktif mana pun di sistem. Kemungkinan pegawai belum diinput ke database master.`,
      suggestedEmp: null,
    };
  }, [suggestEmployeeByName]);

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
      nipy: entry.nipy || '',
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
          nipy: row.nipy || '',
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
        nipy: entry.nipy || '',
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

  const filteredDisplayRows = useMemo(() => {
    if (!displayRows) return null;
    if (strataFilter === 'all') return displayRows;
    const targetStratum = Number(strataFilter);
    return displayRows.filter((r) => Number(r.stratum) === targetStratum);
  }, [displayRows, strataFilter]);

  const handleExportXlsx = useCallback(() => {
    const rowsToExport = filteredDisplayRows || displayRows;
    if (!rowsToExport || rowsToExport.length === 0) {
      setMessage({ type: 'error', text: 'Tidak ada data presensi yang dapat diexport.' });
      return;
    }
    generatePresensiLoyalisXlsx({
      month,
      year,
      workingDays: activeWorkingDays,
      expectedHours,
      rows: rowsToExport,
      strataFilter,
    });
    setMessage({ type: 'success', text: 'Berhasil mengunduh Data Perhitungan Presensi Tersimpan (.xlsx)' });
  }, [filteredDisplayRows, displayRows, month, year, activeWorkingDays, expectedHours, strataFilter]);

  const handleExcelUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onerror = () => {
      setSavingPresence(false);
      setMessage({ type: 'error', text: 'Gagal membaca file Excel. Pastikan file tidak rusak dan coba lagi.' });
    };
    reader.onload = (evt) => {
      try {
        const data = evt.target?.result;
        if (!(data instanceof ArrayBuffer)) {
          throw new Error('File Excel tidak dapat dibaca sebagai data biner.');
        }

        const parsedWorkbook = parseLoyalisPresenceWorkbook(data, canonicalPeriod);
        const calculationRows = parsedWorkbook.rows.filter(
          (row) => !usesSharedImport || Boolean(row.nipy),
        );

        if (calculationRows.length === 0) {
          setMessage({
            type: 'error',
            text: `Tidak ada baris presensi untuk periode ${canonicalPeriod} pada file ini.`,
          });
          return;
        }

        // Auto-detect working days count from the uploaded raw logs using robust algorithm:
        // - A date is NOT a working day if:
        //   1) All employees recorded on that date have "Tidak Hadir" status.
        //   2) At least half of the employees recorded on that date have "Libur Rutin" status.
        // - Otherwise, it is a working day.
        const dateStats: Record<string, { total: number; tidakHadir: number; liburRutin: number }> = {};
        calculationRows.forEach(row => {
          const tgl = row.date;
          const jk = row.workStatus.toUpperCase();
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

        const employeesByNipy = new Map(
          loyalisEmployees
            .filter((employee) => employee.nipy)
            .map((employee) => [employee.nipy, employee] as const),
        );
        const grouped: Record<string, { rows: typeof calculationRows; match: any | null }> = {};
        calculationRows.forEach(row => {
          const matchByNipy = row.nipy ? employeesByNipy.get(row.nipy) || null : null;
          const matchByName = matchExcelName(row.name, loyalisEmployees);
          // Newer imports are NIPY-only. Historical uploads may contain an
          // old/stale NIPY, so use it when it resolves and fall back to the
          // existing name/override matcher otherwise.
          const match = usesSharedImport ? matchByNipy : matchByNipy || matchByName;
          const groupKey = match
            ? `employee:${match.id}`
            : row.nipy
              ? `nipy:${row.nipy}`
              : `name:${row.name}`;

          if (!grouped[groupKey]) grouped[groupKey] = { rows: [], match };
          grouped[groupKey].rows.push(row);
          if (!grouped[groupKey].match && match) grouped[groupKey].match = match;
        });

        const parsedData: any[] = [];
        Object.values(grouped).forEach(({ rows: empRows, match }) => {
          if (usesSharedImport && !match) return;

          const excelName = empRows[0]?.name || empRows[0]?.nipy || '-';
          const sourceNipy = empRows.find((row) => row.nipy)?.nipy || '';
          // Sort logs by ISO date before converting them to the display format.
          const dailyLogs = [...empRows]
            .sort((a, b) => a.dateIso.localeCompare(b.dateIso))
            .map((dayRow) => ({
              Tanggal: dayRow.date,
              'Jam kerja': dayRow.workStatus,
              'Scan masuk': dayRow.scanIn,
              'Scan pulang': dayRow.scanOut,
            }));

          // Run recalculation to get total worked minutes, active days, etc.
          const summary = recalculateSummary(dailyLogs, expectedHours);

          parsedData.push({
            excelName,
            nipy: sourceNipy,
            employeeId: match?.id || null,
            employeeName: match?.name || null,
            ...summary,
          });
        });

        if (parsedData.length === 0) {
          setMessage({
            type: 'error',
            text: 'Tidak ada pegawai Loyalis yang dapat dihubungkan dari file Excel ini.',
          });
          return;
        }

        const warningParts: string[] = [];
        if (parsedWorkbook.outsidePeriodCount > 0) {
          warningParts.push(`${parsedWorkbook.outsidePeriodCount} baris di luar periode diabaikan.`);
        }
        if (parsedWorkbook.invalidDateCount > 0) {
          warningParts.push(`${parsedWorkbook.invalidDateCount} baris dengan tanggal tidak valid diabaikan.`);
        }
        if (parsedWorkbook.invalidTimeCount > 0) {
          warningParts.push(`${parsedWorkbook.invalidTimeCount} baris memiliki jam scan tidak valid.`);
        }
        if (parsedWorkbook.invalidStatusCount > 0) {
          warningParts.push(`${parsedWorkbook.invalidStatusCount} baris tanpa status diabaikan.`);
        }
        if (parsedWorkbook.missingIdentityCount > 0) {
          warningParts.push(`${parsedWorkbook.missingIdentityCount} baris tanpa identitas pegawai diabaikan.`);
        }
        const unmatchedCount = parsedData.filter((row) => !row.employeeId).length;
        if (unmatchedCount > 0) {
          warningParts.push(`${unmatchedCount} pegawai perlu dihubungkan manual.`);
        }

        setUploadedData(parsedData);
        setMessage({
          type: 'success',
          text: `Berhasil mengunggah ${parsedData.length} data pegawai dari ${parsedWorkbook.rows.length} baris logs presensi. Jumlah hari kerja otomatis diatur menjadi ${deducedDays} hari.${warningParts.length > 0 ? ` ${warningParts.join(' ')}` : ''}`
        });
      } catch (err) {
        console.error(err);
        setMessage({
          type: 'error',
          text: err instanceof Error ? err.message : 'Gagal membaca file Excel. Pastikan format benar.',
        });
      }
    };
    const prepareAndRead = async () => {
      if (!usesSharedImport) {
        reader.readAsArrayBuffer(file);
        return;
      }
      setSavingPresence(true);
      try {
        const previewForm = new FormData();
        previewForm.append('file', file);
        previewForm.append('period', canonicalPeriod);
        previewForm.append('mode', 'preview');
        const preview = await authenticatedFormData<{
          summary: {
            sourceRowCount: number;
            matchedLoyalisCount: number;
            matchedPekaryaCount: number;
            matchedSatpamCount: number;
            unknownNipyCount: number;
            invalidRowCount: number;
            activeEmployeeMissingNipyCount: number;
            duplicateMasterNipyCount: number;
          };
          differences: {
            previousRevision: number;
            added: number;
            removed: number;
            changed: number;
          };
        }>('/api/attendance/imports', previewForm);
        const summary = preview.summary;
        const proceed = window.confirm(
          [
            `Aktifkan file presensi bersama untuk ${canonicalPeriod}?`,
            `${summary.sourceRowCount} baris · ${summary.matchedLoyalisCount} Loyalis · ${summary.matchedPekaryaCount} Pekarya (${summary.matchedSatpamCount} Satpam).`,
            `${summary.unknownNipyCount} NIPY tidak dikenal · ${summary.invalidRowCount} baris tidak valid.`,
            `${summary.activeEmployeeMissingNipyCount} pegawai aktif belum punya NIPY · ${summary.duplicateMasterNipyCount} NIPY master duplikat.`,
            `Perubahan terhadap revisi aktif: +${preview.differences.added} / -${preview.differences.removed} / ${preview.differences.changed} berubah.`,
            'File lama dan hasil sebelumnya tetap disimpan untuk audit.',
          ].join('\n'),
        );
        if (!proceed) return;
        const activateForm = new FormData();
        activateForm.append('file', file);
        activateForm.append('period', canonicalPeriod);
        activateForm.append('mode', 'activate');
        activateForm.append(
          'requestId',
          createFinancialRequestId('attendance-import'),
        );
        activateForm.append(
          'reason',
          'Mengaktifkan file presensi bulanan bersama untuk perhitungan payroll.',
        );
        activateForm.append(
          'expectedRevision',
          String(preview.differences.previousRevision),
        );
        const activated = await authenticatedFormData<{
          activeRevision: number;
          activeRevisionId: string;
        }>('/api/attendance/imports', activateForm);
        setActiveImport({
          activeRevision: activated.activeRevision,
          activeRevisionId: activated.activeRevisionId,
        });
        // The server has parsed and stored the file; read the table back from
        // it rather than parsing the same bytes a second time here. Only the
        // server applies the department routing, so a local re-parse would
        // disagree with what every other viewer of this period sees.
        const parsedData = await fetchActiveImportLoyalisRows();
        if (parsedData.length === 0) {
          setMessage({
            type: 'error',
            text: 'File aktif tidak memuat baris presensi Loyalis untuk periode ini.',
          });
          return;
        }
        setUploadedData(parsedData);
        const unmatchedCount = parsedData.filter((row) => !row.employeeId).length;
        setMessage({
          type: 'success',
          text: `Berhasil mengaktifkan file presensi bersama. ${parsedData.length} pegawai Loyalis dimuat.${
            unmatchedCount > 0 ? ` ${unmatchedCount} baris perlu dihubungkan manual.` : ''
          }`,
        });
      } catch (error) {
        setMessage({
          type: 'error',
          text:
            error instanceof Error
              ? error.message
              : 'Gagal mengaktifkan file presensi bersama.',
        });
      } finally {
        setSavingPresence(false);
      }
    };
    void prepareAndRead();
  }, [
    canonicalPeriod,
    loyalisEmployees,
    expectedHours,
    matchExcelName,
    usesSharedImport,
    fetchActiveImportLoyalisRows,
  ]);

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

      await setDoc(doc(db, 'LoyalisPresence', presenceDocId), payload, { merge: true });
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
    if (
      usesSharedImport &&
      (!activeImport?.activeRevision || !activeImport.activeRevisionId)
    ) {
      setMessage({
        type: 'error',
        text: 'Aktifkan file presensi bersama sebelum menyimpan hasil Loyalis.',
      });
      return;
    }
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
          nipy: row.nipy || '',
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
            nipy: emp.nipy || '',
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
        ...(usesSharedImport && {
          sourceImportRevision: activeImport?.activeRevision || 0,
          sourceImportRevisionId: activeImport?.activeRevisionId || '',
          sourceImportStale: false,
          sourceCalendarRevision: activeCalendarRevision,
          sourceCalendarStale: false,
        }),
        updatedAt: serverTimestamp(),
      };

      await setDoc(doc(db, 'LoyalisPresence', presenceDocId), payload);

      let propagationNote = '';
      try {
        propagationNote = await propagateUraianToSlips({
          scope: 'loyalis',
          period: periodToken,
        });
      } catch (propagationError) {
        // The attendance document is already safely saved. A propagation
        // outage must not turn that successful save into a false failure.
        console.error('Gagal menyinkronkan presensi Loyalis ke slip draf:', propagationError);
        propagationNote = ' Namun slip gaji belum diperbarui — buka Payroll › Refresh Massal.';
      }

      // The propagation above updates only eligible draft slips. Verified,
      // locked, and paid slips remain immutable and receive drift notices.

      // Update correction requests
      try {
        const updateCorrectionPromises = Object.entries(pendingResolutionUpdates).map(async ([reqId, update]) => {
          const reqRef = doc(db, 'LoyalisPresenceCorrections', reqId);
          await setDoc(reqRef, {
            period: periodToken,
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

      setMessage({
        type: 'success',
        text: `Data bonus presensi berhasil disimpan.${propagationNote}`,
      });
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

      <FloatingSnackbar message={message} />

      {presensiTargetType === 'pekarya' &&
      profile?.role !== 'loyalis_presence_admin' &&
      usesSharedImport ? (
        <Card className="rounded-[20px] border border-indigo-200 bg-indigo-50 p-6">
          <h3 className="font-bold text-indigo-950">Presensi Pekarya memakai data NIPY per pegawai</h3>
          <p className="mt-2 text-sm text-indigo-800">
            Mulai Agustus 2026, pengisian massal jumlah hari dinonaktifkan.
            Kepala SatKer meninjau hari hadir, koreksi, dan peringatan pada halaman
            Presensi Pekarya.
          </p>
          <Link
            href={`/dashboard/payroll/uraian/presensi-pekarya?month=${month}&year=${year}&category=${selectedPekaryaCategory}`}
            className="mt-4 inline-flex min-h-12 items-center rounded-xl bg-indigo-600 px-5 py-3 font-bold text-white hover:bg-indigo-700"
          >
            Buka Presensi Pekarya
          </Link>
        </Card>
      ) : presensiTargetType === 'pekarya' && profile?.role !== 'loyalis_presence_admin' ? (
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

            {usesSharedImport && (
              <div className="space-y-3">
                <div className={`rounded-2xl border p-4 text-sm ${
                  activeImport?.activeRevision
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-amber-200 bg-amber-50 text-amber-900'
                }`}>
                  {activeImport?.activeRevision
                    ? `File presensi bersama aktif: revisi ${activeImport.activeRevision}. Unggahan baru akan membuat revisi pengganti dan tetap menyimpan file lama.`
                    : 'Belum ada file presensi bersama aktif untuk periode ini. Unggah satu XLSX yang memuat Loyalis dan Pekarya.'}
                  {(existingPresence?.sourceImportStale ||
                    existingPresence?.sourceCalendarStale) && (
                    <p className="mt-2 font-bold">
                      Hasil Loyalis lama sudah tidak sesuai dengan revisi import
                      atau kalender aktif. Proses dan simpan ulang sebelum periode
                      ditutup.
                    </p>
                  )}
                </div>
                {importHistory.length > 0 && (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-bold text-slate-700">Riwayat file presensi</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {importHistory.map((revision) => (
                        <div
                          key={revision.id}
                          className={`inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white pl-3 pr-1.5 text-xs font-semibold ${
                            revision.downloadUrl ? 'text-indigo-700' : 'text-slate-500'
                          }`}
                        >
                          {revision.downloadUrl ? (
                            <a href={revision.downloadUrl}>
                              Revisi {revision.revision} · {revision.status}
                            </a>
                          ) : (
                            <span>
                              Revisi {revision.revision} · {revision.status}
                            </span>
                          )}
                          {revision.status === 'writing' && (
                            <button
                              type="button"
                              title="Hapus revisi yang gagal/tidak selesai diaktifkan ini"
                              onClick={() => handleDeleteRevision(revision.id)}
                              disabled={deletingRevisionId === revision.id}
                              className="flex items-center justify-center rounded-lg p-1.5 text-rose-500 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 cursor-pointer"
                            >
                              {deletingRevisionId === revision.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="w-3.5 h-3.5" />
                              )}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

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
                    {usesSharedImport
                      ? 'Pilih & Aktifkan File Presensi Bersama'
                      : 'Pilih File Excel Daily Raw Log'}
                  </Button>
                </div>
              </div>
            )}

            {displayRows && (
              <div className="space-y-4 pt-4 border-t border-slate-100 animate-in fade-in">
                <div className="flex flex-wrap justify-between items-center gap-4 bg-slate-50/70 p-3 rounded-2xl border border-slate-200/70">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                      {uploadedData ? 'Preview Hasil Perhitungan Presensi (Raw Daily Logs)' : 'Data Perhitungan Presensi Tersimpan'}
                    </span>
                    <div className="flex flex-wrap items-center gap-2 mt-0.5">
                      <span className="text-[10px] bg-white text-slate-600 border border-slate-200/80 px-2.5 py-0.5 rounded-full font-semibold shadow-2xs">
                        Target Menit Kerja Kehadiran Penuh: {(activeWorkingDays * expectedHours * 60).toLocaleString('id-ID')} menit
                      </span>
                    </div>
                  </div>

                  {/* Filter Strata & Export Button */}
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-bold text-slate-600">Filter Strata:</span>
                      <div className="inline-flex bg-white p-1 rounded-xl border border-slate-200/80 text-xs font-bold shadow-2xs">
                        {(['all', '1', '2', '3', '4', '5'] as const).map((val) => {
                          const isActive = strataFilter === val;
                          const label = val === 'all' ? 'Semua' : `Strata ${val}`;
                          const count = val === 'all' ? displayRows.length : displayRows.filter(r => Number(r.stratum) === Number(val)).length;
                          return (
                            <button
                              key={val}
                              type="button"
                              onClick={() => setStrataFilter(val)}
                              className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer text-[11px] flex items-center gap-1.5 ${
                                isActive
                                  ? 'bg-indigo-600 text-white shadow-xs font-extrabold'
                                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                              }`}
                            >
                              <span>{label}</span>
                              <span className={`text-[9px] px-1.5 py-0.2 rounded-full font-mono ${
                                isActive ? 'bg-indigo-700 text-indigo-100' : 'bg-slate-100 text-slate-500'
                              }`}>
                                {count}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <Button
                      type="button"
                      onClick={handleExportXlsx}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs h-9 px-3.5 flex items-center gap-1.5 shadow-sm active:scale-95 transition-all cursor-pointer"
                    >
                      <FileSpreadsheet className="w-4 h-4" />
                      <span>Export XLSX</span>
                    </Button>
                  </div>
                </div>

                <div className="flex justify-between items-center px-1">
                  <span className="text-[11px] text-slate-500 font-bold">
                    Menampilkan <strong className="text-indigo-600 font-mono">{filteredDisplayRows?.length || 0}</strong> dari total {displayRows.length} data
                    ({displayRows.filter(r => r.employeeId).length} Terhubung)
                  </span>
                </div>

                <div className="space-y-3.5 pr-1">
                  {filteredDisplayRows && filteredDisplayRows.length === 0 ? (
                    <div className="text-center py-10 bg-slate-50/50 rounded-2xl border-2 border-dashed border-slate-200 space-y-2">
                      <p className="text-xs font-bold text-slate-500">
                        Tidak ada pegawai pada <strong className="text-indigo-600">Strata {strataFilter}</strong>.
                      </p>
                      <button
                        type="button"
                        onClick={() => setStrataFilter('all')}
                        className="text-xs text-indigo-600 font-bold hover:underline cursor-pointer"
                      >
                        Tampilkan Semua Strata
                      </button>
                    </div>
                  ) : (
                    filteredDisplayRows?.map((row, idx) => {
                    const isExpanded = expandedRowIdx === idx;
                    return (
                      <Card
                        key={idx}
                        className={`border-2 rounded-2xl shadow-sm transition-all hover:border-indigo-300 ${isExpanded ? 'ring-4 ring-indigo-50 border-indigo-400 bg-indigo-50/40' : 'border-indigo-200/80 bg-indigo-50/20'
                          } ${activeSearchRowIdx === row.idx ? 'overflow-visible z-30 relative' : 'overflow-hidden'}`}
                      >
                        <div
                          onClick={() => setExpandedRowIdx(isExpanded ? null : idx)}
                          className="p-4 flex flex-wrap lg:flex-nowrap items-center justify-between gap-4 cursor-pointer hover:bg-slate-50/20 transition-colors"
                        >
                          {/* Left: Index & Name */}
                          <div className="flex items-center gap-3 w-full lg:w-[260px] xl:w-[280px] shrink-0 min-w-0">
                            <div className="w-8 h-8 rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-500 font-mono shrink-0">
                              {idx + 1}
                            </div>
                            <div className="space-y-1 min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h4 className="font-bold text-slate-800 text-xs tracking-wide truncate max-w-full" title={row.excelName}>{row.excelName}</h4>
                                {!row.isMatched && row.excelName !== '-' && (
                                  <span className="inline-flex items-center gap-1 text-[9px] font-bold text-rose-600 bg-rose-50 border border-rose-200/80 px-2 py-0.5 rounded-full shrink-0">
                                    <AlertCircle className="w-3 h-3 text-rose-500 shrink-0" />
                                    Belum Terhubung
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5 min-w-0" onClick={(e) => e.stopPropagation()}>
                                {uploadedData &&
                                row.excelName !== '-' &&
                                (!usesSharedImport || !row.isMatched) ? (
                                  activeSearchRowIdx === row.idx ? (
                                    <div className="relative w-full max-w-[240px] z-20">
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
                                      <div className="absolute left-0 right-0 top-8 max-h-48 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-xl z-50 divide-y divide-slate-50">
                                        <div className="p-2 bg-indigo-50/50 border-b border-indigo-100 text-[9px] font-semibold text-indigo-900">
                                          Hubungkan <strong className="font-bold">{row.excelName}</strong> ke:
                                        </div>
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
                                          : 'bg-rose-50 border-rose-200/80 text-rose-700 hover:bg-rose-100/60'
                                        }`}
                                    >
                                      <span className="truncate max-w-[170px]">
                                        {row.isMatched ? row.employeeName : "Hubungkan Pegawai Manual..."}
                                      </span>
                                      <Edit className="w-2.5 h-2.5 opacity-60 shrink-0" />
                                    </button>
                                  )
                                ) : row.isMatched ? (
                                  <div className="flex items-center gap-1 min-w-0 truncate">
                                    <span className="font-bold text-indigo-600 text-[10px] truncate">{row.employeeName}</span>
                                    <span className="text-[9px] text-slate-400 font-mono shrink-0">(ID: {row.employeeId})</span>
                                    {usesSharedImport && row.nipy && (
                                      <span className="text-[9px] text-emerald-600 font-mono shrink-0">
                                        NIPY {row.nipy}
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <span className="inline-flex items-center gap-0.5 text-rose-500 bg-rose-50 border border-rose-100 text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0">
                                    <AlertCircle className="w-2.5 h-2.5" />
                                    {usesSharedImport
                                      ? `NIPY ${row.nipy || 'kosong'} tidak cocok`
                                      : 'Tidak cocok'}
                                  </span>
                                )}
                              </div>

                              {/* Explanation info box for why data hasn't connected */}
                              {!row.isMatched && row.excelName !== '-' && (() => {
                                const reasonInfo = getUnmatchedReason(row.excelName, row.nipy, loyalisEmployees, usesSharedImport);
                                return (
                                  <div className="mt-1.5 text-[10px] bg-rose-50/70 border border-rose-150/80 rounded-lg p-2 space-y-1 text-slate-700 max-w-sm">
                                    <div className="flex items-center gap-1.5 font-bold text-rose-700 text-[10px]">
                                      <Info className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                                      <span>Alasan: {reasonInfo.reason}</span>
                                    </div>
                                    <p className="text-[10px] text-slate-600 leading-normal">
                                      {reasonInfo.detail}
                                    </p>
                                    {reasonInfo.suggestedEmp && uploadedData && (
                                      <div className="flex items-center gap-1.5 pt-0.5">
                                        <span className="text-[9px] font-semibold text-slate-500">Saran:</span>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleLinkEmployee(row.excelName, reasonInfo.suggestedEmp.id);
                                          }}
                                          className="inline-flex items-center gap-1 text-[9px] font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 px-2 py-0.5 rounded-md transition-all cursor-pointer shadow-xs active:scale-95"
                                        >
                                          <CheckCircle2 className="w-3 h-3 text-indigo-600" />
                                          Hubungkan ke "{reasonInfo.suggestedEmp.name}"
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                            </div>
                          </div>

                          {/* Middle: Metrics Grid (Fixed X Positions) */}
                          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-x-2 gap-y-2 flex-1 items-center justify-items-center min-w-0">
                            {/* Hari Aktif */}
                            <div className="flex flex-col text-center w-full">
                              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Hari Aktif</span>
                              <span className="text-xs font-bold text-slate-700 mt-0.5 font-mono">{row.activeDaysCount} hari</span>
                            </div>

                            {/* Punch Tidak Lengkap */}
                            <div className="flex flex-col text-center w-full">
                              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Hari Tidak Lengkap</span>
                              <div className="mt-0.5 font-mono flex justify-center">
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
                            <div className="flex flex-col text-center w-full" onClick={(e) => e.stopPropagation()}>
                              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Total Menit Kerja</span>
                              <div className="mt-0.5 flex justify-center">
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
                            <div className="flex flex-col text-center w-full">
                              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Kekurangan (Menit)</span>
                              <span className="text-xs font-bold text-slate-700 mt-0.5 font-mono">
                                {row.isMatched ? `${row.absenceMinutes} menit` : '-'}
                              </span>
                            </div>

                            {/* Total Upah Presensi */}
                            <div className="flex flex-col text-center w-full">
                              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Total Upah Presensi</span>
                              <span className="text-xs font-bold text-indigo-700 mt-0.5 font-mono">
                                {row.isMatched ? fmtRp(Math.max(0, Math.round(((row.minutes || 0) / 60) * 1650))) : '-'}
                              </span>
                            </div>

                            {/* Bonus Presensi */}
                            <div className="flex flex-col text-center w-full">
                              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Bonus Presensi</span>
                              <span className="text-xs font-bold text-emerald-700 mt-0.5 font-mono">
                                {row.isMatched ? fmtRp(row.netBonus || 0) : '-'}
                              </span>
                            </div>

                            {/* Strata Bonus */}
                            <div className="flex flex-col text-center w-full">
                              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Strata Bonus</span>
                              <div className="mt-0.5 flex justify-center">
                                {row.isMatched ? (
                                  <span className="inline-flex items-center text-[9px] font-bold px-2.5 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200">
                                    Strata {row.stratum || 5}
                                  </span>
                                ) : (
                                  <span className="text-xs text-slate-400 font-semibold">-</span>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Right: Expand Icon */}
                          <div className="flex items-center justify-end shrink-0 pl-1">
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
                                        const isEditable =
                                          !!uploadedData &&
                                          row.excelName !== '-' &&
                                          !usesSharedImport;
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
                                                    <SelectValue>
                                                      {log['Jam kerja'] || 'MASUK'}
                                                    </SelectValue>
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
                                              {isEditable && log['Jam kerja'] !== 'Tidak Hadir' ? (
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
                                              {isEditable && log['Jam kerja'] !== 'Tidak Hadir' ? (
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
                                              {log['Jam kerja'] !== 'Tidak Hadir' && log.duration !== undefined ? `${log.duration} menit` : '-'}
                                            </td>
                                            <td className="px-3 py-2 text-center font-mono font-bold text-indigo-600">
                                              {log['Jam kerja'] !== 'Tidak Hadir' && log.duration !== undefined ? fmtRp(log.duration * 27.5) : '-'}
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
                  }))}
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
