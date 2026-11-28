import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type PointerEvent } from 'react';
import type { VerdictAction } from './api';
import {
  commitDistance,
  decideSwipe,
  lockAxis,
  releaseVelocity,
  SLOP_PX,
  VELOCITY_WINDOW_MS,
  type Sample,
} from './swipe';

/** A drag never starts on these. */
const NO_SWIPE = 'button, a, input, textarea, select, label, [data-no-swipe]';

export interface DragFrame {
  /** Pixels the card has moved. */
  offset: number;
  /** 0 to 1; 1 means letting go now commits. */
  progress: number;
  cardWidth: number;
}

interface Gesture {
  pointerId: number;
  pointerType: string;
  card: HTMLElement;
  cardKey: string;
  startX: number;
  startY: number;
  width: number;
  dragging: boolean;
  /** The slop already travelled when the drag began, so the card does not jump. */
  lead: number;
  samples: Sample[];
}

/**
 * Pointer-event swipe for one card. It waits for a little movement, then locks
 * to an axis: sideways drags the card, vertical is left to the browser to
 * scroll (the card needs `touch-action: pan-y`). Only a release commits; every
 * other ending springs the card back. Painting goes straight to the DOM through
 * `paint`, so tracking the finger costs no React renders.
 */
export function useSwipeGesture({
  cardKey,
  paint,
  onSwipe,
}: {
  /** The card on top. A gesture dies when this changes under it. */
  cardKey: string | null;
  /** `null` means return to rest. */
  paint: (card: HTMLElement, frame: DragFrame | null) => void;
  onSwipe: (action: VerdictAction, cardKey: string, offset: number) => void;
}) {
  const gestureRef = useRef<Gesture | null>(null);
  const latest = useRef({ cardKey, paint, onSwipe });
  latest.current = { cardKey, paint, onSwipe };

  const cancel = useCallback(() => {
    const g = gestureRef.current;
    if (!g) return;
    gestureRef.current = null;
    latest.current.paint(g.card, null);
  }, []);

  // A key or button can move the queue mid-drag; letting go must not then judge another job.
  useLayoutEffect(() => cancel, [cancel, cardKey]);

  useEffect(() => {
    window.addEventListener('blur', cancel);
    return () => window.removeEventListener('blur', cancel);
  }, [cancel]);

  return useMemo(() => {
    const own = (e: PointerEvent) =>
      gestureRef.current?.pointerId === e.pointerId ? gestureRef.current : null;
    const capture = (card: HTMLElement, pointerId: number) => {
      try {
        card.setPointerCapture?.(pointerId);
      } catch {
        // The pointer is already gone.
      }
    };

    return {
      onPointerDown(e: PointerEvent<HTMLElement>) {
        if (e.button > 0) return;
        const active = gestureRef.current;
        if (active) {
          // The same pointer, or a new first finger, means the old one's end was lost.
          const stale =
            e.pointerId === active.pointerId ||
            (e.isPrimary && e.pointerType === active.pointerType);
          if (!stale) return;
          cancel();
        }
        if (e.pointerType === 'touch' && !e.isPrimary) return;
        const key = latest.current.cardKey;
        if (key === null || (e.target as Element).closest(NO_SWIPE)) return;
        const card = e.currentTarget;
        gestureRef.current = {
          pointerId: e.pointerId,
          pointerType: e.pointerType,
          card,
          cardKey: key,
          startX: e.clientX,
          startY: e.clientY,
          width: card.getBoundingClientRect().width,
          dragging: false,
          lead: 0,
          samples: [{ x: e.clientX, t: e.timeStamp }],
        };
        // Touch keeps its target by itself; a mouse can leave the card before the drag starts.
        if (e.pointerType === 'mouse') capture(card, e.pointerId);
      },

      onPointerMove(e: PointerEvent<HTMLElement>) {
        const g = own(e);
        if (!g) return;
        if (e.pointerType === 'mouse' && e.buttons === 0) return cancel();
        const dx = e.clientX - g.startX;
        g.samples.push({ x: e.clientX, t: e.timeStamp });
        while (e.timeStamp - g.samples[0].t > VELOCITY_WINDOW_MS) g.samples.shift();
        if (!g.dragging) {
          const axis = lockAxis(dx, e.clientY - g.startY);
          if (axis === 'pending') return;
          if (axis === 'vertical') {
            gestureRef.current = null;
            return;
          }
          g.dragging = true;
          g.lead = Math.sign(dx) * SLOP_PX;
          capture(g.card, e.pointerId);
        }
        latest.current.paint(g.card, {
          offset: dx - g.lead,
          progress: Math.min(1, Math.abs(dx) / commitDistance(g.width)),
          cardWidth: g.width,
        });
      },

      onPointerUp(e: PointerEvent<HTMLElement>) {
        const g = own(e);
        if (!g) return;
        gestureRef.current = null;
        if (!g.dragging) return;
        const dx = e.clientX - g.startX;
        const velocity = releaseVelocity(
          [...g.samples, { x: e.clientX, t: e.timeStamp }],
          e.timeStamp,
        );
        const action = decideSwipe(dx, velocity, g.width);
        latest.current.paint(g.card, null);
        if (action) latest.current.onSwipe(action, g.cardKey, dx - g.lead);
      },

      /** The browser took the pointer (usually to scroll). Never commits. */
      onPointerCancel(e: PointerEvent<HTMLElement>) {
        if (own(e)) cancel();
      },

      onLostPointerCapture(e: PointerEvent<HTMLElement>) {
        // Capture moving from a child to the card also fires this, from the child.
        if (e.target === e.currentTarget && own(e)) cancel();
      },

      onContextMenu: cancel,
    };
  }, [cancel]);
}

export type SwipeHandlers = ReturnType<typeof useSwipeGesture>;
