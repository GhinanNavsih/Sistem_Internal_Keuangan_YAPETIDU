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

async function resetKoperasiRochmad() {
  const COLLECTION_NAME = 'Employees_BlueCollar';

  console.log(`🔍 Fetching all employees from ${COLLECTION_NAME}...`);

  const snapshot = await db.collection(COLLECTION_NAME).get();

  if (snapshot.empty) {
    console.log('No employees found.');
    return;
  }

  console.log(`Found ${snapshot.size} employees. Resetting koperasiRochmad to 0...`);

  const batch = db.batch();
  let count = 0;
  let batchCount = 0;

  for (const doc of snapshot.docs) {
    batch.update(doc.ref, {
      'deductions.koperasiRochmad': 0,
      'audit.updatedAt': admin.firestore.FieldValue.serverTimestamp()
    });
    
    count++;
    batchCount++;

    // Firestore batch limit is 500
    if (batchCount === 500) {
      await batch.commit();
      console.log(`Committed batch of 500 updates...`);
      batchCount = 0;
    }
  }

  if (batchCount > 0) {
    await batch.commit();
  }

  console.log(`✅ Successfully reset koperasiRochmad to 0 for ${count} employees.`);
}

resetKoperasiRochmad().catch(err => {
  console.error('❌ Script failed:', err);
  process.exit(1);
});
