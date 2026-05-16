import * as admin from 'firebase-admin';
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

async function migrateKoperasiRochmad() {
  const COLLECTION_NAME = 'Employees_BlueCollar';

  console.log(`🔍 Fetching all employees from ${COLLECTION_NAME}...`);

  const snapshot = await db.collection(COLLECTION_NAME).get();

  if (snapshot.empty) {
    console.log('No employees found.');
    return;
  }

  console.log(`Found ${snapshot.size} employees. Migrating koperasiRochmad to kodeKopRochmad...`);

  const batch = db.batch();
  let count = 0;
  let batchCount = 0;

  snapshot.forEach(doc => {
    const data = doc.data();
    const currentVal = data.deductions?.koperasiRochmad ?? 0;
    
    // Only update if koperasiRochmad is non-zero or kodeKopRochmad doesn't exist
    // This makes the script somewhat idempotent
    if (currentVal !== 0 || data.deductions?.kodeKopRochmad === undefined) {
      batch.update(doc.ref, {
        'deductions.kodeKopRochmad': currentVal,
        'deductions.koperasiRochmad': 0,
        'audit.updatedAt': admin.firestore.FieldValue.serverTimestamp()
      });
      count++;
      batchCount++;
    }

    // Firestore batch limit is 500
    if (batchCount === 500) {
      // Note: This approach is slightly flawed in a forEach without await, 
      // but for < 500 docs it's fine. 
      // For safety with larger datasets, I should use a for...of loop.
    }
  });

  if (batchCount > 0) {
    await batch.commit();
  }

  console.log(`✅ Successfully migrated ${count} employees.`);
  console.log(`- New field: deductions.kodeKopRochmad (original value)`);
  console.log(`- Updated field: deductions.koperasiRochmad = 0`);
}

// Re-implementing with for...of for robustness
async function runMigration() {
    const COLLECTION_NAME = 'Employees_BlueCollar';
    const snapshot = await db.collection(COLLECTION_NAME).get();
    
    if (snapshot.empty) {
      console.log('No employees found.');
      return;
    }

    console.log(`Found ${snapshot.size} employees. Starting migration...`);

    let count = 0;
    let batch = db.batch();
    let batchCount = 0;

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const currentVal = data.deductions?.koperasiRochmad ?? 0;

      // If already migrated (koperasiRochmad is 0 and kodeKopRochmad exists), skip
      if (currentVal === 0 && data.deductions?.kodeKopRochmad !== undefined) {
        continue;
      }

      batch.update(doc.ref, {
        'deductions.kodeKopRochmad': currentVal,
        'deductions.koperasiRochmad': 0,
        'audit.updatedAt': admin.firestore.FieldValue.serverTimestamp()
      });

      count++;
      batchCount++;

      if (batchCount === 500) {
        await batch.commit();
        batch = db.batch();
        batchCount = 0;
      }
    }

    if (batchCount > 0) {
      await batch.commit();
    }

    console.log(`✅ Successfully migrated ${count} employees.`);
}

runMigration().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
