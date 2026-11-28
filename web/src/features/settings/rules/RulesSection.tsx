import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { describeAiError } from '@/api/client';
import {
  useBackfillDescriptionsMutation,
  useProfileStatusQuery,
  useRescoreJobsMutation,
} from '@/api/queries';
import { Button, PaperSheet, Switch, useToast } from '@/components/ui';

export function RulesSection() {
  const profileStatus = useProfileStatusQuery().data;
  const rescoreMutation = useRescoreJobsMutation();
  const backfillMutation = useBackfillDescriptionsMutation();
  const { showToast } = useToast();
  const [includeSkippedRescore, setIncludeSkippedRescore] = useState(false);

  return (
    <section className="space-y-2" data-testid="scoring-rules-card">
      <div className="px-1 text-xs font-medium text-[var(--wp-muted)]">Scoring &amp; search rules</div>
      <PaperSheet className="divide-y divide-[var(--wp-hairline)] overflow-hidden">
        {profileStatus?.targeting ? (
          <div className="px-4 py-4">
            <div className="grid gap-3 rounded-[12px] bg-[var(--wp-raised)]/60 p-3 text-xs sm:grid-cols-3">
              <div>
                <div className="text-[var(--wp-muted)]">Target Roles</div>
                <div className="mt-0.5 font-medium text-[var(--wp-ink)]">
                  {profileStatus.targeting.primaryRoles.join(', ') || 'Unspecified'}
                </div>
              </div>
              <div>
                <div className="text-[var(--wp-muted)]">Scoring Weights</div>
                <div className="font-mono-meta mt-0.5 font-medium text-[var(--wp-ink)]">
                  Role {profileStatus.targeting.weights.role_stack} · Lvl{' '}
                  {profileStatus.targeting.weights.level_reachability} · Vibe{' '}
                  {profileStatus.targeting.weights.vibe_culture} · Log{' '}
                  {profileStatus.targeting.weights.logistics_comp}
                </div>
              </div>
              <div>
                <div className="text-[var(--wp-muted)]">Guardrails</div>
                <div className="mt-0.5 font-medium text-[var(--wp-ink)]">
                  Max {profileStatus.targeting.maxYoe ?? '–'} YOE ·{' '}
                  {profileStatus.targeting.dealbreakerCount} dealbreakers ·{' '}
                  {profileStatus.targeting.boostCount} boosts
                </div>
              </div>
            </div>
          </div>
        ) : null}
        <div className="space-y-2 px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <label className="inline-flex items-center gap-2.5 text-[var(--wp-secondary)]">
              <Switch
                checked={includeSkippedRescore}
                onCheckedChange={setIncludeSkippedRescore}
                ariaLabel="Include previously skipped jobs when rescoring"
              />
              <span>Include previously skipped jobs when rescoring</span>
            </label>
            <Button
              size="sm"
              variant="primary"
              disabled={rescoreMutation.isPending}
              onClick={() =>
                rescoreMutation.mutate(
                  { includeSkipped: includeSkippedRescore, scoreLimit: 10 },
                  {
                    onSuccess: (res) =>
                      showToast({
                        tone: 'success',
                        message: `Reset ${res.resetCount} · Scored ${res.scored}`,
                      }),
                  },
                )
              }
            >
              <RefreshCw
                className={
                  rescoreMutation.isPending ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'
                }
              />
              <span>
                {rescoreMutation.isPending ? 'Rescoring…' : 'Rescore Pending Jobs'}
              </span>
            </Button>
          </div>
          {rescoreMutation.data ? (
            <p className="text-xs text-[var(--wp-good)]">
              Reset {rescoreMutation.data.resetCount} unapplied jobs · Scored{' '}
              {rescoreMutation.data.scored} immediately (hourly scheduler finishes any
              remainder).
            </p>
          ) : null}
          {rescoreMutation.isError ? (
            <p role="alert" className="text-xs text-[var(--wp-bad)]">
              {describeAiError(rescoreMutation.error)}
            </p>
          ) : null}
        </div>

        <div className="space-y-2 px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <span className="text-[var(--wp-secondary)]">
              Fill in jobs that have no description
            </span>
            <Button
              size="sm"
              variant="secondary"
              disabled={backfillMutation.isPending}
              onClick={() => backfillMutation.mutate()}
            >
              {backfillMutation.isPending ? 'Fetching…' : 'Fetch missing descriptions'}
            </Button>
          </div>
          {backfillMutation.data ? (
            <p role="status" className="text-xs text-[var(--wp-secondary)]">
              Filled {backfillMutation.data.filled} of {backfillMutation.data.checked}.
              Already complete: {backfillMutation.data.unchanged}. No longer posted:{' '}
              {backfillMutation.data.gone}. Not available:{' '}
              {backfillMutation.data.unavailable}. Failed: {backfillMutation.data.failed}.
              {backfillMutation.data.aiSkippedWithoutDescription > 0
                ? ` ${backfillMutation.data.aiSkippedWithoutDescription} jobs were skipped by AI before they had a description. Rescore with skipped jobs included to review them.`
                : ''}
            </p>
          ) : null}
          {backfillMutation.isError ? (
            <p role="alert" className="text-xs text-[var(--wp-bad)]">
              {backfillMutation.error.message}
            </p>
          ) : null}
        </div>
      </PaperSheet>
    </section>
  );
}
