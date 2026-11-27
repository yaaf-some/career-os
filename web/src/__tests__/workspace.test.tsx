import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { careerApi, describeGoogleError } from '@/api/client';
import {
  formatDateLabel,
  todayFromApi,
  trackerFromApi,
  trackerPatchToApi,
  type ApiTodayResponse,
  type ApiTrackerEntry,
} from '@/api/jobs';
import { GoogleSyncPanel } from '@/components/GoogleSyncPanel';
import { TodayView } from '@/routes/TodayView';
import { TrackerView } from '@/routes/TrackerView';
// Written by the API's `workspace_fixtures_match_web` test.
import jobFixture from './fixtures/jobs.json';
import todayFixture from './fixtures/today.json';
import trackerFixture from './fixtures/tracker.json';

const apiToday = todayFixture as ApiTodayResponse;
const apiTracker = trackerFixture as { entries: ApiTrackerEntry[] };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

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

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Today / Tracker mapping (fixtures shared with crates/api)', () => {
  it('maps today', () => {
    const t = todayFromApi(apiToday);
    expect(t.dateLabel).toBe('Friday, Nov 27');
    expect(t.unreadReplies).toEqual([
      {
        jobId: 'job-1',
        company: 'Example Co',
        role: 'Staff Platform Engineer',
        sender: 'Recruiter <recruiting@example.com>',
        snippet: 'Are you free Tuesday?',
        receivedAt: '2026-11-26T15:00:00Z',
      },
    ]);
    expect(t.agenda.map((a) => [a.id, a.jobId, a.locationOrLink])).toEqual([
      ['evt-2', null, ''],
      ['evt-1', 'job-1', 'https://calendar.example.com/event/1'],
    ]);
    expect(t.followUpsDue).toEqual([
      {
        jobId: 'job-1',
        company: 'Example Co',
        role: 'Staff Platform Engineer',
        dueAt: '2026-11-27T09:00:00Z',
        overdue: true,
        stage: 'interview',
      },
    ]);
    expect(t.topMatches.map((j) => [j.id, j.hydrogenScore])).toEqual([
      ['job-3', 91],
      ['job-1', 87.5],
      ['job-2', 72],
    ]);
    expect(formatDateLabel('not-a-date')).toBe('not-a-date');
  });

  it('maps tracker rows and patches with API stage names', () => {
    const { entries } = trackerFromApi(apiTracker);
    expect(entries.map((e) => [e.jobId, e.stage, e.gmailStatus, e.threadSubject])).toEqual([
      ['job-1', 'interview', 'reply_received', 'Example Co: next steps'],
      ['job-2', 'applied', 'awaiting_reply', 'Globex application received'],
    ]);
    expect(trackerPatchToApi({ jobId: 'j', stage: 'screen' })).toEqual({ jobId: 'j', stage: 'recruiter' });
    expect(trackerPatchToApi({ jobId: 'j', stage: 'archived', nextFollowUpAt: null, notes: 'x' })).toEqual({
      jobId: 'j',
      stage: 'closed',
      nextFollowUpAt: null,
      notes: 'x',
    });
  });
});

