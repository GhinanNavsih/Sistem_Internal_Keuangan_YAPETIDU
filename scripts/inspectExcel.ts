import * as xlsx from 'xlsx';
import * as path from 'path';
import * as fs from 'fs';

const filePath = path.resolve(process.cwd(), '4. Gaji April 2026.xlsx');

if (!fs.existsSync(filePath)) {
  console.error(`❌ Excel file not found at: ${filePath}`);
  process.exit(1);
}

const workbook = xlsx.readFile(filePath);
const sheet = workbook.Sheets['DATA STAF'];
const data = xlsx.utils.sheet_to_json<any[]>(sheet, { header: 1 });

const r4 = data[4] as (string | null)[];
const r5 = data[5] as (string | null)[];
const r6 = data[6] as (string | null)[];
const r7 = data[7] as (string | null)[];
const r8 = data[8] as (number | null)[];

console.log('📌 MAPPING OF COLUMNS IN "DATA STAF":');
const maxCols = Math.max(r4.length, r5.length, r6.length, r8.length);
for (let c = 0; c < maxCols; c++) {
  const colIndexFromR8 = r8[c];
  const h1 = r4[c] || '';
  const h2 = r5[c] || '';
  const h3 = r6[c] || '';
  const h4 = r7[c] || '';
  console.log(`Col ${c} (R8 index: ${colIndexFromR8}): "${h1}" / "${h2}" / "${h3}" / "${h4}"`);
}

console.log('\n📌 Row 9 data (Prof. DR.H. Ahmad Zahro, MA.):');
const row9 = data[9];
row9.forEach((val, c) => {
  console.log(`Col ${c}: ${val}`);
});
