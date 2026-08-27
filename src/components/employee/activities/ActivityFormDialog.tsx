"use client";

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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Loader2,
  CheckCircle2,
  Pencil,
  Send,
  Timer,
  Sparkles,
  Trash2,
  Camera,
} from 'lucide-react';
import {
  calculateJourneyDateTimeTimings,
  MAX_DRIVER_JOURNEY_DESTINATIONS,
  MAX_DRIVER_JOURNEY_LOCATIONS,
} from '@/lib/payroll/driverJourney';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  calculateSopirDefaultFee,
  fmtRp,
  getNextDayISO,
  padTime,
} from './activityModel';
import type { EmployeeActivitiesModel } from './activityModel';

interface ActivityFormDialogProps {
  model: EmployeeActivitiesModel;
}

export default function ActivityFormDialog({ model }: ActivityFormDialogProps) {
  const {
    activityProofInputRef,
    userJobCategory,
    isKebersihan,
    isSopir,
    supportsSpjProof,
    showForm,
    editingActivity,
    formActivityType,
    setFormActivityType,
    setFormName,
    formName,
    formCustomName,
    setFormCustomName,
    formDate,
    setFormDate,
    formTimeStart,
    setFormTimeStart,
    formTimeEnd,
    setFormTimeEnd,
    submitting,
    formProofPhoto,
    setFormProofPhoto,
    uploadingProofPhoto,
    formTripType,
    setFormTripType,
    formVehicleType,
    setFormVehicleType,
    formIsMultiDay,
    setFormIsMultiDay,
    setFormDateEnd,
    formDateEnd,
    formNightCount,
    setFormNightCount,
    formFuelFee,
    setFormFuelFee,
    formTollParkingFee,
    setFormTollParkingFee,
    formPoints,
    setFormPoints,
    setCalculatedDistanceKm,
    calculatedDistanceKm,
    setCalculatedDurationHours,
    calculatedDurationHours,
    isCalculatingRoute,
    setRouteError,
    routeError,
    routeCalculatedPoints,
    resetForm,
    handleCalculateRoute,
    setPersonalSpjDate,
    handleUploadActivityProof,
    handleSubmit,
  } = model;

  // A multi-day Sopir trip has its own Berangkat/Tiba date+time fields, which
  // write the very same formDate/formTimeStart/formTimeEnd state as the generic
  // block further down. Rendering both gave the driver two competing widgets per
  // value, where editing the lower one silently overwrote the upper one.
  const usesDedicatedTripSchedule = isSopir && formIsMultiDay;

  // Arrival must not land before departure. Only meaningful once both halves of
  // the multi-day range are filled in.
  const tripEndsBeforeItStarts =
    usesDedicatedTripSchedule &&
    Boolean(formDate && formTimeStart && formTimeEnd) &&
    `${formDateEnd || formDate}T${formTimeEnd}` <= `${formDate}T${formTimeStart}`;

  return (
    <>
      <Dialog
        open={showForm}
        onOpenChange={(open) => {
          // Never discard the form (and its editingActivity context) while a
          // submission is still in flight: the request would land with no
          // confirmation on screen, inviting a duplicate report.
          if (!open && !submitting && !uploadingProofPhoto) resetForm();
        }}
      >
        <DialogContent className="sm:max-w-md max-w-[calc(100%-2rem)] rounded-3xl border-none shadow-2xl bg-white p-0 overflow-hidden">
          <div className="bg-gradient-to-r from-teal-500 to-cyan-600 p-5 pb-4">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold text-white flex items-center gap-2">
                {editingActivity
                  ? <><Pencil className="w-4.5 h-4.5" /> Edit Kegiatan</>
                  : <><Sparkles className="w-4.5 h-4.5" /> {userJobCategory === 'SATPAM' ? 'Lapor SPJ Pribadi' : 'Lapor Kegiatan Baru'}</>
                }
              </DialogTitle>
              <DialogDescription className="text-teal-100 text-base mt-1">
                {editingActivity
                  ? 'Perbarui detail dan ajukan ulang kegiatan ini.'
                  : userJobCategory === 'SATPAM'
                    ? 'Isi kegiatan, tanggal, serta waktu mulai dan selesai. Jadwal shift tidak membatasi SPJ pribadi.'
                    : 'Masukkan detail kegiatan yang telah Anda selesaikan.'
                }
              </DialogDescription>
            </DialogHeader>
          </div>

          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            {isKebersihan ? (
              <>
                {/* Activity Type Selection */}
                <div className="space-y-1.5">
                  <Label htmlFor="activityType" className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                    Jenis Kegiatan
                  </Label>
                  {/* Native select on mobile for bug-free scrolling/zooming */}
                  <div className="block sm:hidden">
                    <select
                      value={formActivityType}
                      onChange={(e) => {
                        const val = e.target.value as typeof formActivityType;
                        setFormActivityType(val);
                        if (val !== 'Lainnya') {
                          setFormName(val);
                        } else {
                          setFormName(formCustomName || '');
                        }
                      }}
                      className="w-full text-base font-bold text-slate-700 bg-white rounded-xl border border-slate-200 h-10 px-3 pr-10 appearance-none focus:outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-400/20"
                      style={{
                        backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 24 24\' stroke=\'%2394a3b8\'%3E%3Cpath stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'2\' d=\'M19 9l-7 7-7-7\'/%3E%3C/svg%3E")',
                        backgroundPosition: 'right 12px center',
                        backgroundSize: '16px 16px',
                        backgroundRepeat: 'no-repeat',
                      }}
                    >
                      <option value="Piket">Piket</option>
                      <option value="Standby">Standby</option>
                      <option value="Ro'an">Ro&apos;an</option>
                      <option value="Buang Sampah">Buang Sampah</option>
                      <option value="Lainnya">Lainnya</option>
                    </select>
                  </div>

                  {/* Custom select on larger screens (tablet/desktop) */}
                  <div className="hidden sm:block">
                    <Select
                      value={formActivityType}
                      onValueChange={(value) => {
                        if (!value) return;
                        const nextType = value as typeof formActivityType;
                        setFormActivityType(nextType);
                        if (nextType !== 'Lainnya') {
                          setFormName(nextType);
                        } else {
                          setFormName(formCustomName || '');
                        }
                      }}
                    >
                      <SelectTrigger className="w-full text-sm font-bold text-slate-700 bg-white rounded-xl border border-slate-200 h-10 px-3">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl border-slate-100 shadow-xl bg-white">
                        <SelectItem value="Piket">Piket</SelectItem>
                        <SelectItem value="Standby">Standby</SelectItem>
                        <SelectItem value="Ro'an">Ro&apos;an</SelectItem>
                        <SelectItem value="Buang Sampah">Buang Sampah</SelectItem>
                        <SelectItem value="Lainnya">Lainnya</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Custom Activity Name (shown only if 'Lainnya' is selected) */}
                {formActivityType === 'Lainnya' && (
                  <div className="space-y-1.5 animate-in fade-in slide-in-from-top-2 duration-200">
                    <Label htmlFor="activityCustomName" className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                      Jenis Kegiatan Kustom
                    </Label>
                    <Input
                      id="activityCustomName"
                      placeholder="Contoh: Memindahkan Barang"
                      value={formCustomName}
                      onChange={(e) => {
                        setFormCustomName(e.target.value);
                        setFormName(e.target.value);
                      }}
                      className="rounded-xl border-slate-200 focus:border-teal-400 focus:ring-teal-400/20 text-base sm:text-sm"
                      required
                      autoFocus
                      autoComplete="off"
                    />
                  </div>
                )}
              </>
            ) : isSopir ? (
              <div className="space-y-4 animate-in fade-in duration-200">
                {/* Nama Kegiatan */}
                <div className="space-y-1.5">
                  <Label htmlFor="activityNameInput" className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                    Keperluan / Catatan Perjalanan
                  </Label>
                  <Input
                    id="activityNameInput"
                    placeholder="Contoh: Mengantar Rektor Dinas ke Surabaya"
                    value={formName}
                    onChange={(e) => {
                      setFormName(e.target.value);
                      setFormCustomName(e.target.value);
                    }}
                    className="rounded-xl border-slate-200 focus:border-teal-400 focus:ring-teal-400/20 text-base sm:text-sm"
                    required
                    autoFocus
                    autoComplete="off"
                  />
                </div>

                {/* Rute Perjalanan (Destinasi) */}
                <div className="space-y-2">
                  <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">
                    Rute Perjalanan (Destinasi)
                  </Label>
                  <div className="space-y-2">
                    {formPoints.map((point, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-slate-400 w-16 text-right select-none">
                          {idx === 0 ? 'Mulai (Pool)' : idx === formPoints.length - 1 ? 'Tujuan Akhir' : `Singgah ${idx}`}
                        </span>
                        <div className="relative flex-1">
                          <Input
                            placeholder={idx === 0 ? 'Contoh: Pool Unipdu, Jombang' : 'Nama kota/gedung/lokasi'}
                            value={point}
                            onChange={(e) => {
                              const val = e.target.value;
                              setFormPoints(prev => {
                                const copy = [...prev];
                                copy[idx] = val;
                                return copy;
                              });
                              setCalculatedDistanceKm(0);
                              setCalculatedDurationHours(0);
                              setRouteError('');
                            }}
                            className="rounded-xl border-slate-200 focus:border-teal-400 focus:ring-teal-400/20 text-base sm:text-sm pr-2 h-10"
                            required
                            autoComplete="off"
                          />
                        </div>
                        {formPoints.length > 2 && idx > 0 && idx < formPoints.length - 1 && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setFormPoints(prev => prev.filter((_, i) => i !== idx));
                              setCalculatedDistanceKm(0);
                              setCalculatedDurationHours(0);
                              setRouteError('');
                            }}
                            className="h-8 w-8 p-0 text-slate-400 hover:text-rose-500 rounded-xl"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="flex gap-2 pt-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={formPoints.length >= MAX_DRIVER_JOURNEY_LOCATIONS}
                      title={
                        formPoints.length >= MAX_DRIVER_JOURNEY_LOCATIONS
                          ? `Maksimal ${MAX_DRIVER_JOURNEY_DESTINATIONS} titik tujuan`
                          : undefined
                      }
                      onClick={() => {
                        setFormPoints(prev => {
                          const copy = [...prev];
                          copy.splice(copy.length - 1, 0, '');
                          return copy;
                        });
                        setCalculatedDistanceKm(0);
                        setCalculatedDurationHours(0);
                        setRouteError('');
                      }}
                      className="text-[11px] font-bold border-slate-200 rounded-xl hover:bg-slate-50 text-slate-600 px-3 h-8"
                    >
                      + Tambah Titik Singgah
                    </Button>

                    <Button
                      type="button"
                      size="sm"
                      disabled={isCalculatingRoute || formPoints.some(p => !p.trim())}
                      onClick={handleCalculateRoute}
                      className="text-[11px] font-bold bg-teal-600 hover:bg-teal-700 text-white rounded-xl px-3 h-8 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isCalculatingRoute ? 'Menghitung...' : '✓ Cek Rute & Jarak'}
                    </Button>
                  </div>
                </div>

                {routeError && (
                  <div className="p-3 text-xs bg-rose-50 border border-rose-200 text-rose-700 rounded-xl font-medium">
                    ⚠️ {routeError}
                  </div>
                )}

                {calculatedDistanceKm > 0 && JSON.stringify(formPoints) === JSON.stringify(routeCalculatedPoints) && (
                  <div className="p-3.5 bg-emerald-50 border border-emerald-100 rounded-xl space-y-1.5 animate-in fade-in duration-200">
                    <div className="flex justify-between text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                      <span>Rincian Rute Terverifikasi</span>
                      <span className="text-emerald-600 font-extrabold">Terhitung</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <div className="bg-white p-2 rounded-lg border border-slate-100 text-center">
                        <span className="block text-[9px] text-slate-400 font-bold uppercase">Jarak Tempuh</span>
                        <span className="text-sm font-extrabold text-slate-800">{calculatedDistanceKm} km</span>
                      </div>
                      <div className="bg-white p-2 rounded-lg border border-slate-100 text-center">
                        <span className="block text-[9px] text-slate-400 font-bold uppercase">Estimasi Waktu</span>
                        <span className="text-sm font-extrabold text-slate-800">{calculatedDurationHours} jam</span>
                      </div>
                    </div>
                    <div className="pt-2 text-center border-t border-dashed border-slate-200">
                      <span className="text-[9px] font-bold text-slate-400 uppercase block">Estimasi Uang SPJ</span>
                      <span className="text-sm font-black text-teal-600">
                        {fmtRp(calculateSopirDefaultFee(
                          formTripType,
                          formVehicleType,
                          formNightCount,
                          formDate,
                          formFuelFee ? (parseInt(formFuelFee.replace(/\D/g, ''), 10) || 0) : 0,
                          formTollParkingFee ? (parseInt(formTollParkingFee.replace(/\D/g, ''), 10) || 0) : 0,
                          calculatedDistanceKm,
                          calculatedDurationHours
                        ))}
                      </span>
                    </div>
                  </div>
                )}

                {calculatedDistanceKm > 0 && JSON.stringify(formPoints) !== JSON.stringify(routeCalculatedPoints) && (
                  <div className="p-3 text-xs bg-amber-50 border border-amber-200 text-amber-700 rounded-xl font-medium">
                    ⚠️ Rute telah diubah. Silakan klik “Cek Rute & Jarak” kembali sebelum mengirim.
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  {/* Tipe Perjalanan */}
                  <div className="space-y-1.5">
                    <Label htmlFor="tripType" className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                      Tipe Perjalanan
                    </Label>
                    <Select
                      value={formTripType}
                      onValueChange={(value) => {
                        if (value) setFormTripType(value as typeof formTripType);
                      }}
                    >
                      <SelectTrigger className="w-full text-sm font-bold text-slate-700 bg-white rounded-xl border border-slate-200 h-10 px-3">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl border-slate-100 shadow-xl bg-white">
                        <SelectItem value="Dalam Kota">Dalam Kota</SelectItem>
                        <SelectItem value="Luar Kota">Luar Kota</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Jenis Kendaraan */}
                  <div className="space-y-1.5">
                    <Label htmlFor="vehicleType" className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                      Jenis Kendaraan
                    </Label>
                    <Select
                      value={formVehicleType}
                      onValueChange={(value) => {
                        if (value) setFormVehicleType(value as typeof formVehicleType);
                      }}
                    >
                      <SelectTrigger className="w-full text-sm font-bold text-slate-700 bg-white rounded-xl border border-slate-200 h-10 px-3">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl border-slate-100 shadow-xl bg-white">
                        <SelectItem value="Mobil Kecil">Mobil Kecil</SelectItem>
                        <SelectItem value="Bus/Truk">Bus / Truk</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Toggle Lintas Hari / Menginap Above Time Controls */}
                <div className="flex items-center justify-between p-3 rounded-xl bg-teal-50/60 border border-teal-100">
                  <div className="flex items-center gap-2">
                    <input
                      id="toggleMultiDayApp"
                      type="checkbox"
                      checked={formIsMultiDay}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setFormIsMultiDay(checked);
                        if (!checked) {
                          setFormNightCount(0);
                          setFormDateEnd(formDate);
                        } else {
                          const startMins = parseInt((formTimeStart || '00:00').split(':')[0], 10) * 60 + parseInt((formTimeStart || '00:00').split(':')[1], 10);
                          const endMins = parseInt((formTimeEnd || '00:00').split(':')[0], 10) * 60 + parseInt((formTimeEnd || '00:00').split(':')[1], 10);
                          if (endMins <= startMins || !formDateEnd || formDateEnd === formDate) {
                            setFormDateEnd(getNextDayISO(formDate || new Date().toISOString().split('T')[0]));
                          }
                        }
                      }}
                      className="w-4 h-4 rounded text-teal-600 focus:ring-teal-500 cursor-pointer"
                    />
                    <Label htmlFor="toggleMultiDayApp" className="text-xs font-bold text-slate-700 cursor-pointer select-none">
                      Perjalanan Lintas Hari / Menginap
                    </Label>
                  </div>
                  <span className="text-[10px] font-semibold text-teal-700">
                    {formIsMultiDay ? 'Multi-Hari Active' : 'Hari yang sama'}
                  </span>
                </div>

                {formIsMultiDay && (
                  /* 2-Row Layout for Multi-Day / Overnight Trip */
                  <div className="space-y-3 animate-in fade-in duration-200">
                    {/* Row 1: Departure Date & Time */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="appDateStartInput" className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                          Tanggal Berangkat
                        </Label>
                        <Input
                          id="appDateStartInput"
                          type="date"
                          value={formDate}
                          onChange={(e) => setFormDate(e.target.value)}
                          className="rounded-xl border-slate-200 focus:border-teal-400 text-xs h-9 px-2.5 bg-white"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="appTimeStartMulti" className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                          Jam Berangkat
                        </Label>
                        <Input
                          id="appTimeStartMulti"
                          type="text"
                          inputMode="numeric"
                          maxLength={5}
                          placeholder="JJ:MM"
                          value={formTimeStart}
                          onChange={(e) => {
                            let val = e.target.value.replace(/[^0-9]/g, '');
                            if (val.length > 4) val = val.slice(0, 4);
                            if (val.length === 1 && parseInt(val, 10) > 2) val = `0${val}`;
                            if (val.length >= 2) {
                              const hours = parseInt(val.slice(0, 2), 10);
                              if (hours > 23) val = '23' + val.slice(2);
                            }
                            if (val.length === 4) {
                              const minutes = parseInt(val.slice(2, 4), 10);
                              if (minutes > 59) val = val.slice(0, 2) + '59';
                            }
                            if (val.length > 2) {
                              setFormTimeStart(`${val.slice(0, 2)}:${val.slice(2)}`);
                            } else {
                              setFormTimeStart(val);
                            }
                          }}
                          onBlur={(e) => setFormTimeStart(padTime(e.target.value))}
                          className="rounded-xl border-slate-200 focus:border-teal-400 text-xs h-9 px-3 bg-white"
                        />
                      </div>
                    </div>

                    {/* Row 2: Arrival Date & Time */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="appDateEndInput" className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                          Tanggal Tiba / Selesai
                        </Label>
                        <Input
                          id="appDateEndInput"
                          type="date"
                          min={formDate || undefined}
                          value={formDateEnd || formDate}
                          onChange={(e) => setFormDateEnd(e.target.value)}
                          className="rounded-xl border-slate-200 focus:border-teal-400 text-xs h-9 px-2.5 bg-white"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="appTimeEndMulti" className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                          Jam Tiba / Selesai
                        </Label>
                        <Input
                          id="appTimeEndMulti"
                          type="text"
                          inputMode="numeric"
                          maxLength={5}
                          placeholder="JJ:MM"
                          value={formTimeEnd}
                          onChange={(e) => {
                            let val = e.target.value.replace(/[^0-9]/g, '');
                            if (val.length > 4) val = val.slice(0, 4);
                            if (val.length === 1 && parseInt(val, 10) > 2) val = `0${val}`;
                            if (val.length >= 2) {
                              const hours = parseInt(val.slice(0, 2), 10);
                              if (hours > 23) val = '23' + val.slice(2);
                            }
                            if (val.length === 4) {
                              const minutes = parseInt(val.slice(2, 4), 10);
                              if (minutes > 59) val = val.slice(0, 2) + '59';
                            }
                            if (val.length > 2) {
                              setFormTimeEnd(`${val.slice(0, 2)}:${val.slice(2)}`);
                            } else {
                              setFormTimeEnd(val);
                            }
                          }}
                          onBlur={(e) => setFormTimeEnd(padTime(e.target.value))}
                          className="rounded-xl border-slate-200 focus:border-teal-400 text-xs h-9 px-3 bg-white"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {(() => {
                  const timings = calculateJourneyDateTimeTimings({
                    dateStart: formDate,
                    timeStart: formTimeStart,
                    dateEnd: formIsMultiDay ? (formDateEnd || formDate) : formDate,
                    timeEnd: formTimeEnd,
                    isMultiDay: formIsMultiDay,
                  });
                  const effectiveNights = formIsMultiDay ? timings.nightCount : 0;
                  return (
                    <div className="space-y-1 pt-1">
                      <div className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
                        <span>💡 Durasi Terhitung:</span>
                        <span className="text-teal-700 font-extrabold">
                          {timings.durationHours > 0 ? timings.durationHours.toFixed(1) : '0'} Jam ({effectiveNights} Malam)
                        </span>
                      </div>
                      {tripEndsBeforeItStarts && (
                        <p className="text-[11px] font-semibold text-rose-600">
                          Waktu tiba harus setelah waktu berangkat. Perbaiki tanggal atau jam tiba sebelum melaporkan.
                        </p>
                      )}
                    </div>
                  );
                })()}

                <div className="grid grid-cols-2 gap-3">
                  {/* Biaya BBM. Always reimburse here: fuel procurement modes
                      (hold_accumulate / procure_release) belong to a claimed
                      journey, which is reported on the dedicated journey-report
                      page, not through this standalone activity form. */}
                  <div className="space-y-1.5">
                    <Label htmlFor="fuelFee" className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                      BBM (Reimburse)
                    </Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 pointer-events-none">Rp</span>
                      <Input
                        id="fuelFee"
                        type="text"
                        placeholder="0"
                        value={formFuelFee}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '');
                          setFormFuelFee(val ? Number(val).toLocaleString('id-ID') : '');
                        }}
                        className="pl-8 rounded-xl border-slate-200 focus:border-teal-400 focus:ring-teal-400/20 text-base sm:text-sm font-semibold text-slate-700"
                      />
                    </div>
                  </div>

                  {/* Biaya Tol & Parkir */}
                  <div className="space-y-1.5">
                    <Label htmlFor="tollParkingFee" className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                      Tol & Parkir (Reimburse)
                    </Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 pointer-events-none">Rp</span>
                      <Input
                        id="tollParkingFee"
                        type="text"
                        placeholder="0"
                        value={formTollParkingFee}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '');
                          setFormTollParkingFee(val ? Number(val).toLocaleString('id-ID') : '');
                        }}
                        className="pl-8 rounded-xl border-slate-200 focus:border-teal-400 focus:ring-teal-400/20 text-base sm:text-sm font-semibold text-slate-700"
                      />
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* Free text input for other job categories */
              <div className="space-y-2 animate-in fade-in duration-200">
                <Label htmlFor="activityNameInput" className="text-sm font-bold text-slate-600">
                  Nama Kegiatan
                </Label>
                <Input
                  id="activityNameInput"
                  placeholder="Masukkan nama kegiatan..."
                  value={formName}
                  onChange={(e) => {
                    setFormName(e.target.value);
                    setFormCustomName(e.target.value);
                  }}
                  className="h-12 rounded-xl border-slate-200 focus:border-teal-400 focus:ring-teal-400/20 text-base"
                  required
                  autoFocus
                  autoComplete="off"
                />
              </div>
            )}

            {/* Generic date + time. Suppressed for a multi-day Sopir trip, which
                supplies the same three values through its own Berangkat/Tiba
                fields above. */}
            {!usesDedicatedTripSchedule && (
              <>
                {/* Date */}
                <div className="space-y-1.5">
                  <Label htmlFor="activityDate" className="text-base font-bold text-slate-600">
                    Tanggal Kegiatan
                  </Label>
                  <Input
                    id="activityDate"
                    type="date"
                    value={formDate}
                    onChange={(e) => setPersonalSpjDate(e.target.value)}
                    className="h-12 rounded-xl border-slate-200 focus:border-teal-400 focus:ring-teal-400/20 text-base"
                    required
                  />
                </div>

                {/* Time Range */}
                <div className={formActivityType === 'Buang Sampah' ? 'grid grid-cols-1' : 'grid grid-cols-2 gap-3'}>
                  <div className="space-y-1.5">
                    <Label htmlFor="timeStart" className="text-base font-bold text-slate-600">
                      Waktu Mulai
                    </Label>
                    <div className="relative">
                      <Timer className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                      <Input
                        id="timeStart"
                        type={userJobCategory === 'SATPAM' ? 'time' : 'text'}
                        inputMode="numeric"
                        maxLength={5}
                        placeholder="JJ:MM"
                        value={formTimeStart}
                        onChange={(e) => {
                          let val = e.target.value.replace(/[^0-9]/g, '');
                          if (val.length > 4) val = val.slice(0, 4);
                          if (val.length === 1 && parseInt(val, 10) > 2) {
                            val = `0${val}`;
                          }
                          if (val.length >= 2) {
                            const hours = parseInt(val.slice(0, 2), 10);
                            if (hours > 23) val = '23' + val.slice(2);
                          }
                          if (val.length === 4) {
                            const minutes = parseInt(val.slice(2, 4), 10);
                            if (minutes > 59) val = val.slice(0, 2) + '59';
                          }
                          if (val.length > 2) {
                            setFormTimeStart(`${val.slice(0, 2)}:${val.slice(2)}`);
                          } else {
                            setFormTimeStart(val);
                          }
                        }}
                        onBlur={(e) => {
                          setFormTimeStart(padTime(e.target.value));
                        }}
                        className="pl-9 h-12 rounded-xl border-slate-200 focus:border-teal-400 focus:ring-teal-400/20 text-base"
                        required
                      />
                    </div>
                  </div>
                  {formActivityType !== 'Buang Sampah' && (
                    <div className="space-y-1.5">
                      <Label htmlFor="timeEnd" className="text-base font-bold text-slate-600">
                        Waktu Selesai
                      </Label>
                      <div className="relative">
                        <Timer className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                        <Input
                          id="timeEnd"
                          type={userJobCategory === 'SATPAM' ? 'time' : 'text'}
                          inputMode="numeric"
                          maxLength={5}
                          placeholder="JJ:MM"
                          value={formTimeEnd}
                          onChange={(e) => {
                            let val = e.target.value.replace(/[^0-9]/g, '');
                            if (val.length > 4) val = val.slice(0, 4);
                            if (val.length === 1 && parseInt(val, 10) > 2) {
                              val = `0${val}`;
                            }
                            if (val.length >= 2) {
                              const hours = parseInt(val.slice(0, 2), 10);
                              if (hours > 23) val = '23' + val.slice(2);
                            }
                            if (val.length === 4) {
                              const minutes = parseInt(val.slice(2, 4), 10);
                              if (minutes > 59) val = val.slice(0, 2) + '59';
                            }
                            if (val.length > 2) {
                              setFormTimeEnd(`${val.slice(0, 2)}:${val.slice(2)}`);
                            } else {
                              setFormTimeEnd(val);
                            }
                          }}
                          onBlur={(e) => {
                            setFormTimeEnd(padTime(e.target.value));
                          }}
                          className="pl-9 h-12 rounded-xl border-slate-200 focus:border-teal-400 focus:ring-teal-400/20 text-base"
                          required
                        />
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            {supportsSpjProof && (
              <div className="space-y-1.5">
                <Label className="text-base font-bold text-slate-600">
                  Foto Bukti Kegiatan (Opsional)
                </Label>
                <input
                  ref={activityProofInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) handleUploadActivityProof(file);
                    event.target.value = '';
                  }}
                />
                {formProofPhoto ? (
                  <div className="flex items-center justify-between gap-2 rounded-xl border border-blue-200 bg-blue-50/80 px-3 py-2 text-base">
                    <div className="flex min-w-0 items-center gap-1.5 font-bold text-blue-800">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-blue-600" />
                      <span className="truncate">Foto bukti kegiatan terunggah</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setFormProofPhoto(null)}
                      className="h-12 w-12 flex items-center justify-center rounded-lg text-rose-600 transition-colors hover:bg-rose-100"
                      title="Hapus Foto Ini"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={uploadingProofPhoto}
                    onClick={() => activityProofInputRef.current?.click()}
                    className="h-12 w-full gap-2 rounded-xl border-dashed border-slate-300 bg-slate-50/60 text-base font-bold text-slate-700 hover:bg-slate-100"
                  >
                    {uploadingProofPhoto ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                    <span>{uploadingProofPhoto ? 'Mengunggah Foto...' : 'Upload Foto'}</span>
                  </Button>
                )}
              </div>
            )}

            {/* Submit */}
            <div className="flex gap-3 pt-2">
              <Button
                type="button"
                variant="ghost"
                disabled={submitting || uploadingProofPhoto}
                onClick={resetForm}
                className="min-h-12 flex-1 rounded-xl text-base font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Batal
              </Button>
              <Button
                type="submit"
                disabled={submitting || uploadingProofPhoto || tripEndsBeforeItStarts || (isSopir && (calculatedDistanceKm <= 0 || JSON.stringify(formPoints) !== JSON.stringify(routeCalculatedPoints)))}
                className="min-h-12 flex-1 rounded-xl bg-gradient-to-r from-teal-500 to-cyan-600 text-base text-white font-bold shadow-md shadow-teal-200 hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <Send className="w-4 h-4 mr-2" />
                )}
                {editingActivity ? 'Ajukan Ulang' : 'Laporkan'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
