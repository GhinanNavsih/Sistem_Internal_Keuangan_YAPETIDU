import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Initialize Firebase Admin
const serviceAccountPath = path.resolve(process.cwd(), 'service-account.json');
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccountPath),
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  });
}
const db = admin.firestore();

async function main() {
  const [loyalisSnap, blueCollarSnap] = await Promise.all([
    db.collection('Employees_Loyalis').limit(1).get(),
    db.collection('Employees_BlueCollar').limit(1).get(),
  ]);

  if (!loyalisSnap.empty) {
    console.log('--- SAMPLE Employees_Loyalis ---');
    console.log(JSON.stringify(loyalisSnap.docs[0].data(), null, 2));
  }

  if (!blueCollarSnap.empty) {
    console.log('\n--- SAMPLE Employees_BlueCollar ---');
    console.log(JSON.stringify(blueCollarSnap.docs[0].data(), null, 2));
  }
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
