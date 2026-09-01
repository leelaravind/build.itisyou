import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * The baseline surface — Phase 13 through the browser.
 *
 * The Phase-13 gate is "immutable baseline + evidence audit verified". The unit suite proves the
 * immutability by absence — no exported function can edit a baseline, and a test fails when one is
 * added — and proves the integrity check by tampering with a baseline and watching it fail.
 *
 * What only the browser can show is that the verification result *reaches a reader*. A checksum
 * computed and never displayed is a governance control nobody can use: the whole reason for storing
 * the hash is that somebody can ask "has this been tampered with" and get an answer.
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

async function reachBaseline(page: Page): Promise<string> {
  const projectId = await startProject(page, 'A grant management system for a charity.');

  await page.goto(`/plan/${projectId}`);
  await page.getByRole('button', { name: /build the plan/i }).click();
  await expect(page.getByRole('heading', { name: /what the engine produced/i })).toBeVisible();

  await page.getByRole('link', { name: /see the baseline/i }).click();

  await page.waitForURL(/[/]baseline$/);
  await expect(page.getByRole('heading', { name: /what has moved/i })).toBeVisible();

  return projectId;
}

test.describe('the baseline surface', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(isWebkit(browserName), MOBILE_SAFARI_NOTE);
  });

  test('shows the verification result rather than only computing it', async ({ page }) => {
    await reachBaseline(page);

    /*
     * A checksum computed and never displayed is a governance control nobody can use. The point of
     * storing the hash is that "has this been tampered with" becomes a question somebody can ask.
     */
    const status = page.getByRole('status');

    await expect(status).toContainText(/verified/i);
    await expect(status).toContainText(/still hashes to the checksum/i);
  });

  test('shows the checksum itself, so it can be compared', async ({ page }) => {
    await reachBaseline(page);

    // A verdict a reader cannot check independently is a claim. The hash is what makes it checkable
    // against a copy held somewhere else.
    await expect(page.getByRole('status')).toContainText(/[0-9a-f]{16,}/);
  });

  test('says what the baseline captured', async ({ page }) => {
    await reachBaseline(page);

    await expect(page.getByRole('status')).toContainText(/\d+ nodes, \d+ edges/);
  });

  test('reports variance as named items, never as a percentage', async ({ page }) => {
    await reachBaseline(page);

    const body = (await page.locator('main').innerText()).replace(/\s+/g, ' ');

    // "38% divergence" is unactionable and optimisable. Named ids are the conversation somebody
    // actually needs to have.
    expect(body).not.toMatch(/\b\d{1,3}%/);
    expect(body).not.toMatch(/\bdrift\s*:?\s*\d/i);
    expect(body).toMatch(/nothing has moved|changed, .* added, .* removed/i);
  });

  test('explains that a baseline is never edited', async ({ page }) => {
    await reachBaseline(page);

    const body = await page.locator('main').innerText();

    // §29.3. A reader arriving at this page should learn the rule, not discover it when an edit
    // button they expected is missing.
    expect(body).toMatch(/never edited/i);
    expect(body).toMatch(/supersedes|chain/i);
  });

  test('says a release baseline needs an approval', async ({ page }) => {
    await reachBaseline(page);

    const body = await page.locator('main').innerText();

    // Shipping is a decision somebody is accountable for, and the page says so rather than only
    // refusing at the point somebody tries.
    expect(body).toMatch(/requires an approval/i);
    expect(body).toMatch(/accountable/i);
  });

  test('has no detectable accessibility violations', async ({ page }) => {
    await reachBaseline(page);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });
});

test.describe('a project with nothing to baseline', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(isWebkit(browserName), MOBILE_SAFARI_NOTE);
  });

  test('refuses rather than showing an empty baseline that verifies', async ({ page }) => {
    /*
     * An empty baseline hashes cleanly and verifies forever while recording nothing, which makes it
     * worse than no baseline: it looks like one, and it would sit in a governance record as evidence
     * of an agreement about nothing.
     */
    const projectId = await startProject(page, 'A project with no plan.');
    await page.goto(`/plan/${projectId}/baseline`);

    await expect(page.getByRole('heading', { name: /nothing to baseline yet/i })).toBeVisible();
    await expect(page.getByText(/worse than no baseline/i)).toBeVisible();
  });
});

test.describe('tenant isolation', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(isWebkit(browserName), MOBILE_SAFARI_NOTE);
  });

  test('a second guest cannot read the first guest’s baseline', async ({ page, browser }) => {
    const projectId = await reachBaseline(page);

    const other = await browser.newContext();
    const otherPage = await other.newPage();

    await startProject(otherPage, 'An unrelated project.');

    const response = await otherPage.goto(`/plan/${projectId}/baseline`);

    // 404, never 403 — a 403 confirms the project exists.
    expect(response?.status()).toBe(404);

    await other.close();
  });
});
