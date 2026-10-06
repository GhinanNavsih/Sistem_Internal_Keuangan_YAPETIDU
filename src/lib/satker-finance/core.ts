import workbookAccounts from './accounts.json';

export type AccountType = 'AKTIVA' | 'HUTANG' | 'MODAL' | 'TERIMA' | 'KELUAR';
export type CashFlowSection = 'OPERATING' | 'INVESTING' | 'FINANCING';
export type FinancialAccount = {
  /** Stable ledger identity, separate from the unit-editable display code. */
  id?: string;
  localAccountId?: string;
  code: string;
  name: string;
  type: AccountType;
  normalBalance: 'DEBIT' | 'CREDIT' | null;
  reportTarget: 'BALANCE_SHEET' | 'INCOME_STATEMENT' | null;
  postable: boolean;
  cashEquivalent: boolean;
  cashFlowSection: CashFlowSection | null;
  revision?: number;
};
export type JournalLine = { accountCode: string; accountNumber?: string; accountName: string; debit: number; credit: number; description?: string };
export type JournalEntry = {
  id: string;
  satkerId: string;
  academicYear: string;
  monthIndex: number;
  date: string;
  description: string;
  kind: 'EXPENSE' | 'INFLOW' | 'TRANSFER' | 'ADVANCED' | 'REVERSAL';
  lines: JournalLine[];
  totalAmount: number;
  isBalanced?: true;
  cashFlowSection: CashFlowSection | null;
  createdBy: string;
  createdAt?: unknown;
  receiptPath?: string;
  reversesEntryId?: string;
  requestFingerprint?: string;
};
export type OpeningBalances = Record<string, { debit: number; credit: number }>;

export const DEFAULT_ACCOUNTS: FinancialAccount[] = workbookAccounts as FinancialAccount[];
export const CASH_FLOW_SECTIONS: CashFlowSection[] = ['OPERATING', 'INVESTING', 'FINANCING'];
export const accountId = (account: FinancialAccount) => account.id || account.code;

export function fiscalMonths(academicYear: string) {
  const match = /^(\d{4})-(\d{4})$/.exec(academicYear);
  if (!match || Number(match[2]) !== Number(match[1]) + 1) throw new Error('Tahun akademik tidak valid.');
  return Array.from({ length: 12 }, (_, offset) => ({
    monthIndex: (offset + 8) % 12 + 1,
    year: offset < 4 ? Number(match[1]) : Number(match[2]),
    period: offset + 1,
  }));
}

export function academicYearFor(date: Date) {
  const year = date.getFullYear();
  const start = date.getMonth() + 1 >= 9 ? year : year - 1;
  return `${start}-${start + 1}`;
}

export function validateEntryDate(date: string, academicYear: string, monthIndex: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Tanggal transaksi harus berformat YYYY-MM-DD.');
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error('Tanggal transaksi tidak valid.');
  }
  if (!fiscalMonths(academicYear).some((month) => month.monthIndex === monthIndex && month.year === parsed.getUTCFullYear() && parsed.getUTCMonth() + 1 === monthIndex)) {
    throw new Error('Tanggal transaksi berada di luar bulan/tahun akademik.');
  }
}

function amount(value: unknown, allowZero = false) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || (!allowZero && value === 0)) {
    throw new Error('Nominal harus berupa Rupiah bulat yang valid.');
  }
  return value;
}

export function validateOpeningBalances(opening: OpeningBalances, accounts: FinancialAccount[]) {
  const byCode = new Map(accounts.map((account) => [accountId(account), account]));
  let debit = 0;
  let credit = 0;
  for (const [code, balance] of Object.entries(opening)) {
    const account = byCode.get(code);
    if (!account?.postable || account.reportTarget !== 'BALANCE_SHEET') throw new Error(`Kode akun saldo awal ${account?.code || code} tidak tersedia untuk neraca.`);
    amount(balance.debit, true);
    amount(balance.credit, true);
    if (balance.debit && balance.credit) throw new Error(`Saldo awal ${code} harus berada pada satu sisi.`);
    debit += balance.debit;
    credit += balance.credit;
  }
  if (debit !== credit) throw new Error(`Saldo awal belum seimbang: debit ${debit}, kredit ${credit}.`);
  return { debit, credit };
}

