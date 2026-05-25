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

const standardLevels = [
  "S3-Kesehatan",
  "S2-Kesehatan",
  "S1-Kesehatan",
  "D4-Kesehatan",
  "D3-Kesehatan",
  "S3-Eksakta",
  "S2-Eksakta",
  "S1-Eksakta",
  "S3-Sosial",
  "S2-Sosial",
  "S1-Sosial",
  "S2-Administrasi",
  "S1-Administrasi",
  "D3-Administrasi",
  "D2-Administrasi/SLTA",
  "Khusus",
  "S3-FT",
  "S2-FT",
  "S1-FT",
  "S3-fia",
  "S2-fia",
  "S1-fia"
];

async function runMigration() {
  const isDryRun = process.env.DRY_RUN === 'true';
  console.log(`🚀 Starting Education Level Update Migration (Dry Run: ${isDryRun})...\n`);

  console.log('🔍 Fetching all documents from collection "Employees_Loyalis"...');
  const snapshot = await db.collection('Employees_Loyalis').get();
  
  if (snapshot.empty) {
    console.log('⚠️ No documents found in collection "Employees_Loyalis".');
    return;
  }

  console.log(`📄 Found ${snapshot.size} documents. Evaluating fields...`);

  let matchCount = 0;
  let noMatchCount = 0;
  let alreadyUpdatedCount = 0;
  let batch = db.batch();
  let operationCount = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const employeeId = doc.id;
    const personalName = data.personal?.fullName || data.name || 'Unnamed Employee';
    const currentEdu = data.academic_and_tier?.education_level;

    if (!currentEdu) {
      console.log(`  - [${employeeId}] ${personalName}: No education_level set. Skipping.`);
      continue;
    }

    // Clean and check if already exact match
    const trimmedEdu = currentEdu.trim();
    if (standardLevels.includes(trimmedEdu)) {
      alreadyUpdatedCount++;
      continue;
    }

    // Apply 6-character prefix matching (case-insensitive)
    const cleanPrefix = trimmedEdu.substring(0, 6).toUpperCase();
    const matchedStandard = standardLevels.find(std => 
      std.substring(0, 6).toUpperCase() === cleanPrefix
    );

    if (matchedStandard) {
      matchCount++;
      console.log(`  ✅ Match: [${employeeId}] ${personalName}`);
      console.log(`     "${currentEdu}" ➡️ "${matchedStandard}"`);

      if (!isDryRun) {
        // Path is inside nested map 'academic_and_tier.education_level'
        const docRef = db.collection('Employees_Loyalis').doc(employeeId);
        batch.update(docRef, {
          'academic_and_tier.education_level': matchedStandard,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        operationCount++;

        // Commit batch if we hit limit of 500 operations
        if (operationCount === 500) {
          console.log('\n🔥 Committing batch of 500 updates...');
          await batch.commit();
          batch = db.batch();
          operationCount = 0;
        }
      }
    } else {
      noMatchCount++;
      console.log(`  ❌ No standard match found: [${employeeId}] ${personalName} ("${currentEdu}")`);
    }
  }

  // Commit any remaining updates if not dry run
  if (!isDryRun && operationCount > 0) {
    console.log(`\n🔥 Committing final batch of ${operationCount} updates...`);
    await batch.commit();
  }

  console.log('\n───────────────────────────────────────────');
  console.log(`Migration Summary (${isDryRun ? 'DRY RUN' : 'REAL RUN'}):`);
  console.log(`  Total Evaluated:   ${snapshot.size}`);
  console.log(`  Already Correct:   ${alreadyUpdatedCount}`);
  console.log(`  Matched & Updated: ${matchCount}`);
  console.log(`  Unmatched:         ${noMatchCount}`);
  console.log('───────────────────────────────────────────');

  if (isDryRun) {
    console.log('\n💡 Dry run finished. No writes were committed to Firestore.');
  } else {
    console.log('\n✅ Database migration completed successfully!');
  }
}

runMigration().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
