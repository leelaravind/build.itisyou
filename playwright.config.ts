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
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000',
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
        url: 'http://127.0.0.1:3000',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
