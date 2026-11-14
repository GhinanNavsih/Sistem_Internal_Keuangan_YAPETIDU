/** Hide retired metadata without rewriting stored letters. */
export function normalizeStoredLetter<T extends Record<string, unknown>>(letter: T): T {
  const result: Record<string, unknown> = { ...letter };
  delete result.status;
  return result as T;
}

/** Present older incoming letters using the current categories. */
export function normalizeIncomingLetter<T extends Record<string, unknown>>(letter: T): T {
  const result: Record<string, unknown> = normalizeStoredLetter(letter);
  if (result.kategori === 'Instruksi / Disposisi Rektorat') result.kategori = 'Instruksi Rektorat';
  delete result.disposisi;
  return result as T;
}
