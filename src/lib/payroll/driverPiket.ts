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
  stationKey?: PiketStationKey;
  stationName?: string;
  driverId: string;
  driverName: string;
  assignedBy?: string;
  createdAt?: any;
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
  return schedules.filter(
    s => s.driverId === driverId && (s.period === period || s.date.startsWith(period))
  ).length;
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
  return schedules
    .filter(s => s.driverId === driverId && (s.period === period || s.date.startsWith(period)))
    .map(s => s.date)
    .sort();
}