describe('live Today / Tracker / quick-add / sync', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_DEMO_MODE', 'false');
  });

  it('client hits the real routes', async () => {
    const calls = mockFetch((url) => {
      if (url === '/api/today') return json(apiToday);
      if (url === '/api/tracker') return json(apiTracker);
      if (url === '/api/jobs')
        return json({ ...apiToday.topMatches[0], id: 'new-job', triage_status: 'pending_scoring', tier1_score: null });
      if (url === '/api/sync/google')
        return json({
          id: 'r1',
          run_type: 'gmail_sync',
          status: 'succeeded',
          items_fetched: 4,
          items_ingested: 0,
          items_filtered: 0,
          items_errored: 0,
          meta_json: null,
          error_message: null,
          started_at: '2026-11-27T12:00:00Z',
          finished_at: '2026-11-27T12:00:05Z',
        });
      return json({ error: 'not found', code: 'NOT_FOUND' }, 404);
    });
    expect((await careerApi.getToday()).unreadReplies).toHaveLength(1);
    await careerApi.updateTracker({ jobId: 'job-1', stage: 'offer' });
    expect(calls.at(-1)).toEqual({
      url: '/api/tracker',
      method: 'PATCH',
      body: { jobId: 'job-1', stage: 'offer' },
    });
    const added = await careerApi.quickAddJob({ url: 'https://jobs.example.com/x' });
    expect(added).toMatchObject({ id: 'new-job', triageStatus: 'pending', hydrogenScore: null });
    expect(await careerApi.syncGoogleNow()).toMatchObject({ status: 'succeeded', itemsFetched: 4 });
  });

  it('API errors surface instead of demo data (AC8)', async () => {
    mockFetch(() => json({ error: 'boom', code: 'INTERNAL_ERROR' }, 500));
    await expect(careerApi.getToday()).rejects.toMatchObject({ name: 'ApiError', status: 500 });
    await expect(careerApi.getTracker()).rejects.toMatchObject({ status: 500 });
    await expect(careerApi.quickAddJob({ url: 'https://x.example' })).rejects.toMatchObject({ status: 500 });
    await expect(careerApi.listJobs()).rejects.toMatchObject({ status: 500 });
    mockFetch(() => json({ error: 'Google is not connected', code: 'GOOGLE_NOT_CONNECTED' }, 409));
    await expect(careerApi.syncGoogleNow()).rejects.toMatchObject({ status: 409, code: 'GOOGLE_NOT_CONNECTED' });
  });

  it('TodayView and TrackerView render live data', async () => {
    mockFetch((url) => {
      if (url === '/api/today') return json(apiToday);
      if (url === '/api/tracker') return json(apiTracker);
      return json({ error: 'not found', code: 'NOT_FOUND' }, 404);
    });
    renderWithQuery(<TodayView onSelectRole={() => {}} />);
    await waitFor(() => expect(screen.getByText('Are you free Tuesday?')).toBeTruthy());
    expect(screen.getByText('Dentist')).toBeTruthy();
    expect(screen.getByText('Site Reliability Engineer')).toBeTruthy();
    cleanup();
    renderWithQuery(<TrackerView onSelectRole={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Globex application received/)).toBeTruthy());
  });

  it('Settings sync panel shows the last run and a clear 409 message', async () => {
    mockFetch((url) => {
      if (url === '/api/sync-runs')
        return json({
          runs: [
            {
              id: 'r1',
              run_type: 'gmail_sync',
              status: 'failed',
              items_fetched: 0,
              items_ingested: 0,
              items_filtered: 0,
              items_errored: 0,
              meta_json: null,
              error_message: 'token expired',
              started_at: '2026-11-27T00:00:00Z',
              finished_at: '2026-11-27T00:00:02Z',
            },
          ],
        });
      return json({ error: 'a Google sync is already running', code: 'SYNC_IN_PROGRESS' }, 409);
    });
    renderWithQuery(<GoogleSyncPanel connected />);
    await waitFor(() => expect(screen.getByText('token expired')).toBeTruthy());
    expect(screen.getByText('failed')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Sync now/ }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('A sync is already running.'));
  });

  it('drafts and reminders post to the real routes and map the job back', async () => {
    const calls = mockFetch((url) =>
      url.endsWith('/email-draft') || url.endsWith('/calendar-reminder')
        ? json(jobFixture.detail)
        : json({ error: 'not found', code: 'NOT_FOUND' }, 404),
    );
    const d = await careerApi.saveEmailDraft('job-1', {
      to: 'recruiting@example.com',
      subject: 'Re: next steps',
      body: 'Tuesday works.',
      confirmed: true,
    });
    expect(calls[0]).toEqual({
      url: '/api/jobs/job-1/email-draft',
      method: 'POST',
      body: { to: 'recruiting@example.com', subject: 'Re: next steps', body: 'Tuesday works.', confirmed: true },
    });
    expect(d.gmailDraft?.to).toBe('recruiting@example.com');
    const r = await careerApi.addCalendarReminder('job-1', {
      title: 'Follow up',
      startsAt: '2026-12-01T17:00:00.000Z',
      notes: '',
    });
    expect(calls[1]).toMatchObject({ url: '/api/jobs/job-1/calendar-reminder', method: 'POST' });
    expect(r.calendarReminders).toHaveLength(1);
  });

  it('Google 409s become actionable messages, not demo data', async () => {
    mockFetch(() => json({ error: 'reconnect', code: 'GOOGLE_RECONNECT_REQUIRED' }, 409));
    const err = await careerApi
      .saveEmailDraft('job-1', { to: 'a@example.com', subject: 's', body: 'b', confirmed: true })
      .catch((e: unknown) => e);
    expect(describeGoogleError(err)).toBe(
      'Reconnect Google in Settings to allow Gmail drafts and Calendar events.',
    );
    mockFetch(() => json({ error: 'no google', code: 'GOOGLE_NOT_CONNECTED' }, 409));
    const err2 = await careerApi
      .addCalendarReminder('job-1', { title: 't', startsAt: '2026-12-01T17:00:00Z', notes: '' })
      .catch((e: unknown) => e);
    expect(describeGoogleError(err2)).toBe('Connect Google in Settings first.');
  });
});
