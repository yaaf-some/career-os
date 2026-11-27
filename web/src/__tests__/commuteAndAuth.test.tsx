import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommuteInfo, GoogleAuthStatusResponse } from '@/api/types';
import { CommuteBadgeDisplay } from '@/components/CommuteBadge';
import { GoogleAuthPill } from '@/components/GoogleAuthPill';

afterEach(() => {
  cleanup();
});

function renderWithRouter(node: React.ReactNode) {
  const rootRoute = createRootRoute({ component: () => <>{node}</> });
  const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => null });
  const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/settings', component: () => null });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, settingsRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('GoogleAuthPill (Testing-mode 7d countdown)', () => {
  it('renders healthy countdown in days when >24h remaining', async () => {
    const status: GoogleAuthStatusResponse = {
      connected: true,
      authMode: 'testing',
      accountEmail: 'demo@example.com',
      connectedAt: '2026-11-24T12:00:00Z',
      testingExpiresAt: '2026-12-01T12:00:00Z',
      hoursRemaining: 120,
      needsReconnect: false,
      expiresAt: null,
      oauthConfigured: true,
      encryptionConfigured: true,
      missingScopes: [],
    };

    renderWithRouter(<GoogleAuthPill status={status} />);
    const pill = await screen.findByTestId('google-auth-pill');
    expect(pill.textContent).toContain('5d left');
    expect(screen.queryByTestId('google-auth-reconnect-btn')).toBeNull();
  });

  it('shows 1-click reconnect button when <24h remaining', async () => {
    const onReconnect = vi.fn();
    const status: GoogleAuthStatusResponse = {
      connected: true,
      authMode: 'testing',
      accountEmail: 'demo@example.com',
      connectedAt: '2026-11-19T20:00:00Z',
      testingExpiresAt: '2026-11-26T20:00:00Z',
      hoursRemaining: 8,
      needsReconnect: true,
      expiresAt: null,
      oauthConfigured: true,
      encryptionConfigured: true,
      missingScopes: [],
    };

    renderWithRouter(<GoogleAuthPill status={status} onReconnect={onReconnect} />);
    const btn = await screen.findByTestId('google-auth-reconnect-btn');
    expect(screen.getByTestId('google-auth-pill').textContent).toContain('Reconnect (8h left)');
    btn.click();
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it('prompts sign in when disconnected', async () => {
    const status: GoogleAuthStatusResponse = {
      connected: false,
      authMode: 'testing',
      accountEmail: null,
      connectedAt: null,
      testingExpiresAt: null,
      hoursRemaining: null,
      needsReconnect: true,
      expiresAt: null,
      oauthConfigured: true,
      encryptionConfigured: true,
      missingScopes: [],
    };

    renderWithRouter(<GoogleAuthPill status={status} onReconnect={() => undefined} />);
    const pill = await screen.findByTestId('google-auth-pill');
    expect(pill.textContent).toContain('Sign in');
    expect(await screen.findByTestId('google-auth-reconnect-btn')).toBeTruthy();
  });
});

describe('CommuteBadgeDisplay (LA Commute)', () => {
  it('renders Remote badge without distance', () => {
    const commute: CommuteInfo = {
      isRemote: true,
      configured: true,
      originArea: 'West Los Angeles, CA',
      destinationQuery: 'Remote',
      resolvedAddress: null,
      distanceMiles: null,
      durationMinutes: null,
      travelMode: 'drive',
      estimateSource: 'remote',
      cached: false,
      mapsUrl: null,
    };
    render(<CommuteBadgeDisplay commute={commute} />);
    expect(screen.getByTestId('commute-badge').textContent).toContain('Remote');
  });

  it('renders Routes API drive duration, miles, and origin area', () => {
    const commute: CommuteInfo = {
      isRemote: false,
      configured: true,
      originArea: 'West Los Angeles, CA',
      destinationQuery: 'Santa Monica, CA',
      resolvedAddress: 'Santa Monica, CA',
      distanceMiles: 4.6,
      durationMinutes: 14,
      travelMode: 'drive',
      estimateSource: 'routes_api',
      cached: true,
      mapsUrl: 'https://www.google.com/maps/dir/?api=1&origin=West+LA&destination=Santa+Monica',
    };
    render(<CommuteBadgeDisplay commute={commute} />);
    const badge = screen.getByTestId('commute-badge');
    expect(badge.textContent).toContain('~14 min');
    expect(badge.textContent).toContain('4.6 mi');
    expect(badge.textContent).toContain('West Los Angeles, CA');
  });

  it('marks Haversine fallback estimates as est.', () => {
    const commute: CommuteInfo = {
      isRemote: false,
      configured: true,
      originArea: 'West Los Angeles, CA',
      destinationQuery: 'Culver City, CA',
      resolvedAddress: 'Culver City, CA',
      distanceMiles: 5.2,
      durationMinutes: 16,
      travelMode: 'drive',
      estimateSource: 'places_haversine',
      cached: false,
      mapsUrl: null,
    };
    render(<CommuteBadgeDisplay commute={commute} compact />);
    expect(screen.getByTestId('commute-badge').textContent).toContain('est.');
  });
});
