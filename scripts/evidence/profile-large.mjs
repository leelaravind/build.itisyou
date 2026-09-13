#!/usr/bin/env node
/**
 * Where the Work page's time goes at gap-spec §63's Large size (FR-020, W-PERF-3).
 *
 *   node --experimental-strip-types scripts/evidence/profile-large.mjs
 *
 * Runs, in order, every pure step `app/plan/[projectId]/work/page.tsx` performs after its database
 * reads — rule evaluation, decomposition, the merge, and the board, today, project and capacity
 * summaries — on the Large plan from `perf-large.mjs`, and times each one. The database reads and the
 * React render are not included; the staging measurement in `performance/perf-large.json` includes
 * everything, so the difference between the two is what those cost.
 *
 * Writes `artifacts/test-evidence/performance/profile-large.json`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const load = (path) => import(pathToFileURL(join(process.cwd(), path)).href);
const { TwinGraph } = await load('packages/twin/src/graph.ts');
const { createNode } = await load('packages/twin/src/nodes.ts');
const { RULES, RULESET_VERSION } = await load('packages/rules/src/catalogue.ts');
const { evaluateRules } = await load('packages/rules/src/evaluate.ts');
const { decompose, mergeIntoGraph } = await load('packages/execution/src/decompose.ts');
const { buildBoard, buildToday, summariseProject } = await load('packages/execution/src/board.ts');
const { summariseCapacity } = await load('packages/execution/src/scheduling.ts');

const AT = '2026-01-01T00:00:00.000Z';
const PROJECT = 'scale';
const nodes = [];
const edges = [];
const node = (id, nodeClass, attributes = {}) =>
  nodes.push(
    createNode({
      id,
      projectId: PROJECT,
      class: nodeClass,
      label: id,
      provenance: { provenance: 'DETERMINISTIC_CALCULATION', confidence: 'HIGH' },
      attributes,
      at: AT,
    }),
  );
const edge = (from, to, edgeClass) =>
  edges.push({
    id: `${from}:${edgeClass}:${to}`,
    projectId: PROJECT,
    class: edgeClass,
    from,
    to,
    createdAt: AT,
  });

node('proj', 'PROJECT');
for (let p = 0; p < 5; p += 1) {
  node(`phase-${p}`, 'PHASE');
  edge('proj', `phase-${p}`, 'CONTAINS');
}
for (let i = 0; i < 100; i += 1) {
  node(`person-${i}`, 'RESOURCE');
  edge('proj', `person-${i}`, 'CONTAINS');
}
for (let r = 0; r < 1_000; r += 1) {
  node(`req-${r}`, 'REQUIREMENT', {
    kind: 'FUNCTIONAL',
    priority: 'MUST',
    verification: ['TEST'],
    acceptance: [{ id: 'a1', statement: `Requirement ${r} is observable.` }],
    sourceRef: 'intake:capabilities',
  });
  edge('proj', `req-${r}`, 'CONTAINS');
  edge(`req-${r}`, `person-${r % 100}`, 'OWNED_BY');
}
for (let t = 0; t < 5_000; t += 1) {
  node(`task-${t}`, 'TASK');
  edge(`phase-${t % 5}`, `task-${t}`, 'CONTAINS');
  edge(`task-${t}`, `req-${t % 1_000}`, 'IMPLEMENTS');
  edge(`task-${t}`, `person-${t % 100}`, 'ASSIGNED_TO');
}
for (let k = 0; k < 3_000; k += 1) {
  const requirement = `req-${k % 1_000}`;
  node(`test-${k}`, 'TEST', { outcome: 'PASSED', attests: [{ nodeId: requirement, revision: 1 }] });
  node(`evidence-${k}`, 'EVIDENCE', {
    hash: `sha256:${k.toString(16).padStart(8, '0')}`,
    attests: [{ nodeId: requirement, revision: 1 }],
  });
  edge(`test-${k}`, requirement, 'VERIFIES');
  edge(`test-${k}`, `evidence-${k}`, 'EVIDENCED_BY');
}

const steps = [];
const time = (name, fn) => {
  const started = performance.now();
  const value = fn();
  steps.push({ step: name, ms: Math.round(performance.now() - started) });
  return value;
};

const planGraph = time(
  'graph construction',
  () => new TwinGraph({ projectId: PROJECT, nodes, edges }),
);
const evaluation = time('rule evaluation (evaluateRules)', () =>
  evaluateRules(
    RULES,
    {
      projectId: PROJECT,
      lifecycleState: 'DISCOVERY',
      methodology: 'AGILE',
      intake: [],
      asOf: AT.slice(0, 10),
      graph: planGraph,
    },
    RULESET_VERSION,
  ),
);
const decomposition = time('decompose', () =>
  decompose({
    projectId: PROJECT,
    graph: planGraph,
    emissions: evaluation.emissions,
    teamSize: 100,
    at: AT,
  }),
);
const graph = time('mergeIntoGraph', () => mergeIntoGraph(planGraph, decomposition));
time('buildToday', () => buildToday({ graph }));
time('buildBoard', () => buildBoard(graph));
time('summariseProject', () => summariseProject(graph));
time('summariseCapacity', () => summariseCapacity({ graph, resources: [] }));

const total = steps.reduce((sum, s) => sum + s.ms, 0);
for (const s of steps) console.log(`${s.step.padEnd(34)} ${String(s.ms).padStart(6)} ms`);
console.log(`${'total (pure steps)'.padEnd(34)} ${String(total).padStart(6)} ms`);

const file = join(process.cwd(), 'artifacts', 'test-evidence', 'performance', 'profile-large.json');
mkdirSync(dirname(file), { recursive: true });
writeFileSync(
  file,
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      platform: `${process.platform} ${process.arch} node ${process.version}`,
      fixture: { nodes: nodes.length, edges: edges.length },
      page: 'app/plan/[projectId]/work/page.tsx (pure steps only)',
      steps,
      totalMs: total,
    },
    null,
    2,
  )}\n`,
);
