import { Bookmark, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { formatMatchScore } from '@/api/jobs';
import type { JobSummary } from '@/api/types';
import { Monogram, PaperSheet } from '@/components/ui';
import { scoreColor, tint } from '@/lib/stages';
import type { VerdictAction } from './api';
import { relativeAge } from './queue';

const rowButton = 'tap-control flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px]';
const checkboxClass = 'h-5 w-5 accent-[var(--wp-accent)]';

function SelectAll({
  total,
  selected,
  onChange,
}: {
  total: number;
  selected: number;
  onChange: (all: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = selected > 0 && selected < total;
  }, [selected, total]);
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-1 pr-3 text-sm font-medium">
      <span className="flex h-11 w-11 items-center justify-center">
        <input
          ref={ref}
          type="checkbox"
          className={checkboxClass}
          checked={total > 0 && selected === total}
          onChange={(e) => onChange(e.target.checked)}
        />
      </span>
      Select all
    </label>
  );
}

/** The fast way through: one tap per job, or select many and decide at once. */
export function TriageList({
  jobs,
  selected,
  onSelectedChange,
  onVerdict,
  onBulk,
  onOpen,
}: {
  jobs: JobSummary[];
  selected: ReadonlySet<string>;
  onSelectedChange: (next: Set<string>) => void;
  onVerdict: (action: VerdictAction, jobId: string) => void;
  onBulk: (action: VerdictAction, jobs: JobSummary[]) => void;
  onOpen: (jobId: string) => void;
}) {
  // Only what is on screen: a filter must not leave hidden jobs selected for a bulk action.
  const chosen = jobs.filter((j) => selected.has(j.id));
  const toggle = (id: string, on: boolean) => {
    const next = new Set(chosen.map((j) => j.id));
    if (on) next.add(id);
    else next.delete(id);
    onSelectedChange(next);
  };

  return (
    <div className="space-y-2" data-testid="triage-list">
      <div className="sticky top-0 z-20 flex min-h-14 flex-wrap items-center justify-between gap-2 rounded-[14px] border border-[var(--wp-hairline)] bg-[var(--wp-surface)] py-1 pl-1 pr-2 shadow-[var(--wp-shadow-sm)]">
        <SelectAll
          total={jobs.length}
          selected={chosen.length}
          onChange={(all) => onSelectedChange(new Set(all ? jobs.map((j) => j.id) : []))}
        />
        {chosen.length > 0 ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onBulk('skip', chosen)}
              className="tap-control min-h-11 rounded-[12px] bg-[var(--wp-bad-soft)] px-3 text-sm font-semibold text-[var(--wp-bad)]"
            >
              Skip {chosen.length}
            </button>
            <button
              type="button"
              onClick={() => onBulk('shortlist', chosen)}
              className="tap-control min-h-11 rounded-[12px] bg-[var(--wp-good)] px-3 text-sm font-semibold text-[var(--wp-surface)]"
            >
              Save {chosen.length}
            </button>
          </div>
        ) : null}
      </div>

      <PaperSheet className="divide-y divide-[var(--wp-hairline)] overflow-hidden">
        {jobs.map((job) => {
          const age = relativeAge(job.postedAt ?? job.discoveredAt);
          const color = scoreColor(job.matchScore);
          return (
            <div key={job.id} className="flex items-center gap-1 py-2 pl-1 pr-2">
              <label className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center">
                <input
                  type="checkbox"
                  className={checkboxClass}
                  aria-label={`Select ${job.title} at ${job.company}`}
                  checked={selected.has(job.id)}
                  onChange={(e) => toggle(job.id, e.target.checked)}
                />
              </label>
              <button
                type="button"
                onClick={() => onOpen(job.id)}
                className="flex min-w-0 flex-1 items-center gap-3 py-1 text-left"
              >
                <span className="hidden sm:block">
                  <Monogram company={job.company} size="sm" />
                </span>
                <span className="block min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{job.title}</span>
                  <span className="block truncate text-xs text-[var(--wp-muted)]">
                    {[job.company, job.location].filter(Boolean).join(' · ')}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                    <span
                      className="font-mono-meta rounded-full px-2 py-0.5 font-semibold"
                      style={{ color, backgroundColor: tint(color, 14) }}
                    >
                      {formatMatchScore(job.matchScore)}
                    </span>
                    {job.dealbreakerReason ? (
                      <span className="font-medium text-[var(--wp-bad)]">Dealbreaker</span>
                    ) : null}
                    {job.compensation ? (
                      <span className="text-[var(--wp-secondary)]">{job.compensation}</span>
                    ) : null}
                    {age ? <span className="text-[var(--wp-muted)]">{age}</span> : null}
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => onVerdict('skip', job.id)}
                aria-label={`Skip ${job.title} at ${job.company}`}
                className={`${rowButton} bg-[var(--wp-bad-soft)] text-[var(--wp-bad)]`}
              >
                <X className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => onVerdict('shortlist', job.id)}
                aria-label={`Save ${job.title} at ${job.company}`}
                className={`${rowButton} bg-[var(--wp-good-soft)] text-[var(--wp-good)]`}
              >
                <Bookmark className="h-5 w-5" />
              </button>
            </div>
          );
        })}
      </PaperSheet>
    </div>
  );
}
