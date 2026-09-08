import { Calendar, ChevronLeft, Clock } from 'lucide-react';

/**
 * The correction form's captions, default copy, and layout never depend on
 * a fetch (the date/type fields start at fixed defaults), so the form is
 * rendered as real static markup. Only "Riwayat Koreksi" depends on the
 * per-employee request list, so that stays a pulsing placeholder.
 */
function HistoryCardSkeleton() {
  return (
    <div
      key="history-item-placeholder"
      className="space-y-3"
    >
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-slate-100 bg-slate-50/30 p-4 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="h-3.5 w-32 rounded-full bg-slate-200 animate-pulse" />
            <div className="h-4 w-20 rounded-full bg-slate-100 animate-pulse" />
          </div>
          <div className="h-3 w-40 rounded-full bg-slate-100 animate-pulse" />
          <div className="h-3 w-2/3 rounded-full bg-slate-100 animate-pulse" />
        </div>
      ))}
    </div>
  );
}

export function PresensiCorrectionPageSkeleton() {
  return (
    <div className="min-h-screen bg-slate-50/50 py-8 px-4 sm:px-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="rounded-xl flex items-center gap-1.5 text-slate-500 font-semibold">
            <ChevronLeft className="w-4 h-4" />
            Kembali ke Slip Gaji
          </div>
          <div className="text-right">
            <h1 className="text-lg font-extrabold text-slate-950 uppercase tracking-tight">Koreksi Presensi</h1>
            <p className="text-xs text-slate-400 font-medium">Pegawai Loyalis YAPETIDU</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Form card — always renders at fixed defaults, no fetch involved */}
          <div className="lg:col-span-5">
            <div className="bg-white rounded-3xl border-none shadow-[0_4px_25px_rgba(0,0,0,0.02)] p-6 space-y-6">
              <div>
                <div className="text-base font-extrabold text-slate-850 tracking-wide uppercase flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-indigo-500" />
                  Ajukan Koreksi
                </div>
                <p className="text-xs text-slate-450 mt-1">
                  Koreksi hanya diizinkan untuk periode bulan berjalan.
                </p>
              </div>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Tanggal Presensi</label>
                  <div className="rounded-xl border border-slate-200 bg-white h-11" />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Tipe Koreksi</label>
                  <div className="rounded-xl border border-slate-200 bg-white h-11 flex items-center px-3 text-sm font-semibold text-slate-700">
                    Izin Resmi (Hari Penuh)
                  </div>
                </div>

                <div className="flex items-center gap-2 p-3.5 rounded-2xl text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <Clock className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Izin Resmi akan otomatis dihitung sebagai hari penuh: <strong className="font-mono">07:30 — 14:00</strong></span>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Alasan / Keterangan</label>
                  <div className="w-full h-[4.5rem] rounded-xl border border-slate-200 bg-white" />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Bukti Kehadiran</label>
                  <div className="border-2 border-dashed border-slate-200 rounded-2xl p-4 flex flex-col items-center justify-center">
                    <span className="text-xs font-bold text-slate-650 text-center">
                      Klik atau seret file PDF / Foto di sini
                    </span>
                    <span className="text-[10px] text-slate-400 mt-1">Maks. 5MB (PDF, JPG, PNG)</span>
                  </div>
                </div>

                <div className="bg-indigo-600/90 text-white font-bold h-11 rounded-2xl flex items-center justify-center w-full">
                  Kirim Pengajuan
                </div>
              </div>
            </div>
          </div>

          {/* History card */}
          <div className="lg:col-span-7 space-y-6">
            <div className="bg-white rounded-3xl border-none shadow-[0_4px_25px_rgba(0,0,0,0.02)] p-6">
              <div className="mb-4">
                <div className="text-base font-extrabold text-slate-850 tracking-wide uppercase flex items-center gap-2">
                  <Clock className="w-5 h-5 text-indigo-500" />
                  Riwayat Koreksi
                </div>
                <p className="text-xs text-slate-450 mt-1">
                  Pengajuan koreksi presensi yang ditampilkan untuk akun Anda. Data yang dihapus tetap tersimpan untuk audit.
                </p>
              </div>
              <HistoryCardSkeleton />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export { HistoryCardSkeleton as PresensiCorrectionHistorySkeleton };
