import type { Transaction } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import {
  describeDriverJourneyOverlap,
  driverJourneySpan,
  findOverlappingDriverReport,
  type DriverJourneySpanSource,
  type PeerDriverReport,
} from '@/lib/payroll/driverJourneyOverlap';
import { HttpError } from '@/lib/server/auth';

/**
 * Reads one sopir's reports for the given payroll periods. Firestore requires
 * every transaction read to precede its first write, so callers load this
 * before they start writing.
 */
export async function loadDriverPeerReports(
  transaction: Transaction,
  employeeId: string,
  periods: readonly string[],
): Promise<PeerDriverReport[]> {
  const snapshots = await Promise.all(
    periods.map((period) =>
      transaction.get(
        adminDb
          .collection('ActivityReports')
          .where('employeeId', '==', employeeId)
          .where('payrollPeriod', '==', period),
      ),
    ),
  );
  return snapshots.flatMap((snapshot) =>
    snapshot.docs.map((document) => ({ id: document.id, ...document.data() })),
  );
}

/** Rejects a trip whose time is already taken by another of the sopir's reports. */
export function assertNoOverlappingDriverJourney(
  journey: DriverJourneySpanSource,
  peers: readonly PeerDriverReport[],
  excludeReportId: string,
): void {
  const span = driverJourneySpan(journey);
  if (!span) return;
  const overlap = findOverlappingDriverReport(span, peers, { excludeReportId });
  if (overlap) throw new HttpError(409, describeDriverJourneyOverlap(overlap));
}
