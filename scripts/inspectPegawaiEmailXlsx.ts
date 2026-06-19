import * as XLSX from 'xlsx';
import * as path from 'path';
import * as fs from 'fs';

function main() {
  const filePath = path.resolve(process.cwd(), 'Pegawai + Email.xlsx');
  console.log('Reading file:', filePath);
  
  if (!fs.existsSync(filePath)) {
    console.error('File does not exist!');
    return;
  }
  
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets['White Collar Loyalis'];
  const data: any[] = XLSX.utils.sheet_to_json(sheet);
  
  console.log(`Total rows: ${data.length}`);
  
  // Let's print out the first 25 rows with ID, Name, Phone, Email
  console.log('\n--- FIRST 25 ROWS DETAIL ---');
  data.slice(0, 25).forEach((row, i) => {
    console.log(`[Row ${i+1}] ID: ${row['ID Pegawai']} | Name: ${row['Nama Lengkap']}`);
    console.log(`  Telp: "${row['Nomor Telepon']}" | Email: "${row['Email']}"`);
  });
}

main();
