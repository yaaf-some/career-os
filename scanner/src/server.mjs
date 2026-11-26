/**
 * server.mjs — Zero-dependency HTTP scanner service.
 *
 * Endpoints:
 *   GET  /healthz      -> 200 {"ok":true}
 *   POST /scan/ats     -> { sources, portalsConfig? } => { accepted, rejected, errors }
 *   POST /scan/reddit  -> { subreddits?, portalsConfig? } => { accepted, rejected, errors }
 */

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from './lib/is-main-module.mjs';
import { processRawJobs, resolveFilterOptions } from './pipeline.mjs';
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
  const processed = processRawJobs(rawJobs, {
    sourceType: 'ats_board',
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
}
