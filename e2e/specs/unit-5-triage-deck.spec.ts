import { readFileSync } from 'node:fs';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

const seed = JSON.parse(readFileSync(new URL('../fixtures/jobs.json', import.meta.url), 'utf8'));

// A long description, so the card has something to scroll.
const longJob = {
  url: 'https://example.com/jobs/deck-long',
  company: 'Deck Example Works',
  title: 'Infrastructure Engineer',
  location: 'Remote - US',
  workplace_type: 'remote',
  jd_text: Array.from(
    { length: 40 },
    (_, i) => `Responsibility ${i + 1}: keep the example platform reliable and well documented.`,
  ).join('\n'),
};

interface Row {
  id: string;
  triage_status: string;
  application_stage: string | null;
}

const listJobs = async (request: APIRequestContext): Promise<Row[]> =>
  (await (await request.get('/api/jobs?limit=200')).json()).jobs;

const waiting = (rows: Row[]) =>
  rows.filter((j) => j.triage_status.startsWith('pending')).length;

test.beforeEach(async ({ request }) => {
  await request.post('/api/jobs/ingest', { data: { jobs: [...seed.jobs, longJob] } });
  await request.post('/api/ai/score-pending', { data: { limit: 25 } });
  for (const job of await listJobs(request)) {
    await request.post(`/api/triage/${job.id}`, { data: { action: 'restore' } });
  }
});

const title = (card: Locator) => card.getByRole('heading', { level: 2 }).innerText();

async function openDeck(page: Page) {
  await page.goto('/triage');
  const card = page.getByTestId('focus-card');
  await expect(card).toBeVisible();
  await page.waitForTimeout(450); // entrance animation
  return card;
}

/** A point on the card's header, which has nothing to tap or scroll. */
async function grip(card: Locator) {
  const box = (await card.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + 36, box };
}

async function mouseDrag(
  page: Page,
  card: Locator,
  dx: number,
  { flick = false, release = true } = {},
) {
  const { x, y } = await grip(card);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: flick ? 3 : 10 });
  if (!release) return;
  // A finger that rests before lifting is not flicking.
  if (!flick) await page.waitForTimeout(180);
  await page.mouse.up();
}

test('mouse drags commit by distance or flick, and cancel below the line', async ({
  page,
  request,
}) => {
  const card = await openDeck(page);
  const first = await title(card);
  const start = (await card.boundingBox())!;

  await mouseDrag(page, card, 50);
  await expect.poll(async () => Math.abs((await card.boundingBox())!.x - start.x)).toBeLessThan(2);
  expect(await title(card)).toBe(first);
  await expect(page.getByText(/^(Saved|Skipped) /)).toHaveCount(0);

  await mouseDrag(page, card, start.width * 0.55);
  await expect(page.getByText(/^Saved /)).toBeVisible();
  await expect.poll(() => title(card)).not.toBe(first);

  const second = await title(card);
  await page.waitForTimeout(400); // promotion
  await mouseDrag(page, card, -70, { flick: true });
  await expect(page.getByText(/^Skipped /)).toBeVisible();
  await expect.poll(() => title(card)).not.toBe(second);

  // Both verdicts reach the server: the first on the second one, the second after its hold.
  await expect
    .poll(async () => {
      const rows = await listJobs(request);
      return [
        rows.filter((j) => j.triage_status === 'shortlisted').length,
        rows.filter((j) => j.triage_status === 'skipped').length,
      ];
    }, { timeout: 10_000 })
    .toEqual([1, 1]);
});

test('the card tracks the pointer with colored feedback', async ({ page }, info) => {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const card = await openDeck(page);
    await page.screenshot({ path: `artifacts/u5-deck-${info.project.name}-${scheme}.png` });
    const start = (await card.boundingBox())!;
    await mouseDrag(page, card, 110, { release: false });
    const dragged = (await card.boundingBox())!;
    expect(dragged.x - start.x).toBeGreaterThan(70);
    await expect
      .poll(() =>
        card.locator('[data-stamp="shortlist"]').evaluate((el) => Number(getComputedStyle(el).opacity)),
      )
      .toBeGreaterThan(0.5);
    await page.screenshot({ path: `artifacts/u5-drag-${info.project.name}-${scheme}.png` });
    // Back to the middle: nothing is decided.
    const { x, y } = { x: start.x + start.width / 2, y: start.y + 36 };
    await page.mouse.move(x, y, { steps: 5 });
    await page.waitForTimeout(180);
    await page.mouse.up();
    await expect(page.getByText(/^(Saved|Skipped) /)).toHaveCount(0);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    // The dock never covers the card, even with an alert banner above.
    const footer = (await card.getByRole('button', { name: /Read posting/ }).boundingBox())!;
    const arrows = (await page.getByRole('button', { name: 'Previous job' }).boundingBox())!;
    expect(footer.y + footer.height).toBeLessThanOrEqual(arrows.y);
    // Every verdict button is on screen without scrolling.
    for (const name of [/^Skip/, /^Save/, 'Undo']) {
      const box = (await page
        .getByRole('button', { name, exact: typeof name === 'string' })
        .boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    }
  }
});

