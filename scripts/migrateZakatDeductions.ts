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

// Reusable manual overrides
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

async function migrateZakat() {
  const excelPath = path.resolve(process.cwd(), 'Potongan Zakat Infaq Sodaqoh.xlsx');
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

  const sampleRow = rows[0];
  const keys = Object.keys(sampleRow);
  const nameKey = keys.find(k => /name|nama|staf|pegawai/i.test(k)) || keys[0];
  const amountKey = keys.find(k => /potongan|zakat|infaq|sodaqoh|nominal|jumlah|value|amount/i.test(k)) || keys[1];

  console.log(`🔍 Mapping columns:`);
  console.log(`  - Name Column: "${nameKey}"`);
  console.log(`  - Zakat Deduction Column: "${amountKey}"`);

  console.log(`\n👥 Fetching active Loyalis employees from Firebase...`);
  const loyalisSnap = await db.collection('Employees_Loyalis')
    .where('personal_info.status', '==', 'AKTIF')
    .get();
  console.log(`Fetched ${loyalisSnap.size} active Loyalis records.`);

  const employees = loyalisSnap.docs.map(doc => {
    const data = doc.data();
    const name = data.personal_info?.name || '';
    return {
      id: doc.id,
      ref: doc.ref,
      name,
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
  const matchedEmpIds = new Set<string>();

  for (const row of rows) {
    const rawName = String(row[nameKey] || '').trim();
    if (!rawName) continue;

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
      matched.push({ excelName: rawName, dbName: matchedEmp.name, id: matchedEmp.id, ref: matchedEmp.ref, amount });
      matchedEmpIds.add(matchedEmp.id);
      continue;
    }

    // 2. Normalized Match
    matchedEmp = normalizedLookup.get(normLookup);
    if (matchedEmp) {
      matched.push({ excelName: rawName, dbName: matchedEmp.name, id: matchedEmp.id, ref: matchedEmp.ref, amount });
      matchedEmpIds.add(matchedEmp.id);
      continue;
    }

    // 3. Fuzzy match fallback
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
      matched.push({ excelName: rawName, dbName: fuzzyMatch.name, id: fuzzyMatch.id, ref: fuzzyMatch.ref, amount });
      matchedEmpIds.add(fuzzyMatch.id);
      continue;
    }

    unmatched.push({ excelName: rawName, amount });
  }

  // Create complete updates list (all active employees must have ziz.deductionAmount set, to either amount or 0)
  const updates: { ref: admin.firestore.DocumentReference; amount: number; name: string }[] = [];
  
  matched.forEach(m => {
    updates.push({ ref: m.ref, amount: m.amount, name: m.dbName });
  });

  employees.forEach(emp => {
    if (!matchedEmpIds.has(emp.id)) {
      updates.push({ ref: emp.ref, amount: 0, name: emp.name });
    }
  });

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`  MATCHING SUMMARY`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Total Rows in Excel: ${rows.length}`);
  console.log(`  Matched Active Employees: ${matched.length}`);
  console.log(`  Unmatched Excel Rows: ${unmatched.length}`);
  console.log(`  Active Employees with Rp 0 Zakat: ${employees.length - matched.length}`);
  console.log(`  Total updates to run: ${updates.length}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  if (unmatched.length > 0) {
    console.log('⚠️ UNMATCHED ROWS PREVIEW (Top 10):');
    unmatched.slice(0, 10).forEach(u => {
      console.log(`  - "${u.excelName}": Rp ${u.amount.toLocaleString('id-ID')}`);
    });
    console.log('');
  }

  const isCommit = process.argv.includes('--commit');
  if (!isCommit) {
    console.log('✨ Dry run complete! Review the matches above.');
    console.log('👉 To write these updates to Firestore, run with the --commit flag:');
    console.log('   npx tsx scripts/migrateZakatDeductions.ts --commit\n');
    return;
  }

  console.log('🔥 Committing updates to Firestore...');
  const batchSize = 400;
  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = db.batch();
    const chunk = updates.slice(i, i + batchSize);
    
    chunk.forEach(up => {
      batch.update(up.ref, {
        'ziz.deductionAmount': up.amount,
        'audit.updatedAt': admin.firestore.FieldValue.serverTimestamp()
      });
    });

    await batch.commit();
    console.log(`✅ Committed batch of ${chunk.length} updates.`);
  }

  console.log(`\n🎉 Success! Migrated Zakat Infaq Sodaqoh deductions for all active Loyalis employees.`);
}

migrateZakat().catch(console.error);
