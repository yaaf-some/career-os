/**
 * reddit.mjs — Reddit RSS `[Hiring]` post fetcher & parser.
 *
 * Fetches RSS/Atom feeds for configured subreddits (`r/RemoteJobs`, `r/forhire`,
 * `r/digitalnomad`, `r/cscareerquestions`, `r/remotework`), drops `[For Hire]`
 * self-promo, applies `guardPosting` + `filter.mjs`, and returns `{ accepted, rejected, errors }`.
 */

import { FILTER_REASON_CODES } from './filter.mjs';
import { processRawJobs, resolveFilterOptions } from './pipeline.mjs';

export const REDDIT_SUBREDDITS = Object.freeze([
  'RemoteJobs',
  'forhire',
  'digitalnomad',
  'cscareerquestions',
  'remotework',
]);

export const REDDIT_USER_AGENT = 'career-os-scanner/1.0 (job search RSS reader)';

const FOR_HIRE_RE = /\[\s*for\s+hire\s*\]|\bfor\s+hire\b|\blooking\s+for\s+(?:a\s+)?(?:job|role|work|opportunities)\b|\bseeking\s+(?:a\s+)?(?:role|position|work)\b/i;
const HIRING_TAG_RE = /\[\s*hiring\s*\]/i;
const HIRING_SIGNAL_RE = /\[\s*hiring\s*\]|\bwe(?:'re|\s+are)\s+hiring\b|\bis\s+hiring\b|\bhiring\s+(?:a\s+|an\s+)?(?:junior|mid|platform|devops|sre|cloud|infra|infrastructure|systems|release)/i;

function decodeXmlEntities(text) {
  return String(text ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)));
}

function extractTag(block, tagName) {
  const re = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const m = block.match(re);
  return m ? decodeXmlEntities(m[1]).trim() : '';
}

function extractLink(block) {
  const atomHref = block.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\/?>/i);
  if (atomHref?.[1]) return decodeXmlEntities(atomHref[1]).trim();
  return extractTag(block, 'link');
}

function inferRedditLocation(rawTitle, content, subreddit) {
  if (/\b(?:remote|us|usa|united\s+states|los\s+angeles|irvine|orange\s+county)\b/i.test(rawTitle)) {
    return rawTitle;
  }
  const plain = String(content ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  const locLine = plain.match(/\blocation\s*:\s*([^|\n.;]{2,80})/i);
  if (locLine?.[1]) return locLine[1].trim();
  const usBodyCue = plain.match(/\b(?:remote\s+(?:us|usa|united\s+states)|us\s+remote|los\s+angeles(?:\s*,\s*ca)?|orange\s+county|irvine(?:\s*,\s*ca)?)\b/i);
  if (usBodyCue?.[0]) return usBodyCue[0].trim();
  if (subreddit.toLowerCase().includes('remote')) return 'Remote';
  return '';
}

/**
 * Classify whether a Reddit post is a `[Hiring]` lead, a `[For Hire]` self-promo,
 * or non-hiring chatter.
 *
 * @param {string} title
 * @param {string} body
 * @param {string} subreddit
 * @returns {{ kind: 'hiring' | 'for_hire' | 'non_hiring', reasonCode?: string, reasonDetail?: string }}
 */
export function classifyRedditPost(title, body, subreddit) {
  const t = String(title ?? '').trim();
  const b = String(body ?? '').trim();

  if (FOR_HIRE_RE.test(t)) {
    return {
      kind: 'for_hire',
      reasonCode: FILTER_REASON_CODES.SOCIAL_FOR_HIRE,
      reasonDetail: `Reddit self-promo [For Hire] dropped in r/${subreddit}`,
    };
  }

  if (String(subreddit ?? '').toLowerCase() === 'forhire') {
    if (HIRING_TAG_RE.test(t)) {
      return { kind: 'hiring' };
    }
    return {
      kind: 'non_hiring',
      reasonCode: FILTER_REASON_CODES.SOCIAL_NOT_HIRING,
      reasonDetail: 'r/forhire post missing [Hiring] tag',
    };
  }

  if (HIRING_SIGNAL_RE.test(t) || HIRING_TAG_RE.test(b.slice(0, 300))) {
    return { kind: 'hiring' };
  }

  return {
    kind: 'non_hiring',
    reasonCode: FILTER_REASON_CODES.SOCIAL_NOT_HIRING,
    reasonDetail: `No hiring signal in r/${subreddit} post`,
  };
}

/**
 * Parse a Reddit Atom/RSS feed XML string into raw candidate job records.
 *
 * @param {string} xml
 * @param {string} subreddit
 * @returns {Array<Record<string, any>>}
 */
export function parseRedditRss(xml, subreddit) {
  if (typeof xml !== 'string' || !xml.trim()) return [];

  const entryMatches = [...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)];
  const itemMatches = entryMatches.length > 0 ? entryMatches : [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)];

  const records = [];
  for (const match of itemMatches) {
    const block = match[1];
    const rawTitle = extractTag(block, 'title');
    const url = extractLink(block);
    const content = extractTag(block, 'content') || extractTag(block, 'description');
    const published = extractTag(block, 'published') || extractTag(block, 'updated') || extractTag(block, 'pubDate');
    const author = extractTag(block, 'name') || extractTag(block, 'author');

    if (!url || !rawTitle) continue;

    const classification = classifyRedditPost(rawTitle, content, subreddit);
    if (classification.kind === 'non_hiring') {
      continue;
    }

    const cleanTitle = rawTitle.replace(/^\s*\[\s*hiring\s*\]\s*[-:–—]?\s*/i, '').trim() || rawTitle;
    const inferredLocation = inferRedditLocation(rawTitle, content, subreddit);

    records.push({
      title: cleanTitle,
      company: author ? `Reddit (${author.replace(/^\/?u\//i, 'u/')})` : `Reddit r/${subreddit}`,
      url,
      location: inferredLocation,
      description: content,
      postedAt: published || null,
      sourceType: 'reddit',
      sourceId: `r/${subreddit}`,
      preFilterReasonCode: classification.kind === 'for_hire' ? classification.reasonCode : null,
      preFilterReasonDetail: classification.kind === 'for_hire' ? classification.reasonDetail : null,
    });
  }

  return records;
}

