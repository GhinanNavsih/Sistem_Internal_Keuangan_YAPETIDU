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

async function main() {
  const isCommit = process.argv.includes('--commit');
  console.log('======================================================');
  console.log('UNIPDU INTERNAL KEUANGAN - AUTO LINK LOYALIS USERS');
  console.log(`MODE: ${isCommit ? '🔥 COMMIT (WRITE)' : '👀 DRY-RUN (READ-ONLY)'}`);
  console.log('======================================================\n');

  // 1. Fetch all Firestore users
  console.log('🔍 Fetching all existing users from Firestore...');
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

  // 2. Fetch active Loyalis employees
  console.log('🔍 Fetching active Loyalis employees...');
  const loyalisSnapshot = await db.collection('Employees_Loyalis').get();
  
  const toCreate: { empId: string; name: string; email: string; dept: string }[] = [];
  const toLink: { empId: string; name: string; email: string; userUid: string; currentRole: string }[] = [];
  const toSkipAlreadyLinked: { empId: string; name: string; userUid: string }[] = [];
  const toSkipNoEmail: { empId: string; name: string }[] = [];

  loyalisSnapshot.forEach(doc => {
    const data = doc.data();
    const status = data.personal_info?.status || '';
    const name = data.personal_info?.name || 'No Name';
    const email = (data.personal_info?.email || '').toLowerCase().trim();
    const dept = data.employment_profile?.department_unit || '';

    // Only process active employees
    if (status !== 'AKTIF') {
      return;
    }

    if (!email) {
      toSkipNoEmail.push({ empId: doc.id, name });
      return;
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
        dept,
      });
    }
  });

  // 3. Print summaries
  console.log('═══════════════════════════════════════════════════════');
  console.log('  MIGRATION SUMMARY PREVIEW');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  - Already linked: ${toSkipAlreadyLinked.length}`);
  console.log(`  - No email (skipped): ${toSkipNoEmail.length}`);
  console.log(`  - To link (email exists but unlinked): ${toLink.length}`);
  console.log(`  - To create (completely new accounts): ${toCreate.length}`);
  console.log('═══════════════════════════════════════════════════════\n');

  if (toSkipNoEmail.length > 0) {
    console.log('⚠️ Employees missing email address:');
    toSkipNoEmail.forEach(item => {
      console.log(`  - [${item.empId}] ${item.name}`);
    });
    console.log('');
  }

  if (toLink.length > 0) {
    console.log('🔗 Employees to link (existing Firestore users):');
    toLink.forEach(item => {
      console.log(`  - [${item.empId}] ${item.name} (${item.email}) -> Link to UID: ${item.userUid} (Role: ${item.currentRole})`);
    });
    console.log('');
  }

  if (toCreate.length > 0 && !isCommit) {
    console.log('🆕 New accounts to create (sample first 10):');
    toCreate.slice(0, 10).forEach(item => {
      console.log(`  - [${item.empId}] ${item.name} (${item.email}) | Temp Password: password123 | Dept: ${item.dept}`);
    });
    if (toCreate.length > 10) {
      console.log(`  ... and ${toCreate.length - 10} more`);
    }
    console.log('');
  }

  if (!isCommit) {
    console.log('✨ Dry run complete! No database updates were performed.');
    console.log('👉 Run with "--commit" to create and link accounts:');
    console.log('   npx tsx scripts/autoLinkLoyalisUsers.ts --commit\n');
    return;
  }

  // 4. Perform link updates
  if (toLink.length > 0) {
    console.log(`🔥 Linking ${toLink.length} existing user profiles...`);
    let linkCount = 0;
    for (const item of toLink) {
      try {
        await db.collection('users').doc(item.userUid).update({
          linkedEmployeeId: item.empId,
          updatedAt: new Date().toISOString(),
        });
        linkCount++;
        console.log(`   [${linkCount}/${toLink.length}] Linked existing user ${item.email} to ${item.empId}`);
      } catch (err) {
        console.error(`   ❌ Failed to link ${item.email} (UID: ${item.userUid}):`, err);
      }
    }
    console.log(`✅ Finished linking existing accounts (${linkCount}/${toLink.length} success).\n`);
  }

  // 5. Perform creations
  if (toCreate.length > 0) {
    console.log(`🔥 Creating ${toCreate.length} new user accounts...`);
    let createCount = 0;
    
    for (const item of toCreate) {
      try {
        let userRecord;
        // Check if user exists in Firebase Auth but missing Firestore doc
        try {
          userRecord = await auth.getUserByEmail(item.email);
          console.log(`   [Auth Exists] ${item.email} (UID: ${userRecord.uid})`);
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
          role: 'loyalis',
          permittedCategories: item.dept ? [item.dept] : [],
          linkedEmployeeId: item.empId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        await db.collection('users').doc(userRecord.uid).set(userProfile, { merge: true });
        createCount++;
        console.log(`   [Firestore Created] Profile for ${item.email} linked to ${item.empId}`);
      } catch (err) {
        console.error(`   ❌ Failed to create/link user ${item.email}:`, err);
      }
    }
    console.log(`✅ Finished creating new accounts (${createCount}/${toCreate.length} success).\n`);
  }

  console.log('🎉 Execution completed successfully!');
  console.log('──────────────────────────────────────────────────────');
}

main().then(() => process.exit(0)).catch(err => {
  console.error('Fatal error during execution:', err);
  process.exit(1);
});
