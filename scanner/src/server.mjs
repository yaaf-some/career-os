/**
 * server.mjs — Zero-dependency HTTP scanner service.
 *
 * Endpoints:
 *   GET  /healthz      -> 200 {"ok":true}
 *   POST /scan/ats     -> { sources, portalsConfig? } => { accepted, rejected, errors }
 *   POST /sanitize     -> { text } => { jdText } (posting guard for pasted text)
 *   POST /fetch/postings -> { items: [{ url, boardProvider?, board? }] } => { results }
 *   POST /scan/reddit  -> { subreddits?, portalsConfig? } => { accepted, rejected, errors }
 */

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from './lib/is-main-module.mjs';
import { deriveCanonicalKey, processRawJobs, resolveFilterOptions, sanitizePostingWithGuard } from './pipeline.mjs';
import { fetchPostingDescription, parsePostingRef } from './posting-detail.mjs';
import { makeHttpCtx } from './providers/_http.mjs';
import { loadProviders, resolveProvider } from './providers/_registry.mjs';
import { scanReddit } from './reddit.mjs';
import { aggregatorPostingId, normalizeUrl } from './url-key.mjs';
import { DEFAULT_USER_AGENT } from './user-agent.mjs';

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROVIDERS_DIR = path.join(SRC_DIR, 'providers');
const DEFAULT_PORT = 8081;
const DEFAULT_CONCURRENCY = 6;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const DETAIL_CONCURRENCY = 4;
const MAX_SCAN_DETAIL_FETCHES = 500;
export const MAX_FETCH_POSTINGS = 25;

let cachedProvidersPromise = null;

async function getProviders() {
  if (!cachedProvidersPromise) {
    cachedProvidersPromise = loadProviders(PROVIDERS_DIR);
  }
  return cachedProvidersPromise;
}

/**
 * Build a provider HTTP context backed either by the standard transport (`_http.mjs`)
 * or a caller-injected `fetchImpl` (used by unit tests).
 *
 * @param {typeof fetch | undefined} fetchImpl
 */
function buildHttpCtx(fetchImpl) {
  if (!fetchImpl || fetchImpl === globalThis.fetch) {
    return makeHttpCtx();
  }

  async function requestText(url, opts = {}) {
    const headers = new Headers(opts.headers ?? {});
    if (!headers.has('user-agent')) headers.set('user-agent', DEFAULT_USER_AGENT);
    const res = await fetchImpl(url, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body ?? null,
      redirect: opts.redirect ?? 'error',
    });
    opts.onResponse?.(res);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err = new Error(`HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`);
      err.status = res.status;
      err.body = body;
      err.retryAfter = res.headers?.get?.('retry-after') ?? null;
      throw err;
    }
    return res.text();
  }

  return {
    transport: 'http',
    normalizePostingUrl: normalizeUrl,
    aggregatorPostingId,
    async fetchText(url, opts = {}) {
      return requestText(url, opts);
    },
    async fetchJson(url, opts = {}) {
      const text = await requestText(url, opts);
      return JSON.parse(text.replace(/^\uFEFF/, ''));
    },
    async fetchResponse(url, opts = {}) {
      const headers = new Headers(opts.headers ?? {});
      if (!headers.has('user-agent')) headers.set('user-agent', DEFAULT_USER_AGENT);
      return fetchImpl(url, {
        method: opts.method ?? 'GET',
        headers,
        body: opts.body ?? null,
        redirect: opts.redirect ?? 'error',
      });
    },
  };
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const limit = Math.max(1, Math.min(concurrency, items.length || 1));

  const runners = Array.from({ length: limit }, async () => {
    while (cursor < items.length) {
      const idx = cursor;
      cursor += 1;
      results[idx] = await worker(items[idx], idx);
    }
  });

  await Promise.all(runners);
  return results;
}

/**
 * Scan ATS sources through registered providers, `guardPosting`, and strict `filter.mjs`.
 *
 * @param {{
 *   sources?: Array<Record<string, any>>,
 *   portalsConfig?: Record<string, any> | null,
 *   concurrency?: number,
 *   fetchImpl?: typeof fetch,
 *   now?: number,
 * }} [opts]
 * @returns {Promise<{ accepted: Array<Record<string, any>>, rejected: Array<Record<string, any>>, errors: Array<{ target: string, error: string }> }>}
 */
