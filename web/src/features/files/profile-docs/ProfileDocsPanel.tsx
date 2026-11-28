import { ExternalLink, FolderSync } from 'lucide-react';
import { describeGoogleError } from '@/api/client';
import {
  useGoogleAuthStatusQuery,
  useProfileStatusQuery,
  useSyncProjectDocsMutation,
} from '@/api/queries';
import { Badge, Button, PaperSheet, useToast } from '@/components/ui';

export function ProfileDocsPanel() {
  const profileStatus = useProfileStatusQuery().data;
  const googleStatus = useGoogleAuthStatusQuery().data;
  const syncDocsMutation = useSyncProjectDocsMutation();
  const { showToast } = useToast();

  return (
    <section className="space-y-2" data-testid="profile-status-card">
      <div className="flex items-center justify-between px-1 text-xs font-medium text-[var(--wp-muted)]">
        <span>Candidate profile &amp; project docs</span>
        <div className="flex items-center gap-1.5">
          <Badge variant={profileStatus?.loaded ? 'success' : 'warning'}>
            {profileStatus?.loaded ? 'Profile Loaded' : 'Fallback Summary'}
          </Badge>
          <Badge variant={profileStatus?.driveProjectsFolderConfigured ? 'success' : 'neutral'}>
            {profileStatus?.driveProjectsFolderConfigured
              ? 'Drive Folder Configured'
              : 'Drive Folder Unset'}
          </Badge>
        </div>
      </div>
      <PaperSheet className="divide-y divide-[var(--wp-hairline)] overflow-hidden">
        <div className="space-y-3 px-4 py-4">
          <p className="text-xs text-[var(--wp-muted)]">
            Profile files are read from{' '}
            <code className="font-mono-meta rounded bg-[var(--wp-raised)] px-1.5 py-0.5">
              {profileStatus?.dataDir ?? '/data'}
            </code>
            .
          </p>
          {profileStatus && profileStatus.files.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {profileStatus.files.map((f) => (
                <Badge
                  key={f.path}
                  variant={
                    f.status === 'verified'
                      ? 'success'
                      : f.status === 'draft'
                        ? 'warning'
                        : 'neutral'
                  }
                >
                  <span>{f.path}</span>
                  <span className="opacity-75">({f.status})</span>
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
        <div className="space-y-3 px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium text-[var(--wp-secondary)]">
              Synced Google Drive Project Docs ({profileStatus?.projectDocs.length ?? 0})
            </span>
            <Button
              size="sm"
              variant="secondary"
              disabled={
                !googleStatus?.connected ||
                !profileStatus?.driveProjectsFolderConfigured ||
                syncDocsMutation.isPending
              }
              onClick={() =>
                syncDocsMutation.mutate(undefined, {
                  onSuccess: (res) =>
                    showToast({
                      tone: 'success',
                      message: `Synced ${res.docsSynced} · Digested ${res.docsDigested}`,
                    }),
                })
              }
            >
              <FolderSync
                className={
                  syncDocsMutation.isPending ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'
                }
              />
              <span>{syncDocsMutation.isPending ? 'Syncing Docs…' : 'Sync Project Docs'}</span>
            </Button>
          </div>

          {profileStatus && profileStatus.projectDocs.length > 0 ? (
            <ul className="space-y-1.5 text-xs">
              {profileStatus.projectDocs.map((doc) => (
                <li
                  key={doc.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-[var(--wp-hairline)] px-3 py-2"
                >
                  <div className="min-w-0">
                    {doc.driveUrl ? (
                      <a
                        href={doc.driveUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-medium hover:text-[var(--wp-accent)]"
                      >
                        <span className="truncate">{doc.title}</span>
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                    ) : (
                      <span className="font-medium">{doc.title}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={doc.digested ? 'success' : 'neutral'}>
                      {doc.digested ? 'Digested' : 'Raw cached'}
                    </Badge>
                    {doc.modifiedTime ? (
                      <span className="font-mono-meta text-[var(--wp-muted)]">
                        {new Date(doc.modifiedTime).toLocaleDateString()}
                      </span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-[var(--wp-muted)]">
              No Google Docs synced yet. Add Docs to your Project Reports folder and click Sync
              Project Docs.
            </p>
          )}

          {syncDocsMutation.data ? (
            <p className="text-xs text-[var(--wp-good)]">
              Synced {syncDocsMutation.data.docsSynced} · Digested{' '}
              {syncDocsMutation.data.docsDigested} · Unchanged{' '}
              {syncDocsMutation.data.skippedUnchanged}
            </p>
          ) : null}
          {syncDocsMutation.isError ? (
            <p role="alert" className="text-xs text-[var(--wp-bad)]">
              {describeGoogleError(syncDocsMutation.error)}
            </p>
          ) : null}
        </div>
      </PaperSheet>
    </section>
  );
}
