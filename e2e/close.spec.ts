import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * The closure surface — Phase 14 through the browser.
 *
 * The Phase-14 gate is that a project can formally close only when criteria pass or accepted
 * exceptions exist. What the browser adds to the unit suite is that the *reader* can tell the four
 * outcomes apart — met, not met, excepted, undecidable — because they mean four different pieces of
 * work, and a page that renders any two of them alike sends somebody to do the wrong one.
 */

const MOBILE_SAFARI_NOTE =
  'WebKit drops the session cookie over plain HTTP; verified against HTTPS at the staging gate (KI-024)';

function isWebkit(browserName: string): boolean {
  return browserName === 'webkit';
}

/**
 * KI-024 is about plain HTTP: WebKit drops the session cookie on an insecure origin. Over HTTPS —
 * staging — it holds it, so the skip applies to the insecure origin only. It used to be keyed on the
 * browser alone, which skipped WebKit and iOS Safari against HTTPS staging too, so the re-verification
 * KI-024 made mandatory could never fire.
 */
function insecure(baseURL: string | undefined): boolean {
  return !(baseURL ?? 'http://localhost').startsWith('https://');
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

async function reachClosure(page: Page): Promise<string> {
  const projectId = await startProject(page, 'A volunteer rota system for a food bank.');

  await page.goto(`/plan/${projectId}`);
  await page.getByRole('button', { name: /build the plan/i }).click();
  await expect(page.getByRole('heading', { name: /what the engine produced/i })).toBeVisible();

  await page.getByRole('link', { name: /see what closing requires/i }).click();

  await page.waitForURL(/[/]close$/);
  await expect(page.getByRole('heading', { name: /what closing requires/i })).toBeVisible();

  return projectId;
}

test.describe('the closure surface', () => {
  test.beforeEach(({ browserName, baseURL }) => {
    test.skip(isWebkit(browserName) && insecure(baseURL), MOBILE_SAFARI_NOTE);
  });

  test('lists every closure criterion', async ({ page }) => {
    await reachClosure(page);

    const criteria = page.getByRole('listitem').filter({ hasText: /met|excepted|unknown/ });

    expect(await criteria.count()).toBe(9);
  });

  test('does not let a project close before anything has been done', async ({ page }) => {
    await reachClosure(page);

    /*
     * The guard on the whole surface. A project nobody has handed over, with no ownership, no
     * retrospective and no debt register, must not report itself closeable — and it is the kind of
     * thing that would pass unnoticed if the page simply rendered whatever it was given.
     */
    await expect(page.getByRole('status')).not.toContainText(/every closure criterion is met/i);
  });

  test('states each criterion in words, not by colour', async ({ page }) => {
    await reachClosure(page);

    // WCAG 2.2 §1.4.1, and here the four states mean four different pieces of work.
    await expect(page.getByText('not met', { exact: true }).first()).toBeVisible();
  });

  test('says what each criterion is asking about the day after everybody leaves', async ({
    page,
  }) => {
    await reachClosure(page);

    const body = await page.locator('main').innerText();

    // A criterion name is a label. This is the reason somebody should care about it.
    expect(body).toMatch(/transfers a question rather than a system/i);
    expect(body).toMatch(/does not know they are the owner/i);
  });

  test('explains why an undecidable criterion cannot be excepted', async ({ page }) => {
    await reachClosure(page);

    const body = await page.locator('main').innerText();

    if (/unknown/i.test(body)) {
      /*
       * An exception accepts a known shortfall. Letting it cover something undecidable turns "we
       * could not tell" into "we decided it was fine", which is the more dangerous of the two by a
       * long way.
       */
      expect(body).toMatch(/nothing to accept/i);
    }
  });

  test('shows no completion percentage', async ({ page }) => {
    await reachClosure(page);

    const body = (await page.locator('main').innerText()).replace(/\s+/g, ' ');

    // "78% complete" invites closing at 78%, which is the single thing this gate exists to prevent.
    expect(body).not.toMatch(/\b\d{1,3}%/);
    expect(body).not.toMatch(/\b\d{1,3}\s*\/\s*100\b/);
  });

  test('has no detectable accessibility violations', async ({ page }) => {
    await reachClosure(page);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });
});

test.describe('tenant isolation', () => {
  test.beforeEach(({ browserName, baseURL }) => {
    test.skip(isWebkit(browserName) && insecure(baseURL), MOBILE_SAFARI_NOTE);
  });

  test('a second guest cannot read the first guest’s closure position', async ({
    page,
    browser,
  }) => {
    const projectId = await reachClosure(page);

    const other = await browser.newContext();
    const otherPage = await other.newPage();

    await startProject(otherPage, 'An unrelated project.');

    const response = await otherPage.goto(`/plan/${projectId}/close`);

    // 404, never 403 — a 403 confirms the project exists.
    expect(response?.status()).toBe(404);

    await other.close();
  });
});
