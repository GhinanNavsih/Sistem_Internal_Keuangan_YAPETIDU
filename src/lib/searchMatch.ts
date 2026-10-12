/**
 * Lowercases, drops accents and apostrophes, and turns every other punctuation mark into a space,
 * so "Perbaikan - Fakultas" and "perbaikan fakultas" compare equal.
 */
export function normalizeSearchText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Keeps the options whose label contains every word typed, in any order and ignoring punctuation.
 * Best matches first: the label starts with the whole query, then contains it, then has every word at the start of a word.
 * An empty query keeps every option in its original order.
 */
export function rankSearchOptions<T extends { label: string }>(options: readonly T[], query: string): T[] {
  const phrase = normalizeSearchText(query);
  if (!phrase) return [...options];
  const words = phrase.split(' ');
  const ranked: { option: T; index: number; rank: number }[] = [];
  options.forEach((option, index) => {
    const text = normalizeSearchText(option.label);
    if (!words.every((word) => text.includes(word))) return;
    const parts = text.split(' ');
    const rank = text.startsWith(phrase) ? 3
      : text.includes(phrase) ? 2
      : words.every((word) => parts.some((part) => part.startsWith(word))) ? 1
      : 0;
    ranked.push({ option, index, rank });
  });
  return ranked.sort((a, b) => b.rank - a.rank || a.index - b.index).map(({ option }) => option);
}
