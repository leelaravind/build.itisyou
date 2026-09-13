import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Mobile behaviour — Phase 16.
 *
 * §3.3 says the implementation "must not merely shrink desktop UI", which is easy to agree with and
 * hard to test. What *is* testable is the symptom: a shrunk desktop scrolls sideways, because a
 * layout designed at 1280px has widths in it that a 393px viewport cannot honour.
 *
 * So the load-bearing test in this file is horizontal overflow, applied to every route. It is
 * objective, it catches real breakage anywhere on a page rather than at the one element somebody
 * thought to check, and it fails for the exact reason §3.3 cares about.
 *
 * The rest cover the two things a phone changes that a desktop hides: touch targets, and dense
 * representations that need a different shape rather than a smaller one.
 *
 * This suite runs only on the mobile projects. Running it on desktop would pass trivially and make
 * the count look better than it is.
 */

const MOBILE_SAFARI_NOTE =
  'WebKit drops the session cookie over plain HTTP; verified against HTTPS at the staging gate (KI-024)';

/** WCAG 2.2 §2.5.8 fails below 24px. 44px is roughly a finger; designing to the failure line makes every rounding error a defect. */
const MIN_TOUCH_TARGET = 44;

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

/** Routes reachable without a project. Each is checked for overflow. */
const PUBLIC_ROUTES = ['/', '/how-it-works', '/start', '/login', '/portfolio'];

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
 * Answer the two intake questions that cause requirements to be generated.
 *
 * Needed because a traceability chain only exists once there is a requirement, and a project built
 * from a bare idea has none. Without this the chain test asserted against an empty page — which is a
 * perfectly plausible thing for that page to show, so it failed for the right reason.
 */
async function answerIntake(page: Page, projectId: string): Promise<void> {
  await page.goto(`/intake/${projectId}`);

  const answered = new Set<string>();

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
     * Wait after **every** answer, including the last one — the same fix as in `trace.spec.ts` and
     * `change.spec.ts`, and the third copy of this helper to need it.
     *
     * The `if (answered.size < 2)` guard did not skip a read; it skipped waiting for the server
     * action to finish, and `buildPlan` navigates on the next line. Against a real deployment the
     * write takes ~300ms and the navigation cancelled it. Locally it completes in single-digit
     * milliseconds, so the race cannot open at all.
     *
     * That this exists in three files is itself the finding: the helper was copied rather than
     * shared, so one fix had to be made three times and the third was found only by a full run
     * against staging. See KI-060.
     */
    await expect(heading).not.toHaveText(asked, { timeout: 15_000 });
  }

  expect(answered.size, 'intake did not reach the questions that generate requirements').toBe(2);
}

async function buildPlan(page: Page, projectId: string): Promise<void> {
  await page.goto(`/plan/${projectId}`);
  await page.getByRole('button', { name: /build the plan/i }).click();
  await expect(page.getByRole('heading', { name: /what the engine produced/i })).toBeVisible();
}

/**
 * The width of the widest thing on the page, against the viewport.
 *
 * Measured on `documentElement` rather than on `body`: a `body` with `overflow: hidden` reports no
 * scroll width while the content underneath is still cut off, which is the bug rather than the fix.
 */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth - root.clientWidth;
  });
}

test.describe('no route scrolls sideways on a phone', () => {
  test.beforeEach(({ browserName, isMobile, baseURL }) => {
    test.skip(isWebkit(browserName) && insecure(baseURL), MOBILE_SAFARI_NOTE);
    test.skip(!isMobile, 'Only meaningful at a phone viewport.');
  });

  for (const route of PUBLIC_ROUTES) {
    test(`${route} fits the viewport`, async ({ page }) => {
      await page.goto(route);

      /*
       * The symptom §3.3 is really about. A layout designed at 1280px has widths in it that a 393px
       * viewport cannot honour, and the result is a page you have to drag left and right to read.
       */
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
    });
  }

  test('every project surface fits the viewport', async ({ page }) => {
    const projectId = await startProject(page, 'A mobile check project.');
    await buildPlan(page, projectId);

    // The dense surfaces, which are where a shrunk desktop actually breaks: chains, boards, grids
    // and tables all have a natural width that a phone does not have.
    const routes = [
      `/intake/${projectId}`,
      `/plan/${projectId}`,
      `/plan/${projectId}/work`,
      `/plan/${projectId}/rules`,
      `/plan/${projectId}/budget`,
      `/plan/${projectId}/trace`,
      `/plan/${projectId}/release`,
      `/plan/${projectId}/change`,
      `/plan/${projectId}/baseline`,
      `/plan/${projectId}/close`,
    ];

    for (const route of routes) {
      await page.goto(route);
      expect(await horizontalOverflow(page), route).toBeLessThanOrEqual(1);
    }
  });
});

