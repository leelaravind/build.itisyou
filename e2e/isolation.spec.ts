import { test, expect, type Page } from '@playwright/test';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Cross-surface tenant isolation — Phase 18.
 *
 * Every project surface already has a hand-written test asserting a second guest gets a 404. That is
 * eight tests written by somebody who remembered, which means **the ninth page ships without one and
 * nothing fails**. The protection exists because of diligence rather than because of structure, and
 * diligence is exactly what a hardening phase should stop relying on.
 *
 * So this suite discovers the routes from the filesystem rather than listing them. Adding a page under
 * `app/plan/[projectId]/` puts it in this suite automatically, and a page that does not isolate fails
 * a test nobody had to remember to write.
 *
 * The discovery is the point. A hand-maintained list here would have exactly the same problem one
 * level up.
 */

const MOBILE_SAFARI_NOTE =
  'WebKit drops the session cookie over plain HTTP; verified against HTTPS at the staging gate (KI-024)';

function isWebkit(browserName: string): boolean {
  return browserName === 'webkit';
}

/**
 * Every route segment under `app/plan/[projectId]/` that renders a page.
 *
 * Read from disk at collection time. Next.js's own routing is derived from this directory, so
 * anything it can serve is something this finds — which is the property that makes the suite
 * self-maintaining rather than a list somebody has to remember to extend.
 */
function projectRoutes(): readonly string[] {
  const root = join(process.cwd(), 'apps', 'web', 'src', 'app', 'plan', '[projectId]');
  const routes: string[] = [''];

  for (const entry of readdirSync(root)) {
    const path = join(root, entry);

    if (!statSync(path).isDirectory()) continue;

    // Dynamic segments need a real id to resolve and are covered by their own suites, where the
    // fixture that creates that id lives.
    if (entry.startsWith('[') || entry.startsWith('(') || entry.startsWith('_')) continue;

    const files = readdirSync(path);
    if (files.some((file) => file.startsWith('page.'))) routes.push(`/${entry}`);
  }

  return routes;
}

const ROUTES = projectRoutes();

async function startProject(page: Page, idea: string): Promise<string> {
  await page.goto('/start');
  await page.getByLabel(/describe your project/i).fill(idea);
  await page.getByRole('button', { name: /continue/i }).click();
  await expect(page).toHaveURL(/\/intake\/[0-9a-f-]{36}/);

  const projectId = /\/intake\/([^/?]+)/.exec(page.url())?.[1] ?? '';
  expect(projectId).not.toBe('');
  return projectId;
}

test.describe('every project surface isolates by tenant', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(isWebkit(browserName), MOBILE_SAFARI_NOTE);
  });

  test('the route list was discovered, not empty', () => {
    /*
     * The guard on the guard. A discovery that found nothing would make every test below pass
     * vacuously, and the failure would be invisible — an empty loop reports success.
     */
    expect(ROUTES.length).toBeGreaterThan(6);
    expect(ROUTES).toContain('');
    expect(ROUTES).toContain('/budget');
  });

  test('a second guest is refused on every discovered surface', async ({ page, browser }) => {
    const projectId = await startProject(page, 'A project belonging to the first guest.');

    await page.goto(`/plan/${projectId}`);
    await page.getByRole('button', { name: /build the plan/i }).click();
    await expect(page.getByRole('heading', { name: /what the engine produced/i })).toBeVisible();

    const other = await browser.newContext();
    const otherPage = await other.newPage();

    // A session of their own, or every request below is merely anonymous rather than cross-tenant
    // and proves nothing about object ownership.
    await startProject(otherPage, 'An unrelated project.');

    for (const route of ROUTES) {
      const response = await otherPage.goto(`/plan/${projectId}${route}`);

      /*
       * 404, never 403. A 403 confirms the project exists, which is the disclosure the ordering in
       * SECURITY.md is designed to prevent — and it is the specific mistake a new page makes when
       * somebody reaches for the "obviously correct" status code.
       */
      expect(response?.status(), `/plan/{id}${route}`).toBe(404);
    }

    await other.close();
  });

  test('an unknown project id is indistinguishable from a forbidden one', async ({ page }) => {
    /*
     * The other half of the same property. If a nonexistent project returned something different
     * from a forbidden one, an attacker could enumerate which ids exist without ever seeing one.
     */
    await startProject(page, 'A project used only to obtain a session.');

    const unknown = '00000000-0000-4000-8000-000000000000';

    for (const route of ROUTES) {
      const response = await page.goto(`/plan/${unknown}${route}`);
      expect(response?.status(), `/plan/{unknown}${route}`).toBe(404);
    }
  });

  test('no surface is reachable with no session at all', async ({ browser }) => {
    // A fresh context has no cookie. Every project surface must refuse it, and refuse it the same
    // way — a different status for "no session" would be a third distinguishable case.
    const anonymous = await browser.newContext();
    const page = await anonymous.newPage();

    const someId = '11111111-1111-4111-8111-111111111111';

    for (const route of ROUTES) {
      const response = await page.goto(`/plan/${someId}${route}`);
      expect(response?.status(), `/plan/{id}${route} with no session`).toBe(404);
    }

    await anonymous.close();
  });
});
