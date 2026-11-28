/**
 * Maps the API's snake_case job shapes (`crates/api/src/routes/jobs.rs`) to the
 * web's `JobSummary` / `JobDetail`. Fields the API doesn't provide stay null or
 * empty; nothing is invented (docs/trust.md §3–4).
 */
import type {
  EvalBlock,
  FilteredAuditEntry,
  JobSource,
  ScanSourcesResponse,
  SourcesResponse,
  GmailThreadStatus,
  JobDetail,
  JobsListResponse,
  JobSummary,
  PipelineStage,
  ScoreBreakdown,
  TailorEvidenceBullet,
  TailorResponse,
  TodayResponse,
  TrackerEntry,
  TrackerResponse,
  TriageStatus,
  UpdateTrackerRequest,
} from './types';

export interface ApiJobRecord {
  id: string;
  url: string;
  company: string;
  title: string;
  location: string | null;
  workplace_type: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  source_type: string;
  jd_text: string | null;
  triage_status: string;
  tier1_score: number | null;
  tier1_json: string | null;
  created_at: string;
}

export interface ApiEvaluationRecord {
  id: string;
  tier: string;
  model: string;
  provider: string | null;
  overall_score: number | null;
  archetype: string | null;
  blocks_json: string | null;
  created_at: string;
}

export interface ApiApplicationRecord {
  stage: string;
  next_followup_at: string | null;
  gmail_thread_id: string | null;
}

export interface ApiDriveArtifactRecord {
  kind: string;
  drive_url: string;
  created_at: string;
}

export interface ApiListJobsResponse {
  jobs: ApiJobRecord[];
  total: number;
}

export interface ApiGmailThreadRecord {
  id: string;
  thread_id: string;
  subject: string | null;
  from_email: string | null;
  snippet: string | null;
  needs_reply: boolean;
  last_message_at: string | null;
  link_source: string;
}

export interface ApiCalendarEventRecord {
  id: string;
  kind: string;
  title: string;
  starts_at: string;
  ends_at: string;
  html_link: string | null;
  notes: string | null;
}

export interface ApiEmailDraftRecord {
  id: string;
  to_email: string;
  subject: string;
  body: string;
  confirmed: boolean;
  gmail_draft_id: string | null;
  updated_at: string;
}

export interface ApiTailorEvidenceBullet {
  id: string;
  source_file: string;
  section: string;
  text: string;
  relevance_note: string;
}

export interface ApiTailorRunSummary {
  id: string;
  tier: string;
  provider: string;
  model: string;
  grounded_bullets: ApiTailorEvidenceBullet[];
  created_at: string;
}

export interface ApiTailorJobResponse {
  job_id: string;
  tailor_run_id: string;
  tier: string;
  provider: string;
  model: string;
  resume_doc_url: string;
  cover_letter_doc_url: string;
  generated_at: string;
  grounded_bullets: ApiTailorEvidenceBullet[];
}

export interface ApiJobDetailResponse {
  job: ApiJobRecord;
  evaluations: ApiEvaluationRecord[];
  application: ApiApplicationRecord | null;
  drive_artifacts: ApiDriveArtifactRecord[];
  latest_tailor?: ApiTailorRunSummary | null;
  gmail_threads: ApiGmailThreadRecord[];
  calendar_events: ApiCalendarEventRecord[];
  email_draft: ApiEmailDraftRecord | null;
}

const TRIAGE_STATUS: Record<string, TriageStatus> = {
  pending_scoring: 'pending',
  pending_triage: 'pending',
  shortlisted: 'shortlisted',
  skipped: 'skipped',
  blacklisted: 'rejected',
};

const STAGE: Record<string, PipelineStage> = {
  shortlisted: 'saved',
  applied: 'applied',
  recruiter: 'screen',
  interviewing: 'interview',
  offer: 'offer',
  closed: 'archived',
};

