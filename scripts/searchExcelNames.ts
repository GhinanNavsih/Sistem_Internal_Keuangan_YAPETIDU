import * as path from 'path';
import * as XLSX from 'xlsx';

interface ExcelRow {
  NAMA: string;
  POTONGAN: number;
}

const MISSING_NAMES = [
  "Zulfikar",
  "As'ad",
  "Asumta",
  "Sabrina",
  "Syarif",
  "Afifudin",
  "Dimyathi",
  "Niswah",
  "Qonita",
  "Fathmah",
  "Muthi",
  "Krisna",
  "Fajrul",
  "Choirin",
  "Qoimam",
  "Royyan",
  "Amigo"
];

async function searchExcel() {
  const excelPath = path.resolve(process.cwd(), 'Potongan BPJS.xlsx');
  const workbook = XLSX.readFile(excelPath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet) as ExcelRow[];

  console.log(`Searching Excel rows for substrings of missing names...`);
  
  for (const term of MISSING_NAMES) {
    const termLower = term.toLowerCase();
    const matches = rows.filter(row => (row.NAMA || '').toLowerCase().includes(termLower));
    if (matches.length > 0) {
      console.log(`\n🔍 Matches for "${term}":`);
      matches.forEach(m => console.log(`- Excel Row: "${m.NAMA}" (Amount: Rp ${m.POTONGAN})`));
    }
  }
}

searchExcel().catch(console.error);
