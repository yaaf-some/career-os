import type { ReactNode } from 'react';

const TONES = {
  success: 'bg-[var(--wp-good-soft)] text-[var(--wp-good)]',
  warning: 'bg-[var(--wp-warn-soft)] text-[var(--wp-warn)]',
  danger: 'bg-[var(--wp-bad-soft)] text-[var(--wp-bad)]',
} as const;

export function Notice({ tone, children }: { tone: keyof typeof TONES; children: ReactNode }) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={`rounded-[10px] px-3 py-2 text-xs ${TONES[tone]}`}
    >
      {children}
    </div>
  );
}
