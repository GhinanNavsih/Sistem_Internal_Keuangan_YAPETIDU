/**
 * Fixed assets (aset tetap) and their monthly straight-line depreciation.
 *
 * Each asset in a unit's register is written down evenly over its useful life,
 * starting in the month it was acquired. One depreciation journal per month
 * debits each asset's expense account and credits its accumulated-depreciation
 * account (a contra-asset), so the balance sheet shows the asset at book value.
 * The schedule, not the journal, is the source of truth: a month's journal is
 * rebuilt from the register, and a month cannot be reported while its journal
 * differs from what the register says.
 *
 * Firebase-free, so the server enforces exactly what the page shows.
 */
import { accountId, calendarYearOf, fiscalMonths, type FinancialAccount, type JournalEntry, type JournalLine } from './core';
import { fiscalPeriod, lockedThroughPeriod, type ReportStatus } from './entryEditing';

export type FixedAsset = {
  id: string;
  name: string;
  assetAccountId: string;
  accumulatedAccountId: string;
  expenseAccountId: string;
  /** YYYY-MM-DD; depreciation starts in this month. */
  acquisitionDate: string;
  cost: number;
  residualValue: number;
  usefulLifeMonths: number;
  revision?: number;
};
export type FixedAssetInput = Omit<FixedAsset, 'id' | 'revision'>;
export type DepreciationJournal = {
  lines: JournalLine[];
  assets: { assetId: string; name: string; amount: number }[];
  total: number;
};

export const MAX_USEFUL_LIFE_YEARS = 50;
const MAX_COST = 1_000_000_000_000;

export const depreciationEntryId = (monthIndex: number) => `depreciation-${String(monthIndex).padStart(2, '0')}`;

const monthNumber = (year: number, monthIndex: number) => year * 12 + monthIndex - 1;

/**
 * Accumulated depreciation of an asset at the end of a calendar month. Each
 * month gets a whole-Rupiah share; the shares add up to exactly cost minus
 * residual value at the end of the useful life, and nothing after it.
 */
export function accumulatedDepreciation(asset: Pick<FixedAsset, 'acquisitionDate' | 'cost' | 'residualValue' | 'usefulLifeMonths'>, year: number, monthIndex: number) {
  const acquired = monthNumber(Number(asset.acquisitionDate.slice(0, 4)), Number(asset.acquisitionDate.slice(5, 7)));
  const elapsed = Math.min(Math.max(monthNumber(year, monthIndex) - acquired + 1, 0), asset.usefulLifeMonths);
  return Math.floor((asset.cost - asset.residualValue) * elapsed / asset.usefulLifeMonths);
}

/** The depreciation an asset takes in one calendar month. */
export function depreciationForMonth(asset: Pick<FixedAsset, 'acquisitionDate' | 'cost' | 'residualValue' | 'usefulLifeMonths'>, year: number, monthIndex: number) {
  const previousYear = monthIndex === 1 ? year - 1 : year;
  const previousMonth = monthIndex === 1 ? 12 : monthIndex - 1;
  return accumulatedDepreciation(asset, year, monthIndex) - accumulatedDepreciation(asset, previousYear, previousMonth);
}

function validDate(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value && value >= '1950-01-01' && value <= '2100-12-31';
}

