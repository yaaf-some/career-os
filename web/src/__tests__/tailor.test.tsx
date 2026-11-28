import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { careerApi, isDemoModeActive } from '@/api/client';
import { RoleDetailSheet } from '@/components/RoleDetailSheet';
import { ToastProvider } from '@/components/ui';
import apiFixtures from './fixtures/jobs.json';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <ToastProvider>
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </ToastProvider>,
  );
}

const emptyDetail = {
  ...apiFixtures.detail,
  drive_artifacts: [],
  latest_tailor: null,
};

beforeEach(() => {
  vi.stubEnv('VITE_DEMO_MODE', 'false');
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('JOB-12 tailor API & RoleDetailSheet', () => {
  it('tailorJob rejects 500 and 409 without falling back to demo data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: 'profile missing', code: 'PROFILE_NOT_LOADED' }, 409)),
    );
    await expect(careerApi.tailorJob('job-1')).rejects.toMatchObject({
      name: 'ApiError',
      status: 409,
      code: 'PROFILE_NOT_LOADED',
    });
    expect(isDemoModeActive()).toBe(false);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: 'boom', code: 'INTERNAL_ERROR' }, 500)),
    );
    await expect(careerApi.tailorJob('job-1')).rejects.toMatchObject({
      name: 'ApiError',
      status: 500,
    });
    expect(isDemoModeActive()).toBe(false);
  });

  it('triggers POST /api/jobs/{id}/tailor and renders returned Docs + grounded bullets', async () => {
    let tailored = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        if (url === '/api/jobs/job-1' && (init.method ?? 'GET') === 'GET') {
          return json(
            tailored
              ? {
                  ...emptyDetail,
                  drive_artifacts: [
                    {
                      id: 'a1',
                      job_id: 'job-1',
                      kind: 'resume_doc',
                      drive_file_id: 'd1',
                      drive_url: 'https://docs.google.com/document/d/d1/edit',
                      title: 'Resume',
                      created_at: '2026-11-28T20:00:00Z',
                    },
                    {
                      id: 'a2',
                      job_id: 'job-1',
                      kind: 'cover_doc',
                      drive_file_id: 'd2',
                      drive_url: 'https://docs.google.com/document/d/d2/edit',
                      title: 'Cover Letter',
                      created_at: '2026-11-28T20:00:00Z',
                    },
                  ],
                  latest_tailor: {
                    id: 'tr-1',
                    tier: 'deep',
                    provider: 'claude',
                    model: 'opus',
                    created_at: '2026-11-28T20:00:00Z',
                    grounded_bullets: [
                      {
                        id: 'b1',
                        source_file: 'profile/experience.md',
                        section: 'Experience',
                        text: 'Cut p99 API latency by 40%.',
                        relevance_note: 'Directly matches reliability goal.',
                      },
                    ],
                  },
                }
              : emptyDetail,
          );
        }
        if (url === '/api/jobs/job-1/tailor' && init.method === 'POST') {
          tailored = true;
          return json({
            job_id: 'job-1',
            tailor_run_id: 'tr-1',
            tier: 'deep',
            provider: 'claude',
            model: 'opus',
            resume_doc_url: 'https://docs.google.com/document/d/d1/edit',
            cover_letter_doc_url: 'https://docs.google.com/document/d/d2/edit',
            generated_at: '2026-11-28T20:00:00Z',
            grounded_bullets: [
              {
                id: 'b1',
                source_file: 'profile/experience.md',
                section: 'Experience',
                text: 'Cut p99 API latency by 40%.',
                relevance_note: 'Directly matches reliability goal.',
              },
            ],
          });
        }
        return json({ error: 'not found' }, 404);
      }),
    );

    renderWithQuery(<RoleDetailSheet jobId="job-1" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Tailor docs' })).toBeTruthy());
    fireEvent.click(screen.getByRole('tab', { name: 'Tailor docs' }));

    const btn = await screen.findByRole('button', { name: /Tailor to Google Docs/ });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(btn);

    await waitFor(() =>
      expect(screen.getByRole('link', { name: /Open Tailored Resume Doc/ })).toBeTruthy(),
    );
    expect(screen.getByRole('link', { name: /Open Tailored Cover Letter Doc/ })).toBeTruthy();
    expect(screen.getByText('Cut p99 API latency by 40%.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Regenerate Docs/ })).toBeTruthy();
  });

  it('shows inline error alert when tailor returns 409 GOOGLE_NOT_CONNECTED', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        if (url === '/api/jobs/job-1') return json(emptyDetail);
        if (url === '/api/jobs/job-1/tailor' && init.method === 'POST') {
          return json({ error: 'Google not connected', code: 'GOOGLE_NOT_CONNECTED' }, 409);
        }
        return json({ error: 'not found' }, 404);
      }),
    );

    renderWithQuery(<RoleDetailSheet jobId="job-1" onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Tailor docs' }));
    fireEvent.click(await screen.findByRole('button', { name: /Tailor to Google Docs/ }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Connect Google in Settings first/i);
  });
});
