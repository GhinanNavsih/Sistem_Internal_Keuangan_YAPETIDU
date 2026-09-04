/**
 * Helpers for deriving a single `loading` flag from a set of cached queries.
 *
 * The salary matrices are read as dependent pairs — resolve `_config.activeVersion`,
 * then read that version's rows/grade codes. A dependent query stays `isPending`
 * for as long as it is disabled, so naively OR-ing `isPending` across the set
 * would pin `loading` to true forever whenever a version read fails. These
 * helpers treat a group as finished once its version query has errored.
 */

export interface QueryStatusLike {
  isSuccess: boolean;
  isError: boolean;
}

/** A query has finished when it has either resolved or failed. */
export const isQuerySettled = (query: QueryStatusLike): boolean =>
  query.isSuccess || query.isError;

/**
 * A version-scoped group is finished when the version read failed (nothing
 * downstream will ever run) or succeeded and every dependent read has settled.
 */
export const isVersionedGroupSettled = (
  version: QueryStatusLike,
  ...dependents: QueryStatusLike[]
): boolean =>
  version.isError || (version.isSuccess && dependents.every(isQuerySettled));
