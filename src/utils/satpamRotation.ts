/**
 * Utility for calculating the rotating shift schedules for Satpam Pekarya.
 * 
 * Shift Rotation Rules:
 * - Shift sequence: Pagi -> Malam -> Sore -> Pagi
 * - Shift rotation happens every Monday at 08:00 (Start of Shift Pagi).
 * - Roster Teams:
 *   - Team 1 (Ketua: BASTOMI)
 *   - Team 2 (Ketua: MUJIONO)
 *   - Team 3 (Ketua: SUHARIONO)
 * 
 * Reference Week (Week 0): Monday, July 13, 2026 to Sunday, July 19, 2026:
 * - Team 1 = Shift Pagi
 *   Team 2 = Shift Malam
 *   Team 3 = Shift Sore
 */

// Anchor Monday: July 13, 2026 in local Jakarta time
const REF_MONDAY_MS = new Date('2026-07-13T00:00:00+07:00').getTime();

export type SatpamShift = 'Pagi' | 'Sore' | 'Malam';

/**
 * Gets the Monday start timestamp of the scheduling week containing the given date.
 * A scheduling week starts on Monday at 08:00.
 * Any date/time before Monday 08:00 belongs to the previous week's schedule.
 */
export function getSchedulingMonday(dateInput: Date | string | number): Date {
  const d = new Date(dateInput);
  
  // Set to local Jakarta time representation (approximate helper offset)
  // To keep it timezone robust, we find the local calendar day
  const localYear = d.getFullYear();
  const localMonth = d.getMonth();
  const localDate = d.getDate();
  const localHours = d.getHours();
  
  // Create a local date for computation
  const baseDate = new Date(localYear, localMonth, localDate, localHours, d.getMinutes());
  
  // Adjust: if it's Monday before 08:00, subtract 8 hours so it falls into Sunday (previous week)
  if (baseDate.getDay() === 1 && baseDate.getHours() < 8) {
    baseDate.setHours(baseDate.getHours() - 8);
  }
  
  // Find Monday of the resulting week
  const day = baseDate.getDay(); // 0 = Sunday, 1 = Monday, etc.
  const diffToMonday = day === 0 ? -6 : 1 - day; // Sunday is -6 days from Monday, others are (1 - day)
  
  const monday = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + diffToMonday);
  monday.setHours(8, 0, 0, 0); // Monday starts at 08:00
  
  return monday;
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
  const schedMonday = getSchedulingMonday(dateInput);
  
  // Calculate difference in weeks
  const msDiff = schedMonday.getTime() - REF_MONDAY_MS;
  const msInWeek = 7 * 24 * 60 * 60 * 1000;
  
  // Use Math.round to handle floating issues from daylight saving if any
  let diffWeeks = Math.round(msDiff / msInWeek);
  
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
