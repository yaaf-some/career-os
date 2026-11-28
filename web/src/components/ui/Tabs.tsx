import { Tabs as BaseTabs } from '@base-ui/react/tabs';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export const TabsRoot = BaseTabs.Root;

export function TabsList({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <BaseTabs.List
      className={cn(
        'flex gap-5 border-b border-[var(--wp-hairline)] text-xs font-medium',
        className,
      )}
    >
      {children}
    </BaseTabs.List>
  );
}

export function TabsTab({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <BaseTabs.Tab
      value={value}
      className={cn(
        'border-b-2 border-transparent pb-2.5 text-[var(--wp-muted)] outline-none transition-colors hover:text-[var(--wp-ink)] data-[active]:border-[var(--wp-accent)] data-[active]:text-[var(--wp-ink)]',
        className,
      )}
    >
      {children}
    </BaseTabs.Tab>
  );
}

export const TabsPanel = BaseTabs.Panel;
