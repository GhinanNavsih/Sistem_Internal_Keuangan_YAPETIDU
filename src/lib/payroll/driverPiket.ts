import { isPremiumAttendanceDate } from './attendance';
import {
  DEFAULT_DRIVER_VEHICLE_NAME,
  DEFAULT_FUEL_PROCUREMENT_MODE,
  isDriverVehicleName,
  isFuelProcurementMode,
  type DriverVehicleName,
  type FuelProcurementMode,
} from './driverJourney';

export type PiketStationKey = 'pak_ufik' | 'pak_zuem' | 'pak_heri' | 'bu_afifah' | 'sekolah';

export interface PiketStationConfig {
  key: PiketStationKey;
  name: string;
}

export const PIKET_STATIONS: readonly PiketStationConfig[] = [
  { key: 'pak_ufik', name: 'Pak Ufik' },
  { key: 'pak_zuem', name: "Pak Zu'em" },
  { key: 'pak_heri', name: 'Pak Heri' },
  { key: 'bu_afifah', name: 'Bu Afifah' },
  { key: 'sekolah', name: 'Sekolah' },
] as const;

export interface DriverPiketSchedule {
  id: string;
  period: string; // "YYYY-MM" e.g. "2026-08"
  date: string;   // "YYYY-MM-DD" e.g. "2026-08-01"
  /** One of the 5 fixed PIKET_STATIONS keys, or an ad-hoc "extra-..." key. */
  stationKey?: string;
  stationName?: string;
  driverId: string;
  driverName: string;
  assignedBy?: string;
  createdAt?: any;
}

/** Prefix for ad-hoc piket slots added beyond the 5 fixed stations. */
export const EXTRA_PIKET_STATION_PREFIX = 'extra-';

export function isExtraPiketStationKey(stationKey: string | undefined): boolean {
  return typeof stationKey === 'string' && stationKey.startsWith(EXTRA_PIKET_STATION_PREFIX);
}

export interface DriverPiketJourneyLike {
  id?: string;
  status?: unknown;
  employeeId?: string;
  activityDate?: string;
  journeyDate?: string;
  isSelfCreatedPiketSpj?: boolean;
  isSelfAuthorizedWithoutPiket?: boolean;
}

const SUBMITTED_DRIVER_JOURNEY_STATUSES = new Set([
  'submitted',
  'completed',
  'approved',
  'declined',
]);

/**
 * Self-authorized journeys carry an explicit marker. The ID fallback keeps
 * the counter compatible with records created before that marker was added.
 * Piket-specific on purpose: a driver may also self-authorize without a
 * Piket schedule (`isSelfAuthorizedWithoutPiket`), and those must NOT count
 * toward Piket-day quotas here — use `isSelfCreatedDriverJourney` for the
 * generic "was this self-created by the driver at all" question instead.
 */
export function isSelfCreatedDriverPiketJourney(
  journey: DriverPiketJourneyLike,
): boolean {
  return Boolean(
    journey.isSelfCreatedPiketSpj === true ||
      (typeof journey.id === 'string' && journey.id.startsWith('JRN-PIKET-')),
  );
}

/**
 * True for any journey the driver self-authorized directly — whether backed
 * by an active Piket schedule or not. Operational gates (fuel-mode
 * selection, cancel-claim, delete-on-resubmit, admin-delete disposition)
 * care about this broader question, not specifically about Piket.
 */
export function isSelfCreatedDriverJourney(
  journey: DriverPiketJourneyLike,
): boolean {
  return Boolean(
    isSelfCreatedDriverPiketJourney(journey) ||
      journey.isSelfAuthorizedWithoutPiket === true ||
      (typeof journey.id === 'string' && journey.id.startsWith('JRN-MANDIRI-')),
  );
}

/** How many times a sopir may switch vehicles on one journey. */
export const MAX_DRIVER_VEHICLE_CHANGES = 10;

/** One vehicle switch a sopir made on their own journey before reporting it. */
export interface DriverVehicleChange {
  fromVehicle: DriverVehicleName;
  toVehicle: DriverVehicleName;
  fromFuelMode: FuelProcurementMode;
  toFuelMode: FuelProcurementMode;
  /** Server clock, ISO 8601. */
  changedAt: string;
  changedBy: string;
  changedByName: string;
}

export interface DriverVehicleChangeJourneyLike extends DriverPiketJourneyLike {
  vehicleName?: unknown;
  fuelProcurementMode?: unknown;
  fuelModeSelectionRequired?: unknown;
  fuelReservationState?: unknown;
  heldFuelAmount?: unknown;
  procuredAccumulatedAmount?: unknown;
  driverVehicleChanges?: unknown;
}

