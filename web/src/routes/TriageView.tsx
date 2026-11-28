import {
  Bookmark,
  Check,
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
import { prefersReducedMotion } from '@/lib/theme';

type FilterTab = 'inbox' | 'approved' | 'all';
type ViewMode = 'queue' | 'list';

interface PendingVerdict {
  jobId: string;
  action: 'approve' | 'skip';
  prevIndex: number;
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

  const [filter, setFilter] = useState<FilterTab>('inbox');
  const [viewMode, setViewMode] = useState<ViewMode>('queue');
  const [focusIndex, setFocusIndex] = useState(0);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [hiddenVerdicts, setHiddenVerdicts] = useState<Record<string, 'approve' | 'skip'>>({});
  const [dragDx, setDragDx] = useState(0);
  const [dragging, setDragging] = useState(false);

  const pendingRef = useRef<PendingVerdict | null>(null);
  const mutateRef = useRef(triageMutation.mutate);
  mutateRef.current = triageMutation.mutate;
  const dragStartRef = useRef<number | null>(null);

  const flushPending = useCallback(() => {
    const p = pendingRef.current;
    if (!p) return;
    window.clearTimeout(p.timerId);
    pendingRef.current = null;
    mutateRef.current({ id: p.jobId, payload: { action: p.action } });
  }, []);

  useEffect(() => () => flushPending(), [flushPending]);

  const jobs = jobsQuery.data?.jobs ?? [];

  const visibleJobs = useMemo(() => {
    const sorted = [...jobs].sort((a, b) => (b.matchScore ?? -1) - (a.matchScore ?? -1));
    const afterFilter =
      filter === 'inbox'
        ? sorted.filter((j) => j.triageStatus === 'pending' || j.triageStatus === 'shortlisted')
        : filter === 'approved'
          ? sorted.filter((j) => j.triageStatus === 'approved')
          : sorted;
    return afterFilter.filter((j) => !hiddenVerdicts[j.id]);
  }, [jobs, filter, hiddenVerdicts]);

  const clampedIndex = visibleJobs.length === 0 ? 0 : Math.min(focusIndex, visibleJobs.length - 1);
  const currentJob: JobSummary | undefined = visibleJobs[clampedIndex];
  const progressPct =
    visibleJobs.length > 0 ? Math.round(((clampedIndex + 1) / visibleJobs.length) * 100) : 0;

  const commitVerdict = useCallback(
    (action: 'approve' | 'skip' | 'shortlist', targetJob?: JobSummary) => {
      const job = targetJob ?? currentJob;
      if (!job || approvingId) return;

      if (action === 'shortlist') {
        triageMutation.mutate(
          { id: job.id, payload: { action: 'shortlist' } },
          {
            onSuccess: () => showToast({ tone: 'success', message: `Saved ${job.company}` }),
          },
        );
        return;
      }

      flushPending();
      const capturedIdx = clampedIndex;

      const applyDeferred = () => {
        setApprovingId(null);
        setHiddenVerdicts((prev) => ({ ...prev, [job.id]: action }));
        setFocusIndex(Math.max(0, Math.min(capturedIdx, visibleJobs.length - 2)));

        const timerId = window.setTimeout(() => {
          if (pendingRef.current?.jobId === job.id) {
            pendingRef.current = null;
            mutateRef.current({ id: job.id, payload: { action } });
          }
        }, undoDelayMs);

        pendingRef.current = { jobId: job.id, action, prevIndex: capturedIdx, timerId };

        showToast({
          tone: action === 'approve' ? 'success' : 'neutral',
          message: `${action === 'approve' ? 'Approved' : 'Skipped'} ${job.company}`,
          durationMs: undoDelayMs,
          actionLabel: 'Undo',
          onAction: () => {
            const p = pendingRef.current;
            if (p && p.jobId === job.id) {
              window.clearTimeout(p.timerId);
              pendingRef.current = null;
            }
            setHiddenVerdicts((prev) => {
              const copy = { ...prev };
              delete copy[job.id];
              return copy;
            });
            setFocusIndex(capturedIdx);
          },
        });
      };

      if (action === 'approve' && !prefersReducedMotion() && undoDelayMs >= 500) {
        setApprovingId(job.id);
        window.setTimeout(applyDeferred, 240);
      } else {
        applyDeferred();
      }
    },
    [
      approvingId,
      clampedIndex,
      currentJob,
      flushPending,
      showToast,
      triageMutation,
      undoDelayMs,
      visibleJobs.length,
    ],
  );

  // Keyboard shortcuts for Focus Queue
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (viewMode !== 'queue' || browserOpen || !currentJob) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
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
      if (key === 'a') {
        e.preventDefault();
        commitVerdict('approve');
      } else if (key === 's') {
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
        if (next[job.id] && job.triageStatus !== 'pending' && job.triageStatus !== 'shortlisted') {
          delete next[job.id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [jobs, hiddenVerdicts]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (prefersReducedMotion()) return;
    if ((e.target as HTMLElement).closest('button, a')) return;
    dragStartRef.current = e.clientX;
    setDragging(true);
    setDragDx(0);
    if (typeof e.currentTarget.setPointerCapture === 'function') {
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging || dragStartRef.current === null) return;
    setDragDx(e.clientX - dragStartRef.current);
  };

  const handlePointerRelease = () => {
    if (!dragging) return;
    const dx = dragDx;
    dragStartRef.current = null;
    setDragging(false);
    setDragDx(0);
    if (dx > DRAG_COMMIT_PX) {
      commitVerdict('approve');
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
      ) : visibleJobs.length === 0 ? (
        <Empty
          title="Queue complete"
          description="Every role in this filter has been reviewed."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {filter !== 'all' ? (
                <Button variant="secondary" onClick={() => setFilter('all')}>
                  Show all roles
                </Button>
              ) : null}
              <Button variant="primary" onClick={openQuickAdd}>
                Add posting
              </Button>
            </div>
          }
        />
      ) : viewMode === 'list' ? (
        <InsetGroup
          label={filter === 'inbox' ? 'Inbox' : filter === 'approved' ? 'Approved' : 'All roles'}
          trailing={visibleJobs.length}
        >
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
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-[var(--wp-ink)]">
                    {job.title}
                  </span>
                  {job.triageStatus === 'shortlisted' ? (
                    <Badge variant="brand">Saved</Badge>
                  ) : null}
                </div>
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
            <PaperSheet
              key={currentJob.id}
              data-testid="focus-card"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerRelease}
              onPointerCancel={handlePointerRelease}
              style={{
                transform: dragging
                  ? `translate3d(${dragDx}px, 0, 0) rotate(${dragRotate}deg)`
                  : 'translate3d(0, 0, 0) rotate(0deg)',
                transition: dragging
                  ? 'none'
                  : 'transform 260ms var(--ease-calm), opacity 220ms var(--ease-calm)',
              }}
              className="calm-rise relative w-full max-w-[540px] touch-pan-y select-none rounded-[20px] p-6"
            >
              {/* Signature Terracotta Bookmark Notch */}
              {currentJob.triageStatus === 'shortlisted' ? (
                <div
                  title="Saved"
                  data-testid="bookmark-notch"
                  className="absolute right-6 top-0 h-5 w-3 bg-[var(--wp-accent)]"
                  style={{ clipPath: 'polygon(0 0, 100% 0, 100% 100%, 50% 72%, 0 100%)' }}
                />
              ) : null}

              {/* Drag Intent Labels */}
              {dragDx > 12 ? (
                <div
                  className="pointer-events-none absolute left-6 top-4 text-xs font-medium text-[var(--wp-good)]"
                  style={{ opacity: dragRatio }}
                >
                  Approve
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

          {/* Thumb-Zone Action Dock */}
          <div className="mx-auto w-full max-w-[540px] space-y-2 pb-1">
            <div className="grid grid-cols-[1fr_auto_1.3fr] items-center gap-3">
              <button
                type="button"
                disabled={Boolean(approvingId)}
                onClick={() => commitVerdict('skip')}
                className="tap-control paper-sheet flex h-12 items-center justify-center gap-2 rounded-[12px] text-sm font-medium text-[var(--wp-secondary)] hover:text-[var(--wp-ink)] disabled:opacity-50"
              >
                <X className="h-4 w-4" />
                <span>Skip</span>
                <Kbd className="hidden md:inline-flex">X</Kbd>
              </button>

              <button
                type="button"
                aria-label="Save bookmark"
                disabled={Boolean(approvingId) || triageMutation.isPending}
                onClick={() => commitVerdict('shortlist')}
                className={cn(
                  'tap-control paper-sheet flex h-12 w-12 items-center justify-center rounded-[12px]',
                  currentJob.triageStatus === 'shortlisted'
                    ? 'text-[var(--wp-accent)]'
                    : 'text-[var(--wp-muted)] hover:text-[var(--wp-ink)]',
                )}
              >
                <Bookmark className="h-4.5 w-4.5" />
              </button>

              <button
                type="button"
                disabled={Boolean(approvingId)}
                onClick={() => commitVerdict('approve')}
                className="tap-control flex h-12 items-center justify-center gap-2 rounded-[12px] bg-[var(--wp-btn-bg)] text-sm font-medium text-[var(--wp-btn-ink)] disabled:opacity-80"
              >
                {approvingId === currentJob.id ? (
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path className="draw-check" d="M20 6 9 17l-5-5" />
                  </svg>
                ) : (
                  <Check className="h-4 w-4" />
                )}
                <span>{approvingId === currentJob.id ? 'Approved' : 'Approve'}</span>
                {approvingId !== currentJob.id ? (
                  <Kbd className="hidden border-transparent bg-white/15 text-inherit md:inline-flex">
                    A
                  </Kbd>
                ) : null}
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

          <SegmentedControl
            ariaLabel="Triage filter"
            value={filter}
            onValueChange={(next) => {
              setFilter(next);
              setFocusIndex(0);
            }}
            options={[
              { value: 'inbox', label: 'Inbox' },
              { value: 'approved', label: 'Approved' },
              { value: 'all', label: 'All' },
            ]}
          />

          <div className="paper-sheet flex-1 divide-y divide-[var(--wp-hairline)] overflow-y-auto rounded-[14px]">
            {visibleJobs.length === 0 ? (
              <div className="p-6 text-center text-xs text-[var(--wp-muted)]">
                No roles in this filter
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
