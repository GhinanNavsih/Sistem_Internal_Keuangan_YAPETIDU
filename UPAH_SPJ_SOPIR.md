# Upah SPJ Sopir (Driver Journey Wage) Rules

This document records the business rules for calculating a SOPIR's net wage
(`Upah Bersih`) for a single authorized journey, and how that wage interacts
with the journey's separate operational (fuel/toll/meal) budget. It is the
counterpart to `VEHICLE_FUEL_LEDGER.md`, which covers the fuel ledger and
procurement-mode mechanics referenced here but not re-explained.

All logic lives in `src/lib/payroll/driverJourney.ts`, with the review-time
settlement assembled in `src/app/api/pekarya/activities/review/route.ts` and
mirrored in the audit UI, `src/components/DriverJourneyAuditDialog.tsx`. Rate
constants are also asserted directly in `src/lib/payroll/driverJourney.test.ts`.

## 1. Wage components (`calculateDriverNetWage`)

The wage is the sum of four independent components:

```text
Upah Bersih (base) = Komponen Jarak
                    + Komponen Waktu
                    + Uang Makan (short-trip OR strata, never both)
                    + Premi Malam
```

| Component | Formula | Rate |
| --- | --- | --- |
| Komponen Jarak | `ceil(distanceKm * 300)` | Rp300 / km |
| Komponen Waktu | `ceil(travelTimeHours * 5,000)` | Rp5.000 / hour |
| Premi Malam | `nightCount * 50,000` | Rp50.000 / night |
| Uang Makan | see §2 | tiered |

Each component is rounded up (`Math.ceil`) to a whole rupiah independently,
before summing — not once on the total.

### Two different "duration" inputs

`calculateDriverNetWage` deliberately takes two separate duration figures,
and each drives a different component:

- **`travelTimeHours`** — cumulative Google Directions driving time between
  destinations. Drives **Komponen Waktu only**.
- **`elapsedDurationHours`** — wall-clock departure-to-arrival span. Drives
  **Uang Makan only** (§2), never Komponen Waktu.

This means a driver who spends 3 hours actually driving but 8 hours away
(e.g. waiting at a destination) earns Komponen Waktu for 3 hours but Uang
Makan for an 8-hour trip — waiting doesn't inflate driving pay, but it does
count toward feeding the driver. Confirmed in
`driverJourney.test.ts`: `distanceKm: 50, travelTimeHours: 3,
elapsedDurationHours: 8` → `(50*300) + (3*5000) = Rp30.000`, no short-trip
meal component (elapsed > 2h).

Vehicle type (`DriverVehicleName` / `DRIVER_VEHICLE_RATES`) plays **no role**
in the wage formula. It only affects the fuel/operational budget (§4) —
Komponen Jarak is a flat Rp300/km whether the trip used a Bis or an Innova.
Driving effort pay is intentionally decoupled from which vehicle was
assigned.

## 2. Uang Makan (meal component)

There are two mutually-exclusive meal components, keyed off
`elapsedDurationHours`, that never cover the same hours:

- **Short-trip flat rate** (`getShortTripMealWageComponent`): if the
  remaining portion of the trip (duration modulo 24h) is `> 0` and `<= 2`
  hours, pays a flat **Rp5.000**.
- **Strata (gross duration-based) entitlement**
  (`getGrossMealAllowanceForDuration`): for any remaining portion `> 2`
  hours, pays a full day (Rp60.000) per completed 24-hour cycle, plus a
  strata bonus for the leftover:

| Remaining hours in the day | Meal amount |
| --- | ---: |
| `<= 2h` | Rp0 (short-trip flat rate applies instead) |
| `2h < h <= 6h` | +Rp20.000 |
| `6h < h <= 12h` | +Rp40.000 |
| `> 12h` | +Rp60.000 (full day) |

```text
fullDays = floor(elapsedHours / 24)
remainder = elapsedHours mod 24
mealWage = fullDays * 60,000 + strataBonus(remainder)
```

Because the short-trip rate only fires for `remainder <= 2h` — exactly the
gap the strata table pays nothing for — the two components are additive
without ever double-paying the same window.

