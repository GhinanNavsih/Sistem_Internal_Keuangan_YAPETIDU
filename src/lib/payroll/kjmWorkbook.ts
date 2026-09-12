import * as XLSX from 'xlsx';
import { normalizeKjmNipy, type KjmCourse } from './kjm';

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
    let foundHeader = false;
    data.forEach((row, index) => {
      const text = String(row[0] ?? '').trim();
      if (/^program studi\s/i.test(text)) { program = text.replace(/^program studi\s*/i, ''); lecturer = ''; nipy = ''; return; }
      if (String(row[1]).trim().toLowerCase() === 'kode mk') { foundHeader = true; return; }
      const teacher = /^(\d[\d\s]*)\s*[-–]\s*(.+)$/.exec(text);
      if (teacher) { lecturer = `${normalizeKjmNipy(teacher[1])}-${teacher[2].trim()}`; nipy = normalizeKjmNipy(teacher[1]); return; }
      const hasCourse = String(row[1] ?? '').trim() && String(row[2] ?? '').trim();
      if (/^\d+(\.0)?$/.test(text) && !hasCourse && row.slice(1, 7).some(v => v !== '')) throw new Error(`${sheet}:${index + 1}: kode/nama mata kuliah kosong.`);
      if (!hasCourse || /^(jumlah|total|subtotal)/i.test(text)) return;
      if (!foundHeader || !/^\d+(\.0)?$/.test(text) || !lecturer) throw new Error(`${sheet}:${index + 1}: format/baris dosen tidak dikenali.`);
      const sks = Number(row[3]), attendance = Number(row[5]);
      if (row[3] === '' || row[5] === '' || !Number.isFinite(sks) || sks <= 0 || sks > 30 || !Number.isInteger(attendance) || attendance < 0 || attendance > 100) throw new Error(`${sheet}:${index + 1}: SKS/hadir kosong atau tidak valid.`);
      courses.push({ id: `${target.replace(' ', '_')}_${index + 1}`, sheet, row: index + 1, lecturer, nipy,
        program: String(row[8] || program).trim(), code: String(row[1]).trim(), name: String(row[2]).trim(),
        kelas: String(row[4] ?? '').trim(), sks, attendance });
    });
  }
  if (!courses.length || courses.length > 2000) throw new Error('Jumlah mata kuliah harus 1–2000.');
  return courses;
}
