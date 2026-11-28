import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from 'react';

const MIN_PX = 300;
const MAX_PX = 640;
/** Room under the stack for the waiting card to peek out. */
const GAP_PX = 16;

/**
 * The height that lets the card and the dock below it share one screen,
 * whatever sits above (an alert banner, open filters) or below (the phone's
 * tab bar). Null until measured.
 */
export function useFitHeight(
  stackRef: RefObject<HTMLElement | null>,
  dockRef: RefObject<HTMLElement | null>,
): number | null {
  const [height, setHeight] = useState<number | null>(null);

  const measure = useCallback(() => {
    const stack = stackRef.current;
    const dock = dockRef.current;
    if (!stack || !dock) return;
    const top = stack.getBoundingClientRect().top + window.scrollY;
    // The dock sticks this far above the bottom of the screen.
    const lift = parseFloat(getComputedStyle(dock).bottom) || 0;
    const room = window.innerHeight - top - dock.offsetHeight - lift - GAP_PX;
    setHeight(Math.round(Math.max(MIN_PX, Math.min(MAX_PX, room))));
  }, [stackRef, dockRef]);

  // After every render, since opening the filters moves the stack. Dragging does not render.
  useLayoutEffect(measure);

  useEffect(() => {
    // The dock renders after the stack, so measure again once both exist.
    const frame = window.requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    // Things above the stack can appear late and push it down.
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(document.body);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [measure]);

  return height;
}
