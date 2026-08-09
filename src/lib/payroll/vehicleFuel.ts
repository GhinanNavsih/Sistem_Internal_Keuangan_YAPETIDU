import admin, { adminDb } from '@/lib/firebase-admin';
import {
  DEFAULT_DRIVER_VEHICLE_NAME,
  DRIVER_VEHICLE_NAMES,
  isDriverVehicleName,
  isFuelAccumulationVehicle,
  type DriverVehicleName,
  type FuelProcurementMode,
} from '@/lib/payroll/driverJourney';

export const VEHICLE_FUEL_BALANCES_COLLECTION = 'VehicleFuelBalances';
export const VEHICLE_FUEL_LEDGER_SUBCOLLECTION = 'ledger';
export const MAX_VEHICLE_FUEL_ADJUSTMENT = 100_000_000;

export type FuelReservationState = 'none' | 'reserved' | 'committed' | 'released';

export interface VehicleFuelBalance {
  vehicleName: DriverVehicleName;
  availableBalance: number;
  pendingHoldAmount: number;
  pendingReleaseAmount: number;
  updatedAt?: unknown;
  updatedBy?: string;
  updatedByName?: string;
}

export interface FuelReservationRecord {
  fuelReservationId: string;
  fuelReservationState: FuelReservationState;
  fuelReservationVehicleName: DriverVehicleName;
  fuelProcurementMode: FuelProcurementMode;
  baseFuelAllowance: number;
  heldFuelAmount: number;
  procuredAccumulatedAmount: number;
}

export interface FuelLedgerActor {
  uid: string;
  displayName?: string | null;
  role?: string | null;
}

interface FuelLedgerEventInput {
  eventId: string;
  eventType:
    | 'reserve_hold'
    | 'commit_hold'
    | 'release_hold'
    | 'reserve_release'
    | 'commit_release'
    | 'release_release'
    | 'manual_adjustment';
  journeyId?: string;
  reservationId?: string;
  mode?: FuelProcurementMode;
  amount: number;
  availableDelta: number;
  pendingHoldDelta: number;
  pendingReleaseDelta: number;
  reason: string;
  actor: FuelLedgerActor;
}

interface MutableVehicleFuelBalance extends VehicleFuelBalance {
  exists: boolean;
}

export interface FuelLedgerContext {
  transaction: FirebaseFirestore.Transaction;
  balances: Map<DriverVehicleName, MutableVehicleFuelBalance>;
  events: Array<{ vehicleName: DriverVehicleName; input: FuelLedgerEventInput; before: VehicleFuelBalance; after: VehicleFuelBalance }>;
  actor: FuelLedgerActor;
}

function assertAccumulationVehicle(vehicleName: string): asserts vehicleName is DriverVehicleName {
  if (!isDriverVehicleName(vehicleName) || !isFuelAccumulationVehicle(vehicleName)) {
    throw new Error('Kendaraan ini tidak memiliki saldo akumulasi BBM.');
  }
}

function integerMoney(
  value: unknown,
  fieldName: string,
  maximum = MAX_VEHICLE_FUEL_ADJUSTMENT,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > maximum
  ) {
    throw new Error(`${fieldName} tidak valid.`);
  }
  return Math.ceil(value);
}

function signedAdjustment(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    Math.abs(value) > MAX_VEHICLE_FUEL_ADJUSTMENT
  ) {
    throw new Error('Penyesuaian saldo BBM tidak valid.');
  }
  return Math.trunc(value);
}

function emptyBalance(vehicleName: DriverVehicleName): MutableVehicleFuelBalance {
  return {
    vehicleName,
    availableBalance: 0,
    pendingHoldAmount: 0,
    pendingReleaseAmount: 0,
    exists: false,
  };
}

