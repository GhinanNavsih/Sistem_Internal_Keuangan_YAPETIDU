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
  const configSnap = await db.collection('SalaryMatrix_WhiteCollar').doc('_config').get();
  if (!configSnap.exists) {
    console.log('No _config found');
    return;
  }
  const activeVersion = configSnap.data()?.activeVersion;
  const rowsSnap = await db.collection('SalaryMatrix_WhiteCollar').doc(activeVersion).collection('rows').get();

  const dSalaries: Record<number, number> = {};
  rowsSnap.docs.forEach(d => {
    const data = d.data();
    const tahun = data.tahun;
    const salaries = data.salaries || {};
    if (salaries["D"] !== undefined) {
      dSalaries[tahun] = salaries["D"];
    }
  });

  console.log('Years of service and salaries for grade "D":');
  console.log(JSON.stringify(dSalaries, null, 2));
}

main().then(() => process.exit(0));
