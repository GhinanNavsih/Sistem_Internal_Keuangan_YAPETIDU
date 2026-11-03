const LINKING_WORDS = new Set(['dan']);

/**
 * A SatKer's name shortened for a file name: the initials of its words ("Badan Pelayanan Kemahasiswaan" is
 * "BPK"), skipping "dan" and symbols like "&". A one-word name is kept whole, since it is already short or
 * an acronym ("PUSKOMNET"). Only letters and digits remain, so the result is safe in any file name.
 */
export function satkerInitials(name: string): string {
  const words = name.split(/\s+/).map((word) => word.replace(/[^\p{L}\p{N}]/gu, '')).filter((word) => word && !LINKING_WORDS.has(word.toLowerCase()));
  if (words.length === 1) return words[0];
  return words.map((word) => word[0].toUpperCase()).join('') || 'SatKer';
}