function normalizeBalance(
  vehicleName: DriverVehicleName,
  data?: FirebaseFirestore.DocumentData,
): MutableVehicleFuelBalance {
  const value = emptyBalance(vehicleName);
  if (!data) return value;
  value.exists = true;
  value.availableBalance = integerMoney(Number(data.availableBalance || 0), 'Saldo tersedia', Number.MAX_SAFE_INTEGER);
  value.pendingHoldAmount = integerMoney(Number(data.pendingHoldAmount || 0), 'Saldo hold tertunda', Number.MAX_SAFE_INTEGER);
  value.pendingReleaseAmount = integerMoney(Number(data.pendingReleaseAmount || 0), 'Saldo pencairan tertunda', Number.MAX_SAFE_INTEGER);
  value.updatedAt = data.updatedAt;
  value.updatedBy = typeof data.updatedBy === 'string' ? data.updatedBy : undefined;
  value.updatedByName = typeof data.updatedByName === 'string' ? data.updatedByName : undefined;
  return value;
}

function balanceRef(vehicleName: DriverVehicleName) {
  return adminDb.collection(VEHICLE_FUEL_BALANCES_COLLECTION).doc(vehicleName);
}

function ledgerRef(vehicleName: DriverVehicleName, eventId: string) {
  return balanceRef(vehicleName).collection(VEHICLE_FUEL_LEDGER_SUBCOLLECTION).doc(eventId);
}

function publicBalance(balance: MutableVehicleFuelBalance): VehicleFuelBalance {
  return {
    vehicleName: balance.vehicleName,
    availableBalance: balance.availableBalance,
    pendingHoldAmount: balance.pendingHoldAmount,
    pendingReleaseAmount: balance.pendingReleaseAmount,
    updatedAt: balance.updatedAt,
    updatedBy: balance.updatedBy,
    updatedByName: balance.updatedByName,
  };
}

function snapshotForEvent(balance: MutableVehicleFuelBalance): VehicleFuelBalance {
  return publicBalance(balance);
}

function assertBalanceInvariant(balance: MutableVehicleFuelBalance): void {
  for (const [field, value] of [
    ['availableBalance', balance.availableBalance],
    ['pendingHoldAmount', balance.pendingHoldAmount],
    ['pendingReleaseAmount', balance.pendingReleaseAmount],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`Saldo BBM ${field} tidak boleh negatif.`);
    }
  }
}

function queueEvent(
  context: FuelLedgerContext,
  vehicleName: DriverVehicleName,
  input: FuelLedgerEventInput,
  before: MutableVehicleFuelBalance,
): void {
  const after = publicBalance(before);
  context.events.push({
    vehicleName,
    input,
    before: snapshotForEvent(before),
    after,
  });
}

export async function createFuelLedgerContext(
  transaction: FirebaseFirestore.Transaction,
  vehicleNames: Iterable<string>,
  actor: FuelLedgerActor,
): Promise<FuelLedgerContext> {
  const names = [...new Set([...vehicleNames].filter((value) => value !== DEFAULT_DRIVER_VEHICLE_NAME))];
  names.forEach(assertAccumulationVehicle);
  const typedNames = names as DriverVehicleName[];
  const snapshots = await Promise.all(
    typedNames.map((vehicleName) => transaction.get(balanceRef(vehicleName))),
  );
  return {
    transaction,
    balances: new Map(
      typedNames.map((vehicleName, index) => [
        vehicleName,
        normalizeBalance(vehicleName, snapshots[index]?.exists ? snapshots[index].data() : undefined),
      ]),
    ),
    events: [],
    actor,
  };
}

export function getBalanceFromContext(
  context: FuelLedgerContext,
  vehicleName: DriverVehicleName,
): VehicleFuelBalance {
  assertAccumulationVehicle(vehicleName);
  return publicBalance(context.balances.get(vehicleName) || emptyBalance(vehicleName));
}

