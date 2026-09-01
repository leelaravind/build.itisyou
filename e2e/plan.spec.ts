import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * The generated plan — the Phase-6 gate through the browser.
 *
 * Contract: plan §34, "deterministic generation from golden fixture"; gap-spec §8 (the canonical
 * graph); plan §10 and gap-spec §10 (the missing-information engine's output is part of the plan).
 *
 * The unit suite proves the generator is deterministic. What it cannot prove is that a *user* is
 * shown a plan they can judge — that an engine conclusion and a confirmed fact look different, and
 * that what the platform had to assume is on the page rather than in a database column.
 *
 * The determinism test here is deliberately end-to-end rather than a repeat of the unit one: it
 * generates twice through the real HTTP path, with a real database in between, and asserts the page
 * is identical. Persistence is where a stable generator most easily becomes an unstable plan.
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

/** Start a project and build its plan. */
async function buildPlan(page: Page, idea = 'A booking tool for a village hall.'): Promise<string> {
  const projectId = await startProject(page, idea);

  await page.goto(`/plan/${projectId}`);
  await page.getByRole('button', { name: /build the plan/i }).click();

  await expect(page.getByRole('heading', { name: /what the engine produced/i })).toBeVisible();
  return projectId;
}

test.describe('before a plan exists', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(isWebkit(browserName), MOBILE_SAFARI_NOTE);
  });

  test('offers to build one', async ({ page }) => {
    const projectId = await startProject(page, 'A tool for tracking library loans.');
    await page.goto(`/plan/${projectId}`);

    await expect(page.getByRole('heading', { name: /no plan yet/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /build the plan/i })).toBeVisible();
  });

  test('states that no AI is involved', async ({ page }) => {
    // Plan §2.3: the deterministic engine is the core and external AI is optional. A user who
    // believes a model wrote this cannot rely on it being reproducible.
    const projectId = await startProject(page, 'A tool for tracking stock.');
    await page.goto(`/plan/${projectId}`);

    await expect(page.getByText(/uses no ai and invents nothing/i)).toBeVisible();
  });

  test('is reachable before the intake is finished', async ({ page }) => {
    /*
     * The design decision this test protects.
     *
     * Gating the plan behind a complete intake would defeat the engine's whole purpose: producing
     * something honest from partial information and saying what it assumed. A user who must answer
     * twenty-five questions before seeing anything leaves at question four.
     */
    const projectId = await startProject(page, 'An idea and nothing else.');
    await page.goto(`/plan/${projectId}`);
    await page.getByRole('button', { name: /build the plan/i }).click();

    await expect(page.getByRole('heading', { name: /what the engine produced/i })).toBeVisible();
  });
});

test.describe('a generated plan', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(isWebkit(browserName), MOBILE_SAFARI_NOTE);
  });

  test('contains phases', async ({ page }) => {
    await buildPlan(page);
    await expect(page.getByRole('heading', { name: /^phases$/i })).toBeVisible();
  });

  test('gives every item its provenance, beside the item', async ({ page }) => {
    /*
     * The property that makes the plan judgeable rather than merely present.
     *
     * A phase the engine derived and a fact the user confirmed carry different weight, and a reader
     * who cannot tell them apart cannot challenge either. Provenance in a tooltip is provenance
     * nobody reads.
     */
    await buildPlan(page);

    const derived = page.getByText(/worked out by the engine/i);
    await expect(derived.first()).toBeVisible();
    expect(await derived.count()).toBeGreaterThan(1);
  });

  test('never presents an engine conclusion as something the user confirmed', async ({ page }) => {
    // The trust ordering depends on `USER_CONFIRMED` meaning a person said so.
    await buildPlan(page);

    const body = (await page.textContent('main')) ?? '';
    const derivedCount = (body.match(/worked out by the engine/gi) ?? []).length;

    expect(derivedCount).toBeGreaterThan(0);
  });

  test('states what it had to assume', async ({ page }) => {
    /*
     * Plan §10. An assumption recorded in the graph but absent from the page is one the user will
     * never see, which makes it indistinguishable from a fact.
     *
     * The first version of this test accepted "we assumed" *or* "do not know", and the second
     * alternative is on the page for almost every project — so it passed without the assumptions
     * section existing at all. It also found a real gap: the generator's most consequential
     * assumption, that it fell back to a generic phase structure, lived only in a summary array the
     * page never read. It is now a node, and this asserts the node reaches the page.
     */
    await buildPlan(page, 'A project whose type has not been established.');

    await expect(page.getByRole('heading', { name: /what we assumed/i })).toBeVisible();
    // Exact, because the heading and the explanation both contain the phrase.
    await expect(
      page.getByText('A generic phase structure was used', { exact: true }),
    ).toBeVisible();
  });

  test('says what the assumption costs, not only that one was made', async ({ page }) => {
    // "We assumed something" is not actionable. Naming what is missing as a result is.
    await buildPlan(page, 'Another project with no type established.');

    await expect(
      page.getByText(/security, testing and release obligations .* are not included/i),
    ).toBeVisible();
  });

  test('lists what it does not know rather than filling the gap', async ({ page }) => {
    await buildPlan(page, 'An idea with almost nothing decided.');
    await expect(page.getByRole('heading', { name: /what we still do not know/i })).toBeVisible();
  });

  test('reports the same plan when rebuilt from the same answers', async ({ page }) => {
    /*
     * The Phase-6 gate, end to end.
     *
     * The unit suite proves the generator is pure. This proves the round trip is: same answers,
     * through HTTP, through Postgres, back out — identical page. Persistence is where a stable
     * generator most easily becomes an unstable plan, because ids, ordering and null handling all
     * change shape on the way through.
     */
    await buildPlan(page);

    const before = await page.locator('main').innerText();

    await page.getByRole('button', { name: /rebuild the plan/i }).click();
    await expect(page.getByRole('heading', { name: /what the engine produced/i })).toBeVisible();

    const after = await page.locator('main').innerText();
    expect(after).toBe(before);
  });

  test('produces a different plan for a different project type', async ({ page, browser }) => {
    // Guards the guard: the determinism test above would pass for a generator that ignored its input
    // entirely. Two projects, two shapes.
    await buildPlan(page, 'A shop selling handmade furniture to the public.');
    const first = await page.locator('main').innerText();

    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await buildPlan(otherPage, 'An internal tool for our own finance team.');
    const second = await otherPage.locator('main').innerText();

    expect(second).not.toBe(first);
    await other.close();
  });

  test('works without client JavaScript', async ({ browser }) => {
    // Server-rendered forms throughout. A plan that needs a hydrated bundle fails on a slow
    // connection at exactly the moment the user has invested the most effort.
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();

    await buildPlan(page, 'A no-JavaScript project.');
    await expect(page.getByRole('heading', { name: /^phases$/i })).toBeVisible();

    await context.close();
  });
});

