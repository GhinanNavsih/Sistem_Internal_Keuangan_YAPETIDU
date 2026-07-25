export const DRIVER_NIGHT_PREMIUM_RATE = 50_000;
export const DRIVER_DISTANCE_RATE = 300;
export const DRIVER_DURATION_RATE = 5_000;
export const DAILY_MEAL_ALLOWANCE = 60_000;
export const MAX_NIGHT_COUNT = 365;

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

export function getMealAllowanceForDuration(
  hours: number,
  vehicleName?: string,
): number {
  if (vehicleName === 'Ndalem') return 0;
  if (!Number.isFinite(hours) || hours <= 0) return 0;

  // Round to 3 decimal places to prevent floating point drift (e.g., 2.0000000000000004)
  const cleanHours = Math.round(hours * 1000) / 1000;
  const fullDays = Math.floor(cleanHours / 24);
  const remainingHours = Math.round((cleanHours % 24) * 1000) / 1000;
  const fullDayAllowance = fullDays * DAILY_MEAL_ALLOWANCE;

  // Journeys 2 hours or under (<= 2h) receive 0 meal allowance reimbursement (duration is compensated via Upah Bersih duration rate).
  if (remainingHours <= 2) return fullDayAllowance;
  if (remainingHours <= 6) return fullDayAllowance + 20_000;
  if (remainingHours <= 12) return fullDayAllowance + 40_000;
  return fullDayAllowance + 60_000;
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
  const elapsedMinutes =
    timeToMinutes(timeEnd) -
    timeToMinutes(timeStart) +
    nightCount * 24 * 60;
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
  const dateEnd = isMultiDay && input.dateEnd ? input.dateEnd : dateStart;

  if (!dateStart || !timeStart || !timeEnd) {
    return { durationHours: 0, nightCount: 0, dateStart: dateStart || '', dateEnd };
  }

  const startMs = new Date(`${dateStart}T${timeStart}:00`).getTime();
  const endMs = new Date(`${dateEnd}T${timeEnd}:00`).getTime();

  if (isNaN(startMs) || isNaN(endMs)) {
    return { durationHours: 0, nightCount: 0, dateStart, dateEnd };
  }

  let diffMs = endMs - startMs;

  if (!isMultiDay && diffMs < 0) {
    return { durationHours: 0, nightCount: 0, dateStart, dateEnd };
  }

  const durationHours = Math.max(0, diffMs / (1000 * 60 * 60));

  const startDateObj = new Date(`${dateStart}T00:00:00`);
  const endDateObj = new Date(`${dateEnd}T00:00:00`);
  const calendarDaysDiff = Math.max(
    0,
    Math.round((endDateObj.getTime() - startDateObj.getTime()) / (1000 * 60 * 60 * 24)),
  );

  const nightCount = isMultiDay ? calendarDaysDiff : 0;

  return {
    durationHours,
    nightCount,
    dateStart,
    dateEnd,
  };
}

