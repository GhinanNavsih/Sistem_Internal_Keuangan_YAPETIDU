import * as admin from 'firebase-admin';
import * as xlsx from 'xlsx';
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// ─── Initialize Firebase Admin ──────────────────────────────────────────────
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

// ─── Collection name — separate from blue collar ────────────────────────────
const COLLECTION = 'SalaryMatrix_WhiteCollar';

async function seedWhiteCollarSalaryMatrix() {
  const filePath = path.resolve(process.cwd(), 'SalaryMatrix White Collar (Final).xlsx');

  if (!fs.existsSync(filePath)) {
    console.error(`❌ Excel file not found at: ${filePath}`);
    process.exit(1);
  }

  console.log('📄 Reading Excel file...');
  const workbook = xlsx.readFile(filePath);

  // Use the only sheet in the file
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  console.log(`   Using sheet: "${sheetName}"`);

  // Read as array of arrays
  const data = xlsx.utils.sheet_to_json<any[]>(sheet, { header: 1 });

  // ── Parse headers ──────────────────────────────────────────────────────────
  // Row 0: education level group labels (with nulls for spanned cells)
  // Row 1: grade codes (A, B, … Z, AA, AB, AC, AD)
  const levelRow = data[0] as (string | null)[];
  const gradeRow = data[1] as (string | null)[];

  const gradeCodes = gradeRow.slice(2).filter(Boolean) as string[];
  console.log(`   Found ${gradeCodes.length} grade codes: ${gradeCodes.join(', ')}`);

  // Build education level groupings from the merged header row
  // e.g. { "Level 1 ( SLTP,SLTA,D1,D2)": ["A","B","C","D","E","F"], ... }
  const educationLevels: Record<string, string[]> = {};
  let currentLevel: string | null = null;
  for (let col = 2; col < gradeRow.length; col++) {
    if (levelRow[col]) currentLevel = levelRow[col];
    const grade = gradeRow[col];
    if (grade && currentLevel) {
      if (!educationLevels[currentLevel]) educationLevels[currentLevel] = [];
      educationLevels[currentLevel].push(grade);
    }
  }
  console.log('   Education level groups:');
  for (const [level, grades] of Object.entries(educationLevels)) {
    console.log(`     ${level}: ${grades.join(', ')}`);
  }

  // ── Validate grade codes ───────────────────────────────────────────────────
  const expectedGradeCodes = [
    'A', 'B', 'C', 'D', 'E', 'F',
    'G', 'H', 'I', 'J', 'K', 'L',
    'M', 'N', 'O', 'P', 'Q', 'R',
    'S', 'T', 'U', 'V', 'W', 'X',
    'Y', 'Z', 'AA', 'AB', 'AC', 'AD',
  ];
  const missing = expectedGradeCodes.filter(c => !gradeCodes.includes(c));
  if (missing.length > 0) {
    console.error(`❌ Missing grade columns: ${missing.join(', ')}`);
    process.exit(1);
  }
  console.log('   ✔ All expected grade codes present');

  // ── Parse data rows ────────────────────────────────────────────────────────
  const dataRows = data.slice(2); // skip 2 header rows
  const activeVersion = '2026_v1';

  // Firestore batches are limited to 500 ops — we have ~41 rows + 2 metadata = well under the limit
  const batch = db.batch();

  // 1. _config document — points to the active version
  const configRef = db.collection(COLLECTION).doc('_config');
  batch.set(configRef, { activeVersion }, { merge: true });

  // 2. Version metadata document
  const versionDocRef = db.collection(COLLECTION).doc(activeVersion);
  batch.set(versionDocRef, {
    metadata: {
      name: 'Salary Matrix White Collar',
      description: 'Master salary matrix for white collar employees (SLTP–S3) at UNIPDU',
      sourceFile: 'SalaryMatrix White Collar (Final).xlsx',
      gradeCodes,
      educationLevels,
      effectiveDate: admin.firestore.FieldValue.serverTimestamp(),
      version: activeVersion,
      isActive: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
  }, { merge: true });

  // 3. Row documents in the "rows" subcollection — one per year of service
  let rowCount = 0;

  for (const row of dataRows) {
    if (!row || row.length < 3) continue;

    const tahun = Number(row[0]); // years of service
    const bulan = Number(row[1]); // months of service

    if (isNaN(tahun) || isNaN(bulan)) continue;

    const salaries: Record<string, number> = {};
    let isValidRow = true;

    for (let i = 0; i < gradeCodes.length; i++) {
      const grade = gradeCodes[i];
      const value = Number(row[i + 2]);
      if (isNaN(value)) {
        console.warn(`   ⚠ Non-numeric value at year ${tahun}, grade ${grade}: ${row[i + 2]}`);
        isValidRow = false;
        break;
      }
      salaries[grade] = value;
    }

    if (!isValidRow) continue;

    const rowDocRef = versionDocRef.collection('rows').doc(`year_${tahun}`);
    batch.set(rowDocRef, {
      tahun,
      bulan,
      salaries,
      isActive: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    rowCount++;
  }

  // ── Commit ─────────────────────────────────────────────────────────────────
  console.log(`\n🔥 Committing ${rowCount} rows to Firestore...`);
  try {
    await batch.commit();
    console.log('\n✅ White collar salary matrix seeded successfully!');
    console.log('───────────────────────────────────────────');
    console.log(`   Collection:    ${COLLECTION}`);
    console.log(`   Version:       ${activeVersion}`);
    console.log(`   Rows written:  ${rowCount}`);
    console.log(`   Grade codes:   ${gradeCodes.length} (A–AD)`);
    console.log(`   Path:          ${COLLECTION}/${activeVersion}/rows/year_1 … year_${rowCount}`);
    console.log('───────────────────────────────────────────');
  } catch (error) {
    console.error('❌ Failed to commit batch to Firestore:', error);
    process.exit(1);
  }
}

seedWhiteCollarSalaryMatrix().catch(console.error);
