import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiJobRecord } from '@/api/jobs';
import { ToastProvider } from '@/components/ui';
import { relativeAge, safeExternalUrl, sortAndFilter } from '@/features/triage/queue';
import { commitDistance, decideSwipe, lockAxis, releaseVelocity } from '@/features/triage/swipe';
import { TriageView } from '@/features/triage/TriageView';
import fixture from './fixtures/jobs.json';

describe('swipe decisions', () => {
  it('waits for a little movement, then locks to one axis', () => {
    expect(lockAxis(5, 5)).toBe('pending');
    expect(lockAxis(12, 3)).toBe('horizontal');
    expect(lockAxis(10, 14)).toBe('vertical');
    expect(lockAxis(12, 11)).toBe('vertical');
  });

  it('commits by distance relative to the card, or by a flick', () => {
    expect(commitDistance(350)).toBeCloseTo(112);
    expect(commitDistance(2000)).toBe(190);
    expect(commitDistance(100)).toBe(72);
    expect(decideSwipe(130, 0, 350)).toBe('shortlist');
    expect(decideSwipe(-130, 0, 350)).toBe('skip');
    expect(decideSwipe(100, 0, 350)).toBeNull();
    expect(decideSwipe(50, 0.9, 350)).toBe('shortlist');
    expect(decideSwipe(20, 0.9, 350)).toBeNull();
    // Flicked back toward the middle, even from beyond the line.
    expect(decideSwipe(160, -0.9, 350)).toBeNull();
  });

  it('gives a finger that stopped before lifting no speed', () => {
    const moving = [
      { x: 0, t: 0 },
      { x: 60, t: 60 },
    ];
    expect(releaseVelocity(moving, 60)).toBe(1);
    expect(releaseVelocity([...moving, { x: 60, t: 400 }], 400)).toBe(0);
  });
});

const base = fixture.list.jobs[0] as ApiJobRecord;
const row = (id: string, company: string, score: number, extra: Partial<ApiJobRecord> = {}) => ({
  ...base,
  id,
  company,
  title: `${company} Engineer`,
  url: `https://jobs.example.com/${id}`,
  tier1_score: score,
  triage_status: 'pending_triage',
  application_stage: null,
  tags_json: null,
  jd_text: `Own the platform at ${company}.`,
  workplace_type: 'remote',
  ...extra,
});

describe('queue sorting and filtering', () => {
  it('only links web addresses and reads ages', () => {
    expect(safeExternalUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull();
    const now = Date.parse('2026-11-28T00:00:00Z');
    expect(relativeAge('2026-11-27T12:00:00Z', now)).toBe('today');
    expect(relativeAge('2026-11-23T00:00:00Z', now)).toBe('5d ago');
    expect(relativeAge('nonsense', now)).toBeNull();
    expect(sortAndFilter([], { sort: 'score', query: '', hideDealbreakers: false })).toEqual([]);
  });
});

let jobs: ReturnType<typeof row>[];
let posts: { url: string; body: { action: string; job_ids?: string[] } }[];
let failing: Set<string>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const STATUS: Record<string, string> = {
  shortlist: 'shortlisted',
  skip: 'skipped',
  restore: 'pending_triage',
};

function apply(id: string, action: string) {
  const job = jobs.find((j) => j.id === id)!;
  job.triage_status = STATUS[action];
  return { job_id: id, triage_status: job.triage_status, application_id: null };
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubEnv('VITE_DEMO_MODE', 'false');
  jobs = [
    row('a', 'Alpha', 90),
    row('b', 'Bravo', 80),
    row('c', 'Charlie', 70, {
      tier1_json: JSON.stringify({ dealbreaker: { triggered: true, reason: 'On site only' } }),
    }),
  ];
  posts = [];
  failing = new Set();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/jobs?')) {
        return json({ jobs: jobs.map((j) => ({ ...j })), total: jobs.length });
      }
      if (url.startsWith('/api/triage/')) {
        const body = JSON.parse(String(init?.body)) as { action: string; job_ids?: string[] };
        posts.push({ url, body });
        if (url === '/api/triage/batch') {
          const ok = body.job_ids!.filter((id) => !failing.has(id));
          return json({
            updated: ok.length,
            results: ok.map((id) => apply(id, body.action)),
            failed: body
              .job_ids!.filter((id) => failing.has(id))
              .map((job_id) => ({ job_id, error: `job ${job_id} not found` })),
          });
        }
        const id = url.split('/').pop()!;
        if (failing.has(id)) return json({ error: 'boom', code: 'DATABASE_ERROR' }, 500);
        return json(apply(id, body.action));
      }
      return json({ error: 'not found', code: 'NOT_FOUND' }, 404);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function renderDeck(undoDelayMs = 60_000) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onSelectRole = vi.fn();
  const view = render(
    <ToastProvider>
      <QueryClientProvider client={client}>
        <TriageView onSelectRole={onSelectRole} undoDelayMs={undoDelayMs} />
      </QueryClientProvider>
    </ToastProvider>,
  );
  await screen.findByTestId('focus-card');
  return { ...view, onSelectRole };
}

