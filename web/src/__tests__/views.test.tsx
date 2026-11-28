import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoleDetailSheet } from '@/components/RoleDetailSheet';
import { ToastProvider } from '@/components/ui';
import { ThemeProvider } from '@/lib/theme';
import { TodayView } from '@/routes/TodayView';
import { TriageView } from '@/routes/TriageView';

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

describe('TriageView Focus Paper Sheet & Fit Horizon', () => {
  it('renders single-role Focus Sheet, supports Queue Browser, Bookmark, Undo & Skip', async () => {
    const onSelectRole = vi.fn();
    renderWithProviders(<TriageView onSelectRole={onSelectRole} undoDelayMs={50} />);

    expect(screen.getByTestId('triage-view')).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText('Staff Systems Engineer — Agent Runtime')).toBeTruthy();
      expect(screen.getByTestId('fit-horizon')).toBeTruthy();
      expect(screen.getByText('93')).toBeTruthy();
      expect(screen.getByText('Role 33/35')).toBeTruthy();
    });

    // Inspect opens RoleDetailSheet callback
    fireEvent.click(screen.getByRole('button', { name: /Read posting & deep analysis/i }));
    expect(onSelectRole).toHaveBeenCalledWith('job-101');

    // Keyboard S shortlists and shows bookmark notch
    fireEvent.keyDown(window, { key: 's' });
    await waitFor(() => {
      expect(screen.getByTestId('bookmark-notch')).toBeTruthy();
    });

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

    // Approve advances to next card
    fireEvent.click(screen.getByRole('button', { name: /Approve/i }));
    await waitFor(() => {
      expect(screen.getByText(/Approved Northstar Systems/i)).toBeTruthy();
    });
  });

  it('opens RoleDetailSheet tabs cleanly', async () => {
    renderWithProviders(<RoleDetailSheet jobId="job-101" onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText('Staff Systems Engineer — Agent Runtime')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('tab', { name: 'Deep analysis' }));
    await waitFor(() => {
      expect(screen.getByText(/Deep Analysis \(Blocks A–G\)/i)).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('tab', { name: 'Comms & reminders' }));
    await waitFor(() => {
      expect(screen.getByText('Linked Gmail threads')).toBeTruthy();
    });
  });
});
