import { CheckCircle2, Compass, Banknote, ClipboardList, Save, Send } from 'lucide-react';

/**
 * The top bar (title + "Riwayat"/"Slip Gaji" nav) never depends on a fetch,
 * so it renders as real text. Everything below it — trip summary, vehicle/
 * fuel-mode card, extra stops, receipts — is driven by the fetched journey
 * (`activeReportingJourney`) and its shape varies a lot (Ndalem vs other
 * vehicles, single vs multi-day, draft vs fresh claim, fuel procurement
 * mode), so rather than guess one of those shapes it's rendered as a
 * generic set of placeholder cards — the "closest common shape" trade-off
 * from the skeleton guide, not a literal trace of every branch.
 */
export function JourneyReportHeaderShell() {
  return (
    <div className="bg-gradient-to-r from-blue-600 to-blue-700 sticky top-0 z-30 shadow-md">
      <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-white font-extrabold text-base sm:text-lg">
          <CheckCircle2 className="w-5 h-5 text-white" />
          <span>Laporan Perjalanan</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded-xl border border-white/25 text-white font-bold text-xs h-8 px-2.5 flex items-center gap-1.5 bg-white/10">
            <Compass className="w-3.5 h-3.5 text-white" />
            <span className="hidden sm:inline">Riwayat</span>
          </div>
          <div className="rounded-xl border border-white/25 text-white font-bold text-xs h-8 px-2.5 flex items-center gap-1.5 bg-white/10">
            <Banknote className="w-3.5 h-3.5 text-emerald-300" />
            <span className="hidden sm:inline">Slip Gaji</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function JourneyReportPageSkeleton() {
  return (
    <div className="min-h-screen bg-slate-50 font-sans pb-24 text-slate-800 relative">
      <JourneyReportHeaderShell />

      <div className="max-w-2xl mx-auto px-4 py-5 space-y-4">
        {/* Trip Summary Card — icon+caption fixed, journey details aren't known yet */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4 space-y-3">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <ClipboardList className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <span className="block text-[9px] font-black uppercase tracking-wide text-slate-400">Keperluan</span>
              <div className="h-4 w-2/3 rounded-full bg-slate-200 animate-pulse" />
            </div>
          </div>
          <div className="h-3 w-4/5 rounded-full bg-slate-100 animate-pulse" />
          <div className="flex items-center gap-2 border-t border-slate-100 pt-3">
            <div className="h-7 flex-1 rounded-full bg-slate-100 animate-pulse" />
            <div className="h-7 flex-1 rounded-full bg-slate-100 animate-pulse" />
          </div>
        </div>

        {/* Form body — highly conditional on the fetched journey, so a
            generic placeholder stack rather than a guessed exact shape */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4 space-y-3">
          <div className="h-3.5 w-32 rounded-full bg-slate-200 animate-pulse" />
          <div className="h-10 w-full rounded-xl bg-slate-100 animate-pulse" />
          <div className="h-10 w-full rounded-xl bg-slate-100 animate-pulse" />
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4 space-y-3">
          <div className="h-3.5 w-40 rounded-full bg-slate-200 animate-pulse" />
          <div className="grid grid-cols-2 gap-3">
            <div className="h-10 rounded-xl bg-slate-100 animate-pulse" />
            <div className="h-10 rounded-xl bg-slate-100 animate-pulse" />
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4 space-y-3">
          <div className="h-3.5 w-28 rounded-full bg-slate-200 animate-pulse" />
          <div className="h-24 w-full rounded-xl bg-slate-100 animate-pulse" />
        </div>

        {/* Footer actions — labels are fixed, disabled state depends on the fetch */}
        <div className="pt-2 flex flex-col sm:flex-row gap-2">
          <div className="h-10 w-full sm:w-48 rounded-xl border border-rose-100 bg-rose-50/40" />
          <div className="flex gap-2 flex-1 justify-end">
            <div className="flex-1 sm:flex-initial rounded-xl border border-slate-200 text-slate-400 font-bold text-xs h-10 px-4 flex items-center justify-center gap-1.5">
              <Save className="w-4 h-4" />
              <span>Simpan Draft</span>
            </div>
            <div className="flex-1 sm:flex-initial rounded-xl bg-blue-300 text-white font-bold text-xs sm:text-sm h-10 px-5 flex items-center justify-center gap-1.5">
              <Send className="w-4 h-4" />
              <span>Ya, Kirim Laporan</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
