import { PartyPopper } from 'lucide-react';
import { Button, Confetti, PaperSheet, StatTile } from '@/components/ui';
import { tint } from '@/lib/stages';

/** The empty queue: a small celebration when you were the one who emptied it. */
export function QueueComplete({
  saved,
  skipped,
  onAddJob,
}: {
  saved: number;
  skipped: number;
  onAddJob: () => void;
}) {
  const total = saved + skipped;
  return (
    <PaperSheet
      className="relative space-y-5 overflow-hidden rounded-[22px] px-5 py-10 text-center"
      data-testid="queue-complete"
    >
      {total > 0 ? <Confetti /> : null}
      <span
        aria-hidden="true"
        className="mx-auto flex h-16 w-16 items-center justify-center rounded-full text-[var(--wp-accent)]"
        style={{ backgroundColor: tint('var(--wp-accent)', 15) }}
      >
        <PartyPopper className="h-8 w-8" />
      </span>
      <div className="space-y-1.5">
        <h2 className="font-serif-title text-2xl">
          {total > 0 ? 'Queue complete' : 'Nothing to review'}
        </h2>
        <p className="text-sm text-[var(--wp-secondary)]">
          {total > 0
            ? `You decided ${total} ${total === 1 ? 'job' : 'jobs'} this session. Nice work.`
            : 'No jobs are waiting. New ones appear after a scan.'}
        </p>
      </div>
      {total > 0 ? (
        <div className="mx-auto grid max-w-xs grid-cols-2 gap-3 text-center">
          <StatTile label="Saved" value={saved} color="var(--stage-saved)" />
          <StatTile label="Skipped" value={skipped} color="var(--stage-new)" />
        </div>
      ) : null}
      <Button variant="primary" className="min-h-11" onClick={onAddJob}>
        Add posting
      </Button>
    </PaperSheet>
  );
}
