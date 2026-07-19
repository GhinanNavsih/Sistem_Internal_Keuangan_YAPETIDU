import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const serviceAccountPath = path.resolve(process.cwd(), 'service-account.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccountPath),
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'internal-bak',
  });
}

const db = admin.firestore();

async function main() {
  console.log("Fetching Satpam Honorer users...");
  const snapshot = await db.collection('users')
    .where('role', '==', 'honorer')
    .get();

  console.log(`Found ${snapshot.size} honorer users.`);
  snapshot.forEach(doc => {
    const data = doc.data();
    if (data.permittedCategories && data.permittedCategories.includes('SATPAM')) {
      console.log(`ID: ${doc.id}`);
      console.log(JSON.stringify(doc.data(), null, 2));
      console.log('---');
    }
  });
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
