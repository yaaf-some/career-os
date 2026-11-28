import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import {
  Briefcase,
  FolderOpen,
  Inbox,
  Plus,
  Radio,
  Search,
  SlidersHorizontal,
  Sun,
} from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import { isDemoModeActive } from '@/api/client';
import {
  useAiUsageQuery,
  useGoogleAuthMutation,
  useGoogleAuthStatusQuery,
  useHealthQuery,
} from '@/api/queries';
import { AlertBanner } from '@/components/AlertBanner';
import { CommandPalette } from '@/components/CommandPalette';
import { QuickAddDialog } from '@/components/QuickAddDialog';
import { StatusFooter } from '@/components/StatusFooter';
import { Kbd } from '@/components/ui';
import { cn } from '@/lib/cn';

export type NavPath = '/' | '/triage' | '/today' | '/files' | '/sources' | '/settings';

interface NavItem {
  to: NavPath;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

const DESKTOP_NAV_ITEMS: readonly NavItem[] = [
  { to: '/', label: 'Jobs', icon: Briefcase },
  { to: '/triage', label: 'Triage', icon: Inbox },
  { to: '/today', label: 'Today', icon: Sun },
  { to: '/files', label: 'Files', icon: FolderOpen },
  { to: '/sources', label: 'Sources', icon: Radio },
  { to: '/settings', label: 'Settings', icon: SlidersHorizontal },
];

const MOBILE_NAV_ITEMS: readonly NavItem[] = DESKTOP_NAV_ITEMS.filter((i) => i.to !== '/sources');

/** Job pages belong to the Jobs tab. */
const isActive = (to: NavPath, pathname: string) =>
  to === '/' ? pathname === '/' || pathname.startsWith('/jobs/') : pathname.startsWith(to);

interface AppActionsContextValue {
  openQuickAdd: () => void;
  openCommandPalette: () => void;
}

const AppActionsContext = createContext<AppActionsContextValue>({
  openQuickAdd: () => {},
  openCommandPalette: () => {},
});

export function useAppActions(): AppActionsContextValue {
  return useContext(AppActionsContext);
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const healthQuery = useHealthQuery();
  const usageQuery = useAiUsageQuery();
  const googleStatusQuery = useGoogleAuthStatusQuery();
  const googleAuthMutation = useGoogleAuthMutation();

  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);

  const openQuickAdd = useCallback(() => setQuickAddOpen(true), []);
  const openCommandPalette = useCallback(() => setCommandOpen(true), []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleQuickReconnect = () => {
    googleAuthMutation.mutate(undefined, {
      onSuccess: (res) => {
        if (res.authUrl && typeof window !== 'undefined') {
          window.open(res.authUrl, '_blank', 'noopener,noreferrer');
        }
      },
    });
  };

  const demoActive = Boolean(healthQuery.data?.demoMode) || isDemoModeActive();

  const actionsValue = useMemo(
    () => ({ openQuickAdd, openCommandPalette }),
    [openQuickAdd, openCommandPalette],
  );

  return (
    <AppActionsContext.Provider value={actionsValue}>
      <div className="flex min-h-dvh flex-col bg-[var(--wp-canvas)] text-[var(--wp-ink)] md:flex-row">
        {/* Quiet Desktop Sidebar */}
        <aside className="hidden md:flex md:w-60 md:shrink-0 md:flex-col md:justify-between border-r border-[var(--wp-hairline)] bg-[var(--wp-sidebar)] p-4">
          <div className="space-y-5">
            <div className="flex items-center justify-between px-2 pt-1">
              <span className="text-base font-medium tracking-tight text-[var(--wp-ink)]">
                Career OS
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={openCommandPalette}
                  aria-label="Open command palette"
                  title="Command palette (⌘K)"
                  className="tap-control flex h-8 items-center gap-1 rounded-[9px] bg-[var(--wp-raised)] px-2 text-xs text-[var(--wp-muted)] hover:text-[var(--wp-ink)]"
                >
                  <Search className="h-3.5 w-3.5" />
                  <Kbd className="border-0 bg-transparent px-0">⌘K</Kbd>
                </button>
                <button
                  type="button"
                  onClick={openQuickAdd}
                  aria-label="Add job URL"
                  title="Add job posting"
                  className="tap-control flex h-8 w-8 items-center justify-center rounded-[9px] bg-[var(--wp-raised)] text-[var(--wp-ink)] hover:opacity-90"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>

            <nav className="space-y-1" aria-label="Primary navigation">
              {DESKTOP_NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.to, pathname);
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={cn(
                      'tap-control flex h-9 items-center gap-2.5 rounded-[10px] px-2.5 text-sm font-medium',
                      active
                        ? 'bg-[var(--wp-surface)] text-[var(--wp-ink)] shadow-[var(--wp-shadow-sm)]'
                        : 'text-[var(--wp-secondary)] hover:bg-[var(--wp-surface)]/60 hover:text-[var(--wp-ink)]',
                    )}
                  >
                    <Icon
                      className={cn(
                        'h-4 w-4 shrink-0',
                        active ? 'text-[var(--wp-accent)]' : 'text-[var(--wp-muted)]',
                      )}
                    />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>

          <StatusFooter
            demoActive={demoActive}
            usage={usageQuery.data}
            googleStatus={googleStatusQuery.data}
          />
        </aside>

        {/* Main Content Area */}
        <div className="flex min-w-0 flex-1 flex-col">
          <AlertBanner
            googleStatus={googleStatusQuery.data}
            usage={usageQuery.data}
            isReconnecting={googleAuthMutation.isPending}
            onReconnect={handleQuickReconnect}
          />

          <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-5 pb-24 md:px-8 md:py-6 md:pb-8">
            {children}
          </main>
        </div>

        {/* Mobile Bottom Navigation (4-Tab Safe Area) */}
        <nav
          className="pb-safe fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-[var(--wp-hairline)] bg-[var(--wp-surface)]/95 px-2 backdrop-blur-md md:hidden"
          aria-label="Mobile navigation"
        >
          {MOBILE_NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.to, pathname);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  'tap-control flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium',
                  active ? 'text-[var(--wp-accent)]' : 'text-[var(--wp-muted)]',
                )}
              >
                <Icon className="h-[18px] w-[18px]" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <QuickAddDialog
          open={quickAddOpen}
          onOpenChange={setQuickAddOpen}
          onCreated={(jobId) => void navigate({ to: '/jobs/$jobId', params: { jobId } })}
        />
        <CommandPalette
          open={commandOpen}
          onOpenChange={setCommandOpen}
          onOpenQuickAdd={openQuickAdd}
        />
      </div>
    </AppActionsContext.Provider>
  );
}
