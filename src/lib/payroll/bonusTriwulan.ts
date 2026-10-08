/**
 * Bonus Triwulan: Rp500.000 for a Loyalis who qualifies three payroll months in
 * a row, paid on the slip of the third month.
 *
 * A month qualifies when the person reached Strata 1 Bonus Presensi and missed
 * at most one Senam Pagi session. Every streak starts fresh: months that paid a
 * bonus never count toward the next one, so month M pays when M-2, M-1 and M
 * all qualify and neither M-2 nor M-1 paid.
 *
 * Senam Pagi is its own roll call, independent of scan masuk/pulang, cuti or
 * ganti libur. Each recorded session stores who was present, so a month nobody
 * recorded never counts as attended; a month without any session must be
 * marked as such.
 *
 * Pure module, no Firebase, so the rules are unit tested and shared by the
 * page, the API and the seed script.
 */

export const SENAM_PAGI_PATH = '/dashboard/payroll/uraian/senam-pagi';

export const SENAM_PAGI_COLLECTION = 'SenamPagi';
export const BONUS_TRIWULAN_COLLECTION = 'BonusTriwulan';

export const BONUS_TRIWULAN_SOURCE_KIND = 'bonus_triwulan';
/** Also the Vakasi event name, so it is the earning label on the slip. */
export const BONUS_TRIWULAN_LABEL = 'Bonus Triwulan';
export const BONUS_TRIWULAN_AMOUNT = 500_000;
export const BONUS_TRIWULAN_STREAK_MONTHS = 3;
/** The first month SAKU works the bonus out itself. */
export const BONUS_TRIWULAN_START_PERIOD = '2026-10';
/** The months before it, taken from the paper records by the seed script. */
export const BONUS_TRIWULAN_SEED_PERIODS = ['2026-08', '2026-09'] as const;
export const SENAM_PAGI_MAX_MISSES = 1;

export type BonusTriwulanSource = 'saku' | 'paper';

const PERIOD_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const EMPLOYEE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

const MONTH_NAMES = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

export function isValidPeriod(period: unknown): period is string {
  return typeof period === 'string' && PERIOD_PATTERN.test(period);
}

export function shiftPeriod(period: string, months: number): string {
  const [year, month] = period.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + months, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** "Oktober 2026". */
export function periodLabel(period: string): string {
  const match = PERIOD_PATTERN.exec(period);
  return match ? `${MONTH_NAMES[Number(match[2]) - 1]} ${match[1]}` : period;
}

/** "Oktober" — the month alone, for compact table headers and reasons. */
export function periodMonthName(period: string): string {
  const match = PERIOD_PATTERN.exec(period);
  return match ? MONTH_NAMES[Number(match[2]) - 1] : period;
}

export function isBonusTriwulanSeedPeriod(period: string): boolean {
  return (BONUS_TRIWULAN_SEED_PERIODS as readonly string[]).includes(period);
}

/** The months M-2, M-1, M a bonus for M looks at, oldest first. */
export function bonusTriwulanWindow(period: string): string[] {
  return Array.from({ length: BONUS_TRIWULAN_STREAK_MONTHS }, (_, index) =>
    shiftPeriod(period, index - (BONUS_TRIWULAN_STREAK_MONTHS - 1)),
  );
}

export function bonusTriwulanEventId(period: string): string {
  return `BONUS_TRIWULAN_${period}`;
}

export function isBonusTriwulanEventId(eventId: string): boolean {
  return eventId.startsWith('BONUS_TRIWULAN_');
}

// ── Senam Pagi ───────────────────────────────────────────────────────────────

export interface SenamPagiSession {
  /** YYYY-MM-DD, inside the month. One session per day. */
  date: string;
  presentEmployeeIds: string[];
}

export interface SenamPagiMonth {
  period: string;
  source: BonusTriwulanSource;
  /** Marked explicitly: the month had no Senam Pagi at all. */
  noSessions: boolean;
  /** Sorted by date. */
  sessions: SenamPagiSession[];
  /** Paper months only: who met the Senam Pagi rule that month. */
  paperMetEmployeeIds: string[];
  revision: number;
}

function stringIds(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((id): id is string => typeof id === 'string' && EMPLOYEE_ID_PATTERN.test(id)))].sort()
    : [];
}

