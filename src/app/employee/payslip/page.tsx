"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { auth, db, secondaryDb } from '@/lib/firebase';
import { sendPasswordResetEmail } from 'firebase/auth';
import {
  doc,
  getDoc,
  getDocs,
  collection,
  query,
  where
} from 'firebase/firestore';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Loader2,
  LogOut,
  Download,
  CalendarDays,
  CheckCircle2,
  AlertCircle,
  FileText,
  TrendingUp,
  TrendingDown,
  Coins,
  KeyRound,
  Lock,
  ChevronDown,
  ChevronUp,
  BookOpen,
  MessageCircle,
  ClipboardList,
} from 'lucide-react';
import Link from 'next/link';
import { generatePaySlipPdf, PaySlipField, PaySlipData } from '@/utils/generatePaySlipPdf';
import { MONTHS_ID, REKAP_COLUMNS } from '@/utils/rekapConfig';
import {
  calculateYearsOfService,
  calculateGapok,
  matchFunctionalAllowance,
  normalizeName,
  MANUAL_OVERRIDES
} from '@/utils/payrollLogic';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const formatIDR = (amount: number) => {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

function spell(n: number): string {
  const angka = ["", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan", "sepuluh", "sebelas"];
  let hasil = "";

  if (n < 12) {
    hasil = angka[n];
  } else if (n < 20) {
    hasil = spell(n - 10) + " belas";
  } else if (n < 100) {
    hasil = spell(Math.floor(n / 10)) + " puluh " + spell(n % 10);
  } else if (n < 200) {
    hasil = "seratus " + spell(n - 100);
  } else if (n < 1000) {
    hasil = spell(Math.floor(n / 100)) + " ratus " + spell(n % 100);
  } else if (n < 2000) {
    hasil = "seribu " + spell(n - 1000);
  } else if (n < 1000000) {
    hasil = spell(Math.floor(n / 1000)) + " ribu " + spell(n % 1000);
  } else if (n < 1000000000) {
    hasil = spell(Math.floor(n / 1000000)) + " juta " + spell(n % 1000000);
  } else if (n < 1000000000000) {
    hasil = spell(Math.floor(n / 1000000000)) + " milyar " + spell(n % 1000000000);
  }

  return hasil.replace(/\s+/g, " ").trim();
}

function terbilang(n: number): string {
  const cleaned = spell(n);
  if (!cleaned) return "Nol";
  return cleaned.split(" ").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}



// ─── Component ───────────────────────────────────────────────────────────────

export default function EmployeePayslipPage() {
  const { profile, logout } = useAuth();

  const [resetLoading, setResetLoading] = useState(false);
  const [resetSuccess, setResetSuccess] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);

  // Auto-dismiss password reset notifications
  useEffect(() => {
    if (resetSuccess) {
      const timer = setTimeout(() => setResetSuccess(null), 7000);
      return () => clearTimeout(timer);
    }
  }, [resetSuccess]);

  useEffect(() => {
    if (resetError) {
      const timer = setTimeout(() => setResetError(null), 7000);
      return () => clearTimeout(timer);
    }
  }, [resetError]);

  const handlePasswordReset = async () => {
    if (!profile?.email) return;
    setResetLoading(true);
    setResetSuccess(null);
    setResetError(null);
    try {
      await sendPasswordResetEmail(auth, profile.email);
      setResetSuccess(`Tautan reset password telah berhasil dikirim ke email ${profile.email}. Silakan periksa inbox atau folder spam Anda.`);
    } catch (err: any) {
      console.error("Error sending password reset email:", err);
      setResetError(err.message || "Gagal mengirim email reset password. Silakan hubungi administrator.");
    } finally {
      setResetLoading(false);
    }
  };

  // Period dropdown state (defaults to last month or June 2026 minimum)
  const [month, setMonth] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    const m = d.getMonth() + 1;
    const y = d.getFullYear();
    if (y < 2026 || (y === 2026 && m < 6)) {
      return 6;
    }
    return m;
  });
  const [year, setYear] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    const y = d.getFullYear();
    return Math.max(2026, y);
  });
  const [isDefaultPeriodSet, setIsDefaultPeriodSet] = useState(false);
  const [showDoc, setShowDoc] = useState(false);

  const payrollDocumentation = useMemo(() => [
    {
      id: 'gapok',
      title: 'Gaji Pokok',
      formula: '(Masa Kerja, Ketentuan Internal)',
      bullets: [
        'Ditentukan oleh Masa Kerja dan ketentuan internal lembaga yang berlaku',
        'Masa Kerja dihitung dari tanggal pengakuan masa kerja atau tanggal mulai bekerja',
        'Dicocokkan secara otomatis dengan Matriks Gaji yang berlaku',
      ],
    },
    {
      id: 'keluarga',
      title: 'Tunjangan Keluarga',
      formula: 'Gaji Pokok × % Akumulasi',
      bullets: [
        'Dihitung dari jumlah tanggungan terdaftar, dikalikan dengan Gaji Pokok',
      ],
      table: {
        headers: ['Tanggungan', 'Persentase'],
        rows: [
          ['Suami / Istri', '5%'],
          ['Anak SD', '5%'],
          ['Anak SLTP', '7,5%'],
          ['Anak SLTA', '10%'],
          ['Anak PT', '12,5%'],
        ],
      },
    },
    {
      id: 'fungsional',
      title: 'Tunjangan Fungsional',
      formula: '(Pendidikan, Jabatan Akademik)',
      bullets: [
        'Ditentukan oleh tingkat pendidikan terakhir pegawai',
        'Disesuaikan dengan jenjang jabatan fungsional akademik',
        'Jika jenjang belum ditetapkan → menggunakan nilai dasar',
        'Jika jenjang = 0 → Rp 0',
      ],
    },
    {
      id: 'kepangkatan',
      title: 'Kepangkatan',
      formula: '(Akumulasi Kredit / KUM)',
      bullets: [
        'Berdasarkan total akumulasi angka kredit kepangkatan (KUM)',
        'Nominal dicocokkan dengan Matriks Kepangkatan yang berlaku',
        'Jika angka kredit tidak ditemukan di matriks → Rp 0',
      ],
    },
    {
      id: 'presensi',
      title: 'Presensi & Bonus Presensi',
      formula: 'Menit Maks × Rp 27,5  |  Bonus: Rp 250.000',
      bullets: [
        'Penerimaan = Hari Kerja × Menit Wajib/hari × Rp 27,5 (dikreditkan penuh)',
        'Jumlah Hari Kerja ditentukan berdasarkan jumlah hari kerja aktif riil pada bulan bersangkutan',
        'Jika waktu aktual < waktu target, selisih (delta) dideduksi di Potongan',
        'Potongan Presensi = menit absensi × Rp 27,5',
        'Bonus Presensi Rp 250.000 dikreditkan penuh; dipotong jika ada pelanggaran',
      ],
      table: {
        headers: ['Komponen', 'Penerimaan', 'Potongan'],
        rows: [
          ['Presensi (menit kerja)', 'Menit Maks × Rp 27,5', 'Delta menit × Rp 27,5'],
          ['Bonus Presensi', 'Rp 250.000', 'Sesuai pelanggaran'],
        ],
      },
    },
    {
      id: 'struktural',
      title: 'Struktural',
      formula: 'Jabatan #1 (100%) + Jabatan #2+ (50%)',
      bullets: [
        'Jabatan dengan tunjangan tertinggi dibayar 100%',
        'Jabatan tambahan masing-masing dibayar 50%',
        'Jika tidak memiliki jabatan struktural → Rp 0',
      ],
    },
    {
      id: 'hari_tua_instruksional',
      title: 'T. Hari Tua & Instruksional',
      formula: 'THT: 10% × Gapok  |  Instruksional: Kebijakan Yayasan',
      bullets: [
        'T. Hari Tua = 10% dari Gaji Pokok (subsidi Yayasan)',
        'T. Instruksional = tunjangan khusus berdasarkan kebijakan/kondisi tertentu',
      ],
    },
    {
      id: 'bpjs_beras',
      title: 'T. BPJS & Beras',
      formula: 'Subsidi BPJS + Tunjangan Beras',
      bullets: [
        'T. BPJS TK = subsidi iuran Ketenagakerjaan',
        'T. BPJS KES = subsidi iuran Kesehatan',
        'Beras = tunjangan pangan tetap',
      ],
    },
    {
      id: 'vakasi',
      title: 'Vakasi Tambahan',
      formula: 'Total Honorarium Kegiatan Disetujui',
      bullets: [
        'Akumulasi honorarium kegiatan resmi pada bulan berjalan',
        'Hanya kegiatan yang telah disetujui yang dihitung',
        'Ditampilkan per nama kegiatan beserta nominalnya',
      ],
    },
  ], []);

  // Selectable years: from current year down to 2026
  const availableYears = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const years = [];
    for (let y = currentYear; y >= 2026; y--) {
      years.push(y);
    }
    return years;
  }, []);

  // Selectable months: depends on selected year (limited from June 2026 to maximum current month)
  const availableMonths = useMemo(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    const months = [];
    const startMonth = year === 2026 ? 6 : 1;
    const endMonth = year === currentYear ? currentMonth : 12;

    for (let m = startMonth; m <= endMonth; m++) {
      months.push({
        value: m,
        label: MONTHS_ID[m - 1]
      });
    }
    return months;
  }, [year]);

  // Adjust month if the current selection becomes invalid
  useEffect(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    if (year === 2026 && month < 6) {
      setMonth(6);
    } else if (year === currentYear && month > currentMonth) {
      setMonth(currentMonth);
    }
  }, [year, month]);

  // Fetch default period: last locked payslip, or fallback to last month
  useEffect(() => {
    if (!profile?.linkedEmployeeId) return;
    if (isDefaultPeriodSet) return;

    const determineDefaultPeriod = async (attempt = 1) => {
      try {
        const empId = profile.linkedEmployeeId as string;
        const q = query(
          collection(db, 'PayrollSlipStates'),
          where('employeeId', '==', empId),
          where('status', '==', 'locked')
        );
        const querySnapshot = await getDocs(q);

        let targetYear = 2026;
        let targetMonth = 6;
        let foundLocked = false;

        if (!querySnapshot.empty) {
          let latestPeriodVal = 0;
          querySnapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const period = data.period; // e.g. "2026_06"
            if (period && typeof period === 'string') {
              const parts = period.split('_');
              if (parts.length === 2) {
                const y = parseInt(parts[0], 10);
                const m = parseInt(parts[1], 10);
                const val = y * 12 + m;
                if (val > latestPeriodVal) {
                  latestPeriodVal = val;
                  targetYear = y;
                  targetMonth = m;
                  foundLocked = true;
                }
              }
            }
          });
        }

        if (!foundLocked) {
          const d = new Date();
          d.setMonth(d.getMonth() - 1);
          let fallbackYear = d.getFullYear();
          let fallbackMonth = d.getMonth() + 1;
          if (fallbackYear < 2026 || (fallbackYear === 2026 && fallbackMonth < 6)) {
            fallbackYear = 2026;
            fallbackMonth = 6;
          }
          targetYear = fallbackYear;
          targetMonth = fallbackMonth;
        }

        setYear(targetYear);
        setMonth(targetMonth);
        setIsDefaultPeriodSet(true);
      } catch (err: any) {
        console.error(`Error determining default period (attempt ${attempt}):`, err);
        const isPermissionError = err?.code === 'permission-denied' || err?.message?.toLowerCase().includes('permission');
        if (isPermissionError && attempt < 3) {
          setTimeout(() => determineDefaultPeriod(attempt + 1), 600);
        } else {
          const d = new Date();
          d.setMonth(d.getMonth() - 1);
          let fallbackYear = d.getFullYear();
          let fallbackMonth = d.getMonth() + 1;
          if (fallbackYear < 2026 || (fallbackYear === 2026 && fallbackMonth < 6)) {
            fallbackYear = 2026;
            fallbackMonth = 6;
          }
          setYear(fallbackYear);
          setMonth(fallbackMonth);
          setIsDefaultPeriodSet(true);
        }
      }
    };

    determineDefaultPeriod();
  }, [profile?.linkedEmployeeId, isDefaultPeriodSet]);

  const targetDate = useMemo(() => new Date(year, month - 1, 1), [year, month]);
  const periodText = useMemo(() => `${MONTHS_ID[month - 1]} ${year}`, [month, year]);

  // Format for PayrollSlipStates document ID: YYYY_MM
  const periodKey = useMemo(() => {
    return `${year}_${String(month).padStart(2, '0')}`;
  }, [year, month]);

  // Format for presence and extra collections: YYYY-MM
  const periodToken = useMemo(() => {
    return `${year}-${String(month).padStart(2, '0')}`;
  }, [year, month]);

  // Page data states
  const [employeeData, setEmployeeData] = useState<any | null>(null);
  const [confirmedSlip, setConfirmedSlip] = useState<any | null>(null);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [presenceInfo, setPresenceInfo] = useState<{
    workingDays: number;
    expectedHours: number;
    absenceMinutes: number;
    bonusDeduction: number;
  } | null>(null);
  const [vakasiEvents, setVakasiEvents] = useState<{ eventName: string; payGiven: number }[]>([]);
  const [kepangkatanDesignations, setKepangkatanDesignations] = useState<Record<number, string>>({});

  // Dynamic calculations states
  const [calculatedEarnings, setCalculatedEarnings] = useState<PaySlipField[]>([]);
  const [calculatedDeductions, setCalculatedDeductions] = useState<PaySlipField[]>([]);

  // Load employee data & payslip details
  useEffect(() => {
    if (!profile?.linkedEmployeeId) return;
    if (!isDefaultPeriodSet) return;

    const fetchPayslipData = async (attempt = 1) => {
      try {
        setLoading(true);
        setConfirmedSlip(null);
        setIsConfirmed(false);

        const empId = profile.linkedEmployeeId as string;
        const roleStr = profile?.role as string;
        const isLoyalis = roleStr !== 'honorer' && roleStr !== 'ketua_shift_satpam';

        // 1. Fetch main Employee document
        const empRef = doc(db, isLoyalis ? 'Employees_Loyalis' : 'Employees_BlueCollar', empId);
        const empSnap = await getDoc(empRef);

        if (!empSnap.exists()) {
          console.error(`Employee document not found in ${isLoyalis ? 'Employees_Loyalis' : 'Employees_BlueCollar'}`);
          setEmployeeData(null);
          setLoading(false);
          return;
        }

        const employee = { id: empSnap.id, ...empSnap.data() } as any;
        // Parse metadata properties dynamically matching each collection structure
        if (isLoyalis) {
          employee.joinDate = employee.employment_profile?.date_of_hire?.toDate?.() ||
            (employee.employment_profile?.date_of_hire ? new Date(employee.employment_profile.date_of_hire) :
              (employee.personal_info?.join_date ? new Date(employee.personal_info.join_date) : new Date()));
          employee.dateRecognized = employee.employment_profile?.date_recognized?.toDate?.() ||
            (employee.employment_profile?.date_recognized ? new Date(employee.employment_profile.date_recognized) : undefined);
          employee.gradeLevel = employee.academic_and_tier?.level_code || employee.employment_profile?.grade_level || '';
        } else {
          employee.joinDate = employee.employment?.startDate?.toDate?.() ||
            (employee.employment?.startDate ? new Date(employee.employment.startDate) : new Date());
          employee.dateRecognized = undefined;
          employee.gradeLevel = employee.salaryProfile?.salaryGradeCode || '';
        }

        setEmployeeData(employee);

        // 2. Check for saved slip in PayrollSlipStates (Format: {periodKey}_{linkedEmployeeId})
        const slipDocId = `${periodKey}_${empId}`;
        const slipRef = doc(db, 'PayrollSlipStates', slipDocId);
        const slipSnap = await getDoc(slipRef);

        if (slipSnap.exists()) {
          const slipData = slipSnap.data();
          setConfirmedSlip(slipData);
          setIsConfirmed(slipData.status === 'locked');
          setCalculatedEarnings(slipData.earnings || []);
          setCalculatedDeductions(slipData.deductions || []);

          if (isLoyalis) {
            // Fetch presence info in background/parallel to show in guide
            try {
              const presenceSnap = await getDoc(doc(db, 'LoyalisPresence', periodKey));
              if (presenceSnap.exists()) {
                const pData = presenceSnap.data();
                const empEntry = pData.entries?.[empId];
                setPresenceInfo({
                  workingDays: pData.workingDays || 25,
                  expectedHours: pData.expectedHours || 6.5,
                  absenceMinutes: empEntry?.absenceMinutes || 0,
                  bonusDeduction: empEntry?.deduction || 0
                });
              } else {
                setPresenceInfo({
                  workingDays: 25,
                  expectedHours: 6.5,
                  absenceMinutes: 0,
                  bonusDeduction: 0
                });
              }
            } catch (e) {
              console.error("Error fetching presence info for guide:", e);
              setPresenceInfo({
                workingDays: 25,
                expectedHours: 6.5,
                absenceMinutes: 0,
                bonusDeduction: 0
              });
            }

            // Fetch vakasi events in background/parallel to show in guide
            try {
              const vSnap = await getDocs(collection(db, 'VakasiTambahan'));
              const events: { eventName: string; payGiven: number }[] = [];
              vSnap.docs.forEach(d => {
                const data = d.data();
                if (data.period === periodToken && (!data.status || data.status === 'approved')) {
                  const eventName = data.eventName || '';
                  const worker = data.eventWorkers?.[empId];
                  if (worker && worker.payGiven) {
                    events.push({ eventName, payGiven: worker.payGiven });
                  }
                }
              });
              setVakasiEvents(events);
            } catch (e) {
              console.error("Error fetching vakasi events for guide:", e);
              setVakasiEvents([]);
            }

            // Fetch kepangkatan matrix in background
            try {
              const kepConfigSnap = await getDoc(doc(db, 'SalaryMatrix_Kepangkatan', '_config'));
              const activeKepVersion = kepConfigSnap.exists() ? (kepConfigSnap.data()?.activeVersion || '2026_v1') : '2026_v1';
              const kepSnap = await getDocs(collection(db, 'SalaryMatrix_Kepangkatan', activeKepVersion, 'rows'));
              const designations: Record<number, string> = {};
              kepSnap.docs.forEach(d => {
                const data = d.data();
                const credit = Number(data.credit_score) || 0;
                designations[credit] = data.designation || '';
              });
              setKepangkatanDesignations(designations);
            } catch (e) {
              console.error("Error fetching kepangkatan designations for guide:", e);
              setKepangkatanDesignations({});
            }
          }

          setLoading(false);
          return;
        }

        if (!isLoyalis) {
          // No locked slip for blue collar (honorer) -> calculate draft on the fly in real-time!
          setConfirmedSlip(null);
          setIsConfirmed(false);

          // 1. Fetch approved ActivityReports for this employee & period
          const activityQ = query(
            collection(db, 'ActivityReports'),
            where('employeeId', '==', empId),
            where('period', '==', periodToken),
            where('status', '==', 'approved')
          );
          const reportsSnap = await getDocs(activityQ);
          const reports = reportsSnap.docs.map(d => d.data());

          // 2. Fetch KegiatanSpj events for this period
          let spjEventsTotal = 0;
          try {
            const spjQ = query(
              collection(db, 'KegiatanSpj'),
              where('period', '==', periodToken)
            );
            const spjSnap = await getDocs(spjQ);
            spjSnap.docs.forEach(d => {
              const data = d.data();
              const workerInfo = data.eventWorkers?.[empId];
              if (workerInfo) {
                spjEventsTotal += workerInfo.payGiven || 0;
              }
            });
          } catch (err) {
            console.error('Error fetching KegiatanSpj for draft calculation:', err);
          }

          const jobCategory = employee?.employment?.jobCategory || '';
          const earnings: PaySlipField[] = [];
          const gapok = employee?.salaryProfile?.baseSalaryAmount || 0;

          // Gaji Pokok
          earnings.push({ label: 'Gaji Pokok', amount: gapok });

          if (jobCategory === 'SATPAM') {
            let harianCount = 0;
            let jumatCount = 0;
            let lemburSendiriCount = 0;
            let lemburCoverCount = 0;

            reports.forEach(r => {
              const shiftType = r.shiftType || '';
              if (shiftType === 'Harian') harianCount++;
              else if (shiftType === 'Jumat & Libur') jumatCount++;
              else if (shiftType === 'Lembur Sendiri') lemburSendiriCount++;
              else if (shiftType === 'Lembur Cover') lemburCoverCount++;
            });

            earnings.push({ label: 'Vakasi Harian', amount: harianCount * 12500 });
            earnings.push({ label: 'Jumat & Libur', amount: jumatCount * 25000 });
            earnings.push({ label: 'Lembur Sendiri', amount: lemburSendiriCount * 30000 });
            earnings.push({ label: 'Lembur Cover', amount: lemburCoverCount * 50000 });
            earnings.push({ label: 'Tunjangan Jabatan', amount: roleStr === 'ketua_shift_satpam' ? 100000 : 0 });
          } else {
            // General honorer
            const activityTotal = reports.reduce((sum, r) => sum + (r.fee || 0), 0);
            const totalSpj = spjEventsTotal + activityTotal;

            const columns = REKAP_COLUMNS[jobCategory] || REKAP_COLUMNS.KEBERSIHAN;
            columns.forEach(col => {
              if (col.slipLabel) {
                if (col.key === 'spj') {
                  earnings.push({ label: col.slipLabel, amount: totalSpj });
                } else {
                  earnings.push({ label: col.slipLabel, amount: 0 });
                }
              }
            });
          }

          // BPJS Allowance
          if (employee?.bpjs?.allowanceAmount) {
            earnings.push({ label: 'BPJS (Tunjangan)', amount: Math.round(employee.bpjs.allowanceAmount) });
          }

          // Tunjangan Beras
          earnings.push({ 
            label: 'Tunjangan Beras', 
            amount: employee?.salaryProfile?.tunjanganBeras ?? 0 
          });

          // Deductions (Potongan)
          const deductions: PaySlipField[] = [];
          deductions.push({ label: 'KOPERASI ROCHMAD', amount: employee?.deductions?.koperasiRochmad || 0 });

          const bpjsDeduction = employee?.bpjs?.deductionAmount || 0;
          deductions.push({ label: 'BPJS', amount: bpjsDeduction });

          const thtDeduction = employee?.tht?.deductionAmount || 0;
          deductions.push({ label: 'TABUNGAN HARI TUA BNI SIMPONI', amount: thtDeduction });

          const savingsDeduction = employee?.savings?.deductionAmount || 0;
          deductions.push({ label: 'TABUNGAN', amount: savingsDeduction });

          const zizDeduction = employee?.ziz?.deductionAmount || 0;
          deductions.push({ label: 'ZAKAT INFAQ SODAQOH', amount: zizDeduction });
          deductions.push({ label: 'REVISI GAJI', amount: 0 });

          const pinluDeduction = employee?.pinlu?.deductionAmount || 0;
          deductions.push({ label: 'PINLU/TAGIHAN', amount: pinluDeduction });

          // Placeholder / default values for non-matrix elements
          deductions.push({ label: 'PINJAMAN KOP. UNIPDU', amount: 0 });
          deductions.push({ label: 'POTONGAN PRESENSI', amount: 0 });
          deductions.push({ label: 'POTONGAN BONUS PRESENSI', amount: 0 });
          deductions.push({ label: 'IURAN WAJIB KOP. UNIPDU', amount: 0 });

          setCalculatedEarnings(earnings);
          setCalculatedDeductions(deductions);
          setLoading(false);
          return;
        }

        // 3. Fallback: Dynamic calculation of draft payslip in real-time (Only for Loyalis)
        // Fetch active Salary Matrix configs in parallel
        // Fetch active Salary Matrix configs in parallel
        const [
          matrixWhiteConfigSnap,
          fConfigSnap,
          kepConfigSnap,
          presenceSnap,
          vakasiSnap,
          loanSnapshot,
          userSnapshot
        ] = await Promise.all([
          getDoc(doc(db, 'SalaryMatrix_WhiteCollar', '_config')),
          getDoc(doc(db, 'SalaryMatrix_Functional', '_config')),
          getDoc(doc(db, 'SalaryMatrix_Kepangkatan', '_config')),
          getDoc(doc(db, 'LoyalisPresence', periodKey)),
          getDocs(collection(db, 'VakasiTambahan')),
          getDocs(collection(secondaryDb, 'simpanPinjam')),
          getDocs(collection(secondaryDb, 'users'))
        ]);

        // Resolve active matrix versions
        const activeWhiteVersion = matrixWhiteConfigSnap.exists() ? (matrixWhiteConfigSnap.data()?.activeVersion || '2026_v1') : '2026_v1';
        const activeFunctionalVersion = fConfigSnap.exists() ? (fConfigSnap.data()?.activeVersion || '2026_v1') : '2026_v1';
        const activeKepVersion = kepConfigSnap.exists() ? (kepConfigSnap.data()?.activeVersion || '2026_v1') : '2026_v1';

        // Load active versions rows
        const [matrixWhiteSnap, fSnap, kepSnap] = await Promise.all([
          getDocs(collection(db, 'SalaryMatrix_WhiteCollar', activeWhiteVersion, 'rows')),
          getDocs(collection(db, 'SalaryMatrix_Functional', activeFunctionalVersion, 'rows')),
          getDocs(collection(db, 'SalaryMatrix_Kepangkatan', activeKepVersion, 'rows'))
        ]);

        // Process White Matrix
        const matrixWhite: any = {};
        matrixWhiteSnap.docs.forEach(d => {
          const data = d.data();
          const tahun = data.tahun;
          const salaries = data.salaries || {};
          Object.entries(salaries).forEach(([grade, amount]) => {
            if (!matrixWhite[grade]) matrixWhite[grade] = {};
            matrixWhite[grade][tahun] = amount as number;
          });
        });

        // Process Functional Matrix
        const fMatrix: Record<string, { base_value: number; functional_tiers: Record<string, number> }> = {};
        fSnap.docs.forEach(fDoc => {
          const data = fDoc.data();
          fMatrix[fDoc.id] = {
            base_value: data.base_value || 0,
            functional_tiers: data.functional_tiers || {},
          };
        });

        // Process Kepangkatan Matrix
        const kepMatrix: Record<number, number> = {};
        kepSnap.docs.forEach(d => {
          const data = d.data();
          const credit = Number(data.credit_score) || 0;
          const allowance = Number(data.allowance) || 0;
          kepMatrix[credit] = allowance;
        });

        const designations: Record<number, string> = {};
        kepSnap.docs.forEach(d => {
          const data = d.data();
          const credit = Number(data.credit_score) || 0;
          designations[credit] = data.designation || '';
        });
        setKepangkatanDesignations(designations);

        // Calculate Gaji Pokok (Gapok)
        const gapok = calculateGapok(employee, matrixWhite, targetDate);

        // Calculate Tunjangan Fungsional
        const edLevel = employee.academic_and_tier?.education_level;
        const fTier = employee.academic_and_tier?.functional_tier;
        const tunjFungsional = matchFunctionalAllowance(edLevel, fTier, fMatrix);

        // Calculate Tunjangan Kepangkatan dynamically
        const credit = Number(employee.kepangkatan?.cummulativeCredit) || 0;
        const tunjKepangkatan = kepMatrix[credit] || 0;

        // Calculate presence-based values
        let presenceBonus = 0;
        let presenceDeduction = 0;
        let presensiEarning = 0;
        let presensiDeduction = 0;

        // 1. Resolve working days and expected hours (default to 25 / 6.5)
        let workingDays = 25;
        let expectedHours = 6.5;
        if (presenceSnap.exists()) {
          const pData = presenceSnap.data();
          if (pData.workingDays) workingDays = pData.workingDays;
          if (pData.expectedHours) expectedHours = pData.expectedHours;
        }

        // 2. Default to maximum possible earnings
        presenceBonus = 250000;
        presensiEarning = Math.round(workingDays * expectedHours * 1650);
        presenceDeduction = 0;
        presensiDeduction = 0;

        // 3. Apply actual Excel attendance results if they are uploaded and entries exist
        if (presenceSnap.exists()) {
          const pData = presenceSnap.data();
          if (pData.entries && Object.keys(pData.entries).length > 0) {
            const empEntry = pData.entries[empId];
            if (empEntry) {
              presenceDeduction = empEntry.deduction || 0;
              const absenceMinutes = empEntry.absenceMinutes || 0;
              presensiDeduction = Math.round((absenceMinutes / 60) * 1650);
            }
          }
        }

        const draftAbsenceMinutes = presenceSnap.exists() && presenceSnap.data()?.entries?.[empId] ? (presenceSnap.data().entries[empId].absenceMinutes || 0) : 0;
        const draftBonusDeduction = presenceSnap.exists() && presenceSnap.data()?.entries?.[empId] ? (presenceSnap.data().entries[empId].deduction || 0) : 0;
        setPresenceInfo({
          workingDays,
          expectedHours,
          absenceMinutes: draftAbsenceMinutes,
          bonusDeduction: draftBonusDeduction
        });

        // Calculate Vakasi Tambahan
        let vakasiTambahanSum = 0;
        const vakasiEventsList: { eventName: string; payGiven: number }[] = [];
        vakasiSnap.docs.forEach(d => {
          const data = d.data();
          if (data.period === periodToken && (!data.status || data.status === 'approved')) {
            const eventName = data.eventName || '';
            const worker = data.eventWorkers?.[empId];
            if (worker && worker.payGiven) {
              vakasiTambahanSum += worker.payGiven;
              vakasiEventsList.push({
                eventName,
                payGiven: worker.payGiven
              });
            }
          }
        });

        setVakasiEvents(vakasiEventsList);

        // Koperasi loan deduction
        const empName = employee.personal_info?.name || employee.name || '';
        let koperasiDeduction = 0;
        const [yStr, mStr] = periodKey.split('_');
        const targetYear = parseInt(yStr, 10) || new Date().getFullYear();
        const targetMonth = parseInt(mStr, 10) || (new Date().getMonth() + 1);

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
          const isUidMatch = employee.koperasiAuthUid && employee.koperasiAuthUid === loan.userId;
          const isNameMatch = empName && normalizeName(spName) === normalizeName(empName);
          const isOverrideMatch = empName && MANUAL_OVERRIDES[spName.trim()] === empName;

          if (isUidMatch || isNameMatch || isOverrideMatch) {
            const cicilan = Math.round(loan.jumlahPinjaman / loan.tenor);
            koperasiDeduction += cicilan;
          }
        });

        // Koperasi Simpanan Wajib
        let koperasiSaving = 0;
        userSnapshot.docs.forEach(userDoc => {
          const uData = userDoc.data();
          const uName = uData.nama || '';
          const uUid = uData.uid || userDoc.id;

          const isUidMatch = (employee.koperasiUserId && employee.koperasiUserId === userDoc.id) || (employee.koperasiAuthUid && employee.koperasiAuthUid === uUid);
          const isNameMatch = empName && normalizeName(uName) === normalizeName(empName);
          const isOverrideMatch = empName && MANUAL_OVERRIDES[uName.trim()] === empName;

          if (isUidMatch || isNameMatch || isOverrideMatch) {
            const isApproved = uData.status === 'approved' || uData.membershipStatus === 'approved';
            if (!isApproved) return;

            const isYayasanSubsidy = uData.paymentStatus === 'Yayasan Subsidy';
            koperasiSaving = isYayasanSubsidy ? 0 : 25000;
          }
        });

        // Build Earnings (Penerimaan) list
        const earnings: PaySlipField[] = [];
        earnings.push({ label: 'Gaji Pokok', amount: gapok });

        // Tunjangan Keluarga formula
        const famMetrics = employee.family_allowance_metrics;
        let spouseCount = 0, sd = 0, sltp = 0, slta = 0, pt = 0;
        if (famMetrics) {
          spouseCount = Number(famMetrics.spouse_count) || 0;
          sd = Number(famMetrics.children_sd) || 0;
          sltp = Number(famMetrics.children_sltp) || 0;
          slta = Number(famMetrics.children_slta) || 0;
          pt = Number(famMetrics.children_pt) || 0;
        }
        const familyPct = (spouseCount * 0.05) + (sd * 0.05) + (sltp * 0.075) + (slta * 0.1) + (pt * 0.125);
        const tunjKeluarga = Math.round(gapok * familyPct);
        earnings.push({ label: 'T. Keluarga', amount: tunjKeluarga });
        earnings.push({ label: 'T. Fungsional', amount: tunjFungsional });

        earnings.push({ label: 'Kepangkatan', amount: tunjKepangkatan });

        const tInstruksional = employee.t_instruksional || 0;
        earnings.push({ label: 'T. Instruksional', amount: tInstruksional });
        earnings.push({ label: 'T. Hari Tua', amount: Math.round(gapok * 0.1) });

        const bpjsTk = employee.bpjs?.t_bpjs_tk || 0;
        earnings.push({ label: 'T. BPJS TK', amount: bpjsTk });

        const bpjsKes = employee.bpjs?.t_bpjs_kes || 0;
        earnings.push({ label: 'T. BPJS KES', amount: bpjsKes });

        const tunjBeras = employee.salaryProfile?.tunjanganBeras || 0;
        earnings.push({ label: 'BERAS', amount: tunjBeras });

        earnings.push({ label: 'PRESENSI', amount: presensiEarning });
        earnings.push({ label: 'BONUS PRESENSI', amount: presenceBonus });
        earnings.push({ label: 'PIKET', amount: 0 });
        earnings.push({ label: 'LEMBUR', amount: 0 });

        // Struktural
        const positions = employee.employment_profile?.structural_positions || [];
        if (positions.length > 0) {
          const sortedPos = [...positions].sort((a: any, b: any) => (Number(b.allowance) || 0) - (Number(a.allowance) || 0));
          sortedPos.forEach((pos, idx) => {
            const amt = Number(pos.allowance) || 0;
            if (idx === 0) {
              earnings.push({ label: `STRUKTURAL: ${pos.name}`, amount: amt });
            } else {
              const adjustedAmt = Math.round(amt / 2);
              earnings.push({
                label: `STRUKTURAL: ${pos.name} (50% dari Rp ${amt.toLocaleString('id-ID')})`,
                amount: adjustedAmt,
              });
            }
          });
        } else {
          const structuralRole = employee.employment_profile?.department_unit || employee.employment_profile?.job_role || 'Staf';
          earnings.push({ label: `STRUKTURAL: ${structuralRole}`, amount: 0 });
        }

        // Vakasi Tambahan
        if (vakasiEventsList.length > 0) {
          vakasiEventsList.forEach(item => {
            earnings.push({ label: item.eventName, amount: item.payGiven });
          });
        } else if (vakasiTambahanSum > 0) {
          earnings.push({ label: 'Vakasi Tambahan', amount: vakasiTambahanSum });
        }

        // Build Deductions (Potongan) list
        const deductions: PaySlipField[] = [];
        deductions.push({ label: 'KOPERASI ROCHMAD', amount: employee.deductions?.koperasiRochmad || 0 });

        const bpjsDeduction = employee.bpjs?.deductionAmount || 0;
        deductions.push({ label: 'BPJS', amount: bpjsDeduction });

        const thtDeduction = employee.tht?.deductionAmount || 0;
        deductions.push({ label: 'TABUNGAN HARI TUA BNI SIMPONI', amount: thtDeduction });

        const savingsDeduction = employee.savings?.deductionAmount || 0;
        deductions.push({ label: 'TABUNGAN', amount: savingsDeduction });

        const zizDeduction = employee.ziz?.deductionAmount || 0;
        deductions.push({ label: 'ZAKAT INFAQ SODAQOH', amount: zizDeduction });
        deductions.push({ label: 'REVISI GAJI', amount: 0 });

        const pinluDeduction = employee.pinlu?.deductionAmount || 0;
        deductions.push({ label: 'PINLU/TAGIHAN', amount: pinluDeduction });
        deductions.push({ label: 'PINJAMAN KOP. UNIPDU', amount: koperasiDeduction });
        deductions.push({ label: 'POTONGAN PRESENSI', amount: presensiDeduction });
        deductions.push({ label: 'POTONGAN BONUS PRESENSI', amount: presenceDeduction });
        deductions.push({ label: 'IURAN WAJIB KOP. UNIPDU', amount: koperasiSaving });

        setCalculatedEarnings(earnings);
        setCalculatedDeductions(deductions);
        setLoading(false);
      } catch (err: any) {
        console.error(`Error fetching/calculating payslip data (attempt ${attempt}):`, err);
        const isPermissionError = err?.code === 'permission-denied' || err?.message?.toLowerCase().includes('permission');
        if (isPermissionError && attempt < 3) {
          setTimeout(() => fetchPayslipData(attempt + 1), 600);
        } else {
          setLoading(false);
        }
      }
    };

    fetchPayslipData();
  }, [profile?.linkedEmployeeId, periodKey, periodToken, isDefaultPeriodSet]);

  // Compiled earnings & deductions based on finalized status
  const earnings = useMemo(() => {
    return confirmedSlip?.earnings && confirmedSlip.earnings.length > 0 ? confirmedSlip.earnings : calculatedEarnings;
  }, [confirmedSlip, calculatedEarnings]);

  const deductions = useMemo(() => {
    return confirmedSlip?.deductions && confirmedSlip.deductions.length > 0 ? confirmedSlip.deductions : calculatedDeductions;
  }, [confirmedSlip, calculatedDeductions]);

  // Totals calculations
  const totalEarnings = useMemo(() => earnings.reduce((sum: number, e: PaySlipField) => sum + e.amount, 0), [earnings]);
  const totalDeductions = useMemo(() => deductions.reduce((sum: number, d: PaySlipField) => sum + d.amount, 0), [deductions]);
  const netSalary = useMemo(() => totalEarnings - totalDeductions, [totalEarnings, totalDeductions]);

  const userVariables = useMemo(() => {
    if (!employeeData) return null;

    const baseDate = employeeData.dateRecognized || employeeData.joinDate;
    const years = baseDate ? calculateYearsOfService(baseDate, targetDate) : 0;

    const famMetrics = employeeData.family_allowance_metrics;
    const spouseCount = Number(famMetrics?.spouse_count) || 0;
    const sd = Number(famMetrics?.children_sd) || 0;
    const sltp = Number(famMetrics?.children_sltp) || 0;
    const slta = Number(famMetrics?.children_slta) || 0;
    const pt = Number(famMetrics?.children_pt) || 0;
    const familyPct = (spouseCount * 0.05) + (sd * 0.05) + (sltp * 0.075) + (slta * 0.1) + (pt * 0.125);

    const positions = employeeData.employment_profile?.structural_positions || [];

    const gapokVal = earnings.find((e: PaySlipField) => e.label.toUpperCase() === 'GAJI POKOK')?.amount || 0;
    const tunjKeluargaVal = earnings.find((e: PaySlipField) => e.label.toUpperCase() === 'T. KELUARGA' || e.label.toUpperCase() === 'TUNJANGAN KELUARGA')?.amount || 0;
    const tunjFungsionalVal = earnings.find((e: PaySlipField) => e.label.toUpperCase() === 'T. FUNGSIONAL' || e.label.toUpperCase() === 'TUNJANGAN FUNGSIONAL')?.amount || 0;
    const tunjKepangkatanVal = earnings.find((e: PaySlipField) => e.label.toUpperCase() === 'KEPANGKATAN')?.amount || 0;
    const presensiEarningVal = earnings.find((e: PaySlipField) => e.label.toUpperCase() === 'PRESENSI')?.amount || 0;
    const bonusPresensiVal = earnings.find((e: PaySlipField) => e.label.toUpperCase() === 'BONUS PRESENSI')?.amount || 0;
    const tunjInstruksionalVal = earnings.find((e: PaySlipField) => e.label.toUpperCase() === 'T. INSTRUKSIONAL' || e.label.toUpperCase() === 'INSTRUKSIONAL')?.amount || 0;
    const tunjHariTuaVal = earnings.find((e: PaySlipField) => e.label.toUpperCase() === 'T. HARI TUA' || e.label.toUpperCase() === 'TUNJANGAN HARI TUA')?.amount || 0;
    const bpjsTkVal = earnings.find((e: PaySlipField) => e.label.toUpperCase() === 'T. BPJS TK' || e.label.toUpperCase() === 'BPJS TK')?.amount || 0;
    const bpjsKesVal = earnings.find((e: PaySlipField) => e.label.toUpperCase() === 'T. BPJS KES' || e.label.toUpperCase() === 'BPJS KES')?.amount || 0;
    const berasVal = earnings.find((e: PaySlipField) => e.label.toUpperCase() === 'BERAS')?.amount || 0;
    const totalStrukturalVal = earnings
      .filter((e: PaySlipField) => e.label.toUpperCase().startsWith('STRUKTURAL:'))
      .reduce((sum: number, e: PaySlipField) => sum + e.amount, 0);

    const potonganPresensiVal = deductions.find((d: PaySlipField) => d.label.toUpperCase() === 'POTONGAN PRESENSI')?.amount || 0;
    const potonganBonusPresensiVal = deductions.find((d: PaySlipField) => d.label.toUpperCase() === 'POTONGAN BONUS PRESENSI')?.amount || 0;

    const userCreditScore = Number(employeeData.kepangkatan?.cummulativeCredit) || 0;
    const kepangkatanDesignation = kepangkatanDesignations[userCreditScore] || 'Tidak Ditemukan';

    return {
      years,
      baseDate,
      spouseCount,
      sd,
      sltp,
      slta,
      pt,
      familyPct,
      positions,
      gapokVal,
      tunjKeluargaVal,
      tunjFungsionalVal,
      tunjKepangkatanVal,
      presensiEarningVal,
      bonusPresensiVal,
      tunjInstruksionalVal,
      tunjHariTuaVal,
      bpjsTkVal,
      bpjsKesVal,
      berasVal,
      totalStrukturalVal,
      potonganPresensiVal,
      potonganBonusPresensiVal,
      userCreditScore,
      kepangkationDesignation: kepangkatanDesignation
    };
  }, [employeeData, targetDate, earnings, deductions, kepangkatanDesignations]);

  const DocRow = ({ label, value, highlight }: { label: string; value: React.ReactNode; highlight?: boolean }) => {
    return (
      <>
        <div className={`pr-4 font-semibold text-xs sm:text-sm ${highlight ? 'text-indigo-600 font-bold' : 'text-slate-500'}`}>
          {label}
        </div>
        <div className="text-center text-indigo-600 font-bold text-xs sm:text-sm">:</div>
        <div className={`pl-2 text-xs sm:text-sm ${highlight ? 'text-emerald-600 font-extrabold' : 'text-slate-800 font-bold'}`}>
          {value}
        </div>
      </>
    );
  };

  // Client-side PDF trigger
  const handleDownloadPdf = () => {
    if (!employeeData || !isConfirmed) return;
    const isLoyalis = profile?.role !== 'honorer';
    const slipData: PaySlipData = {
      employeeName: employeeData.personal_info?.name || profile?.displayName || 'Karyawan',
      employeeNo: 1, // Placeholder
      period: periodText,
      jobCategory: isLoyalis ? `STAF ${employeeData.employment_profile?.department_unit || 'STAF'}` : (employeeData.employment?.jobCategory || 'PEKARYA'),
      earnings: earnings,
      deductions: deductions,
      isLoyalis: isLoyalis,
      niy: employeeData.personal_info?.employee_id_niy || '',
      npwp: employeeData.personal_info?.tax_id_npwp || '',
      familyMetrics: employeeData.family_allowance_metrics,
      gradeLevel: employeeData.gradeLevel,
      yearsOfService: userVariables?.years,
      baseDate: userVariables?.baseDate,
      educationLevel: employeeData.academic_and_tier?.education_level,
      functionalTier: employeeData.academic_and_tier?.functional_tier,
      cummulativeCredit: employeeData.kepangkatan?.cummulativeCredit,
      designation: userVariables?.kepangkationDesignation,
      presenceInfo: presenceInfo,
      vakasiEvents: vakasiEvents
    };

    generatePaySlipPdf(slipData, true);
  };

  const whatsappUrl = useMemo(() => {
    if (!employeeData) return '#';
    const empName = employeeData.personal_info?.name || profile?.displayName || 'Karyawan';
    const text = `Yth. Admin Badan Administrasi Keuangan\n\nAssalamualaikum wr. wb., saya ${empName}`;
    return `https://wa.me/6281331862933?text=${encodeURIComponent(text)}`;
  }, [employeeData, profile?.displayName]);

  // ── Rendering states ──

  if (!profile) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/80 to-slate-100 flex items-center justify-center relative overflow-hidden">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin relative z-10" />
      </div>
    );
  }

  // Error: Account not linked
  if (!profile.linkedEmployeeId) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/80 to-slate-100 flex items-center justify-center p-6 relative overflow-hidden">
        {/* Decorative blobs */}
        <div className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full bg-indigo-100/40 blur-[120px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] rounded-full bg-purple-100/30 blur-[100px] pointer-events-none" />
        <Card className="max-w-md w-full rounded-3xl border-none shadow-xl bg-white relative z-10 animate-in zoom-in-95 duration-200">
          <CardContent className="p-8 text-center space-y-4">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-rose-50 flex items-center justify-center">
              <AlertCircle className="w-8 h-8 text-rose-500" />
            </div>
            <h2 className="text-xl font-bold text-slate-900">Akun Belum Dihubungkan</h2>
            <p className="text-sm text-slate-500 leading-relaxed">
              Akun Loyalis Anda belum dihubungkan dengan data pegawai di sistem. Silakan hubungi administrator BAK untuk menghubungkan akun Anda.
            </p>
            <Button
              onClick={() => logout()}
              variant="outline"
              className="rounded-xl mt-4"
            >
              <LogOut className="w-4 h-4 mr-2" />
              Keluar
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/80 to-slate-100 font-sans selection:bg-indigo-100 relative overflow-hidden text-slate-800 pb-16">
      {/* Decorative background blobs */}
      <div className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full bg-indigo-100/40 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] rounded-full bg-purple-100/30 blur-[100px] pointer-events-none" />

      {/* ── Header Navbar ──────────────────────────────────────────────── */}
      <div className="sticky top-0 z-30 bg-white/80 backdrop-blur-xl border-b border-slate-100 shadow-sm relative z-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5 sm:gap-3">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-400 flex items-center justify-center shadow-lg shadow-indigo-200 shrink-0">
              <FileText className="w-4.5 h-4.5 sm:w-5 sm:h-5 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm sm:text-base font-bold text-slate-900 leading-tight truncate">Slip Gaji</h1>
              <p className="text-[10px] sm:text-xs text-slate-400 font-semibold truncate max-w-[120px] sm:max-w-none">{profile.displayName || 'Karyawan'}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {(profile.role === 'honorer' || (profile.role as string) === 'ketua_shift_satpam') && (
              <Link href="/employee/activities">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-slate-600 hover:text-indigo-650 hover:bg-slate-50 border-slate-200 bg-white rounded-xl h-8.5 sm:h-9 px-2.5 sm:px-3.5 flex items-center gap-1.5 font-semibold text-[10px] sm:text-xs shadow-sm cursor-pointer"
                  title="Kembali ke Laporan Kegiatan"
                >
                  <ClipboardList className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-indigo-500" />
                  <span className="hidden sm:inline">Laporan Kegiatan</span>
                </Button>
              </Link>
            )}

            {profile.role === 'loyalis' && (
              <Link href="/employee/presensi-correction">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-slate-600 hover:text-indigo-650 hover:bg-slate-50 border-slate-200 bg-white rounded-xl h-8.5 sm:h-9 px-2.5 sm:px-3.5 flex items-center gap-1.5 font-semibold text-[10px] sm:text-xs shadow-sm cursor-pointer"
                  title="Ajukan Koreksi Presensi"
                >
                  <MessageCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-indigo-500" />
                  <span className="hidden sm:inline">Koreksi Presensi</span>
                </Button>
              </Link>
            )}

            <Button
              onClick={handlePasswordReset}
              disabled={resetLoading}
              variant="outline"
              size="sm"
              className="text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 border-indigo-200 bg-indigo-50/30 rounded-xl h-8.5 sm:h-9 px-2.5 sm:px-3.5 flex items-center gap-1.5 font-semibold text-xs sm:text-sm"
              title="Ubah Password"
            >
              {resetLoading ? (
                <Loader2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 animate-spin" />
              ) : (
                <KeyRound className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              )}
              <span className="hidden sm:inline">Ubah Password</span>
            </Button>

            <Button
              onClick={() => logout()}
              variant="ghost"
              size="sm"
              className="text-slate-400 hover:text-rose-500 rounded-xl h-8.5 sm:h-9 px-2.5 sm:px-3.5 border border-slate-150/40 bg-white shadow-sm flex items-center gap-1.5 font-semibold text-xs sm:text-sm"
              title="Keluar"
            >
              <LogOut className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span className="hidden sm:inline">Keluar</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Floating Action Notifications */}
      {resetSuccess && (
        <div className="fixed bottom-6 right-6 z-50 max-w-md bg-emerald-50 border border-emerald-200 text-emerald-800 p-4 rounded-2xl shadow-xl flex items-start gap-3 animate-in fade-in slide-in-from-bottom-5">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <div className="font-bold text-sm">Email Terkirim</div>
            <div className="text-xs text-emerald-700 mt-0.5">{resetSuccess}</div>
          </div>
        </div>
      )}

      {resetError && (
        <div className="fixed bottom-6 right-6 z-50 max-w-md bg-rose-50 border border-rose-200 text-rose-800 p-4 rounded-2xl shadow-xl flex items-start gap-3 animate-in fade-in slide-in-from-bottom-5">
          <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div>
            <div className="font-bold text-sm">Gagal Mengirim Email</div>
            <div className="text-xs text-rose-700 mt-0.5">{resetError}</div>
          </div>
        </div>
      )}

      <div className="max-w-3xl mx-auto px-4 sm:px-6 mt-8 space-y-6 relative z-10">

        {/* ── Period Selector Control ────────────────────────────────────── */}
        <Card className="bg-white/80 backdrop-blur-md rounded-3xl shadow-[0_4px_25px_rgba(0,0,0,0.02)] border-none">
          <CardContent className="p-5 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3 w-full md:w-auto">
              <CalendarDays className="w-5 h-5 text-indigo-500 shrink-0" />
              <span className="text-sm font-semibold text-slate-500">Periode:</span>
            </div>
            <div className="grid grid-cols-2 gap-3 w-full md:flex md:w-auto md:items-center">
              <Select value={String(month)} onValueChange={(v) => v && setMonth(parseInt(v))}>
                <SelectTrigger className="text-sm font-bold text-slate-700 bg-white rounded-2xl border border-slate-200 h-11 px-4 w-full md:w-40 shadow-sm focus:ring-indigo-500/20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-2xl border-slate-100 shadow-2xl bg-white z-40">
                  {availableMonths.map((m) => (
                    <SelectItem key={m.value} value={String(m.value)}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={String(year)} onValueChange={(v) => v && setYear(parseInt(v))}>
                <SelectTrigger className="text-sm font-bold text-slate-700 bg-white rounded-2xl border border-slate-200 h-11 px-4 w-full md:w-28 shadow-sm focus:ring-indigo-500/20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-2xl border-slate-100 shadow-2xl bg-white z-40">
                  {availableYears.map(y => (
                    <SelectItem key={y} value={String(y)}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* ── Loading Spinner ── */}
        {loading ? (
          <div className="py-24 flex flex-col items-center justify-center text-slate-400">
            <Loader2 className="w-10 h-10 animate-spin text-indigo-500 mb-4" />
            <p className="text-sm font-semibold animate-pulse">Memuat rincian slip gaji...</p>
          </div>
        ) : !employeeData ? (
          <Card className="bg-white rounded-3xl border-none shadow-sm">
            <CardContent className="py-16 text-center text-slate-400">
              <AlertCircle className="w-12 h-12 text-rose-500 mx-auto mb-4" />
              <p className="text-sm font-semibold">Data karyawan gagal dimuat.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">

            {/* ─── FLOATING PAYSLIP DESIGN ─────────────────────────────────── */}
            <Card className="bg-white rounded-[32px] shadow-[0_15px_50px_rgba(0,0,0,0.06)] border-none overflow-hidden relative">

              {/* Kop Surat Header */}
              <div className="p-6 md:p-8 bg-gradient-to-r from-slate-50/80 via-indigo-50/20 to-slate-50/80 border-b border-slate-100 flex flex-col items-center text-center relative">

                {/* Floating Status Badge */}
                <div className="md:absolute top-6 right-6 mb-4 md:mb-0">
                  {isConfirmed ? (
                    <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold rounded-xl px-3 py-1 shadow-none flex items-center gap-1.5 hover:bg-emerald-50">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      TERKUNCI / FINAL
                    </Badge>
                  ) : (
                    <Badge className="bg-amber-50 text-amber-700 border border-amber-200 text-xs font-bold rounded-xl px-3 py-1 shadow-none flex items-center gap-1.5 hover:bg-amber-50 animate-pulse">
                      <AlertCircle className="w-3.5 h-3.5" />
                      DRAFT (Belum Dikunci)
                    </Badge>
                  )}
                </div>

                <div className="flex gap-4 items-center justify-center filter drop-shadow-sm mb-4 mt-2">
                  <img
                    src="/Logo YAPETIDU (Transparent bg).png"
                    alt="Logo YAPETIDU"
                    className="h-14 w-auto object-contain shrink-0"
                  />
                  <div className="w-px h-8 bg-slate-200" />
                  <img
                    src="/Logo UNIPDU.png"
                    alt="Logo UNIPDU"
                    className="h-14 w-auto object-contain shrink-0"
                  />
                </div>

                <h3 className="text-xs font-bold text-slate-800 tracking-wider uppercase">YAYASAN PESANTREN TINGGI DARUL 'ULUM</h3>
                <h2 className="text-sm font-extrabold text-slate-900 tracking-wide mt-1 uppercase">UNIVERSITAS PESANTREN TINGGI DARUL 'ULUM</h2>
                <p className="text-[10px] text-slate-400 font-medium mt-1">Pondok Pesantren Darul 'Ulum Peterongan Jombang 61481 Telp. (0321) 873655</p>
              </div>

              {/* Payslip Details Section */}
              <div className="px-6 md:px-8 py-6 border-b border-slate-100 bg-[#FCFDFE]">
                <div className="flex flex-col md:flex-row justify-between gap-4">
                  <div className="space-y-1.5">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">NAMA PEGAWAI</span>
                    <span className="text-base font-extrabold text-slate-800 uppercase tracking-tight">
                      {employeeData.personal_info?.name || profile.displayName || '-'}
                    </span>
                    <div className="flex items-center gap-2 mt-0.5 text-xs font-semibold text-slate-500">
                      <span>NIY: {employeeData.personal_info?.employee_id_niy || '-'}</span>
                      <span className="text-slate-350">•</span>
                      <span>NPWP: {employeeData.personal_info?.tax_id_npwp || '-'}</span>
                    </div>
                  </div>

                  <div className="space-y-1.5 md:text-right">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">PERIODE SLIP</span>
                    <span className="text-sm font-bold text-indigo-600 block">{periodText.toUpperCase()}</span>
                    <span className="text-[11px] font-bold bg-indigo-50 text-indigo-700 px-2.5 py-0.5 rounded-full inline-block">
                      STAF {employeeData.employment_profile?.department_unit || 'LOYALIS'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Earnings & Deductions Tables */}
              <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-100">

                {/* Earnings List */}
                <div className="p-6 md:p-8 space-y-4 bg-emerald-50/15">
                  <h4 className="text-xs font-bold text-emerald-700 uppercase tracking-widest flex items-center gap-1.5">
                    <TrendingUp className="w-4 h-4 text-emerald-500" />
                    I. PENERIMAAN
                  </h4>
                  <div className="space-y-2.5 divide-y divide-slate-50">
                    {earnings.map((item: PaySlipField, idx: number) => (
                      <div key={idx} className="flex justify-between items-center pt-2 text-xs font-medium">
                        <span className="text-slate-500 uppercase max-w-[200px] truncate" title={item.label}>
                          {item.label}
                        </span>
                        <span className="text-slate-700 font-semibold tabular-nums">
                          {item.amount > 0 ? formatIDR(item.amount) : '-'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Deductions List */}
                <div className="p-6 md:p-8 space-y-4 bg-rose-50/15">
                  <h4 className="text-xs font-bold text-rose-700 uppercase tracking-widest flex items-center gap-1.5">
                    <TrendingDown className="w-4 h-4 text-rose-500" />
                    II. POTONGAN
                  </h4>
                  <div className="space-y-2.5 divide-y divide-slate-50">
                    {deductions.map((item: PaySlipField, idx: number) => (
                      <div key={idx} className="flex justify-between items-center pt-2 text-xs font-medium">
                        <span className="text-slate-500 uppercase max-w-[200px] truncate" title={item.label}>
                          {item.label}
                        </span>
                        <span className="text-slate-700 font-semibold tabular-nums">
                          {item.amount > 0 ? formatIDR(item.amount) : '-'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

              </div>

              {/* Summary Totals Footer */}
              <div className="grid grid-cols-1 md:grid-cols-2 bg-slate-50/50 border-t border-slate-100">
                <div className="px-6 md:px-8 py-4 flex justify-between items-center text-xs font-bold border-b md:border-b-0 divide-x-0 border-slate-100">
                  <span className="text-emerald-700 uppercase">JUMLAH PENERIMAAN</span>
                  <span className="text-emerald-700 tabular-nums">{formatIDR(totalEarnings)}</span>
                </div>
                <div className="px-6 md:px-8 py-4 flex justify-between items-center text-xs font-bold">
                  <span className="text-rose-700 uppercase">JUMLAH POTONGAN</span>
                  <span className="text-rose-700 tabular-nums">{formatIDR(totalDeductions)}</span>
                </div>
              </div>

              {/* NET SALARY CARD BOX */}
              <div className="p-6 md:p-8 bg-gradient-to-r from-indigo-50/30 via-indigo-50/80 to-purple-50/30 border-t border-b border-indigo-100 flex flex-col md:flex-row items-center justify-between gap-4">
                <div>
                  <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest block">PENERIMAAN BERSIH</span>
                  <span className="text-3xl font-extrabold text-indigo-800 tracking-tight block mt-0.5 tabular-nums">
                    {formatIDR(netSalary)}
                  </span>
                </div>
                <div className="bg-white/80 border border-indigo-100/50 rounded-2xl p-4 shadow-sm max-w-md w-full md:w-auto">
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Terbilang</span>
                  <p className="text-xs font-bold text-slate-600 leading-normal italic">
                    "{terbilang(netSalary)} Rupiah"
                  </p>
                </div>
              </div>

              {/* Documentation Section */}
              {profile?.role === 'loyalis' && (
                <div className="border-t border-slate-100">
                  <div
                    onClick={() => setShowDoc(!showDoc)}
                    className="p-6 md:p-8 flex items-center justify-between cursor-pointer hover:bg-slate-50/80 transition-colors"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center shrink-0">
                        <BookOpen className="w-4.5 h-4.5 text-indigo-500" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Panduan Perhitungan Gaji</h3>
                        <p className="text-xs text-slate-400 font-medium mt-1">Klik untuk {showDoc ? 'menyembunyikan' : 'melihat'} detail formula dan logika perhitungan</p>
                      </div>
                    </div>
                    <div className="shrink-0 text-slate-400">
                      {showDoc ? (
                        <ChevronUp className="w-5 h-5 text-indigo-500" />
                      ) : (
                        <ChevronDown className="w-5 h-5" />
                      )}
                    </div>
                  </div>

                  {showDoc && (
                    <div className="px-6 md:px-8 pb-8 space-y-6 animate-in fade-in slide-in-from-top-2 duration-200">
                      <div className="h-px bg-slate-100" />
                      {payrollDocumentation.map((item, idx) => (
                        <div key={item.id}>
                          {/* Section Header */}
                          <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1 mb-2">
                            <h4 className="text-sm font-bold text-slate-800 tracking-wide">
                              {idx + 1}. {item.title.toUpperCase()}
                            </h4>
                            <span className="text-[11px] font-medium text-slate-400 italic">
                              Formula: {item.formula}
                            </span>
                          </div>

                          {/* Bullet Points */}
                          <ul className="space-y-1 ml-4 pl-0">
                            {item.bullets.map((bullet, bIdx) => (
                              <li key={bIdx} className="flex items-start gap-2 text-xs sm:text-sm text-slate-550 leading-relaxed">
                                <span className="mt-2 w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0" />
                                <span>{bullet}</span>
                              </li>
                            ))}
                          </ul>

                          {/* Optional variables display */}
                          {userVariables && (
                            <div className="mt-3.5 ml-4 bg-[#f8fafc] border border-slate-200/50 rounded-xl p-4.5 max-w-2xl animate-in fade-in duration-200">
                              {item.id === 'gapok' && (
                                <div className="grid grid-cols-[auto_24px_1fr] gap-y-1.5 items-baseline">
                                  <DocRow label="Masa Kerja" value={`${userVariables.years} Tahun`} />
                                  <DocRow label="Tgl Pengakuan" value={userVariables.baseDate ? new Date(userVariables.baseDate).toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' }) : '-'} />
                                  <DocRow label="Gaji Pokok" value={formatIDR(userVariables.gapokVal)} highlight />
                                </div>
                              )}

                              {item.id === 'keluarga' && (
                                <div className="grid grid-cols-[auto_24px_1fr] gap-y-1.5 items-baseline">
                                  <DocRow label="Tanggungan Suami/Istri" value={`${userVariables.spouseCount} orang (${userVariables.spouseCount * 5}%)`} />
                                  <DocRow label="Tanggungan Anak (SD/SLTP/SLTA/PT)" value={`${userVariables.sd}/${userVariables.sltp}/${userVariables.slta}/${userVariables.pt} orang`} />
                                  <DocRow label="Persentase Total" value={`${(userVariables.familyPct * 100).toFixed(1)}%`} />
                                  <DocRow label="Tunjangan Keluarga" value={formatIDR(userVariables.tunjKeluargaVal)} highlight />
                                </div>
                              )}

                              {item.id === 'fungsional' && (
                                <div className="grid grid-cols-[auto_24px_1fr] gap-y-1.5 items-baseline">
                                  <DocRow label="Pendidikan Terakhir" value={employeeData?.academic_and_tier?.education_level || '-'} />
                                  <DocRow label="Jenjang Fungsional" value={employeeData?.academic_and_tier?.functional_tier || 'Belum Ditetapkan'} />
                                  <DocRow label="Tunjangan Fungsional" value={formatIDR(userVariables.tunjFungsionalVal)} highlight />
                                </div>
                              )}

                              {item.id === 'kepangkatan' && (
                                <div className="grid grid-cols-[auto_24px_1fr] gap-y-1.5 items-baseline">
                                  <DocRow label="Akumulasi Kredit (KUM)" value={String(userVariables.userCreditScore)} />
                                  <DocRow label="Jenjang Kepangkatan" value={userVariables.kepangkationDesignation} />
                                  <DocRow label="T. Kepangkatan" value={formatIDR(userVariables.tunjKepangkatanVal)} highlight />
                                </div>
                              )}

                              {item.id === 'presensi' && (
                                <div className="grid grid-cols-[auto_24px_1fr] gap-y-1.5 items-baseline">
                                  {(() => {
                                    const wDays = presenceInfo?.workingDays || 25;
                                    const expHours = presenceInfo?.expectedHours || 6.5;
                                    const targetMinutes = Math.round(wDays * expHours * 60);
                                    const absenceMinutes = presenceInfo?.absenceMinutes || 0;
                                    const actualMinutes = Math.max(0, targetMinutes - absenceMinutes);
                                    const earning = userVariables.presensiEarningVal;
                                    const deduction = userVariables.potonganPresensiVal;
                                    const netPresensi = Math.max(0, earning - deduction);
                                    
                                    const bonusEarning = userVariables.bonusPresensiVal;
                                    const bonusDeduction = userVariables.potonganBonusPresensiVal;
                                    const netBonus = Math.max(0, bonusEarning - bonusDeduction);

                                    let stratum = 5;
                                    let statusText = '';
                                    if (bonusDeduction === 0) {
                                      stratum = 1;
                                      statusText = 'Kekurangan = 0 menit';
                                    } else if (bonusDeduction <= 100000) {
                                      stratum = 2;
                                      statusText = `Kekurangan ≤ ${(wDays * 30).toLocaleString('id-ID')} menit`;
                                    } else if (bonusDeduction <= 150000) {
                                      stratum = 3;
                                      statusText = `Kekurangan ≤ ${(wDays * 35).toLocaleString('id-ID')} menit`;
                                    } else if (bonusDeduction <= 200000) {
                                      stratum = 4;
                                      statusText = `Kekurangan ≤ ${(wDays * 40).toLocaleString('id-ID')} menit`;
                                    } else {
                                      stratum = 5;
                                      statusText = `Kekurangan > ${(wDays * 40).toLocaleString('id-ID')} menit`;
                                    }

                                    return (
                                      <>
                                        <DocRow label="Hari Kerja Aktif" value={`${wDays} hari`} />
                                        <DocRow label="Total Waktu Kerja" value={`${targetMinutes} menit`} />
                                        <DocRow label="Waktu Dikerjakan" value={`${actualMinutes} menit`} />
                                        <DocRow 
                                          label="Bersih Presensi" 
                                          value={formatIDR(netPresensi)} 
                                          highlight 
                                        />
                                        <div 
                                          style={{ gridColumn: '1 / -1' }} 
                                          className="text-[11px] text-slate-500 font-mono font-normal mt-0.5 mb-2 leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-200/50"
                                        >
                                          = ({targetMinutes.toLocaleString('id-ID')} x Rp27,5) - (({targetMinutes.toLocaleString('id-ID')} - {actualMinutes.toLocaleString('id-ID')}) x Rp27,5)
                                          <br />
                                          = {formatIDR(earning).replace(/\s+/g, '')} - ({absenceMinutes.toLocaleString('id-ID')} x Rp27,5)
                                          <br />
                                          = {formatIDR(earning).replace(/\s+/g, '')} - {formatIDR(deduction).replace(/\s+/g, '')}
                                          <br />
                                          = {formatIDR(netPresensi).replace(/\s+/g, '')}
                                        </div>
                                        <DocRow 
                                          label="Bersih Bonus Presensi" 
                                          value={formatIDR(netBonus)} 
                                          highlight 
                                        />
                                        <div 
                                          style={{ gridColumn: '1 / -1' }} 
                                          className="text-[11px] text-slate-500 font-normal mt-0.5 mb-2 leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-200/50"
                                        >
                                          Stratum {stratum} ({statusText})
                                          <br />
                                          = {formatIDR(bonusEarning).replace(/\s+/g, '')} - {formatIDR(bonusDeduction).replace(/\s+/g, '')}
                                          <div className="block text-[10px] text-slate-400 mt-2 leading-normal font-light border-t border-slate-200/60 pt-2">
                                            <strong>Ketentuan Bonus Presensi:</strong>
                                            <br />
                                            • Stratum 1 (0 mnt): Potongan Rp0 (Sisa Rp250rb)
                                            <br />
                                            • Stratum 2 (≤ {(wDays * 30).toLocaleString('id-ID')} mnt): Potongan Rp100rb (Sisa Rp150rb)
                                            <br />
                                            • Stratum 3 (≤ {(wDays * 35).toLocaleString('id-ID')} mnt): Potongan Rp150rb (Sisa Rp100rb)
                                            <br />
                                            • Stratum 4 (≤ {(wDays * 40).toLocaleString('id-ID')} mnt): Potongan Rp200rb (Sisa Rp50rb)
                                            <br />
                                            • Stratum 5 (&gt; {(wDays * 40).toLocaleString('id-ID')} mnt): Potongan Rp250rb (Sisa Rp0)
                                          </div>
                                        </div>
                                      </>
                                    );
                                  })()}
                                </div>
                              )}

                              {item.id === 'struktural' && (
                                <div className="grid grid-cols-[auto_24px_1fr] gap-y-1.5 items-baseline">
                                  <DocRow label="Jabatan Terdaftar" value={userVariables.positions.length > 0 ? userVariables.positions.map((p: any) => p.name).join(', ') : 'Tidak Ada'} />
                                  <DocRow label="Total T. Struktural" value={formatIDR(userVariables.totalStrukturalVal)} highlight />
                                </div>
                              )}

                              {item.id === 'hari_tua_instruksional' && (
                                <div className="grid grid-cols-[auto_24px_1fr] gap-y-1.5 items-baseline">
                                  <DocRow label="Tunjangan Hari Tua (10% Gapok)" value={formatIDR(userVariables.tunjHariTuaVal)} highlight />
                                  <DocRow label="T. Instruksional" value={formatIDR(userVariables.tunjInstruksionalVal)} highlight />
                                </div>
                              )}

                              {item.id === 'bpjs_beras' && (
                                <div className="grid grid-cols-[auto_24px_1fr] gap-y-1.5 items-baseline">
                                  <DocRow label="T. BPJS TK" value={formatIDR(userVariables.bpjsTkVal)} highlight />
                                  <DocRow label="T. BPJS KES" value={formatIDR(userVariables.bpjsKesVal)} highlight />
                                  <DocRow label="Tunjangan Beras" value={formatIDR(userVariables.berasVal)} highlight />
                                </div>
                              )}

                              {item.id === 'vakasi' && (
                                <div className="grid grid-cols-[auto_24px_1fr] gap-y-1.5 items-baseline">
                                  {vakasiEvents && vakasiEvents.length > 0 ? (
                                    <>
                                      {vakasiEvents.map((evt, eIdx) => (
                                        <DocRow key={eIdx} label={evt.eventName} value={formatIDR(evt.payGiven)} />
                                      ))}
                                    </>
                                  ) : (
                                    <div className="col-span-3 text-xs text-slate-400 italic mb-1">Tidak ada kegiatan resmi terdaftar pada periode ini</div>
                                  )}
                                  <DocRow label="Total Vakasi Tambahan" value={formatIDR(
                                    earnings
                                      .filter((e: PaySlipField) => !['GAJI POKOK', 'T. KELUARGA', 'TUNJANGAN KELUARGA', 'T. FUNGSIONAL', 'TUNJANGAN FUNGSIONAL', 'KEPANGKATAN', 'T. INSTRUKSIONAL', 'INSTRUKSIONAL', 'T. HARI TUA', 'TUNJANGAN HARI TUA', 'T. BPJS TK', 'BPJS TK', 'T. BPJS KES', 'BPJS KES', 'BERAS', 'PRESENSI', 'BONUS PRESENSI', 'PIKET', 'LEMBUR'].includes(e.label.toUpperCase()) && !e.label.toUpperCase().startsWith('STRUKTURAL:'))
                                      .reduce((sum: number, e: PaySlipField) => sum + e.amount, 0)
                                  )} highlight />
                                </div>
                              )}
                            </div>
                          )}

                          {/* Separator between items */}
                          {idx < payrollDocumentation.length - 1 && (
                            <div className="h-px bg-slate-100 mt-5" />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

            </Card>

            {/* ── Download Action Button ────────────────────────────────────── */}
            {isConfirmed ? (
              <div className="flex flex-col sm:flex-row items-center gap-3.5 justify-center w-full max-w-xl mx-auto">
                <Button
                  onClick={handleDownloadPdf}
                  className="w-full sm:w-auto h-12 rounded-2xl px-8 text-sm font-bold bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg shadow-indigo-500/20 hover:shadow-xl hover:shadow-indigo-500/30 transition-all hover:scale-[1.02] transform active:scale-95 flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Download className="w-5 h-5" />
                  Unduh Slip Gaji (PDF)
                </Button>

                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full sm:w-auto h-12 rounded-2xl px-8 text-sm font-bold bg-gradient-to-r from-[#25D366] to-[#075E54] hover:opacity-95 text-white shadow-lg shadow-emerald-500/20 hover:shadow-xl hover:shadow-emerald-500/30 transition-all hover:scale-[1.02] transform active:scale-95 flex items-center justify-center gap-2 cursor-pointer text-center overflow-hidden"
                >
                  <MessageCircle className="w-5 h-5 text-white" />
                  Hubungi Admin BAK
                </a>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3.5 w-full max-w-xl mx-auto">
                <div className="flex flex-col sm:flex-row items-center gap-3.5 justify-center w-full">
                  <Button
                    disabled
                    className="w-full sm:w-auto h-12 rounded-2xl px-8 text-sm font-bold bg-slate-100 text-slate-400 border border-slate-200/60 shadow-none cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    <Lock className="w-5 h-5 text-slate-400" />
                    Unduh Slip Gaji (PDF)
                  </Button>

                  <a
                    href={whatsappUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full sm:w-auto h-12 rounded-2xl px-8 text-sm font-bold bg-gradient-to-r from-[#25D366] to-[#075E54] hover:opacity-95 text-white shadow-lg shadow-emerald-500/20 hover:shadow-xl hover:shadow-emerald-500/30 transition-all hover:scale-[1.02] transform active:scale-95 flex items-center justify-center gap-2 cursor-pointer text-center overflow-hidden"
                  >
                    <MessageCircle className="w-5 h-5 text-white" />
                    Hubungi Admin BAK via WhatsApp
                  </a>
                </div>
                <p className="text-[11px] font-semibold text-amber-600 bg-amber-50/60 border border-amber-100/50 px-3 py-1 rounded-full animate-pulse text-center">
                  Slip gaji masih berupa DRAFT. Hubungi BAK untuk melakukan penguncian final sebelum mengunduh.
                </p>
              </div>
            )}

          </div>
        )}

      </div>
    </div>
  );
}
