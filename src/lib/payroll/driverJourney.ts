export const DRIVER_NIGHT_PREMIUM_RATE = 50_000;
export const DRIVER_DISTANCE_RATE = 300;
export const DRIVER_DURATION_RATE = 5_000;
export const DAILY_MEAL_ALLOWANCE = 60_000;
export const MAX_NIGHT_COUNT = 365;

export const DRIVER_VEHICLE_RATES = Object.freeze({
  Bis: 2_500,
  Elf: 1_350,
  'Kijang LGX': 1_200,
  'Innova Hitam': 1_250,
  'Innova Matic': 1_450,
  'Suzuki XL7': 1_000,
  Ndalem: 0,
} as const);

export type DriverVehicleName = keyof typeof DRIVER_VEHICLE_RATES;
export const DEFAULT_DRIVER_VEHICLE_NAME: DriverVehicleName = 'Ndalem';
export const DRIVER_VEHICLE_NAMES = Object.freeze(
  Object.keys(DRIVER_VEHICLE_RATES) as DriverVehicleName[],
);

export type FuelProcurementMode =
  | 'hold_accumulate'
  | 'procure_release'
  | 'standard_direct';

export const DEFAULT_FUEL_PROCUREMENT_MODE: FuelProcurementMode = 'standard_direct';

export const DEFAULT_DRIVER_JOURNEY_POINT = 'UNIPDU Jombang, Jawa Timur';
/** Google Directions accepts at most 25 intermediate destination waypoints. */
export const MAX_DRIVER_JOURNEY_DESTINATIONS = 25;
/** Main-destination arrays use the same full limit as the editable route. */
export const MAX_MAIN_DESTINATIONS = MAX_DRIVER_JOURNEY_DESTINATIONS;
/** Stored/displayed journey points also contain the departure point. */
export const MAX_DRIVER_JOURNEY_LOCATIONS = MAX_DRIVER_JOURNEY_DESTINATIONS + 1;
/** Route measurement may append the departure point once to close the return leg. */
export const MAX_DRIVER_ROUTE_CALCULATION_POINTS = MAX_DRIVER_JOURNEY_LOCATIONS + 1;

export interface DriverJourneyLocation {
  address: string;
  latitude: number;
  longitude: number;
}

export const DEFAULT_DRIVER_JOURNEY_LOCATION: Readonly<DriverJourneyLocation> = Object.freeze({
  address: DEFAULT_DRIVER_JOURNEY_POINT,
  latitude: -7.5458,
  longitude: 112.2858,
});

export function normalizeDriverJourneyLocation(
  value: unknown,
  expectedAddress?: unknown,
): DriverJourneyLocation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const candidate = value as Record<string, unknown>;
  const storedAddress = typeof candidate.address === 'string' ? candidate.address.trim() : '';
  const canonicalAddress = typeof expectedAddress === 'string' && expectedAddress.trim()
    ? expectedAddress.trim()
    : storedAddress;
  if (!canonicalAddress) return null;
  if (
    storedAddress &&
    typeof expectedAddress === 'string' &&
    expectedAddress.trim() &&
    storedAddress !== expectedAddress.trim()
  ) {
    return null;
  }

  const latitude = candidate.latitude;
  const longitude = candidate.longitude;
  if (
    typeof latitude !== 'number' ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    typeof longitude !== 'number' ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }

  return { address: canonicalAddress, latitude, longitude };
}

export function normalizeDriverJourneyLocations(
  value: unknown,
  addresses: unknown,
): Array<DriverJourneyLocation | null> {
  const destinations = normalizeDriverJourneyDestinations(addresses);
  const values = Array.isArray(value) ? value : [];
  return destinations.map((address, index) => (
    normalizeDriverJourneyLocation(values[index], address)
  ));
}

export interface DriverJourneyPointLocationSources {
  /** The full ordered route, `[startPoint, ...stops]`. */
  points: string[];
  startPoint?: unknown;
  startPointLocation?: unknown;
  /** Pre-authorized stops; positionally paired with `mainDestinationLocations`. */
  mainDestinations?: unknown;
  mainDestinationLocations?: unknown;
  /** The sopir's stop log — the only carrier of ad hoc stops' coordinates. */
  extraActivities?: unknown;
}

/**
 * Resolves one coordinate per entry in `points`, so a route can be re-measured
 * against the exact places the sopir picked rather than re-geocoded from
 * ambiguous address text.
 *
 * Coordinates live in two places: pre-authorized stops carry theirs in
 * `mainDestinationLocations`, while stops the sopir added mid-journey carry
 * theirs only inside `extraActivities`. Authorized coordinates win; the stop
 * log fills the gaps, including where a stored authorized coordinate fails
 * validation.
 *
 * Both sources are paired positionally rather than through
 * `normalizeDriverJourneyLocations`, so every route point stays aligned with
 * its coordinate. The main-destination array and `points` now share the same
 * full configured destination limit.
 */