/** Reads a stored `SenamPagi/{period}` document; null when there is none. */
export function parseSenamPagiDoc(period: string, data: unknown): SenamPagiMonth | null {
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  const rawSessions = record.sessions && typeof record.sessions === 'object'
    ? record.sessions as Record<string, unknown>
    : {};
  const sessions = Object.entries(rawSessions)
    .filter(([date]) => date.startsWith(`${period}-`) && DATE_PATTERN.test(date))
    .map(([date, session]) => ({
      date,
      presentEmployeeIds: stringIds(
        session && typeof session === 'object'
          ? (session as Record<string, unknown>).presentEmployeeIds
          : [],
      ),
    }))
    .sort((left, right) => left.date.localeCompare(right.date));
  return {
    period,
    source: record.source === 'paper' ? 'paper' : 'saku',
    noSessions: record.noSessions === true,
    sessions,
    paperMetEmployeeIds: stringIds(record.paperMetEmployeeIds),
    revision: Number(record.revision || 0),
  };
}

/** Whether the month has been filled in at all (a paper record counts). */
export function isSenamPagiRecorded(month: SenamPagiMonth | null | undefined): boolean {
  if (!month) return false;
  return month.source === 'paper' || month.noSessions || month.sessions.length > 0;
}

export interface SenamPagiStanding {
  recorded: boolean;
  /** Sessions held that month (0 for a paper month or one without senam). */
  sessionCount: number;
  misses: number;
  met: boolean;
}

export function senamPagiStanding(
  month: SenamPagiMonth | null | undefined,
  employeeId: string,
): SenamPagiStanding {
  if (!month || !isSenamPagiRecorded(month)) {
    return { recorded: false, sessionCount: 0, misses: 0, met: false };
  }
  if (month.source === 'paper') {
    return {
      recorded: true,
      sessionCount: 0,
      misses: 0,
      met: month.paperMetEmployeeIds.includes(employeeId),
    };
  }
  if (month.sessions.length === 0) {
    // Only reachable with `noSessions`: nothing to attend, so nothing missed.
    return { recorded: true, sessionCount: 0, misses: 0, met: true };
  }
  const misses = month.sessions.filter(
    (session) => !session.presentEmployeeIds.includes(employeeId),
  ).length;
  return {
    recorded: true,
    sessionCount: month.sessions.length,
    misses,
    met: misses <= SENAM_PAGI_MAX_MISSES,
  };
}

export type SenamPagiCommand =
  | { action: 'save_session'; date: string; presentEmployeeIds: string[] }
  | { action: 'delete_session'; date: string }
  | { action: 'set_no_sessions'; noSessions: boolean };

/**
 * Applies one recorder action to the month, or says why it is refused.
 * `rosterIds` are the Loyalis on the payroll that month; `today` is the
 * Jakarta date, since a session cannot be recorded before it happens.
 */
