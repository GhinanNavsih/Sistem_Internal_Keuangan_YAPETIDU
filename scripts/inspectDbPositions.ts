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
  const ids = ['Loyalis_043', 'Loyalis_185', 'Loyalis_169', 'Loyalis_215'];
  for (const id of ids) {
    const docSnap = await db.collection('Employees_Loyalis').doc(id).get();
    if (docSnap.exists) {
      const data = docSnap.data();
      console.log(`\n=== Document: ${id} ===`);
      console.log('Name:', data?.personal_info?.name);
      console.log('Status:', data?.personal_info?.status);
      console.log('Structural Positions:', JSON.stringify(data?.employment_profile?.structural_positions, null, 2));
    } else {
      console.log(`\n=== Document: ${id} NOT FOUND ===`);
    }
  }
}

main().then(() => process.exit(0));
