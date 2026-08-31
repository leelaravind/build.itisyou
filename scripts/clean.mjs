#!/usr/bin/env node
/** Remove build and test output. Cross-platform, so it works the same in CI and on Windows. */
import { rmSync } from 'node:fs';
import { join } from 'node:path';

const TARGETS = [
  '.next',
  'dist',
  'coverage',
  'test-results',
  'playwright-report',
  'tsconfig.tsbuildinfo',
];
const ROOTS = ['.', 'apps/web', 'packages/shared'];

for (const root of ROOTS) {
  for (const target of TARGETS) {
    rmSync(join(root, target), { recursive: true, force: true });
  }
}
console.log('Cleaned build and test output.');
