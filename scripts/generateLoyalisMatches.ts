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

function cleanField(val: any): string | null {
  if (val === undefined || val === null) return null;
  const str = String(val).trim();
  return str === '' ? null : str;
}

async function main() {
  const filePath = path.resolve(process.cwd(), 'Pegawai + Email.xlsx');
  if (!fs.existsSync(filePath)) {
    console.error('❌ Excel file not found!');
    process.exit(1);
  }
  
  const workbook = xlsx.readFile(filePath);
  const sheet = workbook.Sheets['White Collar Loyalis'];
  if (!sheet) {
    console.error('❌ Sheet "White Collar Loyalis" not found!');
    process.exit(1);
  }
  
  const excelData: any[] = xlsx.utils.sheet_to_json(sheet);
  console.log(`📄 Read ${excelData.length} rows from Excel.`);
  
  console.log('🔍 Fetching Firestore Employees_Loyalis records...');
  const snapshot = await db.collection('Employees_Loyalis').get();
  
  const dbMap = new Map<string, any>();
  snapshot.forEach(doc => {
    const data = doc.data();
    dbMap.set(doc.id, {
      id: doc.id,
      name: data.personal_info?.name || data.name || '',
      email: data.personal_info?.email || '',
      phone: data.personal_info?.phone || ''
    });
  });
  console.log(`🔍 Retrieved ${dbMap.size} documents from Firestore.`);
  
  const matches: any[] = [];
  const processedDbIds = new Set<string>();
  
  excelData.forEach(row => {
    const excelId = cleanField(row['ID Pegawai']);
    const excelName = cleanField(row['Nama Lengkap']);
    // Swapped columns mapping:
    // 'Nomor Telepon' contains emails.
    // 'Email' contains phone numbers.
    const emailToMigrate = cleanField(row['Nomor Telepon']);
    const phoneToMigrate = cleanField(row['Email']);
    
    if (!excelId) {
      console.warn(`⚠️ Skipped Excel row without ID: ${excelName}`);
      return;
    }
    
    const dbRecord = dbMap.get(excelId);
    
    if (dbRecord) {
      processedDbIds.add(excelId);
      const isNameMatch = String(excelName).trim().toLowerCase() === String(dbRecord.name).trim().toLowerCase();
      
      matches.push({
        excel_id: excelId,
        excel_name: excelName,
        db_id: dbRecord.id,
        db_name: dbRecord.name,
        email_to_migrate: emailToMigrate,
        phone_to_migrate: phoneToMigrate,
        match_status: isNameMatch ? 'exact_match' : 'name_mismatch_warning'
      });
    } else {
      matches.push({
        excel_id: excelId,
        excel_name: excelName,
        db_id: null,
        db_name: null,
        email_to_migrate: emailToMigrate,
        phone_to_migrate: phoneToMigrate,
        match_status: 'excel_only_not_found_in_db'
      });
    }
  });
  
  // Add database records that are not in the Excel sheet
  dbMap.forEach((val, id) => {
    if (!processedDbIds.has(id)) {
      matches.push({
        excel_id: null,
        excel_name: null,
        db_id: id,
        db_name: val.name,
        email_to_migrate: null,
        phone_to_migrate: null,
        match_status: 'db_only_untouched'
      });
    }
  });
  
  const outputPath = path.resolve(process.cwd(), 'loyalis_email_matches.json');
  fs.writeFileSync(outputPath, JSON.stringify(matches, null, 2), 'utf-8');
  console.log(`\n✅ Generated matching JSON at: ${outputPath}`);
  console.log(`📊 Total mapped entries: ${matches.length}`);
  
  // Summarize statuses
  const statusCounts: Record<string, number> = {};
  matches.forEach(m => {
    statusCounts[m.match_status] = (statusCounts[m.match_status] || 0) + 1;
  });
  console.log('Status breakdown:');
  Object.entries(statusCounts).forEach(([status, count]) => {
    console.log(`- ${status}: ${count}`);
  });
}

main().catch(console.error);
