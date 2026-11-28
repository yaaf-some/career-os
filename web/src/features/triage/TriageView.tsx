import { History, List, Plus, SlidersHorizontal, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useJobsQuery } from '@/api/queries';
import type { JobSummary } from '@/api/types';
import { useAppActions } from '@/components/AppShell';
import {
  Button,
  Empty,
  Input,
  Notice,
  PageHeader,
  ScoreRing,
  SegmentedControl,
  Sheet,
  SheetClose,
  SheetTitle,
  Skeleton,
  Switch,
} from '@/components/ui';
import { ActionDock } from './ActionDock';
import type { VerdictAction } from './api';
import { canAnimate, CardStack, type CardExit } from './CardStack';
import {
  readPrefs,
  sortAndFilter,
  writePrefs,
  type QueuePrefs,
  type SortKey,
  type TriageMode,
} from './queue';
import { QueueComplete } from './QueueComplete';
import { TriageList } from './TriageList';
import { UndoHistory } from './UndoHistory';
import { describeEntry, useVerdicts, type BulkFailure } from './verdictStore';

const headerButton = 'tap-control paper-sheet relative flex h-11 w-11 items-center justify-center rounded-[12px] text-[var(--wp-ink)]';

/** True while a keystroke belongs to a field, a dialog or the browser. */
function shortcutBlocked(e: KeyboardEvent): boolean {
  // A held key must not run through the queue.
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return true;
  const el = document.activeElement;
  if (el instanceof HTMLInputElement && el.type !== 'checkbox') return true;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  return Boolean(document.querySelector('[role="dialog"], [role="alertdialog"]'));
}

