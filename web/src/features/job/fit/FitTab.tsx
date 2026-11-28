import { RefreshCw, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { describeAiError } from '@/api/client';
import type { JobDetail } from '@/api/types';
import { FitHorizon } from '@/components/FitHorizon';
import { Badge, Button, Notice, PaperSheet, ScoreRing, Select, Skeleton, useToast } from '@/components/ui';
import { errorText, useRawJobQuery } from '../overview/api';
import {
  TIER_OPTIONS,
  evaluationViews,
  fallbackViews,
  guardFlagLines,
  triageDetail,
  useEvaluateMutation,
  useRescoreJobMutation,
  type EvaluationView,
  type TierChoice,
  type TriageDetail,
} from './api';
import { ReportMarkdown } from './ReportMarkdown';

const WHEN = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const tierLabel = (tier: string) => TIER_OPTIONS.find((o) => o.value === tier)?.label ?? tier;

function TriageCard({ job, detail }: { job: JobDetail; detail: TriageDetail }) {
  const rescore = useRescoreJobMutation(job.id);
  const { showToast } = useToast();

  const run = () => {
    const wasWaiting = job.triageStatus === 'pending' && !job.inPipeline;
    rescore.mutate(undefined, {
      onSuccess: (result) =>
        showToast({
          tone: 'success',
          message:
            wasWaiting && result.triageStatus === 'skipped'
              ? `Rescored ${Math.round(result.score)} and moved to skipped`
              : `Rescored: ${Math.round(result.score)} of 100`,
        }),
    });
  };

  return (
    <PaperSheet className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ScoreRing score={job.matchScore} size={52} />
          <div>
            <h3 className="text-sm font-medium text-[var(--wp-ink)]">Triage score</h3>
            <p className="text-xs text-[var(--wp-muted)]">
              {job.matchScore === null ? 'Not scored yet' : 'Quick match against your profile'}
            </p>
          </div>
        </div>
        <Button className="min-h-11" disabled={rescore.isPending} onClick={run}>
          <RefreshCw className={`h-3.5 w-3.5 ${rescore.isPending ? 'motion-safe:animate-spin' : ''}`} />
          <span>{rescore.isPending ? 'Scoring…' : 'Rescore this job'}</span>
        </Button>
      </div>
      {rescore.isError ? <Notice tone="danger">{describeAiError(rescore.error)}</Notice> : null}

      {job.scoreBreakdown ? (
        <FitHorizon score={job.matchScore} breakdown={job.scoreBreakdown} compact />
      ) : null}

      {detail.archetype || job.dealbreakerReason ? (
        <div className="flex flex-wrap gap-1.5">
          {detail.archetype ? <Badge variant="brand">{detail.archetype}</Badge> : null}
          {job.dealbreakerReason ? (
            <Badge variant="danger">Dealbreaker: {job.dealbreakerReason}</Badge>
          ) : null}
        </div>
      ) : null}
      {job.matchSummary ? (
        <p className="text-sm leading-relaxed text-[var(--wp-secondary)]">{job.matchSummary}</p>
      ) : null}
      {detail.scoredWithoutDescription ? (
        <Notice tone="warning">
          This score was made without a description. Rescore to include it.
        </Notice>
      ) : null}
    </PaperSheet>
  );
}

function Evaluation({ evaluation }: { evaluation: EvaluationView }) {
  return (
    <div className="space-y-3" data-testid="evaluation">
      <PaperSheet className="space-y-2 bg-[var(--wp-accent-soft)] p-4">
        <p className="font-serif-title text-lg text-[var(--wp-ink)]">{evaluation.verdict}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {evaluation.tier ? <Badge variant="brand">{tierLabel(evaluation.tier)}</Badge> : null}
          {evaluation.ranBy ? <Badge>{evaluation.ranBy}</Badge> : null}
          <span className="text-xs text-[var(--wp-muted)]">
            {WHEN.format(new Date(evaluation.createdAt))}
          </span>
        </div>
      </PaperSheet>

      {evaluation.blocks.map((block) => (
        <PaperSheet key={block.block} className="space-y-1.5 p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-medium text-[var(--wp-ink)]">
              Block {block.block}: {block.title}
            </div>
            {block.rating ? (
              <Badge variant={block.block === 'G' ? 'success' : 'neutral'}>{block.rating}</Badge>
            ) : null}
          </div>
          <p className="break-words text-sm leading-relaxed text-[var(--wp-secondary)]">
            {block.summary}
          </p>
          {block.highlights.length > 0 ? (
            <ul className="list-disc space-y-0.5 pt-1 pl-4 text-xs text-[var(--wp-muted)]">
              {block.highlights.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
          ) : null}
        </PaperSheet>
      ))}

      {evaluation.reportMd ? (
        <PaperSheet className="space-y-2 p-4">
          <h4 className="text-xs font-medium text-[var(--wp-muted)]">Full report</h4>
          <ReportMarkdown source={evaluation.reportMd} />
        </PaperSheet>
      ) : null}
    </div>
  );
}

export function FitTab({ job }: { job: JobDetail }) {
  const raw = useRawJobQuery(job.id);
  const evaluate = useEvaluateMutation(job.id);
  const { showToast } = useToast();
  const [tier, setTier] = useState<TierChoice>('auto');
  /** `null` follows the newest evaluation. */
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const evaluations = raw.data ? evaluationViews(raw.data.evaluations) : fallbackViews(job.deepEval);
  const shown = evaluations.find((e) => e.id === selectedId) ?? evaluations[0];
  const guardLines = guardFlagLines(raw.data?.job.guard_flags_json);

  const run = () =>
    evaluate.mutate(tier, {
      onSuccess: () => {
        setSelectedId(null);
        showToast({ tone: 'success', message: `Deep analysis complete for ${job.company}` });
      },
    });

  return (
    <div className="space-y-4">
      <TriageCard job={job} detail={triageDetail(raw.data?.job)} />

      {guardLines.length > 0 ? (
        <Notice tone="warning">
          <div className="space-y-1">
            <p className="text-sm font-medium">Posting guard flags</p>
            <ul className="list-disc pl-4">
              {guardLines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </Notice>
      ) : null}

      <PaperSheet className="space-y-3 p-4">
        <div>
          <h3 className="text-sm font-medium">Deep Analysis (Blocks A–G)</h3>
          <p className="text-xs text-[var(--wp-muted)]">
            Auto uses Balanced, or Deep when the triage score is 75 or higher.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            ariaLabel="Analysis tier"
            className="min-h-11 min-w-32"
            value={tier}
            onValueChange={setTier}
            options={TIER_OPTIONS}
          />
          <Button variant="primary" className="min-h-11" disabled={evaluate.isPending} onClick={run}>
            <Sparkles className="h-3.5 w-3.5" />
            <span>
              {evaluate.isPending
                ? 'Evaluating…'
                : evaluations.length > 0
                  ? 'Run again'
                  : 'Run deep analysis'}
            </span>
          </Button>
        </div>
        {evaluate.isError ? <Notice tone="danger">{describeAiError(evaluate.error)}</Notice> : null}
      </PaperSheet>

      {raw.isError && !raw.data ? (
        <Notice tone="danger">
          Could not load the evaluation history: {errorText(raw.error)}{' '}
          <button type="button" className="underline" onClick={() => void raw.refetch()}>
            Try again
          </button>
        </Notice>
      ) : null}

      {evaluations.length > 1 ? (
        <PaperSheet className="space-y-2 p-4">
          <h4 className="text-xs font-medium text-[var(--wp-muted)]">
            History ({evaluations.length})
          </h4>
          <ul className="max-h-60 space-y-1.5 overflow-y-auto">
            {evaluations.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  aria-pressed={e.id === shown?.id}
                  onClick={() => setSelectedId(e.id === evaluations[0]!.id ? null : e.id)}
                  className="tap-control flex min-h-11 w-full flex-wrap items-center justify-between gap-x-3 rounded-[10px] border border-[var(--wp-hairline)] px-3 py-2 text-left text-sm text-[var(--wp-ink)] aria-pressed:border-[var(--wp-accent)] aria-pressed:bg-[var(--wp-accent-soft)]"
                >
                  <span className="min-w-0 truncate">{WHEN.format(new Date(e.createdAt))}</span>
                  <span className="text-xs text-[var(--wp-muted)]">
                    {[e.tier ? tierLabel(e.tier) : null, e.score].filter(Boolean).join(' · ')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </PaperSheet>
      ) : null}

      {shown ? (
        <Evaluation evaluation={shown} />
      ) : raw.isLoading ? (
        <Skeleton className="h-24 w-full rounded-[16px]" />
      ) : (
        <PaperSheet className="p-6 text-center text-sm text-[var(--wp-muted)]">
          No A–G deep analysis yet. Run one to evaluate this role.
        </PaperSheet>
      )}
    </div>
  );
}
