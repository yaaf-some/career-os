import { Bookmark, X } from 'lucide-react';
import { Sheet, SheetClose, SheetTitle } from '@/components/ui';
import { tint } from '@/lib/stages';
import { describeEntry, type EntryStatus, type HistoryEntry } from './verdictStore';

const STATUS: Record<EntryStatus, string> = {
  held: 'Not sent yet',
  sending: 'Sending…',
  sent: 'Done',
  undoing: 'Undoing…',
};

/** The last verdicts, each of which can still be taken back. */
export function UndoHistory({
  open,
  onOpenChange,
  history,
  onUndo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  history: HistoryEntry[];
  onUndo: (key: number) => void;
}) {
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      ariaLabel="Undo history"
      maxWidthClass="md:max-w-md"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-5">
        <div className="flex items-center justify-between">
          <SheetTitle className="text-base font-medium">Undo history</SheetTitle>
          <SheetClose className="tap-control min-h-11 rounded-[10px] bg-[var(--wp-raised)] px-4 text-xs font-medium">
            Done
          </SheetClose>
        </div>
        {history.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--wp-muted)]">
            Nothing to undo. Your latest verdicts will show here.
          </p>
        ) : (
          <ul className="paper-sheet min-h-0 flex-1 divide-y divide-[var(--wp-hairline)] overflow-y-auto rounded-[14px]">
            {history.map((entry) => {
              const save = entry.action === 'shortlist';
              const color = save ? 'var(--wp-good)' : 'var(--wp-bad)';
              const Icon = save ? Bookmark : X;
              const detail = entry.jobs.map((j) => j.title).join(', ');
              return (
                <li key={entry.key} className="flex items-center gap-3 px-3 py-2.5">
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                    style={{ color, backgroundColor: tint(color, 15) }}
                    aria-hidden="true"
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{describeEntry(entry)}</div>
                    <div className="truncate text-xs text-[var(--wp-muted)]">
                      {detail} · {STATUS[entry.status]}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={entry.status === 'undoing'}
                    onClick={() => onUndo(entry.key)}
                    aria-label={`Undo ${describeEntry(entry)}: ${detail}`}
                    className="tap-control min-h-11 shrink-0 rounded-[10px] bg-[var(--wp-raised)] px-4 text-sm font-medium text-[var(--wp-accent)] disabled:opacity-45"
                  >
                    Undo
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Sheet>
  );
}
