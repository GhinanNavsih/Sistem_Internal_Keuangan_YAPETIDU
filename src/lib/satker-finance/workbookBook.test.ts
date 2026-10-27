import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkSheet } from 'xlsx';
import { readAkunSheet, readBookWorkbook, readJurnalSheet } from './workbookBook';

// Excel stores dates as day serials counted from 1899-12-30.
const serial = (year: number, month: number, day: number) => (Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 30)) / 86_400_000;

type Cells = Record<string, { v?: unknown; f?: string }>;
function sheetOf(cells: Cells, ref = 'G40'): WorkSheet {
  return { '!ref': `A1:${ref}`, ...cells } as WorkSheet;
}

function akunRow(row: number, type: string, code: number, name: string, position: string, report: string, opening?: [number?, number?]) {
  const cells: Cells = {
    [`A${row}`]: { v: type }, [`B${row}`]: { v: code }, [`C${row}`]: { v: name }, [`D${row}`]: { v: position }, [`E${row}`]: { v: report },
  };
  if (opening?.[0]) cells[`F${row}`] = { v: opening[0] };
  if (opening?.[1]) cells[`G${row}`] = { v: opening[1] };
  return cells;
}

const journalHeader: Cells = { 'A5': { v: 'BLN' }, 'C5': { v: 'REF' }, 'E5': { v: 'URAIAN' }, 'F5': { v: 'DEBET' }, 'G5': { v: 'KREDIT' } };

function journalRow(row: number, day: number | null, code: number | null, description: string, debit: unknown, credit: unknown, month = serial(2026, 9, 1)): Cells {
  const cells: Cells = {};
  cells[`A${row}`] = { v: month };
  if (day !== null) cells[`B${row}`] = { v: day };
  if (code !== null) cells[`C${row}`] = { v: code };
  if (description) cells[`E${row}`] = { v: description };
  if (debit !== null && debit !== undefined) cells[`F${row}`] = typeof debit === 'string' && debit.startsWith('=') ? { f: debit.slice(1) } : { v: debit };
  if (credit !== null && credit !== undefined) cells[`G${row}`] = typeof credit === 'string' && credit.startsWith('=') ? { f: credit.slice(1) } : { v: credit };
  return cells;
}

const journalSheet = (rows: Cells[]) => sheetOf({ ...journalHeader, ...Object.assign({}, ...rows) }, 'G200');

test('reads postable accounts with their side, group and opening balance, skipping headings', () => {
  const sheet = sheetOf({
    'D5': { v: 'POS SALDO' }, 'E5': { v: 'POS LAPORAN' },
    ...akunRow(8, 'AKTIVA', 10000, 'KAS', 'DEBET', 'NERACA', [500000]),
    ...akunRow(9, 'AKTIVA', 11000, 'BANK', '-', '-'),
    ...akunRow(10, 'AKTIVA', 11001, 'BANK UNIPDU UJI', 'DEBET', 'NERACA', [1000, undefined]),
    ...akunRow(11, 'AKTIVA', 11005, 'AKUM. PENYUSUTAN', 'KREDIT', 'NERACA'),
    ...akunRow(12, 'MODAL', 30000, 'MODAL', 'KREDIT', 'NERACA', [undefined, 501000]),
    ...akunRow(13, 'TERIMA', 41000, 'DROPING', 'KREDIT', 'LABA RUGI'),
  });
  const read = readAkunSheet(sheet, 'Akun Uji');
  assert.deepEqual(read.problems, []);
  assert.deepEqual(read.accounts, [
    { code: '10000', name: 'KAS', type: 'AKTIVA', contra: false },
    { code: '11001', name: 'BANK UNIPDU UJI', type: 'AKTIVA', contra: false },
    { code: '11005', name: 'AKUM. PENYUSUTAN', type: 'AKTIVA', contra: true },
    { code: '30000', name: 'MODAL', type: 'MODAL', contra: false },
    { code: '41000', name: 'DROPING', type: 'TERIMA', contra: false },
  ]);
  assert.deepEqual(read.opening, {
    '10000': { debit: 500000, credit: 0 },
    '11001': { debit: 1000, credit: 0 },
    '30000': { debit: 0, credit: 501000 },
  });
});

test('reports an account whose report line does not match its group', () => {
  const read = readAkunSheet(sheetOf({ 'D5': { v: 'POS SALDO' }, 'E5': { v: 'POS LAPORAN' }, ...akunRow(8, 'TERIMA', 41000, 'DROPING', 'KREDIT', 'NERACA') }), 'Akun Uji');
  assert.equal(read.accounts.length, 0);
  assert.match(read.problems[0], /pos laporan akun 41000 harus LABA RUGI/);
});

