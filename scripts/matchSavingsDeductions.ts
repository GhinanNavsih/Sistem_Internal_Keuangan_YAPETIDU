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

// Title and Degree patterns for name normalization
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

// Reusable manual overrides from matchAndUpdateKoperasiUsers
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
  'Achyar': 'M. Achyar',
  'Ahmad Khaerudin': 'A. Khaerudin, S. Ag.',
  'Alief Arsalan Muharram': 'Alief Arsalam Muharram, S.Kom.',
  'Dwi Nurcahyani': 'Dwi Nur Cahyani, SS',
  'Feny Vitiasari Dessy': 'Fenny Vitiasaridessy, S.ST',
  'Harun Arrosyid': 'H. Harun Ar Rasyid, S.Pd.I',
  'Isbayu Uliyah': "Isbayu' Uliyah, S.Kom",
  'Lulus Oktavia Kartikasari': 'Lulus Oktavia Kartika sari, S.Pd',
  'Mochamad Samsukadi': 'H.M. Samsukadi, Lc, M.Th.I',
  'Muhammad Zaimuddin Wijaya Asad': "Drs. H.M.Zaimuddin W.As'ad, MS",
  'Nuning Yudhi Prasetyani': 'Dr. Nuning Yudhi Prastyani, SS. M. Hum.',
  'Nuning Yudhi Prasetyani ': 'Dr. Nuning Yudhi Prastyani, SS. M. Hum.',
  'Pujiani S. Kep. Ns. M. Kes': 'Pujiani, S.Kep. Ners., M.Kes',
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

async function matchSavings() {
  const excelPath = path.resolve(process.cwd(), 'Potongan Tabungan.xlsx');
  if (!fs.existsSync(excelPath)) {
    console.error(`❌ Excel file not found at: ${excelPath}`);
    process.exit(1);
  }

  const workbook = XLSX.readFile(excelPath);
  const sheetName = workbook.SheetNames[0];
  console.log(`📖 Loading sheet: "${sheetName}"`);
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet);

  if (rows.length === 0) {
    console.error('❌ Excel file is empty.');
    process.exit(1);
  }

  // Auto-detect columns
  const sampleRow = rows[0];
  const keys = Object.keys(sampleRow);
  console.log(`Detected columns in Excel: ${keys.join(', ')}`);

  // Find the name column
  const nameKey = keys.find(k => /name|nama|staf|pegawai/i.test(k)) || keys[0];
  // Find the savings deduction column
  const amountKey = keys.find(k => /potongan|tabungan|nominal|jumlah|value|amount|debet|kredit/i.test(k)) || keys[1];

  console.log(`🔍 Mapping columns:`);
  console.log(`  - Name Column: "${nameKey}"`);
  console.log(`  - Deduction Column: "${amountKey}"`);

  // Fetch all active/inactive Loyalis employees from Firebase
  console.log(`\n👥 Fetching Loyalis employees from Firebase...`);
  const loyalisSnap = await db.collection('Employees_Loyalis').get();
  console.log(`Fetched ${loyalisSnap.size} Loyalis records.`);

  const employees = loyalisSnap.docs.map(doc => {
    const data = doc.data();
    const name = data.personal_info?.name || '';
    const status = data.personal_info?.status || 'UNKNOWN';
    return {
      id: doc.id,
      name,
      status,
      normalizedName: normalizeName(name),
    };
  });

  const exactLookup = new Map<string, typeof employees[0]>();
  const normalizedLookup = new Map<string, typeof employees[0]>();

  employees.forEach(emp => {
    if (emp.name) {
      exactLookup.set(emp.name.toLowerCase().trim(), emp);
      normalizedLookup.set(emp.normalizedName, emp);
    }
  });

  const matched: any[] = [];
  const unmatched: any[] = [];

  for (const row of rows) {
    const rawName = String(row[nameKey] || '').trim();
    if (!rawName) continue;

    // Clean amount (sometimes read as string with dots/commas)
    const rawAmount = row[amountKey];
    let amount = 0;
    if (typeof rawAmount === 'number') {
      amount = rawAmount;
    } else if (rawAmount) {
      amount = Number(String(rawAmount).replace(/\D/g, '')) || 0;
    }

    let lookupName = rawName;
    if (MANUAL_OVERRIDES[rawName]) {
      lookupName = MANUAL_OVERRIDES[rawName];
    }

    const normLookup = normalizeName(lookupName);

    // 1. Exact Match
    let matchedEmp = exactLookup.get(lookupName.toLowerCase());
    if (matchedEmp) {
      matched.push({
        excelName: rawName,
        dbName: matchedEmp.name,
        employeeId: matchedEmp.id,
        status: matchedEmp.status,
        amount,
        matchType: 'exact',
      });
      continue;
    }

    // 2. Normalized Match
    matchedEmp = normalizedLookup.get(normLookup);
    if (matchedEmp) {
      matched.push({
        excelName: rawName,
        dbName: matchedEmp.name,
        employeeId: matchedEmp.id,
        status: matchedEmp.status,
        amount,
        matchType: 'normalized',
      });
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
      matched.push({
        excelName: rawName,
        dbName: fuzzyMatch.name,
        employeeId: fuzzyMatch.id,
        status: fuzzyMatch.status,
        amount,
        matchType: 'fuzzy',
      });
      continue;
    }

    // Unmatched
    unmatched.push({
      excelName: rawName,
      amount,
      normalizedKey: normLookup,
    });
  }

  // Sort results
  matched.sort((a, b) => a.excelName.localeCompare(b.excelName));
  unmatched.sort((a, b) => a.excelName.localeCompare(b.excelName));

  const output = {
    generatedAt: new Date().toISOString(),
    summary: {
      totalExcelRows: rows.length,
      matched: matched.length,
      unmatched: unmatched.length,
    },
    matched,
    unmatched,
  };

  const outputPath = path.resolve(process.cwd(), 'scripts/savings_matches.json');
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf8');

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`  MATCHING SUMMARY`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Total Rows in Excel: ${output.summary.totalExcelRows}`);
  console.log(`  Successfully Matched: ${output.summary.matched}`);
  console.log(`  Unmatched: ${output.summary.unmatched}`);
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log(`✅ Results exported for review to: ${outputPath}`);
}

matchSavings().catch(console.error);
