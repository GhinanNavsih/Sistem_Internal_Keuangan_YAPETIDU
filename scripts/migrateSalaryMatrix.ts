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
    console.log('Using local service-account.json for authentication...');
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccountPath),
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'internal-bak',
    });
  } else {
    console.log('No local service-account.json found. Falling back to default credentials...');
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'internal-bak',
    });
  }
}

const db = admin.firestore();

async function migrateSalaryMatrix() {
  const filePath = path.resolve(process.cwd(), 'Penentuan Nominal Gaji Pokok.xlsx');
  
  if (!fs.existsSync(filePath)) {
    console.error(`Excel file not found at: ${filePath}`);
    process.exit(1);
  }

  console.log('Reading Excel file...');
  const workbook = xlsx.readFile(filePath);
  const sheetName = workbook.SheetNames[0]; // Sheet1
  const sheet = workbook.Sheets[sheetName];
  
  // Read sheet as an array of arrays
  const data = xlsx.utils.sheet_to_json<any[]>(sheet, { header: 1 });
  
  const headers = data[1]; // Expected to be ['Bulan', 'Tahun', 'A', 'B', ...]
  const expectedGradeCodes = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R'];
  
  // Validate headers
  const gradeCodesInFile = headers.slice(2);
  const isHeadersValid = expectedGradeCodes.every((code) => gradeCodesInFile.includes(code));
  
  if (!isHeadersValid) {
    console.error('Validation failed: Missing grade columns A through R.');
    process.exit(1);
  }

  const rowsData = data.slice(2); // Skip the first 2 header rows
  const gradeCodes = gradeCodesInFile.map(String);
  
  const batch = db.batch();
  
  const activeVersion = "2026_v1";
  
  // SalaryMatrix/_config
  const configRef = db.collection('SalaryMatrix').doc('_config');
  batch.set(configRef, {
    activeVersion: activeVersion
  }, { merge: true });

  // SalaryMatrix/2026_v1
  const versionDocRef = db.collection('SalaryMatrix').doc(activeVersion);
  
  console.log('Preparing metadata...');
  batch.set(versionDocRef, {
    metadata: {
      name: 'Penentuan Nominal Gaji Pokok',
      description: 'Master matrix for determining UNIPDU employee base wage',
      sourceFile: 'Penentuan Nominal Gaji Pokok.xlsx',
      gradeCodes: gradeCodes,
      effectiveDate: admin.firestore.FieldValue.serverTimestamp(),
      version: activeVersion,
      isActive: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }
  }, { merge: true });

  let rowCount = 0;
  
  for (const row of rowsData) {
    if (!row || row.length < 2) continue;
    
    const bulan = Number(row[0]);
    const tahun = Number(row[1]);
    
    if (isNaN(bulan) || isNaN(tahun)) {
      continue;
    }

    const salaries: Record<string, number> = {};
    let isValidRow = true;

    for (let i = 0; i < gradeCodes.length; i++) {
      const grade = gradeCodes[i];
      const salaryValue = Number(row[i + 2]);
      
      if (isNaN(salaryValue)) {
        isValidRow = false;
        break;
      }
      salaries[grade] = salaryValue;
    }
    
    if (!isValidRow) continue;

    // Subcollection: rows -> year_${tahun}
    const rowDocRef = versionDocRef.collection('rows').doc(`year_${tahun}`);
    batch.set(rowDocRef, {
      tahun,
      bulan,
      salaries,
      isActive: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    rowCount++;
  }

  console.log('Committing to Firestore...');
  try {
    await batch.commit();
    console.log('\n✅ Migration completed successfully!');
    console.log('-----------------------------------');
    console.log(`Total rows migrated: ${rowCount}`);
    console.log(`Version created: ${activeVersion}`);
    console.log(`Firestore path written: SalaryMatrix/${activeVersion}`);
  } catch (error) {
    console.error('Failed to commit batch to Firestore:', error);
  }
}

migrateSalaryMatrix().catch(console.error);
