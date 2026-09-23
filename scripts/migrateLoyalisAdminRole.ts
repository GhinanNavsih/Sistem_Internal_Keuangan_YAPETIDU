/**
 * Moves every account still on a retired role id onto `loyalis_admin`.
 *
 * Employee Admin (`employee_admin`) and PJ Presensi Loyalis
 * (`loyalis_presence_admin`) were merged into one role, Loyalis Admin. The app
 * and the Firestore/Storage rules already treat the old ids as `loyalis_admin`,
 * so nobody is locked out before this runs; running it makes the stored
 * profiles match, after which the legacy ids can be dropped from the rules.
 *
 * Only the `role` field changes. Each rewrite is audited in FinancialAuditLogs
 * in the same batch, like a role change made from the Users screen.
 *
 * Usage:
 *   npm run migrate:loyalis-admin-role              # dry run, lists accounts
 *   npm run migrate:loyalis-admin-role -- --apply   # rewrites them
 */
import './initEnv';
import admin, { adminDb } from '../src/lib/firebase-admin';
import { LEGACY_ROLE_ALIASES } from '../src/lib/payroll/roles';

const ACTOR_UID = 'script:migrateLoyalisAdminRole';

async function main() {
  const apply = process.argv.includes('--apply');
  const legacyRoles = Object.keys(LEGACY_ROLE_ALIASES);
  const snapshot = await adminDb.collection('users').where('role', 'in', legacyRoles).get();

  const accounts = snapshot.docs.map((document) => {
    const data = document.data();
    return {
      uid: document.id,
      email: typeof data.email === 'string' ? data.email : null,
      displayName: typeof data.displayName === 'string' ? data.displayName : '',
      disabled: data.disabled === true,
      fromRole: String(data.role),
      toRole: LEGACY_ROLE_ALIASES[String(data.role)],
    };
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        mode: apply ? 'APPLY' : 'DRY_RUN',
        project: admin.app().options.projectId || null,
        accountCount: accounts.length,
        accounts,
      },
      null,
      2,
    )}\n`,
  );

  if (!apply || accounts.length === 0) return;

  // Two writes per account (profile + audit entry), well under the 500 cap.
  for (let offset = 0; offset < accounts.length; offset += 200) {
    const batch = adminDb.batch();
    for (const account of accounts.slice(offset, offset + 200)) {
      const now = admin.firestore.FieldValue.serverTimestamp();
      batch.update(adminDb.collection('users').doc(account.uid), {
        role: account.toRole,
        updatedAt: now,
        updatedByUid: ACTOR_UID,
      });
      batch.create(adminDb.collection('FinancialAuditLogs').doc(), {
        action: 'USER_PROFILE_UPDATED',
        entityType: 'UserProfile',
        entityId: account.uid,
        reason: 'Penggabungan peran Employee Admin dan PJ Presensi Loyalis menjadi Loyalis Admin',
        requestId: null,
        actorUid: ACTOR_UID,
        actorRole: null,
        actorEmail: null,
        before: { role: account.fromRole },
        after: { role: account.toRole },
        metadata: {},
        occurredAt: now,
        schemaVersion: 1,
      });
    }
    await batch.commit();
  }
  process.stdout.write(`Updated ${accounts.length} account(s) to loyalis_admin.\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
