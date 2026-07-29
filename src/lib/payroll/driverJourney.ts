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
  ndalemMealMoneyProvided?: number,
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

  if (vehicleName === 'Ndalem') {
    const moneyReceived = Math.max(0, ndalemMealMoneyProvided ?? 0);
    return Math.max(0, totalRights - moneyReceived);
  }

  return totalRights;
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

