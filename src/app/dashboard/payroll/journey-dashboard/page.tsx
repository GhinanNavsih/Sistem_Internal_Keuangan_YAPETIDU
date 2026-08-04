"use client";

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import SatkerPekaryaNavBar from '@/components/SatkerPekaryaNavBar';
import {
  Card,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Car,
  Users,
  Compass,
  TrendingUp,
  Award,
  BarChart3,
  Calendar,
  Banknote,
  CheckCircle2,
  Sparkles,
} from 'lucide-react';
import { db } from '@/lib/firebase';
import {
  collection,
  query,
  where,
  onSnapshot,
} from 'firebase/firestore';
import type { DocumentData, QuerySnapshot } from 'firebase/firestore';
import { MONTHS_ID } from '@/utils/rekapConfig';
import { PEKARYA_JOB_CATEGORIES } from '@/lib/payroll/pekaryaSpj';

function fmtRp(val: number): string {
  return 'Rp' + Math.round(val || 0).toLocaleString('id-ID');
}

const ALL_CATEGORY_VALUE = 'all';

const CATEGORY_LABELS: Record<string, string> = {
  SATPAM: 'Satpam',
  SOPIR: 'Sopir',
  PEKARYA: 'Pekarya',
  TEKNISI: 'Teknisi',
  KEBERSIHAN: 'Kebersihan',
  KEBERSIHAN_PONTI: 'Kebersihan Ponti',
  PONTI: 'Ponti',
};

