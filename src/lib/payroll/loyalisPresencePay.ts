/**
 * How Loyalis attendance turns into pay: Presensi (an hourly earning for the
 * month's target minutes) and Bonus Presensi (a flat bonus cut by stratum).
 *
 * From `LOYALIS_NET_PRESENCE_START_PERIOD` a Loyalis earns neither until the
 * period's attendance is imported, and then both are paid net on the earnings
 * side, with no Potongan Presensi / Potongan Bonus Presensi rows. Earlier
 * periods keep the shape their locked slips were signed with: the full
 * earning and bonus, then two deduction rows taking the shortfall back.
 *
 * Pure module — no Firebase — so the whole rule set is unit tested.
 */

/** Flat monthly attendance bonus for a Loyalis employee with no shortfall. */
export const LOYALIS_PRESENCE_BONUS = 250_000;
/** Rupiah per hour used for both the attendance earning and its shortfall. */
export const LOYALIS_HOURLY_RATE = 1_650;
export const LOYALIS_DEFAULT_WORKING_DAYS = 25;
export const LOYALIS_DEFAULT_EXPECTED_HOURS = 6.5;

/**
 * First payroll period paid the net way. Re-saving an older month's presence
 * must not change the figures its locked slips were signed with, so the cut
 * is by period rather than by deploy date.
 */
export const LOYALIS_NET_PRESENCE_START_PERIOD = '2026-11';

/** Accepts `YYYY-MM` or `YYYY_MM`; anything else is treated as legacy. */
export function loyalisNetPresenceApplies(period: string | undefined): boolean {
  const match = /^(\d{4})[-_](\d{2})$/.exec(String(period || '').trim());
  if (!match) return false;
  return `${match[1]}-${match[2]}` >= LOYALIS_NET_PRESENCE_START_PERIOD;
}

// ── One employee ────────────────────────────────────────────────────────────

export interface LoyalisNetPresence {
  /** Presensi for a full month present and on time. */
  grossPresensi: number;
  /** Presensi lost to the minutes short, never more than the gross. */
  presensiShortfall: number;
  /** Presensi actually earned. */
  presensiEarning: number;
  /** Bonus lost to the stratum (0 / 100k / 150k / 200k / 250k). */
  bonusDeduction: number;
  /** Bonus actually earned: 250k for Strata 1 down to 0 for Strata 5. */
  presenceBonus: number;
}

/**
 * The one place the earned Presensi and Bonus Presensi of one Loyalis are
 * worked out. `bonusDeduction` is the stratum deduction the presence page
 * stores on each entry. Rounding matches the legacy rows, so the net equals
 * what the old earning minus its deduction paid.
 */
export function loyalisNetPresence(input: {
  workingDays: number;
  expectedHours: number;
  absenceMinutes: number;
  bonusDeduction: number;
}): LoyalisNetPresence {
  const grossPresensi = Math.round(
    (Number(input.workingDays) || 0) * (Number(input.expectedHours) || 0) * LOYALIS_HOURLY_RATE,
  );
  const absenceMinutes = Math.max(0, Number(input.absenceMinutes) || 0);
  const presensiShortfall = Math.min(
    grossPresensi,
    Math.round((absenceMinutes / 60) * LOYALIS_HOURLY_RATE),
  );
  const bonusDeduction = Math.min(
    LOYALIS_PRESENCE_BONUS,
    Math.max(0, Number(input.bonusDeduction) || 0),
  );
  return {
    grossPresensi,
    presensiShortfall,
    presensiEarning: grossPresensi - presensiShortfall,
    bonusDeduction,
    presenceBonus: LOYALIS_PRESENCE_BONUS - bonusDeduction,
  };
}

// ── One slip ────────────────────────────────────────────────────────────────

export interface LoyalisPresenceEntry {
  deduction?: number;
  absenceMinutes?: number;
}

export interface LoyalisPresenceDocument {
  workingDays?: number;
  expectedHours?: number;
  entries?: Record<string, LoyalisPresenceEntry | undefined>;
}

export interface LoyalisPresenceAmounts {
  presensiEarning: number;
  presenceBonus: number;
  /** Potongan Presensi row. Always 0 from `LOYALIS_NET_PRESENCE_START_PERIOD`. */
  presensiDeduction: number;
  /** Potongan Bonus Presensi row. Always 0 from `LOYALIS_NET_PRESENCE_START_PERIOD`. */
  presenceDeduction: number;
  /** The period has imported attendance entries. */
  imported: boolean;
  /** Informational: Presensi lost to the minutes short. */
  presensiShortfall: number;
  /** Informational: bonus lost to the stratum. */
  bonusDeduction: number;
}

/**
 * Loyalis presence amounts for one slip. The payroll dashboard, the employee
 * payslip and propagation all call this, so a slip built anywhere agrees.
 *
 * In both rules an employee missing from imported entries earns neither.
 * Before `LOYALIS_NET_PRESENCE_START_PERIOD`, a period with no entries at all
 * credited everyone the full earning and bonus.
 */