const topTitle = () =>
  within(screen.getByTestId('focus-card')).getByRole('heading', { level: 2 }).textContent;

type PointerKind = 'pointerDown' | 'pointerMove' | 'pointerUp' | 'pointerCancel';

/** A pointer event at a chosen time, so speed is under the test's control. */
function pointer(
  target: Element,
  kind: PointerKind,
  t: number,
  init: { x: number; y?: number; id?: number; button?: number },
) {
  const event = createEvent[kind](target, {
    pointerId: init.id ?? 1,
    button: init.button ?? 0,
    clientX: init.x,
    clientY: init.y ?? 0,
  });
  Object.defineProperty(event, 'timeStamp', { value: 1000 + t });
  fireEvent(target, event);
}

describe('deck gesture', () => {
  it('follows the finger and springs back from a slow, short drag', async () => {
    await renderDeck();
    const card = screen.getByTestId('focus-card');
    pointer(card, 'pointerDown', 0, { x: 100 });
    pointer(card, 'pointerMove', 300, { x: 160 });
    expect(card.style.transform).toContain('translate3d(52px');
    expect(card.querySelector<HTMLElement>('[data-stamp="shortlist"]')!.style.opacity).not.toBe('');
    pointer(card, 'pointerUp', 700, { x: 160 });
    expect(card.style.transform).toBe('');
    expect(topTitle()).toBe('Alpha Engineer');
    expect(screen.queryByText('Saved Alpha')).toBeNull();
  });

  it('leaves vertical movement, other buttons and extra fingers alone', async () => {
    await renderDeck();
    const card = screen.getByTestId('focus-card');

    pointer(card, 'pointerDown', 0, { x: 100 });
    pointer(card, 'pointerMove', 10, { x: 105, y: 40 });
    pointer(card, 'pointerMove', 20, { x: 400, y: 60 });
    pointer(card, 'pointerUp', 30, { x: 400, y: 60 });
    expect(card.style.transform).toBe('');

    pointer(card, 'pointerDown', 100, { x: 100, button: 2 });
    pointer(card, 'pointerMove', 110, { x: 400 });
    pointer(card, 'pointerUp', 120, { x: 400 });

    pointer(card, 'pointerDown', 200, { x: 100 });
    pointer(card, 'pointerDown', 205, { x: 100, id: 2 });
    pointer(card, 'pointerMove', 210, { x: 400, id: 2 });
    pointer(card, 'pointerUp', 220, { x: 400, id: 2 });
    expect(card.style.transform).toBe('');
    pointer(card, 'pointerCancel', 230, { x: 100 });
    expect(screen.queryByText('Saved Alpha')).toBeNull();
  });

  it('commits a flick, and never judges a card that changed mid-drag', async () => {
    await renderDeck();
    let card = screen.getByTestId('focus-card');
    pointer(card, 'pointerDown', 0, { x: 200 });
    pointer(card, 'pointerMove', 30, { x: 150 });
    pointer(card, 'pointerUp', 40, { x: 140 });
    expect(screen.getByText('Skipped Alpha')).toBeTruthy();
    expect(topTitle()).toBe('Bravo Engineer');

    card = screen.getByTestId('focus-card');
    pointer(card, 'pointerDown', 100, { x: 100 });
    pointer(card, 'pointerMove', 120, { x: 300 });
    fireEvent.keyDown(window, { key: 'x' });
    pointer(card, 'pointerUp', 130, { x: 320 });
    expect(screen.getByText('Skipped Bravo')).toBeTruthy();
    expect(topTitle()).toBe('Charlie Engineer');
    expect(screen.queryByText('Saved Charlie')).toBeNull();
  });
});

