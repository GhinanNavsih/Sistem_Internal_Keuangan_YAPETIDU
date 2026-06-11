import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Initialize Firebase Admin for Internal-BAK
const serviceAccountPath = path.resolve(process.cwd(), 'service-account.json');
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccountPath),
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  });
}
const db = admin.firestore();

async function main() {
  console.log('Fetching sample records with koperasiUserId to verify migration...\n');

  const [loyalisSnap, blueCollarSnap] = await Promise.all([
    db.collection('Employees_Loyalis')
      .where('koperasiUserId', '!=', null)
      .limit(5)
      .get(),
    db.collection('Employees_BlueCollar')
      .where('koperasiUserId', '!=', null)
      .limit(5)
      .get()
  ]);

  console.log(`Found ${loyalisSnap.size} sample Loyalis records.`);
  loyalisSnap.docs.forEach(docSnap => {
    const data = docSnap.data();
    console.log(`- Employee: "${data.personal_info?.name}" (ID: ${docSnap.id})`);
    console.log(`  koperasiUserId:  "${data.koperasiUserId}"`);
    console.log(`  koperasiAuthUid: "${data.koperasiAuthUid}"`);
  });

  console.log(`\nFound ${blueCollarSnap.size} sample Blue Collar records.`);
  blueCollarSnap.docs.forEach(docSnap => {
    const data = docSnap.data();
    console.log(`- Employee: "${data.name}" (ID: ${docSnap.id})`);
    console.log(`  koperasiUserId:  "${data.koperasiUserId}"`);
    console.log(`  koperasiAuthUid: "${data.koperasiAuthUid}"`);
  });

  console.log('\nVerification check complete!');
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
