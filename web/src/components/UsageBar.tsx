import { Cpu, Sparkles } from 'lucide-react';
import type { AiUsageResponse, ClaudeUsageWindow } from '@/api/types';
import { cn } from '@/lib/cn';
import {
  formatAntigravityStatus,
  formatResetCountdown,
  formatUsagePercent,
  getUsageSeverity,
  type UsageSeverity,
} from '@/lib/usage';

const SEVERITY_TEXT: Record<UsageSeverity, string> = {
  ok: 'text-emerald-600 dark:text-emerald-400',
  warn: 'text-amber-600 dark:text-amber-400',
  critical: 'text-red-600 dark:text-red-400',
};

const SEVERITY_BAR: Record<UsageSeverity, string> = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  critical: 'bg-red-500',
};

function WindowMeter({
  label,
  window,
  nowMs,
}: {
  label: string;
  window: ClaudeUsageWindow | null;
  nowMs?: number;
}) {
  const percent = window?.percentUsed ?? null;
  const severity = getUsageSeverity(percent);
  const clamped = percent == null ? 0 : Math.max(0, Math.min(100, Math.round(percent)));
  const countdown = formatResetCountdown(window?.resetAt, nowMs);

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-card/80 px-2.5 py-1.5 text-xs">
      <span className="font-medium text-muted-foreground">{label}</span>
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-secondary" aria-hidden="true">
        <div
          className={cn('h-full rounded-full transition-all', SEVERITY_BAR[severity])}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span
        className={cn(
          'font-semibold tabular-nums',
          percent == null ? 'text-muted-foreground' : SEVERITY_TEXT[severity],
        )}
      >
        {formatUsagePercent(percent)}
      </span>
      <span className="text-[11px] text-muted-foreground tabular-nums">
        resets {countdown}
      </span>
    </div>
  );
}

export function UsageBar({
  usage,
  isLoading,
  nowMs,
}: {
  usage?: AiUsageResponse;
  isLoading?: boolean;
  nowMs?: number;
}) {
  if (isLoading && !usage) {
    return (
      <div
        className="flex items-center gap-2 text-xs text-muted-foreground"
        data-testid="usage-bar-loading"
      >
        <Cpu className="h-3.5 w-3.5 animate-pulse" />
        <span>Loading AI quota telemetry…</span>
      </div>
    );
  }

  if (!usage) {
    return null;
  }

  if (!usage.configured) {
    return (
      <div
        className="flex items-center gap-2 text-xs text-muted-foreground"
        aria-label="AI Quota Usage Bar"
        data-testid="usage-bar-unconfigured"
      >
        <Cpu className="h-3.5 w-3.5" />
        <span>AI bridge not configured</span>
      </div>
    );
  }

  const ag = formatAntigravityStatus(usage.antigravity, nowMs);
  const agToneClass =
    ag.tone === 'ready'
      ? 'text-emerald-600 dark:text-emerald-400'
      : ag.tone === 'cooldown'
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-red-600 dark:text-red-400';

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      aria-label="AI Quota Usage Bar"
      data-testid="usage-bar"
    >
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Cpu className="h-3.5 w-3.5 text-accent-brand" />
        <span>Claude</span>
        {!usage.bridgeReachable ? (
          <span className="text-red-600 dark:text-red-400" data-testid="usage-bridge-offline">
            bridge offline
          </span>
        ) : usage.claudeStale ? (
          <span
            className="text-amber-600 dark:text-amber-400"
            data-testid="usage-claude-stale"
            title={usage.updatedAt ? `Last update ${usage.updatedAt}` : 'No Claude usage data yet'}
          >
            stale
          </span>
        ) : null}
      </div>

      <WindowMeter label="5h" window={usage.claude5h} nowMs={nowMs} />
      <WindowMeter label="7d" window={usage.claude7d} nowMs={nowMs} />

      <div className="flex items-center gap-2 rounded-lg border border-border bg-card/80 px-2.5 py-1.5 text-xs">
        <Sparkles className="h-3.5 w-3.5 text-accent-brand" />
        <span className="font-medium text-muted-foreground">Antigravity</span>
        <span className="font-semibold tabular-nums">{ag.callsLabel}</span>
        <span className={cn('font-medium', agToneClass)}>{ag.label}</span>
      </div>
    </div>
  );
}
