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
  const filePath = path.resolve(process.cwd(), 'Tunjangan Struktural Jabatan.xlsx');
  const workbook = xlsx.readFile(filePath);
  const sheet = workbook.Sheets['Sheet1'];
  const rows = xlsx.utils.sheet_to_json<any[]>(sheet, { header: 1 });

  // Columns: 0: Nama Jabatan, 1: Tunj Jabatan, 2: Satker, 3: Nama Loyalis
  const rawEntries: any[] = [];
  rows.slice(1).forEach((row, idx) => {
    if (!row || row.length === 0) return;
    const nameVal = row[3];
    const jabatanVal = row[0];
    const tunjVal = row[1];
    const satkerVal = row[2];

    if (!nameVal || String(nameVal).trim() === '') return;
    
    rawEntries.push({
      excelName: String(nameVal).trim(),
      jabatanName: String(jabatanVal).trim(),
      allowance: Number(tunjVal) || 0,
      satker: satkerVal ? String(satkerVal).trim() : ''
    });
  });

  console.log(`Extracted ${rawEntries.length} valid rows from Excel.`);

  // Group by Excel employee name
  const groupedByExcelName: Record<string, any[]> = {};
  rawEntries.forEach(entry => {
    if (!groupedByExcelName[entry.excelName]) {
      groupedByExcelName[entry.excelName] = [];
    }
    groupedByExcelName[entry.excelName].push(entry);
  });

  const updatesList: { id: string; name: string; structural_positions: any[] }[] = [];

  for (const [excelName, positions] of Object.entries(groupedByExcelName)) {
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
      const mappedPositions = positions.map(pos => ({
        name: pos.jabatanName,
        allowance: pos.allowance,
        satker: pos.satker
      }));

      updatesList.push({
        id: matchedEmp.id,
        name: matchedEmp.name,
        structural_positions: mappedPositions
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
      console.log('Structural Positions:', JSON.stringify(upd.structural_positions, null, 2));
    });
    console.log('\n👉 To commit these changes to Firestore, run:');
    console.log('   npx tsx scripts/migrateStructuralAllowances.ts --commit');
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
        'employment_profile.structural_positions': upd.structural_positions,
        'employment_profile.structural_position': admin.firestore.FieldValue.delete()
      });
    });

    await batch.commit();
    console.log(`   [Batch ${c + 1}/${chunks.length}] Wrote ${chunk.length} updates...`);
  }

  console.log('\n✅ Migration completed successfully!');
}

run().catch(console.error);
