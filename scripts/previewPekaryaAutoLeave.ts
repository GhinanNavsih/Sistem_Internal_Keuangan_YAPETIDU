/** Read-only preview; this command cannot apply leave or change payroll. */
import { reconcilePekaryaAutoLeave } from '../src/lib/server/pekaryaAutoLeave';
import { adminDb } from '../src/lib/firebase-admin';

async function main() {
  const index = process.argv.indexOf('--period');
  const period = index >= 0 ? process.argv[index + 1] : '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error('Use --period YYYY-MM. No database changes are made.');
  const summary = await reconcilePekaryaAutoLeave(period, {
    uid: 'system:pekarya-auto-leave-preview', email: null, role: 'system', displayName: 'Read-only preview', permittedCategories: [],
  }, { dryRun: true });
  console.log(JSON.stringify({ period, applicable: summary.applicable, note: summary.note,
    employees: summary.results.length,
    coveredDays: summary.results.reduce((sum, item) => sum + item.covered.length, 0),
    releasedDays: summary.results.reduce((sum, item) => sum + item.released.length, 0),
    heldEmployees: summary.results.filter((item) => item.held?.length).length,
    uncoveredDays: summary.results.reduce((sum, item) => sum + item.uncovered.length, 0),
    failures: summary.results.filter((item) => item.failed).map((item) => ({ employeeId: item.employeeId, reason: item.skipped })),
  }, null, 2));
  await adminDb.terminate();
}
main().then(() => process.exit(0)).catch((error) => { console.error(error.message); process.exit(1); });
