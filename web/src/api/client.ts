import { demoStore } from './demoData';
import {
  jobDetailFromApi,
  jobsListFromApi,
  jobSummaryFromApi,
  todayFromApi,
  trackerFromApi,
  trackerPatchToApi,
} from './jobs';
import { scanFromApi, sourceCreateToApi, sourceFromApi, sourcesFromApi } from './jobs';
import type {
  ApiSourceRecord,
  ApiJobDetailResponse,
  ApiJobRecord,
  ApiListJobsResponse,
  ApiTodayResponse,
  ApiTrackerEntry,
} from './jobs';
import type {
  AiRoutingMode,
  AiUsageResponse,
  CalendarReminder,
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
  LinearStatus,
  ProfileStatusResponse,
  QuickAddJobRequest,
  RescoreRequest,
  RescoreResponse,
  ScanSourcesResponse,
  SettingsState,
  SourcesResponse,
  SyncProjectDocsResponse,
  SyncRun,
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

/** One-line message for a failed Google call (sync, draft, reminder). */
export function describeGoogleError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'GOOGLE_NOT_CONNECTED':
        return 'Connect Google in Settings first.';
      case 'GOOGLE_RECONNECT_REQUIRED':
        return 'Reconnect Google in Settings to allow Gmail drafts and Calendar events.';
      case 'SYNC_IN_PROGRESS':
        return 'A sync is already running.';
      case 'DRIVE_FOLDER_NOT_CONFIGURED':
        return 'Set GOOGLE_DRIVE_PROJECTS_FOLDER_ID in .env to sync Project Reports.';
      default:
        return err.message;
    }
  }
  return err instanceof Error ? err.message : 'Google request failed';
}

/** One-line message for a failed AI call, e.g. when the bridge is disabled or busy. */
export function describeAiError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'SERVICE_UNAVAILABLE' && /not configured/i.test(err.message)) {
      return 'AI is not configured: set up the host ai-bridge (README §3).';
    }
    return err.code ? `${err.message} (${err.code})` : err.message;
  }
  return err instanceof Error ? err.message : 'AI request failed';
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

/** Routes the API implements: show real errors, never demo data, outside demo mode. */
const LIVE_ONLY: RequestOptions = { fallbackOnServerError: false };

interface ApiSyncRun {
  id: string;
  run_type: string;
  status: SyncRun['status'];
  items_fetched: number;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
}

function syncRunFromApi(r: ApiSyncRun): SyncRun {
  return {
    id: r.id,
    runType: r.run_type,
    status: r.status,
    itemsFetched: r.items_fetched,
    errorMessage: r.error_message,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  };
}

function demoSyncRun(): ApiSyncRun {
  const now = new Date().toISOString();
  return {
    id: 'demo-sync',
    run_type: 'gmail_sync',
    status: 'succeeded',
    items_fetched: 0,
    error_message: null,
    started_at: now,
    finished_at: now,
  };
}

