import { Meter as BaseMeter } from '@base-ui/react/meter';
import { cn } from '@/lib/cn';

export function Meter({
  value,
  max = 100,
  label,
  valueText,
  tone = 'accent',
  className,
}: {
  value: number;
  max?: number;
  label?: string;
  valueText?: string;
  tone?: 'accent' | 'good' | 'warn' | 'bad';
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(max, Number.isFinite(value) ? value : 0));
  const fillColor =
    tone === 'good'
      ? 'bg-[var(--wp-good)]'
      : tone === 'warn'
        ? 'bg-[var(--wp-warn)]'
        : tone === 'bad'
          ? 'bg-[var(--wp-bad)]'
          : 'bg-[var(--wp-accent)]';

  return (
    <BaseMeter.Root value={clamped} max={max} className={cn('space-y-1.5', className)}>
      {label || valueText ? (
        <div className="flex items-center justify-between text-xs">
          {label ? <BaseMeter.Label className="text-[var(--wp-secondary)]">{label}</BaseMeter.Label> : <span />}
          {valueText ? (
            <BaseMeter.Value className="font-mono-meta text-[var(--wp-muted)]">
              {() => valueText}
            </BaseMeter.Value>
          ) : null}
        </div>
      ) : null}
      <BaseMeter.Track className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--wp-raised)]">
        <BaseMeter.Indicator
          className={cn('h-full rounded-full transition-all', fillColor)}
          style={{ width: `${(clamped / Math.max(1, max)) * 100}%` }}
        />
      </BaseMeter.Track>
    </BaseMeter.Root>
  );
}
