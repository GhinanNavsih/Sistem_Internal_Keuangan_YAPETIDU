# Skeleton Loader Guide

This document captures how loading states should be built across the `/employee/*` portal (Loyalis, Honorer, Ketua Shift Satpam). It was written after retrofitting the Payslip and Activities pages — use it as the spec for any new page, and as the checklist when reviewing a skeleton someone else wrote.

---

## 1. The rule: never show a blank screen or a bare spinner

A page opening should never render an empty canvas with a centered `<Loader2 className="animate-spin" />` and nothing else. The moment a route resolves, the user should see the real page **frame** — header, icons, static labels, card outlines — with only the parts that depend on a fetch shown as placeholders.

If you're about to write:
```tsx
if (!profile) {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="animate-spin" />
    </div>
  );
}
```
stop — that's the anti-pattern this guide replaces.

---

## 2. The core rule: split "fixed" from "dynamic"

Every element on a page falls into one of two buckets. Get this split right and the rest of the skeleton writes itself.

| Bucket | Definition | Treatment |
| :--- | :--- | :--- |
| **Fixed** | Same for every employee, every period, every load — a logo, a letterhead, a section caption, a hardcoded constant list (`POSTS_CONFIG`, a fixed field label like "Pilih Tanggal Dinas") | Render as **real text/images immediately**, no pulse, no placeholder |
| **Dynamic** | Depends on the fetch that hasn't resolved yet — an employee's name, a Rupiah amount, which rows even appear, whether a banner shows state A or state B | Render as a **pulsing placeholder shape** (`bg-slate-100/200 animate-pulse`) that matches the real element's size |

**Before promoting something to "fixed", trace where its value actually comes from.** Don't assume a list "looks fixed" — verify it in the source:

- ✅ **Safe to hardcode**: `POSTS_CONFIG` in `activityShared.tsx` — a literal array of 9 posts, never fetched, never filtered.
- ❌ **Not safe, despite looking static in a screenshot**: Payslip's Loyalis earnings rows (`Gaji Pokok`, `T. Keluarga`, …) come from a server-side push-list in `slipBuilders.ts`, but optional rows (Struktural, Piket, Lembur, Vakasi Tambahan) are conditionally included per employee/period. A screenshot showing 11 rows does not mean every employee always has exactly those 11 rows. Guessing this produces a skeleton→real-content row-count mismatch, which reads as a worse glitch than a generic placeholder.
- ❌ **Not safe**: a banner whose copy depends on today's schedule (Sopir's Piket-active vs Piket-not-active banner) — two genuinely different messages, so neither is "the" fixed text. Use a neutral shape (icon + pulsing bars) instead of guessing which copy wins.

When in doubt, grep for where the value is assigned before deciding it's safe to hardcode into a skeleton.

---

## 3. Reference implementations

| Page/role | File | What's real immediately | What stays a placeholder |
| :--- | :--- | :--- | :--- |
| Payslip (Loyalis) | `src/components/PayslipSkeleton.tsx` | Logos, letterhead text, "NAMA PEGAWAI"/"PERIODE SLIP" captions, "I. PENERIMAAN"/"II. POTONGAN"/"III. PAJAK" headers | Employee name, NIY/NPWP, period value, status badge, every earning/deduction/tax row |
| Activities — Satpam (Ketua Shift) | `src/components/EmployeeActivitiesSkeleton.tsx` (`SatpamRosterFieldsSkeleton`, `SatpamActivitiesPageSkeleton`) | Header, "Lapor Roster Shift Regu" card chrome, date/shift field captions, all 9 real post names + the "Ketua Shift / Keliling" annotation on Pos 2 | Date/shift input values, every guard-assignment and shift-type dropdown |
| Activities — Sopir | `src/components/EmployeeActivitiesSkeleton.tsx` (`SopirActivitiesPageSkeleton`) | Header, "Pemesanan Perjalanan Terbuka (Pool)" caption + Compass icon (the one section not gated behind a non-empty array) | Piket/SPJ banner copy (state-dependent), assigned/claimed/pool journey cards — and the period selector is *omitted entirely*, because it never renders for Sopir on the real page |
| Activities — Pekarya | `src/components/EmployeeActivitiesSkeleton.tsx` (`ActivitiesBodySkeleton`, generic) | Header only | Everything else — not yet given a bespoke skeleton |

