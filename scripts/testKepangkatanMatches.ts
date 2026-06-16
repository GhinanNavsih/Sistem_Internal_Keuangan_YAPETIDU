import './initEnv';
import * as admin from 'firebase-admin';
import * as xlsx from 'xlsx';
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

async function run() {
  // 1. Fetch Loyalis employees from DB
  const empSnap = await db.collection('Employees_Loyalis').get();
  const dbEmployees = empSnap.docs.map(doc => ({
    id: doc.id,
    name: doc.data().personal_info?.name || doc.data().name || '',
    normalized: normalizeName(doc.data().personal_info?.name || doc.data().name || '')
  }));

  console.log(`Loaded ${dbEmployees.length} employees from database.`);

  // 2. Read Excel file
  const filePath = path.resolve(process.cwd(), 'Tunjangan Kepangkatan.xlsx');
  const workbook = xlsx.readFile(filePath);
  const sheet = workbook.Sheets['Sheet1'];
  const rows = xlsx.utils.sheet_to_json<any>(sheet);

  console.log(`Loaded ${rows.length} rows from Excel.`);

  let matchedCount = 0;
  let unmatchedCount = 0;

  for (const row of rows) {
    const excelName = row['NAMA'];
    if (!excelName) continue;

    const cleanExcel = normalizeName(excelName);
    let matchedEmp = dbEmployees.find(emp => emp.normalized === cleanExcel);
    
    if (!matchedEmp) {
      const overridden = MANUAL_OVERRIDES[excelName.trim()];
      if (overridden) {
        matchedEmp = dbEmployees.find(emp => emp.normalized === normalizeName(overridden));
      }
    }
    
    if (!matchedEmp) {
      matchedEmp = dbEmployees.find(emp => emp.normalized.includes(cleanExcel) || cleanExcel.includes(emp.normalized));
    }

    if (matchedEmp) {
      matchedCount++;
    } else {
      unmatchedCount++;
      console.log(`❌ UNMATCHED: "${excelName}" (Normalized: "${cleanExcel}")`);
    }
  }

  console.log(`\nSummary: Matched ${matchedCount}/${rows.length}, Unmatched ${unmatchedCount}`);
}

run().catch(console.error);
