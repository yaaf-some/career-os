export interface XSearchQueryInput {
  id?: string;
  label: string;
  description?: string;
  keywords: string[];
  includeHiring?: boolean;
  excludeRetweets?: boolean;
  minFaves?: number;
  sinceDate?: string;
}

export const DEFAULT_X_SEARCH_PRESETS: readonly XSearchQueryInput[] = [
  {
    id: 'systems-rust-hiring',
    label: 'Rust / Distributed Systems Hiring',
    description: 'Engineering managers & founders posting directly about Rust or systems roles.',
    keywords: ['Rust', 'distributed systems', 'systems engineer'],
    includeHiring: true,
    excludeRetweets: true,
    minFaves: 5,
  },
  {
    id: 'ai-infra-agents',
    label: 'AI Infra & Agentic Platform',
    description: 'High-signal AI infrastructure, evals, and agent orchestration openings.',
    keywords: ['AI infrastructure', 'agentic', 'LLM infra'],
    includeHiring: true,
    excludeRetweets: true,
    minFaves: 10,
  },
  {
    id: 'staff-fullstack-remote',
    label: 'Remote Staff / Principal TypeScript',
    description: 'Remote-friendly senior/staff full-stack & platform posts.',
    keywords: ['TypeScript', 'Staff Engineer', 'remote'],
    includeHiring: true,
    excludeRetweets: true,
    minFaves: 5,
  },
];

/**
 * Build a live X/Twitter saved search URL with hiring intent filters and anti-noise operators.
 */
export function buildXSearchUrl(input: XSearchQueryInput): string {
  const cleanKeywords = input.keywords
    .map((k) => k.trim())
    .filter((k) => k.length > 0)
    .map((k) => (k.includes(' ') ? `"${k}"` : k));

  const parts: string[] = [];

  if (cleanKeywords.length === 1) {
    parts.push(cleanKeywords[0]);
  } else if (cleanKeywords.length > 1) {
    parts.push(`(${cleanKeywords.join(' OR ')})`);
  }

  if (input.includeHiring !== false) {
    parts.push('(hiring OR "we\'re hiring" OR "join our team" OR "DM me")');
  }

  if (input.excludeRetweets !== false) {
    parts.push('-filter:retweets');
  }

  if (typeof input.minFaves === 'number' && input.minFaves > 0) {
    parts.push(`min_faves:${Math.floor(input.minFaves)}`);
  }

  if (input.sinceDate && /^\d{4}-\d{2}-\d{2}$/.test(input.sinceDate)) {
    parts.push(`since:${input.sinceDate}`);
  }

  const query = parts.join(' ').trim();
  const params = new URLSearchParams({
    q: query,
    src: 'typed_query',
    f: 'live',
  });

  return `https://x.com/search?${params.toString()}`;
}
