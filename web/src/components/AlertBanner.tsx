import { AlertCircle, KeyRound, RefreshCw } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import type { AiUsageResponse, GoogleAuthStatusResponse } from '@/api/types';
import { Button } from '@/components/ui';

export function AlertBanner({
  googleStatus,
  usage,
  isReconnecting = false,
  onReconnect,
}: {
  googleStatus?: GoogleAuthStatusResponse;
  usage?: AiUsageResponse;
  isReconnecting?: boolean;
  onReconnect?: () => void;
}) {
  const googleMissingScopes = Boolean(
    googleStatus?.connected && googleStatus.missingScopes.length > 0,
  );
  const googleNeedsAttention = Boolean(
    googleStatus && (!googleStatus.connected || googleStatus.needsReconnect || googleMissingScopes),
  );
  const bridgeOffline = Boolean(usage && usage.configured && !usage.bridgeReachable);

  if (!googleNeedsAttention && !bridgeOffline) {
    return null;
  }

  return (
    <div
      className="border-b border-[var(--wp-hairline)] bg-[var(--wp-warn-soft)] px-4 py-2.5 text-xs text-[var(--wp-ink)]"
      role="status"
      data-testid="action-alert-banner"
    >
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          {googleNeedsAttention && googleStatus ? (
            <div className="flex items-center gap-2">
              <KeyRound className="h-3.5 w-3.5 shrink-0 text-[var(--wp-warn)]" />
              <span>
                {!googleStatus.connected
                  ? 'Google Workspace is disconnected — sign in for Gmail drafts & Calendar.'
                  : googleMissingScopes
                    ? 'Google permissions changed — reconnect to refresh Gmail & Calendar access.'
                    : `Google Testing session expires soon (${Math.max(1, Math.round(googleStatus.hoursRemaining ?? 0))}h left).`}
              </span>
            </div>
          ) : null}

          {bridgeOffline ? (
            <div className="flex items-center gap-2" data-testid="alert-bridge-offline">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 text-[var(--wp-bad)]" />
              <span>Host AI bridge is unreachable — check launchd service on Mac mini.</span>
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {googleNeedsAttention && onReconnect ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={isReconnecting}
              onClick={onReconnect}
            >
              <RefreshCw className={isReconnecting ? 'h-3 w-3 animate-spin' : 'h-3 w-3'} />
              <span>{isReconnecting ? 'Opening…' : googleStatus?.connected ? 'Reconnect' : 'Sign in'}</span>
            </Button>
          ) : null}
          <Link
            to="/settings"
            className="text-xs font-medium text-[var(--wp-accent)] hover:underline"
          >
            Settings
          </Link>
        </div>
      </div>
    </div>
  );
}
