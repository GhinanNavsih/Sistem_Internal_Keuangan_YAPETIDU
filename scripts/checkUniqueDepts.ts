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
  const empSnap = await db.collection('Employees_Loyalis').get();
  const depts = new Set<string>();
  empSnap.docs.forEach(doc => {
    const d = doc.data();
    const dept = d.employment_profile?.department_unit;
    if (dept) {
      depts.add(dept);
    }
  });
  console.log("Unique departments in Employees_Loyalis:", Array.from(depts).sort());
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
