import * as admin from 'firebase-admin';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(path.resolve(process.cwd(), 'service-account.json')),
  });
}
const db = admin.firestore();

async function main() {
  const presenceDoc = await db.collection('LoyalisPresence').doc('2026_05').get();
  const presenceData = presenceDoc.data();
  const entries = presenceData?.entries || {};

  const empSnap = await db.collection('Employees_Loyalis').get();
  console.log(`Total employees in Employees_Loyalis: ${empSnap.size}`);
  
  const sample = empSnap.docs.slice(0, 10);
  sample.forEach(doc => {
    const d = doc.data();
    console.log(`ID: ${doc.id}, Name: ${d.personal_info?.name}, Status: ${d.employment_profile?.status}, Department: ${d.employment_profile?.department_unit}`);
  });
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
