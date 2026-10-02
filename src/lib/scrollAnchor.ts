export interface ScrollAnchorPlan {
  /** Where to scroll the page to so the held element is back where it was. */
  top: number;
  /** Empty space to add after the content so the page is tall enough to get there. */
  fill: number;
}

/**
 * `drift` is how far the held element moved on screen (positive = it moved
 * down), measured after the content changed. Scrolling the page by that amount
 * puts the element back; when the page has become too short to scroll that far
 * (a filter that leaves three rows), the missing height is returned as `fill`.
 */
export function planScrollAnchor(input: {
  drift: number;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}): ScrollAnchorPlan {
  const top = Math.max(0, input.scrollTop + input.drift);
  const room = Math.max(0, input.scrollHeight - input.clientHeight);
  return { top, fill: Math.max(0, Math.ceil(top - room)) };
}
