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

async function updateSavingsDeductions() {
  const matchesPath = path.resolve(process.cwd(), 'scripts/savings_matches.json');
  if (!fs.existsSync(matchesPath)) {
    console.error(`❌ Matches file not found at: ${matchesPath}. Please run scripts/matchSavingsDeductions.ts first.`);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(matchesPath, 'utf8'));
  const matchedList = data.matched || [];
  
  console.log(`📊 Loaded ${matchedList.length} matched records from JSON.`);

  const loyalisSnap = await db.collection('Employees_Loyalis')
    .where('personal_info.status', '==', 'AKTIF')
    .get();

  console.log(`👥 Found ${loyalisSnap.size} active Loyalis employees in Firestore.`);

  const dbEmployees = loyalisSnap.docs.map(doc => ({
    id: doc.id,
    ref: doc.ref,
    name: doc.data().personal_info?.name || '',
  }));

  const matchedMap = new Map<string, number>();
  matchedList.forEach((m: any) => {
    matchedMap.set(m.employeeId, m.amount);
  });

  const updates: { ref: admin.firestore.DocumentReference; amount: number; name: string }[] = [];

  // Match and prepare updates
  dbEmployees.forEach(emp => {
    const amount = matchedMap.get(emp.id) || 0;
    updates.push({
      ref: emp.ref,
      amount,
      name: emp.name
    });
  });

  console.log(`\n⚙️ Preparing to update Firestore database:`);
  console.log(`- Active employees to receive Excel deduction amount (> 0): ${matchedList.length}`);
  console.log(`- Active employees to receive Rp 0 deduction: ${dbEmployees.length - matchedList.length}`);
  console.log(`- Total updates: ${updates.length}`);

  // Write changes in batches
  const batchSize = 400;
  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = db.batch();
    const chunk = updates.slice(i, i + batchSize);
    
    chunk.forEach(up => {
      batch.update(up.ref, {
        'savings.deductionAmount': up.amount,
        'audit.updatedAt': admin.firestore.FieldValue.serverTimestamp()
      });
    });

    await batch.commit();
    console.log(`✅ Committed batch of ${chunk.length} updates.`);
  }

  console.log(`\n🎉 Success! Updated Savings deductions (potongan tabungan) for all active Loyalis employees.`);
}

updateSavingsDeductions().catch(console.error);
