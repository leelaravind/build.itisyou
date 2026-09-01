import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * The release-readiness surface — Phase 11 through the browser.
 *
 * This is the page somebody screenshots into a change-approval ticket, which makes it the page where
 * an over-confident rendering does the most damage. Most of these tests are therefore about what the
 * page must *not* let a reader conclude: that an unevaluated gate passed, that a gate resting on
 * exceptions passed cleanly, or that production was verified when nobody looked.
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

async function reachRelease(page: Page): Promise<string> {
  const projectId = await startProject(page, 'A booking system going to production.');

  await page.goto(`/plan/${projectId}`);
  await page.getByRole('button', { name: /build the plan/i }).click();
  await expect(page.getByRole('heading', { name: /what the engine produced/i })).toBeVisible();

  await page.getByRole('link', { name: /see release readiness/i }).click();

  await page.waitForURL(/[/]release$/);
  await expect(page.getByRole('heading', { name: /the gates/i })).toBeVisible();

  return projectId;
}

test.describe('the release surface', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(isWebkit(browserName), MOBILE_SAFARI_NOTE);
  });

  test('shows all six gates in order', async ({ page }) => {
    await reachRelease(page);

    const gates = page.getByRole('listitem').filter({ hasText: /passed|failed|indeterminate/ });

    expect(await gates.count()).toBe(6);
  });

  test('states each gate result in words, not by colour', async ({ page }) => {
    await reachRelease(page);

    // WCAG 2.2 §1.4.1. On this page the three states are the entire content of the row, so colour
    // alone would make it unreadable rather than merely degraded.
    await expect(page.getByText('indeterminate', { exact: true }).first()).toBeVisible();
  });

  test('does not render an unevaluated gate as passing', async ({ page }) => {
    await reachRelease(page);

    /*
     * The single most important property of this page. Six green ticks where four gates were never
     * reached would be read as approval by whoever receives the screenshot.
     */
    const body = await page.locator('main').innerText();

    expect(body).toMatch(/indeterminate/i);
    expect(body).toMatch(/not a failure of this gate/i);
  });

  test('says which gate stopped the release and what to do about it', async ({ page }) => {
    await reachRelease(page);

    // A project that has done none of the release work should say so at the top, in the terms of the
    // gate that stopped it — not as a generic "not ready".
    await expect(page.getByRole('status')).toContainText(/stopped at the .* gate/i);
  });

  test('argues each blocker rather than naming it', async ({ page }) => {
    await reachRelease(page);

    const body = await page.locator('main').innerText();

    /*
     * Originally this asserted the rollback-plan wording. That was wrong about which gate a fresh
     * project reaches: it stops at testing, so release readiness is never evaluated and its plan
     * blockers correctly do not render. The property worth guarding is not which sentence appears,
     * but that every blocker on the page carries a reason a reader can disagree with.
     *
     * "No security test has run" is a checklist item. "A security suite is evidence about what was
     * tried, never about what exists" is an argument, and it comes from the category's own
     * `cannotShow`.
     */
    expect(body).toMatch(/evidence about what was tried|cannot be checked automatically/i);

    // And the reason has to be attached to the blocker rather than floating in prose somewhere else
    // on the page, or a reader scanning the list still sees only verdicts.
    // `.last()` because the gate row and the blocker row inside it both match — the innermost is the
    // one that has to carry the reason, since that is the row a reader scanning the list sees.
    const blocker = page
      .getByRole('listitem')
      .filter({ hasText: /No security test has run/ })
      .last();

    await expect(blocker).toContainText(/evidence about what was tried/i);
  });

  test('never claims production was verified when nothing was checked', async ({ page }) => {
    await reachRelease(page);

    const body = (await page.locator('main').innerText()).replace(/\s+/g, ' ');

    /*
     * The most damaging false claim available to this platform, and the record people go back to
     * after something has gone wrong.
     */
    expect(body).not.toMatch(/production verification: ?passed/i);
    expect(body).not.toMatch(/production (is )?(healthy|verified|confirmed)/i);
  });

  test('shows no readiness percentage or score', async ({ page }) => {
    await reachRelease(page);

    const body = (await page.locator('main').innerText()).replace(/\s+/g, ' ');

    // The same prohibition as §23, applied to a release decision — where a number would be worse,
    // because it invites shipping at 90%.
    expect(body).not.toMatch(/\b\d{1,3}%\s*(ready|complete|pass)/i);
    expect(body).not.toMatch(/\b\d{1,3}\s*\/\s*100\b/);
    expect(body).not.toMatch(/\d[^.]{0,24}\bscore\b/i);
  });

  test('has no detectable accessibility violations', async ({ page }) => {
    await reachRelease(page);

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

  test('a second guest cannot read the first guest’s release position', async ({
    page,
    browser,
  }) => {
    const projectId = await reachRelease(page);

    const other = await browser.newContext();
    const otherPage = await other.newPage();

    // A session of their own, or this is an anonymous request and proves nothing about ownership.
    await startProject(otherPage, 'An unrelated project.');

    const response = await otherPage.goto(`/plan/${projectId}/release`);

    // 404, never 403 — a 403 confirms the project exists.
    expect(response?.status()).toBe(404);

    await other.close();
  });
});
