import * as admin from 'firebase-admin';
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

interface EmailMismatch {
  employeeId: string;
  employeeName: string;
  userEmail: string;
  employeeCurrentEmail: string;
}

async function main() {
  const isCommit = process.argv.includes('--commit');
  console.log('======================================================');
  console.log('UNIPDU INTERNAL KEUANGAN - COMPARE LOYALIS EMAILS');
  console.log(`MODE: ${isCommit ? '🔥 COMMIT (WRITE)' : '👀 DRY-RUN (READ-ONLY)'}`);
  console.log('======================================================\n');

  // 1. Fetch all users with role 'loyalis'
  console.log('🔍 Fetching user accounts with role "loyalis" from Firestore...');
  const usersSnapshot = await db.collection('users').where('role', '==', 'loyalis').get();
  console.log(`Fetched ${usersSnapshot.size} user accounts with role "loyalis".`);

  // Map to store user email by linkedEmployeeId
  const userMap = new Map<string, { email: string; displayName: string }>();
  usersSnapshot.forEach(doc => {
    const data = doc.data();
    if (data.linkedEmployeeId) {
      userMap.set(data.linkedEmployeeId, {
        email: (data.email || '').trim(),
        displayName: data.displayName || ''
      });
    }
  });

  // 2. Fetch all employees from Employees_Loyalis
  console.log('🔍 Fetching all employee records from Employees_Loyalis...');
  const loyalisSnapshot = await db.collection('Employees_Loyalis').get();
  console.log(`Fetched ${loyalisSnapshot.size} employee documents.\n`);

  const mismatches: EmailMismatch[] = [];
  const matches: any[] = [];
  const skipped: any[] = [];

  loyalisSnapshot.forEach(doc => {
    const data = doc.data();
    const empId = doc.id;
    const name = data.personal_info?.name || data.name || 'Unknown Name';
    const employeeEmail = (data.personal_info?.email || data.email || '').trim();
    const status = data.personal_info?.status || 'UNKNOWN';

    // We check if this employee is linked to a user account
    const linkedUser = userMap.get(empId);

    if (linkedUser) {
      const userEmail = linkedUser.email;
      if (userEmail.toLowerCase() !== employeeEmail.toLowerCase()) {
        mismatches.push({
          employeeId: empId,
          employeeName: name,
          userEmail: userEmail,
          employeeCurrentEmail: employeeEmail
        });
      } else {
        matches.push({
          employeeId: empId,
          employeeName: name,
          email: userEmail
        });
      }
    } else {
      skipped.push({
        employeeId: empId,
        employeeName: name,
        employeeEmail: employeeEmail,
        status: status
      });
    }
  });

  // Write comparison output to JSON files
  const outputDir = path.resolve(process.cwd(), 'scripts');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const mismatchFilePath = path.join(outputDir, 'email_mismatches.json');
  fs.writeFileSync(mismatchFilePath, JSON.stringify(mismatches, null, 2), 'utf-8');
  console.log(`💾 Saved ${mismatches.length} mismatches to ${mismatchFilePath}`);

  console.log('\n=================== ANALYSIS RESULTS ===================');
  console.log(`Total Mismatches Found : ${mismatches.length}`);
  console.log(`Total Matches Found    : ${matches.length}`);
  console.log(`Employees without User : ${skipped.length}`);
  console.log('========================================================\n');

  if (mismatches.length > 0) {
    console.log('--- DETAILED MISMATCHES (JSON) ---');
    console.log(JSON.stringify(mismatches, null, 2));
    console.log('----------------------------------\n');
  } else {
    console.log('🎉 No email mismatches found between user accounts and employee records!\n');
  }

  if (isCommit) {
    if (mismatches.length === 0) {
      console.log('No updates needed. Exiting.');
      return;
    }

    console.log(`🔥 Committing ${mismatches.length} updates to Firestore...`);
    const batch = db.batch();

    mismatches.forEach(m => {
      const docRef = db.collection('Employees_Loyalis').doc(m.employeeId);
      // We update personal_info.email with the userEmail
      batch.update(docRef, {
        'personal_info.email': m.userEmail,
        'audit.updatedAt': admin.firestore.FieldValue.serverTimestamp(),
        'audit.updatedBy': 'Antigravity Script Align Emails'
      });
    });

    await batch.commit();
    console.log('✅ Successfully aligned all email accounts in Firestore collection "Employees_Loyalis"!');
  } else {
    console.log('👉 To apply the correct email addresses to the employee records, run the script with the --commit flag:');
    console.log('   npx tsx scripts/compareLoyalisEmails.ts --commit\n');
  }
}

main().catch(error => {
  console.error('❌ Script failed with error:', error);
  process.exit(1);
});
