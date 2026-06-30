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

const getDeptIndex = (dbDept: string): number => {
  if (!dbDept) return -1;
  const clean = dbDept.trim().toUpperCase();
  if (clean === 'REKTORAT') return 0;
  if (clean === 'PASCASARJANA') return 1;
  if (clean === 'FAK. AGAMA ISLAM') return 2;
  if (clean === 'FAK. BISNIS, BAHASA DAN PENDIDIKAN') return 3;
  if (clean === 'FAK. SAINS DAN TEKNOLOGI') return 4;
  if (clean === 'FAK. ILMU KESEHATAN' || clean === 'FAK. ILMU KESH') return 5;
  if (clean === 'UPT & LEMBAGA' || clean === 'UPT DAN LEMBAGA') return 6;
  return -1;
};

async function main() {
  // Fetch active loyalis employees
  const empSnap = await db.collection('Employees_Loyalis').where('personal_info.status', '==', 'AKTIF').get();
  const loyalisEmployees = empSnap.docs.map(d => {
    const data = d.data();
    return {
      id: d.id,
      name: data.personal_info?.name || '',
      role: data.employment_profile?.job_role || '',
      department: data.employment_profile?.department_unit || '',
    };
  });

  console.log(`Total loyalis employees: ${loyalisEmployees.length}`);

  // Fetch events for June 2026
  const eventSnap = await db.collection('VakasiTambahan').where('period', '==', '2026-06').get();
  const existingEvents = eventSnap.docs.map(d => ({
    id: d.id,
    ...d.data()
  }));

  console.log(`Total events: ${existingEvents.length}`);

  existingEvents.forEach(evt => {
    const workersMap = (evt as any).eventWorkers || {};
    const rowValues = new Array(7).fill(0);
    let hasPayout = false;

    console.log(`\nProcessing Event: ${(evt as any).eventName}`);

    Object.entries(workersMap).forEach(([empId, w]: [string, any]) => {
      const payout = Number(w.payGiven) || 0;
      if (payout <= 0) {
        console.log(`  Worker ${w.employeeName} (${empId}): payout is <= 0 (${w.payGiven})`);
        return;
      }

      const emp = loyalisEmployees.find(e => e.id === empId);
      const dbDept = emp ? emp.department : (w.department || '');
      const idx = getDeptIndex(dbDept);

      console.log(`  Worker ${w.employeeName} (${empId}): payout=${payout}, dbDept="${dbDept}", idx=${idx}`);

      if (idx !== -1) {
        rowValues[idx] += payout;
        hasPayout = true;
      }
    });

    console.log(`  Event ${(evt as any).eventName} hasPayout: ${hasPayout}, rowValues:`, rowValues);
  });
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
