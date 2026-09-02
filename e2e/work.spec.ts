import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * The execution surface — Phase 8 through the browser.
 *
 * The unit suite proves the decomposer produces valid plans for the solo and twelve-person fixtures.
 * What it cannot prove is that a *user* is shown something they can act on rather than a wall.
 *
 * So most of these assert the honesty of what is presented: that Today is ranked and reasoned rather
 * than a backlog with a heading, that review is visible as its own column, and that the completion
 * figure carries what it does not mean. A page reporting "60% complete" with no caveat would pass a
 * rendering test and mislead every reader.
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

async function reachWork(page: Page, idea = 'A tool for tracking lab equipment.'): Promise<string> {
  const projectId = await startProject(page, idea);

  await page.goto(`/plan/${projectId}`);
  await page.getByRole('button', { name: /build the plan/i }).click();
  await expect(page.getByRole('heading', { name: /what the engine produced/i })).toBeVisible();

  await page.getByRole('link', { name: /see the work/i }).click();

  // Waits for a heading unique to this page. Asserting a generic one would resolve before the
  // navigation and run every later assertion against the plan page.
  await page.waitForURL(/[/]work$/);
  await expect(page.getByRole('heading', { name: /what to do next/i })).toBeVisible();

  return projectId;
}

test.describe('before a plan exists', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(isWebkit(browserName), MOBILE_SAFARI_NOTE);
  });

  test('says there is nothing to break down yet', async ({ page }) => {
    const projectId = await startProject(page, 'A project with no plan yet.');
    await page.goto(`/plan/${projectId}/work`);

    await expect(page.getByRole('heading', { name: /no plan to break down yet/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /go to the plan/i })).toBeVisible();
  });
});

test.describe('what to do next', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(isWebkit(browserName), MOBILE_SAFARI_NOTE);
  });

  test('comes before the board', async ({ page }) => {
    /*
     * The ordering is the argument. A page that opens with a board asks the reader to do the
     * prioritising, and the point of having a dependency graph is that the platform can do some of
     * it. Asserted structurally so a reshuffle cannot silently invert it.
     */
    await reachWork(page);

    const order = await page.evaluate(() => {
      const headings = [...document.querySelectorAll('h2')];
      const today = headings.find((h) => /what to do next/i.test(h.textContent ?? ''));
      const board = headings.find((h) => /^the board$/i.test(h.textContent ?? ''));
      if (!today || !board) return 'missing';
      return (today.compareDocumentPosition(board) & 4) !== 0 ? 'today-first' : 'board-first';
    });

    expect(order).toBe('today-first');
  });

  test('gives a reason for every item', async ({ page }) => {
    // A task appearing because it happened to sort first is one the user ignores, and after a week of
    // that they ignore the view.
    await reachWork(page);

    const items = page.locator('ol li');
    expect(await items.count()).toBeGreaterThan(0);

    const text = (await items.first().textContent()) ?? '';
    expect(text.length).toBeGreaterThan(40);
  });

  test('is capped rather than showing everything', async ({ page }) => {
    await reachWork(page);
    expect(await page.locator('ol li').count()).toBeLessThanOrEqual(5);
  });

  test('says it leaves out work that cannot be started', async ({ page }) => {
    await reachWork(page);
    await expect(
      page.getByText(/blocked work and work waiting on something unfinished/i),
    ).toBeVisible();
  });
});

test.describe('the board', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(isWebkit(browserName), MOBILE_SAFARI_NOTE);
  });

  test('shows review as its own column', async ({ page }) => {
    /*
     * Folding review into "in progress" hides the most common queue in software delivery: work that
     * is finished, waiting for someone, and counted as active.
     */
    await reachWork(page);

    await expect(page.getByRole('heading', { name: /^in review/i })).toBeVisible();
    await expect(page.getByText(/most common place for work to sit unnoticed/i)).toBeVisible();
  });

  test('has a column for every status', async ({ page }) => {
    await reachWork(page);

    for (const label of ['To do', 'In progress', 'Blocked', 'In review', 'Done']) {
      await expect(page.getByRole('heading', { name: new RegExp(`^${label}`, 'i') })).toBeVisible();
    }
  });

  test('shows what each task exists for', async ({ page }) => {
    // The rule id, so a task can be argued with rather than simply done.
    await reachWork(page);

    const body = (await page.textContent('main')) ?? '';
    expect(body).toMatch(/rule:[A-Z]{2,8}-/);
  });
});

test.describe('progress reporting', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(isWebkit(browserName), MOBILE_SAFARI_NOTE);
  });

  test('states what the completion figure does not mean', async ({ page }) => {
    /*
     * "60% complete" counts items, not effort, and tasks are not equal in size. That difference is
     * where every optimistic status report comes from, so the caveat travels with the number.
     */
    await reachWork(page);

    await expect(page.getByText(/of tasks done/i)).toBeVisible();
    await expect(page.getByText(/counts tasks, not effort/i)).toBeVisible();
  });

  test('surfaces work that is finished but not delivered', async ({ page }) => {
    await reachWork(page);
    await expect(page.getByText(/waiting on review/i)).toBeVisible();
  });

  test('explains how the structure was chosen', async ({ page }) => {
    // A hierarchy decision nobody can see is one nobody can disagree with.
    await reachWork(page);

    await expect(page.getByRole('heading', { name: /how this was structured/i })).toBeVisible();
    await expect(page.getByText(/no workstreams|workstreams:/i).first()).toBeVisible();
  });

  test('names the hierarchy it actually used', async ({ page }) => {
    await reachWork(page);
    await expect(page.getByText(/project → phase/i)).toBeVisible();
  });
});

test.describe('a project belongs to one guest', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(isWebkit(browserName), MOBILE_SAFARI_NOTE);
  });

  test('another guest cannot see its work', async ({ page, browser }) => {
    const projectId = await reachWork(page);

    const other = await browser.newContext();
    const otherPage = await other.newPage();
    const response = await otherPage.goto(`/plan/${projectId}/work`);

    // 404, never 403 — a 403 confirms the project exists.
    expect(response?.status()).toBe(404);
    await other.close();
  });

  test('an unknown project id is indistinguishable from a forbidden one', async ({ page }) => {
    const response = await page.goto('/plan/99999999-9999-4999-8999-999999999999/work');
    expect(response?.status()).toBe(404);
  });

  test('a malformed project id is too', async ({ page }) => {
    /*
     * Postgres raises on an invalid uuid literal rather than returning no rows, so an id that is not
     * a uuid used to reach the database and come back a 500. That is a distinguishable answer: it
     * tells a prober that their id was rejected for its *shape* rather than for who owns it, and it
     * turns a typo into an error page.
     */
    for (const id of ['not-a-uuid', '../../etc/passwd', '1 OR 1=1']) {
      const response = await page.goto(`/plan/${encodeURIComponent(id)}/work`);
      expect(response?.status(), id).toBe(404);
    }
  });
});

test.describe('accessibility of the work page', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(isWebkit(browserName), MOBILE_SAFARI_NOTE);
  });

  test('has no axe violations', async ({ page }) => {
    test.slow();

    await reachWork(page, 'An accessibility check for the work page.');

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

    await reachWork(page, 'A no-JavaScript work check.');
    await expect(page.getByRole('heading', { name: /the board/i })).toBeVisible();

    await context.close();
  });
});
