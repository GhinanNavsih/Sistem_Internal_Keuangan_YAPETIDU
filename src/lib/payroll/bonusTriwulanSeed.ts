/**
 * The one-time load of the paper records Bonus Triwulan was kept on before
 * SAKU took it over, for August and September 2026. October's bonus reads both
 * months, in two parts:
 *
 * - who was paid the bonus: a sheet the script generates (one row per Loyalis,
 *   an ID column so no name has to be matched) filled with Y or T;
 * - Senam Pagi attendance: a recap of who attended each session, read by
 *   `parseRekapSheet` and matched to the roster by `matchRekapNames`. The miss
 *   limit counts every session of the three months together, so what is kept is
 *   how many sessions each person missed, not whether they passed.
 *
 * Pure module, so the parsing rules are unit tested.
 */
import {
  BONUS_TRIWULAN_SEED_PERIODS,
  periodMonthName,
  SENAM_PAGI_MAX_MISSES,
  type StratumEntryLike,
} from './bonusTriwulan';
import { normalizeName } from './employeeNames';

export const SEED_COLUMNS = {
  id: 'ID',
  nipy: 'NIPY',
  name: 'Nama',
  unit: 'Unit',
} as const;

/** "Bonus Agustus", "Bonus September": who received the bonus that month. */
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
    ...Object.fromEntries(BONUS_TRIWULAN_SEED_PERIODS.map((period) => [seedBonusColumn(period), ''])),
  }));
}

export function seedTemplateHeaders(): string[] {
  return [
    SEED_COLUMNS.id,
    SEED_COLUMNS.nipy,
    SEED_COLUMNS.name,
    SEED_COLUMNS.unit,
    ...BONUS_TRIWULAN_SEED_PERIODS.map(seedBonusColumn),
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
  /** Per seed month: received the bonus. */
  bonusPaid: Record<string, boolean>;
}

export interface SeedParseResult {
  entries: SeedEntry[];
  /** Any error means nothing may be written. */
  errors: string[];
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

    const bonusPaid: Record<string, boolean> = {};
    let complete = true;
    for (const period of BONUS_TRIWULAN_SEED_PERIODS) {
      const column = seedBonusColumn(period);
      const value = parseYesNo(row[column]);
      if (value === null) {
        errors.push(`Baris ${line} (${label}): kolom "${column}" harus Y atau T.`);
        complete = false;
      } else {
        bonusPaid[period] = value;
      }
    }
    if (!complete) return;

    if (BONUS_TRIWULAN_SEED_PERIODS.filter((period) => bonusPaid[period]).length > 1) {
      errors.push(`Baris ${line} (${label}): tidak mungkin menerima bonus di Agustus dan September sekaligus.`);
      return;
    }
    entries.push({ employeeId, employeeName: rosterEntry.employeeName, bonusPaid });
  });

  for (const entry of roster) {
    if (!seen.has(entry.employeeId)) {
      errors.push(`${entry.employeeName} (${entry.employeeId}) belum ada di lembar.`);
    }
  }
  return { entries, errors };
}

export interface SeedPlan {
  /** Per seed month: who received the bonus. */
  recipients: Record<string, Array<{ employeeId: string; employeeName: string }>>;
}

export function planSeed(entries: readonly SeedEntry[]): SeedPlan {
  const byName = [...entries].sort((left, right) => left.employeeName.localeCompare(right.employeeName, 'id-ID'));
  return {
    recipients: Object.fromEntries(BONUS_TRIWULAN_SEED_PERIODS.map((period) => [
      period,
      byName
        .filter((entry) => entry.bonusPaid[period])
        .map((entry) => ({ employeeId: entry.employeeId, employeeName: entry.employeeName })),
    ])),
  };
}

/**
 * Who can still earn the bonus in October, as far as the paper months say:
 * Strata 1 (from SAKU) in both August and September, paid in neither, and at
 * most one missed Senam Pagi session across the two months (October's own
 * sessions can still add misses). `misses[period][employeeId]` is each
 * person's misses that month; someone missing from it is left out.
 */
export function previewOctoberCandidates(
  entries: readonly SeedEntry[],
  presence: Record<string, Record<string, StratumEntryLike | undefined> | null>,
  misses: Record<string, Readonly<Record<string, number>>>,
): string[] {
  return entries
    .filter((entry) => {
      let total = 0;
      for (const period of BONUS_TRIWULAN_SEED_PERIODS) {
        const presenceEntry = presence[period]?.[entry.employeeId];
        const missed = misses[period]?.[entry.employeeId];
        if (
          entry.bonusPaid[period] ||
          presenceEntry?.isNotFoundInExcel === true ||
          Number(presenceEntry?.stratum) !== 1 ||
          missed === undefined
        ) return false;
        total += missed;
      }
      return total <= SENAM_PAGI_MAX_MISSES;
    })
    .map((entry) => entry.employeeName)
    .sort((left, right) => left.localeCompare(right, 'id-ID'));
}

