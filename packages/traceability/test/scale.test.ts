import { describe, expect, it } from 'vitest';
import { TwinGraph } from '@govintel/twin/graph';
import { createNode, type NodeClass, type TwinNode } from '@govintel/twin/nodes';
import type { EdgeClass, TwinEdge } from '@govintel/twin/edges';
import { checkInvariants } from '@govintel/twin/invariants';
import { traceAll } from '../src/chain.ts';
import { analyse } from '../src/gaps.ts';

/*
 * Gap-spec §63: the product is tested at realistic and large sizes, and at the large size "it must
 * not crash". These are the three fixtures it names, built as project graphs and put through the
 * engines every project surface calls — graph construction, the traceability chain for every
 * requirement, gap analysis and the invariant check.
 *
 * Each fixture is built so the right answer is known from its construction: every requirement has
 * work, a test covers requirement `k % requirements`, and every test has passed and kept evidence.
 * So a requirement's chain is complete exactly when some test reaches it, and the expected number of
 * complete chains is `min(requirements, tests)`. A scale bug that drops or double-counts links shows
 * up as a wrong count, not only as a slow run.
 *
 * The time budgets are wide on purpose — the large fixture measured about 150 ms on a laptop — and
 * exist to catch a blow-up rather than to benchmark a machine: a walk that rescans every edge for
 * every node is about 280 million steps at this size, which is seconds, not milliseconds.
 */

const AT = '2026-01-01T00:00:00.000Z';
const PROJECT = 'scale';

interface Size {
  readonly name: string;
  readonly people: number;
  readonly tasks: number;
  readonly requirements: number;
  readonly tests: number;
  readonly risks: number;
  /** The relationship floor the spec names for this size, where it names one. */
  readonly minEdges: number;
  readonly budgetMs: number;
}

const SIZES: readonly Size[] = [
  {
    name: 'small',
    people: 1,
    tasks: 30,
    requirements: 20,
    tests: 10,
    risks: 0,
    minEdges: 0,
    budgetMs: 1_000,
  },
  {
    name: 'medium',
    people: 12,
    tasks: 500,
    requirements: 150,
    tests: 300,
    risks: 100,
    minEdges: 0,
    budgetMs: 2_000,
  },
  {
    name: 'large',
    people: 100,
    tasks: 5_000,
    requirements: 1_000,
    tests: 3_000,
    risks: 0,
    minEdges: 10_000,
    budgetMs: 5_000,
  },
];

function node(
  id: string,
  nodeClass: NodeClass,
  attributes: Record<string, unknown> = {},
): TwinNode {
  return createNode({
    id,
    projectId: PROJECT,
    class: nodeClass,
    label: id,
    provenance: { provenance: 'DETERMINISTIC_CALCULATION', confidence: 'HIGH' },
    attributes,
    at: AT,
  });
}

function edge(from: string, to: string, edgeClass: EdgeClass): TwinEdge {
  return {
    id: `${from}:${edgeClass}:${to}`,
    projectId: PROJECT,
    class: edgeClass,
    from,
    to,
    createdAt: AT,
  };
}

