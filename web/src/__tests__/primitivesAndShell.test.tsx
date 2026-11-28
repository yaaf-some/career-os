import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertBanner } from '@/components/AlertBanner';
import { AppShell } from '@/components/AppShell';
import {
  SegmentedControl,
  Sheet,
  SheetTitle,
  Switch,
  ToastProvider,
  useToast,
} from '@/components/ui';
import { ThemeProvider, useTheme } from '@/lib/theme';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  document.documentElement.classList.remove('dark');
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function ThemeHarness() {
  const { preference, resolved, setPreference } = useTheme();
  return (
    <div>
      <span data-testid="theme-state">
        {preference}:{resolved}
      </span>
      <SegmentedControl
        ariaLabel="Theme choice"
        value={preference}
        onValueChange={setPreference}
        options={[
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
          { value: 'system', label: 'System' },
        ]}
      />
    </div>
  );
}

function ToastHarness({ onUndo }: { onUndo: () => void }) {
  const { showToast } = useToast();
  return (
    <button
      type="button"
      onClick={() =>
        showToast({
          message: 'Approved Render',
          tone: 'success',
          actionLabel: 'Undo',
          onAction: onUndo,
        })
      }
    >
      Trigger toast
    </button>
  );
}

describe('Warm Paper theme & Base UI primitives', () => {
  it('persists Light / Dark / System theme selection cleanly', () => {
    render(
      <ThemeProvider>
        <ThemeHarness />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(screen.getByTestId('theme-state').textContent).toBe('dark:dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem('career-os-theme')).toBe('dark');

    fireEvent.click(screen.getByRole('radio', { name: 'Light' }));
    expect(screen.getByTestId('theme-state').textContent).toBe('light:light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('toggles Switch, renders Sheet, and fires Toast Undo callback', async () => {
    const onSwitch = vi.fn();
    const onUndo = vi.fn();
    const { rerender } = render(
      <ToastProvider>
        <Switch checked={false} onCheckedChange={onSwitch} ariaLabel="Scan Acme" />
        <Sheet open={false} onOpenChange={() => {}} ariaLabel="Sample sheet">
          <SheetTitle>Pull-up sheet</SheetTitle>
        </Sheet>
        <ToastHarness onUndo={onUndo} />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole('switch', { name: 'Scan Acme' }));
    expect(onSwitch).toHaveBeenCalledWith(true);

    fireEvent.click(screen.getByRole('button', { name: 'Trigger toast' }));
    expect(screen.getByText('Approved Render')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledTimes(1);

    rerender(
      <ToastProvider>
        <Switch checked onCheckedChange={onSwitch} ariaLabel="Scan Acme" />
        <Sheet open onOpenChange={() => {}} ariaLabel="Sample sheet">
          <SheetTitle>Pull-up sheet</SheetTitle>
        </Sheet>
        <ToastHarness onUndo={onUndo} />
      </ToastProvider>,
    );
    expect(screen.getByText('Pull-up sheet')).toBeTruthy();
  });
});

describe('AlertBanner & Quiet AppShell with ⌘K + Quick-Add', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_DEMO_MODE', 'false');
  });

  it('hides AlertBanner when healthy and shows when Google or bridge needs action', async () => {
    const healthyGoogle = {
      connected: true,
      authMode: 'testing' as const,
      accountEmail: 'you@example.com',
      connectedAt: null,
      testingExpiresAt: null,
      hoursRemaining: 100,
      needsReconnect: false,
      expiresAt: null,
      oauthConfigured: true,
      encryptionConfigured: true,
      missingScopes: [],
    };
    const healthyUsage = {
      configured: true,
      bridgeReachable: true,
      updatedAt: null,
      claude5h: null,
      claude7d: null,
      claudeStale: false,
      antigravity: { callsUsed: 0, callsLimit: null, cooldownUntil: null, status: 'ready' as const },
      dbStatsByTier: [],
    };

    const healthyRoot = createRootRoute({
      component: () => (
        <div data-testid="healthy-wrap">
          <AlertBanner googleStatus={healthyGoogle} usage={healthyUsage} />
        </div>
      ),
    });
    const healthyRouter = createRouter({
      routeTree: healthyRoot,
      history: createMemoryHistory({ initialEntries: ['/'] }),
    });
    render(<RouterProvider router={healthyRouter} />);
    await waitFor(() => expect(screen.getByTestId('healthy-wrap')).toBeTruthy());
    expect(screen.queryByTestId('action-alert-banner')).toBeNull();
    cleanup();

    const offlineRoot = createRootRoute({
      component: () => (
        <AlertBanner
          googleStatus={{ ...healthyGoogle, needsReconnect: true, hoursRemaining: 3 }}
          usage={{ ...healthyUsage, bridgeReachable: false }}
        />
      ),
    });
    const offlineRouter = createRouter({
      routeTree: offlineRoot,
      history: createMemoryHistory({ initialEntries: ['/'] }),
    });
    render(<RouterProvider router={offlineRouter} />);
    await waitFor(() => {
      expect(screen.getByTestId('action-alert-banner')).toBeTruthy();
      expect(screen.getByTestId('alert-bridge-offline')).toBeTruthy();
    });
  });

  it('opens ⌘K command palette and submits Quick-Add job URL', async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        calls.push({
          url,
          method: init.method ?? 'GET',
          body: init.body ? JSON.parse(String(init.body)) : undefined,
        });
        if (url === '/healthz') {
          return json({ status: 'ok', service: 'career-os-api', version: '0.1.0', db_ok: true });
        }
        if (url === '/api/ai/usage') {
          return json({
            configured: true,
            bridgeReachable: true,
            updatedAt: null,
            claude5h: null,
            claude7d: null,
            claudeStale: false,
            antigravity: { callsUsed: 0, callsLimit: null, cooldownUntil: null, status: 'ready' },
            dbStatsByTier: [],
          });
        }
        if (url === '/api/auth/google/status') {
          return json({
            connected: true,
            auth_mode: 'testing',
            account_email: 'you@example.com',
            hours_remaining: 100,
            needs_reconnect: false,
            oauth_configured: true,
            encryption_configured: true,
            missing_scopes: [],
          });
        }
        if (url === '/api/jobs' && init.method === 'POST') {
          return json({
            id: 'job-new',
            canonical_key: 'https://boards.greenhouse.io/acme/jobs/1',
            url: 'https://boards.greenhouse.io/acme/jobs/1',
            company: 'Acme',
            title: 'Platform Engineer',
            location: 'Remote US',
            workplace_type: 'remote',
            source_type: 'manual_url',
            triage_status: 'pending_scoring',
            tier1_score: 82,
            created_at: '2026-11-28T00:00:00Z',
            updated_at: '2026-11-28T00:00:00Z',
          });
        }
        return json({ error: 'not found' }, 404);
      }),
    );

    const rootRoute = createRootRoute({
      component: () => (
        <AppShell>
          <div>Shell body</div>
        </AppShell>
      ),
    });
    const router = createRouter({
      routeTree: rootRoute,
      history: createMemoryHistory({ initialEntries: ['/'] }),
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <ThemeProvider>
        <ToastProvider>
          <QueryClientProvider client={qc}>
            <RouterProvider router={router} />
          </QueryClientProvider>
        </ToastProvider>
      </ThemeProvider>,
    );

    await waitFor(() => expect(screen.getByText('Shell body')).toBeTruthy());

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    const searchInput = await screen.findByLabelText('Search commands');
    fireEvent.change(searchInput, { target: { value: 'Add job' } });
    fireEvent.click(await screen.findByRole('option', { name: /Add job posting URL/i }));

    const urlInput = await screen.findByLabelText('Job posting URL');
    fireEvent.change(urlInput, { target: { value: 'https://boards.greenhouse.io/acme/jobs/1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to queue' }));

    await waitFor(() => {
      expect(calls.some((c) => c.url === '/api/jobs' && c.method === 'POST')).toBe(true);
    });
  });
});
