import { Switch } from '@base-ui/react/switch';
import { Car, Clock, Cpu, ExternalLink, Kanban, KeyRound, MapPin, ShieldCheck, Train } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  useCommutePreviewMutation,
  useGoogleAuthMutation,
  useGoogleAuthStatusQuery,
  useSettingsQuery,
  useUpdateSettingsMutation,
} from '@/api/queries';
import type { CliTierModel } from '@/api/types';
import { CommuteBadgeDisplay } from '@/components/CommuteBadge';
import { Badge, Button, Card, SectionHeader } from '@/components/ui';
import { cn } from '@/lib/cn';

const CLI_OPTIONS: readonly { value: CliTierModel; label: string }[] = [
  { value: 'claude', label: 'Claude Code' },
  { value: 'agy', label: 'Antigravity' },
];

export function SettingsView() {
  const settingsQuery = useSettingsQuery();
  const googleStatusQuery = useGoogleAuthStatusQuery();
  const updateMutation = useUpdateSettingsMutation();
  const googleAuthMutation = useGoogleAuthMutation();
  const commutePreviewMutation = useCommutePreviewMutation();

  const settings = settingsQuery.data;
  const googleStatus = googleStatusQuery.data;

  const [homeArea, setHomeArea] = useState('West Los Angeles, CA');
  const [travelMode, setTravelMode] = useState<'drive' | 'transit'>('drive');
  const [previewDestination, setPreviewDestination] = useState('Santa Monica, CA');

  useEffect(() => {
    if (settings?.homeLocationArea) setHomeArea(settings.homeLocationArea);
    if (settings?.defaultTravelMode) setTravelMode(settings.defaultTravelMode);
  }, [settings?.homeLocationArea, settings?.defaultTravelMode]);

  return (
    <div className="space-y-6" data-testid="settings-view">
      <SectionHeader
        title="Settings"
        subtitle="Configure hydrogen/neon CLI priority, Google OAuth 7-day Testing-mode reconnect, LA Commute & Maps, and Linear JOB operations."
      />

      {settingsQuery.isLoading || !settings ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading settings…</Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {/* CLI Routing & Failover */}
          <Card className="p-4 space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Cpu className="h-4 w-4 text-accent-brand" />
              <span>Model Tier Routing (hydrogen & neon)</span>
            </div>

            <div className="space-y-3 text-sm">
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">
                  hydrogen (Fast Triage) Primary CLI
                </span>
                <select
                  value={settings.hydrogenPrimaryCli}
                  onChange={(e) =>
                    updateMutation.mutate({
                      hydrogenPrimaryCli: e.target.value as CliTierModel,
                    })
                  }
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                >
                  {CLI_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">
                  neon (Deep Eval A–G & Tailoring) Primary CLI
                </span>
                <select
                  value={settings.neonPrimaryCli}
                  onChange={(e) =>
                    updateMutation.mutate({
                      neonPrimaryCli: e.target.value as CliTierModel,
                    })
                  }
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                >
                  {CLI_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <div>
                  <div className="font-medium">Auto-Failover</div>
                  <div className="text-xs text-muted-foreground">
                    Retry on the other CLI when the primary is rate-limited, times out, is
                    missing, or tries to use a tool.
                  </div>
                </div>
                <Switch.Root
                  checked={settings.autoFailover}
                  onCheckedChange={(checked) =>
                    updateMutation.mutate({ autoFailover: checked })
                  }
                  aria-label="Toggle auto-failover"
                  className={cn(
                    'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-border transition-colors',
                    settings.autoFailover ? 'bg-accent-brand' : 'bg-secondary',
                  )}
                >
                  <Switch.Thumb
                    className={cn(
                      'inline-block h-4 w-4 rounded-full bg-white shadow-xs transition-transform',
                      settings.autoFailover ? 'translate-x-5' : 'translate-x-1',
                    )}
                  />
                </Switch.Root>
              </div>
            </div>
          </Card>

          {/* Google OAuth Integration */}
          <Card className="p-4 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <KeyRound className="h-4 w-4 text-accent-brand" />
                <span>Google Workspace OAuth</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Badge variant="neutral">
                  {googleStatus?.authMode === 'testing' ? 'Testing (7d)' : googleStatus?.authMode ?? 'Testing (7d)'}
                </Badge>
                <Badge
                  variant={
                    googleStatus?.connected
                      ? googleStatus.needsReconnect
                        ? 'warning'
                        : 'success'
                      : 'danger'
                  }
                >
                  {googleStatus?.connected
                    ? googleStatus.needsReconnect
                      ? 'Reconnect Soon'
                      : 'Connected'
                    : 'Not Connected'}
                </Badge>
              </div>
            </div>

            <p className="text-sm text-muted-foreground">
              Kept intentionally in GCP Testing mode for local self-hosted privacy — re-sign-in is
              required once every 7 days for Gmail drafts, Calendar agenda/reminders, and Google Docs
              export.
            </p>

            {googleStatus ? (
              <div className="rounded-lg border border-border bg-secondary/40 p-3 text-xs space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" />
                    7-day window remaining
                  </span>
                  <span className="font-mono font-semibold text-foreground">
                    {googleStatus.hoursRemaining !== null
                      ? `${googleStatus.hoursRemaining.toFixed(1)}h`
                      : 'Not connected'}
                  </span>
                </div>
                {googleStatus.testingExpiresAt ? (
                  <div className="text-muted-foreground">
                    Expires: {new Date(googleStatus.testingExpiresAt).toLocaleString()}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-1.5">
              {settings.googleScopes.map((scope) => (
                <Badge key={scope} variant="neutral">
                  <ShieldCheck className="h-3 w-3 text-emerald-500" />
                  <span>{scope}</span>
                </Badge>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
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
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-accent-brand underline"
                >
                  <span>Open OAuth Consent Window</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : null}
            </div>
          </Card>

          {/* LA Commute & Google Maps/Places */}
          <Card className="p-4 space-y-4 lg:col-span-2" data-testid="la-commute-card">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <MapPin className="h-4 w-4 text-accent-brand" />
                <span>LA Commute & Maps Distance (Maps + Places API)</span>
              </div>
              <Badge variant={settings.mapsConfigured ? 'success' : 'neutral'}>
                {settings.mapsConfigured ? 'Maps + Places Ready' : 'Configure API Key'}
              </Badge>
            </div>

            <p className="text-sm text-muted-foreground">
              Estimates travel time and mileage from your Los Angeles neighborhood (neighborhood/city
              only — never store a street address) to hybrid or on-site roles. Remote roles bypass
              lookup automatically.
            </p>

            <div className="grid gap-3 md:grid-cols-3">
              <label className="space-y-1 text-xs">
                <span className="font-medium text-muted-foreground">Home Area (Neighborhood)</span>
                <input
                  type="text"
                  value={homeArea}
                  onChange={(e) => setHomeArea(e.target.value)}
                  placeholder="West Los Angeles, CA"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                />
              </label>

              <div className="space-y-1 text-xs">
                <span className="font-medium text-muted-foreground">Default Travel Mode</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setTravelMode('drive')}
                    className={cn(
                      'inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium',
                      travelMode === 'drive'
                        ? 'border-accent-brand bg-accent-brand/10 text-foreground'
                        : 'border-border text-muted-foreground hover:bg-accent/60',
                    )}
                  >
                    <Car className="h-4 w-4" />
                    <span>Drive</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTravelMode('transit')}
                    className={cn(
                      'inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium',
                      travelMode === 'transit'
                        ? 'border-accent-brand bg-accent-brand/10 text-foreground'
                        : 'border-border text-muted-foreground hover:bg-accent/60',
                    )}
                  >
                    <Train className="h-4 w-4" />
                    <span>Transit</span>
                  </button>
                </div>
              </div>

              <label className="space-y-1 text-xs">
                <span className="font-medium text-muted-foreground">Preview Destination</span>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={previewDestination}
                    onChange={(e) => setPreviewDestination(e.target.value)}
                    placeholder="Santa Monica, CA"
                    className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                  <Button
                    variant="secondary"
                    disabled={commutePreviewMutation.isPending || !previewDestination.trim()}
                    onClick={() => {
                      updateMutation.mutate({
                        homeLocationArea: homeArea,
                        defaultTravelMode: travelMode,
                      });
                      commutePreviewMutation.mutate({
                        originArea: homeArea,
                        destination: previewDestination,
                        travelMode,
                      });
                    }}
                  >
                    {commutePreviewMutation.isPending ? 'Checking…' : 'Preview'}
                  </Button>
                </div>
              </label>
            </div>

            {commutePreviewMutation.data ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-secondary/40 p-3 text-xs">
                <CommuteBadgeDisplay commute={commutePreviewMutation.data} />
                {commutePreviewMutation.data.resolvedAddress ? (
                  <span className="text-muted-foreground">
                    Resolved: {commutePreviewMutation.data.resolvedAddress}
                  </span>
                ) : null}
              </div>
            ) : null}
          </Card>

          {/* Linear JOB Ops Widget */}
          <Card className="p-4 space-y-3 lg:col-span-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Kanban className="h-4 w-4 text-accent-brand" />
                <span>Linear {settings.linearTeamKey} Ops</span>
              </div>
              <Badge variant={settings.linearConnected ? 'success' : 'neutral'}>
                {settings.linearConnected ? `Team ${settings.linearTeamKey} Synced` : 'Offline'}
              </Badge>
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              {settings.linearIssues.map((issue) => (
                <div key={issue.key} className="rounded-lg border border-border p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-accent-brand">
                      {issue.key}
                    </span>
                    <Badge variant="neutral">{issue.state}</Badge>
                  </div>
                  <div className="mt-1.5 font-medium">{issue.title}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Priority: {issue.priority}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
