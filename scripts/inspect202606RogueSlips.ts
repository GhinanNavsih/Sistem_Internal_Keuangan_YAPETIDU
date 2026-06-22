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
  console.log('--- Inspecting all 2026_06 slips ---');
  const snap = await db.collection('PayrollSlipStates').get();
  
  snap.docs.forEach(doc => {
    if (doc.id.startsWith('2026_06')) {
      const data = doc.data();
      const earnings = data.earnings || [];
      const matched = earnings.filter((e: any) => 
        e.label.includes('Skripsi') || 
        e.label.includes('DELF') || 
        e.label.includes('Internship') ||
        e.label === 'SPJ'
      );
      if (matched.length > 0) {
        console.log(`Slip: ${doc.id} | Status: ${data.status}`);
        matched.forEach((m: any) => {
          console.log(`  - ${m.label}: Rp ${m.amount.toLocaleString('id-ID')}`);
        });
      }
    }
  });
}

run().catch(console.error);
