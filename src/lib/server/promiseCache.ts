/**
 * A small in-memory cache for expensive server reads whose key already says
 * whether the value is still good: a revision id whose rows are never edited,
 * or a document path joined with its update time. Only the newest `limit` keys
 * are kept.
 *
 * The pending promise is what gets stored, so requests that arrive while a read
 * is running share it instead of starting their own, and a failed read is
 * forgotten rather than served again.
 */
export function createPromiseCache<T>(limit: number) {
  const entries = new Map<string, Promise<T>>();
  return {
    get(key: string, load: () => Promise<T>): Promise<T> {
      const cached = entries.get(key);
      if (cached) {
        // Re-insert so the key counts as the most recently used.
        entries.delete(key);
        entries.set(key, cached);
        return cached;
      }
      const pending = load();
      entries.set(key, pending);
      pending.catch(() => {
        if (entries.get(key) === pending) entries.delete(key);
      });
      while (entries.size > limit) {
        entries.delete(entries.keys().next().value as string);
      }
      return pending;
    },
    clear() {
      entries.clear();
    },
  };
}
