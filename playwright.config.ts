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
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // A committed `test.only` silently skips the rest of the suite - which is exactly the failure mode
  // that lets a broken build reach staging looking green.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 4 : undefined,
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

  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'pnpm --filter=@govintel/web start',
        url: 'http://localhost:3000',
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
        timeout: 120_000,
      },
});
