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

function generateFallbackEmail(name: string): string {
  const normalized = name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '') // remove all spaces
    .replace(/[^a-z0-9]/g, ''); // remove special characters
  return `${normalized}@bu.unipdu.ac.id`;
}

async function main() {
  const isCommit = process.argv.includes('--commit');
  console.log('======================================================');
  console.log('UNIPDU INTERNAL KEUANGAN - CREATE SATPAM HONORER ACCOUNTS');
  console.log(`MODE: ${isCommit ? '🔥 COMMIT (WRITE)' : '👀 DRY-RUN (READ-ONLY)'}`);
  console.log('======================================================\n');

  // 1. Fetch all Firestore user accounts
  console.log('🔍 Fetching all existing user accounts from Firestore...');
  const usersSnapshot = await db.collection('users').get();
  
  const existingUserEmails = new Map<string, { uid: string; data: any }>();
  const existingLinkedIds = new Map<string, { uid: string; data: any }>();
  
  usersSnapshot.forEach(doc => {
    const data = doc.data();
    const emailNormalized = (data.email || '').toLowerCase().trim();
    if (emailNormalized) {
      existingUserEmails.set(emailNormalized, { uid: doc.id, data });
    }
    if (data.linkedEmployeeId) {
      existingLinkedIds.set(data.linkedEmployeeId, { uid: doc.id, data });
    }
  });
  console.log(`Fetched ${usersSnapshot.size} total user accounts.\n`);

  // 2. Fetch active SATPAM employees
  console.log('🔍 Fetching active SATPAM from Employees_BlueCollar...');
  const blueCollarSnapshot = await db.collection('Employees_BlueCollar')
    .where('employment.status', '==', 'active')
    .where('employment.jobCategory', '==', 'SATPAM')
    .get();

  const toCreate: { empId: string; name: string; email: string; generatedEmail: boolean }[] = [];
  const toLink: { empId: string; name: string; email: string; userUid: string; currentRole: string }[] = [];
  const toSkipAlreadyLinked: { empId: string; name: string; userUid: string }[] = [];

  blueCollarSnapshot.forEach(doc => {
    const data = doc.data();
    const name = data.name || 'No Name';
    let email = (data.email || '').toLowerCase().trim();
    let generatedEmail = false;

    if (!email) {
      email = generateFallbackEmail(name);
      generatedEmail = true;
    }

    const linkedUser = existingLinkedIds.get(doc.id);
    const emailUser = existingUserEmails.get(email);

    if (linkedUser) {
      toSkipAlreadyLinked.push({ empId: doc.id, name, userUid: linkedUser.uid });
    } else if (emailUser) {
      toLink.push({
        empId: doc.id,
        name,
        email,
        userUid: emailUser.uid,
        currentRole: emailUser.data.role || 'unknown',
      });
    } else {
      toCreate.push({
        empId: doc.id,
        name,
        email,
        generatedEmail,
      });
    }
  });

  // 3. Print summary of SATPAM found
  console.log('═══════════════════════════════════════════════════════');
  console.log('  MIGRATION SUMMARY PREVIEW');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  - Total Active SATPAM found           : ${blueCollarSnapshot.size}`);
  console.log(`  - Already linked to an account        : ${toSkipAlreadyLinked.length}`);
  console.log(`  - To link (email matches existing user): ${toLink.length}`);
  console.log(`  - To create (completely new accounts)  : ${toCreate.length}`);
  console.log('═══════════════════════════════════════════════════════\n');

  if (toLink.length > 0) {
    console.log('🔗 SATPAM to link (existing Firestore users):');
    toLink.forEach(item => {
      console.log(`  - [${item.empId}] ${item.name} (${item.email}) -> Link to UID: ${item.userUid} (Current Role: ${item.currentRole})`);
    });
    console.log('');
  }

  if (toCreate.length > 0) {
    console.log('🆕 New SATPAM accounts to create:');
    toCreate.forEach(item => {
      const generatedMsg = item.generatedEmail ? ' | ⚠️ GENERATED FALLBACK EMAIL' : '';
      console.log(`  - [${item.empId}] ${item.name} (${item.email})${generatedMsg} | Default Password: password123`);
    });
    console.log('');
  }

  if (!isCommit) {
    console.log('✨ Dry run complete! No database updates were performed.');
    console.log('👉 Run with "--commit" to create and link accounts:');
    console.log('   npx tsx scripts/createSatpamHonorerAccounts.ts --commit\n');
    return;
  }

  // 4. Perform link updates for existing accounts
  if (toLink.length > 0) {
    console.log(`🔥 Updating and linking ${toLink.length} existing user profiles...`);
    let linkCount = 0;
    for (const item of toLink) {
      try {
        await db.collection('users').doc(item.userUid).update({
          linkedEmployeeId: item.empId,
          role: 'honorer',
          permittedCategories: ['SATPAM'],
          updatedAt: new Date().toISOString(),
        });
        linkCount++;
        console.log(`   [${linkCount}/${toLink.length}] Linked and updated existing user ${item.email} to ${item.empId} (Role: honorer)`);
      } catch (err) {
        console.error(`   ❌ Failed to link ${item.email} (UID: ${item.userUid}):`, err);
      }
    }
    console.log(`✅ Finished linking existing accounts (${linkCount}/${toLink.length} success).\n`);
  }

  // 4b. Reset passwords for already linked SATPAM accounts
  if (toSkipAlreadyLinked.length > 0) {
    console.log(`🔥 Resetting passwords to "password123" for ${toSkipAlreadyLinked.length} already linked SATPAM accounts...`);
    let resetCount = 0;
    for (const item of toSkipAlreadyLinked) {
      try {
        await auth.updateUser(item.userUid, { password: 'password123' });
        resetCount++;
        console.log(`   [Password Reset] ${item.name} (UID: ${item.userUid})`);
      } catch (err) {
        console.error(`   ❌ Failed to reset password for user ${item.name}:`, err);
      }
    }
    console.log(`✅ Finished resetting passwords (${resetCount}/${toSkipAlreadyLinked.length} success).\n`);
  }

  // 5. Perform creations for new accounts
  if (toCreate.length > 0) {
    console.log(`🔥 Creating ${toCreate.length} new SATPAM user accounts...`);
    let createCount = 0;
    
    for (const item of toCreate) {
      try {
        // If the email was generated, update the Employee document first
        if (item.generatedEmail) {
          await db.collection('Employees_BlueCollar').doc(item.empId).update({
            email: item.email,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          console.log(`   [Employee Updated] Added generated email ${item.email} to employee doc ${item.empId}`);
        }

        let userRecord;
        // Check if user exists in Firebase Auth
        try {
          userRecord = await auth.getUserByEmail(item.email);
          console.log(`   [Auth Exists] ${item.email} (UID: ${userRecord.uid}) - Updating password to password123`);
          await auth.updateUser(userRecord.uid, { password: 'password123' });
        } catch (authErr: any) {
          if (authErr.code === 'auth/user-not-found') {
            userRecord = await auth.createUser({
              email: item.email,
              password: 'password123',
              displayName: item.name,
            });
            console.log(`   [Auth Created] ${item.email} (UID: ${userRecord.uid})`);
          } else {
            throw authErr;
          }
        }

        // Create Firestore user document
        const userProfile = {
          email: item.email,
          displayName: item.name,
          role: 'honorer',
          permittedCategories: ['SATPAM'],
          linkedEmployeeId: item.empId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        await db.collection('users').doc(userRecord.uid).set(userProfile, { merge: true });
        createCount++;
        console.log(`   [Firestore Created] Profile for ${item.email} linked to ${item.empId} (Role: honorer)`);
      } catch (err) {
        console.error(`   ❌ Failed to create/link user ${item.email}:`, err);
      }
    }
    console.log(`✅ Finished creating new accounts (${createCount}/${toCreate.length} success).\n`);
  }

  console.log('🎉 SATPAM honorer accounts creation completed!');
  console.log('──────────────────────────────────────────────────────');
}

main().then(() => process.exit(0)).catch(err => {
  console.error('Fatal error during execution:', err);
  process.exit(1);
});
