/**
 * The graph structure and its algorithms.
 *
 * The traversals here are read by every calculation in the product, so their failure modes are not
 * "a wrong answer on screen" — they are wrong budgets, wrong schedules and traceability matrices with
 * silent gaps. Most of these tests are about termination and ordering rather than about results,
 * because those are what break under real data rather than under a fixture.
 */

import { describe, expect, it } from 'vitest';
import { TwinGraph } from '../src/graph.ts';
import { createNode, type NodeClass, type TwinNode } from '../src/nodes.ts';
import type { EdgeClass, TwinEdge } from '../src/edges.ts';

const AT = '2026-03-01T09:00:00.000Z';
const PROJECT = 'p1';

function node(id: string, nodeClass: NodeClass = 'TASK'): TwinNode {
  return createNode({
    id,
    projectId: PROJECT,
    class: nodeClass,
    label: id,
    provenance: { provenance: 'USER_PROVIDED', confidence: 'HIGH' },
    at: AT,
  });
}

function edge(from: string, to: string, edgeClass: EdgeClass = 'DEPENDS_ON'): TwinEdge {
  return {
    id: `${from}->${edgeClass}->${to}`,
    projectId: PROJECT,
    class: edgeClass,
    from,
    to,
    createdAt: AT,
  };
}

function graphOf(nodes: readonly TwinNode[], edges: readonly TwinEdge[]): TwinGraph {
  return new TwinGraph({ projectId: PROJECT, nodes, edges });
}

describe('construction', () => {
  it('rejects a duplicate node id', () => {
    // Two nodes with one id means one of them is unreachable, and which one depends on insertion
    // order. Silently keeping the last would make the graph depend on the order rows came back.
    expect(() => graphOf([node('a'), node('a')], [])).toThrow(/twice/i);
  });

  it('rejects an edge pointing at a node that is not in the graph', () => {
    // A dangling edge makes every traversal quietly return a shorter answer than the truth.
    expect(() => graphOf([node('a')], [edge('a', 'ghost')])).toThrow(/does not exist/i);
  });

  it('rejects an edge originating from a node that is not in the graph', () => {
    expect(() => graphOf([node('a')], [edge('ghost', 'a')])).toThrow(/does not exist/i);
  });

  it('accepts an empty graph', () => {
    const graph = graphOf([], []);
    expect(graph.size).toBe(0);
    expect(graph.edgeCount).toBe(0);
  });
});

describe('hierarchy', () => {
  const nodes = [
    node('project', 'PROJECT'),
    node('phase', 'PHASE'),
    node('epic', 'EPIC'),
    node('task', 'TASK'),
    node('subtask', 'SUBTASK'),
  ];
  const edges = [
    edge('project', 'phase', 'CONTAINS'),
    edge('phase', 'epic', 'CONTAINS'),
    edge('epic', 'task', 'CONTAINS'),
    edge('task', 'subtask', 'CONTAINS'),
  ];
  const graph = graphOf(nodes, edges);

  it('finds a node’s parent', () => {
    expect(graph.parent('task')?.id).toBe('epic');
  });

  it('reports no parent for the root', () => {
    expect(graph.parent('project')).toBeUndefined();
  });

  it('lists ancestors nearest first', () => {
    expect(graph.ancestors('subtask').map((n) => n.id)).toEqual([
      'task',
      'epic',
      'phase',
      'project',
    ]);
  });

  it('lists descendants breadth first', () => {
    expect(graph.descendants('project').map((n) => n.id)).toEqual([
      'phase',
      'epic',
      'task',
      'subtask',
    ]);
  });

  it('finds the root of a deep chain', () => {
    expect(graph.root('subtask').id).toBe('project');
  });

  it('treats an unparented node as its own root', () => {
    expect(graphOf([node('lonely')], []).root('lonely').id).toBe('lonely');
  });
});

