import { cn } from '@/lib/cn';
import { scoreColor } from '@/lib/stages';

/** Fit score (0–100) as a ring colored by how strong the match is. */
export function ScoreRing({
  score,
  size = 40,
  className,
}: {
  score: number | null;
  size?: number;
  className?: string;
}) {
  const radius = 16;
  const length = 2 * Math.PI * radius;
  const filled = score === null ? 0 : (Math.max(0, Math.min(100, score)) / 100) * length;
  const color = scoreColor(score);
  return (
    <span
      role="img"
      aria-label={score === null ? 'Not scored' : `Fit score ${Math.round(score)} of 100`}
      className={cn('relative inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 40 40" className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx="20" cy="20" r={radius} fill="none" stroke="var(--wp-raised)" strokeWidth="4" />
        {filled > 0 ? (
          <circle
            cx="20"
            cy="20"
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={`${filled} ${length}`}
          />
        ) : null}
      </svg>
      <span className="font-mono-meta font-semibold" style={{ color, fontSize: size * 0.31 }}>
        {score === null ? '—' : Math.round(score)}
      </span>
    </span>
  );
}