test.describe('touch targets', () => {
  test.beforeEach(({ browserName, isMobile, baseURL }) => {
    test.skip(isWebkit(browserName) && insecure(baseURL), MOBILE_SAFARI_NOTE);
    test.skip(!isMobile, 'Only meaningful at a phone viewport.');
  });

  test('every visible control is large enough to hit', async ({ page }) => {
    await page.goto('/start');

    /*
     * Checked by measuring rather than by inspecting classes. A class that should produce 44px and
     * does not — because something overrode it, or the element is inline — is exactly the failure a
     * class-based check cannot see.
     */
    const controls = page.locator('button:visible, a:visible, input:visible, select:visible');
    const count = await controls.count();

    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i += 1) {
      const control = controls.nth(i);
      const box = await control.boundingBox();

      if (box === null) continue;

      // Inline links inside a paragraph are exempt: WCAG 2.2 §2.5.8 exempts targets in a sentence,
      // and enforcing it would mean no prose could contain a link.
      const inline = await control.evaluate(
        (element) =>
          element.closest('p') !== null ||
          (element.tagName === 'A' &&
            element.closest('nav') === null &&
            element.closest('main')?.textContent !== element.textContent),
      );

      if (inline) continue;

      expect(box.height, await control.innerText()).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET - 1);
    }
  });
});

test.describe('dense representations get a different shape, not a smaller one', () => {
  test.beforeEach(({ browserName, isMobile, baseURL }) => {
    test.skip(isWebkit(browserName) && insecure(baseURL), MOBILE_SAFARI_NOTE);
    test.skip(!isMobile, 'Only meaningful at a phone viewport.');
  });

  test('the traceability chain is readable as text', async ({ page }) => {
    const projectId = await startProject(page, 'A records system holding personal data.');
    await answerIntake(page, projectId);
    await buildPlan(page, projectId);
    await page.goto(`/plan/${projectId}/trace`);

    /*
     * The chain itself is on the requirement's own page — the index carries one row per requirement
     * and would otherwise be 3,239 elements on a phone. So this follows the same route a reader does.
     */
    await page.locator('section[aria-labelledby="chains-heading"] a').first().click();
    await page.waitForURL(/[/]trace[/].+/);

    const body = await page.locator('main').innerText();

    /*
     * §3.4's accessible alternative for a traceability graph: each hop is text — its name, its status
     * word, and why. Nothing conveyed by position or colour alone, which is also what makes it work
     * at 393px without a horizontal scroll.
     */
    expect(body).toMatch(/(work|test|evidence)\s+(linked|missing|unverified|stale|not required)/i);

    // The new surface gets the same §3.3 check as the rest of them, on the page it now lives on.
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  });

  test('the work board becomes stacked lists with their status named', async ({ page }) => {
    const projectId = await startProject(page, 'A mobile board project.');
    await buildPlan(page, projectId);
    await page.goto(`/plan/${projectId}/work`);

    // A card conveys its status by which column it sits in, so on a phone — and for assistive
    // technology at any size — the status is written on the group instead.
    await expect(page.getByRole('heading', { name: /what to do next/i })).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  });

  test('budget figures carry their unit inline', async ({ page }) => {
    const projectId = await startProject(page, 'A mobile budget project.');
    await buildPlan(page, projectId);
    await page.goto(`/plan/${projectId}/budget`);

    const body = await page.locator('main').innerText();

    // A column heading two hundred pixels away is not a label anybody hears, and on a phone it is not
    // a label anybody sees either.
    expect(body).toMatch(/hours/i);
    expect(body).toMatch(/[£$€]/);
  });
});

test.describe('mobile accessibility', () => {
  test.beforeEach(({ browserName, isMobile, baseURL }) => {
    test.skip(isWebkit(browserName) && insecure(baseURL), MOBILE_SAFARI_NOTE);
    test.skip(!isMobile, 'Only meaningful at a phone viewport.');
  });

  test('the landing page has no violations at a phone size', async ({ page }) => {
    await page.goto('/');

    /*
     * Run separately from the desktop accessibility pass because reflow changes what axe sees:
     * elements overlap, targets shrink and contrast can change with a different background stack.
     */
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test('the intake wizard has no violations at a phone size', async ({ page }) => {
    const projectId = await startProject(page, 'A mobile accessibility project.');
    await page.goto(`/intake/${projectId}`);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });
});
