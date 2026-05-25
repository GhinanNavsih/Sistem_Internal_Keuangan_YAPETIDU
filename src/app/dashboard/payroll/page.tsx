"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { calculateYearsOfService, calculateGapok, matchFunctionalAllowance } from '@/utils/payrollLogic';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  CheckCircle2,
  Pencil,
  Globe,
  MessageCircle,
  Share2,
  FileText,
  Hexagon,
  TrendingUp,
  Users,
  UserCircle,
  Lightbulb,
  Briefcase,
  Loader2,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Printer,
  Eye,
  CircleCheck,
  ScanLine,
  Upload,
  LogOut,
  UserCog,
  Award,
  FileSpreadsheet,
  Banknote,
  ChevronRight,
  Search,
} from 'lucide-react';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/AuthContext';
import { Employee, SalaryMatrix, BlueCollarEmployee, UraianGajiDocument, UraianEntry } from '@/types';
import PaySlipDialog, { SlipState } from '@/components/PaySlipDialog';
import LegalitasPimpinanDialog from '@/components/LegalitasPimpinanDialog';
import CetakPayrollDialog from '@/components/CetakPayrollDialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { generateRekapGajiPekaryaPdf, RekapGajiPekaryaData, RekapCategoryData } from '@/utils/generateRekapGajiPekaryaPdf';
import { generatePayrollStatementPdf, PayrollStatementData, PayrollStatementEmployee } from '@/utils/generatePayrollStatementPdf';

import {
  calculateTotalEarnings,
  calculateTotalDeductions,
  calculateNetSalary
} from '@/utils/salaryCalculator';

function SortIcon({ active, direction }: { active: boolean; direction: 'asc' | 'desc' | null }) {
  if (!active || !direction) return <ChevronsUpDown className="w-3 h-3 text-slate-300" />;
  return direction === 'asc' ? <ChevronUp className="w-3 h-3 text-indigo-500" /> : <ChevronDown className="w-3 h-3 text-indigo-500" />;
}
// ... [rest of imports and sorting logic unchanged until TableHead]
// (Wait, I need to update the handleSort and getFilteredAndSortedEmployees logic too)


