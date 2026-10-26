/** Compatible with Firestore timestamps, serialized timestamps and local dates. */
export function proposalTimestampMs(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (!value || typeof value !== 'object') return 0;
  const timestamp = value as { toMillis?: () => number; seconds?: number; nanoseconds?: number };
  if (typeof timestamp.toMillis === 'function') return timestamp.toMillis();
  return Number(timestamp.seconds || 0) * 1000 + Number(timestamp.nanoseconds || 0) / 1e6;
}

export function compareProposalCreation(
  left: { id: string; createdAt?: unknown }, right: { id: string; createdAt?: unknown },
): number {
  return proposalTimestampMs(right.createdAt) - proposalTimestampMs(left.createdAt) || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}
