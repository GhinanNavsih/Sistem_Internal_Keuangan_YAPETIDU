import { ShieldCheck, LogOut } from 'lucide-react';
import EmployeeNavigationMenu from '@/components/EmployeeNavigationMenu';

export function LeaveHeaderShell({ displayName }: { displayName?: string | null }) {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 shadow-sm backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3 sm:px-6">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-lg shadow-amber-200/60">
          <ShieldCheck className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-extrabold">Ajukan Izin</h1>
          {displayName ? (
            <p className="truncate text-sm text-slate-500">{displayName}</p>
          ) : (
            <div className="h-2.5 w-24 mt-1.5 rounded-full bg-slate-200 animate-pulse" />
          )}
        </div>
        <EmployeeNavigationMenu />
        <div className="h-9 w-9 shrink-0 rounded-xl border border-slate-200 bg-white shadow-sm flex items-center justify-center">
          <LogOut className="h-4.5 w-4.5 text-slate-300" />
        </div>
      </div>
    </header>
  );
}

/**
 * Which of the two leave forms an employee sees (Satpam vs. Pekarya) is
 * decided by `isSatpam`, derived purely from `profile.role`/
 * `permittedCategories` — not from the periods fetch this page also waits
 * on. So once the profile has resolved, the correct card header/description
 * can render as real text immediately even before the periods fetch
 * finishes; only the form fields and history list inside stay placeholders.
 * Before the profile resolves at all (variant "unknown"), neither card
 * shape is knowable yet, so this shows a neutral, uncommitted card instead
 * of guessing one.
 */
export function LeaveCardSkeleton({ variant }: { variant: 'satpam' | 'pekarya' | 'unknown' }) {
  if (variant === 'unknown') {
    return (
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-slate-50/70 p-5 space-y-2">
          <div className="h-5 w-56 rounded-full bg-slate-200 animate-pulse" />
          <div className="h-3.5 w-full max-w-md rounded-full bg-slate-100 animate-pulse" />
        </div>
        <div className="p-5 space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-12 w-full rounded-xl bg-slate-100 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const isSatpam = variant === 'satpam';
  return (
    <div
      className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${
        isSatpam ? 'border-amber-200' : 'border-indigo-200'
      }`}
    >
      <div
        className={`border-b p-5 ${
          isSatpam ? 'border-amber-100 bg-amber-50/70' : 'border-indigo-100 bg-indigo-50/70'
        }`}
      >
        <div className="flex items-center gap-2 text-xl font-bold text-slate-900">
          <ShieldCheck className={`h-6 w-6 ${isSatpam ? 'text-amber-700' : 'text-indigo-700'}`} />
          {isSatpam ? 'Ajukan Izin & Presensi Satpam' : 'Ajukan Izin Resmi'}
        </div>
        <p className="text-base text-slate-600 mt-1">
          {isSatpam
            ? 'Laporkan scan masuk & keluar yang terlupa atau ajukan izin untuk kewajiban dinas yang terjadwal. Izin yang tumpang tindih dengan shift terdaftar tidak menambah Harian.'
            : 'Kirim laporan scan masuk & scan keluar atau izin resmi kepada Kepala SatKer.'}
        </p>
      </div>
      <div className="p-5 space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-12 w-full rounded-xl bg-slate-100 animate-pulse" />
        ))}
        <div className="pt-2">
          <div className="h-4 w-32 rounded-full bg-slate-200 animate-pulse mb-2" />
          <div className="h-16 w-full rounded-xl bg-slate-100 animate-pulse" />
        </div>
      </div>
    </div>
  );
}

export function LeavePageSkeleton({
  displayName,
  variant = 'unknown',
}: {
  displayName?: string | null;
  variant?: 'satpam' | 'pekarya' | 'unknown';
}) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/80 to-slate-100 text-slate-900">
      <LeaveHeaderShell displayName={displayName} />
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        <LeaveCardSkeleton variant={variant} />
      </main>
    </div>
  );
}