/** Reads a stored switch log, dropping anything malformed. */
export function driverVehicleChangesFrom(value: unknown): DriverVehicleChange[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): DriverVehicleChange[] => {
    if (!item || typeof item !== 'object') return [];
    const entry = item as Record<string, unknown>;
    if (
      !isDriverVehicleName(entry.fromVehicle) ||
      !isDriverVehicleName(entry.toVehicle) ||
      !isFuelProcurementMode(entry.fromFuelMode) ||
      !isFuelProcurementMode(entry.toFuelMode) ||
      typeof entry.changedAt !== 'string'
    ) {
      return [];
    }
    return [{
      fromVehicle: entry.fromVehicle,
      toVehicle: entry.toVehicle,
      fromFuelMode: entry.fromFuelMode,
      toFuelMode: entry.toFuelMode,
      changedAt: entry.changedAt,
      changedBy: typeof entry.changedBy === 'string' ? entry.changedBy : '',
      changedByName: typeof entry.changedByName === 'string' ? entry.changedByName : '',
    }];
  });
}

/**
 * Why the sopir may not switch this journey's vehicle, or null when they may.
 *
 * Only a self-authorized journey that is still under way and has no BBM held
 * qualifies. Such a journey has nothing priced or reserved yet: the fuel
 * allowance and any hold are derived at submission from whichever vehicle the
 * journey names by then, so switching is the same as having picked that
 * vehicle at authorization. A Kepala-Satker-authorized journey was priced and
 * held on its vehicle, and stays correctable only in the audit.
 */
export function driverVehicleChangeBlocker(
  journey: DriverVehicleChangeJourneyLike,
): string | null {
  if (!isSelfCreatedDriverJourney(journey)) {
    return 'Kendaraan hanya dapat diganti pada SPJ yang diotorisasi sendiri.';
  }
  if (journey.status !== 'claimed') {
    return 'Kendaraan hanya dapat diganti sebelum laporan perjalanan dikirim.';
  }
  if (
    journey.fuelReservationState === 'reserved' ||
    journey.fuelReservationState === 'committed' ||
    Number(journey.heldFuelAmount || 0) > 0 ||
    Number(journey.procuredAccumulatedAmount || 0) > 0
  ) {
    return 'BBM perjalanan ini sudah direservasi, sehingga kendaraan tidak dapat diganti.';
  }
  if (driverVehicleChangesFrom(journey.driverVehicleChanges).length >= MAX_DRIVER_VEHICLE_CHANGES) {
    return `Kendaraan sudah diganti ${MAX_DRIVER_VEHICLE_CHANGES} kali pada perjalanan ini.`;
  }
  return null;
}

export type DriverVehicleChangePlan =
  | {
      ok: true;
      changed: boolean;
      fromVehicle: DriverVehicleName;
      toVehicle: DriverVehicleName;
      fromFuelMode: FuelProcurementMode;
      toFuelMode: FuelProcurementMode;
    }
  | { ok: false; status: 400 | 403 | 409; message: string };

/**
 * Decides the vehicle and fuel mode a switch lands on.
 *
 * - To Ndalem: always Standard langsung (Ndalem has no fuel balance).
 * - From Ndalem, or while the mode is still unchosen: the sopir picks the mode,
 *   defaulting to Tahan & akumulasi like the authorization dialog.
 * - Car to car: the mode already chosen stays; asking for another is refused.
 */
export function planDriverVehicleChange(
  journey: DriverVehicleChangeJourneyLike,
  request: { vehicleName: unknown; fuelProcurementMode?: unknown },
): DriverVehicleChangePlan {
  if (!isDriverVehicleName(request.vehicleName)) {
    return { ok: false, status: 400, message: 'Jenis kendaraan tidak dikenal.' };
  }
  const rawMode = request.fuelProcurementMode ?? undefined;
  if (rawMode !== undefined && !isFuelProcurementMode(rawMode)) {
    return { ok: false, status: 400, message: 'Mode pengadaan BBM tidak valid.' };
  }
  const requestedMode = isFuelProcurementMode(rawMode) ? rawMode : undefined;
  const blocker = driverVehicleChangeBlocker(journey);
  if (blocker) {
    return {
      ok: false,
      status: isSelfCreatedDriverJourney(journey) ? 409 : 403,
      message: blocker,
    };
  }
  if (!isDriverVehicleName(journey.vehicleName)) {
    return { ok: false, status: 409, message: 'Jenis kendaraan perjalanan tidak valid.' };
  }

  const fromVehicle = journey.vehicleName;
  const toVehicle = request.vehicleName;
  const fromFuelMode = isFuelProcurementMode(journey.fuelProcurementMode)
    ? journey.fuelProcurementMode
    : DEFAULT_FUEL_PROCUREMENT_MODE;
  let toFuelMode: FuelProcurementMode;
  if (toVehicle === DEFAULT_DRIVER_VEHICLE_NAME) {
    if (requestedMode !== undefined && requestedMode !== DEFAULT_FUEL_PROCUREMENT_MODE) {
      return {
        ok: false,
        status: 400,
        message: 'Kendaraan Ndalem hanya menggunakan Pengisian Standard.',
      };
    }
    toFuelMode = DEFAULT_FUEL_PROCUREMENT_MODE;
  } else if (
    fromVehicle === DEFAULT_DRIVER_VEHICLE_NAME ||
    journey.fuelModeSelectionRequired === true
  ) {
    toFuelMode = requestedMode ?? 'hold_accumulate';
  } else {
    if (requestedMode !== undefined && requestedMode !== fromFuelMode) {
      return {
        ok: false,
        status: 409,
        message: 'Mode BBM perjalanan sudah dikunci; hanya kendaraan yang dapat diganti.',
      };
    }
    toFuelMode = fromFuelMode;
  }

  if (toVehicle === fromVehicle && toFuelMode !== fromFuelMode) {
    return {
      ok: false,
      status: 409,
      message: 'Pilih kendaraan yang berbeda untuk mengganti kendaraan.',
    };
  }
  return {
    ok: true,
    changed: toVehicle !== fromVehicle,
    fromVehicle,
    toVehicle,
    fromFuelMode,
    toFuelMode,
  };
}

