import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { careerApi, isDemoModeActive, linearStatusFromApi, settingsFromApi } from '@/api/client';
import { ToastProvider } from '@/components/ui';
import { ThemeProvider } from '@/lib/theme';
import { SettingsView } from '@/routes/SettingsView';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type Call = { url: string; method: string; body: unknown };

function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>): Call[] {
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

const serverError = () => json({ error: 'boom', code: 'INTERNAL_ERROR' }, 500);

beforeEach(() => {
  vi.stubEnv('VITE_DEMO_MODE', 'false');
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('live API errors are not masked by demo data (JOB-11)', () => {
  const cases: [string, () => Promise<unknown>][] = [
    ['/api/settings', () => careerApi.getSettings()],
    ['/api/jobs/j1/commute', () => careerApi.getJobCommute('j1')],
    [
      '/api/commute/preview',
      () =>
        careerApi.previewCommute({ originArea: 'A', destination: 'B', travelMode: 'drive' }),
    ],
    ['/api/auth/google/status', () => careerApi.getGoogleAuthStatus()],
    ['/api/auth/google/url', () => careerApi.startGoogleAuth()],
    ['/api/integrations/linear', () => careerApi.getLinearStatus()],
  ];

  for (const [path, call] of cases) {
    it(`${path}: 500 rejects with ApiError`, async () => {
      mockFetch(serverError);
      await expect(call()).rejects.toMatchObject({ name: 'ApiError', status: 500 });
      expect(isDemoModeActive()).toBe(false);
    });
  }

  it('triage 404 rejects instead of faking a triaged job', async () => {
    mockFetch(() => json({ error: 'job not found', code: 'NOT_FOUND' }, 404));
    await expect(careerApi.triageJob('missing', { action: 'skip' })).rejects.toMatchObject({
      status: 404,
    });
  });

  it('a network failure is an error, never demo data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    await expect(careerApi.getLinearStatus()).rejects.toMatchObject({
      name: 'ApiError',
      code: 'NETWORK_ERROR',
    });
    expect(isDemoModeActive()).toBe(false);
  });

  it('listJobs reads every page', async () => {
    const job = (id: string) => ({
      id, title: id, company: 'Example Co', url: 'https://example.com', source_type: 'manual',
      triage_status: 'pending_triage', created_at: '2026-11-01T00:00:00Z', jd_text: null,
    });
    const calls = mockFetch((url) =>
      json({ jobs: [job(url.endsWith('offset=0') ? 'a' : 'b')], total: 2 }),
    );
    const res = await careerApi.listJobs();
    expect(res.jobs.map((j) => j.id)).toEqual(['a', 'b']);
    expect(calls.map((c) => c.url)).toEqual([
      '/api/jobs?limit=200&offset=0',
      '/api/jobs?limit=200&offset=1',
    ]);
  });
});

