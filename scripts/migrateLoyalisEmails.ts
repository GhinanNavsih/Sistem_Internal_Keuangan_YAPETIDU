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
  const matchesPath = path.resolve(process.cwd(), 'loyalis_email_matches.json');
  if (!fs.existsSync(matchesPath)) {
    console.error('❌ Match JSON file not found at: ' + matchesPath);
    console.error('👉 Run npx tsx scripts/generateLoyalisMatches.ts first.');
    process.exit(1);
  }
  
  const matches: any[] = JSON.parse(fs.readFileSync(matchesPath, 'utf-8'));
  console.log(`📋 Read ${matches.length} mapping entries.`);
  
  const isCommit = process.argv.includes('--commit');
  
  let skippedCount = 0;
  let updateCount = 0;
  const updatesToApply: { docId: string, name: string, updates: any }[] = [];
  
  matches.forEach(entry => {
    if (entry.match_status === 'db_only_untouched') {
      skippedCount++;
      return;
    }
    
    if (entry.match_status === 'exact_match' || entry.match_status === 'name_mismatch_warning') {
      const updateData: any = {};
      
      // We always set / overwrite the email and phone with the Excel values (which might be null)
      updateData['personal_info.email'] = entry.email_to_migrate;
      updateData['personal_info.phone'] = entry.phone_to_migrate;
      updateData['audit.updatedAt'] = admin.firestore.FieldValue.serverTimestamp();
      
      updatesToApply.push({
        docId: entry.db_id,
        name: entry.db_name,
        updates: updateData
      });
      updateCount++;
    } else {
      console.warn(`⚠️ Entry has unexpected match_status: ${entry.match_status} for Excel ID ${entry.excel_id}`);
      skippedCount++;
    }
  });
  
  console.log(`\n📊 Migration Plan Summary:`);
  console.log(`- Total records to update: ${updateCount}`);
  console.log(`- Total records skipped/untouched: ${skippedCount}`);
  
  if (!isCommit) {
    console.log('\n👀 --- PREVIEW OF UPDATES (Dry Run, first 10 records) ---');
    updatesToApply.slice(0, 10).forEach(u => {
      console.log(`Document: ${u.docId} (${u.name})`);
      console.log(`  Updating fields:`, JSON.stringify(u.updates, null, 2));
    });
    
    console.log('\n✨ Dry run complete! No changes were written to Firestore.');
    console.log('👉 To write these changes, run with the --commit flag:');
    console.log('   npx tsx scripts/migrateLoyalisEmails.ts --commit\n');
    return;
  }
  
  console.log('\n🔥 Committing updates to Firestore collection "Employees_Loyalis"...');
  
  const chunks: any[][] = [];
  const chunkSize = 400; // Well within batch limit of 500
  for (let i = 0; i < updatesToApply.length; i += chunkSize) {
    chunks.push(updatesToApply.slice(i, i + chunkSize));
  }
  
  let totalWritten = 0;
  for (let c = 0; c < chunks.length; c++) {
    const chunk = chunks[c];
    const batch = db.batch();
    
    chunk.forEach(item => {
      const docRef = db.collection('Employees_Loyalis').doc(item.docId);
      batch.update(docRef, item.updates);
    });
    
    await batch.commit();
    totalWritten += chunk.length;
    console.log(`   [Batch ${c + 1}/${chunks.length}] Wrote ${chunk.length} updates...`);
  }
  
  console.log(`\n✅ Migration completed successfully! Total records updated in Firestore: ${totalWritten}`);
  console.log('──────────────────────────────────────────────────────');
}

main().catch(console.error);
