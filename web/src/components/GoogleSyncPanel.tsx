import { RefreshCw } from 'lucide-react';
import { ApiError } from '@/api/client';
import { useSyncGoogleMutation, useSyncRunsQuery } from '@/api/queries';
import { Badge, Button } from '@/components/ui';

const STATUS_VARIANT = {
  succeeded: 'success',
  partial: 'warning',
  failed: 'danger',
  running: 'neutral',
} as const;

function syncErrorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'GOOGLE_NOT_CONNECTED') return 'Connect Google first.';
    if (err.code === 'SYNC_IN_PROGRESS') return 'A sync is already running.';
    return err.message;
  }
  return err instanceof Error ? err.message : 'Sync failed';
}

/** Last Gmail/Calendar sync and a "Sync now" button (scheduled runs are twice daily). */
export function GoogleSyncPanel({ connected }: { connected: boolean }) {
  const runsQuery = useSyncRunsQuery();
  const syncMutation = useSyncGoogleMutation();
  const last = runsQuery.data?.find((r) => r.runType === 'gmail_sync');

  return (
    <div className="rounded-lg border border-border bg-secondary/40 p-3 text-xs space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">Gmail & Calendar sync (twice daily)</span>
        <Button
          size="sm"
          variant="secondary"
          disabled={!connected || syncMutation.isPending}
          onClick={() => syncMutation.mutate()}
        >
          <RefreshCw className={syncMutation.isPending ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
          <span>{syncMutation.isPending ? 'Syncing…' : 'Sync now'}</span>
        </Button>
      </div>
      {last ? (
        <div className="flex flex-wrap items-center gap-2" data-testid="last-sync">
          <Badge variant={STATUS_VARIANT[last.status]}>{last.status}</Badge>
          <span className="text-muted-foreground">
            {new Date(last.finishedAt ?? last.startedAt).toLocaleString()} · {last.itemsFetched}{' '}
            items
          </span>
          {last.errorMessage ? <span className="text-destructive">{last.errorMessage}</span> : null}
        </div>
      ) : (
        <div className="text-muted-foreground">No sync yet.</div>
      )}
      {syncMutation.isError ? (
        <p role="alert" className="text-destructive">
          {syncErrorText(syncMutation.error)}
        </p>
      ) : null}
    </div>
  );
}
