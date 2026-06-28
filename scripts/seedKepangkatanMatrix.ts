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
    console.log('Using local service-account.json for authentication...');
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccountPath),
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'internal-bak',
    });
  } else {
    console.log('No local service-account.json found. Falling back to default credentials...');
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'internal-bak',
    });
  }
}

const db = admin.firestore();
const COLLECTION = 'SalaryMatrix_Kepangkatan';

const initialMapping = [
  { credit_score: 100, designation: 'Asisten Ahli', allowance: 35000 },
  { credit_score: 150, designation: 'Asisten Ahli', allowance: 40000 },
  { credit_score: 200, designation: 'Lektor A', allowance: 45000 },
  { credit_score: 300, designation: 'Lektor B', allowance: 50000 },
  { credit_score: 400, designation: 'Lektor Kepala', allowance: 400000 },
  { credit_score: 550, designation: 'Lektor Kepala', allowance: 60000 },
  { credit_score: 700, designation: 'Lektor Kepala', allowance: 65000 },
  { credit_score: 850, designation: 'Guru Besar', allowance: 70000 },
  { credit_score: 1050, designation: 'Guru Besar', allowance: 70000 },
];

async function seed() {
  const activeVersion = '2026_v1';
  const batch = db.batch();

  // 1. _config document — active version
  const configRef = db.collection(COLLECTION).doc('_config');
  batch.set(configRef, { activeVersion }, { merge: true });

  // 2. Version metadata document
  const versionDocRef = db.collection(COLLECTION).doc(activeVersion);
  batch.set(versionDocRef, {
    metadata: {
      name: 'Kepangkatan Allowance Matrix',
      description: 'Master Kepangkatan allowance matrix matching cumulative credit to allowance for Loyalis staff',
      version: activeVersion,
      isActive: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
  }, { merge: true });

  // 3. Row documents in "rows" subcollection — one per credit score
  initialMapping.forEach(item => {
    const docId = String(item.credit_score);
    const rowDocRef = versionDocRef.collection('rows').doc(docId);
    
    batch.set(rowDocRef, {
      credit_score: item.credit_score,
      designation: item.designation,
      allowance: item.allowance,
      isActive: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    
    console.log(`Prepared row: Credit ${item.credit_score} (${item.designation}) -> ${item.allowance}`);
  });

  console.log(`\n🔥 Committing seed to Firestore...`);
  await batch.commit();
  console.log('✅ Kepangkatan matrix seeded successfully!');
}

seed().catch(console.error);
