#!/usr/bin/env node
/**
 * Latency smoke against a deployed environment (contract §11), recorded as JSON.
 *
 *   node scripts/evidence/perf-smoke.mjs https://govintel-web-staging.kpleelaaravind.workers.dev
 *
 * Measures time to the full response body for the public routes and the health endpoint, first
 * sequentially (what one user sees) and then with 20 concurrent requests (whether concurrency, not
 * the route, is what is slow). Run from this machine, so each figure includes the network between
 * here and Cloudflare's nearest edge — it is an upper bound on server time, stated as such, not a
 * claim about it. Project pages are measured by the E2E suite's own durations, since they need a
 * session this script does not create.
 *
 * Exits non-zero if any request fails or any p95 exceeds the budget, so it can be a gate.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = process.argv[2];
if (base === undefined) {
  console.error('usage: perf-smoke.mjs <base-url>');
  process.exit(2);
}

const ROUTES = ['/api/health', '/', '/start', '/how-it-works', '/portfolio', '/login'];
const SEQUENTIAL = 15;
const CONCURRENT = 20;
/** Plan §33: an interaction ≤ 200 ms and an LCP ≤ 2.5 s. A full HTML response over the internet is held to 1.5 s at p95. */
const P95_BUDGET_MS = 1500;

const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};

async function timed(url) {
  const start = performance.now();
  const response = await fetch(url, { redirect: 'manual' });
  await response.arrayBuffer();
  return { ms: performance.now() - start, status: response.status };
}

const results = [];
let failed = false;

for (const route of ROUTES) {
  const url = `${base}${route}`;
  await timed(url); // one warm-up, so a cold isolate is reported once rather than as the median
  const sequential = [];
  for (let i = 0; i < SEQUENTIAL; i++) sequential.push(await timed(url));
  const concurrent = await Promise.all(Array.from({ length: CONCURRENT }, () => timed(url)));

  const summarise = (samples) => ({
    n: samples.length,
    p50: Math.round(
      percentile(
        samples.map((s) => s.ms),
        50,
      ),
    ),
    p95: Math.round(
      percentile(
        samples.map((s) => s.ms),
        95,
      ),
    ),
    max: Math.round(Math.max(...samples.map((s) => s.ms))),
    statuses: [...new Set(samples.map((s) => s.status))],
  });

  const entry = { route, sequential: summarise(sequential), concurrent: summarise(concurrent) };
  const bad = [...sequential, ...concurrent].some((s) => s.status >= 500);
  const slow = entry.sequential.p95 > P95_BUDGET_MS || entry.concurrent.p95 > P95_BUDGET_MS;
  entry.withinBudget = !bad && !slow;
  if (!entry.withinBudget) failed = true;
  results.push(entry);
  console.log(
    `${route.padEnd(14)} seq p50 ${entry.sequential.p50} ms p95 ${entry.sequential.p95} ms | ` +
      `x${CONCURRENT} p50 ${entry.concurrent.p50} ms p95 ${entry.concurrent.p95} ms | ` +
      `status ${entry.sequential.statuses.join(',')}`,
  );
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = join(root, 'artifacts', 'test-evidence', 'performance', 'perf-smoke.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(
  out,
  `${JSON.stringify({ base, measuredAt: new Date().toISOString(), budgetP95Ms: P95_BUDGET_MS, results }, null, 2)}\n`,
);
process.exit(failed ? 1 : 0);
