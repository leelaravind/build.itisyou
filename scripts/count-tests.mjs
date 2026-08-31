#!/usr/bin/env node
/**
 * Test census.
 *
 * Contract: MASTER_IMPLEMENTATION_PLAN.md section 0.3 requires at least 600 meaningful automated
 * tests with a per-area distribution; gap-spec section 64 forbids meeting the number with trivial
 * copies.
 *
 * This reports actual executed test counts from Vitest and Playwright, grouped into the plan's
 * areas, so progress toward the target is measured rather than estimated. It does not judge whether
 * a test is meaningful - no script can. That remains a review obligation, and this output exists to
 * make a shortfall or a suspicious spike visible.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';

/** Plan section 0.3 target distribution. */
const TARGETS = [
  { area: 'Domain model + invariants', minimum: 70, match: /packages[\\/]domain[\\/]/ },
  { area: 'Deterministic rules engine', minimum: 100, match: /packages[\\/]rules[\\/]/ },
  { area: 'Lifecycle + quality gates', minimum: 45, match: /packages[\\/](lifecycle|gates)[\\/]/ },
  { area: 'AI interchange validation', minimum: 55, match: /packages[\\/]interchange[\\/]/ },
  { area: 'Budget/estimation/resource calc', minimum: 50, match: /packages[\\/]calc[\\/]/ },
  { area: 'Dependency/impact propagation', minimum: 50, match: /packages[\\/]graph[\\/]/ },
  { area: 'API + contract', minimum: 55, match: /apps[\\/]web[\\/]test[\\/]api[\\/]/ },
  { area: 'Auth/RBAC/tenant isolation', minimum: 50, match: /(tenant|rbac|auth)/i },
  {
    area: 'Frontend components',
    minimum: 45,
    match: /apps[\\/]web[\\/]test[\\/](client|components)[\\/]/,
  },
  { area: 'Foundation (shared)', minimum: 0, match: /packages[\\/]shared[\\/]/ },
];

const REPORT = 'test-results/vitest-census.json';

function collectVitest() {
  try {
    rmSync(REPORT, { force: true });
    execSync(`npx vitest run --reporter=json --outputFile=${REPORT}`, {
      stdio: ['ignore', 'ignore', 'inherit'],
    });
  } catch {
    // A failing suite still writes the report; the census is about counts, not pass/fail.
  }

  if (!existsSync(REPORT)) return { total: 0, byFile: new Map() };

  const data = JSON.parse(readFileSync(REPORT, 'utf8'));
  const byFile = new Map();
  let total = 0;

  for (const suite of data.testResults ?? []) {
    const file = suite.name ?? '';
    const count = (suite.assertionResults ?? []).length;
    byFile.set(file, (byFile.get(file) ?? 0) + count);
    total += count;
  }
  return { total, byFile };
}

const { total, byFile } = collectVitest();

console.log('\nTest census - progress toward the 600 minimum (plan section 0.3)\n');
console.log(`${'Area'.padEnd(34)} ${'Count'.padStart(6)} ${'Min'.padStart(6)}  Status`);
console.log('-'.repeat(64));

const counted = new Set();
let accountedFor = 0;

for (const { area, minimum, match } of TARGETS) {
  let count = 0;
  for (const [file, n] of byFile) {
    if (counted.has(file)) continue;
    if (match.test(file)) {
      count += n;
      counted.add(file);
    }
  }
  accountedFor += count;
  const status = count >= minimum ? 'ok' : `short by ${minimum - count}`;
  console.log(
    `${area.padEnd(34)} ${String(count).padStart(6)} ${String(minimum).padStart(6)}  ${status}`,
  );
}

const unclassified = total - accountedFor;
if (unclassified > 0)
  console.log(`${'Unclassified'.padEnd(34)} ${String(unclassified).padStart(6)}`);

console.log('-'.repeat(64));
console.log(`${'Vitest total'.padEnd(34)} ${String(total).padStart(6)} ${String(600).padStart(6)}`);
console.log(
  '\nPlaywright journeys, accessibility and security suites are counted separately by',
  '`pnpm test:e2e`; plan section 0.3 requires 40 + 20 + 20 of those.\n',
);

if (total < 600) {
  console.log(`Remaining to reach the Vitest portion of the target: ${600 - total}\n`);
}