export function reserveFuel(
  context: FuelLedgerContext,
  input: {
    journeyId: string;
    reservationId: string;
    vehicleName: DriverVehicleName;
    mode: FuelProcurementMode;
    baseFuelAllowance: number;
    reason: string;
  },
): FuelReservationRecord {
  const baseFuelAllowance = integerMoney(input.baseFuelAllowance, 'Jatah BBM dasar');
  if (input.mode === 'standard_direct') {
    return {
      fuelReservationId: input.reservationId,
      fuelReservationState: 'none',
      fuelReservationVehicleName: input.vehicleName,
      fuelProcurementMode: input.mode,
      baseFuelAllowance,
      heldFuelAmount: 0,
      procuredAccumulatedAmount: 0,
    };
  }
  assertAccumulationVehicle(input.vehicleName);
  const balance = context.balances.get(input.vehicleName) || emptyBalance(input.vehicleName);
  const before = { ...balance };
  const heldFuelAmount = input.mode === 'hold_accumulate' ? baseFuelAllowance : 0;
  const procuredAccumulatedAmount = input.mode === 'procure_release'
    ? balance.availableBalance
    : 0;
  if (input.mode === 'hold_accumulate') {
    balance.pendingHoldAmount += heldFuelAmount;
  } else {
    balance.availableBalance -= procuredAccumulatedAmount;
    balance.pendingReleaseAmount += procuredAccumulatedAmount;
  }
  assertBalanceInvariant(balance);
  context.balances.set(input.vehicleName, balance);
  queueEvent(context, input.vehicleName, {
    eventId: `${input.reservationId}__reserve`,
    eventType: input.mode === 'hold_accumulate' ? 'reserve_hold' : 'reserve_release',
    journeyId: input.journeyId,
    reservationId: input.reservationId,
    mode: input.mode,
    amount: heldFuelAmount || procuredAccumulatedAmount,
    availableDelta: balance.availableBalance - before.availableBalance,
    pendingHoldDelta: balance.pendingHoldAmount - before.pendingHoldAmount,
    pendingReleaseDelta: balance.pendingReleaseAmount - before.pendingReleaseAmount,
    reason: input.reason,
    actor: context.actor,
  }, before);
  return {
    fuelReservationId: input.reservationId,
    fuelReservationState: 'reserved',
    fuelReservationVehicleName: input.vehicleName,
    fuelProcurementMode: input.mode,
    baseFuelAllowance,
    heldFuelAmount,
    procuredAccumulatedAmount,
  };
}

function transitionReservation(
  context: FuelLedgerContext,
  reservation: FuelReservationRecord,
  transition: 'commit' | 'release',
  reason: string,
  journeyId?: string,
): FuelReservationRecord {
  if (reservation.fuelReservationState !== 'reserved') return reservation;
  if (reservation.fuelProcurementMode === 'standard_direct') {
    return { ...reservation, fuelReservationState: transition === 'commit' ? 'committed' : 'released' };
  }
  const vehicleName = reservation.fuelReservationVehicleName;
  assertAccumulationVehicle(vehicleName);
  const balance = context.balances.get(vehicleName) || emptyBalance(vehicleName);
  const before = { ...balance };
  if (reservation.fuelProcurementMode === 'hold_accumulate') {
    balance.pendingHoldAmount -= reservation.heldFuelAmount;
    if (transition === 'commit') balance.availableBalance += reservation.heldFuelAmount;
  } else {
    balance.pendingReleaseAmount -= reservation.procuredAccumulatedAmount;
    if (transition === 'release') balance.availableBalance += reservation.procuredAccumulatedAmount;
  }
  assertBalanceInvariant(balance);
  context.balances.set(vehicleName, balance);
  const eventType = reservation.fuelProcurementMode === 'hold_accumulate'
    ? (transition === 'commit' ? 'commit_hold' : 'release_hold')
    : (transition === 'commit' ? 'commit_release' : 'release_release');
  queueEvent(context, vehicleName, {
    eventId: `${reservation.fuelReservationId}__${transition}`,
    eventType,
    journeyId,
    reservationId: reservation.fuelReservationId,
    mode: reservation.fuelProcurementMode,
    amount: reservation.heldFuelAmount || reservation.procuredAccumulatedAmount,
    availableDelta: balance.availableBalance - before.availableBalance,
    pendingHoldDelta: balance.pendingHoldAmount - before.pendingHoldAmount,
    pendingReleaseDelta: balance.pendingReleaseAmount - before.pendingReleaseAmount,
    reason,
    actor: context.actor,
  }, before);
  return {
    ...reservation,
    fuelReservationState: transition === 'commit' ? 'committed' : 'released',
  };
}

