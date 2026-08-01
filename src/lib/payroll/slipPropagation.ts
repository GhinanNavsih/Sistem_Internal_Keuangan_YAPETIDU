import {
  defaultPayrollPeriodToken,
  isImmutablePayrollStatus,
  previousPayrollPeriodToken,
  type MoneyField,
} from './domain';

/**
 * Rules for pushing an employee-profile edit onto an already-saved payslip.
 *
 * The slip is recomputed in full from the profile, but only the labels the
 * profile actually owns are overlaid onto the stored arrays. Rows Finance types
 * by hand (Revisi Gaji), rows sourced from other systems (koperasi loans,
 * presence, SPJ and the rekap columns) keep their stored value and position.
 *
 * This module is pure — no Firebase — so the whole rule set is unit tested.
 */

export type SlipFieldKind = 'earnings' | 'deductions';

/**
 * Where drift is recorded when a slip could not be updated in place. Keyed by
 * the slip id, so a manual save_draft can clear it.
 */
export const DRIFT_NOTICES_COLLECTION = 'PayrollProfileDriftNotices';

/** Labels whose amount is fully determined by the employee document. */
const PROFILE_OWNED_EARNINGS = new Set([
  'gaji pokok',
  't. keluarga',
  't. fungsional',
  'kepangkatan',
  'instruksional',
  't. hari tua',
  't. bpjs tk',
  't. bpjs kes',
  'beras',
  'tunjangan beras',
  'bpjs (tunjangan)',
]);

const PROFILE_OWNED_DEDUCTIONS = new Set([
  'koperasi rochmad',
  'bpjs',
  'tabungan hari tua bni simponi',
  'tabungan',
  'zakat infaq sodaqoh',
  'pinlu/tagihan',
]);

/**
 * Structural rows carry the position name — and its 50% suffix — inside the
 * label, so they are matched by prefix rather than by exact text. A renamed or
 * re-valued position therefore removes the old row and appends the new one.
 */
const STRUCTURAL_LABEL_PREFIX = 'struktural: ';

function normalizeLabel(label: string): string {
  return label.trim().toLocaleLowerCase('id-ID');
}

export function isProfileOwnedLabel(kind: SlipFieldKind, label: string): boolean {
  const normalized = normalizeLabel(label);
  if (kind === 'deductions') return PROFILE_OWNED_DEDUCTIONS.has(normalized);
  return (
    PROFILE_OWNED_EARNINGS.has(normalized) ||
    normalized.startsWith(STRUCTURAL_LABEL_PREFIX)
  );
}

export interface SlipFieldChange {
  kind: SlipFieldKind;
  label: string;
  /** null when the row did not exist before. */
  oldValue: number | null;
  /** null when the row is being removed. */
  newValue: number | null;
}

/**
 * Overlay the profile-owned subset of `fresh` onto `stored`.
 *
 * Mirrors the merge the Refresh Massal flow already applies, so automatic
 * propagation and a manual refresh can never produce different arrays:
 * owned label in both -> overwrite; in fresh only -> append; in stored only ->
 * remove; anything else -> untouched, including its position in the array.
 */
export function mergeProfileOwnedFields(
  stored: readonly MoneyField[],
  fresh: readonly MoneyField[],
  kind: SlipFieldKind,
): { merged: MoneyField[]; changes: SlipFieldChange[] } {
  const changes: SlipFieldChange[] = [];
  const freshOwned = new Map<string, MoneyField>();
  for (const field of fresh) {
    if (isProfileOwnedLabel(kind, field.label)) {
      freshOwned.set(normalizeLabel(field.label), field);
    }
  }

  const merged: MoneyField[] = [];
  const seen = new Set<string>();
  for (const field of stored) {
    if (!isProfileOwnedLabel(kind, field.label)) {
      merged.push(field);
      continue;
    }
    const key = normalizeLabel(field.label);
    const replacement = freshOwned.get(key);
    if (!replacement) {
      // The profile no longer produces this row — a removed structural
      // position, or an allowance that dropped to zero and is no longer pushed.
      changes.push({ kind, label: field.label, oldValue: field.amount, newValue: null });
      continue;
    }
    seen.add(key);
    if (replacement.amount !== field.amount) {
      changes.push({
        kind,
        label: field.label,
        oldValue: field.amount,
        newValue: replacement.amount,
      });
    }
    merged.push({ ...field, amount: replacement.amount });
  }

  for (const [key, field] of freshOwned) {
    if (seen.has(key)) continue;
    merged.push({ label: field.label, amount: field.amount });
    changes.push({ kind, label: field.label, oldValue: null, newValue: field.amount });
  }

  return { merged, changes };
}

