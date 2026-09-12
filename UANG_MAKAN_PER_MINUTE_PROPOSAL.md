# Uang Makan Per-Minute Rate — Proposed Revision

**Status: DRAFT / PROPOSED — not yet approved or implemented.** This document
is for stakeholder review of a change to the SOPIR Uang Makan (meal
component) rule described in `UPAH_SPJ_SOPIR.md` §2. No code has been
changed. Do not treat any formula here as live until this proposal is
approved and the corresponding code/tests land.

## 1. Problem being solved

The current strata table (`getGrossMealAllowanceForDuration`, documented in
`UPAH_SPJ_SOPIR.md` §2) pays a flat amount per tier:

| Remaining hours in the day | Meal amount |
| --- | ---: |
| `<= 2h` | Rp0 (short-trip flat Rp5.000 applies instead) |
| `2h < h <= 6h` | Rp20.000 |
| `6h < h <= 12h` | Rp40.000 |
| `> 12h` | Rp60.000 |

This creates a cliff: a trip that lasts 2h01m and a trip that lasts 5h59m
are paid identically (Rp20.000), even though the second one is nearly 3x
longer. A driver whose trip lands just under a tier boundary is effectively
unpaid for the time between the previous boundary and their actual arrival.

## 2. Proposed design

Replace the flat strata entirely (including the ≤2h flat Rp5.000 rule, via
the short-trip floor in §2.2) with a blended per-minute rate that depends on
time of day, computed over rolling 24-hour blocks anchored to the trip's
departure time, with a cap per block matching today's daily maximum.

### 2.1 Per-minute rates

| Window | Rate |
| --- | ---: |
| 07:30–14:00 ("working hours") | Rp70 / minute |
| Outside 07:30–14:00 | Rp84 / minute |

A trip that straddles the boundary is billed as a blend: each minute is
priced at whichever rate applies to the clock time it falls in, and the
per-minute amounts are summed. Example (confirmed with stakeholder in prior
discussion): a 06:00–15:00 trip = 90 min @ Rp84 (06:00–07:30) + 390 min @
Rp70 (07:30–14:00) + 60 min @ Rp84 (14:00–15:00) = Rp42.750.

### 2.2 Short-trip floor: `max(Rp5.000, blended per-minute value)` (resolved)

For any trip duration, compute the blended per-minute amount as in §2.1, then
pay whichever is greater of that and the existing flat short-trip rate:

```text
shortTripFloor = 5,000
UangMakan = max(shortTripFloor, blendedPerMinuteValue)
```

No duration threshold and no "is this an in-working-hours journey"
classification is needed. This single rule reproduces, as a side effect, the
two duration thresholds separately proposed and checked against each pure
rate during design discussion — `ceil(5,000 / 84) = 60 minutes` for a trip
entirely outside working hours, and `ceil(5,000 / 70) = 72 minutes` for a
trip entirely inside working hours — as the natural crossover points where
the blended value first exceeds the floor. Unlike a fixed duration
threshold, it also resolves correctly for any trip that straddles the
07:30/14:00 boundary.

**Why a fixed duration threshold isn't safe for a straddling trip:** take a
65-minute trip, 07:15–08:20 (15 min outside + 50 min inside): blended =
`15×84 + 50×70 = Rp4.760`. If this trip were routed to a 60-minute threshold
because it starts before 07:30, its duration (65 ≥ 60) would put it in
per-minute mode at Rp4.760 — *below* the Rp5.000 floor, and below what a
shorter, purely-flat 40-minute trip would earn. `max(5,000,
blendedPerMinuteValue)` avoids this for every composition, without ever
needing to classify the trip: `max(5,000, 4,760) = 5,000`.

This formula applies from 0 minutes — it fully replaces the current
`getShortTripMealWageComponent` flat-rate rule (§5 item 1 in prior drafts of
this document; now resolved in favor of this formula rather than either of
the two options previously listed there).

### 2.3 Rolling 24-hour blocks, capped at Rp60.000 each

The trip's elapsed duration is split into blocks the same way the current
system already splits it — `fullBlocks = floor(elapsedHours / 24)`,
`remainderHours = elapsedHours % 24` — **except each block's start/end
clock time is now tracked**, because the per-minute rate needs real
clock-time overlap with 07:30–14:00, not just an hour count.

```text
for each 24-hour block (and the final partial remainder block):
    blockAmount = sum of (minutes in window × window rate) for that block
    blockAmount = min(blockAmount, 60,000)
total = sum of all blockAmount
```

This preserves the current system's Rp60.000-per-day ceiling while fixing
the tier-boundary cliff within a block.

### 2.4 Why rolling anchoring, not calendar-midnight anchoring

Two ways to define a "block" were evaluated:

