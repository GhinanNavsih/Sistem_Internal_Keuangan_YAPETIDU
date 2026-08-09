import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyManualAdjustment,
  commitFuelReservation,
  createFuelLedgerContext,
  getBalanceFromContext,
  reconcileFuelReservation,
  releaseFuelReservation,
  reservationFields,
  reservationFromJourney,
  reserveFuel,
} from './vehicleFuel';

function fakeTransaction(initial: Record<string, Record<string, unknown>> = {}) {
  return {
    get: async (ref: { id: string }) => ({
      exists: Boolean(initial[ref.id]),
      data: () => initial[ref.id],
    }),
    set: () => undefined,
    create: () => undefined,
  } as unknown as FirebaseFirestore.Transaction;
}

async function createContext(initial: Record<string, Record<string, unknown>> = {}) {
  return createFuelLedgerContext(
    fakeTransaction(initial),
    ['Suzuki XL7', 'Bis', 'Ndalem'],
    { uid: 'test-manager', displayName: 'Test Manager', role: 'satker_head' },
  );
}

test('vehicle fuel contexts exclude Ndalem and reject accumulation for it', async () => {
  const context = await createContext();
  assert.deepEqual([...context.balances.keys()], ['Suzuki XL7', 'Bis']);
  assert.throws(() => getBalanceFromContext(context, 'Ndalem'));
  assert.throws(() => reserveFuel(context, {
    journeyId: 'JRN-1',
    reservationId: 'FUEL-1',
    vehicleName: 'Ndalem',
    mode: 'hold_accumulate',
    baseFuelAllowance: 100,
    reason: 'Tidak berlaku',
  }));
});

test('hold reservations move pending hold to available exactly once', async () => {
  const context = await createContext();
  const reservation = reserveFuel(context, {
    journeyId: 'JRN-HOLD',
    reservationId: 'FUEL-HOLD',
    vehicleName: 'Suzuki XL7',
    mode: 'hold_accumulate',
    baseFuelAllowance: 120_000,
    reason: 'Reservasi hold untuk perjalanan',
  });
  assert.equal(getBalanceFromContext(context, 'Suzuki XL7').pendingHoldAmount, 120_000);
  assert.equal(getBalanceFromContext(context, 'Suzuki XL7').availableBalance, 0);

  const committed = commitFuelReservation(context, reservation, 'JRN-HOLD');
  assert.equal(committed.fuelReservationState, 'committed');
  assert.deepEqual(getBalanceFromContext(context, 'Suzuki XL7'), {
    vehicleName: 'Suzuki XL7',
    availableBalance: 120_000,
    pendingHoldAmount: 0,
    pendingReleaseAmount: 0,
    updatedAt: undefined,
    updatedBy: undefined,
    updatedByName: undefined,
  });
  const eventCount = context.events.length;
  assert.equal(commitFuelReservation(context, committed, 'JRN-HOLD').fuelReservationState, 'committed');
  assert.equal(context.events.length, eventCount);
});

test('release reservations restores procure pools and hold pending amounts', async () => {
  const context = await createContext({
    Bis: { vehicleName: 'Bis', availableBalance: 500_000 },
  });
  const procure = reserveFuel(context, {
    journeyId: 'JRN-PROCURE',
    reservationId: 'FUEL-PROCURE',
    vehicleName: 'Bis',
    mode: 'procure_release',
    baseFuelAllowance: 100_000,
    reason: 'Reservasi procure untuk perjalanan',
  });
  assert.equal(procure.procuredAccumulatedAmount, 500_000);
  assert.equal(getBalanceFromContext(context, 'Bis').availableBalance, 0);
  assert.equal(getBalanceFromContext(context, 'Bis').pendingReleaseAmount, 500_000);

  const released = releaseFuelReservation(context, procure, 'Perjalanan dibatalkan', 'JRN-PROCURE');
  assert.equal(released.fuelReservationState, 'released');
  assert.equal(getBalanceFromContext(context, 'Bis').availableBalance, 500_000);
  assert.equal(getBalanceFromContext(context, 'Bis').pendingReleaseAmount, 0);
  const eventCount = context.events.length;
  releaseFuelReservation(context, released, 'Duplikat pembatalan', 'JRN-PROCURE');
  assert.equal(context.events.length, eventCount);

  const hold = reserveFuel(context, {
    journeyId: 'JRN-HOLD-2',
    reservationId: 'FUEL-HOLD-2',
    vehicleName: 'Bis',
    mode: 'hold_accumulate',
    baseFuelAllowance: 80_000,
    reason: 'Reservasi hold kedua',
  });
  assert.equal(getBalanceFromContext(context, 'Bis').pendingHoldAmount, 80_000);
  releaseFuelReservation(context, hold, 'Perjalanan dibatalkan', 'JRN-HOLD-2');
  assert.equal(getBalanceFromContext(context, 'Bis').pendingHoldAmount, 0);
  assert.equal(getBalanceFromContext(context, 'Bis').availableBalance, 500_000);
});