export function validateFixedAsset(raw: Record<string, unknown>, accounts: FinancialAccount[]): FixedAssetInput {
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name || name.length > 150) throw new Error('Nama aset wajib diisi (maksimal 150 karakter).');
  const byId = new Map(accounts.filter((account) => account.postable).map((account) => [accountId(account), account]));
  const assetAccount = byId.get(String(raw.assetAccountId));
  if (!assetAccount || assetAccount.type !== 'AKTIVA' || assetAccount.cashEquivalent || assetAccount.reportTarget !== 'BALANCE_SHEET' || assetAccount.normalBalance !== 'DEBIT') {
    throw new Error('Akun aset harus akun Aktiva bersaldo normal Debet yang aktif (bukan kas/bank).');
  }
  const accumulated = byId.get(String(raw.accumulatedAccountId));
  if (!accumulated || accumulated.type !== 'AKTIVA' || accumulated.cashEquivalent || accumulated.normalBalance !== 'CREDIT' || accountId(accumulated) === accountId(assetAccount)) {
    throw new Error('Akun akumulasi penyusutan harus akun Aktiva pengurang (bersaldo normal Kredit).');
  }
  const expense = byId.get(String(raw.expenseAccountId));
  if (!expense || expense.type !== 'KELUAR') throw new Error('Akun beban penyusutan harus akun Pengeluaran yang aktif.');
  if (!validDate(raw.acquisitionDate)) throw new Error('Tanggal perolehan tidak valid.');
  const cost = raw.cost;
  if (typeof cost !== 'number' || !Number.isSafeInteger(cost) || cost <= 0 || cost > MAX_COST) throw new Error('Harga perolehan harus berupa Rupiah bulat yang valid.');
  const residualValue = raw.residualValue ?? 0;
  if (typeof residualValue !== 'number' || !Number.isSafeInteger(residualValue) || residualValue < 0 || residualValue >= cost) {
    throw new Error('Nilai sisa harus Rupiah bulat, tidak negatif, dan lebih kecil dari harga perolehan.');
  }
  const years = raw.usefulLifeYears;
  if (typeof years !== 'number' || !Number.isInteger(years) || years < 1 || years > MAX_USEFUL_LIFE_YEARS) {
    throw new Error(`Umur manfaat harus 1–${MAX_USEFUL_LIFE_YEARS} tahun.`);
  }
  return {
    name, assetAccountId: accountId(assetAccount), accumulatedAccountId: accountId(accumulated), expenseAccountId: accountId(expense),
    acquisitionDate: raw.acquisitionDate as string, cost, residualValue, usefulLifeMonths: years * 12,
  };
}

/** Whether an edit changes anything the depreciation schedule or its journals depend on (the name does not). */
export function assetFiguresChanged(before: Partial<FixedAssetInput>, after: FixedAssetInput) {
  return (['assetAccountId', 'accumulatedAccountId', 'expenseAccountId', 'acquisitionDate', 'cost', 'residualValue', 'usefulLifeMonths'] as const)
    .some((key) => before[key] !== after[key]);
}

/**
 * The accumulated-depreciation account that goes with an asset account: by
 * the catalog's numbering (13002 Gedung → 13011 Akum Dep Gedung, i.e. +9),
 * else the only contra-asset account there is, else none.
 */
export function suggestedAccumulatedAccountId(assetAccountId: string, accounts: FinancialAccount[]) {
  const asset = accounts.find((account) => accountId(account) === assetAccountId);
  const contras = accounts.filter((account) => account.postable && account.type === 'AKTIVA' && !account.cashEquivalent && account.normalBalance === 'CREDIT');
  if (asset && /^\d{5}$/.test(asset.code)) {
    const paired = contras.find((account) => account.code === String(Number(asset.code) + 9));
    if (paired) return accountId(paired);
  }
  return contras.length === 1 ? accountId(contras[0]) : '';
}

