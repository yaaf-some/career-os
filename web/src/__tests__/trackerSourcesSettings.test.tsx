import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/ui';
import { ThemeProvider } from '@/lib/theme';
import { SettingsView } from '@/routes/SettingsView';
import { SourcesView } from '@/routes/SourcesView';
import { TrackerView } from '@/routes/TrackerView';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function renderWithProviders(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return render(
    <ThemeProvider>
      <ToastProvider>
        <QueryClientProvider client={client}>{ui}</QueryClientProvider>
      </ToastProvider>
    </ThemeProvider>,
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  document.documentElement.classList.remove('dark');
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Grouped TrackerView, TanStack SourcesView & Warm Paper SettingsView', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_DEMO_MODE', 'true');
  });

  it('groups Tracker entries by stage and opens Stage Picker sheet', async () => {
    const onSelectRole = vi.fn();
    renderWithProviders(<TrackerView onSelectRole={onSelectRole} />);

    await waitFor(() => {
      expect(screen.getByTestId('tracker-view')).toBeTruthy();
      expect(screen.getByText('Screen')).toBeTruthy();
      expect(screen.getByText('Example Cloud')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Change stage for Example Cloud' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Interview' }));
    await waitFor(() => {
      expect(screen.getByText('Moved Example Cloud to Interview')).toBeTruthy();
    });
  });

  it('filters SourcesView TanStack table and toggles board switch', async () => {
    renderWithProviders(<SourcesView />);

    await waitFor(() => {
      expect(screen.getByTestId('sources-table')).toBeTruthy();
    });

    const filterInput = screen.getByLabelText('Filter boards');
    fireEvent.change(filterInput, { target: { value: 'Northstar' } });
    await waitFor(() => {
      expect(screen.getByText('Northstar Systems')).toBeTruthy();
    });

    const toggle = screen.getByRole('switch', { name: 'Scan Northstar Systems' });
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(screen.getByText(/Northstar Systems scanning/i)).toBeTruthy();
    });
  });

  it('switches Appearance theme and AI routing mode in SettingsView', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'false');
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        calls.push({
          url,
          method: init.method ?? 'GET',
          body: init.body ? JSON.parse(String(init.body)) : undefined,
        });
        if (url === '/api/settings') {
          return json({
            settings: [{ key: 'ai_routing', value_json: '{"mode":"auto"}', updated_at: 'x' }],
          });
        }
        if (url === '/api/settings/ai_routing') {
          return json({
            key: 'ai_routing',
            value_json: '{"mode":"prefer_agy"}',
            updated_at: 'x',
          });
        }
        if (url === '/api/auth/google/status') {
          return json({
            connected: false,
            auth_mode: 'testing',
            account_email: null,
            hours_remaining: null,
            needs_reconnect: true,
            oauth_configured: true,
            encryption_configured: true,
            missing_scopes: [],
          });
        }
        if (url === '/api/profile/status') {
          return json({
            loaded: false,
            dataDir: '/data',
            driveProjectsFolderConfigured: false,
            files: [],
            targeting: null,
            projectDocs: [],
            warnings: [],
          });
        }
        if (url === '/api/ai/usage') {
          return json({
            configured: true,
            bridgeReachable: true,
            updatedAt: null,
            claude5h: { percentUsed: 24, resetAt: null },
            claude7d: { percentUsed: 50, resetAt: null },
            claudeStale: false,
            antigravity: { callsUsed: 2, callsLimit: 40, cooldownUntil: null, status: 'ready' },
            dbStatsByTier: [],
          });
        }
        if (url === '/api/sources') return json({ sources: [], filtered_audit: [] });
        if (url === '/api/sync-runs') return json({ runs: [] });
        return json({ error: 'not found' }, 404);
      }),
    );

    renderWithProviders(<SettingsView />);

    await waitFor(() => expect(screen.getByTestId('settings-view')).toBeTruthy());

    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(document.documentElement.dataset.theme).toBe('dark');

    const geminiRadio = await screen.findByRole('radio', { name: 'Gemini' });
    fireEvent.click(geminiRadio);
    await waitFor(() => {
      expect(
        calls.some(
          (c) =>
            c.url === '/api/settings/ai_routing' &&
            c.method === 'PUT' &&
            JSON.stringify(c.body).includes('prefer_agy'),
        ),
      ).toBe(true);
    });
  });
});
