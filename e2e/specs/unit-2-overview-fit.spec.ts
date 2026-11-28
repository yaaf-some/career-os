import { expect, test, type Page } from '@playwright/test';

async function expectNoSidewaysScroll(page: Page, where: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${where} overflows horizontally`).toBeLessThanOrEqual(0);
}

async function snapshot(page: Page, name: string, project: string) {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(350);
    await page.screenshot({
      path: `artifacts/unit2-${name}-${project}-${scheme}.png`,
      fullPage: true,
    });
    await expectNoSidewaysScroll(page, name);
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

test('edit, tag, note, score, evaluate, archive and delete one job', async ({ page, request }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  // This job is deleted at the end, so it belongs to this spec alone.
  const slug = `unit2-${info.project.name}`;
  const url = `https://example.com/jobs/${slug}`;
  const company = `Overview Fixtures ${info.project.name}`;
  const added = await request.post('/api/jobs', {
    data: { url, company, title: 'Infrastructure Engineer' },
  });
  expect(added.ok()).toBeTruthy();
  const { id } = await added.json();

  await page.goto(`/jobs/${id}`);
  const job = page.getByTestId('job-page');
  const heading = job.getByRole('heading', { level: 1 });
  await expect(heading).toHaveText('Infrastructure Engineer');

  // Edit the stored fields.
  await job.getByRole('button', { name: 'Edit details' }).click();
  await job.getByLabel('Title').fill('Senior Infrastructure Engineer');
  await job.getByLabel('Location').fill('Los Angeles, CA');
  await job.getByRole('combobox', { name: 'Workplace type' }).click();
  await page.getByRole('option', { name: 'Hybrid' }).click();
  await job.getByLabel('Salary from').fill('150k');
  await job.getByLabel('Salary to').fill('120k');
  await job.getByLabel('Currency').fill('usd');
  await job.getByRole('button', { name: 'Save details' }).click();
  await expect(job.getByRole('alert')).toContainText('cannot be higher than the top salary');
  await snapshot(page, 'edit-form', info.project.name);
  await job.getByLabel('Salary to').fill('185,000');
  await job.getByRole('button', { name: 'Save details' }).click();
  await expect(heading).toHaveText('Senior Infrastructure Engineer');
  await expect(job.getByText('USD 150k–185k').first()).toBeVisible();

  // Tags: add, rename, remove.
  const newTag = job.getByRole('textbox', { name: 'New tag' });
  for (const tag of ['referral', 'a-long-tag-name-to-wrap-nicely']) {
    await newTag.fill(tag);
    await newTag.press('Enter');
    await expect(job.getByRole('button', { name: `Rename tag ${tag}` })).toBeVisible();
  }
  await job.getByRole('button', { name: 'Rename tag referral' }).click();
  await job.getByRole('textbox', { name: 'New name for tag referral' }).fill('warm intro');
  await job.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(job.getByRole('button', { name: 'Rename tag warm intro' })).toBeVisible();
  await job.getByRole('button', { name: 'Remove tag a-long-tag-name-to-wrap-nicely' }).click();
  await expect(job.getByRole('button', { name: /a-long-tag-name/ })).toHaveCount(0);

  // Notes: add, edit, delete.
  const newNote = job.getByRole('textbox', { name: 'New note' });
  await newNote.fill('Ask about the on-call rotation.');
  await job.getByRole('button', { name: 'Add note' }).click();
  await expect(job.getByText('Ask about the on-call rotation.')).toBeVisible();
  await expect(newNote).toHaveValue('');
  const note = job.getByRole('listitem').filter({ hasText: 'on-call rotation' });
  await note.getByRole('button', { name: 'Edit' }).click();
  await job.getByRole('textbox', { name: 'Edit note' }).fill('Ask about on-call and the team size.');
  await job.getByRole('button', { name: 'Save note' }).click();
  await expect(job.getByText('Ask about on-call and the team size.')).toBeVisible();
  await newNote.fill('A second note to delete.');
  await job.getByRole('button', { name: 'Add note' }).click();
  const extra = job.getByRole('listitem').filter({ hasText: 'A second note' });
  await extra.getByRole('button', { name: 'Delete' }).click();
  await extra.getByRole('button', { name: 'Delete for good' }).click();
  await expect(extra).toHaveCount(0);

  // The description editor is still there.
  await job.getByRole('button', { name: 'Paste', exact: true }).click();
  const longText = `Run the platform.\n\n${'• Keep Kubernetes clusters healthy and well documented.\n'.repeat(40)}`;
  await job.getByRole('textbox', { name: 'Job description text' }).fill(longText);
  await job.getByRole('button', { name: 'Save description' }).click();
  const unfold = job.getByRole('button', { name: 'Show full description' });
  await expect(unfold).toBeVisible();
  await snapshot(page, 'description-folded', info.project.name);
  await unfold.click();
  await expect(job.getByRole('button', { name: 'Show less' })).toBeVisible();
  await job.getByRole('button', { name: 'Show less' }).click();
  await snapshot(page, 'overview', info.project.name);

  // A reload keeps everything.
  await page.reload();
  await expect(heading).toHaveText('Senior Infrastructure Engineer');
  await expect(job.getByText('Ask about on-call and the team size.')).toBeVisible();
  await expect(job.getByRole('button', { name: 'Rename tag warm intro' })).toBeVisible();

  // Fit: rescore this job only, then run evaluations at two tiers.
  await job.getByRole('tab', { name: 'Fit' }).click();
  await job.getByRole('button', { name: 'Rescore this job' }).click();
  await expect(page.getByTestId('toast-viewport')).toContainText('Rescored: 78 of 100');
  await expect(
    job.getByRole('tabpanel', { name: 'Fit' }).getByText('Mock fast triage match on systems and backend scope.'),
  ).toBeVisible();

  await job.getByRole('button', { name: 'Run deep analysis' }).click();
  await expect(job.getByTestId('report-markdown')).toContainText('Mock Deep Evaluation');
  await job.getByRole('combobox', { name: 'Analysis tier' }).click();
  await page.getByRole('option', { name: 'Fast' }).click();
  await job.getByRole('button', { name: 'Run again' }).click();
  await expect(job.getByText('History (2)')).toBeVisible();
  const history = job.locator('button[aria-pressed]');
  await expect(history).toHaveCount(2);
  await expect(history.first()).toContainText('Fast');
  await history.last().click();
  await expect(history.last()).toHaveAttribute('aria-pressed', 'true');
  await expect(job.getByTestId('evaluation')).toContainText('mock-deep');
  await snapshot(page, 'fit', info.project.name);

  // Archive hides it from the list; unarchive brings it back.
  await job.getByRole('tab', { name: 'Overview' }).click();
  await job.getByRole('button', { name: 'Archive job' }).click();
  await expect(job.getByText('Archived. It is hidden from your job list.')).toBeVisible();
  const listed = async () =>
    ((await (await request.get('/api/jobs?limit=200')).json()).jobs as { id: string }[]).some(
      (j) => j.id === id,
    );
  expect(await listed()).toBe(false);
  await job.getByRole('button', { name: 'Unarchive', exact: true }).click();
  await expect(job.getByRole('button', { name: 'Archive job' })).toBeVisible();
  expect(await listed()).toBe(true);

  // Delete needs the confirm step.
  await job.getByRole('button', { name: 'Delete permanently' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('This cannot be undone.');
  // Let the dialog finish rising before the picture.
  await page.waitForTimeout(600);
  await page.screenshot({ path: `artifacts/unit2-delete-${info.project.name}.png` });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  expect((await request.get(`/api/jobs/${id}`)).status()).toBe(200);
  await job.getByRole('button', { name: 'Delete permanently' }).click();
  await dialog.getByRole('button', { name: 'Delete job' }).click();
  await expect(page.getByTestId('jobs-view')).toBeVisible();
  expect((await request.get(`/api/jobs/${id}`)).status()).toBe(404);

  expect(errors).toEqual([]);
});
