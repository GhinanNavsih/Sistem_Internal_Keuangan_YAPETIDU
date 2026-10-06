import admin, { adminDb } from '@/lib/firebase-admin';
import type { FamilyAllowanceMetrics } from '@/lib/payroll/familyAllowance';
import { familyMetricsBeforeEdits, type FamilyAllowanceHistoryEvent } from '@/lib/payroll/familyAllowanceHistory';
import { explainFamilyAllowance, readFamilyAllowanceSnapshot, type FamilyAllowanceExplanation } from '@/lib/payroll/familyAllowanceSnapshot';
import { isImmutablePayrollStatus, type MoneyField } from '@/lib/payroll/domain';

function millis(value: unknown): number {
  if (typeof value === 'string') return Date.parse(value);
  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') {
    return value.toMillis();
  }
  return NaN;
}

/** Read-only and server-owned: employees receive counts, never institution-wide audit logs. */
export async function resolveSavedFamilyAllowance(
  employee: FirebaseFirestore.DocumentSnapshot,
  slip: FirebaseFirestore.DocumentSnapshot,
  period: string,
): Promise<FamilyAllowanceExplanation | null> {
  const saved = slip.data();
  if (!saved || !isImmutablePayrollStatus(saved.status)) return null;
  const earnings: MoneyField[] = saved.lockedSnapshot?.earnings || saved.earnings || [];
  const frozen = readFamilyAllowanceSnapshot(saved.lockedSnapshot?.familyAllowanceSnapshot, period);
  if (frozen) return explainFamilyAllowance(earnings, frozen, period);
  const unavailable = explainFamilyAllowance(earnings, null, period);
  const finalizedAt = millis(saved.verifiedAt || saved.lockedAt || saved.confirmedAt);
  const current = employee.data()?.family_allowance_metrics as FamilyAllowanceMetrics | undefined;
  if (!current || !Number.isFinite(finalizedAt)) return unavailable;
  if (employee.updateTime && employee.updateTime.toMillis() <= finalizedAt) {
    return explainFamilyAllowance(earnings, current, period);
  }
  const [edits, approvals] = await Promise.all([
    adminDb.collection('EmpEditLog')
      .where('timestamp', '>', admin.firestore.Timestamp.fromMillis(finalizedAt))
      .select('edits', 'timestamp').get(),
    adminDb.collection('FinancialAuditLogs').where('metadata.employeeId', '==', employee.id)
      .select('action', 'occurredAt', 'before.familyAllowanceMetrics').get(),
  ]);
  const events: FamilyAllowanceHistoryEvent[] = [];
  for (const document of edits.docs) {
    const data = document.data();
    for (const edit of Array.isArray(data.edits) ? data.edits : []) {
      if (edit.employeeId !== employee.id) continue;
      const changes = (Array.isArray(edit.changes) ? edit.changes : [])
        .filter((change: { field?: unknown }) => typeof change.field === 'string' && change.field.startsWith('family_allowance_metrics.'));
      if (changes.length) events.push({ occurredAt: millis(edit.timestamp || data.timestamp), changes });
    }
  }
  for (const document of approvals.docs) {
    const data = document.data();
    if (data.action === 'FAMILY_ALLOWANCE_REQUEST_APPROVED' && data.before?.familyAllowanceMetrics) {
      events.push({ occurredAt: millis(data.occurredAt), beforeMetrics: data.before.familyAllowanceMetrics });
    }
  }
  if (events.some(event => !Number.isFinite(event.occurredAt))) return unavailable;
  if (!events.some(event => event.occurredAt > finalizedAt)) return unavailable;
  const previous = familyMetricsBeforeEdits(current, events, finalizedAt);
  return explainFamilyAllowance(earnings, previous, period);
}
