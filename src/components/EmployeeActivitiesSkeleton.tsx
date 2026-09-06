import { ClipboardList, CalendarDays } from 'lucide-react';

export function ActivitiesHeaderShell({ displayName }: { displayName?: string | null }) {
  return (
    <div className="sticky top-0 z-30 bg-white/80 backdrop-blur-xl border-b border-slate-100 shadow-sm relative z-20">
      <div className="max-w-2xl mx-auto px-4 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center shadow-lg shadow-teal-200/50">
            <ClipboardList className="w-4.5 h-4.5 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-slate-900 leading-tight">Laporan Kegiatan</h1>
            {displayName ? (
              <p className="text-[11px] text-slate-400 font-medium">{displayName}</p>
            ) : (
              <div className="h-2 w-20 mt-1 rounded-full bg-slate-200 animate-pulse" />
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <div className="h-9 w-9 rounded-xl bg-slate-100 animate-pulse" />
          <div className="h-9 w-9 rounded-xl bg-slate-100 animate-pulse" />
        </div>
      </div>
    </div>
  );
}

/**
 * The header chrome and the period-selector shell are the only pieces that
 * are the same regardless of which workflow (Satpam/Sopir/Pekarya) or
 * employee this resolves to. The actual activity cards below them (posts,
 * trip forms, SPJ entries, history) depend on fetched config that varies
 * per workflow, so — same call as the payslip skeleton — those stay generic
 * placeholders rather than guessed content that could mismatch on load.
 */
export function ActivitiesBodySkeleton() {
  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      <div className="bg-white rounded-2xl shadow-sm p-4">
        <div className="flex items-center gap-3">
          <CalendarDays className="w-4 h-4 text-teal-500 shrink-0" />
          <div className="flex items-center gap-2 flex-1">
            <div className="h-10 flex-1 rounded-xl bg-slate-100 animate-pulse" />
            <div className="h-10 w-24 rounded-xl bg-slate-100 animate-pulse" />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm p-5 space-y-4">
        <div className="h-4 w-40 rounded-full bg-slate-200 animate-pulse" />
        <div className="h-3 w-56 rounded-full bg-slate-100 animate-pulse" />
        <div className="space-y-2.5 pt-2">
          <div className="h-9 w-full rounded-xl bg-slate-100 animate-pulse" />
          <div className="h-9 w-full rounded-xl bg-slate-100 animate-pulse" />
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm p-5 space-y-3">
        <div className="h-4 w-32 rounded-full bg-slate-200 animate-pulse" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-14 w-full rounded-xl bg-slate-100 animate-pulse" />
        ))}
      </div>
    </div>
  );
}

export function ActivitiesPageSkeleton() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/80 to-slate-100 font-sans text-slate-800">
      <ActivitiesHeaderShell />
      <div className="max-w-2xl mx-auto px-4 py-5 relative z-10">
        <ActivitiesBodySkeleton />
      </div>
    </div>
  );
}
