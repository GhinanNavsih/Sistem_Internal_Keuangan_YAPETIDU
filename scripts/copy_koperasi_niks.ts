import * as admin from 'firebase-admin';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection as clientCollection, getDocs as clientGetDocs } from 'firebase/firestore';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Clean name normalization matching logic
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
  'Mujianto Solichin': 'Dr. Mujianto Sholichin, M. PdI.',
  'Siti Roudhotul Jannah ': 'Siti Roudhatul Jannah, SST.Keb. M. Tr. Keb.',
  'Siti Roudhotul Jannah': 'Siti Roudhatul Jannah, SST.Keb. M. Tr. Keb.',
};

const secondaryConfig = {
  apiKey: "AIzaSyB_sA0peKgiDudDGks0RNlwq6cB0IOer1M",
  authDomain: "koperasi-unipdu.firebaseapp.com",
  projectId: "koperasi-unipdu",
  storageBucket: "koperasi-unipdu.firebasestorage.app",
  messagingSenderId: "10094241377",
  appId: "1:10094241377:web:1b11e23f8479306733ec20"
};

async function run() {
  try {
    console.log('Initializing Firebase Admin for primary database...');
    const serviceAccountPath = path.resolve(process.cwd(), 'service-account.json');
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccountPath),
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    });
    const adminDb = admin.firestore();

    console.log('Initializing Firebase Client for secondary database...');
    const secondaryApp = initializeApp(secondaryConfig, 'secondary_nik');
    const secondaryDb = getFirestore(secondaryApp);

    console.log('Fetching internal employees from primary DB (via Admin)...');
    const [loyalisSnap, blueCollarSnap] = await Promise.all([
      adminDb.collection('Employees_Loyalis').get(),
      adminDb.collection('Employees_BlueCollar').get(),
    ]);

    const employees: any[] = [];

    loyalisSnap.forEach(docSnap => {
      const data = docSnap.data();
      employees.push({
        id: docSnap.id,
        name: data.personal_info?.name || '',
        nik: data.personal_info?.nik || '',
        normalizedName: normalizeName(data.personal_info?.name || ''),
        collection: 'Employees_Loyalis',
        koperasiAuthUid: data.koperasiAuthUid || null,
      });
    });

    blueCollarSnap.forEach(docSnap => {
      const data = docSnap.data();
      employees.push({
        id: docSnap.id,
        name: data.name || '',
        nik: data.nik || '',
        normalizedName: normalizeName(data.name || ''),
        collection: 'Employees_BlueCollar',
        koperasiAuthUid: data.koperasiAuthUid || null,
      });
    });

    console.log('Fetching Koperasi users and loans...');
    const [usersSnap, loansSnap] = await Promise.all([
      clientGetDocs(clientCollection(secondaryDb, 'users')),
      clientGetDocs(clientCollection(secondaryDb, 'simpanPinjam')),
    ]);

    const kopUsers = usersSnap.docs.map(docSnap => ({
      id: docSnap.id,
      ...docSnap.data()
    })) as any[];

    const kopLoans = loansSnap.docs.map(docSnap => docSnap.data()) as any[];

    console.log(`\nDatabase Status:`);
    console.log(`- ${employees.length} internal employees loaded.`);
    console.log(`- ${kopUsers.length} Koperasi users loaded.`);
    console.log(`- ${kopLoans.length} Koperasi loans loaded.`);
    console.log(`\nScanning for missing NIK values...`);

    let copiedNiksCount = 0;

    for (const emp of employees) {
      // Check if employee's NIK is missing (empty, whitespace, or placeholder dashes)
      const currentNikClean = emp.nik ? emp.nik.trim() : '';
      const isMissingNik = !currentNikClean || currentNikClean === '-' || currentNikClean.length < 10;

      if (isMissingNik) {
        // Find matching Koperasi user to extract NIK
        let matchedKopUser = kopUsers.find(u => emp.koperasiAuthUid && (u.uid === emp.koperasiAuthUid || u.id === emp.koperasiAuthUid));

        if (!matchedKopUser) {
          matchedKopUser = kopUsers.find(u => u.nama && normalizeName(u.nama) === emp.normalizedName);
        }

        if (!matchedKopUser) {
          const overrideName = MANUAL_OVERRIDES[emp.name.trim()];
          if (overrideName) {
            matchedKopUser = kopUsers.find(u => u.nama && normalizeName(u.nama) === normalizeName(overrideName));
          }
        }

        let koperasiNik = matchedKopUser?.nik || '';

        // Fallback: search loan documents if the Koperasi user profile doesn't have NIK
        if (!koperasiNik && matchedKopUser) {
          const matchedLoan = kopLoans.find(l => l.userId === (matchedKopUser.uid || matchedKopUser.id) && l.userData?.nik);
          koperasiNik = matchedLoan?.userData?.nik || '';
        }

        // Clean and validate copied NIK
        const koperasiNikClean = koperasiNik ? koperasiNik.trim() : '';
        if (koperasiNikClean && koperasiNikClean !== '-' && koperasiNikClean.length >= 10) {
          console.log(`Copying NIK for "${emp.name}" (${emp.collection}): Koperasi NIK "${koperasiNikClean}"`);

          if (emp.collection === 'Employees_Loyalis') {
            await adminDb.collection('Employees_Loyalis').doc(emp.id).update({
              'personal_info.nik': koperasiNikClean
            });
          } else {
            await adminDb.collection('Employees_BlueCollar').doc(emp.id).update({
              nik: koperasiNikClean
            });
          }
          copiedNiksCount++;
        }
      }
    }

    console.log(`\nNIK Sync Migration completed!`);
    console.log(`Successfully copied ${copiedNiksCount} NIK values from Koperasi into primary Employee documents.`);
    process.exit(0);
  } catch (err) {
    console.error('Error running NIK migration:', err);
    process.exit(1);
  }
}

run();
