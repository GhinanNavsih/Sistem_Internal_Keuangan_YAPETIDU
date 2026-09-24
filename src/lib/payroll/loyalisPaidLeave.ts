import {
  ANNUAL_PAID_LEAVE_SCAN_IN,
  ANNUAL_PAID_LEAVE_SCAN_OUT,
} from './annualPaidLeave';
import { calculateLoyalisDailyDuration } from './loyalisPresenceWindow';

export interface LoyalisPaidLeaveDailyLog {
  Tanggal: string;
  'Jam kerja': string;
  'Scan masuk': string;
  'Scan pulang': string;
  [key: string]: unknown;
}

export interface LoyalisPaidLeaveEntry {
  employeeId?: string;
  employeeName?: string;
  minutes?: number;
  absenceMinutes?: number;
  stratum?: number;
  deduction?: number;
  netBonus?: number;
  activeDaysCount?: number;
  incompleteDaysCount?: number;
  absentDaysCount?: number;
  dailyLogs?: LoyalisPaidLeaveDailyLog[];
  approvedPaidLeaveDates?: string[];
  approvedGantiLiburDates?: string[];
  [key: string]: unknown;
}

/**
 * A working day credited as a full paid day: an approved annual leave (CUTI)
 * or an approved ganti libur, the day off earned by working a full holiday.
 */
export type LoyalisDayCreditKind = 'annual_leave' | 'ganti_libur';

export const LOYALIS_DAY_CREDIT_WORK_STATUS: Record<LoyalisDayCreditKind, string> = {
  annual_leave: 'CUTI',
  ganti_libur: 'GANTI LIBUR',
};

const DAY_CREDIT_WORK_STATUSES = new Set(Object.values(LOYALIS_DAY_CREDIT_WORK_STATUS));

export function paidLeaveIsoToLoyalisDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : '';
}

function dateSortValue(value: string): string {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : value;
}

export function loyalisHasPayableAttendance(
  entry: LoyalisPaidLeaveEntry | null | undefined,
  leaveDate: string,
): boolean {
  const dateKey = paidLeaveIsoToLoyalisDate(leaveDate);
  const row = (entry?.dailyLogs || []).find((item) => item.Tanggal === dateKey);
  if (!row) return false;
  const status = String(row['Jam kerja'] || '').trim().toUpperCase();
  if (status === 'TIDAK HADIR' || DAY_CREDIT_WORK_STATUSES.has(status)) return false;
  return Boolean(
    String(row['Scan masuk'] || '').trim() ||
      String(row['Scan pulang'] || '').trim(),
  );
}

export function loyalisPresenceStratum(absenceMinutes: number, workingDays: number) {
  const minutes = Math.max(0, absenceMinutes);
  if (minutes === 0) {
    return { stratum: 1, deduction: 0, netBonus: 250_000 };
  }
  if (minutes <= workingDays * 30) {
    return { stratum: 2, deduction: 100_000, netBonus: 150_000 };
  }
  if (minutes <= workingDays * 35) {
    return { stratum: 3, deduction: 150_000, netBonus: 100_000 };
  }
  if (minutes <= workingDays * 40) {
    return { stratum: 4, deduction: 200_000, netBonus: 50_000 };
  }
  return { stratum: 5, deduction: 250_000, netBonus: 0 };
}