test('groups consecutive lines that balance into one voucher, with formulas evaluated', () => {
  const sheet = journalSheet([
    journalRow(7, 4, 11001, 'Setoran dana', 33_250_000, null),
    journalRow(8, 4, 41000, 'Setoran dana', null, '=F7'),
    journalRow(10, 7, 51104, 'Konsumsi', '=18*14000', null),
    journalRow(11, 7, 51104, 'Konsumsi', 1_000, null),
    journalRow(12, 7, 11001, 'Konsumsi', null, '=SUM(F10:F11)'),
  ]);
  const read = readJurnalSheet(sheet, 'Jurnal Uji', new Set(['11001', '41000', '51104']), '2026-2027');
  assert.deepEqual(read.problems, []);
  assert.deepEqual(read.vouchers.map((voucher) => [voucher.id, voucher.date, voucher.description, voucher.lines.length]), [
    ['imp-uji-r7', '2026-09-04', 'Setoran dana', 2],
    ['imp-uji-r10', '2026-09-07', 'Konsumsi', 3],
  ]);
  assert.deepEqual(read.vouchers[1].lines.map((line) => [line.code, line.debit, line.credit]), [['51104', 252_000, 0], ['51104', 1_000, 0], ['11001', 0, 253_000]]);
});

test('reports a run that does not balance before the next blank line, and an account outside the sheet', () => {
  const sheet = journalSheet([
    journalRow(7, 2, 51104, 'Galon', 22_000, null),
    journalRow(8, 2, 51104, 'Galon', 20_500, null),
    journalRow(10, 3, 99999, 'Tidak dikenal', 5_000, null),
    journalRow(11, 3, 10000, 'Tidak dikenal', null, 5_000),
  ]);
  const read = readJurnalSheet(sheet, 'Jurnal Uji', new Set(['51104', '10000']), '2026-2027');
  assert.equal(read.vouchers.length, 0);
  const problems = read.problems.join('\n');
  assert.match(problems, /baris 7–8: jurnal tidak seimbang/);
  assert.match(problems, /baris 10: akun 99999 tidak ada di sheet Akun/);
  assert.match(problems, /baris 11–11: jurnal tidak seimbang/);
});

test('refuses text amounts, a day outside the month, and a line with both sides filled', () => {
  const sheet = journalSheet([
    journalRow(7, 1, 10000, 'Teks', ',', null),
    journalRow(9, 31, 10000, 'Tanggal', 1000, null),
    journalRow(11, 1, 10000, 'Dua sisi', 1000, 1000),
  ]);
  const read = readJurnalSheet(sheet, 'Jurnal Uji', new Set(['10000']), '2026-2027');
  assert.match(read.problems[0], /baris 7: nominal berisi teks/);
  assert.match(read.problems[1], /baris 9: tanggal 31 tidak ada di bulan ini/);
  assert.match(read.problems[2], /baris 11: isi Debet atau Kredit, salah satu saja/);
});

test('refuses a month outside the academic year', () => {
  const sheet = journalSheet([journalRow(7, 3, 10000, 'Bulan lain', 1000, null, serial(2027, 9, 1)), journalRow(8, 3, 10000, 'Bulan lain', null, 1000, serial(2027, 9, 1))]);
  const read = readJurnalSheet(sheet, 'Jurnal Uji', new Set(['10000']), '2026-2027');
  assert.match(read.problems[0], /baris 7: bulan di luar tahun akademik/);
});

test('reads a whole book only when the accounts, opening balance and journals all read clean', () => {
  const akun = sheetOf({
    'A3': { v: 'TAHUN AKADEMIK 2026-2027' }, 'D5': { v: 'POS SALDO' }, 'E5': { v: 'POS LAPORAN' },
    ...akunRow(8, 'AKTIVA', 10000, 'KAS', 'DEBET', 'NERACA', [1000]),
    ...akunRow(9, 'MODAL', 30000, 'MODAL', 'KREDIT', 'NERACA', [undefined, 1000]),
  });
  const jurnal = sheetOf({
    'A3': { v: 'TAHUN AKADEMIK 2026-2027' },
    ...journalHeader,
    ...journalRow(7, 5, 10000, 'Penerimaan', 300, null),
    ...journalRow(8, 5, 30000, 'Penerimaan', null, 300),
  }, 'G20');
  const result = readBookWorkbook({ akun, akunLabel: 'Akun Uji', jurnal, jurnalLabel: 'Jurnal Uji', academicYear: '2026-2027' });
  assert.deepEqual(result.problems, []);
  assert.equal(result.book?.vouchers.length, 1);
  assert.deepEqual(result.summary, { accounts: 2, openingAccounts: 2, openingDebit: 1000, vouchers: 1, lines: 2, debit: 300 });
});

test('blocks the book when the opening balance does not balance or the journal is for another year', () => {
  const akun = sheetOf({ 'D5': { v: 'POS SALDO' }, 'E5': { v: 'POS LAPORAN' }, ...akunRow(8, 'AKTIVA', 10000, 'KAS', 'DEBET', 'NERACA', [1000]) });
  const jurnal = sheetOf({ 'A3': { v: 'TAHUN AKADEMIK 2025-2026' }, ...journalHeader }, 'G20');
  const result = readBookWorkbook({ akun, akunLabel: 'Akun Uji', jurnal, jurnalLabel: 'Jurnal Uji', academicYear: '2026-2027' });
  assert.equal(result.book, null);
  assert.match(result.problems.join('\n'), /tahun akademik 2025-2026, bukan 2026-2027/);
  assert.match(result.problems.join('\n'), /saldo awal belum seimbang/);
});
