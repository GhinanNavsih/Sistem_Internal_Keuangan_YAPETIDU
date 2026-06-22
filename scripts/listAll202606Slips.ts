import './initEnv';
import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';

const serviceAccountPath = path.resolve(process.cwd(), 'service-account.json');

if (!admin.apps.length) {
  if (fs.existsSync(serviceAccountPath)) {
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

async function run() {
  const snap = await db.collection('PayrollSlipStates').get();
  console.log('=== All 2026_06 Slips in DB ===');
  snap.docs.forEach(doc => {
    if (doc.id.startsWith('2026_06')) {
      const data = doc.data();
      console.log(`\nDocument: ${doc.id} | Status: ${data.status}`);
      console.log('Earnings:', JSON.stringify(data.earnings, null, 2));
    }
  });
}

run().catch(console.error);
