import { CalendarClock, Mail } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTrackerQuery, useUpdateTrackerMutation } from '@/api/queries';
import type { GmailThreadStatus, PipelineStage } from '@/api/types';
import { Badge, Button, Card, SectionHeader } from '@/components/ui';
import { cn } from '@/lib/cn';

const STAGES: readonly PipelineStage[] = [
  'saved',
  'applied',
  'screen',
  'interview',
  'offer',
  'archived',
];

const GMAIL_LABELS: Record<GmailThreadStatus, { label: string; variant: 'neutral' | 'warning' | 'success' | 'brand' }> = {
  none: { label: 'No Thread', variant: 'neutral' },
  awaiting_reply: { label: 'Awaiting Reply', variant: 'warning' },
  reply_received: { label: 'Reply Received', variant: 'success' },
  draft_ready: { label: 'Draft Ready', variant: 'brand' },
};

export function TrackerView({
  onSelectRole,
}: {
  onSelectRole: (jobId: string) => void;
}) {
  const trackerQuery = useTrackerQuery();
  const updateMutation = useUpdateTrackerMutation();
  const [stageFilter, setStageFilter] = useState<PipelineStage | 'all'>('all');

  const entries = trackerQuery.data?.entries ?? [];

  const stageCounts = useMemo(() => {
    const counts: Record<PipelineStage, number> = {
      saved: 0,
      applied: 0,
      screen: 0,
      interview: 0,
      offer: 0,
      archived: 0,
    };
    for (const e of entries) {
      counts[e.stage] += 1;
    }
    return counts;
  }, [entries]);

  const filtered = useMemo(() => {
    if (stageFilter === 'all') return entries;
    return entries.filter((e) => e.stage === stageFilter);
  }, [entries, stageFilter]);

  return (
    <div className="space-y-5" data-testid="tracker-view">
      <SectionHeader
        title="Tracker"
        subtitle="Pipeline stages, Gmail thread status, and follow-up scheduling."
      />

      {/* Stage Filter Chips */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setStageFilter('all')}
          className={cn(
            'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
            stageFilter === 'all'
              ? 'border-accent-brand bg-accent-brand/10 text-accent-brand'
              : 'border-border bg-card text-muted-foreground hover:text-foreground',
          )}
        >
          All ({entries.length})
        </button>
        {STAGES.map((stage) => (
          <button
            key={stage}
            type="button"
            onClick={() => setStageFilter(stage)}
            className={cn(
              'rounded-lg border px-3 py-1.5 text-xs font-medium capitalize transition-colors',
              stageFilter === stage
                ? 'border-accent-brand bg-accent-brand/10 text-accent-brand'
                : 'border-border bg-card text-muted-foreground hover:text-foreground',
            )}
          >
            {stage} ({stageCounts[stage]})
          </button>
        ))}
      </div>

      {trackerQuery.isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading pipeline tracker…</Card>
      ) : filtered.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          No applications in this stage.
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((entry) => {
            const gmailMeta = GMAIL_LABELS[entry.gmailStatus];
            const followUpDateValue = entry.nextFollowUpAt
              ? entry.nextFollowUpAt.slice(0, 10)
              : '';

            return (
              <Card key={entry.jobId} className="p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onSelectRole(entry.jobId)}
                        className="text-left text-base font-semibold hover:text-accent-brand"
                      >
                        {entry.company} — {entry.title}
                      </button>
                      <Badge variant="brand">{entry.hydrogenScore}/100</Badge>
                      <Badge variant={gmailMeta.variant}>
                        <Mail className="h-3 w-3" />
                        <span>{gmailMeta.label}</span>
                      </Badge>
                    </div>
                    {entry.threadSubject ? (
                      <div className="text-xs text-muted-foreground">
                        Thread: {entry.threadSubject}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span>Stage</span>
                      <select
                        value={entry.stage}
                        onChange={(e) =>
                          updateMutation.mutate({
                            jobId: entry.jobId,
                            stage: e.target.value as PipelineStage,
                          })
                        }
                        className="rounded-lg border border-border bg-background px-2 py-1 text-xs font-medium text-foreground capitalize"
                      >
                        {STAGES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <CalendarClock className="h-3.5 w-3.5" />
                      <span>Follow-up</span>
                      <input
                        type="date"
                        value={followUpDateValue}
                        onChange={(e) =>
                          updateMutation.mutate({
                            jobId: entry.jobId,
                            nextFollowUpAt: e.target.value
                              ? new Date(`${e.target.value}T14:00:00Z`).toISOString()
                              : null,
                          })
                        }
                        className="rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground"
                      />
                    </label>

                    <Button size="sm" onClick={() => onSelectRole(entry.jobId)}>
                      Details
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
