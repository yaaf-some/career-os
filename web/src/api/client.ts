import { demoStore } from './demoData';
import type {
  AiUsageResponse,
  CalendarReminder,
  CliTierModel,
  CommuteInfo,
  CommutePreviewRequest,
  CreateSourceRequest,
  GmailDraft,
  GoogleAuthStartResponse,
  GoogleAuthStatusResponse,
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

interface RequestOptions {
  /**
   * Fall back to demo data on 404/5xx (default). AI routes turn this off so a disabled
   * or failing bridge shows its error instead of a fake demo answer.
   */
  fallbackOnServerError?: boolean;
}

/** Error from the API's `{error, code}` body. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  const text = await res.text();
  try {
    const body = JSON.parse(text) as { error?: unknown; code?: unknown };
    if (typeof body.error === 'string') {
      return new ApiError(body.error, res.status, typeof body.code === 'string' ? body.code : null);
    }
  } catch {
    // not JSON
  }
  return new ApiError(text || `API request failed (${res.status})`, res.status, null);
}

async function requestWithFallback<T>(
  path: string,
  init: RequestInit | undefined,
  fallback: () => T | Promise<T>,
  { fallbackOnServerError = true }: RequestOptions = {},
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
      if (fallbackOnServerError && (res.status === 404 || res.status >= 500)) {
        usingDemoFallback = true;
        return fallback();
      }
      throw await toApiError(res);
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

  /** `POST /api/triage/{id}`, then re-reads the job. */
  async triageJob(id: string, payload: TriageActionRequest): Promise<JobSummary> {
    let fellBack = false;
    const res = await requestWithFallback<unknown>(
      `/api/triage/${encodeURIComponent(id)}`,
      { method: 'POST', body: JSON.stringify(toTriageRequest(payload)) },
      () => {
        fellBack = true;
        return demoStore.triageJob(id, payload);
      },
    );
    if (fellBack) return res as JobSummary;
    return careerApi.getJob(id);
  },

  /** Deep (neon) evaluation via `POST /api/ai/evaluate/{id}`, then re-reads the job. */
  async evaluateJob(id: string): Promise<JobDetail> {
    let fellBack = false;
    const res = await requestWithFallback<unknown>(
      `/api/ai/evaluate/${encodeURIComponent(id)}`,
      { method: 'POST', body: JSON.stringify({ tier: 'neon' }) },
      () => {
        fellBack = true;
        return demoStore.evaluateJob(id);
      },
      { fallbackOnServerError: false },
    );
    if (fellBack) return res as JobDetail;
    return careerApi.getJob(id);
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

  /** Builds settings from `GET /api/settings`; only `ai_routing` is stored server-side so far. */
  async getSettings(): Promise<SettingsState> {
    let fellBack = false;
    const res = await requestWithFallback<unknown>('/api/settings', { method: 'GET' }, () => {
      fellBack = true;
      return demoStore.getSettings();
    });
    if (fellBack) return res as SettingsState;
    return settingsFromApi(res as ApiSettingsList);
  },

  /** Tier routing is saved with `PUT /api/settings/ai_routing` (full object). */
  async updateSettings(payload: UpdateSettingsRequest): Promise<SettingsState> {
    const touchesRouting =
      payload.hydrogenPrimaryCli !== undefined ||
      payload.neonPrimaryCli !== undefined ||
      payload.autoFailover !== undefined;
    if (!touchesRouting) {
      // Commute preferences have no API yet (demo store only).
      return demoStore.updateSettings(payload);
    }
    const current = await careerApi.getSettings();
    const value: AiRoutingSetting = {
      hydrogenPrimary: payload.hydrogenPrimaryCli ?? current.hydrogenPrimaryCli,
      neonPrimary: payload.neonPrimaryCli ?? current.neonPrimaryCli,
      autoFailover: payload.autoFailover ?? current.autoFailover,
    };
    let fellBack = false;
    const res = await requestWithFallback<unknown>(
      '/api/settings/ai_routing',
      { method: 'PUT', body: JSON.stringify({ value }) },
      () => {
        fellBack = true;
        return demoStore.updateSettings(payload);
      },
    );
    if (fellBack) return res as SettingsState;
    return careerApi.getSettings();
  },

  async getGoogleAuthStatus(): Promise<GoogleAuthStatusResponse> {
    const raw = await requestWithFallback<Record<string, unknown>>(
      '/api/auth/google/status',
      { method: 'GET' },
      () => demoStore.getGoogleAuthStatus() as unknown as Record<string, unknown>,
    );
    return {
      connected: Boolean(raw.connected),
      authMode: String(raw.auth_mode ?? raw.authMode ?? 'testing'),
      accountEmail: (raw.account_email ?? raw.accountEmail ?? null) as string | null,
      connectedAt: (raw.connected_at ?? raw.connectedAt ?? null) as string | null,
      testingExpiresAt: (raw.testing_expires_at ?? raw.testingExpiresAt ?? null) as string | null,
      hoursRemaining:
        typeof (raw.hours_remaining ?? raw.hoursRemaining) === 'number'
          ? Number(raw.hours_remaining ?? raw.hoursRemaining)
          : null,
      needsReconnect: Boolean(raw.needs_reconnect ?? raw.needsReconnect ?? false),
      expiresAt: (raw.expires_at ?? raw.expiresAt ?? null) as string | null,
      oauthConfigured: Boolean(raw.oauth_configured ?? raw.oauthConfigured ?? false),
      encryptionConfigured: Boolean(
        raw.encryption_configured ?? raw.encryptionConfigured ?? false,
      ),
    };
  },

  async startGoogleAuth(): Promise<GoogleAuthStartResponse> {
    const raw = await requestWithFallback<Record<string, unknown>>(
      '/api/auth/google/url',
      { method: 'GET' },
      () => demoStore.startGoogleAuth() as unknown as Record<string, unknown>,
    );
    return {
      authUrl: String(raw.url ?? raw.authUrl ?? ''),
      state: String(raw.state ?? ''),
    };
  },

  async getJobCommute(id: string): Promise<CommuteInfo> {
    const raw = await requestWithFallback<Record<string, unknown>>(
      `/api/jobs/${encodeURIComponent(id)}/commute`,
      { method: 'GET' },
      () => demoStore.getJobCommute(id) as unknown as Record<string, unknown>,
    );
    return normalizeCommute(raw);
  },

  async previewCommute(payload: CommutePreviewRequest): Promise<CommuteInfo> {
    const raw = await requestWithFallback<Record<string, unknown>>(
      '/api/commute/preview',
      {
        method: 'POST',
        body: JSON.stringify({
          origin_area: payload.originArea,
          destination: payload.destination,
          travel_mode: payload.travelMode,
        }),
      },
      () => demoStore.previewCommute(payload) as unknown as Record<string, unknown>,
    );
    return normalizeCommute(raw);
  },
};

function normalizeCommute(raw: Record<string, unknown>): CommuteInfo {
  const dist = raw.distance_miles ?? raw.distanceMiles;
  const dur = raw.duration_minutes ?? raw.durationMinutes;
  return {
    isRemote: Boolean(raw.is_remote ?? raw.isRemote ?? false),
    configured: Boolean(raw.configured ?? false),
    originArea: (raw.origin_area ?? raw.originArea ?? null) as string | null,
    destinationQuery: (raw.destination_query ?? raw.destinationQuery ?? null) as string | null,
    resolvedAddress: (raw.resolved_address ?? raw.resolvedAddress ?? null) as string | null,
    distanceMiles: typeof dist === 'number' ? dist : null,
    durationMinutes: typeof dur === 'number' ? dur : null,
    travelMode: String(raw.travel_mode ?? raw.travelMode ?? 'drive'),
    estimateSource: (raw.estimate_source ?? raw.estimateSource ?? null) as string | null,
    cached: Boolean(raw.cached ?? false),
    mapsUrl: (raw.maps_url ?? raw.mapsUrl ?? null) as string | null,
  };
}

/** API triage actions (`TriageAction` in crates/api). */
type ApiTriageAction = 'shortlist' | 'skip' | 'blacklist' | 'restore';

export function toTriageRequest(payload: TriageActionRequest): { action: ApiTriageAction } {
  const map: Record<TriageActionRequest['action'], ApiTriageAction> = {
    approve: 'shortlist',
    shortlist: 'shortlist',
    skip: 'skip',
    reject: 'blacklist',
  };
  return { action: map[payload.action] };
}

/** Value of the `ai_routing` setting (validated by the API). */
export interface AiRoutingSetting {
  hydrogenPrimary: CliTierModel;
  neonPrimary: CliTierModel;
  autoFailover: boolean;
}

interface ApiSettingsList {
  settings: { key: string; value_json: string; updated_at: string }[];
}

const DEFAULT_ROUTING: AiRoutingSetting = {
  hydrogenPrimary: 'claude',
  neonPrimary: 'claude',
  autoFailover: true,
};

function isCli(v: unknown): v is CliTierModel {
  return v === 'claude' || v === 'agy';
}

export function settingsFromApi(list: ApiSettingsList): SettingsState {
  let routing = DEFAULT_ROUTING;
  const row = list.settings?.find((s) => s.key === 'ai_routing');
  if (row) {
    try {
      const v = JSON.parse(row.value_json) as Partial<AiRoutingSetting>;
      routing = {
        hydrogenPrimary: isCli(v.hydrogenPrimary) ? v.hydrogenPrimary : DEFAULT_ROUTING.hydrogenPrimary,
        neonPrimary: isCli(v.neonPrimary) ? v.neonPrimary : DEFAULT_ROUTING.neonPrimary,
        autoFailover:
          typeof v.autoFailover === 'boolean' ? v.autoFailover : DEFAULT_ROUTING.autoFailover,
      };
    } catch {
      // keep defaults
    }
  }
  return {
    hydrogenPrimaryCli: routing.hydrogenPrimary,
    neonPrimaryCli: routing.neonPrimary,
    autoFailover: routing.autoFailover,
    // Not stored by the API yet; neutral values instead of demo data.
    googleOAuthConnected: false,
    googleScopes: [],
    linearTeamKey: '',
    linearConnected: false,
    linearIssues: [],
    homeLocationArea: '',
    defaultTravelMode: 'drive',
  };
}
