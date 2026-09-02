import { expect, test, type Page } from '@playwright/test';

/**
 * The lifecycle and the evidence that unblocks it, through the browser.
 *
 * These two features are tested together because neither is useful alone: the lifecycle machine
 * refuses to advance without gate evidence, and recording evidence has no visible effect except that
 * the lifecycle then moves. Testing them separately would verify that each half runs, which is the
 * thing that was already true of every other orphaned module in this codebase.
 *
 * What this asserts, in one journey: a project starts at IDEA, the refusal names the gate that is
 * blocking it, recording evidence changes that answer, and the recorded evidence survives a plan
 * regeneration — the failure mode the projection exists to prevent.
 */

const MOBILE_SAFARI_NOTE =
  'WebKit drops the session cookie over plain HTTP; runs against HTTPS (KI-024)';

function webkitOverInsecureOrigin(browserName: string, baseURL: string | undefined): boolean {
  return browserName === 'webkit' && (baseURL ?? '').startsWith('http://');
}

async function startProject(page: Page, idea: string): Promise<string> {
  await page.goto('/start');
  await page.getByLabel(/describe your project/i).fill(idea);
  await page.getByRole('button', { name: /continue/i }).click();
  await expect(page).toHaveURL(/\/intake\/[0-9a-f-]{36}/);

  const projectId = /\/intake\/([^/?]+)/.exec(page.url())?.[1] ?? '';
  expect(projectId).not.toBe('');
  return projectId;
}

test.describe('the lifecycle', () => {
  test.beforeEach(({ browserName, baseURL }) => {
    test.skip(webkitOverInsecureOrigin(browserName, baseURL), MOBILE_SAFARI_NOTE);
  });

  test('a new project starts at the beginning and says so', async ({ page }) => {
    const projectId = await startProject(page, 'A booking tool for a physiotherapy clinic.');
    await page.goto(`/plan/${projectId}`);

    const lifecycle = page.getByRole('region', { name: /where this project is/i });
    await expect(lifecycle).toBeVisible();

    // The whole path is shown, not just the current step: a stage means little without what is
    // ahead of it.
    await expect(lifecycle).toContainText('Stage 1 of 12');
    await expect(lifecycle.getByRole('listitem').first()).toContainText('Idea');
  });

  test('offers the next step and nothing further', async ({ page }) => {
    /*
     * The machine is a line, not a menu. If this ever shows two moves from IDEA, an edge has been
     * added that skips a stage — and every gate attached to the skipped stage stops being consulted.
     */
    const projectId = await startProject(page, 'A rota tool for a veterinary practice.');
    await page.goto(`/plan/${projectId}`);

    const moves = page.getByRole('heading', { name: /^Move to /i });
    await expect(moves).toHaveCount(1);
    await expect(moves.first()).toContainText('Discovery');
  });

  test('advances when nothing is required, and records where it got to', async ({ page }) => {
    const projectId = await startProject(page, 'An inventory tool for a bike shop.');
    await page.goto(`/plan/${projectId}`);

    await page.getByRole('button', { name: /move to discovery/i }).click();
    await expect(page).toHaveURL(new RegExp(`/plan/${projectId}`));

    const lifecycle = page.getByRole('region', { name: /where this project is/i });
    await expect(lifecycle).toContainText('Stage 2 of 12');
  });

  test('names the gate that is blocking it rather than only refusing', async ({ page }) => {
    /*
     * The load-bearing assertion of the whole feature. An operator who cannot see *which* gate
     * blocked them asks for the gate to be removed — so a refusal that does not name its cause is
     * worse than no gate at all.
     */
    const projectId = await startProject(page, 'A claims tool for an insurance broker.');
    await page.goto(`/plan/${projectId}`);
    await page.getByRole('button', { name: /move to discovery/i }).click();

    const lifecycle = page.getByRole('region', { name: /where this project is/i });
    await expect(lifecycle).toContainText(/not passed/i);
    await expect(lifecycle).toContainText(/discovery/i);

    // Never offers a way around itself.
    await expect(lifecycle).not.toContainText(/override|bypass|force|skip/i);
  });
});

