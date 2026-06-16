import * as XLSX from 'xlsx';
import * as path from 'path';

function main() {
  const filePath = path.resolve(process.cwd(), 'Tunjangan Struktural Jabatan.xlsx');
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets['Sheet1'];
  const excelRows = XLSX.utils.sheet_to_json<any>(sheet);
  
  console.log('=== Excel Search for positions containing "Biro Pelayanan" or "Pengelolaan Data" or "Administrasi Keuangan" ===');
  excelRows.forEach((r, idx) => {
    const pos = String(r['NAMA JABATAN'] || '');
    if (pos.toLowerCase().includes('biro') || pos.toLowerCase().includes('administrasi') || pos.toLowerCase().includes('data')) {
      console.log(`Row ${idx + 2}: Name: "${r['Nama Loyalis']}" | Position: "${r['NAMA JABATAN']}" | Allowance: ${r['TUNJ JABATAN']}`);
    }
  });
}

main();
