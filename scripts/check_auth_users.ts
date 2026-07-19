import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const serviceAccountPath = path.resolve(process.cwd(), 'service-account.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccountPath),
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'internal-bak',
  });
}

const db = admin.firestore();
const auth = admin.auth();

async function main() {
  console.log("Fetching all Auth users...");
  const authUsers: admin.auth.UserRecord[] = [];
  let nextPageToken: string | undefined;

  do {
    const result = await auth.listUsers(1000, nextPageToken);
    authUsers.push(...result.users);
    nextPageToken = result.pageToken;
  } while (nextPageToken);

  console.log(`Found ${authUsers.length} users in Firebase Auth.`);

  console.log("Checking Firestore profiles...");
  for (const user of authUsers) {
    const docRef = db.collection('users').doc(user.uid);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      console.log(`⚠️ Missing Firestore profile for Auth User: ${user.email} (UID: ${user.uid})`);
    } else {
      const data = docSnap.data();
      if (data?.email !== user.email) {
        console.log(`⚠️ Email mismatch for UID: ${user.uid}. Auth: ${user.email}, Firestore: ${data?.email}`);
      }
    }
  }
  console.log("Done checking.");
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