export function buildVoucher(
  raw: Record<string, unknown>, accounts: FinancialAccount[],
): Pick<JournalEntry, 'kind' | 'description' | 'date' | 'lines' | 'totalAmount' | 'cashFlowSection'> {
  const byCode = new Map(accounts.filter((account) => account.postable).map((account) => [accountId(account), account]));
  const kind = raw.kind;
  const description = typeof raw.description === 'string' ? raw.description.trim() : '';
  const date = typeof raw.date === 'string' ? raw.date : '';
  if (!description || description.length > 500) throw new Error('Uraian transaksi wajib diisi (maksimal 500 karakter).');
  if (!['EXPENSE', 'INFLOW', 'TRANSFER', 'ADVANCED'].includes(String(kind))) throw new Error('Jenis voucher tidak valid.');
  const line = (code: unknown, debit: number, credit: number, lineDescription = ''): JournalLine => {
    const account = byCode.get(String(code));
    if (!account) throw new Error(`Kode akun ${String(code)} tidak dapat diposting.`);
    return { accountCode: accountId(account), accountNumber: account.code, accountName: account.name, debit, credit, ...(lineDescription ? { description: lineDescription } : {}) };
  };
  let lines: JournalLine[];
  if (kind === 'ADVANCED') {
    if (!Array.isArray(raw.lines) || raw.lines.length < 2 || raw.lines.length > 30) throw new Error('Jurnal lanjutan harus memiliki 2–30 baris.');
    lines = raw.lines.map((rawLine) => {
      if (!rawLine || typeof rawLine !== 'object') throw new Error('Baris jurnal tidak valid.');
      const value = rawLine as Record<string, unknown>;
      const debit = amount(value.debit, true);
      const credit = amount(value.credit, true);
      if ((debit > 0) === (credit > 0)) throw new Error('Setiap baris jurnal harus memiliki tepat satu sisi bernilai positif.');
      const lineDescription = typeof value.description === 'string' ? value.description.trim() : '';
      if (lineDescription.length > 300) throw new Error('Uraian baris maksimal 300 karakter.');
      return line(value.accountCode, debit, credit, lineDescription);
    });
  } else {
    const total = amount(raw.amount);
    const account = byCode.get(String(raw.accountCode));
    const source = byCode.get(String(raw.paymentAccountCode));
    if (!account) throw new Error(`Kode akun ${String(raw.accountCode)} tidak dapat diposting.`);
    if (!source) throw new Error(`Kode akun ${String(raw.paymentAccountCode)} tidak dapat diposting.`);
    if (accountId(account) === accountId(source)) throw new Error('Akun transaksi dan sumber/tujuan kas harus berbeda.');
    if (!source.cashEquivalent) throw new Error('Sumber/tujuan pembayaran harus akun kas atau bank.');
    if (kind === 'TRANSFER' && !account.cashEquivalent) throw new Error('Transfer harus antar akun kas/bank.');
    lines = kind === 'INFLOW'
      ? [line(accountId(source), total, 0), line(accountId(account), 0, total)]
      : kind === 'TRANSFER'
        ? [line(accountId(account), total, 0), line(accountId(source), 0, total)]
        : [line(accountId(account), total, 0), line(accountId(source), 0, total)];
  }
  const totalDebit = lines.reduce((sum, item) => sum + item.debit, 0);
  const totalCredit = lines.reduce((sum, item) => sum + item.credit, 0);
  if (!Number.isSafeInteger(totalDebit) || totalDebit !== totalCredit || totalDebit <= 0) throw new Error('Debit dan kredit jurnal harus seimbang.');
  const cashChange = lines.reduce((sum, item) => sum + (byCode.get(item.accountCode)?.cashEquivalent ? item.debit - item.credit : 0), 0);
  let cashFlowSection: CashFlowSection | null = null;
  if (cashChange !== 0) {
    const selected = raw.cashFlowSection;
    if (kind === 'ADVANCED') {
      if (!CASH_FLOW_SECTIONS.includes(selected as CashFlowSection)) throw new Error('Klasifikasi arus kas wajib dipilih untuk jurnal kas lanjutan.');
      cashFlowSection = selected as CashFlowSection;
    } else {
      const category = byCode.get(String(raw.accountCode));
      cashFlowSection = category?.cashFlowSection ?? null;
      if (!cashFlowSection) throw new Error('Akun lawan kas belum memiliki klasifikasi arus kas.');
    }
  }
  return { kind: kind as JournalEntry['kind'], description, date, lines, totalAmount: totalDebit, cashFlowSection };
}

