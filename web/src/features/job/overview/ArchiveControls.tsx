import { Archive, ArchiveRestore, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/api/queries';
import type { JobDetail } from '@/api/types';
import {
  Button,
  DialogContent,
  DialogDescription,
  DialogRoot,
  DialogTitle,
  Notice,
  PaperSheet,
  useToast,
} from '@/components/ui';
import { errorText, useArchiveJobMutation, useDeleteJobMutation } from './api';

function useArchive(job: JobDetail) {
  const mutation = useArchiveJobMutation(job.id);
  const { showToast } = useToast();
  const set = (archived: boolean) =>
    mutation.mutate(archived, {
      onSuccess: () =>
        showToast({
          tone: 'success',
          message: archived ? `Archived ${job.company}` : `${job.company} is back in your jobs`,
        }),
      onError: (err) => showToast({ tone: 'danger', message: errorText(err) }),
    });
  return { set, pending: mutation.isPending };
}

export function ArchivedBanner({ job }: { job: JobDetail }) {
  const archive = useArchive(job);
  if (!job.archivedAt) return null;
  return (
    <Notice tone="warning">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm">Archived. It is hidden from your job list.</span>
        <Button className="min-h-11" disabled={archive.pending} onClick={() => archive.set(false)}>
          <ArchiveRestore className="h-3.5 w-3.5" />
          <span>Unarchive</span>
        </Button>
      </div>
    </Notice>
  );
}

export function ManageCard({ job, onDeleted }: { job: JobDetail; onDeleted: () => void }) {
  const archive = useArchive(job);
  const remove = useDeleteJobMutation(job.id);
  const { showToast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const qc = useQueryClient();
  const deleted = useRef(false);

  // The cached copy goes once the page has been left, so nothing refetches it.
  useEffect(
    () => () => {
      if (deleted.current) qc.removeQueries({ queryKey: queryKeys.jobDetail(job.id) });
    },
    [qc, job.id],
  );

  return (
    <PaperSheet className="space-y-3 p-4">
      <h3 className="text-sm font-medium text-[var(--wp-ink)]">Manage this job</h3>
      <p className="text-xs text-[var(--wp-muted)]">
        Archiving hides the job but keeps everything, and a later scan will not bring it back as new.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          className="min-h-11"
          disabled={archive.pending}
          onClick={() => archive.set(!job.archivedAt)}
        >
          {job.archivedAt ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
          <span>{job.archivedAt ? 'Unarchive job' : 'Archive job'}</span>
        </Button>
        <Button
          variant="danger"
          className="min-h-11"
          onClick={() => {
            remove.reset();
            setConfirming(true);
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span>Delete permanently</span>
        </Button>
      </div>

      <DialogRoot open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="max-h-[85dvh] space-y-3 overflow-y-auto">
          <DialogTitle className="font-serif-title text-xl">Delete this job for good?</DialogTitle>
          <DialogDescription className="break-words text-sm text-[var(--wp-secondary)]">
            {job.title} at {job.company} will be removed along with its notes, tags, contact links,
            activity history, fit evaluations, application stage and follow-up, email draft,
            tailoring history and links to its documents.
          </DialogDescription>
          <p className="text-sm text-[var(--wp-secondary)]">
            Google Docs, Gmail messages and calendar events stay in your Google account. If a source
            still lists this posting, a later scan can add it again; archive it to keep it hidden.
          </p>
          <p className="text-sm font-medium text-[var(--wp-bad)]">This cannot be undone.</p>
          {remove.isError ? <Notice tone="danger">{errorText(remove.error)}</Notice> : null}
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button className="min-h-11" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              className="min-h-11"
              disabled={remove.isPending || remove.isSuccess}
              onClick={() =>
                remove.mutate(undefined, {
                  onSuccess: () => {
                    deleted.current = true;
                    setConfirming(false);
                    showToast({ tone: 'success', message: `Deleted ${job.company}` });
                    onDeleted();
                  },
                })
              }
            >
              {remove.isPending ? 'Deleting…' : 'Delete job'}
            </Button>
          </div>
        </DialogContent>
      </DialogRoot>
    </PaperSheet>
  );
}
