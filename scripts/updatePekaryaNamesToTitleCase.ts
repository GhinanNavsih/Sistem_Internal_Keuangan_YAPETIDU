import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const serviceAccountPath = path.resolve(process.cwd(), 'service-account.json');

if (!admin.apps.length) {
  if (fs.existsSync(serviceAccountPath)) {
    console.log('Using service-account.json...');
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

function toTitleCase(name: string): string {
  if (!name) return name;
  return name
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map(word => {
      if (!word) return '';
      // Capitalize first letter of each word
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

async function run() {
  console.log('=== Updating Pekarya Employee Names to Title Case ===');

  // 1. Update Employees_BlueCollar collection
  const blueCollarSnap = await db.collection('Employees_BlueCollar').get();
  console.log(`Found ${blueCollarSnap.size} Pekarya employees in Employees_BlueCollar.`);

  let updatedBlueCollarCount = 0;
  const batch = db.batch();

  for (const docSnap of blueCollarSnap.docs) {
    const data = docSnap.data();
    const currentName = data.name || '';
    const newName = toTitleCase(currentName);

    if (currentName !== newName) {
      console.log(`[Employees_BlueCollar] "${currentName}" -> "${newName}"`);
      batch.update(docSnap.ref, {
        name: newName,
        updatedAt: new Date().toISOString(),
      });
      updatedBlueCollarCount++;
    }
  }

  if (updatedBlueCollarCount > 0) {
    await batch.commit();
    console.log(`Successfully updated ${updatedBlueCollarCount} Pekarya employees to Title Case.`);
  } else {
    console.log('No Employees_BlueCollar names needed updating.');
  }

  // 2. Update SatpamShiftTeams collection (ketuaShiftName)
  const teamsSnap = await db.collection('SatpamShiftTeams').get();
  for (const teamDoc of teamsSnap.docs) {
    const data = teamDoc.data();
    const currentKetuaName = data.ketuaShiftName || '';
    const newKetuaName = toTitleCase(currentKetuaName);

    if (currentKetuaName !== newKetuaName) {
      console.log(`[SatpamShiftTeams] "${currentKetuaName}" -> "${newKetuaName}"`);
      await teamDoc.ref.update({
        ketuaShiftName: newKetuaName,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  // 3. Update users collection (displayName for Pekarya users)
  const usersSnap = await db.collection('users').get();
  for (const userDoc of usersSnap.docs) {
    const data = userDoc.data();
    const currentDisplayName = data.displayName || '';
    const newDisplayName = toTitleCase(currentDisplayName);

    if ((data.role === 'honorer' || data.role === 'ketua_shift_satpam') && currentDisplayName !== newDisplayName) {
      console.log(`[users] "${currentDisplayName}" -> "${newDisplayName}"`);
      await userDoc.ref.update({
        displayName: newDisplayName,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  console.log('=== Title Case Name Update Completed Successfully ===');
  process.exit(0);
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
