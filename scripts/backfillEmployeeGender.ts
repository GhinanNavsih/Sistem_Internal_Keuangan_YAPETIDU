/**
 * Backfill employee gender in Employees_Loyalis and Employees_BlueCollar
 * based on the Indonesian NIK (Nomor Induk Kependudukan) statutory standard (UU No. 23/2006).
 *
 * In NIK:
 * - Digits 7-8 represent the birth day.
 * - For females: birth day is (day + 40), i.e., 41–71.
 * - For males: birth day is 01–31.
 *
 * Usage:
 *   npx tsx scripts/backfillEmployeeGender.ts           # Dry-run (prints planned updates)
 *   npx tsx scripts/backfillEmployeeGender.ts --apply   # Commits updates to Firestore
 */

import './initEnv';
import admin, { adminDb } from '../src/lib/firebase-admin';
import { deriveGenderFromNik, formatGenderLabel, type Gender } from '../src/lib/payroll/gender';

interface BackfillPlanItem {
  collection: 'Employees_Loyalis' | 'Employees_BlueCollar';
  id: string;
  name: string;
  nik: string;
  derivedGender: Gender;
  currentGender?: string | null;
}

async function main() {
  const isApply = process.argv.includes('--apply');
  console.log(`\n=== EMPLOYEE GENDER BACKFILL SCRIPT ===`);
  console.log(`Mode: ${isApply ? 'LIVE COMMIT (--apply)' : 'DRY RUN (pass --apply to execute)'}\n`);

  const plan: BackfillPlanItem[] = [];
  let alreadySetCount = 0;
  let missingOrInvalidNikCount = 0;

  // 1. Process Employees_Loyalis
  const loyalisSnap = await adminDb.collection('Employees_Loyalis').get();
  console.log(`Found ${loyalisSnap.size} documents in Employees_Loyalis.`);

  loyalisSnap.docs.forEach((doc) => {
    const data = doc.data();
    const nik = data.personal_info?.nik || data.nik || '';
    const currentGender = data.personal_info?.gender || data.gender;
    const derived = deriveGenderFromNik(nik);

    if (derived) {
      if (currentGender === derived) {
        alreadySetCount++;
      } else {
        plan.push({
          collection: 'Employees_Loyalis',
          id: doc.id,
          name: data.personal_info?.name || data.name || doc.id,
          nik,
          derivedGender: derived,
          currentGender,
        });
      }
    } else {
      missingOrInvalidNikCount++;
    }
  });

  // 2. Process Employees_BlueCollar
  const pekaryaSnap = await adminDb.collection('Employees_BlueCollar').get();
  console.log(`Found ${pekaryaSnap.size} documents in Employees_BlueCollar.`);

  pekaryaSnap.docs.forEach((doc) => {
    const data = doc.data();
    const nik = data.nik || data.personal_info?.nik || '';
    const currentGender = data.gender || data.personal_info?.gender;
    const derived = deriveGenderFromNik(nik);

    if (derived) {
      if (currentGender === derived) {
        alreadySetCount++;
      } else {
        plan.push({
          collection: 'Employees_BlueCollar',
          id: doc.id,
          name: data.name || data.personal_info?.name || doc.id,
          nik,
          derivedGender: derived,
          currentGender,
        });
      }
    } else {
      missingOrInvalidNikCount++;
    }
  });

  console.log(`\n--- Plan Summary ---`);
  console.log(`Planned updates: ${plan.length}`);
  console.log(`Already up-to-date: ${alreadySetCount}`);
  console.log(`Missing or invalid NIK: ${missingOrInvalidNikCount}`);

  const femaleCount = plan.filter((p) => p.derivedGender === 'female').length;
  const maleCount = plan.filter((p) => p.derivedGender === 'male').length;
  console.log(`Breakdown of planned updates: ${femaleCount} Female (${formatGenderLabel('female')}), ${maleCount} Male (${formatGenderLabel('male')})\n`);

  // Sample items
  console.log(`Sample Planned Updates (first 10):`);
  plan.slice(0, 10).forEach((item, idx) => {
    console.log(
      `  ${idx + 1}. [${item.collection}] ${item.name} | NIK: ${item.nik} -> ${item.derivedGender.toUpperCase()} (${formatGenderLabel(item.derivedGender)})`,
    );
  });

  if (!isApply) {
    console.log(`\n[DRY RUN COMPLETE] No changes were written. Run with --apply to commit these updates to Firestore.\n`);
    return;
  }

  // Execute batch writes
  console.log(`\nExecuting Firestore batch writes for ${plan.length} documents...`);
  const BATCH_SIZE = 450;
  let batch = adminDb.batch();
  let opCount = 0;
  let totalCommitted = 0;

  for (const item of plan) {
    const docRef = adminDb.collection(item.collection).doc(item.id);
    if (item.collection === 'Employees_Loyalis') {
      batch.update(docRef, {
        'personal_info.gender': item.derivedGender,
        gender: item.derivedGender,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } else {
      batch.update(docRef, {
        gender: item.derivedGender,
        'personal_info.gender': item.derivedGender,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    opCount++;

    if (opCount >= BATCH_SIZE) {
      await batch.commit();
      totalCommitted += opCount;
      console.log(`Committed batch of ${opCount} writes (total so far: ${totalCommitted})...`);
      batch = adminDb.batch();
      opCount = 0;
    }
  }

  if (opCount > 0) {
    await batch.commit();
    totalCommitted += opCount;
    console.log(`Committed final batch of ${opCount} writes.`);
  }

  console.log(`\n[SUCCESS] Successfully updated gender for ${totalCommitted} employees in Firestore!\n`);
}

main().catch((err) => {
  console.error('Fatal error in backfillEmployeeGender:', err);
  process.exit(1);
});
