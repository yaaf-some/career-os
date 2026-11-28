import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const seed = JSON.parse(readFileSync(new URL('../fixtures/jobs.json', import.meta.url), 'utf8'));

test.beforeEach(async ({ request }) => {
  await request.post('/api/jobs/ingest', { data: seed });
  const { jobs } = await (await request.get('/api/jobs?limit=200')).json();
  // Both projects share one database, so put earlier verdicts back in the queue.
  for (const job of jobs) {
    await request.post(`/api/triage/${job.id}`, { data: { action: 'restore' } });
  }
});

test('the card follows a drag, and releasing it far right saves', async ({ page }, info) => {
  await page.goto('/triage');
  const card = page.getByTestId('focus-card');
  await expect(card).toBeVisible();
  await page.waitForTimeout(500); // entrance animation
  await page.screenshot({ path: `artifacts/triage-${info.project.name}.png` });

  const start = (await card.boundingBox())!;
  const x = start.x + start.width / 2;
  const y = start.y + 30;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 140, y, { steps: 8 });
  const dragged = (await card.boundingBox())!;
  expect(dragged.x - start.x).toBeGreaterThan(100);

  await page.mouse.up();
  await expect(page.getByText(/^Saved /)).toBeVisible();
});

test('a missing description can be pasted in and is cleaned', async ({ page }, info) => {
  await page.goto('/triage');
  await page.getByRole('button', { name: 'Browse queue' }).click();
  await page.getByRole('button', { name: /DevOps Engineer/ }).click();
  await page.getByRole('button', { name: /Read posting/ }).click();
  const sheet = page.getByRole('dialog');

  await sheet.getByRole('button', { name: /^(Paste|Edit)$/ }).click();
  await sheet
    .getByLabel('Job description text')
    .fill(`Own the delivery pipeline (${info.project.name}).<div style="display:none">hidden</div>`);
  await sheet.getByRole('button', { name: 'Save description' }).click();

  await expect(sheet.getByText(`Own the delivery pipeline (${info.project.name}).`)).toBeVisible();
  await expect(sheet.getByText('hidden')).toHaveCount(0);
  await page.screenshot({ path: `artifacts/description-${info.project.name}.png` });
});

test('writes from another site are refused', async ({ request }) => {
  const res = await request.post('/api/jobs/backfill-descriptions', {
    headers: { 'sec-fetch-site': 'cross-site' },
    data: {},
  });
  expect(res.status()).toBe(403);
});

test('the API and scanner agree on the description fetch contract', async ({ request }) => {
  const { jobs } = await (await request.get('/api/jobs?limit=200')).json();
  // example.com is not a job board, so this exercises both services without leaving the machine.
  const res = await request.post(`/api/jobs/${jobs[0].id}/fetch-description`);
  expect(await res.json()).toEqual({ status: 'unsupported' });
  const backfill = await (await request.post('/api/jobs/backfill-descriptions', { data: {} })).json();
  expect(backfill.failed).toBe(0);
});
