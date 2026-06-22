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
  console.log('=== Checking for Skripsi Saintek in any slip ===');
  snap.docs.forEach(doc => {
    const data = doc.data();
    const earnings = data.earnings || [];
    const matched = earnings.filter((e: any) => e.label.includes('Skripsi'));
    if (matched.length > 0) {
      console.log(`Document: ${doc.id} | Status: ${data.status}`);
      matched.forEach((m: any) => {
        console.log(`  - ${m.label}: Rp ${m.amount.toLocaleString('id-ID')}`);
      });
    }
  });
}

run().catch(console.error);
