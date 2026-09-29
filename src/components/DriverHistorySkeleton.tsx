import { ArrowLeft } from 'lucide-react';

/**
 * Only the back arrow, title, and section captions below are fixed (same for
 * every Sopir, every period) — everything else (period value, SPJ/journey
 * rows, totals, tab counts) depends on data that hasn't resolved yet, so it
 * stays a pulsing placeholder rather than guessed content.
 */
export function DriverHistoryHeaderShell() {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
      <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4">
        <div className="flex items-center gap-1">
          <div className="flex size-8 items-center justify-center text-slate-400">
            <ArrowLeft className="size-4" />
          </div>
          <h1 className="text-base font-semibold text-slate-900">Riwayat perjalanan</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="size-8 animate-pulse rounded-lg bg-slate-100" />
          <div className="size-8 animate-pulse rounded-lg bg-slate-100" />
        </div>
      </div>
    </header>
  );
}

function JourneyRowSkeleton() {
  return (
    <li className="space-y-3 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="h-4 w-3/4 animate-pulse rounded bg-slate-200" />
          <div className="h-3.5 w-1/2 animate-pulse rounded bg-slate-100" />
          <div className="h-3.5 w-2/5 animate-pulse rounded bg-slate-100" />
        </div>
        <div className="h-4 w-16 animate-pulse rounded bg-slate-100" />
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="h-3.5 w-48 animate-pulse rounded bg-slate-100" />
        <div className="h-8 w-16 animate-pulse rounded-lg bg-slate-100" />
      </div>
    </li>
  );
}

export function DriverHistoryJourneyListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <ul className="divide-y divide-slate-100">
      {Array.from({ length: count }).map((_, i) => (
        <JourneyRowSkeleton key={i} />
      ))}
    </ul>
  );
}

export function DriverHistoryPageSkeleton() {
  return (
    <div className="min-h-screen bg-white pb-12 font-sans text-sm text-slate-700">
      <DriverHistoryHeaderShell />

      <div className="mx-auto max-w-2xl space-y-5 px-4 py-5">
        {/* Period — month/year values aren't known pre-mount */}
        <div className="flex items-center gap-2">
          <div className="h-10 w-40 animate-pulse rounded-lg bg-slate-100" />
          <div className="h-10 w-28 animate-pulse rounded-lg bg-slate-100" />
        </div>

        {/* Assigned SPJ history — mirrors the shared panel's fixed caption */}
        <div className="space-y-3">
          <div className="px-1">
            <h2 className="text-xs font-black uppercase tracking-wider text-slate-600">Riwayat SPJ Penugasan</h2>
          </div>
          <div className="h-16 animate-pulse rounded-2xl bg-slate-100" />
        </div>

        {/* Totals — labels are fixed, amounts aren't */}
        <dl className="grid grid-cols-2 divide-x divide-slate-200 border-y border-slate-200">
          <div className="py-4 pr-4">
            <dt className="text-xs text-slate-500">Upah bersih disetujui</dt>
            <dd className="mt-1.5 h-6 w-24 animate-pulse rounded bg-slate-200" />
          </div>
          <div className="py-4 pl-4">
            <dt className="text-xs text-slate-500">Total reimburse</dt>
            <dd className="mt-1.5 h-6 w-24 animate-pulse rounded bg-slate-200" />
          </div>
        </dl>

        {/* Status tabs — labels are fixed, counts aren't */}
        <div className="-mx-4 flex overflow-x-auto overflow-y-hidden border-b border-slate-200 px-4 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {['Semua', 'Menunggu', 'Disetujui', 'Ditolak'].map((label) => (
            <div key={label} className="shrink-0 px-2 py-2.5 text-[13px] text-slate-400">
              {label}
            </div>
          ))}
        </div>

        <DriverHistoryJourneyListSkeleton />
      </div>
    </div>
  );
}
