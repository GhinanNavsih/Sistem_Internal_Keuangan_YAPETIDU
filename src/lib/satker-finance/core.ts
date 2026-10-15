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
export type CashFlowAmounts = Record<CashFlowSection, number>;
export type JournalLine = { accountCode: string; accountNumber?: string; accountName: string; debit: number; credit: number; description?: string };
export type JournalEntry = {
  id: string;
  satkerId: string;
  academicYear: string;
  monthIndex: number;
  date: string;
  description: string;
  kind: 'EXPENSE' | 'INFLOW' | 'TRANSFER' | 'ADVANCED' | 'REVERSAL' | 'DEPRECIATION';
  lines: JournalLine[];
  totalAmount: number;
  isBalanced?: true;
  /** The section with the largest share of `cashFlows`; on journals posted before the split was kept, the one section chosen by hand. */
  cashFlowSection: CashFlowSection | null;
  /** Cash moved per section, derived from the counter accounts when the journal was posted. Absent on older journals. */
  cashFlows?: CashFlowAmounts;
  /** On a monthly depreciation journal: what each fixed asset contributed. */
  depreciation?: { assets: { assetId: string; name: string; amount: number }[] };
  createdBy: string;
  createdAt?: unknown;
  /** Storage paths of the receipts. Journals posted before several were allowed keep their one receipt in `receiptPath`; read both through `entryReceiptPaths`. */
  receiptPaths?: string[];
  receiptPath?: string;
  reversesEntryId?: string;
  requestFingerprint?: string;
};
export type OpeningBalances = Record<string, { debit: number; credit: number }>;

/**
 * Receipts one journal may carry, and the size each is compressed to before it is sent. They travel in one JSON
 * request (base64, a third larger), which the host caps near 32 MB: ten of 2 MB always fit.
 */
export const MAX_ENTRY_RECEIPTS = 10;
export const MAX_ENTRY_RECEIPT_BYTES = 2 * 1024 * 1024;
/** Storage paths of a journal's receipts, oldest first. */
export function entryReceiptPaths(entry: Pick<JournalEntry, 'receiptPath' | 'receiptPaths'>): string[] {
  if (Array.isArray(entry.receiptPaths)) return entry.receiptPaths.filter((path): path is string => typeof path === 'string' && !!path);
  return entry.receiptPath ? [entry.receiptPath] : [];
}

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

/** The academic year before (-1) or after (+1) this one. */
export function adjacentAcademicYear(academicYear: string, offset: 1 | -1) {
  fiscalMonths(academicYear);
  const start = Number(academicYear.slice(0, 4)) + offset;
  return `${start}-${start + 1}`;
}

/** The calendar year a month of the academic year falls in (September–December in the first, the rest in the second). */
export function calendarYearOf(academicYear: string, monthIndex: number) {
  const month = fiscalMonths(academicYear).find((item) => item.monthIndex === monthIndex);
  if (!month) throw new Error('Bulan tidak valid.');
  return month.year;
}

