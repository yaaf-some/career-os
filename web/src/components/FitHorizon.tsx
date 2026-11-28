import type { ScoreBreakdown } from '@/api/types';
import { formatMatchScore } from '@/api/jobs';
import { cn } from '@/lib/cn';

export function FitHorizon({
  score,
  breakdown,
  source,
  compact = false,
}: {
  score: number | null;
  breakdown?: ScoreBreakdown | null;
  source?: string;
  compact?: boolean;
}) {
  const highConviction = score !== null && score >= 75;
  const rolePct = breakdown ? Math.max(0, Math.min(35, breakdown.roleStack)) : 0;
  const levelPct = breakdown ? Math.max(0, Math.min(25, breakdown.levelReachability)) : 0;
  const vibePct = breakdown ? Math.max(0, Math.min(25, breakdown.vibeCulture)) : 0;
  const logPct = breakdown ? Math.max(0, Math.min(15, breakdown.logisticsComp)) : 0;

  return (
    <div className="space-y-2.5" data-testid="fit-horizon">
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              'font-mono-meta font-medium',
              compact ? 'text-xl' : 'text-2xl',
              highConviction ? 'text-[var(--wp-good)]' : 'text-[var(--wp-ink)]',
            )}
          >
            {score !== null ? Math.round(score) : '—'}
          </span>
          <span className="text-xs text-[var(--wp-muted)]">
            {score !== null ? 'of 100 fit' : formatMatchScore(score)}
          </span>
        </div>
        {source ? (
          <span className="font-mono-meta text-xs text-[var(--wp-muted)]">{source}</span>
        ) : null}
      </div>

      {breakdown ? (
        <>
          <div
            className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-[var(--wp-raised)]"
            aria-label="4-part fit breakdown"
          >
            <div
              className="h-full rounded-l-full bg-[var(--fit-role)]"
              style={{ width: `${rolePct}%` }}
            />
            <div
              className="h-full bg-[var(--fit-level)]"
              style={{ width: `${levelPct}%` }}
            />
            <div
              className="h-full bg-[var(--fit-vibe)]"
              style={{ width: `${vibePct}%` }}
            />
            <div
              className="h-full rounded-r-full bg-[var(--fit-logistics)]"
              style={{ width: `${logPct}%` }}
            />
          </div>

          <div className="font-mono-meta flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs text-[var(--wp-secondary)]">
            {[
              ['Role', breakdown.roleStack, 35, 'var(--fit-role)'],
              ['Level', breakdown.levelReachability, 25, 'var(--fit-level)'],
              ['Vibe', breakdown.vibeCulture, 25, 'var(--fit-vibe)'],
              ['Logistics', breakdown.logisticsComp, 15, 'var(--fit-logistics)'],
            ].map(([label, value, max, color]) => (
              <span key={label} className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: String(color) }} />
                <span>{`${label} ${value}/${max}`}</span>
              </span>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
