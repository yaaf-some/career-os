import { Link } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import type { AiUsageResponse, GoogleAuthStatusResponse } from '@/api/types';
import { PopoverContent, PopoverRoot, PopoverTrigger, Separator } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatAntigravityStatus, formatResetCountdown, formatUsagePercent } from '@/lib/usage';

export function StatusFooter({
  demoActive,
  usage,
  googleStatus,
}: {
  demoActive: boolean;
  usage?: AiUsageResponse;
  googleStatus?: GoogleAuthStatusResponse;
}) {
  const bridgeHealthy = !usage || !usage.configured || usage.bridgeReachable;
  const googleHealthy = !googleStatus || (googleStatus.connected && !googleStatus.needsReconnect);
  const dotTone = demoActive
    ? 'bg-[var(--wp-warn)]'
    : bridgeHealthy && googleHealthy
      ? 'bg-[var(--wp-good)]'
      : 'bg-[var(--wp-warn)]';

  const agStatus = usage ? formatAntigravityStatus(usage.antigravity) : null;

  return (
    <PopoverRoot>
      <PopoverTrigger
        type="button"
        data-testid="status-footer-trigger"
        className="tap-control flex w-full items-center justify-between rounded-[10px] px-2.5 py-2 text-left text-xs text-[var(--wp-muted)] hover:bg-[var(--wp-surface)] hover:text-[var(--wp-ink)] focus-visible:outline-2 focus-visible:outline-[var(--wp-accent)]"
      >
        <span className="flex items-center gap-2">
          <span className={cn('h-2 w-2 rounded-full', dotTone)} aria-hidden="true" />
          <span>{demoActive ? 'Demo Mode' : bridgeHealthy ? 'Auto AI · Live' : 'Bridge Offline'}</span>
        </span>
        <ChevronRight className="h-3.5 w-3.5 opacity-60" />
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="font-medium text-[var(--wp-ink)]">System Status</span>
          <span className="font-mono-meta text-[11px] text-[var(--wp-muted)]">
            {demoActive ? 'Demo' : 'Live'}
          </span>
        </div>

        <Separator />

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[var(--wp-secondary)]">Claude (5h / 7d)</span>
            <span className="font-mono-meta text-[var(--wp-ink)]">
              {usage?.configured
                ? `${formatUsagePercent(usage.claude5h?.percentUsed)} / ${formatUsagePercent(usage.claude7d?.percentUsed)}`
                : 'Unconfigured'}
            </span>
          </div>
          {usage?.claude5h?.resetAt ? (
            <div className="flex items-center justify-between text-[11px] text-[var(--wp-muted)]">
              <span>5h resets</span>
              <span className="font-mono-meta">{formatResetCountdown(usage.claude5h.resetAt)}</span>
            </div>
          ) : null}
          <div className="flex items-center justify-between">
            <span className="text-[var(--wp-secondary)]">Gemini (agy)</span>
            <span className="font-mono-meta text-[var(--wp-ink)]">
              {agStatus ? `${agStatus.label} · ${agStatus.callsLabel}` : 'Checking…'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[var(--wp-secondary)]">Google Workspace</span>
            <span className="font-mono-meta text-[var(--wp-ink)]">
              {googleStatus
                ? googleStatus.connected
                  ? googleStatus.needsReconnect
                    ? 'Reconnect soon'
                    : 'Connected'
                  : 'Disconnected'
                : 'Checking…'}
            </span>
          </div>
        </div>

        <Separator />

        <Link
          to="/settings"
          className="inline-flex items-center gap-1 font-medium text-[var(--wp-accent)] hover:underline"
        >
          <span>Open Settings</span>
          <ChevronRight className="h-3 w-3" />
        </Link>
      </PopoverContent>
    </PopoverRoot>
  );
}
