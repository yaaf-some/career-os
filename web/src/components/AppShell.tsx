import { Link, useRouterState } from '@tanstack/react-router';
import {
  Briefcase,
  CalendarCheck2,
  Inbox,
  Radio,
  Settings,
  Terminal,
} from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';
import { isDemoModeActive } from '@/api/client';
import { useAiUsageQuery, useHealthQuery } from '@/api/queries';
import { Badge } from '@/components/ui';
import { UsageBar } from '@/components/UsageBar';
import { cn } from '@/lib/cn';

export type NavPath = '/' | '/triage' | '/tracker' | '/sources' | '/settings';

interface NavItem {
  to: NavPath;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

const NAV_ITEMS: readonly NavItem[] = [
  { to: '/', label: 'Today', icon: CalendarCheck2 },
  { to: '/triage', label: 'Triage', icon: Inbox },
  { to: '/tracker', label: 'Tracker', icon: Briefcase },
  { to: '/sources', label: 'Sources', icon: Radio },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const healthQuery = useHealthQuery();
  const usageQuery = useAiUsageQuery();

  const demoActive = Boolean(healthQuery.data?.demoMode) || isDemoModeActive();

  return (
    <div className="min-h-dvh bg-background text-foreground flex flex-col md:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex md:w-60 md:shrink-0 md:flex-col border-r border-border bg-card/50">
        <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-brand/15 text-accent-brand">
              <Terminal className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-semibold leading-tight">Career OS</div>
              <div className="text-[11px] text-muted-foreground">Local-First PWA</div>
            </div>
          </div>
          <Badge variant={demoActive ? 'warning' : 'success'}>
            {demoActive ? 'Demo' : 'Live'}
          </Badge>
        </div>

        <nav className="flex-1 space-y-1 p-3" aria-label="Primary navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active =
              item.to === '/'
                ? pathname === '/'
                : pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  active
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-border p-3 text-xs text-muted-foreground">
          <div className="font-medium text-foreground">Tiers</div>
          <div className="mt-1 flex items-center justify-between">
            <span>hydrogen</span>
            <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px]">Fast Triage</span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span>neon</span>
            <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px]">Deep Eval A–G</span>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Usage Bar Header */}
        <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-md">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
            <div className="flex items-center gap-2 md:hidden">
              <Terminal className="h-4 w-4 text-accent-brand" />
              <span className="text-sm font-semibold">Career OS</span>
              <Badge variant={demoActive ? 'warning' : 'success'}>
                {demoActive ? 'Demo' : 'Live'}
              </Badge>
            </div>
            <UsageBar usage={usageQuery.data} isLoading={usageQuery.isLoading} />
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 pb-24 md:px-6 md:pb-8">
          {children}
        </main>
      </div>

      {/* Mobile Bottom Navigation */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-background/95 backdrop-blur-md md:hidden"
        aria-label="Mobile navigation"
      >
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active =
            item.to === '/'
              ? pathname === '/'
              : pathname.startsWith(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                'flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium transition-colors',
                active ? 'text-accent-brand' : 'text-muted-foreground',
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
