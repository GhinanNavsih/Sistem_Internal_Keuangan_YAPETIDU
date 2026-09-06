import { ClipboardList, CalendarDays } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { POSTS_CONFIG } from '@/components/employee/activities/activityShared';
import type { EmployeeActivityWorkflow } from '@/lib/employeeActivities';

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

/**
 * The date/shift fields and the 9-post grid the Ketua Shift roster form
 * always opens on. POSTS_CONFIG is a hardcoded constant (same 9 posts for
 * every regu and period — see activityShared.tsx), so the post id/name/
 * "Ketua Shift / Keliling" annotation render as real text immediately.
 * Only the guard-assignment and shift-type dropdowns stay as placeholders,
 * since those depend on the roster config (myShiftTeam, allSatpamEmployees,
 * satpamDutyPlan) that's still being fetched. Shared between the
 * pre-profile page skeleton below and the in-card loading state once the
 * profile has resolved but the roster config hasn't.
 */
export function SatpamRosterFieldsSkeleton() {
  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100 pb-3">
        <div className="space-y-2">
          <Label className="text-sm font-bold text-slate-600">Pilih Tanggal Dinas</Label>
          <div className="h-12 rounded-xl bg-white border border-slate-100 animate-pulse" />
        </div>
        <div className="flex flex-col justify-center space-y-2">
          <Label className="text-sm font-bold text-slate-600">Shift yang Dilaporkan</Label>
          <div className="h-12 rounded-xl bg-white border border-slate-100 animate-pulse" />
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-bold text-slate-600 border-b border-slate-100 pb-2">
          Penugasan Pos Keamanan (9 Pos)
        </h3>
        <div className="space-y-3.5">
          {POSTS_CONFIG.map((post) => (
            <div key={post.id} className="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-center bg-white p-3 rounded-xl border border-slate-200">
              <div className="md:col-span-3">
                <span className="text-base font-black text-slate-600 block leading-tight">{post.id}</span>
                <span className="text-base font-extrabold text-slate-900 block mt-1">{post.name}</span>
                {post.id === 'Pos 2' && (
                  <span className="mt-1 block text-sm font-bold text-blue-700">
                    Ketua Shift / Keliling
                  </span>
                )}
              </div>
              <div className="md:col-span-5">
                <div className="h-12 w-full rounded-lg bg-slate-100 animate-pulse" />
              </div>
              <div className="md:col-span-4">
                <div className="h-12 w-full rounded-lg bg-slate-100 animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Pre-profile skeleton for /employee/activities/satpam. The `workflow` prop
 * passed into this route is a static "satpam" from the page file — known
 * before auth even resolves — so unlike the generic ActivitiesPageSkeleton
 * this can render the actual Ketua Shift roster card shape instead of vague
 * filler cards. A non-ketua Satpam honorer landing on this same route
 * doesn't have this inline card (they get a history list + FAB instead) and
 * will see this swap away once their profile/role resolves — the same
 * "closest common shape, corrected once data confirms the real one"
 * trade-off already made for the shared activities skeleton.
 */
export function SatpamActivitiesPageSkeleton() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/80 to-slate-100 font-sans text-slate-800">
      <ActivitiesHeaderShell />
      <div className="max-w-2xl mx-auto px-4 py-5 space-y-5 relative z-10">
        <div className="bg-white rounded-2xl shadow-sm p-4">
          <div className="flex items-center gap-3">
            <CalendarDays className="w-4 h-4 text-teal-500 shrink-0" />
            <div className="flex items-center gap-2 flex-1">
              <div className="h-10 flex-1 rounded-xl bg-slate-100 animate-pulse" />
              <div className="h-10 w-24 rounded-xl bg-slate-100 animate-pulse" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="bg-gradient-to-r from-purple-600 to-indigo-600 p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center backdrop-blur-md">
                <ClipboardList className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white">Lapor Roster Shift Regu</h2>
                <div className="h-3 w-40 mt-1.5 rounded-full bg-white/20 animate-pulse" />
              </div>
            </div>
          </div>
          <div className="p-5">
            <SatpamRosterFieldsSkeleton />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Picks the pre-profile skeleton by workflow — known statically from the
 * page file (satpam/sopir/pekarya each pass their own literal `workflow`
 * prop) rather than derived from the still-loading profile. Used both as
 * the workspace's Suspense fallback and the view's own `!profile` gate, so
 * the two never disagree on shape.
 */
export function ActivitiesWorkflowSkeleton({ workflow }: { workflow: EmployeeActivityWorkflow }) {
  if (workflow === 'satpam') return <SatpamActivitiesPageSkeleton />;
  return <ActivitiesPageSkeleton />;
}
