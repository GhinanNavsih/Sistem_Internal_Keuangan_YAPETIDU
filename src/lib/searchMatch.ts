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
 * An option may also carry `keywords` (an abbreviation, say) that are searched but never shown.
 * Best matches first: a keyword equal to the whole query, then the label starts with the whole query (or a keyword does),
 * then the label contains it, then every word is at the start of a word.
 * An empty query keeps every option in its original order.
 */
export function rankSearchOptions<T extends { label: string; keywords?: readonly string[] }>(options: readonly T[], query: string): T[] {
  const phrase = normalizeSearchText(query);
  if (!phrase) return [...options];
  const words = phrase.split(' ');
  const ranked: { option: T; index: number; rank: number }[] = [];
  options.forEach((option, index) => {
    const labelText = normalizeSearchText(option.label);
    const keywordTexts = (option.keywords ?? []).map(normalizeSearchText).filter(Boolean);
    const text = [labelText, ...keywordTexts].join(' ');
    if (!words.every((word) => text.includes(word))) return;
    const parts = text.split(' ');
    let rank = labelText.startsWith(phrase) ? 3
      : labelText.includes(phrase) ? 2
      : words.every((word) => parts.some((part) => part.startsWith(word))) ? 1
      : 0;
    if (keywordTexts.includes(phrase)) rank = 4;
    else if (keywordTexts.some((keyword) => keyword.startsWith(phrase))) rank = Math.max(rank, 3);
    ranked.push({ option, index, rank });
  });
  return ranked.sort((a, b) => b.rank - a.rank || a.index - b.index).map(({ option }) => option);
}
