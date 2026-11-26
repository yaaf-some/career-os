import { Cpu, Sparkles } from 'lucide-react';
import type { AiUsageResponse } from '@/api/types';
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
  percent,
  resetAt,
  nowMs,
}: {
  label: string;
  percent: number;
  resetAt: string;
  nowMs?: number;
}) {
  const severity = getUsageSeverity(percent);
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  const countdown = formatResetCountdown(resetAt, nowMs);

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-card/80 px-2.5 py-1.5 text-xs">
      <span className="font-medium text-muted-foreground">{label}</span>
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-secondary" aria-hidden="true">
        <div
          className={cn('h-full rounded-full transition-all', SEVERITY_BAR[severity])}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className={cn('font-semibold tabular-nums', SEVERITY_TEXT[severity])}>
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
      </div>

      <WindowMeter
        label="5h"
        percent={usage.claude5h.percentUsed}
        resetAt={usage.claude5h.resetAt}
        nowMs={nowMs}
      />

      <WindowMeter
        label="7d"
        percent={usage.claude7d.percentUsed}
        resetAt={usage.claude7d.resetAt}
        nowMs={nowMs}
      />

      <div className="flex items-center gap-2 rounded-lg border border-border bg-card/80 px-2.5 py-1.5 text-xs">
        <Sparkles className="h-3.5 w-3.5 text-accent-brand" />
        <span className="font-medium text-muted-foreground">Antigravity</span>
        <span className="font-semibold tabular-nums">{ag.callsLabel}</span>
        <span className={cn('font-medium', agToneClass)}>{ag.label}</span>
      </div>
    </div>
  );
}
