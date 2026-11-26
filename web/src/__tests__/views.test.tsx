import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TodayView } from '@/routes/TodayView';
import { TriageView } from '@/routes/TriageView';

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.stubEnv('VITE_DEMO_MODE', 'true');
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('TodayView state rendering', () => {
  it('renders action queue sections and supports quick-add URL submission', async () => {
    const onSelectRole = vi.fn();
    renderWithQuery(<TodayView onSelectRole={onSelectRole} />);

    expect(screen.getByTestId('today-view')).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText('Unread Recruiter Replies')).toBeTruthy();
      expect(screen.getByText('Calendar Agenda')).toBeTruthy();
      expect(screen.getByText('Follow-ups Due')).toBeTruthy();
      expect(screen.getByText('Top Scored Matches')).toBeTruthy();
    });

    const urlInput = screen.getByLabelText('Job posting URL') as HTMLInputElement;
    const titleInput = screen.getByLabelText('Role title') as HTMLInputElement;
    fireEvent.change(urlInput, {
      target: { value: 'https://boards.greenhouse.io/example-cloud/jobs/999' },
    });
    fireEvent.change(titleInput, {
      target: { value: 'Principal Systems Architect' },
    });

    fireEvent.click(screen.getByRole('button', { name: /add & score/i }));

    await waitFor(() => {
      expect(screen.getAllByText(/Principal Systems Architect/i).length).toBeGreaterThanOrEqual(1);
    });
  });
});

describe('TriageView state rendering', () => {
  it('renders hydrogen-scored inbox jobs and updates status on triage action', async () => {
    const onSelectRole = vi.fn();
    renderWithQuery(<TriageView onSelectRole={onSelectRole} />);

    expect(screen.getByTestId('triage-view')).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText('Staff Systems Engineer — Agent Runtime')).toBeTruthy();
      expect(screen.getByText('hydrogen 93/100')).toBeTruthy();
    });

    const inspectButtons = screen.getAllByRole('button', { name: /inspect/i });
    fireEvent.click(inspectButtons[0]);
    expect(onSelectRole).toHaveBeenCalledWith('job-101');

    const shortlistButtons = screen.getAllByRole('button', { name: /shortlist/i });
    fireEvent.click(shortlistButtons[0]);

    await waitFor(() => {
      expect(screen.getAllByText('shortlisted').length).toBeGreaterThan(0);
    });
  });
});
