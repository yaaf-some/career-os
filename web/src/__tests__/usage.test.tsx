import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { UsageBar } from '@/components/UsageBar';
import {
  formatAntigravityStatus,
  formatResetCountdown,
  formatUsagePercent,
  getUsageSeverity,
} from '@/lib/usage';

afterEach(() => {
  cleanup();
});

describe('Usage Bar formatting helpers', () => {
  it('formats and clamps utilization percentages', () => {
    expect(formatUsagePercent(42.6)).toBe('43%');
    expect(formatUsagePercent(-5)).toBe('0%');
    expect(formatUsagePercent(120)).toBe('100%');
    expect(formatUsagePercent(Number.NaN)).toBe('0%');
  });

  it('classifies usage severity thresholds', () => {
    expect(getUsageSeverity(30)).toBe('ok');
    expect(getUsageSeverity(65)).toBe('warn');
    expect(getUsageSeverity(85)).toBe('critical');
  });

  it('formats reset countdown across days, hours, minutes, and expired', () => {
    const base = Date.parse('2026-11-26T12:00:00Z');
    expect(formatResetCountdown('2026-11-26T14:15:00Z', base)).toBe('2h 15m');
    expect(formatResetCountdown('2026-11-26T12:45:00Z', base)).toBe('45m');
    expect(formatResetCountdown('2026-11-26T12:00:30Z', base)).toBe('<1m');
    expect(formatResetCountdown('2026-11-28T15:00:00Z', base)).toBe('2d 3h');
    expect(formatResetCountdown('2026-11-26T11:59:00Z', base)).toBe('Resetting');
  });

  it('formats Antigravity ready, cooldown, and exhausted states', () => {
    const now = Date.parse('2026-11-26T12:00:00Z');
    expect(
      formatAntigravityStatus(
        { callsUsed: 12, callsLimit: 40, cooldownUntil: null, status: 'ready' },
        now,
      ),
    ).toEqual({
      callsLabel: '12/40 calls',
      label: 'Ready',
      tone: 'ready',
    });

    expect(
      formatAntigravityStatus(
        {
          callsUsed: 20,
          callsLimit: 40,
          cooldownUntil: '2026-11-26T12:25:00Z',
          status: 'cooldown',
        },
        now,
      ),
    ).toEqual({
      callsLabel: '20/40 calls',
      label: 'Cooldown 25m',
      tone: 'cooldown',
    });

    expect(
      formatAntigravityStatus(
        { callsUsed: 40, callsLimit: 40, cooldownUntil: null, status: 'exhausted' },
        now,
      ),
    ).toEqual({
      callsLabel: '40/40 calls',
      label: 'Quota Exhausted',
      tone: 'exhausted',
    });
  });
});

describe('UsageBar component', () => {
  it('renders Claude 5h/7d percentages, countdowns, and Antigravity status', () => {
    const now = Date.parse('2026-11-26T12:00:00Z');
    render(
      <UsageBar
        nowMs={now}
        usage={{
          claude5h: { percentUsed: 42, resetAt: '2026-11-26T14:15:00Z' },
          claude7d: { percentUsed: 88, resetAt: '2026-11-28T12:00:00Z' },
          antigravity: {
            callsUsed: 14,
            callsLimit: 40,
            cooldownUntil: null,
            status: 'ready',
          },
          updatedAt: '2026-11-26T12:00:00Z',
          configured: true,
          bridgeReachable: true,
          claudeStale: false,
          dbStatsByTier: [],
        }}
      />,
    );

    expect(screen.getByTestId('usage-bar')).toBeTruthy();
    expect(screen.getByText('42%')).toBeTruthy();
    expect(screen.getByText('resets 2h 15m')).toBeTruthy();
    expect(screen.getByText('88%')).toBeTruthy();
    expect(screen.getByText('resets 2d')).toBeTruthy();
    expect(screen.getByText('14/40 calls')).toBeTruthy();
    expect(screen.getByText('Ready')).toBeTruthy();
  });
});