test('on touch, sideways swipes the card and vertical scrolls it', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'needs a touch screen');
  const card = await openDeck(page);
  await page.getByRole('button', { name: 'Browse queue' }).click();
  await page.getByRole('button', { name: /Infrastructure Engineer/ }).click();
  await expect.poll(() => title(card)).toBe('Infrastructure Engineer');
  await page.waitForTimeout(450);

  const cdp = await page.context().newCDPSession(page);
  const swipe = async (from: { x: number; y: number }, dx: number, dy: number) => {
    const send = (type: string, x: number, y: number) =>
      cdp.send('Input.dispatchTouchEvent', {
        type: type as 'touchStart',
        touchPoints: type === 'touchEnd' ? [] : [{ x, y }],
      });
    await send('touchStart', from.x, from.y);
    for (let i = 1; i <= 8; i++) {
      await page.waitForTimeout(16);
      await send('touchMove', from.x + (dx * i) / 8, from.y + (dy * i) / 8);
    }
    await send('touchEnd', 0, 0);
  };

  await card.getByRole('button', { name: 'Show full description' }).click();
  const body = card.getByTestId('card-body');
  await body.evaluate((el) => (el.scrollTop = 0));
  const area = (await body.boundingBox())!;

  await swipe({ x: area.x + area.width / 2, y: area.y + area.height - 30 }, 6, -180);
  await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(40);
  expect(await title(card)).toBe('Infrastructure Engineer');

  // Reading the expanded text never swipes, even sideways.
  await swipe({ x: area.x + 60, y: area.y + area.height - 60 }, 220, 0);
  await page.waitForTimeout(300);
  expect(await title(card)).toBe('Infrastructure Engineer');
  await expect(page.getByText(/^Saved /)).toHaveCount(0);
  await page.screenshot({ path: 'artifacts/u5-expanded-mobile.png' });

  const { x, y } = await grip(card);
  await swipe({ x: x - 60, y }, 200, 4);
  await expect(page.getByText('Saved Deck Example Works')).toBeVisible();
});

test('reduced motion still swipes, without animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const card = await openDeck(page);
  await mouseDrag(page, card, 260);
  await expect(page.getByText(/^Saved /)).toBeVisible();
  // No flying card: only the queue's own layers are ever in the stack.
  await expect(page.getByTestId('card-stack').locator(':scope > :not([data-layer])')).toHaveCount(0);
});

test('undo works after a verdict was sent, and leaves no pipeline entry', async ({
  page,
  request,
}, info) => {
  const card = await openDeck(page);
  const first = await title(card);
  const total = waiting(await listJobs(request));

  await page.keyboard.press('s');
  await expect.poll(async () => waiting(await listJobs(request)), { timeout: 10_000 }).toBe(
    total - 1,
  );
  expect((await listJobs(request)).filter((j) => j.application_stage === 'shortlisted').length)
    .toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Undo history' }).click();
  await expect(page.getByRole('dialog')).toContainText('Done');
  await page.screenshot({ path: `artifacts/u5-history-${info.project.name}.png` });
  const savedStageCount = async () =>
    (await listJobs(request)).filter((j) => j.application_stage === 'shortlisted').length;
  const before = await savedStageCount();
  await page.getByRole('dialog').getByRole('button', { name: /^Undo Saved/ }).click();
  await expect.poll(async () => waiting(await listJobs(request))).toBe(total);
  expect(await savedStageCount()).toBe(before - 1);
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  await expect.poll(() => title(card)).toBe(first);
});

test('list mode decides one tap or many, is remembered, and ends in a celebration', async ({
  page,
  request,
}, info) => {
  await openDeck(page);
  await page.getByRole('radio', { name: 'List' }).click();
  await expect(page.getByTestId('triage-list')).toBeVisible();
  await page.reload();
  const list = page.getByTestId('triage-list');
  await expect(list).toBeVisible();
  const total = waiting(await listJobs(request));

  await page.getByRole('checkbox', { name: /^Select .* at / }).nth(0).check();
  await page.getByRole('checkbox', { name: /^Select .* at / }).nth(1).check();
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(250);
    await page.screenshot({ path: `artifacts/u5-list-${info.project.name}-${scheme}.png` });
  }
  await page.getByRole('button', { name: 'Skip 2' }).click();
  await expect(page.getByText('Skipped 2 jobs')).toBeVisible();
  await expect.poll(async () => waiting(await listJobs(request))).toBe(total - 2);

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => waiting(await listJobs(request))).toBe(total);
  await expect(page.getByRole('checkbox', { name: /^Select .* at / })).toHaveCount(total);

  await page.getByRole('button', { name: 'Sort and filter' }).click();
  await page.getByRole('searchbox', { name: 'Search the queue' }).fill('Infrastructure');
  await expect(page.getByRole('checkbox', { name: /^Select .* at / })).toHaveCount(1);
  await page.screenshot({ path: `artifacts/u5-filters-${info.project.name}.png` });
  await list.getByRole('button', { name: /^Save Infrastructure Engineer/ }).click();
  await page.getByRole('searchbox', { name: 'Search the queue' }).fill('');
  await page.getByRole('button', { name: 'Sort and filter' }).click();

  await page.getByRole('checkbox', { name: 'Select all' }).check();
  await page.getByRole('button', { name: `Skip ${total - 1}` }).click();
  await expect(page.getByTestId('queue-complete')).toContainText(`You decided ${total} jobs`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `artifacts/u5-complete-${info.project.name}.png` });
  await expect.poll(async () => waiting(await listJobs(request))).toBe(0);
});