describe('commute settings persist through the API (JOB-11)', () => {
  it('PUTs home area and travel mode, then re-reads them', async () => {
    const stored = new Map<string, string>();
    const calls = mockFetch((url, init) => {
      if (url.startsWith('/api/settings/') && init.method === 'PUT') {
        const key = url.slice('/api/settings/'.length);
        const value = (JSON.parse(String(init.body)) as { value: unknown }).value;
        stored.set(key, JSON.stringify(value));
        return json({ key, value_json: stored.get(key), updated_at: 'x' });
      }
      return json({
        settings: [...stored].map(([key, value_json]) => ({ key, value_json, updated_at: 'x' })),
      });
    });

    const next = await careerApi.updateSettings({
      homeLocationArea: '  Pasadena, CA ',
      defaultTravelMode: 'transit',
    });

    expect(calls.filter((c) => c.method === 'PUT')).toEqual([
      { url: '/api/settings/home_location_area', method: 'PUT', body: { value: 'Pasadena, CA' } },
      { url: '/api/settings/travel_mode', method: 'PUT', body: { value: 'transit' } },
    ]);
    expect(next.homeLocationArea).toBe('Pasadena, CA');
    expect(next.defaultTravelMode).toBe('transit');
  });

  it('skips a blank home area and surfaces a 400', async () => {
    const calls = mockFetch((url) =>
      url === '/api/settings/travel_mode'
        ? json({ error: 'travel_mode must be "drive" or "transit"', code: 'BAD_REQUEST' }, 400)
        : json({ settings: [] }),
    );
    await expect(
      careerApi.updateSettings({ homeLocationArea: '   ', defaultTravelMode: 'transit' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(calls.some((c) => c.url === '/api/settings/home_location_area')).toBe(false);
  });

  it('settingsFromApi reads commute keys with safe defaults', () => {
    const s = settingsFromApi({
      settings: [
        { key: 'home_location_area', value_json: '"Culver City, CA"', updated_at: 'x' },
        { key: 'travel_mode', value_json: '"TRANSIT"', updated_at: 'x' },
      ],
    });
    expect(s.homeLocationArea).toBe('Culver City, CA');
    expect(s.defaultTravelMode).toBe('transit');
    const empty = settingsFromApi({
      settings: [{ key: 'travel_mode', value_json: '"bike"', updated_at: 'x' }],
    });
    expect(empty.homeLocationArea).toBe('');
    expect(empty.defaultTravelMode).toBe('drive');
  });
});

describe('Linear status mapping (JOB-11)', () => {
  it('maps the API shape', () => {
    expect(
      linearStatusFromApi({
        configured: true,
        team_key: 'JOB',
        issues: [
          { identifier: 'JOB-42', job_id: 'j1', company: 'Acme', title: 'SRE', updated_at: 'x' },
        ],
      }),
    ).toEqual({
      configured: true,
      teamKey: 'JOB',
      issues: [{ key: 'JOB-42', jobId: 'j1', company: 'Acme', title: 'SRE' }],
    });
  });
});

function renderSettings(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
      <ToastProvider>
        <QueryClientProvider client={client}>{ui}</QueryClientProvider>
      </ToastProvider>
    </ThemeProvider>,
  );
}

function settingsApi(overrides: Record<string, () => Response> = {}) {
  return mockFetch((url) => {
    if (overrides[url]) return overrides[url]();
    if (url === '/api/settings') return json({ settings: [] });
    if (url === '/api/integrations/linear') {
      return json({
        configured: true,
        team_key: 'JOB',
        issues: [
          { identifier: 'JOB-42', job_id: 'j1', company: 'Acme', title: 'SRE', updated_at: 'x' },
        ],
      });
    }
    if (url === '/api/auth/google/status') {
      return json({ connected: true, auth_mode: 'testing', missing_scopes: [] });
    }
    return json({ error: 'not found' }, 404);
  });
}

describe('SettingsView hardening (JOB-11)', () => {
  it('shows the Google callback result once and strips it from the URL', async () => {
    window.history.replaceState(null, '', '/settings?google=error&reason=denied');
    settingsApi();
    renderSettings(<SettingsView />);

    const notice = await screen.findByTestId('google-callback-notice');
    expect(notice.textContent).toMatch(/cancelled/i);
    await waitFor(() => expect(window.location.search).toBe(''));
    expect(window.location.pathname).toBe('/settings');
  });

  it('renders real Linear status instead of demo issues', async () => {
    settingsApi();
    renderSettings(<SettingsView />);
    const card = await screen.findByTestId('linear-card');
    await waitFor(() => expect(card.textContent).toContain('JOB-42'));
    expect(card.textContent).toContain('Acme');
    expect(screen.getByText('Configured')).toBeTruthy();
  });

  it('shows a settings error instead of a skeleton or demo data', async () => {
    settingsApi({ '/api/settings': serverError });
    renderSettings(<SettingsView />);
    const alert = await screen.findByText(/Settings could not be loaded/i);
    expect(alert).toBeTruthy();
  });
});
