import './initEnv';
import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';
import { calculateTotalEarnings } from '../src/utils/salaryCalculator';

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
  const docSnap = await db.collection('Employees_Loyalis').doc('Loyalis_002').get();
  if (!docSnap.exists) {
    console.error('Loyalis_002 not found.');
    return;
  }

  const data = docSnap.data()!;
  console.log('Employee name:', data.personal_info?.name || data.name);
  console.log('Kepangkatan map:', data.kepangkatan);

  // Compute their earnings using actual salaryCalculator logic
  const gapok = 2000000;
  const earningsWithoutAllowance = calculateTotalEarnings({ ...data, kepangkatan: null }, gapok);
  const earningsWithAllowance = calculateTotalEarnings(data, gapok);

  console.log('Total Earnings (without Rank Allowance):', earningsWithoutAllowance);
  console.log('Total Earnings (with Rank Allowance):', earningsWithAllowance);
  console.log('Difference:', earningsWithAllowance - earningsWithoutAllowance);
}

run().catch(console.error);
