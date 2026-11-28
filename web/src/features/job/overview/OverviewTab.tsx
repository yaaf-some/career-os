import type { JobDetail } from '@/api/types';
import { DescriptionSection } from '@/components/DescriptionSection';
import { FitHorizon } from '@/components/FitHorizon';
import { Badge, PaperSheet } from '@/components/ui';

export function OverviewTab({ job }: { job: JobDetail }) {
  return (
    <div className="space-y-4">
      <PaperSheet className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-medium text-[var(--wp-muted)]">
            Fit breakdown
          </span>
          {job.dealbreakerReason ? (
            <Badge variant="danger">Dealbreaker: {job.dealbreakerReason}</Badge>
          ) : null}
        </div>
        <FitHorizon
          score={job.matchScore}
          breakdown={job.scoreBreakdown}
          source={job.source}
          compact
        />
        {job.matchSummary ? (
          <p className="text-sm leading-relaxed text-[var(--wp-secondary)]">
            {job.matchSummary}
          </p>
        ) : null}
      </PaperSheet>

      <DescriptionSection key={job.id} jobId={job.id} text={job.descriptionText} />

      {job.requirements.length > 0 ? (
        <PaperSheet className="space-y-2 p-4">
          <h4 className="text-xs font-medium text-[var(--wp-muted)]">Key requirements</h4>
          <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--wp-secondary)]">
            {job.requirements.map((req) => (
              <li key={req}>{req}</li>
            ))}
          </ul>
        </PaperSheet>
      ) : null}
    </div>
  );
}