export function resolveDriverJourneyPointLocations(
  input: DriverJourneyPointLocationSources,
): Array<DriverJourneyLocation | null> {
  const points = Array.isArray(input.points) ? input.points : [];
  if (points.length === 0) return [];

  const startAddress = typeof input.startPoint === 'string' && input.startPoint.trim()
    ? input.startPoint.trim()
    : points[0];
  const startLocation = normalizeDriverJourneyLocation(input.startPointLocation, startAddress)
    || (points[0] === DEFAULT_DRIVER_JOURNEY_LOCATION.address
      ? { ...DEFAULT_DRIVER_JOURNEY_LOCATION }
      : null);

  const mainDestinations = Array.isArray(input.mainDestinations) && input.mainDestinations.length > 0
    ? input.mainDestinations
    : points.slice(1);
  const mainLocationValues = Array.isArray(input.mainDestinationLocations)
    ? input.mainDestinationLocations
    : [];
  const locationByAddress = new Map<string, DriverJourneyLocation | null>();
  mainDestinations.forEach((address, index) => {
    const trimmed = typeof address === 'string' ? address.trim() : '';
    if (!trimmed || locationByAddress.has(trimmed)) return;
    locationByAddress.set(trimmed, normalizeDriverJourneyLocation(mainLocationValues[index], trimmed));
  });

  const fallbackByAddress = new Map<string, DriverJourneyLocation | null>();
  (Array.isArray(input.extraActivities) ? input.extraActivities : []).forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    const activity = entry as Record<string, unknown>;
    if (activity.type !== 'tambah_lokasi') return;
    const address = typeof activity.destination === 'string' ? activity.destination.trim() : '';
    if (!address || fallbackByAddress.has(address)) return;
    fallbackByAddress.set(address, normalizeDriverJourneyLocation(activity.destinationLocation, address));
  });

  return [
    startLocation,
    ...points.slice(1).map((address) => {
      const trimmed = typeof address === 'string' ? address.trim() : '';
      if (!trimmed) return null;
      return locationByAddress.get(trimmed) || fallbackByAddress.get(trimmed) || null;
    }),
  ];
}

export function driverJourneyRoutePoint(
  address: unknown,
  location?: unknown,
): string {
  const normalizedAddress = typeof address === 'string' ? address.trim() : '';
  const normalizedLocation = normalizeDriverJourneyLocation(location, normalizedAddress);
  if (!normalizedLocation) return normalizedAddress;
  return `${normalizedLocation.latitude.toFixed(6)},${normalizedLocation.longitude.toFixed(6)}`;
}

/** Counts user-entered destinations while excluding the origin and generated return. */
export function countDriverJourneyRouteDestinations(points: readonly string[]): number {
  const activePoints = points.map((point) => point.trim()).filter(Boolean);
  if (activePoints.length === 0) return 0;
  const closesAtOrigin =
    activePoints.length >= 3 &&
    activePoints[activePoints.length - 1] === activePoints[0];
  return Math.max(0, activePoints.length - (closesAtOrigin ? 2 : 1));
}

/**
 * Closes an already-resolved route back to its origin for one real Google
 * Directions measurement. This is deliberately different from multiplying an
 * outbound distance by two: the return leg may follow different roads.
 */
export function closeDriverJourneyRoundTrip(points: readonly string[]): string[] {
  const activePoints = points.map((point) => point.trim()).filter(Boolean);
  if (activePoints.length < 2) return activePoints;
  return activePoints[activePoints.length - 1] === activePoints[0]
    ? activePoints
    : [...activePoints, activePoints[0]];
}

/**
 * Returns the ordered main destinations for a journey while keeping older
 * DriverJourneys, which only have `endPoint`, readable.
 */
export function normalizeDriverJourneyDestinations(
  value: unknown,
  legacyEndPoint?: unknown,
): string[] {
  const rawValues = Array.isArray(value) && value.length > 0
    ? value
    : typeof legacyEndPoint === 'string'
      ? [legacyEndPoint]
      : [];

  return rawValues
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, MAX_MAIN_DESTINATIONS);
}

export function driverJourneyRoutePoints(
  startPoint: unknown,
  destinations: unknown,
  legacyEndPoint?: unknown,
  returnToStart = true,
): string[] {
  const start = typeof startPoint === 'string' && startPoint.trim()
    ? startPoint.trim()
    : DEFAULT_DRIVER_JOURNEY_POINT;
  const mainDestinations = normalizeDriverJourneyDestinations(destinations, legacyEndPoint);
  if (mainDestinations.length === 0) return [start];
  return returnToStart
    ? [start, ...mainDestinations, start]
    : [start, ...mainDestinations];
}

export const FUEL_PROCUREMENT_MODE_LABELS: Readonly<
  Record<FuelProcurementMode, string>
> = Object.freeze({
  standard_direct: 'Standard langsung',
  hold_accumulate: 'Tahan & akumulasi',
  procure_release: 'Cairkan saldo',
});

export function isFuelProcurementMode(value: unknown): value is FuelProcurementMode {
  return value === 'hold_accumulate' ||
    value === 'procure_release' ||
    value === 'standard_direct';
}