- **Calendar-midnight anchoring** (blocks reset at 00:00): rejected. It
  independently caps the departure-day and arrival-day slivers, which can
  inflate cost even for a trip that should be neutral. A clean test case —
  Monday 07:30 → Thursday 07:30 (exactly 72h, zero remainder) — comes out to
  Rp217.800 under calendar anchoring vs Rp180.000 under both the current
  system and rolling anchoring, purely because midnight cuts an artificial
  4th partial day out of an otherwise exact 3-day trip.
- **Rolling anchoring** (blocks reset every 24h from departure): matches how
  `getGrossMealAllowanceForDuration` already thinks about "days" today. It
  is mathematically exact for any whole-24h-multiple trip and stays within
  roughly +2% to +13% of today's figure for partial remainders in the three
  journey shapes simulated below (§4) — a much tighter band than
  calendar-midnight anchoring's +12% to +21%.

**Recommendation: rolling anchoring.**

## 3. Rate calibration rationale

Rp70/Rp84 keeps the same 5:6 ratio as the originally proposed Rp75/Rp90, but
scaled down so it lands almost exactly on the current system's payout for
the stakeholder's own worked example (a 9-hour trip spanning 06:00–15:00:
Rp39.900 proposed vs Rp40.000 today). It is not possible to calibrate a
single flat per-minute rate to be neutral for every trip length
simultaneously — the current system is concave (generous at the bottom of
each tier, capped at the top) while a per-minute rate is linear — so this
calibration deliberately targets the middle of the range rather than either
extreme. Short trips just past 2h will earn less than today; trips that
used to land just under a tier ceiling (the original complaint) will earn
more.

## 4. Simulation: current vs proposed (rolling-anchored)

| Journey | Current logic | Proposed (rolling-anchored, capped) | Delta |
| --- | ---: | ---: | ---: |
| A: Mon 22:00 → Wed 04:00 (30h) | Rp80.000 | Rp90.240 | +12.8% |
| B: Mon 06:00 → Wed 15:00 (57h) | Rp160.000 | Rp162.750 | +1.7% |
| C: Mon 07:30 → Thu 07:30 (72h, exact) | Rp180.000 | Rp180.000 | 0% |

These are the three shapes exercised during design discussion; they are not
exhaustive. Before implementation, the actual driver-journey dataset should
be replayed through both formulas (see §7) to see the real distribution of
deltas, not just these three illustrative cases.

## 5. Open questions for stakeholders

These are unresolved and materially affect the formula — implementation
should not start until they're answered. (The sub-2h/sub-1h short-trip
question that previously sat here as item 1 is resolved — see §2.2.)

1. **Is the Rp60.000-per-block cap intended to be permanent, or a
   transitional safeguard?** It was reintroduced specifically to stop
   multi-day trips from costing roughly double under an uncapped per-minute
   rate (see prior discussion). Confirm this cap is an accepted permanent
   feature of the new rule, not a stopgap.
2. **Effective date / cutover.** See §6 — confirm whether new-only or
   retroactive-to-pending is intended.
3. **Is the 07:30–14:00 window fixed and global**, or should it ever vary
   (e.g. by driver shift, by day of week, by holiday)? The current proposal
   assumes one fixed window, every day, for every driver.

## 6. Migration strategy (precedent: `pekaryaSpj.ts`)

This codebase already solved an equivalent problem: `pekaryaSpj.ts` moved
Pekarya SPJ from legacy 30-minute-block rates to a per-minute rate, using a
date-gated cutover (`PEKARYA_SPJ_PER_MINUTE_RATE_START_DATE`,
`usesPerMinuteSpjRate(activityDate)`) so that "raising the rate never
reprices existing SPJ" — activities dated before the cutoff keep pricing
under the legacy rate forever, even if reviewed after the cutoff date.

The same pattern is recommended here:

- Add a `UANG_MAKAN_PER_MINUTE_RATE_START_DATE` constant and a
  `usesPerMinuteMealRate(activityDate)` helper, mirroring
  `usesPerMinuteSpjRate`.
- An activity dated on/after the cutoff uses the new blended-per-minute
  formula (§2); one dated before it keeps using
  `getGrossMealAllowanceForDuration` exactly as today.
- This is a **separate axis** from the existing `mealAccountingMode`
  (`legacy_reimbursement` vs `upah_bersih_gross`, `UPAH_SPJ_SOPIR.md` §2) —
  that flag controls *where* the meal entitlement is paid (wage vs
  reimbursement); the new flag controls *how the entitlement amount itself
  is calculated*. Both need to be resolved independently for a given
  record, and both need the same "an explicit stamp always wins, so
  re-auditing an old approved journey never silently reprices it" rule
  applied to unstamped records.
- Unlike the SPJ precedent, Rp70 and Rp84 are already whole-number
  rupiah-per-minute rates (no recurring-decimal issue like the SPJ case's
  Rp83,33…/hour), so no hourly-rate-then-divide trick is needed — straight
  integer minute arithmetic is exact.

## 7. Implementation checklist (once approved)