// Format currency
const formatIDR = (amount: number) => {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

// ─── Payroll period helper ──────────────────────────────────────
const MONTHS_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

function getPayrollPeriod(date: Date): string {
  return `${MONTHS_ID[date.getMonth()]} ${date.getFullYear()}`;
}

// ─── Extended employee with raw data ────────────────────────────
interface EmployeeRow extends Employee {
  raw: any;
  rowIndex: number;
}

export default function PayrollValidationDashboard() {
  const { profile, logout } = useAuth();
  const [targetDate] = useState(new Date('2026-05-01'));
  const [activeTab, setActiveTab] = useState('Tagihan');
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [salaryMatrix, setSalaryMatrix] = useState<SalaryMatrix>({});
  const [loading, setLoading] = useState(true);
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' | null }>({ key: '', direction: null });

  // Collar type state (Lapangan / Blue Collar vs Kantor / White Collar Loyalis)
  const [payrollCollar, setPayrollCollar] = useState<'blue' | 'loyalis'>('blue');

  // ─── Filters ───────────────────────────────────────────────────
  const [activityFilter, setActivityFilter] = useState<'active' | 'all'>('active');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Reset category filter when switching collars
  useEffect(() => {
    setCategoryFilter('all');
  }, [payrollCollar]);

  // ─── Slip status state (keyed by employeeId) ───────────────────
  const [slipStates, setSlipStates] = useState<Record<string, SlipState>>({});

  // ─── UraianGaji state (keyed by docId e.g. "2026_05_KEBERSIHAN") ──
  const [uraianMap, setUraianMap] = useState<Record<string, UraianGajiDocument>>({});

  // ─── VakasiTambahan state (keyed by employeeId) ─────────────────
  const [vakasiTambahanMap, setVakasiTambahanMap] = useState<Record<string, number>>({});
  const [vakasiTambahanListMap, setVakasiTambahanListMap] = useState<Record<string, { eventName: string; payGiven: number }[]>>({});
  const [functionalAllowanceMap, setFunctionalAllowanceMap] = useState<Record<string, number>>({});

  // ─── Dialog state ──────────────────────────────────────────────
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<'create' | 'review'>('create');
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeRow | null>(null);

  const [legalitasDialogOpen, setLegalitasDialogOpen] = useState(false);
  const [cetakPayrollDialogOpen, setCetakPayrollDialogOpen] = useState(false);
  const [printSelectorOpen, setPrintSelectorOpen] = useState(false);

  const handlePrintRekap = () => {
    const activeEmployees = employees.filter(e => e.isActive);
    const categoriesMap: Record<string, RekapCategoryData> = {};

    categories.forEach(cat => {
      categoriesMap[cat] = {
        categoryName: payrollCollar === 'loyalis' ? `STAF ${cat}` : `VAKASI ${cat}`,
        totalEarnings: 0,
        bpjs: 0,
        kopRochmad: 0,
        kopUnipdu: 0,
        tunai: 0,
        danaSosial: 0,
        totalDeductions: 0,
        netSalary: 0,
      };
    });

    activeEmployees.forEach(emp => {
      const cat = emp.role;
      const periodKey = `${targetDate.getFullYear()}_${String(targetDate.getMonth() + 1).padStart(2, '0')}`;
      const uraianDoc = uraianMap[`${periodKey}_${cat}`];
      const gapok = calculateGapok(emp, salaryMatrix, targetDate);
      const uraianEntry = uraianDoc?.entries?.[emp.id];

      const earnings = calculateTotalEarnings(emp.raw, gapok, uraianEntry, vakasiTambahanMap[emp.id] ?? 0, functionalAllowanceMap[emp.id] ?? 0);

      const bpjs = payrollCollar === 'loyalis' ? 0 : (emp.raw.bpjs?.deductionAmount ? Math.round(emp.raw.bpjs.deductionAmount) : 0);
      const kopRochmad = payrollCollar === 'loyalis' ? 0 : (emp.raw.deductions?.koperasiRochmad || 0);
      const kopUnipdu = 0;
      const tunai = 0;
      const danaSosial = 0;

      const totalDeductions = calculateTotalDeductions(emp.raw);
      const netSalary = calculateNetSalary(earnings, totalDeductions);

      if (categoriesMap[cat]) {
        categoriesMap[cat].totalEarnings += earnings;
        categoriesMap[cat].bpjs += bpjs;
        categoriesMap[cat].kopRochmad += kopRochmad;
        categoriesMap[cat].kopUnipdu += kopUnipdu;
        categoriesMap[cat].tunai += tunai;
        categoriesMap[cat].danaSosial += danaSosial;
        categoriesMap[cat].totalDeductions += totalDeductions;
        categoriesMap[cat].netSalary += netSalary;
      }
    });

    const data: RekapGajiPekaryaData = {
      period: getPayrollPeriod(targetDate),
      categories: Object.values(categoriesMap).filter(c => c.totalEarnings > 0),
    };

    generateRekapGajiPekaryaPdf(data);
  };

  const handlePrintPayrollStatement = () => {
    const activeEmployees = employees.filter(e => e.isActive);

    const roleOrder = payrollCollar === 'loyalis'
      ? ['REKTORAT', 'DOSEN', 'TENDIK', 'STAF']
      : ['SATPAM', 'SOPIR', 'PEKARYA', 'TEKNISI', 'KEBERSIHAN_IC', 'PONTI'];
    const sortedEmployees = [...activeEmployees].sort((a, b) => {
      const roleA = roleOrder.indexOf(a.role) !== -1 ? roleOrder.indexOf(a.role) : 99;
      const roleB = roleOrder.indexOf(b.role) !== -1 ? roleOrder.indexOf(b.role) : 99;
      if (roleA !== roleB) return roleA - roleB;
      return a.name.localeCompare(b.name);
    });

    let totalNetSalary = 0;
    const stmtEmployees: PayrollStatementEmployee[] = sortedEmployees.map((emp, idx) => {
      const cat = emp.role;
      const periodKey = `${targetDate.getFullYear()}_${String(targetDate.getMonth() + 1).padStart(2, '0')}`;
      const uraianDoc = uraianMap[`${periodKey}_${cat}`];
      const gapok = calculateGapok(emp, salaryMatrix, targetDate);
      const uraianEntry = uraianDoc?.entries?.[emp.id];

      const earnings = calculateTotalEarnings(emp.raw, gapok, uraianEntry, vakasiTambahanMap[emp.id] ?? 0, functionalAllowanceMap[emp.id] ?? 0);
      const totalDeductions = calculateTotalDeductions(emp.raw);
      const netSalary = calculateNetSalary(earnings, totalDeductions);

      totalNetSalary += netSalary;

      let satker = cat;
      if (satker === 'KEBERSIHAN_IC') satker = 'KEBERSIHAN IC';
      if (satker === 'KEBERSIHAN_PT') satker = 'KEBERSIHAN PONDOK TINGGI';

      return {
        no: idx + 1,
        name: emp.name,
        satker: satker,
        accountNumber: payrollCollar === 'loyalis' ? (emp.raw.banking_info?.account_number || '') : (emp.raw.bankAccount?.accountNumber || ''),
        netSalary
      };
    });

    const data: PayrollStatementData = {
      period: getPayrollPeriod(targetDate),
      employees: stmtEmployees,
      totalNetSalary,
      title: payrollCollar === 'loyalis' ? 'PAYROLL STAF LOYALIS' : 'PAYROLL PEKARYA'
    };

    generatePayrollStatementPdf(data);
  };

  const handleSort = (key: string) => {
    let direction: 'asc' | 'desc' | null = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    } else if (sortConfig.key === key && sortConfig.direction === 'desc') {
      direction = null;
    }
    setSortConfig({ key, direction });
  };

  const getFilteredAndSortedEmployees = () => {
    let filtered = [...employees];

    // Activity Filter
    if (activityFilter === 'active') {
      filtered = filtered.filter(emp => emp.isActive);
    }

    // Category Filter
    if (categoryFilter !== 'all') {
      filtered = filtered.filter(emp => emp.role === categoryFilter);
    }

    // Search Query Filter
    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(emp =>
        emp.name.toLowerCase().includes(q) ||
        emp.id.toLowerCase().includes(q)
      );
    }

    // Sorting
    if (!sortConfig.direction || !sortConfig.key) return filtered;

    return filtered.sort((a, b) => {
      let aValue: any;
      let bValue: any;

      switch (sortConfig.key) {
        case 'name':
          aValue = a.name.toLowerCase();
          bValue = b.name.toLowerCase();
          break;
        case 'role':
          aValue = a.role.toLowerCase();
          bValue = b.role.toLowerCase();
          break;
        case 'earnings': {
          const gapokA = calculateGapok(a, salaryMatrix, targetDate);
          const roleKeyA = payrollCollar === 'loyalis' ? a.role : a.raw.employment?.jobCategory;
          const uraianA = uraianMap[`${targetDate.getFullYear()}_${String(targetDate.getMonth() + 1).padStart(2, '0')}_${roleKeyA}`]?.entries?.[a.id];
          aValue = calculateTotalEarnings(a.raw, gapokA, uraianA, vakasiTambahanMap[a.id] ?? 0, functionalAllowanceMap[a.id] ?? 0);

          const gapokB = calculateGapok(b, salaryMatrix, targetDate);
          const roleKeyB = payrollCollar === 'loyalis' ? b.role : b.raw.employment?.jobCategory;
          const uraianB = uraianMap[`${targetDate.getFullYear()}_${String(targetDate.getMonth() + 1).padStart(2, '0')}_${roleKeyB}`]?.entries?.[b.id];
          bValue = calculateTotalEarnings(b.raw, gapokB, uraianB, vakasiTambahanMap[b.id] ?? 0, functionalAllowanceMap[b.id] ?? 0);
          break;
        }
        case 'deductions':
          aValue = calculateTotalDeductions(a.raw);
          bValue = calculateTotalDeductions(b.raw);
          break;
        case 'net': {
          const gapokA = calculateGapok(a, salaryMatrix, targetDate);
          const roleKeyA = payrollCollar === 'loyalis' ? a.role : a.raw.employment?.jobCategory;
          const uraianA = uraianMap[`${targetDate.getFullYear()}_${String(targetDate.getMonth() + 1).padStart(2, '0')}_${roleKeyA}`]?.entries?.[a.id];
          const earningsA = calculateTotalEarnings(a.raw, gapokA, uraianA, vakasiTambahanMap[a.id] ?? 0, functionalAllowanceMap[a.id] ?? 0);
          const deductionsA = calculateTotalDeductions(a.raw);
          aValue = calculateNetSalary(earningsA, deductionsA);

          const gapokB = calculateGapok(b, salaryMatrix, targetDate);
          const roleKeyB = payrollCollar === 'loyalis' ? b.role : b.raw.employment?.jobCategory;
          const uraianB = uraianMap[`${targetDate.getFullYear()}_${String(targetDate.getMonth() + 1).padStart(2, '0')}_${roleKeyB}`]?.entries?.[b.id];
          const earningsB = calculateTotalEarnings(b.raw, gapokB, uraianB, vakasiTambahanMap[b.id] ?? 0, functionalAllowanceMap[b.id] ?? 0);
          const deductionsB = calculateTotalDeductions(b.raw);
          bValue = calculateNetSalary(earningsB, deductionsB);
          break;
        }
        default:
          return 0;
      }

      if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  };

  const displayEmployees = getFilteredAndSortedEmployees();

  // Get all unique categories for filter
  const categories = Array.from(new Set(employees.map(emp => emp.role))).sort();

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);

        const isLoyalis = payrollCollar === 'loyalis';
        const empCollName = isLoyalis ? 'Employees_Loyalis' : 'Employees_BlueCollar';
        const matrixCollName = isLoyalis ? 'SalaryMatrix_WhiteCollar' : 'SalaryMatrix';

        // 1. Fetch Employees
        const empSnapshot = await getDocs(collection(db, empCollName));
        let index = 1;
        const empList = empSnapshot.docs
          .map(docSnap => {
            const data = docSnap.data();

            const joinDateVal = isLoyalis
              ? (data.employment_profile?.date_of_hire?.toDate?.() || (data.employment_profile?.date_of_hire ? new Date(data.employment_profile.date_of_hire) : new Date()))
              : (data.employment?.startDate ? new Date(data.employment.startDate) : new Date());

            const row: EmployeeRow = {
              id: docSnap.id,
              name: isLoyalis ? (data.personal_info?.name || '') : (data.name || ''),
              role: isLoyalis ? (data.employment_profile?.job_role || '') : (data.employment?.jobCategory || ''),
              gradeLevel: isLoyalis ? (data.academic_and_tier?.level_code || '') : (data.salaryProfile?.salaryGradeCode || ''),
              joinDate: joinDateVal,
              isActive: isLoyalis ? (data.personal_info?.status === 'AKTIF') : (data.flags?.isActive ?? true),
              raw: { ...data, employeeId: docSnap.id },
              rowIndex: index++,
            };
            return row;
          });
        setEmployees(empList);

        // 2. Fetch Active Salary Matrix Version
        const matrixRootRef = doc(db, matrixCollName, '_config');
        const matrixRootSnap = await getDoc(matrixRootRef);

        let activeVersion = '2026_v1';
        if (matrixRootSnap.exists() && matrixRootSnap.data().activeVersion) {
          activeVersion = matrixRootSnap.data().activeVersion;
        }

        // 3. Fetch Salary Matrix Rows for Active Version
        const matrixSnapshot = await getDocs(collection(db, matrixCollName, activeVersion, 'rows'));
        const matrix: SalaryMatrix = {};

        matrixSnapshot.docs.forEach(matrixDoc => {
          const data = matrixDoc.data();
          const tahun = data.tahun;
          const grades = data.salaries || {};

          Object.entries(grades).forEach(([grade, amount]) => {
            if (!matrix[grade]) matrix[grade] = {};
            matrix[grade][tahun] = amount as number;
          });
        });

        setSalaryMatrix(matrix);

        // 4. Fetch Active Functional Matrix and calculate fAllowanceMap
        const fAllowanceMap: Record<string, number> = {};
        if (isLoyalis) {
          const fConfigRef = doc(db, 'SalaryMatrix_Functional', '_config');
          const fConfigSnap = await getDoc(fConfigRef);
          let fVersion = '2026_v1';
          if (fConfigSnap.exists() && fConfigSnap.data().activeVersion) {
            fVersion = fConfigSnap.data().activeVersion;
          }

          const fSnapshot = await getDocs(collection(db, 'SalaryMatrix_Functional', fVersion, 'rows'));
          const fMatrix: Record<string, { base_value: number; functional_tiers: Record<string, number> }> = {};
          fSnapshot.docs.forEach(fDoc => {
            const data = fDoc.data();
            fMatrix[fDoc.id] = {
              base_value: data.base_value || 0,
              functional_tiers: data.functional_tiers || {},
            };
          });

          empList.forEach(emp => {
            const edLevel = emp.raw.academic_and_tier?.education_level;
            const fTier = emp.raw.academic_and_tier?.functional_tier;
            fAllowanceMap[emp.id] = matchFunctionalAllowance(edLevel, fTier, fMatrix);
          });
        } else {
          empList.forEach(emp => {
            fAllowanceMap[emp.id] = 0;
          });
        }
        setFunctionalAllowanceMap(fAllowanceMap);
      } catch (error) {
        console.error("Error fetching data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [payrollCollar]);

  // ─── Fetch UraianGaji for current period ───────────────────────
  useEffect(() => {
    const fetchUraian = async () => {
      try {
        const period = `${targetDate.getFullYear()}_${String(targetDate.getMonth() + 1).padStart(2, '0')}`;
        const snapshot = await getDocs(collection(db, 'UraianGaji'));
        const map: Record<string, UraianGajiDocument> = {};
        snapshot.docs.forEach(d => {
          if (d.id.startsWith(period)) {
            map[d.id] = d.data() as UraianGajiDocument;
          }
        });
        setUraianMap(map);
      } catch (err) {
        console.error('Error fetching UraianGaji:', err);
      }
    };
    fetchUraian();
  }, [targetDate]);

  // ─── Fetch VakasiTambahan for current period ───────────────────
  useEffect(() => {
    const fetchVakasiTambahan = async () => {
      try {
        const periodToken = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}`;
        const snapshot = await getDocs(collection(db, 'VakasiTambahan'));
        const sumMap: Record<string, number> = {};
        const listMap: Record<string, { eventName: string; payGiven: number }[]> = {};
        
        snapshot.docs.forEach(d => {
          const data = d.data();
          if (data.period === periodToken) {
            const eventNameVal = data.eventName || '';
            const workers = data.eventWorkers || {};
            Object.entries(workers).forEach(([empId, w]: [string, any]) => {
              sumMap[empId] = (sumMap[empId] || 0) + (w.payGiven || 0);
              
              if (!listMap[empId]) {
                listMap[empId] = [];
              }
              listMap[empId].push({
                eventName: eventNameVal,
                payGiven: w.payGiven || 0,
              });
            });
          }
        });
        setVakasiTambahanMap(sumMap);
        setVakasiTambahanListMap(listMap);
      } catch (err) {
        console.error('Error fetching VakasiTambahan:', err);
      }
    };
    fetchVakasiTambahan();
  }, [targetDate]);

  // ─── Slip Handlers ─────────────────────────────────────────────

  const openCreateDialog = (emp: EmployeeRow) => {
    setSelectedEmployee(emp);
    setDialogMode('create');
    setDialogOpen(true);
  };

  const openReviewDialog = (emp: EmployeeRow) => {
    setSelectedEmployee(emp);
    setDialogMode('review');
    setDialogOpen(true);
  };

  const handleSlipGenerated = (employeeId: string, state: SlipState) => {
    setSlipStates(prev => ({ ...prev, [employeeId]: state }));
  };

  const handleSlipConfirmed = (employeeId: string) => {
    setSlipStates(prev => ({
      ...prev,
      [employeeId]: {
        ...prev[employeeId],
        status: 'confirmed',
        confirmedAt: new Date().toISOString(),
      },
    }));
  };

  // ─── Stats ─────────────────────────────────────────────────────

  const totalSlips = Object.keys(slipStates).length;
  const confirmedSlips = Object.values(slipStates).filter(s => s.status === 'confirmed').length;
  const printedSlips = Object.values(slipStates).filter(s => s.status === 'printed').length;

  const tabs = [
    { name: 'Tagihan', icon: <FileText className="w-4 h-4 mr-2" /> },
  ];

  const payrollPeriod = getPayrollPeriod(targetDate);

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50/80 to-white p-8 font-sans text-slate-800">
      <div className="max-w-7xl mx-auto">
        {/* Header Section */}
        <div className="flex justify-between items-center mb-6">
          <div className="flex gap-2">
            <Link href="/dashboard">
              <Button variant="outline" className="rounded-xl shadow-sm bg-white border-slate-200 text-slate-600 hover:bg-slate-50">
                ← Kembali
              </Button>
            </Link>
            <Button
              variant="outline"
              onClick={logout}
              className="rounded-xl shadow-sm bg-white border-slate-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-100 transition-all cursor-pointer"
            >
              <LogOut className="w-4 h-4 mr-2" />
              Keluar
            </Button>
          </div>
          <div className="flex gap-3">
            <Button
              onClick={() => setPrintSelectorOpen(true)}
              variant="outline"
              className="rounded-xl shadow-sm bg-white border-slate-200 text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50/50 hover:border-indigo-200 transition-all font-semibold"
            >
              <Printer className="w-4 h-4 mr-2" /> Cetak Dokumen
            </Button>
            {profile?.role === 'super_admin' && (
              <Link href="/dashboard/users">
                <Button variant="outline" className="rounded-xl shadow-sm bg-white border-slate-200 text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50/50 hover:border-indigo-200 transition-all font-bold">
                  <UserCog className="w-4 h-4 mr-2" /> Manajemen Akses
                </Button>
              </Link>
            )}
            <Link href="/dashboard/employees">
              <Button variant="outline" className="rounded-xl shadow-sm bg-white border-slate-200 text-slate-600 hover:text-indigo-600 hover:border-indigo-100 transition-all">
                <Users className="w-4 h-4 mr-2" /> Data Pegawai
              </Button>
            </Link>
            <Link href="/dashboard/payroll/master">
              <Button variant="outline" className="rounded-xl shadow-sm bg-white border-slate-200 text-slate-600 hover:text-indigo-600 hover:border-indigo-100 transition-all">
                <FileText className="w-4 h-4 mr-2" /> Master Gaji Pokok
              </Button>
            </Link>
            <Link href="/dashboard/payroll/uraian">
              <Button variant="outline" className="rounded-xl shadow-sm bg-white border-slate-200 text-slate-600 hover:text-indigo-600 hover:border-indigo-100 transition-all">
                <ScanLine className="w-4 h-4 mr-2" /> Rekap Presensi
              </Button>
            </Link>
          </div>
        </div>

        {/* Main Card */}
        <Card className="bg-white rounded-[20px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-none overflow-hidden">
          <div className="p-8 pb-0">
            {/* Title & Info */}
            <div className="flex justify-between items-start mb-6">
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex items-center gap-3 filter drop-shadow-sm">
                    <img
                      src="/Logo YAPETIDU (Transparent bg).png"
                      alt="Logo YAPETIDU"
                      className="h-10 w-auto object-contain hover:scale-105 transition-transform duration-300 cursor-pointer"
                    />
                    <div className="w-px h-6 bg-slate-200" />
                    <img
                      src="/Logo UNIPDU.png"
                      alt="Logo UNIPDU"
                      className="h-10 w-auto object-contain hover:scale-105 transition-transform duration-300 cursor-pointer"
                    />
                  </div>
                  <h1 className="text-2xl font-bold tracking-tight ml-2">BAK UNIPDU Payroll</h1>
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500 mt-1"></div>
                </div>

                {/* Filter Controls */}
                <div className="flex flex-wrap items-center gap-4 mb-6">
                  {/* Collar Switch Toggle */}
                  <div className="flex bg-slate-100 p-1 rounded-xl">
                    <button
                      onClick={() => setPayrollCollar('blue')}
                      className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${payrollCollar === 'blue'
                        ? 'bg-white text-indigo-600 shadow-sm font-bold'
                        : 'text-slate-500 hover:text-slate-700'
                        }`}
                    >
                      Pekarya (Blue Collar)
                    </button>
                    <button
                      onClick={() => setPayrollCollar('loyalis')}
                      className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${payrollCollar === 'loyalis'
                        ? 'bg-white text-indigo-600 shadow-sm font-bold'
                        : 'text-slate-500 hover:text-slate-700'
                        }`}
                    >
                      Staf (White Collar)
                    </button>
                  </div>

                  <div className="flex bg-slate-100 p-1 rounded-xl">
                    <button
                      onClick={() => setActivityFilter('active')}
                      className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${activityFilter === 'active'
                        ? 'bg-white text-indigo-600 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                        }`}
                    >
                      Aktif
                    </button>
                    <button
                      onClick={() => setActivityFilter('all')}
                      className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${activityFilter === 'all'
                        ? 'bg-white text-indigo-600 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                        }`}
                    >
                      Semua
                    </button>
                  </div>

                  <select
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    className="bg-white border border-slate-200 text-slate-600 text-xs font-semibold rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all cursor-pointer shadow-sm"
                  >
                    <option value="all">Semua Kategori</option>
                    {categories.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>

                  {/* Search Bar Input */}
                  <div className="relative w-72 shrink-0">
                    <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                      <Search className="w-4 h-4" />
                    </span>
                    <input
                      type="text"
                      placeholder="Cari nama atau ID pegawai..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full bg-white border border-slate-200 text-slate-700 placeholder:text-slate-400 text-xs font-semibold rounded-xl pl-10 pr-4 py-2.5 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 transition-all shadow-sm"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap gap-6 text-sm">
                  <div>
                    <span className="text-slate-500 block mb-1">Periode Payroll</span>
                    <span className="font-medium">{payrollPeriod}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block mb-1">Total Karyawan</span>
                    <span className="font-medium">{loading ? '...' : displayEmployees.length}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block mb-1">Slip Dicetak</span>
                    <span className="font-medium text-indigo-600">{printedSlips + confirmedSlips} / {displayEmployees.length}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block mb-1">Dikonfirmasi</span>
                    <span className="font-medium text-emerald-600">{confirmedSlips} / {displayEmployees.length}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block mb-1">Label</span>
                    <div className="flex gap-2">
                      <Badge variant="secondary" className="bg-pink-50 text-pink-700 hover:bg-pink-100 rounded-full font-normal border-none shadow-none"><div className="w-1.5 h-1.5 rounded-full bg-pink-500 mr-1.5"></div> Validasi</Badge>
                      <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-full font-normal border-none shadow-none"><div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5"></div> Bulanan</Badge>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Navigation Tabs */}
            <div className="flex gap-6 border-b border-slate-100 overflow-x-auto no-scrollbar">
              {tabs.map((tab) => (
                <button
                  key={tab.name}
                  onClick={() => setActiveTab(tab.name)}
                  className={`flex items-center pb-4 text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${activeTab === tab.name
                    ? 'border-indigo-500 text-indigo-700'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                    }`}
                >
                  <span className={`${activeTab === tab.name ? 'text-indigo-500' : 'text-slate-400'}`}>
                    {tab.icon}
                  </span>
                  {tab.name}
                </button>
              ))}
            </div>
          </div>

          {/* Table Section */}
          <div className="p-0">
            <div className="px-8 py-4 font-semibold text-lg border-b border-slate-100">
              Validasi Gaji
            </div>
            {loading ? (
              <div className="p-20 flex flex-col items-center justify-center text-slate-400">
                <Loader2 className="w-8 h-8 animate-spin mb-4 text-indigo-500" />
                <p>Memuat data karyawan...</p>
              </div>
            ) : employees.length === 0 ? (
              <div className="p-20 flex flex-col items-center justify-center text-slate-400">
                <Users className="w-12 h-12 mb-4 opacity-20" />
                <p>Belum ada data karyawan.</p>
              </div>
            ) : (
              <Table>
                <TableHeader className="bg-slate-50/50">
                  <TableRow className="border-slate-100">
                    <TableHead className="font-medium text-slate-500 pl-8 cursor-pointer hover:text-indigo-600 transition-colors w-[320px]" onClick={() => handleSort('name')}>
                      <div className="flex items-center gap-1">
                        Nama Karyawan
                        <SortIcon active={sortConfig.key === 'name'} direction={sortConfig.direction} />
                      </div>
                    </TableHead>
                    <TableHead className="font-medium text-slate-500 cursor-pointer hover:text-indigo-600 transition-colors w-[320px]" onClick={() => handleSort('role')}>
                      <div className="flex items-center gap-1">
                        Jabatan / Golongan
                        <SortIcon active={sortConfig.key === 'role'} direction={sortConfig.direction} />
                      </div>
                    </TableHead>
                    <TableHead className="font-medium text-slate-500 cursor-pointer hover:text-indigo-600 transition-colors whitespace-nowrap" onClick={() => handleSort('earnings')}>
                      <div className="flex items-center gap-1">
                        Pendapatan
                        <SortIcon active={sortConfig.key === 'earnings'} direction={sortConfig.direction} />
                      </div>
                    </TableHead>
                    <TableHead className="font-medium text-slate-500 cursor-pointer hover:text-indigo-600 transition-colors whitespace-nowrap" onClick={() => handleSort('deductions')}>
                      <div className="flex items-center gap-1">
                        Potongan
                        <SortIcon active={sortConfig.key === 'deductions'} direction={sortConfig.direction} />
                      </div>
                    </TableHead>
                    <TableHead className="font-medium text-slate-500 cursor-pointer hover:text-indigo-600 transition-colors whitespace-nowrap" onClick={() => handleSort('net')}>
                      <div className="flex items-center gap-1">
                        Gaji Bersih
                        <SortIcon active={sortConfig.key === 'net'} direction={sortConfig.direction} />
                      </div>
                    </TableHead>
                    <TableHead className="font-medium text-slate-500 text-right pr-8">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayEmployees.map((emp) => {
                    const years = calculateYearsOfService(emp.joinDate, targetDate);
                    const gapok = calculateGapok(emp, salaryMatrix, targetDate);
                    const slip = slipStates[emp.id];

                    return (
                      <TableRow key={emp.id} className="border-slate-100 hover:bg-slate-50/50 transition-colors">
                        <TableCell className="font-medium pl-8 py-4 w-[320px] max-w-[320px]">
                          <span className="block truncate" title={emp.name}>{emp.name}</span>
                        </TableCell>
                        <TableCell className="py-4 w-[320px] max-w-[320px]">
                          <div className="flex flex-col">
                            <div className="flex items-center gap-2">
                              <span className="block truncate max-w-[280px]" title={emp.role}>{emp.role}</span>
                              {!emp.isActive && (
                                <Badge variant="secondary" className="bg-slate-100 text-slate-500 text-[10px] h-4 px-1.5 font-normal uppercase shrink-0">
                                  Keluar
                                </Badge>
                              )}
                            </div>
                            <span className="text-xs text-slate-500 truncate max-w-[300px]" title={`Golongan ${emp.gradeLevel}`}>Golongan {emp.gradeLevel}</span>
                          </div>
                        </TableCell>
                        <TableCell className="py-4 text-slate-600">
                          {(() => {
                            const cat = emp.raw.employment?.jobCategory;
                            const period = `${targetDate.getFullYear()}_${String(targetDate.getMonth() + 1).padStart(2, '0')}`;
                            const uraian = uraianMap[`${period}_${cat}`]?.entries?.[emp.id];
                            const gapokVal = calculateGapok(emp, salaryMatrix, targetDate);
                            return formatIDR(calculateTotalEarnings(emp.raw, gapokVal, uraian, vakasiTambahanMap[emp.id] ?? 0, functionalAllowanceMap[emp.id] ?? 0));
                          })()}
                        </TableCell>
                        <TableCell className="py-4 text-slate-600">
                          {formatIDR(calculateTotalDeductions(emp.raw))}
                        </TableCell>
                        <TableCell className="py-4 font-bold text-indigo-700">
                          {(() => {
                            const cat = emp.raw.employment?.jobCategory;
                            const period = `${targetDate.getFullYear()}_${String(targetDate.getMonth() + 1).padStart(2, '0')}`;
                            const uraian = uraianMap[`${period}_${cat}`]?.entries?.[emp.id];
                            const gapokVal = calculateGapok(emp, salaryMatrix, targetDate);
                            const earnings = calculateTotalEarnings(emp.raw, gapokVal, uraian, vakasiTambahanMap[emp.id] ?? 0, functionalAllowanceMap[emp.id] ?? 0);
                            const deductions = calculateTotalDeductions(emp.raw);
                            return formatIDR(calculateNetSalary(earnings, deductions));
                          })()}
                        </TableCell>
                        <TableCell className="text-right pr-8 py-4">
                          <div className="flex justify-end gap-2">
                            {/* ─── Stage 1: No slip yet ──────────────── */}
                            {!slip && (
                              <button
                                id={`cetak-${emp.id}`}
                                onClick={() => openCreateDialog(emp)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold
                                  bg-indigo-50 text-indigo-600 border border-indigo-200
                                  hover:bg-indigo-100 hover:border-indigo-300 hover:shadow-sm
                                  transition-all duration-150 cursor-pointer"
                              >
                                <Printer className="w-3.5 h-3.5" />
                                Cetak
                              </button>
                            )}

                            {/* ─── Stage 2: Slip printed, awaiting confirmation ── */}
                            {slip && slip.status === 'printed' && (
                              <>
                                <button
                                  id={`tinjau-${emp.id}`}
                                  onClick={() => openReviewDialog(emp)}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold
                                    bg-amber-50 text-amber-600 border border-amber-200
                                    hover:bg-amber-100 hover:border-amber-300 hover:shadow-sm
                                    transition-all duration-150 cursor-pointer"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                  Tinjau
                                </button>
                                <button
                                  id={`konfirmasi-${emp.id}`}
                                  onClick={() => handleSlipConfirmed(emp.id)}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold
                                    bg-emerald-50 text-emerald-600 border border-emerald-200
                                    hover:bg-emerald-100 hover:border-emerald-300 hover:shadow-sm
                                    transition-all duration-150 cursor-pointer"
                                >
                                  <CircleCheck className="w-3.5 h-3.5" />
                                  Konfirmasi
                                </button>
                              </>
                            )}

                            {/* ─── Stage 3: Confirmed ──────────────── */}
                            {slip && slip.status === 'confirmed' && (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold
                                bg-emerald-100 text-emerald-700 border border-emerald-200">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Lunas
                              </span>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        </Card>
      </div>

      {/* ─── Pay Slip Dialog ─────────────────────────────────────── */}
      <PaySlipDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mode={dialogMode}
        employee={selectedEmployee?.raw ?? null}
        employeeNo={selectedEmployee?.rowIndex ?? 0}
        gapok={selectedEmployee ? calculateGapok(selectedEmployee, salaryMatrix, targetDate) : 0}
        period={payrollPeriod}
        slipState={selectedEmployee ? slipStates[selectedEmployee.id] ?? null : null}
        onSlipGenerated={handleSlipGenerated}
        onSlipConfirmed={handleSlipConfirmed}
        activeTab={payrollCollar}
        uraianEntry={(() => {
          if (!selectedEmployee) return undefined;
          const cat = selectedEmployee.raw.employment?.jobCategory;
          const period = `${targetDate.getFullYear()}_${String(targetDate.getMonth() + 1).padStart(2, '0')}`;
          const uraianDoc = uraianMap[`${period}_${cat}`];
          return uraianDoc?.entries?.[selectedEmployee.id] ?? undefined;
        })()}
        vakasiTambahanSum={selectedEmployee ? vakasiTambahanMap[selectedEmployee.id] ?? 0 : 0}
        vakasiTambahanList={selectedEmployee ? vakasiTambahanListMap[selectedEmployee.id] ?? [] : []}
        tunjanganFungsional={selectedEmployee ? functionalAllowanceMap[selectedEmployee.id] ?? 0 : 0}
      />

      <LegalitasPimpinanDialog
        open={legalitasDialogOpen}
        onOpenChange={setLegalitasDialogOpen}
        employees={employees}
        categories={categories}
        salaryMatrix={salaryMatrix}
        targetDate={targetDate}
        uraianMap={uraianMap}
        periodName={payrollPeriod}
        vakasiTambahanMap={vakasiTambahanMap}
        functionalAllowanceMap={functionalAllowanceMap}
      />

      <CetakPayrollDialog
        open={cetakPayrollDialogOpen}
        onOpenChange={setCetakPayrollDialogOpen}
        employees={employees}
        salaryMatrix={salaryMatrix}
        targetDate={targetDate}
        uraianMap={uraianMap}
        periodName={payrollPeriod}
        onPrintPdf={handlePrintPayrollStatement}
        vakasiTambahanMap={vakasiTambahanMap}
        functionalAllowanceMap={functionalAllowanceMap}
      />

      {/* ─── Print Selection Dialog ─────────────────────────────────── */}
      <Dialog open={printSelectorOpen} onOpenChange={setPrintSelectorOpen}>
        <DialogContent className="sm:max-w-[460px] p-6 rounded-2xl bg-white border border-slate-100 shadow-[0_20px_50px_rgba(0,0,0,0.1)]">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold tracking-tight text-slate-900 flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-indigo-50 text-indigo-600">
                <Printer className="w-5 h-5" />
              </div>
              Cetak Dokumen Payroll
            </DialogTitle>
            <DialogDescription className="text-slate-500 mt-2 text-sm">
              Pilih format dokumen payroll yang ingin Anda cetak atau unduh untuk periode <span className="font-semibold text-slate-700">{payrollPeriod}</span>.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3.5 mt-4">
            {/* Card 1: Cetak Legalitas Pimpinan */}
            <button
              onClick={() => {
                setPrintSelectorOpen(false);
                setLegalitasDialogOpen(true);
              }}
              className="group flex items-start gap-4 p-4 rounded-2xl border border-slate-100 bg-slate-50/40 hover:bg-indigo-50/30 hover:border-indigo-100 transition-all duration-200 text-left outline-none cursor-pointer"
            >
              <div className="flex-shrink-0 p-3 rounded-xl bg-indigo-50 text-indigo-600 group-hover:bg-indigo-100/70 transition-colors">
                <Award className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-slate-800 text-[15px] group-hover:text-indigo-900 transition-colors">
                  Legalitas Pimpinan
                </h3>
                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                  Cetak slip validasi pimpinan untuk keperluan pengesahan resmi.
                </p>
              </div>
              <div className="flex-shrink-0 self-center pl-2">
                <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-indigo-500 group-hover:translate-x-1 transition-all duration-200" />
              </div>
            </button>

            {/* Card 2: Cetak Rekap Gaji */}
            <button
              onClick={() => {
                setPrintSelectorOpen(false);
                handlePrintRekap();
              }}
              className="group flex items-start gap-4 p-4 rounded-2xl border border-slate-100 bg-slate-50/40 hover:bg-emerald-50/30 hover:border-emerald-100 transition-all duration-200 text-left outline-none cursor-pointer"
            >
              <div className="flex-shrink-0 p-3 rounded-xl bg-emerald-50 text-emerald-600 group-hover:bg-emerald-100/70 transition-colors">
                <FileSpreadsheet className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-slate-800 text-[15px] group-hover:text-emerald-900 transition-colors">
                  Rekapitulasi Gaji
                </h3>
                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                  Unduh laporan rekap vakasi total berdasarkan masing-masing divisi.
                </p>
              </div>
              <div className="flex-shrink-0 self-center pl-2">
                <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-emerald-500 group-hover:translate-x-1 transition-all duration-200" />
              </div>
            </button>

            {/* Card 3: Cetak Payroll Statement */}
            <button
              onClick={() => {
                setPrintSelectorOpen(false);
                setCetakPayrollDialogOpen(true);
              }}
              className="group flex items-start gap-4 p-4 rounded-2xl border border-slate-100 bg-slate-50/40 hover:bg-amber-50/30 hover:border-amber-100 transition-all duration-200 text-left outline-none cursor-pointer"
            >
              <div className="flex-shrink-0 p-3 rounded-xl bg-amber-50 text-amber-600 group-hover:bg-amber-100/70 transition-colors">
                <Banknote className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-slate-800 text-[15px] group-hover:text-amber-900 transition-colors">
                  Payroll Statement
                </h3>
                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                  Cetak rincian rekening bank dan surat pengantar transfer bank.
                </p>
              </div>
              <div className="flex-shrink-0 self-center pl-2">
                <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-amber-500 group-hover:translate-x-1 transition-all duration-200" />
              </div>
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
