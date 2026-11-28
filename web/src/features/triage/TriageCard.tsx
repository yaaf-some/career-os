import { Banknote, Bookmark, ChevronRight, Clock, ExternalLink, MapPin, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { JobSummary, ScoreBreakdown } from '@/api/types';
import { CommuteBadge } from '@/components/CommuteBadge';
import { Monogram, Notice, ScoreRing } from '@/components/ui';
import { cn } from '@/lib/cn';
import { companyHue, tint } from '@/lib/stages';
import { relativeAge, safeExternalUrl } from './queue';
import type { SwipeHandlers } from './useSwipeGesture';

const FIT_PARTS: readonly {
  key: keyof ScoreBreakdown;
  label: string;
  max: number;
  color: string;
}[] = [
  { key: 'roleStack', label: 'Role', max: 35, color: 'var(--fit-role)' },
  { key: 'levelReachability', label: 'Level', max: 25, color: 'var(--fit-level)' },
  { key: 'vibeCulture', label: 'Vibe', max: 25, color: 'var(--fit-vibe)' },
  { key: 'logisticsComp', label: 'Logistics', max: 15, color: 'var(--fit-logistics)' },
];

function FitBreakdown({ breakdown }: { breakdown: ScoreBreakdown }) {
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-2.5" data-testid="fit-breakdown">
      {FIT_PARTS.map((part) => {
        const value = breakdown[part.key];
        const pct = Math.max(0, Math.min(100, (value / part.max) * 100));
        return (
          <li key={part.key}>
            <div className="font-mono-meta text-xs text-[var(--wp-secondary)]">
              {`${part.label} ${value}/${part.max}`}
            </div>
            <div
              className="mt-1 h-1.5 overflow-hidden rounded-full"
              style={{ backgroundColor: tint(part.color, 18) }}
              aria-hidden="true"
            >
              <div
                className="h-full rounded-full"
                style={{ width: `${pct}%`, backgroundColor: part.color }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Chip({ icon, color, children }: { icon: ReactNode; color: string; children: ReactNode }) {
  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
      style={{ color, backgroundColor: tint(color, 13) }}
    >
      {icon}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** Colored feedback that grows with the drag; the gesture sets its opacity. */
function SwipeFeedback() {
  return (
    <>
      {(
        [
          ['shortlist', 'Save', 'var(--wp-good)', 'left-5 -rotate-12', Bookmark],
          ['skip', 'Skip', 'var(--wp-bad)', 'right-5 rotate-12', X],
        ] as const
      ).map(([action, label, color, position, Icon]) => (
        <div key={action} aria-hidden="true">
          <div
            data-wash={action}
            className="pointer-events-none absolute inset-0 z-10 rounded-[inherit] border-[3px] opacity-0"
            style={{ borderColor: color, backgroundColor: tint(color, 14) }}
          />
          <div
            data-stamp={action}
            className={cn(
              'pointer-events-none absolute top-6 z-20 flex items-center gap-1.5 rounded-[12px] border-[3px] bg-[var(--wp-surface)] px-3 py-1.5 text-lg font-bold uppercase tracking-widest opacity-0 data-[armed]:shadow-[var(--wp-shadow-lg)]',
              position,
            )}
            style={{ color, borderColor: color }}
          >
            <Icon className="h-5 w-5" strokeWidth={3} />
            {label}
          </div>
        </div>
      ))}
    </>
  );
}

function Description({ job }: { job: JobSummary }) {
  const [expanded, setExpanded] = useState(false);
  const text = job.descriptionText?.trim() ?? '';

  if (!text) {
    return job.hasDescription ? null : (
      <Notice tone="warning">
        {job.matchScore === null
          ? 'No description yet.'
          : 'No description yet: the score may rest on the title alone.'}
      </Notice>
    );
  }
  const long = text.length > 280 || text.split('\n').length > 6;
  return (
    <section className="space-y-1.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--wp-muted)]">
        From the posting
      </h3>
      {/* Expanded text is for reading and selecting, so a drag on it never swipes. */}
      <p
        data-no-swipe={expanded ? '' : undefined}
        data-testid="card-description"
        className={cn(
          'whitespace-pre-line break-words text-sm leading-relaxed text-[var(--wp-secondary)]',
          expanded ? 'select-text' : long && 'line-clamp-6',
        )}
      >
        {text}
      </p>
      {long ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="tap-control min-h-11 text-sm font-medium text-[var(--wp-accent)]"
        >
          {expanded ? 'Show less' : 'Show full description'}
        </button>
      ) : null}
    </section>
  );
}

/**
 * One job, with everything needed to decide. The header and footer stay put and
 * the middle scrolls. `isTop` is false for the card waiting behind.
 */
export function TriageCard({
  job,
  isTop,
  handlers,
  onOpen,
}: {
  job: JobSummary;
  isTop: boolean;
  handlers?: SwipeHandlers;
  onOpen?: () => void;
}) {
  const hue = companyHue(job.company);
  const postingUrl = safeExternalUrl(job.url);
  const posted = relativeAge(job.postedAt);
  const found = relativeAge(job.discoveredAt);
  const remote = job.remotePolicy.toLowerCase().includes('remote');
  const place = [
    job.company,
    job.location,
    job.remotePolicy === 'unknown' ? null : job.remotePolicy,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <article
      data-testid={isTop ? 'focus-card' : 'next-card'}
      {...handlers}
      onDragStart={(e) => e.preventDefault()}
      className={cn(
        'paper-floating relative flex h-full w-full select-none flex-col overflow-hidden rounded-[22px] text-[var(--wp-ink)]',
        'touch-pan-y touch-pinch-zoom [-webkit-touch-callout:none]',
        '[transition:transform_380ms_var(--ease-spring)] motion-reduce:[transition:none]',
        isTop && 'cursor-grab active:cursor-grabbing',
      )}
    >
      <SwipeFeedback />

      <header
        className="flex shrink-0 items-start gap-3 px-4 pb-3 pt-4"
        style={{ backgroundImage: `linear-gradient(180deg, ${tint(hue, 15)}, transparent)` }}
      >
        <Monogram company={job.company} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="font-serif-title line-clamp-3 break-words text-xl leading-tight">
            {job.title}
          </h2>
          <p className="mt-1 line-clamp-2 text-xs text-[var(--wp-secondary)]">{place}</p>
        </div>
        <ScoreRing score={job.matchScore} size={56} />
      </header>

      <div
        className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 pb-4"
        data-testid={isTop ? 'card-body' : undefined}
      >
        <div className="flex flex-wrap gap-1.5">
          <Chip
            icon={<Banknote className="h-3.5 w-3.5 shrink-0" />}
            color={job.compensation ? 'var(--wp-good)' : 'var(--wp-muted)'}
          >
            {job.compensation ?? 'Pay not listed'}
          </Chip>
          {posted ? (
            <Chip icon={<Clock className="h-3.5 w-3.5 shrink-0" />} color="var(--stage-applied)">
              Posted {posted}
            </Chip>
          ) : null}
          {found ? (
            <Chip icon={<MapPin className="h-3.5 w-3.5 shrink-0" />} color="var(--stage-interview)">
              Found {found}
            </Chip>
          ) : null}
          {/* One commute lookup at a time: only for the card being decided. */}
          {isTop && !remote ? (
            <CommuteBadge jobId={job.id} remotePolicy={job.remotePolicy} compact />
          ) : null}
        </div>

        {job.dealbreakerReason ? (
          <Notice tone="danger">Dealbreaker: {job.dealbreakerReason}</Notice>
        ) : null}

        <section className="space-y-3 rounded-[14px] bg-[var(--wp-raised)] p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--wp-muted)]">
            Why this score
          </h3>
          <p className="text-sm leading-relaxed">
            {job.matchSummary ||
              (job.matchScore === null ? 'Not scored yet.' : 'No reason was recorded.')}
          </p>
          {job.scoreBreakdown ? <FitBreakdown breakdown={job.scoreBreakdown} /> : null}
        </section>

        <Description job={job} />
      </div>

      <footer className="flex shrink-0 items-stretch border-t border-[var(--wp-hairline)]">
        {postingUrl ? (
          <a
            href={postingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="tap-control flex min-h-12 items-center gap-1.5 border-r border-[var(--wp-hairline)] px-4 text-xs font-medium text-[var(--wp-secondary)] hover:text-[var(--wp-ink)]"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Posting
          </a>
        ) : null}
        <button
          type="button"
          onClick={onOpen}
          className="tap-control flex min-h-12 min-w-0 flex-1 items-center justify-between gap-2 px-4 text-left text-xs font-medium text-[var(--wp-accent)]"
        >
          <span>Read posting &amp; deep analysis</span>
          <ChevronRight className="h-4 w-4 shrink-0" />
        </button>
      </footer>
    </article>
  );
}
