export type TriageStatus = 'pending' | 'shortlisted' | 'skipped' | 'rejected';

export type PipelineStage =
  | 'saved'
  | 'applied'
  | 'screen'
  | 'interview'
  | 'offer'
  | 'archived';

export type GmailThreadStatus = 'none' | 'awaiting_reply' | 'reply_received' | 'draft_ready';

/** Unified routing preference sent to ai-bridge (`auto` balances Claude & Gemini equally). */
export type AiRoutingMode = 'auto' | 'prefer_claude' | 'prefer_agy';

export interface HealthResponse {
  ok: boolean;
  service: string;
  version: string;
  demoMode?: boolean;
}

/** Mirrors the API's `AiUsageResponse` (`GET /api/ai/usage`). */
export interface ClaudeUsageWindow {
  /** 0–100, or null when Claude Code didn't report it. */
  percentUsed: number | null;
  /** RFC 3339, or null. */
  resetAt: string | null;
}

export interface AntigravityUsage {
  /** agy calls recorded in the last 24 h. */
  callsUsed: number;
  /** Optional daily budget (`AI_AGY_DAILY_CALL_LIMIT`). */
  callsLimit: number | null;
  cooldownUntil: string | null;
  status: 'ready' | 'cooldown' | 'exhausted';
}

export interface AiUsageTierStat {
  tier: string;
  totalCalls: number;
  successfulCalls: number;
  avgLatencyMs: number;
}

export interface AiUsageResponse {
  /** False when no AI bridge is configured. */
  configured: boolean;
  bridgeReachable: boolean;
  /** When Claude Code last wrote its statusline. */
  updatedAt: string | null;
  claude5h: ClaudeUsageWindow | null;
  claude7d: ClaudeUsageWindow | null;
  /** True when there is no fresh Claude usage data. */
  claudeStale: boolean;
  antigravity: AntigravityUsage;
  dbStatsByTier: AiUsageTierStat[];
}

export interface ScoreBreakdown {
  roleStack: number;
  levelReachability: number;
  vibeCulture: number;
  logisticsComp: number;
}

export interface JobSummary {
  id: string;
  title: string;
  company: string;
  location: string;
  remotePolicy: string;
  compensation: string | null;
  source: string;
  url: string;
  triageStatus: TriageStatus;
  stage: PipelineStage;
  /** False until the job has an application (saved or later). */
  inPipeline: boolean;
  tags: string[];
  postedAt: string | null;
  archivedAt: string | null;
  /** 0–100; null until fast triage scoring has run. */
  matchScore: number | null;
  /** Null for legacy scored rows without a 4-dimension breakdown. */
  scoreBreakdown: ScoreBreakdown | null;
  /** Set when a hard dealbreaker triggered during triage scoring. */
  dealbreakerReason?: string | null;
  matchSummary: string;
  hasDescription: boolean;
  /** Cleaned posting text. Untrusted: render it as text only. */
  descriptionText?: string;
  hasDeepEval: boolean;
  gmailStatus: GmailThreadStatus;
  nextFollowUpAt: string | null;
  discoveredAt: string;
}

export interface EvalBlock {
  block: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';
  title: string;
  rating: string;
  summary: string;
  highlights: string[];
}

export interface TailorEvidenceBullet {
  id: string;
  sourceFile: string;
  section: string;
  text: string;
  relevanceNote: string;
}

export interface TailorArtifacts {
  resumeDocUrl: string | null;
  coverLetterDocUrl: string | null;
  generatedAt: string | null;
  groundedBullets: TailorEvidenceBullet[];
}

export interface GmailDraft {
  id: string;
  to: string;
  subject: string;
  body: string;
  confirmed: boolean;
  updatedAt: string;
}

export interface CalendarReminder {
  id: string;
  title: string;
  startsAt: string;
  notes: string;
}

/** A Gmail thread linked to the job's application (live API only). */
export interface GmailThreadSummary {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  snippet: string;
  needsReply: boolean;
  lastMessageAt: string | null;
  linkSource: 'auto' | 'manual';
}

export interface JobDetail extends JobSummary {
  descriptionText: string;
  requirements: string[];
  deepEval: {
    overallVerdict: string;
    confidence: string | null;
    evaluatedAt: string;
    /** Host CLI and model that ran the evaluation (live API only). */
    provider?: string | null;
    model?: string;
    blocks: EvalBlock[];
  } | null;
  tailor: TailorArtifacts;
  gmailDraft: GmailDraft | null;
  calendarReminders: CalendarReminder[];
  gmailThreads: GmailThreadSummary[];
}

export interface TodayReplyItem {
  jobId: string;
  company: string;
  role: string;
  sender: string;
  snippet: string;
  receivedAt: string;
}

export interface TodayAgendaItem {
  id: string;
  jobId: string | null;
  title: string;
  startsAt: string;
  endsAt: string;
  locationOrLink: string;
}

export interface TodayFollowUpItem {
  jobId: string;
  company: string;
  role: string;
  dueAt: string;
  overdue: boolean;
  stage: PipelineStage;
}

export interface TodayResponse {
  dateLabel: string;
  unreadReplies: TodayReplyItem[];
  agenda: TodayAgendaItem[];
  followUpsDue: TodayFollowUpItem[];
  topMatches: JobSummary[];
}

