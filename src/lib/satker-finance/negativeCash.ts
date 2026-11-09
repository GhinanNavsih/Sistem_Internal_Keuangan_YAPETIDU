import { accountId, isCashAccount, type FinancialAccount, type JournalEntry, type OpeningBalances } from './core';

type CashLine = { accountCode: string; debit: number; credit: number };

/** A cash or bank account that a journal would push below zero. */
export type NegativeCashDip = {
  accountCode: string;
  accountName: string;
  /** First date, on or after the journal's date, when the account ends the day below zero. */
  firstDate: string;
  /** The lowest end-of-day balance from the journal's date onward (negative). */
  lowest: number;
};

/**
 * Cash and bank accounts that the journal being typed would leave below zero. Money can't be spent before it comes
 * in, so a negative balance usually means the withdrawal or receipt that funds the spending has not been recorded yet.
 *
 * Balances follow the journal dates, not the order of entry, and are read at the end of each day: the app can't know
 * the order of two journals dated the same day. Only accounts the draft takes money out of are reported, and only
 * from the draft's date onward, so a receipt that helps an already-negative account does not warn.
 */
export function findNegativeCash(args: {
  accounts: FinancialAccount[];
  opening: OpeningBalances;
  /** Saved journals of the academic year. */
  entries: Pick<JournalEntry, 'id' | 'date' | 'academicYear' | 'lines'>[];
  academicYear: string;
  draft: { date: string; lines: CashLine[] };
  /** The journal being edited: it is replaced by the draft rather than counted twice. */
  editingEntryId?: string;
}): NegativeCashDip[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.draft.date)) return [];
  const accountMap = new Map(args.accounts.map((account) => [accountId(account), account]));
  const cashIds = new Set([...accountMap].filter(([, account]) => isCashAccount(account)).map(([id]) => id));
  // Net cash change the draft makes to each cash account; only accounts it reduces can be pushed below zero by it.
  const draftChange = new Map<string, number>();
  for (const line of args.draft.lines) {
    if (!cashIds.has(line.accountCode)) continue;
    draftChange.set(line.accountCode, (draftChange.get(line.accountCode) ?? 0) + line.debit - line.credit);
  }
  const reduced = [...draftChange].filter(([, change]) => change < 0).map(([id]) => id);
  if (!reduced.length) return [];

  const journals = [
    ...args.entries.filter((entry) => entry.academicYear === args.academicYear && entry.id !== args.editingEntryId),
    { date: args.draft.date, lines: args.draft.lines },
  ];
  const dips: NegativeCashDip[] = [];
  for (const code of reduced) {
    const balanceOpening = (args.opening[code]?.debit ?? 0) - (args.opening[code]?.credit ?? 0);
    const changeByDate = new Map<string, number>();
    for (const journal of journals) {
      const change = journal.lines.reduce((sum, line) => sum + (line.accountCode === code ? line.debit - line.credit : 0), 0);
      if (change) changeByDate.set(journal.date, (changeByDate.get(journal.date) ?? 0) + change);
    }
    let balance = balanceOpening;
    let firstDate = '';
    let lowest = 0;
    for (const date of [...new Set([...changeByDate.keys(), args.draft.date])].sort()) {
      balance += changeByDate.get(date) ?? 0;
      if (date < args.draft.date || balance >= 0) continue;
      if (!firstDate) firstDate = date;
      lowest = Math.min(lowest, balance);
    }
    if (firstDate) dips.push({ accountCode: code, accountName: accountMap.get(code)?.name ?? code, firstDate, lowest });
  }
  return dips;
}
