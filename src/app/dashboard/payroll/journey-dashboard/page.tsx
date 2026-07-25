"use client";

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import SatkerPekaryaNavBar from '@/components/SatkerPekaryaNavBar';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
  Fuel,
  Banknote,
  MapPin,
  Clock,
  ShieldCheck,
  CheckCircle2,
  ChevronRight,
  Sparkles,
  ArrowUpRight,
} from 'lucide-react';
import { db } from '@/lib/firebase';
import {
  collection,
  query,
  getDocs,
  where,
  onSnapshot,
} from 'firebase/firestore';
import { MONTHS_ID } from '@/utils/rekapConfig';

function fmtRp(val: number): string {
  return 'Rp' + Math.round(val || 0).toLocaleString('id-ID');
}

function dateOnlyFromValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const timestamp = value as { toDate?: () => Date; seconds?: number };
    const date = timestamp.toDate?.() || (typeof timestamp.seconds === 'number' ? new Date(timestamp.seconds * 1000) : null);
    if (date && !Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }
  return '';
}

interface CompletedJourney {
  id: string;
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

  const [selectedMonth, setSelectedMonth] = useState<string>(
    searchParams.get('month') || currentMonth
  );
  const [selectedYear, setSelectedYear] = useState<string>(
    searchParams.get('year') || currentYear
  );

