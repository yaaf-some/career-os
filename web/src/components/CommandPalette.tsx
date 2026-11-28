import { useNavigate } from '@tanstack/react-router';
import {
  Briefcase,
  CalendarCheck2,
  Inbox,
  Moon,
  Plus,
  Radar,
  Radio,
  RefreshCw,
  Search,
  Settings,
  Sun,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { useScanSourcesMutation, useSyncGoogleMutation } from '@/api/queries';
import {
  DialogContent,
  DialogRoot,
  DialogTitle,
  Input,
  Kbd,
  useToast,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import { useTheme } from '@/lib/theme';

interface CommandItem {
  id: string;
  label: string;
  group: 'Navigate' | 'Actions';
  keywords: string;
  icon: ComponentType<{ className?: string }>;
  run: () => void;
}

export function CommandPalette({
  open,
  onOpenChange,
  onOpenQuickAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenQuickAdd: () => void;
}) {
  const navigate = useNavigate();
  const scanMutation = useScanSourcesMutation();
  const syncGoogleMutation = useSyncGoogleMutation();
  const { resolved, toggleLightDark } = useTheme();
  const { showToast } = useToast();

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setActiveIndex(0);
    }
  }, [open]);

  const items = useMemo<CommandItem[]>(
    () => [
      {
        id: 'quick-add',
        label: 'Add job posting URL',
        group: 'Actions',
        keywords: 'quick add url ingest job',
        icon: Plus,
        run: () => {
          onOpenChange(false);
          onOpenQuickAdd();
        },
      },
      {
        id: 'nav-today',
        label: 'Go to Today',
        group: 'Navigate',
        keywords: 'home briefing replies agenda',
        icon: CalendarCheck2,
        run: () => {
          onOpenChange(false);
          void navigate({ to: '/' });
        },
      },
      {
        id: 'nav-triage',
        label: 'Go to Triage',
        group: 'Navigate',
        keywords: 'inbox focus queue review score',
        icon: Inbox,
        run: () => {
          onOpenChange(false);
          void navigate({ to: '/triage' });
        },
      },
      {
        id: 'nav-tracker',
        label: 'Go to Tracker',
        group: 'Navigate',
        keywords: 'applications stages pipeline follow up',
        icon: Briefcase,
        run: () => {
          onOpenChange(false);
          void navigate({ to: '/tracker' });
        },
      },
      {
        id: 'nav-sources',
        label: 'Go to Job Boards & Sources',
        group: 'Navigate',
        keywords: 'ats greenhouse lever reddit audit',
        icon: Radio,
        run: () => {
          onOpenChange(false);
          void navigate({ to: '/sources' });
        },
      },
      {
        id: 'nav-settings',
        label: 'Go to Settings',
        group: 'Navigate',
        keywords: 'appearance theme ai routing google maps linear',
        icon: Settings,
        run: () => {
          onOpenChange(false);
          void navigate({ to: '/settings' });
        },
      },
      {
        id: 'scan-sources',
        label: 'Scan job boards now',
        group: 'Actions',
        keywords: 'ats reddit fetch refresh scan',
        icon: Radar,
        run: () => {
          onOpenChange(false);
          scanMutation.mutate(undefined, {
            onSuccess: (res) =>
              showToast({
                tone: 'success',
                message: `Scanned ${res.scannedSources} boards · ${res.newMatches} new matches`,
              }),
            onError: () =>
              showToast({ tone: 'danger', message: 'Board scan failed — check Sources' }),
          });
        },
      },
      {
        id: 'sync-google',
        label: 'Sync Gmail & Calendar',
        group: 'Actions',
        keywords: 'google oauth workspace sync',
        icon: RefreshCw,
        run: () => {
          onOpenChange(false);
          syncGoogleMutation.mutate(undefined, {
            onSuccess: (res) =>
              showToast({
                tone: 'success',
                message: `Google sync ${res.status} · ${res.itemsFetched} items`,
              }),
            onError: () =>
              showToast({ tone: 'warning', message: 'Google sync unavailable — check Settings' }),
          });
        },
      },
      {
        id: 'toggle-theme',
        label: resolved === 'dark' ? 'Switch to Warm Paper Light' : 'Switch to Warm Charcoal Dark',
        group: 'Actions',
        keywords: 'theme appearance dark light mode',
        icon: resolved === 'dark' ? Sun : Moon,
        run: () => {
          toggleLightDark();
          onOpenChange(false);
        },
      },
    ],
    [navigate, onOpenChange, onOpenQuickAdd, resolved, scanMutation, showToast, syncGoogleMutation, toggleLightDark],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.keywords.toLowerCase().includes(q) ||
        item.group.toLowerCase().includes(q),
    );
  }, [items, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [filtered.length]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (filtered.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % filtered.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      filtered[activeIndex]?.run();
    }
  };

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent ariaLabel="Command palette" className="max-w-md p-0 overflow-hidden">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <div
          className="flex items-center gap-2 border-b border-[var(--wp-hairline)] px-4 py-3"
          onKeyDown={handleKeyDown}
        >
          <Search className="h-4 w-4 shrink-0 text-[var(--wp-muted)]" />
          <Input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to view or run action…"
            aria-label="Search commands"
            className="h-8 border-0 bg-transparent px-0 focus-visible:ring-0"
          />
          <Kbd>Esc</Kbd>
        </div>

        <div className="max-h-72 overflow-y-auto p-2" role="listbox" aria-label="Commands">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-[var(--wp-muted)]">
              No matching commands
            </div>
          ) : (
            filtered.map((item, idx) => {
              const Icon = item.icon;
              const selected = idx === activeIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={item.run}
                  className={cn(
                    'flex w-full items-center justify-between gap-3 rounded-[10px] px-3 py-2.5 text-left text-sm transition-colors',
                    selected
                      ? 'bg-[var(--wp-raised)] text-[var(--wp-ink)]'
                      : 'text-[var(--wp-secondary)] hover:bg-[var(--wp-raised)]/60',
                  )}
                >
                  <span className="flex items-center gap-2.5">
                    <Icon
                      className={cn(
                        'h-4 w-4 shrink-0',
                        selected ? 'text-[var(--wp-accent)]' : 'text-[var(--wp-muted)]',
                      )}
                    />
                    <span className="font-medium">{item.label}</span>
                  </span>
                  <span className="text-[11px] text-[var(--wp-muted)]">{item.group}</span>
                </button>
              );
            })
          )}
        </div>
      </DialogContent>
    </DialogRoot>
  );
}
