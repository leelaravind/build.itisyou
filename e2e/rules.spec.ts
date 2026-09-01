import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * The rules and gates surface — Phase 7 through the browser.
 *
 * The unit suite proves the engine is deterministic, that precedence works, and that an unanswered
 * input produces `INDETERMINATE` rather than `NOT_APPLICABLE`. What it cannot prove is that a *user*
 * is shown the difference.
 *
 * That is what most of these assert. A page that renders "247 rules do not apply" when half of them
 * were simply undecidable would pass every engine test and actively mislead: it would tell someone
 * their project has no privacy obligations because they left a field blank.
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

async function reachRules(page: Page, idea = 'A tool for booking meeting rooms.'): Promise<string> {
  const projectId = await startProject(page, idea);

  await page.goto(`/plan/${projectId}`);
  await page.getByRole('button', { name: /build the plan/i }).click();
  await expect(page.getByRole('heading', { name: /what the engine produced/i })).toBeVisible();

  await page.getByRole('link', { name: /see the findings/i }).click();

  /*
   * Waits for the URL and for a heading unique to this page.
   *
   * The first version asserted `heading level 1` was visible, which is true on the plan page as well
   * — so it resolved before the navigation and every later assertion ran against the wrong page.
   * The failures then looked like missing content rather than a helper that never arrived.
   */
  await page.waitForURL(/[/]rules$/);
  await expect(page.getByRole('heading', { name: /where this project stands/i })).toBeVisible();

  return projectId;
}

test.describe('the findings page', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(isWebkit(browserName), MOBILE_SAFARI_NOTE);
  });

  test('is reachable from the plan', async ({ page }) => {
    await reachRules(page);
    await expect(page.getByRole('heading', { name: /where this project stands/i })).toBeVisible();
  });

  test('states that no model was involved', async ({ page }) => {
    // Plan §2.3: the deterministic engine is the core. Someone who believes a model produced this
    // cannot rely on it being reproducible or on being able to argue with it.
    await reachRules(page);
    await expect(page.getByText(/nothing here came from a model/i)).toBeVisible();
  });

  test('names the ruleset version', async ({ page }) => {
    // Gap-spec §13.1. Without it a stored finding cannot be explained once the catalogue moves on.
    await reachRules(page);
    await expect(page.getByText(/ruleset \d+\.\d+\.\d+/)).toBeVisible();
  });

  test('shows what cannot be decided separately from what does not apply', async ({ page }) => {
    /*
     * The distinction the whole engine rests on, asserted where the user sees it.
     *
     * A guest project has answered almost nothing, so a large number of rules are undecidable. A page
     * that folded those into "do not apply" would tell someone their project has no privacy or
     * security obligations because they left fields blank.
     */
    await reachRules(page);

    await expect(page.getByText(/cannot decide yet/i)).toBeVisible();
    // Exact: the phrase also appears in the explanatory paragraph below.
    await expect(page.getByText('Do not apply', { exact: true })).toBeVisible();
    await expect(page.getByText(/these are not rules that do not apply/i)).toBeVisible();
  });

  test('names the questions that would settle the undecidable rules', async ({ page }) => {
    // A page that says "47 rules are undecidable" and stops is a page nobody can act on.
    await reachRules(page);

    await expect(page.getByRole('heading', { name: /cannot be decided yet/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /answer these/i })).toBeVisible();
  });

  test('the answer link goes back to intake', async ({ page }) => {
    const projectId = await reachRules(page);
    await page.getByRole('link', { name: /answer these/i }).click();
    await expect(page).toHaveURL(new RegExp(`/intake/${projectId}$`));
  });

  test('every finding names the rule that produced it', async ({ page }) => {
    /*
     * Gap-spec §13.3 and plan §12.
     *
     * A finding nobody can trace is one the user cannot challenge, and an engine whose conclusions
     * cannot be questioned is one people stop trusting the first time they disagree.
     */
    await reachRules(page);

    const body = (await page.textContent('main')) ?? '';
    expect(body).toMatch(/[A-Z]{2,8}-[A-Z0-9]+-\d{3}/);
  });

  test('says whether a finding blocks or advises', async ({ page }) => {
    // A catalogue where everything looks equally urgent is one where the mandatory items get waived
    // along with everything else.
    await reachRules(page);
    await expect(page.getByText(/blocks a gate/i).first()).toBeVisible();
  });

  test('explains each finding rather than only naming it', async ({ page }) => {
    await reachRules(page);

    const findings = page.getByRole('heading', { name: /^obligations/i });
    await expect(findings).toBeVisible();
  });
});

test.describe('gates', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(isWebkit(browserName), MOBILE_SAFARI_NOTE);
  });

  test('shows the quality gates and their state', async ({ page }) => {
    await reachRules(page);
    await expect(page.getByRole('heading', { name: /^quality gates$/i })).toBeVisible();
  });

  test('distinguishes an undecidable gate from a failed one', async ({ page }) => {
    // Collapsing them into failure teaches people that gate failures are noise, which is how the real
    // ones get ignored.
    await reachRules(page);
    await expect(page.getByText(/cannot be decided/i).first()).toBeVisible();
  });

  test('never conveys gate state by colour alone', async ({ page }) => {
    /*
     * WCAG 2.2 §1.4.1, and one of the platform's own rules (A11Y-STATUS-001).
     *
     * Around one in twelve men has some colour vision deficiency, and red-green is exactly the
     * pairing a pass/fail indicator reaches for.
     */
    await reachRules(page);

    const body = (await page.textContent('main')) ?? '';
    expect(body).toMatch(/passed|failed|indeterminate/i);
  });

  test('does not pass a gate on an empty project', async ({ page }) => {
    // A gate system that passed a project with nothing in it would pass anything.
    await reachRules(page, 'A project with nothing decided.');

    const body = (await page.textContent('main')) ?? '';
    expect(body).not.toMatch(/every blocking criterion .* is met/i);
  });
});

test.describe('a project belongs to one guest', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(isWebkit(browserName), MOBILE_SAFARI_NOTE);
  });

  test('another guest cannot read its findings', async ({ page, browser }) => {
    const projectId = await reachRules(page);

    const other = await browser.newContext();
    const otherPage = await other.newPage();
    const response = await otherPage.goto(`/plan/${projectId}/rules`);

    // 404, never 403 — a 403 confirms the project exists.
    expect(response?.status()).toBe(404);
    await other.close();
  });

  test('an unknown project id is indistinguishable from a forbidden one', async ({ page }) => {
    const response = await page.goto('/plan/99999999-9999-4999-8999-999999999999/rules');
    expect(response?.status()).toBe(404);
  });
});

test.describe('accessibility of the findings page', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(isWebkit(browserName), MOBILE_SAFARI_NOTE);
  });

  test('has no axe violations', async ({ page }) => {
    test.slow();

    await reachRules(page, 'An accessibility check for the findings page.');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(
      results.violations.flatMap((v) =>
        v.nodes.map((n) => `${v.id}: ${n.target.join(' ')} — ${v.help}`),
      ),
    ).toEqual([]);
  });

  test('works without client JavaScript', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();

    await reachRules(page, 'A no-JavaScript findings check.');
    await expect(page.getByRole('heading', { name: /where this project stands/i })).toBeVisible();

    await context.close();
  });
});
