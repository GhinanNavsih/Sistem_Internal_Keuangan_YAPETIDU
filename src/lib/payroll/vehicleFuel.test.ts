import assert from 'node:assert/strict';
import test from 'node:test';
import {
  commitFuelReservation,
  createFuelLedgerContext,
  flushFuelLedger,
  getBalanceFromContext,
  reconcileFuelReservation,
  releaseFuelReservation,
  reservationFields,
  reservationFromJourney,
  reserveFuel,
  setVehicleFuelBalance,
  VehicleFuelConflictError,
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

test('hold authorization consumes available balance and approval moves it to accumulation once', async () => {
  const context = await createContext({
    'Suzuki XL7': { vehicleName: 'Suzuki XL7', availableBalance: 300_000 },
  });
  const reservation = reserveFuel(context, {
    journeyId: 'JRN-HOLD',
    reservationId: 'FUEL-HOLD',
    vehicleName: 'Suzuki XL7',
    mode: 'hold_accumulate',
    baseFuelAllowance: 120_000,
    reason: 'Reservasi hold untuk perjalanan',
  });
  assert.deepEqual(getBalanceFromContext(context, 'Suzuki XL7'), {
    vehicleName: 'Suzuki XL7',
    availableBalance: 180_000,
    pendingHoldAmount: 120_000,
    accumulatedHoldAmount: 0,
    pendingReleaseAmount: 0,
    schemaVersion: 2,
    updatedAt: undefined,
    updatedBy: undefined,
    updatedByName: undefined,
  });

  const committed = commitFuelReservation(context, reservation, 'JRN-HOLD');
  assert.equal(committed.fuelReservationState, 'committed');
  assert.deepEqual(getBalanceFromContext(context, 'Suzuki XL7'), {
    vehicleName: 'Suzuki XL7',
    availableBalance: 180_000,
    pendingHoldAmount: 0,
    accumulatedHoldAmount: 120_000,
    pendingReleaseAmount: 0,
    schemaVersion: 2,
    updatedAt: undefined,
    updatedBy: undefined,
    updatedByName: undefined,
  });
  const eventCount = context.events.length;
  assert.equal(commitFuelReservation(context, committed, 'JRN-HOLD').fuelReservationState, 'committed');
  assert.equal(context.events.length, eventCount);
});

test('hold authorization rejects an insufficient available balance without mutating it', async () => {
  const context = await createContext({
    Bis: { vehicleName: 'Bis', availableBalance: 20_000 },
  });
  assert.throws(
    () => reserveFuel(context, {
      journeyId: 'JRN-INSUFFICIENT',
      reservationId: 'FUEL-INSUFFICIENT',
      vehicleName: 'Bis',
      mode: 'hold_accumulate',
      baseFuelAllowance: 25_000,
      reason: 'Saldo tidak mencukupi',
    }),
    VehicleFuelConflictError,
  );
  assert.equal(getBalanceFromContext(context, 'Bis').availableBalance, 20_000);
  assert.equal(context.events.length, 0);
});

test('new fuel ledger balances omit undefined metadata and capture correct audit snapshots', async () => {
  const createdDocuments: Array<Record<string, unknown>> = [];
  const transaction = {
    get: async () => ({
      exists: true,
      data: () => ({ vehicleName: 'Bis', availableBalance: 200_000 }),
    }),
    set: () => undefined,
    create: (_ref: unknown, data: Record<string, unknown>) => {
      createdDocuments.push(data);
    },
  } as unknown as FirebaseFirestore.Transaction;
  const context = await createFuelLedgerContext(
    transaction,
    ['Bis'],
    { uid: 'test-manager', displayName: 'Test Manager', role: 'satker_head' },
  );

  reserveFuel(context, {
    journeyId: 'JRN-SERIALIZE',
    reservationId: 'FUEL-SERIALIZE',
    vehicleName: 'Bis',
    mode: 'hold_accumulate',
    baseFuelAllowance: 120_000,
    reason: 'Uji serialisasi audit',
  });
  flushFuelLedger(context);

  assert.equal(createdDocuments.length, 1);
  const ledgerDocument = createdDocuments[0];
  const before = ledgerDocument.before as Record<string, unknown>;
  const after = ledgerDocument.after as Record<string, unknown>;
  assert.equal('updatedAt' in before, false);
  assert.equal('updatedBy' in before, false);
  assert.equal('updatedByName' in before, false);
  assert.equal('updatedAt' in after, false);
  assert.equal('updatedBy' in after, false);
  assert.equal('updatedByName' in after, false);
  assert.equal(before.availableBalance, 200_000);
  assert.equal(after.availableBalance, 80_000);
  assert.equal(after.pendingHoldAmount, 120_000);
  assert.equal(ledgerDocument.availableDelta, -120_000);
  assert.equal(ledgerDocument.schemaVersion, 2);
  assert.equal(ledgerDocument.reservationVersion, 2);
});

test('cancellation restores locked accumulation and pending hold reservations', async () => {
  const context = await createContext({
    Bis: {
      vehicleName: 'Bis',
      availableBalance: 500_000,
      accumulatedHoldAmount: 200_000,
    },
  });
  const procure = reserveFuel(context, {
    journeyId: 'JRN-PROCURE',
    reservationId: 'FUEL-PROCURE',
    vehicleName: 'Bis',
    mode: 'procure_release',
    baseFuelAllowance: 100_000,
    reason: 'Reservasi procure untuk perjalanan',
  });
  assert.equal(procure.procuredAccumulatedAmount, 200_000);
  assert.equal(getBalanceFromContext(context, 'Bis').availableBalance, 500_000);
  assert.equal(getBalanceFromContext(context, 'Bis').accumulatedHoldAmount, 0);
  assert.equal(getBalanceFromContext(context, 'Bis').pendingReleaseAmount, 200_000);

  const released = releaseFuelReservation(context, procure, 'Perjalanan dibatalkan', 'JRN-PROCURE');
  assert.equal(released.fuelReservationState, 'released');
  assert.equal(getBalanceFromContext(context, 'Bis').availableBalance, 500_000);
  assert.equal(getBalanceFromContext(context, 'Bis').accumulatedHoldAmount, 200_000);
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
  assert.equal(getBalanceFromContext(context, 'Bis').availableBalance, 420_000);
  assert.equal(getBalanceFromContext(context, 'Bis').pendingHoldAmount, 80_000);
  releaseFuelReservation(context, hold, 'Perjalanan dibatalkan', 'JRN-HOLD-2');
  assert.equal(getBalanceFromContext(context, 'Bis').pendingHoldAmount, 0);
  assert.equal(getBalanceFromContext(context, 'Bis').availableBalance, 500_000);
});

test('Cairkan combines accumulated holds with the current journey allowance', async () => {
  const context = await createContext({
    Bis: {
      vehicleName: 'Bis',
      availableBalance: 20_000,
      accumulatedHoldAmount: 260_000,
    },
  });
  const reservation = reserveFuel(context, {
    journeyId: 'JRN-CAIR',
    reservationId: 'FUEL-CAIR',
    vehicleName: 'Bis',
    mode: 'procure_release',
    baseFuelAllowance: 20_000,
    reason: 'Cairkan akumulasi kendaraan',
  });

  assert.equal(reservation.procuredAccumulatedAmount, 260_000);
  assert.equal(getBalanceFromContext(context, 'Bis').availableBalance, 20_000);
  assert.equal(getBalanceFromContext(context, 'Bis').accumulatedHoldAmount, 0);
  assert.equal(getBalanceFromContext(context, 'Bis').pendingReleaseAmount, 260_000);
  assert.equal(reservationFields(reservation).fuelAllowanceForSettlement, 280_000);
});

for (const [label, actualFuelExpenditure, expectedAvailable] of [
  ['equal allowance', 280_000, 300_000],
  ['above allowance', 300_000, 320_000],
  ['below allowance', 250_000, 270_000],
] as const) {
  test(`Cairkan approval adds ${label} actual fuel expenditure to Tersedia`, async () => {
    const context = await createContext({
      Bis: {
        vehicleName: 'Bis',
        availableBalance: 20_000,
        accumulatedHoldAmount: 260_000,
      },
    });
    const reservation = reserveFuel(context, {
      journeyId: `JRN-CAIR-${actualFuelExpenditure}`,
      reservationId: `FUEL-CAIR-${actualFuelExpenditure}`,
      vehicleName: 'Bis',
      mode: 'procure_release',
      baseFuelAllowance: 20_000,
      reason: 'Cairkan akumulasi kendaraan',
    });
    const committed = commitFuelReservation(
      context,
      reservation,
      `JRN-CAIR-${actualFuelExpenditure}`,
      actualFuelExpenditure,
    );
    assert.equal(committed.fuelReservationState, 'committed');
    assert.equal(getBalanceFromContext(context, 'Bis').availableBalance, expectedAvailable);
    assert.equal(getBalanceFromContext(context, 'Bis').accumulatedHoldAmount, 0);
    assert.equal(getBalanceFromContext(context, 'Bis').pendingReleaseAmount, 0);
    const eventCount = context.events.length;
    commitFuelReservation(context, committed, 'JRN-IDEMPOTENT', actualFuelExpenditure);
    assert.equal(context.events.length, eventCount);
    assert.equal(getBalanceFromContext(context, 'Bis').availableBalance, expectedAvailable);
  });
}

test('Cairkan cannot commit without a positive approved fuel expenditure', async () => {
  const context = await createContext({
    Bis: {
      vehicleName: 'Bis',
      availableBalance: 20_000,
      accumulatedHoldAmount: 260_000,
    },
  });
  const reservation = reserveFuel(context, {
    journeyId: 'JRN-CAIR-ZERO',
    reservationId: 'FUEL-CAIR-ZERO',
    vehicleName: 'Bis',
    mode: 'procure_release',
    baseFuelAllowance: 20_000,
    reason: 'Cairkan tanpa aktual',
  });
  assert.throws(
    () => commitFuelReservation(context, reservation, 'JRN-CAIR-ZERO', 0),
    VehicleFuelConflictError,
  );
  assert.equal(getBalanceFromContext(context, 'Bis').pendingReleaseAmount, 260_000);
  assert.equal(getBalanceFromContext(context, 'Bis').availableBalance, 20_000);
});

test('reconciliation releases the old hold before locking accumulated funds', async () => {
  const context = await createContext({
    Bis: {
      vehicleName: 'Bis',
      availableBalance: 300_000,
      accumulatedHoldAmount: 125_000,
    },
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
  assert.equal(replacement.procuredAccumulatedAmount, 125_000);
  assert.deepEqual(getBalanceFromContext(context, 'Bis'), {
    vehicleName: 'Bis',
    availableBalance: 300_000,
    pendingHoldAmount: 0,
    accumulatedHoldAmount: 0,
    pendingReleaseAmount: 125_000,
    schemaVersion: 2,
    updatedAt: undefined,
    updatedBy: undefined,
    updatedByName: undefined,
  });
});

test('setting a saldo records the calculated signed delta as an append-only event', async () => {
  const context = await createContext({
    Bis: { vehicleName: 'Bis', availableBalance: 1_000_000 },
  });
  setVehicleFuelBalance(context, {
    vehicleName: 'Bis',
    targetBalance: 1_250_000,
    reason: 'Koreksi dokumen pembelian',
    requestId: 'REQ-ADD-1',
  });
  setVehicleFuelBalance(context, {
    vehicleName: 'Bis',
    targetBalance: 1_150_000,
    reason: 'Koreksi pembatalan pembelian',
    requestId: 'REQ-ADD-2',
  });
  assert.equal(getBalanceFromContext(context, 'Bis').availableBalance, 1_150_000);
  assert.equal(context.events.length, 2);
  assert.equal(context.events[0].input.availableDelta, 250_000);
  assert.equal(context.events[1].input.availableDelta, -100_000);
  assert.throws(() => setVehicleFuelBalance(context, {
    vehicleName: 'Bis',
    targetBalance: -1,
    reason: 'Saldo baru tidak valid',
    requestId: 'REQ-ADD-3',
  }));
  assert.equal(getBalanceFromContext(context, 'Bis').availableBalance, 1_150_000);
  assert.equal(context.events.length, 2);
});

test('legacy reservations remain version 1 and use their original transition rules', async () => {
  const context = await createContext({
    Bis: {
      vehicleName: 'Bis',
      availableBalance: 0,
      pendingHoldAmount: 100_000,
    },
  });
  const legacyHold = reservationFromJourney({
    fuelReservationId: 'FUEL-LEGACY-HOLD',
    fuelReservationState: 'reserved',
    fuelReservationVehicleName: 'Bis',
    fuelProcurementMode: 'hold_accumulate',
    baseOperationalCost: 100_000,
    heldFuelAmount: 100_000,
  });
  assert.ok(legacyHold);
  assert.equal(legacyHold!.fuelReservationVersion, 1);
  commitFuelReservation(context, legacyHold!, 'JRN-LEGACY-HOLD');
  assert.equal(getBalanceFromContext(context, 'Bis').availableBalance, 100_000);
  assert.equal(getBalanceFromContext(context, 'Bis').pendingHoldAmount, 0);
  assert.equal(getBalanceFromContext(context, 'Bis').accumulatedHoldAmount, 0);
});

test('journey reservation fields include a version marker and preserve legacy standard behavior', () => {
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
    fuelReservationVersion: 1,
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

test('hold reservations expose no cash fuel allocation', async () => {
  const context = await createContext({
    Bis: { vehicleName: 'Bis', availableBalance: 200_000 },
  });
  const reservation = reserveFuel(context, {
    journeyId: 'JRN-HOLD-FIELDS',
    reservationId: 'FUEL-HOLD-FIELDS',
    vehicleName: 'Bis',
    mode: 'hold_accumulate',
    baseFuelAllowance: 200_000,
    reason: 'Uji field cash BBM',
  });

  assert.deepEqual(reservationFields(reservation), {
    fuelReservationVersion: 2,
    fuelReservationId: 'FUEL-HOLD-FIELDS',
    fuelReservationState: 'reserved',
    fuelReservationVehicleName: 'Bis',
    fuelProcurementMode: 'hold_accumulate',
    heldFuelAmount: 200_000,
    procuredAccumulatedAmount: 0,
    fuelAllowanceForSettlement: 0,
    fuelTotalAllocation: 0,
  });
});
