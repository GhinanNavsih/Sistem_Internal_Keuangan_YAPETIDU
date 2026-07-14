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
const auth = admin.auth();

const targetUids = [
  '5OfhHtXxlTfxO0KC62qbfTQTByr1', // Loyalis_197
  'PNewZGuj1xdrC59Kot3gdFWlLW43', // Loyalis_246
  'v6f5gnvgE2fmynAs1zuTAlr7AHi1', // Loyalis_185
  'xDngYyrnGib9sjp5cF2d2mgjSbj2'  // Loyalis_059
];

async function main() {
  console.log('======================================================');
  console.log('UNIPDU INTERNAL KEUANGAN - VERIFY REACTIVATIONS');
  console.log('======================================================\n');

  // 1. Verify User disabled status in Firebase Auth
  console.log('🔍 Checking Firebase Auth disabled status...');
  for (const uid of targetUids) {
    try {
      const userRecord = await auth.getUser(uid);
      console.log(`  - [UID: ${uid}] ${userRecord.displayName} (${userRecord.email}): disabled = ${userRecord.disabled}`);
    } catch (err: any) {
      console.error(`  - ❌ Failed to get auth record for UID ${uid}:`, err.message);
    }
  }

  // 2. Verify Reactivation Tokens in Firestore
  console.log('\n🔍 Checking reactivation_tokens in Firestore...');
  const tokensSnapshot = await db.collection('reactivation_tokens').where('uid', 'in', targetUids).get();
  console.log(`Found ${tokensSnapshot.size} tokens in reactivation_tokens collection.`);
  
  tokensSnapshot.forEach(doc => {
    const data = doc.data();
    console.log(`  - Token: ${doc.id.substring(0, 10)}...`);
    console.log(`    UID: ${data.uid}`);
    console.log(`    Email: ${data.email}`);
    console.log(`    DisplayName: ${data.displayName}`);
    console.log(`    ExpiresAt: ${data.expiresAt}`);
    console.log(`    Used: ${data.used}`);
  });
}

main().catch(console.error);