function fixture(size: Size): { nodes: TwinNode[]; edges: TwinEdge[] } {
  const nodes: TwinNode[] = [node('proj', 'PROJECT')];
  const edges: TwinEdge[] = [];
  const phases = 5;

  for (let p = 0; p < phases; p += 1) {
    nodes.push(node(`phase-${p}`, 'PHASE'));
    edges.push(edge('proj', `phase-${p}`, 'CONTAINS'));
  }
  for (let i = 0; i < size.people; i += 1) {
    nodes.push(node(`person-${i}`, 'RESOURCE'));
    edges.push(edge('proj', `person-${i}`, 'CONTAINS'));
  }
  for (let r = 0; r < size.requirements; r += 1) {
    nodes.push(
      node(`req-${r}`, 'REQUIREMENT', {
        kind: 'FUNCTIONAL',
        priority: 'MUST',
        verification: ['TEST'],
        acceptance: [{ id: 'a1', statement: `Requirement ${r} is observable.` }],
        sourceRef: 'intake:capabilities',
      }),
    );
    edges.push(edge('proj', `req-${r}`, 'CONTAINS'));
    edges.push(edge(`req-${r}`, `person-${r % size.people}`, 'OWNED_BY'));
  }
  for (let t = 0; t < size.tasks; t += 1) {
    nodes.push(node(`task-${t}`, 'TASK'));
    edges.push(edge(`phase-${t % phases}`, `task-${t}`, 'CONTAINS'));
    edges.push(edge(`task-${t}`, `req-${t % size.requirements}`, 'IMPLEMENTS'));
    edges.push(edge(`task-${t}`, `person-${t % size.people}`, 'ASSIGNED_TO'));
  }
  for (let k = 0; k < size.tests; k += 1) {
    const requirement = `req-${k % size.requirements}`;
    nodes.push(
      node(`test-${k}`, 'TEST', {
        outcome: 'PASSED',
        attests: [{ nodeId: requirement, revision: 1 }],
      }),
    );
    nodes.push(
      node(`evidence-${k}`, 'EVIDENCE', {
        hash: `sha256:${k.toString(16).padStart(8, '0')}`,
        attests: [{ nodeId: requirement, revision: 1 }],
      }),
    );
    edges.push(edge(`test-${k}`, requirement, 'VERIFIES'));
    edges.push(edge(`test-${k}`, `evidence-${k}`, 'EVIDENCED_BY'));
  }
  for (let i = 0; i < size.risks; i += 1) {
    nodes.push(node(`risk-${i}`, 'RISK'));
    edges.push(edge('proj', `risk-${i}`, 'CONTAINS'));
  }

  return { nodes, edges };
}

describe('gap-spec §63 performance fixtures', () => {
  for (const size of SIZES) {
    it(`${size.name}: ${size.tasks} tasks, ${size.requirements} requirements, ${size.tests} tests, ${size.people} people — traced and analysed without crashing, within budget`, () => {
      const { nodes, edges } = fixture(size);
      expect(edges.length).toBeGreaterThanOrEqual(size.minEdges);

      const started = performance.now();
      const graph = new TwinGraph({ projectId: PROJECT, nodes, edges });
      const traces = traceAll(graph);
      const report = analyse(graph);
      const invariants = checkInvariants(graph);
      const elapsed = performance.now() - started;

      expect(graph.size).toBe(nodes.length);
      expect(graph.edgeCount).toBe(edges.length);
      expect(traces).toHaveLength(size.requirements);
      expect(traces.filter((trace) => trace.complete)).toHaveLength(
        Math.min(size.requirements, size.tests),
      );
      const covered = Math.min(size.requirements, size.tests);
      expect(report.counts.requirements).toBe(size.requirements);
      expect(report.counts.complete).toBe(covered);
      expect(report.gaps.filter((gap) => gap.kind === 'REQUIREMENT_WITHOUT_TEST')).toHaveLength(
        size.requirements - covered,
      );
      expect(report.gaps.filter((gap) => gap.kind === 'REQUIREMENT_WITHOUT_WORK')).toHaveLength(0);
      expect(invariants.violations).toBeInstanceOf(Array);
      expect(elapsed).toBeLessThan(size.budgetMs);
    }, 60_000);
  }

  it('gives the same answer for the large fixture in reverse order — no order-dependent state', () => {
    const large = SIZES.find((size) => size.name === 'large');
    if (large === undefined) throw new Error('large fixture missing');
    const { nodes, edges } = fixture(large);

    const first = traceAll(new TwinGraph({ projectId: PROJECT, nodes, edges }));
    const reversed = traceAll(
      new TwinGraph({
        projectId: PROJECT,
        nodes: [...nodes].reverse(),
        edges: [...edges].reverse(),
      }),
    );

    const completeIds = (traces: typeof first) =>
      traces
        .filter((trace) => trace.complete)
        .map((trace) => trace.requirementId)
        .sort();
    expect(completeIds(reversed)).toEqual(completeIds(first));
  }, 60_000);
});