export function loyalisPresenceAmounts(
  presence: LoyalisPresenceDocument | null | undefined,
  employeeId: string,
  period: string,
): LoyalisPresenceAmounts {
  const entries = presence?.entries;
  const hasEntries = Boolean(entries && Object.keys(entries).length > 0);
  const entry = hasEntries ? entries?.[employeeId] : undefined;
  const isMissingFromEntries = hasEntries && !entry;

  const workingDays = Number(presence?.workingDays) || LOYALIS_DEFAULT_WORKING_DAYS;
  const expectedHours = Number(presence?.expectedHours) || LOYALIS_DEFAULT_EXPECTED_HOURS;

  if (loyalisNetPresenceApplies(period)) {
    if (!entry) {
      return {
        presensiEarning: 0,
        presenceBonus: 0,
        presensiDeduction: 0,
        presenceDeduction: 0,
        imported: hasEntries,
        presensiShortfall: 0,
        bonusDeduction: 0,
      };
    }
    const net = loyalisNetPresence({
      workingDays,
      expectedHours,
      absenceMinutes: Number(entry.absenceMinutes) || 0,
      bonusDeduction: Number(entry.deduction) || 0,
    });
    return {
      presensiEarning: net.presensiEarning,
      presenceBonus: net.presenceBonus,
      presensiDeduction: 0,
      presenceDeduction: 0,
      imported: true,
      presensiShortfall: net.presensiShortfall,
      bonusDeduction: net.bonusDeduction,
    };
  }

  const presensiDeduction = entry
    ? Math.round(((Number(entry.absenceMinutes) || 0) / 60) * LOYALIS_HOURLY_RATE)
    : 0;
  const presenceDeduction = entry ? Number(entry.deduction) || 0 : 0;
  return {
    presensiEarning: isMissingFromEntries
      ? 0
      : Math.round(workingDays * expectedHours * LOYALIS_HOURLY_RATE),
    presenceBonus: isMissingFromEntries ? 0 : LOYALIS_PRESENCE_BONUS,
    presensiDeduction,
    presenceDeduction,
    imported: hasEntries,
    presensiShortfall: presensiDeduction,
    bonusDeduction: presenceDeduction,
  };
}

// ── The whole roster (Presensi Loyalis page) ────────────────────────────────

export interface LoyalisPresenceDeltaRow {
  employeeId?: string | null;
  absenceMinutes?: number;
  /** Stratum deduction of the bonus, as stored on the presence entry. */
  deduction?: number;
}

export interface LoyalisPresenceDeltaPart {
  /** Everyone present every working day and on time. */
  ideal: number;
  /** What the slips pay. */
  actual: number;
  /** ideal − actual. */
  delta: number;
}

export interface LoyalisPresenceDelta {
  employeeCount: number;
  shortfallMinutes: number;
  presensi: LoyalisPresenceDeltaPart;
  bonus: LoyalisPresenceDeltaPart;
  totalDelta: number;
}

/**
 * What attendance cost the roster this month, compared with everyone being
 * present every working day and on time. Only rows linked to an employee
 * count; a row with no scans carries the full-month shortfall and Stratum 5,
 * so it adds its whole Presensi and bonus to the delta. A later row for the
 * same employee replaces an earlier one, as the presence save does.
 */
export function summarizeLoyalisPresenceDelta(
  rows: readonly LoyalisPresenceDeltaRow[],
  workingDays: number,
  expectedHours: number,
): LoyalisPresenceDelta {
  const byEmployee = new Map<string, LoyalisPresenceDeltaRow>();
  for (const row of rows) {
    if (row.employeeId) byEmployee.set(row.employeeId, row);
  }

  let shortfallMinutes = 0;
  const presensi = { ideal: 0, actual: 0, delta: 0 };
  const bonus = { ideal: 0, actual: 0, delta: 0 };
  for (const row of byEmployee.values()) {
    const net = loyalisNetPresence({
      workingDays,
      expectedHours,
      absenceMinutes: Number(row.absenceMinutes) || 0,
      bonusDeduction: Number(row.deduction) || 0,
    });
    shortfallMinutes += Math.max(0, Number(row.absenceMinutes) || 0);
    presensi.ideal += net.grossPresensi;
    presensi.actual += net.presensiEarning;
    bonus.ideal += LOYALIS_PRESENCE_BONUS;
    bonus.actual += net.presenceBonus;
  }
  presensi.delta = presensi.ideal - presensi.actual;
  bonus.delta = bonus.ideal - bonus.actual;

  return {
    employeeCount: byEmployee.size,
    shortfallMinutes,
    presensi,
    bonus,
    totalDelta: presensi.delta + bonus.delta,
  };
}

// ── Explaining a saved slip (payslip page and PDF) ──────────────────────────

interface MoneyRow {
  label: string;
  amount: number;
}

export interface LoyalisPresenceInfo {
  workingDays?: number;
  expectedHours?: number;
  absenceMinutes?: number;
  bonusDeduction?: number;
  /** False while the period has no imported attendance. Missing means imported. */
  imported?: boolean;
}

