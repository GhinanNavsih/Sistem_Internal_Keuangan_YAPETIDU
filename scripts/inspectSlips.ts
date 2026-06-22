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
  console.log('Total slips in DB:', snap.size);
  
  const statusCounts: Record<string, number> = {};
  const periodCounts: Record<string, number> = {};
  snap.docs.forEach(doc => {
    const data = doc.data();
    const status = data.status || 'unknown';
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    const period = data.period || 'unknown';
    periodCounts[period] = (periodCounts[period] || 0) + 1;
  });
  console.log('Status counts:', statusCounts);
  console.log('Period counts:', periodCounts);

  // Print first 5 slips in detail
  console.log('\nSample slips:');
  snap.docs.slice(0, 5).forEach(doc => {
    console.log(`Document ID: ${doc.id}`);
    console.log(`Data:`, JSON.stringify(doc.data(), null, 2));
  });
}

run().catch(console.error);