/**
 * Last line of defence, run inside the write transaction: if a gathering bug
 * ever moved a row the profile does not own, abort rather than corrupt the slip.
 */
export function assertOnlyProfileOwnedChanged(
  stored: readonly MoneyField[],
  merged: readonly MoneyField[],
  kind: SlipFieldKind,
): void {
  const mergedByLabel = new Map<string, number>();
  for (const field of merged) {
    if (!isProfileOwnedLabel(kind, field.label)) {
      mergedByLabel.set(normalizeLabel(field.label), field.amount);
    }
  }
  for (const field of stored) {
    if (isProfileOwnedLabel(kind, field.label)) continue;
    const key = normalizeLabel(field.label);
    if (!mergedByLabel.has(key)) {
      throw new Error(`Propagasi menghapus baris di luar profil: ${field.label}`);
    }
    if (mergedByLabel.get(key) !== field.amount) {
      throw new Error(`Propagasi mengubah nilai di luar profil: ${field.label}`);
    }
  }
}

export type PropagationOutcome =
  | 'updated'
  | 'unchanged'
  | 'no_slip'
  | 'period_closed'
  | 'blocked_status'
  | 'immutable';

export type SlipPropagationClass =
  | Exclude<PropagationOutcome, 'updated' | 'unchanged'>
  | 'eligible';

export function classifySlipForPropagation(
  slipExists: boolean,
  status: unknown,
  periodClosed: boolean,
): SlipPropagationClass {
  if (periodClosed) return 'period_closed';
  // No slip document means the payroll page still computes from the profile on
  // read, so it is already correct and needs no write.
  if (!slipExists) return 'no_slip';
  if (isImmutablePayrollStatus(status)) return 'immutable';
  if (status === 'draft' || status === undefined || status === null) return 'eligible';
  // finance_verified / kbu_approved: a human signed off on these numbers, so the
  // slip is left alone and the drift is flagged instead.
  return 'blocked_status';
}

/**
 * The periods an edit made now should reach: the month being compiled plus the
 * current month, minus anything already closed.
 *
 * Deliberately bounded to the previous and current month — sweeping every draft
 * the employee owns would rewrite a months-old period nobody ever closed.
 */
export function resolvePropagationPeriods(
  now: Date,
  isPeriodClosed: (period: string) => boolean,
): string[] {
  const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const previous = previousPayrollPeriodToken(now);
  const candidates =
    defaultPayrollPeriodToken(now, isPeriodClosed(previous)) === previous
      ? [previous, current]
      : [current];
  return candidates.filter((period) => !isPeriodClosed(period));
}

/**
 * Profile paths that move money. Used only to word the confirmation message —
 * propagation itself always runs, because an under-inclusive list here would
 * silently reintroduce the stale-slip bug for whichever field was forgotten.
 */
export const PAY_RELEVANT_FIELD_PATHS: readonly string[] = [
  'bpjs.',
  'salaryProfile.',
  'kepangkatan.',
  'academic_and_tier.',
  'family_allowance_metrics.',
  'employment_profile.structural_positions',
  'employment_profile.date_of_hire',
  'employment_profile.date_recognized',
  'employment_profile.department_unit',
  'employment_profile.job_role',
  't_instruksional',
  'savings.',
  'ziz.',
  'tht.',
  'pinlu.',
  'deductions.',
  'employment.jobCategory',
  'employment.startDate',
];

export function isPayRelevantChange(changedFields: readonly string[]): boolean {
  return changedFields.some((field) =>
    PAY_RELEVANT_FIELD_PATHS.some((path) => field === path || field.startsWith(path)),
  );
}
