"use client";

import { useCallback, useEffect, useRef } from 'react';

/**
 * A press held for `delayMs` (or a right click) calls `onLongPress`. The click
 * that ends a long press is swallowed: call `consumeLongPress()` at the top of
 * the button's onClick and return when it is true.
 */
export function useLongPress(onLongPress: () => void, delayMs = 600) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRef = useRef(false);
  const callbackRef = useRef(onLongPress);

  useEffect(() => {
    callbackRef.current = onLongPress;
  }, [onLongPress]);

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => clear, [clear]);

  const handlers = {
    onPointerDown: (event: React.PointerEvent) => {
      if (event.button !== 0) return;
      firedRef.current = false;
      clear();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        firedRef.current = true;
        callbackRef.current();
      }, delayMs);
    },
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    // Right click on a desktop; a touch long press also raises it on Android.
    onContextMenu: (event: React.MouseEvent) => {
      event.preventDefault();
      clear();
      if (firedRef.current) return;
      callbackRef.current();
    },
  };

  const consumeLongPress = useCallback(() => {
    const fired = firedRef.current;
    firedRef.current = false;
    return fired;
  }, []);

  return { handlers, consumeLongPress };
}
