import * as admin from 'firebase-admin';
import * as path from 'path';
import * as dotenv from 'dotenv';
import * as XLSX from 'xlsx';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(path.resolve(process.cwd(), 'service-account.json')),
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  });
}
const db = admin.firestore();

// Exact copy of normalizeName from payrollLogic
const TITLE_PATTERN = /^(KH\.?|Hj\.?|HJ\.?|H\.?|Ust\.?|Ustadz|Ustadzah|Gus|Nyai|Ning|Lora|Prof\.?|Dr\.?|DR\.?|Drs\.?|DRS\.?|Dra\.?|DRA\.?|Ir\.?|IR\.?)$/i;
const DEGREE_PATTERN = /^(S\.|M\.|A\.|SST|SE|SS|SH|ST|MA|MM|MBA|MSi|PhD|Ph\.D\.?|Ners\.?|Apt\.?|Lc\.?|LC\.?|Ns\.?|Dr\.?|DR\.?|M\.?Pd\.?I?|M\.?Tr\.?|Keb\.?|Kes\.?)$/i;

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

// Manual match overrides if name spelling differs significantly
const NAME_OVERRIDES: Record<string, string> = {
  "prof. dr.h. ahmad zahro, ma.": "ahmad zahro",
  "dr.dr.h.m. zulfikar as'ad, mmr": "muhammad zulfikar asumta",
  "dr. dr. h. m. zulfikar as'ad, mmr": "muhammad zulfikar asumta",
  "dr. dr. h.m. zulfikar as'ad, mmr": "muhammad zulfikar asumta",
  "siti rofi'ah, a. md.": "siti rofiah",
  "ririn susilowati, s.h.i, m.e.i": "ririn susilawati",
  "irva arina alawiyah, se": "irva arina alawiyyah",
  "alfis sunan": "sunan",
  "aifi rohim": "aifi rokhim",
  "binti qoni'af, ss, m. hum": "binti qaniah",
  "binti qoni'ah, ss, m. hum": "binti qaniah",
  "dina eka sofiana, se, m.a": "dina eka shofiana",
  "m. qomaruzzaman, s. sos": "m qomaruzzaman",
  "helmi anuchasari, s.km., m.km": "helmi annuchasari",
  "afsah novitasari, s.si, m.pd,": "afsah novita sari",
  "afsah novitasari, s.si, m.pd": "afsah novita sari",
  "anggrea maduratih, s.ab": "anggria maduratih",
  "mokhamad abdul rohim": "m abdul rohim",
  "khoirul a": "khoirul anwar",
  "m.ali nawawi, se., mm": "m ali nawawi",
  "maisaroh, m.si": "maisarah",
  "muhammad zaky, se.m.pd": "muhamad zaki",
  "muhamad fuady": "muhammad fuady",
  "muhammad miftakhul syaikhuddin": "muhammad miftakhul syakhuddin",
  "m. masrur, s. kom.m. kom.": "mukhamad masrur",
  "sholahuddin, s.pdi": "sholihuddin",
  "siti asiah, m.pd.": "siti asiah m. pd",
  "hj. suspa hariati, s. sos.": "suspahariati",
  "achmad mundzir, s.hi": "ahmad mundzir",
  "dian puspitayani, sst.m.kes.": "dian pushpita yani",
  "dian puspitayani, sst.m.kes": "dian pushpita yani",
  "hj.sabrina dwi prihatini, skm., m.kes": "sabrina dwi prihartini"
};

