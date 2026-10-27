import type { CellObject, WorkSheet } from 'xlsx';
import { fiscalMonths, groupNormalBalance, type AccountType } from './core';
import { ACCOUNT_TYPE_LIST, type BookImport, type BookImportAccount, type BookImportLine, type BookImportVoucher } from './bookImport';

/**
 * Reads one unit's book from the "Akun …" and "Jurnal …" sheets of the SatKer workbook. Nothing is written here: the
 * result is a plan for the server, or a list of problems to fix in the sheet first.
 */

type Value = number | string | null;

// Rows are counted as in Excel: row 5 holds the headings, row 6 the sheet's own totals, the journal starts at row 7.
const JOURNAL_FIRST_ROW = 7;
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

function columnName(column: number) {
  let name = '';
  for (let value = column; value > 0; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
  return name;
}

function parseAddress(address: string) {
  const match = /^\$?([A-Z]+)\$?(\d+)$/.exec(address.toUpperCase());
  if (!match) return null;
  const column = [...match[1]].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0);
  return { row: Number(match[2]), column };
}

const addressOf = (row: number, column: number) => `${columnName(column)}${row}`;

/** The value of a cell: its typed value, or the result of its formula (the workbook was saved without cached results). */
function valueAt(sheet: WorkSheet, address: string, depth = 0): Value {
  if (depth > 50) throw new Error(`Rumus di sel ${address} saling merujuk.`);
  const cell = sheet[address] as CellObject | undefined;
  if (!cell) return null;
  if (cell.f) return formulaValue(cell.f, sheet, depth + 1);
  if (cell.v === undefined || cell.v === null || cell.v === '') return null;
  if (typeof cell.v === 'number' || typeof cell.v === 'string') return cell.v;
  throw new Error(`Nilai sel ${address} tidak dikenali.`);
}

function formulaValue(formula: string, sheet: WorkSheet, depth: number): Value {
  const source = formula.replace(/\s+/g, '').toUpperCase();
  if (/^\$?[A-Z]+\$?\d+$/.test(source)) return valueAt(sheet, source.replace(/\$/g, ''), depth);
  return arithmetic(source, sheet, depth);
}

