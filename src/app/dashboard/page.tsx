"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import GlobalHeader from '@/components/GlobalHeader';
import Link from 'next/link';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/AuthContext';
import { useDashboardData } from '@/lib/DashboardDataContext';

// Session-level in-memory cache for Pekarya previews across page transitions.
// Entries expire: approving an activity/SPJ elsewhere in the app changes what
// the preview endpoint returns, and client-side navigation back here does not
// remount with a clean slate, so an immortal entry would keep showing
// pre-approval totals until someone hit the manual refresh button.
const PEKARYA_PREVIEW_CACHE_TTL_MS = 2 * 60 * 1000;
const PEKARYA_PREVIEW_CACHE_MAX_ENTRIES = 12;

type PekaryaPreviewCacheEntry = {
  previews: Record<string, PekaryaSlipPreview>;
  storedAt: number;
};

const pekaryaSessionCache = new Map<string, PekaryaPreviewCacheEntry>();

function readPekaryaSessionCache(): Record<
  string,
  Record<string, PekaryaSlipPreview>
> {
  const now = Date.now();
  const fresh: Record<string, Record<string, PekaryaSlipPreview>> = {};
  pekaryaSessionCache.forEach((entry, period) => {
    if (now - entry.storedAt > PEKARYA_PREVIEW_CACHE_TTL_MS) {
      pekaryaSessionCache.delete(period);
      return;
    }
    fresh[period] = entry.previews;
  });
  return fresh;
}

function writePekaryaSessionCache(
  period: string,
  previews: Record<string, PekaryaSlipPreview>,
) {
  // Re-insert so Map iteration order stays newest-last for the eviction below.
  pekaryaSessionCache.delete(period);
  pekaryaSessionCache.set(period, { previews, storedAt: Date.now() });
  while (pekaryaSessionCache.size > PEKARYA_PREVIEW_CACHE_MAX_ENTRIES) {
    const oldest = pekaryaSessionCache.keys().next();
    if (oldest.done) break;
    pekaryaSessionCache.delete(oldest.value);
  }
}
import {
  buildDashboardSlipData,
  DashboardPeriodInputs,
  DashboardVakasiItem,
  sumSlipFields,
} from '@/lib/payroll/dashboardSlipData';
import {
  isPayableVakasiTambahan,
  vakasiWorkerCollection,
} from '@/lib/payroll/vakasiTambahan';
import { isPekaryaJobCategory } from '@/lib/payroll/pekaryaSpj';
import { authenticatedJson } from '@/lib/payroll/client';
import { PekaryaSlipPreview } from '@/lib/payroll/pekaryaSlipPreview';

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
  Scissors,
  RefreshCw,
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
  Treemap,
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

const CustomizedCompositionTreemapContent = (props: any) => {
  const { x, y, width, height, index, name, value, depth } = props;
  
  if (depth === 0 || !name) return null;

  const color = PIE_COLORS[index % PIE_COLORS.length] || '#4f46e5';
  const valueText = value !== undefined ? formatIDR(value) : '';

  const maxNameChars = Math.max(8, Math.floor((width - 16) / 7));
  const truncatedName = name.length > maxNameChars ? `${name.substring(0, maxNameChars)}…` : name;

  const showName = width > 40 && height > 20;
  const showValue = width > 60 && height > 38 && valueText;

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={color}
        stroke="#ffffff"
        strokeWidth={1.5}
        opacity={0.85}
        rx={4}
        ry={4}
      />
      {showName && (
        <text
          x={x + 6}
          y={y + 15}
          className="treemap-label"
          fill="#000000"
          fontSize={9.5}
          fontWeight={600}
          textAnchor="start"
        >
          {truncatedName}
        </text>
      )}
      {showValue && (
        <text
          x={x + 6}
          y={y + 27}
          className="treemap-label-sub"
          fill="#000000"
          fontSize={8.5}
          fontWeight={500}
          textAnchor="start"
        >
          {valueText}
        </text>
      )}
    </g>
  );
};

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

interface DashboardPeriodData {
  uraianMap: Record<string, any>;
  loyalisPresenceData: any | null;
  vakasiTambahanMap: Record<string, number>;
  vakasiTambahanListMap: Record<string, DashboardVakasiItem[]>;
  vakasiEvents: string[];
}

const EMPTY_PERIOD_DATA: DashboardPeriodData = {
  uraianMap: {},
  loyalisPresenceData: null,
  vakasiTambahanMap: {},
  vakasiTambahanListMap: {},
  vakasiEvents: [],
};

/**
 * Every underscore-format period ("YYYY_MM") this dashboard's cumulative
 * trend covers: the fixed window since payroll went live (2026-06) through
 * the current month, plus any period a slip or the current selection reaches
 * outside that window. `periodAggregates` and the Pekarya preview prefetch
 * both call this so the two can never cover a different set of periods.
 */