test.describe('evidence and approvals', () => {
  test.beforeEach(({ browserName, baseURL }) => {
    test.skip(webkitOverInsecureOrigin(browserName, baseURL), MOBILE_SAFARI_NOTE);
  });

  test('lists every criterion a person has to confirm, with why it matters', async ({ page }) => {
    const projectId = await startProject(page, 'A payments tool for a letting agency.');
    await page.goto(`/plan/${projectId}/evidence`);

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Seventeen MANUAL criteria in the catalogue. Asserted as a count so a criterion that stops being
    // offered is caught — that is exactly how all seventeen came to be unsatisfiable.
    await expect(page.getByText(/of 17 recorded/)).toBeVisible();
    await expect(page.getByText(/block a gate until recorded/)).toBeVisible();
  });

  test('records evidence and stops asking for it', async ({ page }) => {
    const projectId = await startProject(page, 'A scheduling tool for a dental practice.');
    await page.goto(`/plan/${projectId}/evidence`);

    await expect(page.getByText(/^0 of 17 recorded/)).toBeVisible();

    const form = page
      .locator('form')
      .filter({ has: page.getByLabel(/what is it/i) })
      .first();
    await form.getByLabel(/what is it/i).fill('Rollback rehearsed and timed');
    await form.getByLabel(/or state what was done/i).fill('Rolled back in staging, 13 seconds.');
    await form.getByRole('button', { name: /record it/i }).click();

    await expect(page.getByRole('status')).toContainText(/evidence recorded/i);
    await expect(page.getByText(/^1 of 17 recorded/)).toBeVisible();
  });

  test('refuses evidence that points at nothing', async ({ page }) => {
    // A record with no note, no link and no file is a claim that something exists, which is the one
    // thing evidence must not be.
    const projectId = await startProject(page, 'A CRM for a plumbing firm.');
    await page.goto(`/plan/${projectId}/evidence`);

    const form = page
      .locator('form')
      .filter({ has: page.getByLabel(/what is it/i) })
      .first();
    await form.getByLabel(/what is it/i).fill('Nothing behind this');
    await form.getByRole('button', { name: /record it/i }).click();

    /*
     * Filtered rather than assumed to be the only alert.
     *
     * `getByRole('alert')` was a strict-mode violation in CI: the page can carry more than one at a
     * time, and asserting on "the alert" makes the test depend on how many there happen to be
     * rather than on the one it cares about.
     */
    await expect(page.getByRole('alert').filter({ hasText: /link or a note/i })).toBeVisible();
    await expect(page.getByText(/^0 of 17 recorded/)).toBeVisible();
  });

  test('refuses an approval with no reason', async ({ page }) => {
    const projectId = await startProject(page, 'A quoting tool for a roofing company.');
    await page.goto(`/plan/${projectId}/evidence`);

    const approval = page
      .locator('form')
      .filter({ has: page.getByLabel(/why you are approving/i) })
      .first();

    // The textarea is `required`, so the browser blocks submission — which is the assertion: the
    // control is enforced before the request, and the server enforces it again.
    await expect(approval.getByLabel(/why you are approving/i)).toHaveAttribute('required', '');
  });

  test('evidence survives regenerating the plan', async ({ page }) => {
    /*
     * The reason evidence lives in its own table rather than as a twin node.
     *
     * `generatePlan` deletes every node and edge for the project and rewrites them. Evidence stored
     * as a node would survive exactly until somebody pressed "Build the plan" again, and its
     * disappearance would look like a gate spontaneously regressing rather than like data loss.
     */
    const projectId = await startProject(page, 'A logistics tool for a courier firm.');

    await page.goto(`/plan/${projectId}/evidence`);
    const form = page
      .locator('form')
      .filter({ has: page.getByLabel(/what is it/i) })
      .first();
    await form.getByLabel(/what is it/i).fill('Survives regeneration');
    await form.getByLabel(/or state what was done/i).fill('Recorded before the plan was rebuilt.');
    await form.getByRole('button', { name: /record it/i }).click();
    await expect(page.getByText(/^1 of 17 recorded/)).toBeVisible();

    await page.goto(`/plan/${projectId}`);
    await page.getByRole('button', { name: /build the plan/i }).click();
    await expect(page.getByRole('heading', { name: /what the engine produced/i })).toBeVisible();

    await page.goto(`/plan/${projectId}/evidence`);
    await expect(page.getByText(/^1 of 17 recorded/)).toBeVisible();
    await expect(page.getByText('Survives regeneration')).toBeVisible();
  });

  test('a second guest cannot see the first guest’s evidence', async ({ page, browser }) => {
    const projectId = await startProject(page, 'A tool holding commercially sensitive pricing.');

    await page.goto(`/plan/${projectId}/evidence`);
    const form = page
      .locator('form')
      .filter({ has: page.getByLabel(/what is it/i) })
      .first();
    await form.getByLabel(/what is it/i).fill('Confidential rollback plan');
    await form
      .getByLabel(/or state what was done/i)
      .fill('Should never be visible to anyone else.');
    await form.getByRole('button', { name: /record it/i }).click();
    await expect(page.getByRole('status')).toBeVisible();

    // A different browser context is a different guest session, and therefore a different tenant.
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    const response = await otherPage.goto(`/plan/${projectId}/evidence`);

    // 404, never 403: a 403 confirms the project exists and belongs to somebody else, and existence
    // is itself tenant data.
    expect(response?.status()).toBe(404);
    await expect(otherPage.getByText('Confidential rollback plan')).toHaveCount(0);

    await other.close();
  });
});
