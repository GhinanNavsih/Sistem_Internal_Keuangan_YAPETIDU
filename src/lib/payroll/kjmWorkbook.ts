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

/** Parse only raw sheets. Derived sheets and their cached formulas are never payment inputs. */
export function parseKjmWorkbook(buffer: Buffer): KjmCourse[] {
  const metadata = XLSX.read(buffer, { type: 'buffer', bookSheets: true });
  const selected = metadata.SheetNames.filter(n => ['kontrak asli', 'tetap asli'].includes(n.trim().toLowerCase()));
  const workbook = XLSX.read(buffer, { type: 'buffer', cellFormula: false, sheetRows: 5001, sheets: selected });
  const courses: KjmCourse[] = [];
  for (const target of ['kontrak asli', 'tetap asli']) {
    const names = workbook.SheetNames.filter(n => n.trim().toLowerCase() === target);
    if (names.length !== 1) throw new Error(`Wajib ada tepat satu sheet ${target}.`);
    const sheet = names[0];
    const data = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheet], { header: 1, defval: '', raw: true });
    if (data.length > 5000) throw new Error(`${sheet}: maksimum 5000 baris.`);
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
      const sks = Number(row[cols.sks]), attendance = Number(row[cols.attendance]);
      if (row[cols.sks] === '' || row[cols.attendance] === '' || !Number.isFinite(sks) || sks <= 0 || sks > 30 || !Number.isInteger(attendance) || attendance < 0 || attendance > 100) {
        throw new Error(`${sheet}:${index + 1}: SKS/hadir kosong atau tidak valid.`);
      }
      const rowProgram = cols.program >= 0 ? String(row[cols.program] ?? '').trim() : '';
      courses.push({ id: `${target.replace(' ', '_')}_${index + 1}`, sheet, row: index + 1, lecturer, nipy,
        program: rowProgram || String(row[8] || program).trim(), code, name,
        kelas: String(cols.kelas >= 0 ? row[cols.kelas] ?? '' : '').trim(), sks, attendance });
    });
  }
  if (!courses.length || courses.length > 2000) throw new Error('Jumlah mata kuliah harus 1–2000.');
  return courses;
}
