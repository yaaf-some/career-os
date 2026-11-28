import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type BadgeVariant = 'neutral' | 'brand' | 'success' | 'warning' | 'danger';

const BADGE_STYLES: Record<BadgeVariant, string> = {
  neutral: 'border-[var(--wp-hairline)] bg-[var(--wp-raised)] text-[var(--wp-secondary)]',
  brand: 'border-transparent bg-[var(--wp-accent-soft)] text-[var(--wp-accent)]',
  success: 'border-transparent bg-[var(--wp-good-soft)] text-[var(--wp-good)]',
  warning: 'border-transparent bg-[var(--wp-warn-soft)] text-[var(--wp-warn)]',
  danger: 'border-transparent bg-[var(--wp-bad-soft)] text-[var(--wp-bad)]',
};

export function Badge({
  variant = 'neutral',
  className,
  children,
}: {
  variant?: BadgeVariant;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        BADGE_STYLES[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
