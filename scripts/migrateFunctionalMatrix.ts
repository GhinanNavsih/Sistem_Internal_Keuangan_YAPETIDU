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
const COLLECTION = 'SalaryMatrix_Functional';

async function migrateFunctionalMatrix() {
  const filePath = path.resolve(process.cwd(), 'Matrix_Tunjangan_Fungsional.xlsx');

  if (!fs.existsSync(filePath)) {
    console.error(`❌ Excel file not found at: ${filePath}`);
    process.exit(1);
  }

  console.log('📄 Reading Functional Matrix Excel file...');
  const workbook = xlsx.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  // Read as array of arrays
  const data = xlsx.utils.sheet_to_json<any[]>(sheet, { header: 1 });
  const cleanData = data.filter(row => row && row.length > 0 && row.some(cell => cell !== null && cell !== ''));

  const activeVersion = '2026_v1';
  const batch = db.batch();

  // 1. _config document — active version
  const configRef = db.collection(COLLECTION).doc('_config');
  batch.set(configRef, { activeVersion }, { merge: true });

  // 2. Version metadata document
  const versionDocRef = db.collection(COLLECTION).doc(activeVersion);
  batch.set(versionDocRef, {
    metadata: {
      name: 'Functional Allowance Matrix',
      description: 'Master functional allowance matrix matching education_level and functional_tier for Loyalis staff',
      sourceFile: 'Matrix_Tunjangan_Fungsional.xlsx',
      effectiveDate: admin.firestore.FieldValue.serverTimestamp(),
      version: activeVersion,
      isActive: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
  }, { merge: true });

  // 3. Row documents in "rows" subcollection — one per education level
  let rowCount = 0;
  
  // Rows index 0 and 1 are headers. Data starts at index 2.
  const dataRows = cleanData.slice(2);

  for (const row of dataRows) {
    if (!row || row.length < 2) continue;

    const educationLevel = String(row[0] || '').trim();
    if (!educationLevel || educationLevel === 'null') continue;

    const baseValue = Number(row[1]) || 0;
    const functionalTiers: Record<string, number> = {};

    let isValid = true;
    for (let i = 1; i <= 16; i++) {
      const val = Number(row[i + 1]) || 0;
      functionalTiers[String(i)] = val;
    }

    // Doc ID is cleaned/sanitized name of education level
    const docId = educationLevel.replace(/[\/\s\.]+/g, '_');
    const rowDocRef = versionDocRef.collection('rows').doc(docId);
    
    batch.set(rowDocRef, {
      education_level: educationLevel,
      base_value: baseValue,
      functional_tiers: functionalTiers,
      isActive: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    rowCount++;
    console.log(`Parsed row: ${educationLevel} -> base: ${baseValue}, tiers: ${Object.keys(functionalTiers).length} slots`);
  }

  console.log(`\n🔥 Committing ${rowCount} rows to Firestore...`);
  try {
    await batch.commit();
    console.log('\n✅ Functional matrix seeded successfully!');
    console.log('───────────────────────────────────────────');
    console.log(`   Collection:    ${COLLECTION}`);
    console.log(`   Version:       ${activeVersion}`);
    console.log(`   Rows written:  ${rowCount}`);
    console.log('───────────────────────────────────────────');
  } catch (error) {
    console.error('❌ Failed to commit functional matrix:', error);
    process.exit(1);
  }
}

migrateFunctionalMatrix().catch(console.error);
