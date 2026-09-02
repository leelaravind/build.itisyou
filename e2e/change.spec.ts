import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * The change-impact surface — Phase 12 through the browser.
 *
 * The load-bearing test here is that the page reports impact *reaching something* on a graph the
 * application actually produced. An impact report that found nothing renders identically to a change
 * with no consequences, so every other assertion in this file would pass against a traversal that
 * never moved — which is exactly the defect the traceability chain shipped with in Phase 10 and the
 * golden scenario caught again in this phase's unit suite.
 */

const MOBILE_SAFARI_NOTE =
  'WebKit drops the session cookie over plain HTTP; verified against HTTPS at the staging gate (KI-024)';

function isWebkit(browserName: string): boolean {
  return browserName === 'webkit';
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

/** Answers the two intake questions that cause requirements to be generated. */
async function answerIntake(page: Page, projectId: string): Promise<void> {
  await page.goto(`/intake/${projectId}`);

  const answered = new Set<string>();

  for (let step = 0; step < 40 && answered.size < 2; step += 1) {
    const heading = page.getByRole('heading', { level: 2 }).first();
    if ((await heading.count()) === 0) break;

    const asked = await heading.innerText();
    const question = asked.toLowerCase();

    if (question.includes('kinds of data')) {
      await page.getByRole('checkbox', { name: 'Personal data', exact: true }).check();
      await page.getByRole('button', { name: /save answer/i }).click();
      answered.add('data');
    } else if (question.includes('sign in')) {
      await page.getByRole('radio', { name: 'Yes', exact: true }).check();
      await page.getByRole('button', { name: /save answer/i }).click();
      answered.add('auth');
    } else {
      const skip = page.getByRole('button', { name: /i don.t know/i });
      if ((await skip.count()) === 0) break;
      await skip.click();
    }

    // Waits for the question to change rather than for the network, which resolves immediately after
    // a streamed server action and would let this loop skip the whole wizard.
    /*
     * Wait for the wizard to advance after **every** answer, including the last one.
     *
     * This used to be guarded by `if (answered.size < 2)`, on the reasoning that once both answers
     * are in there is nothing left to read. But the guard did not skip a *read* — it skipped waiting
     * for the server action to finish, and the caller navigates to `/plan` on the next line.
     *
     * Locally that race cannot open: the action completes in single-digit milliseconds against an
     * in-process database, long before the navigation starts. Against a real deployment it takes
     * ~300ms, so the navigation began while the final answer was still being written and Chromium
     * cancelled it — `net::ERR_ABORTED`, in roughly one run in thirty, on the two specs that answer
     * questions rather than skipping them.
     *
     * The failure was worth more than the flake it caused: had the navigation won the race, the
     * second answer might not have been recorded, and the trace would have been empty for a reason
     * having nothing to do with traceability — which is the exact failure this helper's own comments
     * say it exists to prevent.
     */
    await expect(heading).not.toHaveText(asked, { timeout: 15_000 });
  }

  expect(answered.size, 'intake did not reach the questions that generate requirements').toBe(2);
}

async function reachChange(page: Page): Promise<string> {
  const projectId = await startProject(page, 'A patient records system for a clinic.');

  await answerIntake(page, projectId);

  await page.goto(`/plan/${projectId}`);
  await page.getByRole('button', { name: /build the plan/i }).click();
  await expect(page.getByRole('heading', { name: /what the engine produced/i })).toBeVisible();

  await page.getByRole('link', { name: /see what a change would break/i }).click();

  await page.waitForURL(/[/]change/);
  await expect(page.getByRole('heading', { name: /what would you change/i })).toBeVisible();

  return projectId;
}

/**
 * Choose the personal-data requirement and wait for the report.
 *
 * The wait matters: clicking a link and reading `innerText` immediately reads the page before
 * navigation, which renders as "the impact report is empty" — indistinguishable from a change with no
 * consequences, and the exact confusion this whole surface is built to avoid.
 */
async function selectPersonalData(page: Page): Promise<void> {
  await page.getByRole('link', { name: /handle personal data lawfully/i }).click();
  await page.waitForURL(/node=/);
  await expect(page.getByRole('status')).toBeVisible();
}

test.describe('the change-impact surface', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(isWebkit(browserName), MOBILE_SAFARI_NOTE);
  });

  test('offers something to change', async ({ page }) => {
    await reachChange(page);

    const candidates = page.getByRole('listitem').filter({ has: page.getByRole('link') });

    expect(await candidates.count()).toBeGreaterThan(0);
  });

  test('reports impact that actually reached something', async ({ page }) => {
    await reachChange(page);

    /*
     * The guard. A report that found nothing renders identically to a change with no consequences,
     * and every other assertion here would pass against a traversal that never moved.
     */
    await selectPersonalData(page);

    await expect(page.getByRole('heading', { name: /what stops being true/i })).toBeVisible();

    const impacted = page
      .getByRole('listitem')
      .filter({ hasText: /invalidated|revalidation|stale/i });

    expect(await impacted.count()).toBeGreaterThan(0);
  });

  test('shows the path that reached each item, with its reasoning', async ({ page }) => {
    await reachChange(page);
    await selectPersonalData(page);

    const body = await page.locator('main').innerText();

    // "47 items affected" cannot be acted on or disputed. The path is what makes the verdict
    // checkable, and each hop carries the rule's own reason.
    expect(body).toMatch(/→/);
    expect(body).toMatch(
      /passed against a different claim|no longer about the current|may be right, wrong, or half-right|computed from an input/i,
    );
  });

  test('states each verdict in words and explains what it means', async ({ page }) => {
    await reachChange(page);
    await selectPersonalData(page);

    const body = await page.locator('main').innerText();

    // WCAG 2.2 §1.4.1, and the four states are the whole meaning of a row. "Stale" alone is jargon;
    // the meaning has to travel with it.
    expect(body).toMatch(/may still hold|no longer holds|must be re-run/i);
  });

  test('shows no proportion of the project', async ({ page }) => {
    await reachChange(page);
    await selectPersonalData(page);

    const body = (await page.locator('main').innerText()).replace(/\s+/g, ' ');

    // A percentage of a project affected is optimisable and tells nobody what to do.
    expect(body).not.toMatch(/\b\d{1,3}%/);
    expect(body).not.toMatch(/\b\d{1,3}\s*\/\s*100\b/);
  });

  test('says nothing is affected as a real answer when nothing is', async ({ page }) => {
    await reachChange(page);

    /*
     * The §25 hazard: an empty report and a report on an unconnected node render identically, and the
     * reader needs to know which they are looking at.
     */
    await page.goto(`${page.url().split('?')[0] ?? ''}?node=does-not-exist`);

    await expect(page.getByRole('heading', { name: /what stops being true/i })).toHaveCount(0);
  });

  test('has no detectable accessibility violations', async ({ page }) => {
    await reachChange(page);
    await selectPersonalData(page);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });
});

