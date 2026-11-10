import { accountId, type FinancialAccount, type JournalEntry, type OpeningBalances } from './core';

export type LedgerRow = { date: string; id: string; description: string; debit: number; credit: number; balance: number };
export type Ledger = { beginning: number; ending: number; rows: LedgerRow[] };

/**
 * One account's Buku Besar: every journal line on the account, in the order the entries are given (by date), with
 * the running balance kept as debit minus credit. A month lists only its own lines and starts from the balance the
 * earlier months left; ANNUAL lists the whole academic year from the opening balance.
 */
export function buildLedger(args: {
  entries: Pick<JournalEntry, 'id' | 'date' | 'monthIndex' | 'description' | 'lines'>[];
  opening: OpeningBalances;
  accountCode: string;
  months: { monthIndex: number; period: number }[];
  month: number | 'ANNUAL';
}): Ledger {
  const rows: LedgerRow[] = [];
  let balance = (args.opening[args.accountCode]?.debit || 0) - (args.opening[args.accountCode]?.credit || 0);
  const targetPeriod = args.month === 'ANNUAL' ? 12 : args.months.find((item) => item.monthIndex === args.month)?.period || 12;
  let beginning = balance;
  for (const entry of args.entries) {
    const period = args.months.find((item) => item.monthIndex === entry.monthIndex)?.period || 0;
    if (period > targetPeriod) continue;
    for (const line of entry.lines.filter((item) => item.accountCode === args.accountCode)) {
      balance += line.debit - line.credit;
      if (args.month === 'ANNUAL' || period === targetPeriod) rows.push({ date: entry.date, id: entry.id, description: line.description || entry.description, debit: line.debit, credit: line.credit, balance });
    }
    if (period < targetPeriod && args.month !== 'ANNUAL') beginning = balance;
  }
  return { beginning, ending: balance, rows };
}

/** A signed (debit minus credit) balance in the account's normal direction, so a liability's balance reads positive. */
export function ledgerDisplayBalance(account: Pick<FinancialAccount, 'normalBalance'> | undefined, signed: number): number {
  return account?.normalBalance === 'CREDIT' && signed ? -signed : signed;
}

export type PrintableLedger = {
  code: string;
  name: string;
  normalBalance: 'DEBIT' | 'CREDIT';
  /** Balances are in the account's normal direction; minus means the opposite side. */
  beginning: number;
  ending: number;
  rows: LedgerRow[];
  totalDebit: number;
  totalCredit: number;
};

/**
 * The ledgers a printed Buku Besar contains: each postable account that holds a balance at the start of the period
 * or has a line in it, by account code. An account with neither would print as an empty page of zeros.
 */
export function printableLedgers(args: {
  accounts: FinancialAccount[];
  entries: Pick<JournalEntry, 'id' | 'date' | 'monthIndex' | 'description' | 'lines'>[];
  opening: OpeningBalances;
  months: { monthIndex: number; period: number }[];
  month: number | 'ANNUAL';
  /** Keep accounts with no balance and no line too, for a printout of one account the user picked by hand. */
  includeEmpty?: boolean;
}): PrintableLedger[] {
  return args.accounts
    .filter((account) => account.postable)
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
    .flatMap((account) => {
      const ledger = buildLedger({ ...args, accountCode: accountId(account) });
      if (!args.includeEmpty && !ledger.rows.length && !ledger.beginning) return [];
      const show = (signed: number) => ledgerDisplayBalance(account, signed);
      return [{
        code: account.code, name: account.name, normalBalance: account.normalBalance === 'CREDIT' ? 'CREDIT' as const : 'DEBIT' as const,
        beginning: show(ledger.beginning), ending: show(ledger.ending),
        rows: ledger.rows.map((row) => ({ ...row, balance: show(row.balance) })),
        totalDebit: ledger.rows.reduce((sum, row) => sum + row.debit, 0), totalCredit: ledger.rows.reduce((sum, row) => sum + row.credit, 0),
      }];
    });
}
