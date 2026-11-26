/**
 * Deletes every Ajuan Duka (kind 'duka') in BansosRequests, plus its proof
 * file in Storage. Ajuan Duka is no longer submitted; Ajuan Melahirkan is not
 * touched. Duka never has a Vakasi event or a payroll slip row, so nothing
 * else refers to these requests.
 *
 * Kind is read with serializeBansosRequest, the same rule the app uses, so a
 * record with a missing or unknown kind counts as Duka here too.
 *
 * Each deletion writes a FinancialAuditLogs entry holding the removed
 * request's details, so what was removed stays on record. Duka already handed
 * over in cash is included; the dry run reports those separately.
 *
 * Dry run is the default:
 *   npx tsx scripts/deleteDukaSantunanRequests.ts
 *
 * Apply only after reviewing the output:
 *   npx tsx scripts/deleteDukaSantunanRequests.ts --apply
 *
 * Optional, to delete only some of them (IDs are still checked to be Duka):
 *   npx tsx scripts/deleteDukaSantunanRequests.ts --apply --ids=ID1,ID2
 */
import { adminDb, adminStorage } from '../src/lib/firebase-admin';
import { BANSOS_REQUESTS_COLLECTION } from '../src/lib/payroll/santunan';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '../src/lib/server/audit';
import type { AuthenticatedProfile } from '../src/lib/server/auth';
import { serializeBansosRequest } from '../src/lib/server/santunan';

const REASON = 'Ajuan Duka dihapus: pengajuan Duka dihentikan (scripts/deleteDukaSantunanRequests.ts).';

const actor: AuthenticatedProfile = {
  uid: 'script:deleteDukaSantunanRequests',
  email: null,
  role: 'super_admin',
  displayName: 'deleteDukaSantunanRequests script',
  permittedCategories: [],
};

function allowedIds(): Set<string> | null {
  const arg = process.argv.find((value) => value.startsWith('--ids='));
  if (!arg) return null;
  return new Set(arg.slice('--ids='.length).split(',').map((id) => id.trim()).filter(Boolean));
}

async function main() {
  const apply = process.argv.includes('--apply');
  const ids = allowedIds();

  const snapshot = await adminDb.collection(BANSOS_REQUESTS_COLLECTION).get();
  const targets = snapshot.docs
    .map((doc) => ({ id: doc.id, request: serializeBansosRequest(doc.id, doc.data()) }))
    .filter(({ request }) => request.kind === 'duka')
    .filter(({ id }) => !ids || ids.has(id));

  console.log(`mode: ${apply ? 'APPLY' : 'DRY_RUN'}`);
  console.log(`BansosRequests: ${snapshot.size} dokumen; Ajuan Duka yang dipilih: ${targets.length}`);
  if (ids) {
    const missing = [...ids].filter((id) => !targets.some((target) => target.id === id));
    if (missing.length) console.log(`bukan Ajuan Duka atau tidak ditemukan (dilewati): ${missing.join(', ')}`);
  }

  const handedOver = targets.filter(({ request }) => request.handedOver);
  const handedOverTotal = handedOver.reduce((sum, { request }) => sum + (request.amount || 0), 0);
  console.log(`sudah diserahkan tunai: ${handedOver.length} ajuan, total Rp ${handedOverTotal.toLocaleString('id-ID')}`);

  for (const { id, request } of targets) {
    console.log(
      `  ${id} | ${request.status} | ${request.employeeName || request.employeeId} | ${request.eventDate} | ` +
      `Rp ${(request.amount || 0).toLocaleString('id-ID')} | diserahkan: ${request.handedOver ? 'ya' : 'tidak'}`,
    );
  }

  if (!apply) {
    console.log(`\nakan dihapus jika --apply: ${targets.length} ajuan Duka beserta bukti di Storage.`);
    return;
  }

  let deleted = 0;
  const orphanedProofs: string[] = [];
  for (const { id } of targets) {
    const ref = adminDb.collection(BANSOS_REQUESTS_COLLECTION).doc(id);
    // Re-read in the transaction: skipped if it is gone or is no longer Duka.
    const outcome = await adminDb.runTransaction(async (transaction) => {
      const current = await transaction.get(ref);
      if (!current.exists) return null;
      const data = current.data()!;
      const request = serializeBansosRequest(current.id, data);
      if (request.kind !== 'duka') return null;

      transaction.delete(ref);
      transaction.create(newFinancialAuditRef(), buildFinancialAuditRecord(actor, {
        action: 'BANSOS_DUKA_DELETED',
        entityType: BANSOS_REQUESTS_COLLECTION,
        entityId: current.id,
        reason: REASON,
        before: {
          kind: request.kind,
          employeeId: request.employeeId,
          employeeName: request.employeeName,
          eventDate: request.eventDate,
          subjectName: request.subjectName,
          status: request.status,
          amount: request.amount ?? null,
          handedOver: request.handedOver,
          handedOverAt: request.handedOverAt ?? null,
          proofName: request.proofName,
        },
        after: null,
      }));
      return { proofPath: String(data.proofPath || '') };
    });

    if (!outcome) continue;
    deleted += 1;
    if (outcome.proofPath) {
      // The request is already gone; a failed proof delete leaves only the file.
      await adminStorage.bucket().file(outcome.proofPath).delete({ ignoreNotFound: true }).catch((cause) => {
        orphanedProofs.push(outcome.proofPath);
        console.error(`bukti gagal dihapus ${outcome.proofPath}:`, cause);
      });
    }
  }

  console.log(`\ndihapus: ${deleted} ajuan Duka`);
  if (orphanedProofs.length) {
    console.log(`bukti yang perlu dihapus manual di Storage:\n  ${orphanedProofs.join('\n  ')}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
