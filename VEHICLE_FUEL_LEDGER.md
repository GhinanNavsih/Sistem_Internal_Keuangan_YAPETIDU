# Vehicle Fuel Accumulation Ledger

This document explains how driver-journey fuel (BBM) reimbursement can be routed through a shared per-vehicle balance instead of paid out per trip, the reservation state machine that keeps that balance correct under concurrent approvals, and which TypeScript files implement each part.

## Purpose

Most driver journeys reimburse fuel directly: the trip gets a cash allowance, the driver spends it, any difference is settled as a delta. That flow is `standard_direct` and is unaffected by anything in this document.

For vehicles that are *shared* across drivers, a second option exists: instead of paying fuel per trip, a journey's fuel allowance can be **held back and added to a pool** for that vehicle, and a later trip can **draw down that pool** instead of taking a fresh cash allowance. This lets a fleet vehicle accumulate a BBM balance from trips that didn't need it and spend that balance on trips that do, without cash changing hands every time.

The pool is stored per vehicle model (not per physical car) in:

```text
VehicleFuelBalances/{vehicleName}
```

## Core Concepts

### Procurement modes

```ts
export type FuelProcurementMode =
  | 'standard_direct'   // default — legacy per-trip cash reimbursement
  | 'hold_accumulate'    // this trip's fuel becomes pool balance instead of cash
  | 'procure_release';   // this trip draws down the pool on top of its own allowance
```

| Mode | What happens to this trip | What happens to the pool |
|---|---|---|
| `standard_direct` | Fuel reimbursed as a normal cash allowance/delta, exactly like before this feature existed | Never touched — reservation state stays `none` forever |
| `hold_accumulate` | No fuel cash paid to the driver for this trip; no receipt required | The trip's base fuel allowance moves into the pool once the audit is approved |
| `procure_release` | Trip's effective fuel allowance = its own base allowance **plus** whatever is currently available in the pool | The entire available pool is drained into this trip the moment it's reserved |

### Eligible vehicles

Every `DriverVehicleName` except `Ndalem` (`DEFAULT_DRIVER_VEHICLE_NAME`) can accumulate a balance. Ndalem has a zero fuel rate and is asserted to `standard_direct` everywhere a mode is chosen — `assertAccumulationVehicle()` throws for it, and `createFuelLedgerContext()` silently drops it from the vehicles it loads.

### Balance fields

```ts
interface VehicleFuelBalance {
  vehicleName: DriverVehicleName;
  availableBalance: number;      // spendable pool
  pendingHoldAmount: number;     // held fuel not yet committed into availableBalance
  pendingReleaseAmount: number;  // pool amount claimed by a trip, not yet finalized
}
```

All three fields must stay `>= 0`. `assertBalanceInvariant()` throws (aborting the whole Firestore transaction) the instant a mutation would push any of them negative — this is the mechanism that catches a double-spend rather than letting it silently corrupt the pool.

### Reservation state machine

Every trip that touches the ledger carries one `FuelReservationRecord`, identified by a fresh `fuelReservationId` each time it is (re)created:

```text
   reserveFuel()                commitFuelReservation()
none ────────────► reserved ──────────────────────────► committed  (terminal)
                       │
                       │ releaseFuelReservation()
                       ▼
                    released  (terminal)
```

- **`none`** — `standard_direct` mode, or nothing reserved yet.
- **`reserved`** — `reserveFuel()` moved money into a pending bucket: `hold_accumulate` adds to `pendingHoldAmount`; `procure_release` drains the current `availableBalance` into `pendingReleaseAmount`.
- **`committed`** — `commitFuelReservation()` finalizes the reservation. For `hold_accumulate` the held amount now becomes real `availableBalance` (the pool grows). For `procure_release` nothing further moves — the drained amount was genuinely spent, so `pendingReleaseAmount` just clears without restoring `availableBalance`. **This transition is terminal** — nothing in the codebase can undo a commit.
- **`released`** — `releaseFuelReservation()` returns a pending reservation without finalizing it: `hold_accumulate`'s pending hold is simply discarded (never became available); `procure_release`'s drained amount is restored back to `availableBalance` (the pool is refunded).

Both `commitFuelReservation()` and `releaseFuelReservation()` are idempotent no-ops if the reservation isn't currently `reserved` (`if (reservation.fuelReservationState !== 'reserved') return reservation;`), so a retried request can never double-apply a transition or double-write a ledger event.

