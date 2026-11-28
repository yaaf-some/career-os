import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { careerApi } from '@/api/client';
import {
  evalBlocksFromJson,
  formatMatchScore,
  jobDetailFromApi,
  jobsListFromApi,
  type ApiJobDetailResponse,
  type ApiListJobsResponse,
} from '@/api/jobs';
import { JobPageHarness } from './jobPageHarness';
import { TriageView } from '@/features/triage/TriageView';
// Written by the API's `jobs_fixture_matches_web` test.
import fixture from './fixtures/jobs.json';

const apiList = fixture.list as ApiListJobsResponse;
const apiDetail = fixture.detail as ApiJobDetailResponse;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function mockApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.startsWith('/api/jobs?')) return json(apiList);
      if (url === '/api/jobs/job-1') return json(apiDetail);
      return json({ error: 'not found', code: 'NOT_FOUND' }, 404);
    }),
  );
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

describe('API job shape → web (fixture shared with crates/api)', () => {
  it('maps list rows, including an unscored job', () => {
    const { jobs, total } = jobsListFromApi(apiList);
    expect(total).toBe(2);
    expect(jobs[0]).toMatchObject({
      id: 'job-1',
      title: 'Staff Platform Engineer',
      location: 'Remote (US)',
      remotePolicy: 'remote',
      compensation: 'USD 210k–260k',
      source: 'ats_board',
      triageStatus: 'pending',
      stage: 'saved',
      matchScore: 87.5,
      scoreBreakdown: null,
      matchSummary: 'Strong platform match.',
      discoveredAt: '2026-11-21T09:00:00Z',
    });
    expect(jobs[1]).toMatchObject({
      triageStatus: 'pending',
      matchScore: null,
      matchSummary: '',
      compensation: null,
      location: '',
      remotePolicy: 'unknown',
    });
    expect(formatMatchScore(jobs[0].matchScore)).toBe('88/100');
    expect(formatMatchScore(jobs[1].matchScore)).toBe('unscored');
  });

  it('maps detail from job, newest deep eval, application and artifacts', () => {
    const d = jobDetailFromApi(apiDetail);
    expect(d.stage).toBe('interview');
    expect(d.nextFollowUpAt).toBe('2026-11-30T00:00:00Z');
    expect(d.hasDeepEval).toBe(true);
    expect(d.descriptionText).toContain('Build the platform.');
    expect(d.requirements).toEqual([]);
    expect(d.deepEval).toMatchObject({
      overallVerdict: '4.1 / 5 · Staff Platform Engineer',
      confidence: null,
      evaluatedAt: '2026-11-22T10:00:00Z',
      provider: 'claude',
      model: 'sonnet',
    });
    expect(d.deepEval?.blocks).toEqual([
      { block: 'A', title: 'Fit', rating: '', summary: 'Strong fit on platform work.', highlights: [] },
      {
        block: 'B',
        title: 'Gaps',
        rating: 'minor',
        summary: 'No Kubernetes operator experience.',
        highlights: ['Learnable in weeks'],
      },
      { block: 'G', title: 'Posting integrity', rating: '', summary: 'Posting looks genuine.', highlights: [] },
    ]);
    expect(d.tailor).toEqual({
      resumeDocUrl: 'https://docs.example.com/resume-1',
      coverLetterDocUrl: null,
      generatedAt: '2026-11-22T12:00:00Z',
      groundedBullets: [
        {
          id: 'b1',
          sourceFile: 'profile/experience.md',
          section: 'Platform',
          text: 'Owned multi-cluster Kubernetes reliability and CI/CD pipelines.',
          relevanceNote: 'Matches platform reliability requirements.',
        },
      ],
    });
    // Comms: a linked thread needs a reply, so that wins over the saved draft.
    expect(d.gmailStatus).toBe('reply_received');
    expect(d.gmailThreads).toEqual([
      {
        id: 'thr-1',
        threadId: 'gmail-thread-1',
        subject: 'Example Co: next steps',
        from: 'Recruiter <recruiting@example.com>',
        snippet: 'Thanks for applying to Example Co. Are you free Tuesday?',
        needsReply: true,
        lastMessageAt: '2026-11-24T15:00:00Z',
        linkSource: 'auto',
      },
    ]);
    expect(d.gmailDraft).toMatchObject({ to: 'recruiting@example.com', confirmed: false });
    expect(d.calendarReminders).toEqual([
      { id: 'evt-1', title: 'Example Co interview', startsAt: '2026-11-26T17:00:00Z', notes: '' },
    ]);
  });

  it('maps every DB triage status and stage', () => {
    const job = apiList.jobs[0];
    const status = (s: string) => jobsListFromApi({ jobs: [{ ...job, triage_status: s }], total: 1 }).jobs[0].triageStatus;
    expect(['pending_scoring', 'pending_triage', 'shortlisted', 'skipped', 'blacklisted'].map(status)).toEqual([
      'pending',
      'pending',
      'shortlisted',
      'skipped',
      'rejected',
    ]);
    const stage = (s: string) =>
      jobDetailFromApi({ ...apiDetail, application: { ...apiDetail.application!, stage: s } }).stage;
    expect(['shortlisted', 'applied', 'recruiter', 'interviewing', 'offer', 'closed'].map(stage)).toEqual([
      'saved',
      'applied',
      'screen',
      'interview',
      'offer',
      'archived',
    ]);
    const noApp = jobDetailFromApi({
      ...apiDetail,
      application: null,
      evaluations: [],
      drive_artifacts: [],
      gmail_threads: [],
      calendar_events: [],
      email_draft: null,
    });
    expect(noApp).toMatchObject({
      stage: 'saved',
      nextFollowUpAt: null,
      hasDeepEval: false,
      deepEval: null,
      gmailStatus: 'none',
      gmailThreads: [],
    });
  });

  it('never throws on odd blocks_json', () => {
    expect(evalBlocksFromJson(null)).toEqual([]);
    expect(evalBlocksFromJson('not json')).toEqual([]);
    expect(evalBlocksFromJson('[1,2]')).toEqual([]);
    expect(evalBlocksFromJson('{"A":42,"B":{"unknown":true},"Z":"ignored","C":"Level ok"}')).toEqual([
      { block: 'C', title: 'Level', rating: '', summary: 'Level ok', highlights: [] },
    ]);
    // Shape claude/sonnet actually returned during live verification.
    expect(
      evalBlocksFromJson('{"A":{"score":4,"summary":"Good fit.","title":"Fit"},"B":{"score":3.3,"items":["Gap one"],"summary":"Unconfirmed gaps."}}'),
    ).toEqual([
      { block: 'A', title: 'Fit', rating: '4.0', summary: 'Good fit.', highlights: [] },
      { block: 'B', title: 'Gaps', rating: '3.3', summary: 'Unconfirmed gaps.', highlights: ['Gap one'] },
    ]);
  });
});

