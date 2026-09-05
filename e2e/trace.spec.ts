import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * The traceability surface — Phase 10 through the browser.
 *
 * The Phase-10 gate is "complete Requirement→Release chain verified", and the unit suite verifies the
 * chain against constructed graphs. What it cannot verify is that the chain is walked over a graph
 * the *application* actually produces — which is where the module's first defect lived: hops
 * describing edges the twin does not permit produced traces that were empty and confident, and an
 * empty trace looks exactly like a project that has not done the work.
 *
 * So the load-bearing test here asserts the page reports real structure on a generated project, not
 * merely that it renders.
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

/**
 * Answer intake until the questions that generate requirements have been answered.
 *
 * Driven by *which question is on screen* rather than by position, because the wizard's order is
 * rule-driven and a positional script would break the first time a rule changed what it asks next.
 *
 * The two answers that matter are the ones the requirement rules key off: holding personal data, and
 * users signing in. Everything else is answered "I don't know", which is both faster and a more
 * honest fixture — a real guest does not know most of this on the first pass.
 */
async function answerIntake(page: Page, projectId: string): Promise<void> {
  await page.goto(`/intake/${projectId}`);

  const answered = new Set<string>();

  // Bounded rather than open-ended: an unbounded loop over a wizard that stops advancing would hang
  // until the whole suite timed out, with nothing to say about why.
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

    /*
     * Wait for the *question* to change, not for the network to go idle.
     *
     * The first version awaited `networkidle`, which resolves immediately after a server action that
     * streams its response — so the next iteration read the heading of the question it had just
     * answered, decided it had already handled it, and clicked "I don't know" through the whole
     * wizard without ever reaching the two questions this helper exists to answer.
     */
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

  // If the wizard stopped asking before both were answered, every later assertion here would be
  // about an empty graph and would fail for a reason that has nothing to do with traceability.
  expect(answered.size, 'intake did not reach the questions that generate requirements').toBe(2);
}

async function reachTrace(
  page: Page,
  idea = 'A records system for a GP practice handling patient data.',
): Promise<string> {
  const projectId = await startProject(page, idea);

  // Requirements are generated from intake answers, so a project nobody has answered anything for
  // legitimately has nothing to trace. Exercising the chain means answering first.
  await answerIntake(page, projectId);

  await page.goto(`/plan/${projectId}`);
  await page.getByRole('button', { name: /build the plan/i }).click();
  await expect(page.getByRole('heading', { name: /what the engine produced/i })).toBeVisible();

  await page.getByRole('link', { name: /see the traceability/i }).click();

  // Anchored on prose unique to this page rather than on a heading. The h1 here is the project name,
  // which differs per test, and “Traceability” is an eyebrow label rather than a heading — matching
  // it as one silently found nothing and every later assertion ran against a half-loaded page.
  await page.waitForURL(/[/]trace$/);
  await expect(page.getByText(/every requirement, followed through/i)).toBeVisible();

  return projectId;
}

