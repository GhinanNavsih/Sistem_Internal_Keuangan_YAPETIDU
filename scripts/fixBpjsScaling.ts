import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

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

async function fixBpjsScaling() {
  console.log('🔍 Fetching all employees from Employees_BlueCollar...');
  const snapshot = await db.collection('Employees_BlueCollar').get();
  
  if (snapshot.empty) {
    console.log('No employees found.');
    return;
  }

  const batch = db.batch();
  let count = 0;

  snapshot.forEach(doc => {
    const data = doc.data();
    const bpjs = data.bpjs || {};
    
    // Check if we need to scale up
    // Usually if it's less than 1000, it's the faulty decimal version (e.g. 472.878)
    const allowance = bpjs.allowanceAmount || 0;
    const deduction = bpjs.deductionAmount || 0;

    const newAllowance = allowance * 1000;
    const newDeduction = deduction * 1000;

    batch.update(doc.ref, {
      'bpjs.allowanceAmount': newAllowance,
      'bpjs.deductionAmount': newDeduction,
      'audit.updatedAt': admin.firestore.FieldValue.serverTimestamp()
    });
    
    count++;
  });

  console.log(`🚀 Updating ${count} employees...`);
  await batch.commit();
  console.log('✅ BPJS scaling fix completed!');
}

fixBpjsScaling().catch(err => {
  console.error('❌ Fix failed:', err);
  process.exit(1);
});