// ── Attendance recap sheet ("Rekapitulasi absen senam pagi") ───────────────────

/** One person's row in the recap: a 1 under every session they attended. */
export interface RekapRow {
  /** Line in the sheet, for messages. */
  line: number;
  name: string;
  attended: number;
}

export interface RekapSheet {
  period: string;
  /** YYYY-MM-DD of the sessions that were held (a column nobody attended is dropped). */
  sessionDates: string[];
  rows: RekapRow[];
  warnings: string[];
}

const SESSION_HEADER = /^(\d{1,2})\/(\d{1,2})$/;

/**
 * Reads the recap: a header row holding NAMA, one dd/mm column per session and
 * (optionally) TOTAL, then one row per person with a 1 for each session
 * attended. A session column that nobody attended counts as not held.
 */
export function parseRekapSheet(
  grid: readonly (readonly unknown[])[],
  period: string,
): { sheet: RekapSheet } | { error: string } {
  const headerIndex = grid.findIndex((row) => row.some((cell) => String(cell).trim().toUpperCase() === 'NAMA'));
  if (headerIndex < 0) return { error: 'Baris judul dengan kolom NAMA tidak ditemukan.' };
  const header = grid[headerIndex].map((cell) => String(cell).trim());
  const nameCol = header.findIndex((cell) => cell.toUpperCase() === 'NAMA');
  const totalCol = header.findIndex((cell) => cell.toUpperCase() === 'TOTAL');
  const month = Number(period.slice(5));
  const sessionCols: Array<{ col: number; date: string }> = [];
  for (let col = nameCol + 1; col < header.length; col += 1) {
    const match = SESSION_HEADER.exec(header[col]);
    if (!match) continue;
    if (Number(match[2]) !== month) {
      return { error: `Kolom ${header[col]} bukan bulan ${periodMonthName(period)}.` };
    }
    sessionCols.push({ col, date: `${period}-${match[1].padStart(2, '0')}` });
  }
  if (sessionCols.length === 0) return { error: 'Kolom tanggal sesi (dd/mm) tidak ditemukan.' };

  const warnings: string[] = [];
  const people: Array<{ line: number; name: string; marks: boolean[]; total: string }> = [];
  for (let index = headerIndex + 1; index < grid.length; index += 1) {
    const row = grid[index];
    const name = String(row[nameCol] ?? '').trim();
    if (!name) continue;
    people.push({
      line: index + 1,
      name,
      marks: sessionCols.map(({ col }) => String(row[col] ?? '').trim() === '1'),
      total: totalCol >= 0 ? String(row[totalCol] ?? '').trim() : '',
    });
  }

  const held = sessionCols
    .map((session, position) => ({ ...session, position }))
    .filter((session) => {
      const attended = people.some((person) => person.marks[session.position]);
      if (!attended) warnings.push(`Sesi ${session.date.slice(8)}/${session.date.slice(5, 7)} tidak ada yang hadir; dianggap tidak diadakan.`);
      return attended;
    });
  if (held.length === 0) return { error: 'Tidak ada sesi dengan peserta.' };

  const rows = people.map<RekapRow>((person) => {
    const attended = held.filter((session) => person.marks[session.position]).length;
    if (person.total !== '' && Number(person.total) !== attended) {
      warnings.push(`Baris ${person.line} (${person.name}): TOTAL ${person.total} tidak sama dengan jumlah tanda ${attended}.`);
    }
    return { line: person.line, name: person.name, attended };
  });
  const seen = new Set<string>();
  for (const row of rows) {
    const key = normalizeName(row.name);
    if (seen.has(key)) warnings.push(`Baris ${row.line} (${row.name}): nama sama dengan baris sebelumnya.`);
    seen.add(key);
  }
  return { sheet: { period, sessionDates: held.map((session) => session.date), rows, warnings } };
}

/**
 * The fewest sessions a person can have attended and still be within the miss
 * limit. Anyone below it cannot qualify whatever the other months hold, so an
 * unmatched name below it does not matter.
 */
export function rekapMinAttended(sessionCount: number): number {
  return Math.max(0, sessionCount - SENAM_PAGI_MAX_MISSES);
}

export type RekapMatchMethod = 'override' | 'exact' | 'prefix' | 'fuzzy';

export interface RekapMatch {
  row: RekapRow;
  employeeId: string | null;
  employeeName: string | null;
  method: RekapMatchMethod | null;
  /** Why a row is unmatched; empty for a match. */
  note: string;
  /** The nearest roster names, for a row that is not matched. */
  suggestions: Array<{ employeeId: string; employeeName: string; distance: number }>;
}

/** A typo-sized difference: this share of the longer name, at most. */
export const REKAP_FUZZY_MAX_RATIO = 0.15;

const flatName = (value: string) => value.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

