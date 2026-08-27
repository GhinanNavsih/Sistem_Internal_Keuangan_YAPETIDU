export type EmployeeActivityStatus = 'pending' | 'approved' | 'declined';
export type EmployeeActivityStatusFilter = EmployeeActivityStatus | 'all';

export interface EmployeeActivityHistoryRecord {
  status: EmployeeActivityStatus;
  fee: number;
}

export interface EmployeeActivityHistoryStats {
  pending: number;
  approved: number;
  declined: number;
  totalApprovedFee: number;
}

/**
 * Filters the in-memory view only. Records are returned by reference and are
 * never rewritten, which keeps historical Firestore data outside this concern.
 */
export function filterEmployeeActivityHistory<
  T extends Pick<EmployeeActivityHistoryRecord, 'status'>,
>(records: readonly T[], filter: EmployeeActivityStatusFilter): readonly T[] {
  if (filter === 'all') return records;
  return records.filter((record) => record.status === filter);
}

export function summarizeEmployeeActivityHistory(
  records: readonly EmployeeActivityHistoryRecord[],
): EmployeeActivityHistoryStats {
  let pending = 0;
  let approved = 0;
  let declined = 0;
  let totalApprovedFee = 0;

  for (const record of records) {
    if (record.status === 'pending') pending += 1;
    if (record.status === 'declined') declined += 1;
    if (record.status === 'approved') {
      approved += 1;
      totalApprovedFee += record.fee || 0;
    }
  }

  return { pending, approved, declined, totalApprovedFee };
}
