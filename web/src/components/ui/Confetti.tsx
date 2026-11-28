import { useMemo } from 'react';
import { prefersReducedMotion } from '@/lib/theme';

const PIECES = 36;

/**
 * A short burst for real wins. Renders nothing for reduced motion. Place inside
 * a `relative` container and change `key` to play it again.
 */
export function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: PIECES }, (_, i) => ({
        left: `${(i * 97) % 100}%`,
        color: `var(--hue-${(i % 8) + 1})`,
        delay: `${(i % 9) * 45}ms`,
        drift: `${((i * 53) % 90) - 45}px`,
        spin: `${((i * 131) % 720) - 360}deg`,
      })),
    [],
  );
  if (prefersReducedMotion()) return null;
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-80 overflow-hidden">
      {pieces.map((p, i) => (
        <span
          key={i}
          className="confetti-piece"
          style={
            {
              left: p.left,
              backgroundColor: p.color,
              animationDelay: p.delay,
              '--drift': p.drift,
              '--spin': p.spin,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