### Meal accounting mode migration

How the meal entitlement is *paid* has changed, and both old and new
records must keep reproducing the figure they were actually paid under:

- **`legacy_reimbursement`** (historical): meal was pre-authorized as
  operational cash (part of the fuel/toll budget, §4) and settled as
  reimbursement, netted against any cash already handed to the driver
  mid-trip.
- **`upah_bersih_gross`** (current, `CURRENT_MEAL_ACCOUNTING_MODE`): meal is
  paid **inside Upah Bersih** at its full entitlement. It contributes
  **nothing** to the operational budget or reimbursement, and mid-trip cash
  handed to the driver is recorded for audit but no longer nets against the
  entitlement (see memory: mid-trip cash is reported but intentionally never
  reduces meal pay under this mode).

`resolveMealAccountingMode(storedMode, { alreadyApproved })` decides the
mode for an unstamped record with a deliberately asymmetric default:

```text
if storedMode is a valid mode: use it (an approved journey keeps the
                                        treatment it was paid under)
else if alreadyApproved: 'legacy_reimbursement'   (paid before the mode existed)
else: 'upah_bersih_gross'                          (not paid yet — use current policy)
```

An explicit stamp always wins so re-auditing an old approved journey never
silently reprices it.

## 3. Premi Malam (night premium) and the multi-day timeline

`calculateNightPremium(nightCount) = nightCount * 50,000`. `nightCount` must
be a non-negative integer (`assertNightCount`), capped at `MAX_NIGHT_COUNT`
(365).

`nightCount` itself comes from one shared timeline resolver,
`calculateJourneyDateTimeTimings` (wrapped for the audit UI by
`calculateEditableDriverJourneyTimeline`, per `CLAUDE.md`'s note that the
latter is the single source of truth for overnight inference shared by
submission and audit):

```text
calendarDaysDiff = dateEnd - dateStart (in days)
if calendarDaysDiff > 0:
    arrivesBefore5AM = (arrival hour < 5)
    nightCount = max(0, calendarDaysDiff - (1 if arrivesBefore5AM else 0))
elif isMultiDay flag is set but dates are equal:
    nightCount = 0   # explicit flag alone never invents a night
```

The **05:00 cutoff rule**: arriving the next calendar day at 04:59 or
earlier does not count as an overnight stay (the trip is treated as having
run through the same "night," e.g. an overnight drive that lands before
dawn); arriving at 05:00 or later does. Confirmed in
`driverJourney.test.ts`: arrival `02:30` next day → 0 nights; arrival
`05:00` next day → 1 night (+Rp50.000).

A stale `isMultiDay: true` flag with an unchanged `dateEnd` scores **zero**
nights — the flag alone never bills a Premi Malam; only an actual date
boundary or a wrapped clock time (`timeEnd < timeStart` inferring the next
calendar day) does.

## 4. Relationship to the operational (fuel/toll/meal) budget

A journey has **two separate money flows** that must not be confused:

1. **Wage** (`calculateDriverNetWage` → Upah Bersih) — what the driver
   earns, computed at review/approval time from actual measured
   distance/duration.
2. **Operational budget** (`calculateDriverJourneyOperationalCosts`,
   documented alongside procurement modes in `VEHICLE_FUEL_LEDGER.md`) —
   cash/ledger allowance for fuel and toll/parking, authorized before the
   trip. Under the current `upah_bersih_gross` mode this budget carries
   **no meal allowance at all** (`mealAllowance = 0`); the full meal
   entitlement is only ever reported via `grossMealAllowance` so the
   authorizing Kepala Satker can see what the driver will earn for it, and
   is actually paid through the wage formula in §2.

At review time, `calculateDriverReimbursementSettlement` settles actual
fuel/toll spend against the pre-authorized allowance:

```text
fuelDelta = actualFuelSpent - effectiveFuelAllowance
tollDelta = actualTollSpent - tollAllowance
extraCost      = max(0, fuelDelta) + max(0, tollDelta)   # driver spent more than budgeted
allowanceSurplus = max(0, -fuelDelta) + max(0, -tollDelta) # driver spent less than budgeted
netOperationalDelta = fuelDelta + tollDelta

reimburseDelta       = max(0, netOperationalDelta + additionalReimbursement)
remainingUnspentCash = max(0, -netOperationalDelta - additionalReimbursement)
```

