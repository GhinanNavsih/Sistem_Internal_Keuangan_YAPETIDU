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
const auth = admin.auth();

async function createSuperAdmin() {
  const email = process.argv[2] || 'bak@unipdu.ac.id';
  const password = process.argv[3] || 'bakUnipdu2026!';
  const displayName = process.argv[4] || 'Badan Administrasi Keuangan (BAK)';

  console.log('-----------------------------------');
  console.log('UNIPDU INTERNAL KEUANGAN - SEED ADMIN');
  console.log('-----------------------------------');
  console.log(`Target Email: ${email}`);
  console.log(`Target Name:  ${displayName}`);
  console.log('Checking user existence...');

  try {
    let userRecord;
    try {
      userRecord = await auth.getUserByEmail(email);
      console.log(`User already exists in Firebase Auth with UID: ${userRecord.uid}`);
    } catch (error: any) {
      if (error.code === 'auth/user-not-found') {
        console.log(`Creating user in Firebase Auth...`);
        userRecord = await auth.createUser({
          email,
          password,
          displayName,
        });
        console.log(`Successfully created Auth user with UID: ${userRecord.uid}`);
      } else {
        throw error;
      }
    }

    console.log(`Writing/Updating Firestore user profile...`);
    await db.collection('users').doc(userRecord.uid).set({
      email,
      displayName,
      role: 'super_admin',
      permittedCategories: [], // super_admin bypasses restricted categories checks
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }, { merge: true });

    console.log('\n✅ Seeding completed successfully!');
    console.log('-----------------------------------');
    console.log(`Email:    ${email}`);
    console.log(`Password: ${password}`);
    console.log(`Name:     ${displayName}`);
    console.log('-----------------------------------');
    console.log('You can now log in using these credentials.');

  } catch (error) {
    console.error('❌ Failed to seed Super Admin:', error);
    process.exit(1);
  }
}

createSuperAdmin().catch(console.error);
