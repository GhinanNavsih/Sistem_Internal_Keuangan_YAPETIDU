"use client";

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/AuthContext';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
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
  TrendingUp,
  TrendingDown,
  Users,
  Banknote,
  Activity,
  ArrowRight,
  PiggyBank,
  CheckCircle,
  FileCheck,
  Calendar,
  AlertCircle,
  ArrowLeft,
  DollarSign,
  FileSpreadsheet,
  FileText,
  Percent,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

// Indonesian Month Labels
const MONTHS_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

// Format Currency to IDR
const formatIDR = (amount: number) => {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

// Convert Period ID (e.g., '2026_05') to readable Indonesian label (e.g., 'Mei 2026')
const formatPeriodLabel = (periodId: string): string => {
  const parts = periodId.split('_');
  if (parts.length !== 2) return periodId;
  const [yearStr, monthStr] = parts;
  const monthIdx = parseInt(monthStr, 10) - 1;
  const monthName = MONTHS_ID[monthIdx] || monthStr;
  return `${monthName} ${yearStr}`;
};

interface PeriodAggregate {
  period: string; // e.g., "2026_05"
  label: string; // e.g., "Mei 2026"
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  
  // Loyalis (White Collar) aggregates
  loyalisGross: number;
  loyalisDeductions: number;
  loyalisNet: number;
  loyalisCount: number;
  
  // Pekarya (Blue Collar) aggregates
  pekaryaGross: number;
  pekaryaDeductions: number;
  pekaryaNet: number;
  pekaryaCount: number;

  totalSlipsCount: number;
  confirmedSlipsCount: number;
  
  deductionsBreakdown: Record<string, number>;
}

export default function TreasuryDashboard() {
  const { user, profile, loading: authLoading } = useAuth();
  const router = useRouter();

  // Component states
  const [mounted, setMounted] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [employeesLoyalis, setEmployeesLoyalis] = useState<any[]>([]);
  const [employeesBlueCollar, setEmployeesBlueCollar] = useState<any[]>([]);
  const [slips, setSlips] = useState<any[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<string>('');

  // Hydration prevention
  useEffect(() => {
    setMounted(true);
  }, []);

  // Fetch data on mount
  useEffect(() => {
    if (!profile || profile.role !== 'super_admin') return;

    const fetchData = async () => {
      try {
        setDataLoading(true);
        // Fetch Loyalis, BlueCollar, and SlipStates parallelly
        const [loySnap, bcSnap, slipSnap] = await Promise.all([
          getDocs(collection(db, 'Employees_Loyalis')),
          getDocs(collection(db, 'Employees_BlueCollar')),
          getDocs(collection(db, 'PayrollSlipStates')),
        ]);

        const loyData = loySnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const bcData = bcSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const slipData = slipSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        setEmployeesLoyalis(loyData);
        setEmployeesBlueCollar(bcData);
        setSlips(slipData);
      } catch (err) {
        console.error('Error fetching dashboard data:', err);
      } finally {
        setDataLoading(false);
      }
    };

    fetchData();
  }, [profile]);

  // Master Active Counts
  const activeStaffCounts = useMemo(() => {
    const activeLoyalis = employeesLoyalis.filter(
      e => e.personal_info?.status === 'AKTIF'
    ).length;
    
    const activeBlueCollar = employeesBlueCollar.filter(
      e => e.flags?.isActive !== false
    ).length;

    return {
      loyalis: activeLoyalis,
      pekarya: activeBlueCollar,
      total: activeLoyalis + activeBlueCollar,
    };
  }, [employeesLoyalis, employeesBlueCollar]);

  // Map employee ID to category
  const employeeCategoryMap = useMemo(() => {
    const map: Record<string, 'loyalis' | 'pekarya'> = {};
    employeesLoyalis.forEach(e => {
      map[e.id] = 'loyalis';
    });
    employeesBlueCollar.forEach(e => {
      map[e.id] = 'pekarya';
    });
    return map;
  }, [employeesLoyalis, employeesBlueCollar]);

  // Aggregation of Slip States by Period
  const periodAggregates = useMemo(() => {
    const aggregates: Record<string, PeriodAggregate> = {};

    slips.forEach(d => {
      const period = d.period || d.id.substring(0, 7);
      const employeeId = d.employeeId || d.id.substring(period.length + 1);

      if (!aggregates[period]) {
        aggregates[period] = {
          period,
          label: formatPeriodLabel(period),
          totalGross: 0,
          totalDeductions: 0,
          totalNet: 0,
          loyalisGross: 0,
          loyalisDeductions: 0,
          loyalisNet: 0,
          loyalisCount: 0,
          pekaryaGross: 0,
          pekaryaDeductions: 0,
          pekaryaNet: 0,
          pekaryaCount: 0,
          totalSlipsCount: 0,
          confirmedSlipsCount: 0,
          deductionsBreakdown: {},
        };
      }

      const agg = aggregates[period];
      agg.totalSlipsCount++;

      const isConfirmed = d.status === 'confirmed' || d.status === 'printed';
      if (isConfirmed) {
        agg.confirmedSlipsCount++;

        const gross = (d.earnings || []).reduce((sum: number, e: any) => sum + (e.amount || 0), 0);
        const deductions = (d.deductions || []).reduce((sum: number, de: any) => sum + (de.amount || 0), 0);
        const net = gross - deductions;

        agg.totalGross += gross;
        agg.totalDeductions += deductions;
        agg.totalNet += net;

        // Categorize employee
        const category = employeeCategoryMap[employeeId] || (employeeId.startsWith('Loyalis_') ? 'loyalis' : 'pekarya');

        if (category === 'loyalis') {
          agg.loyalisGross += gross;
          agg.loyalisDeductions += deductions;
          agg.loyalisNet += net;
          agg.loyalisCount++;
        } else {
          agg.pekaryaGross += gross;
          agg.pekaryaDeductions += deductions;
          agg.pekaryaNet += net;
          agg.pekaryaCount++;
        }

        // Deduction breakdown
        (d.deductions || []).forEach((de: any) => {
          const label = de.label || 'Lain-lain';
          agg.deductionsBreakdown[label] = (agg.deductionsBreakdown[label] || 0) + (de.amount || 0);
        });
      }
    });

    return aggregates;
  }, [slips, employeeCategoryMap]);

  // Sorted Periods list
  const sortedPeriods = useMemo(() => {
    return Object.keys(periodAggregates).sort();
  }, [periodAggregates]);

  // Initialize selectedPeriod once data is loaded
  useEffect(() => {
    if (sortedPeriods.length > 0 && !selectedPeriod) {
      setSelectedPeriod(sortedPeriods[sortedPeriods.length - 1]);
    }
  }, [sortedPeriods, selectedPeriod]);

  // Selected period data
  const currentPeriodData = useMemo(() => {
    return periodAggregates[selectedPeriod] || null;
  }, [periodAggregates, selectedPeriod]);

  // Month-over-Month Delta Calculations
  const deltas = useMemo(() => {
    if (!selectedPeriod || sortedPeriods.length < 2) return null;
    const currentIndex = sortedPeriods.indexOf(selectedPeriod);
    if (currentIndex <= 0) return null; // No previous month available in dataset

    const prevPeriod = sortedPeriods[currentIndex - 1];
    const currAgg = periodAggregates[selectedPeriod];
    const prevAgg = periodAggregates[prevPeriod];

    if (!currAgg || !prevAgg) return null;

    const calcPct = (curr: number, prev: number) => {
      if (prev === 0) return 0;
      return ((curr - prev) / prev) * 100;
    };

    return {
      gross: calcPct(currAgg.totalGross, prevAgg.totalGross),
      deductions: calcPct(currAgg.totalDeductions, prevAgg.totalDeductions),
      net: calcPct(currAgg.totalNet, prevAgg.totalNet),
      staff: calcPct(currAgg.confirmedSlipsCount, prevAgg.confirmedSlipsCount),
    };
  }, [selectedPeriod, sortedPeriods, periodAggregates]);

  // Recharts Chart Data (Historical Trends)
  const chartData = useMemo(() => {
    return sortedPeriods.map(p => {
      const agg = periodAggregates[p];
      return {
        name: agg.label,
        'Pendapatan Kotor': agg.totalGross,
        'Potongan': agg.totalDeductions,
        'Gaji Bersih': agg.totalNet,
      };
    });
  }, [sortedPeriods, periodAggregates]);

  // Selected Period Deduction Breakdown (Sorted)
  const sortedDeductions = useMemo(() => {
    if (!currentPeriodData) return [];
    return Object.entries(currentPeriodData.deductionsBreakdown)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [currentPeriodData]);

  // Custom Chart Tooltip
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white/95 backdrop-blur-sm p-4 border border-slate-200/80 rounded-2xl shadow-xl">
          <p className="font-bold text-slate-800 mb-2">{label}</p>
          {payload.map((entry: any, index: number) => (
            <p key={index} className="text-sm font-semibold flex items-center gap-1" style={{ color: entry.stroke || entry.fill }}>
              <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: entry.stroke || entry.fill }}></span>
              {entry.name}: {formatIDR(entry.value)}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  // Guard loading states
  if (authLoading || !mounted) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-400 flex items-center justify-center shadow-lg shadow-indigo-200">
            <Loader2 className="w-6 h-6 text-white animate-spin" />
          </div>
          <p className="text-sm text-slate-500 font-medium animate-pulse font-sans">Memuat Dashboard...</p>
        </div>
      </div>
    );
  }

  // Double-check authorization
  if (!user || !profile || profile.role !== 'super_admin') {
    return null; // Route layout will handle redirect
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50/50 via-white to-purple-50/50 p-6 md:p-8 font-sans text-slate-800">
      <div className="max-w-[1400px] mx-auto space-y-8">
        
        {/* Section 1: Header & Period Selector */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-white/40 backdrop-blur-md p-6 rounded-3xl border border-slate-200/50 shadow-sm">
          <div>
            <span className="text-indigo-600 text-xs font-bold uppercase tracking-wider">Treasury & Financial Dashboard</span>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 mt-1">
              Yayasan Pendidikan Islam Darul 'Ulum (YAPETIDU)
            </h1>
            <p className="text-slate-500 text-sm mt-1">
              Selamat datang kembali, <span className="font-semibold text-slate-700">{profile.displayName || 'Bendahara'}</span>. Berikut ringkasan arus kas payroll Anda.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2 bg-white/80 border border-slate-200 px-4 py-2 rounded-2xl shadow-sm">
              <Calendar className="w-4 h-4 text-indigo-500" />
              <span className="text-sm font-semibold text-slate-700">Periode Laporan:</span>
              {sortedPeriods.length > 0 ? (
                <Select value={selectedPeriod} onValueChange={(val) => { if (val) setSelectedPeriod(val); }}>
                  <SelectTrigger className="border-0 bg-transparent p-0 text-sm font-bold text-indigo-600 hover:text-indigo-700 focus:ring-0 focus:ring-offset-0 h-auto cursor-pointer gap-1">
                    <SelectValue placeholder="Pilih Periode" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl border-slate-200 shadow-md">
                    {sortedPeriods.map(p => (
                      <SelectItem key={p} value={p} className="cursor-pointer font-medium hover:bg-slate-50">
                        {formatPeriodLabel(p)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <span className="text-sm font-bold text-slate-400">Belum ada data</span>
              )}
            </div>

            <div className="flex items-center gap-2 bg-indigo-50/50 border border-indigo-100/50 px-4 py-2 rounded-2xl">
              <Users className="w-4 h-4 text-indigo-600" />
              <span className="text-xs font-medium text-indigo-800">
                Staf Aktif Master: <span className="font-bold">{activeStaffCounts.total} orang</span>
              </span>
            </div>
          </div>
        </div>

        {/* Section 1.5: Period Processing Progress Info */}
        {currentPeriodData && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 bg-slate-50/50 border border-slate-200/50 p-6 rounded-2xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
                <FileCheck className="w-5 h-5 text-indigo-600" />
              </div>
              <div>
                <p className="text-xs text-slate-500 font-medium">Status Konfirmasi Slip</p>
                <p className="text-sm font-bold text-slate-800">
                  {currentPeriodData.confirmedSlipsCount} / {activeStaffCounts.total} Slip Dikonfirmasi
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
                <Activity className="w-5 h-5 text-indigo-600" />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-slate-500 font-medium">Progress Penyelesaian Gaji</p>
                  <p className="text-xs font-bold text-indigo-600">
                    {activeStaffCounts.total > 0
                      ? Math.min(100, (currentPeriodData.confirmedSlipsCount / activeStaffCounts.total) * 100).toFixed(2)
                      : "0.00"}%
                  </p>
                </div>
                <div className="w-full bg-slate-200 h-1.5 rounded-full mt-1 overflow-hidden">
                  <div 
                    className="bg-indigo-600 h-1.5 rounded-full transition-all duration-500" 
                    style={{ 
                      width: `${activeStaffCounts.total > 0 ? Math.min(100, (currentPeriodData.confirmedSlipsCount / activeStaffCounts.total) * 100) : 0}%` 
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
                <AlertCircle className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <p className="text-xs text-slate-500 font-medium">Menunggu Konfirmasi</p>
                <p className="text-sm font-bold text-slate-800">
                  {Math.max(0, activeStaffCounts.total - currentPeriodData.confirmedSlipsCount)} Slip Gaji
                </p>
              </div>
            </div>
          </div>
        )}

        {dataLoading ? (
          <div className="h-[400px] flex flex-col items-center justify-center bg-white/40 border border-slate-200/50 rounded-3xl">
            <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
            <p className="text-slate-500 text-sm mt-3 font-medium">Sedang memproses data keuangan...</p>
          </div>
        ) : !currentPeriodData ? (
          <div className="p-12 text-center bg-white border border-slate-200 rounded-3xl shadow-sm">
            <AlertCircle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
            <h3 className="text-lg font-bold text-slate-800 mb-1">Belum Ada Data Slip Gaji</h3>
            <p className="text-slate-500 text-sm max-w-md mx-auto">
              Tidak ditemukan data slip gaji di sistem. Silakan masuk ke modul Validasi Gaji untuk men-generate slip baru.
            </p>
            <Link href="/dashboard/payroll" className="inline-block mt-4">
              <Button className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer">
                Generasikan Payroll
              </Button>
            </Link>
          </div>
        ) : (
          <>
            {/* Section 2: Summary Metric Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              
              {/* Card 1: Gross Revenue / Expenses */}
              <Card className="hover:shadow-lg transition-all duration-300 border-emerald-100 hover:border-emerald-200 bg-gradient-to-br from-white to-emerald-50/10">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <div className="space-y-0.5">
                    <CardTitle className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Pendapatan Kotor</CardTitle>
                    <CardDescription className="text-slate-400 text-xs">Total beban pra-potongan</CardDescription>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600">
                    <Banknote className="w-5 h-5" />
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-2xl font-black text-slate-900 tracking-tight">
                    {formatIDR(currentPeriodData.totalGross)}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {deltas ? (
                      deltas.gross > 0 ? (
                        <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 rounded-lg py-0.5 px-2 flex items-center gap-0.5 text-xs font-semibold">
                          <TrendingUp className="w-3.5 h-3.5" />
                          {deltas.gross.toFixed(1)}% MoM
                        </Badge>
                      ) : deltas.gross < 0 ? (
                        <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200 rounded-lg py-0.5 px-2 flex items-center gap-0.5 text-xs font-semibold">
                          <TrendingDown className="w-3.5 h-3.5" />
                          {Math.abs(deltas.gross).toFixed(1)}% MoM
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-slate-50 text-slate-600 border-slate-200 rounded-lg py-0.5 px-2 text-xs font-semibold">
                          0% MoM
                        </Badge>
                      )
                    ) : (
                      <span className="text-slate-400 text-xs font-medium">Bulan pertama data</span>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Card 2: Total Deductions */}
              <Card className="hover:shadow-lg transition-all duration-300 border-rose-100 hover:border-rose-200 bg-gradient-to-br from-white to-rose-50/10">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <div className="space-y-0.5">
                    <CardTitle className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Potongan Gaji</CardTitle>
                    <CardDescription className="text-slate-400 text-xs">BPJS, Koperasi, Zakat, dll</CardDescription>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-rose-50 flex items-center justify-center text-rose-600">
                    <PiggyBank className="w-5 h-5" />
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-2xl font-black text-slate-900 tracking-tight">
                    {formatIDR(currentPeriodData.totalDeductions)}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {deltas ? (
                      deltas.deductions > 0 ? (
                        <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200 rounded-lg py-0.5 px-2 flex items-center gap-0.5 text-xs font-semibold">
                          <TrendingUp className="w-3.5 h-3.5" />
                          {deltas.deductions.toFixed(1)}% MoM
                        </Badge>
                      ) : deltas.deductions < 0 ? (
                        <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 rounded-lg py-0.5 px-2 flex items-center gap-0.5 text-xs font-semibold">
                          <TrendingDown className="w-3.5 h-3.5" />
                          {Math.abs(deltas.deductions).toFixed(1)}% MoM
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-slate-50 text-slate-600 border-slate-200 rounded-lg py-0.5 px-2 text-xs font-semibold">
                          0% MoM
                        </Badge>
                      )
                    ) : (
                      <span className="text-slate-400 text-xs font-medium">Bulan pertama data</span>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Card 3: Net Salary (Payout Expense) */}
              <Card className="hover:shadow-lg transition-all duration-300 border-indigo-100 hover:border-indigo-200 bg-gradient-to-br from-white to-indigo-50/10">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <div className="space-y-0.5">
                    <CardTitle className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Gaji Bersih</CardTitle>
                    <CardDescription className="text-slate-400 text-xs">Kas ditransfer ke pegawai</CardDescription>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600">
                    <DollarSign className="w-5 h-5" />
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-2xl font-black text-indigo-600 tracking-tight">
                    {formatIDR(currentPeriodData.totalNet)}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {deltas ? (
                      deltas.net > 0 ? (
                        <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 rounded-lg py-0.5 px-2 flex items-center gap-0.5 text-xs font-semibold">
                          <TrendingUp className="w-3.5 h-3.5" />
                          {deltas.net.toFixed(1)}% MoM
                        </Badge>
                      ) : deltas.net < 0 ? (
                        <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200 rounded-lg py-0.5 px-2 flex items-center gap-0.5 text-xs font-semibold">
                          <TrendingDown className="w-3.5 h-3.5" />
                          {Math.abs(deltas.net).toFixed(1)}% MoM
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-slate-50 text-slate-600 border-slate-200 rounded-lg py-0.5 px-2 text-xs font-semibold">
                          0% MoM
                        </Badge>
                      )
                    ) : (
                      <span className="text-slate-400 text-xs font-medium">Bulan pertama data</span>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Card 4: Confirmed Staff Count */}
              <Card className="hover:shadow-lg transition-all duration-300 border-slate-100 hover:border-slate-200 bg-gradient-to-br from-white to-slate-50/10">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <div className="space-y-0.5">
                    <CardTitle className="text-xs font-bold text-slate-500 uppercase tracking-wider">Pegawai Terbayar</CardTitle>
                    <CardDescription className="text-slate-400 text-xs">Slip terkonfirmasi periode ini</CardDescription>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-600">
                    <CheckCircle className="w-5 h-5" />
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-2xl font-black text-slate-900 tracking-tight">
                    {currentPeriodData.confirmedSlipsCount} <span className="text-sm font-bold text-slate-400">Pegawai</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {deltas ? (
                      deltas.staff > 0 ? (
                        <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 rounded-lg py-0.5 px-2 flex items-center gap-0.5 text-xs font-semibold">
                          <TrendingUp className="w-3.5 h-3.5" />
                          +{deltas.staff.toFixed(1)}% MoM
                        </Badge>
                      ) : deltas.staff < 0 ? (
                        <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200 rounded-lg py-0.5 px-2 flex items-center gap-0.5 text-xs font-semibold">
                          <TrendingDown className="w-3.5 h-3.5" />
                          {deltas.staff.toFixed(1)}% MoM
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-slate-50 text-slate-600 border-slate-200 rounded-lg py-0.5 px-2 text-xs font-semibold">
                          0% MoM
                        </Badge>
                      )
                    ) : (
                      <span className="text-slate-400 text-xs font-medium">Bulan pertama data</span>
                    )}
                  </div>
                </CardContent>
              </Card>

            </div>

            {/* Section 3: Historical Trend Chart */}
            <Card className="shadow-md border-slate-200/60 overflow-hidden">
              <CardHeader className="bg-slate-50/50 border-b border-slate-100 p-6 flex flex-row items-center justify-between flex-wrap gap-4">
                <div>
                  <CardTitle className="text-lg font-bold text-slate-800 flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-indigo-500" /> Tren Pengeluaran Payroll
                  </CardTitle>
                  <CardDescription className="text-xs text-slate-500">
                    Histori perbandingan Pendapatan Kotor, Potongan, dan Gaji Bersih per bulan
                  </CardDescription>
                </div>

                <div className="flex items-center gap-4 text-xs font-bold">
                  <span className="flex items-center gap-1.5 text-emerald-600">
                    <span className="w-3 h-3 bg-emerald-500 rounded-full inline-block"></span> Pendapatan Kotor
                  </span>
                  <span className="flex items-center gap-1.5 text-rose-600">
                    <span className="w-3 h-3 bg-rose-500 rounded-full inline-block"></span> Potongan
                  </span>
                  <span className="flex items-center gap-1.5 text-indigo-600">
                    <span className="w-3 h-3 bg-indigo-500 rounded-full inline-block"></span> Gaji Bersih
                  </span>
                </div>
              </CardHeader>
              
              <CardContent className="p-6">
                <div className="w-full h-[320px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={chartData}
                      margin={{ top: 10, right: 10, left: 10, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="colorGross" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.15}/>
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0.01}/>
                        </linearGradient>
                        <linearGradient id="colorDeductions" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.15}/>
                          <stop offset="95%" stopColor="#f43f5e" stopOpacity={0.01}/>
                        </linearGradient>
                        <linearGradient id="colorNet" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6366f1" stopOpacity={0.15}/>
                          <stop offset="95%" stopColor="#6366f1" stopOpacity={0.01}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis 
                        dataKey="name" 
                        tickLine={false} 
                        axisLine={false}
                        tick={{ fill: '#64748b', fontSize: 12, fontWeight: 500 }}
                        dy={10}
                      />
                      <YAxis 
                        tickLine={false} 
                        axisLine={false} 
                        tick={{ fill: '#64748b', fontSize: 11, fontWeight: 500 }}
                        tickFormatter={(value) => `Rp ${value / 1000000}jt`}
                      />
                      <Tooltip content={<CustomTooltip />} />
                      <Area 
                        type="monotone" 
                        dataKey="Pendapatan Kotor" 
                        stroke="#10b981" 
                        strokeWidth={3}
                        fillOpacity={1} 
                        fill="url(#colorGross)" 
                      />
                      <Area 
                        type="monotone" 
                        dataKey="Potongan" 
                        stroke="#f43f5e" 
                        strokeWidth={3}
                        fillOpacity={1} 
                        fill="url(#colorDeductions)" 
                      />
                      <Area 
                        type="monotone" 
                        dataKey="Gaji Bersih" 
                        stroke="#6366f1" 
                        strokeWidth={3.5}
                        fillOpacity={1} 
                        fill="url(#colorNet)" 
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Section 4 & 5: Category Breakdown & Deduction Composition */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              
              {/* Section 4: Category Breakdown */}
              <Card className="shadow-md border-slate-200/60 flex flex-col justify-between">
                <div>
                  <CardHeader className="bg-slate-50/50 border-b border-slate-100 p-6">
                    <CardTitle className="text-lg font-bold text-slate-800 flex items-center gap-2">
                      <Users className="w-5 h-5 text-indigo-500" /> Analisis Segmentasi Kategori
                    </CardTitle>
                    <CardDescription className="text-xs text-slate-500">
                      Perbandingan beban anggaran gaji antara Loyalis vs Pekarya periode {formatPeriodLabel(selectedPeriod)}
                    </CardDescription>
                  </CardHeader>
                  
                  <CardContent className="p-6 space-y-6">
                    
                    {/* Visual Bar Proportion */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs font-bold">
                        <span className="text-indigo-600">Loyalis ({((currentPeriodData.loyalisNet / (currentPeriodData.totalNet || 1)) * 100).toFixed(0)}%)</span>
                        <span className="text-amber-600">Pekarya ({((currentPeriodData.pekaryaNet / (currentPeriodData.totalNet || 1)) * 100).toFixed(0)}%)</span>
                      </div>
                      <div className="w-full h-4 bg-slate-100 rounded-full flex overflow-hidden shadow-inner">
                        <div 
                          className="bg-indigo-500 h-full transition-all duration-500" 
                          style={{ width: `${(currentPeriodData.loyalisNet / (currentPeriodData.totalNet || 1)) * 100}%` }}
                          title={`Loyalis: ${formatIDR(currentPeriodData.loyalisNet)}`}
                        />
                        <div 
                          className="bg-amber-500 h-full transition-all duration-500" 
                          style={{ width: `${(currentPeriodData.pekaryaNet / (currentPeriodData.totalNet || 1)) * 100}%` }}
                          title={`Pekarya: ${formatIDR(currentPeriodData.pekaryaNet)}`}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                      
                      {/* Loyalis Segment */}
                      <div className="border border-indigo-100 bg-indigo-50/20 p-5 rounded-2xl space-y-3">
                        <div className="flex items-center justify-between">
                          <Badge className="bg-indigo-600 text-white rounded-lg">Loyalis</Badge>
                          <span className="text-xs font-bold text-slate-500">{currentPeriodData.loyalisCount} Terbayar</span>
                        </div>
                        
                        <div className="space-y-1">
                          <p className="text-xs text-slate-400 font-medium">Beban Bersih (Net Transfer)</p>
                          <p className="text-lg font-black text-indigo-700">{formatIDR(currentPeriodData.loyalisNet)}</p>
                        </div>
                        
                        <div className="pt-2 border-t border-indigo-100/50 flex justify-between text-xs font-semibold text-slate-500">
                          <span>Kotor: {formatIDR(currentPeriodData.loyalisGross)}</span>
                          <span>Potongan: {formatIDR(currentPeriodData.loyalisDeductions)}</span>
                        </div>
                      </div>

                      {/* Pekarya Segment */}
                      <div className="border border-amber-100 bg-amber-50/20 p-5 rounded-2xl space-y-3">
                        <div className="flex items-center justify-between">
                          <Badge className="bg-amber-500 text-white rounded-lg">Pekarya</Badge>
                          <span className="text-xs font-bold text-slate-500">{currentPeriodData.pekaryaCount} Terbayar</span>
                        </div>
                        
                        <div className="space-y-1">
                          <p className="text-xs text-slate-400 font-medium">Beban Bersih (Net Transfer)</p>
                          <p className="text-lg font-black text-amber-700">{formatIDR(currentPeriodData.pekaryaNet)}</p>
                        </div>
                        
                        <div className="pt-2 border-t border-amber-100/50 flex justify-between text-xs font-semibold text-slate-500">
                          <span>Kotor: {formatIDR(currentPeriodData.pekaryaGross)}</span>
                          <span>Potongan: {formatIDR(currentPeriodData.pekaryaDeductions)}</span>
                        </div>
                      </div>

                    </div>
                  </CardContent>
                </div>
              </Card>

              {/* Section 5: Deduction Composition */}
              <Card className="shadow-md border-slate-200/60 flex flex-col justify-between">
                <div>
                  <CardHeader className="bg-slate-50/50 border-b border-slate-100 p-6">
                    <CardTitle className="text-lg font-bold text-slate-800 flex items-center gap-2">
                      <PiggyBank className="w-5 h-5 text-indigo-500" /> Komposisi Potongan Gaji
                    </CardTitle>
                    <CardDescription className="text-xs text-slate-500">
                      Rincian alokasi potongan untuk disalurkan ke BPJS, Koperasi, Yayasan, Zakat dll
                    </CardDescription>
                  </CardHeader>
                  
                  <CardContent className="p-6">
                    {sortedDeductions.length === 0 ? (
                      <p className="text-center text-slate-400 text-sm py-12">Tidak ada potongan terpotong pada periode ini</p>
                    ) : (
                      <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2">
                        {sortedDeductions.map((item, idx) => {
                          const percentage = currentPeriodData.totalDeductions > 0
                            ? (item.value / currentPeriodData.totalDeductions) * 100
                            : 0;

                          // Harmonic colors for bars
                          const barColors = [
                            'bg-indigo-500', 'bg-rose-500', 'bg-emerald-500', 
                            'bg-amber-500', 'bg-sky-500', 'bg-purple-500'
                          ];
                          const colorClass = barColors[idx % barColors.length];

                          return (
                            <div key={item.name} className="space-y-1.5">
                              <div className="flex items-center justify-between text-xs font-semibold">
                                <span className="text-slate-700">{item.name}</span>
                                <span className="text-slate-900 font-bold">
                                  {formatIDR(item.value)} <span className="text-slate-400 text-[10px] ml-1">({percentage.toFixed(1)}%)</span>
                                </span>
                              </div>
                              <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                                <div 
                                  className={`${colorClass} h-full rounded-full transition-all duration-500`}
                                  style={{ width: `${percentage}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </div>
              </Card>

            </div>

            {/* Section 6: Quick Navigation Cards */}
            <div className="space-y-4">
              <h3 className="text-lg font-bold text-slate-800">Navigasi Cepat Modul</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                
                {/* Nav Card 1 */}
                <Link href="/dashboard/payroll">
                  <div className="group bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md hover:border-indigo-400 hover:-translate-y-1 transition-all duration-300 cursor-pointer flex justify-between items-start">
                    <div className="space-y-2">
                      <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center group-hover:bg-indigo-600 group-hover:text-white transition-all">
                        <FileText className="w-5 h-5" />
                      </div>
                      <h4 className="font-bold text-slate-800 group-hover:text-indigo-600 transition-colors">Validasi Gaji</h4>
                      <p className="text-xs text-slate-500 leading-relaxed">
                        Periksa rincian slip gaji, kelola override data, lakukan persetujuan (konfirmasi), serta unduh rekapitulasi slip.
                      </p>
                    </div>
                    <ArrowRight className="w-5 h-5 text-slate-400 group-hover:text-indigo-500 group-hover:translate-x-1 transition-all mt-1" />
                  </div>
                </Link>

                {/* Nav Card 2 */}
                <Link href="/dashboard/employees">
                  <div className="group bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md hover:border-indigo-400 hover:-translate-y-1 transition-all duration-300 cursor-pointer flex justify-between items-start">
                    <div className="space-y-2">
                      <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center group-hover:bg-indigo-600 group-hover:text-white transition-all">
                        <Users className="w-5 h-5" />
                      </div>
                      <h4 className="font-bold text-slate-800 group-hover:text-indigo-600 transition-colors">Master Data Pegawai</h4>
                      <p className="text-xs text-slate-500 leading-relaxed">
                        Kelola data induk pegawai Loyalis (Gaji Pokok/Jabatan Struktural) dan Pekarya (Harian/Mingguan).
                      </p>
                    </div>
                    <ArrowRight className="w-5 h-5 text-slate-400 group-hover:text-indigo-500 group-hover:translate-x-1 transition-all mt-1" />
                  </div>
                </Link>

                {/* Nav Card 3 */}
                <Link href="/dashboard/payroll/constant-values">
                  <div className="group bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md hover:border-indigo-400 hover:-translate-y-1 transition-all duration-300 cursor-pointer flex justify-between items-start">
                    <div className="space-y-2">
                      <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center group-hover:bg-indigo-600 group-hover:text-white transition-all">
                        <Percent className="w-5 h-5" />
                      </div>
                      <h4 className="font-bold text-slate-800 group-hover:text-indigo-600 transition-colors">Audit Nilai Konstan</h4>
                      <p className="text-xs text-slate-500 leading-relaxed">
                        Konfigurasi parameter BPJS Kesehatan & Ketenagakerjaan, Zakat, Tunjangan Beras, dan Tunjangan Jabatan Pegawai.
                      </p>
                    </div>
                    <ArrowRight className="w-5 h-5 text-slate-400 group-hover:text-indigo-500 group-hover:translate-x-1 transition-all mt-1" />
                  </div>
                </Link>

              </div>
            </div>

          </>
        )}

      </div>
    </div>
  );
}