export function commitFuelReservation(
  context: FuelLedgerContext,
  reservation: FuelReservationRecord,
  journeyId?: string,
): FuelReservationRecord {
  return transitionReservation(context, reservation, 'commit', 'Persetujuan audit perjalanan', journeyId);
}

export function releaseFuelReservation(
  context: FuelLedgerContext,
  reservation: FuelReservationRecord,
  reason: string,
  journeyId?: string,
): FuelReservationRecord {
  return transitionReservation(context, reservation, 'release', reason, journeyId);
}

/**
 * Atomically reconciles a journey's prior reservation with a new vehicle/mode
 * selection. This is used by authorization and audit corrections: the old
 * hold/release is returned first, then the replacement reservation is created
 * from the same transaction-local balance snapshot.
 */
export function reconcileFuelReservation(
  context: FuelLedgerContext,
  input: {
    previousReservation?: FuelReservationRecord | null;
    journeyId: string;
    reservationId: string;
    vehicleName: DriverVehicleName;
    mode: FuelProcurementMode;
    baseFuelAllowance: number;
    reason: string;
  },
): FuelReservationRecord {
  if (input.previousReservation?.fuelReservationState === 'committed') {
    throw new Error('Reservasi BBM yang sudah diselesaikan tidak dapat direkonsiliasi.');
  }
  if (input.previousReservation?.fuelReservationState === 'reserved') {
    releaseFuelReservation(
      context,
      input.previousReservation,
      `${input.reason}: lepaskan reservasi lama`,
      input.journeyId,
    );
  }
  return reserveFuel(context, {
    journeyId: input.journeyId,
    reservationId: input.reservationId,
    vehicleName: input.vehicleName,
    mode: input.mode,
    baseFuelAllowance: input.baseFuelAllowance,
    reason: input.reason,
  });
}

export function applyManualAdjustment(
  context: FuelLedgerContext,
  input: {
    vehicleName: DriverVehicleName;
    delta: number;
    reason: string;
    requestId: string;
  },
): VehicleFuelBalance {
  assertAccumulationVehicle(input.vehicleName);
  const delta = signedAdjustment(input.delta);
  if (!input.reason.trim()) throw new Error('Alasan penyesuaian saldo wajib diisi.');
  const balance = context.balances.get(input.vehicleName) || emptyBalance(input.vehicleName);
  const before = { ...balance };
  balance.availableBalance += delta;
  assertBalanceInvariant(balance);
  context.balances.set(input.vehicleName, balance);
  queueEvent(context, input.vehicleName, {
    eventId: `manual__${input.requestId}`,
    eventType: 'manual_adjustment',
    reservationId: input.requestId,
    amount: Math.abs(delta),
    availableDelta: delta,
    pendingHoldDelta: 0,
    pendingReleaseDelta: 0,
    reason: input.reason.trim(),
    actor: context.actor,
  }, before);
  return publicBalance(balance);
}

export function flushFuelLedger(context: FuelLedgerContext): void {
  const now = admin.firestore.FieldValue.serverTimestamp();
  for (const balance of context.balances.values()) {
    const relevant = context.events.some((event) => event.vehicleName === balance.vehicleName);
    if (!relevant) continue;
    context.transaction.set(balanceRef(balance.vehicleName), {
      vehicleName: balance.vehicleName,
      availableBalance: balance.availableBalance,
      pendingHoldAmount: balance.pendingHoldAmount,
      pendingReleaseAmount: balance.pendingReleaseAmount,
      updatedAt: now,
      updatedBy: context.actor.uid,
      updatedByName: context.actor.displayName || '',
    }, { merge: true });
  }
  for (const event of context.events) {
    context.transaction.create(
      ledgerRef(event.vehicleName, event.input.eventId),
      {
        vehicleName: event.vehicleName,
        eventType: event.input.eventType,
        journeyId: event.input.journeyId || null,
        reservationId: event.input.reservationId || null,
        mode: event.input.mode || null,
        amount: event.input.amount,
        availableDelta: event.input.availableDelta,
        pendingHoldDelta: event.input.pendingHoldDelta,
        pendingReleaseDelta: event.input.pendingReleaseDelta,
        reason: event.input.reason,
        actorUid: event.input.actor.uid,
        actorRole: event.input.actor.role || null,
        actorName: event.input.actor.displayName || '',
        before: event.before,
        after: event.after,
        createdAt: now,
        schemaVersion: 1,
      },
    );
  }
}