export interface LoyalisPresenceBreakdown {
  /** False: Presensi and Bonus Presensi wait for the attendance import. */
  imported: boolean;
  workingDays: number;
  targetMinutes: number;
  absenceMinutes: number;
  actualMinutes: number;
  grossPresensi: number;
  presensiShortfall: number;
  netPresensi: number;
  fullBonus: number;
  bonusDeduction: number;
  netBonus: number;
  stratum: 1 | 2 | 3 | 4 | 5;
  /** e.g. "Kekurangan ≤ 750 menit". */
  stratumRule: string;
}

const MINUTE_RATE = LOYALIS_HOURLY_RATE / 60;

function amountOf(rows: readonly MoneyRow[] | undefined, label: string): number | null {
  const row = rows?.find((field) => field.label.trim().toUpperCase() === label);
  return row ? Number(row.amount) || 0 : null;
}

function stratumFromBonusDeduction(deduction: number): 1 | 2 | 3 | 4 | 5 {
  if (deduction <= 0) return 1;
  if (deduction <= 100_000) return 2;
  if (deduction <= 150_000) return 3;
  if (deduction <= 200_000) return 4;
  return 5;
}

function stratumRuleText(stratum: number, workingDays: number): string {
  const limit = (perDay: number) => (workingDays * perDay).toLocaleString('id-ID');
  if (stratum === 1) return 'Kekurangan = 0 menit';
  if (stratum === 2) return `Kekurangan ≤ ${limit(30)} menit`;
  if (stratum === 3) return `Kekurangan ≤ ${limit(35)} menit`;
  if (stratum === 4) return `Kekurangan ≤ ${limit(40)} menit`;
  return `Kekurangan > ${limit(40)} menit`;
}

/**
 * Reads a saved Loyalis slip back into the figures its Presensi explanation
 * shows. Handles both shapes: a legacy slip carries the full earning plus
 * Potongan rows, a net slip carries only what was earned.
 */
export function loyalisPresenceBreakdown(input: {
  earnings: readonly MoneyRow[] | undefined;
  deductions: readonly MoneyRow[] | undefined;
  presenceInfo?: LoyalisPresenceInfo | null;
}): LoyalisPresenceBreakdown {
  const info = input.presenceInfo || {};
  const presensiRow = amountOf(input.earnings, 'PRESENSI') ?? 0;
  const bonusRow = amountOf(input.earnings, 'BONUS PRESENSI') ?? 0;
  const potonganPresensi = amountOf(input.deductions, 'POTONGAN PRESENSI');
  const potonganBonus = amountOf(input.deductions, 'POTONGAN BONUS PRESENSI');
  const legacy = potonganPresensi !== null || potonganBonus !== null;

  const hasSchedule = Number(info.workingDays) > 0 && Number(info.expectedHours) > 0;
  let workingDays = hasSchedule ? Number(info.workingDays) : LOYALIS_DEFAULT_WORKING_DAYS;
  const expectedHours = hasSchedule ? Number(info.expectedHours) : LOYALIS_DEFAULT_EXPECTED_HOURS;
  let targetMinutes = Math.round(workingDays * expectedHours * 60);
  if (!hasSchedule && legacy && presensiRow > 0) {
    // A legacy slip's Presensi row is the full-month earning, so it carries
    // the target even when the schedule was not sent along.
    targetMinutes = Math.round(presensiRow / MINUTE_RATE);
    workingDays = Math.round(targetMinutes / (LOYALIS_DEFAULT_EXPECTED_HOURS * 60)) || LOYALIS_DEFAULT_WORKING_DAYS;
  }

  let grossPresensi: number;
  let presensiShortfall: number;
  let fullBonus: number;
  let bonusDeduction: number;
  if (legacy) {
    grossPresensi = presensiRow;
    presensiShortfall = potonganPresensi ?? 0;
    fullBonus = bonusRow;
    bonusDeduction = potonganBonus ?? 0;
  } else {
    grossPresensi = Math.round(workingDays * expectedHours * LOYALIS_HOURLY_RATE);
    presensiShortfall = Math.max(0, grossPresensi - presensiRow);
    fullBonus = LOYALIS_PRESENCE_BONUS;
    bonusDeduction = Math.max(0, LOYALIS_PRESENCE_BONUS - bonusRow);
  }

  const savedAbsence = Number(info.absenceMinutes) || 0;
  const absenceMinutes = savedAbsence > 0
    ? savedAbsence
    : Math.round(presensiShortfall / MINUTE_RATE);
  const stratum = stratumFromBonusDeduction(bonusDeduction);

  return {
    // The legacy rule credited everyone before any import, so a legacy slip
    // always has figures to explain.
    imported: legacy || info.imported !== false,
    workingDays,
    targetMinutes,
    absenceMinutes,
    actualMinutes: Math.max(0, targetMinutes - absenceMinutes),
    grossPresensi,
    presensiShortfall,
    netPresensi: Math.max(0, grossPresensi - presensiShortfall),
    fullBonus,
    bonusDeduction,
    netBonus: Math.max(0, fullBonus - bonusDeduction),
    stratum,
    stratumRule: stratumRuleText(stratum, workingDays),
  };
}