/**
 * Fetch and parse Reddit RSS feeds across the requested subreddits.
 *
 * @param {{ subreddits?: readonly string[], fetchImpl?: typeof fetch }} [opts]
 * @returns {Promise<{ leads: Array<Record<string, any>>, errors: Array<{ subreddit: string, error: string }> }>}
 */
export async function fetchRedditRss(opts = {}) {
  const subreddits = Array.isArray(opts.subreddits) && opts.subreddits.length > 0
    ? opts.subreddits
    : REDDIT_SUBREDDITS;
  const fetchFn = opts.fetchImpl ?? globalThis.fetch;
  const leads = [];
  const errors = [];

  for (const rawSub of subreddits) {
    const subreddit = String(rawSub ?? '').replace(/^\/?r\//i, '').trim();
    if (!subreddit) continue;
    const feedUrl = `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/new.rss`;
    try {
      const res = await fetchFn(feedUrl, {
        headers: {
          'User-Agent': REDDIT_USER_AGENT,
          Accept: 'application/atom+xml, application/rss+xml, application/xml, text/xml',
        },
      });
      if (!res.ok) {
        errors.push({ subreddit, error: `HTTP ${res.status}` });
        continue;
      }
      const xml = await res.text();
      leads.push(...parseRedditRss(xml, subreddit));
    } catch (err) {
      errors.push({
        subreddit,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { leads, errors };
}

/**
 * Fetch Reddit RSS feeds, sanitize with `guardPosting`, and apply strict `filter.mjs`.
 *
 * @param {{
 *   subreddits?: readonly string[],
 *   portalsConfig?: Record<string, any> | null,
 *   fetchImpl?: typeof fetch,
 *   now?: number,
 * }} [opts]
 * @returns {Promise<{ accepted: Array<Record<string, any>>, rejected: Array<Record<string, any>>, errors: Array<{ subreddit: string, error: string }> }>}
 */
export async function scanReddit(opts = {}) {
  const configSubs = Array.isArray(opts.portalsConfig?.reddit_subreddits)
    ? opts.portalsConfig.reddit_subreddits
    : null;
  const subreddits = Array.isArray(opts.subreddits) && opts.subreddits.length > 0
    ? opts.subreddits
    : configSubs && configSubs.length > 0
      ? configSubs
      : REDDIT_SUBREDDITS;

  const { leads, errors } = await fetchRedditRss({
    subreddits,
    fetchImpl: opts.fetchImpl,
  });

  const filterOpts = resolveFilterOptions(opts.portalsConfig);
  const processed = processRawJobs(leads, {
    sourceType: 'reddit',
    sinceDays: filterOpts.sinceDays,
    maxYoe: filterOpts.maxYoe,
    strictLocation: filterOpts.strictLocation,
    now: opts.now,
  });

  return {
    accepted: processed.accepted,
    rejected: processed.rejected,
    errors,
  };
}
