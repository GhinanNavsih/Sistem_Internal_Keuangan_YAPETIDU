/** Preview by default. --apply writes only missing immutable metadata and its audit. */
import { adminDb, default as admin } from '../src/lib/firebase-admin';

async function main() {
  const apply = process.argv.includes('--apply');
  const idsArgument = process.argv.find(arg => arg.startsWith('--ids='));
  const ids = idsArgument ? new Set(idsArgument.slice(6).split(',').filter(Boolean)) : null;
  const [proposals, creationAudits] = await Promise.all([
    adminDb.collection('ProposalKegiatan').get(),
    adminDb.collection('FinancialAuditLogs').where('entityType', '==', 'ProposalKegiatan').where('before', '==', null).get(),
  ]);
  const evidence = new Map<string, FirebaseFirestore.DocumentData>();
  for (const snapshot of creationAudits.docs) {
    const audit = snapshot.data();
    if (audit.action === 'PROPOSAL_KEGIATAN_SAVE_DRAFT' || audit.action === 'PROPOSAL_KEGIATAN_SUBMIT_PROPOSAL') {
      const previous = evidence.get(audit.entityId);
      if (!previous || audit.occurredAt?.toMillis() < previous.occurredAt?.toMillis()) evidence.set(audit.entityId, audit);
    }
  }
  const results = [];
  for (const snapshot of proposals.docs) {
    if (ids && !ids.has(snapshot.id)) continue;
    const before = snapshot.data();
    const patch: FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData> = {};
    if (!before.createdAt) patch.createdAt = snapshot.createTime;
    const creation = evidence.get(snapshot.id);
    if (!before.creatorRole && creation && creation.actorUid === before.submittedBy && typeof creation.actorRole === 'string') patch.creatorRole = creation.actorRole;
    if (!Object.keys(patch).length) continue;
    if (apply) await adminDb.runTransaction(async transaction => {
      const current = await transaction.get(snapshot.ref);
      if (!current.exists || !current.createTime?.isEqual(snapshot.createTime!)) throw new Error(`Document changed identity: ${snapshot.id}`);
      const update = { ...patch };
      if (current.data()?.createdAt) delete update.createdAt;
      if (current.data()?.creatorRole) delete update.creatorRole;
      if (!Object.keys(update).length) return;
      transaction.update(snapshot.ref, update);
      transaction.create(adminDb.collection('FinancialAuditLogs').doc(), {
        action: 'PROPOSAL_KEGIATAN_BACKFILL_METADATA', entityType: 'ProposalKegiatan', entityId: snapshot.id,
        actorUid: 'system:backfill-proposal-metadata', actorRole: 'system', actorEmail: null,
        reason: 'Restore immutable creation metadata from Firestore and creation audit evidence',
        before: { createdAt: before.createdAt || null, creatorRole: before.creatorRole || null }, after: update,
        metadata: { timestampSource: 'firestore.createTime', creatorRoleSource: 'creation_audit' },
        occurredAt: admin.firestore.FieldValue.serverTimestamp(), schemaVersion: 1,
      });
    });
    results.push({ id: snapshot.id, createdAt: patch.createdAt ? snapshot.createTime!.toDate().toISOString() : undefined, creatorRole: patch.creatorRole });
  }
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', eventsScanned: proposals.size, eventsToUpdate: results.length,
    timestampsToRestore: results.filter(result => result.createdAt).length, creatorRolesRecovered: results.filter(result => result.creatorRole).length,
    unresolvedCreatorRoles: proposals.docs.filter(snapshot => !snapshot.data().creatorRole && evidence.get(snapshot.id)?.actorUid !== snapshot.data().submittedBy).length,
    changes: results }, null, 2));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => admin.app().delete());
