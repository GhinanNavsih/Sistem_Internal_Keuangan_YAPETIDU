"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  CalendarCheck,
  CalendarDays,
  Clock,
  Loader2,
  MapPin,
  Package,
  Plus,
  RefreshCw,
  UserRound,
  ZoomIn,
} from 'lucide-react';
import SatkerPekaryaNavBar from '@/components/SatkerPekaryaNavBar';
import VenueReservationDialog from '@/components/venue/VenueReservationDialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FloatingSnackbar, type SnackbarMessage } from '@/components/ui/floating-snackbar';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/AuthContext';
import { authenticatedJson } from '@/lib/payroll/client';
import { canReserveVenues } from '@/lib/payroll/roles';
import {
  isActivePhase,
  jamRange,
  MAX_CANCEL_REASON_LENGTH,
  RESERVATION_PHASE_LABELS,
  resolveVenuePhoto,
  type ReservationAction,
  type ReservationPhase,
  type ReservationView,
  type VenuePhotos,
} from '@/lib/venueReservation';
import { formatReservationDate } from '@/lib/venueReservationForm';

interface ListResponse {
  reservations: ReservationView[];
  viewerRole: string;
}

type Tab = 'aktif' | 'riwayat';

const PHASE_TONES: Record<ReservationPhase, string> = {
  menunggu: 'bg-amber-50 text-amber-700 border-amber-200',
  terjadwal: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  diserahkan: 'bg-teal-50 text-teal-700 border-teal-200',
  diterima: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  menunggu_checkin: 'bg-sky-50 text-sky-700 border-sky-200',
  selesai: 'bg-slate-100 text-slate-600 border-slate-200',
  dibatalkan: 'bg-slate-100 text-slate-500 border-slate-200',
  ditolak: 'bg-rose-50 text-rose-700 border-rose-200',
};

/** What happens next, in the words a Kepala SatKer needs. */
function phaseHint(reservation: ReservationView): string | null {
  if (!reservation.isOwner) {
    switch (reservation.phase) {
      case 'menunggu':
        return 'Menunggu keputusan Biro Umum di SIMPEL.';
      case 'terjadwal':
        return reservation.handoverStarted
          ? 'Pekarya sedang menyerahkan fasilitas di lokasi.'
          : 'Terjadwal di kalender kampus. Pekarya akan menyiapkan fasilitas di lokasi.';
      case 'diserahkan':
        return 'Fasilitas sudah diserahkan oleh Pekarya kepada pemohon.';
      case 'diterima':
        return 'Fasilitas sedang digunakan untuk kegiatan.';
      case 'menunggu_checkin':
        return 'Kegiatan telah selesai. Menunggu Pekarya memeriksa dan menerima kembali fasilitas.';
      default:
        return null;
    }
  }

  switch (reservation.phase) {
    case 'menunggu':
      return 'Menunggu keputusan Biro Umum di SIMPEL.';
    case 'terjadwal':
      return reservation.handoverStarted
        ? 'Pekarya sedang menyerahkan fasilitas di lokasi.'
        : 'Pekarya akan menyerahkan kunci dan peralatan di lokasi pada hari kegiatan.';
    case 'diserahkan':
      return 'Fasilitas sudah diserahkan Pekarya. Konfirmasi setelah Anda menerimanya.';
    case 'diterima':
      return 'Setelah kegiatan selesai, laporkan agar Pekarya memeriksa dan menerima kembali fasilitas.';
    case 'menunggu_checkin':
      return 'Menunggu Pekarya memeriksa dan menerima kembali fasilitas.';
    default:
      return null;
  }
}

