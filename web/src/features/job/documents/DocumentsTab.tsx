import { ExternalLink, FileText, ShieldCheck } from 'lucide-react';
import { describeTailorError } from '@/api/client';
import { useTailorJobMutation } from '@/api/queries';
import type { JobDetail } from '@/api/types';
import { Button, PaperSheet, useToast } from '@/components/ui';

export function DocumentsTab({ job }: { job: JobDetail }) {
  const tailorMutation = useTailorJobMutation();
  const { showToast } = useToast();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">Tailor Resume &amp; Cover Letter</h3>
          <p className="text-xs text-[var(--wp-muted)]">
            Strictly grounded in <code className="font-mono-meta">profile/</code> &amp;
            synced project docs.
          </p>
        </div>
        <Button
          size="sm"
          variant="primary"
          disabled={tailorMutation.isPending}
          onClick={() =>
            tailorMutation.mutate(job.id, {
              onSuccess: () =>
                showToast({
                  tone: 'success',
                  message: `Tailored Google Docs ready for ${job.company}`,
                }),
            })
          }
        >
          <FileText className="h-3.5 w-3.5" />
          <span>
            {tailorMutation.isPending
              ? 'Generating Docs…'
              : job.tailor.resumeDocUrl || job.tailor.coverLetterDocUrl
                ? 'Regenerate Docs'
                : 'Tailor to Google Docs'}
          </span>
        </Button>
      </div>

      {tailorMutation.isError ? (
        <p
          role="alert"
          className="rounded-[10px] bg-[var(--wp-bad-soft)] px-3 py-2 text-xs text-[var(--wp-bad)]"
        >
          {describeTailorError(tailorMutation.error)}
        </p>
      ) : null}

      <PaperSheet className="space-y-2 p-4">
        <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--wp-muted)]">
          <ShieldCheck className="h-4 w-4 text-[var(--wp-good)]" />
          <span>Google Docs Artifacts</span>
        </div>
        {job.tailor.resumeDocUrl || job.tailor.coverLetterDocUrl ? (
          <div className="flex flex-wrap gap-2">
            {job.tailor.resumeDocUrl ? (
              <a
                href={job.tailor.resumeDocUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-[10px] border border-[var(--wp-hairline)] bg-[var(--wp-raised)] px-3 py-1.5 text-xs font-medium hover:opacity-90"
              >
                <FileText className="h-3.5 w-3.5 text-[var(--wp-accent)]" />
                <span>Open Tailored Resume Doc</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
            {job.tailor.coverLetterDocUrl ? (
              <a
                href={job.tailor.coverLetterDocUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-[10px] border border-[var(--wp-hairline)] bg-[var(--wp-raised)] px-3 py-1.5 text-xs font-medium hover:opacity-90"
              >
                <FileText className="h-3.5 w-3.5 text-[var(--wp-good)]" />
                <span>Open Tailored Cover Letter Doc</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-[var(--wp-muted)]">
            Not yet tailored. Generate Google Docs drafts grounded in your profile &amp;
            synced project docs.
          </p>
        )}
      </PaperSheet>

      <PaperSheet className="space-y-2.5 p-4">
        <div className="text-xs font-medium text-[var(--wp-muted)]">
          Grounded Evidence
        </div>
        {job.tailor.groundedBullets.length === 0 ? (
          <p className="text-sm text-[var(--wp-muted)]">
            Tailor to map matching bullets from your profile &amp; synced project docs.
          </p>
        ) : (
          job.tailor.groundedBullets.map((b) => (
            <div
              key={b.id}
              className="rounded-[12px] border border-[var(--wp-hairline)] p-3 text-sm"
            >
              <div className="text-xs text-[var(--wp-muted)]">
                {b.sourceFile} → {b.section}
              </div>
              <p className="mt-1 font-medium text-[var(--wp-ink)]">{b.text}</p>
              <p className="mt-1 text-xs text-[var(--wp-secondary)]">
                {b.relevanceNote}
              </p>
            </div>
          ))
        )}
      </PaperSheet>
    </div>
  );
}
