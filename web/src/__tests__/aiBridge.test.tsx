import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, careerApi, describeAiError, settingsFromApi, toTriageRequest } from '@/api/client';
import type { AiUsageResponse } from '@/api/types';
import { UsageBar } from '@/components/UsageBar';
import { formatAntigravityStatus, formatUsagePercent } from '@/lib/usage';
// Written by the API's `ai_usage_fixture_matches_web` test (AC8).
import apiUsage from './fixtures/ai-usage.json';
import jobFixture from './fixtures/jobs.json';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const usage = apiUsage as AiUsageResponse;
const NOW = Date.parse('2026-09-21T13:13:20Z');

describe('API usage fixture (shared with crates/api)', () => {
  it('matches the web AiUsageResponse shape', () => {
    expect(usage.configured).toBe(true);
    expect(usage.claude5h?.percentUsed).toBe(23.5);
    expect(typeof usage.claude7d?.resetAt).toBe('string');
    expect(usage.antigravity.status).toBe('cooldown');
    expect(usage.dbStatsByTier[0]).toEqual({
      tier: 'fast',
      totalCalls: 12,
      successfulCalls: 11,
      avgLatencyMs: 8400,
    });
  });

  it('renders the fixture', () => {
    render(<UsageBar usage={usage} nowMs={NOW} />);
    expect(screen.getByText('24%')).toBeTruthy(); // 23.5 rounds up
    expect(screen.getByText('resets 1h')).toBeTruthy();
    expect(screen.getByText('7/50 calls')).toBeTruthy();
    expect(screen.getByText('Cooldown 2m')).toBeTruthy();
    expect(screen.queryByTestId('usage-claude-stale')).toBeNull();
  });
});

describe('UsageBar null / stale / unconfigured states (AC9)', () => {
  const base: AiUsageResponse = {
    configured: true,
    bridgeReachable: true,
    updatedAt: null,
    claude5h: null,
    claude7d: null,
    claudeStale: true,
    antigravity: { callsUsed: 0, callsLimit: null, cooldownUntil: null, status: 'ready' },
    dbStatsByTier: [],
  };

  it('renders missing windows as dashes and marks stale', () => {
    render(<UsageBar usage={base} nowMs={NOW} />);
    expect(screen.getAllByText('—').length).toBe(2);
    expect(screen.getAllByText('resets —').length).toBe(2);
    expect(screen.getByTestId('usage-claude-stale')).toBeTruthy();
    expect(screen.getByText('0 calls today')).toBeTruthy();
  });

  it('shows a window with a null percentage without throwing', () => {
    render(
      <UsageBar
        usage={{ ...base, claude5h: { percentUsed: null, resetAt: null }, claudeStale: false }}
        nowMs={NOW}
      />,
    );
    expect(screen.getByTestId('usage-bar')).toBeTruthy();
  });

  it('shows not configured', () => {
    render(<UsageBar usage={{ ...base, configured: false }} />);
    expect(screen.getByTestId('usage-bar-unconfigured')).toBeTruthy();
    expect(screen.queryByTestId('usage-bar')).toBeNull();
  });

  it('shows bridge offline instead of stale', () => {
    render(<UsageBar usage={{ ...base, bridgeReachable: false }} nowMs={NOW} />);
    expect(screen.getByTestId('usage-bridge-offline')).toBeTruthy();
    expect(screen.queryByTestId('usage-claude-stale')).toBeNull();
  });

  it('formats null helpers', () => {
    expect(formatUsagePercent(null)).toBe('—');
    expect(
      formatAntigravityStatus(
        { callsUsed: 3, callsLimit: null, cooldownUntil: null, status: 'exhausted' },
        NOW,
      ).tone,
    ).toBe('exhausted');
  });
});

type Call = { url: string; method: string; body: unknown };

