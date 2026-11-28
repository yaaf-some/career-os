import { Bookmark, ChevronLeft, ChevronRight, Undo2, X } from 'lucide-react';
import { Kbd } from '@/components/ui';

const arrowClass =
  'tap-control flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] text-[var(--wp-secondary)] hover:bg-[var(--wp-raised)] disabled:opacity-30';

const verdictClass =
  'tap-control flex h-14 min-w-0 flex-1 items-center justify-center gap-2 rounded-[16px] text-base font-semibold';

function Key({ children, solid = false }: { children: string; solid?: boolean }) {
  return (
    <span aria-hidden="true" className="hidden md:inline-flex">
      <Kbd className={solid ? 'border-current !bg-transparent !text-inherit' : undefined}>
        {children}
      </Kbd>
    </span>
  );
}

/** Every gesture has a button here, within reach of a thumb. */
export function ActionDock({
  position,
  total,
  canUndo,
  onPrevious,
  onNext,
  onSkip,
  onSave,
  onUndo,
}: {
  /** 1-based place of the current card in the queue. */
  position: number;
  total: number;
  canUndo: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onSkip: () => void;
  onSave: () => void;
  onUndo: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous job"
          disabled={position <= 1}
          onClick={onPrevious}
          className={arrowClass}
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <span className="font-mono-meta text-xs text-[var(--wp-muted)]">
          {position} of {total}
        </span>
        <button
          type="button"
          aria-label="Next job"
          disabled={position >= total}
          onClick={onNext}
          className={arrowClass}
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onSkip}
          aria-keyshortcuts="X"
          className={`${verdictClass} border-2 border-[var(--wp-bad)] bg-[var(--wp-bad-soft)] text-[var(--wp-bad)]`}
        >
          <X className="h-5 w-5" strokeWidth={2.5} />
          <span>Skip</span>
          <Key>X</Key>
        </button>
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          aria-label="Undo"
          aria-keyshortcuts="Z"
          title="Undo (Z)"
          className="tap-control paper-sheet flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-[var(--wp-warn)] disabled:opacity-35"
        >
          <Undo2 className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={onSave}
          aria-keyshortcuts="S"
          className={`${verdictClass} border-2 border-[var(--wp-good)] bg-[var(--wp-good)] text-[var(--wp-surface)]`}
        >
          <Bookmark className="h-5 w-5" strokeWidth={2.5} />
          <span>Save</span>
          <Key solid>S</Key>
        </button>
      </div>
    </div>
  );
}
