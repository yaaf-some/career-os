/** What is in the queue, in what order, and how it is remembered. */
import type { JobSummary } from '@/api/types';

export type TriageMode = 'deck' | 'list';
export type SortKey = 'score' | 'newest';

export interface QueuePrefs {
  mode: TriageMode;
  sort: SortKey;
  hideDealbreakers: boolean;
}

export interface QueueFilters {
  sort: SortKey;
  query: string;
  hideDealbreakers: boolean;
}

const PREFS_KEY = 'career-os-triage';
const DEFAULT_PREFS: QueuePrefs = { mode: 'deck', sort: 'score', hideDealbreakers: false };

export function readPrefs(): QueuePrefs {
  try {
    const raw = JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<QueuePrefs>;
    return {
      mode: raw.mode === 'list' ? 'list' : 'deck',
      sort: raw.sort === 'newest' ? 'newest' : 'score',
      hideDealbreakers: raw.hideDealbreakers === true,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function writePrefs(prefs: QueuePrefs): void {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Private browsing: the choice just does not stick.
  }
}

const time = (iso: string | null): number => {
  const parsed = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(parsed) ? 0 : parsed;
};

export function sortAndFilter(jobs: readonly JobSummary[], filters: QueueFilters): JobSummary[] {
  const words = filters.query.toLowerCase().split(/\s+/).filter(Boolean);
  const byScore = (a: JobSummary, b: JobSummary) => (b.matchScore ?? -1) - (a.matchScore ?? -1);
  const byAge = (a: JobSummary, b: JobSummary) =>
    time(b.postedAt ?? b.discoveredAt) - time(a.postedAt ?? a.discoveredAt);
  return jobs
    .filter((job) => {
      if (filters.hideDealbreakers && job.dealbreakerReason) return false;
      if (words.length === 0) return true;
      const text = [job.title, job.company, job.location, ...job.tags, job.descriptionText ?? '']
        .join(' ')
        .toLowerCase();
      return words.every((w) => text.includes(w));
    })
    .sort(filters.sort === 'newest' ? byAge : byScore);
}

/** "today", "3d ago", "2w ago", "5mo ago"; null when the date cannot be read. */
export function relativeAge(iso: string | null, now = Date.now()): string | null {
  const at = time(iso);
  if (!at) return null;
  const days = Math.floor((now - at) / 86_400_000);
  if (days < 1) return 'today';
  if (days < 14) return `${days}d ago`;
  if (days < 60) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/** Only web links may be opened: the address comes from an untrusted posting. */
export function safeExternalUrl(url: string): string | null {
  return /^https?:\/\//i.test(url.trim()) ? url.trim() : null;
}
