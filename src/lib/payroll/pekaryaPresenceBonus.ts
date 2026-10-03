import {
  ATTENDANCE_WORK_WINDOW_START_MINUTES,
  isPremiumAttendanceDate,
  normalizeAttendanceTime,
} from './attendance';
import { periodDateRange } from './calendar';

/**
 * "Bonus Presensi" for Kebersihan and Teknisi, decided by the working days of
 * the payroll calendar:
 *
 * - present on every working day and never late ........ Rp100.000
 * - present on every working day (late or not) ......... Rp50.000
 * - absent on one working day (late or not) ............ Rp30.000
 * - absent on two working days (late or not) ........... Rp10.000
 * - absent on three or more working days ............... nothing
 *
 * A working day is a calendar day that is not a Friday or a Tanggal Merah —
 * those are the premium days, worked at the premium rate rather than expected.
 * Presence on a premium day neither helps nor hurts. Late means the scan-in is
 * after the 07:30 start of the work window, even by a second.
 */
export const PEKARYA_PRESENCE_BONUS_AMOUNTS = {
  perfect: 100_000,
  full: 50_000,
  oneAbsence: 30_000,
  twoAbsences: 10_000,
} as const;

/** The rekap column that carries the bonus for each category that earns it. */
const PRESENCE_BONUS_COLUMN_KEYS: Readonly<Record<string, string>> = {
  KEBERSIHAN: 'bonusPresensi',
  TEKNISI: 'bonusMutlak',
};

export function presenceBonusColumnKey(category: string): string | null {
  return PRESENCE_BONUS_COLUMN_KEYS[category] ?? null;
}

export type PekaryaPresenceBonusTier =
  | 'perfect'
  | 'full'
  | 'one_absence'
  | 'two_absences'
  | 'none';

export interface PresenceBonusDay {
  date: string;
  present: boolean;
  /** The recorded scan-in. Null when none was recorded — never a generated one. */
  scanIn: string | null;
}

export interface PekaryaPresenceBonus {
  amount: number;
  tier: PekaryaPresenceBonusTier;
  workingDays: number;
  absentDates: string[];
  lateDates: string[];
}

const WORK_START_CLOCK = `${String(Math.floor(ATTENDANCE_WORK_WINDOW_START_MINUTES / 60)).padStart(2, '0')}:${String(ATTENDANCE_WORK_WINDOW_START_MINUTES % 60).padStart(2, '0')}:00`;

function isLate(scanIn: string | null): boolean {
  const clock = normalizeAttendanceTime(scanIn);
  return clock !== null && clock > WORK_START_CLOCK;
}

export function calculatePekaryaPresenceBonus(input: {
  period: string;
  days: readonly PresenceBonusDay[];
  premiumDates: ReadonlySet<string>;
}): PekaryaPresenceBonus {
  const byDate = new Map(input.days.map((day) => [day.date, day]));
  const workingDates = periodDateRange(input.period).filter(
    (date) => !isPremiumAttendanceDate(date, input.premiumDates),
  );
  const absentDates: string[] = [];
  const lateDates: string[] = [];
  for (const date of workingDates) {
    const day = byDate.get(date);
    if (!day?.present) {
      absentDates.push(date);
    } else if (isLate(day.scanIn)) {
      lateDates.push(date);
    }
  }

  let tier: PekaryaPresenceBonusTier = 'none';
  if (absentDates.length === 0) {
    tier = lateDates.length === 0 ? 'perfect' : 'full';
  } else if (absentDates.length === 1) {
    tier = 'one_absence';
  } else if (absentDates.length === 2) {
    tier = 'two_absences';
  }
  const amount = {
    perfect: PEKARYA_PRESENCE_BONUS_AMOUNTS.perfect,
    full: PEKARYA_PRESENCE_BONUS_AMOUNTS.full,
    one_absence: PEKARYA_PRESENCE_BONUS_AMOUNTS.oneAbsence,
    two_absences: PEKARYA_PRESENCE_BONUS_AMOUNTS.twoAbsences,
    none: 0,
  }[tier];
  return {
    amount,
    tier,
    workingDays: workingDates.length,
    absentDates,
    lateDates,
  };
}

/**
 * The days as they will stand once one day's correction is applied, for the
 * routes that change a single date and must refresh the bonus with it.
 */
export function applyCorrectionToPresenceDays(
  days: readonly PresenceBonusDay[],
  date: string,
  correction: { present?: boolean; scanIn?: string | null },
): PresenceBonusDay[] {
  const existing = days.find((day) => day.date === date);
  const next: PresenceBonusDay = {
    date,
    present: correction.present ?? existing?.present ?? false,
    scanIn:
      correction.scanIn !== undefined
        ? correction.scanIn
        : (existing?.scanIn ?? null),
  };
  return [...days.filter((day) => day.date !== date), next];
}
