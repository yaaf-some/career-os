import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePostingRef } from '../src/posting-detail.mjs';
import { fetchPostings, scanAts } from '../src/server.mjs';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('parsePostingRef accepts known ATS URLs and company pages with a board hint', () => {
  assert.deepEqual(parsePostingRef('https://boards.greenhouse.io/acme/jobs/123?gh_jid=123'),
    { provider: 'greenhouse', board: 'acme', id: '123' });
  assert.deepEqual(parsePostingRef('https://example.com/careers?gh_jid=77', { provider: 'greenhouse', board: 'acme' }),
    { provider: 'greenhouse', board: 'acme', id: '77' });
  assert.equal(parsePostingRef('https://jobs.ashbyhq.com/acme/ab12-cd34').provider, 'ashby');
  assert.equal(parsePostingRef('https://jobs.lever.co/acme/ab12-cd34').provider, 'lever');
});

test('parsePostingRef rejects other hosts and path tricks', () => {
  for (const url of [
    'https://example.com/jobs/1',
    'https://example.com/?next=https://boards.greenhouse.io/acme/jobs/1',
    'https://boards.greenhouse.io/../jobs/1',
    'https://boards.greenhouse.io/acme/jobs/1abc',
    'file:///etc/passwd',
    'not a url',
  ]) {
    assert.equal(parsePostingRef(url), null, url);
  }
});

test('fetchPostings only calls fixed ATS API hosts and reports closed or unsupported postings', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(String(url));
    if (String(url).endsWith('/boards/acme/jobs/1')) {
      return json({ content: '&lt;p&gt;Run Kubernetes.&lt;/p&gt;' });
    }
    return json({}, 404);
  };
  const results = await fetchPostings({
    fetchImpl,
    items: [
      { url: 'https://job-boards.greenhouse.io/acme/jobs/1' },
      { url: 'https://job-boards.greenhouse.io/acme/jobs/2' },
      { url: 'https://internal.example/jobs/3' },
    ],
  });
  assert.deepEqual(results.map((r) => r.status), ['ok', 'gone', 'unsupported']);
  assert.equal(results[0].jdText, 'Run Kubernetes.');
  assert.ok(seen.every((u) => u.startsWith('https://boards-api.greenhouse.io/')));
});

test('scanAts fills bodies for an oversized Greenhouse board and re-applies description filters', async () => {
  const listing = {
    jobs: [1, 2].map((id) => ({
      id,
      title: 'Platform Engineer',
      absolute_url: `https://boards.greenhouse.io/bigco/jobs/${id}`,
      location: { name: 'Remote - US' },
    })),
  };
  const fetchImpl = async (input) => {
    const url = new URL(String(input));
    if (url.searchParams.get('content') === 'true') {
      return new Response('x', { status: 200 });
    }
    if (url.pathname.endsWith('/jobs/1')) return json({ content: '<p>2 years of experience.</p>' });
    if (url.pathname.endsWith('/jobs/2')) return json({ content: '<p>Requires 10+ years of experience.</p>' });
    if (url.pathname.endsWith('/offices')) return json({ offices: [] });
    return json(listing);
  };
  // The injected transport has no body cap, so raise the same error the real one does.
  const capped = async (input, init) => {
    if (new URL(String(input)).searchParams.get('content') === 'true') {
      const err = new Error('HTTP body exceeded maxBytes');
      err.code = 'response_too_large';
      throw err;
    }
    return fetchImpl(input, init);
  };

  const result = await scanAts({
    sources: [{ name: 'BigCo', provider: 'greenhouse', careers_url: 'https://boards.greenhouse.io/bigco' }],
    fetchImpl: capped,
  });

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.accepted.map((j) => j.jdText), ['2 years of experience.']);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].reasonCode, 'YOE_ABOVE_MAX');
});

test('fetched descriptions keep paragraphs and bullets and are not cut at 4000 characters', async () => {
  const content = `&lt;h3&gt;Role&lt;/h3&gt;&lt;p&gt;${'word '.repeat(1500)}&lt;/p&gt;&lt;ul&gt;\n  &lt;li&gt;Ship&lt;/li&gt;\n  &lt;li&gt;&lt;p&gt;Own on-call&lt;/p&gt;&lt;/li&gt;\n&lt;/ul&gt;`;
  const [result] = await fetchPostings({
    fetchImpl: async () => json({ content }),
    items: [{ url: 'https://job-boards.greenhouse.io/acme/jobs/1' }],
  });
  assert.ok(result.jdText.length > 7000);
  assert.match(result.jdText, /^Role\n+word /);
  assert.match(result.jdText, /\n• Ship\n+• Own on-call/);
});
