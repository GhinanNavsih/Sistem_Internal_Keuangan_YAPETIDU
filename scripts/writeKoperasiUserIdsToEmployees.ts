import * as admin from 'firebase-admin';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// ─── Initialize Firebase Admin for Internal-BAK ───
const serviceAccountPath = path.resolve(process.cwd(), 'service-account.json');

if (!admin.apps.length) {
  if (fs.existsSync(serviceAccountPath)) {
    console.log('Using service-account.json for Internal-BAK...');
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
const dbInternal = admin.firestore();

// ─── Initialize Firebase Client for Koperasi Unipdu ───
const secondaryConfig = {
  apiKey: "AIzaSyB_sA0peKgiDudDGks0RNlwq6cB0IOer1M",
  authDomain: "koperasi-unipdu.firebaseapp.com",
  projectId: "koperasi-unipdu",
  storageBucket: "koperasi-unipdu.firebasestorage.app",
  messagingSenderId: "10094241377",
  appId: "1:10094241377:web:1b11e23f8479306733ec20"
};

const appKoperasi = initializeApp(secondaryConfig);
const dbKoperasi = getFirestore(appKoperasi);

async function main() {
  const isCommit = process.argv.includes('--commit');
  console.log(`Starting migration script in ${isCommit ? 'COMMIT' : 'DRY-RUN'} mode...\n`);

  // 1. Load the name matching json
  const matchPath = path.resolve(process.cwd(), 'koperasi_users_name_matching.json');
  if (!fs.existsSync(matchPath)) {
    console.error(`Error: Match file not found at ${matchPath}`);
    process.exit(1);
  }
  
  const matchData = JSON.parse(fs.readFileSync(matchPath, 'utf8'));
  const matchedList = matchData.matched || [];
  console.log(`Loaded ${matchedList.length} matched users from ${matchPath}`);

  // 2. Fetch Koperasi users to get their Auth UIDs
  console.log('Fetching all users from Koperasi to map Auth UIDs...');
  const userSnapshot = await getDocs(collection(dbKoperasi, 'users'));
  console.log(`Fetched ${userSnapshot.size} users from Koperasi.`);

  const uidMap = new Map<string, string>();
  userSnapshot.docs.forEach(docSnap => {
    const data = docSnap.data();
    const uid = data.uid || docSnap.id;
    uidMap.set(docSnap.id, uid);
  });

  console.log(`Mapped ${uidMap.size} Koperasi users to their Auth UIDs.\n`);

  let successCount = 0;
  let missingUidCount = 0;
  let errorCount = 0;

  // 3. Process matches
  for (const item of matchedList) {
    const { koperasiDocId, koperasiName, internalName, internalDocId, internalCollection } = item;
    const authUid = uidMap.get(koperasiDocId);

    if (!authUid) {
      console.warn(`[WARNING] No Koperasi Auth UID found for user "${koperasiName}" (Doc ID: ${koperasiDocId})`);
      missingUidCount++;
      continue;
    }

    if (isCommit) {
      try {
        const docRef = dbInternal.collection(internalCollection).doc(internalDocId);
        await docRef.update({
          koperasiUserId: koperasiDocId,
          koperasiAuthUid: authUid,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`[UPDATED] "${internalName}" (${internalCollection}/${internalDocId}) → koperasiUserId: "${koperasiDocId}", koperasiAuthUid: "${authUid}"`);
        successCount++;
      } catch (err) {
        console.error(`[ERROR] Failed to update "${internalName}" (${internalDocId}):`, err);
        errorCount++;
      }
    } else {
      console.log(`[DRY-RUN] Will update "${internalName}" (${internalCollection}/${internalDocId}) → koperasiUserId: "${koperasiDocId}", koperasiAuthUid: "${authUid}"`);
      successCount++;
    }
  }

  console.log('\n=======================================');
  console.log('MIGRATION SUMMARY:');
  console.log('=======================================');
  console.log(`Mode: ${isCommit ? 'COMMIT' : 'DRY-RUN'}`);
  console.log(`Total Matched: ${matchedList.length}`);
  console.log(`Successfully mapped/updated: ${successCount}`);
  console.log(`Missing Auth UIDs: ${missingUidCount}`);
  console.log(`Errors encountered: ${errorCount}`);
  console.log('=======================================\n');

  if (!isCommit) {
    console.log('To apply these changes to the Firestore database, run this script with --commit:');
    console.log('  npx tsx scripts/writeKoperasiUserIdsToEmployees.ts --commit');
  }
}

main().then(() => process.exit(0)).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