/** Evaluates + − × ÷, parentheses, SUM(range) and cell references; anything else is refused rather than guessed. */
function arithmetic(source: string, sheet: WorkSheet, depth: number): number {
  let position = 0;
  const unsupported = (): never => { throw new Error(`Rumus ${source} tidak dapat dibaca.`); };
  const eat = (pattern: RegExp) => {
    const match = pattern.exec(source.slice(position));
    if (!match) return null;
    position += match[0].length;
    return match;
  };
  const numberAt = (value: Value, address: string) => {
    if (value === null) return 0;
    if (typeof value !== 'number') throw new Error(`Sel ${address} berisi teks, bukan angka.`);
    return value;
  };
  const factor = (): number => {
    if (eat(/^-/)) return -factor();
    if (eat(/^\(/)) {
      const value = expression();
      if (!eat(/^\)/)) unsupported();
      return value;
    }
    const sum = eat(/^SUM\(([A-Z]+\d+):([A-Z]+\d+)\)/);
    if (sum) {
      const from = parseAddress(sum[1]);
      const to = parseAddress(sum[2]);
      if (!from || !to) unsupported();
      let total = 0;
      for (let row = from!.row; row <= to!.row; row++) {
        for (let column = from!.column; column <= to!.column; column++) {
          const address = addressOf(row, column);
          total += numberAt(valueAt(sheet, address, depth + 1), address);
        }
      }
      return total;
    }
    const reference = eat(/^([A-Z]+\d+)/);
    if (reference) return numberAt(valueAt(sheet, reference[1], depth + 1), reference[1]);
    const literal = eat(/^\d+(\.\d+)?/);
    if (literal) return Number(literal[0]);
    return unsupported();
  };
  const term = (): number => {
    let value = factor();
    for (;;) {
      if (eat(/^\*/)) value *= factor();
      else if (eat(/^\//)) value /= factor();
      else return value;
    }
  };
  const expression = (): number => {
    let value = term();
    for (;;) {
      if (eat(/^\+/)) value += term();
      else if (eat(/^-/)) value -= term();
      else return value;
    }
  };
  const result = expression();
  if (position !== source.length || !Number.isFinite(result)) unsupported();
  return result;
}

const textAt = (sheet: WorkSheet, address: string) => {
  const value = valueAt(sheet, address);
  return value === null ? '' : String(value).trim();
};

/** The sheet's used range, from its !ref, as 1-based rows. */
function lastRowOf(sheet: WorkSheet) {
  const range = typeof sheet['!ref'] === 'string' ? sheet['!ref'].split(':')[1] : undefined;
  return range ? parseAddress(range)?.row ?? 0 : 0;
}

export type AkunRead = { accounts: BookImportAccount[]; opening: BookImport['opening']; problems: string[]; unnamed: Set<string> };

/**
 * The accounts a unit posts to and their opening balances. Headings are skipped; a row with a number but no name is a
 * placeholder, which is imported only if no journal uses it. A sheet without POS columns (the group decides the side
 * and the report line) is read from its group alone.
 */
export function readAkunSheet(sheet: WorkSheet, label: string): AkunRead {
  const accounts: BookImportAccount[] = [];
  const opening: BookImport['opening'] = {};
  const problems: string[] = [];
  const unnamed = new Set<string>();
  const seen = new Set<string>();
  const hasPositions = /POS SALDO/i.test(textAt(sheet, 'D5')) && /POS LAPORAN/i.test(textAt(sheet, 'E5'));
  for (let row = 1; row <= lastRowOf(sheet); row++) {
    try {
      const codeValue = valueAt(sheet, `B${row}`);
      if (typeof codeValue !== 'number' || codeValue === 0) continue;
      const code = String(codeValue);
      const type = textAt(sheet, `A${row}`).toUpperCase() as AccountType;
      const name = textAt(sheet, `C${row}`);
      const position = textAt(sheet, `D${row}`).toUpperCase();
      const report = textAt(sheet, `E${row}`).toUpperCase();
      const debitValue = valueAt(sheet, `F${row}`);
      const creditValue = valueAt(sheet, `G${row}`);
      if (seen.has(code)) { problems.push(`${label} baris ${row}: nomor akun ${code} dipakai dua kali.`); continue; }
      seen.add(code);
      if (!name) {
        if (debitValue || creditValue) problems.push(`${label} baris ${row}: akun ${code} memiliki saldo awal tetapi belum bernama.`);
        else unnamed.add(code);
        continue;
      }
      if (!ACCOUNT_TYPE_LIST.includes(type)) { problems.push(`${label} baris ${row}: kelompok akun "${type}" tidak dikenali.`); continue; }
      const expectedReport = type === 'TERIMA' || type === 'KELUAR' ? 'LABA RUGI' : 'NERACA';
      if (hasPositions) {
        const postable = (position === 'DEBET' || position === 'KREDIT') && (report === 'NERACA' || report === 'LABA RUGI');
        if (!postable) {
          if (debitValue || creditValue) problems.push(`${label} baris ${row}: akun ${code} bukan akun posting tetapi memiliki saldo awal.`);
          continue;
        }
        if (report !== expectedReport) { problems.push(`${label} baris ${row}: pos laporan akun ${code} harus ${expectedReport}.`); continue; }
      }
      const contra = hasPositions && (position === 'DEBET' ? 'DEBIT' : 'CREDIT') !== groupNormalBalance(type);
      accounts.push({ code, name, type, contra });
      const debit = debitValue === null ? 0 : debitValue;
      const credit = creditValue === null ? 0 : creditValue;
      if (typeof debit !== 'number' || typeof credit !== 'number' || !Number.isSafeInteger(debit) || !Number.isSafeInteger(credit) || debit < 0 || credit < 0) {
        problems.push(`${label} baris ${row}: saldo awal akun ${code} harus Rupiah bulat.`);
      } else if (debit && credit) {
        problems.push(`${label} baris ${row}: saldo awal akun ${code} harus berada pada satu sisi.`);
      } else if ((debit || credit) && expectedReport !== 'NERACA') {
        problems.push(`${label} baris ${row}: akun laba rugi ${code} tidak memiliki saldo awal.`);
      } else if (debit || credit) {
        opening[code] = { debit, credit };
      }
    } catch (cause) {
      problems.push(`${label} baris ${row}: ${cause instanceof Error ? cause.message : 'tidak dapat dibaca.'}`);
    }
  }
  return { accounts, opening, problems, unnamed };
}

/** The workbook's "TAHUN AKADEMIK 2026-2027" heading, when the sheet has one. */
function academicYearHeading(sheet: WorkSheet) {
  for (let row = 1; row <= 5; row++) {
    const match = /(\d{4})\s*-\s*(\d{4})/.exec(textAt(sheet, `A${row}`));
    if (match) return `${match[1]}-${match[2]}`;
  }
  return null;
}

const dateText = (year: number, month: number, day: number) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

export type JurnalRead = { vouchers: BookImportVoucher[]; problems: string[] };

/**
 * The journal's vouchers. The sheet does not mark where a voucher starts, so a voucher is the run of consecutive lines
 * on one date that balances (debet equals kredit); a blank line or a new date ends a run that does not balance.
 * Column A gives the month, column B the day, C the account number, E the description, F and G the debet and kredit.
 */
export function readJurnalSheet(sheet: WorkSheet, label: string, accountCodes: Set<string>, academicYear: string, unnamedCodes = new Set<string>()): JurnalRead {
  const vouchers: BookImportVoucher[] = [];
  const problems: string[] = [];
  const months = fiscalMonths(academicYear);
  const slug = label.replace(/^Jurnal\s+/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'jurnal';
  type Line = BookImportLine & { row: number };
  let run: { lines: Line[]; debit: number; credit: number; date: string } | null = null;

  const close = () => {
    if (!run) return;
    const first = run.lines[0].row;
    const last = run.lines[run.lines.length - 1].row;
    const description = run.lines.map((line) => line.description).find(Boolean) || '';
    if (run.lines.length < 2 || run.debit !== run.credit) {
      problems.push(`${label} baris ${first}–${last}: jurnal tidak seimbang atau belum lengkap (debet ${run.debit.toLocaleString('id-ID')}, kredit ${run.credit.toLocaleString('id-ID')}).`);
    } else if (!description) {
      problems.push(`${label} baris ${first}–${last}: uraian jurnal kosong.`);
    } else {
      vouchers.push({
        id: `imp-${slug}-r${first}`,
        date: run.date,
        description,
        lines: run.lines.map(({ code, debit, credit, description: lineDescription }) => ({ code, debit, credit, description: lineDescription })),
      });
    }
    run = null;
  };

  const headingRow = textAt(sheet, 'C5');
  if (headingRow.toUpperCase() !== 'REF') problems.push(`${label}: format jurnal tidak dikenali (judul kolom REF di C5 tidak ada).`);

  for (let row = JOURNAL_FIRST_ROW; row <= lastRowOf(sheet); row++) {
    try {
      const dateSerial = valueAt(sheet, `A${row}`);
      const dayValue = valueAt(sheet, `B${row}`);
      const codeValue = valueAt(sheet, `C${row}`);
      const description = textAt(sheet, `E${row}`);
      const debitValue = valueAt(sheet, `F${row}`);
      const creditValue = valueAt(sheet, `G${row}`);
      if (codeValue === null && !description && debitValue === null && creditValue === null) { close(); continue; }
      if (typeof codeValue !== 'number' || !Number.isInteger(codeValue)) throw new Error('nomor akun harus berupa angka.');
      const code = String(codeValue);
      if (unnamedCodes.has(code)) throw new Error(`akun ${code} dipakai jurnal tetapi belum bernama di sheet Akun.`);
      if (!accountCodes.has(code)) throw new Error(`akun ${code} tidak ada di sheet Akun atau bukan akun posting.`);
      if (typeof dateSerial !== 'number' || typeof dayValue !== 'number' || !Number.isInteger(dayValue)) throw new Error('bulan (kolom A) dan tanggal (kolom B) harus diisi.');
      const day = new Date(EXCEL_EPOCH + Math.round(dateSerial) * 86_400_000);
      const year = day.getUTCFullYear();
      const month = day.getUTCMonth() + 1;
      if (!months.some((item) => item.monthIndex === month && item.year === year)) throw new Error('bulan di luar tahun akademik.');
      const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
      if (dayValue < 1 || dayValue > lastDay) throw new Error(`tanggal ${dayValue} tidak ada di bulan ini.`);
      const date = dateText(year, month, dayValue);
      const debit = debitValue === null ? 0 : debitValue;
      const credit = creditValue === null ? 0 : creditValue;
      if (typeof debit !== 'number' || typeof credit !== 'number') throw new Error('nominal berisi teks, bukan angka.');
      if (!Number.isSafeInteger(debit) || !Number.isSafeInteger(credit) || debit < 0 || credit < 0) throw new Error('nominal harus Rupiah bulat dan tidak negatif.');
      if ((debit > 0) === (credit > 0)) throw new Error('isi Debet atau Kredit, salah satu saja.');
      if (run && run.date !== date) close();
      run ??= { lines: [], debit: 0, credit: 0, date };
      run.lines.push({ row, code, debit, credit, description });
      run.debit += debit;
      run.credit += credit;
      if (run.debit === run.credit && run.lines.length >= 2) close();
    } catch (cause) {
      problems.push(`${label} baris ${row}: ${cause instanceof Error ? cause.message : 'tidak dapat dibaca.'}`);
      close();
    }
  }
  close();
  return { vouchers, problems };
}

export type BookReadResult = {
  /** Null while any problem remains: the book is imported only once the sheets read clean. */
  book: BookImport | null;
  problems: string[];
  summary: { accounts: number; openingAccounts: number; openingDebit: number; vouchers: number; lines: number; debit: number };
};

export function readBookWorkbook(input: { akun: WorkSheet; akunLabel: string; jurnal: WorkSheet; jurnalLabel: string; academicYear: string }): BookReadResult {
  const problems: string[] = [];
  const headingYear = academicYearHeading(input.jurnal);
  if (headingYear && headingYear !== input.academicYear) problems.push(`${input.jurnalLabel} adalah tahun akademik ${headingYear}, bukan ${input.academicYear}.`);
  const akun = readAkunSheet(input.akun, input.akunLabel);
  problems.push(...akun.problems);
  const jurnal = readJurnalSheet(input.jurnal, input.jurnalLabel, new Set(akun.accounts.map((account) => account.code)), input.academicYear, akun.unnamed);
  problems.push(...jurnal.problems);
  const openingDebit = Object.values(akun.opening).reduce((sum, balance) => sum + balance.debit, 0);
  const openingCredit = Object.values(akun.opening).reduce((sum, balance) => sum + balance.credit, 0);
  if (openingDebit !== openingCredit) problems.push(`${input.akunLabel}: saldo awal belum seimbang (debet ${openingDebit.toLocaleString('id-ID')}, kredit ${openingCredit.toLocaleString('id-ID')}).`);
  const lines = jurnal.vouchers.reduce((sum, voucher) => sum + voucher.lines.length, 0);
  const debit = jurnal.vouchers.reduce((sum, voucher) => sum + voucher.lines.reduce((total, line) => total + line.debit, 0), 0);
  return {
    book: problems.length ? null : { accounts: akun.accounts, opening: akun.opening, vouchers: jurnal.vouchers },
    problems,
    summary: { accounts: akun.accounts.length, openingAccounts: Object.keys(akun.opening).length, openingDebit, vouchers: jurnal.vouchers.length, lines, debit },
  };
}
