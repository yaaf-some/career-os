import { useEffect, useState, type FormEvent } from 'react';
import { formatMatchScore } from '@/api/jobs';
import { useQuickAddJobMutation } from '@/api/queries';
import { describeAiError } from '@/api/client';
import {
  Button,
  Input,
  Sheet,
  SheetClose,
  SheetDescription,
  SheetTitle,
  useToast,
} from '@/components/ui';

export function QuickAddDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (jobId: string) => void;
}) {
  const quickAddMutation = useQuickAddJobMutation();
  const { showToast } = useToast();

  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');

  useEffect(() => {
    if (!open) {
      setUrl('');
      setTitle('');
      setCompany('');
      quickAddMutation.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    quickAddMutation.mutate(
      {
        url: trimmed,
        title: title.trim() || undefined,
        company: company.trim() || undefined,
      },
      {
        onSuccess: (created) => {
          onOpenChange(false);
          showToast({
            tone: 'success',
            message: `Added ${created.title} (${formatMatchScore(created.matchScore)})`,
          });
          onCreated?.(created.id);
        },
      },
    );
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      ariaLabel="Add job posting"
      maxWidthClass="md:max-w-md"
    >
      <div className="flex flex-col gap-5 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <SheetTitle className="font-serif-title text-xl text-[var(--wp-ink)]">
              Add job posting
            </SheetTitle>
            <SheetDescription className="mt-1 text-xs text-[var(--wp-muted)]">
              Paste a posting URL to ingest and score automatically on the Fast tier.
            </SheetDescription>
          </div>
          <SheetClose className="tap-control rounded-[10px] bg-[var(--wp-raised)] px-3 py-1.5 text-xs font-medium text-[var(--wp-secondary)] hover:text-[var(--wp-ink)]">
            Cancel
          </SheetClose>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3" data-testid="quick-add-form">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-[var(--wp-secondary)]">Posting URL</span>
            <Input
              type="url"
              required
              autoFocus
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://boards.greenhouse.io/company/jobs/123"
              aria-label="Job posting URL"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-[var(--wp-secondary)]">Role title (optional)</span>
              <Input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Platform Engineer"
                aria-label="Role title"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-[var(--wp-secondary)]">Company (optional)</span>
              <Input
                type="text"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="Acme Cloud"
                aria-label="Company name"
              />
            </label>
          </div>

          {quickAddMutation.isError ? (
            <p role="alert" className="text-xs text-[var(--wp-bad)]">
              {describeAiError(quickAddMutation.error)}
            </p>
          ) : null}

          <div className="flex items-center justify-between gap-3 pt-2">
            <button
              type="button"
              onClick={() => setUrl('https://boards.greenhouse.io/example-cloud/jobs/101')}
              className="text-xs text-[var(--wp-muted)] underline hover:text-[var(--wp-ink)]"
            >
              Try sample link
            </button>
            <Button
              type="submit"
              variant="primary"
              disabled={quickAddMutation.isPending || !url.trim()}
            >
              {quickAddMutation.isPending ? 'Adding…' : 'Add to queue'}
            </Button>
          </div>
        </form>
      </div>
    </Sheet>
  );
}
