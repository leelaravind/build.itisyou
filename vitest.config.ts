import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**', 'e2e/**'],
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
      include: ['packages/*/src/**/*.ts', 'apps/*/src/**/*.ts'],
      exclude: ['**/*.d.ts', '**/index.ts'],
    },
  },
});
