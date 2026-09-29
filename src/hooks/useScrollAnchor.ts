import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * Keeps one element visually still while the list around it is re-sorted.
 *
 * Call the returned `hold(element)` in the event handler that changes the
 * data. After React commits, the page is scrolled by however far that element
 * moved, so the row the reviewer just acted on stays under the cursor instead
 * of the page jumping to wherever the row ended up. Browsers with native scroll
 * anchoring (Chrome, Firefox) have usually corrected most of the move by then;
 * this only absorbs what is left, and covers Safari, which has none.
 */
export function useScrollAnchor() {
  const pending = useRef<{ element: Element; top: number } | null>(null);

  const hold = useCallback((element: Element | null | undefined) => {
    if (!element) return;
    const entry = { element, top: element.getBoundingClientRect().top };
    pending.current = entry;
    // If the handler turns out to change nothing, drop the hold rather than
    // let it fire on some later, unrelated render.
    requestAnimationFrame(() => {
      if (pending.current === entry) pending.current = null;
    });
  }, []);

  useLayoutEffect(() => {
    const entry = pending.current;
    if (!entry) return;
    pending.current = null;
    if (!entry.element.isConnected) return;
    const drift = entry.element.getBoundingClientRect().top - entry.top;
    if (Math.abs(drift) >= 1) {
      window.scrollBy({ top: drift, behavior: 'instant' });
    }
  });

  return hold;
}
