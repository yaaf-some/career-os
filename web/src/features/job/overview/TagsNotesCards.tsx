import { X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button, Input, Notice, PaperSheet, Textarea } from '@/components/ui';
import { companyHue, tint } from '@/lib/stages';
import { errorText, useAnnotationMutation, useAnnotationsQuery, type JobNote } from './api';

function LoadFailure({ what, error, retry }: { what: string; error: unknown; retry: () => void }) {
  return (
    <Notice tone="danger">
      Could not load {what}: {errorText(error)}{' '}
      <button type="button" className="underline" onClick={retry}>
        Try again
      </button>
    </Notice>
  );
}

export function TagsCard({ jobId }: { jobId: string }) {
  const query = useAnnotationsQuery(jobId);
  const mutation = useAnnotationMutation(jobId);
  const [draft, setDraft] = useState('');
  /** The tag being renamed, if any; the input then edits it. */
  const [renaming, setRenaming] = useState<string | null>(null);
  const tags = query.data?.tags ?? [];

  const reset = () => {
    setDraft('');
    setRenaming(null);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const tag = draft.trim();
    if (!tag || mutation.isPending) return;
    mutation.mutate(
      renaming ? { type: 'renameTag', from: renaming, to: tag } : { type: 'addTag', tag },
      { onSuccess: reset },
    );
  };

  return (
    <PaperSheet className="space-y-3 p-4">
      <h3 className="text-sm font-medium text-[var(--wp-ink)]">Tags</h3>
      {query.isError && !query.data ? (
        <LoadFailure what="tags" error={query.error} retry={() => void query.refetch()} />
      ) : null}
      {tags.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <li
              key={tag}
              className="flex min-w-0 max-w-full items-center rounded-full border border-[var(--wp-hairline)] text-sm text-[var(--wp-ink)]"
              style={{ backgroundColor: tint(companyHue(tag), 16) }}
            >
              <button
                type="button"
                aria-label={`Rename tag ${tag}`}
                className="tap-control min-h-10 min-w-0 truncate rounded-l-full pl-3.5 pr-1"
                onClick={() => {
                  setRenaming(tag);
                  setDraft(tag);
                }}
              >
                {tag}
              </button>
              <button
                type="button"
                aria-label={`Remove tag ${tag}`}
                disabled={mutation.isPending}
                className="tap-control flex h-10 w-9 shrink-0 items-center justify-center rounded-r-full text-[var(--wp-muted)] hover:text-[var(--wp-bad)]"
                onClick={() => {
                  if (renaming === tag) reset();
                  mutation.mutate({ type: 'removeTag', tag });
                }}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : query.data ? (
        <p className="text-xs text-[var(--wp-muted)]">No tags yet. Tags also show in the job list.</p>
      ) : null}
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
        <Input
          aria-label={renaming ? `New name for tag ${renaming}` : 'New tag'}
          className="min-h-11 min-w-0 flex-1 basis-40 max-sm:!text-base"
          placeholder={renaming ? 'New name' : 'Add a tag'}
          maxLength={40}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button type="submit" className="min-h-11" disabled={!draft.trim() || mutation.isPending}>
          {renaming ? 'Rename' : 'Add tag'}
        </Button>
        {renaming ? (
          <Button variant="ghost" className="min-h-11" onClick={reset}>
            Cancel
          </Button>
        ) : null}
      </form>
      {mutation.isError ? <Notice tone="danger">{errorText(mutation.error)}</Notice> : null}
    </PaperSheet>
  );
}

const NOTE_DATE = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function NoteItem({ jobId, note }: { jobId: string; note: JobNote }) {
  const mutation = useAnnotationMutation(jobId);
  const [draft, setDraft] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const edited = note.updatedAt !== note.createdAt;

  return (
    <li className="space-y-2 rounded-[12px] border border-[var(--wp-hairline)] bg-[var(--wp-canvas)] p-3">
      {draft === null ? (
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--wp-ink)]">
          {note.body}
        </p>
      ) : (
        <Textarea
          aria-label="Edit note"
          rows={4}
          className="max-sm:!text-base"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-[var(--wp-muted)]">
          {NOTE_DATE.format(new Date(note.createdAt))}
          {edited ? ' · edited' : ''}
        </span>
        <div className="flex gap-1.5">
          {draft !== null ? (
            <>
              <Button
                size="sm"
                variant="primary"
                className="min-h-10"
                disabled={!draft.trim() || mutation.isPending}
                onClick={() =>
                  mutation.mutate(
                    { type: 'editNote', noteId: note.id, body: draft },
                    { onSuccess: () => setDraft(null) },
                  )
                }
              >
                Save note
              </Button>
              <Button size="sm" variant="ghost" className="min-h-10" onClick={() => setDraft(null)}>
                Cancel
              </Button>
            </>
          ) : confirming ? (
            <>
              <Button
                size="sm"
                variant="danger"
                className="min-h-10"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate({ type: 'deleteNote', noteId: note.id })}
              >
                Delete for good
              </Button>
              <Button size="sm" variant="ghost" className="min-h-10" onClick={() => setConfirming(false)}>
                Keep
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="ghost" className="min-h-10" onClick={() => setDraft(note.body)}>
                Edit
              </Button>
              <Button size="sm" variant="ghost" className="min-h-10" onClick={() => setConfirming(true)}>
                Delete
              </Button>
            </>
          )}
        </div>
      </div>
      {mutation.isError ? <Notice tone="danger">{errorText(mutation.error)}</Notice> : null}
    </li>
  );
}

export function NotesCard({ jobId }: { jobId: string }) {
  const query = useAnnotationsQuery(jobId);
  const mutation = useAnnotationMutation(jobId);
  const [draft, setDraft] = useState('');
  const notes = query.data?.notes ?? [];

  return (
    <PaperSheet className="space-y-3 p-4">
      <h3 className="text-sm font-medium text-[var(--wp-ink)]">Notes</h3>
      {query.isError && !query.data ? (
        <LoadFailure what="notes" error={query.error} retry={() => void query.refetch()} />
      ) : null}
      <div className="space-y-2">
        <Textarea
          aria-label="New note"
          rows={2}
          className="max-sm:!text-base"
          placeholder="Anything worth remembering about this job"
          maxLength={10000}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button
          className="min-h-11"
          disabled={!draft.trim() || mutation.isPending}
          onClick={() =>
            mutation.mutate({ type: 'addNote', body: draft }, { onSuccess: () => setDraft('') })
          }
        >
          {mutation.isPending ? 'Saving…' : 'Add note'}
        </Button>
      </div>
      {mutation.isError ? <Notice tone="danger">{errorText(mutation.error)}</Notice> : null}
      {notes.length > 0 ? (
        <ul className="space-y-2">
          {notes.map((note) => (
            <NoteItem key={note.id} jobId={jobId} note={note} />
          ))}
        </ul>
      ) : null}
    </PaperSheet>
  );
}
