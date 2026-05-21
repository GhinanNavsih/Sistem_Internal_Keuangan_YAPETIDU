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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseString(val: any): string | null {
  if (val === undefined || val === null) return null;
  const str = String(val).trim();
  return str === '' ? null : str;
}

function parseNumeric(val: any): number {
  if (val === undefined || val === null || val === '') return 0;
  const num = Number(val);
  return isNaN(num) ? 0 : num;
}

function parseNumericOrNull(val: any): number | null {
  if (val === undefined || val === null || val === '') return null;
  const num = Number(val);
  return isNaN(num) ? null : num;
}

function parseExcelDate(val: any): admin.firestore.Timestamp | null {
  if (val === undefined || val === null || val === '') return null;

  if (typeof val === 'number') {
    // Convert Excel serial number to date
    const date = new Date(Math.round((val - 25569) * 86400 * 1000));
    return admin.firestore.Timestamp.fromDate(date);
  }

  if (typeof val === 'string') {
    const clean = val.trim();
    if (clean === '') return null;
    const date = new Date(clean);
    if (!isNaN(date.getTime())) {
      return admin.firestore.Timestamp.fromDate(date);
    }
  }

  return null;
}

// ─── Schema Column Indices mapping from DATA STAF sheet ─────────────────────
const COL_NO = 0;
const COL_NAMA = 1;
const COL_NIY = 2;
const COL_NPWP = 3;
const COL_BANK = 4;
const COL_NOREK = 5;
const COL_STATUS = 6;
const COL_JOB_ROLE = 11;
const COL_DEPT = 15;
const COL_EDU_CODE = 19;
const COL_EDU_LEVEL = 20;
const COL_FUNC_TIER = 21;
const COL_SPOUSE = 23;
const COL_CHILD_SD = 24;
const COL_CHILD_SLTP = 25;
const COL_CHILD_SLTA = 26;
const COL_CHILD_PT = 27;
const COL_TGL_MASUK = 29;
const COL_TGL_PENGAKUAN = 30;
const COL_TGL_KELUAR = 31;
const COL_LEVEL_CODE = 34;
const COL_LEVEL_RUPIAH = 35;

