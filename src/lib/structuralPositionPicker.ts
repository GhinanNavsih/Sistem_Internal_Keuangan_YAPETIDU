/**
 * Search rules for the Loyalis Admin's structural-position picker. The picker
 * only ever sees id/name/satker: the allowance stays with the caller, so a role
 * that may not know what a position pays never has the amount in its props.
 */
export interface PositionOption {
  id: string;
  name: string;
  satker: string;
}

export interface TakenPosition {
  name?: string | null;
  satker?: string | null;
}

function positionKey(name: string | null | undefined, satker: string | null | undefined): string {
  return `${(name ?? '').trim().toLowerCase()}|${(satker ?? '').trim().toLowerCase()}`;
}

/**
 * Options that match the search text (against name or satker) and are not
 * already on the employee. The same name under another satker is a different
 * position, so both fields decide whether an option is taken.
 */
export function filterPositionOptions(
  options: readonly PositionOption[],
  taken: readonly TakenPosition[],
  query: string,
): PositionOption[] {
  const takenKeys = new Set(taken.map((position) => positionKey(position.name, position.satker)));
  const needle = query.trim().toLowerCase();
  return options.filter((option) => {
    if (takenKeys.has(positionKey(option.name, option.satker))) return false;
    if (!needle) return true;
    return `${option.name ?? ''} ${option.satker ?? ''}`.toLowerCase().includes(needle);
  });
}
