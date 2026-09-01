import { test, expect } from '@playwright/test';

/**
 * The staging gate — Phase 19.
 *
 * The plan lists eight tasks for staging, and most of them are already covered: the full E2E suite
 * runs against a production build, security headers have their own suite, and migrations are checked
 * by the schema fingerprint. What was missing is the part a staging environment exists to prove —
 * that the *deployed artefact* answers for itself.
 *
 * Two properties, and both are about the running process rather than about the code.
 *
 * **Version identity.** A version reported by the deployment pipeline tells you what the pipeline
 * believed it shipped. A version reported by the process tells you what is actually serving, and the
 * two differ in exactly the situations where somebody urgently needs to know.
 *
 * **Health that checks rather than remembers.** A health endpoint returning a cached status answers
 * "was this healthy at some point", which nobody is asking.
 *
 * There is also a performance smoke test here. It is deliberately a smoke test rather than a
 * benchmark — see the comment on it.
 */

test.describe('deployment identity', () => {
  test('the running process reports what it is', async ({ request }) => {
    const response = await request.get('/api/health');

    expect(response.status()).toBe(200);

    const body = (await response.json()) as Record<string, unknown>;

    expect(body.status).toBe('ok');
    expect(body.mode).toBe('NORMAL');

    /*
     * `unknown` is a legitimate value here and the test says so rather than requiring a real commit.
     * A local build has no commit, and a test demanding one would fail for everybody running the
     * suite on their own machine — which is how a check gets deleted rather than fixed.
     *
     * What matters is that the field exists and comes from the process.
     */
    expect(typeof body.commit).toBe('string');
    expect(typeof body.version).toBe('string');
    expect(typeof body.environment).toBe('string');
  });

  test('health is never cached', async ({ request }) => {
    // A cached health response is a report about a moment that has passed, which is the one thing a
    // health check must never be.
    const response = await request.get('/api/health');

    expect(response.headers()['cache-control']).toMatch(/no-store/);
  });

  test('health discloses nothing beyond a status and a version', async ({ request }) => {
    const response = await request.get('/api/health');
    const body = (await response.json()) as Record<string, unknown>;

    /*
     * This is the most-scraped URL a service has and it is unauthenticated, so everything it returns
     * is public. A stack trace, a connection string or a row count here is reconnaissance somebody
     * else can use.
     */
    expect(Object.keys(body).sort()).toEqual([
      'commit',
      'environment',
      'mode',
      'status',
      'version',
    ]);

    const serialised = JSON.stringify(body);

    expect(serialised).not.toMatch(/postgres|password|connection|at .*\.ts:\d+/i);
  });
});

test.describe('performance smoke', () => {
  /**
   * A smoke test, not a benchmark.
   *
   * A benchmark on shared CI hardware measures the CI provider's scheduling as much as the code, and
   * a threshold tight enough to catch a real regression is loose enough to fail randomly. That test
   * gets quarantined within a fortnight and then deleted, taking the real signal with it.
   *
   * So the threshold is deliberately generous. It catches the failures worth catching at this level:
   * an accidental synchronous loop over every node, an N+1 that turns one query into four hundred, a
   * page that renders the whole graph. Those are not marginal — they are orders of magnitude, and a
   * ten-second budget finds them while never firing on a slow runner.
   */
  const BUDGET_MS = 10_000;

  for (const route of ['/', '/how-it-works', '/start', '/portfolio']) {
    test(`${route} responds within the smoke budget`, async ({ request }) => {
      const started = Date.now();
      const response = await request.get(route);
      const elapsed = Date.now() - started;

      expect(response.status()).toBe(200);
      expect(elapsed, `${route} took ${String(elapsed)}ms`).toBeLessThan(BUDGET_MS);
    });
  }

  test('a fully planned project renders within the smoke budget', async ({ page, browserName }) => {
    /*
     * Skipped on WebKit, and only here.
     *
     * This is the one test in the file that needs a guest session, and WebKit drops the session
     * cookie over plain HTTP (KI-024) — so it times out for a reason that has nothing to do with
     * performance. The request-based tests above have no session and stay on every browser, which is
     * where their value is.
     */
    test.skip(
      browserName === 'webkit',
      'WebKit drops the session cookie over plain HTTP; verified against HTTPS at the staging gate (KI-024)',
    );

    /*
     * The route that does the most work: rules evaluation, decomposition, estimation, budget
     * roll-up, feasibility and health, all on one request. If anything in the deterministic core has
     * acquired an accidental quadratic, this is where it shows.
     */
    await page.goto('/start');
    await page.getByLabel(/describe your project/i).fill('A performance smoke project.');
    await page.getByRole('button', { name: /continue/i }).click();
    await expect(page).toHaveURL(/\/intake\/[0-9a-f-]{36}/);

    const projectId = /\/intake\/([^/?]+)/.exec(page.url())?.[1] ?? '';

    await page.goto(`/plan/${projectId}`);
    await page.getByRole('button', { name: /build the plan/i }).click();
    await expect(page.getByRole('heading', { name: /what the engine produced/i })).toBeVisible();

    const started = Date.now();
    await page.goto(`/plan/${projectId}/budget`);
    await expect(page.getByRole('heading', { name: /^effort$/i })).toBeVisible();
    const elapsed = Date.now() - started;

    expect(elapsed, `budget page took ${String(elapsed)}ms`).toBeLessThan(BUDGET_MS);
  });
});

test.describe('the deployed artefact serves what was built', () => {
  test('serves a production build rather than a development one', async ({ request }) => {
    /*
     * Three separate stale-artefact incidents in this project (KI-027 and its predecessors) came from
     * a server that was running something other than the code under test. The Playwright config now
     * builds inside the webServer command; this asserts the result from the outside.
     *
     * A development build sends `x-nextjs-*` development headers and unminified payloads; a
     * production one does not.
     */
    const response = await request.get('/');
    const body = await response.text();

    expect(response.status()).toBe(200);
    expect(body).not.toContain('__next_dev__');
    expect(body).not.toMatch(/webpack-hmr|react-refresh/);
  });

  test('does not advertise what it is built with', async ({ request }) => {
    const response = await request.get('/');

    expect(response.headers()['x-powered-by']).toBeUndefined();
  });
});
