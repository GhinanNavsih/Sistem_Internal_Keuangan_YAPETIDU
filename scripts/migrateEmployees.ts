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

function excelDateToISODateString(excelSerial: any): string | null {
  if (excelSerial === null || excelSerial === undefined || excelSerial === '') return null;
  const serial = Number(excelSerial);
  if (isNaN(serial)) return null; // Fallback if it's already a string date or invalid
  const date = new Date(Math.round((serial - 25569) * 86400 * 1000));
  return date.toISOString().split('T')[0];
}

function parseNumeric(value: any): number {
  if (value === null || value === undefined || value === '') return 0;
  const num = Number(value);
  return isNaN(num) ? 0 : num;
}

function normalizeJobCategory(jabatan: string): string {
  if (!jabatan) return 'OTHER';
  const clean = jabatan.trim().toUpperCase();
  if (clean.includes('SATPAM')) return 'SATPAM';
  if (clean.includes('SOPIR')) return 'SOPIR';
  if (clean.includes('TEKNISI')) return 'TEKNISI';
  if (clean.includes('KEBERSIHAN PONTI') || clean === 'KEBERSIHAN_PONTI') return 'KEBERSIHAN_PONTI';
  if (clean === 'IC' || clean.includes('KEBERSIHAN IC') || clean === 'KEBERSIHAN_IC') return 'KEBERSIHAN';
  if (clean.includes('KEBERSIHAN')) return 'KEBERSIHAN';
  return clean || 'OTHER';
}