  const [journeys, setJourneys] = useState<CompletedJourney[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Sync state when URL params change
  useEffect(() => {
    const m = searchParams.get('month');
    const y = searchParams.get('year');
    if (m) setSelectedMonth(m);
    if (y) setSelectedYear(y);
  }, [searchParams]);

  // Fetch completed journeys from Firestore
  useEffect(() => {
    setLoading(true);

    // Fetch from DriverJourneys (status: completed or approved) and ActivityReports (jobCategory: SOPIR)
    const journeysRef = collection(db, 'DriverJourneys');
    const reportsRef = collection(db, 'ActivityReports');

    const unsubJourneys = onSnapshot(journeysRef, (journeysSnap) => {
      const journeyList: CompletedJourney[] = [];
      const seenIds = new Set<string>();

      journeysSnap.forEach((docSnap) => {
        const d = docSnap.data();
        if (d.status === 'completed' || d.status === 'approved') {
          seenIds.add(docSnap.id);
          const jDate = dateOnlyFromValue(d.journeyDate || d.activityDate || d.createdAt);
          journeyList.push({
            id: docSnap.id,
            activityName: d.activityName || d.purpose || 'Perjalanan Dinas',
            employeeName: d.employeeName || d.driverName || 'Sopir',
            employeeId: d.employeeId || d.driverId || '',
            vehicleName: d.vehicleName || d.vehicleType || 'Suzuki XL7',
            journeyDate: jDate,
            activityDate: jDate,
            distanceKm: d.newTotalDistanceKm || d.distanceKm || 0,
            durationHours: d.newTotalDurationHours || d.durationHours || 0,
            operationalCost: d.totalOperationalCost || d.operationalCost || d.fee || 0,
            upahBersih: d.upahBersih || 0,
            fuelFee: d.fuelFee || 0,
            tollParkingFee: d.tollParkingFee || 0,
            reimburseDelta: d.reimburseDelta || 0,
            nightCount: Number(d.nightCount || 0),
            points: d.points || [],
            status: d.status,
          });
        }
      });

      // Also check ActivityReports for any completed SOPIR journeys
      getDocs(query(reportsRef, where('jobCategory', '==', 'SOPIR'))).then((reportsSnap) => {
        reportsSnap.forEach((rSnap) => {
          const rd = rSnap.data();
          if ((rd.status === 'approved' || rd.status === 'completed') && !seenIds.has(rSnap.id) && !seenIds.has(rd.journeyId)) {
            const rDate = rd.activityDate || rd.journeyDate || '';
            journeyList.push({
              id: rSnap.id,
              activityName: rd.activityName || 'Perjalanan Dinas',
              employeeName: rd.employeeName || 'Sopir',
              employeeId: rd.employeeId || '',
              vehicleName: rd.vehicleType || rd.vehicleName || 'Suzuki XL7',
              journeyDate: rDate,
              activityDate: rDate,
              distanceKm: rd.distanceKm || 0,
              durationHours: rd.durationHours || 0,
              operationalCost: rd.totalOperationalCost || rd.fee || 0,
              upahBersih: rd.upahBersih || 0,
              fuelFee: rd.fuelFee || 0,
              tollParkingFee: rd.tollParkingFee || 0,
              reimburseDelta: rd.reimburseDelta || 0,
              nightCount: Number(rd.nightCount || 0),
              points: rd.points || [],
              status: rd.status,
            });
          }
        });

        setJourneys(journeyList);
        setLoading(false);
      });
    });

    return () => unsubJourneys();
  }, []);

  // Filter journeys by selected month and year (or ALL)
  const filteredJourneys = useMemo(() => {
    return journeys.filter((j) => {
      if (!j.journeyDate) return selectedMonth === 'all';
      const parts = j.journeyDate.split('-');
      if (parts.length < 2) return selectedMonth === 'all';
      const jYear = parts[0];
      const jMonth = String(parseInt(parts[1], 10));

      if (selectedYear !== 'all' && jYear !== selectedYear) return false;
      if (selectedMonth !== 'all' && jMonth !== selectedMonth) return false;
      return true;
    });
  }, [journeys, selectedMonth, selectedYear]);

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

  // Car Stats Aggregation
  const carStats = useMemo(() => {
    const map: Record<string, {
      vehicleName: string;
      trips: number;
      totalDistanceKm: number;
      totalDurationHours: number;
      totalFuelCost: number;
      totalSPJCost: number;
      totalNights: number;
    }> = {};

    filteredJourneys.forEach((j) => {
      const vName = j.vehicleName || 'Suzuki XL7';
      if (!map[vName]) {
        map[vName] = {
          vehicleName: vName,
          trips: 0,
          totalDistanceKm: 0,
          totalDurationHours: 0,
          totalFuelCost: 0,
          totalSPJCost: 0,
          totalNights: 0,
        };
      }
      map[vName].trips += 1;
      map[vName].totalDistanceKm += j.distanceKm || 0;
      map[vName].totalDurationHours += j.durationHours || 0;
      map[vName].totalFuelCost += j.fuelFee || 0;
      map[vName].totalSPJCost += j.operationalCost || 0;
      map[vName].totalNights += j.nightCount || 0;
    });

    const list = Object.values(map);
    list.sort((a, b) => b.trips - a.trips);
    return list;
  }, [filteredJourneys]);

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
      const dName = j.employeeName || 'Sopir';
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
  }, [filteredJourneys]);

  const handlePeriodChange = (m: string, y: string) => {
    setSelectedMonth(m);
    setSelectedYear(y);
    router.push(`/dashboard/payroll/journey-dashboard?month=${m}&year=${y}`);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/20 to-slate-100 p-4 sm:p-6 lg:p-8 space-y-6">
      {/* ── Navigation Header Bar ────────────────────────────────────────── */}
      <SatkerPekaryaNavBar />

      {/* ── Page Header + Period Controls ────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white/80 backdrop-blur-md p-6 rounded-3xl border border-slate-200/80 shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Badge className="bg-indigo-100 text-indigo-700 hover:bg-indigo-100 text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-0.5 rounded-lg border border-indigo-200">
              Analitik Perjalanan Dinamis
            </Badge>
            <Sparkles className="w-4 h-4 text-amber-500 animate-pulse" />
          </div>
          <h1 className="text-2xl font-black text-slate-800 tracking-tight flex items-center gap-2">
            Dashboard Perjalanan Driver
          </h1>
          <p className="text-xs text-slate-500 font-medium">
            Statistik lengkap performa armada kendaraan (Car Stats) & kinerja upah bersih sopir (Driver Stats).
          </p>
        </div>

        {/* Period Filter Dropdowns */}
        <div className="flex items-center gap-2.5 bg-slate-50 p-2 rounded-2xl border border-slate-200/80">
          <Calendar className="w-4 h-4 text-indigo-500 shrink-0 ml-1" />

          <Select value={selectedMonth} onValueChange={(m) => handlePeriodChange(m || 'all', selectedYear)}>
            <SelectTrigger className="w-36 h-9 text-xs font-bold bg-white rounded-xl border-slate-200">
              <SelectValue />
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

          <Select value={selectedYear} onValueChange={(y) => handlePeriodChange(selectedMonth, y || 'all')}>
            <SelectTrigger className="w-28 h-9 text-xs font-bold bg-white rounded-xl border-slate-200">
              <SelectValue />
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
            <span className="text-[10px] font-black uppercase tracking-widest text-indigo-100">Total Perjalanan Selesai</span>
            <div className="w-9 h-9 rounded-xl bg-white/20 backdrop-blur-md flex items-center justify-center">
              <Compass className="w-5 h-5 text-white" />
            </div>
          </div>
          <div>
            <span className="text-3xl font-black">{overallKPI.totalTrips}</span>
            <span className="text-xs text-indigo-100 font-semibold ml-2">Perjalanan</span>
          </div>
          <div className="text-[10px] text-indigo-100/80 font-medium pt-1 border-t border-white/10 flex justify-between">
            <span>Total Kilometrase:</span>
            <span className="font-extrabold text-white">{overallKPI.totalMileage.toFixed(1)} KM</span>
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
            <span>Aggregat BBM + Tol + Makan</span>
            <span className="font-bold text-blue-600">Terverifikasi</span>
          </div>
        </Card>

        {/* Card 3: Total Upah Bersih Sopir */}
        <Card className="rounded-2xl border-none shadow-sm bg-white p-5 space-y-3 border border-slate-100">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total Upah Bersih Sopir</span>
            <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Award className="w-5 h-5" />
            </div>
          </div>
          <div>
            <span className="text-2xl font-black text-emerald-600">{fmtRp(overallKPI.totalUpahBersih)}</span>
          </div>
          <div className="text-[10px] text-slate-500 font-medium pt-1 border-t border-slate-100 flex justify-between">
            <span>Komponen Jarak + Waktu + Premi</span>
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
            <span>Talangan Driver Terganti</span>
            <span className="font-bold text-amber-600">Biaya Tambahan</span>
          </div>
        </Card>
      </div>

      {/* ── Main Section: Car Stats & Driver Stats ──────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 🚗 CAR STATS SECTION */}
        <Card className="rounded-3xl border-none shadow-sm bg-white p-6 space-y-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                <Car className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-extrabold text-slate-800">Statistik Kendaraan (Car Stats)</h3>
                <p className="text-[11px] text-slate-400 font-semibold">Performa kilometrase & penggunaan armada</p>
              </div>
            </div>
            <Badge variant="outline" className="bg-indigo-50 border-indigo-200 text-indigo-700 text-[10px] font-bold">
              {carStats.length} Kendaraan Terpakai
            </Badge>
          </div>

          {carStats.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400 font-medium">
              Belum ada data perjalanan kendaraan pada periode ini.
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
                        {car.trips} Perjalanan ({usagePct}%)
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
                        <span className="text-[9px] text-slate-400 font-bold block uppercase">Total Jarak</span>
                        <span className="font-extrabold text-slate-800">{car.totalDistanceKm.toFixed(1)} KM</span>
                      </div>
                      <div className="bg-white p-2.5 rounded-xl border border-slate-100">
                        <span className="text-[9px] text-slate-400 font-bold block uppercase">Total BBM</span>
                        <span className="font-extrabold text-slate-800">{fmtRp(car.totalFuelCost)}</span>
                      </div>
                      <div className="bg-white p-2.5 rounded-xl border border-slate-100">
                        <span className="text-[9px] text-slate-400 font-bold block uppercase">BBM / KM</span>
                        <span className="font-extrabold text-emerald-600">{avgFuelPerKm > 0 ? fmtRp(avgFuelPerKm) : '—'}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* 👤 DRIVER STATS SECTION */}
        <Card className="rounded-3xl border-none shadow-sm bg-white p-6 space-y-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <Users className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-extrabold text-slate-800">Statistik Sopir (Driver Stats)</h3>
                <p className="text-[11px] text-slate-400 font-semibold">Leaderboard upah bersih & total trip sopir</p>
              </div>
            </div>
            <Badge variant="outline" className="bg-emerald-50 border-emerald-200 text-emerald-700 text-[10px] font-bold">
              {driverStats.length} Driver Aktif
            </Badge>
          </div>

          {driverStats.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400 font-medium">
              Belum ada data perjalanan sopir pada periode ini.
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
                        <span className="text-[10px] text-slate-400 font-semibold">{drv.trips} Trip Selesai</span>
                      </div>
                    </div>

                    <div className="text-right">
                      <span className="text-xs font-bold text-slate-400 block uppercase text-[9px]">Upah Bersih Total</span>
                      <span className="text-sm font-black text-emerald-600">{fmtRp(drv.totalUpahBersih)}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 pt-1 text-xs">
                    <div className="bg-white p-2.5 rounded-xl border border-slate-100">
                      <span className="text-[9px] text-slate-400 font-bold block uppercase">Jarak Ditempuh</span>
                      <span className="font-extrabold text-slate-800">{drv.totalDistanceKm.toFixed(1)} KM</span>
                    </div>
                    <div className="bg-white p-2.5 rounded-xl border border-slate-100">
                      <span className="text-[9px] text-slate-400 font-bold block uppercase">Jam Mengemudi</span>
                      <span className="font-extrabold text-slate-800">{drv.totalDurationHours.toFixed(1)} Jam</span>
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

      {/* ── Bottom Section: Completed Journeys Log Table ──────────────────── */}
      <Card className="rounded-3xl border-none shadow-sm bg-white p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <h3 className="text-base font-extrabold text-slate-800 flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
              Daftar Riwayat Perjalanan Terverifikasi
            </h3>
            <p className="text-xs text-slate-400 font-semibold">Rincian perjalanan dinas yang sudah disetujui & diaudit</p>
          </div>
          <Badge variant="outline" className="bg-slate-50 text-slate-600 text-[10px] font-bold">
            {filteredJourneys.length} Record Log
          </Badge>
        </div>

        {filteredJourneys.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400 font-medium">
            Tidak ada data riwayat perjalanan pada filter ini.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-100">
            <Table>
              <TableHeader className="bg-slate-50/80">
                <TableRow className="border-slate-100 text-[10px] uppercase font-black text-slate-500">
                  <TableHead className="py-3 px-4">Tanggal</TableHead>
                  <TableHead className="py-3 px-4">Kegiatan & Rute</TableHead>
                  <TableHead className="py-3 px-4">Kendaraan</TableHead>
                  <TableHead className="py-3 px-4">Sopir</TableHead>
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
                      {j.points && j.points.length > 0 && (
                        <div className="text-[10px] text-slate-400 truncate max-w-xs mt-0.5">
                          📍 {j.points.join(' → ')}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="py-3 px-4">
                      <Badge variant="outline" className="bg-indigo-50/60 border-indigo-100 text-indigo-700 text-[10px] font-bold">
                        {j.vehicleName}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-3 px-4 font-extrabold text-slate-800">
                      {j.employeeName}
                    </TableCell>
                    <TableCell className="py-3 px-4 text-right font-bold text-slate-600 whitespace-nowrap">
                      {j.distanceKm} km ({j.durationHours} jam)
                    </TableCell>
                    <TableCell className="py-3 px-4 text-right font-extrabold text-blue-700 whitespace-nowrap">
                      {fmtRp(j.operationalCost)}
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
  );
}

export default function JourneyDashboardPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-400 text-xs font-bold">
        Memuat Dashboard Perjalanan...
      </div>
    }>
      <JourneyDashboardContent />
    </Suspense>
  );
}
