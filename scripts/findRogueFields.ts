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
  console.log('--- 1. Querying VakasiTambahan for events ---');
  const vakasiSnap = await db.collection('VakasiTambahan').get();
  console.log(`Total VakasiTambahan docs in DB: ${vakasiSnap.size}`);
  vakasiSnap.docs.forEach(doc => {
    const data = doc.data();
    console.log(`Document ID: ${doc.id} | Period: ${data.period} | Event: "${data.eventName}" | Status: ${data.status}`);
  });

  console.log('\n--- 2. Searching PayrollSlipStates for rogue fields ---');
  const slipSnap = await db.collection('PayrollSlipStates').get();
  console.log(`Total slips in DB: ${slipSnap.size}`);
  
  const matches: any[] = [];
  slipSnap.docs.forEach(doc => {
    const data = doc.data();
    const earnings = data.earnings || [];
    const hasRogue = earnings.some((e: any) => 
      e.label.includes('Skripsi') || 
      e.label.includes('DELF') || 
      e.label === 'SPJ'
    );
    if (hasRogue) {
      matches.push({
        id: doc.id,
        status: data.status,
        period: data.period,
        employeeId: data.employeeId,
        matchedEarnings: earnings.filter((e: any) => 
          e.label.includes('Skripsi') || 
          e.label.includes('DELF') || 
          e.label === 'SPJ'
        )
      });
    }
  });

  console.log(`Found ${matches.length} matching slips with rogue fields:`);
  matches.forEach(m => {
    console.log(JSON.stringify(m, null, 2));
  });
}

run().catch(console.error);
