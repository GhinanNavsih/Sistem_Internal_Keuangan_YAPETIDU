/**
 * Gives each Kepala SatKer Loyalis account its SatKer initials, the SatKer code
 * in Surat Keluar numbers (001/BPM/UNIPDU/XI/2026). Initials are saved on the
 * `users` profile as `satkerInitials`, the same field the Users screen edits.
 *
 * Only the accounts listed below are touched, matched by email, and only when
 * they are active Kepala SatKer Loyalis accounts that have no initials yet (one
 * that already has different initials is reported and left alone). The final set
 * must be valid and unique. Each change is audited in FinancialAuditLogs in the
 * same batch, like an edit made from the Users screen.
 *
 * Usage:
 *   tsx scripts/setSatkerInitials.ts            # dry run, shows the plan
 *   tsx scripts/setSatkerInitials.ts --apply    # saves it
 */
import './initEnv';
import admin, { adminDb } from '../src/lib/firebase-admin';
import {
  findSatkerInitialsConflict,
  normalizeSatkerInitials,
  satkerInitialsProblem,
} from '../src/lib/surat-menyurat/satkerInitials';

const ACTOR_UID = 'script:setSatkerInitials';

/** email -> initials, as agreed for each SatKer. */
const INITIALS_BY_EMAIL: Record<string, string> = {
  'bpak@unipdu.ac.id': 'BPAK',
  'bpkm@unipdu.ac.id': 'BPKM',
  'baa@unipdu.ac.id': 'BAA',
  'sdm@unipdu.ac.id': 'BSDM',
  'biroumum@unipdu.ac.id': 'BU',
  'fai@unipdu.ac.id': 'FAI',
  'fbbp1@unipdu.ac.id': 'FBBP',
  'fik@unipdu.ac.id': 'FIK',
  'saintek@unipdu.ac.id': 'FST',
  'humas@unipdu.ac.id': 'HUMAS',
  'lppm@unipdu.ac.id': 'LPPM',
  'lpi@unipdu.ac.id': 'LPI',
  'mkk@unipdu.ac.id': 'MKK',
  'pasca@unipdu.ac.id': 'PASCA',
  'plp@unipdu.ac.id': 'PLP',
  'pmb@unipdu.ac.id': 'PMB',
  'perpus@unipdu.ac.id': 'PERPUS',
  'puskom@unipdu.ac.id': 'PUSKOM',
  'pjm@unipdu.ac.id': 'PJM',
  'psq@unipdu.ac.id': 'PSQ',
  'psa@unipdu.ac.id': 'PSA',
  'psb@unipdu.ac.id': 'PSB',
  'rektorat@unipdu.ac.id': 'SR',
  'ppd@unipdu.ac.id': 'TPPD',
};

interface Head {
  uid: string;
  email: string;
  satkerName: string;
  disabled: boolean;
  satkerInitials: string;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const snapshot = await adminDb.collection('users').where('role', '==', 'satker_head_loyalis').get();
  const heads: Head[] = snapshot.docs.map((document) => {
    const data = document.data();
    return {
      uid: document.id,
      email: String(data.email || '').trim().toLowerCase(),
      satkerName: String(data.satkerName || data.displayName || '').trim(),
      disabled: data.disabled === true,
      satkerInitials: normalizeSatkerInitials(data.satkerInitials),
    };
  });

  const problems: string[] = [];
  const changes: { head: Head; initials: string }[] = [];
  const finalHeads = heads.map((head) => ({ ...head }));

  for (const [email, wanted] of Object.entries(INITIALS_BY_EMAIL)) {
    const initials = normalizeSatkerInitials(wanted);
    const matches = heads.filter((head) => head.email === email && !head.disabled);
    if (matches.length !== 1) {
      problems.push(`${email}: ${matches.length} active Kepala SatKer Loyalis accounts found, expected 1.`);
      continue;
    }
    const head = matches[0];
    const invalid = satkerInitialsProblem(initials);
    if (invalid) {
      problems.push(`${email}: ${invalid}`);
      continue;
    }
    if (head.satkerInitials && head.satkerInitials !== initials) {
      problems.push(`${email}: already has initials ${head.satkerInitials}, not overwritten.`);
      continue;
    }
    if (head.satkerInitials === initials) continue;
    changes.push({ head, initials });
    finalHeads.find((item) => item.uid === head.uid)!.satkerInitials = initials;
  }

  // The result as a whole must be unique, not just each change on its own.
  for (const { head, initials } of changes) {
    const conflict = findSatkerInitialsConflict(initials, finalHeads, head.uid);
    if (conflict) problems.push(`${head.email}: ${initials} would clash with ${conflict.email}.`);
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        mode: apply ? 'APPLY' : 'DRY_RUN',
        project: admin.app().options.projectId || null,
        activeHeads: heads.filter((head) => !head.disabled).length,
        willSet: changes.map(({ head, initials }) => `${head.satkerName} (${head.email}) -> ${initials}`),
        problems,
      },
      null,
      2,
    )}\n`,
  );

  if (problems.length > 0) {
    process.exitCode = 1;
    process.stdout.write('Nothing was saved: fix the problems above first.\n');
    return;
  }
  if (!apply || changes.length === 0) return;

  // Two writes per account (profile + audit entry), well under the 500 cap.
  for (let offset = 0; offset < changes.length; offset += 200) {
    const batch = adminDb.batch();
    for (const { head, initials } of changes.slice(offset, offset + 200)) {
      const now = admin.firestore.FieldValue.serverTimestamp();
      batch.update(adminDb.collection('users').doc(head.uid), {
        satkerInitials: initials,
        updatedAt: now,
        updatedByUid: ACTOR_UID,
      });
      batch.create(adminDb.collection('FinancialAuditLogs').doc(), {
        action: 'USER_PROFILE_UPDATED',
        entityType: 'UserProfile',
        entityId: head.uid,
        reason: 'Pengisian inisial SatKer untuk nomor Surat Keluar',
        requestId: null,
        actorUid: ACTOR_UID,
        actorRole: null,
        actorEmail: null,
        before: { satkerInitials: head.satkerInitials || null },
        after: { satkerInitials: initials },
        metadata: {},
        occurredAt: now,
        schemaVersion: 1,
      });
    }
    await batch.commit();
  }
  process.stdout.write(`Saved initials for ${changes.length} account(s).\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
