// @ts-nocheck
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const serviceAccount = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), 'service-account.json'), 'utf8')
);

try {
  initializeApp({
    credential: cert(serviceAccount)
  });
} catch (e) {}

const db = getFirestore();

async function run() {
  const period = '2026_06';
  console.log('=== Inspecting ANDIK PRIYO UTOMO ===');
  
  // 1. Find employee in Blue Collar
  const bcSnap = await db.collection('Employees_BlueCollar').get();
  let employee: any = null;
  for (const doc of bcSnap.docs) {
    const data = doc.data();
    if (data.name?.toUpperCase().includes('ANDIK PRIYO UTOMO')) {
      employee = { id: doc.id, ...data };
      break;
    }
  }

  if (!employee) {
    console.log('Employee not found in Blue Collar.');
    return;
  }

  console.log('Employee Profile:', JSON.stringify(employee, null, 2));

  // 2. Check saved slip
  const slipDoc = await db.collection('PayrollSlipStates').doc(`${period}_${employee.id}`).get();
  if (slipDoc.exists) {
    console.log('Saved Slip:', JSON.stringify(slipDoc.data(), null, 2));
  } else {
    console.log('No saved slip found.');
  }

  // 3. Check UraianGaji for SATPAM
  const uraianDoc = await db.collection('UraianGaji').doc(`${period}_SATPAM`).get();
  if (uraianDoc.exists) {
    const data = uraianDoc.data();
    console.log('UraianGaji Entry for him:', JSON.stringify(data?.entries?.[employee.id], null, 2));
  } else {
    console.log('No UraianGaji found for SATPAM.');
  }
}

run().catch(console.error);
