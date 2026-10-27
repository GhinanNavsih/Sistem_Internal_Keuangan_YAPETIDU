import { defaultCashFlowSection, groupNormalBalance, type AccountType, type FinancialAccount } from './core';

/** One account of a workbook's Akun sheet. `contra` marks the side opposite its group's normal balance. */
export type BookImportAccount = { code: string; name: string; type: AccountType; contra: boolean };
export type BookImportLine = { code: string; debit: number; credit: number; description: string };
export type BookImportVoucher = { id: string; date: string; description: string; lines: BookImportLine[] };
/** Opening balances keyed by the workbook's account code. */
export type BookImport = {
  accounts: BookImportAccount[];
  opening: Record<string, { debit: number; credit: number }>;
  vouchers: BookImportVoucher[];
};

/** Firestore allows 500 writes per transaction; the import stays under it so it lands whole or not at all. */
export const BOOK_IMPORT_MAX_WRITES = 400;
export const ACCOUNT_TYPE_LIST: AccountType[] = ['AKTIVA', 'HUTANG', 'MODAL', 'TERIMA', 'KELUAR'];

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const wholeRupiah = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function textOf(value: unknown, max: number, name: string) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new Error(`${name} wajib diisi (maksimal ${max} karakter).`);
  return value.trim();
}

function lineFrom(value: unknown): BookImportLine {
  if (!isRecord(value)) throw new Error('Baris jurnal tidak valid.');
  const code = textOf(value.code, 20, 'Nomor akun');
  if (!wholeRupiah(value.debit) || !wholeRupiah(value.credit)) throw new Error(`Nominal baris akun ${code} harus Rupiah bulat.`);
  const description = typeof value.description === 'string' ? value.description.trim().slice(0, 300) : '';
  return { code, debit: value.debit as number, credit: value.credit as number, description };
}

/** Checks the shape of a book sent by the page. Accounting rules are checked again by the server against the catalog. */
export function bookImportFrom(raw: unknown): BookImport {
  if (!isRecord(raw)) throw new Error('Data impor tidak valid.');
  if (!Array.isArray(raw.accounts) || raw.accounts.length === 0 || raw.accounts.length > 400) throw new Error('Daftar akun impor harus berisi 1–400 akun.');
  const accounts = raw.accounts.map((value): BookImportAccount => {
    if (!isRecord(value)) throw new Error('Baris akun impor tidak valid.');
    const code = textOf(value.code, 20, 'Nomor akun');
    if (!/^\d+(\.\d+)?$/.test(code)) throw new Error(`Nomor akun ${code} harus berupa angka.`);
    if (!ACCOUNT_TYPE_LIST.includes(value.type as AccountType)) throw new Error(`Kelompok akun ${code} tidak valid.`);
    return { code, name: textOf(value.name, 150, `Nama akun ${code}`), type: value.type as AccountType, contra: value.contra === true };
  });
  const opening: BookImport['opening'] = {};
  if (!isRecord(raw.opening)) throw new Error('Saldo awal impor tidak valid.');
  for (const [code, balance] of Object.entries(raw.opening)) {
    if (!isRecord(balance) || !wholeRupiah(balance.debit) || !wholeRupiah(balance.credit)) throw new Error(`Saldo awal akun ${code} harus Rupiah bulat.`);
    opening[code] = { debit: balance.debit as number, credit: balance.credit as number };
  }
  if (!Array.isArray(raw.vouchers) || raw.vouchers.length > 400) throw new Error('Jumlah jurnal impor maksimal 400.');
  const vouchers = raw.vouchers.map((value): BookImportVoucher => {
    if (!isRecord(value)) throw new Error('Jurnal impor tidak valid.');
    const id = textOf(value.id, 100, 'ID jurnal');
    if (!Array.isArray(value.lines) || value.lines.length < 2 || value.lines.length > 30) throw new Error(`Jurnal ${id} harus memiliki 2–30 baris.`);
    return {
      id,
      date: textOf(value.date, 10, 'Tanggal jurnal'),
      description: textOf(value.description, 500, 'Uraian jurnal'),
      lines: value.lines.map(lineFrom),
    };
  });
  const writes = accounts.length + vouchers.length + 4;
  if (writes > BOOK_IMPORT_MAX_WRITES) throw new Error(`Impor terlalu besar (${writes} dokumen). Bagi berkas menjadi beberapa bagian.`);
  return { accounts, opening, vouchers };
}

export type PlannedAccount = {
  code: string;
  /** The ledger identity journals and opening balances use: the code for a catalog account, the document id for a unit's own. */
  accountId: string;
  /** Document in the unit's accountCatalog subcollection. */
  docId: string;
  data: Record<string, unknown>;
  account: FinancialAccount;
};

/**
 * Turns the workbook's accounts into the unit's catalog entries, using the same rules as a manual save: a code of the
 * shared catalog becomes a unit override (`base_<code>`), any other code a unit account of its own.
 */
export function planBookAccounts(accounts: BookImportAccount[], unitId: string, catalog: FinancialAccount[]): PlannedAccount[] {
  const catalogByCode = new Map(catalog.map((account) => [account.code, account]));
  const seen = new Set<string>();
  return accounts.map((input) => {
    if (seen.has(input.code)) throw new Error(`Nomor akun ${input.code} muncul lebih dari sekali.`);
    seen.add(input.code);
    const shared = catalogByCode.get(input.code);
    if (shared && shared.type !== input.type) throw new Error(`Kelompok akun ${input.code} tidak sesuai katalog umum.`);
    const type = input.type;
    const cashEquivalent = type === 'AKTIVA' && (input.code === '10000' || input.code.startsWith('11'));
    const normalBalance = groupNormalBalance(type, input.contra);
    const reportTarget = type === 'TERIMA' || type === 'KELUAR' ? 'INCOME_STATEMENT' : 'BALANCE_SHEET';
    const cashFlowSection = cashEquivalent ? null : shared?.cashFlowSection ?? defaultCashFlowSection(type, input.code);
    const docId = shared ? `base_${input.code}` : `custom_${unitId}_${input.code.replace('.', '_')}`;
    const accountId = shared ? input.code : docId;
    const data = shared
      ? { baseCode: input.code, code: input.code, name: input.name, normalBalance, reportTarget, cashEquivalent, cashFlowSection, postable: true }
      : { code: input.code, name: input.name, type, normalBalance, reportTarget, postable: true, cashEquivalent, cashFlowSection };
    return {
      code: input.code, accountId, docId, data,
      account: { id: accountId, code: input.code, name: input.name, type, normalBalance, reportTarget, postable: true, cashEquivalent, cashFlowSection },
    };
  });
}
