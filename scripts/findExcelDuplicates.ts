import * as path from 'path';
import * as XLSX from 'xlsx';

interface ExcelRow {
  NAMA: string;
  POTONGAN: number;
}

async function findDuplicates() {
  const excelPath = path.resolve(process.cwd(), 'Potongan BPJS.xlsx');
  const workbook = XLSX.readFile(excelPath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet) as ExcelRow[];

  const nameCounts = new Map<string, number>();
  for (const row of rows) {
    const name = (row.NAMA || '').trim();
    nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
  }

  console.log('Duplicate names in Excel sheet:');
  let hasDuplicates = false;
  nameCounts.forEach((count, name) => {
    if (count > 1) {
      console.log(`- "${name}" appears ${count} times`);
      hasDuplicates = true;
    }
  });

  if (!hasDuplicates) {
    console.log('No duplicate names found in Excel.');
  }
}

findDuplicates().catch(console.error);
