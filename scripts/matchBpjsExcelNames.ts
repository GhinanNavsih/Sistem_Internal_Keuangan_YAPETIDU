import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import * as XLSX from 'xlsx';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const serviceAccountPath = path.resolve(process.cwd(), 'service-account.json');

if (!admin.apps.length) {
  if (fs.existsSync(serviceAccountPath)) {
    console.log('Using service-account.json...');
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccountPath),
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    });
  } else {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    });
  }
}

const db = admin.firestore();

// Anchored DEGREE_PATTERN (ends with $) to prevent partial word matches like "Masrur" matching "M"
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

const MANUAL_OVERRIDES: Record<string, string> = {
  'Siti Rofiah': "Siti Rofi'ah, A. Md.",
  'Ririn Susilawati': 'Ririn Susilowati, S.H.I, M.E.I',
  'Irva Arina Alawiyyah': 'Irva Arina Alawiyah, SE',
  'Sunan': 'ALFIS SUNAN',
  'Aifi Rokhim': 'AIFI ROHIM',
  'Binti Qaniah': "Binti Qoni'ah, SS, M. Hum",
  'Dina Eka Shofiana': 'Dina Eka Sofiana, SE, M.A',
  'Dina Eka Shofiana ': 'Dina Eka Sofiana, SE, M.A',
  'M Qomaruzzaman': 'M. Qomaruzzaman, S. Sos',
  'Helmi Annuchasari': 'Helmi Anuchasari, S.KM., M.KM',
  'Afsah Novita Sari': 'Afsah Novitasari, S.Si, M.Pd,',
  'Anggria Maduratih': 'Anggrea Maduratih, S.AB',
  'M Abdul Rokhim': 'Mokhamad Abdul Rokhim',
  'Khoirul Anwar': 'KHOIRUL A',
  'M Ali Nawawi': 'M.Ali Nawawi, SE., MM',
  'M Fatoni': 'FATHONI',
  'Maisarah ': 'Maisaroh, M.Si',
  'Maisarah': 'Maisaroh, M.Si',
  'Muhamad Zaki ': 'Muhammad Zaky, SE.M.Pd',
  'Muhamad Zaki': 'Muhammad Zaky, SE.M.Pd',
  'Muhammad Fuady': 'MUHAMAD FUADY',
  'Muhammad Miftakhul Syaikhuddin': 'Muhammad Miftakhul Syakhuddin',
  'Muhammad Zulfikar Asumta ': "DR.dr.H.M. Zulfikar As'ad, MMR",
  'Muhammad Zulfikar Asumta': "DR.dr.H.M. Zulfikar As'ad, MMR",
  'Mukhamad Masrur': 'M. Masrur, S. Kom.M. Kom.',
  'Nurul Lailiyah.s.ab.m.si': 'Nurul Lailiyah',
  'Sholihuddin': 'Sholahuddin, S.Pdi',
  'Siti Asiah M. Pd': 'Siti Asiah, M.Pd.',
  'Suspahariati': 'Hj. Suspa Hariati, S. Sos.',
  'Ahmad Mundzir': 'Achmad Mundzir, S.HI',
  'Ahmad Zahro': 'Prof. DR.H. Ahmad Zahro, MA.',
  'Dian Puspita Yani ': 'Dian Puspitayani, SST.M.Kes.',
  'Dian Puspita Yani': 'Dian Puspitayani, SST.M.Kes.',
  'Sabrina Dwi Prihartini': 'Hj.Sabrina Dwi Prihatini, SKM., M.Kes',
};

interface ExcelRow {
  NAMA: string;
  POTONGAN: number;
}

async function matchNames() {
  const excelPath = path.resolve(process.cwd(), 'Potongan BPJS.xlsx');
  const workbook = XLSX.readFile(excelPath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet) as ExcelRow[];

  console.log(`📊 Loaded ${rows.length} rows from Excel.`);

  const loyalisSnap = await db.collection('Employees_Loyalis')
    .where('personal_info.status', '==', 'AKTIF')
    .get();

  console.log(`👥 Found ${loyalisSnap.size} active Loyalis employees in Firestore.`);

  const employees = loyalisSnap.docs.map(doc => ({
    id: doc.id,
    name: doc.data().personal_info?.name || '',
    normalizedName: normalizeName(doc.data().personal_info?.name || ''),
  }));

  let exactMatches = 0;
  let normalizedMatches = 0;
  let manualMatches = 0;
  let unmatched: ExcelRow[] = [];
  const matches: { employeeId: string; excelName: string; dbName: string; amount: number }[] = [];

  const exactLookup = new Map<string, typeof employees[0]>();
  const normalizedLookup = new Map<string, typeof employees[0]>();
  
  employees.forEach(emp => {
    exactLookup.set(emp.name.toLowerCase().trim(), emp);
    normalizedLookup.set(emp.normalizedName, emp);
  });

  for (const row of rows) {
    const rawName = row.NAMA || '';
    const cleanRaw = rawName.trim();
    
    let lookupName = cleanRaw;
    if (MANUAL_OVERRIDES[cleanRaw]) {
      lookupName = MANUAL_OVERRIDES[cleanRaw];
    }

    const normLookup = normalizeName(lookupName);

    // 1. Exact Match
    let matchedEmp = exactLookup.get(lookupName.toLowerCase());
    if (matchedEmp) {
      exactMatches++;
      matches.push({ employeeId: matchedEmp.id, excelName: rawName, dbName: matchedEmp.name, amount: row.POTONGAN });
      continue;
    }

    // 2. Normalized Match
    matchedEmp = normalizedLookup.get(normLookup);
    if (matchedEmp) {
      normalizedMatches++;
      matches.push({ employeeId: matchedEmp.id, excelName: rawName, dbName: matchedEmp.name, amount: row.POTONGAN });
      continue;
    }

    // 3. Fallback name search (min length 3 to prevent "m" matching things containing "m")
    let fuzzyMatch = null;
    if (normLookup.length >= 3) {
      for (const emp of employees) {
        if (emp.normalizedName.length >= 3 && 
            (emp.normalizedName.includes(normLookup) || normLookup.includes(emp.normalizedName))) {
          fuzzyMatch = emp;
          break;
        }
      }
    }

    if (fuzzyMatch) {
      manualMatches++;
      matches.push({ employeeId: fuzzyMatch.id, excelName: rawName, dbName: fuzzyMatch.name, amount: row.POTONGAN });
      continue;
    }

    unmatched.push(row);
  }

  console.log(`\n📋 Match Results Summary:`);
  console.log(`- Exact matches: ${exactMatches}`);
  console.log(`- Normalized matches: ${normalizedMatches}`);
  console.log(`- Fuzzy/Fitted matches: ${manualMatches}`);
  console.log(`- Unmatched: ${unmatched.length}`);

  if (unmatched.length > 0) {
    console.log('\n❌ Unmatched names from Excel:');
    unmatched.forEach(u => console.log(`- "${u.NAMA}" (Amount: Rp ${u.POTONGAN})`));
  }
}

matchNames().catch(console.error);