test.describe('the traceability surface', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(isWebkit(browserName), MOBILE_SAFARI_NOTE);
  });

  test('reports requirements it actually found, not an empty chain', async ({ page }) => {
    await reachTrace(page);

    /*
     * The test that would have caught the module's original defect. The first chain described edges
     * the twin forbids, so every hop matched nothing — every trace came back empty and the report
     * looked like an untouched project. Nothing failed, because "no requirements traced" is a
     * perfectly plausible thing for a report to say.
     */
    // Read through the description list rather than by role: `dt` and `dd` do not compute an
    // accessible name from their contents, so `getByRole('term', { name })` matches nothing.
    const requirements = page.locator('dt', { hasText: /^Requirements$/ });
    await expect(requirements).toBeVisible();

    const count = await requirements.locator('xpath=following-sibling::dd[1]').innerText();

    expect(Number(count)).toBeGreaterThan(0);
  });

  test('names every requirement and says where its chain stops', async ({ page }) => {
    await reachTrace(page);

    // Colour alone would fail WCAG 2.2 §1.4.1, and on this row the status word is the entire
    // content — an unreadable row is not degraded, it is empty.
    await expect(page.getByRole('heading', { name: /every requirement/i })).toBeVisible();
    await expect(
      page.getByText(/complete|breaks at (Design|Work|Test|Evidence)/i).first(),
    ).toBeVisible();
  });

  test('shows each chain hop by name with a status word, on the requirement’s own page', async ({
    page,
  }) => {
    await reachTrace(page);

    /*
     * The hops moved off the index deliberately. Rendering all 79 chains there put 3,239 elements and
     * 1.28 MB on one page, and Firefox's accessibility-tree walker took longer than the test timeout
     * building an aria snapshot of it — so the axe check below used to fail in CI for reasons that
     * had nothing to do with accessibility.
     *
     * They are not hidden, they are somewhere. This asserts that the somewhere is reachable by
     * following a link from the index, which is the only version of "moved" worth having.
     */
    await page.getByRole('heading', { name: /every requirement/i }).scrollIntoViewIfNeeded();
    await page.locator('section[aria-labelledby="chains-heading"] a').first().click();

    await page.waitForURL(/[/]trace[/].+/);
    await expect(page.getByRole('heading', { name: /the chain/i })).toBeVisible();

    await expect(page.getByText(/Work\s+(linked|missing)/i).first()).toBeVisible();
    await expect(page.getByText(/Test\s+(linked|missing|unverified)/i).first()).toBeVisible();

    /*
     * What the status *means*, which the index never had room for. On the index this was a `title`
     * tooltip — available to a mouse and to nothing else — and a status word with no explanation is
     * a verdict the reader cannot argue with.
     *
     * Matched against the model's own sentences for a missing hop, so a page that renders the status
     * word and drops the reason fails here rather than looking fine.
     */
    const body = await page.locator('main').innerText();
    expect(body).toMatch(
      /nobody is doing anything about this|nothing will notice if this stops being true|nothing was kept/i,
    );
  });

  test('the requirement’s own page has no detectable accessibility violations', async ({
    page,
  }) => {
    await reachTrace(page);

    await page.locator('section[aria-labelledby="chains-heading"] a').first().click();
    await page.waitForURL(/[/]trace[/].+/);
    await expect(page.getByRole('heading', { name: /the chain/i })).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test('an id that names no requirement is a 404, not an empty chain', async ({ page }) => {
    const projectId = await reachTrace(page);

    /*
     * An empty chain reads as a requirement nobody has done anything about. Answering a wrong id
     * with one would be the module's original defect wearing a different hat: confident, plausible,
     * and about nothing.
     */
    const response = await page.goto(`/plan/${projectId}/trace/req/no-such-requirement`);

    expect(response?.status()).toBe(404);
  });

  test('does not put every chain back on one page', async ({ page }) => {
    await reachTrace(page);

    /*
     * A drift guard, not a style preference. This page rendered every chain inline until the rules'
     * emitted requirements were materialised and it became 3,239 elements — 41 per requirement — at
     * which point the accessibility check began timing out rather than failing, which is a much
     * harder failure to read.
     *
     * The budget is per requirement, because the honest reason the page got big is that the project
     * got bigger. Fifteen elements per requirement is roughly double what a row costs today and a
     * third of what a chain costs, so it catches the chains coming back without objecting to a row
     * gaining a word.
     */
    const requirements = Number(
      await page
        .locator('dt', { hasText: /^Requirements$/ })
        .locator('xpath=following-sibling::dd[1]')
        .innerText(),
    );

    const elements = await page.evaluate(() => document.querySelectorAll('*').length);

    expect(requirements).toBeGreaterThan(0);
    expect(
      elements,
      `${String(elements)} elements for ${String(requirements)} requirements`,
    ).toBeLessThan(200 + 15 * requirements);
  });

  test('gives every gap an id to go and look at', async ({ page }) => {
    await reachTrace(page);

    // A finding with nothing checkable behind it is an assertion, and an engine whose assertions
    // cannot be checked stops being believed the first time somebody disagrees with one.
    const gaps = page.locator('section[aria-labelledby="blocking-heading"] li');

    const count = await gaps.count();

    // Not a guard around the loop. This fixture answers the two questions that generate requirements
    // and generates no work for most of them, so it has blocking gaps by construction — and a run
    // where it does not is either a broken fixture or a product that has changed underneath this
    // test, both of which are worth stopping for rather than skipping past.
    expect(count, 'the fixture project should have blocking gaps to show').toBeGreaterThan(0);

    for (let index = 0; index < count; index += 1) {
      await expect(gaps.nth(index)).toContainText(/[a-z0-9-]+:[a-z0-9-]+/i);
    }

    // And the id is a way to go and look, not a string to read out. Every blocking gap here is about
    // one requirement, so it links to that requirement's chain.
    await expect(gaps.first().getByRole('link')).toHaveAttribute('href', /[/]trace[/]/);
  });

  test('states why each gap matters, not only that it exists', async ({ page }) => {
    await reachTrace(page);

    const body = await page.locator('main').innerText();

    // Every `why` in the model is a sentence a reader can disagree with. "REQUIREMENT_WITHOUT_TEST"
    // is a code; "nothing will notice if this stops being true" is an argument.
    expect(body).toMatch(
      /nothing will notice|nobody is doing anything|only the assertion that it was/i,
    );
  });

  test('shows no coverage percentage anywhere', async ({ page }) => {
    await reachTrace(page);

    const body = (await page.locator('main').innerText()).replace(/\s+/g, ' ');

    /*
     * The same prohibition as §23's 83/100, applied to traceability. A coverage figure is
     * unactionable, optimisable, and moves for reasons no reader can see.
     *
     * The word "percentage" is allowed — the page explains why it does not show one, and refusing to
     * produce a thing is different from refusing to name it.
     */
    expect(body).not.toMatch(/\b\d{1,3}%\s*(traceab|cover|complete)/i);
    expect(body).not.toMatch(/\b(traceab|coverage)\w*\s*[:=]?\s*\d{1,3}\s*%/i);
    expect(body).not.toMatch(/\b\d{1,3}\s*\/\s*100\b/);
  });

  test('explains what "not assessable" means when it reports any', async ({ page }) => {
    await reachTrace(page);

    /*
     * Reads the *value*, not the label. The first version tested the page text for "Not assessable",
     * which is always present as a column heading — so the branch ran unconditionally and demanded
     * an explanation the page correctly omits when the count is zero.
     */
    const value = await page
      .locator('dt', { hasText: /^Not assessable$/ })
      .locator('xpath=following-sibling::dd[1]')
      .innerText();

    if (Number(value) > 0) {
      // A third count nobody can interpret is worse than two they can. It must say why those
      // requirements are neither traced nor gapped.
      await expect(page.getByText(/no way of being verified/i)).toBeVisible();
    }
  });

  test('has no detectable accessibility violations', async ({ page }) => {
    await reachTrace(page);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });
});

