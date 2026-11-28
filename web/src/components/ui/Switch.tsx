import { Switch as BaseSwitch } from '@base-ui/react/switch';
import { cn } from '@/lib/cn';

export function Switch({
  checked,
  onCheckedChange,
  disabled = false,
  ariaLabel,
  id,
  className,
}: {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
  id?: string;
  className?: string;
}) {
  return (
    <BaseSwitch.Root
      id={id}
      checked={checked}
      disabled={disabled}
      aria-label={ariaLabel}
      onCheckedChange={(next) => onCheckedChange(next)}
      className={cn(
        'tap-control relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-[var(--wp-hairline)] p-0.5 transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--wp-accent)] disabled:cursor-not-allowed disabled:opacity-45',
        'bg-[var(--wp-raised)] data-[checked]:border-transparent data-[checked]:bg-[var(--wp-accent)]',
        className,
      )}
    >
      <BaseSwitch.Thumb className="pointer-events-none block h-4.5 w-4.5 rounded-full bg-[var(--wp-surface)] shadow-xs transition-transform data-[checked]:translate-x-5" />
    </BaseSwitch.Root>
  );
}
