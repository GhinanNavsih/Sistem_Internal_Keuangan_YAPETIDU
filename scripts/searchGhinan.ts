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
  const snap = await db.collection('Employees_Loyalis').get();
  let found = false;
  snap.docs.forEach(docSnap => {
    const data = docSnap.data();
    const name = data.personal_info?.name || '';
    if (name.toLowerCase().includes('ghinan') || name.toLowerCase().includes('navsih')) {
      found = true;
      console.log(`\n=== Found in Firestore ===`);
      console.log('ID:', docSnap.id);
      console.log('Name:', name);
      console.log('Status:', data.personal_info?.status);
      console.log('Structural Positions:', JSON.stringify(data.employment_profile?.structural_positions, null, 2));
    }
  });
  if (!found) {
    console.log('\n=== NOT FOUND IN FIRESTORE ===');
  }
}

main().then(() => process.exit(0));
