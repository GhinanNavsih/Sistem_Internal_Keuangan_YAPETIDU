import {
  type AttendanceNormalizedRow,
  type EffectiveAttendanceDay,
  isPremiumAttendanceDate,
  satpamAttendanceEvidenceDates,
} from './attendance';
import { periodDateRange } from './calendar';
import { getShiftIsoBounds, type SatpamShiftName } from './domain';

export interface AutoLeaveScheduledShift {
  planId: string;
  planRevision: number;
  teamId: string;
  dutyDate: string;
  shiftName: SatpamShiftName;
  startsAtIso: string;
  endsAtIso: string;
}
export interface AutoLeaveScheduledDuty {
  reviewRequired?: boolean;
  planId: string;
  planRevision: number;
  teamId: string;
  dutyDate: string;
  shiftName: SatpamShiftName;
}
export interface PekaryaAutoLeaveHeld { date: string | null; reason: string }
export interface PekaryaAutoLeaveCandidates {
  dates: string[];
  shifts: Map<string, AutoLeaveScheduledShift>;
  held: PekaryaAutoLeaveHeld[];
}

const INVALID_SOURCE_ISSUES = new Set([
  'IDENTIFIER_CONFLICT', 'IDENTIFIER_MISSING', 'DATE_INVALID', 'TIME_INVALID', 'OUTSIDE_PERIOD',
]);

/** Absence needs positive source coverage, never merely a missing import. */
export function pekaryaAutoLeaveCandidates(input: {
  period: string;
  category: string;
  nipy: string;
  identityValid: boolean;
  importAvailable: boolean;
  rows: readonly AttendanceNormalizedRow[];
  days: readonly EffectiveAttendanceDay[];
  premiumDates: ReadonlySet<string>;
  blockedDates: ReadonlySet<string>;
  workDates: ReadonlySet<string>;
  schedules: readonly AutoLeaveScheduledDuty[];
  now: Date;
}): PekaryaAutoLeaveCandidates {
  const result: PekaryaAutoLeaveCandidates = { dates: [], shifts: new Map(), held: [] };
  const hold = (date: string | null, reason: string) => result.held.push({ date, reason });
  if (!input.identityValid) { hold(null, 'Identitas presensi belum unik atau belum lengkap.'); return result; }
  const employeeRows = input.rows.filter((row) => row.nipy === input.nipy);
  const invalidDates = new Set(employeeRows.filter((row) =>
    row.issues.some((issue) => INVALID_SOURCE_ISSUES.has(issue))).map((row) => row.date));
  const rows = employeeRows.filter((row) =>
    !row.issues.some((issue) => INVALID_SOURCE_ISSUES.has(issue)));
  if (!input.importAvailable || !rows.some((row) => row.date.startsWith(`${input.period}-`))) {
    hold(null, 'Menunggu data presensi pegawai pada import aktif.'); return result;
  }
  const rowsByDate = Map.groupBy(rows, (row) => row.date);
  const days = input.days.filter((day) => day.nipy === input.nipy);
  const schedules = Map.groupBy(input.schedules, (duty) => duty.dutyDate);
  const isSatpam = input.category === 'SATPAM';
  const dates = isSatpam ? [...schedules.keys()].sort() : periodDateRange(input.period)
    .filter((date) => !isPremiumAttendanceDate(date, input.premiumDates));
  if (isSatpam && !dates.length) hold(null, 'Menunggu satu jadwal dinas terpublikasi yang jelas.');
  for (const date of dates) {
    if (!date.startsWith(`${input.period}-`) || input.workDates.has(date)) continue;
    if (input.blockedDates.has(date)) { hold(date, 'Ada pengajuan atau kredit presensi lain pada tanggal ini.'); continue; }
    const duty = schedules.get(date);
    if (isSatpam && duty?.length !== 1) { hold(date, 'Jadwal dinas bertumpuk; perlu diperiksa.'); continue; }
    const scheduled = isSatpam ? duty![0] : null;
    if (scheduled?.reviewRequired || (scheduled && !scheduled.teamId)) {
      hold(date, 'Jadwal dinas perlu diperiksa sebelum cuti otomatis dipakai.'); continue;
    }
    const bounds = scheduled ? getShiftIsoBounds(date, scheduled.shiftName) : null;
    const endsAt = bounds?.endsAtIso || `${date}T14:00:00+07:00`;
    if (new Date(endsAt).getTime() > input.now.getTime()) continue;
    const evidenceDates = scheduled ? satpamAttendanceEvidenceDates(date, scheduled.shiftName) : [date];
    // A partial punch or actual journey credit is attendance, never a full absence.
    if (rows.some((row) => evidenceDates.includes(row.date) && (row.scanIn || row.scanOut)) ||
        days.some((day) => evidenceDates.includes(day.date) && (day.present || day.scanIn || day.scanOut))) continue;
    if (evidenceDates.some((evidenceDate) => invalidDates.has(evidenceDate))) {
      hold(date, 'Ada bukti presensi yang belum valid pada tanggal ini.');
      continue;
    }
    if (evidenceDates.some((evidenceDate) => !rowsByDate.has(evidenceDate))) {
      hold(date, scheduled?.shiftName === 'Malam'
        ? 'Menunggu bukti presensi lengkap hingga akhir shift malam.'
        : 'Tanggal ini tidak memiliki baris presensi yang valid.');
      continue;
    }
    result.dates.push(date);
    if (scheduled && bounds) result.shifts.set(date, { ...scheduled, ...bounds });
  }
  return result;
}

export interface AutomaticAttendanceCredit {
  annualPaidLeaveRequestId: string;
  employeeId: string;
  leaveDate: string;
  category: string;
  source?: string;
  status: string;
}

/** Shared effective view; the import and manual corrections remain intact. */
export function applyAutomaticPekaryaLeave(
  days: readonly EffectiveAttendanceDay[],
  credits: readonly AutomaticAttendanceCredit[],
  joinNipyByEmployeeId: ReadonlyMap<string, string>,
): EffectiveAttendanceDay[] {
  const result = days.map((day) => ({ ...day }));
  for (const credit of credits) {
    if (credit.source !== 'auto_absence' || credit.status !== 'posted' || credit.category === 'SATPAM') continue;
    const nipy = joinNipyByEmployeeId.get(credit.employeeId);
    const index = result.findIndex((day) => day.nipy === nipy && day.date === credit.leaveDate);
    const day = result[index];
    if (!day || day.present || day.scanIn || day.scanOut) continue;
    result[index] = { ...day, present: true, completePunch: true, workStatus: 'CUTI',
      scanIn: '07:30:00', scanOut: '14:00:00',
      annualPaidLeaveCredit: { requestId: credit.annualPaidLeaveRequestId, automatic: true } };
  }
  return result;
}
