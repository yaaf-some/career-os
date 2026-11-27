/**
 * Maps the API's snake_case job shapes (`crates/api/src/routes/jobs.rs`) to the
 * web's `JobSummary` / `JobDetail`. Fields the API doesn't provide stay null or
 * empty; nothing is invented (docs/trust.md §3–4).
 */
import type {
  EvalBlock,
  JobDetail,
  JobsListResponse,
  JobSummary,
  PipelineStage,
  TriageStatus,
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

export interface ApiJobDetailResponse {
  job: ApiJobRecord;
  evaluations: ApiEvaluationRecord[];
  application: ApiApplicationRecord | null;
  drive_artifacts: ApiDriveArtifactRecord[];
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

function hydrogenRationale(job: ApiJobRecord): string {
  const parsed = parseJson(job.tier1_json);
  if (parsed && typeof parsed === 'object' && 'rationale' in parsed) {
    const r = (parsed as { rationale: unknown }).rationale;
    if (typeof r === 'string') return r;
  }
  return '';
}

export function jobSummaryFromApi(
  job: ApiJobRecord,
  extra?: { application?: ApiApplicationRecord | null; hasNeonEval?: boolean },
): JobSummary {
  const app = extra?.application ?? null;
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
    stage: app ? (STAGE[app.stage] ?? 'saved') : 'saved',
    hydrogenScore: job.tier1_score,
    // The hydrogen tier returns one score, not a per-dimension breakdown.
    scoreBreakdown: null,
    hydrogenSummary: hydrogenRationale(job),
    hasNeonEval: extra?.hasNeonEval ?? false,
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

function newestNeon(evals: ApiEvaluationRecord[]): ApiEvaluationRecord | null {
  return (
    evals
      .filter((e) => e.tier === 'neon')
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

export function jobDetailFromApi(res: ApiJobDetailResponse): JobDetail {
  const neon = newestNeon(res.evaluations);
  const arts = res.drive_artifacts;
  const resumeDocUrl = artifactUrl(arts, 'resume_doc');
  const coverLetterDocUrl = artifactUrl(arts, 'cover_doc');
  const generated = arts
    .filter((a) => a.kind === 'resume_doc' || a.kind === 'cover_doc')
    .map((a) => a.created_at)
    .sort()
    .at(-1);
  return {
    ...jobSummaryFromApi(res.job, {
      application: res.application,
      hasNeonEval: neon !== null,
    }),
    descriptionText: res.job.jd_text ?? '',
    requirements: [],
    neonEval: neon
      ? {
          overallVerdict: verdict(neon),
          confidence: null,
          evaluatedAt: neon.created_at,
          provider: neon.provider,
          model: neon.model,
          blocks: evalBlocksFromJson(neon.blocks_json),
        }
      : null,
    tailor: {
      resumeDocUrl,
      coverLetterDocUrl,
      generatedAt: generated ?? null,
      groundedBullets: [],
    },
    gmailDraft: null,
    calendarReminders: [],
  };
}

/** Badge text for a hydrogen score; 'unscored' until the hydrogen tier runs. */
export function formatHydrogenScore(score: number | null): string {
  return score == null ? 'unscored' : `${Math.round(score)}/100`;
}