export function applyApprovedPaidLeaveToLoyalisEntry(input: {
  entry: LoyalisPaidLeaveEntry;
  leaveDate: string;
  expectedHours: number;
  workingDays: number;
  isOffDay: boolean;
  /** Defaults to an annual leave, the only kind that existed before. */
  kind?: LoyalisDayCreditKind;
}): LoyalisPaidLeaveEntry {
  const kind = input.kind || 'annual_leave';
  const dateKey = paidLeaveIsoToLoyalisDate(input.leaveDate);
  if (!dateKey) {
    throw new Error(
      kind === 'ganti_libur'
        ? 'Tanggal ganti libur Loyalis tidak valid.'
        : 'Tanggal cuti Loyalis tidak valid.',
    );
  }
  const dailyLogs = [...(input.entry.dailyLogs || [])];
  const existingIndex = dailyLogs.findIndex((row) => row.Tanggal === dateKey);
  const existing = existingIndex >= 0 ? dailyLogs[existingIndex] : null;
  // Either kind already credited this date; a second credit would pay it twice.
  const wasAlreadyApplied = DAY_CREDIT_WORK_STATUSES.has(
    String(existing?.['Jam kerja'] || '').trim().toUpperCase(),
  );
  const nextRow: LoyalisPaidLeaveDailyLog = {
    ...(existing || {}),
    Tanggal: dateKey,
    'Jam kerja': LOYALIS_DAY_CREDIT_WORK_STATUS[kind],
    'Scan masuk': ANNUAL_PAID_LEAVE_SCAN_IN.slice(0, 5),
    'Scan pulang': ANNUAL_PAID_LEAVE_SCAN_OUT.slice(0, 5),
    ...(kind === 'ganti_libur'
      ? { gantiLibur: true, gantiLiburDate: input.leaveDate }
      : { annualPaidLeave: true, annualPaidLeaveDate: input.leaveDate }),
    isOffDay: input.isOffDay,
  };
  if (existingIndex >= 0) dailyLogs[existingIndex] = nextRow;
  else dailyLogs.push(nextRow);
  dailyLogs.sort((left, right) =>
    dateSortValue(left.Tanggal).localeCompare(dateSortValue(right.Tanggal)),
  );

  const creditedDates = kind === 'ganti_libur'
    ? {
        approvedGantiLiburDates: Array.from(
          new Set([...(input.entry.approvedGantiLiburDates || []), input.leaveDate]),
        ).sort(),
      }
    : {
        approvedPaidLeaveDates: Array.from(
          new Set([...(input.entry.approvedPaidLeaveDates || []), input.leaveDate]),
        ).sort(),
      };
  if (wasAlreadyApplied || input.isOffDay) {
    return { ...input.entry, dailyLogs, ...creditedDates };
  }

  const expectedMinutes = Math.max(0, input.expectedHours * 60);
  const existingScanIn = String(existing?.['Scan masuk'] || '').trim();
  const existingScanOut = String(existing?.['Scan pulang'] || '').trim();
  const existingWorkedMinutes = existingScanIn && existingScanOut
    ? calculateLoyalisDailyDuration(
        existingScanIn,
        existingScanOut,
        input.expectedHours,
      ) || 0
    : existingScanIn || existingScanOut
      ? Math.min(150, expectedMinutes)
      : 0;
  const creditedMinutes = Math.min(expectedMinutes, existingWorkedMinutes);
  const nextAbsenceMinutes = Math.max(
    0,
    Number(input.entry.absenceMinutes || 0) - (expectedMinutes - creditedMinutes),
  );
  const stratum = loyalisPresenceStratum(nextAbsenceMinutes, input.workingDays);
  const wasAbsent = String(existing?.['Jam kerja'] || '').trim().toUpperCase() === 'TIDAK HADIR';
  const wasIncomplete = Boolean(
    existing &&
      !wasAbsent &&
      (!String(existing['Scan masuk'] || '').trim() ||
        !String(existing['Scan pulang'] || '').trim()),
  );
  return {
    ...input.entry,
    minutes:
      Math.max(0, Number(input.entry.minutes || 0) - creditedMinutes) +
      expectedMinutes,
    absenceMinutes: nextAbsenceMinutes,
    ...stratum,
    activeDaysCount:
      Number(input.entry.activeDaysCount || 0) + (creditedMinutes > 0 ? 0 : 1),
    absentDaysCount: Math.max(
      0,
      Number(input.entry.absentDaysCount || 0) - (wasAbsent ? 1 : 0),
    ),
    incompleteDaysCount: Math.max(
      0,
      Number(input.entry.incompleteDaysCount || 0) - (wasIncomplete ? 1 : 0),
    ),
    dailyLogs,
    ...creditedDates,
  };
}
