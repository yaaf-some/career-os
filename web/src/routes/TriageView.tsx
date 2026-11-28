import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  List,
  MapPin,
  Plus,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatMatchScore } from '@/api/jobs';
import { useJobsQuery, useTriageMutation } from '@/api/queries';
import type { JobSummary } from '@/api/types';
import { useAppActions } from '@/components/AppShell';
import { CommuteBadge } from '@/components/CommuteBadge';
import { FitHorizon } from '@/components/FitHorizon';
import {
  Badge,
  Button,
  Empty,
  InsetGroup,
  Kbd,
  PaperSheet,
  SegmentedControl,
  Sheet,
  SheetClose,
  SheetTitle,
  Skeleton,
  useToast,
} from '@/components/ui';
import { cn } from '@/lib/cn';

type ViewMode = 'queue' | 'list';
type Verdict = 'shortlist' | 'skip';

interface PendingVerdict {
  jobId: string;
  company: string;
  action: Verdict;
  timerId: number;
}

const DRAG_COMMIT_PX = 96;

export function TriageView({
  onSelectRole,
  undoDelayMs = 3500,
}: {
  onSelectRole: (jobId: string) => void;
  undoDelayMs?: number;
}) {
  const jobsQuery = useJobsQuery();
  const triageMutation = useTriageMutation();
  const { openQuickAdd } = useAppActions();
  const { showToast, dismissToast } = useToast();

  const [viewMode, setViewMode] = useState<ViewMode>('queue');
  const [focusIndex, setFocusIndex] = useState(0);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [hiddenVerdicts, setHiddenVerdicts] = useState<Record<string, Verdict>>({});
  const [dragDx, setDragDx] = useState(0);
  const [dragging, setDragging] = useState(false);

  const pendingRef = useRef<PendingVerdict | null>(null);
  const mutateRef = useRef(triageMutation.mutateAsync);
  mutateRef.current = triageMutation.mutateAsync;
  const dragRef = useRef<{ pointerId: number; startX: number } | null>(null);

  const unhide = useCallback((jobId: string) => {
    setHiddenVerdicts((prev) => {
      const copy = { ...prev };
      delete copy[jobId];
      return copy;
    });
  }, []);

  const flushPending = useCallback(() => {
    const p = pendingRef.current;
    if (!p) return;
    window.clearTimeout(p.timerId);
    pendingRef.current = null;
    // `mutateAsync` so a failure is still reported after leaving this view.
    mutateRef.current({ id: p.jobId, payload: { action: p.action } }).catch(() => {
      unhide(p.jobId);
      showToast({ message: `Could not save your choice for ${p.company}. It is back in the queue.` });
    });
  }, [showToast, unhide]);

  // Send the held verdict before the page is hidden, closed or suspended.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden') flushPending();
    };
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', flushPending);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', flushPending);
      flushPending();
    };
  }, [flushPending]);

  const jobs = jobsQuery.data?.jobs ?? [];

  const visibleJobs = useMemo(
    () =>
      jobs
        .filter((j) => j.triageStatus === 'pending' && !hiddenVerdicts[j.id])
        .sort((a, b) => (b.matchScore ?? -1) - (a.matchScore ?? -1)),
    [jobs, hiddenVerdicts],
  );

  const clampedIndex = visibleJobs.length === 0 ? 0 : Math.min(focusIndex, visibleJobs.length - 1);
  const currentJob: JobSummary | undefined = visibleJobs[clampedIndex];
  const progressPct =
    visibleJobs.length > 0 ? Math.round(((clampedIndex + 1) / visibleJobs.length) * 100) : 0;

  const commitVerdict = useCallback(
    (action: Verdict, targetJob?: JobSummary) => {
      const job = targetJob ?? currentJob;
      if (!job) return;

      flushPending();
      const capturedIdx = clampedIndex;
      setHiddenVerdicts((prev) => ({ ...prev, [job.id]: action }));
      setFocusIndex(Math.max(0, Math.min(capturedIdx, visibleJobs.length - 2)));

      const timerId = window.setTimeout(() => {
        if (pendingRef.current?.jobId === job.id) flushPending();
      }, undoDelayMs);
      pendingRef.current = { jobId: job.id, company: job.company, action, timerId };

      showToast({
        tone: action === 'shortlist' ? 'success' : 'neutral',
        message: `${action === 'shortlist' ? 'Saved' : 'Skipped'} ${job.company}`,
        durationMs: undoDelayMs,
        actionLabel: 'Undo',
        onAction: () => {
          const p = pendingRef.current;
          if (p?.jobId !== job.id) return;
          window.clearTimeout(p.timerId);
          pendingRef.current = null;
          unhide(job.id);
          setFocusIndex(capturedIdx);
        },
      });
    },
    [clampedIndex, currentJob, flushPending, showToast, undoDelayMs, unhide, visibleJobs.length],
  );

  // Keyboard shortcuts for Focus Queue
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (viewMode !== 'queue' || browserOpen || !currentJob) return;
      // A held key must not run through the queue.
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const activeEl = document.activeElement;
      const tag = activeEl?.tagName ?? '';
      if (
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) ||
        (activeEl instanceof HTMLElement && activeEl.isContentEditable) ||
        document.querySelector('[role="dialog"]')
      ) {
        return;
      }

      const key = e.key.toLowerCase();
      if (key === 's') {
        e.preventDefault();
        commitVerdict('shortlist');
      } else if (key === 'x') {
        e.preventDefault();
        commitVerdict('skip');
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setFocusIndex((i) => Math.min(i + 1, Math.max(0, visibleJobs.length - 1)));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setFocusIndex((i) => Math.max(0, i - 1));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [browserOpen, commitVerdict, currentJob, viewMode, visibleJobs.length]);

  // Clear stale hidden entries once query refreshes with updated status
  useEffect(() => {
    if (Object.keys(hiddenVerdicts).length === 0) return;
    setHiddenVerdicts((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const job of jobs) {
        if (next[job.id] && job.triageStatus !== 'pending') {
          delete next[job.id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [jobs, hiddenVerdicts]);

  const endDrag = () => {
    dragRef.current = null;
    setDragging(false);
    setDragDx(0);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current || e.button > 0) return;
    if ((e.target as HTMLElement).closest('button, a')) return;
    dragRef.current = { pointerId: e.pointerId, startX: e.clientX };
    setDragging(true);
    setDragDx(0);
    if (typeof e.currentTarget.setPointerCapture === 'function') {
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    setDragDx(e.clientX - drag.startX);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const dx = e.clientX - drag.startX;
    endDrag();
    if (dx > DRAG_COMMIT_PX) {
      commitVerdict('shortlist');
    } else if (dx < -DRAG_COMMIT_PX) {
      commitVerdict('skip');
    }
  };

  const dragRotate = Math.max(-2.5, Math.min(2.5, dragDx * 0.02));
  const dragRatio = Math.min(1, Math.abs(dragDx) / DRAG_COMMIT_PX);

  return (
    <div className="mx-auto flex h-full max-w-[680px] flex-col gap-5" data-testid="triage-view">
      {/* Calm Header + Progress */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <h1 className="text-base font-medium text-[var(--wp-ink)]">Triage</h1>
            <span className="font-mono-meta text-xs text-[var(--wp-muted)]">
              {visibleJobs.length > 0 ? `${clampedIndex + 1} / ${visibleJobs.length}` : '0 / 0'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden sm:block">
              <SegmentedControl
                ariaLabel="Triage view mode"
                value={viewMode}
                onValueChange={(m) => {
                  dismissToast();
                  setViewMode(m);
                }}
                options={[
                  { value: 'queue', label: 'Queue' },
                  { value: 'list', label: 'List' },
                ]}
              />
            </div>
            <button
              type="button"
              onClick={openQuickAdd}
              aria-label="Add job URL"
              className="tap-control flex h-9 w-9 items-center justify-center rounded-[10px] bg-[var(--wp-raised)] text-[var(--wp-ink)]"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setBrowserOpen(true)}
              aria-label="Browse queue"
              className="tap-control flex h-9 w-9 items-center justify-center rounded-[10px] bg-[var(--wp-raised)] text-[var(--wp-ink)]"
            >
              <List className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="h-0.5 w-full overflow-hidden rounded-full bg-[var(--wp-hairline)]">
          <div
            className="h-full bg-[var(--wp-accent)] transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {jobsQuery.isLoading ? (
        <Skeleton className="h-80 w-full rounded-[20px]" />
      ) : jobsQuery.isError ? (
        <Empty
          title="Could not load your jobs"
          description={jobsQuery.error.message}
          action={
            <Button variant="primary" onClick={() => void jobsQuery.refetch()}>
              Try again
            </Button>
          }
        />
      ) : visibleJobs.length === 0 ? (
        <Empty
          title="Queue complete"
          description="No jobs are waiting for review. Saved jobs are in the Tracker."
          action={
            <Button variant="primary" onClick={openQuickAdd}>
              Add posting
            </Button>
          }
        />
      ) : viewMode === 'list' ? (
        <InsetGroup label="Waiting for review" trailing={visibleJobs.length}>
          {visibleJobs.map((job, idx) => (
            <div
              key={job.id}
              className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between"
            >
              <button
                type="button"
                onClick={() => onSelectRole(job.id)}
                className="min-w-0 flex-1 text-left"
              >
                <div className="truncate text-sm font-medium text-[var(--wp-ink)]">{job.title}</div>
                <div className="mt-0.5 truncate text-xs text-[var(--wp-muted)]">
                  {job.company} · {job.location}
                </div>
              </button>
              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={cn(
                    'font-mono-meta text-sm font-medium',
                    (job.matchScore ?? 0) >= 75
                      ? 'text-[var(--wp-accent)]'
                      : 'text-[var(--wp-muted)]',
                  )}
                >
                  {formatMatchScore(job.matchScore)}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setFocusIndex(idx);
                    setViewMode('queue');
                  }}
                >
                  Focus
                </Button>
                <Button size="sm" variant="secondary" onClick={() => onSelectRole(job.id)}>
                  Inspect
                </Button>
              </div>
            </div>
          ))}
        </InsetGroup>
      ) : currentJob ? (
        <div className="flex flex-1 flex-col justify-between gap-5">
          {/* Focus Paper Sheet */}
          <div className="relative flex flex-1 items-center justify-center">
            <div key={currentJob.id} className="calm-rise w-full max-w-[540px]">
            <PaperSheet
              data-testid="focus-card"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={endDrag}
              style={{
                transform: dragging
                  ? `translate3d(${dragDx}px, 0, 0) rotate(${dragRotate}deg)`
                  : 'translate3d(0, 0, 0) rotate(0deg)',
                transition: dragging
                  ? 'none'
                  : 'transform 260ms var(--ease-calm), opacity 220ms var(--ease-calm)',
              }}
              className="relative w-full touch-pan-y select-none rounded-[20px] p-6"
            >
              {/* Drag Intent Labels */}
              {dragDx > 12 ? (
                <div
                  className="pointer-events-none absolute left-6 top-4 text-xs font-medium text-[var(--wp-good)]"
                  style={{ opacity: dragRatio }}
                >
                  Save
                </div>
              ) : null}
              {dragDx < -12 ? (
                <div
                  className="pointer-events-none absolute right-6 top-4 text-xs font-medium text-[var(--wp-bad)]"
                  style={{ opacity: dragRatio }}
                >
                  Skip
                </div>
              ) : null}

              <div className="space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--wp-muted)]">
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 shrink-0" />
                    <span>
                      {currentJob.company} · {currentJob.location}
                    </span>
                  </span>
                  <CommuteBadge
                    jobId={currentJob.id}
                    remotePolicy={currentJob.remotePolicy}
                    compact
                  />
                </div>

                <h2 className="font-serif-title text-2xl leading-tight text-[var(--wp-ink)]">
                  {currentJob.title}
                </h2>

                {currentJob.dealbreakerReason ? (
                  <div className="rounded-[10px] bg-[var(--wp-bad-soft)] px-3 py-2 text-xs text-[var(--wp-bad)]">
                    Dealbreaker: {currentJob.dealbreakerReason}
                  </div>
                ) : null}

                <p className="text-sm leading-relaxed text-[var(--wp-secondary)]">
                  {currentJob.matchSummary || 'Role queued for evaluation.'}
                </p>

                {!currentJob.hasDescription ? (
                  <Badge variant="neutral">
                    {currentJob.matchScore === null
                      ? 'No description yet'
                      : 'No description yet: the score may rest on the title alone'}
                  </Badge>
                ) : null}

                <div className="border-t border-[var(--wp-hairline)] pt-3.5">
                  <FitHorizon
                    score={currentJob.matchScore}
                    breakdown={currentJob.scoreBreakdown}
                    source={currentJob.source}
                  />
                </div>

                <button
                  type="button"
                  onClick={() => onSelectRole(currentJob.id)}
                  className="tap-control flex w-full items-center justify-between border-t border-[var(--wp-hairline)] pt-3.5 text-xs font-medium text-[var(--wp-secondary)] hover:text-[var(--wp-ink)]"
                >
                  <span>Read posting &amp; deep analysis</span>
                  <ChevronUp className="h-4 w-4" />
                </button>
              </div>
            </PaperSheet>
            </div>
          </div>

          {/* Thumb-Zone Action Dock */}
          <div className="mx-auto w-full max-w-[540px] space-y-2 pb-1">
            <div className="grid grid-cols-[1fr_1.3fr] items-center gap-3">
              <button
                type="button"
                onClick={() => commitVerdict('skip')}
                className="tap-control paper-sheet flex h-12 items-center justify-center gap-2 rounded-[12px] text-sm font-medium text-[var(--wp-secondary)] hover:text-[var(--wp-ink)]"
              >
                <X className="h-4 w-4" />
                <span>Skip</span>
                <Kbd className="hidden md:inline-flex">X</Kbd>
              </button>

              <button
                type="button"
                onClick={() => commitVerdict('shortlist')}
                className="tap-control flex h-12 items-center justify-center gap-2 rounded-[12px] bg-[var(--wp-btn-bg)] text-sm font-medium text-[var(--wp-btn-ink)]"
              >
                <Bookmark className="h-4 w-4" />
                <span>Save</span>
                <Kbd className="hidden border-transparent bg-white/15 text-inherit md:inline-flex">
                  S
                </Kbd>
              </button>
            </div>

            {visibleJobs.length > 1 ? (
              <div className="flex items-center justify-between px-1 text-xs text-[var(--wp-muted)]">
                <button
                  type="button"
                  disabled={clampedIndex === 0}
                  onClick={() => setFocusIndex((i) => Math.max(0, i - 1))}
                  className="inline-flex items-center gap-1 hover:text-[var(--wp-ink)] disabled:opacity-35"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  <span>Previous</span>
                </button>
                <button
                  type="button"
                  disabled={clampedIndex >= visibleJobs.length - 1}
                  onClick={() =>
                    setFocusIndex((i) => Math.min(i + 1, Math.max(0, visibleJobs.length - 1)))
                  }
                  className="inline-flex items-center gap-1 hover:text-[var(--wp-ink)] disabled:opacity-35"
                >
                  <span>Next</span>
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Queue Browser Sheet */}
      <Sheet
        open={browserOpen}
        onOpenChange={setBrowserOpen}
        ariaLabel="Queue browser"
        maxWidthClass="md:max-w-md"
      >
        <div className="flex min-h-0 flex-1 flex-col gap-4 p-6">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-base font-medium">Queue browser</SheetTitle>
            <SheetClose className="tap-control rounded-[10px] bg-[var(--wp-raised)] px-3 py-1 text-xs font-medium">
              Done
            </SheetClose>
          </div>

          <div className="paper-sheet flex-1 divide-y divide-[var(--wp-hairline)] overflow-y-auto rounded-[14px]">
            {visibleJobs.length === 0 ? (
              <div className="p-6 text-center text-xs text-[var(--wp-muted)]">
                No jobs waiting for review
              </div>
            ) : (
              visibleJobs.map((j, idx) => (
                <button
                  key={j.id}
                  type="button"
                  onClick={() => {
                    setFocusIndex(idx);
                    setViewMode('queue');
                    setBrowserOpen(false);
                  }}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[var(--wp-raised)]/45"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-[var(--wp-ink)]">
                      {j.title}
                    </div>
                    <div className="truncate text-xs text-[var(--wp-muted)]">
                      {j.company} · {j.location}
                    </div>
                  </div>
                  <span
                    className={cn(
                      'font-mono-meta shrink-0 text-sm font-medium',
                      (j.matchScore ?? 0) >= 75
                        ? 'text-[var(--wp-accent)]'
                        : 'text-[var(--wp-muted)]',
                    )}
                  >
                    {j.matchScore !== null ? Math.round(j.matchScore) : '—'}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      </Sheet>
    </div>
  );
}
