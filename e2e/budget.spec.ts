import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * The money surface — Phase 9 through the browser.
 *
 * The calculation suite proves the arithmetic. What it cannot prove is that the arithmetic survives
 * contact with a page: the strongest guarantees in this phase are all *negative* — no midpoint, no
 * score, no delivery date, no total that quietly includes contingency — and a negative guarantee is
 * exactly the kind a template can breach without any unit test noticing.
 *
 * So these read the rendered page and assert what is absent as carefully as what is present.
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

async function reachBudget(
  page: Page,
  idea = 'A system for scheduling clinic appointments.',
): Promise<string> {
  const projectId = await startProject(page, idea);

  await page.goto(`/plan/${projectId}`);
  await page.getByRole('button', { name: /build the plan/i }).click();
  await expect(page.getByRole('heading', { name: /what the engine produced/i })).toBeVisible();

  await page.getByRole('link', { name: /see the money/i }).click();

  // Waits on the URL and then on a heading unique to this page. Asserting a heading both pages share
  // would resolve before navigation, and every later assertion would run against the plan page — a
  // mistake this suite has already made twice.
  await page.waitForURL(/[/]budget$/);
  await expect(page.getByRole('heading', { name: /can this be delivered/i })).toBeVisible();

  return projectId;
}

test.describe('before a plan exists', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(isWebkit(browserName), MOBILE_SAFARI_NOTE);
  });

  test('says there is nothing to cost yet rather than showing zero', async ({ page }) => {
    const projectId = await startProject(page, 'A project nobody has planned.');
    await page.goto(`/plan/${projectId}/budget`);

    await expect(page.getByRole('heading', { name: /nothing to cost yet/i })).toBeVisible();

    // A £0.00 budget for an unplanned project is a lie that looks like a fact. Absence of a plan has
    // to read as absence, not as a project that costs nothing.
    await expect(page.getByText(/0\.00/)).toHaveCount(0);
  });
});

test.describe('the money surface', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(isWebkit(browserName), MOBILE_SAFARI_NOTE);
  });

  test('presents effort as a range, never as one number', async ({ page }) => {
    await reachBudget(page);

    const effort = page.getByRole('region', { name: /^effort$/i });
    await expect(effort).toBeVisible();

    // Plan §12.3. A single figure would be read as a commitment by every reader of this page, which
    // is why there is no accessor anywhere in the finance package that returns one.
    await expect(effort).toContainText(/\d+–\d+ hours/);
    await expect(effort).toContainText(/expected/i);
  });

  test('states its confidence and why the range is wide', async ({ page }) => {
    await reachBudget(page);

    const effort = page.getByRole('region', { name: /^effort$/i });

    // Nothing here has been sized, so anything other than low confidence would be the page
    // overstating what the engine knows.
    await expect(effort).toContainText(/low confidence/i);
    await expect(effort).toContainText(/has not been sized/i);
  });

  test('shows what the estimate assumed', async ({ page }) => {
    await reachBudget(page);

    // §20.4. An estimate whose assumptions are not reachable from the figure cannot be disagreed
    // with, and an estimate nobody can disagree with gets ignored the first time it is wrong.
    const disclosure = page.getByText(/what this figure assumed/i);
    await expect(disclosure).toBeVisible();
    await disclosure.click();
    await expect(page.getByText(/nobody has sized this/i)).toBeVisible();
  });

  test('names every component of the contingency', async ({ page }) => {
    await reachBudget(page);

    const section = page.getByRole('region', { name: /^contingency$/i });
    await expect(section).toBeVisible();

    // §21.5. A contingency figure with no decomposition never shrinks; it just gets spent.
    await expect(section).toContainText(/% allowance/);
    await expect(section.getByRole('listitem').first()).toBeVisible();
  });

  test('says plainly that no budget was recorded rather than reporting healthy', async ({
    page,
  }) => {
    await reachBudget(page);

    const section = page.getByRole('region', { name: /^contingency$/i });
    await expect(section).toContainText(/no budget has been recorded/i);
    await expect(section).toContainText(/nothing here can be over budget/i);
  });

  test('reports feasibility as dimensions with causes, never as a score', async ({ page }) => {
    await reachBudget(page);

    const section = page.getByRole('region', { name: /can this be delivered/i });
    await expect(section).toBeVisible();

    // §22 opens with "feasibility is not a magic score". The dimension that decided the verdict is
    // named, so a reader can go and look at the thing that caused it.
    await expect(section).toContainText(/decided by:/i);

    const dimensions = section.getByRole('listitem');
    expect(await dimensions.count()).toBeGreaterThanOrEqual(8);
  });

  test('reports health without an unexplained number out of a hundred', async ({ page }) => {
    await reachBudget(page);

    const section = page.getByRole('region', { name: /is it going well/i });
    await expect(section).toBeVisible();
    await expect(section).toContainText(/decided by:/i);
  });

  test('shows no score and no delivery date anywhere on the page', async ({ page }) => {
    await reachBudget(page);

    const body = (await page.locator('main').innerText()).replace(/\s+/g, ' ');

    // §23: "do not create an unexplained 83/100". The forms that could take are a fraction out of a
    // hundred, or a percentage attached to a verdict.
    expect(body).not.toMatch(/\b\d{1,3}\s*\/\s*100\b/);
    expect(body).not.toMatch(/\b\d{1,3}%\s*(healthy|complete|confident|feasible)/i);
    // A blanket ban on the word "score" was the first version of this, and it was wrong: it failed
    // on the page's own disclaimer that there is no score. Refusing to produce a thing and refusing
    // to name it are different, and the disclaimer is the useful half. What is forbidden is the word
    // appearing anywhere near a number.
    expect(body).not.toMatch(/\d[^.]{0,24}\bscore\b|\bscore\b[^.]{0,24}\d/i);

    // And the disclaimer must be present, or this passes for a page that merely says less.
    expect(body).toMatch(/no score/i);

    // §20: "do not pretend to know exact delivery time". An absolute date here would be a figure
    // derived from ranges and read as a commitment.
    expect(body).not.toMatch(
      /\b\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/,
    );
    expect(body).not.toMatch(/\b\d{4}-\d{2}-\d{2}\b/);
  });

  test('states each verdict in words, not by colour alone', async ({ page }) => {
    await reachBudget(page);

    // WCAG 2.2 §1.4.1 and rule A11Y-STATUS-001. Each verdict on this page is the only place that
    // verdict appears, so colour-only would make it unreadable rather than merely degraded.
    const verdicts = page.getByRole('status');
    expect(await verdicts.count()).toBeGreaterThanOrEqual(2);

    for (const verdict of await verdicts.all()) {
      await expect(verdict).toContainText(/[a-z]{4,}/i);
    }
  });

  test('has no detectable accessibility violations', async ({ page }) => {
    await reachBudget(page);

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

  test('a second guest cannot read the first guest’s money', async ({ page, browser }) => {
    const projectId = await reachBudget(page, 'A project with figures worth hiding.');

    // A fresh context is a different guest: new cookie jar, new session, nothing shared.
    const other = await browser.newContext();
    const otherPage = await other.newPage();

    // The second guest needs a session of their own, or the request is merely anonymous rather than
    // cross-tenant, and the test would prove nothing about object ownership.
    await startProject(otherPage, 'An unrelated project.');

    const response = await otherPage.goto(`/plan/${projectId}/budget`);

    // 404, never 403 — a 403 confirms the project exists, which is the disclosure the ordering in
    // SECURITY.md exists to prevent.
    expect(response?.status()).toBe(404);

    await other.close();
  });
});
