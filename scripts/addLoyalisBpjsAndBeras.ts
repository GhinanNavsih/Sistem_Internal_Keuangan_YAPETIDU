import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const serviceAccountPath = path.resolve(process.cwd(), 'service-account.json');

if (!admin.apps.length) {
  if (fs.existsSync(serviceAccountPath)) {
    console.log('Using service-account.json...');
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

async function addLoyalisBpjsAndBeras() {
  const COLLECTION_NAME = 'Employees_Loyalis';
  
  const T_BPJS_TK = 207216;
  const T_BPJS_KES = 166038;
  const BPJS_DEDUCTION = 472878;
  const TUNJANGAN_BERAS = 100000;

  console.log(`🔍 Fetching active employees from ${COLLECTION_NAME}...`);

  const snapshot = await db.collection(COLLECTION_NAME)
    .where('personal_info.status', '==', 'AKTIF')
    .get();

  if (snapshot.empty) {
    console.log('No active Loyalis employees found.');
    return;
  }

  console.log(`Found ${snapshot.size} active Loyalis employees. Updating...`);

  const batch = db.batch();
  let count = 0;

  snapshot.forEach(doc => {
    const ref = doc.ref;
    batch.update(ref, {
      'bpjs.t_bpjs_tk': T_BPJS_TK,
      'bpjs.t_bpjs_kes': T_BPJS_KES,
      'bpjs.deductionAmount': BPJS_DEDUCTION,
      'salaryProfile.tunjanganBeras': TUNJANGAN_BERAS,
      'audit.updatedAt': admin.firestore.FieldValue.serverTimestamp()
    });
    count++;
  });

  await batch.commit();

  console.log(`✅ Successfully updated ${count} active Loyalis employees with:`);
  console.log(`- T. BPJS TK: Rp ${T_BPJS_TK}`);
  console.log(`- T. BPJS KES: Rp ${T_BPJS_KES}`);
  console.log(`- BPJS Deduction: Rp ${BPJS_DEDUCTION}`);
  console.log(`- Beras: Rp ${TUNJANGAN_BERAS}`);
}

addLoyalisBpjsAndBeras().catch(err => {
  console.error('❌ Script failed:', err);
  process.exit(1);
});