async function migrateEmployees() {
  const filePath = path.resolve(process.cwd(), 'Data Pegawai (Blue Collar).xlsx');
  
  if (!fs.existsSync(filePath)) {
    console.error(`Excel file not found at: ${filePath}`);
    process.exit(1);
  }

  console.log('Reading Excel file...');
  const workbook = xlsx.readFile(filePath);
  const sheetName = workbook.SheetNames[0]; // Usually 'data pegawai' or similar
  const sheet = workbook.Sheets[sheetName];
  
  // Read sheet as an array of arrays
  const data = xlsx.utils.sheet_to_json<any[]>(sheet, { header: 1 });
  
  const rowsData = data.slice(2); // Skip the first 2 header rows

  const employees = [];
  let counter = 1;
  let totalActive = 0;
  let totalInactive = 0;
  let missingNiyCount = 0;
  let missingBankCount = 0;
  const jobCategoriesCount: Record<string, number> = {};

  for (const row of rowsData) {
    if (!row || row.length < 3) continue; // Skip empty rows or rows without name

    const nama = row[2];
    if (!nama || typeof nama !== 'string' || nama.trim() === '') continue; // Must have name

    const niyRaw = row[1];
    const statusRaw = row[3] ? String(row[3]).trim().toLowerCase() : '';
    const jabatanRaw = row[4] ? String(row[4]) : '';
    
    const masukRaw = row[5];
    const keluarRaw = row[6];
    const monthsRaw = row[8];
    const gapokLevelRaw = row[9];
    const gapokJmlRaw = row[10];
    const bankRaw = row[11];
    const norekRaw = row[12];
    const tunjBpjsRaw = row[13];
    const koperasiUnipduRaw = row[14];
    const bpjsDeductionRaw = row[15];
    const kopRochmadRaw = row[16];
    const kopGemilangRaw = row[17];

    // Normalization
    const employeeId = 'EMP_' + String(counter).padStart(3, '0');
    const niy = niyRaw ? String(niyRaw).trim() : null;
    const name = nama.trim();
    
    const status = (statusRaw === 'aktif' || statusRaw === 'active') ? 'active' : 'inactive';
    const isActive = status === 'active';
    const isPayrollEligible = isActive; // True for active, false for inactive
    
    const jobCategory = normalizeJobCategory(jabatanRaw);
    const startDate = excelDateToISODateString(masukRaw);
    const endDate = excelDateToISODateString(keluarRaw);

    const totalMonths = parseNumeric(monthsRaw);
    const baseSalaryYear = Math.floor(totalMonths / 12);
    const salaryGradeCode = gapokLevelRaw ? String(gapokLevelRaw).trim() : "OTHER";
    const baseSalaryAmount = parseNumeric(gapokJmlRaw);
    
    const bankName = bankRaw ? String(bankRaw).trim() : null;
    const accountNumber = norekRaw ? String(norekRaw).trim() : null;

    const allowanceAmount = parseNumeric(tunjBpjsRaw);
    const bpjsDeductionAmount = parseNumeric(bpjsDeductionRaw);
    
    const koperasiUnipdu = parseNumeric(koperasiUnipduRaw);
    const koperasiRochmad = parseNumeric(kopRochmadRaw);
    const koperasiGemilang = parseNumeric(kopGemilangRaw);

    // Track stats
    if (isActive) totalActive++; else totalInactive++;
    if (!niy) missingNiyCount++;
    if (!accountNumber) missingBankCount++;
    jobCategoriesCount[jobCategory] = (jobCategoriesCount[jobCategory] || 0) + 1;

    const employeeRecord = {
      employeeId,
      niy,
      name,
      employment: {
        status,
        employmentType: "blue_collar",
        unit: "BAK",
        jobCategory,
        position: jabatanRaw ? jabatanRaw.trim() : "",
        startDate,
        endDate
      },
      salaryProfile: {
        salaryGradeCode,
        baseSalaryYear,
        baseSalaryAmount,
        salaryMatrixVersion: "2026_v1"
      },
      bankAccount: {
        bankName,
        accountNumber,
        accountHolderName: name
      },
      bpjs: {
        allowanceAmount,
        deductionAmount: bpjsDeductionAmount
      },
      deductions: {
        koperasiRochmad,
        koperasiGemilang,
        koperasiUnipdu,
        otherDeduction: 0
      },
      flags: {
        isPayrollEligible,
        isActive
      },
      audit: {
        sourceFile: "Data Pegawai (Blue Collar).xlsx",
        sourceSheet: sheetName,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }
    };

    employees.push(employeeRecord);
    counter++;
  }

  // Write Preview to tmp/employees-preview.json
  const tmpDir = path.resolve(process.cwd(), 'tmp');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir);
  }
  
  const previewPath = path.resolve(tmpDir, 'employees-preview.json');
  
  // Clone for preview so we can replace ServerTimestamp with string
  const previewData = employees.map(emp => ({
    ...emp,
    audit: {
      ...emp.audit,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  }));

  fs.writeFileSync(previewPath, JSON.stringify(previewData, null, 2));
  console.log(`\n📄 Generated local preview file at: tmp/employees-preview.json`);

  // Batch write to Firestore
  console.log('\nCommitting to Firestore...');
  const batch = db.batch();
  
  // Metadata
  const metadataRef = db.collection('MasterData').doc('Employees').collection('metadata').doc('info');
  // Or based on structure: MasterData/Employees/metadata
  // Better use: MasterData/Employees/metadata (where Employees is a collection, metadata is a document, and records is a subcollection... no wait. 
  // MasterData/Employees could be a Document, with `metadata` field and `records` subcollection.
  // The user prompt says:
  // MasterData
  //   └── Employees
  //         ├── metadata
  //         └── records
  //               ├── EMP_001
  const employeesDocRef = db.collection('MasterData').doc('Employees');
  
  batch.set(employeesDocRef, {
    metadata: {
      name: "Data Pegawai Blue Collar",
      description: "Master employee data for UNIPDU blue-collar payroll workers",
      sourceFile: "Data Pegawai (Blue Collar).xlsx",
      sourceSheet: sheetName,
      employmentType: "blue_collar",
      unit: "BAK",
      totalEmployees: employees.length,
      totalActiveEmployees: totalActive,
      totalInactiveEmployees: totalInactive,
      jobCategories: Object.keys(jobCategoriesCount),
      salaryMatrixVersion: "2026_v1",
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }
  }, { merge: true });

  // Records
  for (const emp of employees) {
    const docRef = employeesDocRef.collection('records').doc(emp.employeeId);
    batch.set(docRef, emp, { merge: true });
  }

  try {
    await batch.commit();
    console.log('\n✅ Employee Migration completed successfully!');
    console.log('-----------------------------------');
    console.log(`Total employees migrated : ${employees.length}`);
    console.log(`Total active             : ${totalActive}`);
    console.log(`Total inactive           : ${totalInactive}`);
    console.log(`Job category breakdown   :`, jobCategoriesCount);
    console.log(`Employees missing NIY    : ${missingNiyCount}`);
    console.log(`Employees missing Bank   : ${missingBankCount}`);
    console.log(`Firestore path written   : MasterData/Employees and MasterData/Employees/records`);
  } catch (error) {
    console.error('Failed to commit batch to Firestore:', error);
  }
}

migrateEmployees().catch(console.error);
