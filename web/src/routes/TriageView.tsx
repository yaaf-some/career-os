import { Check, Eye, FastForward, Star, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useJobsQuery, useTriageMutation } from '@/api/queries';
import type { TriageStatus } from '@/api/types';
import { Badge, Button, Card, SectionHeader } from '@/components/ui';
import { cn } from '@/lib/cn';

type FilterTab = 'inbox' | 'approved' | 'all';

const STATUS_BADGE: Record<TriageStatus, 'brand' | 'success' | 'warning' | 'neutral' | 'danger'> = {
  pending: 'brand',
  shortlisted: 'warning',
  approved: 'success',
  skipped: 'neutral',
  rejected: 'danger',
};

export function TriageView({
  onSelectRole,
}: {
  onSelectRole: (jobId: string) => void;
}) {
  const jobsQuery = useJobsQuery();
  const triageMutation = useTriageMutation();
  const [filter, setFilter] = useState<FilterTab>('inbox');

  const jobs = jobsQuery.data?.jobs ?? [];

  const visibleJobs = useMemo(() => {
    const sorted = [...jobs].sort((a, b) => b.hydrogenScore - a.hydrogenScore);
    if (filter === 'inbox') {
      return sorted.filter(
        (j) => j.triageStatus === 'pending' || j.triageStatus === 'shortlisted',
      );
    }
    if (filter === 'approved') {
      return sorted.filter((j) => j.triageStatus === 'approved');
    }
    return sorted;
  }, [jobs, filter]);

  return (
    <div className="space-y-5" data-testid="triage-view">
      <SectionHeader
        title="Triage"
        subtitle="Inbox of hydrogen-scored roles. Approve, shortlist, skip, or reject before running neon deep eval."
        action={
          <div className="inline-flex rounded-lg border border-border bg-card p-0.5 text-xs">
            {(
              [
                { id: 'inbox', label: 'Inbox' },
                { id: 'approved', label: 'Approved' },
                { id: 'all', label: 'All' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className={cn(
                  'rounded-md px-2.5 py-1 font-medium transition-colors',
                  filter === tab.id
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        }
      />

      {jobsQuery.isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading hydrogen triage inbox…</Card>
      ) : visibleJobs.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          No jobs in this triage view. Trigger a scan in Sources or quick-add a URL in Today.
        </Card>
      ) : (
        <div className="space-y-3">
          {visibleJobs.map((job) => (
            <Card key={job.id} className="p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="brand">hydrogen {job.hydrogenScore}/100</Badge>
                    <Badge variant={STATUS_BADGE[job.triageStatus]}>{job.triageStatus}</Badge>
                    <span className="text-xs text-muted-foreground">{job.source}</span>
                  </div>

                  <div>
                    <button
                      type="button"
                      onClick={() => onSelectRole(job.id)}
                      className="text-left text-base font-semibold hover:text-accent-brand"
                    >
                      {job.title}
                    </button>
                    <div className="text-sm text-muted-foreground">
                      {job.company} • {job.location}
                      {job.compensation ? ` • ${job.compensation}` : ''}
                    </div>
                  </div>

                  <p className="text-sm text-foreground/90">{job.hydrogenSummary}</p>

                  {/* Score Breakdown */}
                  <div className="grid grid-cols-2 gap-2 pt-1 sm:grid-cols-4">
                    {(
                      [
                        ['Skills', job.scoreBreakdown.skills],
                        ['Level', job.scoreBreakdown.level],
                        ['Domain', job.scoreBreakdown.domain],
                        ['Logistics', job.scoreBreakdown.logistics],
                      ] as const
                    ).map(([label, score]) => (
                      <div key={label} className="rounded-lg bg-secondary/60 px-2.5 py-1.5">
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                          <span>{label}</span>
                          <span className="font-semibold text-foreground tabular-nums">{score}</span>
                        </div>
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-background">
                          <div
                            className="h-full rounded-full bg-accent-brand"
                            style={{ width: `${Math.min(100, Math.max(0, score))}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 lg:flex-col lg:items-stretch">
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={triageMutation.isPending}
                    onClick={() =>
                      triageMutation.mutate({ id: job.id, payload: { action: 'approve' } })
                    }
                  >
                    <Check className="h-3.5 w-3.5" />
                    <span>Approve</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={triageMutation.isPending}
                    onClick={() =>
                      triageMutation.mutate({ id: job.id, payload: { action: 'shortlist' } })
                    }
                  >
                    <Star className="h-3.5 w-3.5" />
                    <span>Shortlist</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={triageMutation.isPending}
                    onClick={() =>
                      triageMutation.mutate({ id: job.id, payload: { action: 'skip' } })
                    }
                  >
                    <FastForward className="h-3.5 w-3.5" />
                    <span>Skip</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={triageMutation.isPending}
                    onClick={() =>
                      triageMutation.mutate({ id: job.id, payload: { action: 'reject' } })
                    }
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    <span>Reject</span>
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => onSelectRole(job.id)}>
                    <Eye className="h-3.5 w-3.5" />
                    <span>Inspect</span>
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
