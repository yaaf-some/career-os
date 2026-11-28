import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const seed = JSON.parse(readFileSync(new URL('../fixtures/jobs.json', import.meta.url), 'utf8'));

test.beforeEach(async ({ request }) => {
  await request.post('/api/jobs/ingest', { data: seed });
  await request.post('/api/ai/score-pending', { data: { limit: 10 } });
});

test('every screen renders without errors in light and dark', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const screens = [
    ['jobs', '/', 'jobs-view'],
    ['pipeline', '/?view=pipeline', 'tracker-view'],
    ['triage', '/triage', 'triage-view'],
    ['today', '/today', 'today-view'],
    ['files', '/files', 'files-view'],
    ['sources', '/sources', 'sources-view'],
    ['settings', '/settings', 'settings-view'],
  ] as const;
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const [name, path, testId] of screens) {
      await page.goto(path);
      await expect(page.getByTestId(testId)).toBeVisible();
      await page.waitForTimeout(450);
      await page.screenshot({ path: `artifacts/${name}-${info.project.name}-${scheme}.png` });
      // Nothing should scroll sideways, least of all on a phone.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${name} overflows horizontally`).toBeLessThanOrEqual(0);
    }
  }
  expect(errors).toEqual([]);
});

test('a job has its own address, tabs and a stage once saved', async ({ page }, info) => {
  await page.goto('/');
  await page.getByRole('searchbox', { name: 'Search jobs' }).fill('Example Cloud');
  await page.getByRole('button', { name: /Platform Engineer/ }).first().click();
  await expect(page).toHaveURL(/\/jobs\//);
  const job = page.getByTestId('job-page');

  const save = job.getByRole('button', { name: 'Save', exact: true });
  const stage = job.getByRole('combobox', { name: 'Application stage' });
  await expect(save.or(stage)).toBeVisible();
  if (await save.isVisible()) await save.click();
  await expect(stage).toBeVisible();
  await expect(stage).toContainText('Saved');

  const active = job.getByRole('tab', { name: 'Documents' });
  await active.click();
  await expect(page).toHaveURL(/tab=documents/);
  // The selected tab is underlined in the accent color.
  // Polled because the color fades in.
  const underline = () => active.evaluate((el) => getComputedStyle(el).borderBottomColor);
  const idle = await job
    .getByRole('tab', { name: 'Fit' })
    .evaluate((el) => getComputedStyle(el).borderBottomColor);
  await expect.poll(underline, { message: await active.evaluate((el) => el.outerHTML) }).not.toBe(idle);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `artifacts/job-${info.project.name}.png`, fullPage: true });

  await page.reload();
  await expect(page.getByRole('tab', { name: 'Documents' })).toHaveAttribute('aria-selected', 'true');
  await page.goBack();
  await expect(page.getByTestId('jobs-view')).toBeVisible();
});
