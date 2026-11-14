/**
 * The initials of a Kepala SatKer Loyalis account's SatKer, e.g. "BPM". They are
 * the SatKer code in the number of every Surat Keluar (001/BPM/UNIPDU/XI/2026),
 * so two active SatKers must never share them. Pure, so the server, the account
 * forms and the letter numbering all apply the same rule.
 */

export const SATKER_INITIALS_MIN = 1;
export const SATKER_INITIALS_MAX = 10;

const VALID_INITIALS = /^[A-Z0-9]+$/;

/** Initials as stored: trimmed and upper-cased. Anything that is not a string is blank. */
export function normalizeSatkerInitials(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

/** What is wrong with these initials, or null when they can be saved. */
export function satkerInitialsProblem(value: unknown): string | null {
  const initials = normalizeSatkerInitials(value);
  if (!initials) return 'Inisial SatKer wajib diisi.';
  if (
    initials.length < SATKER_INITIALS_MIN ||
    initials.length > SATKER_INITIALS_MAX ||
    !VALID_INITIALS.test(initials)
  ) {
    return `Inisial SatKer harus ${SATKER_INITIALS_MIN}–${SATKER_INITIALS_MAX} huruf atau angka, tanpa spasi.`;
  }
  return null;
}

interface HeadWithInitials {
  uid: string;
  disabled?: boolean;
  satkerInitials?: unknown;
}

/**
 * The other active Kepala SatKer Loyalis who already uses these initials, if
 * any. A disabled account does not count: its SatKer carries on under a new head
 * with the same initials. `exceptUid` is the account being saved.
 */
export function findSatkerInitialsConflict<T extends HeadWithInitials>(
  initials: unknown,
  heads: readonly T[],
  exceptUid?: string,
): T | undefined {
  const wanted = normalizeSatkerInitials(initials);
  if (!wanted) return undefined;
  return heads.find(
    (head) =>
      head.uid !== exceptUid &&
      head.disabled !== true &&
      normalizeSatkerInitials(head.satkerInitials) === wanted,
  );
}
