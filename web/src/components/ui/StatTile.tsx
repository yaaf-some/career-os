import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { tint } from '@/lib/stages';

/** One number with a label, tinted with a color token. Clickable with `onClick`. */
export function StatTile({
  label,
  value,
  color = 'var(--wp-accent)',
  active = false,
  onClick,
}: {
  label: string;
  value: ReactNode;
  color?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      aria-pressed={onClick ? active : undefined}
      onClick={onClick}
      className={cn('rounded-[14px] border px-3 py-2.5 text-left', onClick && 'tap-control')}
      style={{
        backgroundColor: tint(color, active ? 24 : 11),
        borderColor: active ? color : 'transparent',
      }}
    >
      <div className="font-mono-meta text-2xl font-semibold leading-none" style={{ color }}>
        {value}
      </div>
      <div className="mt-1.5 text-xs font-medium text-[var(--wp-secondary)]">{label}</div>
    </Tag>
  );
}
