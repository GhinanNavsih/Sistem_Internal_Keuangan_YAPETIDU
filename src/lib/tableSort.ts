export type SortDirection = 'asc' | 'desc';

export interface TableSort<K extends string> {
  key: K;
  direction: SortDirection;
}

/**
 * Header click cycle: ascending, then descending, then back to the table's own
 * order (`null`). Clicking a different column starts that column ascending.
 */
export function nextTableSort<K extends string>(
  current: TableSort<K> | null,
  key: K,
): TableSort<K> | null {
  if (!current || current.key !== key) return { key, direction: 'asc' };
  return current.direction === 'asc' ? { key, direction: 'desc' } : null;
}

/**
 * Sorts a copy of `rows` by the column's accessor. Strings compare in
 * Indonesian order with digits read as numbers; the sort is stable, so rows
 * that tie keep the order they came in.
 */
export function sortTableRows<T, K extends string>(
  rows: readonly T[],
  sort: TableSort<K> | null,
  accessors: Record<K, (row: T) => string | number>,
): T[] {
  if (!sort) return [...rows];
  const read = accessors[sort.key];
  const sign = sort.direction === 'asc' ? 1 : -1;
  return [...rows].sort((left, right) => {
    const a = read(left);
    const b = read(right);
    if (typeof a === 'number' && typeof b === 'number') return (a - b) * sign;
    return (
      String(a).localeCompare(String(b), 'id', { numeric: true, sensitivity: 'base' }) * sign
    );
  });
}
