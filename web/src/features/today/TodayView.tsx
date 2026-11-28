import { ChevronRight, Plus } from 'lucide-react';
import { useTodayQuery } from '@/api/queries';
import { useAppActions } from '@/components/AppShell';
import { Empty, InsetGroup, PaperSheet, Skeleton } from '@/components/ui';
import { cn } from '@/lib/cn';

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
}

export function TodayView({
  onSelectRole,
}: {
  onSelectRole: (jobId: string) => void;
}) {
  const todayQuery = useTodayQuery();
  const { openQuickAdd } = useAppActions();
  const data = todayQuery.data;

  const replyCount = data?.unreadReplies.length ?? 0;
  const matchCount = data?.topMatches.length ?? 0;
  const upcomingCount = (data?.followUpsDue.length ?? 0) + (data?.agenda.length ?? 0);

  return (
    <div className="mx-auto max-w-[640px] space-y-6" data-testid="today-view">
      {/* Editorial Header */}
      <div className="flex items-start justify-between gap-4 pt-1">
        <div>
          <h1 className="font-serif-title text-2xl text-[var(--wp-ink)]">
            {data?.dateLabel ?? 'Today'}
          </h1>
          <p className="mt-1 text-xs text-[var(--wp-muted)]">
            {data
              ? `${replyCount} ${replyCount === 1 ? 'reply' : 'replies'} · ${upcomingCount} upcoming · ${matchCount} roles worth a look`
              : 'Loading daily briefing…'}
          </p>
        </div>
        <button
          type="button"
          onClick={openQuickAdd}
          aria-label="Add job posting"
          className="tap-control flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-[var(--wp-btn-bg)] text-[var(--wp-btn-ink)]"
        >
          <Plus className="h-4.5 w-4.5" />
        </button>
      </div>

      {todayQuery.isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-36 w-full" />
        </div>
      ) : !data ? (
        <Empty
          title="Unable to load Today"
          description="Check API connectivity and refresh."
        />
      ) : (
        <div className="space-y-6">
          {/* 1. Needs a reply */}
          <InsetGroup label="Needs a reply" trailing={replyCount || undefined}>
            {data.unreadReplies.length === 0 ? (
              <div className="px-4 py-3 text-xs text-[var(--wp-muted)]">
                All recruiter replies handled.
              </div>
            ) : (
              data.unreadReplies.map((reply) => (
                <button
                  key={reply.jobId}
                  type="button"
                  onClick={() => onSelectRole(reply.jobId)}
                  className="stagger-row tap-control flex w-full items-center justify-between gap-4 px-4 py-3.5 text-left hover:bg-[var(--wp-raised)]/45"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-[var(--wp-ink)]">
                      {reply.company} · {reply.role}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-[var(--wp-muted)]">
                      {reply.sender}
                    </div>
                    {reply.snippet ? (
                      <p className="mt-1 line-clamp-1 text-xs text-[var(--wp-secondary)]">
                        {reply.snippet}
                      </p>
                    ) : null}
                  </div>
                  <span
                    className="h-2 w-2 shrink-0 rounded-full bg-[var(--wp-good)]"
                    aria-hidden="true"
                  />
                </button>
              ))
            )}
          </InsetGroup>

          {/* 2. Follow ups & upcoming */}
          <InsetGroup label="Follow ups & upcoming" trailing={upcomingCount || undefined}>
            {upcomingCount === 0 ? (
              <div className="px-4 py-3 text-xs text-[var(--wp-muted)]">
                Clear schedule and no follow-ups due.
              </div>
            ) : (
              <>
                {data.followUpsDue.map((f) => (
                  <button
                    key={`fu-${f.jobId}`}
                    type="button"
                    onClick={() => onSelectRole(f.jobId)}
                    className="stagger-row tap-control flex w-full items-center justify-between gap-4 px-4 py-3.5 text-left hover:bg-[var(--wp-raised)]/45"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-[var(--wp-ink)]">
                        {f.company} · {f.role}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--wp-muted)]">
                        <span className="capitalize">{f.stage}</span>
                        {f.overdue ? (
                          <span className="font-medium text-[var(--wp-warn)]">Overdue</span>
                        ) : null}
                      </div>
                    </div>
                    <span className="font-mono-meta shrink-0 text-xs text-[var(--wp-muted)]">
                      {formatShortDate(f.dueAt)}
                    </span>
                  </button>
                ))}
                {data.agenda.map((item) => {
                  const time = new Date(item.startsAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  });
                  const inner = (
                    <div className="flex w-full items-center justify-between gap-4 px-4 py-3.5 text-left">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-[var(--wp-ink)]">
                          {item.title}
                        </div>
                        {item.locationOrLink ? (
                          <div className="mt-0.5 truncate text-xs text-[var(--wp-muted)]">
                            {item.locationOrLink}
                          </div>
                        ) : null}
                      </div>
                      <span className="font-mono-meta shrink-0 text-xs text-[var(--wp-muted)]">
                        {time}
                      </span>
                    </div>
                  );
                  return item.jobId ? (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSelectRole(item.jobId as string)}
                      className="stagger-row tap-control block w-full hover:bg-[var(--wp-raised)]/45"
                    >
                      {inner}
                    </button>
                  ) : (
                    <div key={item.id}>{inner}</div>
                  );
                })}
              </>
            )}
          </InsetGroup>

          {/* 3. Worth a look */}
          <InsetGroup label="Worth a look" trailing={matchCount || undefined}>
            {data.topMatches.length === 0 ? (
              <PaperSheet className="border-0 px-4 py-3 text-xs text-[var(--wp-muted)] shadow-none">
                Triage queue is clear. Use + to capture a posting URL.
              </PaperSheet>
            ) : (
              data.topMatches.map((job, idx) => {
                const score = job.matchScore;
                const high = score !== null && score >= 75;
                return (
                  <button
                    key={job.id}
                    type="button"
                    onClick={() => onSelectRole(job.id)}
                    style={{ animationDelay: `${idx * 35}ms` }}
                    className="stagger-row tap-control flex w-full items-center justify-between gap-4 px-4 py-3.5 text-left hover:bg-[var(--wp-raised)]/45"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-[var(--wp-ink)]">
                        {job.title}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-[var(--wp-muted)]">
                        {job.company} · {job.location}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        className={cn(
                          'font-mono-meta text-sm font-medium',
                          high ? 'text-[var(--wp-accent)]' : 'text-[var(--wp-muted)]',
                        )}
                      >
                        {score !== null ? Math.round(score) : '—'}
                      </span>
                      <ChevronRight className="h-4 w-4 text-[var(--wp-muted)]" />
                    </div>
                  </button>
                );
              })
            )}
          </InsetGroup>
        </div>
      )}
    </div>
  );
}
