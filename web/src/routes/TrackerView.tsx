import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatMatchScore } from '@/api/jobs';
import { useTrackerQuery, useUpdateTrackerMutation } from '@/api/queries';
import type { GmailThreadStatus, PipelineStage, TrackerEntry } from '@/api/types';
import { useAppActions } from '@/components/AppShell';
import {
  Empty,
  InsetGroup,
  SegmentedControl,
  Sheet,
  SheetClose,
  SheetTitle,
  Skeleton,
  useToast,
} from '@/components/ui';
import { cn } from '@/lib/cn';

const STAGE_ORDER: readonly { id: PipelineStage; label: string }[] = [
  { id: 'interview', label: 'Interview' },
  { id: 'screen', label: 'Screen' },
  { id: 'applied', label: 'Applied' },
  { id: 'saved', label: 'Saved' },
  { id: 'offer', label: 'Offer' },
  { id: 'archived', label: 'Archived' },
];

const GMAIL_DOT: Record<GmailThreadStatus, { dot: string; label: string }> = {
  reply_received: { dot: 'bg-[var(--wp-good)]', label: 'Reply received' },
  awaiting_reply: { dot: 'bg-[var(--wp-accent)]', label: 'Awaiting reply' },
  draft_ready: { dot: 'bg-[var(--wp-accent)]', label: 'Draft ready' },
  none: { dot: 'bg-[var(--wp-muted)]', label: 'Not sent' },
};

type TrackerScope = 'active' | 'all' | 'archived';

function formatDateChip(iso: string | null): string {
  if (!iso) return 'Set date';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
}

