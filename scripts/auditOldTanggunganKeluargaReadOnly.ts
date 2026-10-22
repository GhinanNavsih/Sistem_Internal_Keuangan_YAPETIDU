/**
 * Read-only audit of old tanggungan keluarga (family allowance dependents).
 *
 * "Old" entries were saved before the form required dates: an SD child without
 * a birth date, any other school stage without its Tanggal masuk, or a record
 * that only has child counts (no dependents history at all). A child whose
 * stages mix old and new rows is listed separately, since deleting only the
 * old stage would change how the remaining stages are validated.
 *
 * This script intentionally contains no Firestore write calls.
 * Usage: npm run audit:tanggungan-lama -- [--out outputs/audits/file.json]
 */
import * as fs from 'fs';
import * as path from 'path';
import { adminDb } from '../src/lib/firebase-admin';
import {
  dependentChildren,
  dependentHistory,
  oldDependentReason,
  type FamilyAllowanceMetrics,
  type OldDependentReason,
} from '../src/lib/payroll/familyAllowance';

const COLLECTIONS = ['Employees_Loyalis', 'Employees_BlueCollar', 'Employees_WhiteCollar'];

interface OldEntry {
  id: string;
  level: string;
  enrolled_at: string;
  birth_date: string;
  reason: OldDependentReason;
}

interface Finding {
  collection: string;
  id: string;
  name: string;
  status: string;
  countsOnly: boolean;
  totalEntries: number;
  oldEntries: OldEntry[];
  mixedChildIds: string[];
}

function auditMetrics(metrics: FamilyAllowanceMetrics | undefined) {
  const history = dependentHistory(metrics);
  const oldEntries = history.flatMap((dependent): OldEntry[] => {
    const reason = oldDependentReason(dependent);
    return reason
      ? [{
          id: String(dependent?.id ?? ''),
          level: String(dependent?.level ?? ''),
          enrolled_at: String(dependent?.enrolled_at ?? ''),
          birth_date: String(dependent?.birth_date ?? ''),
          reason,
        }]
      : [];
  });
  const oldIds = new Set(oldEntries.map(entry => entry.id));
  const mixedChildIds = dependentChildren(metrics)
    .filter(child => child.stages.some(stage => oldIds.has(stage.id)) &&
      child.stages.some(stage => !oldIds.has(stage.id)))
    .map(child => child.id);
  return {
    countsOnly: !Array.isArray(metrics?.dependents),
    totalEntries: history.length,
    oldEntries,
    mixedChildIds,
  };
}

function describe(entry: OldEntry): string {
  const date = entry.enrolled_at ? `masuk ${entry.enrolled_at}` : 'tanpa tanggal masuk';
  const birth = entry.birth_date ? `, lahir ${entry.birth_date}` : '';
  return `${entry.level} (${date}${birth}) [${entry.reason}] id=${entry.id}`;
}

async function main() {
  const outIndex = process.argv.indexOf('--out');
  const outPath = outIndex >= 0 ? process.argv[outIndex + 1] : '';
  const findings: Finding[] = [];
  const summaries: Record<string, { scanned: number; employeesWithOld: number; oldEntries: number; countsOnly: number }> = {};

  for (const collection of COLLECTIONS) {
    const snapshot = await adminDb.collection(collection).get();
    const summary = { scanned: snapshot.size, employeesWithOld: 0, oldEntries: 0, countsOnly: 0 };
    for (const document of snapshot.docs) {
      const data = document.data();
      const audit = auditMetrics(data.family_allowance_metrics);
      if (audit.countsOnly && audit.totalEntries > 0) summary.countsOnly++;
      if (audit.oldEntries.length === 0) continue;
      summary.employeesWithOld++;
      summary.oldEntries += audit.oldEntries.length;
      findings.push({
        collection,
        id: document.id,
        name: String(data.personal_info?.name ?? data.name ?? ''),
        status: String(data.personal_info?.status ?? data.employment?.status ?? ''),
        ...audit,
      });
    }
    summaries[collection] = summary;
  }

  console.log('Summary (read-only):');
  for (const [collection, summary] of Object.entries(summaries)) {
    console.log(`- ${collection}: ${summary.scanned} docs, ${summary.employeesWithOld} with old entries, ` +
      `${summary.oldEntries} old entries, ${summary.countsOnly} counts-only records`);
  }
  const mixed = findings.flatMap(finding => finding.mixedChildIds.map(childId => ({ finding, childId })));
  console.log(`- Children mixing old and new stages: ${mixed.length}`);

  console.log('\nEmployees with old entries:');
  for (const finding of findings) {
    console.log(`\n${finding.collection}/${finding.id} | ${finding.name} | ${finding.status} | ` +
      `${finding.oldEntries.length} of ${finding.totalEntries} entries old` +
      `${finding.countsOnly ? ' | counts only' : ''}` +
      `${finding.mixedChildIds.length ? ` | mixed: ${finding.mixedChildIds.join(', ')}` : ''}`);
    for (const entry of finding.oldEntries) console.log(`    - ${describe(entry)}`);
  }

  if (outPath) {
    const resolved = path.resolve(process.cwd(), outPath);
    fs.writeFileSync(resolved, JSON.stringify({ generatedAt: new Date().toISOString(), summaries, findings }, null, 2));
    console.log(`\nWrote ${resolved}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
