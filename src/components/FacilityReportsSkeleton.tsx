import { ChevronLeft, Wrench } from 'lucide-react';

/**
 * A row shape matching the real report Card (place name + date/employee line
 * + status badge), used both for the pre-profile page skeleton below and for
 * the in-page `loading` state once reports are being fetched — the report
 * count and content are unknown either way, so both stay placeholders.
 */
export function FacilityReportRowsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="rounded-2xl border border-slate-200/80 shadow-sm bg-white p-4 flex items-start justify-between gap-3"
        >
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="h-3.5 w-40 rounded-full bg-slate-200 animate-pulse" />
            <div className="h-2.5 w-56 rounded-full bg-slate-100 animate-pulse" />
          </div>
          <div className="h-4 w-16 rounded-md bg-slate-100 animate-pulse shrink-0" />
        </div>
      ))}
    </div>
  );
}

/**
 * The back link, header icon/title/description, and "Riwayat Laporan Semua
 * Pegawai" caption are the same for every employee — they render as real
 * text immediately. The "Laporkan Kondisi" button is omitted rather than
 * placeholder-shown, since the real page only shows it once `showForm` is
 * known to be false, and the report list uses the same row shape as the
 * in-page loading state.
 */
export function FacilityReportsPageSkeleton() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/70 to-slate-100 font-sans text-slate-800">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">
        <div className="flex items-center gap-1.5 text-slate-600 font-bold text-xs">
          <ChevronLeft className="w-4 h-4" />
          Kembali
        </div>

        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600 shadow-inner shrink-0">
            <Wrench className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
              Lapor Kondisi Fasilitas
            </h1>
            <p className="text-slate-500 text-xs sm:text-sm">
              Laporkan fasilitas kampus yang rusak, kotor, tidak terawat, atau membutuhkan
              perbaikan agar segera ditangani Kepala Biro Umum.
            </p>
          </div>
        </div>

        <div className="space-y-2.5">
          <h2 className="text-xs font-black text-slate-500 uppercase tracking-wider">
            Riwayat Laporan Semua Pegawai
          </h2>
          <FacilityReportRowsSkeleton />
        </div>
      </div>
    </div>
  );
}