export function TrackerView({
  onSelectRole,
}: {
  onSelectRole: (jobId: string) => void;
}) {
  const trackerQuery = useTrackerQuery();
  const updateMutation = useUpdateTrackerMutation();
  const { openQuickAdd } = useAppActions();
  const { showToast } = useToast();

  const [scope, setScope] = useState<TrackerScope>('active');
  const [stageTarget, setStageTarget] = useState<TrackerEntry | null>(null);

  const entries = trackerQuery.data?.entries ?? [];

  const filtered = useMemo(() => {
    if (scope === 'active') return entries.filter((e) => e.stage !== 'archived');
    if (scope === 'archived') return entries.filter((e) => e.stage === 'archived');
    return entries;
  }, [entries, scope]);

  const grouped = useMemo(() => {
    const map = new Map<PipelineStage, TrackerEntry[]>();
    for (const s of STAGE_ORDER) map.set(s.id, []);
    for (const entry of filtered) {
      map.get(entry.stage)?.push(entry);
    }
    return STAGE_ORDER.map((s) => ({ ...s, rows: map.get(s.id) ?? [] })).filter(
      (g) => g.rows.length > 0,
    );
  }, [filtered]);

  return (
    <div className="mx-auto max-w-[680px] space-y-6" data-testid="tracker-view">
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <div>
          <h1 className="text-base font-medium text-[var(--wp-ink)]">Tracker</h1>
          <p className="mt-0.5 text-xs text-[var(--wp-muted)]">
            {entries.filter((e) => e.stage !== 'archived').length} active roles
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SegmentedControl
            ariaLabel="Tracker filter"
            value={scope}
            onValueChange={setScope}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'all', label: 'All' },
              { value: 'archived', label: 'Archived' },
            ]}
          />
          <button
            type="button"
            onClick={openQuickAdd}
            aria-label="Add job posting"
            className="tap-control flex h-9 w-9 items-center justify-center rounded-[10px] bg-[var(--wp-raised)] text-[var(--wp-ink)]"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      {trackerQuery.isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : grouped.length === 0 ? (
        <Empty
          title="No roles in this view"
          description="Save roles in Triage or capture a posting URL to start tracking."
        />
      ) : (
        <div className="space-y-6">
          {grouped.map((group) => (
            <InsetGroup key={group.id} label={group.label} trailing={group.rows.length}>
              {group.rows.map((entry) => {
                const gmail = GMAIL_DOT[entry.gmailStatus];
                const followUpIso = entry.nextFollowUpAt ? entry.nextFollowUpAt.slice(0, 10) : '';
                return (
                  <div
                    key={entry.jobId}
                    className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <button
                      type="button"
                      onClick={() => onSelectRole(entry.jobId)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-[var(--wp-ink)]">
                          {entry.title}
                        </span>
                        <span className="font-mono-meta shrink-0 text-xs text-[var(--wp-muted)]">
                          {formatMatchScore(entry.matchScore)}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--wp-muted)]">
                        <span>{entry.company}</span>
                        <span
                          className={cn('h-1.5 w-1.5 rounded-full', gmail.dot)}
                          aria-hidden="true"
                        />
                        <span>{gmail.label}</span>
                        {entry.threadSubject ? (
                          <span className="truncate text-[var(--wp-secondary)]">
                            · {entry.threadSubject}
                          </span>
                        ) : null}
                      </div>
                    </button>

                    <div className="flex shrink-0 items-center gap-2">
                      <label className="inline-flex items-center">
                        <span className="sr-only">Follow-up date for {entry.company}</span>
                        <input
                          type="date"
                          aria-label={`Follow-up date for ${entry.company}`}
                          title={`Follow-up: ${formatDateChip(entry.nextFollowUpAt)}`}
                          value={followUpIso}
                          onChange={(e) =>
                            updateMutation.mutate(
                              {
                                jobId: entry.jobId,
                                nextFollowUpAt: e.target.value
                                  ? new Date(`${e.target.value}T14:00:00Z`).toISOString()
                                  : null,
                              },
                              {
                                onSuccess: () =>
                                  showToast({
                                    message: e.target.value
                                      ? `Follow-up set for ${entry.company}`
                                      : `Cleared follow-up for ${entry.company}`,
                                  }),
                              },
                            )
                          }
                          className="font-mono-meta h-8 rounded-[9px] border border-[var(--wp-hairline)] bg-[var(--wp-canvas)] px-2 text-xs text-[var(--wp-secondary)]"
                        />
                      </label>

                      <button
                        type="button"
                        onClick={() => setStageTarget(entry)}
                        aria-label={`Change stage for ${entry.company}`}
                        className="tap-control h-8 rounded-[9px] bg-[var(--wp-raised)] px-3 text-xs font-medium capitalize text-[var(--wp-ink)] hover:opacity-90"
                      >
                        {entry.stage}
                      </button>
                    </div>
                  </div>
                );
              })}
            </InsetGroup>
          ))}
        </div>
      )}

      {/* Pull-up / Slide-over Stage Picker */}
      <Sheet
        open={Boolean(stageTarget)}
        onOpenChange={(open) => !open && setStageTarget(null)}
        ariaLabel="Change application stage"
        maxWidthClass="md:max-w-sm"
      >
        {stageTarget ? (
          <div className="space-y-4 p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs text-[var(--wp-muted)]">{stageTarget.company}</div>
                <SheetTitle className="text-base font-medium text-[var(--wp-ink)]">
                  {stageTarget.title}
                </SheetTitle>
              </div>
              <SheetClose className="tap-control rounded-[10px] bg-[var(--wp-raised)] px-3 py-1 text-xs font-medium">
                Done
              </SheetClose>
            </div>

            <div className="paper-sheet divide-y divide-[var(--wp-hairline)] overflow-hidden rounded-[14px]">
              {STAGE_ORDER.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    const target = stageTarget;
                    setStageTarget(null);
                    updateMutation.mutate(
                      { jobId: target.jobId, stage: s.id },
                      {
                        onSuccess: () =>
                          showToast({
                            tone: 'success',
                            message: `Moved ${target.company} to ${s.label}`,
                          }),
                      },
                    );
                  }}
                  className="flex w-full items-center justify-between px-4 py-3 text-left text-sm hover:bg-[var(--wp-raised)]/45"
                >
                  <span>{s.label}</span>
                  {stageTarget.stage === s.id ? (
                    <span className="h-2 w-2 rounded-full bg-[var(--wp-accent)]" />
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}