function mockFetch(handler: (url: string, init: RequestInit) => Response): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({
        url,
        method: init.method ?? 'GET',
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      });
      return handler(url, init);
    }),
  );
  return calls;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('client hits the real API routes (AC9)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_DEMO_MODE', 'false');
  });

  it('evaluate posts to /api/ai/evaluate/{id} then reads the job', async () => {
    const calls = mockFetch((url) =>
      url.startsWith('/api/ai/') ? json({ evaluation_id: 'e1' }) : json(jobFixture.detail),
    );
    await careerApi.evaluateJob('job 1');
    expect(calls[0]).toEqual({
      url: '/api/ai/evaluate/job%201',
      method: 'POST',
      body: {},
    });
    expect(calls[1]).toMatchObject({ url: '/api/jobs/job%201', method: 'GET' });
  });

  it('evaluate surfaces a disabled bridge instead of demo data', async () => {
    mockFetch(() =>
      json({ error: 'AI bridge not configured', code: 'SERVICE_UNAVAILABLE' }, 503),
    );
    await expect(careerApi.evaluateJob('j1')).rejects.toMatchObject({
      name: 'ApiError',
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
    });
  });

  it('triage maps actions to POST /api/triage/{id}', async () => {
    const calls = mockFetch((url) =>
      url.startsWith('/api/triage/')
        ? json({ job_id: 'j1', triage_status: 'blacklisted', application_id: null })
        : json(jobFixture.detail),
    );
    await careerApi.triageJob('j1', { action: 'reject' });
    expect(calls[0]).toEqual({ url: '/api/triage/j1', method: 'POST', body: { action: 'blacklist' } });
    expect(toTriageRequest({ action: 'shortlist' })).toEqual({ action: 'shortlist' });
    expect(toTriageRequest({ action: 'skip' })).toEqual({ action: 'skip' });
  });

  it('ai routing PUTs the unified mode object', async () => {
    let stored = JSON.stringify({ mode: 'auto' });
    const calls = mockFetch((url, init) => {
      if (url === '/api/settings/ai_routing') {
        stored = JSON.stringify((JSON.parse(String(init.body)) as { value: unknown }).value);
        return json({ key: 'ai_routing', value_json: stored, updated_at: 'x' });
      }
      return json({ settings: [{ key: 'ai_routing', value_json: stored, updated_at: 'x' }] });
    });
    const next = await careerApi.updateSettings({ aiRoutingMode: 'prefer_agy' });
    const put = calls.find((c) => c.method === 'PUT');
    expect(put).toEqual({
      url: '/api/settings/ai_routing',
      method: 'PUT',
      body: { value: { mode: 'prefer_agy' } },
    });
    expect(next.aiRoutingMode).toBe('prefer_agy');
  });

  it('settings fall back to auto routing default on missing, bad, or legacy values', () => {
    expect(settingsFromApi({ settings: [] }).aiRoutingMode).toBe('auto');
    const bad = settingsFromApi({
      settings: [{ key: 'ai_routing', value_json: '{"mode":"codex"}', updated_at: 'x' }],
    });
    expect(bad.aiRoutingMode).toBe('auto');
    const legacy = settingsFromApi({
      settings: [
        {
          key: 'ai_routing',
          value_json: '{"hydrogenPrimary":"agy","neonPrimary":"claude","autoFailover":true}',
          updated_at: 'x',
        },
      ],
    });
    expect(legacy.aiRoutingMode).toBe('auto');
  });
});

describe('AI error messages', () => {
  it('explains a disabled bridge and keeps other codes', () => {
    expect(
      describeAiError(new ApiError('service unavailable: AI bridge not configured (set ...)', 503, 'SERVICE_UNAVAILABLE')),
    ).toMatch(/not configured/);
    expect(describeAiError(new ApiError('rate limited: ai-bridge 429', 429, 'RATE_LIMITED'))).toBe(
      'rate limited: ai-bridge 429 (RATE_LIMITED)',
    );
    expect(describeAiError(new Error('boom'))).toBe('boom');
  });

  it('usage does not fall back to demo numbers on a server error', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'false');
    mockFetch(() => json({ error: 'db down', code: 'DATABASE_ERROR' }, 500));
    await expect(careerApi.getAiUsage()).rejects.toMatchObject({ status: 500 });
  });
});

