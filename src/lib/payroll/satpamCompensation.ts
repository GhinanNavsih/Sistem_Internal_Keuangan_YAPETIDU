import type { RekapColumn, UraianEntry } from '@/types';
import type { MoneyField } from '@/lib/payroll/domain';

/** The universal Satpam attendance amount now stored in Tunjangan Jabatan. */
export const SATPAM_PRESENCE_BONUS = 50_000;

/** Existing role allowance for a Ketua Shift Satpam. */
export const SATPAM_KETUA_SHIFT_ROLE_ALLOWANCE = 100_000;

export const SATPAM_LEGACY_BONUS_KEY = 'bonusMutlak';

function finiteNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * The single Satpam Tunjangan Jabatan amount used by the rekap and previews.
 * The universal Rp50.000 attendance amount is included for every guard; a
 * Ketua keeps the existing Rp100.000 role allowance on top of it.
 */
export function getSatpamTunjanganJabatan(
  isKetuaShift: boolean,
): number {
  return (
    SATPAM_PRESENCE_BONUS +
    (isKetuaShift ? SATPAM_KETUA_SHIFT_ROLE_ALLOWANCE : 0)
  );
}

export function isSatpamLegacyBonusLabel(label: unknown): boolean {
  if (typeof label !== 'string') return false;
  const normalized = label.trim().toLocaleLowerCase('id-ID');
  return (
    normalized === 'bonus presensi mutlak' ||
    normalized === 'bonus mutlak'
  );
}

/**
 * Returns true for the old Satpam bonus column, including custom columns that
 * may have been saved with the old label instead of the old key.
 */
export function isSatpamLegacyBonusColumn(
  column: Pick<RekapColumn, 'key' | 'label' | 'slipLabel'>,
): boolean {
  const labels = [column.label, column.slipLabel]
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim().toLocaleLowerCase('id-ID'));
  return (
    column.key === SATPAM_LEGACY_BONUS_KEY ||
    labels.some((label) => isSatpamLegacyBonusLabel(label))
  );
}

/**
 * Keeps old, already-generated Satpam slips displayable after the rekap
 * column is removed. The old earning row is folded into the existing
 * Tunjangan Jabatan row and never returned as a separate earning.
 */
export function mergeSatpamLegacyBonusIntoTunjangan(
  earnings: readonly MoneyField[],
): MoneyField[] {
  let legacyAmount = 0;
  let foundLegacyRow = false;
  const normalizedEarnings = earnings
    .filter((earning) => {
      if (!isSatpamLegacyBonusLabel(earning.label)) return true;
      foundLegacyRow = true;
      legacyAmount += finiteNumber(earning.amount) ?? 0;
      return false;
    })
    .map((earning) => ({ ...earning }));

  if (!foundLegacyRow) return normalizedEarnings;

  const allowanceIndex = normalizedEarnings.findIndex(
    (earning) =>
      earning.label.trim().toLocaleLowerCase('id-ID') ===
      'tunjangan jabatan',
  );
  if (allowanceIndex >= 0) {
    normalizedEarnings[allowanceIndex] = {
      ...normalizedEarnings[allowanceIndex],
      amount: normalizedEarnings[allowanceIndex].amount + legacyAmount,
    };
  } else {
    normalizedEarnings.push({
      label: 'Tunjangan Jabatan',
      amount: legacyAmount,
    });
  }

  return normalizedEarnings;
}

/**
 * Makes legacy Satpam Uraian rows safe to consume after the bonus column was
 * removed. A row that still has the old field receives that field's universal
 * amount in Tunjangan Jabatan; rows already written without the old field are
 * raised to the new minimum. Existing higher manual allowances are retained.
 */
export function normalizeSatpamUraianEntry(
  entry: UraianEntry,
  isKetuaShift: boolean,
): UraianEntry {
  const values = { ...(entry.values || {}) };
  const counts = entry.counts ? { ...entry.counts } : undefined;
  const hasLegacyBonus =
    Object.prototype.hasOwnProperty.call(values, SATPAM_LEGACY_BONUS_KEY) ||
    Boolean(
      counts &&
        Object.prototype.hasOwnProperty.call(counts, SATPAM_LEGACY_BONUS_KEY),
    );
  const storedAllowance = finiteNumber(values.tunjanganJabatan);

  if (hasLegacyBonus) {
    const roleAllowance = storedAllowance ??
      (isKetuaShift ? SATPAM_KETUA_SHIFT_ROLE_ALLOWANCE : 0);
    values.tunjanganJabatan = roleAllowance + SATPAM_PRESENCE_BONUS;
  } else {
    values.tunjanganJabatan = Math.max(
      storedAllowance ?? 0,
      getSatpamTunjanganJabatan(isKetuaShift),
    );
  }

  delete values[SATPAM_LEGACY_BONUS_KEY];
  if (counts) {
    delete counts[SATPAM_LEGACY_BONUS_KEY];
  }

  const normalized: UraianEntry = { ...entry, values };
  if (counts && Object.keys(counts).length > 0) {
    normalized.counts = counts;
  } else {
    delete normalized.counts;
  }
  return normalized;
}
