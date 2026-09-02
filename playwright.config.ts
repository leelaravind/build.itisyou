import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration.
 *
 * Contract: MASTER_IMPLEMENTATION_PLAN.md section 32.10 requires 40 critical journeys, section 25
 * requires automated accessibility coverage, section 32.12 requires 20 security regression tests.
 *
 * The browsers are already installed on this machine (see docs/audit/ENVIRONMENT_AUDIT.md), so no
 * download is needed against the constrained C: drive.
 */
/*
 * Where the mock issuer listens.
 *
 * Configurable because a leftover process on the default port would otherwise block the whole suite
 * from starting, and `reuseExistingServer` stays false here for the same reason it is false for the
 * application: a stale process answering is how you end up testing code that no longer exists.
 */
const MOCK_ISSUER = `http://localhost:${process.env.MOCK_OIDC_PORT ?? '4600'}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // A committed `test.only` silently skips the rest of the suite - which is exactly the failure mode
  // that lets a broken build reach staging looking green.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  /*
   * Capped, not left to the default half-the-cores.
   *
   * The application under test is backed by PGlite, which is single-connection, so every request
   * queues behind the previous one in the withDatabase queue (KI-013). Adding browser workers past a handful
   * therefore buys no parallelism at all — it just lengthens the queue until requests exceed the
   * per-test timeout. On this machine the default worker count pushed the Firefox accessibility runs
   * past 45s and the software compositor crashed outright, which reads as a flaky browser rather
   * than as backpressure from the database.
   *
   * Four is enough to overlap browser startup, which is where the real wall-clock goes.
   */
  workers: 4,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results/e2e.json' }]]
    : [['list'], ['html', { open: 'never' }]],
  timeout: 30_000,
  expect: { timeout: 5_000 },

  use: {
    /*
     * `localhost`, not `127.0.0.1`.
     *
     * WebKit declines to store cookies for a bare IP host, so the guest session cookie was never
     * sent back and every session-dependent test failed on mobile-safari while passing everywhere
     * else. The middleware treats both as loopback for the `upgrade-insecure-requests` decision, so
     * nothing else changes.
     */
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    // Plan section 24 locks six mobile screens; gap-spec section 3.3 forbids merely shrinking desktop UI.
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
    { name: 'mobile-safari', use: { ...devices['iPhone 14'] } },
  ],

  /*
   * Two servers locally: the application, and a mock OIDC issuer for it to authenticate against.
   *
   * The issuer is an ordinary process speaking OIDC (`e2e/support/mock-oidc.mjs`), not a flag inside
   * the application. A development-mode bypass would be an authentication bypass living in the
   * product, one misconfiguration from being reachable in a deployed environment, and it would test
   * the bypass rather than the flow. Configured this way the application cannot tell it is not
   * talking to a real provider, which is what makes the journey worth running.
   *
   * Against a deployed environment (`E2E_BASE_URL`) neither server starts and the auth journeys skip
   * themselves: staging has no provider configured, and pointing a deployed environment at a mock
   * issuer would be the same bad idea wearing different clothes.
   */
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        {
          command: 'node e2e/support/mock-oidc.mjs',
          url: `${MOCK_ISSUER}/health`,
          reuseExistingServer: false,
          timeout: 30_000,
        },
        {
          /*
           * Build, then start. `next start` serves whatever is in `.next`, which is not necessarily
           * the code on disk — so running the suite without building first tests the previous commit.
           *
           * That cost real time a third time: every new route in a freshly written spec returned 404,
           * which reads exactly like a routing bug and sends you looking for one. `reuseExistingServer`
           * below already rules out a stale *process*; this rules out a stale *artefact*, which is the
           * same failure wearing different clothes.
           *
           * The build is not skipped in CI. A conditional here would restore the very hole it closes,
           * and CI's own build step is cheap to repeat next to a phantom debugging session.
           */
          command: 'pnpm --filter=@govintel/web build && pnpm --filter=@govintel/web start',
          /*
           * Readiness is `/api/health`, not `/`.
           *
           * `/` renders without touching the database, so the port accepting connections says nothing
           * about whether the database is usable. On a fresh checkout the first request that *does*
           * touch it pays for creating the PGlite instance and building the schema from the DDL —
           * seconds, not milliseconds (KI-017) — and whichever test happens to run first absorbs that
           * cost against a 5s `toHaveURL`.
           *
           * That is what failed in CI: two `ai-import` tests, on chromium only, asserting they had
           * navigated to `/intake/{id}` and finding themselves still on `/start`. It looked like
           * broken project creation and was a cold start. Locally it never appeared, because a
           * `.pglite` directory from an earlier run was already warm.
           *
           * `/api/health` executes `select 1`, so waiting for it to answer means waiting for the
           * database to exist. Using the health endpoint as the readiness probe is what health
           * endpoints are for, and it removes the race for every spec at once rather than padding one
           * timeout at a time.
           */
          url: 'http://localhost:3000/api/health',
          /*
           * Never reuse an existing server, not even locally.
           *
           * `reuseExistingServer: !process.env.CI` is the common default and it cost real time twice
           * in this project: a server left running from an earlier debugging session kept answering,
           * so the suite tested code that had already been replaced. Both times the symptom was a
           * confident, reproducible failure against a fix that was actually correct — the worst kind,
           * because it sends you looking for a bug that no longer exists.
           *
           * Starting a fresh server costs a few seconds. Debugging a phantom failure costs far more.
           */
          reuseExistingServer: false,
          // Generous, because this now covers a production build as well as the server start.
          timeout: 300_000,
          /*
           * The client secret is a literal in a test fixture talking to a process that generated its
           * own key thirty seconds ago. It authenticates nothing and protects nothing, and writing
           * it here rather than reading it from the environment keeps it obvious that it is not a
           * credential. `scan:secrets` allows it for that reason.
           */
          env: {
            OIDC_ISSUER: MOCK_ISSUER,
            OIDC_CLIENT_ID: 'govintel-e2e',
            OIDC_CLIENT_SECRET: 'not-a-secret-mock-issuer-only',
            OIDC_REDIRECT_URI: 'http://localhost:3000/auth/callback',
          },
        },
      ],
});
