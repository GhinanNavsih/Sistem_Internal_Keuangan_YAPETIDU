/** Dry run: npm run repair:satpam-leave-pay -- --period 2026-09
 *  Apply the reviewed repair: add --commit. Closed periods and locked slips are preserved.
 */
import './initEnv';
import { adminDb } from '../src/lib/firebase-admin';
import { repairSatpamApprovedLeavePay } from '../src/lib/server/satpamApprovedLeaveRepair';
import { syncSatpamDutyReconciliation } from '../src/lib/server/satpamDutyPlan';

async function main() {
  const period = process.argv[process.argv.indexOf('--period') + 1];
  if (!process.argv.includes('--period') || !/^\d{4}-\d{2}$/.test(period || '')) throw new Error('Use --period YYYY-MM. Dry run is the default; --commit writes.');
  const commit = process.argv.includes('--commit');
  const requests = await adminDb.collection('SatpamAbsenceRequests').where('period', '==', period).get();
  const results = [];
  for (const snapshot of requests.docs) {
    results.push(await repairSatpamApprovedLeavePay(snapshot.id, Number(snapshot.data().revision || 0), commit));
  }
  let reconciliation;
  if (commit && results.some((result) => result.status === 'repaired')) {
    const view = await syncSatpamDutyReconciliation(period, 'system:satpam-approved-leave-pay-v2');
    reconciliation = { blockers: view.blockers };
  }
  console.log(JSON.stringify({ period, mode: commit ? 'commit' : 'dry-run', results, reconciliation }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
