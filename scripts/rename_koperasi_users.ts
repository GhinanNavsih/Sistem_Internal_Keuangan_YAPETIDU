import * as admin from 'firebase-admin';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection as clientCollection, getDocs as clientGetDocs, doc as clientDoc, updateDoc as clientUpdateDoc } from 'firebase/firestore';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Clean name normalization matching logic copied from payrollLogic
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
    const secondaryApp = initializeApp(secondaryConfig, 'secondary');
    const secondaryDb = getFirestore(secondaryApp);

    console.log('Fetching internal employees from primary DB (via Admin)...');
    const [loyalisSnap, blueCollarSnap] = await Promise.all([
      adminDb.collection('Employees_Loyalis').get(),
      adminDb.collection('Employees_BlueCollar').get(),
    ]);

    const employees: any[] = [];

    loyalisSnap.forEach(docSnap => {
      const data = docSnap.data();
      const name = data.personal_info?.name || '';
      if (name) {
        employees.push({
          id: docSnap.id,
          name,
          normalizedName: normalizeName(name),
          collection: 'Employees_Loyalis',
          koperasiAuthUid: data.koperasiAuthUid || null,
        });
      }
    });

    blueCollarSnap.forEach(docSnap => {
      const data = docSnap.data();
      const name = data.name || '';
      if (name) {
        employees.push({
          id: docSnap.id,
          name,
          normalizedName: normalizeName(name),
          collection: 'Employees_BlueCollar',
          koperasiAuthUid: data.koperasiAuthUid || null,
        });
      }
    });

    console.log('Fetching Koperasi users and loans...');
    const [usersSnap, loansSnap] = await Promise.all([
      clientGetDocs(clientCollection(secondaryDb, 'users')),
      clientGetDocs(clientCollection(secondaryDb, 'simpanPinjam')),
    ]);

    console.log(`\nDatabase Status:`);
    console.log(`- ${employees.length} internal employees loaded.`);
    console.log(`- ${usersSnap.size} Koperasi users loaded.`);
    console.log(`- ${loansSnap.size} Koperasi loans loaded.`);
    
    // Create quick lookup mappings for users
    const kopUsersList = usersSnap.docs.map(d => ({
      id: d.id,
      ...d.data()
    })) as any[];

    console.log(`\n1. Scanning and updating Koperasi Profile Names...`);
    let updateUsersCount = 0;

    for (const userDoc of usersSnap.docs) {
      const userData = userDoc.data();
      const userId = userDoc.id; // Koperasi user doc ID
      const userUid = userData.uid || userId;
      const originalName = userData.nama || '';

      if (!originalName) continue;

      // Try to find matching employee
      let matchedEmployee = employees.find(emp => emp.koperasiAuthUid && (emp.koperasiAuthUid === userUid || emp.koperasiAuthUid === userId));

      if (!matchedEmployee) {
        const normalizedName = normalizeName(originalName);
        matchedEmployee = employees.find(emp => emp.normalizedName === normalizedName);
      }

      if (!matchedEmployee) {
        const overrideName = MANUAL_OVERRIDES[originalName.trim()];
        if (overrideName) {
          matchedEmployee = employees.find(emp => emp.name === overrideName);
        }
      }

      if (matchedEmployee) {
        const targetName = matchedEmployee.name;

        if (originalName !== targetName) {
          console.log(`Renaming User Profile: "${originalName}" -> "${targetName}" (Doc ID: ${userId})`);
          const userRef = clientDoc(secondaryDb, 'users', userId);
          await clientUpdateDoc(userRef, { nama: targetName });
          updateUsersCount++;
        }
      }
    }

    console.log(`\n2. Scanning and updating Koperasi Loan Borrower Names...`);
    let updateLoansCount = 0;

    for (const loanDoc of loansSnap.docs) {
      const loanData = loanDoc.data();
      const loanId = loanDoc.id;
      const originalBorrowerName = loanData.userData?.namaLengkap || '';
      const loanUserId = loanData.userId;

      if (!originalBorrowerName) continue;

      // Find matching employee using the loan's userId or borrower name
      let matchedEmployee = employees.find(emp => emp.koperasiAuthUid && emp.koperasiAuthUid === loanUserId);

      // Or find matching Koperasi User first to map to employee
      if (!matchedEmployee && loanUserId) {
        const kopUser = kopUsersList.find(u => u.uid === loanUserId || u.id === loanUserId);
        if (kopUser && kopUser.nama) {
          const normalizedKopName = normalizeName(kopUser.nama);
          matchedEmployee = employees.find(emp => emp.normalizedName === normalizedKopName);
          
          if (!matchedEmployee) {
            const overrideName = MANUAL_OVERRIDES[kopUser.nama.trim()];
            if (overrideName) {
              matchedEmployee = employees.find(emp => emp.name === overrideName);
            }
          }
        }
      }

      // Or fallback directly matching borrower name from loan document
      if (!matchedEmployee) {
        const normalizedName = normalizeName(originalBorrowerName);
        matchedEmployee = employees.find(emp => emp.normalizedName === normalizedName);
      }

      if (!matchedEmployee) {
        const overrideName = MANUAL_OVERRIDES[originalBorrowerName.trim()];
        if (overrideName) {
          matchedEmployee = employees.find(emp => emp.name === overrideName);
        }
      }

      if (matchedEmployee) {
        const targetName = matchedEmployee.name;

        if (originalBorrowerName !== targetName) {
          console.log(`Updating Loan Borrower: "${originalBorrowerName}" -> "${targetName}" (Loan ID: ${loanId})`);
          const loanRef = clientDoc(secondaryDb, 'simpanPinjam', loanId);
          
          const newUserData = {
            ...(loanData.userData || {}),
            namaLengkap: targetName
          };

          await clientUpdateDoc(loanRef, { userData: newUserData });
          updateLoansCount++;
        }
      }
    }

    console.log(`\nMigration completed!`);
    console.log(`Updated ${updateUsersCount} Koperasi user profile documents.`);
    console.log(`Updated ${updateLoansCount} Koperasi loan documents.`);
    process.exit(0);
  } catch (err) {
    console.error('Error running rename migration:', err);
    process.exit(1);
  }
}

run();
