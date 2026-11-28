import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsView } from '@/routes/SettingsView';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('SettingsView Candidate Profile & Project Docs panel', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_DEMO_MODE', 'false');
  });

  it('shows read-only profile files, synced Drive docs, and invokes sync-docs and rescore', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const key = `${init?.method ?? 'GET'} ${url}`;
        calls.push(key);
        if (url === '/api/settings') return json({ settings: [] });
        if (url === '/api/sync-runs') return json({ runs: [] });
        if (url === '/api/auth/google/status') {
          return json({
            connected: true,
            auth_mode: 'testing',
            account_email: 'you@example.com',
            hours_remaining: 120,
            needs_reconnect: false,
            oauth_configured: true,
            encryption_configured: true,
            missing_scopes: [],
          });
        }
        if (url === '/api/profile/status') {
          return json({
            loaded: true,
            dataDir: '/data',
            driveProjectsFolderConfigured: true,
            files: [
              {
                name: 'targeting',
                path: 'profile/targeting.yml',
                status: 'verified',
                updatedAt: '2026-11-28',
                useIn: ['scanner', 'hydrogen'],
              },
            ],
            targeting: {
              primaryRoles: ['Platform Engineer', 'DevOps Engineer'],
              secondaryRoles: ['SRE'],
              levelLabel: 'Junior-Mid',
              maxYoe: 4,
              weights: {
                role_stack: 35,
                level_reachability: 25,
                vibe_culture: 25,
                logistics_comp: 15,
              },
              dealbreakerCount: 4,
              boostCount: 5,
            },
            projectDocs: [
              {
                id: 'doc-1',
                title: 'Preview Platform Report',
                driveUrl: 'https://docs.example.com/doc-1',
                modifiedTime: '2026-11-28T10:00:00Z',
                digested: true,
                syncedAt: '2026-11-28T12:00:00Z',
              },
            ],
            warnings: [],
          });
        }
        if (url === '/api/profile/sync-docs') {
          return json({ docsSynced: 1, docsDigested: 1, skippedUnchanged: 0 });
        }
        if (url === '/api/ai/rescore') {
          return json({ resetCount: 12, scored: 10, provider: 'claude', model: 'haiku' });
        }
        return json({ error: 'not found' }, 404);
      }),
    );

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <SettingsView />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('profile-status-card')).toBeTruthy());
    expect(screen.getByText('Profile Loaded')).toBeTruthy();
    expect(screen.getByText('profile/targeting.yml')).toBeTruthy();
    expect(screen.getByText('Preview Platform Report')).toBeTruthy();
    expect(screen.getByText('Digested')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /sync project docs/i }));
    await waitFor(() => expect(screen.getByText(/Synced 1 · Digested 1/)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /rescore pending jobs/i }));
    await waitFor(() => expect(screen.getByText(/Reset 12 unapplied jobs · Scored 10/)).toBeTruthy());

    expect(calls).toContain('POST /api/profile/sync-docs');
    expect(calls).toContain('POST /api/ai/rescore');
  });
});
