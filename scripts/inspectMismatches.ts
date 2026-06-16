import * as XLSX from 'xlsx';
import * as path from 'path';

function main() {
  const filePath = path.resolve(process.cwd(), 'Tunjangan Struktural Jabatan.xlsx');
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets['Sheet1'];
  const excelRows = XLSX.utils.sheet_to_json<any>(sheet);
  
  console.log('=== Excel Rows for M. Masrur or similar ===');
  excelRows.forEach((r, idx) => {
    const name = String(r['Nama Loyalis']);
    if (name.toLowerCase().includes('masrur') || name.toLowerCase().includes('miftakhul')) {
      console.log(`Row ${idx + 2}: Name: "${r['Nama Loyalis']}" | Position: "${r['NAMA JABATAN']}" | Allowance: ${r['TUNJ JABATAN']}`);
    }
  });

  console.log('\n=== Excel Rows for Kabag Unipdu press ===');
  excelRows.forEach((r, idx) => {
    const pos = String(r['NAMA JABATAN']);
    if (pos.toLowerCase().includes('press')) {
      console.log(`Row ${idx + 2}: Name: "${r['Nama Loyalis']}" | Position: "${r['NAMA JABATAN']}" | Allowance: ${r['TUNJ JABATAN']}`);
    }
  });

  console.log('\n=== Excel Rows for Dekan F Saintek ===');
  excelRows.forEach((r, idx) => {
    const pos = String(r['NAMA JABATAN']);
    if (pos.toLowerCase().includes('saintek') && pos.toLowerCase().includes('dekan')) {
      console.log(`Row ${idx + 2}: Name: "${r['Nama Loyalis']}" | Position: "${r['NAMA JABATAN']}" | Allowance: ${r['TUNJ JABATAN']}`);
    }
  });
}

main();
