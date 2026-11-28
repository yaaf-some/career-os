import { Select as BaseSelect } from '@base-ui/react/select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

export function Select<T extends string>({
  value,
  onValueChange,
  options,
  ariaLabel,
  placeholder = 'Select…',
  disabled = false,
  className,
}: {
  value: T;
  onValueChange: (next: T) => void;
  options: readonly SelectOption<T>[];
  ariaLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <BaseSelect.Root
      // Without `items`, the trigger shows the raw value instead of its label.
      items={options as SelectOption<T>[]}
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (next != null) onValueChange(next as T);
      }}
    >
      <BaseSelect.Trigger
        aria-label={ariaLabel}
        className={cn(
          'tap-control inline-flex h-9 items-center justify-between gap-2 rounded-[10px] border border-[var(--wp-hairline)] bg-[var(--wp-surface)] px-3 text-xs font-medium text-[var(--wp-ink)] shadow-[var(--wp-shadow-sm)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--wp-accent)] disabled:opacity-50',
          className,
        )}
      >
        <BaseSelect.Value placeholder={placeholder} />
        <BaseSelect.Icon className="text-[var(--wp-muted)]">
          <ChevronDown className="h-3.5 w-3.5" />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner sideOffset={6} align="start" className="z-50">
          <BaseSelect.Popup className="paper-floating min-w-[160px] rounded-[12px] p-1 text-xs outline-none">
            <BaseSelect.List className="space-y-0.5">
              {options.map((opt) => (
                <BaseSelect.Item
                  key={opt.value}
                  value={opt.value}
                  className="flex cursor-pointer items-center justify-between gap-3 rounded-[8px] px-2.5 py-2 text-[var(--wp-ink)] outline-none select-none data-[highlighted]:bg-[var(--wp-raised)] data-[selected]:font-medium"
                >
                  <BaseSelect.ItemText>{opt.label}</BaseSelect.ItemText>
                  <BaseSelect.ItemIndicator className="text-[var(--wp-accent)]">
                    <Check className="h-3.5 w-3.5" />
                  </BaseSelect.ItemIndicator>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