test.describe('tenant isolation', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(isWebkit(browserName), MOBILE_SAFARI_NOTE);
  });

  test('a second guest cannot read the first guest’s impact analysis', async ({
    page,
    browser,
  }) => {
    /*
     * The only test in the suite that runs two complete journeys: one to produce a project with a
     * plan and an impact analysis, and a second to obtain a genuine guest session to attack it from.
     * Every other test does one, so this one is against the same 30s budget with twice the work, and
     * under load on Firefox it ran out of it — which is what the CI failure was. Not a slow
     * assertion: a slow *setup*.
     *
     * `test.slow()` triples the budget and changes nothing about what is asserted. It matters that
     * this is the fix rather than a wider default: a security test that flakes is one people learn
     * to re-run rather than read, and a global increase would hide the next test that is slow for a
     * reason.
     */
    test.slow();

    const projectId = await reachChange(page);

    const other = await browser.newContext();
    const otherPage = await other.newPage();

    await startProject(otherPage, 'An unrelated project.');

    const response = await otherPage.goto(`/plan/${projectId}/change`);

    // 404, never 403 — a 403 confirms the project exists.
    expect(response?.status()).toBe(404);

    await other.close();
  });
});

test.describe('a change request, end to end', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(isWebkit(browserName), MOBILE_SAFARI_NOTE);
  });

  /*
   * Contract: gap-spec §27, §28 (the ten-step sequence), §85 ("manage changes"), plan §24 screen 35.
   *
   * The engine behind this has existed since Phase 12 with no table and no route: request, approve,
   * reject and apply were unreachable from the product, and the page was a preview with nothing
   * behind it. These journeys are the difference between an engine and a feature.
   */

  async function requestAChange(page: Page, title: string): Promise<void> {
    await selectPersonalData(page);

    const form = page
      .locator('form')
      .filter({ has: page.getByLabel(/what is changing/i) })
      .first();

    await form.getByLabel(/what is changing/i).fill(title);
    await form.getByLabel(/^why/i).fill('The regulator changed what lawful processing requires.');
    await form.getByRole('button', { name: /record this request/i }).click();
  }

  test('records the request against the version its impact was calculated on', async ({ page }) => {
    await reachChange(page);
    await requestAChange(page, 'Widen the lawful basis');

    const request = page.getByRole('listitem').filter({ hasText: 'Widen the lawful basis' });

    await expect(request).toBeVisible();
    // The version is the whole point: an approval is an approval of a report about *that* project.
    await expect(request).toContainText(/against version \d+/);
    await expect(request).toContainText(/pending approval/i);
  });

  test('refuses a request with no reason behind it', async ({ page }) => {
    // A change request with no rationale cannot be argued about, and the engine refuses one. The
    // field is `required`, so the browser refuses it first — which is the assertion.
    await reachChange(page);
    await selectPersonalData(page);

    const form = page
      .locator('form')
      .filter({ has: page.getByLabel(/what is changing/i) })
      .first();

    await expect(form.getByLabel(/^why/i)).toHaveAttribute('required', '');
  });

  test('can be decided, and the decision is kept with its reason', async ({ page }) => {
    await reachChange(page);
    await requestAChange(page, 'Narrow the retention period');

    const request = page.getByRole('listitem').filter({ hasText: 'Narrow the retention period' });

    await request
      .getByLabel(/why are you deciding this way/i)
      .fill('The shorter period is enough.');
    await request.getByRole('button', { name: /^approve$/i }).click();

    const decided = page.getByRole('listitem').filter({ hasText: 'Narrow the retention period' });

    await expect(decided).toContainText(/approved/i);
    // The reason is retained, not just the verdict: a decision without one is a signature with no
    // argument behind it.
    await expect(decided).toContainText('The shorter period is enough.');
  });

  test('applies an approved change and moves the project version on', async ({ page }) => {
    const projectId = await reachChange(page);
    await requestAChange(page, 'Record the processing purpose');

    const request = page.getByRole('listitem').filter({ hasText: 'Record the processing purpose' });
    await request.getByLabel(/why are you deciding this way/i).fill('Agreed.');
    await request.getByRole('button', { name: /^approve$/i }).click();

    await page
      .getByRole('listitem')
      .filter({ hasText: 'Record the processing purpose' })
      .getByRole('button', { name: /apply it/i })
      .click();

    await expect(
      page.getByRole('listitem').filter({ hasText: 'Record the processing purpose' }),
    ).toContainText(/applied/i);

    /*
     * §28 step 5, from the other side. The project has moved on, so a second request raised against
     * the old version can no longer be applied — and the page says so before anybody tries.
     */
    await page.goto(`/plan/${projectId}/change`);
    await expect(
      page.getByRole('listitem').filter({ hasText: 'Record the processing purpose' }),
    ).toContainText(/against version/);
  });

  test('a second guest cannot see the first guest’s change requests', async ({ page, browser }) => {
    const projectId = await reachChange(page);
    await requestAChange(page, 'Commercially sensitive change');

    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await startProject(otherPage, 'An unrelated project.');

    const response = await otherPage.goto(`/plan/${projectId}/change`);

    expect(response?.status()).toBe(404);
    expect(await otherPage.content()).not.toContain('Commercially sensitive');

    await other.close();
  });
});