async function main() {
  // 1. Load Excel file
  const filePath = path.resolve(process.cwd(), 'Tunjangan Struktural Jabatan.xlsx');
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets['Sheet1'];
  const excelRows = XLSX.utils.sheet_to_json<any>(sheet);
  
  // 2. Load Firestore Loyalis Employees
  const loySnap = await db.collection('Employees_Loyalis').get();
  const dbEmployees = loySnap.docs.map(d => ({
    id: d.id,
    name: d.data().personal_info?.name || '',
    isActive: d.data().personal_info?.status === 'AKTIF',
    structuralPositions: d.data().employment_profile?.structural_positions || []
  }));

  // Build helper maps for matching
  const dbByNameNormal: Record<string, typeof dbEmployees[0]> = {};
  dbEmployees.forEach(emp => {
    const norm = normalizeName(emp.name);
    dbByNameNormal[norm] = emp;
  });

  // Keep track of matched rows and employees
  const excelMatches: Record<number, typeof dbEmployees[0]> = {};
  const employeeExcelRows: Record<string, any[]> = {}; // employeeId -> array of excel rows

  excelRows.forEach((row, index) => {
    const rawName = row['Nama Loyalis'] || '';
    if (!rawName) return;
    
    let normExcelName = normalizeName(rawName);
    
    // Apply manual override if needed
    if (NAME_OVERRIDES[normExcelName]) {
      normExcelName = NAME_OVERRIDES[normExcelName];
    }

    // Try matching
    let matchedEmp = dbByNameNormal[normExcelName];
    
    if (!matchedEmp) {
      // Try fuzzy matching or manual checks
      // Find if normExcelName is a substring of any db norm names, or vice versa
      const matchedNorm = Object.keys(dbByNameNormal).find(k => 
        k.includes(normExcelName) || normExcelName.includes(k)
      );
      if (matchedNorm) {
        matchedEmp = dbByNameNormal[matchedNorm];
      }
    }

    if (matchedEmp) {
      excelMatches[index] = matchedEmp;
      if (!employeeExcelRows[matchedEmp.id]) {
        employeeExcelRows[matchedEmp.id] = [];
      }
      employeeExcelRows[matchedEmp.id].push(row);
    }
  });

  console.log(`\n======================================================`);
  console.log(`1. UNMATCHED EXCEL NAMES (Not found in Employees_Loyalis)`);
  console.log(`======================================================`);
  let unmatchedExcelCount = 0;
  excelRows.forEach((row, index) => {
    if (!excelMatches[index]) {
      unmatchedExcelCount++;
      console.log(`  - Excel Row ${index + 2}: "${row['Nama Loyalis']}" | Jabatan: "${row['NAMA JABATAN']}" | Tunjangan: Rp ${row['TUNJ JABATAN']?.toLocaleString('id-ID')}`);
    }
  });
  console.log(`Total Unmatched Excel Rows: ${unmatchedExcelCount}`);

  console.log(`\n======================================================`);
  console.log(`2. DETAILED POSITION & ALLOWANCE MISMATCHES`);
  console.log(`======================================================`);
  
  let mismatchCount = 0;

  // Process matched employees
  dbEmployees.forEach(emp => {
    const excelPositions = employeeExcelRows[emp.id] || [];
    const dbPositions = emp.structuralPositions;

    // A. Check positions that are in Excel but missing or different in Firestore
    excelPositions.forEach(exRow => {
      const exTitle = (exRow['NAMA JABATAN'] || '').trim();
      const exAllowance = exRow['TUNJ JABATAN'] || 0;
      const exSatker = (exRow['SATKER'] || '').trim();

      // Find in Firestore positions
      const dbMatch = dbPositions.find((p: any) => 
        (p.name || '').trim().toLowerCase() === exTitle.toLowerCase()
      );

      if (!dbMatch) {
        mismatchCount++;
        console.log(`[MISSING IN FIRESTORE]`);
        console.log(`  Karyawan : ${emp.name} (${emp.id}) [Status Aktif: ${emp.isActive}]`);
        console.log(`  Excel    : Jabatan: "${exTitle}" | Tunjangan: Rp ${exAllowance.toLocaleString('id-ID')} | Satker: "${exSatker}"`);
        console.log(`  Firestore: (TIDAK ADA JABATAN INI)`);
        console.log(`  Semua Jabatan Firestore: ${JSON.stringify(dbPositions)}`);
        console.log(`------------------------------------------------------`);
      } else {
        // Compare allowance and satker
        const allowanceDiff = dbMatch.allowance !== exAllowance;
        
        if (allowanceDiff) {
          mismatchCount++;
          console.log(`[ALLOWANCE VALUE MISMATCH]`);
          console.log(`  Karyawan : ${emp.name} (${emp.id})`);
          console.log(`  Jabatan  : "${exTitle}"`);
          console.log(`  Excel    : Tunjangan: Rp ${exAllowance.toLocaleString('id-ID')} | Satker: "${exSatker}"`);
          console.log(`  Firestore: Tunjangan: Rp ${dbMatch.allowance.toLocaleString('id-ID')} | Satker: "${dbMatch.satker || ''}"`);
          console.log(`------------------------------------------------------`);
        }
      }
    });

    // B. Check positions that are in Firestore but missing in Excel
    dbPositions.forEach((dbPos: any) => {
      const dbTitle = (dbPos.name || '').trim();
      const dbAllowance = dbPos.allowance || 0;

      const excelMatch = excelPositions.find(r => 
        (r['NAMA JABATAN'] || '').trim().toLowerCase() === dbTitle.toLowerCase()
      );

      if (!excelMatch) {
        mismatchCount++;
        console.log(`[EXTRA IN FIRESTORE / MISSING IN EXCEL]`);
        console.log(`  Karyawan : ${emp.name} (${emp.id}) [Status Aktif: ${emp.isActive}]`);
        console.log(`  Firestore: Jabatan: "${dbTitle}" | Tunjangan: Rp ${dbAllowance.toLocaleString('id-ID')} | Satker: "${dbPos.satker || ''}"`);
        console.log(`  Excel    : (TIDAK ADA JABATAN INI DI EXCEL)`);
        console.log(`------------------------------------------------------`);
      }
    });
  });

  console.log(`Total Mismatches Found: ${mismatchCount}`);
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
