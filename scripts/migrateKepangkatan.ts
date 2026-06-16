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
  const isCommit = process.argv.includes('--commit');
  
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

  const updatesList: { id: string; name: string; kepangkatan: { cummulativeCredit: number; t_kepangkatan: number } }[] = [];

  for (const row of rows) {
    const excelName = row['NAMA'];
    if (!excelName || String(excelName).trim() === '') continue;

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
      const credit = Number(row['ANGKA KREDIT KOMULATIF']) || 0;
      const allowance = Number(row['Tunjangan KEPANGKATAN']) || 0;

      updatesList.push({
        id: matchedEmp.id,
        name: matchedEmp.name,
        kepangkatan: {
          cummulativeCredit: credit,
          t_kepangkatan: allowance
        }
      });
    } else {
      console.error(`❌ FAILED TO MATCH: "${excelName}"`);
    }
  }

  console.log(`\nMatched ${updatesList.length} employees to update.`);

  if (!isCommit) {
    console.log('\n--- DRY RUN PREVIEW (First 5 records) ---');
    updatesList.slice(0, 5).forEach(upd => {
      console.log(`\nEmployee ID: ${upd.id} (${upd.name})`);
      console.log('Kepangkatan map:', JSON.stringify(upd.kepangkatan, null, 2));
    });
    console.log('\n👉 To commit these changes to Firestore, run:');
    console.log('   npx tsx scripts/migrateKepangkatan.ts --commit');
    return;
  }

  // Execute batch writes in chunks
  console.log('\n🔥 Committing updates to Firestore...');
  const chunkSize = 400;
  const chunks: any[][] = [];
  for (let i = 0; i < updatesList.length; i += chunkSize) {
    chunks.push(updatesList.slice(i, i + chunkSize));
  }

  for (let c = 0; c < chunks.length; c++) {
    const chunk = chunks[c];
    const batch = db.batch();
    
    chunk.forEach(upd => {
      const docRef = db.collection('Employees_Loyalis').doc(upd.id);
      batch.update(docRef, {
        kepangkatan: upd.kepangkatan
      });
    });

    await batch.commit();
    console.log(`   [Batch ${c + 1}/${chunks.length}] Wrote ${chunk.length} updates...`);
  }

  console.log('\n✅ Migration completed successfully!');
}

run().catch(console.error);