export async function getVehicleFuelBalance(
  vehicleName: DriverVehicleName,
): Promise<VehicleFuelBalance> {
  assertAccumulationVehicle(vehicleName);
  const snapshot = await balanceRef(vehicleName).get();
  return publicBalance(normalizeBalance(vehicleName, snapshot.exists ? snapshot.data() : undefined));
}

export async function getVehicleFuelBalances(): Promise<VehicleFuelBalance[]> {
  const snapshots = await adminDb.collection(VEHICLE_FUEL_BALANCES_COLLECTION).get();
  const byName = new Map(
    snapshots.docs
      .map((snapshot) => snapshot.data())
      .filter((data) => isFuelAccumulationVehicle(String(data.vehicleName || '')))
      .map((data) => [String(data.vehicleName), data]),
  );
  return DRIVER_VEHICLE_NAMES
    .filter((vehicleName) => vehicleName !== DEFAULT_DRIVER_VEHICLE_NAME)
    .map((vehicleName) => publicBalance(normalizeBalance(vehicleName, byName.get(vehicleName))));
}

export async function getVehicleFuelLedger(
  vehicleName: DriverVehicleName,
  limit = 100,
): Promise<Array<Record<string, unknown>>> {
  assertAccumulationVehicle(vehicleName);
  const snapshot = await balanceRef(vehicleName)
    .collection(VEHICLE_FUEL_LEDGER_SUBCOLLECTION)
    .orderBy('createdAt', 'desc')
    .limit(Math.min(200, Math.max(1, limit)))
    .get();
  return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
}

export function reservationFromJourney(data: FirebaseFirestore.DocumentData): FuelReservationRecord | null {
  const mode = data.fuelProcurementMode;
  const state = data.fuelReservationState;
  const vehicleName = data.fuelReservationVehicleName || data.vehicleName;
  if (
    !isDriverVehicleName(vehicleName) ||
    typeof data.fuelReservationId !== 'string' ||
    !['reserved', 'committed', 'released', 'none'].includes(String(state || '')) ||
    !['hold_accumulate', 'procure_release', 'standard_direct'].includes(String(mode || ''))
  ) {
    return null;
  }
  return {
    fuelReservationId: data.fuelReservationId,
    fuelReservationState: state as FuelReservationState,
    fuelReservationVehicleName: vehicleName,
    fuelProcurementMode: mode as FuelProcurementMode,
    baseFuelAllowance: integerMoney(Number(data.baseOperationalCost || data.baseFuelAllowance || 0), 'Jatah BBM dasar', Number.MAX_SAFE_INTEGER),
    heldFuelAmount: integerMoney(Number(data.heldFuelAmount || 0), 'BBM ditahan', Number.MAX_SAFE_INTEGER),
    procuredAccumulatedAmount: integerMoney(Number(data.procuredAccumulatedAmount || 0), 'BBM akumulasi dicairkan', Number.MAX_SAFE_INTEGER),
  };
}

export function reservationFields(reservation: FuelReservationRecord): Record<string, unknown> {
  return {
    fuelReservationId: reservation.fuelReservationId,
    fuelReservationState: reservation.fuelReservationState,
    fuelReservationVehicleName: reservation.fuelReservationVehicleName,
    fuelProcurementMode: reservation.fuelProcurementMode,
    heldFuelAmount: reservation.heldFuelAmount,
    procuredAccumulatedAmount: reservation.procuredAccumulatedAmount,
    fuelAllowanceForSettlement:
      reservation.fuelProcurementMode === 'hold_accumulate'
        ? 0
        : reservation.baseFuelAllowance + reservation.procuredAccumulatedAmount,
    fuelTotalAllocation:
      reservation.baseFuelAllowance + reservation.procuredAccumulatedAmount,
  };
}
