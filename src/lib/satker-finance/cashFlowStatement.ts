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
 * Income and expense accounts of a section are listed even with no movement.
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
    const moved = moves.get(section)!;
    // Income and expense accounts of the section are listed even with no movement, shown as '-' like the printed form.
    const statementIds = new Set(args.accounts.filter((account) => account.postable && !account.cashEquivalent && account.cashFlowSection === section && account.reportTarget === 'INCOME_STATEMENT').map(accountId));
    const lines = [...new Set([...moved.keys(), ...statementIds])].filter((id) => (moved.get(id) ?? 0) !== 0 || statementIds.has(id)).map((id) => {
      const account = byId.get(id);
      const amount = moved.get(id) ?? 0;
      // A line with no movement goes under Penerimaan when it is an income account, otherwise under Pengeluaran.
      return { row: { code: account?.code ?? '', name: account ? account.name : 'Jurnal sebelum rincian akun', amount: Math.abs(amount) }, receipt: amount > 0 || (amount === 0 && account?.type === 'TERIMA') };
    }).sort((a, b) => a.row.code.localeCompare(b.row.code, undefined, { numeric: true }));
    const receipts = lines.filter((line) => line.receipt).map((line) => line.row);
    const payments = lines.filter((line) => !line.receipt).map((line) => line.row);
    const receiptTotal = receipts.reduce((sum, row) => sum + row.amount, 0);
    const paymentTotal = payments.reduce((sum, row) => sum + row.amount, 0);
    sections[section] = { receipts, payments, receiptTotal, paymentTotal, net: receiptTotal - paymentTotal };
  }
  return sections;
}

export type JournalReceiptRef = { entryId: string; date: string; description: string; cashChange: number; totalAmount: number; index: number; count: number };

/**
 * Every receipt attached to the month's journals (the images in the Jurnal tab), in date order, each
 * journal's receipts in the order they were attached. `cashChange` is what the journal moved in cash
 * (zero for one that touches no cash); `index` and `count` place a receipt within its journal.
 */
export function journalReceiptRefs(args: { entries: (JournalEntry & { receiptCount?: number })[]; accounts: FinancialAccount[]; academicYear: string; monthIndex: number }): JournalReceiptRef[] {
  const byId = new Map(args.accounts.map((account) => [accountId(account), account]));
  const month = fiscalMonths(args.academicYear).find((item) => item.monthIndex === args.monthIndex);
  const prefix = month ? `${month.year}-${String(month.monthIndex).padStart(2, '0')}` : '';
  return args.entries
    .filter((entry) => entry.academicYear === args.academicYear && entry.date.startsWith(prefix) && (entry.receiptCount ?? 0) > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
    .flatMap((entry) => {
      const cashChange = entry.lines.reduce((sum, line) => sum + (byId.get(line.accountCode)?.cashEquivalent ? line.debit - line.credit : 0), 0);
      return Array.from({ length: entry.receiptCount ?? 0 }, (_, index) => ({
        entryId: entry.id, date: entry.date, description: entry.description, cashChange, totalAmount: entry.totalAmount, index, count: entry.receiptCount ?? 0,
      }));
    });
}

/** The sections without the accounts that had no movement that month, which `cashFlowStatementSections` lists as '-' like the printed form. */
export function movedCashFlowSections(sections: Record<CashFlowSection, CashFlowSectionLines>): Record<CashFlowSection, CashFlowSectionLines> {
  const moved = {} as Record<CashFlowSection, CashFlowSectionLines>;
  for (const section of CASH_FLOW_SECTIONS) {
    moved[section] = { ...sections[section], receipts: sections[section].receipts.filter((row) => row.amount !== 0), payments: sections[section].payments.filter((row) => row.amount !== 0) };
  }
  return moved;
}
