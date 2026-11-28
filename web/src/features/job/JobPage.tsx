import { ArrowLeft, Bookmark, ExternalLink, RotateCcw, X } from 'lucide-react';
import { useJobDetailQuery, useTriageMutation, useUpdateTrackerMutation } from '@/api/queries';
import type { JobDetail, TriageActionRequest } from '@/api/types';
import { CommuteBadge } from '@/components/CommuteBadge';
import {
  Badge,
  Button,
  Empty,
  Monogram,
  ScoreRing,
  Select,
  Skeleton,
  StageBadge,
  TabsList,
  TabsPanel,
  TabsRoot,
  TabsTab,
  useToast,
} from '@/components/ui';
import { STAGES, companyHue, tint } from '@/lib/stages';
import { ActivityTab } from './activity/ActivityTab';
import { DocumentsTab } from './documents/DocumentsTab';
import { FitTab } from './fit/FitTab';
import { OverviewTab } from './overview/OverviewTab';
import { JOB_TABS, type JobTab } from './tabs';

const TAB_LABELS: Record<JobTab, string> = {
  overview: 'Overview',
  fit: 'Fit',
  activity: 'Activity',
  documents: 'Documents',
};

function JobActions({ job }: { job: JobDetail }) {
  const triageMutation = useTriageMutation();
  const trackerMutation = useUpdateTrackerMutation();
  const { showToast } = useToast();

  const verdict = (action: TriageActionRequest['action'], done: string) =>
    triageMutation.mutate(
      { id: job.id, payload: { action } },
      {
        onSuccess: () => showToast({ tone: 'success', message: done }),
        onError: (err) => showToast({ message: `Could not update: ${err.message}` }),
      },
    );
  const busy = triageMutation.isPending;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {job.inPipeline ? (
        <Select
          ariaLabel="Application stage"
          value={job.stage}
          disabled={trackerMutation.isPending}
          onValueChange={(stage) =>
            trackerMutation.mutate(
              { jobId: job.id, stage },
              {
                onError: (err) => showToast({ message: `Stage not saved: ${err.message}` }),
              },
            )
          }
          options={STAGES.map((s) => ({ value: s.id, label: s.label }))}
        />
      ) : (
        <>
          <Button size="sm" variant="primary" disabled={busy} onClick={() => verdict('shortlist', `Saved ${job.company}`)}>
            <Bookmark className="h-3.5 w-3.5" />
            <span>Save</span>
          </Button>
          {job.triageStatus === 'pending' ? (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => verdict('skip', `Skipped ${job.company}`)}>
              <X className="h-3.5 w-3.5" />
              <span>Skip</span>
            </Button>
          ) : (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => verdict('restore', `${job.company} is back in triage`)}>
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Back to triage</span>
            </Button>
          )}
        </>
      )}
      <a
        href={job.url}
        target="_blank"
        rel="noopener noreferrer"
        className="tap-control inline-flex h-8 items-center gap-1.5 rounded-[10px] border border-[var(--wp-hairline)] bg-[var(--wp-surface)] px-3 text-xs font-medium text-[var(--wp-ink)] hover:bg-[var(--wp-raised)]"
      >
        <span>Posting</span>
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}

function JobHeader({ job }: { job: JobDetail }) {
  const hue = companyHue(job.company);
  return (
    <header
      className="paper-sheet space-y-4 rounded-[20px] p-5"
      style={{ backgroundImage: `linear-gradient(150deg, ${tint(hue, 14)}, transparent 55%)` }}
    >
      <div className="flex items-start gap-4">
        <Monogram company={job.company} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-[var(--wp-secondary)]">{job.company}</div>
          <div className="text-xs text-[var(--wp-muted)]">
            {[job.location, job.compensation].filter(Boolean).join(' · ')}
          </div>
          <h1 className="font-serif-title mt-1 text-2xl leading-tight text-[var(--wp-ink)]">
            {job.title}
          </h1>
        </div>
        <ScoreRing score={job.matchScore} size={56} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {job.inPipeline ? <StageBadge stage={job.stage} /> : null}
        {!job.inPipeline && job.triageStatus === 'skipped' ? <Badge>Skipped</Badge> : null}
        {!job.inPipeline && job.triageStatus === 'pending' ? (
          <Badge variant="brand">Waiting for review</Badge>
        ) : null}
        {job.dealbreakerReason ? (
          <Badge variant="danger">Dealbreaker: {job.dealbreakerReason}</Badge>
        ) : null}
        <CommuteBadge jobId={job.id} remotePolicy={job.remotePolicy} compact />
      </div>
      <JobActions job={job} />
    </header>
  );
}

export function JobPage({
  jobId,
  tab,
  onTabChange,
  onBack,
}: {
  jobId: string;
  tab: JobTab;
  onTabChange: (tab: JobTab) => void;
  onBack: () => void;
}) {
  const detailQuery = useJobDetailQuery(jobId);
  const job = detailQuery.data;

  return (
    <div className="mx-auto max-w-[760px] space-y-5" data-testid="job-page">
      <button
        type="button"
        onClick={onBack}
        className="tap-control inline-flex h-9 items-center gap-1.5 rounded-[10px] pr-3 text-sm font-medium text-[var(--wp-secondary)] hover:text-[var(--wp-ink)]"
      >
        <ArrowLeft className="h-4 w-4" />
        <span>Back</span>
      </button>

      {detailQuery.isLoading ? (
        <Skeleton className="h-56 w-full rounded-[20px]" />
      ) : !job ? (
        <Empty
          title="Unable to load this job"
          description={detailQuery.error?.message}
          action={<Button onClick={() => void detailQuery.refetch()}>Try again</Button>}
        />
      ) : (
        // Keyed by job so no form or mutation state carries to another job.
        <div key={job.id} className="space-y-5">
          <JobHeader job={job} />
          <TabsRoot value={tab} onValueChange={(next) => onTabChange(next as JobTab)}>
            <TabsList className="overflow-x-auto">
              {JOB_TABS.map((id) => (
                <TabsTab key={id} value={id} className="shrink-0 px-1 text-sm">
                  {TAB_LABELS[id]}
                </TabsTab>
              ))}
            </TabsList>
            {/* Panels stay mounted so unsaved drafts survive switching tabs. */}
            <TabsPanel value="overview" keepMounted className="pt-5">
              <OverviewTab job={job} />
            </TabsPanel>
            <TabsPanel value="fit" keepMounted className="pt-5">
              <FitTab job={job} />
            </TabsPanel>
            <TabsPanel value="activity" keepMounted className="pt-5">
              <ActivityTab job={job} />
            </TabsPanel>
            <TabsPanel value="documents" keepMounted className="pt-5">
              <DocumentsTab job={job} />
            </TabsPanel>
          </TabsRoot>
        </div>
      )}
    </div>
  );
}
