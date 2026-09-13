#!/usr/bin/env node
/**
 * Gap-spec §63 on a deployed environment: a Large project's pages, served by the real runtime.
 *
 *   APP_DSN_FILE=<file> OWNER_DSN_FILE=<file> node scripts/evidence/perf-large.mjs <base-url>
 *
 * 1. Starts a guest project through the product's own `/start` flow in a real browser, so the
 *    project, organisation and session are exactly what a visitor gets.
 * 2. Seeds the Large fixture from `packages/traceability/test/scale.test.ts` into that project's twin
 *    — 12,106 nodes and 23,105 relationships — **as the restricted application role**, inside a
 *    transaction scoped to the project's organisation, so row-level security admits the rows exactly
 *    as it would admit the product's own writes. The owner connection is used for one read only: the
 *    project's organisation id, which the restricted role cannot see without a tenant.
 * 3. Requests every project page with that visitor's cookie and records status and latency.
 *
 * §63's bar at this size is "it must not crash": the check passes when every page answers 200 with
 * no error boundary. Latency is recorded against the interactive budget used by `perf-smoke.mjs`
 * and reported, not hidden.
 *
 * Connection strings are read from files and never printed. Seeded data belongs to a guest project,
 * so the guest purge removes it with the project (staging keeps guests six hours).
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { chromium } from '@playwright/test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const base = (process.argv[2] ?? '').replace(/\/$/, '');
if (!base.startsWith('https://')) {
  console.error('usage: node scripts/evidence/perf-large.mjs <https-base-url>');
  process.exit(2);
}
const appDsn = readFileSync(process.env.APP_DSN_FILE ?? '', 'utf8').trim();
const ownerDsn = readFileSync(process.env.OWNER_DSN_FILE ?? '', 'utf8').trim();

const BUDGET_P95_MS = 1500;
const SAMPLES = 6;
const SIZE = { people: 100, tasks: 5_000, requirements: 1_000, tests: 3_000, phases: 5 };

// 1. A real guest project -------------------------------------------------------------------------
const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
await page.goto(`${base}/start`);
await page.getByLabel(/describe your project/i).fill('Performance fixture: a large project (§63)');
await page.getByRole('button', { name: /continue/i }).click();
await page.waitForURL(/\/intake\/[0-9a-f-]{36}/, { timeout: 30_000 });
const projectId = /\/intake\/([0-9a-f-]{36})/.exec(page.url())[1];
const cookie = (await context.cookies(base)).map((c) => `${c.name}=${c.value}`).join('; ');
await browser.close();
console.log(`project ${projectId}`);

// 2. Seed as the restricted role ------------------------------------------------------------------
const owner = postgres(ownerDsn, { max: 1, prepare: false });
const [{ organization_id: organizationId }] =
  await owner`SELECT organization_id FROM projects WHERE id = ${projectId}`;
await owner.end();

const id = (local) => `${projectId}:${local}`;
const nodes = [];
const edges = [];
const node = (local, nodeClass, attributes = {}) =>
  nodes.push({
    id: id(local),
    organization_id: organizationId,
    project_id: projectId,
    class: nodeClass,
    label: local,
    state: 'ACTIVE',
    provenance: 'DETERMINISTIC_CALCULATION',
    confidence: 'HIGH',
    revision: 1,
    attributes,
  });
const edge = (from, to, edgeClass) =>
  edges.push({
    id: id(`${from}:${edgeClass}:${to}`),
    organization_id: organizationId,
    project_id: projectId,
    class: edgeClass,
    from_id: id(from),
    to_id: id(to),
  });

node('proj', 'PROJECT');
for (let p = 0; p < SIZE.phases; p += 1) {
  node(`phase-${p}`, 'PHASE');
  edge('proj', `phase-${p}`, 'CONTAINS');
}
for (let i = 0; i < SIZE.people; i += 1) {
  node(`person-${i}`, 'RESOURCE');
  edge('proj', `person-${i}`, 'CONTAINS');
}
for (let r = 0; r < SIZE.requirements; r += 1) {
  node(`req-${r}`, 'REQUIREMENT', {
    kind: 'FUNCTIONAL',
    priority: 'MUST',
    verification: ['TEST'],
    acceptance: [{ id: 'a1', statement: `Requirement ${r} is observable.` }],
    sourceRef: 'intake:capabilities',
  });
  edge('proj', `req-${r}`, 'CONTAINS');
  edge(`req-${r}`, `person-${r % SIZE.people}`, 'OWNED_BY');
}
for (let t = 0; t < SIZE.tasks; t += 1) {
  node(`task-${t}`, 'TASK');
  edge(`phase-${t % SIZE.phases}`, `task-${t}`, 'CONTAINS');
  edge(`task-${t}`, `req-${t % SIZE.requirements}`, 'IMPLEMENTS');
  edge(`task-${t}`, `person-${t % SIZE.people}`, 'ASSIGNED_TO');
}
for (let k = 0; k < SIZE.tests; k += 1) {
  const requirement = id(`req-${k % SIZE.requirements}`);
  node(`test-${k}`, 'TEST', { outcome: 'PASSED', attests: [{ nodeId: requirement, revision: 1 }] });
  node(`evidence-${k}`, 'EVIDENCE', {
    hash: `sha256:${k.toString(16).padStart(8, '0')}`,
    attests: [{ nodeId: requirement, revision: 1 }],
  });
  edge(`test-${k}`, `req-${k % SIZE.requirements}`, 'VERIFIES');
  edge(`test-${k}`, `evidence-${k}`, 'EVIDENCED_BY');
}

const app = postgres(appDsn, { max: 1, prepare: false });
const seedStarted = Date.now();
await app.begin(async (tx) => {
  const [{ role }] = await tx`SELECT current_user AS role`;
  if (role !== 'govintel_app') throw new Error(`seeding must run as govintel_app, not ${role}`);
  await tx`SELECT set_config('app.current_organization_id', ${organizationId}, true)`;
  const nodeCols = [
    'id',
    'organization_id',
    'project_id',
    'class',
    'label',
    'state',
    'provenance',
    'confidence',
    'revision',
    'attributes',
  ];
  for (let i = 0; i < nodes.length; i += 1000) {
    const batch = nodes
      .slice(i, i + 1000)
      .map((n) => ({ ...n, attributes: tx.json(n.attributes) }));
    await tx`INSERT INTO twin_nodes ${tx(batch, nodeCols)}`;
  }
  const edgeCols = ['id', 'organization_id', 'project_id', 'class', 'from_id', 'to_id'];
  for (let i = 0; i < edges.length; i += 2000) {
    await tx`INSERT INTO twin_edges ${tx(edges.slice(i, i + 2000), edgeCols)}`;
  }
});
await app.end();
const seedMs = Date.now() - seedStarted;
console.log(`seeded ${nodes.length} nodes, ${edges.length} edges as govintel_app in ${seedMs} ms`);

// 3. The pages, as that visitor -------------------------------------------------------------------
const routes = [
  `/p/${projectId}`,
  `/plan/${projectId}`,
  `/plan/${projectId}/trace`,
  `/plan/${projectId}/rules`,
  `/plan/${projectId}/work`,
  `/plan/${projectId}/budget`,
  `/plan/${projectId}/evidence`,
  `/plan/${projectId}/change`,
  `/plan/${projectId}/baseline`,
  `/plan/${projectId}/release`,
  `/plan/${projectId}/close`,
];
const quantile = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)];
};
const results = [];
for (const route of routes) {
  const samples = [];
  const statuses = new Set();
  let errorBoundary = false;
  let bytes = 0;
  for (let i = 0; i <= SAMPLES; i += 1) {
    const started = performance.now();
    const response = await fetch(`${base}${route}`, { headers: { cookie }, redirect: 'manual' });
    const body = await response.text();
    const elapsed = performance.now() - started;
    if (i === 0) continue; // warm-up
    samples.push(elapsed);
    statuses.add(response.status);
    bytes = body.length;
    if (/something went wrong/i.test(body)) errorBoundary = true;
  }
  const row = {
    route: route.replace(projectId, ':id'),
    statuses: [...statuses],
    errorBoundary,
    bytes,
    p50: Math.round(quantile(samples, 0.5)),
    p95: Math.round(quantile(samples, 0.95)),
  };
  results.push(row);
  console.log(
    `${row.route.padEnd(24)} status ${row.statuses.join(',')} p50 ${row.p50} ms p95 ${row.p95} ms ${Math.round(bytes / 1024)} KiB${errorBoundary ? ' ERROR BOUNDARY' : ''}`,
  );
}

const crashed = results.filter((r) => r.statuses.some((s) => s !== 200) || r.errorBoundary);
const overBudget = results.filter((r) => r.p95 > BUDGET_P95_MS);
const out = {
  generatedAt: new Date().toISOString(),
  base,
  fixture: { ...SIZE, nodes: nodes.length, edges: edges.length },
  seed: { role: 'govintel_app', rlsScoped: true, ms: seedMs },
  samplesPerRoute: SAMPLES,
  budgetP95Ms: BUDGET_P95_MS,
  results,
  crashed: crashed.map((r) => r.route),
  overBudget: overBudget.map((r) => r.route),
};
const file = join(root, 'artifacts', 'test-evidence', 'performance', 'perf-large.json');
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
console.log(
  `crashed: ${crashed.length} of ${results.length}; over the ${BUDGET_P95_MS} ms p95 budget: ${overBudget.map((r) => r.route).join(', ') || 'none'}`,
);
if (crashed.length > 0) process.exitCode = 1;
