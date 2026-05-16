import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const serviceAccountPath = path.resolve(process.cwd(), 'service-account.json');

if (!admin.apps.length) {
  if (fs.existsSync(serviceAccountPath)) {
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
const previewPath = path.resolve(process.cwd(), 'tmp/name-update-preview.json');

async function executeNameUpdate() {
  if (!fs.existsSync(previewPath)) {
    console.error('❌ Preview file not found at tmp/name-update-preview.json');
    return;
  }

  const updates = JSON.parse(fs.readFileSync(previewPath, 'utf8'));
  console.log(`🚀 Starting update for ${updates.length} employees...`);

  const batch = db.batch();
  
  for (const item of updates) {
    const ref = db.collection('Employees_BlueCollar').doc(item.employeeId);
    batch.update(ref, {
      name: item.newName,
      'bankAccount.accountHolderName': item.newName,
      'audit.updatedAt': admin.firestore.FieldValue.serverTimestamp()
    });
  }

  await batch.commit();
  console.log('✅ Name updates completed successfully!');
}

executeNameUpdate().catch(err => {
  console.error('❌ Execution failed:', err);
  process.exit(1);
});
