import {
  Car,
  Clock,
  Cpu,
  ExternalLink,
  FileText,
  FolderSync,
  Kanban,
  KeyRound,
  MapPin,
  RefreshCw,
  ShieldCheck,
  Train,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { describeAiError, describeGoogleError } from '@/api/client';
import {
  useCommutePreviewMutation,
  useGoogleAuthMutation,
  useGoogleAuthStatusQuery,
  useProfileStatusQuery,
  useRescoreJobsMutation,
  useSettingsQuery,
  useSyncProjectDocsMutation,
  useUpdateSettingsMutation,
} from '@/api/queries';
import type { AiRoutingMode } from '@/api/types';
import { CommuteBadgeDisplay } from '@/components/CommuteBadge';
import { GoogleSyncPanel } from '@/components/GoogleSyncPanel';
import { Badge, Button, Card, SectionHeader } from '@/components/ui';
import { cn } from '@/lib/cn';

const ROUTING_MODE_OPTIONS: readonly { value: AiRoutingMode; label: string }[] = [
  { value: 'auto', label: 'Auto — Balance Claude & Gemini' },
  { value: 'prefer_claude', label: 'Prefer Claude' },
  { value: 'prefer_agy', label: 'Prefer Gemini (agy)' },
];

export function SettingsView() {
  const settingsQuery = useSettingsQuery();
  const googleStatusQuery = useGoogleAuthStatusQuery();
  const profileStatusQuery = useProfileStatusQuery();
  const updateMutation = useUpdateSettingsMutation();
  const googleAuthMutation = useGoogleAuthMutation();
  const commutePreviewMutation = useCommutePreviewMutation();
  const syncDocsMutation = useSyncProjectDocsMutation();
  const rescoreMutation = useRescoreJobsMutation();

  const settings = settingsQuery.data;
  const googleStatus = googleStatusQuery.data;
  const profileStatus = profileStatusQuery.data;

  const [homeArea, setHomeArea] = useState('West Los Angeles, CA');
  const [travelMode, setTravelMode] = useState<'drive' | 'transit'>('drive');
  const [previewDestination, setPreviewDestination] = useState('Santa Monica, CA');
  const [includeSkippedRescore, setIncludeSkippedRescore] = useState(false);

  useEffect(() => {
    if (settings?.homeLocationArea) setHomeArea(settings.homeLocationArea);
    if (settings?.defaultTravelMode) setTravelMode(settings.defaultTravelMode);
  }, [settings?.homeLocationArea, settings?.defaultTravelMode]);

  return (
    <div className="space-y-6" data-testid="settings-view">
      <SectionHeader
        title="Settings"
        subtitle="Configure AI routing preference, Google OAuth 7-day Testing-mode reconnect, LA Commute & Maps, and Linear JOB operations."
      />

      {settingsQuery.isLoading || !settings ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading settings…</Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {/* Unified AI Routing */}
          <Card className="p-4 space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Cpu className="h-4 w-4 text-accent-brand" />
              <span>AI Routing &amp; Capability Tiers</span>
            </div>

            <div className="space-y-3 text-sm">
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">
                  Provider Routing Preference
                </span>
                <select
                  aria-label="AI routing mode"
                  value={settings.aiRoutingMode}
                  onChange={(e) =>
                    updateMutation.mutate({
                      aiRoutingMode: e.target.value as AiRoutingMode,
                    })
                  }
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                >
                  {ROUTING_MODE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="rounded-lg border border-border p-3 text-xs text-muted-foreground space-y-1">
                <div className="font-medium text-foreground">Automatic Task Routing</div>
                <p>
                  Triage scoring &amp; project-doc digests use <strong>Fast</strong>; A–G analysis
                  uses <strong>Balanced</strong> and auto-escalates to <strong>Deep</strong> on
                  matches &ge; 75. Failover between Claude and Gemini stays active automatically.
                </p>
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

            {googleStatus?.connected && googleStatus.missingScopes.length > 0 ? (
              <p
                role="status"
                className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
              >
                Reconnect Google to grant new access:{' '}
                {googleStatus.missingScopes.map((s) => s.split('/').pop()).join(', ')} (Gmail drafts
                are saved for you to send; Career OS never sends mail).
              </p>
            ) : null}

            <GoogleSyncPanel connected={Boolean(googleStatus?.connected)} />

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

          {/* Candidate Profile & Project Docs (Read-Only) */}
          <Card className="p-4 space-y-4 lg:col-span-2" data-testid="profile-status-card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <FileText className="h-4 w-4 text-accent-brand" />
                <span>Candidate Profile & Project Docs (Read-Only)</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant={profileStatus?.loaded ? 'success' : 'warning'}>
                  {profileStatus?.loaded ? 'Profile Loaded' : 'Fallback Summary'}
                </Badge>
                <Badge
                  variant={profileStatus?.driveProjectsFolderConfigured ? 'success' : 'neutral'}
                >
                  {profileStatus?.driveProjectsFolderConfigured
                    ? 'Drive Folder Configured'
                    : 'Drive Folder Unset'}
                </Badge>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Mounted read-only from <code className="rounded bg-secondary px-1">{profileStatus?.dataDir ?? '/data'}</code>
              . Edit files in your private data repo or add Google Docs to your Project Reports Drive
              folder.
            </p>

            {profileStatus?.targeting ? (
              <div className="grid gap-2 rounded-lg border border-border bg-secondary/30 p-3 text-xs sm:grid-cols-3">
                <div>
                  <div className="text-muted-foreground">Target Roles</div>
                  <div className="mt-0.5 font-medium">
                    {profileStatus.targeting.primaryRoles.join(', ') || 'Unspecified'}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Scoring Weights</div>
                  <div className="mt-0.5 font-mono font-medium">
                    Role {profileStatus.targeting.weights.role_stack} · Lvl{' '}
                    {profileStatus.targeting.weights.level_reachability} · Vibe{' '}
                    {profileStatus.targeting.weights.vibe_culture} · Log{' '}
                    {profileStatus.targeting.weights.logistics_comp}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Guardrails</div>
                  <div className="mt-0.5 font-medium">
                    Max {profileStatus.targeting.maxYoe ?? '–'} YOE ·{' '}
                    {profileStatus.targeting.dealbreakerCount} dealbreakers ·{' '}
                    {profileStatus.targeting.boostCount} boosts
                  </div>
                </div>
              </div>
            ) : null}

            {profileStatus && profileStatus.files.length > 0 ? (
              <div className="space-y-1.5">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Local Profile Files
                </div>
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
              </div>
            ) : null}

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Synced Google Drive Project Docs ({profileStatus?.projectDocs.length ?? 0})
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={
                    !googleStatus?.connected ||
                    !profileStatus?.driveProjectsFolderConfigured ||
                    syncDocsMutation.isPending
                  }
                  onClick={() => syncDocsMutation.mutate()}
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
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
                    >
                      <div className="min-w-0">
                        {doc.driveUrl ? (
                          <a
                            href={doc.driveUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 font-medium hover:text-accent-brand"
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
                          <span className="text-muted-foreground">
                            {new Date(doc.modifiedTime).toLocaleDateString()}
                          </span>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No Google Docs synced yet. Add Docs to your Project Reports folder and click Sync
                  Project Docs.
                </p>
              )}

              {syncDocsMutation.data ? (
                <p className="text-xs text-emerald-700 dark:text-emerald-400">
                  Synced {syncDocsMutation.data.docsSynced} · Digested{' '}
                  {syncDocsMutation.data.docsDigested} · Unchanged{' '}
                  {syncDocsMutation.data.skippedUnchanged}
                </p>
              ) : null}
              {syncDocsMutation.isError ? (
                <p role="alert" className="text-xs text-destructive">
                  {describeGoogleError(syncDocsMutation.error)}
                </p>
              ) : null}
            </div>

            {profileStatus && profileStatus.warnings.length > 0 ? (
              <ul className="list-disc space-y-0.5 pl-4 text-xs text-amber-700 dark:text-amber-300">
                {profileStatus.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3 text-xs">
              <label className="inline-flex items-center gap-2 text-muted-foreground">
                <input
                  type="checkbox"
                  checked={includeSkippedRescore}
                  onChange={(e) => setIncludeSkippedRescore(e.target.checked)}
                />
                <span>Include previously skipped jobs when rescoring</span>
              </label>
              <Button
                size="sm"
                variant="primary"
                disabled={rescoreMutation.isPending}
                onClick={() =>
                  rescoreMutation.mutate({
                    includeSkipped: includeSkippedRescore,
                    scoreLimit: 10,
                  })
                }
              >
                <RefreshCw
                  className={rescoreMutation.isPending ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'}
                />
                <span>
                  {rescoreMutation.isPending ? 'Rescoring…' : 'Rescore Pending Jobs'}
                </span>
              </Button>
            </div>
            {rescoreMutation.data ? (
              <p className="text-xs text-emerald-700 dark:text-emerald-400">
                Reset {rescoreMutation.data.resetCount} unapplied jobs · Scored{' '}
                {rescoreMutation.data.scored} immediately (hourly scheduler finishes any remainder).
              </p>
            ) : null}
            {rescoreMutation.isError ? (
              <p role="alert" className="text-xs text-destructive">
                {describeAiError(rescoreMutation.error)}
              </p>
            ) : null}
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
