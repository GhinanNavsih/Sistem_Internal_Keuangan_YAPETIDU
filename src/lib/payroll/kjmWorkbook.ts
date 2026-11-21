import * as XLSX from 'xlsx';
import { normalizeKjmNipy, type KjmCourse } from './kjm';

interface KjmColumnMap {
  code: number;
  name: number;
  sks: number;
  kelas: number;
  attendance: number;
  program: number;
}

const LEGACY_SHEETS = ['kontrak asli', 'tetap asli'];
const KJM_HEADERS = [
  'nipy', 'nama dosen pengajar', 'program studi', 'kode mk', 'nama mata kuliah',
  'kelas', 'sks', 'jumlah hadir (pertemuan)',
];
const sheetKey = (name: string) => name.trim().toLowerCase();
const cellText = (value: unknown) => String(value ?? '').trim();
const headerText = (value: unknown) => cellText(value).toLowerCase().replace(/\s+/g, ' ');

function readCourseLoad(sksCell: unknown, attendanceCell: unknown, location: string) {
  const sks = Number(cellText(sksCell));
  const attendance = Number(cellText(attendanceCell));
  if (!cellText(attendanceCell) || !Number.isFinite(sks) || sks <= 0 || sks > 30 ||
      !Number.isInteger(attendance) || attendance < 0 || attendance > 100) {
    throw new Error(`${location}: SKS/hadir kosong atau tidak valid.`);
  }
  return { sks, attendance };
}

function readRows(workbook: XLSX.WorkBook, sheet: string): unknown[][] {
  const data = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheet], {
    header: 1, range: 0, defval: '', raw: true,
  });
  if (data.length > 5000) throw new Error(`${sheet}: maksimum 5000 baris.`);
  return data;
}

function parseKjmSheet(sheet: string, data: unknown[][]): KjmCourse[] {
  const headerIndex = data.findIndex(row => {
    const headers = row.map(headerText);
    return KJM_HEADERS.every(header => headers.includes(header));
  });
  if (headerIndex === -1) throw new Error(`${sheet}: kolom wajib XLSX tidak lengkap. Periksa ${KJM_HEADERS.join(', ')}.`);

  const headers = data[headerIndex].map(headerText);
  const columns = KJM_HEADERS.map(header => headers.indexOf(header));
  const courses: KjmCourse[] = [];
  for (let index = headerIndex + 1; index < data.length; index += 1) {
    const row = data[index];
    if (!row.some(cellText)) continue;

    const [rawNipy, lecturerCell, programCell, codeCell, nameCell, kelasCell, sksCell, attendanceCell] =
      columns.map(column => row[column]);
    const nipy = normalizeKjmNipy(rawNipy);
    const lecturerName = cellText(lecturerCell);
    const program = cellText(programCell);
    const code = cellText(codeCell);
    const name = cellText(nameCell);
    const rowNumber = index + 1;
    const location = `${sheet}:${rowNumber}`;
    if (!lecturerName || !program || !code || !name) {
      throw new Error(`${location}: nama dosen, prodi, kode, dan nama mata kuliah wajib diisi.`);
    }
    const { sks, attendance } = readCourseLoad(sksCell, attendanceCell, location);
    courses.push({
      id: `kjm_${rowNumber}`, sheet, row: rowNumber, lecturer: `${nipy}-${lecturerName}`, nipy,
      ...(typeof rawNipy === 'number' && /^\d{10}$/.test(nipy) ? { nipyMayHaveLostLeadingZero: true } : {}),
      program, code, name, kelas: cellText(kelasCell), sks, attendance,
    });
  }
  return courses;
}

