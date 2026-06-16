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
  // Check Settings collection
  const settingsSnap = await db.collection('Settings').get();
  console.log('=== Settings Collection ===');
  settingsSnap.docs.forEach(d => {
    console.log(`\n--- ${d.id} ---`);
    console.log(JSON.stringify(d.data(), null, 2));
  });

  // Check EmpEditLog for a sample
  const editLogSnap = await db.collection('EmpEditLog').limit(3).get();
  console.log('\n=== EmpEditLog (sample) ===');
  editLogSnap.docs.forEach(d => {
    console.log(`\n--- ${d.id} ---`);
    console.log(JSON.stringify(d.data(), null, 2));
  });

  // Check a confirmed slip sample to understand the schema
  const slipSnap = await db.collection('PayrollSlipStates').limit(1).get();
  console.log('\n=== PayrollSlipStates Sample ===');
  if (!slipSnap.empty) {
    const d = slipSnap.docs[0];
    console.log(`Doc ID: ${d.id}`);
    const data = d.data();
    console.log(`Status: ${data.status}`);
    console.log(`Earnings count: ${(data.earnings || []).length}`);
    console.log(`Deductions count: ${(data.deductions || []).length}`);
    console.log('Earnings:', JSON.stringify(data.earnings?.slice(0, 5), null, 2));
    console.log('Deductions:', JSON.stringify(data.deductions?.slice(0, 5), null, 2));
  }
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
