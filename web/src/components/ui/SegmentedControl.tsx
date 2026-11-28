import { cn } from '@/lib/cn';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  ariaLabel,
  fullWidth = false,
  className,
}: {
  value: T;
  onValueChange: (next: T) => void;
  options: readonly SegmentedOption<T>[];
  ariaLabel?: string;
  fullWidth?: boolean;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'rounded-[10px] border border-[var(--wp-hairline)] bg-[var(--wp-canvas)] p-1 text-xs',
        fullWidth ? 'grid' : 'inline-flex items-center',
        className,
      )}
      style={
        fullWidth
          ? { gridTemplateColumns: `repeat(${Math.max(1, options.length)}, minmax(0, 1fr))` }
          : undefined
      }
    >
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onValueChange(opt.value)}
            className={cn(
              'tap-control rounded-[7px] px-3 py-1.5 font-medium outline-none focus-visible:outline-2 focus-visible:outline-[var(--wp-accent)]',
              selected
                ? 'bg-[var(--wp-surface)] text-[var(--wp-ink)] shadow-[var(--wp-shadow-sm)]'
                : 'text-[var(--wp-muted)] hover:text-[var(--wp-ink)]',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
