/** Dry run: npm run repair:satpam-leave-pay -- --period 2026-09
 *  Apply the reviewed repair: add --commit. Closed periods and locked slips are preserved.
 */
import './initEnv';
import { adminDb } from '../src/lib/firebase-admin';
import { repairSatpamApprovedLeavePay } from '../src/lib/server/satpamApprovedLeaveRepair';
import { buildSatpamDutyReconciliation, syncSatpamDutyReconciliation } from '../src/lib/server/satpamDutyPlan';

async function main() {
  const period = process.argv[process.argv.indexOf('--period') + 1];
  if (!process.argv.includes('--period') || !/^\d{4}-\d{2}$/.test(period || '')) throw new Error('Use --period YYYY-MM. Dry run is the default; --commit writes.');
  const commit = process.argv.includes('--commit');
  const requestedIds = new Set(process.argv.flatMap((argument, index) => {
    if (argument !== '--request-id') return [];
    const id = process.argv[index + 1] || '';
    if (!/^[A-Za-z0-9_-]{1,180}$/.test(id)) throw new Error('Use --request-id REQUEST_ID (repeat to restrict a repair).');
    return [id];
  }));
  const [projectedView, storedReconciliations] = await Promise.all([
    buildSatpamDutyReconciliation(period),
    adminDb.collection('SatpamDutyReconciliations').where('period', '==', period).get(),
  ]);
  const storedById = new Map(storedReconciliations.docs.map((doc) => [doc.id, doc.data()]));
  const projectedBonusChanges = projectedView.plans.flatMap((plan) => plan.employees.flatMap((employee) => {
    const stored = storedById.get(`${period.replace('-', '')}__${plan.teamId}__${employee.employeeId}`);
    if (!stored || Number(stored.bonusAmount || 0) === employee.bonusAmount) return [];
    return [{ employeeId: employee.employeeId, employeeName: employee.employeeName,
      previousBonusAmount: Number(stored.bonusAmount || 0), bonusAmount: employee.bonusAmount,
      previousMissedDuties: stored.missedDuties, missedDuties: employee.missedDuties }];
  }));
  const requests = await adminDb.collection('SatpamAbsenceRequests').where('period', '==', period).get();
  if ([...requestedIds].some((id) => !requests.docs.some((snapshot) => snapshot.id === id))) throw new Error('A selected request is not in this payroll period.');
  const results = [];
  for (const snapshot of requests.docs) {
    if (requestedIds.size && !requestedIds.has(snapshot.id)) continue;
    results.push(await repairSatpamApprovedLeavePay(snapshot.id, Number(snapshot.data().revision || 0), commit));
  }
  let reconciliation = { blockers: projectedView.blockers, projectedBonusChanges };
  if (commit && results.some((result) => result.status === 'repaired')) {
    const view = await syncSatpamDutyReconciliation(period, 'system:satpam-approved-leave-pay-v2');
    reconciliation = { blockers: view.blockers, projectedBonusChanges };
  }
  console.log(JSON.stringify({ period, mode: commit ? 'commit' : 'dry-run', results, reconciliation }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
