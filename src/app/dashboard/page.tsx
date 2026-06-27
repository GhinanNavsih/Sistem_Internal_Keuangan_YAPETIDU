"use client";

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/AuthContext';
import { useDashboardData } from '@/lib/DashboardDataContext';
import { calculateYearsOfService, calculateGapok } from '@/utils/payrollLogic';
import { calculateTotalEarnings, calculateTotalDeductions, calculateNetSalary } from '@/utils/salaryCalculator';
import { buildInitialEarnings } from '@/components/PaySlipDialog';

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
  SlidersHorizontal,
  PieChart as PieIcon,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  BarChart,
  Bar,
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

const PIE_COLORS = ['#6366f1', '#f43f5e', '#10b981', '#f59e0b', '#0ea5e9', '#a855f7'];

const GROUP_COLOR_MAP: Record<string, { hex: string; bg: string }> = {
  // Loyalis Departments
  'REKTORAT': { hex: '#10b981', bg: 'bg-emerald-500' }, // Green
  'FAK. ILMU KESEHATAN': { hex: '#6366f1', bg: 'bg-indigo-500' }, // Indigo
  'UPT & LEMBAGA': { hex: '#f43f5e', bg: 'bg-rose-500' }, // Rose/Pink
  'FAK. BISNIS, BAHASA DAN PENDIDIKAN': { hex: '#f59e0b', bg: 'bg-amber-500' }, // Amber/Orange
  'FAK. AGAMA ISLAM': { hex: '#0ea5e9', bg: 'bg-sky-500' }, // Sky Blue
  'FAK. SAINS DAN TEKNOLOGI': { hex: '#a855f7', bg: 'bg-purple-500' }, // Purple
  'PASCASARJANA': { hex: '#ec4899', bg: 'bg-pink-500' }, // Pink

  // Pekarya Job Categories
  'SATPAM': { hex: '#ef4444', bg: 'bg-red-500' },
  'SOPIR': { hex: '#10b981', bg: 'bg-emerald-500' },
  'PEKARYA': { hex: '#f43f5e', bg: 'bg-rose-500' },
  'TEKNISI': { hex: '#f59e0b', bg: 'bg-amber-500' },
  'KEBERSIHAN': { hex: '#3b82f6', bg: 'bg-blue-500' },
  'KEBERSIHAN_IC': { hex: '#0ea5e9', bg: 'bg-sky-500' },
  'KEBERSIHAN_PONTI': { hex: '#a855f7', bg: 'bg-purple-500' },
  'PONTI': { hex: '#ec4899', bg: 'bg-pink-500' },
};

const getGroupColorInfo = (name: string, idx: number) => {
  const normalizedName = name.trim().toUpperCase();
  if (GROUP_COLOR_MAP[normalizedName]) {
    return GROUP_COLOR_MAP[normalizedName];
  }
  const hexColors = ['#6366f1', '#f43f5e', '#10b981', '#f59e0b', '#0ea5e9', '#a855f7', '#ec4899'];
  const bgColors = ['bg-indigo-500', 'bg-rose-500', 'bg-emerald-500', 'bg-amber-500', 'bg-sky-500', 'bg-purple-500', 'bg-pink-500'];
  return {
    hex: hexColors[idx % hexColors.length],
    bg: bgColors[idx % bgColors.length],
  };
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
  confirmedLoyalisCount: number;

  // Pekarya (Blue Collar) aggregates
  pekaryaGross: number;
  pekaryaDeductions: number;
  pekaryaNet: number;
  pekaryaCount: number;
  confirmedPekaryaCount: number;

  totalSlipsCount: number;
  confirmedSlipsCount: number;

  deductionsBreakdown: Record<string, number>;
  loyalisDeductionsBreakdown: Record<string, number>;
  pekaryaDeductionsBreakdown: Record<string, number>;

  earningsBreakdown: Record<string, number>;
  loyalisEarningsBreakdown: Record<string, number>;
  pekaryaEarningsBreakdown: Record<string, number>;
}

interface EarningShareSectionProps {
  title: string;
  subtitle: string;
  data: { name: string; value: number; percentage: number }[];
  totalGross: number;
  animateList: boolean;
  type: 'loyalis' | 'pekarya';
  shareOfEarningView: 'list' | 'pie' | 'bar';
  selectedShareGroup: { type: 'loyalis' | 'pekarya'; name: string } | null;
  setSelectedShareGroup: React.Dispatch<React.SetStateAction<{ type: 'loyalis' | 'pekarya'; name: string } | null>>;
}

