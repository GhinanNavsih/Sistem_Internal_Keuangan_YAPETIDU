/**
 * Utility for calculating the rotating shift schedules for Satpam Pekarya.
 * 
 * Shift Rotation Rules:
 * - Shift sequence: Pagi -> Malam -> Sore -> Pagi
 * - Shift rotation happens every Sunday at 08:00 (Start of Shift Pagi).
 * - Roster Teams:
 *   - Team 1 (Ketua: BASTOMI)
 *   - Team 2 (Ketua: MUJIONO)
 *   - Team 3 (Ketua: SUHARIONO)
 * 
 * Reference Week (Week 0): Sunday, July 12, 2026 at 08:00 WIB:
 * - Team 1 = Shift Pagi
 *   Team 2 = Shift Malam
 *   Team 3 = Shift Sore
 */

// Anchor Sunday: July 12, 2026 at the exact rotation boundary in Jakarta.
const REF_SUNDAY_MS = new Date('2026-07-12T08:00:00+07:00').getTime();

export type SatpamShift = 'Pagi' | 'Sore' | 'Malam';

/**
 * Gets the Sunday start timestamp of the scheduling week containing the given date.
 * A scheduling week starts on Sunday at 08:00 WIB.
 * Any instant before Sunday 08:00 WIB belongs to the previous week's schedule.
 * A date-only value represents that date's schedule at the rotation boundary.
 */
export function getSchedulingSunday(dateInput: Date | string | number): Date {
  const isDateOnly =
    typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput);

  let year: number;
  let month: number;
  let dayOfMonth: number;
  let hour = 8;

  if (isDateOnly) {
    [year, month, dayOfMonth] = (dateInput as string).split('-').map(Number);
  } else {
    const instant = new Date(dateInput);
    if (Number.isNaN(instant.getTime())) {
      throw new Error('Tanggal rotasi Satpam tidak valid.');
    }
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(instant);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    year = Number(values.year);
    month = Number(values.month);
    dayOfMonth = Number(values.day);
    hour = Number(values.hour);
  }

  // Use UTC for calendar arithmetic; Jakarta has a fixed +07:00 offset and no DST.
  let calendarDate = new Date(Date.UTC(year, month - 1, dayOfMonth));
  if (!isDateOnly && calendarDate.getUTCDay() === 0 && hour < 8) {
    calendarDate = new Date(calendarDate.getTime() - 24 * 60 * 60 * 1000);
  }

  const daysSinceSunday = calendarDate.getUTCDay();
  const sundayCalendar = new Date(
    calendarDate.getTime() - daysSinceSunday * 24 * 60 * 60 * 1000,
  );
  const sundayDateOnly = [
    sundayCalendar.getUTCFullYear(),
    String(sundayCalendar.getUTCMonth() + 1).padStart(2, '0'),
    String(sundayCalendar.getUTCDate()).padStart(2, '0'),
  ].join('-');
  return new Date(`${sundayDateOnly}T08:00:00+07:00`);
}

/**
 * Calculates the shift assignment for a specific team on a given date.
 * 
 * @param teamNumber 1, 2, or 3
 * @param dateInput Selected date in yyyy-mm-dd or Date format
 */
export function getSatpamShiftForTeam(
  teamNumber: 1 | 2 | 3 | number,
  dateInput: Date | string | number
): SatpamShift {
  const schedulingSunday = getSchedulingSunday(dateInput);
  
  // Calculate difference in weeks
  const msDiff = schedulingSunday.getTime() - REF_SUNDAY_MS;
  const msInWeek = 7 * 24 * 60 * 60 * 1000;
  
  const diffWeeks = Math.round(msDiff / msInWeek);
  
  // Modulo 3 weeks cycle
  let cycleIndex = diffWeeks % 3;
  if (cycleIndex < 0) {
    cycleIndex += 3;
  }
  
  // Define shift schedule based on cycle index:
  // Week 0: Team 1 = Pagi, Team 2 = Malam, Team 3 = Sore
  // Week 1: Team 1 = Malam, Team 2 = Sore, Team 3 = Pagi
  // Week 2: Team 1 = Sore, Team 2 = Pagi, Team 3 = Malam
  if (teamNumber === 1) {
    if (cycleIndex === 0) return 'Pagi';
    if (cycleIndex === 1) return 'Malam';
    return 'Sore';
  } else if (teamNumber === 2) {
    if (cycleIndex === 0) return 'Malam';
    if (cycleIndex === 1) return 'Sore';
    return 'Pagi';
  } else { // Team 3
    if (cycleIndex === 0) return 'Sore';
    if (cycleIndex === 1) return 'Pagi';
    return 'Malam';
  }
}

/**
 * Returns which team number is scheduled for a specific shift on a given date.
 */
export function getTeamScheduledForShift(
  shift: SatpamShift,
  dateInput: Date | string | number
): number {
  for (let t = 1; t <= 3; t++) {
    if (getSatpamShiftForTeam(t, dateInput) === shift) {
      return t;
    }
  }
  return 1; // fallback
}