export function TriageView({
  onSelectRole,
  undoDelayMs = 3500,
}: {
  onSelectRole: (jobId: string) => void;
  undoDelayMs?: number;
}) {
  const jobsQuery = useJobsQuery();
  const { openQuickAdd } = useAppActions();
  const { hidden, history, saved, skipped, commit, commitBulk, undo } = useVerdicts();

  const [prefs, setPrefs] = useState<QueuePrefs>(readPrefs);
  const [query, setQuery] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [failures, setFailures] = useState<BulkFailure[]>([]);
  const [exits, setExits] = useState<CardExit[]>([]);
  const exitKey = useRef(0);
  const lastIndex = useRef(0);

  const changePrefs = (patch: Partial<QueuePrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    writePrefs(next);
  };
  /** A new order or filter starts again at the top. */
  const toTop = () => {
    lastIndex.current = 0;
    setFocusId(null);
  };

  const queue = useMemo(
    () =>
      (jobsQuery.data?.jobs ?? []).filter(
        (j) => j.triageStatus === 'pending' && !j.archivedAt && !hidden.has(j.id),
      ),
    [jobsQuery.data, hidden],
  );
  const jobs = useMemo(
    () =>
      sortAndFilter(queue, {
        sort: prefs.sort,
        query,
        hideDealbreakers: prefs.hideDealbreakers,
      }),
    [queue, prefs.sort, prefs.hideDealbreakers, query],
  );

  const focused = jobs.findIndex((j) => j.id === focusId);
  const index = focused >= 0 ? focused : Math.max(0, Math.min(lastIndex.current, jobs.length - 1));
  const current: JobSummary | undefined = jobs[index];
  // The waiting card wraps around, so whatever is behind is what comes next.
  const next = jobs.length > 1 ? jobs[(index + 1) % jobs.length] : null;
  const currentId = current?.id ?? null;
  const nextId = next?.id ?? null;

  // Pin the card being read: a refresh that re-sorts must not swap it under a thumb.
  useEffect(() => {
    if (currentId === null) return;
    lastIndex.current = index;
    if (currentId !== focusId) setFocusId(currentId);
  }, [currentId, focusId, index]);

  const mode: TriageMode = prefs.mode;
  const decidedCount = saved + skipped;
  const progress =
    decidedCount + queue.length > 0 ? (decidedCount / (decidedCount + queue.length)) * 100 : 0;
  const latest = history.find((e) => e.status !== 'undoing');
  const filtering = query.trim() !== '' || prefs.hideDealbreakers;
  // The last card still gets to fly off before anything replaces the stack.
  const flying = mode === 'deck' && exits.length > 0;

  const decide = useCallback(
    (action: VerdictAction, jobId: string, offset = 0) => {
      const job = jobs.find((j) => j.id === jobId);
      if (!job || !commit(job, action, undoDelayMs)) return;
      setFailures([]);
      if (jobId !== currentId) return;
      setFocusId(nextId);
      if (mode === 'deck' && canAnimate()) {
        const exit = { key: ++exitKey.current, job, action, offset };
        setExits((prev) => [...prev.slice(-2), exit]);
      }
    },
    [commit, currentId, jobs, mode, nextId, undoDelayMs],
  );
  const removeExit = useCallback(
    (key: number) => setExits((prev) => prev.filter((e) => e.key !== key)),
    [],
  );

  const takeBack = useCallback(
    async (key: number) => {
      setExits([]);
      const [first] = await undo(key);
      if (first) setFocusId(first);
    },
    [undo],
  );
  const latestKey = latest?.key;
  const undoLatest = useCallback(() => {
    if (latestKey !== undefined) void takeBack(latestKey);
  }, [latestKey, takeBack]);

  const decideMany = async (action: VerdictAction, chosen: JobSummary[]) => {
    setSelected(new Set());
    setFailures([]);
    setFailures(await commitBulk(chosen, action));
  };

  const browse = useCallback(
    (step: 1 | -1) => {
      const target = jobs[Math.max(0, Math.min(jobs.length - 1, index + step))];
      if (target) setFocusId(target.id);
    },
    [index, jobs],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (shortcutBlocked(e)) return;
      const key = e.key.toLowerCase();
      if (key === 'z') {
        e.preventDefault();
        undoLatest();
        return;
      }
      if (mode !== 'deck' || !currentId) return;
      if (key === 's' || key === 'x') {
        e.preventDefault();
        decide(key === 's' ? 'shortlist' : 'skip', currentId);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        browse(e.key === 'ArrowRight' ? 1 : -1);
      } else if (e.key === 'Enter') {
        // On a focused button or link, Enter already means that control.
        if (document.activeElement?.closest('button, a, summary, [role="button"]')) return;
        e.preventDefault();
        onSelectRole(currentId);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [browse, currentId, decide, mode, onSelectRole, undoLatest]);

  const left =
    jobs.length === queue.length ? `${queue.length} left` : `${jobs.length} of ${queue.length} shown`;
  const lastVerdict = latest ? (
    <p role="status" className="min-w-0 truncate text-sm text-[var(--wp-secondary)]">
      {describeEntry(latest)}
    </p>
  ) : null;

  return (
    <div className="mx-auto flex max-w-[680px] flex-col gap-3" data-testid="triage-view">
      <PageHeader
        title="Triage"
        subtitle={
          jobsQuery.data ? (
            <span data-testid="triage-counts">
              {left} · {decidedCount} decided this session
            </span>
          ) : null
        }
        actions={
          <>
            <button type="button" onClick={openQuickAdd} aria-label="Add job URL" className={headerButton}>
              <Plus className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => setBrowserOpen(true)}
              aria-label="Browse queue"
              className={headerButton}
            >
              <List className="h-5 w-5" />
            </button>
          </>
        }
      />

      <div className="flex items-center justify-between gap-2">
        <SegmentedControl<TriageMode>
          ariaLabel="Triage view mode"
          value={mode}
          onValueChange={(m) => {
            setExits([]);
            changePrefs({ mode: m });
          }}
          options={[
            { value: 'deck', label: 'Deck' },
            { value: 'list', label: 'List' },
          ]}
          className="[&>button]:min-h-9 [&>button]:min-w-16"
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            aria-label="Undo history"
            className={headerButton}
          >
            <History className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => setFiltersOpen((v) => !v)}
            aria-label="Sort and filter"
            aria-expanded={filtersOpen}
            className={headerButton}
          >
            <SlidersHorizontal className="h-5 w-5" />
            {filtering || prefs.sort !== 'score' ? (
              <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-[var(--wp-accent)]" />
            ) : null}
          </button>
        </div>
      </div>

      {filtersOpen ? (
        <div className="paper-sheet space-y-3 rounded-[14px] p-3" data-testid="triage-filters">
          <Input
            type="search"
            aria-label="Search the queue"
            placeholder="Title, company, place or keyword"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              toTop();
            }}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SegmentedControl<SortKey>
              ariaLabel="Sort queue"
              value={prefs.sort}
              onValueChange={(sort) => {
                changePrefs({ sort });
                toTop();
              }}
              options={[
                { value: 'score', label: 'Best fit' },
                { value: 'newest', label: 'Newest' },
              ]}
            />
            <label className="flex min-h-11 items-center gap-2 text-sm">
              Hide dealbreakers
              <Switch
                ariaLabel="Hide dealbreakers"
                checked={prefs.hideDealbreakers}
                onCheckedChange={(hideDealbreakers) => {
                  changePrefs({ hideDealbreakers });
                  toTop();
                }}
              />
            </label>
          </div>
        </div>
      ) : null}

      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--wp-raised)]"
        role="progressbar"
        aria-label="Share of the queue decided"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress)}
      >
        <div
          className="h-full rounded-full bg-[var(--wp-good)] [transition:width_300ms_var(--ease-calm)]"
          style={{ width: `${progress}%` }}
        />
      </div>

      {failures.length > 0 ? (
        <Notice tone="danger">
          <p className="font-medium">Not updated, still in the queue:</p>
          <ul className="mt-1 list-disc pl-4">
            {failures.map((f) => (
              <li key={f.job.id}>
                {f.job.title} at {f.job.company}: {f.error}
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => setFailures([])} className="mt-1 min-h-8 font-medium underline">
            Dismiss
          </button>
        </Notice>
      ) : null}

      {jobsQuery.isLoading ? (
        <Skeleton className="h-96 w-full rounded-[22px]" />
      ) : jobsQuery.isError && !jobsQuery.data ? (
        <Empty
          title="Could not load your jobs"
          description={jobsQuery.error.message}
          action={
            <Button variant="primary" onClick={() => void jobsQuery.refetch()}>
              Try again
            </Button>
          }
        />
      ) : queue.length === 0 && !flying ? (
        <>
          <QueueComplete saved={saved} skipped={skipped} onAddJob={openQuickAdd} />
          {latest ? (
            <div className="flex items-center justify-center gap-3">
              {lastVerdict}
              <Button className="min-h-11" onClick={undoLatest} aria-label="Undo">
                <Undo2 className="h-4 w-4" />
                Undo
              </Button>
            </div>
          ) : null}
        </>
      ) : jobs.length === 0 && !flying ? (
        <Empty
          title="No matches"
          description={`${queue.length} waiting, but none match your search and filters.`}
          action={
            <Button
              variant="primary"
              onClick={() => {
                setQuery('');
                changePrefs({ hideDealbreakers: false });
                toTop();
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : mode === 'list' ? (
        <>
          <TriageList
            jobs={jobs}
            selected={selected}
            onSelectedChange={setSelected}
            onVerdict={decide}
            onBulk={(action, chosen) => void decideMany(action, chosen)}
            onOpen={onSelectRole}
          />
          {latest ? (
            <div className="paper-floating sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 flex items-center justify-between gap-3 rounded-[14px] py-1.5 pl-4 pr-2 md:bottom-3">
              {lastVerdict}
              <Button className="min-h-11 shrink-0" onClick={undoLatest} aria-label="Undo">
                <Undo2 className="h-4 w-4" />
                Undo
              </Button>
            </div>
          ) : null}
        </>
      ) : current || flying ? (
        <>
          {/* Cards slide to the screen edge without making the page scroll sideways. */}
          <div className="-mx-5 overflow-x-clip px-5 pb-4 md:-mx-8 md:px-8">
            <CardStack
              current={current ?? null}
              next={next}
              exits={exits}
              onExitDone={removeExit}
              onSwipe={decide}
              onOpen={onSelectRole}
            />
          </div>
          {current ? (
          <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 -mx-2 bg-[var(--wp-canvas)] px-2 pb-1 md:bottom-0">
            <div className="flex min-h-5 justify-center">{lastVerdict}</div>
            <ActionDock
              position={index + 1}
              total={jobs.length}
              canUndo={Boolean(latest)}
              onPrevious={() => browse(-1)}
              onNext={() => browse(1)}
              onSkip={() => decide('skip', current.id)}
              onSave={() => decide('shortlist', current.id)}
              onUndo={undoLatest}
            />
          </div>
          ) : null}
        </>
      ) : null}

      <UndoHistory
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        history={history}
        onUndo={(key) => void takeBack(key)}
      />

      <Sheet
        open={browserOpen}
        onOpenChange={setBrowserOpen}
        ariaLabel="Queue browser"
        maxWidthClass="md:max-w-md"
      >
        <div className="flex min-h-0 flex-1 flex-col gap-4 p-5">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-base font-medium">Queue browser</SheetTitle>
            <SheetClose className="tap-control min-h-11 rounded-[10px] bg-[var(--wp-raised)] px-4 text-xs font-medium">
              Done
            </SheetClose>
          </div>
          <div className="paper-sheet min-h-0 flex-1 divide-y divide-[var(--wp-hairline)] overflow-y-auto rounded-[14px]">
            {jobs.length === 0 ? (
              <div className="p-6 text-center text-xs text-[var(--wp-muted)]">
                No jobs waiting for review
              </div>
            ) : (
              jobs.map((j) => (
                <button
                  key={j.id}
                  type="button"
                  onClick={() => {
                    setFocusId(j.id);
                    changePrefs({ mode: 'deck' });
                    setBrowserOpen(false);
                  }}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[var(--wp-raised)]/45"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{j.title}</span>
                    <span className="block truncate text-xs text-[var(--wp-muted)]">
                      {[j.company, j.location].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <ScoreRing score={j.matchScore} size={36} />
                </button>
              ))
            )}
          </div>
        </div>
      </Sheet>
    </div>
  );
}
