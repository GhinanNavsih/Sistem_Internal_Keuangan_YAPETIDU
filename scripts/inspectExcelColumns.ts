import * as xlsx from 'xlsx';
import * as path from 'path';

const filePath = path.resolve(process.cwd(), '4. Gaji April 2026.xlsx');
const workbook = xlsx.readFile(filePath);
const sheet = workbook.Sheets['DATA STAF'];

if (!sheet) {
  console.log('DATA STAF sheet not found');
  process.exit(1);
}

const data = xlsx.utils.sheet_to_json<any[]>(sheet, { header: 1 });
const row4 = data[4];
const row5 = data[5];
const row6 = data[6];
const row8 = data[8];
const row9 = data[9];

const maxLen = Math.max(row4.length, row5.length, row6.length, row9.length);
for (let i = 30; i < maxLen; i++) {
  console.log(`Index ${i} (ColNum ${row8[i] || ''}):`);
  console.log(`  Row 4: ${row4[i] ?? ''}`);
  console.log(`  Row 5: ${row5[i] ?? ''}`);
  console.log(`  Row 6: ${row6[i] ?? ''}`);
  console.log(`  Row 9 Value: ${row9[i] ?? ''}`);
}
