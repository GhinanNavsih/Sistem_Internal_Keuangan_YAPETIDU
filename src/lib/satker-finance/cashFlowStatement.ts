import { accountId, CASH_FLOW_SECTIONS, fiscalMonths, type CashFlowSection, type FinancialAccount, type JournalEntry } from './core';

export type CashFlowRow = { code: string; name: string; amount: number };
export type CashFlowSectionLines = { receipts: CashFlowRow[]; payments: CashFlowRow[]; receiptTotal: number; paymentTotal: number; net: number };

const LEGACY_ID = '';

/**
 * The month's cash movements by account, split into what came in (Penerimaan)
 * and what went out (Pengeluaran) within each cash-flow section. Each non-cash
 * line counts the cash it moved, the same way `cashFlowAllocation` does, so the
 * sections add up to the month's change in cash. A journal that touches no cash
 * moves nothing. An account paid and refunded in the same month shows its net.
 */
export function cashFlowStatementSections(args: { entries: JournalEntry[]; accounts: FinancialAccount[]; academicYear: string; monthIndex: number }): Record<CashFlowSection, CashFlowSectionLines> {
  const byId = new Map(args.accounts.map((account) => [accountId(account), account]));
  const month = fiscalMonths(args.academicYear).find((item) => item.monthIndex === args.monthIndex);
  const prefix = month ? `${month.year}-${String(month.monthIndex).padStart(2, '0')}` : '';
  const moves = new Map(CASH_FLOW_SECTIONS.map((section) => [section, new Map<string, number>()]));
  const add = (section: CashFlowSection, id: string, amount: number) => moves.get(section)!.set(id, (moves.get(section)!.get(id) ?? 0) + amount);

  for (const entry of args.entries) {
    if (entry.academicYear !== args.academicYear || !entry.date.startsWith(prefix)) continue;
    const cashChange = entry.lines.reduce((sum, line) => sum + (byId.get(line.accountCode)?.cashEquivalent ? line.debit - line.credit : 0), 0);
    if (!cashChange) continue;
    // A journal posted before the per-account split was kept has only its section, so its whole cash change goes on one row.
    if (!entry.cashFlows) {
      if (entry.cashFlowSection) add(entry.cashFlowSection, LEGACY_ID, cashChange);
      continue;
    }
    for (const line of entry.lines) {
      const account = byId.get(line.accountCode);
      if (!account || account.cashEquivalent || !account.cashFlowSection) continue;
      add(account.cashFlowSection, accountId(account), line.credit - line.debit);
    }
  }

  const sections = {} as Record<CashFlowSection, CashFlowSectionLines>;
  for (const section of CASH_FLOW_SECTIONS) {
    const rows = [...moves.get(section)!.entries()].filter(([, amount]) => amount !== 0).map(([id, amount]) => {
      const account = byId.get(id);
      return { code: account?.code ?? '', name: account ? account.name : 'Jurnal sebelum rincian akun', amount };
    }).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
    const receipts = rows.filter((row) => row.amount > 0);
    const payments = rows.filter((row) => row.amount < 0).map((row) => ({ ...row, amount: -row.amount }));
    const receiptTotal = receipts.reduce((sum, row) => sum + row.amount, 0);
    const paymentTotal = payments.reduce((sum, row) => sum + row.amount, 0);
    sections[section] = { receipts, payments, receiptTotal, paymentTotal, net: receiptTotal - paymentTotal };
  }
  return sections;
}
