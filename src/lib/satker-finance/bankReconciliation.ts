/**
 * Monthly bank reconciliation (rekonsiliasi bank) and cash count (opname kas).
 *
 * At each month end every cash or bank account in use is compared with an
 * outside figure: the bank statement's closing balance, or the cash counted in
 * the box. Timing differences on the bank's side explain a gap: a deposit the
 * books have but the bank has not credited yet, or a payment the books have
 * but the bank has not debited yet. Anything else, such as bank charges or
 * interest the books do not have yet, must be journaled first; the account is
 * reconciled only when
 *
 *   statement balance + deposits in transit − outstanding payments = book balance.
 *
 * Firebase-free, so the server enforces exactly what the page shows.
 */
import { accountId, type FinancialAccount } from './core';

export type ReconciliationItemKind = 'DEPOSIT_IN_TRANSIT' | 'OUTSTANDING_PAYMENT';
export type ReconciliationItem = { kind: ReconciliationItemKind; description: string; amount: number };
export type BankReconciliation = {
  monthIndex: number;
  accountId: string;
  statementBalance: number;
  items: ReconciliationItem[];
  note?: string;
  revision?: number;
  hasStatement?: boolean;
};

export const RECONCILIATION_ITEM_LABELS: Record<ReconciliationItemKind, string> = {
  DEPOSIT_IN_TRANSIT: 'Setoran belum masuk rekening koran',
  OUTSTANDING_PAYMENT: 'Pembayaran belum didebet bank',
};
const MAX_ITEMS = 50;
const MAX_BALANCE = 1e15;

export const reconciliationDocId = (monthIndex: number, account: string) => `${String(monthIndex).padStart(2, '0')}_${account}`;

export function validateReconciliationInput(raw: Record<string, unknown>): Pick<BankReconciliation, 'statementBalance' | 'items' | 'note'> {
  const statementBalance = raw.statementBalance;
  if (typeof statementBalance !== 'number' || !Number.isSafeInteger(statementBalance) || Math.abs(statementBalance) > MAX_BALANCE) {
    throw new Error('Saldo rekening koran harus berupa Rupiah bulat.');
  }
  if (!Array.isArray(raw.items) || raw.items.length > MAX_ITEMS) throw new Error(`Daftar penyesuaian tidak valid (maksimal ${MAX_ITEMS} baris).`);
  const items = raw.items.map((value) => {
    const item = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
    if (item.kind !== 'DEPOSIT_IN_TRANSIT' && item.kind !== 'OUTSTANDING_PAYMENT') throw new Error('Jenis penyesuaian tidak valid.');
    const description = typeof item.description === 'string' ? item.description.trim() : '';
    if (!description || description.length > 200) throw new Error('Uraian penyesuaian wajib diisi (maksimal 200 karakter).');
    if (typeof item.amount !== 'number' || !Number.isSafeInteger(item.amount) || item.amount <= 0 || item.amount > MAX_BALANCE) {
      throw new Error('Nominal penyesuaian harus Rupiah bulat lebih dari nol.');
    }
    return { kind: item.kind, description, amount: item.amount } as ReconciliationItem;
  });
  const note = typeof raw.note === 'string' ? raw.note.trim() : '';
  if (note.length > 500) throw new Error('Catatan rekonsiliasi maksimal 500 karakter.');
  return { statementBalance, items, ...(note ? { note } : {}) };
}

/** The statement balance after the bank catches up with the books' timing differences. */
export function adjustedStatementBalance(reconciliation: Pick<BankReconciliation, 'statementBalance' | 'items'>) {
  return reconciliation.items.reduce((sum, item) => sum + (item.kind === 'DEPOSIT_IN_TRANSIT' ? item.amount : -item.amount), reconciliation.statementBalance);
}

type BalanceRow = { account: FinancialAccount; endingDebit: number; endingCredit: number; periodDebit: number; periodCredit: number };

/** Cash and bank accounts that need a reconciliation for the month: any with a balance or with movement that month. */
export function accountsToReconcile<T extends BalanceRow>(rows: T[]): T[] {
  return rows.filter((row) => row.account.cashEquivalent && row.account.postable &&
    (row.endingDebit || row.endingCredit || row.periodDebit || row.periodCredit));
}

export type ReconciliationState = {
  account: FinancialAccount;
  bookBalance: number;
  reconciliation?: BankReconciliation;
  adjusted?: number;
  difference?: number;
  status: 'MISSING' | 'DIFFERENT' | 'MATCHED';
};

/** Each account to reconcile, with its book balance and whether the saved reconciliation explains it. */
export function reconciliationStates(rows: BalanceRow[], reconciliations: BankReconciliation[], monthIndex: number): ReconciliationState[] {
  return accountsToReconcile(rows).map((row) => {
    const bookBalance = row.endingDebit - row.endingCredit;
    const reconciliation = reconciliations.find((item) => item.monthIndex === monthIndex && item.accountId === accountId(row.account));
    if (!reconciliation) return { account: row.account, bookBalance, status: 'MISSING' };
    const adjusted = adjustedStatementBalance(reconciliation);
    const difference = adjusted - bookBalance;
    return { account: row.account, bookBalance, reconciliation, adjusted, difference, status: difference === 0 ? 'MATCHED' : 'DIFFERENT' };
  });
}
