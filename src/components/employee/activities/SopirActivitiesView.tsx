"use client";

import {
  Card,
  CardContent,
} from '@/components/ui/card';
import {
  Button,
} from '@/components/ui/button';
import {
  Input,
} from '@/components/ui/input';
import {
  Label,
} from '@/components/ui/label';
import {
  Badge,
} from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Loader2,
  Plus,
  CalendarDays,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Sparkles,
  MapPin,
  Compass,
  Search,
  Target,
} from 'lucide-react';
import {
  getTodayDateString,
} from '@/lib/payroll/driverPiket';
import {
  DEFAULT_DRIVER_VEHICLE_NAME,
  DRIVER_VEHICLE_NAMES,
  DRIVER_VEHICLE_RATES,
  cashOperationalCostFromJourney,
  calculateEstimatedDriverWage,
  resolveMealAccountingMode,
  CURRENT_MEAL_ACCOUNTING_MODE,
  formatDurationHoursAsJamMenit,
  type DriverVehicleName,
} from '@/lib/payroll/driverJourney';
import {
  PLACE_AUTOCOMPLETE_MIN_QUERY_LENGTH,
} from '@/hooks/useCostSafePlaceAutocomplete';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  getEffectiveVehicleRate,
  DestinationImageBanner,
  fmtRp,
  journeyMainDestinationLabel,
} from './activityModel';
import type { EmployeeActivitiesModel } from './activityModel';
import { SOPIR_JOURNEY_REPORT_PATH } from '@/lib/employeeActivities';
import ActivityFormDialog from './ActivityFormDialog';

interface SopirActivitiesViewProps {
  model: EmployeeActivitiesModel;
}

