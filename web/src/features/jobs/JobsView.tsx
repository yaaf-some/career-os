import { Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useJobsQuery } from '@/api/queries';
import type { JobSummary } from '@/api/types';
import { useAppActions } from '@/components/AppShell';
import {
  Badge,
  Button,
  Empty,
  Input,
  Monogram,
  PageHeader,
  ScoreRing,
  SegmentedControl,
  Skeleton,
  StageBadge,
  StatTile,
} from '@/components/ui';
import { TrackerView } from './PipelineView';

export type JobsViewMode = 'list' | 'pipeline';

type Filter = 'all' | 'waiting' | 'pipeline' | 'skipped';

const FILTERS: readonly { id: Filter; label: string; color: string }[] = [
  { id: 'waiting', label: 'To review', color: 'var(--wp-accent)' },
  { id: 'pipeline', label: 'In pipeline', color: 'var(--stage-applied)' },
  { id: 'skipped', label: 'Skipped', color: 'var(--stage-archived)' },
  { id: 'all', label: 'All jobs', color: 'var(--stage-interview)' },
];

function matches(job: JobSummary, filter: Filter): boolean {
  if (filter === 'waiting') return job.triageStatus === 'pending' && !job.inPipeline;
  if (filter === 'pipeline') return job.inPipeline;
  if (filter === 'skipped') return job.triageStatus === 'skipped' && !job.inPipeline;
  return true;
}

const PAGE = 60;

export function JobsView({
  view,
  onViewChange,
  onSelectRole,
}: {
  view: JobsViewMode;
  onViewChange: (view: JobsViewMode) => void;
  onSelectRole: (jobId: string) => void;
}) {
  const jobsQuery = useJobsQuery();
  const { openQuickAdd } = useAppActions();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [shown, setShown] = useState(PAGE);

  const jobs = jobsQuery.data?.jobs ?? [];
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return jobs.filter(
      (j) =>
        matches(j, filter) &&
        (!q || `${j.title} ${j.company} ${j.location} ${j.tags.join(' ')}`.toLowerCase().includes(q)),
    );
  }, [jobs, filter, search]);

  return (
    <div className="mx-auto max-w-[860px] space-y-5" data-testid="jobs-view">
      <PageHeader
        title="Jobs"
        subtitle={jobsQuery.data ? `${jobs.length} roles you are tracking` : undefined}
        actions={
          <>
            <SegmentedControl
              ariaLabel="Jobs layout"
              value={view}
              onValueChange={onViewChange}
              options={[
                { value: 'list', label: 'List' },
                { value: 'pipeline', label: 'Pipeline' },
              ]}
            />
            <Button variant="primary" size="sm" onClick={openQuickAdd}>
              <Plus className="h-3.5 w-3.5" />
              <span>Add job</span>
            </Button>
          </>
        }
      />

      {view === 'pipeline' ? (
        <TrackerView embedded onSelectRole={onSelectRole} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {FILTERS.map((f) => (
              <StatTile
                key={f.id}
                label={f.label}
                color={f.color}
                value={jobs.filter((j) => matches(j, f.id)).length}
                active={filter === f.id}
                onClick={() => {
                  setFilter(f.id);
                  setShown(PAGE);
                }}
              />
            ))}
          </div>

          <label className="relative block">
            <Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-[var(--wp-muted)]" />
            <Input
              type="search"
              aria-label="Search jobs"
              placeholder="Search title, company, location or tag"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setShown(PAGE);
              }}
              style={{ paddingLeft: 38 }}
            />
          </label>

          {jobsQuery.isLoading ? (
            <Skeleton className="h-72 w-full rounded-[16px]" />
          ) : jobsQuery.isError ? (
            <Empty
              title="Could not load your jobs"
              description={jobsQuery.error.message}
              action={<Button onClick={() => void jobsQuery.refetch()}>Try again</Button>}
            />
          ) : visible.length === 0 ? (
            <Empty title="No jobs here" description="Try another filter or search." />
          ) : (
            <ul className="paper-sheet divide-y divide-[var(--wp-hairline)] overflow-hidden rounded-[16px]">
              {visible.slice(0, shown).map((job) => (
                <li key={job.id}>
                  <button
                    type="button"
                    onClick={() => onSelectRole(job.id)}
                    className="flex w-full items-center gap-3 px-3.5 py-3 text-left hover:bg-[var(--wp-raised)]/60"
                  >
                    <Monogram company={job.company} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-[var(--wp-ink)]">
                        {job.title}
                      </span>
                      <span className="block truncate text-xs text-[var(--wp-secondary)]">
                        {[job.company, job.location, job.compensation].filter(Boolean).join(' · ')}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5 empty:hidden">
                        {job.inPipeline ? <StageBadge stage={job.stage} /> : null}
                        {!job.inPipeline && job.triageStatus === 'skipped' ? <Badge>Skipped</Badge> : null}
                        {job.dealbreakerReason ? <Badge variant="danger">Dealbreaker</Badge> : null}
                        {job.tags.map((tag) => (
                          <Badge key={tag} variant="brand">
                            {tag}
                          </Badge>
                        ))}
                      </span>
                    </span>
                    <ScoreRing score={job.matchScore} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {visible.length > shown ? (
            <div className="flex justify-center">
              <Button onClick={() => setShown((n) => n + PAGE)}>
                Show more ({visible.length - shown} left)
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