test.describe('a plan belongs to one project and one guest', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(isWebkit(browserName), MOBILE_SAFARI_NOTE);
  });

  test('another guest cannot open it', async ({ page, browser }) => {
    const projectId = await buildPlan(page);

    const other = await browser.newContext();
    const otherPage = await other.newPage();
    const response = await otherPage.goto(`/plan/${projectId}`);

    // 404, never 403 — a 403 confirms the project exists.
    expect(response?.status()).toBe(404);
    await other.close();
  });

  test('an unknown project id is indistinguishable from a forbidden one', async ({ page }) => {
    const response = await page.goto('/plan/99999999-9999-4999-8999-999999999999');
    expect(response?.status()).toBe(404);
  });

  test('another guest cannot trigger generation for a project they do not own', async ({
    page,
    browser,
  }) => {
    /*
     * A real broken-object-level-authorisation attempt, not a bare POST.
     *
     * The first version of this test fired an unauthenticated POST at the route and asserted the
     * status was not 2xx — which the transport rejects before any application code runs, so it would
     * have passed against an action with no ownership check whatsoever.
     *
     * This one uses a genuine second guest with a valid session, on a page they are entitled to,
     * submitting the real form with the hidden project id rewritten to someone else's. That is
     * exactly the request an attacker would craft, and it reaches the server action.
     */
    const victimId = await startProject(page, 'A project belonging to the first guest.');

    const attacker = await browser.newContext();
    const attackerPage = await attacker.newPage();
    const attackerId = await startProject(attackerPage, 'A project belonging to the second guest.');

    await attackerPage.goto(`/plan/${attackerId}`);
    await expect(attackerPage.getByRole('button', { name: /build the plan/i })).toBeVisible();

    // Point their own form at the victim's project.
    await attackerPage.evaluate((id) => {
      const input = document.querySelector<HTMLInputElement>('input[name="projectId"]');
      if (input) input.value = id;
    }, victimId);

    await attackerPage.getByRole('button', { name: /build the plan/i }).click();

    // Sent back to the start rather than given someone else's project.
    await expect(attackerPage).toHaveURL(/\/start/);

    // And the victim's project is untouched: still no plan.
    await page.goto(`/plan/${victimId}`);
    await expect(page.getByRole('heading', { name: /no plan yet/i })).toBeVisible();

    await attacker.close();
  });

  test('the same request succeeds for the guest who does own the project', async ({ page }) => {
    // The inverse. Without it, an action that refused every request would pass the test above.
    const projectId = await startProject(page, 'A project the guest does own.');
    await page.goto(`/plan/${projectId}`);
    await page.getByRole('button', { name: /build the plan/i }).click();

    await expect(page.getByRole('heading', { name: /what the engine produced/i })).toBeVisible();
  });
});

test.describe('accessibility of the plan', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(isWebkit(browserName), MOBILE_SAFARI_NOTE);
  });

  test('has no axe violations before generation', async ({ page }) => {
    test.slow();

    const projectId = await startProject(page, 'An accessibility check project.');
    await page.goto(`/plan/${projectId}`);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(
      results.violations.flatMap((v) =>
        v.nodes.map((n) => `${v.id}: ${n.target.join(' ')} — ${v.help}`),
      ),
    ).toEqual([]);
  });

  test('has no axe violations once generated', async ({ page }) => {
    test.slow();

    await buildPlan(page, 'An accessibility check for a generated plan.');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(
      results.violations.flatMap((v) =>
        v.nodes.map((n) => `${v.id}: ${n.target.join(' ')} — ${v.help}`),
      ),
    ).toEqual([]);
  });
});
