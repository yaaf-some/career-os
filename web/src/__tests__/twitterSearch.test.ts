import { describe, expect, it } from 'vitest';
import { buildXSearchUrl, DEFAULT_X_SEARCH_PRESETS } from '@/lib/twitterSearch';

describe('X/Twitter saved search URL builder', () => {
  it('builds a live X search URL with quoted multi-word keywords and hiring filters', () => {
    const url = buildXSearchUrl({
      label: 'Systems Rust',
      keywords: ['Rust', 'distributed systems'],
      includeHiring: true,
      excludeRetweets: true,
      minFaves: 5,
      sinceDate: '2026-11-01',
    });

    const parsed = new URL(url);
    expect(parsed.origin).toBe('https://x.com');
    expect(parsed.pathname).toBe('/search');
    expect(parsed.searchParams.get('f')).toBe('live');
    expect(parsed.searchParams.get('src')).toBe('typed_query');

    const q = parsed.searchParams.get('q') ?? '';
    expect(q).toContain('(Rust OR "distributed systems")');
    expect(q).toContain('(hiring OR "we\'re hiring" OR "join our team" OR "DM me")');
    expect(q).toContain('-filter:retweets');
    expect(q).toContain('min_faves:5');
    expect(q).toContain('since:2026-11-01');
  });

  it('handles single keyword without unnecessary OR grouping and optional flags disabled', () => {
    const url = buildXSearchUrl({
      label: 'Single',
      keywords: ['TypeScript'],
      includeHiring: false,
      excludeRetweets: false,
      minFaves: 0,
    });

    const parsed = new URL(url);
    expect(parsed.searchParams.get('q')).toBe('TypeScript');
  });

  it('produces valid https URLs for all default presets', () => {
    for (const preset of DEFAULT_X_SEARCH_PRESETS) {
      const url = buildXSearchUrl(preset);
      expect(url.startsWith('https://x.com/search?')).toBe(true);
    }
  });
});
