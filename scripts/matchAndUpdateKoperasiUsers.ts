import * as admin from 'firebase-admin';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// ─── Initialize Firebase Admin for Internal-BAK ───
const serviceAccountPath = path.resolve(process.cwd(), 'service-account.json');

if (!admin.apps.length) {
  if (fs.existsSync(serviceAccountPath)) {
    console.log('Using service-account.json for Internal-BAK...');
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
const dbInternal = admin.firestore();

// ─── Initialize Firebase Client for Koperasi Unipdu ───
const secondaryConfig = {
  apiKey: "AIzaSyB_sA0peKgiDudDGks0RNlwq6cB0IOer1M",
  authDomain: "koperasi-unipdu.firebaseapp.com",
  projectId: "koperasi-unipdu",
  storageBucket: "koperasi-unipdu.firebasestorage.app",
  messagingSenderId: "10094241377",
  appId: "1:10094241377:web:1b11e23f8479306733ec20"
};

const appKoperasi = initializeApp(secondaryConfig);
const dbKoperasi = getFirestore(appKoperasi);

// ─── Name Normalization ───
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
  
  // User confirmed manual overrides:
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

  // Newly identified matches:
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
  'Mujianto Solichin': 'Dr. Mujianto Sholichin, M. PdI.',
  'Siti Roudhotul Jannah ': 'Siti Roudhatul Jannah, SST.Keb. M. Tr. Keb.',
  'Siti Roudhotul Jannah': 'Siti Roudhatul Jannah, SST.Keb. M. Tr. Keb.',
};

async function main() {
  console.log('Fetching internal employees...');
  const [loyalisSnap, blueCollarSnap] = await Promise.all([
    dbInternal.collection('Employees_Loyalis').get(),
    dbInternal.collection('Employees_BlueCollar').get(),
  ]);

  interface Employee {
    id: string;
    originalName: string;
    normalizedName: string;
    collection: string;
  }

  const internalEmployees: Employee[] = [];

  loyalisSnap.docs.forEach(doc => {
    const data = doc.data();
    const name = data.personal_info?.name || '';
    if (name) {
      internalEmployees.push({
        id: doc.id,
        originalName: name,
        normalizedName: normalizeName(name),
        collection: 'Employees_Loyalis',
      });
    }
  });

  blueCollarSnap.docs.forEach(doc => {
    const data = doc.data();
    const name = data.name || '';
    if (name) {
      internalEmployees.push({
        id: doc.id,
        originalName: name,
        normalizedName: normalizeName(name),
        collection: 'Employees_BlueCollar',
      });
    }
  });

  console.log(`Fetched ${internalEmployees.length} internal employees.\n`);

  // 2. Fetch Koperasi users collection
  console.log('Fetching Koperasi users...');
  const userSnapshot = await getDocs(collection(dbKoperasi, 'users'));
  console.log(`Fetched ${userSnapshot.size} users from Koperasi.\n`);

  const matched: any[] = [];
  const unmatched: any[] = [];

  // 3. Perform matching
  userSnapshot.docs.forEach(docSnap => {
    const userData = docSnap.data();
    const currentName = userData.nama || '';
    if (!currentName) return;

    const normalizedSP = normalizeName(currentName);

    // Try exact normalized match
    let match = internalEmployees.find(emp => emp.normalizedName === normalizedSP);

    // Try manual override
    const overrideName = MANUAL_OVERRIDES[currentName.trim()];
    if (overrideName) {
      const overrideMatch = internalEmployees.find(emp => emp.originalName === overrideName);
      if (overrideMatch) {
        match = overrideMatch;
      }
    }

    if (match) {
      matched.push({
        koperasiDocId: docSnap.id,
        koperasiName: currentName,
        internalName: match.originalName,
        internalDocId: match.id,
        internalCollection: match.collection,
        normalizedKey: normalizedSP,
        needsUpdate: currentName !== match.originalName,
      });
    } else {
      unmatched.push({
        koperasiDocId: docSnap.id,
        koperasiName: currentName,
        normalizedKey: normalizedSP,
      });
    }
  });

  // 4. Write to JSON file
  const outputPath = path.join(process.cwd(), 'koperasi_users_name_matching.json');
  const output = {
    generatedAt: new Date().toISOString(),
    summary: {
      totalKoperasiUsers: userSnapshot.size,
      matched: matched.length,
      unmatched: unmatched.length,
      matchedToUpdate: matched.filter(m => m.needsUpdate).length,
      matchedUnchanged: matched.filter(m => !m.needsUpdate).length,
    },
    matched: matched.sort((a, b) => a.koperasiName.localeCompare(b.koperasiName)),
    unmatched: unmatched.sort((a, b) => a.koperasiName.localeCompare(b.koperasiName)),
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf8');

  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  MATCH SUMMARY`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Total Koperasi Users: ${output.summary.totalKoperasiUsers}`);
  console.log(`  Matched (Ready to update): ${output.summary.matchedToUpdate}`);
  console.log(`  Matched (Already identical): ${output.summary.matchedUnchanged}`);
  console.log(`  Unmatched: ${output.summary.unmatched}`);
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log(`✅ Results exported for review to: ${outputPath}`);

  // 5. Commit updates if requested
  const isCommit = process.argv.includes('--commit');
  if (isCommit) {
    const toUpdate = matched.filter(m => m.needsUpdate);
    console.log(`\nStarting updates of ${toUpdate.length} documents in Koperasi 'users' collection...`);
    let count = 0;
    for (const item of toUpdate) {
      try {
        const userDocRef = doc(dbKoperasi, 'users', item.koperasiDocId);
        await updateDoc(userDocRef, {
          nama: item.internalName,
          updatedAt: new Date(),
        });
        console.log(`[${++count}/${toUpdate.length}] Updated doc "${item.koperasiDocId}": "${item.koperasiName}" → "${item.internalName}"`);
      } catch (err) {
        console.error(`Failed to update doc "${item.koperasiDocId}":`, err);
      }
    }
    console.log('\nAll updates completed successfully!');
  } else {
    console.log('To write changes to the Koperasi database, run the script with --commit flag:');
    console.log('  npx tsx scripts/matchAndUpdateKoperasiUsers.ts --commit');
  }
}

main().then(() => process.exit(0)).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
