import { ChevronRight, Clock, ExternalLink, FolderSync, RefreshCw, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { describeAiError, describeGoogleError } from '@/api/client';
import {
  useAiUsageQuery,
  useCommutePreviewMutation,
  useGoogleAuthMutation,
  useGoogleAuthStatusQuery,
  useProfileStatusQuery,
  useRescoreJobsMutation,
  useSettingsQuery,
  useSourcesQuery,
  useSyncProjectDocsMutation,
  useUpdateSettingsMutation,
} from '@/api/queries';
import type { AiRoutingMode } from '@/api/types';
import { CommuteBadgeDisplay } from '@/components/CommuteBadge';
import { GoogleSyncPanel } from '@/components/GoogleSyncPanel';
import {
  Badge,
  Button,
  Input,
  InsetGroup,
  Meter,
  PaperSheet,
  SegmentedControl,
  Skeleton,
  Switch,
  useToast,
} from '@/components/ui';
import { useTheme, type ThemePreference } from '@/lib/theme';
import { formatAntigravityStatus, formatUsagePercent, getUsageSeverity } from '@/lib/usage';

const THEME_OPTIONS: readonly { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

const ROUTING_OPTIONS: readonly { value: AiRoutingMode; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'prefer_claude', label: 'Claude' },
  { value: 'prefer_agy', label: 'Gemini' },
];

export function SettingsView({ onOpenSources }: { onOpenSources?: () => void }) {
  const settingsQuery = useSettingsQuery();
  const googleStatusQuery = useGoogleAuthStatusQuery();
  const profileStatusQuery = useProfileStatusQuery();
  const usageQuery = useAiUsageQuery();
  const sourcesQuery = useSourcesQuery();

  const updateMutation = useUpdateSettingsMutation();
  const googleAuthMutation = useGoogleAuthMutation();
  const commutePreviewMutation = useCommutePreviewMutation();
  const syncDocsMutation = useSyncProjectDocsMutation();
  const rescoreMutation = useRescoreJobsMutation();

  const { preference, setPreference } = useTheme();
  const { showToast } = useToast();

  const settings = settingsQuery.data;
  const googleStatus = googleStatusQuery.data;
  const profileStatus = profileStatusQuery.data;
  const usage = usageQuery.data;

  const [homeArea, setHomeArea] = useState('West Los Angeles, CA');
  const [travelMode, setTravelMode] = useState<'drive' | 'transit'>('drive');
  const [previewDestination, setPreviewDestination] = useState('Santa Monica, CA');
  const [includeSkippedRescore, setIncludeSkippedRescore] = useState(false);

  useEffect(() => {
    if (settings?.homeLocationArea) setHomeArea(settings.homeLocationArea);
    if (settings?.defaultTravelMode) setTravelMode(settings.defaultTravelMode);
  }, [settings?.homeLocationArea, settings?.defaultTravelMode]);

  const claude5hPct = usage?.claude5h?.percentUsed ?? 0;
  const claude7dPct = usage?.claude7d?.percentUsed ?? 0;
  const claude5hSeverity = getUsageSeverity(usage?.claude5h?.percentUsed);
  const agStatus = usage ? formatAntigravityStatus(usage.antigravity) : null;

  return (
    <div className="mx-auto max-w-[680px] space-y-6" data-testid="settings-view">
      <div className="pt-1">
        <h1 className="text-base font-medium text-[var(--wp-ink)]">Settings</h1>
        <p className="mt-0.5 text-xs text-[var(--wp-muted)]">
          Appearance, AI routing, profile sync, and integrations
        </p>
      </div>

      {/* 1. Appearance */}
      <InsetGroup label="Appearance">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
          <div>
            <div className="text-sm font-medium text-[var(--wp-ink)]">Theme</div>
            <div className="text-xs text-[var(--wp-muted)]">
              Warm Paper light or Warm Charcoal dark
            </div>
          </div>
          <SegmentedControl
            ariaLabel="Appearance theme"
            value={preference}
            onValueChange={(next) => {
              setPreference(next);
              showToast({ message: `Theme set to ${next}` });
            }}
            options={THEME_OPTIONS}
          />
        </div>
      </InsetGroup>

      {settingsQuery.isLoading || !settings ? (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-44 w-full" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* 2. AI Routing & Provider Health */}
          <InsetGroup label="AI routing">
            <div className="space-y-3 px-4 py-4">
              <div>
                <div className="text-sm font-medium text-[var(--wp-ink)]">Provider balance</div>
                <p className="mt-0.5 text-xs text-[var(--wp-muted)]">
                  Fast scores batches · Balanced runs A–G · matches &ge; 75 escalate to Deep.
                </p>
              </div>
              <SegmentedControl
                ariaLabel="AI routing mode"
                fullWidth
                value={settings.aiRoutingMode}
                onValueChange={(mode) =>
                  updateMutation.mutate(
                    { aiRoutingMode: mode },
                    {
                      onSuccess: () =>
                        showToast({ tone: 'success', message: `AI routing set to ${mode}` }),
                    },
                  )
                }
                options={ROUTING_OPTIONS}
              />
            </div>

            <div className="grid gap-4 px-4 py-4 sm:grid-cols-2">
              <Meter
                label="Claude 5h"
                value={claude5hPct}
                valueText={
                  usage?.configured ? formatUsagePercent(usage.claude5h?.percentUsed) : 'Unconfigured'
                }
                tone={
                  claude5hSeverity === 'critical'
                    ? 'bad'
                    : claude5hSeverity === 'warn'
                      ? 'warn'
                      : 'good'
                }
              />
              <Meter
                label="Claude 7d"
                value={claude7dPct}
                valueText={
                  usage?.configured
                    ? `${formatUsagePercent(usage.claude7d?.percentUsed)} · Gemini ${agStatus?.label ?? 'Ready'}`
                    : '—'
                }
                tone="accent"
              />
            </div>
          </InsetGroup>

          {/* 3. Candidate Profile & Project Docs */}
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
                  Mounted read-only from{' '}
                  <code className="font-mono-meta rounded bg-[var(--wp-raised)] px-1.5 py-0.5">
                    {profileStatus?.dataDir ?? '/data'}
                  </code>
                  .
                </p>

                {profileStatus?.targeting ? (
                  <div className="grid gap-3 rounded-[12px] bg-[var(--wp-raised)]/60 p-3 text-xs sm:grid-cols-3">
                    <div>
                      <div className="text-[var(--wp-muted)]">Target Roles</div>
                      <div className="mt-0.5 font-medium text-[var(--wp-ink)]">
                        {profileStatus.targeting.primaryRoles.join(', ') || 'Unspecified'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[var(--wp-muted)]">Scoring Weights</div>
                      <div className="font-mono-meta mt-0.5 font-medium text-[var(--wp-ink)]">
                        Role {profileStatus.targeting.weights.role_stack} · Lvl{' '}
                        {profileStatus.targeting.weights.level_reachability} · Vibe{' '}
                        {profileStatus.targeting.weights.vibe_culture} · Log{' '}
                        {profileStatus.targeting.weights.logistics_comp}
                      </div>
                    </div>
                    <div>
                      <div className="text-[var(--wp-muted)]">Guardrails</div>
                      <div className="mt-0.5 font-medium text-[var(--wp-ink)]">
                        Max {profileStatus.targeting.maxYoe ?? '–'} YOE ·{' '}
                        {profileStatus.targeting.dealbreakerCount} dealbreakers ·{' '}
                        {profileStatus.targeting.boostCount} boosts
                      </div>
                    </div>
                  </div>
                ) : null}

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

              <div className="space-y-2 px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                  <label className="inline-flex items-center gap-2.5 text-[var(--wp-secondary)]">
                    <Switch
                      checked={includeSkippedRescore}
                      onCheckedChange={setIncludeSkippedRescore}
                      ariaLabel="Include previously skipped jobs when rescoring"
                    />
                    <span>Include previously skipped jobs when rescoring</span>
                  </label>
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={rescoreMutation.isPending}
                    onClick={() =>
                      rescoreMutation.mutate(
                        { includeSkipped: includeSkippedRescore, scoreLimit: 10 },
                        {
                          onSuccess: (res) =>
                            showToast({
                              tone: 'success',
                              message: `Reset ${res.resetCount} · Scored ${res.scored}`,
                            }),
                        },
                      )
                    }
                  >
                    <RefreshCw
                      className={
                        rescoreMutation.isPending ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'
                      }
                    />
                    <span>
                      {rescoreMutation.isPending ? 'Rescoring…' : 'Rescore Pending Jobs'}
                    </span>
                  </Button>
                </div>
                {rescoreMutation.data ? (
                  <p className="text-xs text-[var(--wp-good)]">
                    Reset {rescoreMutation.data.resetCount} unapplied jobs · Scored{' '}
                    {rescoreMutation.data.scored} immediately (hourly scheduler finishes any
                    remainder).
                  </p>
                ) : null}
                {rescoreMutation.isError ? (
                  <p role="alert" className="text-xs text-[var(--wp-bad)]">
                    {describeAiError(rescoreMutation.error)}
                  </p>
                ) : null}
              </div>
            </PaperSheet>
          </section>

          {/* 4. Job Boards Link */}
          <InsetGroup label="Job boards">
            {onOpenSources ? (
              <button
                type="button"
                onClick={onOpenSources}
                className="tap-control flex w-full items-center justify-between px-4 py-3.5 text-left hover:bg-[var(--wp-raised)]/45"
              >
                <div>
                  <div className="text-sm font-medium text-[var(--wp-ink)]">
                    Manage ATS &amp; Reddit boards
                  </div>
                  <div className="text-xs text-[var(--wp-muted)]">
                    {sourcesQuery.data?.sources.length ?? 0} configured · profile-filtered
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-[var(--wp-muted)]" />
              </button>
            ) : (
              <a
                href="/sources"
                className="tap-control flex w-full items-center justify-between px-4 py-3.5 text-left hover:bg-[var(--wp-raised)]/45"
              >
                <div>
                  <div className="text-sm font-medium text-[var(--wp-ink)]">
                    Manage ATS &amp; Reddit boards
                  </div>
                  <div className="text-xs text-[var(--wp-muted)]">
                    {sourcesQuery.data?.sources.length ?? 0} configured · profile-filtered
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-[var(--wp-muted)]" />
              </a>
            )}
          </InsetGroup>

          {/* 5. Google Workspace OAuth */}
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

          {/* 6. LA Commute & Maps */}
          <section className="space-y-2" data-testid="la-commute-card">
            <div className="flex items-center justify-between px-1 text-xs font-medium text-[var(--wp-muted)]">
              <span>LA commute &amp; Maps</span>
              <Badge variant={settings.mapsConfigured ? 'success' : 'neutral'}>
                {settings.mapsConfigured ? 'Maps + Places Ready' : 'Configure API Key'}
              </Badge>
            </div>
            <PaperSheet className="space-y-3 p-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="space-y-1 text-xs">
                  <span className="font-medium text-[var(--wp-secondary)]">Home area</span>
                  <Input
                    type="text"
                    value={homeArea}
                    onChange={(e) => setHomeArea(e.target.value)}
                    placeholder="West Los Angeles, CA"
                  />
                </label>

                <div className="space-y-1 text-xs">
                  <span className="block font-medium text-[var(--wp-secondary)]">Travel mode</span>
                  <SegmentedControl
                    ariaLabel="Default travel mode"
                    fullWidth
                    value={travelMode}
                    onValueChange={setTravelMode}
                    options={[
                      { value: 'drive', label: 'Drive' },
                      { value: 'transit', label: 'Transit' },
                    ]}
                  />
                </div>

                <label className="space-y-1 text-xs">
                  <span className="font-medium text-[var(--wp-secondary)]">Preview</span>
                  <div className="flex gap-2">
                    <Input
                      type="text"
                      value={previewDestination}
                      onChange={(e) => setPreviewDestination(e.target.value)}
                      placeholder="Santa Monica, CA"
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
                      {commutePreviewMutation.isPending ? '…' : 'Preview'}
                    </Button>
                  </div>
                </label>
              </div>

              {commutePreviewMutation.data ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] bg-[var(--wp-raised)]/60 p-3 text-xs">
                  <CommuteBadgeDisplay commute={commutePreviewMutation.data} />
                  {commutePreviewMutation.data.resolvedAddress ? (
                    <span className="text-[var(--wp-muted)]">
                      Resolved: {commutePreviewMutation.data.resolvedAddress}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </PaperSheet>
          </section>

          {/* 7. Linear Integration */}
          <InsetGroup
            label={`Linear ${settings.linearTeamKey}`}
            trailing={settings.linearConnected ? 'Connected' : 'Offline'}
          >
            {settings.linearIssues.length === 0 ? (
              <div className="px-4 py-3 text-xs text-[var(--wp-muted)]">
                No synced Linear issues yet.
              </div>
            ) : (
              settings.linearIssues.map((issue) => (
                <div
                  key={issue.key}
                  className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-[var(--wp-ink)]">{issue.title}</div>
                    <div className="font-mono-meta text-xs text-[var(--wp-muted)]">
                      {issue.key} · Priority {issue.priority}
                    </div>
                  </div>
                  <Badge variant="neutral">{issue.state}</Badge>
                </div>
              ))
            )}
          </InsetGroup>
        </div>
      )}
    </div>
  );
}
