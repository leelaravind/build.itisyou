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
          /*
           * Hooks get 30s, not the default 10s.
           *
           * Several suites build a PGlite instance in `beforeAll`, which is real Postgres and costs
           * roughly a second and a half on its own (KI-017). Run in parallel across six database
           * files, that comfortably exceeds ten seconds — and the failure is a hook timeout in
           * *other* files, which reads as those files being broken rather than as the pool being
           * busy.
           *
           * The previous value was not chosen to match the cost of the operation; it was the default,
           * and it happened to be enough for five files. Raising it is correcting a limit tuned to a
           * file count rather than weakening a check: nothing here waits on a condition that might
           * never arrive, it waits on a database that is definitely being built.
           */
          hookTimeout: 30_000,
          /*
           * `server-only` throws on import by design — it exists to turn "this module reached a
           * client bundle" into a build error. The test runner is neither a server component nor a
           * client bundle, so it trips the guard while proving nothing. Stubbed rather than removed
           * from the modules under test, where the marker is doing real work.
           */
          alias: {
            'server-only': new URL('./apps/web/test/stubs/server-only.ts', import.meta.url)
              .pathname,
          },
          include: [
            'packages/*/test/**/*.test.ts',
            'apps/*/test/design/**/*.test.ts',
            // Server-side application code: cookie signing, session handling. Node environment, no
            // DOM — which is why it belongs in this project rather than the `client` one.
            'apps/*/test/server/**/*.test.ts',
          ],
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
