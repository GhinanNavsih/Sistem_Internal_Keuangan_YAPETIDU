import './initEnv';
import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';

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

async function run() {
  console.log('Searching all collections for "Skripsi Saintek"...');
  const collections = await db.listCollections();
  
  for (const coll of collections) {
    const snap = await coll.get();
    snap.docs.forEach(doc => {
      const dataStr = JSON.stringify(doc.data());
      if (dataStr.includes('Skripsi Saintek')) {
        console.log(`Found match in collection: "${coll.id}" | Document ID: "${doc.id}"`);
        console.log('Document Data:', JSON.stringify(doc.data(), null, 2));
      }
    });
  }
  console.log('Search finished.');
}

run().catch(console.error);
