import { ArrowLeft, CalendarDays } from 'lucide-react';

/**
 * Only the back-arrow, title, and section captions below are fixed (same for
 * every Sopir, every period) — everything else (display name, period value,
 * SPJ/journey rows, stats) depends on data that hasn't resolved yet, so it
 * stays a pulsing placeholder rather than guessed content.
 */
export function DriverHistoryHeaderShell({ displayName }: { displayName?: string | null }) {
  return (
    <div className="sticky top-0 z-30 bg-white/80 backdrop-blur-xl border-b border-slate-100 shadow-sm relative z-20">
      <div className="max-w-2xl mx-auto px-4 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-xl text-slate-400 h-8.5 w-8.5 flex items-center justify-center">
            <ArrowLeft className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-slate-900 leading-tight">Riwayat Perjalanan</h1>
            {displayName ? (
              <p className="text-[11px] text-slate-400 font-medium">{displayName}</p>
            ) : (
              <div className="h-2.5 w-16 mt-1 rounded-full bg-slate-200 animate-pulse" />
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <div className="h-8 w-8 rounded-xl bg-slate-100 animate-pulse" />
          <div className="h-9 w-9 rounded-xl bg-slate-100 animate-pulse" />
        </div>
      </div>
    </div>
  );
}

function JourneyCardSkeleton() {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 overflow-hidden p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="h-4 w-20 rounded-md bg-slate-100 animate-pulse" />
        <div className="h-4 w-16 rounded-md bg-slate-100 animate-pulse" />
      </div>
      <div className="space-y-2">
        <div className="h-3.5 w-3/4 rounded-full bg-slate-200 animate-pulse" />
        <div className="h-3 w-1/2 rounded-full bg-slate-100 animate-pulse" />
      </div>
      <div className="flex justify-between items-center pt-2.5 border-t border-slate-100">
        <div className="flex gap-4">
          <div className="h-6 w-16 rounded-full bg-slate-100 animate-pulse" />
          <div className="h-6 w-16 rounded-full bg-slate-100 animate-pulse" />
        </div>
        <div className="h-7 w-16 rounded-lg bg-slate-100 animate-pulse" />
      </div>
    </div>
  );
}

export function DriverHistoryJourneyListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: count }).map((_, i) => (
        <JourneyCardSkeleton key={i} />
      ))}
    </div>
  );
}

export function DriverHistoryPageSkeleton() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/80 to-slate-100 font-sans relative overflow-hidden text-slate-800 pb-12">
      <div className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full bg-indigo-100/40 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] rounded-full bg-purple-100/30 blur-[100px] pointer-events-none" />

      <DriverHistoryHeaderShell />

      <div className="max-w-2xl mx-auto px-4 py-5 space-y-5 relative z-10">
        {/* Period selector — icon is fixed, month/year values aren't known pre-mount */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4">
          <div className="flex items-center gap-3">
            <CalendarDays className="w-4 h-4 text-indigo-500 shrink-0" />
            <div className="flex items-center gap-2 flex-1">
              <div className="h-10 flex-1 rounded-xl bg-slate-50 border border-slate-200 animate-pulse" />
              <div className="h-10 w-24 rounded-xl bg-slate-50 border border-slate-200 animate-pulse" />
            </div>
          </div>
        </div>

        {/* Assigned SPJ history — section caption is fixed, panel content isn't */}
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <div>
              <h2 className="text-xs font-black uppercase tracking-wider text-slate-600">Riwayat SPJ Penugasan</h2>
              <p className="mt-0.5 text-[10px] font-medium text-slate-400">
                Penugasan yang disetujui dan otomatis masuk ke pendapatan SPJ Anda.
              </p>
            </div>
          </div>
          <div className="rounded-2xl border-none bg-white shadow-sm h-16 animate-pulse" />
        </div>

        {/* Stats summary — labels are fixed, amounts aren't */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 text-center">
            <div className="h-6 w-24 mx-auto rounded-full bg-slate-200 animate-pulse" />
            <div className="text-[11px] font-semibold text-slate-400 mt-1.5">Total Reimburse Didapatkan</div>
          </div>
          <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl shadow-lg shadow-indigo-200/40 border-none p-4 text-center">
            <div className="h-6 w-24 mx-auto rounded-full bg-white/30 animate-pulse" />
            <div className="text-[11px] font-semibold text-indigo-100 mt-1.5">Upah Bersih Disetujui</div>
          </div>
        </div>

        {/* Filter buttons — labels are fixed, counts aren't */}
        <div className="flex items-center gap-2">
          {['Semua', 'Menunggu', 'Disetujui', 'Ditolak'].map((label) => (
            <div
              key={label}
              className="flex-1 py-2 px-3 rounded-xl text-xs font-bold text-center bg-white text-slate-400 border border-slate-200"
            >
              {label}
            </div>
          ))}
        </div>

        <DriverHistoryJourneyListSkeleton />
      </div>
    </div>
  );
}