## Numeric Walkthroughs

These mirror the scenarios in `src/lib/payroll/vehicleFuel.test.ts`.

**Hold & accumulate** — Suzuki XL7 starts empty.

| Step | availableBalance | pendingHoldAmount |
|---|---|---|
| Reserve BBM 120.000 (`hold_accumulate`) | 0 | 120.000 |
| Commit (audit approved) | **120.000** | 0 |

The driver was paid no fuel cash for that trip; the pool now has 120.000 for the next `procure_release` trip to use.

**Procure & release** — Bis starts with a pool of 500.000.

| Step | availableBalance | pendingReleaseAmount |
|---|---|---|
| Reserve BBM (`procure_release`, base allowance 100.000) | 0 | 500.000 |
| Release (trip cancelled before approval) | **500.000** | 0 |

The whole available pool is claimed the instant the trip reserves against it (not just the amount it needs), because a transaction can't know what a later trip in the same window will draw. If the trip is declined or cancelled, the full amount is refunded. If it's approved instead, the pool stays drained at 0 and the trip's effective fuel allowance for that leg was `100.000 (base) + 500.000 (pool) = 600.000`.

**Reconciling a change of mind** — Bis starts with a pool of 300.000, already holding a `hold_accumulate` reservation of 50.000.

`reconcileFuelReservation()` releases the old reservation first (pending hold back to 0), then reserves the replacement from the resulting balance:

| Step | availableBalance | pendingHoldAmount | pendingReleaseAmount |
|---|---|---|---|
| Start (reserved hold 50.000) | 0 | 50.000 | 0 |
| Release old | 300.000 | 0 | 0 |
| Reserve new (`procure_release`, base 75.000) | 0 | 0 | 300.000 |

`reconcileFuelReservation()` refuses to run at all if the previous reservation was already `committed` — `"Reservasi BBM yang sudah diselesaikan tidak dapat direkonsiliasi."` — because there is no transition that can pull money back out of a committed pool credit or a committed pool spend.

## Where This Happens In The App

### 1. Authorization — `authorize` action

`src/app/api/driver-journeys/route.ts`

Kepala SatKer (or Super Admin) picks the vehicle and fuel mode when creating a `DriverJourneys` document. Ndalem is rejected with any mode other than `standard_direct`. If the mode isn't the default, `reserveFuel()` runs immediately — the pool commitment is visible and pending from the moment of authorization, not deferred to approval. Re-authorizing an existing, not-yet-claimed journey (same `journeyId`) reconciles in place: it throws if the previous reservation was already `committed`, otherwise releases it and reserves the replacement, using the same shape as `reconcileFuelReservation()`.

### 2. Self-authorized Piket SPJ — `create_self` and `select_fuel_mode`

Same file. A driver who self-claims a Piket-duty trip (`isSelfCreatedPiketSpj: true`, no satker pre-authorization) chooses only a vehicle at creation. If that vehicle can accumulate fuel, the mode itself is deferred: `fuelProcurementMode: null, fuelModeSelectionRequired: true`, no reservation exists yet. The driver must call `select_fuel_mode` to actually reserve — locked to one choice per journey; once `fuelModeSelectionRequired` flips to `false`, a repeat call is rejected unless it repeats the same mode (idempotent). `src/app/api/pekarya/activities/route.ts:762` defensively blocks journey-report submission while the flag is still `true`, so a self-created trip can't be reported without ever picking a mode.

### 3. Claim / Cancel Claim — driver actions

Same file. `claim` carries the existing reservation over unchanged. `cancel_claim` releases a currently-`reserved` reservation (refunding a drained pool, discarding a pending hold) and, for self-created journeys, deletes the document entirely rather than returning it to `unassigned`.

### 4. Audit approval — commit

`src/app/api/pekarya/activities/review/route.ts`, `approve_driver` branch.

This is where a `reserved` reservation becomes `committed`. Because the auditor can still change the vehicle or edit figures during audit, the branch is written generically: release the existing reservation if it's `reserved`, then reserve-and-commit again against whatever vehicle/mode the audit ends up with. Once this transaction succeeds, the reservation is `committed` and — per the state machine above — permanently locked.

### 5. Decline — release

Same file, `decline` branch: a `reserved` reservation is released back to the pool instead of committed.

### 6. Re-editing an already-confirmed journey — deliberately blocked for accumulation modes

