import * as admin from 'firebase-admin';
import * as xlsx from 'xlsx';
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Initialize Firebase Admin
const serviceAccountPath = path.resolve(process.cwd(), 'service-account.json');

if (!admin.apps.length) {
  if (fs.existsSync(serviceAccountPath)) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccountPath),
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'internal-bak',
    });
  } else {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'internal-bak',
    });
  }
}

const db = admin.firestore();

async function main() {
  const filePath = path.resolve(process.cwd(), 'Pegawai + Email.xlsx');
  if (!fs.existsSync(filePath)) {
    console.error('Excel file not found!');
    return;
  }
  
  const workbook = xlsx.readFile(filePath);
  const sheet = workbook.Sheets['White Collar Loyalis'];
  const excelData: any[] = xlsx.utils.sheet_to_json(sheet);
  
  console.log('Fetching Firestore Employees_Loyalis...');
  const snapshot = await db.collection('Employees_Loyalis').get();
  
  const dbMap = new Map<string, any>();
  snapshot.forEach(doc => {
    dbMap.set(doc.id, {
      id: doc.id,
      name: doc.data().personal_info?.name || doc.data().name || '',
      data: doc.data()
    });
  });
  
  console.log(`Firestore has ${dbMap.size} Loyalis records.`);
  console.log(`Excel file has ${excelData.length} rows.`);
  
  const matchingById: any[] = [];
  const idMismatches: any[] = [];
  const nameMismatches: any[] = [];
  
  excelData.forEach(row => {
    const excelId = row['ID Pegawai'];
    const excelName = row['Nama Lengkap'];
    
    if (!excelId) {
      console.log(`Row without ID: ${excelName}`);
      return;
    }
    
    const dbRecord = dbMap.get(excelId);
    if (!dbRecord) {
      idMismatches.push({
        excelId,
        excelName,
        reason: 'ID not found in Firestore'
      });
    } else {
      const dbName = dbRecord.name;
      const cleanExcelName = String(excelName).trim().toLowerCase();
      const cleanDbName = String(dbName).trim().toLowerCase();
      
      const isNameMatch = cleanExcelName === cleanDbName;
      if (isNameMatch) {
        matchingById.push({
          id: excelId,
          excelName,
          dbName,
          matchType: 'exact_id_and_name'
        });
      } else {
        nameMismatches.push({
          id: excelId,
          excelName,
          dbName,
          reason: 'Name mismatch for same ID'
        });
      }
    }
  });
  
  console.log(`\nExact ID & Name Matches: ${matchingById.length}`);
  console.log(`ID Mismatches (Excel ID not in DB): ${idMismatches.length}`);
  console.log(`Name Mismatches (ID matches, but names differ): ${nameMismatches.length}`);
  
  if (idMismatches.length > 0) {
    console.log('\n--- ID Mismatches (Top 10) ---');
    console.log(JSON.stringify(idMismatches.slice(0, 10), null, 2));
  }
  
  const excelIds = new Set(excelData.map(row => row['ID Pegawai']));
  const missingInExcel: any[] = [];
  dbMap.forEach((val, id) => {
    if (!excelIds.has(id)) {
      missingInExcel.push({ id, name: val.name });
    }
  });

  console.log(`\nRecords in Firestore missing from Excel: ${missingInExcel.length}`);
  if (missingInExcel.length > 0) {
    console.log(JSON.stringify(missingInExcel, null, 2));
  }
}

main().catch(console.error);
