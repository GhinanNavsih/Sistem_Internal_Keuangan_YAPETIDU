import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import * as xlsx from 'xlsx';

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

// Helper to normalize names for reliable matching
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '') // remove special characters, spaces, and punctuation
    .trim();
}

async function runMigration() {
  const excelPath = path.resolve(process.cwd(), 'Data_Anggota_pekarya.xlsx');
  
  if (!fs.existsSync(excelPath)) {
    console.error(`❌ Excel file not found at: ${excelPath}`);
    process.exit(1);
  }

  // 1. Read Excel file
  console.log('📖 Reading Data_Anggota_pekarya.xlsx...');
  const workbook = xlsx.readFile(excelPath);
  const sheet = workbook.Sheets['Data Anggota'];
  if (!sheet) {
    console.error('❌ Sheet "Data Anggota" not found in Excel!');
    process.exit(1);
  }
  
  const excelRows = xlsx.utils.sheet_to_json<any>(sheet);
  console.log(`Total rows in Excel sheet: ${excelRows.length}`);

  // 2. Fetch all Blue Collar employees from Firestore
  console.log('🔍 Fetching all Employees_BlueCollar documents from Firestore...');
  const snapshot = await db.collection('Employees_BlueCollar').get();
  
  interface FireEmployee {
    id: string;
    name: string;
    nik: string;
    ref: admin.firestore.DocumentReference;
  }
  
  const fireEmployees: FireEmployee[] = [];
  snapshot.forEach(doc => {
    const data = doc.data();
    fireEmployees.push({
      id: doc.id,
      name: data.name || '',
      nik: String(data.nik || '').trim(),
      ref: doc.ref
    });
  });
  console.log(`Fetched ${fireEmployees.length} blue collar employees from Firestore.`);

  // 3. Perform matching and update
  let matchedByNik = 0;
  let matchedByName = 0;
  let unmatchedCount = 0;
  let updatedCount = 0;

  console.log('\n🚀 Starting migration and updates...');
  
  for (const row of excelRows) {
    const excelName = String(row['Nama Lengkap'] || '').trim();
    const excelNik = String(row['NIK'] || '').trim();
    const excelPhone = String(row['No. Telp'] || '').trim();
    const excelEmail = String(row['Email'] || '').trim();

    if (!excelName) continue;

    let matchedEmp: FireEmployee | undefined = undefined;

    // Try NIK match first (if NIK is provided and valid)
    if (excelNik && excelNik !== '-' && excelNik !== '0') {
      matchedEmp = fireEmployees.find(emp => emp.nik === excelNik);
      if (matchedEmp) {
        matchedByNik++;
      }
    }

    // Try Name match fallback
    if (!matchedEmp) {
      const normExcelName = normalizeName(excelName);
      matchedEmp = fireEmployees.find(emp => normalizeName(emp.name) === normExcelName);
      if (matchedEmp) {
        matchedByName++;
      }
    }

    // If matched, perform the update
    if (matchedEmp) {
      const updateData: any = {};
      if (excelPhone && excelPhone !== '-') {
        updateData.phoneNumber = excelPhone;
      }
      if (excelEmail && excelEmail !== '-') {
        updateData.email = excelEmail;
      }

      if (Object.keys(updateData).length > 0) {
        await matchedEmp.ref.update(updateData);
        updatedCount++;
        console.log(`✅ MATCHED [${matchedEmp.id}] ${matchedEmp.name} -> Phone: ${excelPhone || 'N/A'}, Email: ${excelEmail || 'N/A'}`);
      }
    } else {
      unmatchedCount++;
      console.log(`⚠️ UNMATCHED EXCEL RECORD: "${excelName}" (NIK: ${excelNik || 'N/A'})`);
    }
  }

  console.log('\n📊 Migration complete!');
  console.log(`-----------------------------------`);
  console.log(`Total Excel records processed: ${excelRows.length}`);
  console.log(`Matched by NIK:                ${matchedByNik}`);
  console.log(`Matched by Name (fallback):    ${matchedByName}`);
  console.log(`Total matched employees:       ${matchedByNik + matchedByName}`);
  console.log(`Total unmatched records:       ${unmatchedCount}`);
  console.log(`Total updated in Firestore:    ${updatedCount}`);
}

runMigration().catch(console.error);