test.describe('a project with no requirements', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(isWebkit(browserName), MOBILE_SAFARI_NOTE);
  });

  test('says there is nothing to trace rather than reporting a clean bill of health', async ({
    page,
  }) => {
    /*
     * The hazard §25 creates. A page that correctly goes quiet is indistinguishable from a page with
     * nothing to check, and one of those is much worse news than the other.
     */
    const projectId = await startProject(page, 'A project with nothing recorded.');
    await page.goto(`/plan/${projectId}/trace`);

    await expect(page.getByText(/no requirements are recorded/i)).toBeVisible();
    await expect(page.getByText(/not the same as being fully traced/i)).toBeVisible();
  });
});

test.describe('tenant isolation', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(isWebkit(browserName), MOBILE_SAFARI_NOTE);
  });

  test('a second guest cannot read the first guest’s traceability', async ({ page, browser }) => {
    const projectId = await reachTrace(page);

    const other = await browser.newContext();
    const otherPage = await other.newPage();

    // A session of their own, or the request is anonymous rather than cross-tenant and proves
    // nothing about object ownership.
    await startProject(otherPage, 'An unrelated project.');

    const response = await otherPage.goto(`/plan/${projectId}/trace`);

    // 404, never 403. A 403 confirms the project exists.
    expect(response?.status()).toBe(404);

    await other.close();
  });
});
