/**
 * What must hold before a month's report can go to BAK. The page shows the
 * same list as a checklist; the server refuses the submission while any item
 * fails.
 *
 * Firebase-free, so the server enforces exactly what the page shows.
 */
import { sameBalances, yearInUse, type buildFinancialStatements, type FinancialAccount, type JournalEntry, type OpeningBalances } from './core';
import { buildDepreciationJournal, depreciationEntryId, depreciationStatus, type FixedAsset } from './depreciation';
import { reconciliationStates, type BankReconciliation } from './bankReconciliation';

type Statements = ReturnType<typeof buildFinancialStatements>;

export type PreviousYearState = {
  academicYear: string;
  status?: string | null;
  entryCount?: number;
  closingBalances?: OpeningBalances | null;
};

export type MonthCheck = { id: 'trial' | 'cash' | 'opening' | 'depreciation' | 'bank'; label: string; ok: boolean; detail: string };

/**
 * Whether this year's opening balance must come from the previous year's closing: the previous book is in use
 * (has journals or is closed). A year closed before closings were stored has nothing to carry, so the opening
 * of the year after it is typed in as before.
 */
export function openingComesFromPreviousYear(previous: PreviousYearState | null) {
  return !!previous && yearInUse(previous) && !(previous.status === 'CLOSED' && !previous.closingBalances);
}

const rupiah = (value: number) => `Rp ${new Intl.NumberFormat('id-ID').format(value)}`;

export function monthChecks(args: {
  academicYear: string;
  monthIndex: number;
  accounts: FinancialAccount[];
  statements: Statements;
  entries: Pick<JournalEntry, 'id' | 'lines'>[];
  openingBalances: OpeningBalances;
  previousYear: PreviousYearState | null;
  assets: FixedAsset[];
  reconciliations: BankReconciliation[];
}): MonthCheck[] {
  const { statements } = args;
  const trialOk = statements.trialBalance.difference === 0 && statements.trialBalance.periodDebits === statements.trialBalance.periodCredits;
  const cashOk = statements.cashFlow.reconciliationDelta === 0;

  const previous = args.previousYear;
  let openingOk = true;
  let openingDetail = 'Saldo awal diisi BAK (tahun pertama di aplikasi).';
  if (previous && openingComesFromPreviousYear(previous)) {
    if (previous.status !== 'CLOSED') {
      openingOk = false;
      openingDetail = `Tahun buku ${previous.academicYear} belum ditutup, jadi saldo awal tahun ini belum dibawa dari penutupannya.`;
    } else if (!sameBalances(args.openingBalances, previous.closingBalances || {})) {
      openingOk = false;
      openingDetail = `Saldo awal tidak sama dengan saldo penutupan tahun ${previous.academicYear}.`;
    } else {
      openingDetail = `Saldo awal sama dengan saldo penutupan tahun ${previous.academicYear}.`;
    }
  }

  let depreciationOk = true;
  let depreciationDetail = 'Tidak ada aset tetap yang disusutkan bulan ini.';
  try {
    const expected = buildDepreciationJournal(args.assets, args.accounts, args.academicYear, args.monthIndex);
    const posted = args.entries.find((entry) => entry.id === depreciationEntryId(args.monthIndex));
    const status = depreciationStatus(expected, posted);
    depreciationOk = status === 'POSTED' || status === 'NONE';
    if (status === 'POSTED') depreciationDetail = `Penyusutan ${rupiah(expected!.total)} sudah diposting.`;
    if (status === 'MISSING') depreciationDetail = `Penyusutan ${rupiah(expected!.total)} belum diposting.`;
    if (status === 'STALE') depreciationDetail = 'Jurnal penyusutan berbeda dengan daftar aset tetap. Posting ulang penyusutan bulan ini.';
  } catch (error) {
    depreciationOk = false;
    depreciationDetail = error instanceof Error ? error.message : 'Daftar aset tetap tidak valid.';
  }

  const states = reconciliationStates(statements.rows, args.reconciliations, args.monthIndex);
  const unreconciled = states.filter((state) => state.status !== 'MATCHED');
  const bankDetail = !states.length ? 'Tidak ada akun kas/bank yang perlu direkonsiliasi.'
    : !unreconciled.length ? `${states.length} akun kas/bank cocok dengan rekening koran atau hitung fisik.`
      : `Belum cocok: ${unreconciled.map((state) => `${state.account.code} ${state.account.name} (${state.status === 'MISSING' ? 'belum diisi' : `selisih ${rupiah(state.difference!)}`})`).join(', ')}.`;

  return [
    { id: 'trial', label: 'Neraca saldo seimbang', ok: trialOk, detail: trialOk ? 'Total debet sama dengan total kredit.' : `Selisih ${rupiah(statements.trialBalance.difference)}.` },
    { id: 'cash', label: 'Arus kas cocok dengan saldo kas di buku', ok: cashOk, detail: cashOk ? 'Saldo akhir arus kas sama dengan saldo akun kas/bank.' : `Selisih ${rupiah(statements.cashFlow.reconciliationDelta)}: ada jurnal kas lama tanpa klasifikasi arus kas.` },
    { id: 'opening', label: 'Saldo awal dari penutupan tahun lalu', ok: openingOk, detail: openingDetail },
    { id: 'depreciation', label: 'Penyusutan aset tetap diposting', ok: depreciationOk, detail: depreciationDetail },
    { id: 'bank', label: 'Rekonsiliasi bank dan hitung fisik kas', ok: !unreconciled.length, detail: bankDetail },
  ];
}
