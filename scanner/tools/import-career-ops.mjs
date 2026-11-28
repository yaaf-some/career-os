#!/usr/bin/env node
// One-off migration from the old career-ops data layout (JOB-7).
//
//   node scanner/tools/import-career-ops.mjs <data-dir> <api-base> [--enable-sources] [--dry-run]
//
// Reads <data-dir>/portals.yml (tracked_companies) and <data-dir>/data/pipeline.md
// (pending "- [ ] url | company | title | location" lines) and creates Sources and
// manual jobs through the career-os API. Idempotent: existing sources (same
// careers URL) are skipped; job ingest is deduplicated by the API.
// Sources are created DISABLED unless --enable-sources is passed.
// Private data stays in <data-dir>; nothing is written to this repo.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Minimal YAML subset: the `tracked_companies:` list of flat `key: value` maps. */
export function parseTrackedCompanies(yamlText) {
  const lines = yamlText.split(/\r?\n/);
  const start = lines.findIndex((l) => /^tracked_companies:\s*$/.test(l));
  if (start === -1) return [];
  const out = [];
  let cur = null;
  for (const raw of lines.slice(start + 1)) {
    if (/^\S/.test(raw)) break; // next top-level key
    const line = raw.replace(/\s+#.*$/, '');
    if (!line.trim() || /^\s*#/.test(raw)) continue;
    const item = line.match(/^\s*-\s+([A-Za-z_]+):\s*(.*)$/);
    const field = line.match(/^\s+([A-Za-z_]+):\s*(.*)$/);
    if (item) {
      cur = {};
      out.push(cur);
      cur[item[1]] = unquote(item[2]);
    } else if (field && cur) {
      cur[field[1]] = unquote(field[2]);
    }
  }
  return out
    .filter((c) => c.name && c.careers_url)
    .map((c) => ({
      name: c.name,
      careersUrl: c.careers_url,
      api: c.api || null,
      enabled: c.enabled !== 'false',
    }));
}

function unquote(v) {
  const t = v.trim();
  return /^(['"]).*\1$/.test(t) ? t.slice(1, -1) : t;
}

/**
 * Provider + board id for a careers URL. Scans run through the scanner sidecar,
 * which auto-detects any provider it knows from the URL, so unknown hosts get
 * `auto`. Returns null only for non-http(s) URLs.
 */
export function toSource(company) {
  const url = new URL(company.careersUrl);
  const host = url.hostname.toLowerCase();
  const first = url.pathname.split('/').filter(Boolean)[0] ?? null;
  const ghApi = company.api?.match(/boards-api\.greenhouse\.io\/v1\/boards\/([^/]+)/);
  if (ghApi) return { provider: 'greenhouse', boardId: ghApi[1] };
  if (host.endsWith('greenhouse.io') && first) return { provider: 'greenhouse', boardId: first };
  if (host === 'jobs.ashbyhq.com' && first) return { provider: 'ashby', boardId: first };
  if (host === 'jobs.lever.co' && first) return { provider: 'lever', boardId: first };
  if (host.endsWith('paylocity.com')) return { provider: 'paylocity', boardId: null };
  return url.protocol === 'https:' || url.protocol === 'http:' ? { provider: 'auto', boardId: null } : null;
}

/** Pending pipeline lines: `- [ ] url | company | title | location`. */
export function parsePipeline(markdown) {
  const jobs = [];
  for (const line of markdown.split(/\r?\n/)) {
    const m = line.match(/^\s*-\s+\[\s\]\s+(\S+)(.*)$/);
    if (!m || !/^https?:\/\//.test(m[1])) continue;
    const [company, title, location] = m[2]
      .split('|')
      .slice(1)
      .map((s) => s.trim());
    jobs.push({
      url: m[1],
      company: company || 'Unknown company',
      title: title || 'Untitled role',
      location: location || null,
      source_type: 'manual',
    });
  }
  return jobs;
}

async function api(base, method, route, body) {
  const res = await fetch(`${base}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${route} -> ${res.status} ${await res.text()}`);
  return res.json();
}

export async function runImport({ dataDir, apiBase, enableSources = false, dryRun = false, log = console.log }) {
  const portals = parseTrackedCompanies(await readFile(path.join(dataDir, 'portals.yml'), 'utf8'));
  const pipeline = parsePipeline(await readFile(path.join(dataDir, 'data', 'pipeline.md'), 'utf8'));

  const existing = dryRun ? { sources: [] } : await api(apiBase, 'GET', '/api/sources');
  const known = new Set((existing.sources ?? []).map((s) => s.careers_url));

  const summary = { sourcesCreated: 0, sourcesSkipped: 0, unsupported: [], jobsIngested: 0, jobsDuplicate: 0 };
  for (const c of portals) {
    const src = toSource(c);
    if (!src) {
      summary.unsupported.push(c.name);
      continue;
    }
    if (known.has(c.careersUrl)) {
      summary.sourcesSkipped += 1;
      continue;
    }
    if (!dryRun) {
      await api(apiBase, 'POST', '/api/sources', {
        company: c.name,
        provider: src.provider,
        careers_url: c.careersUrl,
        board_id: src.boardId,
        enabled: enableSources && c.enabled,
        notes: 'Imported from career-ops portals.yml',
      });
    }
    summary.sourcesCreated += 1;
  }

  for (let i = 0; i < pipeline.length; i += 50) {
    const batch = pipeline.slice(i, i + 50);
    if (dryRun) {
      summary.jobsIngested += batch.length;
      continue;
    }
    const r = await api(apiBase, 'POST', '/api/jobs/ingest', { jobs: batch });
    summary.jobsIngested += r.ingested;
    summary.jobsDuplicate += r.duplicates;
  }
  log(JSON.stringify(summary, null, 2));
  return summary;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const [dataDir, apiBase] = args.filter((a) => !a.startsWith('--'));
  if (!dataDir || !apiBase) {
    console.error('usage: import-career-ops.mjs <data-dir> <api-base> [--enable-sources] [--dry-run]');
    process.exit(2);
  }
  runImport({
    dataDir,
    apiBase: apiBase.replace(/\/$/, ''),
    enableSources: args.includes('--enable-sources'),
    dryRun: args.includes('--dry-run'),
  }).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
