import * as xlsx from 'xlsx';
import * as path from 'path';

const filePath = path.resolve(process.cwd(), '4. Gaji April 2026.xlsx');
const workbook = xlsx.readFile(filePath);
const sheetName = 'list pot';
const sheet = workbook.Sheets[sheetName];

const data = xlsx.utils.sheet_to_json<any[]>(sheet, { header: 1 });

console.log("THT (Tabungan Hari Tua BNI Simponi) data in sheet 'list pot':");
for (let i = 5; i < data.length; i++) {
  const row = data[i];
  const name = row[24];
  const amount = row[25];
  if (name || amount) {
    console.log(`Row ${i + 1}: Name="${name}" | Amount="${amount}"`);
  }
}