export interface JobsListResponse {
  jobs: JobSummary[];
  total: number;
}

export interface TriageActionRequest {
  action: 'shortlist' | 'skip' | 'reject' | 'restore';
  reason?: string;
}

export interface QuickAddJobRequest {
  url: string;
  title?: string;
  company?: string;
}

export interface TailorResponse {
  jobId: string;
  tailor: TailorArtifacts;
}

export interface TrackerEntry {
  jobId: string;
  company: string;
  title: string;
  stage: PipelineStage;
  matchScore: number | null;
  gmailStatus: GmailThreadStatus;
  threadSubject: string | null;
  lastActivityAt: string;
  nextFollowUpAt: string | null;
  notes: string;
}

export interface TrackerResponse {
  entries: TrackerEntry[];
}

export interface UpdateTrackerRequest {
  jobId: string;
  stage?: PipelineStage;
  nextFollowUpAt?: string | null;
  notes?: string;
}

/** One background sync run (`GET /api/sync-runs`). */
export interface SyncRun {
  id: string;
  runType: string;
  status: 'running' | 'succeeded' | 'partial' | 'failed';
  itemsFetched: number;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface JobSource {
  id: string;
  name: string;
  kind: 'greenhouse' | 'ashby' | 'lever' | 'reddit' | 'custom';
  boardUrl: string;
  enabled: boolean;
  lastScannedAt: string | null;
  matchedCount: number;
  /** Last scan error for this source (live API only). */
  lastError?: string | null;
}

export interface FilteredAuditEntry {
  id: string;
  title: string;
  company: string;
  sourceName: string;
  rule: string;
  reason: string;
  filteredAt: string;
}

export interface SourcesResponse {
  sources: JobSource[];
  filteredAudit: FilteredAuditEntry[];
}

export interface CreateSourceRequest {
  name: string;
  kind: JobSource['kind'];
  boardUrl: string;
}

export interface ScanSourcesResponse {
  scannedSources: number;
  newMatches: number;
  filteredOut: number;
  ranAt: string;
}

/** An application with a Linear issue (identifier stored by the API, e.g. `JOB-42`). */
export interface LinearJobIssue {
  key: string;
  jobId: string;
  company: string;
  title: string;
}

/** `GET /api/integrations/linear`. */
export interface LinearStatus {
  configured: boolean;
  teamKey: string | null;
  issues: LinearJobIssue[];
}

export interface SettingsState {
  aiRoutingMode: AiRoutingMode;
  googleOAuthConnected: boolean;
  googleScopes: string[];
  homeLocationArea: string;
  defaultTravelMode: 'drive' | 'transit';
  mapsConfigured?: boolean;
}

export interface UpdateSettingsRequest {
  aiRoutingMode?: AiRoutingMode;
  homeLocationArea?: string;
  defaultTravelMode?: 'drive' | 'transit';
}

export interface GoogleAuthStartResponse {
  authUrl: string;
  state: string;
}

export interface GoogleAuthStatusResponse {
  connected: boolean;
  authMode: 'testing' | 'production' | string;
  accountEmail: string | null;
  connectedAt: string | null;
  testingExpiresAt: string | null;
  hoursRemaining: number | null;
  needsReconnect: boolean;
  expiresAt: string | null;
  oauthConfigured: boolean;
  encryptionConfigured: boolean;
  /** Scopes the current grant lacks (e.g. gmail.compose); reconnect to grant them. */
  missingScopes: string[];
}

export interface CommuteInfo {
  isRemote: boolean;
  configured: boolean;
  originArea: string | null;
  destinationQuery: string | null;
  resolvedAddress: string | null;
  distanceMiles: number | null;
  durationMinutes: number | null;
  travelMode: string;
  estimateSource: 'routes_api' | 'places_haversine' | 'remote' | 'unconfigured' | string | null;
  cached: boolean;
  mapsUrl: string | null;
}

export interface CommutePreviewRequest {
  originArea?: string;
  destination: string;
  travelMode?: 'drive' | 'transit';
}

export interface ScoringWeights {
  role_stack: number;
  level_reachability: number;
  vibe_culture: number;
  logistics_comp: number;
}

export interface ProfileFileStatus {
  name: string;
  path: string;
  status: string;
  updatedAt: string | null;
  useIn: string[];
}

export interface ProfileTargetingSummary {
  primaryRoles: string[];
  secondaryRoles: string[];
  levelLabel: string | null;
  maxYoe: number | null;
  weights: ScoringWeights;
  dealbreakerCount: number;
  boostCount: number;
}

export interface ProjectDocSummary {
  id: string;
  title: string;
  driveUrl: string | null;
  modifiedTime: string | null;
  digested: boolean;
  syncedAt: string;
}

export interface ProfileStatusResponse {
  loaded: boolean;
  dataDir: string;
  driveProjectsFolderConfigured: boolean;
  files: ProfileFileStatus[];
  targeting: ProfileTargetingSummary | null;
  projectDocs: ProjectDocSummary[];
  warnings: string[];
}

export interface SyncProjectDocsResponse {
  docsSynced: number;
  docsDigested: number;
  skippedUnchanged: number;
}

export interface RescoreRequest {
  includeSkipped?: boolean;
  scoreLimit?: number;
}

export interface RescoreResponse {
  resetCount: number;
  scored: number;
  provider: string | null;
  model: string | null;
}
