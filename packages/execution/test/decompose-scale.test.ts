import { describe, expect, it } from 'vitest';
import { TwinGraph } from '@govintel/twin/graph';
import { createNode, type NodeClass, type TwinNode } from '@govintel/twin/nodes';
import type { EdgeClass, TwinEdge } from '@govintel/twin/edges';
import { decompose, mergeIntoGraph } from '../src/decompose.ts';

/*
 * FR-020. At gap-spec §63's Large size, the three staging pages that call `decompose` on every
 * request take nine to ten seconds; the pages that do not call it take one to two and a half.
 *
 * This runs the decomposer alone on the same Large plan (5 phases, 1,000 requirements, 5,000 tasks),
 * so its share of those seconds is measured rather than inferred: the duration in the unit JSON
 * record is the measurement. The assertions guard what §63 requires — it completes and returns a
 * mergeable result — and the 60 s limit catches a hang, not slowness. Slowness is W-PERF-3, open, and
 * a budget belongs here once that is fixed.
 */

const AT = '2026-01-01T00:00:00.000Z';
const PROJECT = 'scale';

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

function largePlan(): TwinGraph {
  const nodes: TwinNode[] = [node('proj', 'PROJECT')];
  const edges: TwinEdge[] = [];
  for (let p = 0; p < 5; p += 1) {
    nodes.push(node(`phase-${p}`, 'PHASE'));
    edges.push(edge('proj', `phase-${p}`, 'CONTAINS'));
  }
  for (let r = 0; r < 1_000; r += 1) {
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
  }
  for (let t = 0; t < 5_000; t += 1) {
    nodes.push(node(`task-${t}`, 'TASK'));
    edges.push(edge(`phase-${t % 5}`, `task-${t}`, 'CONTAINS'));
    edges.push(edge(`task-${t}`, `req-${t % 1_000}`, 'IMPLEMENTS'));
  }
  return new TwinGraph({ projectId: PROJECT, nodes, edges });
}

const NO_EMISSIONS = {
  requirements: [],
  tasks: [],
  tests: [],
  gates: [],
  risks: [],
  calculationEffects: [],
};

describe('decompose at gap-spec §63 Large size (FR-020)', () => {
  it('completes on 5,000 tasks and 1,000 requirements and returns a result that merges into the plan', () => {
    const graph = largePlan();

    const result = decompose({
      projectId: PROJECT,
      graph,
      emissions: NO_EMISSIONS,
      teamSize: 100,
      at: AT,
    });
    const merged = mergeIntoGraph(graph, result);

    expect(merged.size).toBeGreaterThanOrEqual(graph.size);
    expect(merged.nodesOfClass('TASK').length).toBeGreaterThanOrEqual(5_000);
  }, 60_000);
});