describe('deck keys', () => {
  it('browses with arrows, opens with Enter and ignores keys while typing', async () => {
    const { onSelectRole } = await renderDeck();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(topTitle()).toBe('Bravo Engineer');
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(topTitle()).toBe('Alpha Engineer');
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onSelectRole).toHaveBeenCalledWith('a');

    fireEvent.click(screen.getByRole('button', { name: 'Sort and filter' }));
    screen.getByRole('searchbox', { name: 'Search the queue' }).focus();
    fireEvent.keyDown(window, { key: 's' });
    expect(topTitle()).toBe('Alpha Engineer');
    expect(posts).toEqual([]);
  });

  it('searches and hides dealbreakers', async () => {
    await renderDeck();
    fireEvent.click(screen.getByRole('button', { name: 'Sort and filter' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Hide dealbreakers' }));
    expect(screen.getByTestId('triage-counts').textContent).toContain('2 of 3 shown');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search the queue' }), {
      target: { value: 'platform at bravo' },
    });
    expect(topTitle()).toBe('Bravo Engineer');
  });
});

describe('held verdicts and undo history', () => {
  it('holds a verdict, then sends it when the page is hidden', async () => {
    await renderDeck();
    fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    expect(posts).toEqual([]);
    fireEvent(window, new Event('pagehide'));
    expect(posts).toEqual([{ url: '/api/triage/a', body: { action: 'shortlist' } }]);
  });

  it('undoes a held verdict without telling the server', async () => {
    await renderDeck();
    fireEvent.click(screen.getByRole('button', { name: /^Skip/ }));
    fireEvent.keyDown(window, { key: 'z' });
    await waitFor(() => expect(topTitle()).toBe('Alpha Engineer'));
    expect(posts).toEqual([]);
    expect(screen.getByTestId('triage-counts').textContent).toContain('0 decided');
  });

  it('flushes on unmount', async () => {
    const { unmount } = await renderDeck();
    fireEvent.click(screen.getByRole('button', { name: /^Skip/ }));
    unmount();
    expect(posts).toEqual([{ url: '/api/triage/a', body: { action: 'skip' } }]);
  });

  it('restores the card and says so when the send fails', async () => {
    failing.add('a');
    await renderDeck(0);
    fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    await screen.findByText(/Could not save your choice for Alpha/);
    expect(screen.getByTestId('triage-counts').textContent).toContain('3 left0 decided');
  });

  it('undoes an already sent verdict with restore, from the history', async () => {
    await renderDeck(0);
    fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    await waitFor(() => expect(posts).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Undo history' }));
    await screen.findByText(/Alpha Engineer · Done/);
    fireEvent.click(screen.getByRole('button', { name: 'Undo Saved Alpha: Alpha Engineer' }));
    await waitFor(() =>
      expect(posts[1]).toEqual({ url: '/api/triage/a', body: { action: 'restore' } }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('triage-counts').textContent).toContain('3 left0 decided'),
    );
  });

  it('keeps the history when a restore fails', async () => {
    await renderDeck(0);
    fireEvent.click(screen.getByRole('button', { name: /^Skip/ }));
    await waitFor(() => expect(posts).toHaveLength(1));
    failing.add('a');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await screen.findByText(/Could not undo Alpha/);
    expect(screen.getByText('Skipped Alpha')).toBeTruthy();
    expect(screen.getByTestId('triage-counts').textContent).toContain('1 decided');
  });

  it('celebrates when the queue is emptied', async () => {
    await renderDeck();
    for (let i = 0; i < 3; i++) fireEvent.keyDown(window, { key: 's' });
    expect(screen.getByTestId('queue-complete').textContent).toContain('You decided 3 jobs');
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy();
  });
});

describe('list mode', () => {
  it('is remembered, bulk decides and surfaces per-job failures', async () => {
    failing.add('b');
    const first = await renderDeck();
    fireEvent.click(screen.getByRole('radio', { name: 'List' }));
    first.unmount();

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <ToastProvider>
        <QueryClientProvider client={client}>
          <TriageView onSelectRole={() => {}} />
        </QueryClientProvider>
      </ToastProvider>,
    );
    await screen.findByTestId('triage-list');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }));
    fireEvent.click(screen.getByRole('button', { name: 'Skip 3' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Bravo Engineer at Bravo: job b not found');
    expect(posts[0]).toEqual({
      url: '/api/triage/batch',
      body: { action: 'skip', job_ids: ['a', 'b', 'c'] },
    });
    await waitFor(() =>
      expect(screen.getByTestId('triage-counts').textContent).toContain('1 left2 decided'),
    );

    // One undo takes the whole bulk verdict back.
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() =>
      expect(screen.getByTestId('triage-counts').textContent).toContain('3 left0 decided'),
    );
    expect(posts[1].body).toEqual({ action: 'restore', job_ids: ['a', 'c'] });
  });
});
