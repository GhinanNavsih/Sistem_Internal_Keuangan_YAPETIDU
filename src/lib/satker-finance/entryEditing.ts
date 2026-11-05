/** Journal integrity rules shared by the page and server. Every fiscal period remains editable. */
import { fiscalMonths, type JournalEntry } from './core';

/** Ids of the journals some reversing journal points at. */
export function reversedEntryIds(entries: readonly Pick<JournalEntry, 'reversesEntryId'>[]): Set<string> {
  return new Set(entries.flatMap((entry) => (entry.reversesEntryId ? [entry.reversesEntryId] : [])));
}

export type EntryChange = 'edit' | 'delete';

/**
 * Why the journal cannot be edited or deleted, in words for the user, or null
 * when it can. `reversed` is whether a reversing journal points at it.
 * `newMonthIndex` is the month an edited journal moves to when its date changes.
 */
export function entryChangeBlocker(args: {
  change: EntryChange;
  entry: Pick<JournalEntry, 'kind' | 'monthIndex'>;
  reversed: boolean;
  academicYear: string;
  newMonthIndex?: number;
}): string | null {
  if (args.change === 'edit' && args.entry.kind === 'REVERSAL') {
    return 'Jurnal pembalik tidak dapat diubah. Hapus jurnal pembalik ini lalu catat ulang bila perlu.';
  }
  if (args.change === 'edit' && args.entry.kind === 'DEPRECIATION') {
    return 'Jurnal penyusutan dibuat dari daftar aset tetap. Ubah daftar asetnya, lalu posting ulang penyusutan bulan ini.';
  }
  if (args.reversed) return 'Jurnal ini sudah dibalik. Hapus jurnal pembaliknya lebih dahulu.';

  const validMonth = (month: number) => fiscalMonths(args.academicYear).some((item) => item.monthIndex === month);
  if (!validMonth(args.entry.monthIndex)) return 'Bulan jurnal tidak valid.';
  if (args.newMonthIndex !== undefined && !validMonth(args.newMonthIndex)) return 'Bulan tanggal baru tidak valid.';
  return null;
}
