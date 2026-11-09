import { accountId, CASH_FLOW_SECTIONS, fiscalMonths, isCashAccount, type CashFlowSection, type FinancialAccount, type JournalEntry } from './core';

export type CashFlowRow = { code: string; name: string; amount: number };
export type CashFlowSectionLines = { receipts: CashFlowRow[]; payments: CashFlowRow[]; receiptTotal: number; paymentTotal: number; net: number };

const LEGACY_ID = '';

/**
 * The month's cash movements by account, split into what came in (Penerimaan)
 * and what went out (Pengeluaran) within each cash-flow section. Each non-cash
 * line counts the cash it moved, the same way `cashFlowAllocation` does, so the
 * sections add up to the month's change in cash. A journal that touches no cash
 * moves nothing. An account with both receipts and payments keeps both amounts
 * visible, even when they offset. Income and expense accounts of a section are
 * listed at zero here for callers that need the complete catalog view.
 */
export function cashFlowStatementSections(args: { entries: JournalEntry[]; accounts: FinancialAccount[]; academicYear: string; monthIndex: number }): Record<CashFlowSection, CashFlowSectionLines> {
  const byId = new Map(args.accounts.map((account) => [accountId(account), account]));
  const month = fiscalMonths(args.academicYear).find((item) => item.monthIndex === args.monthIndex);
  const prefix = month ? `${month.year}-${String(month.monthIndex).padStart(2, '0')}` : '';
  const moves = new Map(CASH_FLOW_SECTIONS.map((section) => [section, new Map<string, { receipts: number; payments: number }>()]));
  const add = (section: CashFlowSection, id: string, amount: number) => {
    const current = moves.get(section)!.get(id) ?? { receipts: 0, payments: 0 };
    if (amount > 0) current.receipts += amount;
    else if (amount < 0) current.payments -= amount;
    moves.get(section)!.set(id, current);
  };

  for (const entry of args.entries) {
    if (entry.academicYear !== args.academicYear || !entry.date.startsWith(prefix)) continue;
    const cashChange = entry.lines.reduce((sum, line) => sum + (isCashAccount(byId.get(line.accountCode)) ? line.debit - line.credit : 0), 0);
    if (!cashChange) continue;
    // Older journals have only one section; retain that assignment while showing their known account lines.
    if (!entry.cashFlows) {
      if (entry.cashFlowSection) {
        let assigned = 0;
        for (const line of entry.lines) {
          const account = byId.get(line.accountCode);
          if (isCashAccount(account) || !account) continue;
          const amount = line.credit - line.debit;
          add(entry.cashFlowSection, accountId(account), amount);
          assigned += amount;
        }
        // Preserve the legacy total for any unmatched lines.
        add(entry.cashFlowSection, LEGACY_ID, cashChange - assigned);
      }
      continue;
    }
    for (const line of entry.lines) {
      const account = byId.get(line.accountCode);
      if (!account || isCashAccount(account) || !account.cashFlowSection) continue;
      add(account.cashFlowSection, accountId(account), line.credit - line.debit);
    }
  }

  const sections = {} as Record<CashFlowSection, CashFlowSectionLines>;
  for (const section of CASH_FLOW_SECTIONS) {
    const moved = moves.get(section)!;
    // Income and expense accounts of the section are included at zero for the complete catalog view.
    const statementIds = new Set(args.accounts.filter((account) => account.postable && !isCashAccount(account) && account.cashFlowSection === section && account.reportTarget === 'INCOME_STATEMENT').map(accountId));
    const lines = [...new Set([...moved.keys(), ...statementIds])].filter((id) => {
      const amounts = moved.get(id);
      return (amounts?.receipts ?? 0) !== 0 || (amounts?.payments ?? 0) !== 0 || statementIds.has(id);
    }).flatMap((id) => {
      const account = byId.get(id);
      const amounts = moved.get(id) ?? { receipts: 0, payments: 0 };
      const row = (amount: number) => ({ code: account?.code ?? '', name: account ? account.name : 'Jurnal sebelum rincian akun', amount });
      const rows: { row: CashFlowRow; receipt: boolean }[] = [];
      if (amounts.receipts) rows.push({ row: row(amounts.receipts), receipt: true });
      if (amounts.payments) rows.push({ row: row(amounts.payments), receipt: false });
      // A line with no movement goes under Penerimaan when it is an income account, otherwise under Pengeluaran.
      if (!amounts.receipts && !amounts.payments && statementIds.has(id)) rows.push({ row: row(0), receipt: account?.type === 'TERIMA' });
      return rows;
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
      const cashChange = entry.lines.reduce((sum, line) => sum + (isCashAccount(byId.get(line.accountCode)) ? line.debit - line.credit : 0), 0);
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
