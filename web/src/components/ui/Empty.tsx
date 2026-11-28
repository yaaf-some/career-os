import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Empty({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'paper-sheet calm-rise rounded-[20px] p-8 text-center space-y-2',
        className,
      )}
    >
      <div className="font-serif-title text-xl text-[var(--wp-ink)]">{title}</div>
      {description ? <p className="text-sm text-[var(--wp-secondary)]">{description}</p> : null}
      {action ? <div className="pt-2">{action}</div> : null}
    </div>
  );
}
