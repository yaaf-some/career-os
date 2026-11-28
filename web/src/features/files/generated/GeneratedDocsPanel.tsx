import { ExternalLink } from 'lucide-react';
import { InsetGroup } from '@/components/ui';

/** Resumes and cover letters Career OS has created. */
export function GeneratedDocsPanel() {
  return (
    <InsetGroup label="Resumes and cover letters">
      <div className="space-y-2 px-4 py-4 text-sm text-[var(--wp-secondary)]">
        <p>Each job lists its own documents on its Documents tab.</p>
        <a
          href="https://drive.google.com/drive/recent"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 font-medium text-[var(--wp-accent)]"
        >
          <span>Open Google Drive</span>
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
    </InsetGroup>
  );
}