function computePayrollPeriodRange(
  slips: readonly { period?: string; id?: string }[],
  selectedPeriod: string,
): string[] {
  const startYear = 2026;
  const startMonth = 6;
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const endYear = Math.max(startYear, currentYear);
  const endMonth = currentYear === startYear
    ? Math.max(startMonth, currentMonth)
    : currentMonth;

  const periods = new Set<string>();
  for (let year = startYear; year <= endYear; year++) {
    const firstMonth = year === startYear ? startMonth : 1;
    const lastMonth = year === endYear ? endMonth : 12;
    for (let month = firstMonth; month <= lastMonth; month++) {
      periods.add(`${year}_${String(month).padStart(2, '0')}`);
    }
  }

  slips.forEach((slip) => {
    const period = slip.period || slip.id?.substring(0, 7);
    if (period && period >= '2026_06') periods.add(period);
  });
  if (selectedPeriod && selectedPeriod >= '2026_06') periods.add(selectedPeriod);

  return Array.from(periods).sort();
}

const createEmptyPeriodAggregate = (period: string): PeriodAggregate => ({
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
});

interface EarningShareSectionProps {
  title: string;
  subtitle: string;
  data: { name: string; value: number; percentage: number; type?: 'loyalis' | 'pekarya' }[];
  totalGross: number;
  animateList: boolean;
  type: 'loyalis' | 'pekarya' | 'semua';
  shareOfEarningView: 'treemap' | 'bar' | 'pie';
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
      const itemType = item.type || (type === 'semua' ? 'loyalis' : type);
      const isSelected = selectedShareGroup && selectedShareGroup.type === itemType && selectedShareGroup.name === item.name;
      const isAnySelected = type === 'semua' ? !!selectedShareGroup : (selectedShareGroup && selectedShareGroup.type === type);
      return {
        ...item,
        itemType,
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

  const handleChartClick = (name: string | undefined, itemType?: 'loyalis' | 'pekarya') => {
    if (!name) return;
    const resolvedType = itemType || (type === 'semua' ? 'loyalis' : type);
    setSelectedShareGroup((prev) => {
      if (prev && prev.type === resolvedType && prev.name === name) {
        return null; // Toggle off
      }
      return { type: resolvedType, name };
    });
  };

  const CustomizedTreemapContent = (props: any) => {
    const { x, y, width, height, index, name, value, percentage, isSelected, isAnySelected, itemType, depth } = props;
    
    // Ignore root node and nodes without name
    if (depth === 0 || !name) return null;

    const colorInfo = getGroupColorInfo(name, index);
    const cellOpacity = isAnySelected ? (isSelected ? 1.0 : 0.18) : 0.85;

    const maxNameChars = Math.max(8, Math.floor((width - 24) / 7));
    const truncatedName = name.length > maxNameChars ? `${name.substring(0, maxNameChars)}…` : name;
    const valueText = value !== undefined && percentage !== undefined
      ? `${formatIDR(value)} (${percentage.toFixed(1)}%)`
      : '';

    const showName = width > 50 && height > 24;
    const showValue = width > 70 && height > 44 && valueText;

    return (
      <g className="cursor-pointer" onClick={() => handleChartClick(name, itemType)}>
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          fill={colorInfo.hex}
          stroke={isSelected ? '#4f46e5' : '#ffffff'}
          strokeWidth={isSelected ? 3 : 1.5}
          opacity={cellOpacity}
          rx={4}
          ry={4}
        />
        {showName && (
          <text
            x={x + 8}
            y={y + 16}
            className="treemap-label"
            fill="#000000"
            fontSize={10}
            fontWeight={600}
            textAnchor="start"
          >
            {truncatedName}
          </text>
        )}
        {showValue && (
          <text
            x={x + 8}
            y={y + 29}
            className="treemap-label-sub"
            fill="#000000"
            fontSize={9}
            fontWeight={500}
            textAnchor="start"
          >
            {valueText}
          </text>
        )}
      </g>
    );
  };


  return (
    <div className="flex flex-col justify-between flex-1 w-full">
      <div>
        <div className="mb-4">
          <h4 className="text-sm font-bold text-slate-700">{title}</h4>
          <p className="text-[11px] text-slate-400 mt-0.5">{subtitle}</p>
        </div>

        {shareOfEarningView === 'treemap' ? (
          <div className="w-full" style={{ height: type === 'semua' ? 450 : 300, minWidth: 0 }}>
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={{ width: 100, height: 100 }}>
              <Treemap
                width={100}
                height={100}
                data={chartData}
                dataKey="value"
                aspectRatio={4 / 3}
                stroke="#fff"
                content={<CustomizedTreemapContent />}
              />
            </ResponsiveContainer>
          </div>
        ) : shareOfEarningView === 'bar' ? (
          <div className="w-full" style={{ height: type === 'semua' ? 450 : 300, minWidth: 0 }}>
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={{ width: 100, height: 100 }}>
              <BarChart layout="vertical" width={100} height={100} data={chartData} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                <XAxis
                  type="number"
                  tickFormatter={(val) => `Rp ${val / 1000000}jt`}
                  tick={{ fill: '#64748b', fontSize: 10, fontWeight: 500 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  dataKey="name"
                  type="category"
                  tickFormatter={(val) => val.length > 20 ? `${val.substring(0, 20)}...` : val}
                  tick={{ fill: '#64748b', fontSize: 9, fontWeight: 500 }}
                  tickLine={false}
                  axisLine={false}
                  width={120}
                />
                <Tooltip formatter={(value: any) => formatIDR(value)} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]} onClick={(entry: any) => handleChartClick(entry.name, entry.itemType || entry.payload?.itemType)}>
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
          <div className="w-full h-[300px]" style={{ minWidth: 0 }}>
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={{ width: 100, height: 100 }}>
              <PieChart width={100} height={100}>
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
                              onClick={() => handleChartClick(name, entry.payload?.itemType || entry.payload?.payload?.itemType)}
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
                  onClick={(entry: any) => handleChartClick(entry.name, entry.itemType || entry.payload?.itemType)}
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

  const {
    employeesLoyalis,
    employeesBlueCollar,
    salaryMatrixBlue,
    salaryMatrixWhite,
    functionalAllowanceMap,
    kepangkatanAllowanceMap,
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
  const [deductionsView, setDeductionsView] = useState<'treemap' | 'pie' | 'bar'>('treemap');
  const [earningsView, setEarningsView] = useState<'treemap' | 'pie' | 'bar'>('treemap');
  const [animateBars, setAnimateBars] = useState(false);
  const [animateListBars, setAnimateListBars] = useState(false);
  const [animateEarningsListBars, setAnimateEarningsListBars] = useState(false);
  const [shareOfEarningView, setShareOfEarningView] = useState<'treemap' | 'bar' | 'pie'>('treemap');
  const [animateShareOfEarningListBars, setAnimateShareOfEarningListBars] = useState(false);
  const [selectedShareGroup, setSelectedShareGroup] = useState<{ type: 'loyalis' | 'pekarya'; name: string } | null>(null);

  // Period-specific payroll inputs are cached for every report period so the
  // cumulative trend uses the same fallback calculations as the payroll page.
  const [periodDataByPeriod, setPeriodDataByPeriod] = useState<Record<string, DashboardPeriodData>>({});

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

  // Trigger starting animation on the deduction bars when toggling to 'Treemap' view
  useEffect(() => {
    if (deductionsView === 'treemap') {
      setAnimateListBars(false);
      const timer = setTimeout(() => {
        setAnimateListBars(true);
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [deductionsView]);

  // Trigger starting animation on the earning bars when toggling to 'Treemap' view
  useEffect(() => {
    if (earningsView === 'treemap') {
      setAnimateEarningsListBars(false);
      const timer = setTimeout(() => {
        setAnimateEarningsListBars(true);
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [earningsView]);

  // Trigger starting animation on the share of earning bars when toggling to 'Treemap' view
  useEffect(() => {
    if (shareOfEarningView === 'treemap') {
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

  // Load all period-specific payroll inputs. The payroll page rebuilds missing
  // slips from these inputs, so the dashboard must retain them for historical
  // periods as well as the currently selected period.
  useEffect(() => {
    if (!profile || profile.role !== 'super_admin') return;

    let cancelled = false;

    const fetchPeriodData = async () => {
      try {
        const [uraianSnapshot, presenceSnapshot, vakasiSnapshot] = await Promise.all([
          getDocs(collection(db, 'UraianGaji')),
          getDocs(collection(db, 'LoyalisPresence')),
          getDocs(collection(db, 'VakasiTambahan')),
        ]);

        const nextPeriodData: Record<string, DashboardPeriodData> = {};
        const getPeriodData = (period: string): DashboardPeriodData => {
          if (!nextPeriodData[period]) {
            nextPeriodData[period] = {
              uraianMap: {},
              loyalisPresenceData: null,
              vakasiTambahanMap: {},
              vakasiTambahanListMap: {},
              vakasiEvents: [],
            };
          }
          return nextPeriodData[period];
        };

        uraianSnapshot.docs.forEach(d => {
          const period = d.id.substring(0, 7);
          if (!/^\d{4}_\d{2}$/.test(period)) return;
          getPeriodData(period).uraianMap[d.id] = d.data();
        });

        presenceSnapshot.docs.forEach(d => {
          if (!/^\d{4}_\d{2}$/.test(d.id)) return;
          getPeriodData(d.id).loyalisPresenceData = d.data();
        });

        vakasiSnapshot.docs.forEach(d => {
          const data = d.data();
          if (!data.period || !isPayableVakasiTambahan(data)) return;
          const period = String(data.period).replace('-', '_');
          if (!/^\d{4}_\d{2}$/.test(period)) return;

          const periodData = getPeriodData(period);
          const workers = data.eventWorkers || {};
          let hasLoyalisRecipient = false;
          Object.entries(workers).forEach(([employeeId, worker]: [string, any]) => {
            if (vakasiWorkerCollection(worker) !== 'Employees_Loyalis') return;
            hasLoyalisRecipient = true;
            periodData.vakasiTambahanMap[employeeId] =
              (periodData.vakasiTambahanMap[employeeId] || 0) + (worker.payGiven || 0);
            if (!periodData.vakasiTambahanListMap[employeeId]) {
              periodData.vakasiTambahanListMap[employeeId] = [];
            }
            periodData.vakasiTambahanListMap[employeeId].push({
              eventName: data.eventName || '',
              payGiven: worker.payGiven || 0,
              isEndOfMonth: !!data.isEndOfMonth,
            });
          });
          if (hasLoyalisRecipient && data.eventName) {
            periodData.vakasiEvents.push(data.eventName);
          }
        });

        if (!cancelled) setPeriodDataByPeriod(nextPeriodData);
      } catch (err) {
        console.error('Error fetching dashboard period data:', err);
      }
    };

    fetchPeriodData();
    return () => {
      cancelled = true;
    };
  }, [profile]);

  // Slips index by period -> employeeId
  const slipsByPeriod = useMemo(() => {
    const map: Record<string, Record<string, any>> = {};
    slips.forEach((slip) => {
      const period = slip.period || slip.id?.substring(0, 7);
      if (!period) return;
      const employeeId = slip.employeeId || slip.id?.substring(period.length + 1);
      if (!employeeId) return;
      if (!map[period]) map[period] = {};
      map[period][employeeId] = slip;
    });
    return map;
  }, [slips]);

  // Which periods actually need the server-side Pekarya live calculation?
  // Historical periods where all active Pekarya staff already have saved slips
  // in PayrollSlipStates use their saved records directly and do not need
  // expensive multi-collection server preview queries.
  const periodsNeedingPreview = useMemo(() => {
    if (dataLoading || contextLoading) return [];
    const range = computePayrollPeriodRange(slips, selectedPeriod);
    const activePekarya = employeesBlueCollar.filter(
      (e) => e.flags?.isActive !== false && isPekaryaJobCategory(e.employment?.jobCategory),
    );

    return range.filter((period) => {
      if (activePekarya.length === 0) return false;
      const periodSlips = slipsByPeriod[period] || {};
      return activePekarya.some((e) => !periodSlips[e.id]?.earnings);
    });
  }, [dataLoading, contextLoading, slips, selectedPeriod, employeesBlueCollar, slipsByPeriod]);

  // The shared Pekarya earnings preview (matrix-sourced Gaji Pokok, approved
  // activity/event SPJ, published-or-estimated attendance) — loaded only
  // when needed and cached in memory across session views.
  const [pekaryaPreviewsByPeriod, setPekaryaPreviewsByPeriod] = useState<
    Record<string, Record<string, PekaryaSlipPreview>>
  >(() => readPekaryaSessionCache());
  const [pekaryaPreviewErrorsByPeriod, setPekaryaPreviewErrorsByPeriod] =
    useState<Record<string, string>>({});
  const [pekaryaPreviewsLoading, setPekaryaPreviewsLoading] = useState(false);

  // In-flight tracker to strictly prevent duplicate parallel fetches
  const inFlightFetches = useRef<Set<string>>(new Set());
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Which periods still need previews loaded?
  const pendingPeriods = useMemo(() => {
    return periodsNeedingPreview.filter(
      (period) =>
        !(period in pekaryaPreviewsByPeriod) &&
        !(period in pekaryaPreviewErrorsByPeriod),
    );
  }, [periodsNeedingPreview, pekaryaPreviewsByPeriod, pekaryaPreviewErrorsByPeriod]);

  const pekaryaPreviewsBusy =
    pekaryaPreviewsLoading || pendingPeriods.length > 0;

  const pekaryaPreviewCoverageErrors = periodsNeedingPreview.reduce<
    Record<string, string>
  >((errors, period) => {
    const previews = pekaryaPreviewsByPeriod[period];
    if (!previews) return errors;
    const periodSlips = slipsByPeriod[period] || {};
    const missingCount = employeesBlueCollar.filter(
      (employee) =>
        employee.flags?.isActive !== false &&
        isPekaryaJobCategory(employee.employment?.jobCategory) &&
        !periodSlips[employee.id]?.earnings &&
        !previews[employee.id],
    ).length;
    if (missingCount > 0) {
      errors[period] =
        `${missingCount} pegawai Pekarya aktif tidak memiliki pratinjau resmi.`;
    }
    return errors;
  }, {});
  const pekaryaPreviewFailures = Object.entries(
    {
      ...pekaryaPreviewCoverageErrors,
      ...pekaryaPreviewErrorsByPeriod,
    },
  ).sort(([left], [right]) => left.localeCompare(right));

  useEffect(() => {
    if (!profile || profile.role !== 'super_admin') return;

    const periodsToFetch = pendingPeriods.filter(
      (period) => !inFlightFetches.current.has(period),
    );

    if (periodsToFetch.length === 0) {
      if (inFlightFetches.current.size === 0 && pekaryaPreviewsLoading) {
        setPekaryaPreviewsLoading(false);
      }
      return;
    }

    periodsToFetch.forEach((p) => inFlightFetches.current.add(p));
    setPekaryaPreviewsLoading(true);

    periodsToFetch.forEach(async (period) => {
      const periodToken = period.replace('_', '-');
      let previews: Record<string, PekaryaSlipPreview> | null = null;
      let error: string | null = null;

      try {
        const result = await authenticatedJson<{
          previews: Record<string, PekaryaSlipPreview>;
        }>(`/api/payroll/slip-preview?period=${periodToken}`);
        previews = result.previews || {};
      } catch (err) {
        console.error(`Gagal memuat pratinjau slip Pekarya untuk ${period}:`, err);
        error =
          err instanceof Error
            ? err.message
            : 'Gagal memuat pratinjau perhitungan Pekarya.';
      } finally {
        inFlightFetches.current.delete(period);

        if (previews) {
          writePekaryaSessionCache(period, previews);
        }

        if (isMountedRef.current) {
          if (previews) {
            setPekaryaPreviewsByPeriod((prev) => ({
              ...prev,
              [period]: previews!,
            }));
          }

          if (error) {
            setPekaryaPreviewErrorsByPeriod((prev) => ({
              ...prev,
              [period]: error!,
            }));
          } else {
            setPekaryaPreviewErrorsByPeriod((prev) => {
              if (!(period in prev)) return prev;
              const next = { ...prev };
              delete next[period];
              return next;
            });
          }

          if (inFlightFetches.current.size === 0) {
            setPekaryaPreviewsLoading(false);
          }
        }
      }
    });
  }, [pendingPeriods, profile, pekaryaPreviewsLoading]);

  // An explicit refresh drops every cached period, not just the selected one:
  // the cumulative trend reads previews across the whole period range, so a
  // stale entry behind the current selection would survive an otherwise
  // deliberate "reload the numbers" action.
  const handleRefreshPreviews = useCallback(() => {
    pekaryaSessionCache.clear();
    inFlightFetches.current.clear();
    setPekaryaPreviewsByPeriod({});
    setPekaryaPreviewErrorsByPeriod({});
  }, []);

  const selectedPeriodData = periodDataByPeriod[selectedPeriod] || EMPTY_PERIOD_DATA;
  const selectedPeriodVakasiEvents = selectedPeriodData.vakasiEvents;

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

  // Aggregate the same employee-level values that the payroll page displays.
  // Missing slips are rebuilt for every period, not only for selectedPeriod.
  const periodAggregates = useMemo(() => {
    const aggregates: Record<string, PeriodAggregate> = {};
    computePayrollPeriodRange(slips, selectedPeriod).forEach((period) => {
      aggregates[period] = createEmptyPeriodAggregate(period);
    });

    const addEmployeeToAggregate = (
      aggregate: PeriodAggregate,
      employee: any,
      collar: 'loyalis' | 'pekarya',
      slip: any | undefined,
    ) => {
      const [year, month] = aggregate.period.split('_').map(Number);
      const periodData = periodDataByPeriod[aggregate.period] || EMPTY_PERIOD_DATA;
      const inputs: DashboardPeriodInputs = {
        targetDate: new Date(year, month - 1, 1),
        salaryMatrix: collar === 'loyalis' ? salaryMatrixWhite : salaryMatrixBlue,
        uraianMap: periodData.uraianMap,
        vakasiTambahanMap: periodData.vakasiTambahanMap,
        vakasiTambahanListMap: periodData.vakasiTambahanListMap,
        functionalAllowanceMap,
        kepangkatanAllowanceMap,
        koperasiDeductions,
        koperasiSavings,
        loyalisPresenceData: periodData.loyalisPresenceData,
        pekaryaPreviews: pekaryaPreviewsByPeriod[aggregate.period],
      };
      const data = buildDashboardSlipData(employee, collar, slip, inputs);
      const gross = sumSlipFields(data.earnings);
      const deductions = sumSlipFields(data.deductions);
      // "Kas ditransfer ke pegawai" has to be net of income tax too, so the
      // tax category is subtracted here alongside potongan.
      const tax = sumSlipFields(data.taxes);
      const net = gross - deductions - tax;

      aggregate.totalGross += gross;
      aggregate.totalDeductions += deductions;
      aggregate.totalNet += net;
      aggregate.totalSlipsCount++;
      aggregate.confirmedSlipsCount++;

      if (collar === 'loyalis') {
        aggregate.loyalisGross += gross;
        aggregate.loyalisDeductions += deductions;
        aggregate.loyalisNet += net;
        aggregate.loyalisCount++;
        aggregate.confirmedLoyalisCount++;
      } else {
        aggregate.pekaryaGross += gross;
        aggregate.pekaryaDeductions += deductions;
        aggregate.pekaryaNet += net;
        aggregate.pekaryaCount++;
        aggregate.confirmedPekaryaCount++;
      }

      data.deductions.forEach(field => {
        const label = field.label || 'Lain-lain';
        aggregate.deductionsBreakdown[label] =
          (aggregate.deductionsBreakdown[label] || 0) + (field.amount || 0);
        const breakdown = collar === 'loyalis'
          ? aggregate.loyalisDeductionsBreakdown
          : aggregate.pekaryaDeductionsBreakdown;
        breakdown[label] = (breakdown[label] || 0) + (field.amount || 0);
      });

      data.earnings.forEach(field => {
        const label = field.label || 'Lain-lain';
        aggregate.earningsBreakdown[label] =
          (aggregate.earningsBreakdown[label] || 0) + (field.amount || 0);
        const breakdown = collar === 'loyalis'
          ? aggregate.loyalisEarningsBreakdown
          : aggregate.pekaryaEarningsBreakdown;
        breakdown[label] = (breakdown[label] || 0) + (field.amount || 0);
      });
    };

    Object.entries(aggregates).forEach(([period, aggregate]) => {
      const periodSlips = slipsByPeriod[period] || {};
      employeesLoyalis
        .filter(employee => employee.personal_info?.status === 'AKTIF')
        .forEach(employee => addEmployeeToAggregate(
          aggregate,
          employee,
          'loyalis',
          periodSlips[employee.id],
        ));
      employeesBlueCollar
        .filter(employee => employee.flags?.isActive !== false)
        .forEach(employee => addEmployeeToAggregate(
          aggregate,
          employee,
          'pekarya',
          periodSlips[employee.id],
        ));
    });

    return aggregates;
  }, [
    slips,
    selectedPeriod,
    employeesLoyalis,
    employeesBlueCollar,
    salaryMatrixBlue,
    salaryMatrixWhite,
    functionalAllowanceMap,
    kepangkatanAllowanceMap,
    koperasiDeductions,
    koperasiSavings,
    periodDataByPeriod,
    pekaryaPreviewsByPeriod,
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
    if (!selectedPeriod) {
      return {
        loyalis: [],
        pekarya: [],
        combined: [],
        totalLoyalisGross: 0,
        totalPekaryaGross: 0,
        totalCombinedGross: 0,
      };
    }

    const periodData = periodDataByPeriod[selectedPeriod] || EMPTY_PERIOD_DATA;
    const selectedPeriodSlipsMap: Record<string, any> = {};
    slips.forEach(slip => {
      const period = slip.period || slip.id?.substring(0, 7);
      const employeeId = slip.employeeId || slip.id?.substring((period || '').length + 1);
      if (period === selectedPeriod && employeeId) {
        selectedPeriodSlipsMap[employeeId] = slip;
      }
    });

    const [year, month] = selectedPeriod.split('_').map(Number);
    const targetDate = new Date(year, month - 1, 1);
    const loyalisMap: Record<string, number> = {};
    const pekaryaMap: Record<string, number> = {};
    let totalLoyalisGross = 0;
    let totalPekaryaGross = 0;

    const getData = (employee: any, collar: 'loyalis' | 'pekarya') => buildDashboardSlipData(
      employee,
      collar,
      selectedPeriodSlipsMap[employee.id],
      {
        targetDate,
        salaryMatrix: collar === 'loyalis' ? salaryMatrixWhite : salaryMatrixBlue,
        uraianMap: periodData.uraianMap,
        vakasiTambahanMap: periodData.vakasiTambahanMap,
        vakasiTambahanListMap: periodData.vakasiTambahanListMap,
        functionalAllowanceMap,
        kepangkatanAllowanceMap,
        koperasiDeductions,
        koperasiSavings,
        loyalisPresenceData: periodData.loyalisPresenceData,
        pekaryaPreviews: pekaryaPreviewsByPeriod[selectedPeriod],
      },
    );

    employeesLoyalis
      .filter(employee => employee.personal_info?.status === 'AKTIF')
      .forEach(employee => {
        const gross = sumSlipFields(getData(employee, 'loyalis').earnings);
        const department = employee.employment_profile?.department_unit || 'LAIN-LAIN';
        loyalisMap[department] = (loyalisMap[department] || 0) + gross;
        totalLoyalisGross += gross;
      });

    employeesBlueCollar
      .filter(employee => employee.flags?.isActive !== false)
      .forEach(employee => {
        const gross = sumSlipFields(getData(employee, 'pekarya').earnings);
        const category = employee.employment?.jobCategory || 'LAIN-LAIN';
        pekaryaMap[category] = (pekaryaMap[category] || 0) + gross;
        totalPekaryaGross += gross;
      });

    const loyalisList = Object.entries(loyalisMap)
      .map(([name, value]) => ({
        name,
        value,
        percentage: totalLoyalisGross > 0 ? (value / totalLoyalisGross) * 100 : 0,
        type: 'loyalis' as const,
      }))
      .sort((a, b) => b.value - a.value);

    const pekaryaList = Object.entries(pekaryaMap)
      .map(([name, value]) => ({
        name,
        value,
        percentage: totalPekaryaGross > 0 ? (value / totalPekaryaGross) * 100 : 0,
        type: 'pekarya' as const,
      }))
      .sort((a, b) => b.value - a.value);

    const combinedTotal = totalLoyalisGross + totalPekaryaGross;
    const combinedList = [
      ...Object.entries(loyalisMap).map(([name, value]) => ({
        name,
        value,
        percentage: combinedTotal > 0 ? (value / combinedTotal) * 100 : 0,
        type: 'loyalis' as const,
      })),
      ...Object.entries(pekaryaMap).map(([name, value]) => ({
        name,
        value,
        percentage: combinedTotal > 0 ? (value / combinedTotal) * 100 : 0,
        type: 'pekarya' as const,
      })),
    ].sort((a, b) => b.value - a.value);

    return {
      loyalis: loyalisList,
      pekarya: pekaryaList,
      combined: combinedList,
      totalLoyalisGross,
      totalPekaryaGross,
      totalCombinedGross: combinedTotal,
    };
  }, [
    selectedPeriod,
    slips,
    employeesLoyalis,
    employeesBlueCollar,
    salaryMatrixBlue,
    salaryMatrixWhite,
    functionalAllowanceMap,
    kepangkatanAllowanceMap,
    koperasiDeductions,
    koperasiSavings,
    periodDataByPeriod,
    pekaryaPreviewsByPeriod,
  ]);

  // Selected Group Composition (Drilldown details when a share group is selected)
  const selectedGroupComposition = useMemo(() => {
    if (!selectedPeriod || !selectedShareGroup) return null;

    const periodData = periodDataByPeriod[selectedPeriod] || EMPTY_PERIOD_DATA;
    const selectedPeriodSlipsMap: Record<string, any> = {};
    slips.forEach(slip => {
      const period = slip.period || slip.id?.substring(0, 7);
      const employeeId = slip.employeeId || slip.id?.substring((period || '').length + 1);
      if (period === selectedPeriod && employeeId) {
        selectedPeriodSlipsMap[employeeId] = slip;
      }
    });

    const [year, month] = selectedPeriod.split('_').map(Number);
    const targetDate = new Date(year, month - 1, 1);
    const isLoyalis = selectedShareGroup.type === 'loyalis';
    const employees = isLoyalis
      ? employeesLoyalis.filter(employee =>
        employee.personal_info?.status === 'AKTIF' &&
        (employee.employment_profile?.department_unit || 'LAIN-LAIN') === selectedShareGroup.name,
      )
      : employeesBlueCollar.filter(employee =>
        employee.flags?.isActive !== false &&
        (employee.employment?.jobCategory || 'LAIN-LAIN') === selectedShareGroup.name,
      );

    const earningsBreakdown: Record<string, number> = {};
    const deductionsBreakdown: Record<string, number> = {};
    let totalGross = 0;
    let totalDeductions = 0;
    const collar = isLoyalis ? 'loyalis' : 'pekarya';

    employees.forEach(employee => {
      const data = buildDashboardSlipData(
        employee,
        collar,
        selectedPeriodSlipsMap[employee.id],
        {
          targetDate,
          salaryMatrix: isLoyalis ? salaryMatrixWhite : salaryMatrixBlue,
          uraianMap: periodData.uraianMap,
          vakasiTambahanMap: periodData.vakasiTambahanMap,
          vakasiTambahanListMap: periodData.vakasiTambahanListMap,
          functionalAllowanceMap,
          kepangkatanAllowanceMap,
          koperasiDeductions,
          koperasiSavings,
          loyalisPresenceData: periodData.loyalisPresenceData,
          pekaryaPreviews: pekaryaPreviewsByPeriod[selectedPeriod],
        },
      );
      totalGross += sumSlipFields(data.earnings);
      totalDeductions += sumSlipFields(data.deductions);

      data.earnings.forEach(field => {
        const label = field.label || 'Lain-lain';
        earningsBreakdown[label] = (earningsBreakdown[label] || 0) + (field.amount || 0);
      });
      data.deductions.forEach(field => {
        const label = field.label || 'Lain-lain';
        deductionsBreakdown[label] = (deductionsBreakdown[label] || 0) + (field.amount || 0);
      });
    });

    return {
      earningsBreakdown,
      deductionsBreakdown,
      totalGross,
      totalDeductions,
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
    kepangkatanAllowanceMap,
    koperasiDeductions,
    koperasiSavings,
    periodDataByPeriod,
    pekaryaPreviewsByPeriod,
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
        <GlobalHeader />

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
                <div className="flex items-center gap-1.5">
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
                  <button
                    type="button"
                    onClick={handleRefreshPreviews}
                    disabled={pekaryaPreviewsBusy}
                    title="Segarkan data kalkulasi periode terpilih"
                    className="p-1 text-slate-400 hover:text-indigo-600 rounded-lg hover:bg-indigo-50 transition-colors disabled:opacity-40 cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${pekaryaPreviewsBusy ? 'animate-spin text-indigo-600' : ''}`} />
                  </button>
                </div>
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

        {contextLoading || dataLoading || pekaryaPreviewsBusy ? (
          <div className="h-[400px] flex flex-col items-center justify-center bg-white/40 border border-slate-200/50 rounded-3xl">
            <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
            <p className="text-slate-500 text-sm mt-3 font-medium">Sedang memproses data keuangan...</p>
          </div>
        ) : pekaryaPreviewFailures.length > 0 ? (
          <div className="flex min-h-[320px] flex-col items-center justify-center rounded-3xl border border-rose-200 bg-rose-50/80 p-10 text-center shadow-sm">
            <AlertCircle className="mb-4 h-12 w-12 text-rose-500" />
            <h3 className="text-lg font-bold text-slate-800">
              Pratinjau Payroll Pekarya Tidak Tersedia
            </h3>
            <p className="mt-2 max-w-xl text-sm text-slate-600">
              Ringkasan keuangan disembunyikan agar perhitungan lokal lama tidak
              menggantikan nilai resmi dari server.
            </p>
            <div className="mt-4 max-w-xl space-y-1 text-xs text-rose-700">
              {pekaryaPreviewFailures.slice(0, 4).map(([period, message]) => (
                <p key={period}>
                  {formatPeriodLabel(period)}: {message}
                </p>
              ))}
              {pekaryaPreviewFailures.length > 4 && (
                <p>…dan {pekaryaPreviewFailures.length - 4} periode lainnya.</p>
              )}
            </div>
            <Button
              type="button"
              className="mt-6 rounded-xl bg-rose-600 text-white hover:bg-rose-700"
              onClick={handleRefreshPreviews}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Coba Lagi
            </Button>
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
                    <Scissors className="w-5 h-5" />
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
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Pegawai Terhitung</p>
                    <p className="text-slate-400 text-[11px]">Draft & terkonfirmasi periode ini</p>
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
                    onClick={() => setShareOfEarningView('treemap')}
                    className={`px-3 py-1 text-[11px] font-bold rounded-lg transition-all cursor-pointer ${shareOfEarningView === 'treemap'
                      ? 'bg-white text-indigo-600 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                      }`}
                  >
                    Treemap
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
                  <div className="w-full">
                    <EarningShareSection
                      title="Semua Staf (Loyalis & Pekarya)"
                      subtitle="Distribusi total pendapatan kotor berdasarkan Satuan Kerja (Loyalis) dan Kategori Kerja (Pekarya)"
                      data={shareOfEarningData.combined}
                      totalGross={shareOfEarningData.totalCombinedGross}
                      animateList={animateShareOfEarningListBars}
                      type="semua"
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
                        onClick={() => setEarningsView('treemap')}
                        className={`px-3 py-1 text-[11px] font-bold rounded-lg transition-all cursor-pointer ${earningsView === 'treemap'
                          ? 'bg-white text-indigo-600 shadow-sm'
                          : 'text-slate-500 hover:text-slate-700'
                          }`}
                      >
                        Treemap
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
                    ) : earningsView === 'treemap' ? (
                      <div className="w-full h-[300px]" style={{ minWidth: 0, minHeight: 0 }}>
                        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={{ width: 100, height: 100 }}>
                          <Treemap
                            width={100}
                            height={100}
                            data={sortedEarnings}
                            dataKey="value"
                            aspectRatio={4 / 3}
                            stroke="#fff"
                            content={<CustomizedCompositionTreemapContent />}
                          />
                        </ResponsiveContainer>
                      </div>
                    ) : earningsView === 'bar' ? (
                      <div className="w-full h-[300px]" style={{ minWidth: 0, minHeight: 0 }}>
                        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={{ width: 100, height: 100 }}>
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
                      <div className="w-full h-[300px]" style={{ minWidth: 0, minHeight: 0 }}>
                        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={{ width: 100, height: 100 }}>
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
                        onClick={() => setDeductionsView('treemap')}
                        className={`px-3 py-1 text-[11px] font-bold rounded-lg transition-all cursor-pointer ${deductionsView === 'treemap'
                          ? 'bg-white text-indigo-600 shadow-sm'
                          : 'text-slate-500 hover:text-slate-700'
                          }`}
                      >
                        Treemap
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
                    ) : deductionsView === 'treemap' ? (
                      <div className="w-full h-[300px]" style={{ minWidth: 0, minHeight: 0 }}>
                        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={{ width: 100, height: 100 }}>
                          <Treemap
                            width={100}
                            height={100}
                            data={sortedDeductions}
                            dataKey="value"
                            aspectRatio={4 / 3}
                            stroke="#fff"
                            content={<CustomizedCompositionTreemapContent />}
                          />
                        </ResponsiveContainer>
                      </div>
                    ) : deductionsView === 'bar' ? (
                      <div className="w-full h-[300px]" style={{ minWidth: 0, minHeight: 0 }}>
                        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={{ width: 100, height: 100 }}>
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
                      <div className="w-full h-[300px]" style={{ minWidth: 0, minHeight: 0 }}>
                        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={{ width: 100, height: 100 }}>
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

          </>
        )}

      </div>
    </div>
  );
}