const STAGE_TO_API: Record<PipelineStage, string> = {
  saved: 'shortlisted',
  applied: 'applied',
  screen: 'recruiter',
  interview: 'interviewing',
  offer: 'offer',
  archived: 'closed',
};

export function stageFromApi(stage: string): PipelineStage {
  return STAGE[stage] ?? 'saved';
}

/** Reply waiting on you > draft saved > conversation exists > nothing. */
function gmailStatusFrom(threads: { needsReply: boolean }[], hasDraft: boolean): GmailThreadStatus {
  if (threads.some((t) => t.needsReply)) return 'reply_received';
  if (hasDraft) return 'draft_ready';
  return threads.length > 0 ? 'awaiting_reply' : 'none';
}

const BLOCK_TITLES: Record<EvalBlock['block'], string> = {
  A: 'Fit',
  B: 'Gaps',
  C: 'Level',
  D: 'Compensation',
  E: 'CV strategy',
  F: 'Interview prep',
  G: 'Posting integrity',
};

function formatMoney(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

export function formatCompensation(job: ApiJobRecord): string | null {
  const { salary_min: min, salary_max: max } = job;
  if (min == null && max == null) return null;
  const cur = job.salary_currency ? `${job.salary_currency} ` : '';
  if (min != null && max != null)
    return `${cur}${formatMoney(min)}–${formatMoney(max)}`;
  return min != null
    ? `${cur}${formatMoney(min)}+`
    : `${cur}up to ${formatMoney(max as number)}`;
}

function parseJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function triageTier1Fields(job: ApiJobRecord): {
  rationale: string;
  breakdown: ScoreBreakdown | null;
  dealbreakerReason: string | null;
} {
  const parsed = parseJson(job.tier1_json);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { rationale: '', breakdown: null, dealbreakerReason: null };
  }
  const obj = parsed as Record<string, unknown>;
  const rationale = typeof obj.rationale === 'string' ? obj.rationale : '';

  let breakdown: ScoreBreakdown | null = null;
  if (obj.breakdown && typeof obj.breakdown === 'object' && !Array.isArray(obj.breakdown)) {
    const b = obj.breakdown as Record<string, unknown>;
    if (
      typeof b.role_stack === 'number' &&
      typeof b.level_reachability === 'number' &&
      typeof b.vibe_culture === 'number' &&
      typeof b.logistics_comp === 'number'
    ) {
      breakdown = {
        roleStack: Math.round(b.role_stack),
        levelReachability: Math.round(b.level_reachability),
        vibeCulture: Math.round(b.vibe_culture),
        logisticsComp: Math.round(b.logistics_comp),
      };
    }
  }

  let dealbreakerReason: string | null = null;
  if (obj.dealbreaker && typeof obj.dealbreaker === 'object' && !Array.isArray(obj.dealbreaker)) {
    const db = obj.dealbreaker as Record<string, unknown>;
    if (db.triggered === true) {
      dealbreakerReason =
        typeof db.reason === 'string' && db.reason.trim()
          ? db.reason.trim()
          : 'Dealbreaker triggered';
    }
  }

  return { rationale, breakdown, dealbreakerReason };
}

export function jobSummaryFromApi(
  job: ApiJobRecord,
  extra?: { application?: ApiApplicationRecord | null; hasDeepEval?: boolean },
): JobSummary {
  const app = extra?.application ?? null;
  const tier1 = triageTier1Fields(job);
  return {
    id: job.id,
    title: job.title,
    company: job.company,
    location: job.location ?? '',
    remotePolicy: job.workplace_type ?? 'unknown',
    compensation: formatCompensation(job),
    source: job.source_type,
    url: job.url,
    triageStatus: TRIAGE_STATUS[job.triage_status] ?? 'pending',
    stage: app ? stageFromApi(app.stage) : 'saved',
    matchScore: job.tier1_score,
    scoreBreakdown: tier1.breakdown,
    dealbreakerReason: tier1.dealbreakerReason,
    matchSummary: tier1.rationale,
    hasDescription: Boolean(job.jd_text?.trim()),
    hasDeepEval: extra?.hasDeepEval ?? false,
    gmailStatus: app?.gmail_thread_id ? 'awaiting_reply' : 'none',
    nextFollowUpAt: app?.next_followup_at ?? null,
    discoveredAt: job.created_at,
  };
}

