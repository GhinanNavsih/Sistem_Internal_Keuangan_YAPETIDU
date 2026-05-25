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

async function inspectEmployees() {
  console.log('🔍 Fetching all Employees_Loyalis documents...');
  const snapshot = await db.collection('Employees_Loyalis').get();
  
  const levels = new Set<string>();
  const list: { id: string, name: string, edu: any }[] = [];
  
  snapshot.forEach(doc => {
    const data = doc.data();
    const name = data.personal?.fullName || data.name || 'No Name';
    const edu = data.academic_and_tier?.education_level;
    if (edu) {
      levels.add(edu);
      list.push({ id: doc.id, name, edu });
    }
  });

  console.log('📌 UNIQUE EDUCATION LEVELS CURRENTLY IN Employees_Loyalis:');
  levels.forEach(lvl => console.log(`- "${lvl}"`));

  console.log('\n📌 SAMPLE EMPLOYEES:');
  list.slice(0, 10).forEach(emp => {
    console.log(`- [${emp.id}] ${emp.name}: "${emp.edu}"`);
  });
}

inspectEmployees().catch(console.error);