const ACTION_COPY: Record<ReservationAction, { button: string; title: string; description: string; confirm: string }> = {
  cancel: {
    button: 'Batalkan',
    title: 'Batalkan reservasi?',
    description: 'Ruangan kembali tersedia untuk orang lain, dan Pekarya serta Biro Umum diberi tahu.',
    confirm: 'Batalkan Reservasi',
  },
  'confirm-receipt': {
    button: 'Konfirmasi Terima Fasilitas',
    title: 'Konfirmasi fasilitas diterima?',
    description: 'Pastikan kunci ruangan dan seluruh peralatan sudah Anda terima dari Pekarya di lokasi.',
    confirm: 'Ya, Sudah Diterima',
  },
  'ready-return': {
    button: 'Selesai Acara & Kembalikan',
    title: 'Kegiatan sudah selesai?',
    description: 'Pekarya akan diberi tahu untuk memeriksa ruangan dan menerima kembali peralatan.',
    confirm: 'Ya, Siap Dikembalikan',
  },
};

function byDateAndTime(left: ReservationView, right: ReservationView): number {
  return left.waktu.localeCompare(right.waktu) || jamRange(left.jam).start - jamRange(right.jam).start;
}

function ReservationsContent() {
  const { profile: realProfile, activeProfile } = useAuth();
  const profile = activeProfile || realProfile;
  const isLoyalisHead = profile?.role === 'satker_head_loyalis';

  const [reservations, setReservations] = useState<ReservationView[]>([]);
  const [viewerIsSuperAdmin, setViewerIsSuperAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('aktif');
  const [message, setMessage] = useState<SnackbarMessage | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [pendingAction, setPendingAction] = useState<{ reservation: ReservationView; action: ReservationAction } | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelGroup, setCancelGroup] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);

  // Cover photos of buildings and rooms for reservation cards and the dialog
  const [photos, setPhotos] = useState<VenuePhotos | null>(null);
  const [photosLoading, setPhotosLoading] = useState(true);
  const [previewImage, setPreviewImage] = useState<{ url: string; title: string } | null>(null);

  const loadReservations = useCallback(async () => {
    try {
      const result = await authenticatedJson<ListResponse>('/api/venue-reservations');
      setReservations(result.reservations || []);
      setViewerIsSuperAdmin(result.viewerRole === 'super_admin');
      setLoadError(null);
    } catch (error) {
      console.error('Error loading venue reservations:', error);
      setLoadError(error instanceof Error ? error.message : 'Gagal memuat reservasi.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadPhotos = useCallback(async () => {
    try {
      const result = await authenticatedJson<VenuePhotos>('/api/venue-reservations/photos');
      setPhotos(result);
    } catch {
      // Visual nicety; card falls back to clean placeholder if fetch fails.
    } finally {
      setPhotosLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadReservations();
      void loadPhotos();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadReservations, loadPhotos]);

  const refresh = () => {
    setRefreshing(true);
    void loadReservations();
    void loadPhotos();
  };

  const [activeScope, setActiveScope] = useState<'all' | 'mine'>('all');

  const { active, history } = useMemo(() => {
    const activeList = reservations.filter((reservation) => isActivePhase(reservation.phase)).sort(byDateAndTime);
    const historyList = reservations
      .filter((reservation) => !isActivePhase(reservation.phase))
      .sort((left, right) => byDateAndTime(right, left));
    return { active: activeList, history: historyList };
  }, [reservations]);

  const myActiveCount = useMemo(
    () => active.filter((reservation) => reservation.isOwner).length,
    [active],
  );

  const shown = useMemo(() => {
    if (tab === 'riwayat') return history;
    if (activeScope === 'mine') return active.filter((reservation) => reservation.isOwner);
    return active;
  }, [tab, activeScope, active, history]);

  const openForm = () => {
    setFormKey((key) => key + 1);
    setFormOpen(true);
  };

  const handleCreated = (reservation: ReservationView) => {
    setFormOpen(false);
    setTab('aktif');
    const label = reservation.groupTotal && reservation.groupTotal > 1
      ? `${reservation.groupTotal} hari kegiatan (${reservation.kegiatan})`
      : reservation.id;
    setMessage({
      type: 'success',
      text: `Reservasi ${label} terjadwal. Pekarya akan menyiapkan serah terima di ${reservation.ruangan}.`,
    });
    void loadReservations();
  };

  const openAction = (reservation: ReservationView, action: ReservationAction) => {
    setCancelReason('');
    setCancelGroup(false);
    setPendingAction({ reservation, action });
  };

  const confirmAction = async () => {
    if (!pendingAction) return;
    const { reservation, action } = pendingAction;
    setActionBusy(true);
    try {
      await authenticatedJson<{ reservation: ReservationView }>('/api/venue-reservations', {
        method: 'POST',
        body: JSON.stringify({
          action,
          bookingId: reservation.id,
          ...(action === 'cancel' && cancelReason.trim() ? { reason: cancelReason.trim() } : {}),
          ...(action === 'cancel' && cancelGroup ? { cancelGroup: true } : {}),
        }),
      });
      setMessage({
        type: 'success',
        text:
          action === 'cancel'
            ? cancelGroup
              ? `Seluruh rangkaian reservasi (${reservation.kegiatan}) berhasil dibatalkan.`
              : `Reservasi ${reservation.id} (${formatReservationDate(reservation.waktu)}) dibatalkan.`
            : action === 'confirm-receipt'
              ? 'Penerimaan fasilitas sudah dikonfirmasi ke Pekarya.'
              : 'Pekarya sudah diberi tahu untuk melakukan check-in pengembalian.',
      });
      setPendingAction(null);
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Gagal memperbarui reservasi.' });
      setPendingAction(null);
    } finally {
      setActionBusy(false);
      void loadReservations();
    }
  };

  if (!canReserveVenues(profile?.role)) {
    return (
      <div className="mx-auto mt-16 max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
        Halaman Reservasi Ruang hanya tersedia untuk Kepala SatKer Loyalis dan Super Admin.
      </div>
    );
  }

  const tabClass = (value: Tab) =>
    `rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all cursor-pointer ${
      tab === value ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'
    }`;

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-gradient-to-br from-slate-50 via-indigo-50/80 to-slate-100 font-sans text-slate-800">
      <div className="pointer-events-none absolute right-0 top-0 hidden h-[600px] w-[600px] rounded-full bg-indigo-100/40 blur-[120px] sm:block" />

      {/* Kepala SatKer have no sidebar; their top bar is their navigation. */}
      {isLoyalisHead && (
        <Suspense fallback={null}>
          <SatkerPekaryaNavBar />
        </Suspense>
      )}

      <div className="relative z-10 mx-auto w-full max-w-5xl space-y-5 px-3 py-4 sm:space-y-6 sm:p-6 lg:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 shadow-inner sm:h-11 sm:w-11 sm:rounded-2xl">
              <CalendarCheck className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl lg:text-3xl">Reservasi Ruang</h1>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500 sm:text-sm">
                Pesan ruangan dan peralatan kampus untuk kegiatan. Bila ruangan dan peralatan tersedia pada jam
                tersebut, reservasi langsung terjadwal di SIMPEL UNIPDU dan Pekarya menyiapkan serah terima.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={refresh}
              disabled={loading || refreshing}
              className="rounded-xl"
              title="Muat ulang status dari SIMPEL"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Muat Ulang</span>
            </Button>
            <Button
              type="button"
              onClick={openForm}
              disabled={!!loadError}
              className="rounded-xl bg-indigo-600 text-white hover:bg-indigo-700"
            >
              <Plus className="h-4 w-4" />
              Reservasi Baru
            </Button>
          </div>
        </div>

        {loadError && (
          <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="space-y-1">
              <p className="font-semibold">{loadError}</p>
              {profile?.role === 'super_admin' && (
                <p className="text-xs text-rose-600">
                  Tambahkan kunci akun layanan SIMPEL (file simpel-service-account.json di server, atau variabel
                  SIMPEL_SERVICE_ACCOUNT), lalu mulai ulang server.
                </p>
              )}
            </div>
          </div>
        )}

        {!loadError && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex gap-1 rounded-xl border border-slate-200/60 bg-slate-100/90 p-1">
                <button type="button" onClick={() => setTab('aktif')} className={tabClass('aktif')}>
                  Aktif ({active.length})
                </button>
                <button type="button" onClick={() => setTab('riwayat')} className={tabClass('riwayat')}>
                  Riwayat ({history.length})
                </button>
              </div>

              {tab === 'aktif' && active.length > 0 && (
                <div className="flex items-center gap-1 rounded-xl border border-slate-200/60 bg-slate-100/80 p-1">
                  <button
                    type="button"
                    onClick={() => setActiveScope('all')}
                    className={`rounded-lg px-3 py-1 text-xs font-semibold transition-all cursor-pointer ${
                      activeScope === 'all'
                        ? 'bg-white text-indigo-700 shadow-sm font-bold'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    Semua ({active.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveScope('mine')}
                    className={`rounded-lg px-3 py-1 text-xs font-semibold transition-all cursor-pointer ${
                      activeScope === 'mine'
                        ? 'bg-white text-indigo-700 shadow-sm font-bold'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    Milik Saya ({myActiveCount})
                  </button>
                </div>
              )}
            </div>

            {loading ? (
              <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white p-10 text-sm text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" /> Memuat reservasi...
              </div>
            ) : shown.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 p-10 text-center text-sm text-slate-500">
                {tab === 'aktif'
                  ? activeScope === 'mine' && active.length > 0
                    ? 'Anda belum memiliki reservasi aktif. Beralih ke "Semua" untuk melihat reservasi dari peminjam lain.'
                    : 'Belum ada reservasi aktif di kampus saat ini. Klik "Reservasi Baru" untuk memesan ruangan.'
                  : 'Belum ada riwayat reservasi.'}
              </div>
            ) : (
              <ul className="space-y-3">
                {shown.map((reservation) => {
                  const hint = phaseHint(reservation);
                  const venuePhoto = resolveVenuePhoto(photos, reservation.gedung, reservation.ruangan);
                  const venueTitle = `${reservation.gedung} · ${reservation.ruangan}`;

                  return (
                    <li
                      key={reservation.id}
                      className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm transition-all hover:shadow-md sm:p-5"
                    >
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                        {/* Venue Image Thumbnail */}
                        <div className="group/img relative aspect-[16/10] w-full shrink-0 overflow-hidden rounded-xl border border-slate-200/80 bg-slate-100 sm:w-44 md:w-48 sm:aspect-[4/3]">
                          {venuePhoto ? (
                            <>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={venuePhoto}
                                alt={venueTitle}
                                decoding="async"
                                draggable={false}
                                className="h-full w-full object-cover transition-transform duration-300 group-hover/img:scale-105"
                              />
                              <button
                                type="button"
                                onClick={() => setPreviewImage({ url: venuePhoto, title: venueTitle })}
                                className="absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 transition-opacity duration-200 group-hover/img:opacity-100 focus-visible:opacity-100 cursor-zoom-in"
                                title="Lihat foto ruangan"
                              >
                                <span className="inline-flex items-center gap-1.5 rounded-lg bg-black/60 px-2.5 py-1 text-xs font-medium text-white shadow backdrop-blur-sm">
                                  <ZoomIn className="h-3.5 w-3.5" />
                                  Perbesar
                                </span>
                              </button>
                            </>
                          ) : photosLoading ? (
                            <div className="flex h-full w-full items-center justify-center bg-slate-100 animate-pulse">
                              <Building2 className="h-7 w-7 text-slate-300" />
                            </div>
                          ) : (
                            <div className="flex h-full w-full flex-col items-center justify-center bg-slate-50/80 p-3 text-slate-300">
                              <Building2 className="h-7 w-7 stroke-[1.5]" />
                              <span className="mt-1.5 line-clamp-1 text-center text-[10px] font-medium text-slate-400">
                                {reservation.ruangan || reservation.gedung}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Content details and actions */}
                        <div className="flex min-w-0 flex-1 flex-col justify-between gap-3 sm:flex-row sm:items-start">
                          <div className="min-w-0 space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <h2 className="text-sm font-bold text-slate-900 sm:text-base">{reservation.kegiatan}</h2>
                              <span
                                className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${PHASE_TONES[reservation.phase]}`}
                              >
                                {RESERVATION_PHASE_LABELS[reservation.phase]}
                              </span>
                              {Boolean(reservation.groupTotal && reservation.groupTotal > 1) && (
                                <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
                                  Hari {reservation.groupIndex || 1} dari {reservation.groupTotal}
                                </span>
                              )}
                              {reservation.isOwner ? (
                                <span className="rounded-full border border-indigo-200 bg-indigo-50/90 px-2 py-0.5 text-[10px] font-bold text-indigo-700">
                                  Milik Saya
                                </span>
                              ) : (
                                <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                                  Peminjam Lain
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                              <span className="inline-flex items-center gap-1.5">
                                <CalendarDays className="h-3.5 w-3.5 text-slate-400" />
                                {formatReservationDate(reservation.waktu)}
                              </span>
                              <span className="inline-flex items-center gap-1.5">
                                <Clock className="h-3.5 w-3.5 text-slate-400" />
                                {reservation.jam} WIB
                              </span>
                              <span className="inline-flex items-center gap-1.5">
                                <MapPin className="h-3.5 w-3.5 text-slate-400" />
                                {reservation.gedung} · {reservation.ruangan}
                              </span>
                            </div>
                            {reservation.fasilitasTambahan.length > 0 && (
                              <div className="flex flex-wrap items-center gap-1.5">
                                <Package className="h-3.5 w-3.5 text-slate-400" />
                                {reservation.fasilitasTambahan.map((line) => (
                                  <span
                                    key={line}
                                    className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-600"
                                  >
                                    {line}
                                  </span>
                                ))}
                              </div>
                            )}
                            <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
                              <span className="font-semibold text-slate-700">
                                {reservation.isOwner ? `Pemohon: ${reservation.pemohon} (Saya)` : `Pemohon: ${reservation.pemohon}`}
                              </span>
                              {reservation.kontak && (
                                <>
                                  <span>·</span>
                                  <span>{reservation.kontak}</span>
                                </>
                              )}
                              {reservation.ownerName && reservation.ownerName !== reservation.pemohon && (
                                <span className="inline-flex items-center gap-1 text-slate-500">
                                  · <UserRound className="h-3 w-3" /> PIC SAKU: {reservation.ownerName}
                                </span>
                              )}
                            </p>
                            {hint && <p className="text-xs text-slate-500">{hint}</p>}
                            {reservation.alasanPenolakan && (
                              <p className="text-xs italic text-rose-600">&ldquo;{reservation.alasanPenolakan}&rdquo;</p>
                            )}
                          </div>
                          {reservation.allowedActions.length > 0 && (
                            <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col sm:items-end">
                              {reservation.allowedActions.map((action) => (
                                <Button
                                  key={action}
                                  type="button"
                                  size="sm"
                                  variant={action === 'cancel' ? 'outline' : 'default'}
                                  onClick={() => openAction(reservation, action)}
                                  className={`rounded-lg ${
                                    action === 'cancel'
                                      ? 'border-rose-200 text-rose-600 hover:bg-rose-50'
                                      : action === 'confirm-receipt'
                                        ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                                        : 'bg-sky-600 text-white hover:bg-sky-700'
                                  }`}
                                >
                                  {ACTION_COPY[action].button}
                                </Button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>

      <VenueReservationDialog
        key={formKey}
        open={formOpen}
        onOpenChange={setFormOpen}
        uid={profile?.uid || ''}
        defaultPemohon={profile?.displayName || ''}
        onCreated={handleCreated}
        onRestart={() => setFormKey((key) => key + 1)}
        initialPhotos={photos}
      />

      <Dialog open={pendingAction !== null} onOpenChange={(open) => { if (!open && !actionBusy) setPendingAction(null); }}>
        <DialogContent className="sm:max-w-md w-[95vw] p-6 rounded-2xl border-none shadow-2xl bg-white">
          {pendingAction && (
            <>
              <DialogHeader>
                <DialogTitle className="text-base font-bold text-slate-900">
                  {ACTION_COPY[pendingAction.action].title}
                </DialogTitle>
                <DialogDescription className="text-xs leading-relaxed text-slate-500">
                  {pendingAction.reservation.kegiatan} · {formatReservationDate(pendingAction.reservation.waktu)},{' '}
                  {pendingAction.reservation.jam} WIB · {pendingAction.reservation.ruangan}.{' '}
                  {ACTION_COPY[pendingAction.action].description}
                </DialogDescription>
              </DialogHeader>
              {pendingAction.action === 'cancel' && (
                <div className="space-y-3">
                  {Boolean(pendingAction.reservation.groupTotal && pendingAction.reservation.groupTotal > 1) && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-950 space-y-2">
                      <p className="font-semibold text-amber-900">Cakupan Pembatalan Rangkaian Kegiatan</p>
                      <div className="space-y-1.5">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="cancel-scope"
                            checked={!cancelGroup}
                            onChange={() => setCancelGroup(false)}
                            className="text-rose-600 focus:ring-rose-500"
                          />
                          <span>
                            Hanya hari ini ({formatReservationDate(pendingAction.reservation.waktu)})
                          </span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="cancel-scope"
                            checked={cancelGroup}
                            onChange={() => setCancelGroup(true)}
                            className="text-rose-600 focus:ring-rose-500"
                          />
                          <span>
                            Seluruh rangkaian kegiatan ({pendingAction.reservation.groupTotal} hari)
                          </span>
                        </label>
                      </div>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label htmlFor="alasan-batal" className="text-[11px] font-bold text-slate-500 uppercase">
                      Alasan (opsional)
                    </Label>
                    <textarea
                      id="alasan-batal"
                      rows={3}
                      maxLength={MAX_CANCEL_REASON_LENGTH}
                      value={cancelReason}
                      onChange={(event) => setCancelReason(event.target.value)}
                      placeholder="Misal: kegiatan diundur ke pekan depan"
                      className="w-full rounded-xl border border-slate-200 p-3 text-xs focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                </div>
              )}
              <DialogFooter className="gap-2 sm:gap-0">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPendingAction(null)}
                  disabled={actionBusy}
                  className="rounded-xl"
                >
                  Batal
                </Button>
                <Button
                  type="button"
                  onClick={confirmAction}
                  disabled={actionBusy}
                  className={`rounded-xl text-white ${
                    pendingAction.action === 'cancel' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-indigo-600 hover:bg-indigo-700'
                  }`}
                >
                  {actionBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                  {pendingAction.action === 'cancel'
                    ? cancelGroup
                      ? 'Batalkan Seluruh Rangkaian'
                      : pendingAction.reservation.groupTotal && pendingAction.reservation.groupTotal > 1
                        ? 'Batalkan Hari Ini Saja'
                        : ACTION_COPY[pendingAction.action].confirm
                    : ACTION_COPY[pendingAction.action].confirm}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Image Preview Lightbox */}
      <Dialog open={previewImage !== null} onOpenChange={(open) => { if (!open) setPreviewImage(null); }}>
        <DialogContent className="max-w-2xl w-[95vw] p-4 sm:p-6 rounded-2xl border-none shadow-2xl bg-white">
          {previewImage && (
            <div className="space-y-3">
              <DialogHeader>
                <DialogTitle className="text-base font-bold text-slate-900">
                  {previewImage.title}
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-500">
                  Foto fasilitas dan ruangan dari SIMPEL UNIPDU
                </DialogDescription>
              </DialogHeader>
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewImage.url}
                  alt={previewImage.title}
                  className="max-h-[70vh] w-full object-contain"
                />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <FloatingSnackbar message={message} onDismiss={() => setMessage(null)} />
    </div>
  );
}

export default function ReservasiRuangPage() {
  return <ReservationsContent />;
}