Same file. A satker_head can reopen an already-*approved* SOPIR journey for correction while its payroll period is still open, but only when `fuelProcurementMode === 'standard_direct'`. Accumulation-mode journeys are rejected with `"...memakai akumulasi BBM yang sudah final; gunakan proses koreksi resmi untuk mengubahnya."` This mirrors `reconcileFuelReservation()`'s own invariant: since nothing can un-commit a `hold_accumulate` pool credit or a `procure_release` pool spend, re-running the audit transaction for those modes would reserve and commit a second time on top of the first, double-counting the ledger. `standard_direct` trips never touch the ledger (state stays `none`), so re-approving them is always safe.

### 7. Manual balance adjustments

`src/app/api/driver-journeys/vehicle-fuel-balances/route.ts` (`POST`).

`applyManualAdjustment()` applies a signed delta directly to `availableBalance`, outside the trip-reservation flow — for corrections like a documented bulk fuel purchase. Requires a reason (8–500 characters) and an idempotent `requestId`; still enforces the non-negative balance invariant, so it cannot be used to overdraw a pool.

## Data Model

### `VehicleFuelBalances/{vehicleName}`

```ts
{
  vehicleName: "Bis",
  availableBalance: 500000,
  pendingHoldAmount: 0,
  pendingReleaseAmount: 0,
  updatedAt: ServerTimestamp,
  updatedBy: "<firebase-user-id>",
  updatedByName: "Nama Aktor",
}
```

One document per accumulation-eligible vehicle (six of the seven `DriverVehicleName`s — everything except Ndalem). Firestore rules close this collection entirely (`allow read, write: if false`), including its `ledger` subcollection, so every mutation must go through the transactional server helpers below; no client can forge a balance or a reservation.

### `VehicleFuelBalances/{vehicleName}/ledger/{eventId}`

Append-only audit trail, one document per state transition. `eventId` is deterministic (`{reservationId}__reserve`, `__commit`, `__release`, or `manual__{requestId}`), so replaying the same logical operation can never double-write the same event — `flushFuelLedger()` writes events with `transaction.create()`, which throws on a colliding id.

```ts
{
  vehicleName, eventType, journeyId, reservationId, mode, amount,
  availableDelta, pendingHoldDelta, pendingReleaseDelta,
  reason, actorUid, actorRole, actorName,
  before: { /* balance snapshot */ }, after: { /* balance snapshot */ },
  createdAt, schemaVersion: 1,
}
```

### Reservation fields mirrored onto `DriverJourneys` / `ActivityReports`

Every document that carries a trip's fuel state stores the same flat fields, produced by `reservationFields()`:

```ts
fuelReservationId, fuelReservationState, fuelReservationVehicleName,
fuelProcurementMode, heldFuelAmount, procuredAccumulatedAmount,
fuelAllowanceForSettlement,  // 0 under hold_accumulate; base + pool otherwise
fuelTotalAllocation,         // base + pool, regardless of mode
```

`reservationFromJourney()` parses these back into a `FuelReservationRecord` before any reservation function runs; it returns `null` for documents written before this feature existed (missing or invalid `fuelProcurementMode`), which every caller treats as "nothing to release, plain standard-direct trip."

## The Transaction-Scoped Ledger Context

`createFuelLedgerContext(transaction, vehicleNames, actor)` is created once per Firestore transaction. It reads every relevant vehicle's current balance up front into an **in-memory working copy** (`balances`), plus an empty **queue of events** (`events`). Every reservation function — `reserveFuel`, `commitFuelReservation`, `releaseFuelReservation`, `reconcileFuelReservation`, `applyManualAdjustment` — mutates only this in-memory copy and queues an event; nothing reaches Firestore until `flushFuelLedger(context)` runs once at the end, writing the final balance (`set` with `merge: true`) and every queued ledger event.

This lets one request that touches several reports against the same vehicle (e.g. a batched audit approval) net out multiple reservation changes before a single balance write, and keeps the whole thing inside one atomic transaction alongside the report/journey document writes it's part of.

## Safety Invariants

- **Balances never go negative.** `assertBalanceInvariant()` aborts the transaction rather than let any field dip below zero.
- **Commit is terminal.** No function moves a reservation out of `committed`. `reconcileFuelReservation()` and the `authorize` re-edit path both explicitly throw if asked to touch one.
- **Commit/release are idempotent.** Re-transitioning an already-transitioned reservation is a no-op — verified in the test suite, and what makes retried requests and re-running approval logic safe.
- **Ledger events can't be double-written.** Deterministic event ids plus `transaction.create()` guarantee at-most-once per logical event.
- **Ndalem never holds a balance.** Enforced at every entry point that accepts a vehicle name.
- **A fresh reservation id every time a trip (re)reserves.** State (`reserved`/`committed`/`released`) always describes one specific reservation instance, never a reused id.

