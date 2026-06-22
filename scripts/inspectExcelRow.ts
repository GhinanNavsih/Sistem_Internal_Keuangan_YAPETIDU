import * as xlsx from 'xlsx';
import * as path from 'path';
import * as fs from 'fs';

async function run() {
  const filePath = path.resolve(process.cwd(), '4. Gaji April 2026.xlsx');
  const workbook = xlsx.readFile(filePath);
  const sheet = workbook.Sheets['DATA STAF'];
  const data = xlsx.utils.sheet_to_json<any[]>(sheet, { header: 1 });
  
  const headers = data[8];
  
  // Print all headers with indices
  console.log('--- ALL HEADERS ---');
  headers.forEach((h, idx) => {
    if (h !== undefined && h !== null && h !== '') {
      console.log(`${idx}: ${h}`);
    }
  });

  const namesToCheck = [
    'Ahmad Zahro',
    'Sabrina Dwi Prihatini',
    'Syarif Hidayatulloh',
    'Afifudin Dimyathi',
    'Niswah Qonita',
    'Muhammad Qoimam'
  ];

  console.log('\n--- EMPLOYEE ROWS ---');
  namesToCheck.forEach(nameQuery => {
    const row = data.find(r => r && String(r[1]).includes(nameQuery));
    if (row) {
      console.log(`\nName: ${row[1]} (Col 1)`);
      row.forEach((val, idx) => {
        if (val !== undefined && val !== null && val !== '') {
          console.log(`  Col ${idx} (${headers[idx]}): ${val}`);
        }
      });
    } else {
      console.log(`\nName containing "${nameQuery}" not found.`);
    }
  });
}

run().catch(console.error);
