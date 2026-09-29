import { Compass } from 'lucide-react';

/**
 * The top bar (title + "Riwayat") never depends on a fetch, so it renders as
 * real text. Everything below it is driven by the fetched journey
 * (`activeReportingJourney`) and its shape varies a lot (Ndalem vs other
 * vehicles, single vs multi-day, draft vs fresh claim, fuel procurement
 * mode), so rather than guess one of those shapes it's rendered as the
 * "closest common shape" of the real page: summary rows, then titled sections
 * of placeholder lines, then the fixed action bar.
 */
export function JourneyReportHeaderShell() {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
      <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4">
        <h1 className="text-base font-semibold text-slate-900">Laporan Perjalanan</h1>
        <div className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-slate-400">
          <Compass className="size-4" />
          <span className="hidden sm:inline">Riwayat</span>
        </div>
      </div>
    </header>
  );
}

function SectionSkeleton({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 border-t border-slate-200 py-5">
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

export function JourneyReportPageSkeleton() {
  return (
    <div className="min-h-screen bg-white pb-24 font-sans text-sm text-slate-700">
      <JourneyReportHeaderShell />

      <div className="mx-auto max-w-2xl px-4">
        {/* Trip summary — activity name, then vehicle / date / route rows */}
        <section className="space-y-3 py-5">
          <div className="h-5 w-2/3 animate-pulse rounded bg-slate-200" />
          <div className="divide-y divide-slate-100">
            {[0, 1, 2].map((row) => (
              <div key={row} className="flex items-center justify-between gap-4 py-2.5">
                <div className="h-3.5 w-20 animate-pulse rounded bg-slate-100" />
                <div className="h-3.5 w-32 animate-pulse rounded bg-slate-200" />
              </div>
            ))}
          </div>
        </section>

        <SectionSkeleton title="Rute">
          <div className="ml-1.5 space-y-5 border-l border-dashed border-slate-300 pl-5">
            {[0, 1, 2].map((stop) => (
              <div key={stop} className="space-y-1.5">
                <div className="h-3 w-16 animate-pulse rounded bg-slate-100" />
                <div className="h-4 w-1/2 animate-pulse rounded bg-slate-200" />
              </div>
            ))}
          </div>
        </SectionSkeleton>

        <SectionSkeleton title="Waktu">
          <div className="grid grid-cols-2 gap-3">
            <div className="h-10 animate-pulse rounded-lg bg-slate-100" />
            <div className="h-10 animate-pulse rounded-lg bg-slate-100" />
          </div>
        </SectionSkeleton>

        <SectionSkeleton title="Pengeluaran">
          <div className="h-10 w-full animate-pulse rounded-lg bg-slate-100" />
          <div className="h-10 w-full animate-pulse rounded-lg bg-slate-100" />
        </SectionSkeleton>
      </div>

      {/* Action bar — labels are fixed, the disabled state depends on the fetch */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-3">
          <div className="flex h-10 items-center rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-400">
            Simpan draft
          </div>
          <div className="flex h-10 flex-1 items-center justify-center rounded-lg bg-blue-200 px-4 text-sm font-medium text-white">
            Kirim laporan
          </div>
        </div>
      </div>
    </div>
  );
}
