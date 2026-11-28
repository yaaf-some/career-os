import { useState } from 'react';
import { useFetchDescriptionMutation, useSetDescriptionMutation } from '@/api/queries';
import { Button, PaperSheet } from '@/components/ui';

const FETCH_RESULT: Record<string, string> = {
  gone: 'The employer no longer lists this posting. You can paste the text if you still have it.',
  empty: 'The job board has no description for this posting. Paste it instead.',
  unsupported: 'Automatic fetching does not work for this site. Paste the description instead.',
  error: 'The job board did not answer. Try again in a moment, or paste the description.',
};

/** The posting text, with ways to fill it in. Mount with `key={jobId}`. */
export function DescriptionSection({ jobId, text }: { jobId: string; text: string }) {
  const fetchMutation = useFetchDescriptionMutation();
  const setMutation = useSetDescriptionMutation();
  const [pasting, setPasting] = useState(false);
  const [draft, setDraft] = useState('');

  const status = fetchMutation.data?.status;
  const failure = fetchMutation.error ?? setMutation.error;

  return (
    <PaperSheet className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-[var(--wp-muted)]">Job description</h3>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={text ? 'ghost' : 'primary'}
            disabled={fetchMutation.isPending}
            onClick={() => fetchMutation.mutate(jobId)}
          >
            {fetchMutation.isPending ? 'Fetching…' : text ? 'Fetch again' : 'Fetch description'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setDraft(text);
              setPasting((open) => !open);
            }}
          >
            {pasting ? 'Cancel' : text ? 'Edit' : 'Paste'}
          </Button>
        </div>
      </div>

      {status && status !== 'ok' ? (
        <p role="status" className="text-xs text-[var(--wp-warn)]">
          {FETCH_RESULT[status] ?? FETCH_RESULT.error}
        </p>
      ) : null}
      {failure ? (
        <p role="alert" className="text-xs text-[var(--wp-bad)]">
          {failure.message}
        </p>
      ) : null}

      {pasting ? (
        <div className="space-y-2">
          <textarea
            aria-label="Job description text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={12}
            className="w-full rounded-[10px] border border-[var(--wp-hairline)] bg-[var(--wp-surface)] p-3 text-base text-[var(--wp-ink)] sm:text-sm"
          />
          <Button
            size="sm"
            variant="primary"
            disabled={!draft.trim() || setMutation.isPending}
            onClick={() =>
              setMutation.mutate(
                { id: jobId, text: draft },
                { onSuccess: () => setPasting(false) },
              )
            }
          >
            {setMutation.isPending ? 'Saving…' : 'Save description'}
          </Button>
        </div>
      ) : (
        <p className="whitespace-pre-line text-sm leading-relaxed text-[var(--wp-secondary)]">
          {text || 'No description saved yet.'}
        </p>
      )}
    </PaperSheet>
  );
}
