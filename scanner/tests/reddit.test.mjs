import test from 'node:test';
import assert from 'node:assert/strict';
import { FILTER_REASON_CODES } from '../src/filter.mjs';
import {
  REDDIT_SUBREDDITS,
  REDDIT_USER_AGENT,
  classifyRedditPost,
  parseRedditRss,
  scanReddit,
} from '../src/reddit.mjs';

test('classifyRedditPost distinguishes [Hiring], [For Hire], and non-hiring chatter', () => {
  assert.equal(
    classifyRedditPost('[Hiring] Platform Engineer - Remote US', '2 years AWS', 'forhire').kind,
    'hiring',
  );
  const forHire = classifyRedditPost('[For Hire] DevOps Engineer seeking remote role', '', 'forhire');
  assert.equal(forHire.kind, 'for_hire');
  assert.equal(forHire.reasonCode, FILTER_REASON_CODES.SOCIAL_FOR_HIRE);

  const chatter = classifyRedditPost('How is the market for SREs right now?', 'Just asking', 'cscareerquestions');
  assert.equal(chatter.kind, 'non_hiring');

  const forhireMissingTag = classifyRedditPost('Need advice on resume', '', 'forhire');
  assert.equal(forhireMissingTag.kind, 'non_hiring');
});

test('parseRedditRss extracts [Hiring] leads and marks [For Hire] for audited rejection', () => {
  const atomXml = `<?xml version="1.0" encoding="UTF-8"?>
  <feed xmlns="http://www.w3.org/2005/Atom">
    <entry>
      <title>[Hiring] Junior DevOps Engineer - Remote US</title>
      <link href="https://www.reddit.com/r/forhire/comments/abc123/hiring_devops/"/>
      <content type="html">&lt;p&gt;2-3 years of experience with Terraform and Kubernetes.&lt;/p&gt;</content>
      <published>2026-11-25T10:00:00Z</published>
      <author><name>/u/acme_hiring</name></author>
    </entry>
    <entry>
      <title>[For Hire] Senior Cloud Engineer looking for work</title>
      <link href="https://www.reddit.com/r/forhire/comments/def456/for_hire/"/>
      <content type="html">Hire me please</content>
      <published>2026-11-25T11:00:00Z</published>
      <author><name>/u/jobseeker</name></author>
    </entry>
    <entry>
      <title>Weekly career thread</title>
      <link href="https://www.reddit.com/r/forhire/comments/ghi789/thread/"/>
      <content type="html">Discussion</content>
    </entry>
  </feed>`;

  const records = parseRedditRss(atomXml, 'forhire');
  assert.equal(records.length, 2);
  assert.equal(records[0].title, 'Junior DevOps Engineer - Remote US');
  assert.equal(records[0].preFilterReasonCode, null);
  assert.equal(records[0].company, 'Reddit (u/acme_hiring)');
  assert.equal(records[1].preFilterReasonCode, FILTER_REASON_CODES.SOCIAL_FOR_HIRE);
});

test('scanReddit fetches configured subreddits with clean User-Agent and applies guard + strict filter', async () => {
  const seenHeaders = [];
  const feedBySub = {
    RemoteJobs: `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <title>[Hiring] Platform Engineer - Remote US</title>
        <link href="https://www.reddit.com/r/RemoteJobs/comments/101/platform/"/>
        <content type="html">&lt;div&gt;2 years of experience with Docker &amp;amp; K8s.&lt;/div&gt;</content>
        <published>2026-11-25T12:00:00Z</published>
      </entry>
      <entry>
        <title>[Hiring] SRE - Remote UK</title>
        <link href="https://www.reddit.com/r/RemoteJobs/comments/102/sre_uk/"/>
        <content type="html">London UK timezone only.</content>
      </entry>
      <entry>
        <title>[For Hire] DevOps Engineer</title>
        <link href="https://www.reddit.com/r/RemoteJobs/comments/103/for_hire/"/>
        <content type="html">Looking for work</content>
      </entry>
    </feed>`,
  };

  const mockFetch = async (url, init) => {
    seenHeaders.push({ url, ua: init?.headers?.['User-Agent'] });
    if (url.includes('/r/RemoteJobs/')) {
      return new Response(feedBySub.RemoteJobs, { status: 200 });
    }
    if (url.includes('/r/forhire/')) {
      return new Response('rate limited', { status: 429 });
    }
    return new Response('<feed xmlns="http://www.w3.org/2005/Atom"></feed>', { status: 200 });
  };

  const result = await scanReddit({ fetchImpl: mockFetch });
  assert.equal(seenHeaders.length, REDDIT_SUBREDDITS.length);
  for (const req of seenHeaders) {
    assert.equal(req.ua, REDDIT_USER_AGENT);
  }
  assert.equal(result.accepted.length, 1);
  assert.equal(result.accepted[0].title, 'Platform Engineer - Remote US');
  assert.equal(result.accepted[0].guard.integrity, 'clean');
  assert.equal(result.rejected.length, 2);
  assert.ok(result.rejected.some((r) => r.reasonCode === FILTER_REASON_CODES.LOCATION_NON_US));
  assert.ok(result.rejected.some((r) => r.reasonCode === FILTER_REASON_CODES.SOCIAL_FOR_HIRE));
  assert.deepEqual(result.errors, [{ subreddit: 'forhire', error: 'HTTP 429' }]);
});
