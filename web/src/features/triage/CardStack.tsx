import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { JobSummary } from '@/api/types';
import { cn } from '@/lib/cn';
import { prefersReducedMotion } from '@/lib/theme';
import type { VerdictAction } from './api';
import { TriageCard } from './TriageCard';
import { useFitHeight } from './useFitHeight';
import { useSwipeGesture, type DragFrame } from './useSwipeGesture';

/** The card behind sits this much lower and smaller until it is promoted. */
const BEHIND_DROP_PX = 14;
const BEHIND_SCALE = 0.95;
const BEHIND_TRANSFORM = `translateY(${BEHIND_DROP_PX}px) scale(${BEHIND_SCALE})`;
const MAX_TILT_DEG = 9;
const FLY_MS = 320;

/** A decided card on its way off the screen. */
export interface CardExit {
  key: number;
  job: JobSummary;
  action: VerdictAction;
  /** Where the drag left it; 0 for a button or key. */
  offset: number;
}

export const canAnimate = () =>
  !prefersReducedMotion() &&
  typeof Element !== 'undefined' &&
  typeof Element.prototype.animate === 'function';

const tilt = (offset: number, width: number) =>
  Math.max(-MAX_TILT_DEG, Math.min(MAX_TILT_DEG, (offset / (width || 320)) * 14));

function setFeedback(card: HTMLElement, action: VerdictAction | null, progress: number) {
  for (const side of ['shortlist', 'skip'] as const) {
    const wash = card.querySelector<HTMLElement>(`[data-wash="${side}"]`);
    const stamp = card.querySelector<HTMLElement>(`[data-stamp="${side}"]`);
    const on = side === action;
    if (wash) wash.style.opacity = on ? String(progress) : '';
    if (!stamp) continue;
    stamp.style.opacity = on ? String(Math.min(1, progress * 1.4)) : '';
    stamp.style.scale = on ? String(0.8 + progress * 0.2 + (progress >= 1 ? 0.08 : 0)) : '';
    stamp.toggleAttribute('data-armed', on && progress >= 1);
  }
}

function ExitingCard({ exit, onDone }: { exit: CardExit; onDone: (key: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const width = node.getBoundingClientRect().width;
    const side = exit.action === 'shortlist' ? 1 : -1;
    const card = node.querySelector<HTMLElement>('article');
    if (card) setFeedback(card, exit.action, 1);
    const animation = node.animate(
      [
        { transform: `translate3d(${exit.offset}px, 0, 0) rotate(${tilt(exit.offset, width)}deg)` },
        {
          transform: `translate3d(${side * (width + 160)}px, 40px, 0) rotate(${side * 18}deg)`,
          opacity: 0.2,
        },
      ],
      { duration: FLY_MS, easing: 'cubic-bezier(0.32, 0.4, 0.6, 1)', fill: 'forwards' },
    );
    // A timer rather than `finished`, which never settles in a hidden tab.
    const timer = window.setTimeout(() => onDone(exit.key), FLY_MS);
    return () => {
      window.clearTimeout(timer);
      animation.cancel();
    };
  }, [exit, onDone]);

  return (
    <div ref={ref} aria-hidden="true" inert className="pointer-events-none absolute inset-0 z-20">
      <TriageCard job={exit.job} isTop={false} />
    </div>
  );
}

function Layer({
  isTop,
  children,
}: {
  isTop: boolean;
  children: React.ReactNode;
}) {
  // Only a card that first appears on top rises in; a promoted one already glides up.
  const [entered] = useState(isTop);
  return (
    <div
      data-layer={isTop ? 'top' : 'next'}
      aria-hidden={isTop ? undefined : true}
      inert={!isTop}
      className={cn(
        'absolute inset-0 origin-bottom [transition:transform_320ms_var(--ease-calm),opacity_320ms_var(--ease-calm)]',
        isTop ? 'z-10' : 'pointer-events-none z-0 opacity-80',
      )}
      style={{ transform: isTop ? 'none' : BEHIND_TRANSFORM }}
    >
      {/* The entrance animation has its own element, so its fill can never override a drag. */}
      <div className={cn('h-full', entered && 'calm-rise')}>{children}</div>
    </div>
  );
}

export function CardStack({
  current,
  next,
  exits,
  onExitDone,
  onSwipe,
  onOpen,
  dockRef,
}: {
  /** The buttons below, which must stay on screen with the card. */
  dockRef: RefObject<HTMLElement | null>;
  /** Null while the last card flies off. */
  current: JobSummary | null;
  next: JobSummary | null;
  exits: CardExit[];
  onExitDone: (key: number) => void;
  onSwipe: (action: VerdictAction, jobId: string, offset: number) => void;
  onOpen: (jobId: string) => void;
}) {
  const stackRef = useRef<HTMLDivElement>(null);
  const height = useFitHeight(stackRef, dockRef);

  const paint = useCallback((card: HTMLElement, frame: DragFrame | null) => {
    const reduced = prefersReducedMotion();
    const behind = stackRef.current?.querySelector<HTMLElement>('[data-layer="next"]');
    if (!frame) {
      card.style.transition = '';
      card.style.transform = '';
      setFeedback(card, null, 0);
      // Every layer: if the queue moved mid-drag, the painted one is now on top.
      stackRef.current?.querySelectorAll<HTMLElement>('[data-layer]').forEach((layer) => {
        layer.style.transition = '';
        layer.style.opacity = '';
        layer.style.transform = layer.dataset.layer === 'next' ? BEHIND_TRANSFORM : 'none';
      });
      return;
    }
    const rotate = reduced ? 0 : tilt(frame.offset, frame.cardWidth);
    card.style.transition = 'none';
    card.style.transform = `translate3d(${frame.offset}px, 0, 0) rotate(${rotate}deg)`;
    setFeedback(
      card,
      frame.offset > 0 ? 'shortlist' : frame.offset < 0 ? 'skip' : null,
      frame.progress,
    );
    if (behind && !reduced) {
      const left = 1 - frame.progress;
      behind.style.transition = 'none';
      behind.style.transform = `translateY(${BEHIND_DROP_PX * left}px) scale(${1 - (1 - BEHIND_SCALE) * left})`;
      behind.style.opacity = String(0.8 + 0.2 * frame.progress);
    }
  }, []);

  const currentId = current?.id ?? null;
  const handlers = useSwipeGesture({ cardKey: currentId, paint, onSwipe });

  // One keyed list, so the waiting card keeps its element as it moves to the top.
  const cards = current ? (next && next.id !== current.id ? [next, current] : [current]) : [];

  return (
    <div
      ref={stackRef}
      className="relative h-[60dvh] min-h-[300px]"
      style={height === null ? undefined : { height }}
      data-testid="card-stack"
    >
      {cards.map((job) => {
        const isTop = job.id === currentId;
        return (
          <Layer key={job.id} isTop={isTop}>
            <TriageCard
              job={job}
              isTop={isTop}
              handlers={isTop ? handlers : undefined}
              onOpen={() => onOpen(job.id)}
            />
          </Layer>
        );
      })}
      {exits.map((exit) => (
        <ExitingCard key={exit.key} exit={exit} onDone={onExitDone} />
      ))}
    </div>
  );
}
