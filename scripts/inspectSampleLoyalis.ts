import * as admin from 'firebase-admin';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(path.resolve(process.cwd(), 'service-account.json')),
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  });
}
const db = admin.firestore();

async function main() {
  const snap = await db.collection('Employees_Loyalis').limit(1).get();
  if (!snap.empty) {
    const data = snap.docs[0].data();
    console.log('Sample Document ID:', snap.docs[0].id);
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log('No documents found.');
  }
}

main().then(() => process.exit(0));
