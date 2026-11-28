import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function PaperSheet({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'paper-sheet rounded-[16px] text-[var(--wp-ink)]',
        className,
      )}
      {...props}
    />
  );
}

/** Alias preserving compatibility across existing views during staged migration. */
export const Card = PaperSheet;

export function InsetGroup({
  label,
  trailing,
  className,
  children,
}: {
  label?: ReactNode;
  trailing?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn('space-y-2', className)}>
      {label || trailing ? (
        <div className="flex items-center justify-between px-1 text-xs font-medium text-[var(--wp-muted)]">
          <div>{label}</div>
          {trailing ? <div className="font-mono-meta">{trailing}</div> : null}
        </div>
      ) : null}
      <div className="paper-sheet divide-y divide-[var(--wp-hairline)] overflow-hidden rounded-[16px]">
        {children}
      </div>
    </section>
  );
}

export function InsetRow({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-4 py-3', className)} {...props} />;
}

export function SectionHeader({
  title,
  subtitle,
  action,
  serif = false,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  serif?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1
          className={cn(
            serif ? 'font-serif-title text-2xl' : 'text-lg font-medium tracking-tight',
            'text-[var(--wp-ink)]',
          )}
        >
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1 text-xs text-[var(--wp-muted)]">{subtitle}</p>
        ) : null}
      </div>
      {action ? <div className="flex items-center gap-2">{action}</div> : null}
    </div>
  );
}
