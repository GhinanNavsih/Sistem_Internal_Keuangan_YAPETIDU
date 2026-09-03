"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { FloatingSnackbar } from '@/components/ui/floating-snackbar';
import { useAuth } from '@/lib/AuthContext';
import EmployeeNavigationMenu from '@/components/EmployeeNavigationMenu';
import { auth, db, secondaryDb } from '@/lib/firebase';
import { sendPasswordResetEmail } from 'firebase/auth';
import {
  doc,
  getDocFromServer,
  getDocsFromServer,
  collection,
  query,
  where,
  onSnapshot,
} from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  Banknote,
  CalendarDays,
  CheckCircle2,
  AlertCircle,
  FileText,
  TrendingUp,
  TrendingDown,
  Landmark,
  Coins,
  KeyRound,
  Lock,
  ChevronDown,
  ChevronUp,
  CreditCard,
  History,
  BookOpen,
  CalendarCheck,
  Wrench,
  Calendar,
  Menu as MenuIcon,
  RefreshCw,
} from 'lucide-react';
import Link from 'next/link';
import { generatePaySlipPdf, PaySlipField, PaySlipData } from '@/utils/generatePaySlipPdf';
import {
  PAYROLL_TAX_THRESHOLD,
  normalizeTaxFields,
} from '@/lib/payroll/payrollTax';
import { MONTHS_ID } from '@/utils/rekapConfig';
import { authenticatedJson } from '@/lib/payroll/client';
import { activityBelongsToPayrollPeriod } from '@/lib/payroll/pekaryaSpj';
import {
  composeKoperasiLoanHistoryTrail,
  koperasiProjectedPaidInstallments,
  koperasiProjectedRemainingBalance,
  isKoperasiPayrollPayableStatus,
  projectKoperasiLoanForPeriod,
  resolveKoperasiLoanStatus,
  selectKoperasiActiveLoans,
} from '@/lib/payroll/koperasiLoan';
import {
  calculateYearsOfService,
} from '@/utils/payrollLogic';
import { isTransferEligibleStatus } from '@/lib/payroll/domain';
import { mergeSatpamLegacyBonusIntoTunjangan } from '@/lib/payroll/satpamCompensation';
import {
  overlayPekaryaAttendanceEarnings,
  type PekaryaAttendanceLog,
} from '@/lib/payroll/pekaryaSlipPreview';