describe('live API job routes', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_DEMO_MODE', 'false');
    mockApi();
  });

  it('client maps listJobs and getJob responses', async () => {
    const list = await careerApi.listJobs();
    expect(list.jobs.map((j) => j.id)).toEqual(['job-1', 'job-2']);
    const detail = await careerApi.getJob('job-1');
    expect(detail.deepEval?.provider).toBe('claude');
  });

  it('TriageView renders live jobs, unscored last, without fake breakdowns', async () => {
    renderWithQuery(<TriageView onSelectRole={() => {}} />);
    await waitFor(() => expect(screen.getByText('Staff Platform Engineer')).toBeTruthy());
    expect(screen.getByText('88')).toBeTruthy();
    expect(screen.queryByText(/Role \d+\/35/)).toBeNull();

    // Switch to List mode to verify scored-before-unscored ordering across all rows
    fireEvent.click(screen.getByRole('radio', { name: 'List' }));
    await waitFor(() => expect(screen.getByText('Backend Engineer')).toBeTruthy());
    expect(screen.getByText('88/100')).toBeTruthy();
    expect(screen.getByText('unscored')).toBeTruthy();
    const titles = screen
      .getAllByRole('button', { name: /Engineer/ })
      .map((b) => b.querySelector('.truncate')?.textContent)
      .filter(Boolean);
    expect(titles).toEqual(['Staff Platform Engineer', 'Backend Engineer']);
  });

  it('maps 4-dimension breakdown and dealbreaker badge from tier1_json', () => {
    const job = apiList.jobs[0];
    const mapped = jobsListFromApi({
      jobs: [
        {
          ...job,
          tier1_score: 32,
          tier1_json: JSON.stringify({
            job_id: job.id,
            score: 32,
            breakdown: {
              role_stack: 12,
              level_reachability: 10,
              vibe_culture: 5,
              logistics_comp: 5,
            },
            dealbreaker: { triggered: true, reason: 'Aerospace hardware role' },
            recommended_status: 'skipped',
            rationale: 'Hardware Systems Engineer mismatch.',
          }),
        },
      ],
      total: 1,
    }).jobs[0];

    expect(mapped.scoreBreakdown).toEqual({
      roleStack: 12,
      levelReachability: 10,
      vibeCulture: 5,
      logisticsComp: 5,
    });
    expect(mapped.dealbreakerReason).toBe('Aerospace hardware role');
  });

  it('job page shows the live job detail and deep evaluation', async () => {
    renderWithQuery(<JobPageHarness jobId="job-1" />);
    await waitFor(() => expect(screen.getAllByText('88').length).toBeGreaterThan(0));
    expect(screen.getAllByText('Interviewing').length).toBeGreaterThan(0);
    expect(screen.getByText('Strong platform match.')).toBeTruthy();
    expect(screen.getByText(/Build the platform\./)).toBeTruthy();
    expect(screen.queryByText('Key requirements')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Fit' }));
    await waitFor(() => expect(screen.getByText('4.1 / 5 · Staff Platform Engineer')).toBeTruthy());
    expect(screen.getByText('claude · sonnet')).toBeTruthy();
    expect(screen.getByText('No Kubernetes operator experience.')).toBeTruthy();
    expect(screen.queryByText(/Confidence:/)).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Activity' }));
    await waitFor(() => expect(screen.getByText('Example Co: next steps')).toBeTruthy());
    expect(screen.getByText('Needs reply')).toBeTruthy();
    expect(screen.getByText('Example Co interview')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Documents' }));
    const tailor = await screen.findByRole('button', { name: /Regenerate Docs/ });
    expect((tailor as HTMLButtonElement).disabled).toBe(false);
    expect(
      screen.getByText('Owned multi-cluster Kubernetes reliability and CI/CD pipelines.'),
    ).toBeTruthy();
  });
});