export const careerApi = {
  /** `GET /healthz` (API: `{status, service, version, db_ok}`). */
  async healthz(): Promise<HealthResponse> {
    const raw = await requestWithFallback<Record<string, unknown>>('/healthz', { method: 'GET' }, () => ({
      ok: true,
      service: 'career-os-demo',
      version: '0.1.0',
      demoMode: true,
    }));
    if ('demoMode' in raw) return raw as unknown as HealthResponse;
    return {
      ok: raw.status === 'ok' && raw.db_ok !== false,
      service: String(raw.service ?? ''),
      version: String(raw.version ?? ''),
    };
  },

  getAiUsage(): Promise<AiUsageResponse> {
    // No demo numbers on a live API error: the bar renders nothing instead.
    return requestWithFallback('/api/ai/usage', { method: 'GET' }, () => demoStore.getUsage(), {
      fallbackOnServerError: false,
    });
  },

  async getToday(): Promise<TodayResponse> {
    let fellBack = false;
    const res = await requestWithFallback<unknown>(
      '/api/today',
      { method: 'GET' },
      () => {
        fellBack = true;
        return demoStore.getToday();
      },
      LIVE_ONLY,
    );
    return fellBack ? (res as TodayResponse) : todayFromApi(res as ApiTodayResponse);
  },

  async listJobs(): Promise<JobsListResponse> {
    let fellBack = false;
    const res = await requestWithFallback<unknown>(
      '/api/jobs',
      { method: 'GET' },
      () => {
        fellBack = true;
        const jobs = demoStore.listJobs();
        return { jobs, total: jobs.length };
      },
      LIVE_ONLY,
    );
    return fellBack ? (res as JobsListResponse) : jobsListFromApi(res as ApiListJobsResponse);
  },

  async quickAddJob(payload: QuickAddJobRequest): Promise<JobSummary> {
    let fellBack = false;
    const res = await requestWithFallback<unknown>(
      '/api/jobs',
      { method: 'POST', body: JSON.stringify(payload) },
      () => {
        fellBack = true;
        return demoStore.quickAddJob(payload);
      },
      LIVE_ONLY,
    );
    return fellBack ? (res as JobSummary) : jobSummaryFromApi(res as ApiJobRecord);
  },

  async getJob(id: string): Promise<JobDetail> {
    let fellBack = false;
    const res = await requestWithFallback<unknown>(
      `/api/jobs/${encodeURIComponent(id)}`,
      { method: 'GET' },
      () => {
        fellBack = true;
        const found = demoStore.getJob(id);
        if (!found) throw new Error(`Job ${id} not found`);
        return found;
      },
      LIVE_ONLY,
    );
    return fellBack ? (res as JobDetail) : jobDetailFromApi(res as ApiJobDetailResponse);
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
      LIVE_ONLY,
    );
    if (fellBack) return res as JobSummary;
    return careerApi.getJob(id);
  },

  /** Deep A–G evaluation via `POST /api/ai/evaluate/{id}` (auto-escalates >= 75), then re-reads the job. */
  async evaluateJob(id: string): Promise<JobDetail> {
    let fellBack = false;
    const res = await requestWithFallback<unknown>(
      `/api/ai/evaluate/${encodeURIComponent(id)}`,
      { method: 'POST', body: JSON.stringify({}) },
      () => {
        fellBack = true;
        return demoStore.evaluateJob(id);
      },
      { fallbackOnServerError: false },
    );
    if (fellBack) return res as JobDetail;
    return careerApi.getJob(id);
  },

  /** Route not implemented yet (JOB-12): keeps the demo fallback until it ships. */
  tailorJob(id: string): Promise<TailorResponse> {
    return requestWithFallback(
      `/api/jobs/${encodeURIComponent(id)}/tailor`,
      { method: 'POST', body: JSON.stringify({}) },
      () => demoStore.tailorJob(id),
    );
  },

  /** Saves the draft; with `confirmed` it also goes to Gmail Drafts. Never sends. */
  async saveEmailDraft(
    id: string,
    payload: Pick<GmailDraft, 'to' | 'subject' | 'body' | 'confirmed'>,
  ): Promise<JobDetail> {
    let fellBack = false;
    const res = await requestWithFallback<unknown>(
      `/api/jobs/${encodeURIComponent(id)}/email-draft`,
      { method: 'POST', body: JSON.stringify(payload) },
      () => {
        fellBack = true;
        return demoStore.saveEmailDraft(id, payload);
      },
      LIVE_ONLY,
    );
    return fellBack ? (res as JobDetail) : jobDetailFromApi(res as ApiJobDetailResponse);
  },

  /** Creates a Google Calendar event (30 min) linked to the job. */
  async addCalendarReminder(
    id: string,
    payload: Pick<CalendarReminder, 'title' | 'startsAt' | 'notes'>,
  ): Promise<JobDetail> {
    let fellBack = false;
    const res = await requestWithFallback<unknown>(
      `/api/jobs/${encodeURIComponent(id)}/calendar-reminder`,
      { method: 'POST', body: JSON.stringify(payload) },
      () => {
        fellBack = true;
        return demoStore.addCalendarReminder(id, payload);
      },
      LIVE_ONLY,
    );
    return fellBack ? (res as JobDetail) : jobDetailFromApi(res as ApiJobDetailResponse);
  },

  async getTracker(): Promise<TrackerResponse> {
    let fellBack = false;
    const res = await requestWithFallback<unknown>(
      '/api/tracker',
      { method: 'GET' },
      () => {
        fellBack = true;
        return demoStore.getTracker();
      },
      LIVE_ONLY,
    );
    return fellBack
      ? (res as TrackerResponse)
      : trackerFromApi(res as { entries: ApiTrackerEntry[] });
  },

  /** `POST /api/sync/google`: one Gmail/Calendar sync now (409 when not connected or busy). */
  async syncGoogleNow(): Promise<SyncRun> {
    const raw = await requestWithFallback<ApiSyncRun>(
      '/api/sync/google',
      { method: 'POST' },
      () => demoSyncRun(),
      LIVE_ONLY,
    );
    return syncRunFromApi(raw);
  },

  async getSyncRuns(): Promise<SyncRun[]> {
    const raw = await requestWithFallback<{ runs: ApiSyncRun[] }>(
      '/api/sync-runs',
      { method: 'GET' },
      () => ({ runs: [] }),
      LIVE_ONLY,
    );
    return raw.runs.map(syncRunFromApi);
  },

  async updateTracker(payload: UpdateTrackerRequest): Promise<TrackerResponse> {
    let fellBack = false;
    const res = await requestWithFallback<unknown>(
      '/api/tracker',
      { method: 'PATCH', body: JSON.stringify(trackerPatchToApi(payload)) },
      () => {
        fellBack = true;
        return demoStore.updateTracker(payload);
      },
      LIVE_ONLY,
    );
    return fellBack
      ? (res as TrackerResponse)
      : trackerFromApi(res as { entries: ApiTrackerEntry[] });
  },

  async getSources(): Promise<SourcesResponse> {
    let fellBack = false;
    const res = await requestWithFallback<unknown>(
      '/api/sources',
      { method: 'GET' },
      () => {
        fellBack = true;
        return demoStore.getSources();
      },
      LIVE_ONLY,
    );
    return fellBack
      ? (res as SourcesResponse)
      : sourcesFromApi(res as Parameters<typeof sourcesFromApi>[0]);
  },

  async createSource(payload: CreateSourceRequest): Promise<JobSource> {
    let fellBack = false;
    const res = await requestWithFallback<unknown>(
      '/api/sources',
      { method: 'POST', body: JSON.stringify(sourceCreateToApi(payload)) },
      () => {
        fellBack = true;
        return demoStore.addSource(payload);
      },
      LIVE_ONLY,
    );
    return fellBack ? (res as JobSource) : sourceFromApi(res as ApiSourceRecord);
  },

  /** Turns scanning on or off for one source (`PATCH /api/sources/{id}`). */
  async setSourceEnabled(id: string, enabled: boolean): Promise<JobSource> {
    let fellBack = false;
    const res = await requestWithFallback<unknown>(
      `/api/sources/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: JSON.stringify({ enabled }) },
      () => {
        fellBack = true;
        return demoStore.setSourceEnabled(id, enabled);
      },
      LIVE_ONLY,
    );
    return fellBack ? (res as JobSource) : sourceFromApi(res as ApiSourceRecord);
  },

  /** Scans every enabled source through the scanner's filters (`POST /api/sources/scan`). */
  async scanSources(): Promise<ScanSourcesResponse> {
    let fellBack = false;
    const res = await requestWithFallback<unknown>(
      '/api/sources/scan',
      { method: 'POST', body: JSON.stringify({}) },
      () => {
        fellBack = true;
        return demoStore.scanSources();
      },
      LIVE_ONLY,
    );
    return fellBack
      ? (res as ScanSourcesResponse)
      : scanFromApi(res as Parameters<typeof scanFromApi>[0]);
  },

  /** Builds settings from `GET /api/settings`; only `ai_routing` is stored server-side so far. */
  async getSettings(): Promise<SettingsState> {
    let fellBack = false;
    const res = await requestWithFallback<unknown>(
      '/api/settings',
      { method: 'GET' },
      () => {
        fellBack = true;
        return demoStore.getSettings();
      },
      LIVE_ONLY,
    );
    if (fellBack) return res as SettingsState;
    return settingsFromApi(res as ApiSettingsList);
  },

  /**
   * Saves each field present: `ai_routing` ({mode}), `home_location_area` and
   * `travel_mode` (JSON strings read by the commute routes), then re-reads.
   */
  async updateSettings(payload: UpdateSettingsRequest): Promise<SettingsState> {
    const writes: [string, unknown][] = [];
    if (payload.aiRoutingMode !== undefined) {
      writes.push([AI_ROUTING_KEY, { mode: payload.aiRoutingMode } satisfies AiRoutingSetting]);
    }
    const home = payload.homeLocationArea?.trim();
    if (home) writes.push([HOME_LOCATION_AREA_KEY, home]);
    if (payload.defaultTravelMode) writes.push([TRAVEL_MODE_KEY, payload.defaultTravelMode]);
    if (writes.length === 0) return careerApi.getSettings();

    let fellBack = false;
    for (const [key, value] of writes) {
      await requestWithFallback<unknown>(
        `/api/settings/${key}`,
        { method: 'PUT', body: JSON.stringify({ value }) },
        () => {
          fellBack = true;
          return null;
        },
        LIVE_ONLY,
      );
      if (fellBack) return demoStore.updateSettings(payload);
    }
    return careerApi.getSettings();
  },

  /** `GET /api/integrations/linear`: configured flag, team key, stored issue identifiers. */
  async getLinearStatus(): Promise<LinearStatus> {
    let fellBack = false;
    const res = await requestWithFallback<unknown>(
      '/api/integrations/linear',
      { method: 'GET' },
      () => {
        fellBack = true;
        return demoStore.getLinearStatus();
      },
      LIVE_ONLY,
    );
    return fellBack ? (res as LinearStatus) : linearStatusFromApi(res as ApiLinearStatus);
  },

  async getGoogleAuthStatus(): Promise<GoogleAuthStatusResponse> {
    const raw = await requestWithFallback<Record<string, unknown>>(
      '/api/auth/google/status',
      { method: 'GET' },
      () => demoStore.getGoogleAuthStatus() as unknown as Record<string, unknown>,
      LIVE_ONLY,
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
      missingScopes: Array.isArray(raw.missing_scopes ?? raw.missingScopes)
        ? ((raw.missing_scopes ?? raw.missingScopes) as unknown[]).filter(
            (s): s is string => typeof s === 'string',
          )
        : [],
    };
  },

  async startGoogleAuth(): Promise<GoogleAuthStartResponse> {
    const raw = await requestWithFallback<Record<string, unknown>>(
      '/api/auth/google/url',
      { method: 'GET' },
      () => demoStore.startGoogleAuth() as unknown as Record<string, unknown>,
      LIVE_ONLY,
    );
    return {
      authUrl: String(raw.url ?? raw.authUrl ?? ''),
      state: String(raw.state ?? ''),
    };
  },

  getProfileStatus(): Promise<ProfileStatusResponse> {
    return requestWithFallback(
      '/api/profile/status',
      { method: 'GET' },
      () => demoStore.getProfileStatus(),
      LIVE_ONLY,
    );
  },

  syncProjectDocs(): Promise<SyncProjectDocsResponse> {
    return requestWithFallback(
      '/api/profile/sync-docs',
      { method: 'POST' },
      () => demoStore.syncProjectDocs(),
      LIVE_ONLY,
    );
  },

  rescoreJobs(payload: RescoreRequest = {}): Promise<RescoreResponse> {
    return requestWithFallback(
      '/api/ai/rescore',
      { method: 'POST', body: JSON.stringify(payload) },
      () => demoStore.rescoreJobs(payload),
      LIVE_ONLY,
    );
  },

  async getJobCommute(id: string): Promise<CommuteInfo> {
    const raw = await requestWithFallback<Record<string, unknown>>(
      `/api/jobs/${encodeURIComponent(id)}/commute`,
      { method: 'GET' },
      () => demoStore.getJobCommute(id) as unknown as Record<string, unknown>,
      LIVE_ONLY,
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
      LIVE_ONLY,
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

/** Setting keys the API validates (`crates/api/src/routes/settings.rs`). */
const AI_ROUTING_KEY = 'ai_routing';
const HOME_LOCATION_AREA_KEY = 'home_location_area';
const TRAVEL_MODE_KEY = 'travel_mode';

/** Value of the `ai_routing` setting (validated by the API). */
export interface AiRoutingSetting {
  mode: AiRoutingMode;
}

interface ApiSettingsList {
  settings: { key: string; value_json: string; updated_at: string }[];
}

const DEFAULT_ROUTING: AiRoutingSetting = {
  mode: 'auto',
};

function isRoutingMode(v: unknown): v is AiRoutingMode {
  return v === 'auto' || v === 'prefer_claude' || v === 'prefer_agy';
}

function parseSettingValue(list: ApiSettingsList, key: string): unknown {
  const row = list.settings?.find((s) => s.key === key);
  if (!row) return undefined;
  try {
    return JSON.parse(row.value_json) as unknown;
  } catch {
    return undefined;
  }
}

export function settingsFromApi(list: ApiSettingsList): SettingsState {
  const routing = parseSettingValue(list, AI_ROUTING_KEY) as Partial<AiRoutingSetting> | undefined;
  const home = parseSettingValue(list, HOME_LOCATION_AREA_KEY);
  const mode = parseSettingValue(list, TRAVEL_MODE_KEY);
  const travel = typeof mode === 'string' ? mode.trim().toLowerCase() : '';
  return {
    aiRoutingMode: isRoutingMode(routing?.mode) ? routing.mode : DEFAULT_ROUTING.mode,
    // Not stored by the API yet; neutral values instead of demo data.
    googleOAuthConnected: false,
    googleScopes: [],
    homeLocationArea: typeof home === 'string' ? home.trim() : '',
    defaultTravelMode: travel === 'transit' ? 'transit' : 'drive',
  };
}

interface ApiLinearStatus {
  configured: boolean;
  team_key: string | null;
  issues: { identifier: string; job_id: string; company: string; title: string; updated_at: string }[];
}

export function linearStatusFromApi(raw: ApiLinearStatus): LinearStatus {
  return {
    configured: Boolean(raw.configured),
    teamKey: raw.team_key ?? null,
    issues: (raw.issues ?? []).map((i) => ({
      key: i.identifier,
      jobId: i.job_id,
      company: i.company,
      title: i.title,
    })),
  };
}
