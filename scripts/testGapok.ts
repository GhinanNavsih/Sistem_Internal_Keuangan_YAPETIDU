import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

if (getApps().length === 0) {
  initializeApp({
    credential: cert(path.resolve(process.cwd(), 'service-account.json')),
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  });
}
const db = getFirestore();

async function main() {
  const period = '2026_06';
  const employeeId = 'Loyalis_253';
  const docId = `${period}_${employeeId}`;

  const docSnap = await db.collection('PayrollSlipStates').doc(docId).get();
  if (docSnap.exists) {
    console.log(`\n=== Found saved slip in PayrollSlipStates (ID: ${docId}) ===`);
    console.log(JSON.stringify(docSnap.data(), null, 2));
  } else {
    console.log(`\n=== No saved slip found in PayrollSlipStates for ID: ${docId} ===`);
  }
}

main().then(() => process.exit(0));
