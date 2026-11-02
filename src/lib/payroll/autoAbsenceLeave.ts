import { annualPaidLeaveEntitlementDays, isDateOnly } from './annualPaidLeave';

export const AUTO_ABSENCE_LEAVE_START_PERIOD = '2026-09';
export type AutoLeaveUncoveredReason = 'saldo_habis' | 'belum_berhak';
export interface AutoLeavePlanInput {
  period: string;
  serviceDate: string;
  absentDates: readonly string[];
  blockedDates: ReadonlySet<string>;
  existingAutoDates: ReadonlySet<string>;
  balance: { reservedDays: number; usedDays: number; manualUsedDays: number };
}
export interface AutoLeavePlan {
  cover: string[];
  release: string[];
  keep: string[];
  uncovered: Array<{ date: string; reason: AutoLeaveUncoveredReason }>;
}

/** One shared allowance allocator; source adapters establish actual absence. */
export function planAutoAbsenceLeave(input: AutoLeavePlanInput): AutoLeavePlan {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.period) ||
      input.period < AUTO_ABSENCE_LEAVE_START_PERIOD || !isDateOnly(input.serviceDate)) {
    return { cover: [], release: [], keep: [], uncovered: [] };
  }
  const nonAutoHeld = Math.max(0, input.balance.reservedDays + input.balance.usedDays +
    input.balance.manualUsedDays - input.existingAutoDates.size);
  const wanted = new Set<string>();
  const uncovered: AutoLeavePlan['uncovered'] = [];
  for (const date of [...new Set(input.absentDates)].filter((date) =>
    isDateOnly(date) && date.startsWith(`${input.period}-`) && !input.blockedDates.has(date)).sort()) {
    const entitlement = annualPaidLeaveEntitlementDays(input.serviceDate, date);
    if (!entitlement) uncovered.push({ date, reason: 'belum_berhak' });
    else if (nonAutoHeld + wanted.size >= entitlement) uncovered.push({ date, reason: 'saldo_habis' });
    else wanted.add(date);
  }
  const existing = [...input.existingAutoDates].sort();
  return {
    cover: [...wanted].filter((date) => !input.existingAutoDates.has(date)),
    release: existing.filter((date) => !wanted.has(date)),
    keep: existing.filter((date) => wanted.has(date)),
    uncovered,
  };
}