## Roles

| Action | Endpoint / action | Authorized roles |
|---|---|---|
| Choose fuel mode at authorization | `driver-journeys` → `authorize` | `super_admin`, `satker_head` (scoped to `SOPIR`) |
| Choose fuel mode for self-created Piket SPJ | `driver-journeys` → `select_fuel_mode` | `honorer` (Sopir, own journey only) |
| Claim / cancel claim | `driver-journeys` → `claim` / `cancel_claim` | `honorer` (Sopir) |
| Commit reservation (approve audit) | `pekarya/activities/review` → `approve_driver` | `super_admin`, `satker_head` (scoped) |
| Release reservation (decline) | `pekarya/activities/review` → `decline` | `super_admin`, `satker_head` (scoped) |
| Re-edit a confirmed journey (standard_direct only) | `pekarya/activities/review` → `approve_driver` | `super_admin`, `satker_head` (scoped) |
| View fleet balances / per-vehicle ledger | `driver-journeys/vehicle-fuel-balances` → `GET` | `super_admin`, `satker_head` (fleet-wide); Sopir (own journey's vehicle only) |
| Manual balance adjustment | `driver-journeys/vehicle-fuel-balances` → `POST` | `super_admin`, `satker_head` (scoped to `SOPIR`) |

## Affected Files

### Core ledger logic

```text
src/lib/payroll/vehicleFuel.ts
```

Balance and reservation primitives, the transaction-scoped ledger context, `flushFuelLedger`, manual adjustments, and the Firestore read helpers used by the balances API.

### Shared types and pure calculations

```text
src/lib/payroll/driverJourney.ts
```

`FuelProcurementMode`, vehicle name/rate tables, `calculateEffectiveFuelAllowance`, `calculateDriverJourneyOperationalCosts`, `calculateDriverReimbursementSettlement` — the math that turns a reservation's numbers into a trip's operational cost and reimbursement delta.

### API endpoints

```text
src/app/api/driver-journeys/route.ts
src/app/api/driver-journeys/vehicle-fuel-balances/route.ts
src/app/api/pekarya/activities/review/route.ts
src/app/api/pekarya/activities/route.ts
```

Respectively: authorize / create_self / select_fuel_mode / claim / cancel_claim; balance and ledger reads plus manual adjustment; approve_driver (commit) and decline (release) and the confirmed-journey re-edit lock; the `fuelModeSelectionRequired` submission guard.

### UI

```text
src/app/dashboard/payroll/driver-journeys/page.tsx
src/components/DriverJourneyAuditDialog.tsx
src/app/employee/activities/journey-report/page.tsx
```

Respectively: Kepala SatKer's authorization form (mode picker, live cost preview), the fleet balance cards and per-vehicle ledger viewer, and the manual adjustment control; the audit dialog's mode badge ("Mode terkunci setelah klaim"), hold/pool figures, and the fuel-lock notice shown when a confirmed journey can't be re-edited; the driver-side mode-selection prompt shown for a self-created Piket SPJ journey still needing `select_fuel_mode`.

## Firestore Security Rules

```text
Current_Firestore_Rules.md
```

`VehicleFuelBalances/{vehicleName}` and its `ledger` subcollection are fully closed to clients (`allow read, write: if false`). Every balance read goes through the authenticated `vehicle-fuel-balances` API, and every mutation goes through the admin-SDK transactional helpers in `vehicleFuel.ts` — clients cannot forge a reservation, balance, or ledger entry.

## Summary

`standard_direct` is the unmodified legacy path: fuel is cash, per trip, no ledger involved. `hold_accumulate` and `procure_release` route a trip's fuel through a shared per-vehicle pool instead, using a `reserved → committed | released` state machine to keep that pool's three balance fields correct across authorization, claiming, audit approval, decline, and cancellation — all inside atomic Firestore transactions with an append-only event trail. The one deliberate limitation this creates elsewhere in the app is that a `committed` reservation can never be undone, which is why post-approval corrections to a driver journey are only allowed when that journey's fuel was `standard_direct`.
