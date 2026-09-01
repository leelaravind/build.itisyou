import { test, expect } from '@playwright/test';
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
     * nothing must not render alike. Here the difference is "you are a guest" versus "your
     * organisation has no projects", and they need different responses.
     */
    await expect(page.getByRole('status')).toContainText(/nothing to roll up as a guest/i);
    await expect(page.getByRole('status')).toContainText(/not the same as an organisation/i);
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