async function migrateLoyalis() {
  const filePath = path.resolve(process.cwd(), '4. Gaji April 2026.xlsx');

  if (!fs.existsSync(filePath)) {
    console.error(`❌ Excel file not found at: ${filePath}`);
    process.exit(1);
  }

  console.log('📄 Reading Excel file...');
  const workbook = xlsx.readFile(filePath);
  
  const sheetName = 'DATA STAF';
  const sheet = workbook.Sheets[sheetName];
  
  if (!sheet) {
    console.error(`❌ Sheet "${sheetName}" not found in workbook.`);
    process.exit(1);
  }

  console.log(`   Using sheet: "${sheetName}"`);
  const data = xlsx.utils.sheet_to_json<any[]>(sheet, { header: 1 });

  // Rows 0 to 8 are headers/titles. Actual employee data starts at index 9 (NO = 1)
  const dataRows = data.slice(9);
  console.log(`   Found ${dataRows.length} potential rows in sheet.`);

  const employees: any[] = [];
  let runningIndex = 1;

  for (const row of dataRows) {
    if (!row || row.length === 0) continue;

    const name = parseString(row[COL_NAMA]);
    // Filter out rows where the NAMA column is blank
    if (!name) continue;

    const noVal = row[COL_NO];
    const sequenceNo = parseNumericOrNull(noVal) || runningIndex;
    const documentId = `Loyalis_${String(sequenceNo).padStart(3, '0')}`;

    const employeeRecord = {
      personal_info: {
        name,
        employee_id_niy: parseString(row[COL_NIY]),
        tax_id_npwp: parseString(row[COL_NPWP]),
        status: parseString(row[COL_STATUS]),
      },
      banking_info: {
        bank_name: parseString(row[COL_BANK]),
        account_number: parseString(row[COL_NOREK]),
      },
      employment_profile: {
        job_role: parseString(row[COL_JOB_ROLE]),
        department_unit: parseString(row[COL_DEPT]),
        date_of_hire: parseExcelDate(row[COL_TGL_MASUK]),
        date_recognized: parseExcelDate(row[COL_TGL_PENGAKUAN]),
        date_exit: parseExcelDate(row[COL_TGL_KELUAR]),
      },
      academic_and_tier: {
        education_level: parseString(row[COL_EDU_LEVEL]),
        education_code: parseNumericOrNull(row[COL_EDU_CODE]),
        functional_tier: parseNumericOrNull(row[COL_FUNC_TIER]),
        level_code: parseString(row[COL_LEVEL_CODE]),
        base_salary_tier: parseNumericOrNull(row[COL_LEVEL_RUPIAH]),
      },
      family_allowance_metrics: {
        spouse_count: parseNumeric(row[COL_SPOUSE]),
        children_sd: parseNumeric(row[COL_CHILD_SD]),
        children_sltp: parseNumeric(row[COL_CHILD_SLTP]),
        children_slta: parseNumeric(row[COL_CHILD_SLTA]),
        children_pt: parseNumeric(row[COL_CHILD_PT]),
      },
      audit: {
        sourceFile: '4. Gaji April 2026.xlsx',
        sourceSheet: sheetName,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }
    };

    employees.push({
      documentId,
      record: employeeRecord
    });

    runningIndex++;
  }

  console.log(`\n📋 Extracted ${employees.length} valid employee master records.\n`);

  // Print out a preview of the first 2 JSON objects as requested
  console.log('👀 --- PREVIEW OF FIRST 2 JSON RECORDS ---');
  const previewData = employees.slice(0, 2).map(emp => {
    // Clone record and replace Firestore timestamps with readable strings for printing
    const clone = JSON.parse(JSON.stringify(emp.record));
    
    // Since Timestamp object structures stringify as complex nested maps, replace them with clean strings in preview
    const formatPreviewDate = (tsObj: any) => {
      if (!tsObj) return null;
      // Excel dates can be reconstructed for the log preview
      return 'Firestore.Timestamp';
    };

    clone.employment_profile.date_of_hire = emp.record.employment_profile.date_of_hire ? 'Timestamp(' + emp.record.employment_profile.date_of_hire.toDate().toISOString().split('T')[0] + ')' : null;
    clone.employment_profile.date_recognized = emp.record.employment_profile.date_recognized ? 'Timestamp(' + emp.record.employment_profile.date_recognized.toDate().toISOString().split('T')[0] + ')' : null;
    clone.employment_profile.date_exit = emp.record.employment_profile.date_exit ? 'Timestamp(' + emp.record.employment_profile.date_exit.toDate().toISOString().split('T')[0] + ')' : null;
    clone.audit.createdAt = 'ServerTimestamp';
    clone.audit.updatedAt = 'ServerTimestamp';
    return {
      documentId: emp.documentId,
      record: clone
    };
  });
  console.log(JSON.stringify(previewData, null, 2));
  console.log('-------------------------------------------\n');

  // Check if --commit flag is passed
  const isCommit = process.argv.includes('--commit');
  if (!isCommit) {
    console.log('✨ Dry run complete! Review the preview above.');
    console.log('👉 To commit these records to Firestore, run with the --commit flag:');
    console.log('   npx tsx scripts/migrateLoyalis.ts --commit\n');
    return;
  }

  // Execute the batch write in chunks of 500
  console.log('🔥 Committing records to Firestore collection "Employees_Loyalis"...');
  
  const chunks: any[][] = [];
  const chunkSize = 400; // Chunk size well below Firestore 500 limit
  for (let i = 0; i < employees.length; i += chunkSize) {
    chunks.push(employees.slice(i, i + chunkSize));
  }

  let totalWritten = 0;
  for (let c = 0; c < chunks.length; c++) {
    const chunk = chunks[c];
    const batch = db.batch();
    
    for (const emp of chunk) {
      const docRef = db.collection('Employees_Loyalis').doc(emp.documentId);
      batch.set(docRef, emp.record, { merge: true });
    }

    await batch.commit();
    totalWritten += chunk.length;
    console.log(`   [Batch ${c + 1}/${chunks.length}] Wrote ${chunk.length} records...`);
  }

  console.log(`\n✅ Migration completed successfully! Total records written: ${totalWritten}`);
  console.log('──────────────────────────────────────────────────────');
}

migrateLoyalis().catch(console.error);