/** One month's depreciation journal for the whole register, grouped by account; null when nothing is depreciated that month. */
export function buildDepreciationJournal(assets: FixedAsset[], accounts: FinancialAccount[], academicYear: string, monthIndex: number): DepreciationJournal | null {
  const year = calendarYearOf(academicYear, monthIndex);
  const byId = new Map(accounts.filter((account) => account.postable).map((account) => [accountId(account), account]));
  const items = assets
    .map((asset) => ({ asset, amount: depreciationForMonth(asset, year, monthIndex) }))
    .filter((item) => item.amount > 0)
    .sort((a, b) => a.asset.name.localeCompare(b.asset.name, 'id') || a.asset.id.localeCompare(b.asset.id));
  if (!items.length) return null;
  const debits = new Map<string, number>();
  const credits = new Map<string, number>();
  for (const { asset, amount } of items) {
    debits.set(asset.expenseAccountId, (debits.get(asset.expenseAccountId) || 0) + amount);
    credits.set(asset.accumulatedAccountId, (credits.get(asset.accumulatedAccountId) || 0) + amount);
  }
  const line = (id: string, debit: number, credit: number, description: string): JournalLine => {
    const account = byId.get(id);
    if (!account) throw new Error(`Akun ${id} pada daftar aset tetap tidak dapat diposting. Perbaiki akun aset tersebut.`);
    return { accountCode: id, accountNumber: account.code, accountName: account.name, debit, credit, description };
  };
  const sorted = (map: Map<string, number>) => [...map].sort(([a], [b]) => a.localeCompare(b));
  const lines = [
    ...sorted(debits).map(([id, amount]) => line(id, amount, 0, 'Beban penyusutan')),
    ...sorted(credits).map(([id, amount]) => line(id, 0, amount, 'Akumulasi penyusutan')),
  ];
  const total = items.reduce((sum, item) => sum + item.amount, 0);
  return { lines, assets: items.map(({ asset, amount }) => ({ assetId: asset.id, name: asset.name, amount })), total };
}

/** Whether two journals post the same amounts to the same accounts, whatever the line order. */
export function sameJournalLines(a: Pick<JournalLine, 'accountCode' | 'debit' | 'credit'>[] | undefined, b: Pick<JournalLine, 'accountCode' | 'debit' | 'credit'>[] | undefined) {
  const key = (lines: Pick<JournalLine, 'accountCode' | 'debit' | 'credit'>[] | undefined) =>
    (lines || []).map((line) => `${line.accountCode}|${line.debit}|${line.credit}`).sort().join(';');
  return key(a) === key(b);
}

export type DepreciationStatus = 'NONE' | 'POSTED' | 'MISSING' | 'STALE';

/** NONE: nothing to depreciate; POSTED: the journal matches the register; MISSING: not posted; STALE: posted but the register changed since. */
export function depreciationStatus(expected: DepreciationJournal | null, posted: Pick<JournalEntry, 'lines'> | undefined): DepreciationStatus {
  if (!expected) return posted ? 'STALE' : 'NONE';
  if (!posted) return 'MISSING';
  return sameJournalLines(expected.lines, posted.lines) ? 'POSTED' : 'STALE';
}

/** Accumulated depreciation the register expects at the end of a month, per accumulated-depreciation account. */
export function scheduledAccumulatedByAccount(assets: FixedAsset[], academicYear: string, monthIndex: number) {
  const year = calendarYearOf(academicYear, monthIndex);
  const totals = new Map<string, number>();
  for (const asset of assets) {
    totals.set(asset.accumulatedAccountId, (totals.get(asset.accumulatedAccountId) || 0) + accumulatedDepreciation(asset, year, monthIndex));
  }
  return totals;
}

/**
 * Why an asset's figures can no longer change, or null when they can: once a
 * depreciation journal that includes the asset sits in a sealed month or a
 * closed year, changing the schedule would leave reported figures wrong.
 */
export function assetChangeBlocker(assetId: string, years: {
  academicYear: string;
  status?: string | null;
  reports: readonly ReportStatus[];
  depreciationEntries: Pick<JournalEntry, 'monthIndex' | 'depreciation'>[];
}[]): string | null {
  for (const year of years) {
    const including = year.depreciationEntries.filter((entry) => entry.depreciation?.assets.some((item) => item.assetId === assetId));
    if (!including.length) continue;
    const locked = year.status === 'CLOSED' ? fiscalMonths(year.academicYear).length : lockedThroughPeriod(year.academicYear, year.reports);
    if (including.some((entry) => (fiscalPeriod(year.academicYear, entry.monthIndex) ?? 0) <= locked)) {
      return 'Penyusutan aset ini sudah masuk laporan yang dikirim ke BAK, sehingga akun, tanggal, harga, nilai sisa, dan umurnya tidak dapat diubah lagi. Koreksi dengan jurnal di bulan yang masih terbuka.';
    }
  }
  return null;
}