export function fuelProcurementModeLabel(value: unknown): string {
  return isFuelProcurementMode(value)
    ? FUEL_PROCUREMENT_MODE_LABELS[value]
    : 'Mode pengadaan BBM';
}

export function assertFuelProcurementMode(
  value: unknown,
): asserts value is FuelProcurementMode {
  if (!isFuelProcurementMode(value)) {
    throw new Error('Mode pengadaan BBM tidak valid.');
  }
}

export function isFuelAccumulationVehicle(vehicleName: string): boolean {
  return isDriverVehicleName(vehicleName) && vehicleName !== DEFAULT_DRIVER_VEHICLE_NAME;
}

export function isDriverVehicleName(value: unknown): value is DriverVehicleName {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(DRIVER_VEHICLE_RATES, value)
  );
}

export function getDriverVehicleRate(vehicleName: string): number {
  return DRIVER_VEHICLE_RATES[vehicleName as DriverVehicleName] ?? 1_000;
}

export function assertNightCount(value: unknown): asserts value is number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_NIGHT_COUNT
  ) {
    throw new Error(`Jumlah malam harus berupa bilangan bulat antara 0 dan ${MAX_NIGHT_COUNT}.`);
  }
}

export interface CanonicalDriverJourneyTimeline {
  dateStart: string;
  dateEnd: string;
  isMultiDay: boolean;
  nightCount: number;
  nightPremium: number;
}

/**
 * Normalizes timeline fields shared by the driver form, ActivityReports, and
 * DriverJourneys. A single-day journey can never retain an old overnight
 * count from a previous draft.
 */
export function canonicalizeDriverJourneyTimeline(input: {
  activityDate: string;
  dateStart?: unknown;
  dateEnd?: unknown;
  isMultiDay?: unknown;
  nightCount?: unknown;
}): CanonicalDriverJourneyTimeline {
  const dateStart =
    typeof input.dateStart === 'string' && input.dateStart.trim()
      ? input.dateStart.trim()
      : input.activityDate;
  if (!dateStart) throw new Error('Tanggal mulai perjalanan wajib diisi.');

  const isMultiDay = input.isMultiDay === true;
  let nightCount = 0;
  if (isMultiDay) {
    assertNightCount(input.nightCount);
    nightCount = input.nightCount;
  }

  const dateEnd =
    isMultiDay && typeof input.dateEnd === 'string' && input.dateEnd.trim()
      ? input.dateEnd.trim()
      : dateStart;

  return {
    dateStart,
    dateEnd,
    isMultiDay,
    nightCount,
    nightPremium: calculateNightPremium(nightCount),
  };
}

export function getMealTierCount(hours: number): number {
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  const cleanHours = Math.round(hours * 1000) / 1000;
  const fullDays = Math.floor(cleanHours / 24);
  const remainingHours = Math.round((cleanHours % 24) * 1000) / 1000;
  const fullDayMeals = fullDays * 3;

  if (remainingHours <= 2) return fullDayMeals;
  if (remainingHours <= 6) return fullDayMeals + 1;
  if (remainingHours <= 12) return fullDayMeals + 2;
  return fullDayMeals + 3;
}

export function getNdalemUnpaidMealAllowance(
  hours: number,
  ndalemMealMoneyProvided: number = 0,
): number {
  return getMealAllowanceForDuration(hours, 'Ndalem', ndalemMealMoneyProvided);
}

/**
 * How a journey's meal entitlement is accounted for.
 *
 * - `legacy_reimbursement`: the historical treatment — meal is pre-authorized
 *   as operational cash and settled as reimbursement, reduced by any money the
 *   sopir was already handed during the trip.
 * - `upah_bersih_gross`: meal is paid inside Upah Bersih at its full
 *   duration-based entitlement, and takes no part in operational cash or
 *   reimbursement. Money handed over during the trip is recorded but no longer
 *   reduces the entitlement.
 *
 * The mode is stamped onto a report when it is submitted or approved, so an
 * already-approved record keeps the treatment it was paid under. Records with
 * no stamp are historical and therefore legacy.
 */
export type MealAccountingMode = 'upah_bersih_gross' | 'legacy_reimbursement';

export const CURRENT_MEAL_ACCOUNTING_MODE: MealAccountingMode = 'upah_bersih_gross';
export const LEGACY_MEAL_ACCOUNTING_MODE: MealAccountingMode = 'legacy_reimbursement';

export function isMealAccountingMode(value: unknown): value is MealAccountingMode {
  return value === 'upah_bersih_gross' || value === 'legacy_reimbursement';
}

/**
 * Resolves the mode a stored record should be calculated under.
 *
 * An explicit stamp always wins, so re-auditing an old approved journey keeps
 * reproducing the figures it was approved with. Only an unstamped record needs
 * a default, and that default is deliberately asymmetric: an unstamped record
 * that is already approved is historical (legacy), while one still pending has
 * not been paid yet and is settled under the current policy when it is
 * approved.
 */
