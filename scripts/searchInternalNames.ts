import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Initialize Firebase
const serviceAccountPath = path.resolve(process.cwd(), 'service-account.json');
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccountPath),
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  });
}
const db = admin.firestore();

async function main() {
  const [loyalisSnap, blueCollarSnap] = await Promise.all([
    db.collection('Employees_Loyalis').get(),
    db.collection('Employees_BlueCollar').get(),
  ]);

  const allNames: string[] = [];
  loyalisSnap.docs.forEach(d => {
    const name = d.data().personal_info?.name;
    if (name) allNames.push(`Loyalis: "${name}"`);
  });
  blueCollarSnap.docs.forEach(d => {
    const name = d.data().name;
    if (name) allNames.push(`BlueCollar: "${name}"`);
  });

  const searchTerms = ['Afsah', 'Mundzir', 'Zahro', 'Puspita', 'Sabrina'];

  console.log('─── Database Search Results ───\n');
  searchTerms.forEach(term => {
    console.log(`Searching for "${term}":`);
    const matches = allNames.filter(n => n.toLowerCase().includes(term.toLowerCase()));
    if (matches.length > 0) {
      matches.forEach(m => console.log(`  → ${m}`));
    } else {
      console.log('  → No matches found');
    }
    console.log('');
  });
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
