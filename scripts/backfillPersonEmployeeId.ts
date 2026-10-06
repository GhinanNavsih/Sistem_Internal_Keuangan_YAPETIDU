/**
 * Fills in `personEmployeeId`, the employee a login account belongs to, on
 * accounts made before it existed. "Ganti Peran" (switching between one
 * person's accounts) links accounts by that field, so until it is filled in an
 * account has nothing to switch to. The rules are `planPersonEmployeeIdBackfill`
 * in src/lib/personEmployeeBackfill.ts:
 *   - honorer, loyalis and ketua shift accounts take their linkedEmployeeId;
 *   - other roles take the one active employee whose name matches;
 *   - anything else (no match, several matches, a one-word name, a missing
 *     linked employee) is listed under `needsReview` and left alone, to be set
 *     by hand on the Users page.
 *
 * Each written account gets a FinancialAuditLogs entry in the same batch, like
 * an edit from the Users page. A write is refused if the account changed after
 * it was read (run the script again). A second run finds nothing to do.
 *
 * Usage:
 *   npm run backfill:person-employee-id              # dry run, prints the plan
 *   npm run backfill:person-employee-id -- --apply   # writes the assignments
 */
import './initEnv';
import admin, { adminDb } from '../src/lib/firebase-admin';
import { loadAttendanceEmployeeIdentities } from '../src/lib/server/attendanceStore';
import {
  planPersonEmployeeIdBackfill,
  type BackfillAccount,
} from '../src/lib/personEmployeeBackfill';

const ACTOR_UID = 'script:backfillPersonEmployeeId';

async function main() {
  const apply = process.argv.includes('--apply');
  const [usersSnapshot, { identities }] = await Promise.all([
    adminDb.collection('users').get(),
    loadAttendanceEmployeeIdentities(),
  ]);
  const readAt = new Map(usersSnapshot.docs.map((document) => [document.id, document.updateTime]));
  const accounts: BackfillAccount[] = usersSnapshot.docs.map((document) => ({
    uid: document.id,
    ...document.data(),
  }));
  const plan = planPersonEmployeeIdBackfill(
    accounts,
    identities.map(({ employeeId, name, active }) => ({ employeeId, name, active })),
  );

  const skippedByReason: Record<string, number> = {};
  for (const skip of plan.skipped) {
    skippedByReason[skip.reason] = (skippedByReason[skip.reason] || 0) + 1;
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        mode: apply ? 'APPLY' : 'DRY_RUN',
        project: admin.app().options.projectId || null,
        accountCount: accounts.length,
        assignmentCount: plan.assignments.length,
        needsReviewCount: plan.needsReview.length,
        skippedByReason,
        assignments: plan.assignments,
        needsReview: plan.needsReview,
      },
      null,
      2,
    )}\n`,
  );

  if (!apply || plan.assignments.length === 0) return;

  // Two writes per account (profile + audit entry), well under the 500 cap.
  for (let offset = 0; offset < plan.assignments.length; offset += 200) {
    const batch = adminDb.batch();
    for (const assignment of plan.assignments.slice(offset, offset + 200)) {
      const now = admin.firestore.FieldValue.serverTimestamp();
      batch.update(
        adminDb.collection('users').doc(assignment.uid),
        {
          personEmployeeId: assignment.personEmployeeId,
          updatedAt: now,
          updatedByUid: ACTOR_UID,
        },
        { lastUpdateTime: readAt.get(assignment.uid)! },
      );
      batch.create(adminDb.collection('FinancialAuditLogs').doc(), {
        action: 'USER_PROFILE_UPDATED',
        entityType: 'UserProfile',
        entityId: assignment.uid,
        reason:
          assignment.source === 'linked_employee'
            ? 'Pegawai untuk ganti peran diisi dari pegawai yang dihubungkan ke akun'
            : 'Pegawai untuk ganti peran diisi dari satu-satunya pegawai aktif dengan nama yang sama',
        requestId: null,
        actorUid: ACTOR_UID,
        actorRole: null,
        actorEmail: null,
        before: { personEmployeeId: null },
        after: { personEmployeeId: assignment.personEmployeeId },
        metadata: { source: assignment.source, employeeName: assignment.employeeName },
        occurredAt: now,
        schemaVersion: 1,
      });
    }
    await batch.commit();
  }
  process.stdout.write(`Linked ${plan.assignments.length} account(s) to their employee.\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
