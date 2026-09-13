import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Project Home (locked screen 12), through the browser.
 *
 * The completion contract (§7) says Project Home must answer: where are we, what is next, what is
 * blocked, what changed, what needs attention. This route used to render a fabricated project for any
 * id with no access check; these tests hold it to the questions, to the project's real state, and to
 * the same 404-not-403 rule as every other project surface.
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

test.describe('project home', () => {
  test.beforeEach(({ browserName, baseURL }) => {
    test.skip(isWebkit(browserName) && insecure(baseURL), MOBILE_SAFARI_NOTE);
  });

  test('answers the five questions for a project that has just started', async ({ page }) => {
    const projectId = await startProject(page, 'An appointment reminder service for a clinic.');

    await page.goto(`/p/${projectId}`);

    await expect(
      page.getByRole('heading', { level: 1, name: /appointment reminder service/i }),
    ).toBeVisible();
    for (const question of [
      /where the project is/i,
      /needs attention/i,
      /what is next/i,
      /what is blocking it/i,
      /what changed recently/i,
    ]) {
      await expect(page.getByRole('heading', { level: 2, name: question })).toBeVisible();
    }

    // Its real state, not a sample: a new project is at the start of the lifecycle with no plan.
    await expect(page.getByRole('region', { name: /where the project is/i })).toContainText(
      /idea/i,
    );
    await expect(page.getByText(/there is no plan yet/i)).toBeVisible();
    await expect(page.getByText(/not assessed/i)).toBeVisible();
  });

  test('names the gates that block it once there is a plan', async ({ page }) => {
    const projectId = await startProject(page, 'A grant management system for a charity.');
    await page.goto(`/plan/${projectId}`);
    await page.getByRole('button', { name: /build the plan/i }).click();
    await expect(page.getByRole('heading', { name: /what the engine produced/i })).toBeVisible();

    await page.goto(`/p/${projectId}`);

    const blocking = page.getByRole('region', { name: /what is blocking it/i });
    await expect(blocking.getByText(/not passed|cannot tell yet/i).first()).toBeVisible();
    await expect(page.getByText(/there is no plan yet/i)).toHaveCount(0);
  });

  test('links only to sections that exist', async ({ page }) => {
    const projectId = await startProject(page, 'A timesheet tool for a small agency.');
    await page.goto(`/p/${projectId}`);

    const hrefs = await page
      .getByRole('navigation', { name: /project sections/i })
      .getByRole('link')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));

    expect(hrefs.length).toBeGreaterThan(5);
    for (const href of hrefs) {
      const response = await page.request.get(href);
      expect(response.status(), href).toBe(200);
    }
  });

  test('is a 404 for another guest, never a 403', async ({ page, browser }) => {
    const projectId = await startProject(page, 'A project that belongs to one guest.');

    const stranger = await browser.newContext();
    const response = await (await stranger.newPage()).goto(`/p/${projectId}`);
    expect(response?.status()).toBe(404);
    await stranger.close();
  });

  test('is a 404 for an id that is not a project', async ({ page }) => {
    const response = await page.goto('/p/proj_demo');
    expect(response?.status()).toBe(404);
  });

  test('has no detectable accessibility violations', async ({ page }) => {
    test.slow();
    const projectId = await startProject(page, 'A booking system for a sports club.');
    await page.goto(`/p/${projectId}`);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});
