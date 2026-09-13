import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * The portfolio and integrations surface — Phase 15 through the browser.
 *
 * The Phase-15 gate is multi-project and role behaviour. The unit suite covers the visibility rules
 * with constructed viewers; what only the browser can check is §44's prohibition, which is a claim
 * about what a *page* offers: "do not fake functionality" fails through a button far more often than
 * through a sentence, and a button only exists on a rendered page.
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

test.describe('the portfolio surface', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(isWebkit(browserName), MOBILE_SAFARI_NOTE);
  });

  test('is reachable without an account', async ({ page }) => {
    await page.goto('/portfolio');

    await expect(page.getByRole('heading', { name: /across your projects/i })).toBeVisible();
  });

  test('says why it is empty rather than showing an empty table', async ({ page }) => {
    await page.goto('/portfolio');

    /*
     * The same honesty rule every surface in this platform follows: an empty view and a view of
     * nothing must not render alike. A visitor with no project is told they are a guest, what a
     * guest project is, and how to start one — not shown an empty list.
     *
     * This used to assert "nothing to roll up as a guest", which the page said to everyone, signed
     * in or not, because it listed no projects at all. It now lists the caller's projects, so the
     * empty state is the guest-with-nothing case rather than every case.
     */
    await expect(page.getByRole('heading', { name: /your guest project/i })).toBeVisible();
    const empty = page.getByRole('status').filter({ hasText: /no project yet/i });
    await expect(empty).toContainText(/guest session/i);
    await expect(empty.getByRole('link', { name: /start a project/i })).toBeVisible();
  });

  test('lists the guest’s own project and links to its plan', async ({ page }) => {
    const projectId = await startProject(page, 'A volunteer rota for a food bank.');

    await page.goto('/portfolio');

    const link = page.getByRole('link', { name: /volunteer rota for a food bank/i });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', `/plan/${projectId}`);
  });

  test('never lists another guest’s project', async ({ page, browser }) => {
    await startProject(page, 'A private project nobody else should see.');

    const stranger = await browser.newContext();
    const other = await stranger.newPage();
    await other.goto('/portfolio');

    await expect(other.getByText(/private project nobody else should see/i)).toHaveCount(0);
    await stranger.close();
  });

  test('explains that it names a project rather than averaging health', async ({ page }) => {
    await page.goto('/portfolio');

    const body = await page.locator('main').innerText();

    // One healthy project and one on fire is not a moderately healthy portfolio.
    expect(body).toMatch(/not a moderately healthy portfolio/i);
    /*
     * Narrowed from "no percentage anywhere", which failed on the page's own example of a person
     * split 60/60 across two projects — an allocation, not a score. The prohibition is a percentage
     * standing in for a *verdict*; an illustrative figure in prose is not one, and banning both
     * would make the page less able to explain itself.
     */
    expect(body).not.toMatch(/\b\d{1,3}%\s*(healthy|complete|ready|on track|traceab)/i);
    expect(body).not.toMatch(/\b(health|portfolio)\w*\s*[:=]?\s*\d{1,3}\s*%/i);
  });

  test('explains that a total including an invisible project discloses it', async ({ page }) => {
    await page.goto('/portfolio');

    const body = await page.locator('main').innerText();

    // The leak that looks like a feature, and the reason the page says "partial" without saying
    // how partial.
    expect(body).toMatch(/tells you it exists/i);
    expect(body).toMatch(/without saying how much is missing/i);
  });
});

test.describe('gap-spec §44: the integrations boundary', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(isWebkit(browserName), MOBILE_SAFARI_NOTE);
  });

  test('offers no connect button anywhere', async ({ page }) => {
    await page.goto('/portfolio');

    /*
     * The load-bearing test for §44. "Do not fake functionality" fails most often through a button:
     * an action offered on something that cannot perform it, which the user discovers by pressing
     * it. Every integration is PLANNED, so no Connect button may exist.
     */
    await expect(page.getByRole('button', { name: /connect/i })).toHaveCount(0);
  });

  test('labels every integration as planned, in words', async ({ page }) => {
    await page.goto('/portfolio');

    const planned = page.getByText('planned', { exact: true });

    // In words rather than by colour: a badge relying on colour leaves a reader unable to tell
    // planned from connected, which is the whole distinction §44 is about.
    expect(await planned.count()).toBeGreaterThanOrEqual(5);
  });

  test('says what each integration still would not do', async ({ page }) => {
    await page.goto('/portfolio');

    const body = await page.locator('main').innerText();

    /*
     * Every integration is oversold by omission — people assume a connected source control means the
     * platform knows what the code does.
     */
    expect(body).toMatch(/cannot tell whether the code does what the requirement asked/i);
    expect(body).toMatch(/evidence about what was checked, never about what exists/i);
  });

  test('does not claim any integration is available or connected', async ({ page }) => {
    await page.goto('/portfolio');

    const body = (await page.locator('main').innerText()).toLowerCase();

    // Any state other than planned is a claim that the thing is built.
    expect(body).not.toMatch(/\bconnected\b(?!.{0,40}tell)/);
    expect(body).not.toMatch(/\bavailable\b/);
  });

  test('has no detectable accessibility violations', async ({ page }) => {
    await page.goto('/portfolio');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });
});