export function resolveMealAccountingMode(
  storedMode: unknown,
  options: { alreadyApproved?: boolean } = {},
): MealAccountingMode {
  if (isMealAccountingMode(storedMode)) return storedMode;
  return options.alreadyApproved ? LEGACY_MEAL_ACCOUNTING_MODE : CURRENT_MEAL_ACCOUNTING_MODE;
}

/**
 * The full duration-based meal entitlement, never reduced by money already
 * handed to the sopir and never zeroed for a particular vehicle. This is the
 * figure paid inside Upah Bersih under `upah_bersih_gross`.
 */
export function getGrossMealAllowanceForDuration(hours: number): number {
  if (!Number.isFinite(hours) || hours <= 0) return 0;

  // Round to 3 decimal places to prevent floating point drift (e.g., 2.0000000000000004)
  const cleanHours = Math.round(hours * 1000) / 1000;
  const fullDays = Math.floor(cleanHours / 24);
  const remainingHours = Math.round((cleanHours % 24) * 1000) / 1000;
  const fullDayAllowance = fullDays * DAILY_MEAL_ALLOWANCE;

  if (remainingHours <= 2) return fullDayAllowance;
  if (remainingHours <= 6) return fullDayAllowance + 20_000;
  if (remainingHours <= 12) return fullDayAllowance + 40_000;
  return fullDayAllowance + 60_000;
}

export function getMealAllowanceForDuration(
  hours: number,
  vehicleName?: string,
  mealMoneyProvided?: number,
): number {
  const totalRights = getGrossMealAllowanceForDuration(hours);
  if (totalRights <= 0) return 0;

  // Any money already handed to the driver covers part of the meal right,
  // regardless of the vehicle used. The vehicle name remains an input for
  // call-site compatibility and future vehicle-specific rules.
  //
  // Only `legacy_reimbursement` still nets this off; under
  // `upah_bersih_gross` call sites use `getGrossMealAllowanceForDuration`.
  const moneyReceived = Math.max(0, mealMoneyProvided ?? 0);
  return Math.max(0, totalRights - moneyReceived);
}

export interface DriverJourneyOperationalCostResult {
  vehicleName: DriverVehicleName;
  vehicleRate: number;
  baseOperationalCost: number;
  fuelProcurementMode: FuelProcurementMode;
  mealAccountingMode: MealAccountingMode;
  effectiveFuelAllowance: number;
  heldFuelAmount: number;
  procuredAccumulatedAmount: number;
  totalFuelAllocation: number;
  /** Meal paid as operational cash. Always 0 under `upah_bersih_gross`. */
  mealAllowance: number;
  /** Full entitlement, reported regardless of mode; paid in Upah Bersih under `upah_bersih_gross`. */
  grossMealAllowance: number;
  tollParkingFee: number;
  totalOperationalCost: number;
}

export interface DriverJourneyOperationalCostSnapshot {
  totalOperationalCost?: unknown;
  operationalCost?: unknown;
  fee?: unknown;
  fuelProcurementMode?: unknown;
  mealAllowance?: unknown;
  preAuthorizedMeal?: unknown;
  tollParkingFee?: unknown;
  preAuthorizedToll?: unknown;
  heldFuelAmount?: unknown;
  baseOperationalCost?: unknown;
}

function firstNonNegativeAmount(...values: unknown[]): number | null {
  for (const value of values) {
    const amount = Number(value);
    if (Number.isFinite(amount) && amount >= 0) return amount;
  }
  return null;
}

/**
 * Returns the cash operational amount shown to users. A hold journey keeps
 * its fuel amount in the vehicle ledger, so its cash total is meal plus
 * toll/parking rather than the persisted all-in total from older records.
 */
export function cashOperationalCostFromJourney(
  snapshot: DriverJourneyOperationalCostSnapshot,
): number {
  const totalOperationalCost = firstNonNegativeAmount(
    snapshot.totalOperationalCost,
    snapshot.operationalCost,
    snapshot.fee,
  ) ?? 0;
  if (snapshot.fuelProcurementMode !== 'hold_accumulate') return totalOperationalCost;

  const mealAllowance = firstNonNegativeAmount(
    snapshot.mealAllowance,
    snapshot.preAuthorizedMeal,
  );
  const tollParkingFee = firstNonNegativeAmount(
    snapshot.preAuthorizedToll,
    snapshot.tollParkingFee,
  );
  if (mealAllowance !== null || tollParkingFee !== null) {
    return (mealAllowance || 0) + (tollParkingFee || 0);
  }

  const heldFuelAmount = firstNonNegativeAmount(
    snapshot.heldFuelAmount,
    snapshot.baseOperationalCost,
  ) ?? 0;
  return Math.max(0, totalOperationalCost - heldFuelAmount);
}

export interface DriverJourneyFuelCalculationOptions {
  fuelProcurementMode?: FuelProcurementMode;
  procuredAccumulatedAmount?: number;
  /**
   * Defaults to legacy so re-deriving an already-authorized journey's budget
   * reproduces the figures it was authorized with.
   */
  mealAccountingMode?: MealAccountingMode;
}

