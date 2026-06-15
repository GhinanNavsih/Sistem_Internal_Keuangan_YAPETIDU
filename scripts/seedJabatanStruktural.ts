import './initEnv';
import * as admin from 'firebase-admin';
import * as xlsx from 'xlsx';
import * as path from 'path';
import * as fs from 'fs';

const serviceAccountPath = path.resolve(process.cwd(), 'service-account.json');

if (!admin.apps.length) {
  if (fs.existsSync(serviceAccountPath)) {
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
const collectionName = 'JabatanStruktural';

async function run() {
  const isCommit = process.argv.includes('--commit');

  console.log(`Reading Excel file to parse positions...`);
  const filePath = path.resolve(process.cwd(), 'Tunjangan Struktural Jabatan.xlsx');
  const workbook = xlsx.readFile(filePath);
  const sheet = workbook.Sheets['Sheet1'];
  const rows = xlsx.utils.sheet_to_json<any[]>(sheet, { header: 1 });

  const uniquePositions = new Map<string, { allowance: number; satker: string }>();

  rows.slice(1).forEach((row) => {
    if (!row || row.length === 0) return;
    const jabatanVal = row[0];
    const tunjVal = row[1];
    const satkerVal = row[2];

    if (!jabatanVal || String(jabatanVal).trim() === '') return;

    const name = String(jabatanVal).trim();
    let satker = satkerVal ? String(satkerVal).trim() : '';
    if (satker === 'FAK. ILMU KESH') {
      satker = 'FAK. ILMU KESEHATAN';
    }
    const allowance = Number(tunjVal) || 0;

    const existing = uniquePositions.get(name);
    if (existing) {
      if (existing.allowance !== allowance || existing.satker !== satker) {
        console.log(`⚠️ Warning: Duplicate position "${name}" has differing data. Existing: ${existing.allowance} [${existing.satker}], New: ${allowance} [${satker}]. Keeping higher allowance.`);
        if (allowance > existing.allowance) {
          uniquePositions.set(name, { allowance, satker });
        }
      }
    } else {
      uniquePositions.set(name, { allowance, satker });
    }
  });

  console.log(`Parsed ${uniquePositions.size} unique structural positions.`);

  if (!isCommit) {
    console.log('\n--- DRY RUN PREVIEW (First 10 positions) ---');
    const previewArray = Array.from(uniquePositions.entries());
    previewArray.slice(0, 10).forEach(([name, data]) => {
      console.log(`- "${name}" => Satker: "${data.satker}", Allowance: Rp ${data.allowance.toLocaleString('id-ID')}`);
    });
    console.log('\n👉 To clear the database collection and commit these entries, run:');
    console.log('   npx tsx scripts/seedJabatanStruktural.ts --commit');
    return;
  }

  // Clear existing collection
  console.log(`\n🧹 Clearing existing documents in collection "${collectionName}"...`);
  const snap = await db.collection(collectionName).get();
  const docs = snap.docs;
  console.log(`Found ${docs.length} documents to delete.`);
  
  const deleteBatchSize = 400;
  for (let i = 0; i < docs.length; i += deleteBatchSize) {
    const batch = db.batch();
    docs.slice(i, i + deleteBatchSize).forEach(doc => {
      batch.delete(doc.ref);
    });
    await batch.commit();
    console.log(`   Deleted docs ${i + 1} to ${Math.min(i + deleteBatchSize, docs.length)}`);
  }

  // Seed new documents
  console.log(`\n🔥 Seeding ${uniquePositions.size} documents to "${collectionName}"...`);
  const writeBatchSize = 400;
  const entries = Array.from(uniquePositions.entries());
  
  for (let i = 0; i < entries.length; i += writeBatchSize) {
    const batch = db.batch();
    entries.slice(i, i + writeBatchSize).forEach(([name, data]) => {
      // Create a doc reference with a sanitized ID to avoid duplicates and symbols issues
      const docRef = db.collection(collectionName).doc();
      batch.set(docRef, {
        name,
        allowance: data.allowance,
        satker: data.satker
      });
    });
    await batch.commit();
    console.log(`   Seeded docs ${i + 1} to ${Math.min(i + writeBatchSize, entries.length)}`);
  }

  console.log('\n✅ Seeding completed successfully!');
}

run().catch(console.error);