/** Parse the raw attendance export or the legacy pair of raw sheets. */
export function parseKjmWorkbook(buffer: Buffer): KjmCourse[] {
  const metadata = XLSX.read(buffer, { type: 'buffer', bookSheets: true });
  const legacy = metadata.SheetNames.filter(name => LEGACY_SHEETS.includes(sheetKey(name)));
  const selected = legacy.length ? legacy : metadata.SheetNames.filter(name => sheetKey(name) === 'kjm');
  if (!selected.length) throw new Error('Wajib ada sheet KJM atau pasangan sheet Kontrak Asli dan Tetap Asli.');
  const required = legacy.length ? LEGACY_SHEETS : ['kjm'];
  const workbook = XLSX.read(buffer, { type: 'buffer', cellFormula: false, sheetRows: 5001, sheets: selected });
  const courses: KjmCourse[] = [];
  for (const target of required) {
    const names = selected.filter(name => sheetKey(name) === target);
    if (names.length !== 1) throw new Error(`Wajib ada tepat satu sheet ${target}.`);
    const sheet = names[0];
    const data = readRows(workbook, sheet);
    if (target === 'kjm') courses.push(...parseKjmSheet(sheet, data));
    else courses.push(...parseLegacySheet(sheet, target, data));
  }
  if (!courses.length || courses.length > 2000) throw new Error('Jumlah mata kuliah harus 1–2000.');
  return courses;
}

function parseLegacySheet(sheet: string, target: string, data: unknown[][]): KjmCourse[] {
  const courses: KjmCourse[] = [];
  let lecturer = '', nipy = '', program = '';
  let cols: KjmColumnMap | null = null;
  data.forEach((row, index) => {
    const text = String(row[0] ?? '').trim();
    if (/^program studi\s/i.test(text)) {
      const p = text.replace(/^program studi\s*/i, '').trim();
      if (p) program = p;
      lecturer = ''; nipy = ''; return;
    }
    if (!cols) {
      const lower = row.map(c => String(c ?? '').trim().toLowerCase());
      if (lower.includes('kode mk') && lower.some(c => c.includes('mata kuliah') || c === 'nama mk')) {
        cols = {
          code: lower.indexOf('kode mk'),
          name: lower.findIndex(c => c.includes('mata kuliah') || c === 'nama mk'),
          sks: lower.indexOf('sks'),
          kelas: lower.indexOf('kelas'),
          attendance: lower.findIndex(c => c === 'hadir' || c === 'kehadiran'),
          program: lower.findIndex(c => c === 'program studi' || c === 'prodi'),
        };
        return;
      }
      return;
    }
    const teacher = /^(\d[\d\s]*)\s*[-–]\s*(.+)$/.exec(text);
    if (teacher) { lecturer = `${normalizeKjmNipy(teacher[1])}-${teacher[2].trim()}`; nipy = normalizeKjmNipy(teacher[1]); return; }
    const code = cols.code >= 0 ? String(row[cols.code] ?? '').trim() : '';
    const name = cols.name >= 0 ? String(row[cols.name] ?? '').trim() : '';
    const hasCourse = !!(code && name);
    if (/^\d+(\.0)?$/.test(text) && !hasCourse && row.slice(1, 8).some(v => String(v ?? '').trim() !== '')) {
      throw new Error(`${sheet}:${index + 1}: kode/nama mata kuliah kosong.`);
    }
    if (!hasCourse || /^(jumlah|total|subtotal)/i.test(text)) return;
    if (!cols || !/^\d+(\.0)?$/.test(text) || !lecturer) throw new Error(`${sheet}:${index + 1}: format/baris dosen tidak dikenali.`);
    const { sks, attendance } = readCourseLoad(row[cols.sks], row[cols.attendance], `${sheet}:${index + 1}`);
    const rowProgram = cols.program >= 0 ? String(row[cols.program] ?? '').trim() : '';
    courses.push({ id: `${target.replace(' ', '_')}_${index + 1}`, sheet, row: index + 1, lecturer, nipy,
      program: rowProgram || String(row[8] || program).trim(), code, name,
      kelas: String(cols.kelas >= 0 ? row[cols.kelas] ?? '' : '').trim(), sks, attendance });
  });
  return courses;
}