export function calculateEffectiveFuelAllowance(
  baseFuelAllowance: number,
  fuelProcurementMode: FuelProcurementMode = DEFAULT_FUEL_PROCUREMENT_MODE,
  procuredAccumulatedAmount: number = 0,
): number {
  assertNonNegativeAmount(baseFuelAllowance, 'Jatah BBM dasar');
  assertFuelProcurementMode(fuelProcurementMode);
  assertNonNegativeAmount(procuredAccumulatedAmount, 'Akumulasi BBM yang dicairkan');

  if (fuelProcurementMode === 'hold_accumulate') return 0;
  if (fuelProcurementMode === 'procure_release') {
    return baseFuelAllowance + procuredAccumulatedAmount;
  }
  return baseFuelAllowance;
}

/**
 * Calculates the operational allowance attached to an authorized journey.
 * This is shared by Kepala Satker authorization and driver self-authorization
 * during a piket shift so both paths produce the same budget baseline.
 */
export function calculateDriverJourneyOperationalCosts(
  distanceKmOneWay: number,
  durationHoursPP: number,
  vehicleName: DriverVehicleName,
  tollParkingFee: number = 0,
  options: DriverJourneyFuelCalculationOptions = {},
): DriverJourneyOperationalCostResult {
  if (!Number.isFinite(distanceKmOneWay) || distanceKmOneWay < 0) {
    throw new Error('Jarak perjalanan tidak valid.');
  }
  if (!Number.isFinite(durationHoursPP) || durationHoursPP < 0) {
    throw new Error('Durasi perjalanan tidak valid.');
  }
  if (!Number.isFinite(tollParkingFee) || tollParkingFee < 0) {
    throw new Error('Tol & parkir tidak valid.');
  }

  const fuelProcurementMode = options.fuelProcurementMode ?? DEFAULT_FUEL_PROCUREMENT_MODE;
  const procuredAccumulatedAmount = options.procuredAccumulatedAmount ?? 0;
  assertFuelProcurementMode(fuelProcurementMode);
  assertNonNegativeAmount(procuredAccumulatedAmount, 'Akumulasi BBM yang dicairkan');
  if (vehicleName === DEFAULT_DRIVER_VEHICLE_NAME && fuelProcurementMode !== 'standard_direct') {
    throw new Error('Kendaraan Ndalem tidak dapat menggunakan akumulasi BBM.');
  }

  const vehicleRate = DRIVER_VEHICLE_RATES[vehicleName];
  const baseOperationalCost = distanceKmOneWay * 2 * vehicleRate;
  const heldFuelAmount = fuelProcurementMode === 'hold_accumulate' ? baseOperationalCost : 0;
  const effectiveFuelAllowance = calculateEffectiveFuelAllowance(
    baseOperationalCost,
    fuelProcurementMode,
    procuredAccumulatedAmount,
  );
  // Held fuel is a ledger movement, not cash handed to the driver. Keep it
  // separate from the cash fuel allocation used by operational-cost totals.
  const totalFuelAllocation = effectiveFuelAllowance;
  // Under `upah_bersih_gross` meal is no longer a cash advance — it is paid in
  // Upah Bersih — so it contributes nothing to the operational budget. The
  // entitlement is still reported via `grossMealAllowance` so the authorizing
  // Kepala Satker can see what the sopir will earn for it.
  const mealAccountingMode = options.mealAccountingMode ?? LEGACY_MEAL_ACCOUNTING_MODE;
  const grossMealAllowance = getGrossMealAllowanceForDuration(durationHoursPP);
  const mealAllowance = mealAccountingMode === 'upah_bersih_gross'
    ? 0
    : vehicleName === DEFAULT_DRIVER_VEHICLE_NAME
      ? 0
      : getMealAllowanceForDuration(durationHoursPP, vehicleName);

  return {
    vehicleName,
    vehicleRate,
    baseOperationalCost,
    fuelProcurementMode,
    mealAccountingMode,
    effectiveFuelAllowance,
    heldFuelAmount,
    procuredAccumulatedAmount,
    totalFuelAllocation,
    mealAllowance,
    grossMealAllowance,
    tollParkingFee,
    totalOperationalCost: totalFuelAllocation + mealAllowance + tollParkingFee,
  };
}

export interface DriverReimbursementSettlementInput {
  fuelAllowance: number;
  fuelSpent: number;
  tollAllowance: number;
  tollSpent: number;
  additionalReimbursement?: number;
  fuelProcurementMode?: FuelProcurementMode;
  procuredAccumulatedAmount?: number;
}

export interface DriverReimbursementSettlement {
  effectiveFuelAllowance: number;
  heldFuelAmount: number;
  procuredAccumulatedAmount: number;
  fuelDelta: number;
  tollDelta: number;
  extraFuelCost: number;
  extraTollCost: number;
  fuelAllowanceSurplus: number;
  tollAllowanceSurplus: number;
  grossOperationalOverage: number;
  grossAllowanceSurplus: number;
  netOperationalDelta: number;
  /** Gross positive reimbursement before allowance surplus is applied. */
  positiveReimburseDelta: number;
  /** Final cash reimbursement after fuel/toll cross-offset. */
  reimburseDelta: number;
  totalPreAuthorizedAllowance: number;
  totalActualSpent: number;
  /** Net fuel/toll allowance surplus after categories offset each other. */
  unspentCash: number;
  /** Surplus still left after all additional reimbursements; deduct from wage. */
  remainingUnspentCash: number;
}

