import { RefreshCw } from 'lucide-react';
import { describeGoogleError } from '@/api/client';
import { useSyncGoogleMutation, useSyncRunsQuery } from '@/api/queries';
import { Badge, Button } from '@/components/ui';

const STATUS_VARIANT = {
  succeeded: 'success',
  partial: 'warning',
  failed: 'danger',
  running: 'neutral',
} as const;

/** Last Gmail/Calendar sync and a "Sync now" button (scheduled runs are twice daily). */
export function GoogleSyncPanel({ connected }: { connected: boolean }) {
  const runsQuery = useSyncRunsQuery();
  const syncMutation = useSyncGoogleMutation();
  const last = runsQuery.data?.find((r) => r.runType === 'gmail_sync');

  return (
    <div className="rounded-[12px] border border-[var(--wp-hairline)] bg-[var(--wp-raised)] p-3 text-xs space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[var(--wp-secondary)]">Gmail & Calendar sync (twice daily)</span>
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
          <span className="font-mono-meta text-[var(--wp-muted)]">
            {new Date(last.finishedAt ?? last.startedAt).toLocaleString()} · {last.itemsFetched}{' '}
            items
          </span>
          {last.errorMessage ? <span className="text-[var(--wp-bad)]">{last.errorMessage}</span> : null}
        </div>
      ) : (
        <div className="text-[var(--wp-muted)]">No sync yet.</div>
      )}
      {syncMutation.isError ? (
        <p role="alert" className="text-[var(--wp-bad)]">
          {describeGoogleError(syncMutation.error)}
        </p>
      ) : null}
    </div>
  );
}
