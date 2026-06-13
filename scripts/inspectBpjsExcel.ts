import * as path from 'path';
import * as XLSX from 'xlsx';

async function inspectBpjsExcel() {
  const filePath = path.resolve(process.cwd(), 'Potongan BPJS.xlsx');
  console.log(`Loading excel from ${filePath}...`);
  
  const workbook = XLSX.readFile(filePath);
  const sheetNames = workbook.SheetNames;
  console.log('Sheets in workbook:', sheetNames);

  const firstSheet = workbook.Sheets[sheetNames[0]];
  const data = XLSX.utils.sheet_to_json(firstSheet);
  
  console.log(`Found ${data.length} rows in the first sheet.`);
  if (data.length > 0) {
    console.log('Sample rows:');
    console.log(JSON.stringify(data.slice(0, 5), null, 2));
  }
}

inspectBpjsExcel().catch(console.error);