export function buildFinancialStatements(args: {
  accounts: FinancialAccount[];
  opening: OpeningBalances;
  entries: JournalEntry[];
  academicYear: string;
  monthIndex: number | 'ANNUAL';
}) {
  const months = fiscalMonths(args.academicYear);
  const targetPeriod = args.monthIndex === 'ANNUAL' ? 12 : months.find((month) => month.monthIndex === args.monthIndex)?.period;
  if (!targetPeriod) throw new Error('Bulan laporan tidak valid.');
  const accountMap = new Map(args.accounts.map((account) => [accountId(account), account]));
  validateOpeningBalances(args.opening, args.accounts);
  const openingSigned = new Map<string, number>();
  for (const account of args.accounts) {
    const id = accountId(account);
    const balance = args.opening[id];
    openingSigned.set(id, (balance?.debit ?? 0) - (balance?.credit ?? 0));
  }
  const periodOf = new Map(months.map((month) => [`${month.year}-${String(month.monthIndex).padStart(2, '0')}`, month.period]));
  const movements = new Map<string, { debit: number; credit: number }>();
  const periodMovements = new Map<string, { debit: number; credit: number }>();
  const monthlyIncome = months.map((month) => ({ ...month, income: 0, expense: 0, surplus: 0, endingCash: 0 }));
  const cashFlows = { OPERATING: 0, INVESTING: 0, FINANCING: 0 };
  let periodDebits = 0;
  let periodCredits = 0;
  for (const entry of args.entries) {
    if (entry.academicYear !== args.academicYear) continue;
    validateEntryDate(entry.date, args.academicYear, entry.monthIndex);
    const period = periodOf.get(entry.date.slice(0, 7));
    if (!period || period > targetPeriod) continue;
    const cashChange = entry.lines.reduce((sum, line) => sum + (accountMap.get(line.accountCode)?.cashEquivalent ? line.debit - line.credit : 0), 0);
    if (cashChange && entry.cashFlowSection) cashFlows[entry.cashFlowSection] += cashChange;
    for (const line of entry.lines) {
      const current = movements.get(line.accountCode) ?? { debit: 0, credit: 0 };
      current.debit += line.debit;
      current.credit += line.credit;
      movements.set(line.accountCode, current);
      if (period === targetPeriod) {
        periodDebits += line.debit;
        periodCredits += line.credit;
        const periodCurrent = periodMovements.get(line.accountCode) ?? { debit: 0, credit: 0 };
        periodCurrent.debit += line.debit;
        periodCurrent.credit += line.credit;
        periodMovements.set(line.accountCode, periodCurrent);
      }
      const account = accountMap.get(line.accountCode);
      if (account?.type === 'TERIMA') monthlyIncome[period - 1].income += line.credit - line.debit;
      if (account?.type === 'KELUAR') monthlyIncome[period - 1].expense += line.debit - line.credit;
    }
  }
  for (const month of monthlyIncome) month.surplus = month.income - month.expense;
  const rows = args.accounts.filter((account) => account.postable).map((account) => {
    const id = accountId(account);
    const movement = movements.get(id) ?? { debit: 0, credit: 0 };
    const signed = (openingSigned.get(id) ?? 0) + movement.debit - movement.credit;
    return {
      account,
      openingDebit: args.opening[accountId(account)]?.debit ?? 0,
      openingCredit: args.opening[accountId(account)]?.credit ?? 0,
      debitMovement: movement.debit,
      creditMovement: movement.credit,
      endingDebit: Math.max(signed, 0),
      endingCredit: Math.max(-signed, 0),
    };
  });
  const cashOpening = args.accounts.filter((account) => account.cashEquivalent).reduce((sum, account) => sum + (openingSigned.get(accountId(account)) ?? 0), 0);
  const endingCash = rows.filter((row) => row.account.cashEquivalent).reduce((sum, row) => sum + row.endingDebit - row.endingCredit, 0);
  const cashFlowChange = cashFlows.OPERATING + cashFlows.INVESTING + cashFlows.FINANCING;
  const income = args.monthIndex === 'ANNUAL' ? monthlyIncome.reduce((sum, month) => sum + month.income, 0) : monthlyIncome[targetPeriod - 1].income;
  const expense = args.monthIndex === 'ANNUAL' ? monthlyIncome.reduce((sum, month) => sum + month.expense, 0) : monthlyIncome[targetPeriod - 1].expense;
  const trialDebit = rows.reduce((sum, row) => sum + row.endingDebit, 0);
  const trialCredit = rows.reduce((sum, row) => sum + row.endingCredit, 0);
  const openingCashForMonth = args.monthIndex === 'ANNUAL' ? cashOpening : cashOpening + args.entries.filter((entry) => {
    const entryPeriod = periodOf.get(entry.date.slice(0, 7));
    return entry.academicYear === args.academicYear && !!entryPeriod && entryPeriod < targetPeriod;
  }).reduce((sum, entry) => sum + entry.lines.reduce((lineSum, line) => lineSum + (accountMap.get(line.accountCode)?.cashEquivalent ? line.debit - line.credit : 0), 0), 0);
  const monthCashFlows = args.monthIndex === 'ANNUAL' ? cashFlows : { OPERATING: 0, INVESTING: 0, FINANCING: 0 };
  if (args.monthIndex !== 'ANNUAL') {
    for (const entry of args.entries) {
      if (entry.academicYear !== args.academicYear || periodOf.get(entry.date.slice(0, 7)) !== targetPeriod || !entry.cashFlowSection) continue;
      monthCashFlows[entry.cashFlowSection] += entry.lines.reduce((sum, line) => sum + (accountMap.get(line.accountCode)?.cashEquivalent ? line.debit - line.credit : 0), 0);
    }
  }
  const monthCashChange = monthCashFlows.OPERATING + monthCashFlows.INVESTING + monthCashFlows.FINANCING;
  let runningCash = cashOpening;
  for (const month of monthlyIncome) {
    runningCash += args.entries.filter((entry) => entry.academicYear === args.academicYear && periodOf.get(entry.date.slice(0, 7)) === month.period).reduce((sum, entry) => sum + entry.lines.reduce((lineSum, line) => lineSum + (accountMap.get(line.accountCode)?.cashEquivalent ? line.debit - line.credit : 0), 0), 0);
    month.endingCash = runningCash;
  }
  const incomeRows = rows.filter((row) => row.account.reportTarget === 'INCOME_STATEMENT').map((row) => ({
    ...row,
    debitMovement: args.monthIndex === 'ANNUAL' ? row.debitMovement : periodMovements.get(accountId(row.account))?.debit ?? 0,
    creditMovement: args.monthIndex === 'ANNUAL' ? row.creditMovement : periodMovements.get(accountId(row.account))?.credit ?? 0,
  }));
  const balanceRows = rows.filter((row) => row.account.reportTarget === 'BALANCE_SHEET');
  const incomeDebit = incomeRows.reduce((sum, row) => sum + row.endingDebit, 0);
  const incomeCredit = incomeRows.reduce((sum, row) => sum + row.endingCredit, 0);
  const balanceDebit = balanceRows.reduce((sum, row) => sum + row.endingDebit, 0);
  const balanceCredit = balanceRows.reduce((sum, row) => sum + row.endingCredit, 0);
  const allocatedSurplus = incomeCredit - incomeDebit;
  return {
    rows, monthlyIncome,
    incomeStatement: { income, expense, surplus: income - expense, rows: incomeRows },
    balanceSheet: { rows: balanceRows, assets: balanceRows.filter((row) => row.account.type === 'AKTIVA').reduce((sum, row) => sum + row.endingDebit - row.endingCredit, 0), liabilities: balanceRows.filter((row) => row.account.type === 'HUTANG').reduce((sum, row) => sum + row.endingCredit - row.endingDebit, 0), equity: balanceRows.filter((row) => row.account.type === 'MODAL').reduce((sum, row) => sum + row.endingCredit - row.endingDebit, 0), accumulatedSurplus: monthlyIncome.slice(0, targetPeriod).reduce((sum, month) => sum + month.surplus, 0) },
    cashFlow: { openingCash: openingCashForMonth, ...monthCashFlows, netChange: monthCashChange, endingCash: openingCashForMonth + monthCashChange, physicalCash: endingCash, reconciliationDelta: openingCashForMonth + monthCashChange - endingCash },
    trialBalance: { debit: trialDebit, credit: trialCredit, difference: trialDebit - trialCredit, periodDebits, periodCredits },
    annualWorksheet: {
      incomeDebit: incomeDebit + Math.max(allocatedSurplus, 0),
      incomeCredit: incomeCredit + Math.max(-allocatedSurplus, 0),
      balanceDebit: balanceDebit + Math.max(-allocatedSurplus, 0),
      balanceCredit: balanceCredit + Math.max(allocatedSurplus, 0),
      allocatedSurplus,
    },
    audit: { annualCashFlowChange: cashFlowChange, annualCashDelta: endingCash - cashOpening },
  };
}
