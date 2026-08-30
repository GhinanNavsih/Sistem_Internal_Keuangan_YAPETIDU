"use client";

import {
  Card,
  CardContent,
} from '@/components/ui/card';
import {
  Button,
} from '@/components/ui/button';
import {
  Badge,
} from '@/components/ui/badge';
import {
  Loader2,
  ClipboardList,
  Pencil,
  Banknote,
  ChevronDown,
  ChevronUp,
  Camera,
  PackageSearch,
} from 'lucide-react';
import {
  calculateSopirDefaultFee,
  fmtRp,
  calculateDefaultFee,
  getActivityFeeBreakdown,
  getStatusConfig,
} from './activityModel';
import type { EmployeeActivitiesModel } from './activityModel';

interface ActivityHistoryPanelProps {
  model: EmployeeActivitiesModel;
}

export default function ActivityHistoryPanel({ model }: ActivityHistoryPanelProps) {
  const {
    userJobCategory,
    isSopir,
    activities,
    loading,
    setStatusFilter,
    statusFilter,
    expandedId,
    setExpandedId,
    filteredActivities,
    stats,
    openEditForm,
  } = model;

  return (
    <>
{isSopir ? null : (
          <>
            {/* ── Stats Summary ────────────────────────────────────────────── */}
            <div className="grid grid-cols-2 gap-3">
              <Card className="bg-white rounded-2xl shadow-sm border-none">
                <CardContent className="p-4 text-center">
                  <div className="text-2xl font-extrabold text-teal-600">{stats.approved + stats.pending + stats.declined}</div>
                  <div className="text-[11px] font-semibold text-slate-400 mt-0.5">Total Kegiatan</div>
                </CardContent>
              </Card>
              <Card className="bg-gradient-to-br from-teal-500 to-cyan-600 rounded-2xl shadow-lg shadow-teal-200/40 border-none">
                <CardContent className="p-4 text-center">
                  <div className="text-2xl font-extrabold text-white">{fmtRp(stats.totalApprovedFee)}</div>
                  <div className="text-[11px] font-semibold text-teal-100 mt-0.5">
                    {userJobCategory === 'SATPAM' ? 'Total Pekerjaan Disetujui' : 'Total SPJ Disetujui'}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* ── Mini Stats Row ──────────────────────────────────────────── */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setStatusFilter('all')}
                className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all ${statusFilter === 'all'
                  ? 'bg-slate-800 text-white shadow-md'
                  : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'
                  }`}
              >
                Semua ({activities.length})
              </button>
              <button
                onClick={() => setStatusFilter('pending')}
                className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all ${statusFilter === 'pending'
                  ? 'bg-amber-500 text-white shadow-md'
                  : 'bg-white text-amber-600 border border-amber-200 hover:bg-amber-50'
                  }`}
              >
                Menunggu ({stats.pending})
              </button>
              <button
                onClick={() => setStatusFilter('approved')}
                className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all ${statusFilter === 'approved'
                  ? 'bg-emerald-500 text-white shadow-md'
                  : 'bg-white text-emerald-600 border border-emerald-200 hover:bg-emerald-50'
                  }`}
              >
                Disetujui ({stats.approved})
              </button>
              <button
                onClick={() => setStatusFilter('declined')}
                className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all ${statusFilter === 'declined'
                  ? 'bg-rose-500 text-white shadow-md'
                  : 'bg-white text-rose-600 border border-rose-200 hover:bg-rose-50'
                  }`}
              >
                Ditolak ({stats.declined})
              </button>
            </div>

            {/* ── Activity List ────────────────────────────────────────────── */}
            {loading ? (
              <div className="py-16 flex flex-col items-center text-slate-400">
                <Loader2 className="w-8 h-8 animate-spin text-teal-500 mb-3" />
                <span className="text-sm font-medium animate-pulse">Memuat kegiatan...</span>
              </div>
            ) : filteredActivities.length === 0 ? (
              <Card className="bg-white rounded-2xl shadow-sm border-none">
                <CardContent className="py-16 flex flex-col items-center text-center">
                  <div className="w-16 h-16 rounded-2xl bg-slate-50 flex items-center justify-center mb-4">
                    <ClipboardList className="w-8 h-8 text-slate-300" />
                  </div>
                  <h3 className="text-base font-bold text-slate-700">Belum Ada Kegiatan</h3>
                  <p className="text-xs text-slate-400 max-w-xs mt-1.5 leading-relaxed">
                    {statusFilter !== 'all'
                      ? `Tidak ada kegiatan berstatus "${getStatusConfig(statusFilter).label}" pada periode ini.`
                      : userJobCategory === 'SATPAM'
                        ? 'Gunakan tombol “Lapor SPJ Pribadi” di atas untuk menambahkan kegiatan.'
                        : 'Tekan tombol “Tambah Kegiatan” untuk membuat laporan baru.'
                    }
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2.5">
                {filteredActivities.map((activity) => {
                  const sc = getStatusConfig(activity.status);
                  const isExpanded = expandedId === activity.id;
                  const canEdit = activity.status === 'declined' || activity.status === 'pending';

                  return (
                    <Card
                      key={activity.id}
                      className={`bg-white rounded-2xl shadow-sm border-none overflow-hidden transition-all duration-200 ${isExpanded ? 'ring-2 ring-teal-200/60' : ''
                        }`}
                    >
                      <CardContent className="p-0">
                        {/* Main row — tap to expand */}
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : activity.id)}
                          className="w-full flex items-center gap-3 p-4 text-left hover:bg-slate-50/50 transition-colors"
                        >
                          {/* Status dot */}
                          <div className={`w-2.5 h-2.5 rounded-full ${sc.dotClass} shrink-0`} />

                          {/* Activity info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <div className="truncate text-sm font-bold text-slate-800">{activity.activityName}</div>
                              {activity.reportKind === 'satpam_found_item' && (
                                <Badge className="shrink-0 border-none bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                                  Penemuan Barang
                                </Badge>
                              )}
                              {activity.reportKind === 'satpam_reprimand' && (
                                <Badge className="shrink-0 border-none bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                                  Teguran Pengendara
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[11px] text-slate-400 font-medium">{activity.activityDate}</span>
                              <span className="text-[11px] text-slate-300">•</span>
                              <span className="text-[11px] text-slate-400 font-medium">
                                {activity.reportKind === 'satpam_found_item' || activity.reportKind === 'satpam_reprimand'
                                  ? `${activity.proofPhotos?.length || (activity.photoUrl ? 1 : 0)} foto`
                                  : activity.activityType === 'Buang Sampah' || activity.activityName === 'Buang Sampah'
                                  ? activity.timeStart
                                  : `${activity.timeStart} – ${activity.timeEnd}`}
                              </span>
                            </div>
                          </div>

                          {/* Status badge */}
                          <Badge className={`${sc.bgClass} ${sc.textClass} border ${sc.borderClass} text-[10px] font-bold rounded-lg px-2 py-0.5 shrink-0`}>
                            {sc.label}
                          </Badge>

                          {/* Chevron */}
                          {isExpanded
                            ? <ChevronUp className="w-4 h-4 text-slate-300 shrink-0" />
                            : <ChevronDown className="w-4 h-4 text-slate-300 shrink-0" />
                          }
                        </button>

                        {/* Expanded detail */}
                        {isExpanded && (
                          <div className="px-4 pb-4 pt-1 border-t border-slate-50 space-y-3 animate-in slide-in-from-top-2 duration-200">
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <span className="text-[10px] font-bold text-slate-400 uppercase">Tanggal</span>
                                <p className="text-sm font-semibold text-slate-700 mt-0.5">{activity.activityDate}</p>
                              </div>
                              <div>
                                <span className="text-[10px] font-bold text-slate-400 uppercase">
                                  {activity.reportKind === 'satpam_found_item' || activity.reportKind === 'satpam_reprimand' ? 'Bukti' : 'Waktu'}
                                </span>
                                <p className="text-sm font-semibold text-slate-700 mt-0.5">
                                  {activity.reportKind === 'satpam_found_item' || activity.reportKind === 'satpam_reprimand'
                                    ? `${activity.proofPhotos?.length || (activity.photoUrl ? 1 : 0)} foto`
                                    : activity.activityType === 'Buang Sampah' || activity.activityName === 'Buang Sampah'
                                    ? activity.timeStart
                                    : `${activity.timeStart} – ${activity.timeEnd}`}
                                </p>
                              </div>
                            </div>

                            {(activity.reportKind === 'satpam_found_item' || activity.reportKind === 'satpam_reprimand') && (
                              <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
                                <div className="flex items-center gap-2 text-sm font-bold text-amber-950">
                                  <PackageSearch className="h-4 w-4" />
                                  {activity.reportKind === 'satpam_reprimand' ? 'Foto Bukti Teguran' : 'Foto Barang Temuan'}
                                </div>
                                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                                  {(activity.proofPhotos?.length
                                    ? activity.proofPhotos
                                    : activity.photoUrl
                                      ? [{ url: activity.photoUrl }]
                                      : []
                                  ).map((photo, index) => (
                                    <div key={photo.url} className="aspect-square overflow-hidden rounded-xl bg-slate-100">
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img
                                        src={photo.url}
                                        alt={`Foto barang ${index + 1}`}
                                        className="h-full w-full object-cover"
                                      />
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Driver details section */}
                            {activity.jobCategory === 'SOPIR' && (
                              <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 space-y-1.5 text-xs text-slate-600">
                                {activity.points && activity.points.length > 0 && (
                                  <div className="space-y-0.5 pb-1.5 border-b border-slate-200/60">
                                    <span className="font-semibold text-slate-400 text-[10px] uppercase block tracking-wider">Rute Perjalanan:</span>
                                    <div className="font-bold text-slate-700 text-xs pl-0.5 leading-relaxed">
                                      {activity.points.join(' → ')}
                                    </div>
                                  </div>
                                )}
                                <div className="flex justify-between">
                                  <span className="font-semibold text-slate-400">Jenis Kendaraan:</span>
                                  <span className="font-bold text-slate-700">{activity.vehicleType || 'Mobil Kecil'}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="font-semibold text-slate-400">Tipe Perjalanan:</span>
                                  <span className="font-bold text-slate-700">{activity.tripType || 'Dalam Kota'}</span>
                                </div>
                                {activity.distanceKm && activity.distanceKm > 0 ? (
                                  <div className="flex justify-between">
                                    <span className="font-semibold text-slate-400">Jarak / Waktu Tempuh:</span>
                                    <span className="font-bold text-slate-700">{activity.distanceKm} km ({activity.durationHours || 0} jam)</span>
                                  </div>
                                ) : null}
                                <div className="flex justify-between">
                                  <span className="font-semibold text-slate-400">Jumlah Malam:</span>
                                  <span className="font-bold text-slate-700">{activity.nightCount || 0} malam</span>
                                </div>
                                {((activity.fuelFee && activity.fuelFee > 0) || (activity.tollParkingFee && activity.tollParkingFee > 0)) && (
                                  <div className="pt-1.5 border-t border-slate-200/60 mt-1.5 space-y-1">
                                    {activity.fuelFee && activity.fuelFee > 0 && (
                                      <div className="flex justify-between">
                                        <span className="font-semibold text-slate-400">Reimburse BBM:</span>
                                        <span className="font-bold text-slate-700">{fmtRp(activity.fuelFee)}</span>
                                      </div>
                                    )}
                                    {activity.tollParkingFee && activity.tollParkingFee > 0 && (
                                      <div className="flex justify-between">
                                        <span className="font-semibold text-slate-400">Reimburse Tol & Parkir:</span>
                                        <span className="font-bold text-slate-700">{fmtRp(activity.tollParkingFee)}</span>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Satpam details section */}
                            {activity.jobCategory === 'SATPAM' && (activity.shiftName || activity.shiftType || activity.postName || activity.ketuaShiftName) && (
                              <div className="p-3 rounded-xl bg-purple-50/50 border border-purple-100/60 space-y-1.5 text-xs text-purple-950">
                                <div className="flex justify-between">
                                  <span className="font-semibold text-slate-500">Nama Petugas:</span>
                                  <span className="font-bold text-slate-800">{activity.employeeName}</span>
                                </div>
                                {activity.shiftName && (
                                  <div className="flex justify-between">
                                    <span className="font-semibold text-slate-500">Nama Shift:</span>
                                    <span className="font-bold text-slate-800">Shift {activity.shiftName}</span>
                                  </div>
                                )}
                                {activity.shiftType && (
                                  <div className="flex justify-between">
                                    <span className="font-semibold text-slate-500">Kategori Shift:</span>
                                    <span className="font-bold text-slate-800">{activity.shiftType}</span>
                                  </div>
                                )}
                                {activity.postName && (
                                  <div className="flex justify-between">
                                    <span className="font-semibold text-slate-500">Lokasi Pos:</span>
                                    <span className="font-bold text-slate-800">{activity.postName}</span>
                                  </div>
                                )}
                                {activity.ketuaShiftName && (
                                  <div className="flex justify-between">
                                    <span className="font-semibold text-slate-500">Dilaporkan Oleh:</span>
                                    <span className="font-bold text-slate-800">{activity.ketuaShiftName}</span>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Post-guarding photo taken by the Ketua Shift while filing the shift report */}
                            {activity.jobCategory === 'SATPAM' &&
                              activity.reportKind === 'satpam_shift_assignment' &&
                              activity.photoUrl && (
                                <div className="space-y-2 rounded-xl border border-purple-100/60 bg-purple-50/50 p-3">
                                  <div className="flex items-center gap-2 text-sm font-bold text-purple-950">
                                    <Camera className="h-4 w-4" />
                                    Foto Bukti Penjagaan
                                  </div>
                                  <div className="overflow-hidden rounded-xl bg-slate-100">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                      src={activity.photoUrl}
                                      alt={`Foto bukti ${activity.postName || 'penjagaan pos'}`}
                                      className="max-h-64 w-full object-cover"
                                    />
                                  </div>
                                </div>
                              )}

                            {/* Proof photo attached to the general Pekarya SPJ submission */}
                            {['KEBERSIHAN', 'KEBERSIHAN_PONTI', 'PONTI', 'TEKNISI'].includes(activity.jobCategory) &&
                              activity.proofPhoto?.url && (
                                <div className="space-y-2 rounded-xl border border-teal-100 bg-teal-50/60 p-3">
                                  <div className="flex items-center gap-2 text-sm font-bold text-teal-900">
                                    <Camera className="h-4 w-4" />
                                    Foto Bukti Kegiatan
                                  </div>
                                  <div className="overflow-hidden rounded-xl bg-slate-100">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                      src={activity.proofPhoto.url}
                                      alt="Foto bukti kegiatan"
                                      className="max-h-64 w-full object-cover"
                                    />
                                  </div>
                                </div>
                              )}

                            {activity.status === 'approved' && activity.jobCategory === 'SATPAM' && (
                              <div className="flex flex-col gap-1 p-3 rounded-xl bg-emerald-50 border border-emerald-100">
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                  <div className="flex items-center gap-2">
                                    <Banknote className="w-4 h-4 text-emerald-600" />
                                    <span className="text-sm font-bold text-emerald-700">{fmtRp(activity.fee)}</span>
                                  </div>
                                  {activity.shiftType && (
                                    <span className="text-xs text-emerald-600/70 font-bold">
                                      ({activity.shiftType === 'Off-Duty' ? 'Hari Libur' : `Tarif Shift ${activity.shiftType}`})
                                    </span>
                                  )}
                                </div>
                              </div>
                            )}

                            {activity.status === 'approved' && activity.jobCategory !== 'SATPAM' && activity.fee > 0 && (
                              <div className="flex flex-col gap-1 p-3 rounded-xl bg-emerald-50 border border-emerald-100">
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                  <div className="flex items-center gap-2">
                                    <Banknote className="w-4 h-4 text-emerald-600" />
                                    <span className="text-sm font-bold text-emerald-700">{fmtRp(activity.fee)}</span>
                                  </div>
                                  {activity.jobCategory === 'SOPIR' ? (
                                    <span className="text-xs text-emerald-600/70 font-medium">
                                      (Termasuk Biaya SPJ & Reimburse)
                                    </span>
                                  ) : (
                                    (() => {
                                      const breakdown = getActivityFeeBreakdown(activity.timeStart, activity.timeEnd, activity.activityType, activity.activityName);
                                      return breakdown && (
                                        <span className="text-xs text-emerald-600/70 font-medium">
                                          ({breakdown}{activity.hasUangMakan ? ' + Rp7.500 Uang Makan' : ''})
                                        </span>
                                      );
                                    })()
                                  )}
                                  {activity.jobCategory !== 'SOPIR' && activity.hasUangMakan && (
                                    <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-none text-[10px] font-bold rounded-lg px-2 py-0.5">
                                      + Uang Makan
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            )}

                            {activity.status === 'pending' && (
                              activity.jobCategory === 'SATPAM' ? (
                                <div className="flex flex-col gap-1 p-3 rounded-xl bg-amber-50 border border-amber-200">
                                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                    <div className="flex items-center gap-2">
                                      <Banknote className="w-4 h-4 text-amber-600" />
                                      <span className="text-sm font-bold text-amber-700">
                                        {activity.reportKind === 'satpam_found_item' || activity.reportKind === 'satpam_reprimand'
                                          ? `Rekomendasi SPJ: ${fmtRp(activity.submittedFeeRecommendation || (activity.reportKind === 'satpam_reprimand' ? 15_000 : 5_000))}`
                                          : `Estimasi Upah: ${fmtRp(
                                              activity.reportKind === 'satpam_spj'
                                                ? (activity.submittedFeeEstimate && activity.submittedFeeEstimate > 0
                                                  ? activity.submittedFeeEstimate
                                                  : calculateDefaultFee(
                                                    activity.timeStart,
                                                    activity.timeEnd,
                                                    activity.activityType,
                                                    activity.activityName,
                                                  ))
                                                : activity.fee,
                                            )}`}
                                      </span>
                                    </div>
                                    {activity.shiftType ? (
                                      <span className="text-xs text-amber-600/70 font-medium">
                                        (Tarif Shift {activity.shiftType} - Menunggu Verifikasi)
                                      </span>
                                    ) : (
                                      <span className="text-xs text-amber-600/70 font-medium">
                                        (Menunggu Verifikasi)
                                      </span>
                                    )}
                                  </div>
                                </div>
                              ) : activity.jobCategory === 'SOPIR' ? (
                                (() => {
                                  const est = calculateSopirDefaultFee(
                                    activity.tripType,
                                    activity.vehicleType,
                                    activity.nightCount,
                                    activity.activityDate,
                                    activity.fuelFee,
                                    activity.tollParkingFee
                                  );
                                  return (
                                    <div className="flex flex-col gap-1 p-3 rounded-xl bg-amber-50 border border-amber-200">
                                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                        <div className="flex items-center gap-2">
                                          <Banknote className="w-4 h-4 text-amber-600" />
                                          <span className="text-sm font-bold text-amber-700">
                                            Estimasi SPJ: {fmtRp(est)}
                                          </span>
                                        </div>
                                        <span className="text-xs text-amber-600/70 font-medium">
                                          (Menunggu persetujuan SatKer)
                                        </span>
                                      </div>
                                    </div>
                                  );
                                })()
                              ) : (
                                (() => {
                                  const baseFee = calculateDefaultFee(activity.timeStart, activity.timeEnd, activity.activityType, activity.activityName);

                                  // Calculate if it qualifies for Uang Makan
                                  const [sh, sm] = activity.timeStart.split(':').map(Number);
                                  const [eh, em] = activity.timeEnd.split(':').map(Number);
                                  let minutes = (eh * 60 + em) - (sh * 60 + sm);
                                  if (minutes < 0) minutes += 24 * 60;
                                  const halfHours = Math.round(minutes / 30);
                                  const qualifies = halfHours > 4 && activity.activityType !== 'Buang Sampah' && activity.activityName !== 'Buang Sampah';

                                  const totalEstimated = qualifies ? baseFee + 7500 : baseFee;
                                  const breakdown = getActivityFeeBreakdown(activity.timeStart, activity.timeEnd, activity.activityType, activity.activityName);

                                  // Format breakdown with asterisk if qualifies
                                  const breakdownStr = breakdown
                                    ? (qualifies ? `(${breakdown} + *Rp7.500*)` : `(${breakdown})`)
                                    : '';

                                  return (
                                    <div className="flex flex-col gap-1 p-3 rounded-xl bg-amber-50 border border-amber-200">
                                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                        <div className="flex items-center gap-2">
                                          <Banknote className="w-4 h-4 text-amber-600" />
                                          <span className="text-sm font-bold text-amber-700">
                                            Estimasi Upah: {fmtRp(totalEstimated)}
                                          </span>
                                        </div>
                                        {breakdownStr && (
                                          <span className="text-xs text-amber-600/70 font-medium">
                                            {breakdownStr}
                                          </span>
                                        )}
                                      </div>
                                      {qualifies && (
                                        <span className="text-xs text-amber-600 font-medium ml-6">
                                          * Uang Makan jika disetujui oleh Kepala SatKer
                                        </span>
                                      )}
                                    </div>
                                  );
                                })()
                              )
                            )}

                            {activity.status === 'declined' && activity.declineReason && (
                              <div className="p-3 rounded-xl bg-rose-50 border border-rose-100">
                                <span className="text-[10px] font-bold text-rose-400 uppercase block mb-1">Alasan Penolakan</span>
                                <p className="text-sm text-rose-700 font-medium">{activity.declineReason}</p>
                              </div>
                            )}

                            {/* Edit / Re-submit action */}
                            {canEdit &&
                              activity.reportKind !== 'satpam_shift_assignment' &&
                              !activity.sourceOccurrenceId && (
                              <Button
                                onClick={() => openEditForm(activity)}
                                variant="outline"
                                size="sm"
                                className="w-full rounded-xl border-teal-200 text-teal-600 hover:bg-teal-50 font-bold text-xs"
                              >
                                <Pencil className="w-3.5 h-3.5 mr-1.5" />
                                {activity.status === 'declined' ? 'Edit & Ajukan Ulang' : 'Edit Kegiatan'}
                              </Button>
                            )}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </>
        )}
    </>
  );
}
