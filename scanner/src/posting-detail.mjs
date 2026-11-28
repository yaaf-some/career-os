/**
 * posting-detail.mjs — fetch the description of ONE known posting.
 *
 * Used to fill postings a board listing returned without a body (Greenhouse
 * boards too large for `content=true`) and for on-demand backfill of saved jobs.
 *
 * SSRF rule: the posting URL is only ever parsed for a (provider, board, id)
 * triple. Every request goes to a fixed ATS API host built from that triple.
 */

import { htmlToText } from './providers/_html-to-text.mjs';
import { fetchJsonWithRetry } from './providers/_http.mjs';
import { leverDescription } from './providers/lever.mjs';

const GREENHOUSE_HOSTS = new Set([
  'boards.greenhouse.io',
  'boards.eu.greenhouse.io',
  'job-boards.greenhouse.io',
  'job-boards.eu.greenhouse.io',
]);
const ASHBY_BOARD_MAX_BYTES = 40 * 1024 * 1024;
const BOARD_SLUG = /^(?!\.+$)[A-Za-z0-9._-]{1,100}$/;
const GREENHOUSE_ID = /^\d{1,20}$/;
const OPAQUE_ID = /^[A-Za-z0-9-]{1,80}$/;

function ref(provider, board, id, extra = {}) {
  const idPattern = provider === 'greenhouse' ? GREENHOUSE_ID : OPAQUE_ID;
  if (!BOARD_SLUG.test(board ?? '') || !idPattern.test(id ?? '')) return null;
  return { provider, board, id, ...extra };
}

/**
 * @param {string} url Posting URL (untrusted).
 * @param {{ provider?: string | null, board?: string | null }} [hint] The
 *   configured source's board, for company-hosted pages (`?gh_jid=`).
 * @returns {{ provider: 'greenhouse'|'ashby'|'lever', board: string, id: string, eu?: boolean } | null}
 */
export function parsePostingRef(url, hint = {}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  const host = parsed.hostname.toLowerCase();
  const parts = parsed.pathname.split('/').filter(Boolean);

  if (GREENHOUSE_HOSTS.has(host)) {
    if (parts[1] === 'jobs') return ref('greenhouse', parts[0], parts[2]);
    if (parts[0] === 'embed') {
      return ref('greenhouse', parsed.searchParams.get('for'), parsed.searchParams.get('token'));
    }
    return null;
  }
  if (host === 'jobs.ashbyhq.com') return ref('ashby', parts[0], parts[1]);
  if (host === 'jobs.lever.co' || host === 'jobs.eu.lever.co') {
    return ref('lever', parts[0], parts[1], { eu: host === 'jobs.eu.lever.co' });
  }

  const ghJid = parsed.searchParams.get('gh_jid');
  if (ghJid && hint.provider === 'greenhouse') return ref('greenhouse', hint.board, ghJid);
  return null;
}

async function fetchRawDescription(target, ctx, boardCache) {
  if (target.provider === 'greenhouse') {
    const json = await fetchJsonWithRetry(
      ctx,
      `https://boards-api.greenhouse.io/v1/boards/${target.board}/jobs/${target.id}`,
      { redirect: 'error' },
    );
    return htmlToText(json?.content, { keepBreaks: true });
  }
  if (target.provider === 'lever') {
    const apiHost = target.eu ? 'api.eu.lever.co' : 'api.lever.co';
    const json = await fetchJsonWithRetry(
      ctx,
      `https://${apiHost}/v0/postings/${target.board}/${target.id}`,
      { redirect: 'error' },
    );
    return leverDescription(json ?? {});
  }
  // Ashby has no single-posting endpoint: read the board once per batch.
  let board = boardCache.get(target.board);
  if (!board) {
    board = fetchJsonWithRetry(ctx, `https://api.ashbyhq.com/posting-api/job-board/${target.board}`, {
      redirect: 'error',
      timeoutMs: 30_000,
      maxBytes: ASHBY_BOARD_MAX_BYTES,
    });
    boardCache.set(target.board, board);
  }
  const json = await board;
  const wanted = target.id.toLowerCase();
  const job = (Array.isArray(json?.jobs) ? json.jobs : []).find(
    (j) => String(j?.id ?? '').toLowerCase() === wanted,
  );
  if (!job) {
    const err = new Error('posting not listed on board');
    err.status = 404;
    throw err;
  }
  return job.descriptionPlain || htmlToText(job.descriptionHtml, { keepBreaks: true });
}

/**
 * @returns {Promise<{ status: 'ok', description: string }
 *   | { status: 'gone' } | { status: 'empty' } | { status: 'unsupported' }
 *   | { status: 'error', error: string }>}
 */
export async function fetchPostingDescription(target, ctx, boardCache = new Map()) {
  if (!target) return { status: 'unsupported' };
  try {
    const description = String((await fetchRawDescription(target, ctx, boardCache)) ?? '').trim();
    return description ? { status: 'ok', description } : { status: 'empty' };
  } catch (err) {
    if (err?.status === 404 || err?.status === 410) return { status: 'gone' };
    return { status: 'error', error: err instanceof Error ? err.message : String(err) };
  }
}