function editDistance(left: string, right: string): number {
  const rows = Array.from({ length: left.length + 1 }, (_, i) => [i, ...new Array<number>(right.length).fill(0)]);
  for (let j = 1; j <= right.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    }
  }
  return rows[left.length][right.length];
}

const METHOD_RANK: Record<Exclude<RekapMatchMethod, 'override'>, number> = { exact: 0, prefix: 1, fuzzy: 2 };

/**
 * Matches the sheet's names to the roster, as well as names written by hand
 * can be: the same name once titles and degrees are stripped (`exact`), a name
 * cut short by the sheet's column (`prefix`), or a typo-sized difference or
 * the sheet's tokens all appearing in the roster's (`fuzzy`). Each person is
 * claimed once, best match first. `overrides` (sheet name → employee id, or
 * null for "not a Loyalis here") settle what the rules cannot.
 */
export function matchRekapNames(
  rows: readonly RekapRow[],
  roster: ReadonlyArray<{ employeeId: string; employeeName: string }>,
  overrides: Readonly<Record<string, string | null>> = {},
): RekapMatch[] {
  const people = roster.map((entry) => ({
    ...entry,
    norm: normalizeName(entry.employeeName),
    flat: flatName(entry.employeeName),
  }));
  const results: RekapMatch[] = rows.map((row) => ({
    row, employeeId: null, employeeName: null, method: null, note: '', suggestions: [],
  }));
  const taken = new Map<string, number>();
  const claim = (resultIndex: number, person: (typeof people)[number], method: RekapMatchMethod) => {
    results[resultIndex].employeeId = person.employeeId;
    results[resultIndex].employeeName = person.employeeName;
    results[resultIndex].method = method;
    taken.set(person.employeeId, resultIndex);
  };

  const pending: number[] = [];
  rows.forEach((row, index) => {
    if (!Object.prototype.hasOwnProperty.call(overrides, row.name)) {
      pending.push(index);
      return;
    }
    const target = overrides[row.name];
    if (target === null) {
      results[index].note = 'Bukan Loyalis aktif (ditetapkan manual).';
      return;
    }
    const person = people.find((candidate) => candidate.employeeId === target);
    if (!person) {
      results[index].note = `Penetapan manual ${target} tidak ada di daftar Loyalis.`;
    } else if (taken.has(person.employeeId)) {
      results[index].note = `Penetapan manual ${target} sudah dipakai baris lain.`;
    } else {
      claim(index, person, 'override');
    }
  });

  // Candidates per remaining row, then the best of each, claimed best first.
  const best: Array<{ index: number; person: (typeof people)[number]; method: Exclude<RekapMatchMethod, 'override'>; distance: number }> = [];
  for (const index of pending) {
    const norm = normalizeName(rows[index].name);
    const flat = flatName(rows[index].name);
    const tokens = norm.split(' ').filter(Boolean);
    const found: Array<{ person: (typeof people)[number]; method: Exclude<RekapMatchMethod, 'override'>; distance: number }> = [];
    for (const person of people) {
      const distance = editDistance(norm, person.norm);
      if (person.norm === norm) found.push({ person, method: 'exact', distance: 0 });
      else if (flat.length >= 8 && person.flat.startsWith(flat)) found.push({ person, method: 'prefix', distance });
      else if (
        distance / Math.max(norm.length, person.norm.length, 1) <= REKAP_FUZZY_MAX_RATIO ||
        (tokens.length >= 2 && tokens.every((token) => person.norm.split(' ').includes(token)))
      ) found.push({ person, method: 'fuzzy', distance });
    }
    found.sort((a, b) => METHOD_RANK[a.method] - METHOD_RANK[b.method] || a.distance - b.distance);
    if (found.length === 0) continue;
    if (found.length > 1 && found[0].method === found[1].method && found[0].distance === found[1].distance) {
      results[index].note = `Beberapa nama cocok: ${found.slice(0, 3).map((item) => item.person.employeeName).join('; ')}.`;
      continue;
    }
    best.push({ index, ...found[0] });
  }
  best.sort((a, b) => METHOD_RANK[a.method] - METHOD_RANK[b.method] || a.distance - b.distance);
  for (const candidate of best) {
    if (taken.has(candidate.person.employeeId)) {
      const winner = results[taken.get(candidate.person.employeeId)!].row.name;
      results[candidate.index].note = `${candidate.person.employeeName} sudah dipakai baris "${winner}".`;
      continue;
    }
    claim(candidate.index, candidate.person, candidate.method);
  }

  for (const result of results) {
    if (result.employeeId) continue;
    const norm = normalizeName(result.row.name);
    result.suggestions = people
      .map((person) => ({ employeeId: person.employeeId, employeeName: person.employeeName, distance: editDistance(norm, person.norm) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 2);
    if (!result.note) result.note = 'Tidak ada nama yang cocok.';
  }
  return results;
}
