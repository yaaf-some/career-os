import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'icon';

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--wp-btn-bg)] text-[var(--wp-btn-ink)] border border-transparent hover:opacity-92',
  secondary:
    'bg-[var(--wp-surface)] text-[var(--wp-ink)] border border-[var(--wp-hairline)] shadow-[var(--wp-shadow-sm)] hover:bg-[var(--wp-raised)]',
  ghost:
    'bg-transparent text-[var(--wp-secondary)] border border-transparent hover:bg-[var(--wp-raised)] hover:text-[var(--wp-ink)]',
  danger:
    'bg-[var(--wp-bad-soft)] text-[var(--wp-bad)] border border-transparent hover:opacity-90',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5 rounded-[10px]',
  md: 'h-10 px-4 text-sm gap-2 rounded-[12px]',
  icon: 'h-9 w-9 p-0 rounded-[10px]',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      type={type}
      className={cn(
        'tap-control inline-flex items-center justify-center font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--wp-accent)] disabled:pointer-events-none disabled:opacity-45',
        BUTTON_STYLES[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...props}
    />
  );
}
