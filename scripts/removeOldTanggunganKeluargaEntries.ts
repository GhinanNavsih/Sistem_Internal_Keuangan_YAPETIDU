/**
 * Removes old tanggungan keluarga rows: history entries saved without a
 * Tanggal masuk, or an SD child saved without a birth date. Child counts are
 * recalculated from what remains; spouse_count is never touched.
 *
 * Dry run by default. With --apply it first writes a JSON backup of every
 * affected family_allowance_metrics, then runs one transaction per employee
 * that updates the record and adds an EmpEditLog entry. The log entry lets
 * resolveSavedFamilyAllowance rebuild the pre-removal rows for locked slips.
 * Usage: npm run fix:tanggungan-lama -- [--apply]
 */
import * as fs from 'fs';
import * as path from 'path';
import admin, { adminDb } from '../src/lib/firebase-admin';
import {
  dependentChildren,
  dependentHistory,
  isDateOnly,
  oldDependentReason,
  stageGraduationDate,
  todayInJakarta,
  withCurrentFamilyCounts,
  type DependentEnrollment,
  type FamilyAllowanceMetrics,
} from '../src/lib/payroll/familyAllowance';

const COLLECTIONS = ['Employees_Loyalis', 'Employees_BlueCollar', 'Employees_WhiteCollar'];
const COUNT_FIELDS = ['children_sd', 'children_sltp', 'children_slta', 'children_s1', 'children_s2', 'children_pt'] as const;

interface FieldChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

interface Plan {
  collection: string;
  id: string;
  name: string;
  status: string;
  before: FamilyAllowanceMetrics | undefined;
  removed: DependentEnrollment[];
  after: FamilyAllowanceMetrics;
  changes: FieldChange[];
  skipReason: string;
}

/** Same wording the employees page writes, so familyMetricsBeforeEdits can read it back. */
function describeStage(stage: DependentEnrollment, children: ReturnType<typeof dependentChildren>): string {
  const number = children.findIndex(child => child.stages.some(item => item.id === stage.id)) + 1;
  const date = stage.birth_date !== undefined
    ? `lahir ${stage.birth_date || 'belum dicatat'}`
    : `masuk ${stage.enrolled_at || 'belum dicatat'}`;
  const graduation = stage.level !== 'PT' && isDateOnly(stage.enrolled_at)
    ? `; lulus ${stageGraduationDate(stage)}`
    : '';
  return `Anak ${number}; ${stage.level}; ${date}${graduation}` +
    `${stage.ended_at ? `; dihentikan ${stage.ended_at}` : ''}` +
    `${stage.no_further_study ? '; tidak lanjut sekolah' : ''}; ID anak ${stage.child_id || stage.id}`;
}

/** Null when the record has no old rows. A non-empty skipReason means nothing is written. */
function planEmployee(
  collection: string,
  id: string,
  data: { personal_info?: { name?: unknown; status?: unknown }; name?: unknown; employment?: { status?: unknown } },
  metrics: FamilyAllowanceMetrics | undefined,
): Plan | null {
  const history = dependentHistory(metrics);
  const removed = history.filter(dependent => oldDependentReason(dependent) !== null);
  if (removed.length === 0) return null;

  const base = {
    collection,
    id,
    name: String(data.personal_info?.name ?? data.name ?? ''),
    status: String(data.personal_info?.status ?? data.employment?.status ?? ''),
    before: metrics === undefined ? undefined : structuredClone(metrics),
    removed,
  };
  const empty = { ...base, after: metrics ?? {}, changes: [], skipReason: '' };

  if (removed.some(dependent => oldDependentReason(dependent) === 'malformed')) {
    return { ...empty, skipReason: 'riwayat tanggungan tidak valid; perbaiki manual' };
  }
  const removedIds = new Set(removed.map(dependent => dependent.id));
  const mixed = dependentChildren(metrics).some(child =>
    child.stages.some(stage => removedIds.has(stage.id)) && child.stages.some(stage => !removedIds.has(stage.id)));
  if (mixed) {
    return { ...empty, skipReason: 'anak yang punya jenjang lama dan baru; perbaiki manual' };
  }

  const remaining = history.filter(dependent => !removedIds.has(dependent.id));
  const after = withCurrentFamilyCounts({ ...metrics, dependents: remaining }, todayInJakarta());
  const children = dependentChildren(metrics);
  const changes: FieldChange[] = [
    ...removed.map(dependent => ({
      field: `family_allowance_metrics.dependents.${dependent.id}`,
      oldValue: describeStage(dependent, children),
      newValue: null,
    })),
    ...COUNT_FIELDS.filter(field => metrics?.[field] !== after[field]).map(field => ({
      field: `family_allowance_metrics.${field}`,
      oldValue: metrics?.[field] ?? null,
      newValue: after[field],
    })),
  ];
  return { ...base, after, changes, skipReason: '' };
}

