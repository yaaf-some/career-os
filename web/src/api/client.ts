import { demoStore } from './demoData';
import type {
  AiUsageResponse,
  CalendarReminder,
  CreateSourceRequest,
  GmailDraft,
  GoogleAuthStartResponse,
  HealthResponse,
  JobDetail,
  JobSource,
  JobsListResponse,
  JobSummary,
  QuickAddJobRequest,
  ScanSourcesResponse,
  SettingsState,
  SourcesResponse,
  TailorResponse,
  TodayResponse,
  TrackerResponse,
  TriageActionRequest,
  UpdateSettingsRequest,
  UpdateTrackerRequest,
} from './types';

let usingDemoFallback = false;

export function isDemoModeActive(): boolean {
  return usingDemoFallback;
}

async function requestWithFallback<T>(
  path: string,
  init: RequestInit | undefined,
  fallback: () => T | Promise<T>,
): Promise<T> {
  if (import.meta.env.VITE_DEMO_MODE === 'true') {
    usingDemoFallback = true;
    return fallback();
  }

  try {
    const res = await fetch(path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });

    if (!res.ok) {
      if (res.status === 404 || res.status >= 500) {
        usingDemoFallback = true;
        return fallback();
      }
      const message = await res.text();
      throw new Error(message || `API request failed (${res.status})`);
    }

    usingDemoFallback = false;
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof TypeError || (err instanceof Error && /fetch|network/i.test(err.message))) {
      usingDemoFallback = true;
      return fallback();
    }
    throw err;
  }
}

export const careerApi = {
  healthz(): Promise<HealthResponse> {
    return requestWithFallback('/api/healthz', { method: 'GET' }, () => ({
      ok: true,
      service: 'career-os-demo',
      version: '0.1.0',
      demoMode: true,
    }));
  },

  getAiUsage(): Promise<AiUsageResponse> {
    return requestWithFallback('/api/ai/usage', { method: 'GET' }, () => demoStore.getUsage());
  },

  getToday(): Promise<TodayResponse> {
    return requestWithFallback('/api/today', { method: 'GET' }, () => demoStore.getToday());
  },

  listJobs(): Promise<JobsListResponse> {
    return requestWithFallback('/api/jobs', { method: 'GET' }, () => {
      const jobs = demoStore.listJobs();
      return { jobs, total: jobs.length };
    });
  },

  quickAddJob(payload: QuickAddJobRequest): Promise<JobSummary> {
    return requestWithFallback(
      '/api/jobs',
      { method: 'POST', body: JSON.stringify(payload) },
      () => demoStore.quickAddJob(payload),
    );
  },

  getJob(id: string): Promise<JobDetail> {
    return requestWithFallback(`/api/jobs/${encodeURIComponent(id)}`, { method: 'GET' }, () => {
      const found = demoStore.getJob(id);
      if (!found) throw new Error(`Job ${id} not found`);
      return found;
    });
  },

  triageJob(id: string, payload: TriageActionRequest): Promise<JobSummary> {
    return requestWithFallback(
      `/api/jobs/${encodeURIComponent(id)}/triage`,
      { method: 'POST', body: JSON.stringify(payload) },
      () => demoStore.triageJob(id, payload),
    );
  },

  evaluateJob(id: string): Promise<JobDetail> {
    return requestWithFallback(
      `/api/jobs/${encodeURIComponent(id)}/evaluate`,
      { method: 'POST', body: JSON.stringify({}) },
      () => demoStore.evaluateJob(id),
    );
  },

  tailorJob(id: string): Promise<TailorResponse> {
    return requestWithFallback(
      `/api/jobs/${encodeURIComponent(id)}/tailor`,
      { method: 'POST', body: JSON.stringify({}) },
      () => demoStore.tailorJob(id),
    );
  },

  saveEmailDraft(
    id: string,
    payload: Pick<GmailDraft, 'to' | 'subject' | 'body' | 'confirmed'>,
  ): Promise<JobDetail> {
    return requestWithFallback(
      `/api/jobs/${encodeURIComponent(id)}/email-draft`,
      { method: 'POST', body: JSON.stringify(payload) },
      () => demoStore.saveEmailDraft(id, payload),
    );
  },

  addCalendarReminder(
    id: string,
    payload: Pick<CalendarReminder, 'title' | 'startsAt' | 'notes'>,
  ): Promise<JobDetail> {
    return requestWithFallback(
      `/api/jobs/${encodeURIComponent(id)}/calendar-reminder`,
      { method: 'POST', body: JSON.stringify(payload) },
      () => demoStore.addCalendarReminder(id, payload),
    );
  },

  getTracker(): Promise<TrackerResponse> {
    return requestWithFallback('/api/tracker', { method: 'GET' }, () => demoStore.getTracker());
  },

  updateTracker(payload: UpdateTrackerRequest): Promise<TrackerResponse> {
    return requestWithFallback(
      '/api/tracker',
      { method: 'PATCH', body: JSON.stringify(payload) },
      () => demoStore.updateTracker(payload),
    );
  },

  getSources(): Promise<SourcesResponse> {
    return requestWithFallback('/api/sources', { method: 'GET' }, () => demoStore.getSources());
  },

  createSource(payload: CreateSourceRequest): Promise<JobSource> {
    return requestWithFallback(
      '/api/sources',
      { method: 'POST', body: JSON.stringify(payload) },
      () => demoStore.addSource(payload),
    );
  },

  scanSources(): Promise<ScanSourcesResponse> {
    return requestWithFallback(
      '/api/sources/scan',
      { method: 'POST', body: JSON.stringify({}) },
      () => demoStore.scanSources(),
    );
  },

  getSettings(): Promise<SettingsState> {
    return requestWithFallback('/api/settings', { method: 'GET' }, () => demoStore.getSettings());
  },

  updateSettings(payload: UpdateSettingsRequest): Promise<SettingsState> {
    return requestWithFallback(
      '/api/settings',
      { method: 'PATCH', body: JSON.stringify(payload) },
      () => demoStore.updateSettings(payload),
    );
  },

  startGoogleAuth(): Promise<GoogleAuthStartResponse> {
    return requestWithFallback(
      '/api/auth/google/start',
      { method: 'POST', body: JSON.stringify({}) },
      () => ({
        authUrl: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=demo-client&scope=gmail.compose+calendar.events+documents',
        state: 'demo-oauth-state',
      }),
    );
  },
};
