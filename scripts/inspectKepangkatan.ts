import * as XLSX from 'xlsx';
import * as path from 'path';

function main() {
  const filePath = path.resolve(process.cwd(), 'Tunjangan Kepangkatan.xlsx');
  console.log('Reading file:', filePath);
  
  const workbook = XLSX.readFile(filePath);
  console.log('Sheet Names:', workbook.SheetNames);
  
  workbook.SheetNames.forEach(sheetName => {
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet);
    console.log(`\n=== Sheet: ${sheetName} (Rows: ${data.length}) ===`);
    if (data.length > 0) {
      console.log('Sample Row 1:', JSON.stringify(data[0], null, 2));
      if (data.length > 1) {
        console.log('Sample Row 2:', JSON.stringify(data[1], null, 2));
      }
    }
  });
}

main();
