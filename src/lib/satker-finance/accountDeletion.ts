/** Rules for deleting a SatKer account. Pure: the server gathers what uses the account, this decides what blocks deletion. */
import type { JournalEntry, OpeningBalances } from './core';

/** A journal that uses the account, shown so the user can find it in the Jurnal tab. */
export type JournalUse = { id: string; date: string; description: string };

/** Journals with at least one line on the account. Lines store the ledger identity (accountId) in accountCode. */
export function journalsUsingAccount(
  entries: readonly Pick<JournalEntry, 'id' | 'date' | 'description' | 'lines'>[],
  accountKey: string,
): JournalUse[] {
  return entries
    .filter((entry) => (entry.lines ?? []).some((line) => line.accountCode === accountKey))
    .map((entry) => ({ id: entry.id, date: entry.date, description: entry.description }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

/** Whether an opening-balance map holds a debit or credit for the account. Zero rows do not count. */
export function openingHasValue(opening: OpeningBalances, accountKey: string): boolean {
  if (!Object.prototype.hasOwnProperty.call(opening, accountKey)) return false;
  const row = opening[accountKey];
  return Number(row?.debit || 0) !== 0 || Number(row?.credit || 0) !== 0;
}

/** The opening-balance map without the account's row. */
export function openingWithout(opening: OpeningBalances, accountKey: string): OpeningBalances {
  return Object.fromEntries(Object.entries(opening).filter(([key]) => key !== accountKey));
}

export type AccountUse = {
  journals: JournalUse[];
  /** Academic years whose opening balance for the account is not zero. */
  openingYears: string[];
  fixedAssets: number;
  reconciliations: number;
};

const EXAMPLE_JOURNALS = 3;

/** Why the account cannot be deleted yet, in words for the user; null when nothing uses it. */
export function accountDeletionBlocker(use: AccountUse, accountLabel: string): string | null {
  if (use.journals.length) {
    const examples = use.journals.slice(0, EXAMPLE_JOURNALS).map((journal) => `${journal.date} ${journal.description || journal.id}`);
    const more = use.journals.length > EXAMPLE_JOURNALS ? `, dan ${use.journals.length - EXAMPLE_JOURNALS} lainnya` : '';
    return `${accountLabel} dipakai di ${use.journals.length} jurnal (${examples.join('; ')}${more}). Hapus jurnal tersebut di tab Jurnal lebih dahulu; jurnal yang sudah dibalik harus dihapus pembaliknya dahulu.`;
  }
  if (use.openingYears.length) {
    return `${accountLabel} masih memiliki saldo awal pada tahun buku ${use.openingYears.join(', ')}. Kosongkan saldo awalnya di tab Akun lebih dahulu.`;
  }
  if (use.fixedAssets) return `${accountLabel} dipakai oleh ${use.fixedAssets} aset tetap. Ubah daftar aset tetap lebih dahulu.`;
  if (use.reconciliations) return `${accountLabel} sudah memiliki rekonsiliasi bank tersimpan, sehingga belum dapat dihapus.`;
  return null;
}