interface PekaryaDocItem {
  id: string;
  title: string;
  formula: string;
  bullets: string[];
  table?: {
    headers: string[];
    rows: string[][];
  };
}

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
  if (n == null || Number.isNaN(n)) return "";
  if (n < 0) return "minus " + spell(Math.abs(n));
  n = Math.floor(n);
  const angka = ["", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan", "sepuluh", "sebelas"];
  let hasil = "";

  if (n < 12) {
    hasil = angka[n] || "";
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

  return (hasil || "").replace(/\s+/g, " ").trim();
}

function terbilang(n: number): string {
  const cleaned = spell(n);
  if (!cleaned) return "Nol";
  return cleaned.split(" ").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

/**
 * Employee payslips may be rendered before a finance-owned slip snapshot has
 * been published.  Keep all fallback values numeric and deterministic so a
 * malformed/null Firestore value cannot turn the entire slip into NaN.
 */
function money(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric) : 0;
}

type DailyPresenceLogSource = 'loyalis' | 'pekarya-upload' | 'activity' | null;

function dailyPresenceLogValue(log: unknown): Record<string, unknown> {
  return log && typeof log === 'object' && !Array.isArray(log)
    ? (log as Record<string, unknown>)
    : {};
}

function dailyPresenceDate(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value;
  const date = dateFromFirestoreValue(value);
  return date
    ? date.toLocaleDateString('id-ID')
    : '-';
}

function DailyPresenceLogDetails({
  logs,
  source,
  expanded,
  onToggle,
}: {
  logs: readonly unknown[];
  source: DailyPresenceLogSource;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isPekaryaUpload = source === 'pekarya-upload';

  return (
    <div style={{ gridColumn: '1 / -1' }} className="mt-3 pt-3 border-t border-slate-200">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between py-2 text-xs font-bold text-black hover:text-indigo-600 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-indigo-500" />
          <span>Detail Presensi Harian</span>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-indigo-600">
          <span>{expanded ? 'Sembunyikan' : 'Tampilkan Detail'}</span>
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-indigo-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-indigo-500" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="mt-2.5 overflow-x-auto border border-slate-200/80 rounded-xl bg-white text-xs animate-in fade-in duration-200 shadow-sm">
          {logs.length > 0 ? (
            <table className="w-full table-fixed border-collapse text-[10px] sm:text-[11px]">
              <thead className="bg-slate-50 border-b border-slate-200 font-bold text-black">
                <tr>
                  <th className="pl-3 sm:pl-4 pr-1 py-2 text-left w-[22%]">TANGGAL</th>
                  <th className="px-1 py-2 text-center w-[35%]">JAM SCAN (MASUK / PULANG)</th>
                  <th className="px-1 py-2 text-center w-[15%]">DURASI</th>
                  <th className="pr-3 sm:pr-4 pl-1 py-2 text-right w-[28%]">PENDAPATAN</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {logs.map((rawLog, logIdx) => {
                  const log = dailyPresenceLogValue(rawLog);
                  const scanIn = log.scanIn ?? log['Scan masuk'] ?? log.scanMasuk ?? '-';
                  const scanOut = log.scanOut ?? log['Scan pulang'] ?? log.scanPulang ?? '-';
                  const rawDuration = log.duration;
                  const duration = typeof rawDuration === 'number'
                    ? rawDuration
                    : Math.round(money(log.durationSeconds) / 60);
                  const earningsVal = isPekaryaUpload
                    ? money(log.amount)
                    : duration > 0
                      ? duration * 27.5
                      : 0;
                  const payType = typeof log.payType === 'string' ? log.payType : '';

                  return (
                    <tr key={logIdx} className="hover:bg-slate-50/50">
                      <td className="pl-3 sm:pl-4 pr-1 py-2 font-bold text-black font-mono text-[10px] sm:text-[11px] truncate">
                        <div>{dailyPresenceDate(log.date ?? log.Tanggal ?? log.tanggal)}</div>
                        {isPekaryaUpload && payType && (
                          <div className="mt-0.5 text-[9px] font-semibold text-indigo-600">{payType}</div>
                        )}
                      </td>
                      <td className="px-1 py-1.5 text-center font-mono text-[10px] sm:text-[11px]">
                        <div className="flex flex-col items-center leading-tight gap-0.5">
                          <span className="text-black font-medium">
                            Masuk: {String(scanIn || '-')}
                          </span>
                          <span className="text-black font-medium">
                            Pulang: {String(scanOut || '-')}
                          </span>
                        </div>
                      </td>
                      <td className="px-1 py-2 text-center font-mono text-[10px] sm:text-[11px]">
                        {duration > 0 ? `${duration}m` : '-'}
                      </td>
                      <td className="pr-3 sm:pr-4 pl-1 py-2 text-right font-bold font-mono text-black text-[10px] sm:text-[11px]">
                        {earningsVal > 0 ? formatIDR(earningsVal) : '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="p-4 text-center text-slate-500 text-xs italic">
              Data presensi harian belum tersedia untuk periode ini.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function dateFromFirestoreValue(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof (value as any)?.toDate === 'function') {
    const date = (value as any).toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
  }
  if (typeof (value as any)?.seconds === 'number') {
    const date = new Date(Number((value as any).seconds) * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function timestampMillis(value: unknown): number {
  return dateFromFirestoreValue(value)?.getTime() ?? 0;
}

function isLoanPayableForPeriod(loan: any, periodDate: Date): boolean {
  if (money(loan?.sisaHutang) <= 0 || !Array.isArray(loan?.history) || loan.history.length === 0) {
    return false;
  }

  const history = [...loan.history].sort(
    (a: any, b: any) => timestampMillis(b?.timestamp) - timestampMillis(a?.timestamp),
  );
  const payableStatus = isKoperasiPayrollPayableStatus(
    resolveKoperasiLoanStatus(loan),
  );
  if (!payableStatus) return false;

  const activationDate =
    dateFromFirestoreValue(loan.tanggalDisetujui) ||
    dateFromFirestoreValue(history[0]?.timestamp);
  if (!activationDate) return false;

  const targetPeriod = periodDate.getFullYear() * 12 + periodDate.getMonth();
  const activationPeriod = activationDate.getFullYear() * 12 + activationDate.getMonth();
  return activationPeriod <= targetPeriod;
}

function normalizeSlipFields(fields: unknown): PaySlipField[] {
  if (!Array.isArray(fields)) return [];
  return fields
    .filter((field: any) => field && typeof field.label === 'string')
    .map((field: any) => ({ label: field.label, amount: money(field.amount) }));
}

function renameBlueCollarAttendanceLabel(
  fields: PaySlipField[],
  jobCategory: unknown,
): PaySlipField[] {
  const category = String(jobCategory || '').trim().toUpperCase();
  if (!category || category === 'SATPAM') return fields;
  const alreadyUsesCurrentLabel = fields.some(
    (field) => field.label.trim().toUpperCase() === 'PRESENSI HARIAN',
  );
  return fields.flatMap((field) => {
    if (field.label.trim().toUpperCase() !== 'VAKASI HARIAN') return [field];
    return alreadyUsesCurrentLabel
      ? []
      : [{ ...field, label: 'Presensi Harian' }];
  });
}

function mergeSlipFields(fallback: PaySlipField[], saved: unknown): PaySlipField[] {
  const merged = [...fallback];
  for (const field of normalizeSlipFields(saved)) {
    const index = merged.findIndex(
      (candidate) => candidate.label.trim().toUpperCase() === field.label.trim().toUpperCase(),
    );
    if (index >= 0) {
      // A draft generated before an approval/profile update often contains
      // zero placeholders.  Do not let those placeholders hide a now-known
      // positive source value (e.g. BPJS, rice allowance, or approved SPJ).
      if (field.amount > 0 || merged[index].amount <= 0) merged[index] = field;
    }
    else merged.push(field);
  }
  return merged;
}



// ─── Component ───────────────────────────────────────────────────────────────

export default function EmployeePayslipPage() {
  const {
    profile: rawProfile,
    activeProfile,
    logout,
    isImpersonatingUi,
    uiPreviewRevision,
  } = useAuth();
  const profile = activeProfile || rawProfile;

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
  const [koperasiLoansInfo, setKoperasiLoansInfo] = useState<any[]>([]);

  const formatLoanDate = (ts: any) => {
    if (!ts) return '-';
    let d: Date | null = null;
    if (ts?.toDate && typeof ts.toDate === 'function') d = ts.toDate();
    else if (ts?.seconds) d = new Date(ts.seconds * 1000);
    else if (ts instanceof Date) d = ts;
    else if (typeof ts === 'string' || typeof ts === 'number') {
      const parsed = new Date(ts);
      if (!isNaN(parsed.getTime())) d = parsed;
    }
    if (!d) return '-';
    return d.toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

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
        'T. BPJS (TK & KES): Subsidi iuran 100% yang ditanggung oleh lembaga',
        'Lembaga membayarkan seluruh iuran BPJS pegawai secara penuh di sisi Penerimaan',
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
          where('status', 'in', ['confirmed', 'locked', 'payment_created', 'paid'])
        );
        const querySnapshot = await getDocsFromServer(q);

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
  const periodEndDate = useMemo(
    () => new Date(year, month, 0, 23, 59, 59, 999),
    [year, month],
  );
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
  const [pekaryaPreviewError, setPekaryaPreviewError] = useState<string | null>(null);
  const [pekaryaPreviewReloadToken, setPekaryaPreviewReloadToken] = useState(0);
  const [presenceInfo, setPresenceInfo] = useState<{
    workingDays: number;
    expectedHours: number;
    absenceMinutes: number;
    bonusDeduction: number;
  } | null>(null);
  const [vakasiEvents, setVakasiEvents] = useState<{ eventName: string; payGiven: number }[]>([]);
  const [kepangkatanDesignations, setKepangkatanDesignations] = useState<Record<number, string>>({});
  const [dailyPresenceLogs, setDailyPresenceLogs] = useState<any[]>([]);
  const [dailyPresenceLogSource, setDailyPresenceLogSource] = useState<DailyPresenceLogSource>(null);
  const [showDailyLogs, setShowDailyLogs] = useState<boolean>(false);

  // Dynamic calculations states
  const [calculatedEarnings, setCalculatedEarnings] = useState<PaySlipField[]>([]);
  const [calculatedDeductions, setCalculatedDeductions] = useState<PaySlipField[]>([]);
  /**
   * Income tax rows saved on the slip. Tax is its own category, so it is read
   * straight off the slip rather than merged into the deduction list — the
   * employee sees Potongan and Pajak as separate blocks, exactly as printed.
   */
  const [calculatedTaxes, setCalculatedTaxes] = useState<PaySlipField[]>([]);

  const pekaryaPayrollDocumentation = useMemo<PekaryaDocItem[]>(() => {
    const userJobCategory = (employeeData?.employment?.jobCategory || 'PEKARYA').toUpperCase();
    const isSatpam = userJobCategory === 'SATPAM';
    const isKebersihan = userJobCategory.startsWith('KEBERSIHAN');
    const isTeknisi = userJobCategory === 'TEKNISI';
    const isSopir = userJobCategory === 'SOPIR';

    const gapokDoc: PekaryaDocItem = {
      id: 'gapok_pekarya',
      title: 'Gaji Pokok Pekarya',
      formula: 'Golongan + Masa Kerja → Matriks Gaji Aktif',
      bullets: [
        'Nominal diambil dari matriks gaji aktif berdasarkan golongan dan masa kerja pada periode slip',
        'Salinan gaji pokok pada profil pegawai tidak digunakan sebagai sumber nilai',
        'Nominal tidak tergantung pada jumlah jam kerja mingguan',
      ],
    };

    let shiftDoc: PekaryaDocItem;

    if (isSatpam) {
      shiftDoc = {
        id: 'vakasi_jumat_lembur',
        title: 'Vakasi Harian, Jumat & Lembur',
        formula: 'Harian: Rp 12.500/Shift | Jumat: Rp 25.000/Shift | Lembur Sendiri: Rp 30.000 | Cover: Rp 50.000',
        bullets: [
          'Vakasi Harian: Dihitung dari jumlah kehadiran dinas shift Harian (Rp 12.500 per shift)',
          'Jumat & Libur: Insentif tugas piket / penugasan pos pada hari Jumat atau Hari Libur (Rp 25.000 per shift)',
          'Lembur Sendiri: Insentif tugas lembur perorangan di luar shift reguler (Rp 30.000 per shift)',
          'Lembur Cover: Insentif menggantikan / meng-cover penugasan regu lain (Rp 50.000 per shift)',
        ],
        table: {
          headers: ['Jenis Shift / Tugas', 'Tarif Insentif', 'Keterangan'],
          rows: [
            ['Vakasi Harian', 'Rp 12.500 / Shift', 'Shift reguler harian Satpam'],
            ['Jumat & Libur', 'Rp 25.000 / Shift', 'Shift khusus hari Jumat atau hari libur'],
            ['Lembur Sendiri', 'Rp 30.000 / Shift', 'Lembur tugas mandiri tambahan'],
            ['Lembur Cover', 'Rp 50.000 / Shift', 'Lembur meng-cover regu lain'],
          ],
        },
      };
    } else if (isKebersihan) {
      shiftDoc = {
        id: 'vakasi_jumat_lembur',
        title: 'Presensi Harian & Jumat',
        formula: 'Rp 1.923,08 per jam kerja tercatat (Rp 0,53418803418 per detik)',
        bullets: [
          'Presensi Harian dihitung dari selisih scan masuk dan scan pulang pada mesin presensi, bukan dari tarif tetap per shift',
          'Hasil perhitungan dibulatkan ke atas ke rupiah penuh',
          'Hari kerja 6,5 jam bernilai Rp 12.500 dan 13 jam bernilai Rp 25.000',
          'Jumat & Libur: hari Jumat dan hari libur tetap dicatat pada kolom terpisah dan dibayar sesuai jam kerja tercatat',
          'Hari dengan scan masuk atau scan pulang saja belum dapat dihitung — ajukan koreksi presensi agar jamnya lengkap',
        ],
        table: {
          headers: ['Durasi Kerja Tercatat', 'Nilai Presensi', 'Keterangan'],
          rows: [
            ['Rp/Jam Harian', 'Rp 1.924', 'Pembulatan ke atas dari Rp 1.923,08'],
            ['Rp/Jam Jumat & Libur', 'Rp 3.847', 'Pembulatan ke atas dari Rp 3.846,15'],
            ['Harian (6.5 jam)', 'Rp 12.500', 'Setara satu hari kerja penuh'],
            ['Jumat & Libur (6.5 jam)', 'Rp 25.000', 'Dua kali hari kerja penuh'],
          ],
        },
      };
    } else if (isTeknisi) {
      shiftDoc = {
        id: 'vakasi_jumat_lembur',
        title: 'Presensi Harian, Jumat & Lembur',
        formula: 'Rp 1.923,08 per jam kerja tercatat (Rp 0,53418803418 per detik)',
        bullets: [
          'Presensi Harian dihitung dari selisih scan masuk dan scan pulang pada mesin presensi, bukan dari tarif tetap per shift',
          'Hasil perhitungan dibulatkan ke atas ke rupiah penuh',
          'Hari kerja 6,5 jam bernilai Rp 12.500 dan 13 jam bernilai Rp 25.000',
          'Jumat & Libur: hari Jumat dan hari libur tetap dicatat pada kolom terpisah dan dibayar sesuai jam kerja tercatat',
          'Hari dengan scan masuk atau scan pulang saja belum dapat dihitung — ajukan koreksi presensi agar jamnya lengkap',
          'Lembur: Insentif penanganan perbaikan / tugas lembur teknisi',
        ],
        table: {
          headers: ['Durasi Kerja Tercatat', 'Nilai Presensi', 'Keterangan'],
          rows: [
            ['1 jam', 'Rp 1.924', 'Pembulatan ke atas dari Rp 1.923,08'],
            ['6,5 jam', 'Rp 12.500', 'Setara satu hari kerja penuh'],
            ['13 jam', 'Rp 25.000', 'Dua kali hari kerja penuh'],
            ['Lembur', 'Sesuai Rekap', 'Lembur perbaikan / tugas khusus teknisi'],
          ],
        },
      };
    } else if (isSopir) {
      shiftDoc = {
        id: 'vakasi_jumat_lembur',
        title: 'Presensi Harian, Jumat & Piket/Praktek',
        formula: 'Presensi: Rp 1.923,08/jam tercatat | Piket: Rp 15.000/penugasan',
        bullets: [
          'Presensi Harian dihitung dari durasi scan masuk dan scan pulang pada unggahan presensi aktif',
          'Hasil perhitungan dibulatkan ke atas ke rupiah penuh; hari kerja 6,5 jam bernilai Rp 12.500',
          'Jumat & Libur dicatat terpisah dan dibayar sesuai durasi kerja tercatat dengan tarif premium',
          'Piket & Praktek: Insentif tugas siaga piket pengemudi dan pendampingan praktek',
        ],
        table: {
          headers: ['Jenis Presensi / Tugas', 'Nilai', 'Keterangan'],
          rows: [
            ['Presensi Harian', 'Sesuai durasi scan', 'Hari kerja reguler Sopir'],
            ['Jumat & Libur', 'Sesuai durasi scan', 'Hari Jumat atau hari libur'],
            ['Piket', 'Rp 15.000 / Penugasan', 'Tugas siaga piket pengemudi'],
            ['Praktek', 'Sesuai Rekap', 'Pendampingan kegiatan praktek'],
          ],
        },
      };
    } else {
      shiftDoc = {
        id: 'vakasi_jumat_lembur',
        title: 'Presensi Harian & Insentif Tugas',
        formula: 'Rp 1.923,08 per jam kerja tercatat (Rp 0,53418803418 per detik)',
        bullets: [
          'Presensi Harian dihitung dari durasi scan masuk dan scan pulang pada unggahan presensi aktif',
          'Jumat & Libur dicatat terpisah dan dibayar sesuai durasi kerja tercatat dengan tarif premium',
        ],
        table: {
          headers: ['Jenis Presensi', 'Nilai', 'Keterangan'],
          rows: [
            ['Presensi Harian', 'Sesuai durasi scan', 'Hari kerja reguler'],
            ['Jumat & Libur', 'Sesuai durasi scan', 'Hari Jumat atau hari libur'],
          ],
        },
      };
    }

    const bonusDoc: PekaryaDocItem = isSatpam
      ? {
        id: 'bonus_presensi_pekarya',
        title: 'Tunjangan Jabatan',
        formula: 'Reguler: Rp 50.000 | Ketua Shift / Ketua Satpam: Rp 150.000',
        bullets: [
          'Rp 50.000 untuk seluruh Satpam sudah digabung langsung ke Tunjangan Jabatan.',
          'Ketua Shift / Ketua Satpam menerima tambahan tunjangan peran Rp 100.000.',
        ],
      }
      : {
        id: 'bonus_presensi_pekarya',
        title: 'Bonus Presensi & Ketertiban',
        formula: isKebersihan
          ? 'Insentif Bonus Presensi Bulanan / Mutlak'
          : 'Bonus Presensi Mutlak: Rp 50.000',
        bullets: [
          'Diberikan kepada pegawai Pekarya yang memenuhi kualifikasi kedisiplinan dan ketepatan presensi',
          'Dihitung dan disetujui pada pelaporan rekap bulanan / triwulanan',
        ],
      };

    const spjDoc = {
      id: 'spj_pekarya_doc',
      title: 'SPJ (Surat Perintah Jalan & Pelaporan Kegiatan)',
      formula: 'Total Honor ActivityReports + Event Kegiatan SPJ Disetujui',
      bullets: [
        'Dihitung dari akumulasi honor kegiatan harian, tugas perjalanan dinas, serta event resmi',
        'Hanya kegiatan dan SPJ dengan status "Disetujui" (Approved) yang masuk dalam perhitungan',
      ],
    };

    const bpjsDoc = {
      id: 'bpjs_beras_pekarya',
      title: 'BPJS (Tunjangan) & Tunjangan Beras',
      formula: 'Subsidi BPJS + Tunjangan Beras Profil',
      bullets: [
        'BPJS (Tunjangan): Subsidi iuran dari lembaga (Lembaga menanggung 100% iuran BPJS)',
        'Potongan BPJS: Dicatat seimbang pada sisi Potongan sehingga iuran terbayar penuh tanpa mengurangi gaji bersih pegawai',
        'Tunjangan Beras: Tunjangan natura bulanan',
      ],
    };

    return [gapokDoc, shiftDoc, bonusDoc, spjDoc, bpjsDoc];
  }, [employeeData?.employment?.jobCategory]);

  // Load employee data & payslip details
  useEffect(() => {
    if (!profile?.linkedEmployeeId) return;
    if (!isDefaultPeriodSet) return;

    let cancelled = false;
    const fetchPayslipData = async (attempt = 1) => {
      try {
        if (cancelled) return;
        setLoading(true);
        setEmployeeData(null);
        setConfirmedSlip(null);
        setIsConfirmed(false);
        setCalculatedEarnings([]);
        setCalculatedDeductions([]);
        setCalculatedTaxes([]);
        setPekaryaPreviewError(null);
        setDailyPresenceLogs([]);
        setDailyPresenceLogSource(null);
        setShowDailyLogs(false);

        const empId = profile.linkedEmployeeId as string;
        const roleStr = profile?.role as string;
        const isLoyalis = roleStr !== 'honorer' && roleStr !== 'ketua_shift_satpam';

        // 1. Fetch main Employee document (checking both collections to guarantee resolution)
        let empRef = doc(db, isLoyalis ? 'Employees_Loyalis' : 'Employees_BlueCollar', empId);
        let empSnap = await getDocFromServer(empRef);

        if (!empSnap.exists()) {
          const altRef = doc(db, !isLoyalis ? 'Employees_Loyalis' : 'Employees_BlueCollar', empId);
          empSnap = await getDocFromServer(altRef);
        }

        if (!empSnap.exists()) {
          console.error(`Employee document ${empId} not found in Employees_Loyalis or Employees_BlueCollar`);
          if (!cancelled) {
            setEmployeeData(null);
            setLoading(false);
          }
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

        // A final PayrollSlipStates snapshot remains authoritative.  When it
        // does not exist yet (the normal state while Finance is preparing a
        // period), build a read-only employee draft from the employee's own
        // profile, approved activity reports, and their own cooperative data.
        // All queries below are scoped to this employee and never expose an
        // institution-wide payroll collection to the browser.
        const activityQuery = query(
          collection(db, 'ActivityReports'),
          where('employeeId', '==', empId),
        );
        const activityPromise = isLoyalis
          ? Promise.resolve(null)
          : getDocsFromServer(activityQuery).catch((error) => {
            console.warn('Unable to load approved activity reports for payslip draft:', error);
            return null;
          });

        const loanPromise = employee.koperasiAuthUid
          ? getDocsFromServer(query(
            collection(secondaryDb, 'simpanPinjam'),
            where('userId', '==', employee.koperasiAuthUid),
          )).catch((error) => {
            console.warn('Unable to load cooperative loan data for payslip draft:', error);
            return null;
          })
          : Promise.resolve(null);

        const memberPromise = employee.koperasiAuthUid
          ? getDocsFromServer(query(
            collection(secondaryDb, 'users'),
            where('uid', '==', employee.koperasiAuthUid),
          )).catch((error) => {
            console.warn('Unable to load cooperative membership data for payslip draft:', error);
            return null;
          })
          : Promise.resolve(null);

        const [activitySnapshot, loanSnapshot, memberSnapshot] = await Promise.all([
          activityPromise,
          loanPromise,
          memberPromise,
        ]);
        if (cancelled) return;

        // Still read directly: these back the "Rincian Presensi Harian" list,
        // not the money rows, which now come from the shared preview endpoint.
        const activityReports = activitySnapshot?.docs.map((activityDoc) => ({
          id: activityDoc.id,
          ...activityDoc.data(),
        })) || [];

        const rawCooperativeLoans = (loanSnapshot?.docs || [])
          .map((loanDoc) => ({ id: loanDoc.id, ...loanDoc.data() as any }));
        const periodLoans = rawCooperativeLoans
          .map((loan) => projectKoperasiLoanForPeriod(loan, periodEndDate))
          .filter((loan): loan is NonNullable<typeof loan> => Boolean(loan));
        const processedCooperativeLoans = periodLoans
          .filter((loan) => money(loan.sisaHutang) > 0)
          .map((loan) => ({
            ...loan,
            // Use the same full restructuring ancestry trail as Audit
            // Simpan Pinjam, limited to the selected period cutoff.
            composedTrail: composeKoperasiLoanHistoryTrail(loan, periodLoans, periodEndDate),
          }));
        const payableLoans = selectKoperasiActiveLoans(
          processedCooperativeLoans.filter((loan) => isLoanPayableForPeriod(loan, targetDate)),
        );
        const koperasiDeduction = payableLoans.reduce((total, loan) => total + money(loan.cicilan), 0);
        // The payslip answers which loan is being deducted this period, not
        // which restructuring applications were ever submitted. Rejected or
        // cancelled proposals remain available in the Koperasi admin audit,
        // but must not appear as employee-facing loan cards. The active loan's
        // composedTrail still retains its legitimate restructuring ancestry.
        setKoperasiLoansInfo(payableLoans);

        const memberData = memberSnapshot?.docs[0]?.data() as any;
        const memberApproved = memberData?.status === 'approved' || memberData?.membershipStatus === 'approved';
        const koperasiSaving = memberApproved && memberData?.paymentStatus !== 'Yayasan Subsidy'
          ? money(memberData?.iuranWajib) || 25000
          : 0;

        let fallbackEarnings: PaySlipField[] = [];
        let fallbackDeductions: PaySlipField[] = [];
        let loadedPresenceInfo = {
          workingDays: 0,
          expectedHours: 0,
          absenceMinutes: 0,
          bonusDeduction: 0,
        };
        let loadedVakasiEvents: { eventName: string; payGiven: number }[] = [];
        let hasCurrentPekaryaAttendance = false;
        let loadedPekaryaAttendanceLogs: PekaryaAttendanceLog[] | null = null;

        if (!isLoyalis) {
          // Earnings come from /api/payroll/slip-preview — the very same
          // calculation the Finance dashboard renders — so this page and
          // Tinjau Slip Gaji cannot show different rows or totals.
          //
          // There is deliberately no `salaryProfile.baseSalaryAmount`
          // fallback: it is a denormalized snapshot that under-states Gaji
          // Pokok as soon as an employee crosses a service-year boundary. If
          // the preview cannot be read the rows stay empty rather than
          // rendering a stale figure as though it were current.
          try {
            const previewParams = new URLSearchParams({ period: periodToken });
            if (isImpersonatingUi) previewParams.set('employeeId', empId);
            const previewResult = await authenticatedJson<{
              previews?: Record<
                string,
                {
                  earnings?: unknown;
                  meta?: { attendanceSource?: unknown };
                }
              >;
              attendanceLogs?: Record<string, PekaryaAttendanceLog[]>;
              attendanceImportRevisionId?: string | null;
            }>(`/api/payroll/slip-preview?${previewParams.toString()}`);
            if (cancelled) return;
            const employeePreview = previewResult.previews?.[empId];
            const employeeCategory = String(
              employee.employment?.jobCategory || '',
            ).trim().toUpperCase();
            if (
              previewResult.attendanceImportRevisionId &&
              employeeCategory !== 'SATPAM'
            ) {
              loadedPekaryaAttendanceLogs = Array.isArray(
                previewResult.attendanceLogs?.[empId],
              )
                ? previewResult.attendanceLogs![empId]
                : [];
            }
            fallbackEarnings = normalizeSlipFields(
              employeePreview?.earnings,
            );
            hasCurrentPekaryaAttendance =
              employeePreview?.meta?.attendanceSource === 'uploaded_attendance' ||
              employeePreview?.meta?.attendanceSource === 'uraian';
            if (fallbackEarnings.length === 0) {
              throw new Error(
                'Pratinjau perhitungan Pekarya tidak tersedia untuk periode ini.',
              );
            }
          } catch (previewErr) {
            console.warn('Unable to load the shared Pekarya slip preview:', previewErr);
            if (!cancelled) {
              setPekaryaPreviewError(
                previewErr instanceof Error
                  ? previewErr.message
                  : 'Gagal memuat pratinjau perhitungan Pekarya.',
              );
            }
          }

          fallbackDeductions.push(
            { label: 'Koperasi Rochmad', amount: money(employee.deductions?.koperasiRochmad) },
            { label: 'BPJS', amount: money(employee.bpjs?.deductionAmount) },
            { label: 'Tabungan Hari Tua BNI Simponi', amount: money(employee.tht?.deductionAmount) },
            { label: 'Tabungan', amount: money(employee.savings?.deductionAmount) },
            { label: 'Zakat Infaq Sodaqoh', amount: money(employee.ziz?.deductionAmount) },
            { label: 'Revisi Gaji', amount: 0 },
            { label: 'Pinlu/Tagihan', amount: money(employee.pinlu?.deductionAmount) },
            { label: 'Pinjaman Kop. UNIPDU', amount: koperasiDeduction },
            { label: 'Potongan Presensi', amount: 0 },
            { label: 'Potongan Bonus Presensi', amount: 0 },
            { label: 'Iuran Wajib Kop. UNIPDU', amount: koperasiSaving },
          );
        }

        // Check for saved slip in PayrollSlipStates (Format: {periodKey}_{linkedEmployeeId})
        const slipDocId = `${periodKey}_${empId}`;
        const slipRef = doc(db, 'PayrollSlipStates', slipDocId);
        const slipSnap = await getDocFromServer(slipRef);
        if (cancelled) return;

        // LoyalisPresence and the salary matrices are institution-owned data.
        // Fetch only this employee's daily logs and calculated draft rows
        // through scoped server routes. This keeps UI Preview aligned with the
        // Finance dashboard without granting the browser collection-wide
        // access to payroll inputs.
        let foundLogs: any[] = [];
        if (isLoyalis) {
          const previewEmployeeId = isImpersonatingUi ? empId : undefined;
          const buildEmployeeParams = () => {
            const params = new URLSearchParams({ period: periodToken });
            if (previewEmployeeId) params.set('employeeId', previewEmployeeId);
            return params;
          };

          try {
            const presenceParams = buildEmployeeParams();
            const presenceResult = await authenticatedJson<{ dailyLogs?: unknown[] }>(
              `/api/employee/loyalis-presence?${presenceParams.toString()}`,
            );
            if (Array.isArray(presenceResult.dailyLogs)) {
              foundLogs = presenceResult.dailyLogs;
            }
          } catch (pErr) {
            console.warn('Unable to load LoyalisPresence daily logs:', pErr);
          }

          try {
            const payslipParams = buildEmployeeParams();
            const payslipResult = await authenticatedJson<{
              earnings?: unknown;
              deductions?: unknown;
              presenceInfo?: {
                workingDays?: unknown;
                expectedHours?: unknown;
                absenceMinutes?: unknown;
                bonusDeduction?: unknown;
              };
              vakasiEvents?: unknown;
            }>(
              `/api/employee/loyalis-payslip?${payslipParams.toString()}`,
            );

            fallbackEarnings = normalizeSlipFields(payslipResult.earnings);
            fallbackDeductions = normalizeSlipFields(payslipResult.deductions);

            // Cooperative data lives in the separate Koperasi project and is
            // already loaded through the employee-scoped queries above. Merge
            // those two values into the server-calculated Loyalis rows.
            fallbackDeductions = mergeSlipFields(fallbackDeductions, [
              { label: 'Pinjaman Kop. UNIPDU', amount: koperasiDeduction },
              { label: 'Iuran Wajib Kop. UNIPDU', amount: koperasiSaving },
            ]);

            const rawPresenceInfo = payslipResult.presenceInfo;
            if (rawPresenceInfo) {
              const numeric = (value: unknown): number => {
                const parsed = Number(value);
                return Number.isFinite(parsed) ? parsed : 0;
              };
              loadedPresenceInfo = {
                workingDays: numeric(rawPresenceInfo.workingDays),
                expectedHours: numeric(rawPresenceInfo.expectedHours),
                absenceMinutes: numeric(rawPresenceInfo.absenceMinutes),
                bonusDeduction: numeric(rawPresenceInfo.bonusDeduction),
              };
            }
            if (Array.isArray(payslipResult.vakasiEvents)) {
              loadedVakasiEvents = payslipResult.vakasiEvents.filter(
                (event): event is { eventName: string; payGiven: number } =>
                  Boolean(event) &&
                  typeof event === 'object' &&
                  typeof (event as any).eventName === 'string' &&
                  typeof (event as any).payGiven === 'number',
              );
            }
          } catch (payslipErr) {
            console.warn('Unable to load Loyalis draft payslip fallback:', payslipErr);
          }
        }

        // Non-Loyalis employees do not use LoyalisPresence. Once an active
        // unified scanner import exists, its day rows are authoritative; an
        // older approved ActivityReports list remains the pre-import fallback.
        const periodActivityReports = activityReports.filter((report: any) =>
          report.status === 'approved' && activityBelongsToPayrollPeriod(report, periodToken),
        );
        let loadedDailyPresenceLogSource: DailyPresenceLogSource = isLoyalis
          ? 'loyalis'
          : null;
        if (!isLoyalis && loadedPekaryaAttendanceLogs !== null) {
          // An active unified import is the source of truth for this log. Keep
          // an empty array as an intentional empty state instead of falling
          // back to older ActivityReports rows.
          foundLogs = loadedPekaryaAttendanceLogs;
          loadedDailyPresenceLogSource = 'pekarya-upload';
        } else if (!isLoyalis && foundLogs.length === 0 && periodActivityReports.length > 0) {
          foundLogs = periodActivityReports.map((act: any) => {
            let dateStr = '-';
            if (act.date) {
              if (typeof act.date === 'string') dateStr = act.date;
              else if (act.date?.toDate) dateStr = new Date(act.date.toDate()).toLocaleDateString('id-ID');
              else dateStr = new Date(act.date).toLocaleDateString('id-ID');
            }
            return {
              Tanggal: dateStr,
              'Jam kerja': act.activityType || act.activityTitle || act.shift || 'KEGIATAN',
              'Scan masuk': act.startTime || act.checkInTime || '-',
              'Scan pulang': act.endTime || act.checkOutTime || '-',
              duration: typeof act.durationMinutes === 'number' ? act.durationMinutes : (act.hours ? Math.round(act.hours * 60) : 0),
              earningsVal: act.wageAmount || act.nominal || 0,
            };
          });
          loadedDailyPresenceLogSource = 'activity';
        }

        setDailyPresenceLogs(foundLogs);
        setDailyPresenceLogSource(loadedDailyPresenceLogSource);

        if (slipSnap.exists() && isTransferEligibleStatus(slipSnap.data()?.status)) {
          const slipData = slipSnap.data();
          setConfirmedSlip(slipData);
          setIsConfirmed(true);
          setCalculatedEarnings(normalizeSlipFields(slipData.earnings));
          setCalculatedDeductions(normalizeSlipFields(slipData.deductions));
          setCalculatedTaxes(normalizeTaxFields(slipData.taxes));
          setPekaryaPreviewError(null);

          setPresenceInfo(loadedPresenceInfo);
          setVakasiEvents(loadedVakasiEvents);
          setKepangkatanDesignations({});

          setLoading(false);
          return;
        }

        // Draft/verification records are visible to the employee as a
        // read-only snapshot. Finance-owned rows stay frozen until Refresh.
        // Attendance is the narrow exception requested for the unified import:
        // once an active upload exists, those two provisional rows mirror the
        // shared preview even on an older editable draft. Final slips returned
        // above remain immutable.
        const savedSlip = slipSnap.exists() ? slipSnap.data() : null;
        if (savedSlip) setPekaryaPreviewError(null);
        setConfirmedSlip(null);
        setIsConfirmed(false);
        const savedEarnings = savedSlip
          ? normalizeSlipFields(savedSlip.earnings)
          : [];
        const shouldOverlayCurrentAttendance =
          Boolean(savedSlip) &&
          periodToken >= '2026-08' &&
          String(employee.employment?.jobCategory || '').toUpperCase() !== 'SATPAM' &&
          hasCurrentPekaryaAttendance;
        setCalculatedEarnings(
          savedSlip
            ? shouldOverlayCurrentAttendance
              ? overlayPekaryaAttendanceEarnings(
                  savedEarnings,
                  fallbackEarnings,
                )
              : savedEarnings
            : fallbackEarnings,
        );
        setCalculatedDeductions(
          savedSlip
            ? normalizeSlipFields(savedSlip.deductions)
            : fallbackDeductions,
        );
        // No saved slip means no tax has been applied yet: tax is never
        // predicted locally, only shown once Finance has saved it.
        setCalculatedTaxes(savedSlip ? normalizeTaxFields(savedSlip.taxes) : []);
        setPresenceInfo(loadedPresenceInfo);
        setVakasiEvents(loadedVakasiEvents);
        setKepangkatanDesignations({});
        setLoading(false);
        return;

      } catch (err: any) {
        console.error(`Error fetching/calculating payslip data (attempt ${attempt}):`, err);
        const isPermissionError = err?.code === 'permission-denied' || err?.message?.toLowerCase().includes('permission');
        if (isPermissionError && attempt < 3) {
          setTimeout(() => {
            if (!cancelled) fetchPayslipData(attempt + 1);
          }, 600);
        } else if (!cancelled) {
          setLoading(false);
        }
      }
    };

    let unsubscribeActivity: (() => void) | undefined;
    if (profile?.role === 'honorer' && profile.linkedEmployeeId) {
      const activityQuery = query(
        collection(db, 'ActivityReports'),
        where('employeeId', '==', profile.linkedEmployeeId),
      );
      unsubscribeActivity = onSnapshot(
        activityQuery,
        () => {
          if (!cancelled) fetchPayslipData();
        },
        (error) => console.warn('Unable to watch activity reports for payslip draft:', error),
      );
    }
    fetchPayslipData();
    return () => {
      cancelled = true;
      unsubscribeActivity?.();
    };
  }, [
    profile?.linkedEmployeeId,
    profile?.uid,
    profile?.role,
    isImpersonatingUi,
    uiPreviewRevision,
    pekaryaPreviewReloadToken,
    periodKey,
    periodToken,
    periodEndDate,
    targetDate,
    isDefaultPeriodSet,
  ]);

  // Compiled earnings & deductions based on finalized status
  const earnings = useMemo(() => {
    const source = confirmedSlip?.earnings && confirmedSlip.earnings.length > 0
      ? confirmedSlip.earnings
      : calculatedEarnings;
    const normalized = employeeData?.employment?.jobCategory === 'SATPAM'
      ? mergeSatpamLegacyBonusIntoTunjangan(source)
      : source;
    return renameBlueCollarAttendanceLabel(
      normalized,
      employeeData?.employment?.jobCategory,
    );
  }, [confirmedSlip, calculatedEarnings, employeeData?.employment?.jobCategory]);

  const deductions = useMemo(() => {
    return confirmedSlip?.deductions && confirmedSlip.deductions.length > 0 ? confirmedSlip.deductions : calculatedDeductions;
  }, [confirmedSlip, calculatedDeductions]);

  const taxes = useMemo(
    () =>
      confirmedSlip?.taxes && confirmedSlip.taxes.length > 0
        ? normalizeTaxFields(confirmedSlip.taxes)
        : calculatedTaxes,
    [confirmedSlip, calculatedTaxes],
  );

  // Totals calculations
  const totalEarnings = useMemo(() => earnings.reduce((sum: number, e: PaySlipField) => sum + e.amount, 0), [earnings]);
  const totalDeductions = useMemo(() => deductions.reduce((sum: number, d: PaySlipField) => sum + d.amount, 0), [deductions]);
  const totalTax = useMemo(() => taxes.reduce((sum: number, t: PaySlipField) => sum + t.amount, 0), [taxes]);
  // Gaji Bersih before tax — the figure the 5% was charged on.
  const taxBase = useMemo(() => totalEarnings - totalDeductions, [totalEarnings, totalDeductions]);
  const netSalary = useMemo(() => taxBase - totalTax, [taxBase, totalTax]);

  const allDeductionDocs = useMemo(() => [
    {
      id: 'koperasi_rochmad',
      title: 'Koperasi Rochmad',
      formula: 'Nominal Potongan Sesuai Data Koperasi',
      bullets: [
        'Potongan rutin keanggotaan Koperasi Rochmad',
        'Nominal ditentukan oleh kesepakatan keanggotaan pegawai',
      ],
      matchLabels: ['KOPERASI ROCHMAD', 'KOP. ROCHMAD'],
    },
    {
      id: 'bpjs_deduction',
      title: 'Potongan BPJS',
      formula: 'Iuran BPJS Porsi Pegawai',
      bullets: [
        'Iuran BPJS Ketenagakerjaan dan/atau Kesehatan yang dicatat pada sisi Potongan',
        'Karena iuran ditanggung 100% oleh lembaga, nominal Potongan ini persis seimbang dengan Tunjangan BPJS pada sisi Penerimaan (Net Zero Effect)',
      ],
      matchLabels: ['BPJS', 'POTONGAN BPJS', 'BPJS (POTONGAN)'],
    },
    {
      id: 'tht_bni',
      title: 'Tabungan Hari Tua dan/atau BNI Simponi',
      formula: 'Potongan THT / BNI Simponi Sesuai Profil',
      bullets: [
        'Potongan tabungan pensiun / hari tua melalui program Tabungan Hari Tua (THT) dan/atau BNI Simponi',
        'Nominal sesuai dengan kesepakatan dan profil kepegawaian',
      ],
      matchLabels: ['TABUNGAN HARI TUA DAN/ATAU BNI SIMPONI', 'TABUNGAN HARI TUA BNI SIMPONI', 'THT', 'BNI SIMPONI'],
    },
    {
      id: 'tabungan',
      title: 'Tabungan',
      formula: 'Potongan Tabungan Tetap Bulanan',
      bullets: [
        'Potongan tabungan wajib pegawai yang disisihkan setiap bulan',
        'Nominal berdasarkan kebijakan internal atau kesepakatan pegawai',
      ],
      matchLabels: ['TABUNGAN'],
    },
    {
      id: 'zakat',
      title: 'Zakat Infaq Sodaqoh',
      formula: 'Nominal Zakat / Infaq / Sodaqoh',
      bullets: [
        'Potongan zakat profesi, infaq, atau sodaqoh yang disalurkan melalui lembaga',
        'Bersifat sukarela sesuai komitmen pegawai',
      ],
      matchLabels: ['ZAKAT INFAQ SODAQOH', 'ZAKAT'],
    },
    {
      id: 'revisi_gaji',
      title: 'Revisi Gaji',
      formula: 'Penyesuaian / Koreksi Manual',
      bullets: [
        'Digunakan untuk koreksi atau penyesuaian gaji bulan sebelumnya',
        'Misalnya: kelebihan bayar bulan lalu atau koreksi input',
      ],
      matchLabels: ['REVISI GAJI'],
    },
    {
      id: 'pinlu_tagihan',
      title: 'Pinlu / Tagihan',
      formula: 'Pinjaman Lunak + Tagihan Lain',
      bullets: [
        'Potongan pinjaman lunak (Pinlu) dari lembaga',
        'Termasuk tagihan-tagihan resmi lainnya yang perlu dicicil/dibayar dari gaji',
      ],
      matchLabels: ['PINLU/TAGIHAN', 'PINLU', 'TAGIHAN'],
    },
    {
      id: 'pinjaman_kop',
      title: 'Pinjaman Kop. UNIPDU',
      formula: 'Cicilan Pinjaman Koperasi UNIPDU',
      bullets: [
        'Angsuran bulanan pinjaman dari Koperasi UNIPDU',
        'Dipotong otomatis dari gaji berdasarkan jadwal angsuran',
      ],
      matchLabels: ['PINJAMAN KOP. UNIPDU', 'PINJAMAN KOPERASI'],
    },
    {
      id: 'potongan_presensi',
      title: 'Potongan Presensi',
      formula: 'Delta Menit Absensi × Rp 27,5',
      bullets: [
        'Potongan berdasarkan selisih antara waktu kehadiran aktual dan target waktu kerja',
        'Dihitung dari jumlah menit keterlambatan / kekurangan jam kerja',
      ],
      matchLabels: ['POTONGAN PRESENSI'],
    },
    {
      id: 'potongan_bonus_presensi',
      title: 'Potongan Bonus Presensi',
      formula: 'Pengurangan dari Bonus Presensi',
      bullets: [
        'Pengurangan dari Bonus Presensi berdasarkan pelanggaran kedisiplinan',
        'Nominal dipotong sesuai tingkat pelanggaran presensi',
      ],
      matchLabels: ['POTONGAN BONUS PRESENSI'],
    },
    {
      id: 'iuran_wajib_kop',
      title: 'Iuran Wajib Kop. UNIPDU',
      formula: 'Iuran Wajib Bulanan Koperasi',
      bullets: [
        'Iuran simpanan wajib bulanan sebagai anggota Koperasi UNIPDU',
        'Nominal tetap sesuai ketentuan koperasi',
      ],
      matchLabels: ['IURAN WAJIB KOP. UNIPDU', 'IURAN WAJIB KOPERASI'],
    },
  ], []);

  const activeDeductionDocs = useMemo(() => {
    const hasLoanTimeline = koperasiLoansInfo.length > 0;
    const activeFields = deductions.filter((d: PaySlipField) => {
      if (d.amount && d.amount > 0) return true;
      // Show an authoritative pending/restructured timeline even when the
      // current payroll policy correctly produces a Rp 0 deduction.
      return hasLoanTimeline && d.label.trim().toUpperCase().includes('PINJAMAN KOP');
    });
    return activeFields.map((field: PaySlipField) => {
      const fieldUpper = field.label.trim().toUpperCase();
      const docDef = allDeductionDocs.find(doc =>
        doc.matchLabels.some(ml => fieldUpper === ml || fieldUpper.includes(ml) || ml.includes(fieldUpper))
      );
      if (docDef) {
        return {
          id: docDef.id,
          title: docDef.title,
          formula: docDef.formula,
          bullets: docDef.bullets,
          fieldLabel: field.label,
          amount: field.amount,
        };
      }
      return {
        id: `custom_deduction_${field.label}`,
        title: field.label,
        formula: 'Nominal Potongan Spesifik',
        bullets: [`Potongan ${field.label} yang dibebankan pada periode ini`],
        fieldLabel: field.label,
        amount: field.amount,
      };
    });
  }, [deductions, allDeductionDocs, koperasiLoansInfo]);

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

  const DocRow = ({ label, value, highlight, tone = 'positive' }: {
    label: string;
    value: React.ReactNode;
    highlight?: boolean;
    tone?: 'positive' | 'negative';
  }) => {
    const valueColor = tone === 'negative' ? 'text-rose-600' : 'text-emerald-600';
    return (
      <>
        <div className={`pr-4 font-semibold text-xs sm:text-sm ${highlight ? 'text-indigo-600 font-bold' : 'text-black'}`}>
          {label}
        </div>
        <div className="text-center text-indigo-600 font-bold text-xs sm:text-sm">:</div>
        <div className={`pl-2 text-xs sm:text-sm ${highlight ? `${valueColor} font-extrabold` : 'text-black font-bold'}`}>
          {value}
        </div>
      </>
    );
  };

  // Client-side PDF trigger
  const handleDownloadPdf = () => {
    if (!employeeData || !isConfirmed) return;
    const isLoyalis = profile?.role !== 'honorer' && profile?.role !== 'ketua_shift_satpam';
    const slipData: PaySlipData = {
      employeeName: employeeData.personal_info?.name || profile?.displayName || 'Karyawan',
      employeeNo: 1, // Placeholder
      period: periodText,
      jobCategory: isLoyalis ? `STAF ${employeeData.employment_profile?.department_unit || 'STAF'}` : (employeeData.employment?.jobCategory || 'PEKARYA'),
      earnings: earnings,
      deductions: deductions,
      taxes: taxes,
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
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 relative overflow-hidden">
        <div className="max-w-md w-full rounded-2xl border border-slate-200 bg-white p-8 text-center space-y-4 relative z-10 animate-in zoom-in-95 duration-200">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-rose-50 flex items-center justify-center">
            <AlertCircle className="w-8 h-8 text-rose-500" />
          </div>
          <h2 className="text-xl font-bold text-black">Akun Belum Dihubungkan</h2>
          <p className="text-sm text-black leading-relaxed">
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
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white font-sans selection:bg-indigo-100 relative text-black pb-16">

      {/* ── Header Navbar ──────────────────────────────────────────────── */}
      <div className="sticky top-0 z-30 bg-white/80 backdrop-blur-xl border-b border-slate-100 shadow-sm relative z-20">
        <div className="max-w-5xl mx-auto px-3.5 sm:px-8 md:px-12 py-3 sm:py-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-400 flex items-center justify-center shadow-lg shadow-indigo-200 shrink-0">
              <FileText className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
            </div>
            <div className="min-w-0 shrink">
              <h1 className="text-xs sm:text-base font-bold text-black leading-tight truncate">Slip Gaji</h1>
              <p className="text-[10px] sm:text-xs text-black font-semibold">{profile.displayName || 'Karyawan'}</p>
            </div>
          </div>
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            <EmployeeNavigationMenu />

            {profile.role === 'loyalis' && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="outline"
                      size="icon"
                      className="text-black hover:text-indigo-650 hover:bg-slate-50 border-slate-200 bg-white rounded-xl h-8 w-8 sm:h-9 sm:w-9 flex items-center justify-center shadow-sm cursor-pointer shrink-0"
                      title="Menu"
                    />
                  }
                >
                  <MenuIcon className="w-4 h-4 sm:w-4.5 sm:h-4.5 text-indigo-500" />
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem render={<Link href="/employee/presensi-correction" />}>
                    <CalendarCheck className="text-indigo-500" />
                    Ajukan Presensi
                  </DropdownMenuItem>
                  <DropdownMenuItem render={<Link href="/employee/facility-reports" />}>
                    <Wrench className="text-amber-500" />
                    Lapor Fasilitas
                  </DropdownMenuItem>
                  <DropdownMenuItem render={<Link href="/employee/simpan-pinjam" />}>
                    <Banknote className="text-emerald-500" />
                    Simpan Pinjam
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handlePasswordReset} disabled={resetLoading}>
                    {resetLoading ? (
                      <Loader2 className="text-indigo-500 animate-spin" />
                    ) : (
                      <KeyRound className="text-indigo-500" />
                    )}
                    Ubah Password
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            <Button
              onClick={() => logout()}
              variant="ghost"
              size="icon"
              className="text-black hover:text-rose-500 rounded-xl h-8 w-8 sm:h-9 sm:w-9 border border-slate-150/40 bg-white shadow-sm flex items-center justify-center cursor-pointer shrink-0"
              title="Keluar"
            >
              <LogOut className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Floating Action Notifications */}
      <FloatingSnackbar
        message={resetError
          ? { type: 'error', text: resetError }
          : resetSuccess
            ? { type: 'success', text: resetSuccess }
            : null}
        title={resetError ? 'Gagal Mengirim Email' : resetSuccess ? 'Email Terkirim' : undefined}
      />

      <div className="max-w-4xl mx-auto px-6 sm:px-8 md:px-12 mt-8 space-y-6 relative z-10">

        {/* ── Period Selector Control ────────────────────────────────────── */}
        <div className="py-3.5 px-5 bg-slate-50/80 rounded-2xl border border-slate-100 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3 w-full md:w-auto">
            <CalendarDays className="w-5 h-5 text-indigo-500 shrink-0" />
            <span className="text-sm font-semibold text-black">Periode:</span>
          </div>
          <div className="grid grid-cols-2 gap-3 w-full md:flex md:w-auto md:items-center">
            <Select value={String(month)} onValueChange={(v) => v && setMonth(parseInt(v))}>
              <SelectTrigger className="text-sm font-bold text-black bg-white rounded-xl border border-slate-200 h-10 px-4 w-full md:w-40 focus:ring-indigo-500/20">
                <SelectValue>
                  {availableMonths.find((m) => m.value === month)?.label || MONTHS_ID[month - 1]}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="rounded-xl border-slate-100 shadow-lg bg-white z-40">
                {availableMonths.map((m) => (
                  <SelectItem key={m.value} value={String(m.value)}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={String(year)} onValueChange={(v) => v && setYear(parseInt(v))}>
              <SelectTrigger className="text-sm font-bold text-black bg-white rounded-xl border border-slate-200 h-10 px-4 w-full md:w-28 focus:ring-indigo-500/20">
                <SelectValue>{year}</SelectValue>
              </SelectTrigger>
              <SelectContent className="rounded-xl border-slate-100 shadow-lg bg-white z-40">
                {availableYears.map(y => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* ── Loading Spinner ── */}
        {loading ? (
          <div className="py-24 flex flex-col items-center justify-center text-black">
            <Loader2 className="w-10 h-10 animate-spin text-indigo-500 mb-4" />
            <p className="text-sm font-semibold animate-pulse">Memuat rincian slip gaji...</p>
          </div>
        ) : !employeeData ? (
          <div className="py-16 text-center text-black bg-slate-50/50 rounded-2xl border border-slate-100">
            <AlertCircle className="w-12 h-12 text-rose-500 mx-auto mb-4" />
            <p className="text-sm font-semibold">Data karyawan gagal dimuat.</p>
          </div>
        ) : pekaryaPreviewError ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-rose-200 bg-rose-50 px-6 py-16 text-center">
            <AlertCircle className="mb-4 h-12 w-12 text-rose-500" />
            <p className="text-base font-bold text-slate-800">
              Rincian Pekarya Tidak Tersedia
            </p>
            <p className="mt-2 max-w-lg text-sm text-slate-600">
              {pekaryaPreviewError} Nilai slip disembunyikan agar perhitungan lama
              tidak ditampilkan sebagai nilai resmi.
            </p>
            <Button
              type="button"
              className="mt-5 rounded-xl bg-rose-600 text-white hover:bg-rose-700"
              onClick={() =>
                setPekaryaPreviewReloadToken((token) => token + 1)
              }
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Coba Lagi
            </Button>
          </div>
        ) : (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">

            {/* ─── PAYSLIP SCREEN DISPLAY ─────────────────────────────────── */}
            <div>

              {/* Kop Surat Header */}
              <div className="py-6 border-b border-slate-200 flex flex-col items-center text-center relative">

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

                <h3 className="text-xs font-bold text-black tracking-wider uppercase">YAYASAN PESANTREN TINGGI DARUL 'ULUM</h3>
                <h2 className="text-sm font-extrabold text-black tracking-wide mt-1 uppercase">UNIVERSITAS PESANTREN TINGGI DARUL 'ULUM</h2>
                <p className="text-[10px] text-black font-medium mt-1">Pondok Pesantren Darul 'Ulum Peterongan Jombang 61481 Telp. (0321) 873655</p>
              </div>

              {/* Payslip Details Section */}
              <div className="py-6 border-b border-slate-200">
                <div className="flex flex-col md:flex-row justify-between gap-4">
                  <div className="space-y-1.5">
                    <span className="text-[10px] font-bold text-black uppercase tracking-widest block">NAMA PEGAWAI</span>
                    <span className="text-base font-extrabold text-black uppercase tracking-tight">
                      {employeeData.personal_info?.name || profile.displayName || '-'}
                    </span>
                    <div className="flex items-center gap-2 mt-0.5 text-xs font-semibold text-black">
                      <span>NIY: {employeeData.personal_info?.employee_id_niy || '-'}</span>
                      <span className="text-black">•</span>
                      <span>NPWP: {employeeData.personal_info?.tax_id_npwp || '-'}</span>
                    </div>
                  </div>

                  <div className="space-y-1.5 md:text-right">
                    <span className="text-[10px] font-bold text-black uppercase tracking-widest block">PERIODE SLIP</span>
                    <span className="text-sm font-bold text-indigo-600 block">{periodText.toUpperCase()}</span>
                    <span className="text-[11px] font-bold bg-indigo-50 text-indigo-700 px-2.5 py-0.5 rounded-full inline-block">
                      {profile?.role === 'loyalis'
                        ? `STAF ${employeeData.employment_profile?.department_unit || 'LOYALIS'}`
                        : `VAKASI ${employeeData.employment?.jobCategory || 'PEKARYA'}`}
                    </span>
                  </div>
                </div>
              </div>

              {/* Earnings & Deductions Tables */}
              <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-200 border-b border-slate-200">

                {/* Earnings List */}
                <div className="py-6 md:pr-8 space-y-4">
                  <h4 className="text-xs font-bold text-emerald-700 uppercase tracking-widest flex items-center gap-1.5">
                    <TrendingUp className="w-4 h-4 text-emerald-500" />
                    I. PENERIMAAN
                  </h4>
                  <div className="space-y-2.5 divide-y divide-slate-100">
                    {earnings.map((item: PaySlipField, idx: number) => (
                      <div key={idx} className="flex justify-between items-center pt-2 text-xs font-medium">
                        <span className="text-black uppercase max-w-[200px] truncate" title={item.label}>
                          {item.label}
                        </span>
                        <span className="text-black font-semibold tabular-nums">
                          {item.amount > 0 ? formatIDR(item.amount) : '-'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Deductions List */}
                <div className="py-6 md:pl-8 space-y-4">
                  <h4 className="text-xs font-bold text-rose-700 uppercase tracking-widest flex items-center gap-1.5">
                    <TrendingDown className="w-4 h-4 text-rose-500" />
                    II. POTONGAN
                  </h4>
                  <div className="space-y-2.5 divide-y divide-slate-100">
                    {deductions
                      .filter((item: PaySlipField) => item.amount && item.amount > 0)
                      .map((item: PaySlipField, idx: number) => (
                        <div key={idx} className="flex justify-between items-center pt-2 text-xs font-medium">
                          <span className="text-black uppercase max-w-[200px] truncate" title={item.label}>
                            {item.label}
                          </span>
                          <span className="text-black font-semibold tabular-nums">
                            {formatIDR(item.amount)}
                          </span>
                        </div>
                      ))}
                    {deductions.filter((item: PaySlipField) => item.amount && item.amount > 0).length === 0 && (
                      <div className="flex justify-between items-center pt-2 text-xs font-medium text-black italic">
                        <span>TIDAK ADA POTONGAN</span>
                        <span>-</span>
                      </div>
                    )}
                  </div>

                  {/* Pajak — its own category, listed after Potongan */}
                  <div className="pt-5 mt-5 border-t border-slate-200 space-y-4">
                    <h4 className="text-xs font-bold text-amber-700 uppercase tracking-widest flex items-center gap-1.5">
                      <Landmark className="w-4 h-4 text-amber-500" />
                      III. PAJAK
                    </h4>
                    <div className="space-y-2.5 divide-y divide-slate-100">
                      {taxes.length > 0 ? (
                        taxes.map((item: PaySlipField, idx: number) => (
                          <div key={idx} className="flex justify-between items-center pt-2 text-xs font-medium">
                            <span className="text-black uppercase max-w-[200px] truncate" title={item.label}>
                              {item.label}
                            </span>
                            <span className="text-black font-semibold tabular-nums">
                              {formatIDR(item.amount)}
                            </span>
                          </div>
                        ))
                      ) : (
                        <div className="flex justify-between items-center pt-2 text-xs font-medium text-black italic">
                          <span>TIDAK ADA PAJAK</span>
                          <span>-</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

              </div>

              {/* Summary Totals Footer */}
              <div className={`grid grid-cols-1 ${totalTax > 0 ? 'md:grid-cols-3' : 'md:grid-cols-2'} bg-slate-50/50 border-b border-slate-200 rounded-xl my-4`}>
                <div className="px-6 py-4 flex justify-between items-center text-xs font-bold border-b md:border-b-0 divide-x-0 border-slate-200">
                  <span className="text-emerald-700 uppercase">JUMLAH PENERIMAAN</span>
                  <span className="text-emerald-700 tabular-nums">{formatIDR(totalEarnings)}</span>
                </div>
                <div className="px-6 py-4 flex justify-between items-center text-xs font-bold border-b md:border-b-0 border-slate-200">
                  <span className="text-rose-700 uppercase">JUMLAH POTONGAN</span>
                  <span className="text-rose-700 tabular-nums">{formatIDR(totalDeductions)}</span>
                </div>
                {totalTax > 0 && (
                  <div className="px-6 py-4 flex justify-between items-center text-xs font-bold">
                    <span className="text-amber-700 uppercase">JUMLAH PAJAK</span>
                    <span className="text-amber-700 tabular-nums">{formatIDR(totalTax)}</span>
                  </div>
                )}
              </div>

              {/* NET SALARY CARD BOX */}
              <div className="py-6 px-4 sm:px-6 bg-gradient-to-r from-indigo-50/40 via-indigo-50/70 to-purple-50/40 border border-indigo-100/80 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-4 my-6">
                <div>
                  <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest block">PENERIMAAN BERSIH</span>
                  <span className="text-3xl font-extrabold text-indigo-800 tracking-tight block mt-0.5 tabular-nums">
                    {formatIDR(netSalary)}
                  </span>
                </div>
                <div className="bg-white/90 border border-indigo-100/50 rounded-2xl p-4 max-w-md w-full md:w-auto">
                  <span className="text-[9px] font-bold text-black uppercase tracking-widest block mb-1">Terbilang</span>
                  <p className="text-xs font-bold text-black leading-normal italic">
                    "{terbilang(netSalary)} Rupiah"
                  </p>
                </div>
              </div>

              {/* Documentation Section */}
              <div className="border-t border-slate-200 pt-6">
                <div
                  onClick={() => setShowDoc(!showDoc)}
                  className="py-4 flex items-center justify-between cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center shrink-0">
                      <BookOpen className="w-4.5 h-4.5 text-indigo-500" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-black uppercase tracking-wider">Panduan Perhitungan Gaji</h3>
                      <p className="text-xs text-black font-medium mt-1">Klik untuk {showDoc ? 'menyembunyikan' : 'melihat'} detail formula dan logika perhitungan</p>
                    </div>
                  </div>
                  <div className="shrink-0 text-black">
                    {showDoc ? (
                      <ChevronUp className="w-5 h-5 text-indigo-500" />
                    ) : (
                      <ChevronDown className="w-5 h-5" />
                    )}
                  </div>
                </div>

                {showDoc && (() => {
                  const earningsDocs = profile?.role === 'loyalis' ? payrollDocumentation : pekaryaPayrollDocumentation;

                  return (
                    <div className="animate-in fade-in slide-in-from-top-2 duration-200 space-y-6 pt-2">
                      {/* ── Penerimaan ── */}
                      <div className="py-4 space-y-6">
                        <div className="flex items-center gap-2">
                          <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
                          <span className="text-xs font-bold text-emerald-700 uppercase tracking-widest">Penerimaan</span>
                        </div>
                        {earningsDocs.map((item: any, idx: number) => (
                          <div key={item.id}>
                            {/* Section Header */}
                            <div className="mb-2">
                              <h4 className="text-sm font-bold text-black tracking-wide">
                                {idx + 1}. {item.title.toUpperCase()}
                              </h4>
                            </div>

                            {/* Bullet Points (Only shown when no table is present) */}
                            {!item.table && item.bullets && item.bullets.length > 0 && (
                              <ul className="space-y-1 ml-4 pl-0">
                                {item.bullets.map((bullet: string, bIdx: number) => (
                                  <li key={bIdx} className="flex items-start gap-2 text-xs sm:text-sm text-black leading-relaxed">
                                    <span className="mt-2 w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0" />
                                    <span>{bullet}</span>
                                  </li>
                                ))}
                              </ul>
                            )}

                            {/* Optional Table */}
                            {item.table && (
                              <div className="mt-3 ml-0 w-full overflow-x-auto">
                                <table className="min-w-full divide-y divide-slate-200 border border-slate-200/70 rounded-xl overflow-hidden text-xs">
                                  <thead className="bg-slate-50">
                                    <tr>
                                      {item.table.headers.map((h: string, hIdx: number) => (
                                        <th key={hIdx} className="px-3 py-2 text-left font-bold text-black uppercase tracking-wider">{h}</th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100 bg-white">
                                    {item.table.rows.map((r: string[], rIdx: number) => (
                                      <tr key={rIdx} className="hover:bg-slate-50/50">
                                        {r.map((cell: string, cIdx: number) => (
                                          <td key={cIdx} className="px-3 py-2 text-black font-medium">{cell}</td>
                                        ))}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}

                            {/* Optional variables display — Loyalis */}
                            {profile?.role === 'loyalis' && userVariables && (
                              <div className="mt-3 ml-0 w-full py-2 animate-in fade-in duration-200">
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
                                      const earning = userVariables.presensiEarningVal;
                                      const deduction = userVariables.potonganPresensiVal;
                                      const netPresensi = Math.max(0, earning - deduction);
                                      const bonusEarning = userVariables.bonusPresensiVal;
                                      const bonusDeduction = userVariables.potonganBonusPresensiVal;
                                      const netBonus = Math.max(0, bonusEarning - bonusDeduction);

                                      const targetMinutes = presenceInfo?.workingDays && presenceInfo?.expectedHours && presenceInfo.workingDays > 0 && presenceInfo.expectedHours > 0
                                        ? Math.round(presenceInfo.workingDays * presenceInfo.expectedHours * 60)
                                        : (earning > 0 ? Math.round(earning / 27.5) : 9750);

                                      const absenceMinutes = presenceInfo?.absenceMinutes && presenceInfo.absenceMinutes > 0
                                        ? presenceInfo.absenceMinutes
                                        : (deduction > 0 ? Math.round(deduction / 27.5) : 0);

                                      const actualMinutes = Math.max(0, targetMinutes - absenceMinutes);

                                      const wDays = presenceInfo?.workingDays && presenceInfo.workingDays > 0
                                        ? presenceInfo.workingDays
                                        : (Math.round(targetMinutes / (6.5 * 60)) || 25);

                                      let stratum = 5;
                                      let statusText = '';
                                      if (bonusDeduction === 0) { stratum = 1; statusText = 'Kekurangan = 0 menit'; }
                                      else if (bonusDeduction <= 100000) { stratum = 2; statusText = `Kekurangan ≤ ${(wDays * 30).toLocaleString('id-ID')} menit`; }
                                      else if (bonusDeduction <= 150000) { stratum = 3; statusText = `Kekurangan ≤ ${(wDays * 35).toLocaleString('id-ID')} menit`; }
                                      else if (bonusDeduction <= 200000) { stratum = 4; statusText = `Kekurangan ≤ ${(wDays * 40).toLocaleString('id-ID')} menit`; }
                                      else { stratum = 5; statusText = `Kekurangan > ${(wDays * 40).toLocaleString('id-ID')} menit`; }
                                      return (
                                        <>
                                          <DocRow label="Hari Kerja Aktif" value={`${wDays} hari`} />
                                          <DocRow label="Total Waktu Kerja" value={`${targetMinutes.toLocaleString('id-ID')} menit`} />
                                          <DocRow label="Waktu Dikerjakan" value={`${actualMinutes.toLocaleString('id-ID')} menit`} />
                                          <DocRow label="Bersih Presensi" value={formatIDR(netPresensi)} highlight />
                                          <div style={{ gridColumn: '1 / -1' }} className="text-[11px] text-black font-mono font-normal mt-1 mb-2 leading-relaxed border-l-2 border-slate-200 pl-3">
                                            = ({targetMinutes.toLocaleString('id-ID')} x Rp27,5) - (({targetMinutes.toLocaleString('id-ID')} - {actualMinutes.toLocaleString('id-ID')}) x Rp27,5)<br />
                                            = {formatIDR(earning).replace(/\s+/g, '')} - ({absenceMinutes.toLocaleString('id-ID')} x Rp27,5)<br />
                                            = {formatIDR(earning).replace(/\s+/g, '')} - {formatIDR(deduction).replace(/\s+/g, '')}<br />
                                            = {formatIDR(netPresensi).replace(/\s+/g, '')}
                                          </div>
                                          <DocRow label="Bersih Bonus Presensi" value={formatIDR(netBonus)} highlight />
                                          <div style={{ gridColumn: '1 / -1' }} className="text-[11px] text-black font-normal mt-1 mb-2 leading-relaxed border-l-2 border-slate-200 pl-3">
                                            Stratum {stratum} ({statusText})<br />
                                            = {formatIDR(bonusEarning).replace(/\s+/g, '')} - {formatIDR(bonusDeduction).replace(/\s+/g, '')}
                                            <div className="block text-[10px] text-black mt-2 leading-normal font-light border-t border-slate-200 pt-2">
                                              <strong>Ketentuan Bonus Presensi:</strong><br />
                                              • Stratum 1 (0 mnt): Potongan Rp0 (Sisa Rp250rb)<br />
                                              • Stratum 2 (≤ {(wDays * 30).toLocaleString('id-ID')} mnt): Potongan Rp100rb (Sisa Rp150rb)<br />
                                              • Stratum 3 (≤ {(wDays * 35).toLocaleString('id-ID')} mnt): Potongan Rp150rb (Sisa Rp100rb)<br />
                                              • Stratum 4 (≤ {(wDays * 40).toLocaleString('id-ID')} mnt): Potongan Rp200rb (Sisa Rp50rb)<br />
                                              • Stratum 5 (&gt; {(wDays * 40).toLocaleString('id-ID')} mnt): Potongan Rp250rb (Sisa Rp0)
                                            </div>
                                          </div>

                                          <DailyPresenceLogDetails
                                            logs={dailyPresenceLogs}
                                            source={dailyPresenceLogSource}
                                            expanded={showDailyLogs}
                                            onToggle={() => setShowDailyLogs(!showDailyLogs)}
                                          />
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
                                      <>{vakasiEvents.map((evt, eIdx) => <DocRow key={eIdx} label={evt.eventName} value={formatIDR(evt.payGiven)} />)}</>
                                    ) : (
                                      <div className="col-span-3 text-xs text-black italic mb-1">Tidak ada kegiatan resmi terdaftar pada periode ini</div>
                                    )}
                                    <DocRow label="Total Vakasi Tambahan" value={formatIDR(earnings.filter((e: PaySlipField) => !['GAJI POKOK', 'T. KELUARGA', 'TUNJANGAN KELUARGA', 'T. FUNGSIONAL', 'TUNJANGAN FUNGSIONAL', 'KEPANGKATAN', 'T. INSTRUKSIONAL', 'INSTRUKSIONAL', 'T. HARI TUA', 'TUNJANGAN HARI TUA', 'T. BPJS TK', 'BPJS TK', 'T. BPJS KES', 'BPJS KES', 'BERAS', 'PRESENSI', 'BONUS PRESENSI', 'PIKET', 'LEMBUR'].includes(e.label.toUpperCase()) && !e.label.toUpperCase().startsWith('STRUKTURAL:')).reduce((sum: number, e: PaySlipField) => sum + e.amount, 0))} highlight />
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Pekarya variables display card */}
                            {profile?.role !== 'loyalis' && (
                              <div className="mt-3 ml-0 w-full py-2 animate-in fade-in duration-200">
                                {(() => {
                                  const getEarningAmount = (labels: string[]) => {
                                    const match = earnings.find((e: PaySlipField) => labels.some(l => e.label.toUpperCase() === l.toUpperCase() || e.label.toUpperCase().includes(l.toUpperCase())));
                                    return match ? match.amount : 0;
                                  };
                                  if (item.id === 'gapok_pekarya') {
                                    const gapokVal = getEarningAmount(['GAJI POKOK']) || (employeeData?.salaryProfile?.baseSalaryAmount || 0);
                                    return (<div className="grid grid-cols-[auto_24px_1fr] gap-y-1.5 items-baseline"><DocRow label="Kategori Pegawai" value={employeeData?.employment?.jobCategory || 'PEKARYA'} /><DocRow label="Gaji Pokok" value={formatIDR(gapokVal)} highlight /></div>);
                                  }
                                  if (item.id === 'vakasi_jumat_lembur') {
                                    const userJobCategory = (employeeData?.employment?.jobCategory || 'PEKARYA').toUpperCase();
                                    const isSatpam = userJobCategory === 'SATPAM';
                                    const isKebersihan = userJobCategory.startsWith('KEBERSIHAN');
                                    const isTeknisi = userJobCategory === 'TEKNISI';
                                    const isSopir = userJobCategory === 'SOPIR';
                                    const harianVal = getEarningAmount(['PRESENSI HARIAN', 'VAKASI HARIAN', 'HARIAN']);
                                    const jumatVal = getEarningAmount(['JUMAT & LIBUR', 'BONUS JUM\'AT', 'JUMAT']);
                                    const lemburSendiriVal = getEarningAmount(['LEMBUR SENDIRI']);
                                    const lemburCoverVal = getEarningAmount(['LEMBUR COVER']);
                                    const lemburVal = getEarningAmount(['LEMBUR']);
                                    const piketVal = getEarningAmount(['PIKET']);
                                    const praktekVal = getEarningAmount(['PRAKTEK']);
                                    if (isSatpam) return (<div className="grid grid-cols-[auto_24px_1fr] gap-y-1.5 items-baseline"><DocRow label="Vakasi Harian" value={formatIDR(harianVal)} /><DocRow label="Jumat & Libur" value={formatIDR(jumatVal)} /><DocRow label="Lembur Sendiri" value={formatIDR(lemburSendiriVal)} /><DocRow label="Lembur Cover" value={formatIDR(lemburCoverVal)} /><DocRow label="Total Insentif Shift" value={formatIDR(harianVal + jumatVal + lemburSendiriVal + lemburCoverVal)} highlight /></div>);
                                    const dailyLogDetails = (
                                      <DailyPresenceLogDetails
                                        logs={dailyPresenceLogs}
                                        source={dailyPresenceLogSource}
                                        expanded={showDailyLogs}
                                        onToggle={() => setShowDailyLogs(!showDailyLogs)}
                                      />
                                    );
                                    if (isKebersihan) return (<div className="grid grid-cols-[auto_24px_1fr] gap-y-1.5 items-baseline"><DocRow label="Presensi Harian" value={formatIDR(harianVal)} /><DocRow label="Jumat & Libur" value={formatIDR(jumatVal)} /><DocRow label="Total Upah Presensi" value={formatIDR(harianVal + jumatVal)} highlight />{dailyLogDetails}</div>);
                                    if (isTeknisi) return (<div className="grid grid-cols-[auto_24px_1fr] gap-y-1.5 items-baseline"><DocRow label="Presensi Harian" value={formatIDR(harianVal)} /><DocRow label="Jumat & Libur" value={formatIDR(jumatVal)} /><DocRow label="Lembur" value={formatIDR(lemburVal)} /><DocRow label="Total Presensi & Lembur" value={formatIDR(harianVal + jumatVal + lemburVal)} highlight />{dailyLogDetails}</div>);
                                    if (isSopir) return (<div className="grid grid-cols-[auto_24px_1fr] gap-y-1.5 items-baseline"><DocRow label="Presensi Harian" value={formatIDR(harianVal)} /><DocRow label="Jumat & Libur" value={formatIDR(jumatVal)} /><DocRow label="Piket" value={formatIDR(piketVal)} /><DocRow label="Praktek" value={formatIDR(praktekVal)} /><DocRow label="Total Presensi & Tugas" value={formatIDR(harianVal + jumatVal + piketVal + praktekVal)} highlight />{dailyLogDetails}</div>);
                                    return (<div className="grid grid-cols-[auto_24px_1fr] gap-y-1.5 items-baseline"><DocRow label="Presensi Harian" value={formatIDR(harianVal)} /><DocRow label="Jumat & Libur" value={formatIDR(jumatVal)} /><DocRow label="Total Upah Presensi" value={formatIDR(harianVal + jumatVal)} highlight />{dailyLogDetails}</div>);
                                  }
                                  if (item.id === 'bonus_presensi_pekarya') {
                                    const userJobCategory = (employeeData?.employment?.jobCategory || 'PEKARYA').toUpperCase();
                                    if (userJobCategory === 'SATPAM') {
                                      const tunjanganJabatanVal = getEarningAmount(['TUNJANGAN JABATAN']);
                                      return (<div className="grid grid-cols-[auto_24px_1fr] gap-y-1.5 items-baseline"><DocRow label="Tunjangan Jabatan" value={formatIDR(tunjanganJabatanVal)} highlight /></div>);
                                    }
                                    const bonusVal = getEarningAmount(['BONUS PRESENSI', 'BONUS PRESENSI BULANAN', 'BONUS PRESENSI TRIWULANAN', 'BONUS MUTLAK']);
                                    return (<div className="grid grid-cols-[auto_24px_1fr] gap-y-1.5 items-baseline"><DocRow label="Bonus Presensi" value={formatIDR(bonusVal)} highlight /></div>);
                                  }
                                  if (item.id === 'spj_pekarya_doc') {
                                    const spjVal = getEarningAmount(['SPJ']);
                                    return (<div className="grid grid-cols-[auto_24px_1fr] gap-y-1.5 items-baseline"><DocRow label="Total SPJ Disetujui" value={formatIDR(spjVal)} highlight /></div>);
                                  }
                                  if (item.id === 'bpjs_beras_pekarya') {
                                    const bpjsVal = getEarningAmount(['BPJS (TUNJANGAN)', 'BPJS']);
                                    const berasVal = getEarningAmount(['TUNJANGAN BERAS', 'BERAS']);
                                    const tunjKhususVal = getEarningAmount(['TUNJANGAN KHUSUS']);
                                    const tunjJabatanVal = getEarningAmount(['TUNJANGAN JABATAN']);
                                    return (<div className="grid grid-cols-[auto_24px_1fr] gap-y-1.5 items-baseline"><DocRow label="T. BPJS (Subsidi)" value={formatIDR(bpjsVal)} /><DocRow label="Tunjangan Beras" value={formatIDR(berasVal)} />{tunjKhususVal > 0 && <DocRow label="Tunjangan Khusus" value={formatIDR(tunjKhususVal)} />}{tunjJabatanVal > 0 && <DocRow label="Tunjangan Jabatan" value={formatIDR(tunjJabatanVal)} />}<DocRow label="Total Tunjangan Tambahan" value={formatIDR(bpjsVal + berasVal + tunjKhususVal + tunjJabatanVal)} highlight /></div>);
                                  }
                                  return null;
                                })()}
                              </div>
                            )}

                            {/* Separator */}
                            {idx < earningsDocs.length - 1 && <div className="h-px bg-slate-100/80 mt-5" />}
                          </div>
                        ))}
                      </div>

                      {/* ── Pajak ── */}
                      {taxes.length > 0 && (
                        <div className="py-6 border-t border-slate-200 space-y-6">
                          <div className="flex items-center gap-2">
                            <Landmark className="w-3.5 h-3.5 text-amber-600" />
                            <span className="text-xs font-bold text-amber-700 uppercase tracking-widest">Pajak</span>
                          </div>
                          {taxes.map((item: PaySlipField, idx: number) => (
                            <div key={`tax-doc-${idx}`}>
                              <div className="mb-2">
                                <h4 className="text-sm font-bold text-black tracking-wide">
                                  {idx + 1}. {item.label.toUpperCase()}
                                </h4>
                              </div>
                              <ul className="space-y-1 ml-4 pl-0">
                                {[
                                  `Pajak penghasilan dikenakan ketika gaji bersih (penerimaan dikurangi potongan) mencapai ${formatIDR(PAYROLL_TAX_THRESHOLD)}.`,
                                  'Tarif 5% dihitung dari gaji bersih sebelum pajak, bukan dari salah satu komponen penerimaan.',
                                  'Pajak dicatat sebagai kategori tersendiri dan tidak termasuk dalam daftar Potongan.',
                                ].map((bullet: string, bIdx: number) => (
                                  <li key={bIdx} className="flex items-start gap-2 text-xs sm:text-sm text-black leading-relaxed">
                                    <span className="mt-2 w-1.5 h-1.5 rounded-full bg-black shrink-0" />
                                    <span>{bullet}</span>
                                  </li>
                                ))}
                              </ul>
                              <div className="mt-3 ml-4 rounded-2xl border border-amber-100 bg-amber-50/50 p-4 space-y-2">
                                <div className="flex justify-between items-center text-xs">
                                  <span className="text-black font-medium">Dasar Pengenaan (Gaji Bersih Sebelum Pajak)</span>
                                  <span className="text-black font-semibold tabular-nums">{formatIDR(taxBase)}</span>
                                </div>
                                <div className="flex justify-between items-center text-xs">
                                  <span className="text-black font-medium">Tarif</span>
                                  <span className="text-black font-semibold tabular-nums">5%</span>
                                </div>
                                <div className="flex justify-between items-center text-xs pt-2 border-t border-amber-100">
                                  <span className="text-amber-800 font-bold uppercase">Nominal Pajak</span>
                                  <span className="text-amber-800 font-bold tabular-nums">{formatIDR(item.amount)}</span>
                                </div>
                              </div>
                              {idx < taxes.length - 1 && <div className="h-px bg-slate-100/80 mt-5" />}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* ── Potongan ── */}
                      {activeDeductionDocs.length > 0 && (
                        <div className="py-6 border-t border-slate-200 space-y-6">
                          <div className="flex items-center gap-2">
                            <TrendingDown className="w-3.5 h-3.5 text-rose-600" />
                            <span className="text-xs font-bold text-rose-700 uppercase tracking-widest">Potongan</span>
                          </div>
                          {activeDeductionDocs.map((item: any, idx: number) => (
                            <div key={item.id}>
                              {/* Section Header */}
                              <div className="mb-2">
                                <h4 className="text-sm font-bold text-black tracking-wide">
                                  {idx + 1}. {item.title.toUpperCase()}
                                </h4>
                              </div>

                              {/* Bullet Points (Only shown when no table is present) */}
                              {!item.table && item.bullets && item.bullets.length > 0 && (
                                <ul className="space-y-1 ml-4 pl-0">
                                  {item.bullets.map((bullet: string, bIdx: number) => (
                                    <li key={bIdx} className="flex items-start gap-2 text-xs sm:text-sm text-black leading-relaxed">
                                      <span className="mt-2 w-1.5 h-1.5 rounded-full bg-black shrink-0" />
                                      <span>{bullet}</span>
                                    </li>
                                  ))}
                                </ul>
                              )}

                              {/* Standard Deduction Value Card (non-loan items) */}
                              {item.id !== 'pinjaman_kop' && !item.fieldLabel.toUpperCase().includes('PINJAMAN KOP') && (
                                <div className="mt-3 ml-0 w-full py-2 animate-in fade-in duration-200">
                                  <div className="grid grid-cols-[auto_24px_1fr] gap-y-1.5 items-baseline">
                                    <DocRow label={item.fieldLabel} value={formatIDR(item.amount)} highlight tone="negative" />
                                  </div>
                                </div>
                              )}

                              {/* Seamless Integrated Card for Pinjaman Kop. UNIPDU */}
                              {(item.id === 'pinjaman_kop' || item.fieldLabel.toUpperCase().includes('PINJAMAN KOP')) && (
                                <div className="mt-3 ml-0 w-full py-2 space-y-4 animate-in fade-in duration-200">
                                  {/* Primary Deduction Row */}
                                  <div className="grid grid-cols-[auto_24px_1fr] gap-y-1.5 items-baseline">
                                    <DocRow label={item.fieldLabel} value={formatIDR(item.amount)} highlight tone="negative" />
                                  </div>

                                  {/* Integrated Loan Timeline & History Trail */}
                                  {(() => {
                                    const loansToRender = koperasiLoansInfo || [];

                                    if (loansToRender.length === 0) {
                                      return (
                                        <div className="pt-3.5 border-t border-slate-200/60 text-xs text-black italic">
                                          Data pinjaman koperasi belum dapat ditemukan pada database Koperasi UNIPDU.
                                        </div>
                                      );
                                    }

                                    return loansToRender.map((loan, lIdx) => {
                                      const projectedPaidInstallments = koperasiProjectedPaidInstallments(loan);
                                      const percentPaid = loan.tenor > 0
                                        ? Math.min(100, Math.max(0, Math.round((projectedPaidInstallments / loan.tenor) * 100)))
                                        : 0;
                                      const projectedRemainingBalance = koperasiProjectedRemainingBalance(loan);
                                      const trailSegments = loan.composedTrail || [
                                        {
                                          loanId: loan.id || 'loan-current',
                                          loanLabel: `#${(loan.id || 'LOAN').substring(0, 8)} (Saat Ini)`,
                                          entries: loan.history || []
                                        }
                                      ];
                                      const hasAncestors = trailSegments.length > 1;

                                      return (
                                        <div key={loan.id || lIdx} className="space-y-4 pt-3.5 border-t border-slate-200/60">
                                          {/* Header & Program Title */}
                                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                            <div className="flex items-center gap-2.5">
                                              <div className="w-7 h-7 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0">
                                                <CreditCard className="w-3.5 h-3.5 text-indigo-600" />
                                              </div>
                                              <div>
                                                <h5 className="text-xs sm:text-sm font-bold text-black">
                                                  Program Pinjaman: {loan.tujuanPinjaman || 'Pinjaman Koperasi UNIPDU'}
                                                </h5>
                                                {loan.tanggalDisetujui && (
                                                  <p className="text-[10px] text-black">
                                                    Disetujui: {formatLoanDate(loan.tanggalDisetujui)}
                                                  </p>
                                                )}
                                                {loan.status && (
                                                  <p className="text-[10px] font-semibold text-indigo-500">
                                                    Status: {loan.status}
                                                  </p>
                                                )}
                                              </div>
                                            </div>
                                            <span className="inline-flex items-center self-start sm:self-auto text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100/80">
                                              Angsuran Ke-{loan.currentInstallmentNum} dari {loan.tenor} Bulan
                                            </span>
                                          </div>

                                          {/* Key Metrics Grid */}
                                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 border-y border-slate-200 py-3 text-xs">
                                            <div>
                                              <span className="text-[10px] text-black block font-medium">Total Pinjaman</span>
                                              <span className="font-bold text-black">{formatIDR(loan.jumlahPinjaman)}</span>
                                            </div>
                                            <div>
                                              <span className="text-[10px] text-black block font-medium">Sudah Terbayar</span>
                                              <span className="font-bold text-emerald-600">{formatIDR(loan.jumlahPinjaman - loan.sisaHutang)}</span>
                                            </div>
                                            <div>
                                              <span className="text-[10px] text-black block font-medium">Cicilan Bulan Ini</span>
                                              <span className="font-bold text-indigo-600">{formatIDR(loan.cicilan)}</span>
                                            </div>
                                            <div>
                                              <span className="text-[10px] text-black block font-medium">Sisa Setelah Cicilan</span>
                                              <span className="font-bold text-rose-600">{formatIDR(projectedRemainingBalance)}</span>
                                            </div>
                                          </div>

                                          {/* Progress Bar */}
                                          <div className="space-y-1.5">
                                            <div className="flex justify-between items-center text-[11px]">
                                              <span className="font-medium text-black">Progress Pelunasan</span>
                                              <span className="font-bold text-indigo-600">{percentPaid}% Lunas</span>
                                            </div>
                                            <div className="h-2 w-full bg-slate-200/60 rounded-full overflow-hidden p-0.5">
                                              <div
                                                className="h-full bg-gradient-to-r from-indigo-500 to-emerald-500 rounded-full transition-all duration-500"
                                                style={{ width: `${percentPaid}%` }}
                                              />
                                            </div>
                                          </div>

                                          {/* Monthly Timeline Chips */}
                                          <div>
                                            <div className="flex items-center justify-between mb-2">
                                              <span className="text-[10px] font-bold uppercase tracking-wider text-black">
                                                Jadwal Angsuran Bulanan ({loan.tenor} Bulan)
                                              </span>
                                            </div>
                                            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pt-1 scrollbar-none">
                                              {Array.from({ length: loan.tenor }, (_, i) => i + 1).map(monthNum => {
                                                const isPaid = monthNum <= loan.paidInstallments;
                                                const isCurrent = monthNum === loan.currentInstallmentNum && loan.paidInstallments < loan.tenor;

                                                return (
                                                  <div
                                                    key={monthNum}
                                                    className={`flex flex-col items-center justify-center min-w-[42px] py-1.5 px-1 rounded-xl border text-center transition-all ${isCurrent
                                                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm scale-105 font-bold'
                                                      : isPaid
                                                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200/80 font-semibold'
                                                        : 'bg-white text-black border-slate-200/60 font-normal'
                                                      }`}
                                                  >
                                                    <span className="text-[9px] opacity-75 uppercase">Bln</span>
                                                    <span className="text-xs leading-tight">{monthNum}</span>
                                                    {isPaid && <CheckCircle2 className="w-3 h-3 text-emerald-600 mt-0.5" />}
                                                    {isCurrent && <span className="text-[8px] leading-none mt-0.5 font-bold underline">Ini</span>}
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          </div>

                                          {/* Koperasi Loan History Trail */}
                                          <div className="pt-1">
                                            <h6 className="text-[11px] font-bold text-indigo-600 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                                              <History className="w-3.5 h-3.5 text-indigo-600" /> Koperasi Loan History Trail
                                            </h6>

                                            <div className="border-l-2 border-indigo-200 pl-3.5 py-1 max-h-[240px] overflow-y-auto space-y-2.5">
                                              {trailSegments.map((segment: any, segIdx: number) => (
                                                <div key={segment.loanId}>
                                                  {/* Ancestry Segment Label */}
                                                  {hasAncestors && (
                                                    <div className={`flex items-center gap-2 ${segIdx > 0 ? 'mt-3 pt-2.5 border-t border-dashed border-slate-200' : ''}`}>
                                                      <div className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${segIdx === trailSegments.length - 1
                                                        ? 'bg-indigo-100 text-indigo-700'
                                                        : 'bg-slate-200/70 text-black'
                                                        }`}>
                                                        {segment.loanLabel}
                                                      </div>
                                                      {segIdx < trailSegments.length - 1 && (
                                                        <span className="text-[9px] text-black italic">Direstrukturisasi →</span>
                                                      )}
                                                    </div>
                                                  )}

                                                  {/* History Entries Timeline */}
                                                  <div className={`space-y-2.5 ${hasAncestors ? 'ml-1 mt-2' : ''}`}>
                                                    {segment.entries && segment.entries.length > 0 ? (
                                                      segment.entries.map((h: any, idx: number) => (
                                                        <div key={`${segment.loanId}-${idx}`} className="text-xs flex gap-2.5 items-start">
                                                          <div className={`w-2 h-2 rounded-full shrink-0 mt-1 ${segIdx === trailSegments.length - 1 ? 'bg-indigo-500' : 'bg-slate-300'
                                                            }`} />
                                                          <div className="space-y-0.5">
                                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                              <span className={`font-bold ${segIdx === trailSegments.length - 1 ? 'text-black' : 'text-black'
                                                                }`}>{h.status}</span>
                                                              <span className="text-[9px] text-black">{formatLoanDate(h.timestamp || h.createdAt || h.date || loan.tanggalDisetujui)}</span>
                                                            </div>
                                                            {h.notes && <p className="text-[11px] text-black">{h.notes}</p>}
                                                          </div>
                                                        </div>
                                                      ))
                                                    ) : (
                                                      <div className="text-xs text-black italic">Tidak ada catatan history transaksi.</div>
                                                    )}
                                                  </div>
                                                </div>
                                              ))}
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    });
                                  })()}
                                </div>
                              )}

                              {/* Separator */}
                              {idx < activeDeductionDocs.length - 1 && <div className="h-px bg-slate-100/80 mt-5" />}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

            </div>

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
                  <svg
                    className="w-5 h-5 text-white fill-current shrink-0"
                    viewBox="0 0 16 16"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path d="M13.601 2.326A7.85 7.85 0 0 0 7.994 0C3.627 0 .068 3.558.064 7.926c0 1.399.366 2.76 1.057 3.965L0 16l4.204-1.102a7.9 7.9 0 0 0 3.79.965h.004c4.368 0 7.926-3.558 7.93-7.93A7.9 7.9 0 0 0 13.6 2.326zM7.994 14.521a6.6 6.6 0 0 1-3.356-.92l-.24-.144-2.494.654.666-2.433-.156-.251a6.56 6.56 0 0 1-1.007-3.505c0-3.626 2.957-6.584 6.591-6.584a6.56 6.56 0 0 1 4.66 1.931 6.56 6.56 0 0 1 1.928 4.66c-.004 3.639-2.961 6.592-6.592 6.592m3.615-4.934c-.197-.099-1.17-.578-1.353-.646-.182-.065-.315-.099-.445.099-.133.197-.513.646-.627.775-.114.133-.232.148-.43.05-.197-.1-.836-.308-1.592-.985-.59-.525-.985-1.175-1.103-1.372-.114-.198-.011-.304.088-.403.087-.088.197-.232.296-.346.1-.114.133-.198.198-.33.065-.134.034-.248-.015-.347-.05-.099-.445-1.076-.612-1.47-.16-.389-.323-.335-.445-.34-.114-.007-.247-.007-.38-.007a.73.73 0 0 0-.529.247c-.182.198-.691.677-.691 1.654s.71 1.916.81 2.049c.098.133 1.394 2.132 3.383 2.992.47.205.84.326 1.129.418.475.152.904.129 1.246.08.38-.058 1.171-.48 1.338-.943.164-.464.164-.86.114-.943-.049-.084-.182-.133-.38-.232" />
                  </svg>
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
                    <svg
                      className="w-5 h-5 text-white fill-current shrink-0"
                      viewBox="0 0 16 16"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path d="M13.601 2.326A7.85 7.85 0 0 0 7.994 0C3.627 0 .068 3.558.064 7.926c0 1.399.366 2.76 1.057 3.965L0 16l4.204-1.102a7.9 7.9 0 0 0 3.79.965h.004c4.368 0 7.926-3.558 7.93-7.93A7.9 7.9 0 0 0 13.6 2.326zM7.994 14.521a6.6 6.6 0 0 1-3.356-.92l-.24-.144-2.494.654.666-2.433-.156-.251a6.56 6.56 0 0 1-1.007-3.505c0-3.626 2.957-6.584 6.591-6.584a6.56 6.56 0 0 1 4.66 1.931 6.56 6.56 0 0 1 1.928 4.66c-.004 3.639-2.961 6.592-6.592 6.592m3.615-4.934c-.197-.099-1.17-.578-1.353-.646-.182-.065-.315-.099-.445.099-.133.197-.513.646-.627.775-.114.133-.232.148-.43.05-.197-.1-.836-.308-1.592-.985-.59-.525-.985-1.175-1.103-1.372-.114-.198-.011-.304.088-.403.087-.088.197-.232.296-.346.1-.114.133-.198.198-.33.065-.134.034-.248-.015-.347-.05-.099-.445-1.076-.612-1.47-.16-.389-.323-.335-.445-.34-.114-.007-.247-.007-.38-.007a.73.73 0 0 0-.529.247c-.182.198-.691.677-.691 1.654s.71 1.916.81 2.049c.098.133 1.394 2.132 3.383 2.992.47.205.84.326 1.129.418.475.152.904.129 1.246.08.38-.058 1.171-.48 1.338-.943.164-.464.164-.86.114-.943-.049-.084-.182-.133-.38-.232" />
                    </svg>
                    Hubungi Admin BAK
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