export async function scanAts(opts = {}) {
  const portalsConfig = opts.portalsConfig && typeof opts.portalsConfig === 'object'
    ? opts.portalsConfig
    : null;

  let targets;
  if (Array.isArray(opts.sources)) {
    targets = opts.sources.map((entry) => ({
      ...entry,
      _kind: entry._kind ?? (entry.provider === 'builtin' ? 'board' : 'company'),
    }));
  } else if (portalsConfig) {
    targets = [
      ...(Array.isArray(portalsConfig.tracked_companies) ? portalsConfig.tracked_companies : [])
        .map((entry) => ({ ...entry, _kind: 'company' })),
      ...(Array.isArray(portalsConfig.job_boards) ? portalsConfig.job_boards : [])
        .map((entry) => ({ ...entry, _kind: 'board' })),
    ];
  } else {
    targets = [];
  }

  const activeTargets = targets.filter((entry) => entry && entry.enabled !== false);
  const providers = await getProviders();
  const httpCtx = buildHttpCtx(opts.fetchImpl);

  const errors = [];
  const rawJobs = [];

  await mapWithConcurrency(activeTargets, opts.concurrency ?? DEFAULT_CONCURRENCY, async (entry) => {
    const targetName = entry.name || entry.careers_url || entry.api || 'unknown';
    const resolved = resolveProvider(entry, providers, { skipIds: ['local-parser'] });
    if (!resolved || resolved.error) {
      errors.push({
        target: targetName,
        error: resolved?.error ?? 'no provider matched',
      });
      return;
    }

    try {
      const fetched = await resolved.provider.fetch(entry, httpCtx);
      if (Array.isArray(fetched)) {
        for (const job of fetched) {
          rawJobs.push({
            ...job,
            company: job.company || entry.name,
            sourceType: entry._kind === 'board' ? 'discovery' : 'ats_board',
            sourceId: resolved.provider.id,
          });
        }
      }
    } catch (err) {
      errors.push({
        target: targetName,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  const filterOpts = resolveFilterOptions(portalsConfig);
  const runPipeline = () => processRawJobs(rawJobs, {
    sourceType: 'ats_board',
    sinceDays: filterOpts.sinceDays,
    maxYoe: filterOpts.maxYoe,
    strictLocation: filterOpts.strictLocation,
    targetTitleKeywords: filterOpts.targetTitleKeywords,
    excludedSeniority: filterOpts.excludedSeniority,
    excludedDomains: filterOpts.excludedDomains,
    now: opts.now,
  });

  let processed = runPipeline();
  // Some boards list postings without bodies (Greenhouse boards over the size
  // cap). Fetch bodies only for postings that survived the title and location
  // filters, then filter again so the description-based rules apply to them.
  if (await fillMissingDescriptions(rawJobs, processed.accepted, httpCtx)) {
    processed = runPipeline();
  }

  return {
    accepted: processed.accepted,
    rejected: processed.rejected,
    errors,
  };
}

async function fillMissingDescriptions(rawJobs, accepted, httpCtx) {
  const missing = new Set(accepted.filter((job) => !job.jdText).map((job) => job.canonicalKey));
  if (missing.size === 0) return false;

  const pending = [];
  for (const raw of rawJobs) {
    const key = deriveCanonicalKey(String(raw.url ?? '').trim());
    if (!missing.delete(key)) continue;
    const identity = raw.listingIdentity;
    const target = parsePostingRef(raw.url, {
      provider: identity?.ats_provider,
      board: identity?.board_slug,
    });
    if (target) pending.push({ raw, target });
  }

  const boardCache = new Map();
  let filled = 0;
  await mapWithConcurrency(pending.slice(0, MAX_SCAN_DETAIL_FETCHES), DETAIL_CONCURRENCY, async ({ raw, target }) => {
    const result = await fetchPostingDescription(target, httpCtx, boardCache);
    if (result.status === 'ok') {
      raw.description = result.description;
      filled += 1;
    }
  });
  return filled > 0;
}

/**
 * Descriptions for already-saved postings, sanitized like scanned ones.
 *
 * @param {{ items: Array<{ url?: string, boardProvider?: string, board?: string }>, fetchImpl?: typeof fetch }} opts
 */
export async function fetchPostings({ items, fetchImpl }) {
  const httpCtx = buildHttpCtx(fetchImpl);
  const boardCache = new Map();
  return mapWithConcurrency(items, DETAIL_CONCURRENCY, async (item) => {
    const url = typeof item?.url === 'string' ? item.url : '';
    const target = parsePostingRef(url, { provider: item?.boardProvider, board: item?.board });
    const result = await fetchPostingDescription(target, httpCtx, boardCache);
    if (result.status !== 'ok') return { url, status: result.status, error: result.error ?? null };
    const jdText = sanitizePostingWithGuard({ description: result.description }).jdText;
    return jdText ? { url, status: 'ok', jdText } : { url, status: 'empty' };
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function readJsonBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      const err = new Error('Request body too large');
      err.statusCode = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      const err = new Error('Request body must be a JSON object');
      err.statusCode = 400;
      throw err;
    }
    return parsed;
  } catch (err) {
    if (err.statusCode) throw err;
    const parseErr = new Error('Invalid JSON body');
    parseErr.statusCode = 400;
    throw parseErr;
  }
}

/**
 * Create the Node `http.Server` for the scanner service.
 *
 * @param {{ fetchImpl?: typeof fetch }} [opts]
 * @returns {http.Server}
 */
export function createScannerServer(opts = {}) {
  return http.createServer(async (req, res) => {
    const method = (req.method ?? 'GET').toUpperCase();
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;

    if (pathname === '/healthz') {
      if (method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
      }
      sendJson(res, 200, { ok: true });
      return;
    }

    if (pathname === '/scan/ats') {
      if (method !== 'POST') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
      }
      let body;
      try {
        body = await readJsonBody(req);
      } catch (err) {
        sendJson(res, err.statusCode ?? 400, { error: err.message });
        return;
      }

      if (body.sources !== undefined && !Array.isArray(body.sources)) {
        sendJson(res, 400, { error: '`sources` must be an array when provided' });
        return;
      }
      if (body.portalsConfig !== undefined && (body.portalsConfig === null || typeof body.portalsConfig !== 'object' || Array.isArray(body.portalsConfig))) {
        sendJson(res, 400, { error: '`portalsConfig` must be an object when provided' });
        return;
      }

      try {
        const result = await scanAts({
          sources: body.sources,
          portalsConfig: body.portalsConfig,
          fetchImpl: opts.fetchImpl,
        });
        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    if (pathname === '/sanitize') {
      if (method !== 'POST') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
      }
      let body;
      try {
        body = await readJsonBody(req);
      } catch (err) {
        sendJson(res, err.statusCode ?? 400, { error: err.message });
        return;
      }
      if (typeof body.text !== 'string') {
        sendJson(res, 400, { error: '`text` must be a string' });
        return;
      }
      sendJson(res, 200, { jdText: sanitizePostingWithGuard({ description: body.text }).jdText });
      return;
    }

    if (pathname === '/fetch/postings') {
      if (method !== 'POST') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
      }
      let body;
      try {
        body = await readJsonBody(req);
      } catch (err) {
        sendJson(res, err.statusCode ?? 400, { error: err.message });
        return;
      }
      if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > MAX_FETCH_POSTINGS) {
        sendJson(res, 400, { error: `\`items\` must be an array of 1-${MAX_FETCH_POSTINGS} postings` });
        return;
      }
      try {
        sendJson(res, 200, { results: await fetchPostings({ items: body.items, fetchImpl: opts.fetchImpl }) });
      } catch (err) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    if (pathname === '/scan/reddit') {
      if (method !== 'POST') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
      }
      let body;
      try {
        body = await readJsonBody(req);
      } catch (err) {
        sendJson(res, err.statusCode ?? 400, { error: err.message });
        return;
      }

      if (body.subreddits !== undefined && !Array.isArray(body.subreddits)) {
        sendJson(res, 400, { error: '`subreddits` must be an array when provided' });
        return;
      }
      if (body.portalsConfig !== undefined && (body.portalsConfig === null || typeof body.portalsConfig !== 'object' || Array.isArray(body.portalsConfig))) {
        sendJson(res, 400, { error: '`portalsConfig` must be an object when provided' });
        return;
      }

      try {
        const result = await scanReddit({
          subreddits: body.subreddits,
          portalsConfig: body.portalsConfig,
          fetchImpl: opts.fetchImpl,
        });
        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  });
}

if (isMainModule(import.meta.url)) {
  const port = Number.parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10) || DEFAULT_PORT;
  const server = createScannerServer();
  server.listen(port, () => {
    console.log(`[scanner] listening on port ${port}`);
  });

  // As container PID 1, Node ignores SIGTERM unless a handler is installed, so `docker stop`
  // would wait for the kill timeout. Drain in-flight requests, then exit.
  const shutdown = (signal) => {
    console.log(`[scanner] ${signal} received, shutting down`);
    server.close(() => process.exit(0));
    server.closeIdleConnections?.();
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}
