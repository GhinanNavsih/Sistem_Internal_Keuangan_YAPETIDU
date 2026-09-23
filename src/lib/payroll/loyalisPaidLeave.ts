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
  [key: string]: unknown;
}

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
  if (status === 'TIDAK HADIR' || status === 'CUTI') return false;
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
}): LoyalisPaidLeaveEntry {
  const dateKey = paidLeaveIsoToLoyalisDate(input.leaveDate);
  if (!dateKey) throw new Error('Tanggal cuti Loyalis tidak valid.');
  const dailyLogs = [...(input.entry.dailyLogs || [])];
  const existingIndex = dailyLogs.findIndex((row) => row.Tanggal === dateKey);
  const existing = existingIndex >= 0 ? dailyLogs[existingIndex] : null;
  const wasAlreadyApplied = String(existing?.['Jam kerja'] || '').toUpperCase() === 'CUTI';
  const nextRow: LoyalisPaidLeaveDailyLog = {
    ...(existing || {}),
    Tanggal: dateKey,
    'Jam kerja': 'CUTI',
    'Scan masuk': ANNUAL_PAID_LEAVE_SCAN_IN.slice(0, 5),
    'Scan pulang': ANNUAL_PAID_LEAVE_SCAN_OUT.slice(0, 5),
    annualPaidLeave: true,
    annualPaidLeaveDate: input.leaveDate,
    isOffDay: input.isOffDay,
  };
  if (existingIndex >= 0) dailyLogs[existingIndex] = nextRow;
  else dailyLogs.push(nextRow);
  dailyLogs.sort((left, right) =>
    dateSortValue(left.Tanggal).localeCompare(dateSortValue(right.Tanggal)),
  );

  const approvedPaidLeaveDates = Array.from(
    new Set([...(input.entry.approvedPaidLeaveDates || []), input.leaveDate]),
  ).sort();
  if (wasAlreadyApplied || input.isOffDay) {
    return { ...input.entry, dailyLogs, approvedPaidLeaveDates };
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
    approvedPaidLeaveDates,
  };
}
