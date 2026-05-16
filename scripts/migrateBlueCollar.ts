import * as admin from 'firebase-admin';
import * as xlsx from 'xlsx';
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const serviceAccountPath = path.resolve(process.cwd(), 'service-account.json');

if (!admin.apps.length) {
  if (fs.existsSync(serviceAccountPath)) {
    console.log('Using service-account.json...');
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

/**
 * Converts either an Excel serial date (number) or a locale date string
 * (e.g. "1 Agu 1998") into an ISO date string "YYYY-MM-DD".
 * Returns null for empty / invalid values.
 */
function toISODate(value: any): string | null {
  if (value === null || value === undefined || value === '') return null;

  // Already a number → Excel serial
  if (typeof value === 'number') {
    if (isNaN(value) || value <= 0) return null;
    const date = new Date(Math.round((value - 25569) * 86400 * 1000));
    return date.toISOString().split('T')[0];
  }

  const str = String(value).trim();
  if (!str || str.toLowerCase() === 'keluar') return null; // "keluar" is not a date

  // Try parsing locale-style dates like "1 Agu 1998", "26 Des 2024", "18 Okt 2009"
  const MONTH_MAP: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', mei: '05', may: '05',
    jun: '06', jul: '07', agu: '08', aug: '08', sep: '09', okt: '10',
    oct: '10', nov: '11', des: '12', dec: '12',
  };
  const parts = str.split(/\s+/);
  if (parts.length === 3) {
    const [day, monthStr, year] = parts;
    const month = MONTH_MAP[monthStr.toLowerCase()];
    if (month && year) {
      return `${year}-${month}-${String(day).padStart(2, '0')}`;
    }
  }

  // Last fallback: try native Date parse
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) return parsed.toISOString().split('T')[0];

  return null;
}

function num(value: any): number {
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(value);
  return isNaN(n) ? 0 : n;
}

async function migrateBlueCollar() {
  const filePath = path.resolve(process.cwd(), 'Data Pegawai Blue Collar.xlsx');

  if (!fs.existsSync(filePath)) {
    console.error(`❌  Excel file not found: ${filePath}`);
    process.exit(1);
  }

  console.log('📖 Reading Excel file...');
  const workbook = xlsx.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json<any>(sheet);

  const employees: any[] = [];
  let counter = 1;
  const stats = { active: 0, inactive: 0, noNik: 0, noBank: 0 };
  const jobCatCount: Record<string, number> = {};

  for (const row of rows) {
    const name: string = String(row['Nama'] || '').trim();
    if (!name) continue;

    // --- Status ---
    const statusRaw = String(row['Status'] || '').trim().toUpperCase();
    const isActive = statusRaw === 'AKTIF';

    // --- Identifiers ---
    const nik: string | null = row['NIK'] ? String(row['NIK']).trim() : null;

    // --- Employment ---
    const jobCategory: string = String(row['Job Category Normalized'] || 'OTHER').trim();
    const startDate: string | null = toISODate(row['Masuk_ISO'] ?? row['Masuk']);
    const endDate: string | null = toISODate(row['Keluar_ISO'] ?? row['Keluar']);

    // --- Salary grade ---
    const salaryGradeCode: string | null = row['Level'] ? String(row['Level']).trim() : null;
    const baseSalaryAmount: number = num(row['Gapok']);

    // --- Bank ---
    const bankName: string | null = row['Bank'] ? String(row['Bank']).trim() : null;
    const accountNumber: string | null = row['No Rekening']
      ? String(row['No Rekening']).trim()
      : null;

    // --- BPJS ---
    const bpjsAllowance: number = num(row['Tunjangan BPJS']) * 1000;
    const bpjsDeduction: number = num(row['Potongan BPJS']) * 1000;

    // --- Koperasi ---
    const koperasiRochmad: number = num(row['Kode Koperasi Rochmad']);

    // Deterministic ID – sequential per run, idempotent if re-run against same sheet order
    const employeeId = `BC_${String(counter).padStart(3, '0')}`;

    // Stats
    if (isActive) stats.active++; else stats.inactive++;
    if (!nik) stats.noNik++;
    if (!accountNumber) stats.noBank++;
    jobCatCount[jobCategory] = (jobCatCount[jobCategory] || 0) + 1;

    employees.push({
      employeeId,
      nik,                          // National ID (NIK), not NIY
      name,
      collarType: 'blue_collar',
      employment: {
        status: isActive ? 'active' : 'inactive',
        jobCategory,
        startDate,
        endDate: isActive ? null : endDate,
      },
      salaryProfile: {
        salaryGradeCode,
        baseSalaryAmount,
        salaryMatrixVersion: '2026_v1',
      },
      bankAccount: {
        bankName,
        accountNumber,
        accountHolderName: name,
      },
      bpjs: {
        allowanceAmount: bpjsAllowance,
        deductionAmount: bpjsDeduction,
      },
      deductions: {
        koperasiRochmad,
      },
      flags: {
        isActive,
        isPayrollEligible: isActive,
      },
      audit: {
        sourceFile: 'Data Pegawai Blue Collar.xlsx',
        sourceSheet: sheetName,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    });

    counter++;
  }

  // --- Preview ---
  const tmpDir = path.resolve(process.cwd(), 'tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);
  const previewPath = path.resolve(tmpDir, 'blue-collar-preview.json');
  const preview = employees.map(e => ({
    ...e,
    audit: { ...e.audit, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  }));
  fs.writeFileSync(previewPath, JSON.stringify(preview, null, 2));
  console.log(`📄 Preview written to: tmp/blue-collar-preview.json`);

  // --- Firestore ---
  // Path: Employees_BlueCollar (root collection) → {employeeId}
  console.log(`\n🔥 Committing ${employees.length} documents to Employees_BlueCollar...`);

  // Firestore batch limit is 500. Split if needed (65 rows is fine for one batch).
  const batch = db.batch();

  for (const emp of employees) {
    const ref = db.collection('Employees_BlueCollar').doc(emp.employeeId);
    batch.set(ref, emp, { merge: true });
  }

  await batch.commit();

  console.log('\n✅ Migration completed!');
  console.log('─────────────────────────────────────');
  console.log(`Collection        : Employees_BlueCollar`);
  console.log(`Total migrated    : ${employees.length}`);
  console.log(`  Active          : ${stats.active}`);
  console.log(`  Inactive        : ${stats.inactive}`);
  console.log(`  No NIK          : ${stats.noNik}`);
  console.log(`  No Bank Account : ${stats.noBank}`);
  console.log(`Job categories    :`, jobCatCount);
}

migrateBlueCollar().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
