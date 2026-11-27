import type { AntigravityUsage } from '@/api/types';

export type UsageSeverity = 'ok' | 'warn' | 'critical';

/**
 * Clamp and format a utilization percentage (0..100).
 */
export function formatUsagePercent(percent: number | null | undefined): string {
  if (percent == null) return '—';
  if (!Number.isFinite(percent)) return '0%';
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  return `${clamped}%`;
}

/**
 * Map utilization percentage to visual severity threshold.
 */
export function getUsageSeverity(percent: number | null | undefined): UsageSeverity {
  if (percent == null || !Number.isFinite(percent)) return 'ok';
  if (percent >= 85) return 'critical';
  if (percent >= 65) return 'warn';
  return 'ok';
}

/**
 * Format an ISO reset timestamp into a compact human countdown (e.g. "2h 14m", "45m", "<1m", "Resetting").
 */
export function formatResetCountdown(resetAtIso: string | null | undefined, nowMs = Date.now()): string {
  if (!resetAtIso) return '—';
  const targetMs = Date.parse(resetAtIso);
  if (Number.isNaN(targetMs)) return '—';

  const diffMs = targetMs - nowMs;
  if (diffMs <= 0) return 'Resetting';

  const totalMinutes = Math.floor(diffMs / 60_000);
  if (totalMinutes < 1) return '<1m';

  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

export interface AntigravityStatusDisplay {
  label: string;
  callsLabel: string;
  tone: 'ready' | 'cooldown' | 'exhausted';
}

/**
 * Format Antigravity quota calls and cooldown status for the top Usage Bar.
 */
export function formatAntigravityStatus(
  usage: AntigravityUsage,
  nowMs = Date.now(),
): AntigravityStatusDisplay {
  const used = Math.max(0, usage.callsUsed);
  const limit = usage.callsLimit == null ? null : Math.max(1, usage.callsLimit);
  const callsLabel = limit == null ? `${used} calls today` : `${used}/${limit} calls`;

  if (usage.cooldownUntil) {
    const cooldownMs = Date.parse(usage.cooldownUntil);
    if (!Number.isNaN(cooldownMs) && cooldownMs > nowMs) {
      return {
        label: `Cooldown ${formatResetCountdown(usage.cooldownUntil, nowMs)}`,
        callsLabel,
        tone: 'cooldown',
      };
    }
  }

  if ((limit != null && used >= limit) || usage.status === 'exhausted') {
    return {
      label: 'Quota Exhausted',
      callsLabel,
      tone: 'exhausted',
    };
  }

  return {
    label: 'Ready',
    callsLabel,
    tone: 'ready',
  };
}