export function applySenamPagiCommand(
  current: SenamPagiMonth | null,
  command: SenamPagiCommand,
  context: { period: string; today: string; rosterIds: ReadonlySet<string> },
): { month: SenamPagiMonth } | { error: string } {
  if (current?.source === 'paper') {
    return { error: 'Senam Pagi bulan ini berasal dari arsip kertas dan tidak dapat diubah.' };
  }
  const month: SenamPagiMonth = current
    ? { ...current, sessions: [...current.sessions] }
    : {
        period: context.period,
        source: 'saku',
        noSessions: false,
        sessions: [],
        paperMetEmployeeIds: [],
        revision: 0,
      };

  if (command.action === 'set_no_sessions') {
    if (command.noSessions && month.sessions.length > 0) {
      return { error: 'Hapus dulu sesi yang sudah dicatat sebelum menandai bulan ini tanpa Senam Pagi.' };
    }
    return { month: { ...month, noSessions: command.noSessions } };
  }

  const date = String(command.date || '');
  if (!DATE_PATTERN.test(date) || !date.startsWith(`${context.period}-`) ||
    Number.isNaN(Date.parse(`${date}T00:00:00Z`)) ||
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    return { error: `Tanggal sesi harus berada di ${periodLabel(context.period)}.` };
  }

  if (command.action === 'delete_session') {
    if (!month.sessions.some((session) => session.date === date)) {
      return { error: 'Sesi Senam Pagi tidak ditemukan.' };
    }
    return { month: { ...month, sessions: month.sessions.filter((session) => session.date !== date) } };
  }

  if (date > context.today) {
    return { error: 'Sesi Senam Pagi yang belum berlangsung tidak dapat dicatat.' };
  }
  const presentEmployeeIds = [...new Set(command.presentEmployeeIds)].sort();
  const unknown = presentEmployeeIds.filter((employeeId) => !context.rosterIds.has(employeeId));
  if (unknown.length > 0) {
    return { error: `Pegawai berikut bukan Loyalis aktif bulan ini: ${unknown.join(', ')}.` };
  }
  const sessions = month.sessions.filter((session) => session.date !== date);
  sessions.push({ date, presentEmployeeIds });
  sessions.sort((left, right) => left.date.localeCompare(right.date));
  return { month: { ...month, noSessions: false, sessions } };
}

// ── Bonus Triwulan ───────────────────────────────────────────────────────────

/** What the bonus needs from one Loyalis presence entry. */
export interface StratumEntryLike {
  stratum?: unknown;
  isNotFoundInExcel?: unknown;
}

export interface BonusTriwulanMonthInput {
  period: string;
  /** The month's effective presence entries; null when presence is not saved. */
  presence: Record<string, StratumEntryLike | undefined> | null;
  senam: SenamPagiMonth | null;
}

export interface BonusTriwulanInput {
  period: string;
  /** Loyalis on the payroll in `period`. */
  employees: ReadonlyArray<{ employeeId: string; employeeName: string }>;
  /** Exactly the months of `bonusTriwulanWindow(period)`, oldest first. */
  months: readonly BonusTriwulanMonthInput[];
  /** Who was paid in M-2 and M-1; null when that month has no record yet. */
  priorRecipients: ReadonlyArray<{ period: string; recipients: readonly string[] | null }>;
}

export interface BonusTriwulanMonthStanding {
  period: string;
  /** Null when the person has no presence entry that month. */
  stratum: number | null;
  strata1: boolean;
  senam: SenamPagiStanding;
  qualifies: boolean;
}

export interface BonusTriwulanRow {
  employeeId: string;
  employeeName: string;
  months: BonusTriwulanMonthStanding[];
  /** The earlier month of the window that already paid them, if any. */
  paidIn: string | null;
  awarded: boolean;
  reason: string;
}

export interface BonusTriwulanEvaluation {
  period: string;
  rows: BonusTriwulanRow[];
  /** Sorted employee ids. Empty while `missing` is not. */
  recipients: string[];
  /** Why the month cannot be decided yet; empty when every input is there. */
  missing: string[];
}

function entryStratum(entry: StratumEntryLike | undefined): number | null {
  if (!entry || entry.isNotFoundInExcel === true) return null;
  const stratum = Number(entry.stratum);
  return Number.isInteger(stratum) && stratum >= 1 ? stratum : null;
}

function hasEntries(presence: BonusTriwulanMonthInput['presence']): boolean {
  return Boolean(presence && Object.keys(presence).length > 0);
}

/** Which inputs a month still lacks, as messages for the page and the close check. */
function missingInputs(input: BonusTriwulanInput): string[] {
  const missing: string[] = [];
  for (const month of input.months) {
    if (!hasEntries(month.presence)) {
      missing.push(`Presensi Loyalis ${periodLabel(month.period)} belum disimpan.`);
    }
    if (!isSenamPagiRecorded(month.senam)) {
      missing.push(`Senam Pagi ${periodLabel(month.period)} belum dicatat.`);
    }
  }
  for (const prior of input.priorRecipients) {
    if (prior.recipients === null) {
      missing.push(
        isBonusTriwulanSeedPeriod(prior.period)
          ? `Data Bonus Triwulan ${periodLabel(prior.period)} dari arsip kertas belum dimasukkan.`
          : `Bonus Triwulan ${periodLabel(prior.period)} belum dihitung.`,
      );
    }
  }
  return missing;
}