A fuel saving can offset a toll overage (and vice versa) before anything is
reimbursed or deducted — the two categories net against each other first.
`additionalReimbursement` (e.g. an approved meal delta under legacy mode, or
extra operational cost) is settled against that same net position before
any leftover surplus is deducted from wage.

**Final settlement** (`src/app/api/pekarya/activities/review/route.ts`):

```text
baseDriverWage = calculateDriverNetWage(...)               # §1
Upah Bersih    = max(0, baseDriverWage - remainingUnspentCash)
```

Any operational allowance the driver never spent, and that wasn't already
consumed by another reimbursement, is deducted from the driver's wage —
the driver is paid for driving, not handed unspent fuel/toll money as a
bonus. Overspending, by contrast, is reimbursed in cash, not paid through
the wage.

## 5. Pre-trip wage estimate (`calculateEstimatedDriverWage`)

Before a journey is measured/authorized, the app shows the driver/reviewer
an estimate range using only distance and duration (no `nightCount`
parameter — a night premium isn't known until the trip's actual dates are
set):

```text
baseWage = Komponen Jarak + Komponen Waktu + Uang Makan   (per §1–§2)
maxWage  = ceil(baseWage * 1.25)
```

The displayed range (`Rp{baseWage} - Rp{maxWage}`) is a buffer for route
uncertainty before the real distance/duration are measured, not a
reimbursement or authorization budget — those are computed separately by
`calculateDriverJourneyOperationalCosts` (§4). Because this estimate omits
Premi Malam, a multi-night trip's real Upah Bersih can exceed the displayed
`maxWage`; the estimate is a distance/time-only preview, not a ceiling.

## 6. Worked example

A round trip: 100 km, 30 hours cumulative driving time, 30 hours elapsed
(2 nights away), current (`upah_bersih_gross`) meal mode:

```text
Komponen Jarak = ceil(100 * 300)       = Rp30.000
Komponen Waktu = ceil(30 * 5,000)      = Rp150.000
Premi Malam    = 2 * 50,000            = Rp100.000
Uang Makan: elapsed 30h = 1 full day (24h, Rp60.000)
            + 6h remainder -> "> 2h and <= 6h" strata = +Rp20.000
          = Rp80.000

Upah Bersih (base) = 30,000 + 150,000 + 100,000 + 80,000 = Rp360.000
```

(The `driverJourney.test.ts` case with the same distance/travel/elapsed
inputs but 2 nights and default `legacy_reimbursement` mode — which pays no
Uang Makan into the wage — asserts `Rp280.000`, i.e. this example minus the
Rp80.000 meal component.)

If, at settlement, the driver was given a fuel/toll allowance the trip
didn't fully use (`remainingUnspentCash = Rp15.000` after any other
reimbursements are netted out), the final payout is:

```text
Upah Bersih = max(0, 360,000 - 15,000) = Rp345.000
```

## 7. Source references

- `src/lib/payroll/driverJourney.ts` — all rate constants and pure
  calculation functions cited above.
- `src/lib/payroll/driverJourney.test.ts` — the confirmed numeric
  assertions this document's examples are drawn from.
- `src/app/api/pekarya/activities/review/route.ts` — where
  `baseDriverWage`, the reimbursement settlement, and the final `upahBersih`
  are assembled and persisted onto the approved `ActivityReports` record.
- `src/components/DriverJourneyAuditDialog.tsx` — the audit UI surfacing
  the same components under their Indonesian labels (Komponen Jarak,
  Komponen Waktu, Uang Makan, Upah Bersih Sopir, Potongan Sisa Kas
  Operasional).
- `VEHICLE_FUEL_LEDGER.md` — the fuel ledger, procurement modes
  (`hold_accumulate` / `procure_release` / `standard_direct`), and
  authorization/claim/audit permissions referenced in §4 but documented
  there in full.