function assertNonNegativeAmount(value: number, fieldName: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${fieldName} harus berupa angka tidak negatif.`);
  }
}

/**
 * Settles fuel and toll/parking spending against their separate allowances.
 *
 * Savings in one category offset overage in the other before reimbursement is
 * paid. Any allowance still left after that offset and other reimbursement
 * items is deducted from the driver's net wage.
 */
export function calculateDriverReimbursementSettlement(
  input: DriverReimbursementSettlementInput,
): DriverReimbursementSettlement {
  const fuelAllowance = input.fuelAllowance;
  const fuelSpent = input.fuelSpent;
  const tollAllowance = input.tollAllowance;
  const tollSpent = input.tollSpent;
  const additionalReimbursement = input.additionalReimbursement ?? 0;
  const fuelProcurementMode = input.fuelProcurementMode ?? DEFAULT_FUEL_PROCUREMENT_MODE;
  const procuredAccumulatedAmount = input.procuredAccumulatedAmount ?? 0;

  assertNonNegativeAmount(fuelAllowance, 'Jatah BBM');
  assertNonNegativeAmount(fuelSpent, 'BBM terpakai');
  assertNonNegativeAmount(tollAllowance, 'Jatah tol & parkir');
  assertNonNegativeAmount(tollSpent, 'Tol & parkir terbayar');
  assertNonNegativeAmount(additionalReimbursement, 'Reimburse tambahan');
  assertFuelProcurementMode(fuelProcurementMode);
  assertNonNegativeAmount(procuredAccumulatedAmount, 'Akumulasi BBM yang dicairkan');

  const effectiveFuelAllowance = calculateEffectiveFuelAllowance(
    fuelAllowance,
    fuelProcurementMode,
    procuredAccumulatedAmount,
  );
  const heldFuelAmount = fuelProcurementMode === 'hold_accumulate' ? fuelAllowance : 0;
  // A hold journey has no cash fuel purchase or cash fuel allowance. The UI
  // and API reject/clear fuel receipts for this mode, but normalize here too
  // so a stale client cannot create a wage deduction or fuel reimbursement.
  const settledFuelSpent = fuelProcurementMode === 'hold_accumulate' ? 0 : fuelSpent;
  const fuelDelta = settledFuelSpent - effectiveFuelAllowance;
  const tollDelta = tollSpent - tollAllowance;
  const extraFuelCost = Math.max(0, fuelDelta);
  const extraTollCost = Math.max(0, tollDelta);
  const fuelAllowanceSurplus = Math.max(0, -fuelDelta);
  const tollAllowanceSurplus = Math.max(0, -tollDelta);
  const grossOperationalOverage = extraFuelCost + extraTollCost;
  const grossAllowanceSurplus = fuelAllowanceSurplus + tollAllowanceSurplus;
  const netOperationalDelta = fuelDelta + tollDelta;
  const positiveReimburseDelta = grossOperationalOverage + additionalReimbursement;
  const reimburseDelta = Math.max(0, netOperationalDelta + additionalReimbursement);
  const unspentCash = Math.max(0, -netOperationalDelta);
  const remainingUnspentCash = Math.max(
    0,
    -netOperationalDelta - additionalReimbursement,
  );

  return {
    effectiveFuelAllowance,
    heldFuelAmount,
    procuredAccumulatedAmount,
    fuelDelta,
    tollDelta,
    extraFuelCost,
    extraTollCost,
    fuelAllowanceSurplus,
    tollAllowanceSurplus,
    grossOperationalOverage,
    grossAllowanceSurplus,
    netOperationalDelta,
    positiveReimburseDelta,
    reimburseDelta,
    totalPreAuthorizedAllowance: effectiveFuelAllowance + tollAllowance,
    totalActualSpent: settledFuelSpent + tollSpent,
    unspentCash,
    remainingUnspentCash,
  };
}

export function calculateNightPremium(nightCount: number): number {
  assertNightCount(nightCount);
  return nightCount * DRIVER_NIGHT_PREMIUM_RATE;
}

export const DRIVER_SHORT_TRIP_MEAL_ALLOWANCE = 5_000;

export function getShortTripMealWageComponent(durationHours: number): number {
  if (!Number.isFinite(durationHours) || durationHours <= 0) return 0;
  const cleanHours = Math.round(durationHours * 1000) / 1000;
  const remainingHours = Math.round((cleanHours % 24) * 1000) / 1000;
  // If the journey (or partial day) is 2 hours or under (<= 2h), the Rp 5,000 meal allowance is paid directly inside Upah Bersih.
  return (remainingHours > 0 && remainingHours <= 2) ? DRIVER_SHORT_TRIP_MEAL_ALLOWANCE : 0;
}

/**
 * The meal entitlement paid inside Upah Bersih for a journey.
 *
 * Under `legacy_reimbursement` this is nothing — meal was pre-authorized as
 * operational cash and settled as reimbursement instead.
 *
 * Under `upah_bersih_gross` it is the full duration-based entitlement. This is
 * additive to, not a replacement for, `getShortTripMealWageComponent`: the
 * tiered entitlement pays nothing for a partial day of 2 hours or under, which
 * is exactly the gap the flat Rp 5.000 short-trip component fills, so the two
 * never cover the same hours and are not a double payment.
 */
export function getMealWageComponent(
  elapsedDurationHours: number,
  mealAccountingMode: MealAccountingMode,
): number {
  if (mealAccountingMode !== 'upah_bersih_gross') return 0;
  return getGrossMealAllowanceForDuration(elapsedDurationHours);
}

export interface DriverNetWageInput {
  distanceKm: number;
  /** Cumulative Google Directions driving time between destinations. Drives Komponen Waktu only. */
  travelTimeHours: number;
  /** Wall-clock departure-to-arrival span. Drives the meal components (uang makan), not Komponen Waktu. */
  elapsedDurationHours: number;
  nightCount: number;
  /**
   * Defaults to the legacy treatment so that every existing call site — and
   * any recomputation of an already-approved record — keeps producing exactly
   * the figure it produced before meal moved into Upah Bersih. Paths that
   * settle under current policy pass the mode explicitly.
   */
  mealAccountingMode?: MealAccountingMode;
}

export function calculateDriverNetWage(input: DriverNetWageInput): number {
  const { distanceKm, travelTimeHours, elapsedDurationHours, nightCount } = input;
  const mealAccountingMode = input.mealAccountingMode ?? LEGACY_MEAL_ACCOUNTING_MODE;
  if (!Number.isFinite(distanceKm) || distanceKm < 0) {
    throw new Error('Jarak perjalanan tidak valid.');
  }
  if (!Number.isFinite(travelTimeHours) || travelTimeHours < 0) {
    throw new Error('Durasi tempuh perjalanan tidak valid.');
  }
  if (!Number.isFinite(elapsedDurationHours) || elapsedDurationHours < 0) {
    throw new Error('Durasi perjalanan tidak valid.');
  }
  return (
    Math.ceil(distanceKm * DRIVER_DISTANCE_RATE) +
    Math.ceil(travelTimeHours * DRIVER_DURATION_RATE) +
    getShortTripMealWageComponent(elapsedDurationHours) +
    getMealWageComponent(elapsedDurationHours, mealAccountingMode) +
    calculateNightPremium(nightCount)
  );
}

export function journeyDayCount(durationHours: number): number {
  if (!Number.isFinite(durationHours) || durationHours <= 0) return 0;
  return Math.ceil(durationHours / 24);
}

function timeToMinutes(value: string): number {
  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(value)) {
    throw new Error('Waktu perjalanan harus menggunakan format JJ:MM.');
  }
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

export function calculateJourneyElapsedHours(
  timeStart: string,
  timeEnd: string,
  nightCount: number,
): number {
  assertNightCount(nightCount);
  let elapsedMinutes =
    timeToMinutes(timeEnd) -
    timeToMinutes(timeStart) +
    nightCount * 24 * 60;
  if (elapsedMinutes <= 0 && timeToMinutes(timeEnd) < timeToMinutes(timeStart)) {
    elapsedMinutes += 24 * 60;
  }
  if (elapsedMinutes <= 0) {
    throw new Error('Waktu tiba harus setelah waktu berangkat.');
  }
  return elapsedMinutes / 60;
}

export interface JourneyDateTimeInput {
  dateStart: string; // YYYY-MM-DD
  timeStart: string; // HH:MM
  dateEnd?: string;   // YYYY-MM-DD
  timeEnd: string;   // HH:MM
  isMultiDay?: boolean;
}

export interface JourneyDateTimeResult {
  durationHours: number;
  nightCount: number;
  dateStart: string;
  dateEnd: string;
}

export function calculateJourneyDateTimeTimings(
  input: JourneyDateTimeInput,
): JourneyDateTimeResult {
  const { dateStart, timeStart, timeEnd, isMultiDay } = input;
  const dateEnd = input.dateEnd && input.dateEnd > dateStart ? input.dateEnd : (isMultiDay && input.dateEnd ? input.dateEnd : dateStart);

  if (!dateStart || !timeStart || !timeEnd) {
    return { durationHours: 0, nightCount: 0, dateStart: dateStart || '', dateEnd };
  }

  const startMs = new Date(`${dateStart}T${timeStart}:00`).getTime();
  const endMs = new Date(`${dateEnd}T${timeEnd}:00`).getTime();

  if (isNaN(startMs) || isNaN(endMs)) {
    return { durationHours: 0, nightCount: 0, dateStart, dateEnd };
  }

  const diffMs = endMs - startMs;

  if (diffMs < 0) {
    return { durationHours: 0, nightCount: 0, dateStart, dateEnd };
  }

  const durationHours = Math.max(0, diffMs / (1000 * 60 * 60));

  const startDateObj = new Date(`${dateStart}T00:00:00`);
  const endDateObj = new Date(`${dateEnd}T00:00:00`);
  const calendarDaysDiff = Math.max(
    0,
    Math.round((endDateObj.getTime() - startDateObj.getTime()) / (1000 * 60 * 60 * 24)),
  );

  let nightCount = 0;
  if (calendarDaysDiff > 0) {
    const endHour = parseInt(timeEnd.split(':')[0], 10);
    const arrivesBefore5AM = !isNaN(endHour) && endHour < 5;
    nightCount = Math.max(0, calendarDaysDiff - (arrivesBefore5AM ? 1 : 0));
  } else if (isMultiDay) {
    nightCount = calendarDaysDiff;
  }

  return {
    durationHours,
    nightCount,
    dateStart,
    dateEnd,
  };
}

export interface EditableDriverJourneyTimelineInput {
  dateStart: string;
  timeStart: string;
  dateEnd?: string;
  timeEnd: string;
  isMultiDay?: boolean;
}

export interface EditableDriverJourneyTimelineResult extends JourneyDateTimeResult {
  isMultiDay: boolean;
}

function nextCalendarDate(dateValue: string): string {
  const parsed = new Date(`${dateValue}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return dateValue;
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

/**
 * Calculates a reviewable journey timeline while inferring the next calendar
 * day when an auditor changes the arrival time to be earlier than departure.
 * The existing arrival-before-05:00 rule remains authoritative for the night
 * count and therefore for uang menginap.
 */
export function calculateEditableDriverJourneyTimeline(
  input: EditableDriverJourneyTimelineInput,
): EditableDriverJourneyTimelineResult {
  const dateStart = input.dateStart;
  let dateEnd = input.dateEnd && input.dateEnd >= dateStart
    ? input.dateEnd
    : dateStart;
  const hasValidTimes =
    /^([01]\d|2[0-3]):([0-5]\d)$/.test(input.timeStart) &&
    /^([01]\d|2[0-3]):([0-5]\d)$/.test(input.timeEnd);

  // A journey crosses a date boundary only when its recorded dates differ or
  // its clock times wrap past midnight. `input.isMultiDay` deliberately gets no
  // vote here: the submit path stores the flag as true with an unchanged end
  // date whenever the sopir leaves the toggle on, and scores that as zero
  // nights, so advancing dateEnd off the flag alone billed a premium malam to
  // trips that ended the same evening.
  let isMultiDay = dateEnd > dateStart;

  if (
    !isMultiDay &&
    hasValidTimes &&
    timeToMinutes(input.timeEnd) < timeToMinutes(input.timeStart)
  ) {
    isMultiDay = true;
    dateEnd = nextCalendarDate(dateStart);
  }

  const timings = calculateJourneyDateTimeTimings({
    dateStart,
    timeStart: input.timeStart,
    dateEnd,
    timeEnd: input.timeEnd,
    isMultiDay,
  });

  return {
    ...timings,
    isMultiDay,
  };
}

export interface EstimatedDriverWageResult {
  compJarak: number;
  compWaktu: number;
  shortTripMeal: number;
  /** Duration-based entitlement folded into the wage under `upah_bersih_gross`. */
  mealWage: number;
  baseWage: number;
  maxWage: number;
}

export function calculateEstimatedDriverWage(
  totalDistanceKmPP: number,
  totalDurationHoursPP: number,
  mealAccountingMode: MealAccountingMode = LEGACY_MEAL_ACCOUNTING_MODE,
): EstimatedDriverWageResult {
  const dist = Number.isFinite(totalDistanceKmPP) && totalDistanceKmPP > 0 ? totalDistanceKmPP : 0;
  const dur = Number.isFinite(totalDurationHoursPP) && totalDurationHoursPP > 0 ? totalDurationHoursPP : 0;

  const compJarak = Math.ceil(dist * DRIVER_DISTANCE_RATE);
  const compWaktu = Math.ceil(dur * DRIVER_DURATION_RATE);
  const shortTripMeal = getShortTripMealWageComponent(dur);
  const mealWage = getMealWageComponent(dur, mealAccountingMode);

  const baseWage = compJarak + compWaktu + shortTripMeal + mealWage;
  const maxWage = Math.ceil(baseWage * 1.25);

  return {
    compJarak,
    compWaktu,
    shortTripMeal,
    mealWage,
    baseWage,
    maxWage,
  };
}

/**
 * Formats a decimal-hours duration as "{H}j {MM}m" (e.g. 2.6 -> "2j 36m").
 * Decimal hours reads ambiguously at a glance (0.4 jam is easy to misread as
 * "almost no time" when it's really 24 minutes) — this spells out hours and
 * minutes directly, matching how the driver and auditor actually think about
 * a trip's length.
 */
export function formatDurationHoursAsJamMenit(hours: number): string {
  const safeHours = Number.isFinite(hours) && hours > 0 ? hours : 0;
  const totalMinutes = Math.round(safeHours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}j ${String(m).padStart(2, '0')}m`;
}