function editLogEntry(plan: Plan, changes: FieldChange[]) {
  return {
    operatorEmail: 'script:fix-tanggungan-lama',
    operatorName: 'Skrip pembersihan tanggungan lama',
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: new Date().toISOString(),
    editsCount: 1,
    edits: [{
      employeeId: plan.id,
      name: plan.name,
      tab: plan.collection.replace('Employees_', '').toLowerCase(),
      timestamp: new Date().toISOString(),
      changes,
    }],
  };
}

function describePlan(plan: Plan): string {
  const before = plan.before;
  const after = plan.after;
  const counts = COUNT_FIELDS.map(field => `${field} ${before?.[field] ?? 0}→${after[field]}`).join(', ');
  return `${plan.collection}/${plan.id} | ${plan.name} | ${plan.status} | hapus ${plan.removed.length} baris | ` +
    `spouse_count tetap ${after.spouse_count ?? 0} | ${counts}`;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const plans: Plan[] = [];
  for (const collection of COLLECTIONS) {
    const snapshot = await adminDb.collection(collection).get();
    for (const document of snapshot.docs) {
      const data = document.data();
      const plan = planEmployee(collection, document.id, data, data.family_allowance_metrics);
      if (plan) plans.push(plan);
    }
  }

  const actionable = plans.filter(plan => !plan.skipReason);
  const skipped = plans.filter(plan => plan.skipReason);
  console.log(apply ? 'MODE: APPLY' : 'MODE: DRY RUN (nothing written; add --apply to write)');
  console.log(`Employees: ${actionable.length} to change, ${skipped.length} skipped; ` +
    `rows to remove: ${actionable.reduce((sum, plan) => sum + plan.removed.length, 0)}\n`);
  for (const plan of actionable) console.log(describePlan(plan));
  for (const plan of skipped) console.log(`SKIPPED ${plan.collection}/${plan.id} | ${plan.name}: ${plan.skipReason}`);

  if (!apply) return;

  const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  const backupPath = path.resolve(process.cwd(), 'outputs/audits', `tanggungan-lama-backup-${stamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify({
    takenAt: new Date().toISOString(),
    employees: actionable.map(plan => ({
      collection: plan.collection,
      id: plan.id,
      name: plan.name,
      family_allowance_metrics: plan.before ?? null,
    })),
  }, null, 2));
  console.log(`\nBackup written: ${backupPath}`);

  let changed = 0;
  for (const plan of actionable) {
    const reference = adminDb.collection(plan.collection).doc(plan.id);
    const logReference = adminDb.collection('EmpEditLog').doc();
    const result = await adminDb.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const data = snapshot.data() ?? {};
      // Re-plan from the transaction's read so a record edited since the dry run is never overwritten blindly.
      const fresh = planEmployee(plan.collection, plan.id, data, data.family_allowance_metrics);
      if (!fresh || fresh.skipReason) return fresh?.skipReason || 'sudah tidak ada riwayat lama';
      transaction.update(reference, { family_allowance_metrics: fresh.after });
      transaction.create(logReference, editLogEntry(fresh, fresh.changes));
      return `dihapus ${fresh.removed.length} baris`;
    });
    if (result.startsWith('dihapus')) changed++;
    console.log(`${plan.collection}/${plan.id}: ${result}`);
  }
  console.log(`\nDone: ${changed} of ${actionable.length} employees changed.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
