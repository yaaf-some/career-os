import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  parsePipeline,
  parseTrackedCompanies,
  runImport,
  toSource,
} from '../tools/import-career-ops.mjs';

const PORTALS = `max_posting_age_days: 45
title_filter:
  positive:
    - Platform
tracked_companies:
  # --- Group ---
  - name: Example Co
    careers_url: https://job-boards.greenhouse.io/exampleco
    api: https://boards-api.greenhouse.io/v1/boards/exampleco/jobs
    enabled: true

  - name: "Ashby Inc"
    careers_url: https://jobs.ashbyhq.com/ashbyinc
    enabled: false
  - name: Lever Labs
    careers_url: https://jobs.lever.co/leverlabs/  # trailing comment
    enabled: true
  - name: Payroll Corp
    careers_url: https://recruiting.paylocity.com/Recruiting/Jobs/All/123
    enabled: true
other_key: true
`;

const PIPELINE = `# Pipeline — Pending URLs

## Pending

- [ ] https://job-boards.greenhouse.io/exampleco/jobs/1 | Example Co | Platform Engineer | Remote
- [ ] https://jobs.ashbyhq.com/ashbyinc/abc | Ashby Inc | SRE
- [x] https://done.example.com/2 | Done | Old | Remote
- [ ] not-a-url | Bad | Row
`;

test('parses tracked companies and stops at the next top-level key', () => {
  const cos = parseTrackedCompanies(PORTALS);
  assert.deepEqual(
    cos.map((c) => [c.name, c.enabled]),
    [
      ['Example Co', true],
      ['Ashby Inc', false],
      ['Lever Labs', true],
      ['Payroll Corp', true],
    ],
  );
  assert.equal(cos[2].careersUrl, 'https://jobs.lever.co/leverlabs/');
});

test('maps careers URLs to API providers', () => {
  const [gh, ashby, lever, paylocity] = parseTrackedCompanies(PORTALS).map(toSource);
  assert.deepEqual(gh, { provider: 'greenhouse', boardId: 'exampleco' });
  assert.deepEqual(ashby, { provider: 'ashby', boardId: 'ashbyinc' });
  assert.deepEqual(lever, { provider: 'lever', boardId: 'leverlabs' });
  assert.deepEqual(paylocity, { provider: 'paylocity', boardId: null });
  assert.deepEqual(toSource({ careersUrl: 'https://careers.example.com/jobs' }), { provider: 'auto', boardId: null });
  assert.equal(toSource({ careersUrl: 'ftp://example.com/jobs' }), null);
});

test('parses only unchecked pipeline URL rows', () => {
  const jobs = parsePipeline(PIPELINE);
  assert.equal(jobs.length, 2);
  assert.deepEqual(jobs[0], {
    url: 'https://job-boards.greenhouse.io/exampleco/jobs/1',
    company: 'Example Co',
    title: 'Platform Engineer',
    location: 'Remote',
    source_type: 'manual',
  });
  assert.equal(jobs[1].location, null);
});

test('imports idempotently against the API, sources disabled by default', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'career-ops-'));
  await mkdir(path.join(dir, 'data'));
  await writeFile(path.join(dir, 'portals.yml'), PORTALS);
  await writeFile(path.join(dir, 'data', 'pipeline.md'), PIPELINE);

  const sources = [];
  const ingested = new Set();
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const json = (v) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(v));
    };
    if (req.method === 'GET' && req.url === '/api/sources') return json({ sources });
    if (req.method === 'POST' && req.url === '/api/sources') {
      const b = JSON.parse(body);
      sources.push(b);
      return json({ id: String(sources.length), ...b });
    }
    if (req.method === 'POST' && req.url === '/api/jobs/ingest') {
      const { jobs } = JSON.parse(body);
      let n = 0;
      for (const j of jobs) if (!ingested.has(j.url) && ingested.add(j.url)) n += 1;
      return json({ ingested: n, duplicates: jobs.length - n });
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const first = await runImport({ dataDir: dir, apiBase: base, log: () => {} });
    assert.equal(first.sourcesCreated, 4);
    assert.deepEqual(first.unsupported, []);
    assert.equal(first.jobsIngested, 2);
    assert.ok(sources.every((s) => s.enabled === false));

    const second = await runImport({ dataDir: dir, apiBase: base, log: () => {} });
    assert.equal(second.sourcesCreated, 0);
    assert.equal(second.sourcesSkipped, 4);
    assert.equal(second.jobsIngested, 0);
    assert.equal(second.jobsDuplicate, 2);
  } finally {
    server.close();
  }
});
