import { ChevronLeft, LogOut, Menu, Wrench } from 'lucide-react';

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
          className="rounded-md border border-slate-200/80 shadow-sm bg-white p-4 flex items-start justify-between gap-3"
        >
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="h-3.5 w-40 rounded-sm bg-slate-200 animate-pulse" />
            <div className="h-2.5 w-56 rounded-sm bg-slate-100 animate-pulse" />
          </div>
          <div className="h-4 w-16 rounded-sm bg-slate-100 animate-pulse shrink-0" />
        </div>
      ))}
    </div>
  );
}

/**
 * The sticky header and static captions match the real page immediately.
 * The employee name stays a placeholder until the profile resolves; header
 * controls stay decorative until their role-specific actions are available.
 * The report list shares its shape with the in-page loading state.
 */
export function FacilityReportsPageSkeleton() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/70 to-slate-100 font-sans text-slate-800">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3 sm:px-6">
          <span className="rounded-sm p-2 text-slate-500" aria-hidden="true"><ChevronLeft className="size-5" /></span>
          <div className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-indigo-600 text-white"><Wrench className="size-5" /></div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-bold text-slate-800">Lapor Kondisi Fasilitas</h1>
            <div className="mt-1 h-3 w-28 max-w-full rounded-sm bg-slate-100 animate-pulse" />
          </div>
          <span className="flex size-9 shrink-0 items-center justify-center rounded-sm border border-slate-200 bg-white text-indigo-500 shadow-sm" aria-hidden="true"><Menu className="size-4.5" /></span>
          <span className="flex size-8 shrink-0 items-center justify-center rounded-sm" aria-hidden="true"><LogOut className="size-4" /></span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">
        <div className="flex flex-col gap-3">
          <p className="text-slate-500 text-xs sm:text-sm">
            Crew Reparasi: Biro Umum, Teknisi, Kebersihan, dan PusKom.
          </p>
          <div className="h-9 w-full rounded-sm bg-slate-200 animate-pulse" />
        </div>

        <div className="space-y-2.5">
          <h2 className="text-xs font-black text-slate-500 uppercase tracking-wider">
            Riwayat Laporan Semua Pegawai
          </h2>
          <FacilityReportRowsSkeleton />
        </div>
      </main>
    </div>
  );
}