export default function SopirActivitiesView({ model }: SopirActivitiesViewProps) {
  const {
    router,
    isSopir,
    showMapSelector,
    setShowMapSelector,
    mapSearchText,
    setMapSearchText,
    setMapAddress,
    mapAddress,
    setMapLocation,
    mapLocation,
    setMapSearchError,
    mapSearchError,
    cancelPlaceSearch,
    placeSuggestions,
    isSearchingPlaces,
    placeSearchError,
    unassignedJourneys,
    myAssignedJourneys,
    myClaimedJourneys,
    loadingJourneys,
    isClaiming,
    isCancelling,
    isPiketActiveToday,
    activePiketStationName,
    showSelfPiketSpjModal,
    selfPiketActivityName,
    setSelfPiketActivityName,
    selfPiketStartPoint,
    selfPiketStartPointLocation,
    selfPiketEndPoint,
    selfPiketEndPointLocation,
    selfPiketVehicleName,
    setSelfPiketVehicleName,
    creatingPiketSpj,
    setSelfPiketCalcDistance,
    selfPiketCalcDistance,
    selfPiketCalcDuration,
    selfPiketCalculating,
    selfPiketCalcError,
    setMapTargetMode,
    lastSelfPiketCalculatedRef,
    selfPiketOperationalCosts,
    submittedSelfPiketSpjCount,
    openSelfPiketSpjModal,
    closeSelfPiketSpjModal,
    handleCreateSelfPiketSpj,
    resetMapSearch,
    handleMapSearchChange,
    handlePlaceSuggestionSelect,
    handleMapSearchKeyDown,
    initMap,
    handleConfirmMapLocation,
    handleStartAssignedJourney,
    handleClaimJourney,
    handleCancelJourney,
  } = model;

  return (
    <>
{isSopir && (
          <div className="space-y-4">
            {/* Active Piket Banner & Self-Creation Button */}
            {isPiketActiveToday ? (
              <div className="bg-gradient-to-r from-emerald-600 via-teal-600 to-indigo-700 text-white rounded-2xl p-4 sm:p-5 shadow-sm space-y-3 relative overflow-hidden">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 relative z-10">
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-wider bg-white/20 px-2.5 py-0.5 rounded-full text-emerald-100 flex items-center gap-1.5 w-fit">
                      <span className="w-2 h-2 rounded-full bg-emerald-300 animate-ping" />
                      Jadwal Piket Aktif Hari Ini {activePiketStationName ? `• Stasiun: ${activePiketStationName}` : ''}
                    </span>
                    <h3 className="text-sm sm:text-base font-extrabold mt-1.5 text-white">
                      Anda Bertugas Piket Hari Ini!
                    </h3>
                    <p className="text-xs text-emerald-100/90 mt-0.5">
                      Karena jadwal piket Anda aktif hari ini, Anda dapat mengotorisasi SPJ (Surat Perintah Jalan) sendiri. Kendaraan default adalah <strong>Ndalem</strong>, tetapi Anda dapat memilih kendaraan lain bila diperlukan.
                    </p>
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 border border-white/20 px-2.5 py-1 text-[11px] font-extrabold text-white">
                        <Sparkles className="w-3.5 h-3.5 text-amber-200" />
                        SPJ Piket Terbuat Hari Ini: {submittedSelfPiketSpjCount} SPJ
                      </span>
                      {myClaimedJourneys.length === 0 && (
                        <span className="text-[11px] font-semibold text-emerald-100">
                          Anda dapat membuat SPJ Piket berikutnya setelah perjalanan sebelumnya selesai.
                        </span>
                      )}
                    </div>
                    {myClaimedJourneys.length > 0 && (
                      <p className="text-[11px] font-bold text-amber-200 mt-1 flex items-center gap-1.5 bg-amber-950/40 p-2.5 rounded-xl border border-amber-400/30">
                        <AlertCircle className="w-4 h-4 text-amber-300 shrink-0" />
                        Anda memiliki perjalanan aktif yang sedang berjalan. Selesaikan laporan perjalanan tersebut terlebih dahulu untuk dapat membuat SPJ Piket baru.
                      </p>
                    )}
                  </div>

                  <Button
                    disabled={myClaimedJourneys.length > 0}
                    onClick={openSelfPiketSpjModal}
                    className="shrink-0 rounded-xl bg-white text-emerald-900 hover:bg-emerald-50 font-extrabold text-xs h-10 px-4 gap-2 cursor-pointer shadow-md border-none disabled:opacity-50"
                  >
                    <Plus className="w-4 h-4 text-emerald-700" />
                    Buat SPJ Piket
                  </Button>
                </div>
              </div>
            ) : (
              <div className="bg-slate-100 border border-slate-200 text-slate-700 rounded-2xl p-4 sm:p-5 shadow-sm space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start gap-2">
                    <CalendarDays className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                    <div>
                      <h3 className="text-sm font-bold text-slate-800">Buat SPJ Mandiri</h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Anda dapat mengotorisasi SPJ (Surat Perintah Jalan) sendiri kapan saja, termasuk di luar jadwal Piket.
                      </p>
                      {myClaimedJourneys.length > 0 && (
                        <p className="text-[11px] font-bold text-amber-700 mt-1.5 flex items-center gap-1.5 bg-amber-50 p-2 rounded-xl border border-amber-200">
                          <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
                          Anda memiliki perjalanan aktif yang sedang berjalan. Selesaikan laporan perjalanan tersebut terlebih dahulu untuk dapat membuat SPJ baru.
                        </p>
                      )}
                    </div>
                  </div>

                  <Button
                    disabled={myClaimedJourneys.length > 0}
                    onClick={openSelfPiketSpjModal}
                    className="shrink-0 rounded-xl bg-slate-800 text-white hover:bg-slate-700 font-extrabold text-xs h-10 px-4 gap-2 cursor-pointer shadow-sm border-none disabled:opacity-50"
                  >
                    <Plus className="w-4 h-4" />
                    Buat SPJ Mandiri
                  </Button>
                </div>
              </div>
            )}

            {/* 1. Bucket Top: Horizontal Carousel for Assigned Tasks */}
            {myAssignedJourneys.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between pl-1">
                  <h3 className="text-xs font-bold text-purple-800 uppercase tracking-wider flex items-center gap-1.5">
                    <Target className="w-4 h-4 text-purple-600" />
                    Tugas Penugasan Khusus Anda ({myAssignedJourneys.length})
                  </h3>
                  <span className="text-[10px] font-extrabold text-purple-700 bg-purple-100/80 border border-purple-200 px-2 py-0.5 rounded-full">
                    Jadwal Mendatang
                  </span>
                </div>

                <div className="flex overflow-x-auto snap-x snap-mandatory scrollbar-none gap-3 pb-2 pt-1 -mx-1 px-1">
                  {myAssignedJourneys.map((j) => (
                    <Card key={j.id} className="min-w-[280px] sm:min-w-[320px] max-w-[340px] snap-start shrink-0 bg-gradient-to-br from-purple-900 via-indigo-900 to-slate-900 text-white rounded-2xl shadow-md border-none overflow-hidden relative flex flex-col justify-between">
                      <div className="absolute top-0 right-0 w-28 h-28 rounded-full bg-purple-500/10 -translate-y-4 translate-x-4 blur-md pointer-events-none" />
                      <CardContent className="p-4 space-y-3 relative z-10 flex-1 flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] font-bold tracking-wider text-purple-200 uppercase bg-purple-500/40 border border-purple-400/30 px-2 py-0.5 rounded-md">
                              Ditugaskan Khusus
                            </span>
                            {j.activityDate && (
                              <span className="text-[10px] font-bold text-purple-200 bg-white/10 px-2 py-0.5 rounded-md">
                                {new Date(j.activityDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}
                              </span>
                            )}
                          </div>
                          <h4 className="text-sm font-bold mt-2 text-white leading-snug">
                            {j.activityName}
                          </h4>
                        </div>

                        <div className="p-2.5 rounded-xl bg-white/10 text-white text-xs font-medium space-y-1 mt-2">
                          <div className="flex items-center gap-1.5 text-purple-100">
                            <MapPin className="w-4 h-4 text-purple-300 shrink-0" />
                            <span className="font-semibold text-white/95">Tujuan:</span>
                            <span className="truncate flex-1 font-extrabold text-white" title={journeyMainDestinationLabel(j)}>{journeyMainDestinationLabel(j)}</span>
                          </div>
                          <div className="flex justify-between pt-1 border-t border-white/10 text-[10px] text-purple-200">
                            <span>Kendaraan: <strong>{j.vehicleName}</strong></span>
                            <span>Operasional: <strong>{fmtRp(cashOperationalCostFromJourney(j))}</strong></span>
                          </div>
                          {(() => {
                            const est = calculateEstimatedDriverWage(
                              j.distanceKm * 2,
                              (j.durationHours || 0) * 2,
                              resolveMealAccountingMode(j.mealAccountingMode, {
                                alreadyApproved: j.status === 'completed',
                              }),
                            );
                            const baseWage = j.estimatedBaseDriverWage || est.baseWage;
                            const maxWage = j.estimatedMaxDriverWage || est.maxWage;
                            return (
                              <div className="pt-1 border-t border-white/10 text-[10px] text-purple-200 flex justify-between items-center">
                                <span>Estimasi Upah:</span>
                                <span className="font-black text-amber-300">{fmtRp(baseWage)} - {fmtRp(maxWage)}</span>
                              </div>
                            );
                          })()}
                        </div>

                        <Button
                          disabled={myClaimedJourneys.length > 0 || isClaiming}
                          onClick={() => handleStartAssignedJourney(j.id)}
                          className="w-full mt-2 rounded-xl bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700 text-white font-extrabold text-xs h-9 gap-1.5 cursor-pointer shadow-sm border-none disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isClaiming ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                          Mulai Perjalanan Tugas
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* 2. Bucket Middle: Active claimed journeys */}
            {myClaimedJourneys.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-bold text-indigo-700 uppercase tracking-wider pl-1">
                  Perjalanan Aktif Anda
                </h3>
                {myClaimedJourneys.map((j) => {
                  const est = calculateEstimatedDriverWage(
                              j.distanceKm * 2,
                              (j.durationHours || 0) * 2,
                              resolveMealAccountingMode(j.mealAccountingMode, {
                                alreadyApproved: j.status === 'completed',
                              }),
                            );
                  const baseWage = j.estimatedBaseDriverWage || est.baseWage;
                  const maxWage = j.estimatedMaxDriverWage || est.maxWage;

                  return (
                    <div key={j.id} className="bg-white rounded-2xl border-2 border-indigo-200 shadow-xs overflow-hidden p-4 sm:p-5 space-y-3.5">
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-black tracking-wider text-emerald-700 uppercase bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-lg flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                            Dalam Perjalanan
                          </span>
                          <span className="text-xs font-bold text-slate-600 bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-lg">
                            {j.vehicleName} ({fmtRp(getEffectiveVehicleRate(j.vehicleName, j.vehicleRate))}/km)
                          </span>
                        </div>
                        <h4 className="text-base sm:text-lg font-extrabold mt-2.5 text-slate-900 leading-snug">
                          {j.activityName}
                        </h4>
                      </div>

                      <div className="flex items-center gap-1.5 text-xs text-slate-600 bg-slate-50 border border-slate-200/80 p-2.5 rounded-xl">
                        <MapPin className="w-4 h-4 text-indigo-600 shrink-0" />
                        <span className="font-bold text-slate-500">Tujuan utama:</span>
                        <span className="truncate flex-1 font-extrabold text-slate-800" title={journeyMainDestinationLabel(j)}>{journeyMainDestinationLabel(j)}</span>
                      </div>

                      {/* 2-Column Cards Grid: Left = Biaya Operasional, Right = Estimasi Upah Sopir */}
                      <div className="grid grid-cols-2 gap-2.5 pt-1">
                        <div className="bg-indigo-50/70 border border-indigo-100 p-3.5 rounded-xl space-y-0.5">
                          <span className="block text-[9px] font-black text-indigo-600 uppercase tracking-wider">Biaya Operasional</span>
                          <span className="text-xs sm:text-sm font-black text-indigo-900 block">{fmtRp(cashOperationalCostFromJourney(j))}</span>
                        </div>
                        <div className="bg-emerald-50/70 border border-emerald-100 p-3.5 rounded-xl space-y-0.5">
                          <span className="block text-[9px] font-black text-emerald-600 uppercase tracking-wider">Estimasi Upah Sopir</span>
                          <span className="text-xs sm:text-sm font-black text-emerald-900 block">{fmtRp(baseWage)} - {fmtRp(maxWage)}</span>
                        </div>
                      </div>

                      <div className="flex flex-col gap-2 pt-1 border-t border-slate-100">
                        <Button
                          onClick={() => {
                            if (typeof window !== 'undefined') {
                              sessionStorage.removeItem('cancelled_driver_journey_id');
                            }
                            router.push(`${SOPIR_JOURNEY_REPORT_PATH}?id=${j.id}`);
                          }}
                          className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs sm:text-sm h-10.5 gap-2 cursor-pointer shadow-md shadow-indigo-100 transition-all border-none"
                        >
                          <CheckCircle2 className="w-4.5 h-4.5" />
                          Laporan Perjalanan
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => handleCancelJourney(j.id)}
                          className="w-full rounded-xl bg-white hover:bg-rose-50 text-rose-600 border border-rose-200 font-bold text-xs h-9 gap-1.5 cursor-pointer transition-all"
                        >
                          <XCircle className="w-4 h-4 text-rose-500 shrink-0" />
                          Batalkan Klaim Perjalanan
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* 3. Bucket Bottom: Open / Unassigned Journeys Pool */}
            <div className="space-y-2">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider pl-1 flex items-center gap-1.5">
                <Compass className="w-4.5 h-4.5 text-slate-400" />
                Pemesanan Perjalanan Terbuka (Pool)
              </h3>
              {loadingJourneys ? (
                <div className="p-6 text-center text-slate-400 bg-white border border-slate-100 rounded-2xl flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
                  <span className="text-xs font-medium">Memuat perjalanan terbuka...</span>
                </div>
              ) : unassignedJourneys.length === 0 ? (
                <div className="p-6 text-center text-slate-400 bg-white/50 border border-dashed border-slate-200 rounded-2xl">
                  <span className="text-xs font-medium">Belum ada perjalanan dinas terbuka di pool umum.</span>
                </div>
              ) : (
                <div>
                  {myClaimedJourneys.length > 0 && (
                    <div className="p-3.5 text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-2xl font-bold flex items-center gap-2 mb-3">
                      <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>Anda memiliki perjalanan aktif. Selesaikan atau laporkan terlebih dahulu sebelum mengambil perjalanan baru.</span>
                    </div>
                  )}
                  {unassignedJourneys.map((j) => (
                    <div key={j.id} className="pt-6 pb-8 border-b-2 border-slate-300/80 space-y-3.5 first:pt-2">
                      <div className="rounded-2xl overflow-hidden shadow-xs border border-slate-200/60">
                        <DestinationImageBanner destination={j.endPoint} />
                      </div>
                      <div className="space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-emerald-500" />
                            <span className="text-[10px] font-extrabold text-emerald-600 bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 rounded-md">
                              Pool Umum
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            {j.activityDate && (
                              <span className="text-[10px] font-extrabold text-indigo-600 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded-md">
                                {new Date(j.activityDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                              </span>
                            )}
                            <span className="text-[10px] font-bold text-slate-400 bg-slate-50 border border-slate-100 px-1.5 py-0.5 rounded-md">
                              {j.vehicleName} ({fmtRp(getEffectiveVehicleRate(j.vehicleName, j.vehicleRate))}/km)
                            </span>
                          </div>
                        </div>

                        <div>
                          <h4 className="text-xs sm:text-sm font-extrabold text-slate-800 leading-snug">{j.activityName}</h4>
                          <div className="flex items-center gap-1 mt-1 text-[10px] text-slate-500 font-semibold">
                            <MapPin className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                            <span className="truncate flex-1 font-extrabold text-slate-700" title={journeyMainDestinationLabel(j)}>{journeyMainDestinationLabel(j)}</span>
                          </div>
                        </div>

                        <div className="flex justify-between items-center pt-2.5 border-t border-slate-200/60">
                          <div className="flex gap-4">
                            <div>
                              <span className="block text-[8px] text-slate-400 font-extrabold uppercase leading-tight">Biaya Operasional</span>
                              <span className="text-xs font-black text-indigo-600">{fmtRp(cashOperationalCostFromJourney(j))}</span>
                            </div>
                            {(() => {
                              const est = calculateEstimatedDriverWage(
                              j.distanceKm * 2,
                              (j.durationHours || 0) * 2,
                              resolveMealAccountingMode(j.mealAccountingMode, {
                                alreadyApproved: j.status === 'completed',
                              }),
                            );
                              const baseWage = j.estimatedBaseDriverWage || est.baseWage;
                              const maxWage = j.estimatedMaxDriverWage || est.maxWage;
                              return (
                                <div>
                                  <span className="block text-[8px] text-slate-400 font-extrabold uppercase leading-tight">Upah Bersih</span>
                                  <span className="text-xs font-black text-emerald-600">{fmtRp(baseWage)} - {fmtRp(maxWage)}</span>
                                </div>
                              );
                            })()}
                          </div>

                          <Button
                            disabled={myClaimedJourneys.length > 0}
                            onClick={() => handleClaimJourney(j.id)}
                            className="rounded-lg bg-indigo-50 hover:bg-indigo-600 border border-indigo-100 hover:border-indigo-600 text-indigo-700 hover:text-white font-extrabold !text-[9px] sm:!text-[12px] !leading-tight !h-auto py-1 px-2 sm:py-1.5 sm:px-3 transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:bg-slate-50 disabled:text-slate-400 disabled:border-slate-100 disabled:cursor-not-allowed whitespace-normal text-center"
                          >
                            Ambil<br />Perjalanan
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
<ActivityFormDialog model={model} />
<Dialog open={showMapSelector} onOpenChange={setShowMapSelector}>
        <DialogContent className="sm:max-w-[500px] rounded-2xl bg-white border-slate-100 shadow-2xl p-6">
          <DialogHeader>
            <DialogTitle className="text-base font-extrabold text-slate-800 flex items-center gap-2">
              <MapPin className="w-5 h-5 text-indigo-600" />
              Pilih Tujuan di Google Maps
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-400 mt-1">
              Cari lokasi atau geser pin merah ke lokasi tujuan perjalanan dinas.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div className="relative">
              <div className="flex h-11 items-center gap-2.5 rounded-2xl border border-slate-200 bg-white px-3.5 shadow-sm transition-all focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-500/20">
                <Compass className="h-4.5 w-4.5 shrink-0 text-indigo-500" />
                <Input
                  placeholder="Cari lokasi tujuan dinas..."
                  value={mapSearchText}
                  onChange={(event) => handleMapSearchChange(event.target.value)}
                  onKeyDown={handleMapSearchKeyDown}
                  onBlur={() => window.setTimeout(cancelPlaceSearch, 150)}
                  autoComplete="off"
                  role="combobox"
                  aria-expanded={placeSuggestions.length > 0}
                  className="h-full flex-1 border-none bg-transparent p-0 text-xs font-bold text-slate-700 placeholder:text-slate-400 focus-visible:ring-0"
                />
                {isSearchingPlaces && <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />}
                {mapSearchText && (
                  <button
                    type="button"
                    onClick={() => {
                      resetMapSearch();
                      setMapSearchText('');
                      setMapAddress('');
                      setMapLocation(null);
                    }}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-slate-400 transition-all hover:bg-slate-100 hover:text-slate-600"
                    aria-label="Hapus pencarian"
                  >
                    <XCircle className="h-4 w-4" />
                  </button>
                )}
                <div className="h-5 w-px shrink-0 bg-slate-200" />
                <button
                  type="button"
                  onClick={() => {
                    if (placeSuggestions[0]) {
                      handlePlaceSuggestionSelect(placeSuggestions[0]);
                    } else {
                      setMapSearchError(
                        mapSearchText.trim().length < PLACE_AUTOCOMPLETE_MIN_QUERY_LENGTH
                          ? `Ketik minimal ${PLACE_AUTOCOMPLETE_MIN_QUERY_LENGTH} karakter untuk mencari lokasi.`
                          : 'Pilih salah satu saran lokasi sebelum melanjutkan.',
                      );
                    }
                  }}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-indigo-500 transition-all hover:bg-indigo-50 hover:text-indigo-600"
                  aria-label="Pilih saran lokasi pertama"
                >
                  <Search className="h-4.5 w-4.5" />
                </button>
              </div>

              {placeSuggestions.length > 0 && (
                <div className="absolute inset-x-0 top-full z-[100] mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
                  {placeSuggestions.map((suggestion) => (
                    <button
                      key={suggestion.id}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => handlePlaceSuggestionSelect(suggestion)}
                      className="flex w-full items-start gap-2 border-b border-slate-100 px-3 py-2.5 text-left last:border-b-0 hover:bg-indigo-50"
                    >
                      <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-500" />
                      <span className="min-w-0">
                        <strong className="block truncate text-[11px] text-slate-800">{suggestion.primaryText}</strong>
                        {suggestion.secondaryText && (
                          <span className="block truncate text-[10px] text-slate-500">{suggestion.secondaryText}</span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <p className="text-[10px] text-slate-400">
              Ketik minimal {PLACE_AUTOCOMPLETE_MIN_QUERY_LENGTH} karakter, lalu pilih salah satu saran.
            </p>
            {(mapSearchError || placeSearchError) && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-[10px] font-semibold text-amber-700">
                {mapSearchError || placeSearchError}
              </p>
            )}

            {/* Map Container */}
            <div
              ref={(el) => {
                if (el) {
                  initMap(el);
                }
              }}
              className="w-full h-[280px] rounded-xl border border-slate-100 overflow-hidden bg-slate-50 relative flex items-center justify-center"
            >
              <div className="flex flex-col items-center gap-2 text-slate-400">
                <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
                <span className="text-[10px] font-bold">Memuat Google Maps...</span>
              </div>
            </div>

            {/* Selected Address Box */}
            {mapAddress && (
              <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl text-xs text-slate-600 leading-relaxed font-semibold">
                <span className="text-[9px] uppercase tracking-wider text-slate-400 block mb-0.5">Alamat Terpilih:</span>
                📍 {mapAddress}
              </div>
            )}

            <DialogFooter className="pt-2 border-t border-slate-100 gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowMapSelector(false)}
                className="rounded-xl font-bold text-slate-500 hover:bg-slate-50 text-xs px-4"
              >
                Batal
              </Button>
              <Button
                type="button"
                disabled={!mapAddress || !mapLocation}
                onClick={handleConfirmMapLocation}
                className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-5 h-10"
              >
                Konfirmasi Lokasi
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
<Dialog
        open={showSelfPiketSpjModal}
        onOpenChange={(open) => {
          if (open) openSelfPiketSpjModal();
          else closeSelfPiketSpjModal();
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl p-6 sm:p-7">
          <DialogHeader className="border-b border-slate-100 pb-4">
            <DialogTitle className="text-base sm:text-lg font-black text-slate-800 flex items-center gap-2">
              <Compass className="w-5 h-5 text-emerald-600 animate-spin-slow" />
              Otorisasi SPJ Mandiri
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleCreateSelfPiketSpj} className="space-y-4 pt-2">
            {myClaimedJourneys.length > 0 && (
              <div className="p-3 bg-amber-50 border border-amber-200 text-amber-900 rounded-2xl text-xs font-semibold flex items-center gap-2.5 animate-in fade-in duration-200">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>Anda masih memiliki tugas perjalanan aktif yang belum selesai dilaporkan. Selesaikan laporan perjalanan aktif terlebih dahulu sebelum membuat SPJ baru.</span>
              </div>
            )}
            {/* Nama Kegiatan & Tanggal Perjalanan */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-2 space-y-1.5">
                <Label htmlFor="selfPiketActivityName" className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                  Nama Kegiatan / Keperluan
                </Label>
                <Input
                  id="selfPiketActivityName"
                  placeholder="Contoh: Mengantar Gus Ufik ke Surabaya"
                  value={selfPiketActivityName}
                  onChange={(e) => setSelfPiketActivityName(e.target.value)}
                  required
                  className="rounded-xl border-slate-200 focus:border-indigo-400 focus:ring-indigo-400/20 text-xs sm:text-sm h-10 px-3 font-semibold"
                />
              </div>

              <div className="md:col-span-1 space-y-1.5">
                <Label className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                  Tanggal Perjalanan
                </Label>
                <Input
                  type="date"
                  value={getTodayDateString('Asia/Jakarta')}
                  disabled
                  className="rounded-xl border-slate-200 bg-slate-50 font-bold text-xs h-10 px-3 cursor-not-allowed"
                />
              </div>
            </div>

            {/* Titik Mulai (Origin) & Tujuan Utama (Destination) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                  Titik Awal
                </Label>
                {!selfPiketStartPoint ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      resetMapSearch();
                      setMapTargetMode('piketStart');
                      setMapSearchText('');
                      setMapAddress('');
                      setMapLocation(null);
                      setShowMapSelector(true);
                    }}
                    className="w-full rounded-xl border border-dashed border-emerald-300 hover:border-emerald-500 bg-emerald-50/30 hover:bg-emerald-50/50 text-emerald-700 h-10 px-4 flex items-center justify-center gap-1.5 font-bold text-xs cursor-pointer transition-all"
                  >
                    <MapPin className="w-4 h-4" />
                    Pilih Titik Awal di Peta
                  </Button>
                ) : (
                  <div className="p-3 bg-emerald-50/40 border border-emerald-100 rounded-xl flex items-center justify-between gap-3 animate-in fade-in duration-200">
                    <div className="flex items-center gap-2 overflow-hidden text-xs text-emerald-950 font-semibold flex-1">
                      <MapPin className="w-4.5 h-4.5 text-emerald-600 shrink-0" />
                      <span className="truncate" title={selfPiketStartPoint}>{selfPiketStartPoint}</span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        resetMapSearch();
                        setMapTargetMode('piketStart');
                        setMapSearchText(selfPiketStartPoint);
                        setMapAddress(selfPiketStartPoint);
                        setMapLocation(selfPiketStartPointLocation);
                        setShowMapSelector(true);
                      }}
                      className="text-[10px] font-bold text-emerald-700 hover:text-emerald-800 bg-white hover:bg-slate-50 border border-slate-200 px-2.5 h-7 rounded-lg shrink-0 cursor-pointer"
                    >
                      Ubah
                    </Button>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                  Tujuan Utama
                </Label>
                {!selfPiketEndPoint ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      resetMapSearch();
                      setMapTargetMode('piketEnd');
                      setMapSearchText('');
                      setMapAddress('');
                      setMapLocation(null);
                      setShowMapSelector(true);
                    }}
                    className="w-full rounded-xl border border-dashed border-emerald-300 hover:border-emerald-500 bg-emerald-50/30 hover:bg-emerald-50/50 text-emerald-700 h-10 px-4 flex items-center justify-center gap-1.5 font-bold text-xs cursor-pointer transition-all"
                  >
                    <MapPin className="w-4 h-4" />
                    Pilih Lokasi Tujuan di Peta
                  </Button>
                ) : (
                  <div className="p-3 bg-emerald-50/40 border border-emerald-100 rounded-xl flex items-center justify-between gap-3 animate-in fade-in duration-200">
                    <div className="flex items-center gap-2 overflow-hidden text-xs text-emerald-950 font-semibold flex-1">
                      <MapPin className="w-4.5 h-4.5 text-emerald-600 shrink-0" />
                      <span className="truncate" title={selfPiketEndPoint}>{selfPiketEndPoint}</span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        resetMapSearch();
                        setMapTargetMode('piketEnd');
                        setMapSearchText(selfPiketEndPoint);
                        setMapAddress(selfPiketEndPoint);
                        setMapLocation(selfPiketEndPointLocation);
                        setShowMapSelector(true);
                      }}
                      className="text-[10px] font-bold text-emerald-700 hover:text-emerald-800 bg-white hover:bg-slate-50 border border-slate-200 px-2.5 h-7 rounded-lg shrink-0 cursor-pointer"
                    >
                      Ubah
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {/* Kendaraan: Ndalem remains the default, but other vehicles use the same
                operational allowance rules as a Kepala Satker authorization. */}
            <div className="space-y-1.5">
              <Label htmlFor="selfPiketVehicle" className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                Jenis Kendaraan
              </Label>
              <Select
                value={selfPiketVehicleName}
                onValueChange={(value) => {
                  if (value && DRIVER_VEHICLE_NAMES.includes(value as DriverVehicleName)) {
                    setSelfPiketVehicleName(value as DriverVehicleName);
                  }
                }}
              >
                <SelectTrigger id="selfPiketVehicle" className="w-full text-xs font-extrabold text-slate-700 bg-white rounded-xl border border-slate-200 h-10 px-3">
                  <SelectValue>
                    {selfPiketVehicleName === DEFAULT_DRIVER_VEHICLE_NAME
                      ? 'Ndalem — Default, tanpa BBM'
                      : `${selfPiketVehicleName} — Rp${DRIVER_VEHICLE_RATES[selfPiketVehicleName].toLocaleString('id-ID')}/km`}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="rounded-xl border-slate-100 shadow-xl bg-white text-xs">
                  {DRIVER_VEHICLE_NAMES.map((vehicleName) => (
                    <SelectItem key={vehicleName} value={vehicleName}>
                      {vehicleName === DEFAULT_DRIVER_VEHICLE_NAME
                        ? 'Ndalem — Default, tanpa BBM'
                        : `${vehicleName} — Rp${DRIVER_VEHICLE_RATES[vehicleName].toLocaleString('id-ID')}/km`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-slate-500 font-semibold">
                Ndalem dipilih otomatis. Kendaraan lain mendapat anggaran BBM dan uang makan sesuai otorisasi Kepala SatKer.
              </p>
            </div>

            {/* Calculation Loader */}
            {selfPiketCalculating && (
              <div className="flex items-center justify-center p-3 text-xs text-emerald-700 font-bold bg-emerald-50/60 rounded-xl border border-emerald-200/60 animate-in fade-in duration-200">
                <Loader2 className="w-4 h-4 animate-spin mr-2 text-emerald-600" />
                Mengevaluasi rute & durasi Google Maps...
              </div>
            )}

            {/* Calculation Errors */}
            {selfPiketCalcError && (
              <div className="p-3 text-xs bg-rose-50 border border-rose-200 text-rose-700 rounded-xl font-semibold flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{selfPiketCalcError}</span>
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    lastSelfPiketCalculatedRef.current = { start: '', end: '' };
                    setSelfPiketCalcDistance(null);
                  }}
                  className="text-[10px] font-bold bg-rose-600 hover:bg-rose-700 text-white h-7 px-2.5 rounded-lg shrink-0 cursor-pointer"
                >
                  Coba Lagi
                </Button>
              </div>
            )}

            {/* Calculation Summary Preview */}
            {selfPiketCalcDistance !== null && (
              <div className="p-4 bg-gradient-to-br from-emerald-50/80 to-teal-50/50 border border-emerald-200/80 rounded-2xl space-y-3 animate-in fade-in duration-200">
                <div className="flex items-center justify-between border-b border-emerald-200/60 pb-2">
                  <span className="text-[10px] font-black text-emerald-900 uppercase tracking-wider flex items-center gap-1.5">
                    <Compass className="w-3.5 h-3.5 text-emerald-600" />
                    Rincian Perjalanan & Estimasi Upah Sopir
                  </span>
                  <Badge className="bg-emerald-200/80 text-emerald-950 border-none text-[9px] font-black">
                    {isPiketActiveToday ? 'Piket Mandiri' : 'SPJ Mandiri'}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-2 text-slate-700 text-xs font-semibold">
                  <div className="bg-white p-2.5 rounded-xl border border-emerald-100 shadow-xs">
                    <span className="block text-[9px] text-slate-400 font-extrabold uppercase">Jarak Tempuh PP</span>
                    <span className="text-xs sm:text-sm font-black text-emerald-900">{(selfPiketCalcDistance * 2).toFixed(1)} km</span>
                  </div>
                  <div className="bg-white p-2.5 rounded-xl border border-emerald-100 shadow-xs">
                    <span className="block text-[9px] text-slate-400 font-extrabold uppercase">Estimasi Waktu Tempuh PP</span>
                    <span className="text-xs sm:text-sm font-black text-emerald-900">
                      {formatDurationHoursAsJamMenit((selfPiketCalcDuration || 0) * 2)}
                    </span>
                  </div>
                </div>

                {(() => {
                  // Mirror the server's own figure for this journey exactly
                  // (`create_self` in /api/driver-journeys uses the same call with
                  // CURRENT_MEAL_ACCOUNTING_MODE). Hand-rolling the formula here
                  // dropped the meal component and understated the estimate.
                  const { compJarak, compWaktu, shortTripMeal, mealWage, baseWage, maxWage } =
                    calculateEstimatedDriverWage(
                      selfPiketCalcDistance * 2,
                      (selfPiketCalcDuration || 0) * 2,
                      CURRENT_MEAL_ACCOUNTING_MODE,
                    );

                  return (
                    <div className="bg-white p-3 rounded-xl border border-emerald-200/80 space-y-1.5 shadow-xs">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-extrabold text-slate-700">Estimasi Upah Bersih Sopir:</span>
                        <span className="text-xs sm:text-sm font-black text-emerald-700">{fmtRp(baseWage)} - {fmtRp(maxWage)}</span>
                      </div>
                      <div className="text-[10px] text-slate-500 pt-1 border-t border-slate-100 font-semibold">
                        <span>
                          Komponen Jarak ({fmtRp(compJarak)}) + Komponen Waktu ({fmtRp(compWaktu)})
                          {shortTripMeal > 0 ? ` + Uang Makan (≤2 Jam: ${fmtRp(shortTripMeal)})` : ''}
                          {mealWage > 0 ? ` + Uang Makan (${fmtRp(mealWage)})` : ''}
                        </span>
                      </div>
                    </div>
                  );
                })()}

                {selfPiketOperationalCosts && (
                  <div className="bg-white p-3 rounded-xl border border-blue-200/80 space-y-1.5 shadow-xs">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-extrabold text-slate-700">Biaya Operasional SPJ:</span>
                      <span className="text-xs sm:text-sm font-black text-blue-700">
                        {fmtRp(selfPiketOperationalCosts.totalOperationalCost)}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-500 pt-1 border-t border-slate-100 font-semibold">
                      BBM {fmtRp(selfPiketOperationalCosts.baseOperationalCost)} + Uang makan {fmtRp(selfPiketOperationalCosts.mealAllowance)} + Tol/parkir {fmtRp(selfPiketOperationalCosts.tollParkingFee)}
                    </div>
                  </div>
                )}
              </div>
            )}

            <DialogFooter className="pt-3 border-t border-slate-100 gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={closeSelfPiketSpjModal}
                className="rounded-xl font-bold text-slate-500 text-xs px-4 cursor-pointer hover:bg-slate-100"
              >
                Batal
              </Button>
              <Button
                type="submit"
                disabled={
                  creatingPiketSpj ||
                  selfPiketCalculating ||
                  !selfPiketEndPoint.trim() ||
                  selfPiketCalcDistance === null ||
                  selfPiketCalcDistance <= 0 ||
                  selfPiketCalcDuration === null ||
                  selfPiketCalcDuration <= 0 ||
                  myClaimedJourneys.length > 0
                }
                className="rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-extrabold text-xs px-6 h-10 gap-2 shadow-md shadow-emerald-200 cursor-pointer disabled:opacity-50"
              >
                {creatingPiketSpj ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Otorisasi & Mulai Perjalanan
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
{isClaiming && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9999] flex flex-col items-center justify-center gap-4 text-white animate-in fade-in duration-300">
          <div className="bg-slate-950/80 border border-slate-800 rounded-3xl p-8 flex flex-col items-center gap-4 max-w-sm mx-4 text-center shadow-2xl">
            <Loader2 className="w-10 h-10 animate-spin text-indigo-500" />
            <div className="space-y-1.5">
              <h4 className="font-extrabold text-sm text-slate-100">Memproses...</h4>
              <p className="text-xs font-semibold text-slate-400">Mengkonfirmasi Penerimaan Perjalanan</p>
            </div>
          </div>
        </div>
      )}
{isCancelling && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9999] flex flex-col items-center justify-center gap-4 text-white animate-in fade-in duration-300">
          <div className="bg-slate-950/80 border border-slate-800 rounded-3xl p-8 flex flex-col items-center gap-4 max-w-sm mx-4 text-center shadow-2xl">
            <Loader2 className="w-10 h-10 animate-spin text-rose-500" />
            <div className="space-y-1.5">
              <h4 className="font-extrabold text-sm text-slate-100">Memproses...</h4>
              <p className="text-xs font-semibold text-slate-400">Membatalkan Klaim Perjalanan</p>
            </div>
          </div>
        </div>
      )}
</>
  );
}