If you add a bespoke skeleton for Pekarya (or any other workflow), follow the same trace-then-split process used for Satpam/Sopir above — don't reuse the generic filler cards once you know the real shape.

---

## 4. Where a skeleton must be wired in — three phases, one shared shape

A page's loading state isn't one moment, it's up to three, and they must all render the *same* skeleton or the frame will visibly jump:

1. **Session-check** (`ProtectedRoute`, before `useAuth()` resolves at all — role unknown). Pass a `fallback` prop:
   ```tsx
   <ProtectedRoute fallback={<PayslipPageSkeleton />}>{children}</ProtectedRoute>
   ```
   Pick the fallback by **pathname**, not by role (role isn't known yet) — see `src/app/employee/layout.tsx`.

2. **Suspense fallback** (for any page whose content hook uses `useSearchParams`, requiring a Suspense boundary — e.g. `EmployeeActivitiesWorkspace`). Same skeleton, keyed off the `workflow` prop the page passes in statically (see §5).

3. **In-page data-fetch loading** (`if (!profile) return …` / `if (loading) return …` inside the view itself, and any inner `loadingXyz` flag gating a specific card's content). Reuse the *same* fixed/dynamic split — e.g. `SatpamRosterFieldsSkeleton` is shared between the pre-profile page skeleton and the in-card `loadingSatpamConfig` state, so the roster card never changes shape as it moves through loading stages.

Centralize the "which skeleton for which page/workflow" decision in one function (`ActivitiesWorkflowSkeleton({ workflow })` in this codebase) and call it from all three phases, rather than duplicating the branch three times.

---

## 5. Use static props, not fetched state, to pick the skeleton variant

`workflow` (`"satpam" | "sopir" | "pekarya"`) is passed into the page as a literal prop from the page file itself — it's known before `useAuth()` even starts, let alone before Firestore responds. Use facts like this to pick an accurate skeleton *before* the profile loads, instead of falling back to one generic shape for every workflow:

```tsx
// satpam/page.tsx
<EmployeeActivitiesWorkspace workflow="satpam" />
```
```tsx
// EmployeeActivitiesSkeleton.tsx
export function ActivitiesWorkflowSkeleton({ workflow }: { workflow: EmployeeActivityWorkflow }) {
  if (workflow === 'satpam') return <SatpamActivitiesPageSkeleton />;
  if (workflow === 'sopir') return <SopirActivitiesPageSkeleton />;
  return <ActivitiesPageSkeleton />;
}
```

Route-derived facts (which page file rendered this, which literal prop it passed) are available immediately. Profile-derived facts (role, employee data) are not — don't block an accurate skeleton on the latter when the former already tells you enough.

---

## 6. Accepted trade-offs — write them down, don't hide them

Sometimes two different real users land on the same route with genuinely different content (a Ketua Shift Satpam sees a roster-report card; a regular Satpam honorer on the same `/employee/activities/satpam` route sees a history list + FAB instead, with no inline card at all). You cannot know which one you're building for until the profile loads.

In that case, pick the closer/more-detailed shape as the pre-profile skeleton, and **comment the trade-off in the code** so it isn't rediscovered as a "bug" later:

```tsx
/**
 * A non-ketua Satpam honorer landing on this same route doesn't have this
 * inline card (they get a history list + FAB instead) and will see this
 * swap away once their profile/role resolves — the same "closest common
 * shape, corrected once data confirms the real one" trade-off already made
 * for the shared activities skeleton.
 */
```

This is different from guessing dynamic *content* (§2) — it's choosing a shape when two real shapes are both possible, which is unavoidable pre-profile. Guessing content when only one shape exists is avoidable and should not happen.

---

## 7. Checklist for a new page's skeleton

- [ ] Identify every element on the real page; sort into fixed vs dynamic per §2, tracing values back to their source before calling something "fixed."
- [ ] Build one skeleton component that renders fixed elements as real text/images and dynamic elements as size-matched `animate-pulse` placeholders.
- [ ] Wire the *same* skeleton into all three loading phases (§4): `ProtectedRoute` fallback, Suspense fallback (if applicable), and the in-page `!profile`/`loading` gates.
- [ ] Pick the skeleton variant using static, route-known facts (§5) wherever possible, not fetched state.
- [ ] If two real shapes are possible pre-profile, pick the closer one and comment the trade-off (§6) — don't silently guess.
- [ ] Never fake a conditionally-present row/section/banner-copy that depends on fetched data — leave it a neutral placeholder instead.