describe('termination on malformed graphs', () => {
  /*
   * These are the tests that matter.
   *
   * Invariants refuse a cyclic containment graph — but the code that *reports* the cycle has to walk
   * it first, so every traversal must terminate on input the invariants would reject. A recursive
   * implementation passes every test above and hangs on the two below.
   */

  it('ancestors terminates on a containment cycle', () => {
    const graph = graphOf(
      [node('a'), node('b')],
      [edge('a', 'b', 'CONTAINS'), edge('b', 'a', 'CONTAINS')],
    );

    expect(graph.ancestors('a').map((n) => n.id)).toEqual(['b']);
  });

  it('descendants terminates on a containment cycle', () => {
    const graph = graphOf(
      [node('a'), node('b'), node('c')],
      [edge('a', 'b', 'CONTAINS'), edge('b', 'c', 'CONTAINS'), edge('c', 'a', 'CONTAINS')],
    );

    expect(
      graph
        .descendants('a')
        .map((n) => n.id)
        .sort(),
    ).toEqual(['b', 'c']);
  });

  it('root terminates on a self-containing node', () => {
    const graph = graphOf([node('a')], [edge('a', 'a', 'CONTAINS')]);
    expect(graph.root('a').id).toBe('a');
  });

  it('cycle detection survives a chain deep enough to overflow a recursive walk', () => {
    // 20,000 nodes. A recursive DFS overflows the stack well before this, and the depth is
    // user-supplied in every real scenario — an imported plan, a generated decomposition — so this is
    // a denial-of-service surface rather than a theoretical limit.
    const count = 20_000;
    const nodes = Array.from({ length: count }, (_, i) => node(`n${String(i)}`));
    const edges = Array.from({ length: count - 1 }, (_, i) =>
      edge(`n${String(i)}`, `n${String(i + 1)}`),
    );

    const graph = graphOf(nodes, edges);
    expect(graph.findCycles('DEPENDS_ON')).toEqual([]);
  });

  it('detects a cycle at the end of a very deep chain', () => {
    // The harder case: the chain is fine until the last edge closes it. A depth-limited implementation
    // would report no cycle, which is worse than crashing.
    const count = 5_000;
    const nodes = Array.from({ length: count }, (_, i) => node(`n${String(i)}`));
    const edges = [
      ...Array.from({ length: count - 1 }, (_, i) => edge(`n${String(i)}`, `n${String(i + 1)}`)),
      edge(`n${String(count - 1)}`, 'n0'),
    ];

    expect(graphOf(nodes, edges).findCycles('DEPENDS_ON').length).toBeGreaterThan(0);
  });
});

