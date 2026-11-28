import type { PipelineStage } from '@/api/types';

export interface StageStyle {
  id: PipelineStage;
  label: string;
  /** CSS color token; see `--stage-*` in index.css. */
  color: string;
}

/** Pipeline stages in order. The single source for stage names and colors. */
export const STAGES: readonly StageStyle[] = [
  { id: 'saved', label: 'Saved', color: 'var(--stage-saved)' },
  { id: 'applied', label: 'Applied', color: 'var(--stage-applied)' },
  { id: 'screen', label: 'Recruiter screen', color: 'var(--stage-screen)' },
  { id: 'interview', label: 'Interviewing', color: 'var(--stage-interview)' },
  { id: 'offer', label: 'Offer', color: 'var(--stage-offer)' },
  { id: 'archived', label: 'Closed', color: 'var(--stage-archived)' },
];

export function stageStyle(stage: PipelineStage): StageStyle {
  return STAGES.find((s) => s.id === stage) ?? STAGES[0];
}

/** A translucent version of a color token, for chip and tile backgrounds. */
export function tint(color: string, percent = 15): string {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}

export function scoreColor(score: number | null): string {
  if (score === null) return 'var(--wp-muted)';
  if (score >= 75) return 'var(--wp-good)';
  if (score >= 60) return 'var(--wp-warn)';
  return 'var(--stage-archived)';
}

/** A stable hue per company, so the same employer always looks the same. */
export function companyHue(company: string): string {
  let hash = 0;
  for (const ch of company.trim().toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return `var(--hue-${(hash % 8) + 1})`;
}
