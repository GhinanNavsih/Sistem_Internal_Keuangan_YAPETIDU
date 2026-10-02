import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { planScrollAnchor } from '@/lib/scrollAnchor';

/**
 * Keeps one element visually still while the content around it changes size,
 * is re-sorted or is swapped for something shorter.
 *
 * Call the returned `hold(element)` in the event handler that changes the
 * data. After React commits, the page is scrolled by however far that element
 * moved, so the row the reviewer just acted on stays under the cursor instead
 * of the page jumping to wherever the row ended up. Browsers with native scroll
 * anchoring (Chrome, Firefox) have usually corrected most of the move by then;
 * this only absorbs what is left, and covers Safari, which has none.
 *
 * When the change leaves the page too short to scroll back to where the element
 * was (a filter that keeps three rows), the missing height is added as empty
 * space at the bottom of the page until the next hold, so the page cannot jump.
 */
export function useScrollAnchor() {
  const pending = useRef<{ element: Element; top: number } | null>(null);
  const fill = useRef<{ restore: string } | null>(null);

  const clearFill = useCallback(() => {
    if (!fill.current) return;
    document.body.style.paddingBottom = fill.current.restore;
    fill.current = null;
  }, []);

  // Leaving the page must not leave its borrowed space behind.
  useEffect(() => clearFill, [clearFill]);

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
    // Measure against the page's natural height, not last time's borrowed space.
    clearFill();
    const drift = entry.element.getBoundingClientRect().top - entry.top;
    if (Math.abs(drift) < 1) return;
    const scroller = document.scrollingElement ?? document.documentElement;
    const plan = planScrollAnchor({
      drift,
      scrollTop: scroller.scrollTop,
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
    });
    if (plan.fill > 0) {
      const body = document.body;
      fill.current = { restore: body.style.paddingBottom };
      const base = parseFloat(getComputedStyle(body).paddingBottom) || 0;
      body.style.paddingBottom = `${base + plan.fill}px`;
    }
    window.scrollTo({ top: plan.top, behavior: 'instant' });
  });

  return hold;
}
