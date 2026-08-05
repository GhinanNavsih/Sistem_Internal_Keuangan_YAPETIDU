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

export function getMealAllowanceForDuration(
  hours: number,
  vehicleName?: string,
  mealMoneyProvided?: number,
): number {
  if (!Number.isFinite(hours) || hours <= 0) return 0;

  // Round to 3 decimal places to prevent floating point drift (e.g., 2.0000000000000004)
  const cleanHours = Math.round(hours * 1000) / 1000;
  const fullDays = Math.floor(cleanHours / 24);
  const remainingHours = Math.round((cleanHours % 24) * 1000) / 1000;
  const fullDayAllowance = fullDays * DAILY_MEAL_ALLOWANCE;

  let totalRights = 0;
  if (remainingHours <= 2) totalRights = fullDayAllowance;
  else if (remainingHours <= 6) totalRights = fullDayAllowance + 20_000;
  else if (remainingHours <= 12) totalRights = fullDayAllowance + 40_000;
  else totalRights = fullDayAllowance + 60_000;

  // Any money already handed to the driver covers part of the meal right,
  // regardless of the vehicle used. The vehicle name remains an input for
  // call-site compatibility and future vehicle-specific rules.
  const moneyReceived = Math.max(0, mealMoneyProvided ?? 0);
  return Math.max(0, totalRights - moneyReceived);
}

export interface DriverJourneyOperationalCostResult {
  vehicleName: DriverVehicleName;
  vehicleRate: number;
  baseOperationalCost: number;
  mealAllowance: number;
  tollParkingFee: number;
  totalOperationalCost: number;
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

  const vehicleRate = DRIVER_VEHICLE_RATES[vehicleName];
  const baseOperationalCost = distanceKmOneWay * 2 * vehicleRate;
  const mealAllowance = vehicleName === DEFAULT_DRIVER_VEHICLE_NAME
    ? 0
    : getMealAllowanceForDuration(durationHoursPP, vehicleName);

  return {
    vehicleName,
    vehicleRate,
    baseOperationalCost,
    mealAllowance,
    tollParkingFee,
    totalOperationalCost: baseOperationalCost + mealAllowance + tollParkingFee,
  };
}

export interface DriverReimbursementSettlementInput {
  fuelAllowance: number;
  fuelSpent: number;
  tollAllowance: number;
  tollSpent: number;
  additionalReimbursement?: number;
}

export interface DriverReimbursementSettlement {
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

  assertNonNegativeAmount(fuelAllowance, 'Jatah BBM');
  assertNonNegativeAmount(fuelSpent, 'BBM terpakai');
  assertNonNegativeAmount(tollAllowance, 'Jatah tol & parkir');
  assertNonNegativeAmount(tollSpent, 'Tol & parkir terbayar');
  assertNonNegativeAmount(additionalReimbursement, 'Reimburse tambahan');

  const fuelDelta = fuelSpent - fuelAllowance;
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
    totalPreAuthorizedAllowance: fuelAllowance + tollAllowance,
    totalActualSpent: fuelSpent + tollSpent,
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

export function calculateDriverNetWage(
  distanceKm: number,
  durationHours: number,
  nightCount: number,
): number {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) {
    throw new Error('Jarak perjalanan tidak valid.');
  }
  if (!Number.isFinite(durationHours) || durationHours < 0) {
    throw new Error('Durasi perjalanan tidak valid.');
  }
  return (
    Math.ceil(distanceKm * DRIVER_DISTANCE_RATE) +
    Math.ceil(durationHours * DRIVER_DURATION_RATE) +
    getShortTripMealWageComponent(durationHours) +
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
  let isMultiDay = input.isMultiDay === true || dateEnd > dateStart;
  const hasValidTimes =
    /^([01]\d|2[0-3]):([0-5]\d)$/.test(input.timeStart) &&
    /^([01]\d|2[0-3]):([0-5]\d)$/.test(input.timeEnd);

  if (isMultiDay && dateEnd <= dateStart) {
    dateEnd = nextCalendarDate(dateStart);
  }

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
  baseWage: number;
  maxWage: number;
}

export function calculateEstimatedDriverWage(
  totalDistanceKmPP: number,
  totalDurationHoursPP: number,
): EstimatedDriverWageResult {
  const dist = Number.isFinite(totalDistanceKmPP) && totalDistanceKmPP > 0 ? totalDistanceKmPP : 0;
  const dur = Number.isFinite(totalDurationHoursPP) && totalDurationHoursPP > 0 ? totalDurationHoursPP : 0;

  const compJarak = Math.ceil(dist * DRIVER_DISTANCE_RATE);
  const compWaktu = Math.ceil(dur * DRIVER_DURATION_RATE);
  const shortTripMeal = getShortTripMealWageComponent(dur);

  const baseWage = compJarak + compWaktu + shortTripMeal;
  const maxWage = Math.ceil(baseWage * 1.25);

  return {
    compJarak,
    compWaktu,
    shortTripMeal,
    baseWage,
    maxWage,
  };
}
