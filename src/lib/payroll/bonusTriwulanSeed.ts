/**
 * The one-time load of the paper records Bonus Triwulan was kept on before
 * SAKU took it over: for August and September 2026, who met the Senam Pagi
 * rule and who received the bonus. October's bonus reads both months.
 *
 * The admin fills a sheet the script generates (one row per Loyalis, an ID
 * column so no name has to be matched) with Y or T in every cell. Pure module,
 * so the parsing rules are unit tested.
 */
import {
  BONUS_TRIWULAN_SEED_PERIODS,
  periodMonthName,
  type StratumEntryLike,
} from './bonusTriwulan';

export const SEED_COLUMNS = {
  id: 'ID',
  nipy: 'NIPY',
  name: 'Nama',
  unit: 'Unit',
} as const;

/** "Senam Agustus", "Bonus September", … — one per seed month. */
export function seedSenamColumn(period: string): string {
  return `Senam ${periodMonthName(period)}`;
}

export function seedBonusColumn(period: string): string {
  return `Bonus ${periodMonthName(period)}`;
}

export interface SeedRosterEntry {
  employeeId: string;
  employeeName: string;
  nipy: string;
  unit: string;
}

/** The sheet rows, with the Y/T cells left empty for the admin. */
export function buildSeedTemplateRows(roster: readonly SeedRosterEntry[]): Record<string, string>[] {
  return roster.map((entry) => ({
    [SEED_COLUMNS.id]: entry.employeeId,
    [SEED_COLUMNS.nipy]: entry.nipy,
    [SEED_COLUMNS.name]: entry.employeeName,
    [SEED_COLUMNS.unit]: entry.unit,
    ...Object.fromEntries(BONUS_TRIWULAN_SEED_PERIODS.flatMap((period) => [
      [seedSenamColumn(period), ''],
      [seedBonusColumn(period), ''],
    ])),
  }));
}

export function seedTemplateHeaders(): string[] {
  return [
    SEED_COLUMNS.id,
    SEED_COLUMNS.nipy,
    SEED_COLUMNS.name,
    SEED_COLUMNS.unit,
    ...BONUS_TRIWULAN_SEED_PERIODS.flatMap((period) => [seedSenamColumn(period), seedBonusColumn(period)]),
  ];
}

function parseYesNo(value: unknown): boolean | null {
  const text = String(value ?? '').trim().toUpperCase();
  if (text === 'Y' || text === 'YA') return true;
  if (text === 'T' || text === 'TIDAK') return false;
  return null;
}

export interface SeedEntry {
  employeeId: string;
  employeeName: string;
  /** Per seed month. */
  senamMet: Record<string, boolean>;
  bonusPaid: Record<string, boolean>;
}

export interface SeedParseResult {
  entries: SeedEntry[];
  /** Any error means nothing may be written. */
  errors: string[];
  /** Worth a second look, but not wrong in itself. */
  warnings: string[];
}

/**
 * Reads the filled sheet. Every Loyalis on the roster must appear exactly once
 * with Y or T in every month cell; nobody can have been paid in both months,
 * since a payout starts a fresh three-month count.
 */