/** Only an unresolved claimed journey blocks the next self-authorized trip. */
export function hasClaimedDriverJourney(
  journeys: readonly DriverPiketJourneyLike[],
): boolean {
  return journeys.some((journey) => journey.status === 'claimed');
}

/**
 * Counts resolved self-authorized journeys for the driver's Piket date. A
 * currently claimed journey is intentionally excluded because it has not been
 * submitted yet.
 */
export function countSubmittedSelfPiketJourneysOnDate(
  dateStr: string,
  driverId: string,
  journeys: readonly DriverPiketJourneyLike[],
): number {
  if (!dateStr || !driverId || !journeys || journeys.length === 0) return 0;
  return journeys.filter((journey) => {
    const journeyDate = journey.activityDate || journey.journeyDate;
    return (
      journey.employeeId === driverId &&
      journeyDate === dateStr &&
      isSelfCreatedDriverPiketJourney(journey) &&
      typeof journey.status === 'string' &&
      SUBMITTED_DRIVER_JOURNEY_STATUSES.has(journey.status)
    );
  }).length;
}

/**
 * Gets today's date in YYYY-MM-DD format based on local timezone (default Asia/Jakarta).
 */
export function getTodayDateString(timeZone: string = 'Asia/Jakarta'): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

/**
 * Checks if a specific driver has an active piket schedule on a given date (YYYY-MM-DD).
 */
export function isDriverPiketActiveOnDate(
  dateStr: string,
  driverId: string,
  schedules: readonly DriverPiketSchedule[]
): boolean {
  if (!dateStr || !driverId || !schedules || schedules.length === 0) return false;
  return schedules.some(
    s => s.driverId === driverId && s.date === dateStr
  );
}

/**
 * Gets active driver piket schedule on a given date (returns schedule object or null).
 */
export function getActiveDriverPiketScheduleOnDate(
  dateStr: string,
  driverId: string,
  schedules: readonly DriverPiketSchedule[]
): DriverPiketSchedule | null {
  if (!dateStr || !driverId || !schedules || schedules.length === 0) return null;
  return schedules.find(s => s.driverId === driverId && s.date === dateStr) || null;
}

/**
 * Counts how many piket shifts a driver is assigned to in a given period (YYYY-MM).
 */
export function countDriverPiketInPeriod(
  driverId: string,
  period: string,
  schedules: readonly DriverPiketSchedule[]
): number {
  if (!driverId || !period || !schedules || schedules.length === 0) return 0;
  return new Set(
    schedules
      .filter(s => s.driverId === driverId && (s.period === period || s.date.startsWith(period)))
      .map(s => s.date),
  ).size;
}

/**
 * Returns an array of date strings ("YYYY-MM-DD") where a driver is scheduled for piket in a period.
 */
export function getDriverPiketDatesInPeriod(
  driverId: string,
  period: string,
  schedules: readonly DriverPiketSchedule[]
): string[] {
  if (!driverId || !period || !schedules || schedules.length === 0) return [];
  return [...new Set(
    schedules
      .filter(s => s.driverId === driverId && (s.period === period || s.date.startsWith(period)))
      .map(s => s.date),
  )].sort();
}

/**
 * A day a driver is scheduled for Piket is a day he was present, so it's an
 * interim Harian/Jumat & Libur estimate before real attendance is published
 * — split the same way real attendance days are (`isPremiumAttendanceDate`),
 * so the estimate and the eventual real data use one consistent rule. Built
 * on `getDriverPiketDatesInPeriod` so `harian + jumatLibur` always equals
 * `countDriverPiketInPeriod` for the same inputs.
 */
export function classifyDriverPiketDatesInPeriod(
  driverId: string,
  period: string,
  schedules: readonly DriverPiketSchedule[],
  premiumDates: ReadonlySet<string>,
): { harian: number; jumatLibur: number } {
  const dates = getDriverPiketDatesInPeriod(driverId, period, schedules);
  let harian = 0;
  let jumatLibur = 0;
  for (const date of dates) {
    if (isPremiumAttendanceDate(date, premiumDates)) jumatLibur += 1;
    else harian += 1;
  }
  return { harian, jumatLibur };
}
