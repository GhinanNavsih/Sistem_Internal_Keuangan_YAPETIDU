import * as xlsx from 'xlsx';
import * as path from 'path';
import * as fs from 'fs';

const filePath = path.resolve(process.cwd(), 'Matrix_Tunjangan_Fungsional.xlsx');

if (!fs.existsSync(filePath)) {
  console.error(`❌ Excel file not found at: ${filePath}`);
  process.exit(1);
}

const workbook = xlsx.readFile(filePath);
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];
const data = xlsx.utils.sheet_to_json<any[]>(sheet, { header: 1 });
const cleanData = data.filter(row => row && row.length > 0 && row.some(cell => cell !== null && cell !== ''));

const dataRows = cleanData.slice(2);
console.log('📌 ROWS FROM MATRIX_TUNJANGAN_FUNGSIONAL:');
for (const row of dataRows) {
  if (!row || row.length < 2) continue;
  const educationLevel = String(row[0] || '').trim();
  if (!educationLevel || educationLevel === 'null') continue;
  console.log(`- "${educationLevel}"`);
}