/** The last date (YYYY-MM-DD) of a month of the academic year. */
export function lastDateOfMonth(academicYear: string, monthIndex: number) {
  const year = calendarYearOf(academicYear, monthIndex);
  const day = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  return `${year}-${String(monthIndex).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * A book counts as in use once it has a journal or has been closed. The year
 * after a book in use takes its opening balance from that book's closing,
 * instead of having it typed in.
 */
export function yearInUse(year: { status?: unknown; entryCount?: unknown } | null | undefined) {
  return !!year && (year.status === 'CLOSED' || Number(year.entryCount || 0) > 0);
}

/** The normal side of a new account in a group; a contra account (akun pengurang, such as accumulated depreciation) takes the other side. */
export function groupNormalBalance(type: AccountType, contra = false): 'DEBIT' | 'CREDIT' {
  return (type === 'HUTANG' || type === 'MODAL' || type === 'TERIMA') !== contra ? 'CREDIT' : 'DEBIT';
}

/**
 * The cash-flow section a non-cash account of a group starts with. Payables (Hutang) are paid in the ordinary course
 * of operations, so they are operating; only capital (Modal) is financing. A borrowing account can be set to
 * Pendanaan in the catalog.
 */
export function defaultCashFlowSection(type: AccountType, code: string): CashFlowSection {
  if (type === 'MODAL') return 'FINANCING';
  if (type === 'AKTIVA' && code.startsWith('13')) return 'INVESTING';
  return 'OPERATING';
}

export const emptyCashFlows = (): CashFlowAmounts => ({ OPERATING: 0, INVESTING: 0, FINANCING: 0 });

const cashChangeOf = (lines: Pick<JournalLine, 'accountCode' | 'debit' | 'credit'>[], byId: Map<string, FinancialAccount>) =>
  lines.reduce((sum, line) => sum + (byId.get(line.accountCode)?.cashEquivalent ? line.debit - line.credit : 0), 0);

/**
 * How much cash a journal moved in each cash-flow section. Each non-cash line
 * stands for the cash it brought in or paid out, classified by its own
 * account (the catalog's policy, not a choice made per journal): a debit to an
 * expense is cash paid for operations, a debit to equipment cash paid for an
 * investment, a credit to a revenue cash received. The sections always add up
 * to the journal's net change in cash and bank; a journal that does not touch
 * cash (an accrual, a transfer between two cash accounts) moves nothing.
 */
export function cashFlowAllocation(lines: Pick<JournalLine, 'accountCode' | 'debit' | 'credit'>[], accounts: FinancialAccount[] | Map<string, FinancialAccount>): CashFlowAmounts {
  const byId = accounts instanceof Map ? accounts : new Map(accounts.map((account) => [accountId(account), account]));
  const flows = emptyCashFlows();
  if (cashChangeOf(lines, byId) === 0) return flows;
  for (const line of lines) {
    const account = byId.get(line.accountCode);
    if (account?.cashEquivalent) continue;
    const section = account?.cashFlowSection;
    if (!section) throw new Error(`Akun ${account?.code || line.accountCode} belum memiliki klasifikasi arus kas. BAK dapat mengaturnya di katalog akun.`);
    flows[section] -= line.debit - line.credit;
  }
  return flows;
}

/** The section that carries most of a journal's cash, or null when it moves none. */
export function mainCashFlowSection(flows: CashFlowAmounts): CashFlowSection | null {
  let main: CashFlowSection | null = null;
  for (const section of CASH_FLOW_SECTIONS) {
    if (flows[section] !== 0 && (!main || Math.abs(flows[section]) > Math.abs(flows[main]))) main = section;
  }
  return main;
}

/**
 * The cash flows a posted journal counts for: its stored split, or, on a
 * journal posted before the split was kept, its whole cash change in the one
 * section chosen then (none when none was chosen, which the cash
 * reconciliation then reports).
 */
export function entryCashFlows(entry: Pick<JournalEntry, 'lines' | 'cashFlows' | 'cashFlowSection'>, accountMap: Map<string, FinancialAccount>): CashFlowAmounts {
  if (entry.cashFlows) return { ...emptyCashFlows(), ...entry.cashFlows };
  const flows = emptyCashFlows();
  const cashChange = cashChangeOf(entry.lines, accountMap);
  if (cashChange && entry.cashFlowSection) flows[entry.cashFlowSection] = cashChange;
  return flows;
}

/** Whether an ending balance sits on the side opposite the account's normal balance (an overdrawn cash account, a debit liability). */
export function hasAbnormalBalance(account: Pick<FinancialAccount, 'normalBalance'>, endingDebit: number, endingCredit: number) {
  if (account.normalBalance === 'DEBIT') return endingCredit > 0;
  if (account.normalBalance === 'CREDIT') return endingDebit > 0;
  return false;
}

/** Whether two sets of balances agree account by account (zero balances and the debit/credit split aside). */
export function sameBalances(a: OpeningBalances, b: OpeningBalances) {
  const net = (balances: OpeningBalances) => new Map(Object.entries(balances)
    .map(([id, balance]) => [id, (balance?.debit || 0) - (balance?.credit || 0)] as const)
    .filter(([, value]) => value !== 0));
  const left = net(a);
  const right = net(b);
  return left.size === right.size && [...left].every(([id, value]) => right.get(id) === value);
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
): Pick<JournalEntry, 'kind' | 'description' | 'date' | 'lines' | 'totalAmount' | 'cashFlowSection'> & { cashFlows: CashFlowAmounts } {
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
  // The cash-flow section follows the counter accounts' classification; it is not chosen per journal.
  const cashFlows = cashFlowAllocation(lines, byCode);
  return { kind: kind as JournalEntry['kind'], description, date, lines, totalAmount: totalDebit, cashFlowSection: mainCashFlowSection(cashFlows), cashFlows };
}

export type YearClosing = {
  equityAccountId: string;
  /** Penerimaan minus Pengeluaran for the year; negative for a deficit. */
  surplus: number;
  /** The closing journal (jurnal penutup): every income-statement account brought to zero, the difference into equity. */
  lines: JournalLine[];
  /** Balance-sheet balances after closing: the next year's opening balance. */
  balances: OpeningBalances;
};

/** The equity account a year's surplus is closed into unless another is chosen: the lowest-numbered active Modal account. */
export function defaultSurplusAccountId(accounts: FinancialAccount[]) {
  const equity = accounts.filter((account) => account.postable && account.type === 'MODAL' && account.reportTarget === 'BALANCE_SHEET')
    .sort((a, b) => a.code.localeCompare(b.code));
  return equity[0] ? accountId(equity[0]) : '';
}

/**
 * Closes a year: every Penerimaan and Pengeluaran account is brought to zero
 * and the year's surplus (or deficit) moves into the chosen Modal account.
 * What remains, the balance-sheet accounts, is the next year's opening
 * balance, so nobody types it in again.
 */
export function buildYearClosing(args: {
  accounts: FinancialAccount[];
  opening: OpeningBalances;
  entries: JournalEntry[];
  academicYear: string;
  equityAccountId: string;
}): YearClosing {
  const statements = buildFinancialStatements({ ...args, monthIndex: 'ANNUAL' });
  if (statements.trialBalance.difference !== 0) throw new Error('Neraca saldo tahunan belum seimbang.');
  const equity = args.accounts.find((account) => accountId(account) === args.equityAccountId);
  if (!equity?.postable || equity.type !== 'MODAL' || equity.reportTarget !== 'BALANCE_SHEET') {
    throw new Error('Akun penampung surplus harus akun Modal yang aktif.');
  }
  const line = (account: FinancialAccount, debit: number, credit: number, description: string): JournalLine =>
    ({ accountCode: accountId(account), accountNumber: account.code, accountName: account.name, debit, credit, description });
  const lines: JournalLine[] = [];
  for (const row of statements.rows) {
    if (row.account.reportTarget !== 'INCOME_STATEMENT') continue;
    if (row.endingCredit) lines.push(line(row.account, row.endingCredit, 0, 'Penutupan saldo akhir tahun'));
    if (row.endingDebit) lines.push(line(row.account, 0, row.endingDebit, 'Penutupan saldo akhir tahun'));
  }
  const surplus = statements.annualWorksheet.allocatedSurplus;
  if (surplus > 0) lines.push(line(equity, 0, surplus, 'Surplus tahun berjalan'));
  if (surplus < 0) lines.push(line(equity, -surplus, 0, 'Defisit tahun berjalan'));
  const balances: OpeningBalances = {};
  for (const row of statements.rows) {
    if (row.account.reportTarget !== 'BALANCE_SHEET') continue;
    const signed = row.endingDebit - row.endingCredit - (accountId(row.account) === args.equityAccountId ? surplus : 0);
    if (signed) balances[accountId(row.account)] = { debit: Math.max(signed, 0), credit: Math.max(-signed, 0) };
  }
  validateOpeningBalances(balances, args.accounts);
  return { equityAccountId: args.equityAccountId, surplus, lines, balances };
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
    const flows = entryCashFlows(entry, accountMap);
    for (const section of CASH_FLOW_SECTIONS) cashFlows[section] += flows[section];
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
      /** Movement in the report month alone (August for the annual report). */
      periodDebit: periodMovements.get(id)?.debit ?? 0,
      periodCredit: periodMovements.get(id)?.credit ?? 0,
      endingDebit: Math.max(signed, 0),
      endingCredit: Math.max(-signed, 0),
    };
  });
  const abnormalBalances = rows.filter((row) => hasAbnormalBalance(row.account, row.endingDebit, row.endingCredit))
    .map((row) => ({ account: row.account, side: row.endingDebit ? 'DEBIT' as const : 'CREDIT' as const, amount: row.endingDebit || row.endingCredit }));
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
      if (entry.academicYear !== args.academicYear || periodOf.get(entry.date.slice(0, 7)) !== targetPeriod) continue;
      const flows = entryCashFlows(entry, accountMap);
      for (const section of CASH_FLOW_SECTIONS) monthCashFlows[section] += flows[section];
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
    rows, monthlyIncome, abnormalBalances,
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
