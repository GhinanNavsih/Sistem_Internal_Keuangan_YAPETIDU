/**
 * When a posted journal may still be edited or deleted.
 *
 * A journal can be changed while its month, and every month after it, is still
 * open (no report, a draft, or a revision BAK asked for). Once a month's report
 * is with BAK or Rektorat, or approved, the month is sealed together with every
 * later one: their statements build on it, and a submitted snapshot must not
 * silently stop matching the books. The same rule already stops new journals
 * from being posted into such months.
 *
 * A sealed month is corrected by a reversing journal in an open month instead.
 * Reversing journals (and the journals they reverse) keep that pairing: neither
 * half is changed on its own, because that would leave the other half wrong.
 *
 * Firebase-free, so the server enforces exactly what the page shows.
 */
import { fiscalMonths, type JournalEntry } from './core';

/** Report states in which the books may still change. */
const OPEN_REPORT_STATUSES: readonly string[] = ['DRAFT', 'REVISION_REQUESTED'];

export interface ReportStatus {
  monthIndex: number;
  status?: string | null;
}

/** A month with no report yet is open, like a draft. */
export function isReportOpen(status: string | null | undefined): boolean {
  return !status || OPEN_REPORT_STATUSES.includes(status);
}

/** The fiscal period (1 = September … 12 = August) a calendar month falls in, or null. */
export function fiscalPeriod(academicYear: string, monthIndex: number): number | null {
  return fiscalMonths(academicYear).find((month) => month.monthIndex === monthIndex)?.period ?? null;
}

/** The latest fiscal period whose report is no longer open; 0 when every month is open. */
export function lockedThroughPeriod(academicYear: string, reports: readonly ReportStatus[]): number {
  let locked = 0;
  for (const month of fiscalMonths(academicYear)) {
    const report = reports.find((item) => item.monthIndex === month.monthIndex);
    if (!isReportOpen(report?.status)) locked = month.period;
  }
  return locked;
}

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
  reports: readonly ReportStatus[];
  yearStatus?: string | null;
  newMonthIndex?: number;
}): string | null {
  if (args.yearStatus === 'CLOSED') return 'Tahun buku sudah ditutup.';
  if (args.change === 'edit' && args.entry.kind === 'REVERSAL') {
    return 'Jurnal pembalik tidak dapat diubah. Hapus jurnal pembalik ini lalu catat ulang bila perlu.';
  }
  if (args.reversed) return 'Jurnal ini sudah dibalik. Hapus jurnal pembaliknya lebih dahulu.';

  const locked = lockedThroughPeriod(args.academicYear, args.reports);
  const period = fiscalPeriod(args.academicYear, args.entry.monthIndex);
  if (period === null || period <= locked) {
    return 'Jurnal ini terkunci: laporan bulan ini atau bulan sesudahnya sudah dikirim ke BAK.';
  }
  if (args.newMonthIndex !== undefined) {
    const newPeriod = fiscalPeriod(args.academicYear, args.newMonthIndex);
    if (newPeriod === null || newPeriod <= locked) {
      return 'Tanggal baru berada di bulan yang terkunci (laporan bulan itu atau bulan sesudahnya sudah dikirim ke BAK). Pilih tanggal di bulan yang masih terbuka.';
    }
  }
  return null;
}

/**
 * Whether a journal in a sealed month can still be corrected by a reversing
 * journal: it is not itself a reversal, not already reversed, and the year is open.
 */
export function canCorrectByReversal(args: {
  entry: Pick<JournalEntry, 'kind'>;
  reversed: boolean;
  yearStatus?: string | null;
}): boolean {
  return args.entry.kind !== 'REVERSAL' && !args.reversed && args.yearStatus !== 'CLOSED';
}
