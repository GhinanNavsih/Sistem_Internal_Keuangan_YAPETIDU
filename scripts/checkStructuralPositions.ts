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

async function check() {
  const snap = await db.collection('Employees_Loyalis').get();
  console.log('Total Loyalis docs:', snap.size);
  let arrayCount = 0;
  let objectCount = 0;
  let nullOrUndefinedCount = 0;
  let otherCount = 0;

  snap.docs.forEach(docSnap => {
    const data = docSnap.data();
    const sp = data.employment_profile?.structural_positions;
    if (sp === null || sp === undefined) {
      nullOrUndefinedCount++;
    } else if (Array.isArray(sp)) {
      arrayCount++;
      if (sp.length > 0 && arrayCount === 1) {
        console.log('Sample Array Item:', docSnap.id, JSON.stringify(sp, null, 2));
      }
    } else if (typeof sp === 'object') {
      objectCount++;
      if (objectCount === 1) {
        console.log('Sample Map/Object Item:', docSnap.id, JSON.stringify(sp, null, 2));
      }
    } else {
      otherCount++;
    }
  });

  console.log({
    arrayCount,
    objectCount,
    nullOrUndefinedCount,
    otherCount
  });
}

check().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
