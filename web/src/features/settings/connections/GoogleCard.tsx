import { Clock, ExternalLink, ShieldCheck } from 'lucide-react';
import { useGoogleAuthMutation, useGoogleAuthStatusQuery } from '@/api/queries';
import type { SettingsState } from '@/api/types';
import { GoogleSyncPanel } from '@/components/GoogleSyncPanel';
import { Badge, Button, InsetGroup } from '@/components/ui';

export function GoogleCard({ settings }: { settings: SettingsState }) {
  const googleStatusQuery = useGoogleAuthStatusQuery();
  const googleAuthMutation = useGoogleAuthMutation();
  const googleStatus = googleStatusQuery.data;

  return (
    <InsetGroup
      label="Google Workspace OAuth"
      trailing={
        googleStatus?.connected
          ? googleStatus.needsReconnect
            ? 'Reconnect soon'
            : 'Connected'
          : 'Not connected'
      }
    >
      <div className="space-y-3 px-4 py-4">
        <p className="text-xs text-[var(--wp-muted)]">
          Kept in GCP Testing mode for privacy — weekly sign-in powers Gmail drafts, Calendar
          reminders, and Google Docs export.
        </p>

        {googleStatus ? (
          <div className="flex items-center justify-between rounded-[10px] bg-[var(--wp-raised)]/60 px-3 py-2 text-xs">
            <span className="inline-flex items-center gap-1.5 text-[var(--wp-secondary)]">
              <Clock className="h-3.5 w-3.5" />
              <span>7-day window remaining</span>
            </span>
            <span className="font-mono-meta font-medium text-[var(--wp-ink)]">
              {googleStatus.hoursRemaining !== null
                ? `${googleStatus.hoursRemaining.toFixed(1)}h`
                : 'Not connected'}
            </span>
          </div>
        ) : null}

        {googleStatus?.connected && googleStatus.missingScopes.length > 0 ? (
          <p
            role="status"
            className="rounded-[10px] bg-[var(--wp-warn-soft)] px-3 py-2 text-xs text-[var(--wp-warn)]"
          >
            Reconnect Google to grant new access:{' '}
            {googleStatus.missingScopes.map((s) => s.split('/').pop()).join(', ')}.
          </p>
        ) : null}

        <GoogleSyncPanel connected={Boolean(googleStatus?.connected)} />

        <div className="flex flex-wrap gap-1.5">
          {settings.googleScopes.map((scope) => (
            <Badge key={scope} variant="neutral">
              <ShieldCheck className="h-3 w-3 text-[var(--wp-good)]" />
              <span>{scope}</span>
            </Badge>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            disabled={googleAuthMutation.isPending}
            onClick={() =>
              googleAuthMutation.mutate(undefined, {
                onSuccess: (res) => {
                  if (res.authUrl && typeof window !== 'undefined') {
                    window.open(res.authUrl, '_blank', 'noopener,noreferrer');
                  }
                },
              })
            }
          >
            {googleAuthMutation.isPending
              ? 'Starting OAuth…'
              : googleStatus?.connected
                ? 'Reconnect Google OAuth'
                : 'Connect Google OAuth'}
          </Button>
          {googleAuthMutation.data ? (
            <a
              href={googleAuthMutation.data.authUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-[var(--wp-accent)] underline"
            >
              <span>Open OAuth Consent Window</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : null}
        </div>
      </div>
    </InsetGroup>
  );
}
