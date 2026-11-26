export type TriageStatus = 'pending' | 'approved' | 'shortlisted' | 'skipped' | 'rejected';

export type PipelineStage =
  | 'saved'
  | 'applied'
  | 'screen'
  | 'interview'
  | 'offer'
  | 'archived';

export type GmailThreadStatus = 'none' | 'awaiting_reply' | 'reply_received' | 'draft_ready';

export type CliTierModel = 'claude' | 'antigravity' | 'codex' | 'gemini';

export interface HealthResponse {
  ok: boolean;
  service: string;
  version: string;
  demoMode?: boolean;
}

export interface ClaudeUsageWindow {
  percentUsed: number;
  resetAt: string;
}

export interface AntigravityUsage {
  callsUsed: number;
  callsLimit: number;
  cooldownUntil: string | null;
  status: 'ready' | 'cooldown' | 'exhausted';
}

export interface AiUsageResponse {
  claude5h: ClaudeUsageWindow;
  claude7d: ClaudeUsageWindow;
  antigravity: AntigravityUsage;
  updatedAt: string;
}

export interface ScoreBreakdown {
  skills: number;
  level: number;
  domain: number;
  logistics: number;
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
  hydrogenScore: number;
  scoreBreakdown: ScoreBreakdown;
  hydrogenSummary: string;
  hasNeonEval: boolean;
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

export interface JobDetail extends JobSummary {
  descriptionText: string;
  requirements: string[];
  neonEval: {
    overallVerdict: string;
    confidence: string;
    evaluatedAt: string;
    blocks: EvalBlock[];
  } | null;
  tailor: TailorArtifacts;
  gmailDraft: GmailDraft | null;
  calendarReminders: CalendarReminder[];
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
  action: 'approve' | 'shortlist' | 'skip' | 'reject';
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
  hydrogenScore: number;
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

export interface JobSource {
  id: string;
  name: string;
  kind: 'greenhouse' | 'ashby' | 'lever' | 'reddit' | 'custom';
  boardUrl: string;
  enabled: boolean;
  lastScannedAt: string | null;
  matchedCount: number;
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

export interface LinearJobIssue {
  key: string;
  title: string;
  state: 'Backlog' | 'Todo' | 'In Progress' | 'In Review' | 'Done';
  priority: 'Urgent' | 'High' | 'Medium' | 'Low';
}

export interface SettingsState {
  hydrogenPrimaryCli: CliTierModel;
  neonPrimaryCli: CliTierModel;
  autoFailover: boolean;
  googleOAuthConnected: boolean;
  googleScopes: string[];
  linearTeamKey: string;
  linearConnected: boolean;
  linearIssues: LinearJobIssue[];
  homeLocationArea: string;
  defaultTravelMode: 'drive' | 'transit';
  mapsConfigured?: boolean;
}

export interface UpdateSettingsRequest {
  hydrogenPrimaryCli?: CliTierModel;
  neonPrimaryCli?: CliTierModel;
  autoFailover?: boolean;
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
