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

function normalizeJobCategory(jabatan: string): string {
  if (!jabatan) return 'OTHER';
  const clean = String(jabatan).trim().toUpperCase();
  if (clean.includes('SATPAM')) return 'SATPAM';
  if (clean.includes('SOPIR')) return 'SOPIR';
  if (clean.includes('TEKNISI')) return 'TEKNISI';
  if (clean === 'IC' || clean.includes('KEBERSIHAN IC') || clean === 'KEBERSIHAN_IC') return 'KEBERSIHAN';
  if (clean === 'CS' || clean.includes('KEBERSIHAN')) return 'KEBERSIHAN';
  return clean || 'OTHER';
}

function parseDate(dateStr: any): string | null {
  if (!dateStr) return null;
  // If it's already an ISO string
  if (typeof dateStr === 'string' && dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return dateStr;
  }
  // If it's an excel serial number
  if (typeof dateStr === 'number') {
    const date = new Date(Math.round((dateStr - 25569) * 86400 * 1000));
    return date.toISOString().split('T')[0];
  }
  return null;
}

async function migrateEmployeesMaster() {
  const filePath = path.resolve(process.cwd(), 'employee_master_seed_unipdu_blue_collar.xlsx');
  
  if (!fs.existsSync(filePath)) {
    console.error(`Excel file not found at: ${filePath}`);
    process.exit(1);
  }

  console.log('Reading Excel file...');
  const workbook = xlsx.readFile(filePath);
  const sheetName = 'Employee Master Seed';
  const sheet = workbook.Sheets[sheetName] || workbook.Sheets[workbook.SheetNames[0]];
  
  // Read sheet as an array of arrays
  const data = xlsx.utils.sheet_to_json<any[]>(sheet, { header: 1 });
  
  // Headers are at row index 3
  const headers = data[3];
  const rowsData = data.slice(4);

  const employees = [];
  let counter = 1;
  let totalActive = 0;
  let totalInactive = 0;
  
  let missingNiyCount = 0;
  let missingBankCount = 0;
  let unrecognizedJobCategoryCount = 0;
  let invalidDateCount = 0;
  
  const jobCategoriesCount: Record<string, number> = {};
  const seenNiy = new Set<string>();
  const duplicateNiyList: string[] = [];

  for (const row of rowsData) {
    if (!row || row.length === 0) continue; // Skip empty rows

    // Indexes based on headers:
    // 0: employeeId, 1: niy, 2: name, 3: status, 4: employmentType, 5: unit
    // 6: jobCategory, 7: position, 8: startDate, 9: bankName, 10: accountNumber
    // 11: koperasiCode, 12: isActive, 13: isPayrollEligible, 14: notes
    
    const nama = row[2];
    if (!nama || String(nama).trim() === '') continue; // Must have name

    const niyRaw = row[1];
    const statusRaw = row[3];
    const positionRaw = row[7] || row[6]; // Fallback to jobCategory
    const masukRaw = row[8];
    const bankRaw = row[9];
    const norekRaw = row[10];
    const koperasiRaw = row[11];
    
    // Normalization
    const employeeId = 'EMP_' + String(counter).padStart(3, '0');
    const niy = niyRaw ? String(niyRaw).trim() : null;
    const name = String(nama).trim();
    
    const statusLower = statusRaw ? String(statusRaw).trim().toLowerCase() : '';
    const status = (statusLower === 'aktif' || statusLower === 'active') ? 'active' : 'inactive';
    const isActive = status === 'active';
    const isPayrollEligible = isActive;
    
    const jobCategory = normalizeJobCategory(positionRaw);
    const startDate = parseDate(masukRaw);
    const endDate = null; // Keluar date ignored for now as requested

    const bankName = bankRaw ? String(bankRaw).trim() : null;
    const accountNumber = norekRaw ? String(norekRaw).trim() : null;
    const koperasiCode = koperasiRaw ? String(koperasiRaw).trim() : null;

    // Validations & Warnings Tracking
    if (isActive) totalActive++; else totalInactive++;
    
    if (!niy) {
      missingNiyCount++;
    } else {
      if (seenNiy.has(niy)) {
        duplicateNiyList.push(niy);
      }
      seenNiy.add(niy);
    }
    
    if (!accountNumber) missingBankCount++;
    if (jobCategory === 'OTHER') unrecognizedJobCategoryCount++;
    if (!startDate) invalidDateCount++;
    
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
        position: positionRaw ? String(positionRaw).trim() : "",
        startDate,
        endDate
      },
      bankAccount: {
        bankName,
        accountNumber,
        accountHolderName: name
      },
      cooperative: {
        koperasiCode
      },
      flags: {
        isPayrollEligible,
        isActive
      },
      audit: {
        sourceFile: "4. GAJI SATPAM APRIL 2026 - Google Sheets.pdf",
        sourceSheet: "DATA PEGAWAI",
        importedFromPayrollPeriod: "2026-04",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }
    };

    employees.push(employeeRecord);
    counter++;
  }

  // Write Preview to tmp/employees-master-preview.json
  const tmpDir = path.resolve(process.cwd(), 'tmp');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir);
  }
  
  const previewPath = path.resolve(tmpDir, 'employees-master-preview.json');
  
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
  console.log(`\n📄 Generated local preview file at: tmp/employees-master-preview.json`);
  
  console.log('\n--- VALIDATION WARNINGS ---');
  console.log(`Missing NIY count           : ${missingNiyCount}`);
  if (duplicateNiyList.length > 0) {
    console.log(`Duplicate NIY values        : ${duplicateNiyList.join(', ')}`);
  }
  console.log(`Missing bank account        : ${missingBankCount}`);
  console.log(`Unrecognized job category   : ${unrecognizedJobCategoryCount}`);
  console.log(`Invalid/Missing start dates : ${invalidDateCount}`);
  console.log('---------------------------\n');

  // Check if --commit flag is passed
  if (!process.argv.includes('--commit')) {
    console.log('Review the preview file above. If everything looks correct, run:');
    console.log('npm run migrate:employees-master -- --commit\n');
    return;
  }

  // Batch write to Firestore
  console.log('Committing to Firestore...');
  const batch = db.batch();
  
  const employeesDocRef = db.collection('MasterData').doc('Employees');
  
  batch.set(employeesDocRef, {
    metadata: {
      name: "Data Pegawai Blue Collar",
      description: "Master employee data for UNIPDU blue-collar payroll workers",
      sourceFile: "4. GAJI SATPAM APRIL 2026 - Google Sheets.pdf",
      sourceSheet: "DATA PEGAWAI",
      employmentType: "blue_collar",
      unit: "BAK",
      totalEmployees: employees.length,
      totalActiveEmployees: totalActive,
      totalInactiveEmployees: totalInactive,
      jobCategories: Object.keys(jobCategoriesCount),
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
    console.log('\n✅ Employee Master Migration completed successfully!');
    console.log(`Firestore path written: MasterData/Employees/records`);
  } catch (error) {
    console.error('Failed to commit batch to Firestore:', error);
  }
}

migrateEmployeesMaster().catch(console.error);
