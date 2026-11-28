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
  ok: 'text-[var(--wp-good)]',
  warn: 'text-[var(--wp-warn)]',
  critical: 'text-[var(--wp-bad)]',
};

const SEVERITY_BAR: Record<UsageSeverity, string> = {
  ok: 'bg-[var(--wp-good)]',
  warn: 'bg-[var(--wp-warn)]',
  critical: 'bg-[var(--wp-bad)]',
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
    <div className="paper-sheet flex items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-xs">
      <span className="font-medium text-[var(--wp-muted)]">{label}</span>
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-[var(--wp-raised)]" aria-hidden="true">
        <div
          className={cn('h-full rounded-full transition-all', SEVERITY_BAR[severity])}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span
        className={cn(
          'font-mono-meta font-semibold',
          percent == null ? 'text-[var(--wp-muted)]' : SEVERITY_TEXT[severity],
        )}
      >
        {formatUsagePercent(percent)}
      </span>
      <span className="font-mono-meta text-[11px] text-[var(--wp-muted)]">
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
        className="flex items-center gap-2 text-xs text-[var(--wp-muted)]"
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
        className="flex items-center gap-2 text-xs text-[var(--wp-muted)]"
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
      ? 'text-[var(--wp-good)]'
      : ag.tone === 'cooldown'
        ? 'text-[var(--wp-warn)]'
        : 'text-[var(--wp-bad)]';

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      aria-label="AI Quota Usage Bar"
      data-testid="usage-bar"
    >
      <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--wp-muted)]">
        <Cpu className="h-3.5 w-3.5 text-[var(--wp-accent)]" />
        <span>Claude</span>
        {!usage.bridgeReachable ? (
          <span className="text-[var(--wp-bad)]" data-testid="usage-bridge-offline">
            bridge offline
          </span>
        ) : usage.claudeStale ? (
          <span
            className="text-[var(--wp-warn)]"
            data-testid="usage-claude-stale"
            title={usage.updatedAt ? `Last update ${usage.updatedAt}` : 'No Claude usage data yet'}
          >
            stale
          </span>
        ) : null}
      </div>

      <WindowMeter label="5h" window={usage.claude5h} nowMs={nowMs} />
      <WindowMeter label="7d" window={usage.claude7d} nowMs={nowMs} />

      <div className="paper-sheet flex items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-xs">
        <Sparkles className="h-3.5 w-3.5 text-[var(--wp-accent)]" />
        <span className="font-medium text-[var(--wp-muted)]">Antigravity</span>
        <span className="font-mono-meta font-semibold">{ag.callsLabel}</span>
        <span className={cn('font-medium', agToneClass)}>{ag.label}</span>
      </div>
    </div>
  );
}
