import * as XLSX from 'xlsx';
import * as path from 'path';

const TITLE_PATTERN = /^(KH\.?|Hj\.?|HJ\.?|H\.?|Ust\.?|Ustadz|Ustadzah|Gus|Nyai|Ning|Lora|Prof\.?|Dr\.?|DR\.?|Drs\.?|DRS\.?|Dra\.?|DRA\.?|Ir\.?|IR\.?)$/i;
const DEGREE_PATTERN = /^(S\.|M\.|A\.|SST|SE|SS|SH|ST|MA|MM|MBA|MSi|PhD|Ph\.D\.?|Ners\.?|Apt\.?|Lc\.?|LC\.?|Ns\.?|Dr\.?|DR\.?|M\.?Pd\.?I?|M\.?Tr\.?|Keb\.?|Kes\.?)/i;

function normalizeName(fullName: string): string {
  let name = fullName.trim();
  const commaIdx = name.indexOf(',');
  if (commaIdx > 0) {
    name = name.substring(0, commaIdx).trim();
  }
  let tokens = name.split(/\s+/);
  while (tokens.length > 1) {
    if (TITLE_PATTERN.test(tokens[0])) {
      tokens.shift();
    } else {
      break;
    }
  }
  while (tokens.length > 1) {
    const last = tokens[tokens.length - 1];
    if (DEGREE_PATTERN.test(last)) {
      tokens.pop();
    } else {
      break;
    }
  }
  let result = tokens.join(' ');
  result = result.replace(/[.,]+$/g, '');
  return result.toLowerCase().trim();
}

const NAME_OVERRIDES: Record<string, string> = {
  "prof. dr.h. ahmad zahro, ma.": "ahmad zahro",
  "dr.dr.h.m. zulfikar as'ad, mmr": "muhammad zulfikar asumta",
  "siti rofi'ah, a. md.": "siti rofiah",
  "ririn susilowati, s.h.i, m.e.i": "ririn susilawati",
  "irva arina alawiyah, se": "irva arina alawiyyah",
  "alfis sunan": "sunan",
  "aifi rohim": "aifi rokhim",
  "binti qoni'ah, ss, m. hum": "binti qaniah",
  "dina eka sofiana, se, m.a": "dina eka shofiana",
  "m. qomaruzzaman, s. sos": "m qomaruzzaman",
  "helmi anuchasari, s.km., m.km": "helmi annuchasari",
  "afsah novitasari, s.si, m.pd": "afsah novita sari",
  "anggrea maduratih, s.ab": "anggria maduratih",
  "mokhamad abdul rohim": "m abdul rohim",
  "khoirul a": "khoirul anwar",
  "m.ali nawawi, se., mm": "m ali nawawi",
  "maisaroh, m.si": "maisarah",
  "muhammad zaky, se.m.pd": "muhamad zaki",
  "muhamad fuady": "muhammad fuady",
  "muhammad miftakhul syakhuddin": "muhammad miftakhul syaikhuddin",
  "m. masrur, s. kom.m. kom.": "mukhamad masrur",
  "sholahuddin, s.pdi": "sholihuddin",
  "siti asiah, m.pd.": "siti asiah m. pd",
  "hj. suspa hariati, s. sos.": "suspahariati",
  "achmad mundzir, s.hi": "ahmad mundzir",
  "dian puspitayani, sst.m.kes.": "dian pushpita yani",
  "hj.sabrina dwi prihatini, skm., m.kes": "sabrina dwi prihartini"
};

function main() {
  const filePath = path.resolve(process.cwd(), 'Tunjangan Struktural Jabatan.xlsx');
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets['Sheet1'];
  const excelRows = XLSX.utils.sheet_to_json<any>(sheet);

  // DB Mock for the two employees
  const dbEmployees = [
    { id: 'Loyalis_043', name: 'M. Masrur, S. Kom.M. Kom.' },
    { id: 'Loyalis_185', name: 'Muhammad Miftakhul Syakhuddin' }
  ];

  const dbByNameNormal: Record<string, any> = {};
  dbEmployees.forEach(emp => {
    const norm = normalizeName(emp.name);
    dbByNameNormal[norm] = emp;
  });

  console.log('dbByNameNormal keys:', Object.keys(dbByNameNormal));

  excelRows.forEach((row, index) => {
    const rawName = row['Nama Loyalis'] || '';
    if (!rawName) return;
    
    let normExcelName = normalizeName(rawName);
    const originalNorm = normExcelName;
    if (NAME_OVERRIDES[normExcelName]) {
      normExcelName = NAME_OVERRIDES[normExcelName];
    }

    let matchedEmp = dbByNameNormal[normExcelName];
    let fuzzyMatched = false;
    
    if (!matchedEmp) {
      const matchedNorm = Object.keys(dbByNameNormal).find(k => 
        k.includes(normExcelName) || normExcelName.includes(k)
      );
      if (matchedNorm) {
        matchedEmp = dbByNameNormal[matchedNorm];
        fuzzyMatched = true;
      }
    }

    if (matchedEmp) {
      console.log(`Excel Row ${index + 2} ("${rawName}" -> norm: "${originalNorm}" -> overridden: "${normExcelName}") matched to ${matchedEmp.name} (${matchedEmp.id}) [Fuzzy: ${fuzzyMatched}]`);
    }
  });
}

main();
