import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Two test projects, deliberately separated:
 *
 *  - `node`   pure domain and engine code. No DOM, no framework. Fast, and the separation enforces
 *             the modular-monolith boundary - if a domain test suddenly needs jsdom, something in
 *             the domain has grown a UI dependency it should not have.
 *  - `client` React component tests in jsdom.
 */
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
      include: ['packages/*/src/**/*.ts', 'apps/*/src/**/*.{ts,tsx}'],
      exclude: ['**/*.d.ts', '**/index.ts'],
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          // Runs first: pure-Node suites are fast, so a domain regression surfaces in seconds
          // rather than behind the slow jsdom project.
          sequence: { groupOrder: 0 },
          include: ['packages/*/test/**/*.test.ts', 'apps/*/test/design/**/*.test.ts'],
          exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**', 'e2e/**'],
        },
      },
      {
        extends: true,
        plugins: [react()],
        test: {
          name: 'client',
          environment: 'jsdom',
          sequence: { groupOrder: 1 },
          /*
           * Threads, not forks.
           *
           * jsdom environment construction measured ~30s per worker on this machine, which exceeds
           * the default fork-worker response timeout - the suite failed with "Timeout waiting for
           * worker to respond" as soon as there was more than one client test file. Threads share
           * the process and start in a fraction of the time.
           *
           * The isolation forks give is not needed here: component tests touch no global process
           * state, and `cleanup()` in the setup file unmounts between cases.
           */
          pool: 'threads',
          // Vitest 4 removed `poolOptions`; these are top-level now.
          isolate: false,
          maxWorkers: 1,
          testTimeout: 20_000,
          hookTimeout: 30_000,
          setupFiles: ['./apps/web/test/setup.ts'],
          include: ['apps/*/test/client/**/*.test.{ts,tsx}'],
          exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**', 'e2e/**'],
        },
      },
    ],
  },
});
