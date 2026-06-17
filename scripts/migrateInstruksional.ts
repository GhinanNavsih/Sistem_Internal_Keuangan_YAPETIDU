import './initEnv';
import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';
import { normalizeName, MANUAL_OVERRIDES } from '../src/utils/payrollLogic';

const serviceAccountPath = path.resolve(process.cwd(), 'service-account.json');

if (!admin.apps.length) {
  if (fs.existsSync(serviceAccountPath)) {
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

const SCREENSHOT_DATA = [
  { name: "Moh. Faizal Fuad Aziz, M.Pd.", value: 300000 },
  { name: "H. Ahmad Haibat Kannaby Zaimuddin,S.I.P", value: 750000 },
  { name: "Herjanti Nursuksmaningtyas Santoso, S.S, M.Si.", value: 2000000 },
  { name: "H. Ahmad Laroibafih Zulfikar, S.H", value: 750000 },
  { name: "Ashlaha Baladina, S.I.Kom.", value: 750000 },
  { name: "Muhammad Fajrul Alam Ulin Nuha, S.Kom., M.Kom", value: 1000000 },
  { name: "Muhammad Al Himmy Rusydy, S.KM", value: 750000 },
  { name: "Royyan Amigo, S.Mat., M.Mat", value: 2000000 },
  { name: "Muhammad Ghinan Navsih, S.Si.D", value: 750000 },
  { name: "Ir. Syarif Hidayatulloh", value: 100000 },
  { name: "Nufan Balafif, S.Kom., MM", value: 100000 },
  { name: "H. Harun Ar Rasyid, S.Pd.I", value: 75000 },
  { name: "Hj. Anna Qomariana, SE, M.Pdi", value: 150000 },
  { name: "Indah Sumiyarsih, SE.", value: 125000 }
];

async function run() {
  const isCommit = process.argv.includes('--commit');
  
  // 1. Fetch Loyalis employees from DB
  const empSnap = await db.collection('Employees_Loyalis').get();
  const dbEmployees = empSnap.docs.map(doc => ({
    id: doc.id,
    name: doc.data().personal_info?.name || doc.data().name || '',
    normalized: normalizeName(doc.data().personal_info?.name || doc.data().name || '')
  }));

  const matches: any[] = [];
  const failures: string[] = [];

  for (const item of SCREENSHOT_DATA) {
    const cleanExcel = normalizeName(item.name);
    let matchedEmp = dbEmployees.find(emp => emp.normalized === cleanExcel);
    
    if (!matchedEmp) {
      const overridden = MANUAL_OVERRIDES[item.name.trim()];
      if (overridden) {
        matchedEmp = dbEmployees.find(emp => emp.normalized === normalizeName(overridden));
      }
    }
    
    if (!matchedEmp) {
      matchedEmp = dbEmployees.find(emp => emp.normalized.includes(cleanExcel) || cleanExcel.includes(emp.normalized));
    }

    if (matchedEmp) {
      matches.push({
        inputName: item.name,
        matchedName: matchedEmp.name,
        matchedId: matchedEmp.id,
        t_instruksional: item.value
      });
    } else {
      failures.push(item.name);
    }
  }

  // Output matches in clean JSON format
  console.log("=== MATCHING RESULT JSON ===");
  console.log(JSON.stringify(matches, null, 2));
  console.log("============================");

  if (failures.length > 0) {
    console.error("❌ FAILED TO MATCH:", failures);
    return;
  }

  console.log(`\nSuccessfully matched ${matches.length}/${SCREENSHOT_DATA.length} employees.`);

  if (!isCommit) {
    console.log('\n👉 This was a dry run. To execute this update in Firestore, run:');
    console.log('   npx tsx scripts/migrateInstruksional.ts --commit');
    return;
  }

  console.log('\n🔥 Committing updates to Firestore...');
  const batch = db.batch();
  for (const m of matches) {
    const docRef = db.collection('Employees_Loyalis').doc(m.matchedId);
    batch.update(docRef, {
      t_instruksional: m.t_instruksional
    });
  }

  await batch.commit();
  console.log('✅ Migration committed successfully!');
}

run().catch(console.error);
