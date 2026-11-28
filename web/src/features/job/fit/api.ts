import { useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '@/api/core';
import { evalBlocksFromJson } from '@/api/jobs';
import { queryKeys } from '@/api/queries';
import type { EvalBlock, JobDetail } from '@/api/types';
import type { EvaluationRow, JobRow } from '../overview/api';

export type EvaluationTier = 'fast' | 'balanced' | 'deep';
/** `auto` lets the server choose: balanced, or deep for strong matches. */
export type TierChoice = 'auto' | EvaluationTier;

export const TIER_OPTIONS: { value: TierChoice; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'fast', label: 'Fast' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'deep', label: 'Deep' },
];

export interface EvaluationView {
  id: string;
  tier: string | null;
  verdict: string;
  /** `4.1 / 5`, or null when the model gave no score. */
  score: string | null;
  /** CLI and model that ran it. */
  ranBy: string;
  createdAt: string;
  blocks: EvalBlock[];
  reportMd: string | null;
}

const scoreOf = (row: EvaluationRow) =>
  row.overall_score == null ? null : `${row.overall_score.toFixed(1)} / 5`;

function verdictOf(row: EvaluationRow): string {
  return [scoreOf(row), row.archetype].filter(Boolean).join(' · ') || 'Evaluated';
}

/** Every stored evaluation, newest first, whatever tier ran it. */
export function evaluationViews(rows: EvaluationRow[]): EvaluationView[] {
  return [...rows]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((row) => ({
      id: row.id,
      tier: row.tier,
      verdict: verdictOf(row),
      score: scoreOf(row),
      ranBy: [row.provider, row.model].filter(Boolean).join(' · '),
      createdAt: row.created_at,
      blocks: evalBlocksFromJson(row.blocks_json),
      reportMd: row.report_md?.trim() || null,
    }));
}

/** What the shared job detail already knows, for when the history is not available. */
export function fallbackViews(deep: JobDetail['deepEval']): EvaluationView[] {
  if (!deep) return [];
  return [
    {
      id: 'latest',
      tier: null,
      verdict: deep.overallVerdict,
      score: null,
      ranBy: [deep.provider, deep.model].filter(Boolean).join(' · '),
      createdAt: deep.evaluatedAt,
      blocks: deep.blocks,
      reportMd: null,
    },
  ];
}

export interface TriageDetail {
  archetype: string | null;
  scoredWithoutDescription: boolean;
}

function parseObject(raw: string | null): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw ?? 'null');
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function triageDetail(job: JobRow | undefined): TriageDetail {
  const tier1 = parseObject(job?.tier1_json ?? null);
  return {
    archetype: typeof tier1?.archetype === 'string' ? tier1.archetype.trim() || null : null,
    scoredWithoutDescription: tier1?.scored_without_description === true,
  };
}

const GUARD_COUNTS: [string, string][] = [
  ['instructionCount', 'Text written as instructions to an AI'],
  ['hiddenBlocks', 'Hidden blocks of text'],
  ['tamperingCount', 'Invisible characters that alter the text'],
  ['mixedScriptCount', 'Words mixing look-alike alphabets'],
];

/** Lines describing what the posting guard noticed; empty when nothing was flagged. */
export function guardFlagLines(raw: string | null | undefined): string[] {
  const flags = parseObject(raw ?? null);
  if (!flags) return [];
  const lines = GUARD_COUNTS.flatMap(([key, label]) => {
    const count = flags[key];
    return typeof count === 'number' && count > 0 ? [`${label}: ${count}`] : [];
  });
  // `hiddenBlocks` alone is usually page furniture, so it only counts when flagged.
  if (flags.flagged !== true) return [];
  const verdict = typeof flags.verdict === 'string' ? flags.verdict : null;
  const all = [...(verdict ? [verdict] : []), ...lines];
  return all.length > 0 ? all : ['The posting guard flagged this text.'];
}

function useRefreshScores() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: queryKeys.jobs });
    void qc.invalidateQueries({ queryKey: queryKeys.today });
    void qc.invalidateQueries({ queryKey: queryKeys.aiUsage });
  };
}

export function useEvaluateMutation(jobId: string) {
  const refresh = useRefreshScores();
  return useMutation({
    mutationFn: (tier: TierChoice) =>
      request<{ evaluation_id: string; tier: EvaluationTier }>(
        `/api/ai/evaluate/${encodeURIComponent(jobId)}`,
        { method: 'POST', body: JSON.stringify(tier === 'auto' ? {} : { tier }) },
      ),
    onSuccess: refresh,
  });
}

export interface RescoreResult {
  jobId: string;
  score: number;
  triageStatus: string;
}

export function useRescoreJobMutation(jobId: string) {
  const refresh = useRefreshScores();
  return useMutation({
    mutationFn: () =>
      request<RescoreResult>(`/api/ai/score/${encodeURIComponent(jobId)}`, { method: 'POST' }),
    onSuccess: refresh,
  });
}