describe('cycle detection', () => {
  it('finds no cycle in a chain', () => {
    const graph = graphOf([node('a'), node('b'), node('c')], [edge('a', 'b'), edge('b', 'c')]);
    expect(graph.findCycles('DEPENDS_ON')).toEqual([]);
  });

  it('finds no cycle in a diamond', () => {
    // Two paths to the same node is not a cycle. A naive "have I seen this node" check reports one,
    // which would refuse a large fraction of perfectly ordinary plans.
    const graph = graphOf(
      [node('a'), node('b'), node('c'), node('d')],
      [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')],
    );

    expect(graph.findCycles('DEPENDS_ON')).toEqual([]);
  });

  it('finds a two-node cycle', () => {
    const graph = graphOf([node('a'), node('b')], [edge('a', 'b'), edge('b', 'a')]);
    const cycles = graph.findCycles('DEPENDS_ON');

    expect(cycles).toHaveLength(1);
    expect([...(cycles[0] ?? [])].sort()).toEqual(['a', 'b']);
  });

  it('finds a self-loop', () => {
    expect(graphOf([node('a')], [edge('a', 'a')]).findCycles('DEPENDS_ON')).toEqual([['a']]);
  });

  it('reports the cycle members so they can be shown to the user', () => {
    // "There is a cycle somewhere" is not actionable. The member list is what lets the UI draw it.
    const graph = graphOf(
      [node('a'), node('b'), node('c')],
      [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')],
    );

    const cycle = graph.findCycles('DEPENDS_ON')[0] ?? [];
    expect([...cycle].sort()).toEqual(['a', 'b', 'c']);
  });

  it('ignores cycles in other edge classes', () => {
    // A `BLOCKS` cycle is a real problem, but it is not a dependency cycle, and reporting it as one
    // sends the user looking at the wrong relationship.
    const graph = graphOf(
      [node('a'), node('b')],
      [edge('a', 'b', 'BLOCKS'), edge('b', 'a', 'BLOCKS')],
    );

    expect(graph.findCycles('DEPENDS_ON')).toEqual([]);
    expect(graph.findCycles('BLOCKS')).toHaveLength(1);
  });
});

describe('topological ordering', () => {
  it('orders a chain', () => {
    const graph = graphOf([node('a'), node('b'), node('c')], [edge('a', 'b'), edge('b', 'c')]);
    const result = graph.topologicalOrder('DEPENDS_ON');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.order).toEqual(['a', 'b', 'c']);
  });

  it('is deterministic when several nodes are ready at once', () => {
    /*
     * The property the whole Phase-6 gate depends on.
     *
     * With no edges every node is immediately ready, so the ordering is decided entirely by the
     * tie-break. Without an explicit sort this returns map-insertion order, which is stable enough to
     * pass a two-run test and not stable enough to be a guarantee.
     */
    const nodes = ['delta', 'alpha', 'charlie', 'bravo'].map((id) => node(id));
    const result = graphOf(nodes, []).topologicalOrder('DEPENDS_ON');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.order).toEqual(['alpha', 'bravo', 'charlie', 'delta']);
  });

  it('reports the cycles instead of an ordering when one exists', () => {
    const graph = graphOf([node('a'), node('b')], [edge('a', 'b'), edge('b', 'a')]);
    const result = graph.topologicalOrder('DEPENDS_ON');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.cycles.length).toBeGreaterThan(0);
  });

  it('includes nodes with no edges at all', () => {
    // An isolated node still has to appear, or every consumer that iterates the ordering silently
    // skips it.
    const graph = graphOf([node('a'), node('b'), node('island')], [edge('a', 'b')]);
    const result = graph.topologicalOrder('DEPENDS_ON');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.order).toContain('island');
  });
});

describe('reachability', () => {
  const graph = graphOf(
    [node('a'), node('b'), node('c'), node('d')],
    [edge('a', 'b'), edge('b', 'c')],
  );

  it('finds everything downstream', () => {
    expect([...graph.reachable('a', 'DEPENDS_ON')].sort()).toEqual(['b', 'c']);
  });

  it('does not include the starting node', () => {
    expect(graph.reachable('a', 'DEPENDS_ON')).not.toContain('a');
  });

  it('finds nothing from a leaf', () => {
    expect(graph.reachable('d', 'DEPENDS_ON')).toEqual([]);
  });

  it('terminates on a cycle', () => {
    const cyclic = graphOf([node('a'), node('b')], [edge('a', 'b'), edge('b', 'a')]);
    expect([...cyclic.reachable('a', 'DEPENDS_ON')].sort()).toEqual(['a', 'b']);
  });
});

describe('lookup', () => {
  const graph = graphOf([node('a', 'TASK'), node('b', 'RISK')], []);

  it('returns undefined for an unknown node', () => {
    expect(graph.node('nope')).toBeUndefined();
  });

  it('throws a not-found error when a node is required', () => {
    expect(() => graph.requireNode('nope')).toThrow(/not part of this project/i);
  });

  it('filters by class', () => {
    expect(graph.nodesOfClass('RISK').map((n) => n.id)).toEqual(['b']);
  });

  it('filters edges by class', () => {
    const withEdges = graphOf(
      [node('a'), node('b')],
      [edge('a', 'b', 'DEPENDS_ON'), edge('a', 'b', 'BLOCKS')],
    );

    expect(withEdges.edgesFrom('a', 'BLOCKS')).toHaveLength(1);
    expect(withEdges.edgesFrom('a')).toHaveLength(2);
  });
});
