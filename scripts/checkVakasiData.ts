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
  if (presenceDoc.exists) {
    const data = presenceDoc.data();
    console.log('LoyalisPresence 2026_05 metadata:', {
      period: data?.period,
      workingDays: data?.workingDays,
      expectedHours: data?.expectedHours,
      mode: data?.mode,
    });
    console.log('Number of entries:', Object.keys(data?.entries || {}).length);
    
    // Log a few entries
    const entries = data?.entries || {};
    const sampleIds = Object.keys(entries).slice(0, 5);
    sampleIds.forEach(id => {
      console.log(`Entry for ${id} (${entries[id].employeeName}):`, entries[id]);
    });
  } else {
    console.log('No presence doc found for 2026_05.');
  }
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