const EarningShareSection: React.FC<EarningShareSectionProps> = ({
  title,
  subtitle,
  data,
  totalGross,
  animateList,
  type,
  shareOfEarningView,
  selectedShareGroup,
  setSelectedShareGroup,
}) => {
  const chartData = useMemo(() => {
    return data.map((item) => {
      const isSelected = selectedShareGroup && selectedShareGroup.type === type && selectedShareGroup.name === item.name;
      const isAnySelected = selectedShareGroup && selectedShareGroup.type === type;
      return {
        ...item,
        isSelected,
        isAnySelected,
      };
    });
  }, [data, selectedShareGroup, type]);

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[300px] border border-dashed border-slate-200 rounded-2xl p-6 bg-slate-50/20 w-full">
        <p className="text-sm text-slate-400 font-medium animate-pulse">Tidak ada data untuk ditampilkan</p>
      </div>
    );
  }

  const handleChartClick = (name: string | undefined) => {
    if (!name) return;
    setSelectedShareGroup((prev) => {
      if (prev && prev.type === type && prev.name === name) {
        return null; // Toggle off
      }
      return { type, name };
    });
  };

  return (
    <div className="flex flex-col justify-between flex-1 w-full">
      <div>
        <div className="mb-4">
          <h4 className="text-sm font-bold text-slate-700">{title}</h4>
          <p className="text-[11px] text-slate-400 mt-0.5">{subtitle}</p>
        </div>

        {shareOfEarningView === 'list' ? (
          <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2">
            {chartData.map((item, idx) => {
              const colorInfo = getGroupColorInfo(item.name, idx);
              const colorClass = colorInfo.bg;
              const isSelected = item.isSelected;
              const isAnySelected = item.isAnySelected;
              const rowClass = `group/row transition-all duration-200 cursor-pointer rounded-xl p-2 border border-transparent ${
                isSelected 
                  ? 'bg-indigo-50/90 border-indigo-200/80 shadow-md scale-[1.01]' 
                  : isAnySelected 
                    ? 'opacity-25 scale-[0.97] hover:opacity-100 hover:scale-100 hover:bg-indigo-50/20' 
                    : 'hover:bg-indigo-50/30'
              }`;

              return (
                <div key={item.name} className={rowClass} onClick={() => handleChartClick(item.name)}>
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span className="text-slate-700 truncate max-w-[200px]" title={item.name}>
                      {item.name}
                    </span>
                    <span className="text-slate-900 font-bold shrink-0">
                      {formatIDR(item.value)}{' '}
                      <span className="text-slate-400 text-[10px] ml-1">({item.percentage.toFixed(1)}%)</span>
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden mt-1.5">
                    <div
                      className={`${colorClass} h-full rounded-full transition-all duration-500`}
                      style={{ width: `${animateList ? item.percentage : 0}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : shareOfEarningView === 'bar' ? (
          <div className="w-full h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 65 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis
                  dataKey="name"
                  tickFormatter={(val) => val.length > 15 ? `${val.substring(0, 15)}...` : val}
                  tick={{ fill: '#64748b', fontSize: 9, fontWeight: 500 }}
                  angle={-45}
                  textAnchor="end"
                  height={75}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tickFormatter={(val) => `Rp ${val / 1000000}jt`}
                  tick={{ fill: '#64748b', fontSize: 10, fontWeight: 500 }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip formatter={(value: any) => formatIDR(value)} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]} onClick={(entry) => handleChartClick(entry.name)}>
                  {chartData.map((entry, idx) => {
                    const isSelected = entry.isSelected;
                    const isAnySelected = entry.isAnySelected;
                    const cellOpacity = isAnySelected ? (isSelected ? 1.0 : 0.18) : 0.85;
                    const colorInfo = getGroupColorInfo(entry.name, idx);
                    return (
                      <Cell 
                        key={`cell-${idx}`} 
                        fill={colorInfo.hex} 
                        opacity={cellOpacity}
                        stroke={isSelected ? '#4f46e5' : 'none'}
                        strokeWidth={isSelected ? 2.5 : 0}
                        className="cursor-pointer transition-all duration-200 outline-none"
                      />
                    );
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="w-full h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Legend
                  verticalAlign="top"
                  align="left"
                  layout="vertical"
                  content={(props: any) => {
                    const { payload } = props;
                    if (!payload) return null;
                    const sortedPayload = [...payload].sort((a, b) => {
                      const valA = a.payload?.value ?? 0;
                      const valB = b.payload?.value ?? 0;
                      return valB - valA;
                    });
                    return (
                      <div className="flex flex-col gap-1.5 pb-3">
                        {sortedPayload.map((entry, idx) => {
                          const name = entry.payload?.name;
                          return (
                            <div 
                              key={entry.value || idx} 
                              onClick={() => handleChartClick(name)}
                              className="flex items-center gap-2 text-[11px] font-bold text-slate-600 cursor-pointer"
                            >
                              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
                              <span>{formatIDR(entry.payload?.value ?? 0)}</span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  }}
                />
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  labelLine={true}
                  label={({ name, percent }) => `${name}: ${(percent !== undefined ? percent * 100 : 0).toFixed(1)}%`}
                  outerRadius={80}
                  dataKey="value"
                  nameKey="name"
                  startAngle={90}
                  endAngle={-270}
                  onClick={(entry) => handleChartClick(entry.name)}
                >
                  {chartData.map((entry, idx) => {
                    const isSelected = entry.isSelected;
                    const isAnySelected = entry.isAnySelected;
                    const cellOpacity = isAnySelected ? (isSelected ? 1.0 : 0.18) : 0.85;
                    const colorInfo = getGroupColorInfo(entry.name, idx);
                    return (
                      <Cell 
                        key={`cell-${idx}`} 
                        fill={colorInfo.hex} 
                        opacity={cellOpacity}
                        stroke={isSelected ? '#4f46e5' : '#fff'}
                        strokeWidth={isSelected ? 2.5 : 1}
                        className="cursor-pointer transition-all duration-200 outline-none"
                      />
                    );
                  })}
                </Pie>
                <Tooltip formatter={(value: any) => formatIDR(value)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
};

export default function TreasuryDashboard() {
  const { user, profile, loading: authLoading } = useAuth();
  const router = useRouter();

  const {
    employeesLoyalis,
    employeesBlueCollar,
    salaryMatrixBlue,
    salaryMatrixWhite,
    functionalAllowanceMap,
    koperasiDeductions,
    koperasiSavings,
    loading: contextLoading
  } = useDashboardData();

  // Component states
  const [mounted, setMounted] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dataLoading, setDataLoading] = useState(true);
  const [slips, setSlips] = useState<any[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<string>('');
  const [filterCollar, setFilterCollar] = useState<'semua' | 'pekarya' | 'loyalis'>('semua');
  const [deductionsView, setDeductionsView] = useState<'list' | 'pie' | 'bar'>('list');
  const [earningsView, setEarningsView] = useState<'list' | 'pie' | 'bar'>('list');
  const [animateBars, setAnimateBars] = useState(false);
  const [animateListBars, setAnimateListBars] = useState(false);
  const [animateEarningsListBars, setAnimateEarningsListBars] = useState(false);
  const [shareOfEarningView, setShareOfEarningView] = useState<'list' | 'pie' | 'bar'>('list');
  const [animateShareOfEarningListBars, setAnimateShareOfEarningListBars] = useState(false);
  const [selectedShareGroup, setSelectedShareGroup] = useState<{ type: 'loyalis' | 'pekarya'; name: string } | null>(null);

  // Period-specific draft calculation states
  const [selectedPeriodUraianMap, setSelectedPeriodUraianMap] = useState<Record<string, any>>({});
  const [selectedPeriodLoyalisPresence, setSelectedPeriodLoyalisPresence] = useState<any | null>(null);
  const [selectedPeriodVakasiTambahanMap, setSelectedPeriodVakasiTambahanMap] = useState<Record<string, number>>({});
  const [selectedPeriodVakasiEvents, setSelectedPeriodVakasiEvents] = useState<string[]>([]);

  // Hydration prevention & starting animation trigger on mount
  useEffect(() => {
    setMounted(true);
    const timer = setTimeout(() => {
      setAnimateBars(true);
    }, 100);

    setProgress(0);
    const progressTimer = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 90) return prev;
        const diff = Math.random() * 15 + 5;
        return Math.min(prev + diff, 90);
      });
    }, 100);

    return () => {
      clearTimeout(timer);
      clearInterval(progressTimer);
    };
  }, []);

  // Trigger starting animation on the deduction bars when toggling to 'Daftar' view
  useEffect(() => {
    if (deductionsView === 'list') {
      setAnimateListBars(false);
      const timer = setTimeout(() => {
        setAnimateListBars(true);
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [deductionsView]);

  // Trigger starting animation on the earning bars when toggling to 'Daftar' view
  useEffect(() => {
    if (earningsView === 'list') {
      setAnimateEarningsListBars(false);
      const timer = setTimeout(() => {
        setAnimateEarningsListBars(true);
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [earningsView]);

  // Trigger starting animation on the share of earning bars when toggling to 'Daftar' view
  useEffect(() => {
    if (shareOfEarningView === 'list') {
      setAnimateShareOfEarningListBars(false);
      const timer = setTimeout(() => {
        setAnimateShareOfEarningListBars(true);
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [shareOfEarningView]);

  // Reset selected Share of Earning group when page filters change
  useEffect(() => {
    setSelectedShareGroup(null);
  }, [filterCollar, selectedPeriod]);

  // Fetch slips data on mount (employees list is provided by layout context)
  useEffect(() => {
    if (!profile || profile.role !== 'super_admin') return;

    const fetchSlips = async () => {
      try {
        setDataLoading(true);
        const slipSnap = await getDocs(collection(db, 'PayrollSlipStates'));
        const slipData = slipSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setSlips(slipData);
      } catch (err) {
        console.error('Error fetching dashboard slips data:', err);
      } finally {
        setDataLoading(false);
      }
    };

    fetchSlips();
  }, [profile]);

  // Load selected period's draft variables when period changes
  useEffect(() => {
    if (!profile || profile.role !== 'super_admin' || !selectedPeriod) return;

    const fetchSelectedPeriodData = async () => {
      try {
        // 1. Fetch UraianGaji for selected period
        const uraianSnapshot = await getDocs(collection(db, 'UraianGaji'));
        const uMap: Record<string, any> = {};
        uraianSnapshot.docs.forEach(d => {
          if (d.id.startsWith(selectedPeriod)) {
            uMap[d.id] = d.data();
          }
        });
        setSelectedPeriodUraianMap(uMap);

        // 2. Fetch LoyalisPresence for selected period
        const presenceSnap = await getDoc(doc(db, 'LoyalisPresence', selectedPeriod));
        if (presenceSnap.exists()) {
          setSelectedPeriodLoyalisPresence(presenceSnap.data());
        } else {
          setSelectedPeriodLoyalisPresence(null);
        }

        // 3. Fetch VakasiTambahan for selected period
        const periodToken = selectedPeriod.replace('_', '-');
        const vakasiSnapshot = await getDocs(collection(db, 'VakasiTambahan'));
        const vMap: Record<string, number> = {};
        const eventsList: string[] = [];

        vakasiSnapshot.docs.forEach(d => {
          const data = d.data();
          if (data.period === periodToken && (!data.status || data.status === 'approved')) {
            if (data.eventName) {
              eventsList.push(data.eventName);
            }
            const workers = data.eventWorkers || {};
            Object.entries(workers).forEach(([empId, w]: [string, any]) => {
              vMap[empId] = (vMap[empId] || 0) + (w.payGiven || 0);
            });
          }
        });
        setSelectedPeriodVakasiTambahanMap(vMap);
        setSelectedPeriodVakasiEvents(eventsList);

      } catch (err) {
        console.error('Error fetching selected period data:', err);
      }
    };

    fetchSelectedPeriodData();
  }, [selectedPeriod, profile]);

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

  // Aggregation of Slip States by Period (includes live dynamic draft fallback for selectedPeriod)
  const periodAggregates = useMemo(() => {
    const aggregates: Record<string, PeriodAggregate> = {};

    // 1. Generate and initialize all periods from 2026_06 to the current year/month
    const startYear = 2026;
    const startMonth = 6;

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    const endYear = Math.max(startYear, currentYear);
    const endMonth = currentYear === startYear ? Math.max(startMonth, currentMonth) : currentMonth;

    for (let y = startYear; y <= endYear; y++) {
      const sM = y === startYear ? startMonth : 1;
      const eM = y === endYear ? endMonth : 12;
      for (let m = sM; m <= eM; m++) {
        const period = `${y}_${String(m).padStart(2, '0')}`;
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
          confirmedLoyalisCount: 0,
          pekaryaGross: 0,
          pekaryaDeductions: 0,
          pekaryaNet: 0,
          pekaryaCount: 0,
          confirmedPekaryaCount: 0,
          totalSlipsCount: 0,
          confirmedSlipsCount: 0,
          deductionsBreakdown: {},
          loyalisDeductionsBreakdown: {},
          pekaryaDeductionsBreakdown: {},
          earningsBreakdown: {},
          loyalisEarningsBreakdown: {},
          pekaryaEarningsBreakdown: {},
        };
      }
    }

    // Initialize aggregates for all other periods present in slips that are >= '2026_06'
    slips.forEach(d => {
      const period = d.period || d.id.substring(0, 7);
      if (period < '2026_06') return; // Filter out periods before June 2026

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
          confirmedLoyalisCount: 0,
          pekaryaGross: 0,
          pekaryaDeductions: 0,
          pekaryaNet: 0,
          pekaryaCount: 0,
          confirmedPekaryaCount: 0,
          totalSlipsCount: 0,
          confirmedSlipsCount: 0,
          deductionsBreakdown: {},
          loyalisDeductionsBreakdown: {},
          pekaryaDeductionsBreakdown: {},
          earningsBreakdown: {},
          loyalisEarningsBreakdown: {},
          pekaryaEarningsBreakdown: {},
        };
      }
    });

    // Add selectedPeriod to aggregates if not already present
    if (selectedPeriod && selectedPeriod >= '2026_06' && !aggregates[selectedPeriod]) {
      aggregates[selectedPeriod] = {
        period: selectedPeriod,
        label: formatPeriodLabel(selectedPeriod),
        totalGross: 0,
        totalDeductions: 0,
        totalNet: 0,
        loyalisGross: 0,
        loyalisDeductions: 0,
        loyalisNet: 0,
        loyalisCount: 0,
        confirmedLoyalisCount: 0,
        pekaryaGross: 0,
        pekaryaDeductions: 0,
        pekaryaNet: 0,
        pekaryaCount: 0,
        confirmedPekaryaCount: 0,
        totalSlipsCount: 0,
        confirmedSlipsCount: 0,
        deductionsBreakdown: {},
        loyalisDeductionsBreakdown: {},
        pekaryaDeductionsBreakdown: {},
        earningsBreakdown: {},
        loyalisEarningsBreakdown: {},
        pekaryaEarningsBreakdown: {},
      };
    }

    // Helper to compute draft deductions list dynamically
    const getDraftDeductionsList = (emp: any, isLoyalis: boolean) => {
      const list: { label: string; amount: number }[] = [];
      const kopUnipduAmount = koperasiDeductions[emp.id] || 0;
      const kopSaving = koperasiSavings[emp.id] || 0;

      if (isLoyalis) {
        const getLoyalisPresenceDeduction = (empId: string): number => {
          if (selectedPeriodLoyalisPresence?.entries && Object.keys(selectedPeriodLoyalisPresence.entries).length > 0) {
            const entry = selectedPeriodLoyalisPresence.entries[empId];
            if (entry && !entry.isNotFoundInExcel) {
              return entry.deduction || 0;
            }
          }
          return 0;
        };

        const getLoyalisPresensiDeduction = (empId: string): number => {
          if (selectedPeriodLoyalisPresence?.entries && Object.keys(selectedPeriodLoyalisPresence.entries).length > 0) {
            const entry = selectedPeriodLoyalisPresence.entries[empId];
            if (entry && !entry.isNotFoundInExcel) {
              const absenceMinutes = entry.absenceMinutes || 0;
              return Math.round((absenceMinutes / 60) * 1650);
            }
          }
          return 0;
        };

        const bpjsAmt = emp.bpjs?.deductionAmount || 0;
        const thtAmt = emp.tht?.deductionAmount || 0;
        const savingsAmt = emp.savings?.deductionAmount || 0;
        const zizAmt = emp.ziz?.deductionAmount || 0;
        const pinluAmt = emp.pinlu?.deductionAmount || 0;
        const presDeduct = getLoyalisPresensiDeduction(emp.id);
        const presBonusDeduct = getLoyalisPresenceDeduction(emp.id);

        if (bpjsAmt) list.push({ label: 'BPJS', amount: bpjsAmt });
        if (thtAmt) list.push({ label: 'Tabungan Hari Tua BNI Simponi', amount: thtAmt });
        if (savingsAmt) list.push({ label: 'Tabungan', amount: savingsAmt });
        if (zizAmt) list.push({ label: 'Zakat Infaq Sodaqoh', amount: zizAmt });
        if (pinluAmt) list.push({ label: 'Pinlu/Tagihan', amount: pinluAmt });
        if (kopUnipduAmount) list.push({ label: 'Pinjaman Kop. UNIPDU', amount: kopUnipduAmount });
        if (presDeduct) list.push({ label: 'Potongan Presensi', amount: presDeduct });
        if (presBonusDeduct) list.push({ label: 'Potongan Bonus Presensi', amount: presBonusDeduct });
        if (kopSaving) list.push({ label: 'Iuran Wajib Kop. UNIPDU', amount: kopSaving });
      } else {
        const bpjsAmt = emp.bpjs?.deductionAmount ? Math.round(emp.bpjs.deductionAmount) : 0;
        const kopRochmadAmount = emp.deductions?.koperasiRochmad || 0;

        if (bpjsAmt) list.push({ label: 'BPJS', amount: bpjsAmt });
        if (kopRochmadAmount) list.push({ label: 'Kop. Rochmad', amount: kopRochmadAmount });
        if (kopUnipduAmount) list.push({ label: 'Pinjaman Kop. UNIPDU', amount: kopUnipduAmount });
        if (kopSaving) list.push({ label: 'Iuran Wajib Kop. UNIPDU', amount: kopSaving });
      }
      return list;
    };

    // Calculate details for all periods from existing slip states (except the currently selected period)
    slips.forEach(d => {
      const period = d.period || d.id.substring(0, 7);
      const employeeId = d.employeeId || d.id.substring(period.length + 1);

      if (period === selectedPeriod) return; // skip selected period, calculated dynamically next
      if (period < '2026_06') return; // Filter out periods before June 2026

      const agg = aggregates[period];
      if (!agg) return;

      agg.totalSlipsCount++;

      // Include confirmed, printed, and draft slips in historical sums
      const isEligible = d.status === 'confirmed' || d.status === 'printed' || d.status === 'draft';
      if (isEligible) {
        const isConfirmed = d.status === 'confirmed' || d.status === 'printed';
        if (isConfirmed) {
          agg.confirmedSlipsCount++;
        }

        const gross = (d.earnings || []).reduce((sum: number, e: any) => sum + (e.amount || 0), 0);
        const deductions = (d.deductions || []).reduce((sum: number, de: any) => sum + (de.amount || 0), 0);
        const net = gross - deductions;

        agg.totalGross += gross;
        agg.totalDeductions += deductions;
        agg.totalNet += net;

        const category = employeeCategoryMap[employeeId] || (employeeId.startsWith('Loyalis_') ? 'loyalis' : 'pekarya');

        if (category === 'loyalis') {
          agg.loyalisGross += gross;
          agg.loyalisDeductions += deductions;
          agg.loyalisNet += net;
          agg.loyalisCount++;
          if (isConfirmed) {
            agg.confirmedLoyalisCount++;
          }
        } else {
          agg.pekaryaGross += gross;
          agg.pekaryaDeductions += deductions;
          agg.pekaryaNet += net;
          agg.pekaryaCount++;
          if (isConfirmed) {
            agg.confirmedPekaryaCount++;
          }
        }

        (d.deductions || []).forEach((de: any) => {
          const label = de.label || 'Lain-lain';
          agg.deductionsBreakdown[label] = (agg.deductionsBreakdown[label] || 0) + (de.amount || 0);
          if (category === 'loyalis') {
            agg.loyalisDeductionsBreakdown[label] = (agg.loyalisDeductionsBreakdown[label] || 0) + (de.amount || 0);
          } else {
            agg.pekaryaDeductionsBreakdown[label] = (agg.pekaryaDeductionsBreakdown[label] || 0) + (de.amount || 0);
          }
        });

        (d.earnings || []).forEach((e: any) => {
          const label = e.label || 'Lain-lain';
          agg.earningsBreakdown[label] = (agg.earningsBreakdown[label] || 0) + (e.amount || 0);
          if (category === 'loyalis') {
            agg.loyalisEarningsBreakdown[label] = (agg.loyalisEarningsBreakdown[label] || 0) + (e.amount || 0);
          } else {
            agg.pekaryaEarningsBreakdown[label] = (agg.pekaryaEarningsBreakdown[label] || 0) + (e.amount || 0);
          }
        });
      }
    });

    // Dynamically calculate the selectedPeriod aggregate using either slips or fallback draft calculations
    if (selectedPeriod && aggregates[selectedPeriod]) {
      const agg = aggregates[selectedPeriod];

      // Slips lookup for selectedPeriod
      const selectedPeriodSlipsMap: Record<string, any> = {};
      slips.forEach(d => {
        const period = d.period || d.id.substring(0, 7);
        const employeeId = d.employeeId || d.id.substring(period.length + 1);
        if (period === selectedPeriod) {
          selectedPeriodSlipsMap[employeeId] = d;
        }
      });

      // targetDate object for selectedPeriod month
      const parts = selectedPeriod.split('_');
      const targetDateObj = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);

      const activeLoyalis = employeesLoyalis.filter(e => e.personal_info?.status === 'AKTIF');
      const activePekarya = employeesBlueCollar.filter(e => e.flags?.isActive !== false);

      // Loop Loyalis
      activeLoyalis.forEach(emp => {
        const slip = selectedPeriodSlipsMap[emp.id];
        agg.totalSlipsCount++;

        let gross = 0;
        let deductions = 0;
        let net = 0;
        let deductionsList: { label: string; amount: number }[] = [];
        let earningsList: { label: string; amount: number }[] = [];

        if (slip && slip.status !== 'draft' && slip.earnings && slip.deductions) {
          if (slip.status === 'confirmed' || slip.status === 'printed') {
            agg.confirmedSlipsCount++;
            agg.confirmedLoyalisCount++;
          }
          gross = slip.earnings.reduce((sum: number, e: any) => sum + (e.amount || 0), 0);
          deductions = slip.deductions.reduce((sum: number, de: any) => sum + (de.amount || 0), 0);
          net = gross - deductions;
          deductionsList = slip.deductions;
          earningsList = slip.earnings;
        } else {
          // Dynamic draft fallback
          const joinDateVal = emp.employment_profile?.date_of_hire?.toDate?.() || 
                              (emp.employment_profile?.date_of_hire ? new Date(emp.employment_profile.date_of_hire) : new Date());
          const dateRecognizedVal = emp.employment_profile?.date_recognized?.toDate?.() || 
                                    (emp.employment_profile?.date_recognized ? new Date(emp.employment_profile.date_recognized) : undefined);
          const gradeLevel = emp.academic_and_tier?.level_code || '';

          const mappedEmp = {
            joinDate: joinDateVal,
            dateRecognized: dateRecognizedVal,
            gradeLevel: gradeLevel
          } as any;

          const gapokVal = calculateGapok(mappedEmp, salaryMatrixWhite, targetDateObj);

          const getLoyalisPresenceBonus = (empId: string): number => {
            if (selectedPeriodLoyalisPresence?.entries && Object.keys(selectedPeriodLoyalisPresence.entries).length > 0) {
              const entry = selectedPeriodLoyalisPresence.entries[empId];
              if (!entry || entry.isNotFoundInExcel) return 0;
            }
            return 250000;
          };

          const getLoyalisPresensiEarning = (empId: string): number => {
            const workingDays = selectedPeriodLoyalisPresence?.workingDays || 25;
            const expectedHours = selectedPeriodLoyalisPresence?.expectedHours || 6.5;
            if (selectedPeriodLoyalisPresence?.entries && Object.keys(selectedPeriodLoyalisPresence.entries).length > 0) {
              const entry = selectedPeriodLoyalisPresence.entries[empId];
              if (!entry || entry.isNotFoundInExcel) return 0;
            }
            return Math.round(workingDays * expectedHours * 1650);
          };

          gross = calculateTotalEarnings(
            emp,
            gapokVal,
            undefined,
            selectedPeriodVakasiTambahanMap[emp.id] ?? 0,
            functionalAllowanceMap[emp.id] ?? 0,
            getLoyalisPresenceBonus(emp.id),
            getLoyalisPresensiEarning(emp.id)
          );

          earningsList = buildInitialEarnings(
            emp,
            gapokVal,
            'loyalis',
            undefined,
            selectedPeriodVakasiTambahanMap[emp.id] ?? 0,
            undefined,
            functionalAllowanceMap[emp.id] ?? 0,
            undefined,
            getLoyalisPresenceBonus(emp.id),
            getLoyalisPresensiEarning(emp.id)
          );

          deductionsList = getDraftDeductionsList(emp, true);
          deductions = deductionsList.reduce((sum, d) => sum + d.amount, 0);
          net = gross - deductions;
        }

        agg.totalGross += gross;
        agg.totalDeductions += deductions;
        agg.totalNet += net;

        agg.loyalisGross += gross;
        agg.loyalisDeductions += deductions;
        agg.loyalisNet += net;
        agg.loyalisCount++;

        deductionsList.forEach((de: any) => {
          const label = de.label || 'Lain-lain';
          agg.deductionsBreakdown[label] = (agg.deductionsBreakdown[label] || 0) + (de.amount || 0);
          agg.loyalisDeductionsBreakdown[label] = (agg.loyalisDeductionsBreakdown[label] || 0) + (de.amount || 0);
        });

        earningsList.forEach((e: any) => {
          const label = e.label || 'Lain-lain';
          agg.earningsBreakdown[label] = (agg.earningsBreakdown[label] || 0) + (e.amount || 0);
          agg.loyalisEarningsBreakdown[label] = (agg.loyalisEarningsBreakdown[label] || 0) + (e.amount || 0);
        });
      });

      // Loop Pekarya
      activePekarya.forEach(emp => {
        const slip = selectedPeriodSlipsMap[emp.id];
        agg.totalSlipsCount++;

        let gross = 0;
        let deductions = 0;
        let net = 0;
        let deductionsList: { label: string; amount: number }[] = [];
        let earningsList: { label: string; amount: number }[] = [];

        if (slip && slip.status !== 'draft' && slip.earnings && slip.deductions) {
          if (slip.status === 'confirmed' || slip.status === 'printed') {
            agg.confirmedSlipsCount++;
            agg.confirmedPekaryaCount++;
          }
          gross = slip.earnings.reduce((sum: number, e: any) => sum + (e.amount || 0), 0);
          deductions = slip.deductions.reduce((sum: number, de: any) => sum + (de.amount || 0), 0);
          net = gross - deductions;
          deductionsList = slip.deductions;
          earningsList = slip.earnings;
        } else {
          // Dynamic draft fallback
          const joinDateVal = emp.employment?.startDate ? new Date(emp.employment.startDate) : new Date();
          const gradeLevel = emp.salaryProfile?.salaryGradeCode || '';

          const mappedEmp = {
            joinDate: joinDateVal,
            gradeLevel: gradeLevel
          } as any;

          const gapokVal = calculateGapok(mappedEmp, salaryMatrixBlue, targetDateObj);

          const uraianEntry = selectedPeriodUraianMap[`${selectedPeriod}_${emp.employment?.jobCategory}`]?.entries?.[emp.id];
          gross = calculateTotalEarnings(
            emp,
            gapokVal,
            uraianEntry
          );

          earningsList = buildInitialEarnings(
            emp,
            gapokVal,
            'pekarya',
            uraianEntry
          );

          deductionsList = getDraftDeductionsList(emp, false);
          deductions = deductionsList.reduce((sum, d) => sum + d.amount, 0);
          net = gross - deductions;
        }

        agg.totalGross += gross;
        agg.totalDeductions += deductions;
        agg.totalNet += net;

        agg.pekaryaGross += gross;
        agg.pekaryaDeductions += deductions;
        agg.pekaryaNet += net;
        agg.pekaryaCount++;

        deductionsList.forEach((de: any) => {
          const label = de.label || 'Lain-lain';
          agg.deductionsBreakdown[label] = (agg.deductionsBreakdown[label] || 0) + (de.amount || 0);
          agg.pekaryaDeductionsBreakdown[label] = (agg.pekaryaDeductionsBreakdown[label] || 0) + (de.amount || 0);
        });

        earningsList.forEach((e: any) => {
          const label = e.label || 'Lain-lain';
          agg.earningsBreakdown[label] = (agg.earningsBreakdown[label] || 0) + (e.amount || 0);
          agg.pekaryaEarningsBreakdown[label] = (agg.pekaryaEarningsBreakdown[label] || 0) + (e.amount || 0);
        });
      });
    }

    return aggregates;
  }, [
    slips,
    employeeCategoryMap,
    selectedPeriod,
    employeesLoyalis,
    employeesBlueCollar,
    salaryMatrixBlue,
    salaryMatrixWhite,
    functionalAllowanceMap,
    koperasiDeductions,
    koperasiSavings,
    selectedPeriodUraianMap,
    selectedPeriodLoyalisPresence,
    selectedPeriodVakasiTambahanMap,
  ]);

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

  // Filtered metrics based on selected filterCollar
  const { filteredGross, filteredDeductions, filteredNet, filteredConfirmedCount, filteredActiveCount } = useMemo(() => {
    if (!currentPeriodData) {
      return { filteredGross: 0, filteredDeductions: 0, filteredNet: 0, filteredConfirmedCount: 0, filteredActiveCount: activeStaffCounts.total };
    }
    if (filterCollar === 'loyalis') {
      return {
        filteredGross: currentPeriodData.loyalisGross,
        filteredDeductions: currentPeriodData.loyalisDeductions,
        filteredNet: currentPeriodData.loyalisNet,
        filteredConfirmedCount: currentPeriodData.confirmedLoyalisCount,
        filteredActiveCount: activeStaffCounts.loyalis,
      };
    } else if (filterCollar === 'pekarya') {
      return {
        filteredGross: currentPeriodData.pekaryaGross,
        filteredDeductions: currentPeriodData.pekaryaDeductions,
        filteredNet: currentPeriodData.pekaryaNet,
        filteredConfirmedCount: currentPeriodData.confirmedPekaryaCount,
        filteredActiveCount: activeStaffCounts.pekarya,
      };
    } else {
      return {
        filteredGross: currentPeriodData.totalGross,
        filteredDeductions: currentPeriodData.totalDeductions,
        filteredNet: currentPeriodData.totalNet,
        filteredConfirmedCount: currentPeriodData.confirmedSlipsCount,
        filteredActiveCount: activeStaffCounts.total,
      };
    }
  }, [filterCollar, currentPeriodData, activeStaffCounts]);

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

    if (filterCollar === 'loyalis') {
      return {
        gross: calcPct(currAgg.loyalisGross, prevAgg.loyalisGross),
        deductions: calcPct(currAgg.loyalisDeductions, prevAgg.loyalisDeductions),
        net: calcPct(currAgg.loyalisNet, prevAgg.loyalisNet),
        staff: calcPct(currAgg.loyalisCount, prevAgg.loyalisCount),
      };
    } else if (filterCollar === 'pekarya') {
      return {
        gross: calcPct(currAgg.pekaryaGross, prevAgg.pekaryaGross),
        deductions: calcPct(currAgg.pekaryaDeductions, prevAgg.pekaryaDeductions),
        net: calcPct(currAgg.pekaryaNet, prevAgg.pekaryaNet),
        staff: calcPct(currAgg.pekaryaCount, prevAgg.pekaryaCount),
      };
    } else {
      return {
        gross: calcPct(currAgg.totalGross, prevAgg.totalGross),
        deductions: calcPct(currAgg.totalDeductions, prevAgg.totalDeductions),
        net: calcPct(currAgg.totalNet, prevAgg.totalNet),
        staff: calcPct(currAgg.confirmedSlipsCount, prevAgg.confirmedSlipsCount),
      };
    }
  }, [selectedPeriod, sortedPeriods, periodAggregates, filterCollar]);

  // Selected Period Share of Earning Data
  const shareOfEarningData = useMemo(() => {
    if (!selectedPeriod) return { loyalis: [], pekarya: [], totalLoyalisGross: 0, totalPekaryaGross: 0 };

    const loyalisMap: Record<string, number> = {};
    const pekaryaMap: Record<string, number> = {};
    let totalLoyalisGross = 0;
    let totalPekaryaGross = 0;

    // Slips lookup for selectedPeriod
    const selectedPeriodSlipsMap: Record<string, any> = {};
    slips.forEach(d => {
      const period = d.period || d.id.substring(0, 7);
      const employeeId = d.employeeId || d.id.substring(period.length + 1);
      if (period === selectedPeriod) {
        selectedPeriodSlipsMap[employeeId] = d;
      }
    });

    const parts = selectedPeriod.split('_');
    const targetDateObj = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);

    const activeLoyalis = employeesLoyalis.filter(e => e.personal_info?.status === 'AKTIF');
    const activePekarya = employeesBlueCollar.filter(e => e.flags?.isActive !== false);

    // 1. Process Loyalis
    activeLoyalis.forEach(emp => {
      const slip = selectedPeriodSlipsMap[emp.id];
      let gross = 0;

      if (slip && slip.status !== 'draft' && slip.earnings) {
        gross = slip.earnings.reduce((sum: number, e: any) => sum + (e.amount || 0), 0);
      } else {
        const joinDateVal = emp.employment_profile?.date_of_hire?.toDate?.() || 
                            (emp.employment_profile?.date_of_hire ? new Date(emp.employment_profile.date_of_hire) : new Date());
        const dateRecognizedVal = emp.employment_profile?.date_recognized?.toDate?.() || 
                                  (emp.employment_profile?.date_recognized ? new Date(emp.employment_profile.date_recognized) : undefined);
        const gradeLevel = emp.academic_and_tier?.level_code || '';
        const mappedEmp = { joinDate: joinDateVal, dateRecognized: dateRecognizedVal, gradeLevel } as any;
        const gapokVal = calculateGapok(mappedEmp, salaryMatrixWhite, targetDateObj);

        const getLoyalisPresenceBonus = (empId: string): number => {
          if (selectedPeriodLoyalisPresence?.entries && Object.keys(selectedPeriodLoyalisPresence.entries).length > 0) {
            const entry = selectedPeriodLoyalisPresence.entries[empId];
            if (!entry || entry.isNotFoundInExcel) return 0;
          }
          return 250000;
        };

        const getLoyalisPresensiEarning = (empId: string): number => {
          const workingDays = selectedPeriodLoyalisPresence?.workingDays || 25;
          const expectedHours = selectedPeriodLoyalisPresence?.expectedHours || 6.5;
          if (selectedPeriodLoyalisPresence?.entries && Object.keys(selectedPeriodLoyalisPresence.entries).length > 0) {
            const entry = selectedPeriodLoyalisPresence.entries[empId];
            if (!entry || entry.isNotFoundInExcel) return 0;
          }
          return Math.round(workingDays * expectedHours * 1650);
        };

        gross = calculateTotalEarnings(
          emp,
          gapokVal,
          undefined,
          selectedPeriodVakasiTambahanMap[emp.id] ?? 0,
          functionalAllowanceMap[emp.id] ?? 0,
          getLoyalisPresenceBonus(emp.id),
          getLoyalisPresensiEarning(emp.id)
        );
      }

      const dept = emp.employment_profile?.department_unit || 'LAIN-LAIN';
      loyalisMap[dept] = (loyalisMap[dept] || 0) + gross;
      totalLoyalisGross += gross;
    });

    // 2. Process Pekarya
    activePekarya.forEach(emp => {
      const slip = selectedPeriodSlipsMap[emp.id];
      let gross = 0;

      if (slip && slip.status !== 'draft' && slip.earnings) {
        gross = slip.earnings.reduce((sum: number, e: any) => sum + (e.amount || 0), 0);
      } else {
        const joinDateVal = emp.employment?.startDate ? new Date(emp.employment.startDate) : new Date();
        const gradeLevel = emp.salaryProfile?.salaryGradeCode || '';
        const mappedEmp = { joinDate: joinDateVal, gradeLevel } as any;
        const gapokVal = calculateGapok(mappedEmp, salaryMatrixBlue, targetDateObj);
        const uraianEntry = selectedPeriodUraianMap[`${selectedPeriod}_${emp.employment?.jobCategory}`]?.entries?.[emp.id];

        gross = calculateTotalEarnings(
          emp,
          gapokVal,
          uraianEntry
        );
      }

      const category = emp.employment?.jobCategory || 'LAIN-LAIN';
      pekaryaMap[category] = (pekaryaMap[category] || 0) + gross;
      totalPekaryaGross += gross;
    });

    const loyalisList = Object.entries(loyalisMap)
      .map(([name, value]) => ({
        name,
        value,
        percentage: totalLoyalisGross > 0 ? (value / totalLoyalisGross) * 100 : 0,
      }))
      .sort((a, b) => b.value - a.value);

    const pekaryaList = Object.entries(pekaryaMap)
      .map(([name, value]) => ({
        name,
        value,
        percentage: totalPekaryaGross > 0 ? (value / totalPekaryaGross) * 100 : 0,
      }))
      .sort((a, b) => b.value - a.value);

    return {
      loyalis: loyalisList,
      pekarya: pekaryaList,
      totalLoyalisGross,
      totalPekaryaGross,
    };
  }, [
    selectedPeriod,
    slips,
    employeesLoyalis,
    employeesBlueCollar,
    salaryMatrixBlue,
    salaryMatrixWhite,
    functionalAllowanceMap,
    selectedPeriodLoyalisPresence,
    selectedPeriodVakasiTambahanMap,
    selectedPeriodUraianMap,
  ]);

  // Selected Group Composition (Drilldown details when a share group is selected)
  const selectedGroupComposition = useMemo(() => {
    if (!selectedPeriod || !selectedShareGroup) {
      return null;
    }

    const earningsMap: Record<string, number> = {};
    const deductionsMap: Record<string, number> = {};
    let totalGross = 0;
    let totalDeductions = 0;

    // Slips lookup for selectedPeriod
    const selectedPeriodSlipsMap: Record<string, any> = {};
    slips.forEach(d => {
      const period = d.period || d.id.substring(0, 7);
      const employeeId = d.employeeId || d.id.substring(period.length + 1);
      if (period === selectedPeriod) {
        selectedPeriodSlipsMap[employeeId] = d;
      }
    });

    const parts = selectedPeriod.split('_');
    const targetDateObj = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);

    const getDraftDeductionsList = (emp: any, isLoyalis: boolean) => {
      const list: { label: string; amount: number }[] = [];
      const kopUnipduAmount = koperasiDeductions[emp.id] || 0;
      const kopSaving = koperasiSavings[emp.id] || 0;

      if (isLoyalis) {
        const getLoyalisPresenceDeduction = (empId: string): number => {
          if (selectedPeriodLoyalisPresence?.entries && Object.keys(selectedPeriodLoyalisPresence.entries).length > 0) {
            const entry = selectedPeriodLoyalisPresence.entries[empId];
            if (entry && !entry.isNotFoundInExcel) {
              return entry.deduction || 0;
            }
          }
          return 0;
        };

        const getLoyalisPresensiDeduction = (empId: string): number => {
          if (selectedPeriodLoyalisPresence?.entries && Object.keys(selectedPeriodLoyalisPresence.entries).length > 0) {
            const entry = selectedPeriodLoyalisPresence.entries[empId];
            if (entry && !entry.isNotFoundInExcel) {
              const absenceMinutes = entry.absenceMinutes || 0;
              return Math.round((absenceMinutes / 60) * 1650);
            }
          }
          return 0;
        };

        const bpjsAmt = emp.bpjs?.deductionAmount || 0;
        const thtAmt = emp.tht?.deductionAmount || 0;
        const savingsAmt = emp.savings?.deductionAmount || 0;
        const zizAmt = emp.ziz?.deductionAmount || 0;
        const pinluAmt = emp.pinlu?.deductionAmount || 0;
        const presDeduct = getLoyalisPresensiDeduction(emp.id);
        const presBonusDeduct = getLoyalisPresenceDeduction(emp.id);

        if (bpjsAmt) list.push({ label: 'BPJS', amount: bpjsAmt });
        if (thtAmt) list.push({ label: 'Tabungan Hari Tua BNI Simponi', amount: thtAmt });
        if (savingsAmt) list.push({ label: 'Tabungan', amount: savingsAmt });
        if (zizAmt) list.push({ label: 'Zakat Infaq Sodaqoh', amount: zizAmt });
        if (pinluAmt) list.push({ label: 'Pinlu/Tagihan', amount: pinluAmt });
        if (kopUnipduAmount) list.push({ label: 'Pinjaman Kop. UNIPDU', amount: kopUnipduAmount });
        if (presDeduct) list.push({ label: 'Potongan Presensi', amount: presDeduct });
        if (presBonusDeduct) list.push({ label: 'Potongan Bonus Presensi', amount: presBonusDeduct });
        if (kopSaving) list.push({ label: 'Iuran Wajib Kop. UNIPDU', amount: kopSaving });
      } else {
        const bpjsAmt = emp.bpjs?.deductionAmount ? Math.round(emp.bpjs.deductionAmount) : 0;
        const kopRochmadAmount = emp.deductions?.koperasiRochmad || 0;

        if (bpjsAmt) list.push({ label: 'BPJS', amount: bpjsAmt });
        if (kopRochmadAmount) list.push({ label: 'Kop. Rochmad', amount: kopRochmadAmount });
        if (kopUnipduAmount) list.push({ label: 'Pinjaman Kop. UNIPDU', amount: kopUnipduAmount });
        if (kopSaving) list.push({ label: 'Iuran Wajib Kop. UNIPDU', amount: kopSaving });
      }
      return list;
    };

    if (selectedShareGroup.type === 'loyalis') {
      const activeLoyalis = employeesLoyalis.filter(
        e => e.personal_info?.status === 'AKTIF' && (e.employment_profile?.department_unit || 'LAIN-LAIN') === selectedShareGroup.name
      );

      activeLoyalis.forEach(emp => {
        const slip = selectedPeriodSlipsMap[emp.id];
        let gross = 0;
        let deductionsList: { label: string; amount: number }[] = [];
        let earningsList: { label: string; amount: number }[] = [];

        if (slip && slip.status !== 'draft' && slip.earnings && slip.deductions) {
          gross = slip.earnings.reduce((sum: number, e: any) => sum + (e.amount || 0), 0);
          deductionsList = slip.deductions;
          earningsList = slip.earnings;
        } else {
          const joinDateVal = emp.employment_profile?.date_of_hire?.toDate?.() || 
                              (emp.employment_profile?.date_of_hire ? new Date(emp.employment_profile.date_of_hire) : new Date());
          const dateRecognizedVal = emp.employment_profile?.date_recognized?.toDate?.() || 
                                    (emp.employment_profile?.date_recognized ? new Date(emp.employment_profile.date_recognized) : undefined);
          const gradeLevel = emp.academic_and_tier?.level_code || '';
          const mappedEmp = { joinDate: joinDateVal, dateRecognized: dateRecognizedVal, gradeLevel } as any;
          const gapokVal = calculateGapok(mappedEmp, salaryMatrixWhite, targetDateObj);

          const getLoyalisPresenceBonus = (empId: string): number => {
            if (selectedPeriodLoyalisPresence?.entries && Object.keys(selectedPeriodLoyalisPresence.entries).length > 0) {
              const entry = selectedPeriodLoyalisPresence.entries[empId];
              if (!entry || entry.isNotFoundInExcel) return 0;
            }
            return 250000;
          };

          const getLoyalisPresensiEarning = (empId: string): number => {
            const workingDays = selectedPeriodLoyalisPresence?.workingDays || 25;
            const expectedHours = selectedPeriodLoyalisPresence?.expectedHours || 6.5;
            if (selectedPeriodLoyalisPresence?.entries && Object.keys(selectedPeriodLoyalisPresence.entries).length > 0) {
              const entry = selectedPeriodLoyalisPresence.entries[empId];
              if (!entry || entry.isNotFoundInExcel) return 0;
            }
            return Math.round(workingDays * expectedHours * 1650);
          };

          gross = calculateTotalEarnings(
            emp,
            gapokVal,
            undefined,
            selectedPeriodVakasiTambahanMap[emp.id] ?? 0,
            functionalAllowanceMap[emp.id] ?? 0,
            getLoyalisPresenceBonus(emp.id),
            getLoyalisPresensiEarning(emp.id)
          );

          earningsList = buildInitialEarnings(
            emp,
            gapokVal,
            'loyalis',
            undefined,
            selectedPeriodVakasiTambahanMap[emp.id] ?? 0,
            undefined,
            functionalAllowanceMap[emp.id] ?? 0,
            undefined,
            getLoyalisPresenceBonus(emp.id),
            getLoyalisPresensiEarning(emp.id)
          );

          deductionsList = getDraftDeductionsList(emp, true);
        }

        totalGross += gross;
        earningsList.forEach((e: any) => {
          const label = e.label || 'Lain-lain';
          earningsMap[label] = (earningsMap[label] || 0) + (e.amount || 0);
        });

        deductionsList.forEach((de: any) => {
          const label = de.label || 'Lain-lain';
          deductionsMap[label] = (deductionsMap[label] || 0) + (de.amount || 0);
          totalDeductions += (de.amount || 0);
        });
      });
    } else if (selectedShareGroup.type === 'pekarya') {
      const activePekarya = employeesBlueCollar.filter(
        e => e.flags?.isActive !== false && (e.employment?.jobCategory || 'LAIN-LAIN') === selectedShareGroup.name
      );

      activePekarya.forEach(emp => {
        const slip = selectedPeriodSlipsMap[emp.id];
        let gross = 0;
        let deductionsList: { label: string; amount: number }[] = [];
        let earningsList: { label: string; amount: number }[] = [];

        if (slip && slip.status !== 'draft' && slip.earnings && slip.deductions) {
          gross = slip.earnings.reduce((sum: number, e: any) => sum + (e.amount || 0), 0);
          deductionsList = slip.deductions;
          earningsList = slip.earnings;
        } else {
          const joinDateVal = emp.employment?.startDate ? new Date(emp.employment.startDate) : new Date();
          const gradeLevel = emp.salaryProfile?.salaryGradeCode || '';
          const mappedEmp = { joinDate: joinDateVal, gradeLevel } as any;
          const gapokVal = calculateGapok(mappedEmp, salaryMatrixBlue, targetDateObj);
          const uraianEntry = selectedPeriodUraianMap[`${selectedPeriod}_${emp.employment?.jobCategory}`]?.entries?.[emp.id];

          gross = calculateTotalEarnings(
            emp,
            gapokVal,
            uraianEntry
          );

          earningsList = buildInitialEarnings(
            emp,
            gapokVal,
            'pekarya',
            uraianEntry
          );

          deductionsList = getDraftDeductionsList(emp, false);
        }

        totalGross += gross;
        earningsList.forEach((e: any) => {
          const label = e.label || 'Lain-lain';
          earningsMap[label] = (earningsMap[label] || 0) + (e.amount || 0);
        });

        deductionsList.forEach((de: any) => {
          const label = de.label || 'Lain-lain';
          deductionsMap[label] = (deductionsMap[label] || 0) + (de.amount || 0);
          totalDeductions += (de.amount || 0);
        });
      });
    }

    return {
      earningsBreakdown: earningsMap,
      deductionsBreakdown: deductionsMap,
      totalGross,
      totalDeductions
    };
  }, [
    selectedPeriod,
    selectedShareGroup,
    slips,
    employeesLoyalis,
    employeesBlueCollar,
    salaryMatrixBlue,
    salaryMatrixWhite,
    functionalAllowanceMap,
    selectedPeriodLoyalisPresence,
    selectedPeriodVakasiTambahanMap,
    selectedPeriodUraianMap
  ]);

  // Selected Period Deduction Breakdown (Sorted)
  const sortedDeductions = useMemo(() => {
    if (!currentPeriodData) return [];

    let breakdown = currentPeriodData.deductionsBreakdown;
    if (selectedGroupComposition) {
      breakdown = selectedGroupComposition.deductionsBreakdown;
    } else if (filterCollar === 'loyalis') {
      breakdown = currentPeriodData.loyalisDeductionsBreakdown;
    } else if (filterCollar === 'pekarya') {
      breakdown = currentPeriodData.pekaryaDeductionsBreakdown;
    }

    return Object.entries(breakdown)
      .map(([name, value]) => ({ name, value }))
      .filter(item => item.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [currentPeriodData, filterCollar, selectedGroupComposition]);

  // Selected Period Earnings Breakdown (Sorted & Filtered > 0)
  const sortedEarnings = useMemo(() => {
    if (!currentPeriodData) return [];

    let breakdown = currentPeriodData.earningsBreakdown;
    if (selectedGroupComposition) {
      breakdown = selectedGroupComposition.earningsBreakdown;
    } else if (filterCollar === 'loyalis') {
      breakdown = currentPeriodData.loyalisEarningsBreakdown;
    } else if (filterCollar === 'pekarya') {
      breakdown = currentPeriodData.pekaryaEarningsBreakdown;
    }

    // Consolidated mapping
    const consolidated: Record<string, number> = {};
    Object.entries(breakdown).forEach(([name, value]) => {
      let label = name;
      if (label.startsWith('Struktural:')) {
        label = 'Tunjangan Struktural';
      } else if (label === 'Vakasi Tambahan' || selectedPeriodVakasiEvents.includes(label)) {
        label = 'Vakasi Tambahan';
      }
      consolidated[label] = (consolidated[label] || 0) + value;
    });

    return Object.entries(consolidated)
      .map(([name, value]) => ({ name, value }))
      .filter(item => item.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [currentPeriodData, filterCollar, selectedPeriodVakasiEvents, selectedGroupComposition]);

  const currentFilteredGross = useMemo(() => {
    if (selectedGroupComposition) return selectedGroupComposition.totalGross;
    return filteredGross;
  }, [selectedGroupComposition, filteredGross]);

  const currentFilteredDeductions = useMemo(() => {
    if (selectedGroupComposition) return selectedGroupComposition.totalDeductions;
    return filteredDeductions;
  }, [selectedGroupComposition, filteredDeductions]);

  // Selected Period Earnings for Pie Chart (Group < 5% into 'Lainnya')
  const pieEarningsData = useMemo(() => {
    if (currentFilteredGross === 0) return [];
    const mainItems: { name: string; value: number }[] = [];
    let otherSum = 0;

    sortedEarnings.forEach(item => {
      const pct = (item.value / currentFilteredGross) * 100;
      if (pct < 5) {
        otherSum += item.value;
      } else {
        mainItems.push(item);
      }
    });

    if (otherSum > 0) {
      mainItems.push({ name: 'Lainnya', value: otherSum });
    }
    return mainItems;
  }, [sortedEarnings, currentFilteredGross]);

  // Selected Period Deductions for Pie Chart (Group < 5% into 'Lainnya')
  const pieDeductionsData = useMemo(() => {
    if (currentFilteredDeductions === 0) return [];
    const mainItems: { name: string; value: number }[] = [];
    let otherSum = 0;

    sortedDeductions.forEach(item => {
      const pct = (item.value / currentFilteredDeductions) * 100;
      if (pct < 5) {
        otherSum += item.value;
      } else {
        mainItems.push(item);
      }
    });

    if (otherSum > 0) {
      mainItems.push({ name: 'Lainnya', value: otherSum });
    }
    return mainItems;
  }, [sortedDeductions, currentFilteredDeductions]);

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



  if (authLoading || !mounted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/80 to-slate-100 flex items-center justify-center relative overflow-hidden">
        {/* Subtle decorative blobs */}
        <div className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full bg-indigo-100/40 blur-[120px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] rounded-full bg-purple-100/30 blur-[100px] pointer-events-none" />
        <div className="flex flex-col items-center gap-4 relative z-10">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-400 flex items-center justify-center shadow-lg shadow-indigo-200">
            <Loader2 className="w-6 h-6 text-white animate-spin" />
          </div>
          <div className="flex flex-col items-center gap-2">
            <p className="text-sm text-slate-500 font-medium animate-pulse font-sans">Memuat Dashboard...</p>
            <div className="w-48 h-1.5 bg-slate-200/80 rounded-full overflow-hidden shadow-inner">
              <div
                className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Double-check authorization
  if (!user || !profile || profile.role !== 'super_admin') {
    return null; // Route layout will handle redirect
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/80 to-slate-100 p-6 md:p-8 font-sans selection:bg-indigo-100 relative overflow-hidden text-slate-800">
      {/* Subtle decorative blobs */}
      <div className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full bg-indigo-100/40 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] rounded-full bg-purple-100/30 blur-[100px] pointer-events-none" />
      <div className="max-w-[1400px] mx-auto space-y-8 relative z-10">

        {/* Section 1: Header & Period Selector */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-white/40 backdrop-blur-md p-6 rounded-3xl border border-slate-200/50 shadow-sm">
          <div>
            <span className="text-indigo-600 text-xs font-bold uppercase tracking-wider">Treasury & Financial Dashboard</span>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 mt-1">
              Yayasan Pesantren Tinggi Darul 'Ulum (YAPETIDU)
            </h1>
            <p className="text-slate-500 text-sm mt-1">
              Selamat datang kembali, <span className="font-semibold text-slate-700">{profile.displayName || 'Bendahara'}</span>. Berikut ringkasan arus kas payroll Anda.
            </p>
          </div>

          {/* Middle: Period Selector & Employee type toggle */}
          <div className="flex flex-col items-start md:items-center gap-2">
            {/* Period Selector */}
            <div className="flex items-center gap-2 bg-white/80 border border-slate-200 px-4 py-2 rounded-2xl shadow-sm">
              <Calendar className="w-4 h-4 text-indigo-500 shrink-0" />
              <span className="text-sm font-semibold text-slate-700 whitespace-nowrap">Periode Laporan:</span>
              {sortedPeriods.length > 0 ? (
                <Select value={selectedPeriod} onValueChange={(val) => { if (val) setSelectedPeriod(val); }}>
                  <SelectTrigger className="border-0 bg-transparent p-0 text-sm font-bold text-indigo-600 hover:text-indigo-700 focus:ring-0 focus:ring-offset-0 h-auto cursor-pointer gap-1">
                    <SelectValue placeholder="Pilih Periode">
                      {selectedPeriod ? formatPeriodLabel(selectedPeriod) : undefined}
                    </SelectValue>
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

            {/* Employee Type Toggle */}
            <div className="flex bg-slate-100 p-1 rounded-2xl border border-slate-200/60 shadow-sm gap-0.5 shrink-0">
              <button
                type="button"
                onClick={() => setFilterCollar('semua')}
                className={`px-4 py-1.5 text-xs font-bold rounded-xl transition-all cursor-pointer ${filterCollar === 'semua'
                  ? 'bg-white text-indigo-600 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
                  }`}
              >
                Semua
              </button>
              <button
                type="button"
                onClick={() => setFilterCollar('pekarya')}
                className={`px-4 py-1.5 text-xs font-bold rounded-xl transition-all cursor-pointer ${filterCollar === 'pekarya'
                  ? 'bg-white text-indigo-600 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
                  }`}
              >
                Pekarya
              </button>
              <button
                type="button"
                onClick={() => setFilterCollar('loyalis')}
                className={`px-4 py-1.5 text-xs font-bold rounded-xl transition-all cursor-pointer ${filterCollar === 'loyalis'
                  ? 'bg-white text-indigo-600 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
                  }`}
              >
                Loyalis
              </button>
            </div>
          </div>

          {/* Right: Active Staff Badge Container */}
          <div className="w-auto md:w-[240px] flex justify-start md:justify-end shrink-0 self-start md:self-center">
            <div className="flex items-center gap-2 bg-indigo-50/50 border border-indigo-100/50 px-4 py-2 rounded-2xl shrink-0">
              <Users className="w-4 h-4 text-indigo-600" />
              <span className="text-xs font-medium text-indigo-800">
                {filterCollar === 'pekarya'
                  ? 'Staf Pekarya Aktif:'
                  : filterCollar === 'loyalis'
                    ? 'Staf Loyalis Aktif:'
                    : 'Staf Aktif:'}{' '}
                <span className="font-bold">{filteredActiveCount} orang</span>
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
                  {filteredConfirmedCount} / {filteredActiveCount} Slip Dikonfirmasi
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
                    {filteredActiveCount > 0
                      ? Math.min(100, (filteredConfirmedCount / filteredActiveCount) * 100).toFixed(2)
                      : "0.00"}%
                  </p>
                </div>
                <div className="w-full bg-slate-200 h-1.5 rounded-full mt-1 overflow-hidden">
                  <div
                    className="bg-indigo-600 h-1.5 rounded-full transition-all duration-500"
                    style={{
                      width: `${filteredActiveCount > 0 ? Math.min(100, (filteredConfirmedCount / filteredActiveCount) * 100) : 0}%`
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
                  {Math.max(0, filteredActiveCount - filteredConfirmedCount)} Slip Gaji
                </p>
              </div>
            </div>
          </div>
        )}

        {contextLoading || dataLoading ? (
          <div className="h-[400px] flex flex-col items-center justify-center bg-white/40 border border-slate-200/50 rounded-3xl">
            <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
            <p className="text-slate-500 text-sm mt-3 font-medium">Sedang memproses data keuangan...</p>
          </div>
        ) : !currentPeriodData ? (
          <div className="p-12 text-center bg-white/60 backdrop-blur-md border border-slate-200/50 rounded-3xl shadow-sm">
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
              <div className="group bg-white/60 backdrop-blur-md p-5 rounded-2xl border border-slate-200/50 shadow-sm hover:shadow-lg hover:border-emerald-200/60 hover:-translate-y-0.5 transition-all duration-300">
                <div className="flex items-center justify-between mb-4">
                  <div className="space-y-0.5">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Pendapatan Kotor</p>
                    <p className="text-slate-400 text-[11px]">Total beban pra-potongan</p>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600 group-hover:bg-emerald-100 transition-colors">
                    <Banknote className="w-5 h-5" />
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="text-2xl font-black text-slate-900 tracking-tight">
                    {formatIDR(filteredGross)}
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
                </div>
              </div>

              {/* Card 2: Total Deductions */}
              <div className="group bg-white/60 backdrop-blur-md p-5 rounded-2xl border border-slate-200/50 shadow-sm hover:shadow-lg hover:border-rose-200/60 hover:-translate-y-0.5 transition-all duration-300">
                <div className="flex items-center justify-between mb-4">
                  <div className="space-y-0.5">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Potongan Gaji</p>
                    <p className="text-slate-400 text-[11px]">BPJS, Koperasi, Zakat, dll</p>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-rose-50 flex items-center justify-center text-rose-600 group-hover:bg-rose-100 transition-colors">
                    <PiggyBank className="w-5 h-5" />
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="text-2xl font-black text-slate-900 tracking-tight">
                    {formatIDR(filteredDeductions)}
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
                </div>
              </div>

              {/* Card 3: Net Salary (Payout Expense) */}
              <div className="group bg-white/60 backdrop-blur-md p-5 rounded-2xl border border-slate-200/50 shadow-sm hover:shadow-lg hover:border-indigo-200/60 hover:-translate-y-0.5 transition-all duration-300">
                <div className="flex items-center justify-between mb-4">
                  <div className="space-y-0.5">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Gaji Bersih</p>
                    <p className="text-slate-400 text-[11px]">Kas ditransfer ke pegawai</p>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 group-hover:bg-indigo-100 transition-colors">
                    <DollarSign className="w-5 h-5" />
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="text-2xl font-black text-indigo-600 tracking-tight">
                    {formatIDR(filteredNet)}
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
                </div>
              </div>

              {/* Card 4: Confirmed Staff Count */}
              <div className="group bg-white/60 backdrop-blur-md p-5 rounded-2xl border border-slate-200/50 shadow-sm hover:shadow-lg hover:border-slate-300/60 hover:-translate-y-0.5 transition-all duration-300">
                <div className="flex items-center justify-between mb-4">
                  <div className="space-y-0.5">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Pegawai Terbayar</p>
                    <p className="text-slate-400 text-[11px]">Slip terkonfirmasi periode ini</p>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-600 group-hover:bg-slate-200 transition-colors">
                    <CheckCircle className="w-5 h-5" />
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="text-2xl font-black text-slate-900 tracking-tight">
                    {filteredConfirmedCount} <span className="text-sm font-bold text-slate-400">Pegawai</span>
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
                </div>
              </div>

            </div>



            {/* Section 3: Share of Earning Breakdown */}
            <div className="bg-white/60 backdrop-blur-md rounded-2xl border border-slate-200/50 shadow-sm overflow-hidden">
              <div className="bg-slate-50/30 border-b border-slate-100/80 p-6 flex flex-row items-center justify-between flex-wrap gap-4">
                <div className="flex flex-col md:flex-row md:items-center gap-4">
                  <div>
                    <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                      <PieIcon className="w-5 h-5 text-indigo-500" /> Proporsi Pengeluaran Gaji (Share of Earning)
                    </h3>
                    <div className="flex items-center gap-2 flex-wrap mt-0.5">
                      <p className="text-xs text-slate-500">
                        Distribusi total pendapatan kotor berdasarkan Satuan Kerja (Loyalis) dan Kategori Kerja (Pekarya) pada periode {selectedPeriod ? formatPeriodLabel(selectedPeriod) : ''}
                      </p>
                      {selectedShareGroup && (
                        <Badge 
                          variant="outline" 
                          className="bg-indigo-50 text-indigo-700 border-indigo-200/80 rounded-lg py-0.5 px-2 flex items-center gap-1.5 text-[10px] font-bold cursor-pointer hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 transition-colors"
                          onClick={() => setSelectedShareGroup(null)}
                          title="Klik untuk menghapus filter"
                        >
                          Filter: {selectedShareGroup.name}
                          <span className="font-bold text-[11px] hover:text-rose-900 shrink-0">×</span>
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex bg-slate-100/80 p-0.5 rounded-xl border border-slate-200/60 shadow-sm gap-0.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => setShareOfEarningView('list')}
                    className={`px-3 py-1 text-[11px] font-bold rounded-lg transition-all cursor-pointer ${shareOfEarningView === 'list'
                      ? 'bg-white text-indigo-600 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                      }`}
                  >
                    Daftar
                  </button>
                  <button
                    type="button"
                    onClick={() => setShareOfEarningView('bar')}
                    className={`px-3 py-1 text-[11px] font-bold rounded-lg transition-all cursor-pointer ${shareOfEarningView === 'bar'
                      ? 'bg-white text-indigo-600 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                      }`}
                  >
                    Bar Graph
                  </button>
                  <button
                    type="button"
                    onClick={() => setShareOfEarningView('pie')}
                    className={`px-3 py-1 text-[11px] font-bold rounded-lg transition-all cursor-pointer ${shareOfEarningView === 'pie'
                      ? 'bg-white text-indigo-600 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                      }`}
                  >
                    Pie Chart
                  </button>
                </div>
              </div>

              <div className="p-6">
                {filterCollar === 'semua' ? (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <EarningShareSection
                      title="Staf Loyalis (Per SatKer)"
                      subtitle="Distribusi total pendapatan kotor Loyalis per Satuan Kerja"
                      data={shareOfEarningData.loyalis}
                      totalGross={shareOfEarningData.totalLoyalisGross}
                      animateList={animateShareOfEarningListBars}
                      type="loyalis"
                      shareOfEarningView={shareOfEarningView}
                      selectedShareGroup={selectedShareGroup}
                      setSelectedShareGroup={setSelectedShareGroup}
                    />
                    <EarningShareSection
                      title="Staf Pekarya (Per Kategori Kerja)"
                      subtitle="Distribusi total pendapatan kotor Pekarya per Kategori Kerja"
                      data={shareOfEarningData.pekarya}
                      totalGross={shareOfEarningData.totalPekaryaGross}
                      animateList={animateShareOfEarningListBars}
                      type="pekarya"
                      shareOfEarningView={shareOfEarningView}
                      selectedShareGroup={selectedShareGroup}
                      setSelectedShareGroup={setSelectedShareGroup}
                    />
                  </div>
                ) : filterCollar === 'loyalis' ? (
                  <div className="w-full">
                    <EarningShareSection
                      title="Staf Loyalis (Per SatKer)"
                      subtitle="Distribusi total pendapatan kotor Loyalis per Satuan Kerja"
                      data={shareOfEarningData.loyalis}
                      totalGross={shareOfEarningData.totalLoyalisGross}
                      animateList={animateShareOfEarningListBars}
                      type="loyalis"
                      shareOfEarningView={shareOfEarningView}
                      selectedShareGroup={selectedShareGroup}
                      setSelectedShareGroup={setSelectedShareGroup}
                    />
                  </div>
                ) : (
                  <div className="w-full">
                    <EarningShareSection
                      title="Staf Pekarya (Per Kategori Kerja)"
                      subtitle="Distribusi total pendapatan kotor Pekarya per Kategori Kerja"
                      data={shareOfEarningData.pekarya}
                      totalGross={shareOfEarningData.totalPekaryaGross}
                      animateList={animateShareOfEarningListBars}
                      type="pekarya"
                      shareOfEarningView={shareOfEarningView}
                      selectedShareGroup={selectedShareGroup}
                      setSelectedShareGroup={setSelectedShareGroup}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Section 4 & 5: Category Breakdown & Deduction Composition */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

              {/* Section 4: Earnings Composition */}
              <div className="bg-white/60 backdrop-blur-md rounded-2xl border border-slate-200/50 shadow-sm flex flex-col justify-between overflow-hidden">
                <div>
                  <div className="bg-slate-50/30 border-b border-slate-100/80 p-6 flex flex-row justify-between items-center flex-wrap gap-4">
                    <div>
                      <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                        <Banknote className="w-5 h-5 text-indigo-500" /> Komposisi Penerimaan Gaji
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {selectedShareGroup 
                          ? `Rincian alokasi penerimaan kotor untuk kelompok: ${selectedShareGroup.name}`
                          : "Rincian alokasi penerimaan kotor pegawai untuk gaji pokok, tunjangan, vakasi, dll"
                        }
                      </p>
                    </div>

                    <div className="flex bg-slate-100/80 p-0.5 rounded-xl border border-slate-200/60 shadow-sm gap-0.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => setEarningsView('list')}
                        className={`px-3 py-1 text-[11px] font-bold rounded-lg transition-all cursor-pointer ${earningsView === 'list'
                          ? 'bg-white text-indigo-600 shadow-sm'
                          : 'text-slate-500 hover:text-slate-700'
                          }`}
                      >
                        Daftar
                      </button>
                      <button
                        type="button"
                        onClick={() => setEarningsView('bar')}
                        className={`px-3 py-1 text-[11px] font-bold rounded-lg transition-all cursor-pointer ${earningsView === 'bar'
                          ? 'bg-white text-indigo-600 shadow-sm'
                          : 'text-slate-500 hover:text-slate-700'
                          }`}
                      >
                        Bar Graph
                      </button>
                      <button
                        type="button"
                        onClick={() => setEarningsView('pie')}
                        className={`px-3 py-1 text-[11px] font-bold rounded-lg transition-all cursor-pointer ${earningsView === 'pie'
                          ? 'bg-white text-indigo-600 shadow-sm'
                          : 'text-slate-500 hover:text-slate-700'
                          }`}
                      >
                        Pie Chart
                      </button>
                    </div>
                  </div>

                  <div className="p-6">
                    {sortedEarnings.length === 0 ? (
                      <p className="text-center text-slate-400 text-sm py-12">Tidak ada penerimaan pada periode ini</p>
                    ) : earningsView === 'list' ? (
                      <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2">
                        {sortedEarnings.map((item, idx) => {
                          const percentage = currentFilteredGross > 0
                            ? (item.value / currentFilteredGross) * 100
                            : 0;

                          // Harmonic colors for bars
                          const barColors = [
                            'bg-indigo-500', 'bg-emerald-500', 'bg-sky-500',
                            'bg-amber-500', 'bg-purple-500', 'bg-rose-500'
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
                                  style={{ width: `${animateEarningsListBars ? percentage : 0}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : earningsView === 'bar' ? (
                      <div className="w-full h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={sortedEarnings} margin={{ top: 10, right: 10, left: 10, bottom: 65 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                            <XAxis dataKey="name" tickFormatter={(val) => val.length > 12 ? `${val.substring(0, 12)}...` : val} tick={{ fill: '#64748b', fontSize: 10 }} angle={-45} textAnchor="end" height={60} tickLine={false} axisLine={false} />
                            <YAxis tickFormatter={(val) => `Rp ${val / 1000000}jt`} tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} />
                            <Tooltip formatter={(value: any) => formatIDR(value)} />
                            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                              {sortedEarnings.map((entry, idx) => (
                                <Cell key={`cell-${idx}`} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <div className="w-full h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Legend
                              verticalAlign="top"
                              align="left"
                              layout="vertical"
                              content={(props: any) => {
                                const { payload } = props;
                                if (!payload) return null;
                                const sortedPayload = [...payload].sort((a, b) => {
                                  const valA = a.payload?.value ?? 0;
                                  const valB = b.payload?.value ?? 0;
                                  return valB - valA;
                                });
                                return (
                                  <div className="flex flex-col gap-1.5 pb-3">
                                    {sortedPayload.map((entry, idx) => (
                                      <div key={entry.value || idx} className="flex items-center gap-2 text-[11px] font-bold text-slate-600">
                                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
                                        <span>{formatIDR(entry.payload?.value ?? 0)}</span>
                                      </div>
                                    ))}
                                  </div>
                                );
                              }}
                            />
                            <Pie
                              data={pieEarningsData}
                              cx="50%"
                              cy="50%"
                              labelLine={true}
                              label={({ name, percent }) => `${name}: ${(percent !== undefined ? percent * 100 : 0).toFixed(1)}%`}
                              outerRadius={80}
                              dataKey="value"
                              nameKey="name"
                              startAngle={90}
                              endAngle={-270}
                            >
                              {pieEarningsData.map((entry, idx) => (
                                <Cell key={`cell-${idx}`} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                              ))}
                            </Pie>
                            <Tooltip formatter={(value: any) => formatIDR(value)} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Section 5: Deduction Composition */}
              <div className="bg-white/60 backdrop-blur-md rounded-2xl border border-slate-200/50 shadow-sm flex flex-col justify-between overflow-hidden">
                <div>
                  <div className="bg-slate-50/30 border-b border-slate-100/80 p-6 flex flex-row justify-between items-center flex-wrap gap-4">
                    <div>
                      <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                        <PiggyBank className="w-5 h-5 text-indigo-500" /> Komposisi Potongan Gaji
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {selectedShareGroup 
                          ? `Rincian alokasi potongan untuk kelompok: ${selectedShareGroup.name}`
                          : "Rincian alokasi potongan untuk disalurkan ke BPJS, Koperasi, Yayasan, Zakat dll"
                        }
                      </p>
                    </div>

                    <div className="flex bg-slate-100/80 p-0.5 rounded-xl border border-slate-200/60 shadow-sm gap-0.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => setDeductionsView('list')}
                        className={`px-3 py-1 text-[11px] font-bold rounded-lg transition-all cursor-pointer ${deductionsView === 'list'
                          ? 'bg-white text-indigo-600 shadow-sm'
                          : 'text-slate-500 hover:text-slate-700'
                          }`}
                      >
                        Daftar
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeductionsView('bar')}
                        className={`px-3 py-1 text-[11px] font-bold rounded-lg transition-all cursor-pointer ${deductionsView === 'bar'
                          ? 'bg-white text-indigo-600 shadow-sm'
                          : 'text-slate-500 hover:text-slate-700'
                          }`}
                      >
                        Bar Graph
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeductionsView('pie')}
                        className={`px-3 py-1 text-[11px] font-bold rounded-lg transition-all cursor-pointer ${deductionsView === 'pie'
                          ? 'bg-white text-indigo-600 shadow-sm'
                          : 'text-slate-500 hover:text-slate-700'
                          }`}
                      >
                        Pie Chart
                      </button>
                    </div>
                  </div>

                  <div className="p-6">
                    {sortedDeductions.length === 0 ? (
                      <p className="text-center text-slate-400 text-sm py-12">Tidak ada potongan terpotong pada periode ini</p>
                    ) : deductionsView === 'list' ? (
                      <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2">
                        {sortedDeductions.map((item, idx) => {
                          const percentage = currentFilteredDeductions > 0
                            ? (item.value / currentFilteredDeductions) * 100
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
                                  style={{ width: `${animateListBars ? percentage : 0}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : deductionsView === 'bar' ? (
                      <div className="w-full h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={sortedDeductions} margin={{ top: 10, right: 10, left: 10, bottom: 65 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                            <XAxis dataKey="name" tickFormatter={(val) => val.length > 12 ? `${val.substring(0, 12)}...` : val} tick={{ fill: '#64748b', fontSize: 10 }} angle={-45} textAnchor="end" height={60} tickLine={false} axisLine={false} />
                            <YAxis tickFormatter={(val) => `Rp ${val / 1000000}jt`} tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} />
                            <Tooltip formatter={(value: any) => formatIDR(value)} />
                            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                              {sortedDeductions.map((entry, idx) => (
                                <Cell key={`cell-${idx}`} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <div className="w-full h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Legend
                              verticalAlign="top"
                              align="left"
                              layout="vertical"
                              content={(props: any) => {
                                const { payload } = props;
                                if (!payload) return null;
                                const sortedPayload = [...payload].sort((a, b) => {
                                  const valA = a.payload?.value ?? 0;
                                  const valB = b.payload?.value ?? 0;
                                  return valB - valA;
                                });
                                return (
                                  <div className="flex flex-col gap-1.5 pb-3">
                                    {sortedPayload.map((entry, idx) => (
                                      <div key={entry.value || idx} className="flex items-center gap-2 text-[11px] font-bold text-slate-600">
                                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
                                        <span>{formatIDR(entry.payload?.value ?? 0)}</span>
                                      </div>
                                    ))}
                                  </div>
                                );
                              }}
                            />
                            <Pie
                              data={pieDeductionsData}
                              cx="50%"
                              cy="50%"
                              labelLine={true}
                              label={({ name, percent }) => `${name}: ${(percent !== undefined ? percent * 100 : 0).toFixed(1)}%`}
                              outerRadius={80}
                              dataKey="value"
                              nameKey="name"
                              startAngle={90}
                              endAngle={-270}
                            >
                              {pieDeductionsData.map((entry, idx) => (
                                <Cell key={`cell-${idx}`} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                              ))}
                            </Pie>
                            <Tooltip formatter={(value: any) => formatIDR(value)} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>
                </div>
              </div>

            </div>

            {/* Section 6: Quick Navigation Cards */}
            <div className="space-y-4">
              <h3 className="text-lg font-bold text-slate-800">Navigasi Cepat Modul</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                {/* Nav Card 1 */}
                <Link href="/dashboard/payroll">
                  <div className="group bg-white/60 backdrop-blur-md p-6 rounded-2xl border border-slate-200/50 shadow-sm hover:shadow-lg hover:border-indigo-300/60 hover:-translate-y-1 transition-all duration-300 cursor-pointer flex justify-between items-start">
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
                  <div className="group bg-white/60 backdrop-blur-md p-6 rounded-2xl border border-slate-200/50 shadow-sm hover:shadow-lg hover:border-indigo-300/60 hover:-translate-y-1 transition-all duration-300 cursor-pointer flex justify-between items-start">
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

              </div>
            </div>

          </>
        )}

      </div>
    </div>
  );
}