export function parseSeedRows(
  rows: readonly Record<string, unknown>[],
  roster: readonly SeedRosterEntry[],
): SeedParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const rosterById = new Map(roster.map((entry) => [entry.employeeId, entry]));
  const seen = new Map<string, number>();
  const entries: SeedEntry[] = [];

  rows.forEach((row, index) => {
    const line = index + 2; // the header is row 1 of the sheet
    const employeeId = String(row[SEED_COLUMNS.id] ?? '').trim();
    const name = String(row[SEED_COLUMNS.name] ?? '').trim();
    if (!employeeId && !name) return; // a blank line at the end of the sheet
    const label = name || employeeId;
    if (!employeeId) {
      errors.push(`Baris ${line} (${label}): kolom ID kosong.`);
      return;
    }
    const rosterEntry = rosterById.get(employeeId);
    if (!rosterEntry) {
      errors.push(`Baris ${line} (${label}): ID ${employeeId} bukan Loyalis pada Agustus/September.`);
      return;
    }
    if (seen.has(employeeId)) {
      errors.push(`Baris ${line} (${label}): sudah ada di baris ${seen.get(employeeId)}.`);
      return;
    }
    seen.set(employeeId, line);

    const senamMet: Record<string, boolean> = {};
    const bonusPaid: Record<string, boolean> = {};
    let complete = true;
    for (const period of BONUS_TRIWULAN_SEED_PERIODS) {
      for (const [column, target] of [
        [seedSenamColumn(period), senamMet],
        [seedBonusColumn(period), bonusPaid],
      ] as const) {
        const value = parseYesNo(row[column]);
        if (value === null) {
          errors.push(`Baris ${line} (${label}): kolom "${column}" harus Y atau T.`);
          complete = false;
        } else {
          target[period] = value;
        }
      }
    }
    if (!complete) return;

    const paidMonths = BONUS_TRIWULAN_SEED_PERIODS.filter((period) => bonusPaid[period]);
    if (paidMonths.length > 1) {
      errors.push(`Baris ${line} (${label}): tidak mungkin menerima bonus di Agustus dan September sekaligus.`);
      return;
    }
    for (const period of paidMonths) {
      if (!senamMet[period]) {
        warnings.push(
          `${rosterEntry.employeeName}: menerima bonus ${periodMonthName(period)} tetapi Senam ${periodMonthName(period)} ditulis T.`,
        );
      }
    }
    entries.push({ employeeId, employeeName: rosterEntry.employeeName, senamMet, bonusPaid });
  });

  for (const entry of roster) {
    if (!seen.has(entry.employeeId)) {
      errors.push(`${entry.employeeName} (${entry.employeeId}) belum ada di lembar.`);
    }
  }
  return { entries, errors, warnings };
}

export interface SeedPlan {
  /** Per seed month: who met the Senam Pagi rule. */
  senamMetIds: Record<string, string[]>;
  /** Per seed month: who received the bonus. */
  recipients: Record<string, Array<{ employeeId: string; employeeName: string }>>;
}

export function planSeed(entries: readonly SeedEntry[]): SeedPlan {
  const byName = [...entries].sort((left, right) => left.employeeName.localeCompare(right.employeeName, 'id-ID'));
  return {
    senamMetIds: Object.fromEntries(BONUS_TRIWULAN_SEED_PERIODS.map((period) => [
      period,
      byName.filter((entry) => entry.senamMet[period]).map((entry) => entry.employeeId).sort(),
    ])),
    recipients: Object.fromEntries(BONUS_TRIWULAN_SEED_PERIODS.map((period) => [
      period,
      byName
        .filter((entry) => entry.bonusPaid[period])
        .map((entry) => ({ employeeId: entry.employeeId, employeeName: entry.employeeName })),
    ])),
  };
}

/**
 * Who can still earn the bonus in October: Strata 1 (from SAKU) and Senam Pagi
 * met (from paper) in both August and September, and paid in neither. October
 * itself still has to qualify.
 */
export function previewOctoberCandidates(
  entries: readonly SeedEntry[],
  presence: Record<string, Record<string, StratumEntryLike | undefined> | null>,
): string[] {
  return entries
    .filter((entry) => BONUS_TRIWULAN_SEED_PERIODS.every((period) => {
      const presenceEntry = presence[period]?.[entry.employeeId];
      return !entry.bonusPaid[period] &&
        entry.senamMet[period] &&
        presenceEntry?.isNotFoundInExcel !== true &&
        Number(presenceEntry?.stratum) === 1;
    }))
    .map((entry) => entry.employeeName)
    .sort((left, right) => left.localeCompare(right, 'id-ID'));
}
