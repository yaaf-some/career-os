import { Sparkles } from 'lucide-react';
import { describeAiError } from '@/api/client';
import { useEvaluateJobMutation } from '@/api/queries';
import type { JobDetail } from '@/api/types';
import { Badge, Button, PaperSheet, useToast } from '@/components/ui';

export function FitTab({ job }: { job: JobDetail }) {
  const evaluateMutation = useEvaluateJobMutation();
  const { showToast } = useToast();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">Deep Analysis (Blocks A–G)</h3>
          <p className="text-xs text-[var(--wp-muted)]">
            Balanced tier by default · auto-escalates to Deep when match score &ge; 75.
          </p>
        </div>
        <Button
          size="sm"
          variant="primary"
          disabled={evaluateMutation.isPending}
          onClick={() =>
            evaluateMutation.mutate(job.id, {
              onSuccess: () =>
                showToast({
                  tone: 'success',
                  message: `Deep analysis complete for ${job.company}`,
                }),
            })
          }
        >
          <Sparkles className="h-3.5 w-3.5" />
          <span>
            {evaluateMutation.isPending
              ? 'Evaluating…'
              : job.deepEval
                ? 'Re-run Deep Analysis'
                : 'Run Deep Analysis'}
          </span>
        </Button>
      </div>

      {evaluateMutation.isError ? (
        <p
          role="alert"
          className="rounded-[10px] bg-[var(--wp-bad-soft)] px-3 py-2 text-xs text-[var(--wp-bad)]"
        >
          {describeAiError(evaluateMutation.error)}
        </p>
      ) : null}

      {job.deepEval ? (
        <div className="space-y-3">
          <PaperSheet className="flex flex-wrap items-center justify-between gap-2 bg-[var(--wp-accent-soft)] p-4">
            <span className="text-sm font-medium text-[var(--wp-ink)]">
              {job.deepEval.overallVerdict}
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              {job.deepEval.confidence ? (
                <Badge variant="brand">{job.deepEval.confidence}</Badge>
              ) : null}
              {job.deepEval.provider ? (
                <Badge variant="neutral">
                  {job.deepEval.provider}
                  {job.deepEval.model ? ` · ${job.deepEval.model}` : ''}
                </Badge>
              ) : null}
            </div>
          </PaperSheet>

          {job.deepEval.blocks.map((block) => (
            <PaperSheet key={block.block} className="space-y-1.5 p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-medium text-[var(--wp-ink)]">
                  Block {block.block}: {block.title}
                </div>
                {block.rating ? (
                  <Badge variant={block.block === 'G' ? 'success' : 'neutral'}>
                    {block.rating}
                  </Badge>
                ) : null}
              </div>
              <p className="text-sm leading-relaxed text-[var(--wp-secondary)]">
                {block.summary}
              </p>
              {block.highlights.length > 0 ? (
                <ul className="list-disc space-y-0.5 pt-1 pl-4 text-xs text-[var(--wp-muted)]">
                  {block.highlights.map((h) => (
                    <li key={h}>{h}</li>
                  ))}
                </ul>
              ) : null}
            </PaperSheet>
          ))}
        </div>
      ) : (
        <PaperSheet className="p-6 text-center text-sm text-[var(--wp-muted)]">
          No A–G deep analysis yet. Run Deep Analysis to evaluate this role.
        </PaperSheet>
      )}
    </div>
  );
}
