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
