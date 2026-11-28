import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JobPageHarness } from './jobPageHarness';
import { ToastProvider } from '@/components/ui';
import { ThemeProvider } from '@/lib/theme';
import { TodayView } from '@/features/today/TodayView';
import { TriageView } from '@/features/triage/TriageView';

function renderWithProviders(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
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

beforeEach(() => {
  vi.stubEnv('VITE_DEMO_MODE', 'true');
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('TodayView Warm Paper 3-section briefing', () => {
  it('renders Needs a reply, Follow ups & upcoming, and Worth a look and navigates on click', async () => {
    const onSelectRole = vi.fn();
    renderWithProviders(<TodayView onSelectRole={onSelectRole} />);

    expect(screen.getByTestId('today-view')).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText('Needs a reply')).toBeTruthy();
      expect(screen.getByText('Follow ups & upcoming')).toBeTruthy();
      expect(screen.getByText('Worth a look')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Staff Systems Engineer — Agent Runtime'));
    expect(onSelectRole).toHaveBeenCalledWith('job-101');
  });
});

describe('TriageView deck', () => {
  it('renders single-role Focus Sheet, supports Queue Browser, Bookmark, Undo & Skip', async () => {
    const onSelectRole = vi.fn();
    renderWithProviders(<TriageView onSelectRole={onSelectRole} undoDelayMs={50} />);

    expect(screen.getByTestId('triage-view')).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText('Staff Systems Engineer — Agent Runtime')).toBeTruthy();
      const card = within(screen.getByTestId('focus-card'));
      expect(card.getByText('93')).toBeTruthy();
      expect(card.getByText('Role 33/35')).toBeTruthy();
    });

    // Inspect opens RoleDetailSheet callback
    fireEvent.click(screen.getByRole('button', { name: /Read posting & deep analysis/i }));
    expect(onSelectRole).toHaveBeenCalledWith('job-101');

    // A held key is ignored
    fireEvent.keyDown(window, { key: 'x', repeat: true });
    expect(screen.queryByText(/Skipped Northstar Systems/i)).toBeNull();

    // Keyboard X skips and offers Undo toast
    fireEvent.keyDown(window, { key: 'x' });
    await waitFor(() => {
      expect(screen.getByText(/Skipped Northstar Systems/i)).toBeTruthy();
    });

    // Clicking Undo restores the first card
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => {
      expect(screen.getByText('Staff Systems Engineer — Agent Runtime')).toBeTruthy();
    });

    // Save advances to the next card
    fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    await waitFor(() => {
      expect(screen.getByText(/Saved Northstar Systems/i)).toBeTruthy();
    });
  });

  const drag = (dx: number, end: 'pointerUp' | 'pointerCancel') => {
    const card = screen.getByTestId('focus-card');
    fireEvent.pointerDown(card, { pointerId: 1, button: 0, clientX: 200 });
    fireEvent.pointerMove(card, { pointerId: 1, clientX: 200 + dx });
    fireEvent[end](card, { pointerId: 1, clientX: 200 + dx });
  };

  it('a cancelled drag decides nothing; a released one saves', async () => {
    renderWithProviders(<TriageView onSelectRole={vi.fn()} undoDelayMs={5000} />);
    await waitFor(() => expect(screen.getByTestId('focus-card')).toBeTruthy());
    // The entrance animation lives on a wrapper so it cannot override the drag transform.
    expect(screen.getByTestId('focus-card').className).not.toContain('calm-rise');

    // The demo store is shared by these tests, so the first card may be any company.
    drag(180, 'pointerCancel');
    expect(screen.queryByText(/^Saved /)).toBeNull();

    drag(180, 'pointerUp');
    await waitFor(() => expect(screen.getByText(/^Saved /)).toBeTruthy());
  });

  it('opens job page tabs cleanly', async () => {
    renderWithProviders(<JobPageHarness jobId="job-101" />);

    await waitFor(() => {
      expect(screen.getByText('Staff Systems Engineer — Agent Runtime')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('tab', { name: 'Fit' }));
    await waitFor(() => {
      expect(screen.getByText(/Deep Analysis \(Blocks A–G\)/i)).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('tab', { name: 'Activity' }));
    await waitFor(() => {
      expect(screen.getByText('Linked Gmail threads')).toBeTruthy();
    });
  });
});
