import { CalendarDays } from 'lucide-react';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * The header chrome, title, and the panel's own caption/description are
 * fixed copy (same for every Ketua Shift, every period) — the roster grid
 * itself depends on the team/employees/openPeriods fetch, so it stays a
 * pulsing placeholder.
 */
export function SatpamDutyPlanHeaderShell({ displayName }: { displayName?: string | null }) {
  return (
    <div className="sticky top-0 z-30 bg-white/80 backdrop-blur-xl border-b border-slate-100 shadow-sm">
      <div className="max-w-2xl mx-auto px-4 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-200/50">
            <CalendarDays className="w-4.5 h-4.5 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-slate-900 leading-tight">Jadwal Regu</h1>
            {displayName ? (
              <p className="text-[11px] text-slate-400 font-medium">{displayName}</p>
            ) : (
              <div className="h-2.5 w-20 mt-1 rounded-full bg-slate-200 animate-pulse" />
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <div className="h-9 w-9 rounded-xl bg-slate-100 animate-pulse" />
          <div className="h-9 w-9 rounded-xl bg-slate-100 animate-pulse" />
          <div className="h-9 w-9 rounded-xl bg-slate-100 animate-pulse" />
        </div>
      </div>
    </div>
  );
}

export function SatpamDutyPlanBodySkeleton() {
  return (
    <Card className="overflow-hidden rounded-2xl border-indigo-200 bg-white shadow-sm">
      <CardHeader className="border-b border-indigo-100 bg-indigo-50/70 p-5">
        <CardTitle className="flex items-center gap-2 text-xl">
          <CalendarDays className="h-6 w-6 text-indigo-700" />
          Jadwal Regu Satu Periode
        </CardTitle>
        <p className="text-base text-slate-600">
          Pilih Pos 9 Satpam Regu dan susunan awal. Sistem melanjutkan
          rotasi delapan hari untuk seluruh jendela payroll.
        </p>
      </CardHeader>
      <div className="space-y-5 p-4 sm:p-5">
        <div className="h-10 w-full max-w-xs rounded-xl bg-slate-100 animate-pulse" />
        <div className="space-y-2.5">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="h-11 w-full rounded-xl bg-slate-50 border border-slate-100 animate-pulse" />
          ))}
        </div>
      </div>
    </Card>
  );
}

export function SatpamDutyPlanPageSkeleton() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/80 to-slate-100 font-sans text-slate-800">
      <SatpamDutyPlanHeaderShell />
      <div className="max-w-2xl mx-auto px-4 py-5 space-y-5">
        <SatpamDutyPlanBodySkeleton />
        <div className="h-8" />
      </div>
    </div>
  );
}
