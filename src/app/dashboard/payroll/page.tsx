"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { calculateYearsOfService, calculateGapok } from '@/utils/payrollLogic';
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
} from 'lucide-react';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Employee, SalaryMatrix, BlueCollarEmployee, UraianGajiDocument, UraianEntry } from '@/types';
import PaySlipDialog, { SlipState } from '@/components/PaySlipDialog';
import LegalitasPimpinanDialog from '@/components/LegalitasPimpinanDialog';
import CetakPayrollDialog from '@/components/CetakPayrollDialog';
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
  raw: BlueCollarEmployee;
  rowIndex: number;
}

export default function PayrollValidationDashboard() {
  const [targetDate] = useState(new Date('2026-05-01'));
  const [activeTab, setActiveTab] = useState('Tagihan');
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [salaryMatrix, setSalaryMatrix] = useState<SalaryMatrix>({});
  const [loading, setLoading] = useState(true);
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' | null }>({ key: '', direction: null });

  // ─── Filters ───────────────────────────────────────────────────
  const [activityFilter, setActivityFilter] = useState<'active' | 'all'>('active');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  // ─── Slip status state (keyed by employeeId) ───────────────────
  const [slipStates, setSlipStates] = useState<Record<string, SlipState>>({});

  // ─── UraianGaji state (keyed by docId e.g. "2026_05_KEBERSIHAN") ──
  const [uraianMap, setUraianMap] = useState<Record<string, UraianGajiDocument>>({});

  // ─── Dialog state ──────────────────────────────────────────────
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<'create' | 'review'>('create');
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeRow | null>(null);

  const [legalitasDialogOpen, setLegalitasDialogOpen] = useState(false);
  const [cetakPayrollDialogOpen, setCetakPayrollDialogOpen] = useState(false);

  const handlePrintRekap = () => {
    const activeEmployees = employees.filter(e => e.isActive);
    const categoriesMap: Record<string, RekapCategoryData> = {};
    
    categories.forEach(cat => {
      categoriesMap[cat] = {
        categoryName: `VAKASI ${cat}`,
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
      
      const earnings = calculateTotalEarnings(emp.raw, gapok, uraianEntry);
      
      const bpjs = emp.raw.bpjs?.deductionAmount ? Math.round(emp.raw.bpjs.deductionAmount) : 0;
      const kopRochmad = emp.raw.deductions?.koperasiRochmad || 0;
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
    
    const roleOrder = ['SATPAM', 'SOPIR', 'PEKARYA', 'TEKNISI', 'KEBERSIHAN_IC', 'PONTI'];
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
      
      const earnings = calculateTotalEarnings(emp.raw, gapok, uraianEntry);
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
        accountNumber: emp.raw.bankAccount?.accountNumber || '',
        netSalary
      };
    });

    const data: PayrollStatementData = {
      period: getPayrollPeriod(targetDate),
      employees: stmtEmployees,
      totalNetSalary
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
          const uraianA = uraianMap[`${targetDate.getFullYear()}_${String(targetDate.getMonth() + 1).padStart(2, '0')}_${a.raw.employment?.jobCategory}`]?.entries?.[a.id];
          aValue = calculateTotalEarnings(a.raw, gapokA, uraianA);

          const gapokB = calculateGapok(b, salaryMatrix, targetDate);
          const uraianB = uraianMap[`${targetDate.getFullYear()}_${String(targetDate.getMonth() + 1).padStart(2, '0')}_${b.raw.employment?.jobCategory}`]?.entries?.[b.id];
          bValue = calculateTotalEarnings(b.raw, gapokB, uraianB);
          break;
        }
        case 'deductions':
          aValue = calculateTotalDeductions(a.raw);
          bValue = calculateTotalDeductions(b.raw);
          break;
        case 'net': {
          const gapokA = calculateGapok(a, salaryMatrix, targetDate);
          const uraianA = uraianMap[`${targetDate.getFullYear()}_${String(targetDate.getMonth() + 1).padStart(2, '0')}_${a.raw.employment?.jobCategory}`]?.entries?.[a.id];
          const earningsA = calculateTotalEarnings(a.raw, gapokA, uraianA);
          const deductionsA = calculateTotalDeductions(a.raw);
          aValue = calculateNetSalary(earningsA, deductionsA);

          const gapokB = calculateGapok(b, salaryMatrix, targetDate);
          const uraianB = uraianMap[`${targetDate.getFullYear()}_${String(targetDate.getMonth() + 1).padStart(2, '0')}_${b.raw.employment?.jobCategory}`]?.entries?.[b.id];
          const earningsB = calculateTotalEarnings(b.raw, gapokB, uraianB);
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

        // 1. Fetch Blue Collar Employees
        const empSnapshot = await getDocs(collection(db, 'Employees_BlueCollar'));
        let index = 1;
        const empList = empSnapshot.docs
          .map(docSnap => {
            const data = docSnap.data() as BlueCollarEmployee;
            const row: EmployeeRow = {
              id: docSnap.id,
              name: data.name,
              role: data.employment?.jobCategory || '',
              gradeLevel: data.salaryProfile?.salaryGradeCode || '',
              joinDate: data.employment?.startDate ? new Date(data.employment.startDate) : new Date(),
              isActive: data.flags?.isActive ?? true,
              raw: { ...data, employeeId: docSnap.id },
              rowIndex: index++,
            };
            return row;
          });
        setEmployees(empList);

        // 2. Fetch Active Salary Matrix Version
        const matrixRootRef = doc(db, 'SalaryMatrix', '_config');
        const matrixRootSnap = await getDoc(matrixRootRef);

        let activeVersion = '2026_v1';
        if (matrixRootSnap.exists() && matrixRootSnap.data().activeVersion) {
          activeVersion = matrixRootSnap.data().activeVersion;
        }

        // 3. Fetch Salary Matrix Rows for Active Version
        const matrixSnapshot = await getDocs(collection(db, 'SalaryMatrix', activeVersion, 'rows'));
        const matrix: SalaryMatrix = {};

        matrixSnapshot.docs.forEach(matrixDoc => {
          const data = matrixDoc.data();
          const tahun = data.tahun;
          const grades = data.salaries || {};

          // Reconstruct the SalaryMatrix object [gradeLevel][yearsOfService]
          // Our local calculateGapok logic expects: matrix[gradeLevel][years]
          // But the Firestore structure is: rows/{tahun}/salaries/{gradeCode}
          // We need to pivot this for the existing calculateGapok utility.

          Object.entries(grades).forEach(([grade, amount]) => {
            if (!matrix[grade]) matrix[grade] = {};
            matrix[grade][tahun] = amount as number;
          });
        });

        setSalaryMatrix(matrix);
      } catch (error) {
        console.error("Error fetching data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

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
          </div>
          <div className="flex gap-3">
            <Button 
              onClick={() => setLegalitasDialogOpen(true)}
              variant="outline" 
              className="rounded-xl shadow-sm bg-white border-slate-200 text-slate-600 hover:text-indigo-600 hover:border-indigo-100 transition-all"
            >
              <Printer className="w-4 h-4 mr-2" /> Cetak Legalitas
            </Button>
            <Button 
              onClick={handlePrintRekap}
              variant="outline" 
              className="rounded-xl shadow-sm bg-white border-slate-200 text-slate-600 hover:text-indigo-600 hover:border-indigo-100 transition-all"
            >
              <Printer className="w-4 h-4 mr-2" /> Cetak Rekap
            </Button>
            <Button 
              onClick={() => setCetakPayrollDialogOpen(true)}
              variant="outline" 
              className="rounded-xl shadow-sm bg-white border-slate-200 text-slate-600 hover:text-indigo-600 hover:border-indigo-100 transition-all"
            >
              <Printer className="w-4 h-4 mr-2" /> Cetak Payroll
            </Button>
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
                  <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-purple-500 to-indigo-400 flex items-center justify-center">
                    <Hexagon className="w-5 h-5 text-white" />
                  </div>
                  <h1 className="text-2xl font-bold tracking-tight">BAK UNIPDU Payroll</h1>
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500 mt-1"></div>
                </div>

                {/* Filter Controls */}
                <div className="flex flex-wrap items-center gap-4 mb-6">
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
                    className="bg-white border border-slate-200 text-slate-600 text-xs font-semibold rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all cursor-pointer"
                  >
                    <option value="all">Semua Kategori</option>
                    {categories.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
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
                    <TableHead className="font-medium text-slate-500 pl-8 cursor-pointer hover:text-indigo-600 transition-colors" onClick={() => handleSort('name')}>
                      <div className="flex items-center gap-1">
                        Nama Karyawan
                        <SortIcon active={sortConfig.key === 'name'} direction={sortConfig.direction} />
                      </div>
                    </TableHead>
                    <TableHead className="font-medium text-slate-500 cursor-pointer hover:text-indigo-600 transition-colors" onClick={() => handleSort('role')}>
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
                        <TableCell className="font-medium pl-8 py-4">{emp.name}</TableCell>
                        <TableCell className="py-4">
                          <div className="flex flex-col">
                            <div className="flex items-center gap-2">
                              <span>{emp.role}</span>
                              {!emp.isActive && (
                                <Badge variant="secondary" className="bg-slate-100 text-slate-500 text-[10px] h-4 px-1.5 font-normal uppercase">
                                  Keluar
                                </Badge>
                              )}
                            </div>
                            <span className="text-xs text-slate-500">Golongan {emp.gradeLevel}</span>
                          </div>
                        </TableCell>
                        <TableCell className="py-4 text-slate-600">
                          {(() => {
                            const cat = emp.raw.employment?.jobCategory;
                            const period = `${targetDate.getFullYear()}_${String(targetDate.getMonth() + 1).padStart(2, '0')}`;
                            const uraian = uraianMap[`${period}_${cat}`]?.entries?.[emp.id];
                            const gapokVal = calculateGapok(emp, salaryMatrix, targetDate);
                            return formatIDR(calculateTotalEarnings(emp.raw, gapokVal, uraian));
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
                            const earnings = calculateTotalEarnings(emp.raw, gapokVal, uraian);
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
        uraianEntry={(() => {
          if (!selectedEmployee) return undefined;
          const cat = selectedEmployee.raw.employment?.jobCategory;
          const period = `${targetDate.getFullYear()}_${String(targetDate.getMonth() + 1).padStart(2, '0')}`;
          const uraianDoc = uraianMap[`${period}_${cat}`];
          return uraianDoc?.entries?.[selectedEmployee.id] ?? undefined;
        })()}
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
      />
    </div>
  );
}
