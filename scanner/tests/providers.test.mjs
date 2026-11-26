import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProviders, resolveProvider } from '../src/providers/_registry.mjs';

const PROVIDERS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/providers',
);

test('loadProviders loads all 10 US ATS & board providers cleanly', async () => {
  const providers = await loadProviders(PROVIDERS_DIR);
  const expected = [
    'ashby',
    'bamboohr',
    'builtin',
    'greenhouse',
    'lever',
    'paylocity',
    'rippling',
    'smartrecruiters',
    'workable',
    'workday',
  ];
  for (const id of expected) {
    assert.ok(providers.has(id), `missing provider: ${id}`);
    assert.equal(typeof providers.get(id).fetch, 'function');
  }
});

test('resolveProvider matches URLs for every ported provider', async () => {
  const providers = await loadProviders(PROVIDERS_DIR);
  const cases = [
    [{ name: 'GH', careers_url: 'https://job-boards.greenhouse.io/acme' }, 'greenhouse'],
    [{ name: 'Ashby', careers_url: 'https://jobs.ashbyhq.com/acme' }, 'ashby'],
    [{ name: 'Lever', careers_url: 'https://jobs.lever.co/acme' }, 'lever'],
    [{ name: 'Workday', careers_url: 'https://acme.wd5.myworkdayjobs.com/en-US/Careers' }, 'workday'],
    [{ name: 'SR', careers_url: 'https://jobs.smartrecruiters.com/Acme' }, 'smartrecruiters'],
    [{ name: 'Bamboo', careers_url: 'https://acme.bamboohr.com/careers' }, 'bamboohr'],
    [{ name: 'Workable', careers_url: 'https://apply.workable.com/acme' }, 'workable'],
    [{ name: 'Rippling', careers_url: 'https://ats.rippling.com/acme/jobs' }, 'rippling'],
    [{ name: 'Paylocity', careers_url: 'https://recruiting.paylocity.com/Recruiting/Jobs/All/00000000-0000-0000-0000-000000000000' }, 'paylocity'],
    [{ name: 'BuiltIn', careers_url: 'https://www.builtinla.com/jobs/dev-engineering', provider: 'builtin' }, 'builtin'],
  ];
  for (const [entry, expectedId] of cases) {
    const resolved = resolveProvider(entry, providers);
    assert.equal(resolved?.provider?.id, expectedId, `expected ${entry.name} -> ${expectedId}`);
  }
});
