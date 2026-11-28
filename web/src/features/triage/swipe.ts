/** The decisions behind a swipe, kept free of the DOM so they can be tested. */
import type { VerdictAction } from './api';

/** Movement before a touch counts as a drag or a scroll. */
export const SLOP_PX = 8;
/** How much more sideways than vertical a movement must be to drag the card. */
const AXIS_BIAS = 1.2;
const COMMIT_RATIO = 0.32;
const MIN_COMMIT_PX = 72;
const MAX_COMMIT_PX = 190;
const FALLBACK_WIDTH = 320;
/** Pixels per millisecond that count as a flick. */
export const FLICK_VELOCITY = 0.5;
/** A flick still has to travel this far. */
const FLICK_MIN_PX = 32;
/** Only movement this recent says how fast the finger is going. */
export const VELOCITY_WINDOW_MS = 100;

export interface Sample {
  x: number;
  t: number;
}

export function lockAxis(dx: number, dy: number): 'pending' | 'horizontal' | 'vertical' {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < SLOP_PX) return 'pending';
  return Math.abs(dx) > Math.abs(dy) * AXIS_BIAS ? 'horizontal' : 'vertical';
}

/** How far the card must travel to commit, relative to its width. */
export function commitDistance(cardWidth: number): number {
  const width = cardWidth > 0 ? cardWidth : FALLBACK_WIDTH;
  return Math.min(MAX_COMMIT_PX, Math.max(MIN_COMMIT_PX, width * COMMIT_RATIO));
}

/** Speed at release. A finger that stopped before lifting has none. */
export function releaseVelocity(samples: readonly Sample[], releasedAt: number): number {
  const recent = samples.filter((s) => releasedAt - s.t <= VELOCITY_WINDOW_MS);
  if (recent.length < 2) return 0;
  const first = recent[0];
  const last = recent[recent.length - 1];
  // At least one frame, so two events in the same instant are not infinitely fast.
  return (last.x - first.x) / Math.max(16, last.t - first.t);
}

export function decideSwipe(dx: number, velocity: number, cardWidth: number): VerdictAction | null {
  if (dx === 0) return null;
  const flick = Math.abs(velocity) >= FLICK_VELOCITY;
  // Flicking back toward the middle is a change of mind.
  if (flick && Math.sign(velocity) !== Math.sign(dx)) return null;
  const farEnough = Math.abs(dx) >= commitDistance(cardWidth);
  if (!farEnough && !(flick && Math.abs(dx) >= FLICK_MIN_PX)) return null;
  return dx > 0 ? 'shortlist' : 'skip';
}
