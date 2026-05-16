import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Initialize Firebase Admin
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

async function migrate() {
  console.log('🚀 Starting migration to top-level collections...');

  // 1. Migrate Employees
  console.log('\n--- Migrating Employees ---');
  const oldEmpRecords = await db.collection('MasterData').doc('Employees').collection('records').get();
  const empBatch = db.batch();
  
  oldEmpRecords.forEach(doc => {
    const newRef = db.collection('Employees').doc(doc.id);
    empBatch.set(newRef, doc.data());
    console.log(`✅ Queued Employee: ${doc.id}`);
  });

  // Migrate Employees Metadata
  const oldEmpMeta = await db.collection('MasterData').doc('Employees').get();
  if (oldEmpMeta.exists) {
    empBatch.set(db.collection('Employees').doc('_metadata'), oldEmpMeta.data()!);
    console.log('✅ Queued Employees Metadata');
  }
  await empBatch.commit();
  console.log('✔️ Employees migration committed.');

  // 2. Migrate SalaryMatrix
  console.log('\n--- Migrating SalaryMatrix ---');
  const matrixBatch = db.batch();
  
  // Config
  const oldMatrixRoot = await db.collection('MasterData').doc('SalaryMatrix').get();
  if (oldMatrixRoot.exists) {
    matrixBatch.set(db.collection('SalaryMatrix').doc('_config'), oldMatrixRoot.data()!);
    console.log('✅ Queued SalaryMatrix Config');
    
    const activeVersion = oldMatrixRoot.data()?.activeVersion || '2026_v1';
    
    // Version Metadata
    const oldVersionMeta = await db.collection('MasterData').doc('SalaryMatrix').collection('versions').doc(activeVersion).get();
    if (oldVersionMeta.exists) {
      matrixBatch.set(db.collection('SalaryMatrix').doc(activeVersion), oldVersionMeta.data()!);
      console.log(`✅ Queued Version Metadata: ${activeVersion}`);
      
      // Rows
      const oldRows = await db.collection('MasterData').doc('SalaryMatrix').collection('versions').doc(activeVersion).collection('rows').get();
      oldRows.forEach(doc => {
        const newRowRef = db.collection('SalaryMatrix').doc(activeVersion).collection('rows').doc(doc.id);
        matrixBatch.set(newRowRef, doc.data());
        console.log(`✅ Queued Salary Row: ${doc.id}`);
      });
    }
  }
  
  await matrixBatch.commit();
  console.log('✔️ SalaryMatrix migration committed.');

  console.log('\n🎉 Migration finished! You can now verify the data in Firebase Console.');
  console.log('Note: The old MasterData collection is still there. You can delete it manually once verified.');
}

migrate().catch(console.error);
