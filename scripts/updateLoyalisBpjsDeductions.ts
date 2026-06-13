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

// Anchored DEGREE_PATTERN (ends with $)
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

async function updateBpjsDeductions() {
  const excelPath = path.resolve(process.cwd(), 'Potongan BPJS.xlsx');
  const workbook = XLSX.readFile(excelPath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet) as ExcelRow[];

  console.log(`📊 Loaded ${rows.length} rows from Excel.`);

  const loyalisSnap = await db.collection('Employees_Loyalis')
    .where('personal_info.status', '==', 'AKTIF')
    .get();

  console.log(`👥 Found ${loyalisSnap.size} active Loyalis employees in Firestore.`);

  const dbEmployees = loyalisSnap.docs.map(doc => ({
    id: doc.id,
    ref: doc.ref,
    name: doc.data().personal_info?.name || '',
    normalizedName: normalizeName(doc.data().personal_info?.name || ''),
  }));

  const matchedIds = new Set<string>();
  const updates: { ref: admin.firestore.DocumentReference; amount: number; name: string }[] = [];

  // Match and prepare updates for Excel items
  for (const row of rows) {
    const rawName = row.NAMA || '';
    const cleanRaw = rawName.trim();
    
    let lookupName = cleanRaw;
    if (MANUAL_OVERRIDES[cleanRaw]) {
      lookupName = MANUAL_OVERRIDES[cleanRaw];
    }

    const normLookup = normalizeName(lookupName);

    // 1. Exact lookup
    let found = dbEmployees.find(emp => emp.name.toLowerCase().trim() === lookupName.toLowerCase());
    if (found) {
      matchedIds.add(found.id);
      updates.push({ ref: found.ref, amount: row.POTONGAN, name: found.name });
      continue;
    }

    // 2. Normalized lookup
    found = dbEmployees.find(emp => emp.normalizedName === normLookup);
    if (found) {
      matchedIds.add(found.id);
      updates.push({ ref: found.ref, amount: row.POTONGAN, name: found.name });
      continue;
    }

    // 3. Fuzzy lookup (min length 3)
    if (normLookup.length >= 3) {
      found = dbEmployees.find(emp => emp.normalizedName.length >= 3 && 
                               (emp.normalizedName.includes(normLookup) || normLookup.includes(emp.normalizedName)));
      if (found) {
        matchedIds.add(found.id);
        updates.push({ ref: found.ref, amount: row.POTONGAN, name: found.name });
        continue;
      }
    }
  }

  // Find 11 missing employees and prepare updates to set their BPJS deductions to 0
  const missing = dbEmployees.filter(emp => !matchedIds.has(emp.id));
  missing.forEach(emp => {
    updates.push({ ref: emp.ref, amount: 0, name: emp.name });
  });

  console.log(`\n⚙️ Preparing to update Firestore database:`);
  console.log(`- Matched employees (will get Excel deduction values): ${matchedIds.size}`);
  console.log(`- Missing employees (will get Rp 0 deduction): ${missing.length}`);
  console.log(`- Total updates: ${updates.length}`);

  // Write changes in batches
  const batchSize = 400;
  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = db.batch();
    const chunk = updates.slice(i, i + batchSize);
    
    chunk.forEach(up => {
      batch.update(up.ref, {
        'bpjs.deductionAmount': up.amount,
        'audit.updatedAt': admin.firestore.FieldValue.serverTimestamp()
      });
    });

    await batch.commit();
    console.log(`✅ Committed batch of ${chunk.length} updates.`);
  }

  console.log(`\n🎉 Success! Updated BPJS deductions for all active Loyalis employees.`);
}

updateBpjsDeductions().catch(console.error);