test('reconciliation releases the old reservation before reserving the replacement', async () => {
  const context = await createContext({
    Bis: { vehicleName: 'Bis', availableBalance: 300_000 },
  });
  const oldReservation = reserveFuel(context, {
    journeyId: 'JRN-RECONCILE',
    reservationId: 'FUEL-OLD',
    vehicleName: 'Bis',
    mode: 'hold_accumulate',
    baseFuelAllowance: 50_000,
    reason: 'Reservasi lama',
  });
  const replacement = reconcileFuelReservation(context, {
    previousReservation: oldReservation,
    journeyId: 'JRN-RECONCILE',
    reservationId: 'FUEL-NEW',
    vehicleName: 'Bis',
    mode: 'procure_release',
    baseFuelAllowance: 75_000,
    reason: 'Koreksi kendaraan dan mode',
  });
  assert.equal(replacement.fuelReservationState, 'reserved');
  assert.equal(replacement.procuredAccumulatedAmount, 300_000);
  assert.deepEqual(getBalanceFromContext(context, 'Bis'), {
    vehicleName: 'Bis',
    availableBalance: 0,
    pendingHoldAmount: 0,
    pendingReleaseAmount: 300_000,
    updatedAt: undefined,
    updatedBy: undefined,
    updatedByName: undefined,
  });
});

test('manual adjustments are signed, append-only events, and cannot overdraw', async () => {
  const context = await createContext({
    Bis: { vehicleName: 'Bis', availableBalance: 1_000_000 },
  });
  applyManualAdjustment(context, {
    vehicleName: 'Bis',
    delta: 250_000,
    reason: 'Koreksi dokumen pembelian',
    requestId: 'REQ-ADD-1',
  });
  applyManualAdjustment(context, {
    vehicleName: 'Bis',
    delta: -100_000,
    reason: 'Koreksi pembatalan pembelian',
    requestId: 'REQ-ADD-2',
  });
  assert.equal(getBalanceFromContext(context, 'Bis').availableBalance, 1_150_000);
  assert.equal(context.events.length, 2);
  assert.throws(() => applyManualAdjustment(context, {
    vehicleName: 'Bis',
    delta: -2_000_000,
    reason: 'Saldo tidak mencukupi',
    requestId: 'REQ-ADD-3',
  }));
});

test('journey reservation parsing preserves legacy standard behavior and fields are serializable', () => {
  assert.equal(reservationFromJourney({ fuelProcurementMode: undefined }), null);
  const reservation = reservationFromJourney({
    fuelReservationId: 'FUEL-LEGACY',
    fuelReservationState: 'none',
    fuelReservationVehicleName: 'Suzuki XL7',
    fuelProcurementMode: 'standard_direct',
    baseOperationalCost: 200_000,
  });
  assert.ok(reservation);
  assert.deepEqual(reservationFields(reservation!), {
    fuelReservationId: 'FUEL-LEGACY',
    fuelReservationState: 'none',
    fuelReservationVehicleName: 'Suzuki XL7',
    fuelProcurementMode: 'standard_direct',
    heldFuelAmount: 0,
    procuredAccumulatedAmount: 0,
    fuelAllowanceForSettlement: 200_000,
    fuelTotalAllocation: 200_000,
  });
});
