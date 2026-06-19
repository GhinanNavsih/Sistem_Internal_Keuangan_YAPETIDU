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

async function main() {
  const checkIds = ['Loyalis_001', 'Loyalis_003', 'Loyalis_005', 'Loyalis_253'];
  
  console.log('🔍 Fetching database records for verification:');
  for (const id of checkIds) {
    const docRef = db.collection('Employees_Loyalis').doc(id);
    const docSnap = await docRef.get();
    
    if (docSnap.exists) {
      const data = docSnap.data() || {};
      const personalInfo = data.personal_info || {};
      console.log(`\nDocument: ${id}`);
      console.log(`- Name:  ${personalInfo.name || data.name || 'No Name'}`);
      console.log(`- Email: ${personalInfo.email}`);
      console.log(`- Phone: ${personalInfo.phone}`);
    } else {
      console.log(`\nDocument: ${id} does not exist!`);
    }
  }
}

main().catch(console.error);