export function jobsListFromApi(res: ApiListJobsResponse): JobsListResponse {
  return { jobs: res.jobs.map((j) => jobSummaryFromApi(j)), total: res.total };
}

function strings(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string')
    : [];
}

function firstString(o: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return '';
}

/**
 * `blocks_json` is whatever the model returned for keys A–G: usually strings,
 * sometimes objects. Unknown shapes are skipped; a bad blob yields no blocks.
 */
export function evalBlocksFromJson(raw: string | null): EvalBlock[] {
  const parsed = parseJson(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  const blocks: EvalBlock[] = [];
  for (const key of Object.keys(BLOCK_TITLES) as EvalBlock['block'][]) {
    const v = (parsed as Record<string, unknown>)[key];
    if (typeof v === 'string' && v.trim()) {
      blocks.push({
        block: key,
        title: BLOCK_TITLES[key],
        rating: '',
        summary: v,
        highlights: [],
      });
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      const summary = firstString(o, [
        'summary',
        'verdict',
        'assessment',
        'notes',
        'text',
      ]);
      const highlights = strings(o.highlights ?? o.points ?? o.items);
      const rawRating = o.rating ?? o.score;
      const rating =
        typeof rawRating === 'number'
          ? rawRating.toFixed(1)
          : typeof rawRating === 'string'
            ? rawRating
            : '';
      if (!summary && highlights.length === 0) continue;
      blocks.push({
        block: key,
        title: BLOCK_TITLES[key],
        rating,
        summary,
        highlights,
      });
    }
  }
  return blocks;
}

function newestDeepEval(evals: ApiEvaluationRecord[]): ApiEvaluationRecord | null {
  return (
    evals
      .filter(
        (e) =>
          e.tier === 'deep' ||
          e.tier === 'balanced' ||
          e.tier === 'neon' ||
          e.tier === 'carbon',
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null
  );
}

function verdict(e: ApiEvaluationRecord): string {
  const parts: string[] = [];
  if (e.overall_score != null) parts.push(`${e.overall_score.toFixed(1)} / 5`);
  if (e.archetype) parts.push(e.archetype);
  return parts.join(' · ') || 'Evaluated';
}

function artifactUrl(
  arts: ApiDriveArtifactRecord[],
  kind: string,
): string | null {
  const match = arts
    .filter((a) => a.kind === kind)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  return match?.drive_url ?? null;
}

function tailorBulletsFromApi(bullets: ApiTailorEvidenceBullet[] | undefined): TailorEvidenceBullet[] {
  return (bullets ?? []).map((b) => ({
    id: b.id,
    sourceFile: b.source_file,
    section: b.section,
    text: b.text,
    relevanceNote: b.relevance_note,
  }));
}

export function tailorResponseFromApi(res: ApiTailorJobResponse): TailorResponse {
  return {
    jobId: res.job_id,
    tailor: {
      resumeDocUrl: res.resume_doc_url,
      coverLetterDocUrl: res.cover_letter_doc_url,
      generatedAt: res.generated_at,
      groundedBullets: tailorBulletsFromApi(res.grounded_bullets),
    },
  };
}

export function jobDetailFromApi(res: ApiJobDetailResponse): JobDetail {
  const deep = newestDeepEval(res.evaluations);
  const arts = res.drive_artifacts;
  const resumeDocUrl = artifactUrl(arts, 'resume_doc');
  const coverLetterDocUrl = artifactUrl(arts, 'cover_doc');
  const generated = arts
    .filter((a) => a.kind === 'resume_doc' || a.kind === 'cover_doc')
    .map((a) => a.created_at)
    .sort()
    .at(-1);
  const latestTailor = res.latest_tailor ?? null;
  return {
    ...jobSummaryFromApi(res.job, {
      application: res.application,
      hasDeepEval: deep !== null,
    }),
    descriptionText: res.job.jd_text ?? '',
    requirements: [],
    deepEval: deep
      ? {
          overallVerdict: verdict(deep),
          confidence: null,
          evaluatedAt: deep.created_at,
          provider: deep.provider,
          model: deep.model,
          blocks: evalBlocksFromJson(deep.blocks_json),
        }
      : null,
    tailor: {
      resumeDocUrl,
      coverLetterDocUrl,
      generatedAt: generated ?? latestTailor?.created_at ?? null,
      groundedBullets: tailorBulletsFromApi(latestTailor?.grounded_bullets),
    },
    gmailStatus: gmailStatusFrom(
      res.gmail_threads.map((t) => ({ needsReply: t.needs_reply })),
      res.email_draft !== null,
    ),
    gmailDraft: res.email_draft
      ? {
          id: res.email_draft.id,
          to: res.email_draft.to_email,
          subject: res.email_draft.subject,
          body: res.email_draft.body,
          confirmed: res.email_draft.confirmed,
          updatedAt: res.email_draft.updated_at,
        }
      : null,
    calendarReminders: res.calendar_events.map((e) => ({
      id: e.id,
      title: e.title,
      startsAt: e.starts_at,
      notes: e.notes ?? '',
    })),
    gmailThreads: res.gmail_threads.map((t) => ({
      id: t.id,
      threadId: t.thread_id,
      subject: t.subject ?? '(no subject)',
      from: t.from_email ?? '',
      snippet: t.snippet ?? '',
      needsReply: t.needs_reply,
      lastMessageAt: t.last_message_at,
      linkSource: t.link_source === 'manual' ? 'manual' : 'auto',
    })),
  };
}

// ---- Today / Tracker (JOB-6) ----

export interface ApiTodayResponse {
  date: string;
  unreadReplies: {
    threadId: string;
    jobId: string;
    company: string;
    role: string;
    sender: string;
    subject: string;
    snippet: string;
    receivedAt: string;
  }[];
  agenda: {
    id: string;
    jobId: string | null;
    kind: string;
    title: string;
    startsAt: string;
    endsAt: string;
    htmlLink: string | null;
  }[];
  followUpsDue: {
    jobId: string;
    company: string;
    role: string;
    dueAt: string;
    overdue: boolean;
    stage: string;
  }[];
  topMatches: ApiJobRecord[];
}

/** `2026-11-27` → `Friday, Nov 27` (the API's UTC date, labelled without shifting it). */
export function formatDateLabel(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function todayFromApi(res: ApiTodayResponse): TodayResponse {
  return {
    dateLabel: formatDateLabel(res.date),
    unreadReplies: res.unreadReplies.map((r) => ({
      jobId: r.jobId,
      company: r.company,
      role: r.role,
      sender: r.sender,
      snippet: r.snippet || r.subject,
      receivedAt: r.receivedAt,
    })),
    agenda: res.agenda.map((e) => ({
      id: e.id,
      jobId: e.jobId,
      title: e.title,
      startsAt: e.startsAt,
      endsAt: e.endsAt,
      locationOrLink: e.htmlLink ?? '',
    })),
    followUpsDue: res.followUpsDue.map((f) => ({
      jobId: f.jobId,
      company: f.company,
      role: f.role,
      dueAt: f.dueAt,
      overdue: f.overdue,
      stage: stageFromApi(f.stage),
    })),
    topMatches: res.topMatches.map((j) => jobSummaryFromApi(j)),
  };
}

export interface ApiTrackerEntry {
  applicationId: string;
  jobId: string;
  company: string;
  title: string;
  stage: string;
  matchScore: number | null;
  threadSubject: string | null;
  threadCount: number;
  threadsNeedReply: boolean;
  lastActivityAt: string;
  nextFollowUpAt: string | null;
  notes: string;
}

export function trackerFromApi(res: { entries: ApiTrackerEntry[] }): TrackerResponse {
  return {
    entries: res.entries.map(
      (e): TrackerEntry => ({
        jobId: e.jobId,
        company: e.company,
        title: e.title,
        stage: stageFromApi(e.stage),
        matchScore: e.matchScore,
        gmailStatus: e.threadsNeedReply
          ? 'reply_received'
          : e.threadCount > 0
            ? 'awaiting_reply'
            : 'none',
        threadSubject: e.threadSubject,
        lastActivityAt: e.lastActivityAt,
        nextFollowUpAt: e.nextFollowUpAt,
        notes: e.notes,
      }),
    ),
  };
}

/** Web stage names → API stage names; only sends the fields being changed. */
export function trackerPatchToApi(req: UpdateTrackerRequest): Record<string, unknown> {
  const body: Record<string, unknown> = { jobId: req.jobId };
  if (req.stage !== undefined) body.stage = STAGE_TO_API[req.stage];
  if (req.nextFollowUpAt !== undefined) body.nextFollowUpAt = req.nextFollowUpAt;
  if (req.notes !== undefined) body.notes = req.notes;
  return body;
}

/** Badge text for a triage score; 'unscored' until fast scoring runs. */
export function formatMatchScore(score: number | null): string {
  return score == null ? 'unscored' : `${Math.round(score)}/100`;
}

// ---- Sources (JOB-7) ----

export interface ApiSourceRecord {
  id: string;
  company: string;
  provider: string;
  careers_url: string;
  enabled: boolean;
  last_scanned_at: string | null;
  last_error: string | null;
  matched_count: number;
}

export interface ApiFilteredAuditRecord {
  id: string;
  company: string;
  title: string;
  reason_code: string;
  reason_detail: string | null;
  source_type: string;
  created_at: string;
}

const SOURCE_KINDS: JobSource['kind'][] = ['greenhouse', 'ashby', 'lever', 'reddit'];

export function sourceFromApi(s: ApiSourceRecord): JobSource {
  const kind = SOURCE_KINDS.find((k) => k === s.provider) ?? 'custom';
  return {
    id: s.id,
    name: s.company,
    kind,
    boardUrl: s.careers_url,
    enabled: s.enabled,
    lastScannedAt: s.last_scanned_at,
    matchedCount: s.matched_count ?? 0,
    lastError: s.last_error,
  };
}

export function sourcesFromApi(res: {
  sources: ApiSourceRecord[];
  filtered_audit?: ApiFilteredAuditRecord[];
}): SourcesResponse {
  return {
    sources: res.sources.map(sourceFromApi),
    filteredAudit: (res.filtered_audit ?? []).map(
      (a): FilteredAuditEntry => ({
        id: a.id,
        title: a.title,
        company: a.company,
        sourceName: a.source_type,
        rule: a.reason_code,
        reason: a.reason_detail ?? '',
        filteredAt: a.created_at,
      }),
    ),
  };
}

/** Web create payload → API (`custom` lets the scanner auto-detect the board). */
export function sourceCreateToApi(req: { name: string; kind: JobSource['kind']; boardUrl: string }) {
  return {
    company: req.name.trim(),
    provider: req.kind === 'custom' ? 'auto' : req.kind,
    careers_url: req.boardUrl.trim(),
    enabled: true,
  };
}

export function scanFromApi(res: {
  sources_scanned: number;
  items_ingested: number;
  items_filtered?: number;
}): ScanSourcesResponse {
  return {
    scannedSources: res.sources_scanned,
    newMatches: res.items_ingested,
    filteredOut: res.items_filtered ?? 0,
    ranAt: new Date().toISOString(),
  };
}
