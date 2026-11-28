import { PageHeader } from '@/components/ui';
import { GeneratedDocsPanel } from './generated/GeneratedDocsPanel';
import { ProfileDocsPanel } from './profile-docs/ProfileDocsPanel';

/** Everything of yours that Career OS reads or writes. */
export function FilesView() {
  return (
    <div className="mx-auto max-w-[760px] space-y-6" data-testid="files-view">
      <PageHeader title="Your files" subtitle="What Career OS reads about you and what it writes for you" />
      <ProfileDocsPanel />
      <GeneratedDocsPanel />
    </div>
  );
}
