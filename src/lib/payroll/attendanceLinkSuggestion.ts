import { normalizeName } from './employeeNames';

/**
 * Proposes which employee an unrecognised attendance row most likely belongs
 * to, by name, so the admin starts from a suggestion instead of a blank search.
 * It only ever suggests: linking stays the admin's decision.
 *
 * The scanner spells names its own way ("Muhammad Fuadi" for a record held as
 * "Muhamad Fuady"), so an exact match is not required — but a suggestion is
 * made only when one employee is clearly the closest, never between ties.
 */

function comparable(name: string): string {
  return normalizeName(name || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function editDistance(left: string, right: string): number {
  if (left === right) return 0;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length];
}

export function suggestLinkCandidate<T extends { name: string }>(
  sourceName: string,
  candidates: readonly T[],
): T | null {
  const source = comparable(sourceName);
  // A short or empty name is too weak to propose anyone from.
  if (source.length < 4) return null;

  let best: T | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let tied = false;
  for (const candidate of candidates) {
    const target = comparable(candidate.name);
    if (!target) continue;
    const distance = editDistance(source, target);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
      tied = false;
    } else if (distance === bestDistance) {
      tied = true;
    }
  }
  const allowed = Math.max(1, Math.min(3, Math.floor(source.length * 0.15)));
  return best && !tied && bestDistance <= allowed ? best : null;
}
