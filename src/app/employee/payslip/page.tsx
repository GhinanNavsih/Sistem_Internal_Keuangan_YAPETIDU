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
} from 'lucide-react';
import { generatePaySlipPdf, PaySlipField, PaySlipData } from '@/utils/generatePaySlipPdf';
import { MONTHS_ID } from '@/utils/rekapConfig';
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

  // Period dropdown state (defaults to ongoing month or June 2026 minimum)
  const [month, setMonth] = useState(() => {
    const d = new Date();
    const currentYear = d.getFullYear();
    const currentMonth = d.getMonth() + 1;
    if (currentYear === 2026) {
      return Math.max(6, currentMonth);
    }
    return currentMonth;
  });
  const [year, setYear] = useState(() => {
    return Math.max(2026, new Date().getFullYear());
  });

  // Selectable years: from current year down to 2026
  const availableYears = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const years = [];
    for (let y = currentYear; y >= 2026; y--) {
      years.push(y);
    }
    return years;
  }, []);

  // Selectable months: depends on selected year
  const availableMonths = useMemo(() => {
    const months = [];
    const startMonth = year === 2026 ? 6 : 1;
    for (let m = startMonth; m <= 12; m++) {
      months.push({
        value: m,
        label: MONTHS_ID[m - 1]
      });
    }
    return months;
  }, [year]);

  // Adjust month if the current selection becomes invalid
  useEffect(() => {
    if (year === 2026 && month < 6) {
      setMonth(6);
    }
  }, [year, month]);

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

  // Dynamic calculations states
  const [calculatedEarnings, setCalculatedEarnings] = useState<PaySlipField[]>([]);
  const [calculatedDeductions, setCalculatedDeductions] = useState<PaySlipField[]>([]);

  // Load employee data & payslip details
  useEffect(() => {
    if (!profile?.linkedEmployeeId) return;

    const fetchPayslipData = async () => {
      try {
        setLoading(true);
        setConfirmedSlip(null);
        setIsConfirmed(false);

        const empId = profile.linkedEmployeeId as string;

        // 1. Fetch main Loyalis Employee document
        const empRef = doc(db, 'Employees_Loyalis', empId);
        const empSnap = await getDoc(empRef);

        if (!empSnap.exists()) {
          console.error("Employee document not found in Employees_Loyalis");
          setEmployeeData(null);
          setLoading(false);
          return;
        }

        const employee = { id: empSnap.id, ...empSnap.data() } as any;
        // Parse joinDate (date_of_hire) matching the admin page implementation
        employee.joinDate = employee.employment_profile?.date_of_hire?.toDate?.() || 
                            (employee.employment_profile?.date_of_hire ? new Date(employee.employment_profile.date_of_hire) : 
                             (employee.personal_info?.join_date ? new Date(employee.personal_info.join_date) : new Date()));
        
        // Parse dateRecognized matching the admin page implementation
        employee.dateRecognized = employee.employment_profile?.date_recognized?.toDate?.() || 
                                  (employee.employment_profile?.date_recognized ? new Date(employee.employment_profile.date_recognized) : undefined);

        // Parse gradeLevel matching the admin page implementation
        employee.gradeLevel = employee.academic_and_tier?.level_code || employee.employment_profile?.grade_level || '';

        setEmployeeData(employee);

        // 2. Check for saved slip in PayrollSlipStates (Format: {periodKey}_{linkedEmployeeId})
        const slipDocId = `${periodKey}_${empId}`;
        const slipRef = doc(db, 'PayrollSlipStates', slipDocId);
        const slipSnap = await getDoc(slipRef);

        if (slipSnap.exists()) {
          const slipData = slipSnap.data();
          setConfirmedSlip(slipData);
          setIsConfirmed(slipData.status === 'locked');
          setLoading(false);
          return;
        }

        // 3. Fallback: Dynamic calculation of draft payslip in real-time
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
              if (empEntry.isNotFoundInExcel) {
                // Not found in uploaded excel rekap: 0 earnings and bonus
                presenceBonus = 0;
                presensiEarning = 0;
                presenceDeduction = 0;
                presensiDeduction = 0;
              } else {
                // Matched: apply deductions from Excel
                presenceDeduction = empEntry.deduction || 0;
                const absenceMinutes = empEntry.absenceMinutes || 0;
                presensiDeduction = Math.round((absenceMinutes / 60) * 1650);
              }
            }
          }
        }

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
        deductions.push({ label: 'KOPERASI ROCHMAD', amount: 0 });

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
      } catch (err) {
        console.error("Error fetching/calculating payslip data:", err);
        setLoading(false);
      }
    };

    fetchPayslipData();
  }, [profile?.linkedEmployeeId, periodKey, periodToken]);

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

  // Client-side PDF trigger
  const handleDownloadPdf = () => {
    if (!employeeData || !isConfirmed) return;
    const slipData: PaySlipData = {
      employeeName: employeeData.personal_info?.name || profile?.displayName || 'Karyawan',
      employeeNo: 1, // Placeholder
      period: periodText,
      jobCategory: `STAF ${employeeData.employment_profile?.department_unit || 'STAF'}`,
      earnings: earnings,
      deductions: deductions,
      isLoyalis: true,
      niy: employeeData.personal_info?.employee_id_niy || '',
      npwp: employeeData.personal_info?.tax_id_npwp || '',
      familyMetrics: employeeData.family_allowance_metrics
    };

    generatePaySlipPdf(slipData, true);
  };

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
                    I. PENERIMAAN (EARNINGS)
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
                    II. POTONGAN (DEDUCTIONS)
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
                  <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest block">PENERIMAAN BERSIH (NET SALARY)</span>
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

              {/* Quote Block */}
              <div className="p-6 md:p-8 bg-amber-50/15 flex justify-center text-center">
                <div className="max-w-lg border border-amber-100/50 rounded-2xl p-4.5 bg-[#FFFDF9] shadow-inner">
                  <p className="text-xs text-slate-500 font-medium font-serif italic leading-relaxed">
                    "Berimanlah kamu kepada Allah dan RasulNya dan nafkahkanlah sebagian dari hartamu yang Allah telah menjadikan kamu menguasainya. Maka orang-orang yang beriman diantara kamu dan yang menafkahkankan sebagian dari hartanya memperoleh pahala yang besar." (QS. 57:7)
                  </p>
                </div>
              </div>

            </Card>

            {/* ── Download Action Button ────────────────────────────────────── */}
            {isConfirmed ? (
              <div className="flex justify-center">
                <Button
                  onClick={handleDownloadPdf}
                  className="rounded-2xl px-8 py-6 text-sm font-bold bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-xl shadow-indigo-150 hover:shadow-2xl hover:shadow-indigo-250 transition-all hover:scale-[1.02] transform active:scale-95 flex items-center gap-2 cursor-pointer"
                >
                  <Download className="w-5 h-5" />
                  Unduh Slip Gaji (PDF)
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2.5">
                <Button
                  disabled
                  className="rounded-2xl px-8 py-6 text-sm font-bold bg-slate-100 text-slate-400 border border-slate-200/60 shadow-none cursor-not-allowed flex items-center gap-2"
                >
                  <Lock className="w-5 h-5 text-slate-400" />
                  Unduh Slip Gaji (PDF)
                </Button>
                <p className="text-[11px] font-semibold text-amber-600 bg-amber-50/60 border border-amber-100/50 px-3 py-1 rounded-full animate-pulse">
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
