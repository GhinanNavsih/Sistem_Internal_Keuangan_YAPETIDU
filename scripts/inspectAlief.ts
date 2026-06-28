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
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'internal-bak',
    });
  } else {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'internal-bak',
    });
  }
}

const db = admin.firestore();

async function inspectAlief() {
  console.log('🔍 Searching for "Alief" in Employees_Loyalis...');
  const snapshot = await db.collection('Employees_Loyalis').get();
  
  let found = false;
  snapshot.forEach(doc => {
    const data = doc.data();
    const name = data.personal_info?.name || data.name || '';
    if (name.toLowerCase().includes('alief')) {
      console.log(`\n📌 FOUND EMPLOYEE [${doc.id}]:`);
      console.log(JSON.stringify(data, null, 2));
      found = true;
    }
  });

  if (!found) {
    console.log('❌ No employee named "Alief" found.');
  }
}

inspectAlief().catch(console.error);
