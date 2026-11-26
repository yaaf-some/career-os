import { Switch } from '@base-ui/react/switch';
import { Cpu, Kanban, KeyRound, ShieldCheck } from 'lucide-react';
import {
  useGoogleAuthMutation,
  useSettingsQuery,
  useUpdateSettingsMutation,
} from '@/api/queries';
import type { CliTierModel } from '@/api/types';
import { Badge, Button, Card, SectionHeader } from '@/components/ui';
import { cn } from '@/lib/cn';

const CLI_OPTIONS: readonly { value: CliTierModel; label: string }[] = [
  { value: 'claude', label: 'Claude Code CLI' },
  { value: 'antigravity', label: 'Antigravity CLI' },
  { value: 'codex', label: 'Codex CLI' },
  { value: 'gemini', label: 'Gemini CLI' },
];

export function SettingsView() {
  const settingsQuery = useSettingsQuery();
  const updateMutation = useUpdateSettingsMutation();
  const googleAuthMutation = useGoogleAuthMutation();

  const settings = settingsQuery.data;

  return (
    <div className="space-y-6" data-testid="settings-view">
      <SectionHeader
        title="Settings"
        subtitle="Configure hydrogen/neon CLI priority, auto-failover, Google OAuth scopes, and Linear JOB operations."
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
                  <div className="font-medium">Auto-Failover on Quota Exhaustion</div>
                  <div className="text-xs text-muted-foreground">
                    Automatically route to secondary CLI when 5h/7d limit or cooldown triggers.
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
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <KeyRound className="h-4 w-4 text-accent-brand" />
                <span>Google Workspace OAuth</span>
              </div>
              <Badge variant={settings.googleOAuthConnected ? 'success' : 'warning'}>
                {settings.googleOAuthConnected ? 'Connected' : 'Not Connected'}
              </Badge>
            </div>

            <p className="text-sm text-muted-foreground">
              Grants local-first backend scoped access for Gmail drafts, Calendar agenda/reminders,
              and Google Docs tailored resume export.
            </p>

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
                onClick={() => googleAuthMutation.mutate()}
              >
                {googleAuthMutation.isPending
                  ? 'Starting OAuth…'
                  : settings.googleOAuthConnected
                    ? 'Reconnect Google OAuth'
                    : 'Connect Google OAuth'}
              </Button>
              {googleAuthMutation.data ? (
                <a
                  href={googleAuthMutation.data.authUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-medium text-accent-brand underline"
                >
                  Open OAuth Consent Window
                </a>
              ) : null}
            </div>
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