function failureReason(standing: BonusTriwulanMonthStanding): string | null {
  const month = periodMonthName(standing.period);
  if (standing.stratum === null) return `${month}: tidak ada data presensi`;
  if (!standing.strata1) return `${month}: Strata ${standing.stratum}`;
  if (!standing.senam.recorded) return null;
  if (!standing.senam.met) {
    return standing.senam.sessionCount > 0
      ? `${month}: tidak ikut senam ${standing.senam.misses}×`
      : `${month}: tidak memenuhi Senam Pagi`;
  }
  return null;
}

export function evaluateBonusTriwulan(input: BonusTriwulanInput): BonusTriwulanEvaluation {
  const window = bonusTriwulanWindow(input.period);
  if (input.months.length !== window.length ||
    input.months.some((month, index) => month.period !== window[index])) {
    throw new Error('Bulan masukan Bonus Triwulan tidak sesuai.');
  }
  const missing = missingInputs(input);
  const complete = missing.length === 0;
  const paidBy = input.priorRecipients
    .filter((prior) => prior.recipients)
    .map((prior) => ({ period: prior.period, ids: new Set(prior.recipients) }));

  const rows = [...input.employees]
    .sort((left, right) => left.employeeName.localeCompare(right.employeeName, 'id-ID'))
    .map<BonusTriwulanRow>((employee) => {
      const months = input.months.map<BonusTriwulanMonthStanding>((month) => {
        const stratum = hasEntries(month.presence)
          ? entryStratum(month.presence?.[employee.employeeId])
          : null;
        const senam = senamPagiStanding(month.senam, employee.employeeId);
        const strata1 = stratum === 1;
        return { period: month.period, stratum, strata1, senam, qualifies: strata1 && senam.met };
      });
      // The latest earlier payout is the one that resets the count.
      const paidIn = [...paidBy].reverse().find((prior) => prior.ids.has(employee.employeeId))?.period || null;
      const allQualify = months.every((month) => month.qualifies);
      const awarded = complete && allQualify && !paidIn;
      let reason: string;
      if (awarded) {
        reason = `Dapat ${BONUS_TRIWULAN_LABEL}`;
      } else if (paidIn) {
        reason = `Sudah dapat di ${periodMonthName(paidIn)}; hitungan dimulai lagi`;
      } else {
        const failures = months.map(failureReason).filter((text): text is string => Boolean(text));
        reason = failures.length > 0
          ? failures.join('; ')
          : 'Menunggu data lengkap';
      }
      return { employeeId: employee.employeeId, employeeName: employee.employeeName, months, paidIn, awarded, reason };
    });

  return {
    period: input.period,
    rows,
    recipients: rows.filter((row) => row.awarded).map((row) => row.employeeId).sort(),
    missing,
  };
}

/** Whether a stored result still matches a fresh evaluation. */
export function bonusTriwulanResultMatches(
  stored: { recipients: readonly string[]; missing: readonly string[] } | null,
  fresh: Pick<BonusTriwulanEvaluation, 'recipients' | 'missing'>,
): boolean {
  if (!stored) return false;
  const same = (left: readonly string[], right: readonly string[]) =>
    left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index]);
  return same(stored.recipients, fresh.recipients) && same(stored.missing, fresh.missing);
}

/** Reads the recipient ids of a stored `BonusTriwulan/{period}` document. */
export function storedBonusTriwulanRecipients(data: unknown): string[] | null {
  if (!data || typeof data !== 'object') return null;
  const recipients = (data as Record<string, unknown>).recipients;
  if (!recipients || typeof recipients !== 'object') return [];
  return Object.keys(recipients).filter((id) => EMPLOYEE_ID_PATTERN.test(id)).sort();
}

export function storedBonusTriwulanMissing(data: unknown): string[] {
  const missing = data && typeof data === 'object' ? (data as Record<string, unknown>).missing : null;
  return Array.isArray(missing) ? missing.filter((item): item is string => typeof item === 'string') : [];
}
