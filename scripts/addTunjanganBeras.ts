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

async function addTunjanganBeras() {
  const COLLECTION_NAME = 'Employees_BlueCollar';
  const TUNJANGAN_AMOUNT = 60000;

  console.log(`🔍 Fetching active employees from ${COLLECTION_NAME}...`);

  const snapshot = await db.collection(COLLECTION_NAME)
    .where('flags.isActive', '==', true)
    .get();

  if (snapshot.empty) {
    console.log('No active employees found.');
    return;
  }

  console.log(`Found ${snapshot.size} active employees. Updating...`);

  const batch = db.batch();
  let count = 0;

  snapshot.forEach(doc => {
    const ref = doc.ref;
    batch.update(ref, {
      'salaryProfile.tunjanganBeras': TUNJANGAN_AMOUNT,
      'audit.updatedAt': admin.firestore.FieldValue.serverTimestamp()
    });
    count++;
  });

  await batch.commit();

  console.log(`✅ Successfully updated ${count} active employees with tunjanganBeras: ${TUNJANGAN_AMOUNT}.`);
}

addTunjanganBeras().catch(err => {
  console.error('❌ Script failed:', err);
  process.exit(1);
});