**`src/lib/payroll/driverJourney.ts`**
- [ ] Add `UANG_MAKAN_WORKING_HOURS_RATE = 70`, `UANG_MAKAN_OFF_HOURS_RATE = 84`,
      `UANG_MAKAN_DAILY_CAP = 60_000`, `UANG_MAKAN_WORKING_HOURS_START = '07:30'`,
      `UANG_MAKAN_WORKING_HOURS_END = '14:00'`.
- [ ] Add `UANG_MAKAN_PER_MINUTE_RATE_START_DATE` + `usesPerMinuteMealRate(activityDate)`.
- [ ] New function, e.g. `calculateBlendedMealAllowance(dateStart, timeStart, dateEnd, timeEnd)`
      — requires actual timestamps, not just an hour count. This is a
      **breaking input change** relative to `getGrossMealAllowanceForDuration(hours)`.
  - [ ] Segment the span into rolling 24h blocks + remainder, anchored to `timeStart`/`dateStart`.
  - [ ] For each block, sum minutes inside vs outside the working-hours window (recurring daily).
  - [ ] Apply per-minute rates, cap each block at `UANG_MAKAN_DAILY_CAP`, sum blocks.
  - [ ] Apply the §2.2 short-trip floor — `Math.max(5_000, blockAmount)` — to
        the first block only (a short trip is, by construction, entirely
        within one block; the floor has no effect once a trip is long enough
        to reach a second block).
- [ ] Keep `getGrossMealAllowanceForDuration` unchanged for
      `usesPerMinuteMealRate(activityDate) === false` — this becomes the
      permanent legacy path, analogous to `pekaryaSpjLegacyHalfHourRate`.
- [ ] `calculateDriverNetWage` needs a route to real timestamps for meal
      calculation when the per-minute regime applies — audit every call
      site (`calculateDriverNetWage` currently only takes `elapsedDurationHours`,
      not actual clock times).

**Call sites needing real timestamps, not just an hour count** (each needs
review — see `UPAH_SPJ_SOPIR.md` §7 for what each currently does):
- [ ] `src/app/api/pekarya/activities/review/route.ts` (final settlement — has
      real timestamps already, straightforward to wire through)
- [ ] `src/components/DriverJourneyAuditDialog.tsx` (audit preview — has
      real timestamps)
- [ ] `calculateDriverJourneyOperationalCosts` (`grossMealAllowance` display
      field at authorization time — has real timestamps if authorization
      captures planned departure/arrival clock times; confirm it does)
- [ ] `calculateEstimatedDriverWage` (pre-trip range estimate,
      `src/app/dashboard/payroll/driver-journeys/page.tsx`,
      `src/app/api/driver-journeys/route.ts`,
      `src/components/employee/activities/SopirActivitiesView.tsx`) — this
      function currently has **no departure time input at all**, only
      distance/duration. Needs a design decision: assume a default
      departure time for the estimate, or accept the estimate becomes less
      precise once meal is time-of-day-dependent.
- [ ] `src/components/employee/activities/activityShared.tsx`,
      `src/app/employee/driver-history/page.tsx`,
      `src/app/employee/activities/sopir/journey-report/page.tsx` — read
      paths displaying a stored figure; confirm they read the persisted
      amount rather than recomputing, so they're unaffected by the regime
      change for historical records.

**Tests (`src/lib/payroll/driverJourney.test.ts`)**
- [ ] Blended rate on a single window-crossing trip (the 06:00–15:00 case).
- [ ] Rolling-block segmentation across multiple days, including the exact
      72h/zero-remainder case (must equal legacy output).
- [ ] Cap binding within a single block.
- [ ] Cutover date boundary: activity dated the day before vs the day of
      `UANG_MAKAN_PER_MINUTE_RATE_START_DATE`.
- [ ] Short-trip floor (§2.2): pure-outside trip at 59/60/61 minutes, pure-
      inside trip at 71/72/73 minutes, and the 65-minute straddling example
      from §2.2 — assert the floor applies (Rp5.000) exactly where the
      blended value would otherwise dip below it, for every composition,
      not just the two pure ones.
- [ ] Re-run the three §4 simulation journeys as literal test assertions.

**Docs**
- [ ] Fold this proposal into `UPAH_SPJ_SOPIR.md` §2 as the current rule,
      once approved and shipped, keeping the superseded strata description
      for pre-cutover records (mirroring how `pekaryaSpj.ts` keeps
      `PEKARYA_SPJ_LEGACY_HALF_HOUR_RATES` documented, not deleted).

## 8. Source references

- `UPAH_SPJ_SOPIR.md` — the currently-implemented rule this proposal
  revises.
- `src/lib/payroll/pekaryaSpj.ts` (lines ~118–163) — the per-minute /
  date-cutover migration pattern this proposal follows.
- `src/lib/payroll/driverJourney.ts` — where all new code would live.
- Design discussion in this conversation — the three simulation journeys in
  §4, the short-trip floor derivation in §2.2, and the calendar-vs-rolling
  anchoring analysis in §2.4.
