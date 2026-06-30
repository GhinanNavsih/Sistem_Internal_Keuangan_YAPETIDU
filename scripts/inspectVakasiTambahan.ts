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
  // Fetch active loyalis employees
  const empSnap = await db.collection('Employees_Loyalis').where('personal_info.status', '==', 'AKTIF').get();
  const loyalisMap = new Map<string, any>();
  empSnap.docs.forEach(doc => {
    const d = doc.data();
    loyalisMap.set(doc.id, {
      id: doc.id,
      name: d.personal_info?.name,
      department: d.employment_profile?.department_unit
    });
  });

  // Fetch events for June 2026 (or any period with events)
  const eventSnap = await db.collection('VakasiTambahan').where('period', '==', '2026-06').get();
  console.log(`Total events in 2026-06: ${eventSnap.size}`);

  eventSnap.docs.forEach(doc => {
    const evt = doc.data();
    console.log(`Event ID: ${doc.id}, Name: ${evt.eventName}`);
    const workersMap = evt.eventWorkers || {};
    
    Object.entries(workersMap).forEach(([empId, w]: [string, any]) => {
      const emp = loyalisMap.get(empId);
      console.log(`  - Worker ID in event: ${empId}`);
      console.log(`    Worker Name in event: ${w.employeeName}, payGiven: ${w.payGiven}`);
      console.log(`    Matched Employee in DB:`, emp ? `Yes (Name: ${emp.name}, Dept: ${emp.department})` : 'NO MATCH');
    });
  });
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