function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] || category;
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeJobCategory(value: unknown, fallback = ''): string {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toUpperCase();
  return normalized || fallback;
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function dateOnlyFromValue(value: unknown): string {
  if (typeof value === 'string') {
    const isoDate = value.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
    return isoDate || value;
  }
  if (value && typeof value === 'object') {
    const timestamp = value as { toDate?: () => Date; seconds?: number };
    const date = timestamp.toDate?.() || (typeof timestamp.seconds === 'number' ? new Date(timestamp.seconds * 1000) : null);
    if (date && !Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }
  return '';
}

interface CompletedJourney {
  id: string;
  jobCategory: string;
  activityName: string;
  employeeName: string;
  employeeId: string;
  vehicleName: string;
  vehicleType?: string;
  journeyDate?: string;
  activityDate?: string;
  distanceKm: number;
  durationHours: number;
  operationalCost: number;
  upahBersih: number;
  fuelFee?: number;
  tollParkingFee?: number;
  reimburseDelta?: number;
  nightCount?: number;
  points?: string[];
  status: string;
}

function JourneyDashboardContent() {
  const { profile } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const currentMonth = String(new Date().getMonth() + 1);
  const currentYear = String(new Date().getFullYear());

  const selectedMonth = searchParams.get('month') || currentMonth;
  const selectedYear = searchParams.get('year') || currentYear;
  const selectedCategory = searchParams.get('category') || ALL_CATEGORY_VALUE;

  const [journeys, setJourneys] = useState<CompletedJourney[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const allowedCategories = useMemo<string[]>(() => {
    if (!profile) return [];
    if (profile.role === 'super_admin') return Array.from(PEKARYA_JOB_CATEGORIES);

    const permitted = new Set(
      (profile.permittedCategories || []).map((category) => normalizeJobCategory(category)),
    );
    return PEKARYA_JOB_CATEGORIES.filter((category) => permitted.has(category));
  }, [profile]);

  const normalizedSelectedCategory =
    selectedCategory === ALL_CATEGORY_VALUE
      ? ALL_CATEGORY_VALUE
      : normalizeJobCategory(selectedCategory);
  const activeCategory =
    normalizedSelectedCategory === ALL_CATEGORY_VALUE ||
    allowedCategories.includes(normalizedSelectedCategory)
      ? normalizedSelectedCategory
      : ALL_CATEGORY_VALUE;

  // Fetch completed journeys and approved activity reports for every category
  // the current user is allowed to audit. DriverJourneys are legacy SOPIR
  // records, while ActivityReports is the source for all Pekarya categories.
  useEffect(() => {
    if (!profile || allowedCategories.length === 0) {
      return;
    }

    const journeysRef = collection(db, 'DriverJourneys');
    const reportsRef = collection(db, 'ActivityReports');
    const reportsQuery = query(
      reportsRef,
      where('jobCategory', 'in', allowedCategories),
    );
    let cancelled = false;
    let journeysSnapshot: QuerySnapshot<DocumentData> | null = null;
    let reportsSnapshot: QuerySnapshot<DocumentData> | null = null;
    let reportsSettled = false;

    const rebuildDashboardData = () => {
      if (cancelled || !journeysSnapshot || !reportsSettled) return;

      const journeyList: CompletedJourney[] = [];
      const seenJourneyIds = new Set<string>();
      const seenReportIds = new Set<string>();

      journeysSnapshot.forEach((docSnap) => {
        const d = docSnap.data();
        const status = String(d.status || '');
        if (status !== 'completed' && status !== 'approved') return;

        // DriverJourneys predates jobCategory and is created only for SOPIR.
        const jobCategory = normalizeJobCategory(d.jobCategory, 'SOPIR');
        if (!allowedCategories.includes(jobCategory)) return;

        seenJourneyIds.add(docSnap.id);
        if (typeof d.activityDocId === 'string') {
          seenReportIds.add(d.activityDocId);
        }

        const jDate = dateOnlyFromValue(d.journeyDate || d.activityDate || d.createdAt);
        journeyList.push({
          id: docSnap.id,
          jobCategory,
          activityName: String(d.activityName || d.purpose || 'Perjalanan Dinas'),
          employeeName: String(d.employeeName || d.driverName || 'Sopir'),
          employeeId: String(d.employeeId || d.driverId || ''),
          vehicleName: String(d.vehicleName || d.vehicleType || ''),
          journeyDate: jDate,
          activityDate: jDate,
          distanceKm: numberValue(d.newTotalDistanceKm || d.totalDistanceKm || d.distanceKm),
          durationHours: numberValue(d.newTotalDurationHours || d.durationHours),
          operationalCost: numberValue(d.totalOperationalCost || d.operationalCost || d.fee),
          upahBersih: numberValue(d.upahBersih),
          fuelFee: numberValue(d.fuelFee),
          tollParkingFee: numberValue(d.tollParkingFee),
          reimburseDelta: numberValue(d.reimburseDelta),
          nightCount: numberValue(d.nightCount),
          points: stringArrayValue(d.points),
          status,
        });
      });

      reportsSnapshot?.forEach((rSnap) => {
        const rd = rSnap.data();
        const status = String(rd.status || '');
        if (status !== 'approved' && status !== 'completed') return;

        const jobCategory = normalizeJobCategory(rd.jobCategory);
        if (!allowedCategories.includes(jobCategory)) return;

        const linkedJourneyId = typeof rd.journeyId === 'string' ? rd.journeyId : '';
        if (
          seenJourneyIds.has(rSnap.id) ||
          (linkedJourneyId && seenJourneyIds.has(linkedJourneyId)) ||
          seenReportIds.has(rSnap.id)
        ) {
          return;
        }

        const isSopir = jobCategory === 'SOPIR';
        const rDate = dateOnlyFromValue(rd.activityDate || rd.journeyDate || rd.createdAt);
        journeyList.push({
          id: rSnap.id,
          jobCategory,
          activityName: String(rd.activityName || (isSopir ? 'Perjalanan Dinas' : 'Kegiatan Pekarya')),
          employeeName: String(rd.employeeName || (isSopir ? 'Sopir' : 'Pekarya')),
          employeeId: String(rd.employeeId || ''),
          vehicleName: String(rd.vehicleType || rd.vehicleName || ''),
          journeyDate: rDate,
          activityDate: rDate,
          distanceKm: numberValue(rd.distanceKm),
          durationHours: numberValue(rd.durationHours),
          // Non-SOPIR fees are approved wages, not operational SPJ costs.
          operationalCost: isSopir
            ? numberValue(rd.totalOperationalCost || rd.operationalCost || rd.fee)
            : 0,
          upahBersih: isSopir ? numberValue(rd.upahBersih) : numberValue(rd.fee),
          fuelFee: numberValue(rd.fuelFee),
          tollParkingFee: numberValue(rd.tollParkingFee),
          reimburseDelta: numberValue(rd.reimburseDelta),
          nightCount: numberValue(rd.nightCount),
          points: stringArrayValue(rd.points),
          status,
        });
      });

      journeyList.sort((a, b) => (b.journeyDate || '').localeCompare(a.journeyDate || ''));
      setJourneys(journeyList);
      setLoading(false);
    };

    const unsubscribeJourneys = onSnapshot(
      journeysRef,
      (snapshot) => {
        journeysSnapshot = snapshot;
        rebuildDashboardData();
      },
      (error) => {
        console.error('Error listening to completed DriverJourneys:', error);
        if (!cancelled) {
          setJourneys([]);
          setLoading(false);
        }
      },
    );

    const unsubscribeReports = onSnapshot(
      reportsQuery,
      (snapshot) => {
        reportsSnapshot = snapshot;
        reportsSettled = true;
        rebuildDashboardData();
      },
      (error) => {
        console.error('Error listening to approved Pekarya activity reports:', error);
        reportsSnapshot = null;
        reportsSettled = true;
        rebuildDashboardData();
      },
    );

    return () => {
      cancelled = true;
      unsubscribeJourneys();
      unsubscribeReports();
    };
  }, [profile, allowedCategories]);

  // Filter journeys by selected month and year (or ALL)
  const filteredJourneys = useMemo(() => {
    return journeys.filter((j) => {
      if (activeCategory !== ALL_CATEGORY_VALUE && j.jobCategory !== activeCategory) {
        return false;
      }
      if (!j.journeyDate) return selectedMonth === 'all' && selectedYear === 'all';
      const parts = j.journeyDate.split('-');
      if (parts.length < 2) return selectedMonth === 'all' && selectedYear === 'all';
      const jYear = parts[0];
      const jMonth = String(parseInt(parts[1], 10));

      if (selectedYear !== 'all' && jYear !== selectedYear) return false;
      if (selectedMonth !== 'all' && jMonth !== selectedMonth) return false;
      return true;
    });
  }, [journeys, selectedMonth, selectedYear, activeCategory]);

  // Overall KPI Aggregation
  const overallKPI = useMemo(() => {
    const totalTrips = filteredJourneys.length;
    const totalMileage = filteredJourneys.reduce((sum, j) => sum + (j.distanceKm || 0), 0);
    const totalHours = filteredJourneys.reduce((sum, j) => sum + (j.durationHours || 0), 0);
    const totalSPJCost = filteredJourneys.reduce((sum, j) => sum + (j.operationalCost || 0), 0);
    const totalUpahBersih = filteredJourneys.reduce((sum, j) => sum + (j.upahBersih || 0), 0);
    const totalReimburse = filteredJourneys.reduce((sum, j) => sum + (j.reimburseDelta || 0), 0);

    return {
      totalTrips,
      totalMileage,
      totalHours,
      totalSPJCost,
      totalUpahBersih,
      totalReimburse,
    };
  }, [filteredJourneys]);

  // Vehicle/activity stats aggregation. Non-SOPIR categories are grouped by
  // activity because they do not represent vehicle journeys.
  const carStats = useMemo(() => {
    const map: Record<string, {
      vehicleName: string;
      trips: number;
      totalDistanceKm: number;
      totalDurationHours: number;
      totalFuelCost: number;
      totalSPJCost: number;
      totalUpahBersih: number;
      totalReimburse: number;
      totalNights: number;
    }> = {};

    filteredJourneys.forEach((j) => {
      const isSopir = activeCategory === 'SOPIR';
      const groupKey = isSopir
        ? j.vehicleName || 'Kendaraan tidak tercatat'
        : j.jobCategory + ':' + (j.activityName || 'Kegiatan lainnya');
      const displayName = isSopir
        ? j.vehicleName || 'Kendaraan tidak tercatat'
        : categoryLabel(j.jobCategory) + ' · ' + (j.activityName || 'Kegiatan lainnya');
      if (!map[groupKey]) {
        map[groupKey] = {
          vehicleName: displayName,
          trips: 0,
          totalDistanceKm: 0,
          totalDurationHours: 0,
          totalFuelCost: 0,
          totalSPJCost: 0,
          totalUpahBersih: 0,
          totalReimburse: 0,
          totalNights: 0,
        };
      }
      map[groupKey].trips += 1;
      map[groupKey].totalDistanceKm += j.distanceKm || 0;
      map[groupKey].totalDurationHours += j.durationHours || 0;
      map[groupKey].totalFuelCost += j.fuelFee || 0;
      map[groupKey].totalSPJCost += j.operationalCost || 0;
      map[groupKey].totalUpahBersih += j.upahBersih || 0;
      map[groupKey].totalReimburse += j.reimburseDelta || 0;
      map[groupKey].totalNights += j.nightCount || 0;
    });

    const list = Object.values(map);
    list.sort((a, b) => b.trips - a.trips);
    return list;
  }, [filteredJourneys, activeCategory]);

  // Driver Stats Aggregation
  const driverStats = useMemo(() => {
    const map: Record<string, {
      driverId: string;
      driverName: string;
      trips: number;
      totalDistanceKm: number;
      totalDurationHours: number;
      totalUpahBersih: number;
      totalReimburse: number;
      totalNights: number;
    }> = {};

    filteredJourneys.forEach((j) => {
      const dName = j.employeeName || (activeCategory === 'SOPIR' ? 'Sopir' : 'Pekarya');
      const dId = j.employeeId || dName;
      if (!map[dId]) {
        map[dId] = {
          driverId: dId,
          driverName: dName,
          trips: 0,
          totalDistanceKm: 0,
          totalDurationHours: 0,
          totalUpahBersih: 0,
          totalReimburse: 0,
          totalNights: 0,
        };
      }
      map[dId].trips += 1;
      map[dId].totalDistanceKm += j.distanceKm || 0;
      map[dId].totalDurationHours += j.durationHours || 0;
      map[dId].totalUpahBersih += j.upahBersih || 0;
      map[dId].totalReimburse += j.reimburseDelta || 0;
      map[dId].totalNights += j.nightCount || 0;
    });

    const list = Object.values(map);
    list.sort((a, b) => b.totalUpahBersih - a.totalUpahBersih);
    return list;
  }, [filteredJourneys, activeCategory]);

  const isSopirView = activeCategory === 'SOPIR';
  const categoryTitle =
    activeCategory === ALL_CATEGORY_VALUE ? 'Semua Pekarya' : categoryLabel(activeCategory);
  const workerLabel = isSopirView ? 'Sopir' : 'Pekarya';
  const completedItemLabel = isSopirView ? 'Perjalanan' : 'Aktivitas';

  const handleFilterChange = (
    m: string,
    y: string,
    category: string = activeCategory,
  ) => {
    const nextCategory =
      category === ALL_CATEGORY_VALUE
        ? ALL_CATEGORY_VALUE
        : normalizeJobCategory(category);

    const params = new URLSearchParams();
    params.set('month', m);
    params.set('year', y);
    if (nextCategory !== ALL_CATEGORY_VALUE) params.set('category', nextCategory);
    router.push('/dashboard/payroll/journey-dashboard?' + params.toString());
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/20 to-slate-100">
      {/* ── Navigation Header Bar ────────────────────────────────────────── */}
      <SatkerPekaryaNavBar />

      <div className="max-w-[1600px] mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
        {/* ── Page Header + Period Controls ────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white/80 backdrop-blur-md p-6 rounded-3xl border border-slate-200/80 shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Badge className="bg-indigo-100 text-indigo-700 hover:bg-indigo-100 text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-0.5 rounded-lg border border-indigo-200">
              Analitik Pekarya Dinamis
            </Badge>
            <Sparkles className="w-4 h-4 text-amber-500 animate-pulse" />
            {loading && (
              <span className="text-[10px] font-bold text-slate-400">Memuat data...</span>
            )}
          </div>
          <h1 className="text-2xl font-black text-slate-800 tracking-tight flex items-center gap-2">
            Dashboard Pekarya · {categoryTitle}
          </h1>
          <p className="text-xs text-slate-500 font-medium">
            Statistik kegiatan terverifikasi, kinerja {workerLabel.toLowerCase()}, biaya operasional, dan upah bersih.
          </p>
        </div>

        {/* Category and period filter dropdowns */}
        <div className="flex flex-wrap items-center justify-end gap-2.5 bg-slate-50 p-2 rounded-2xl border border-slate-200/80">
          <Select value={activeCategory} onValueChange={(category) => handleFilterChange(selectedMonth, selectedYear, category || ALL_CATEGORY_VALUE)}>
            <SelectTrigger className="w-44 h-9 text-xs font-bold bg-white rounded-xl border-slate-200">
              <SelectValue>
                {activeCategory === ALL_CATEGORY_VALUE ? 'Semua Kategori' : categoryLabel(activeCategory)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="rounded-xl border-slate-100 shadow-xl bg-white text-xs">
              <SelectItem value={ALL_CATEGORY_VALUE}>Semua Kategori</SelectItem>
              {allowedCategories.map((category) => (
                <SelectItem key={category} value={category}>
                  {categoryLabel(category)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Calendar className="w-4 h-4 text-indigo-500 shrink-0 ml-1" />

          <Select value={selectedMonth} onValueChange={(m) => handleFilterChange(m || 'all', selectedYear)}>
            <SelectTrigger className="w-36 h-9 text-xs font-bold bg-white rounded-xl border-slate-200">
              <SelectValue>
                {selectedMonth === 'all'
                  ? 'Semua Bulan'
                  : MONTHS_ID[parseInt(selectedMonth, 10) - 1] || selectedMonth}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="rounded-xl border-slate-100 shadow-xl bg-white text-xs">
              <SelectItem value="all">Semua Bulan</SelectItem>
              {MONTHS_ID.map((name, idx) => (
                <SelectItem key={idx + 1} value={String(idx + 1)}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={selectedYear} onValueChange={(y) => handleFilterChange(selectedMonth, y || 'all')}>
            <SelectTrigger className="w-28 h-9 text-xs font-bold bg-white rounded-xl border-slate-200">
              <SelectValue>
                {selectedYear === 'all' ? 'Semua Tahun' : selectedYear}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="rounded-xl border-slate-100 shadow-xl bg-white text-xs">
              <SelectItem value="all">Semua Tahun</SelectItem>
              {['2024', '2025', '2026', '2027'].map((y) => (
                <SelectItem key={y} value={y}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ── Top Row: Overall KPI Summary Cards ──────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Total Completed Journeys */}
        <Card className="rounded-2xl border-none shadow-sm bg-gradient-to-br from-indigo-500 to-purple-600 text-white p-5 space-y-3 relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-widest text-indigo-100">Total {completedItemLabel} Selesai</span>
            <div className="w-9 h-9 rounded-xl bg-white/20 backdrop-blur-md flex items-center justify-center">
              <Compass className="w-5 h-5 text-white" />
            </div>
          </div>
          <div>
            <span className="text-3xl font-black">{overallKPI.totalTrips}</span>
            <span className="text-xs text-indigo-100 font-semibold ml-2">{completedItemLabel}</span>
          </div>
          <div className="text-[10px] text-indigo-100/80 font-medium pt-1 border-t border-white/10 flex justify-between">
            <span>{isSopirView ? 'Total Kilometrase:' : 'Total Durasi:'}</span>
            <span className="font-extrabold text-white">
              {isSopirView
                ? overallKPI.totalMileage.toFixed(1) + ' KM'
                : overallKPI.totalHours.toFixed(1) + ' Jam'}
            </span>
          </div>
        </Card>

        {/* Card 2: Total Biaya Operasional (SPJ) */}
        <Card className="rounded-2xl border-none shadow-sm bg-white p-5 space-y-3 border border-slate-100">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total Biaya Operasional (SPJ)</span>
            <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <Banknote className="w-5 h-5" />
            </div>
          </div>
          <div>
            <span className="text-2xl font-black text-slate-800">{fmtRp(overallKPI.totalSPJCost)}</span>
          </div>
          <div className="text-[10px] text-slate-500 font-medium pt-1 border-t border-slate-100 flex justify-between">
            <span>{isSopirView ? 'Aggregat BBM + Tol + Makan' : 'Biaya operasional tercatat'}</span>
            <span className="font-bold text-blue-600">Terverifikasi</span>
          </div>
        </Card>

        {/* Card 3: Total net wage */}
        <Card className="rounded-2xl border-none shadow-sm bg-white p-5 space-y-3 border border-slate-100">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total Upah Bersih {workerLabel}</span>
            <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Award className="w-5 h-5" />
            </div>
          </div>
          <div>
            <span className="text-2xl font-black text-emerald-600">{fmtRp(overallKPI.totalUpahBersih)}</span>
          </div>
          <div className="text-[10px] text-slate-500 font-medium pt-1 border-t border-slate-100 flex justify-between">
            <span>{isSopirView ? 'Komponen Jarak + Waktu + Premi' : 'Fee kegiatan yang disetujui'}</span>
            <span className="font-bold text-emerald-600">Sudah Diaudit</span>
          </div>
        </Card>

        {/* Card 4: Total Out-of-Pocket Reimbursement */}
        <Card className="rounded-2xl border-none shadow-sm bg-white p-5 space-y-3 border border-slate-100">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total Reimburse Delta</span>
            <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>
          <div>
            <span className="text-2xl font-black text-amber-600">+{fmtRp(overallKPI.totalReimburse)}</span>
          </div>
          <div className="text-[10px] text-slate-500 font-medium pt-1 border-t border-slate-100 flex justify-between">
            <span>{isSopirView ? 'Talangan Driver Terganti' : 'Reimburse kegiatan tercatat'}</span>
            <span className="font-bold text-amber-600">Biaya Tambahan</span>
          </div>
        </Card>
      </div>

      {/* ── Main Section: Category-specific work stats & worker stats ─────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 🚗 Vehicle stats for SOPIR, activity stats for other categories */}
        <Card className="rounded-3xl border-none shadow-sm bg-white p-6 space-y-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                {isSopirView ? <Car className="w-5 h-5" /> : <BarChart3 className="w-5 h-5" />}
              </div>
              <div>
                <h3 className="text-base font-extrabold text-slate-800">
                  {isSopirView ? 'Statistik Kendaraan (Car Stats)' : 'Statistik Kegiatan (Activity Stats)'}
                </h3>
                <p className="text-[11px] text-slate-400 font-semibold">
                  {isSopirView ? 'Performa kilometrase & penggunaan armada' : 'Kegiatan terverifikasi menurut kategori'}
                </p>
              </div>
            </div>
            <Badge variant="outline" className="bg-indigo-50 border-indigo-200 text-indigo-700 text-[10px] font-bold">
              {carStats.length} {isSopirView ? 'Kendaraan Terpakai' : 'Kegiatan Tercatat'}
            </Badge>
          </div>

          {carStats.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400 font-medium">
              Belum ada data {isSopirView ? 'perjalanan kendaraan' : 'kegiatan'} pada periode ini.
            </div>
          ) : (
            <div className="space-y-4 max-h-[460px] overflow-y-auto pr-1">
              {carStats.map((car) => {
                const usagePct = overallKPI.totalTrips > 0 ? Math.round((car.trips / overallKPI.totalTrips) * 100) : 0;
                const avgFuelPerKm = car.totalDistanceKm > 0 ? Math.round(car.totalFuelCost / car.totalDistanceKm) : 0;

                return (
                  <div key={car.vehicleName} className="p-4 rounded-2xl bg-slate-50 border border-slate-100 space-y-3 hover:border-indigo-200 transition-colors">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-slate-800 text-sm">{car.vehicleName}</span>
                        {car.totalNights > 0 && (
                          <Badge className="bg-purple-100 text-purple-700 border-purple-200 text-[9px] font-bold px-2 py-0.5">
                            {car.totalNights} malam
                          </Badge>
                        )}
                      </div>
                      <span className="text-xs font-black text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-xl border border-indigo-100">
                        {car.trips} {completedItemLabel} ({usagePct}%)
                      </span>
                    </div>

                    {/* Progress Bar Usage */}
                    <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                      <div
                        className="bg-gradient-to-r from-indigo-500 to-purple-500 h-full rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(100, Math.max(5, usagePct))}%` }}
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-2 pt-1 text-xs">
                      <div className="bg-white p-2.5 rounded-xl border border-slate-100">
                        <span className="text-[9px] text-slate-400 font-bold block uppercase">
                          {isSopirView ? 'Total Jarak' : 'Total Durasi'}
                        </span>
                        <span className="font-extrabold text-slate-800">
                          {isSopirView
                            ? car.totalDistanceKm.toFixed(1) + ' KM'
                            : car.totalDurationHours.toFixed(1) + ' Jam'}
                        </span>
                      </div>
                      <div className="bg-white p-2.5 rounded-xl border border-slate-100">
                        <span className="text-[9px] text-slate-400 font-bold block uppercase">
                          {isSopirView ? 'Total BBM' : 'Upah Bersih'}
                        </span>
                        <span className="font-extrabold text-slate-800">
                          {fmtRp(isSopirView ? car.totalFuelCost : car.totalUpahBersih)}
                        </span>
                      </div>
                      <div className="bg-white p-2.5 rounded-xl border border-slate-100">
                        <span className="text-[9px] text-slate-400 font-bold block uppercase">
                          {isSopirView ? 'BBM / KM' : 'Total Reimburse'}
                        </span>
                        <span className="font-extrabold text-emerald-600">
                          {isSopirView
                            ? (avgFuelPerKm > 0 ? fmtRp(avgFuelPerKm) : '—')
                            : '+' + fmtRp(car.totalReimburse)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* 👤 Worker stats section */}
        <Card className="rounded-3xl border-none shadow-sm bg-white p-6 space-y-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <Users className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-extrabold text-slate-800">
                  Statistik {workerLabel} ({isSopirView ? 'Driver' : 'Worker'} Stats)
                </h3>
                <p className="text-[11px] text-slate-400 font-semibold">
                  Leaderboard upah bersih & total {completedItemLabel.toLowerCase()}
                </p>
              </div>
            </div>
            <Badge variant="outline" className="bg-emerald-50 border-emerald-200 text-emerald-700 text-[10px] font-bold">
              {driverStats.length} {workerLabel} Terlibat
            </Badge>
          </div>

          {driverStats.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400 font-medium">
              Belum ada data {completedItemLabel.toLowerCase()} {workerLabel.toLowerCase()} pada periode ini.
            </div>
          ) : (
            <div className="space-y-4 max-h-[460px] overflow-y-auto pr-1">
              {driverStats.map((drv, idx) => (
                <div key={drv.driverId} className="p-4 rounded-2xl bg-slate-50 border border-slate-100 space-y-3 hover:border-emerald-200 transition-colors">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center font-black text-xs border border-emerald-200">
                        #{idx + 1}
                      </div>
                      <div>
                        <span className="font-extrabold text-slate-800 text-sm block leading-tight">{drv.driverName}</span>
                        <span className="text-[10px] text-slate-400 font-semibold">
                          {drv.trips} {isSopirView ? 'Trip' : 'Aktivitas'} Selesai
                        </span>
                      </div>
                    </div>

                    <div className="text-right">
                      <span className="text-xs font-bold text-slate-400 block uppercase text-[9px]">Upah Bersih Total</span>
                      <span className="text-sm font-black text-emerald-600">{fmtRp(drv.totalUpahBersih)}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 pt-1 text-xs">
                    <div className="bg-white p-2.5 rounded-xl border border-slate-100">
                      <span className="text-[9px] text-slate-400 font-bold block uppercase">
                        {isSopirView ? 'Jarak Ditempuh' : 'Total Durasi'}
                      </span>
                      <span className="font-extrabold text-slate-800">
                        {isSopirView
                          ? drv.totalDistanceKm.toFixed(1) + ' KM'
                          : drv.totalDurationHours.toFixed(1) + ' Jam'}
                      </span>
                    </div>
                    <div className="bg-white p-2.5 rounded-xl border border-slate-100">
                      <span className="text-[9px] text-slate-400 font-bold block uppercase">
                        {isSopirView ? 'Jam Mengemudi' : 'Upah Bersih'}
                      </span>
                      <span className="font-extrabold text-slate-800">
                        {isSopirView ? drv.totalDurationHours.toFixed(1) + ' Jam' : fmtRp(drv.totalUpahBersih)}
                      </span>
                    </div>
                    <div className="bg-white p-2.5 rounded-xl border border-slate-100">
                      <span className="text-[9px] text-slate-400 font-bold block uppercase">Total Reimburse</span>
                      <span className="font-extrabold text-blue-600">+{fmtRp(drv.totalReimburse)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ── Bottom Section: Completed activity log table ──────────────────── */}
      <Card className="rounded-3xl border-none shadow-sm bg-white p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <h3 className="text-base font-extrabold text-slate-800 flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
              Daftar Riwayat Kegiatan Terverifikasi
            </h3>
            <p className="text-xs text-slate-400 font-semibold">Rincian kegiatan yang sudah disetujui & diaudit</p>
          </div>
          <Badge variant="outline" className="bg-slate-50 text-slate-600 text-[10px] font-bold">
            {filteredJourneys.length} Record Log
          </Badge>
        </div>

        {filteredJourneys.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400 font-medium">
            Tidak ada data kegiatan pada filter ini.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-100">
            <Table>
              <TableHeader className="bg-slate-50/80">
                <TableRow className="border-slate-100 text-[10px] uppercase font-black text-slate-500">
                  <TableHead className="py-3 px-4">Tanggal</TableHead>
                  <TableHead className="py-3 px-4">Kegiatan & Rute</TableHead>
                  <TableHead className="py-3 px-4">Kendaraan</TableHead>
                  <TableHead className="py-3 px-4">Pekarya</TableHead>
                  <TableHead className="py-3 px-4 text-right">Jarak / Durasi</TableHead>
                  <TableHead className="py-3 px-4 text-right">Biaya SPJ</TableHead>
                  <TableHead className="py-3 px-4 text-right">Upah Bersih</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-slate-100 text-xs font-semibold text-slate-700">
                {filteredJourneys.map((j) => (
                  <TableRow key={j.id} className="hover:bg-slate-50/50 transition-colors">
                    <TableCell className="py-3 px-4 font-bold text-slate-600 whitespace-nowrap">
                      {j.journeyDate || '—'}
                    </TableCell>
                    <TableCell className="py-3 px-4">
                      <div className="font-extrabold text-slate-800 leading-snug max-w-xs">{j.activityName}</div>
                      {activeCategory === ALL_CATEGORY_VALUE && (
                        <div className="text-[10px] text-indigo-500 font-bold mt-0.5">
                          {categoryLabel(j.jobCategory)}
                        </div>
                      )}
                      {j.points && j.points.length > 0 && (
                        <div className="text-[10px] text-slate-400 truncate max-w-xs mt-0.5">
                          📍 {j.points.join(' → ')}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="py-3 px-4">
                      {j.vehicleName ? (
                        <Badge variant="outline" className="bg-indigo-50/60 border-indigo-100 text-indigo-700 text-[10px] font-bold">
                          {j.vehicleName}
                        </Badge>
                      ) : '—'}
                    </TableCell>
                    <TableCell className="py-3 px-4 font-extrabold text-slate-800">
                      {j.employeeName}
                    </TableCell>
                    <TableCell className="py-3 px-4 text-right font-bold text-slate-600 whitespace-nowrap">
                      {j.distanceKm > 0 || j.durationHours > 0
                        ? j.distanceKm.toFixed(1) + ' km (' + j.durationHours.toFixed(1) + ' jam)'
                        : '—'}
                    </TableCell>
                    <TableCell className="py-3 px-4 text-right font-extrabold text-blue-700 whitespace-nowrap">
                      {j.operationalCost > 0 ? fmtRp(j.operationalCost) : '—'}
                    </TableCell>
                    <TableCell className="py-3 px-4 text-right font-black text-emerald-600 whitespace-nowrap">
                      {fmtRp(j.upahBersih)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
      </div>
    </div>
  );
}

export default function JourneyDashboardPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-400 text-xs font-bold">
        Memuat Dashboard Pekarya...
      </div>
    }>
      <JourneyDashboardContent />
    </Suspense>
  );
}
