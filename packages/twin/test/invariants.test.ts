/**
 * Edge legality and graph invariants.
 *
 * Contract: gap-spec §8.3.
 *
 * The spec gives eight examples, and the two most quoted are here verbatim as tests — "task cannot
 * verify requirement" and "test may verify requirement" — because they are the pair that makes the
 * traceability matrix mean anything. Everything else is the general form of one of the eight.
 */

import { describe, expect, it } from 'vitest';
import { TwinGraph } from '../src/graph.ts';
import {
  createNode,
  canContain,
  isImmutableClass,
  NODE_CLASSES,
  type NodeClass,
  type TwinNode,
} from '../src/nodes.ts';
import {
  EDGE_CLASSES,
  checkEdgeLegality,
  isEdgeClass,
  type EdgeClass,
  type TwinEdge,
} from '../src/edges.ts';
import { checkInvariants, errorsOnly, INVARIANT_CODES } from '../src/invariants.ts';

const AT = '2026-03-01T09:00:00.000Z';
const PROJECT = 'p1';

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
    provenance: { provenance: 'USER_PROVIDED', confidence: 'HIGH' },
    attributes,
    at: AT,
  });
}

function edge(from: string, to: string, edgeClass: EdgeClass): TwinEdge {
  return {
    id: `${from}->${edgeClass}->${to}`,
    projectId: PROJECT,
    class: edgeClass,
    from,
    to,
    createdAt: AT,
  };
}

function graphOf(nodes: readonly TwinNode[], edges: readonly TwinEdge[] = []): TwinGraph {
  return new TwinGraph({ projectId: PROJECT, nodes, edges });
}

function codes(graph: TwinGraph, context = {}): string[] {
  return checkInvariants(graph, context).violations.map((v) => v.code);
}

/* -------------------------------------------------------------------------- */
/* The taxonomy itself                                                        */
/* -------------------------------------------------------------------------- */

describe('the taxonomy matches the contract', () => {
  it('declares the thirty-two node classes gap-spec §8.1 requires', () => {
    // The count is asserted because the list is long enough that a deletion during a refactor would
    // otherwise go unnoticed until something silently stopped being representable.
    expect(NODE_CLASSES).toHaveLength(32);
    expect(new Set(NODE_CLASSES).size).toBe(NODE_CLASSES.length);
  });

  it('declares the seventeen edge classes gap-spec §8.2 requires', () => {
    expect(EDGE_CLASSES).toHaveLength(17);
    expect(new Set(EDGE_CLASSES).size).toBe(EDGE_CLASSES.length);
  });

  it('rejects a class name that is not in the taxonomy', () => {
    expect(isEdgeClass('SORT_OF_RELATED')).toBe(false);
  });

  it('gives every edge class a legality rule', () => {
    // A class with no rule would be refused everywhere or permitted everywhere depending on how the
    // lookup was written; either way it would be silently useless.
    for (const edgeClass of EDGE_CLASSES) {
      const anyLegal = NODE_CLASSES.some((from) =>
        NODE_CLASSES.some((to) => checkEdgeLegality(edgeClass, from, to).ok),
      );
      expect(anyLegal, `${edgeClass} permits no pairing at all`).toBe(true);
    }
  });

  it('refuses far more pairings than it permits', () => {
    /*
     * Not a style preference — a measurement of whether the allowlist is doing anything.
     *
     * There are 32 × 32 × 17 = 17,408 possible pairings. A permissive matrix would make the graph
     * structurally meaningless while passing every specific test below, so this asserts the shape of
     * the whole matrix rather than any one rule.
     */
    let legal = 0;
    let total = 0;

    for (const edgeClass of EDGE_CLASSES) {
      for (const from of NODE_CLASSES) {
        for (const to of NODE_CLASSES) {
          total += 1;
          if (checkEdgeLegality(edgeClass, from, to).ok) legal += 1;
        }
      }
    }

    expect(total).toBeGreaterThan(10_000);
    expect(legal / total).toBeLessThan(0.05);
  });
});

/* -------------------------------------------------------------------------- */
/* The examples gap-spec §8.3 names                                           */
/* -------------------------------------------------------------------------- */

describe('the verification rules gap-spec §8.3 names explicitly', () => {
  it('a test may verify a requirement', () => {
    expect(checkEdgeLegality('VERIFIES', 'TEST', 'REQUIREMENT').ok).toBe(true);
  });

  it('a task cannot verify a requirement', () => {
    /*
     * The single most important rule in the file.
     *
     * If work could verify a requirement, the traceability matrix would report "verified" for
     * anything anyone had worked on — and a compliance report that is confidently wrong is worse than
     * no report, because it stops people looking.
     */
    const result = checkEdgeLegality('VERIFIES', 'TASK', 'REQUIREMENT');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('A task cannot verify anything.');
  });

  it('evidence may support a test, a gate and an approval', () => {
    expect(checkEdgeLegality('EVIDENCED_BY', 'TEST', 'EVIDENCE').ok).toBe(true);
    expect(checkEdgeLegality('EVIDENCED_BY', 'GATE', 'EVIDENCE').ok).toBe(true);
    expect(checkEdgeLegality('EVIDENCED_BY', 'APPROVAL', 'EVIDENCE').ok).toBe(true);
  });

  it('a baseline is immutable', () => {
    expect(isImmutableClass('BASELINE')).toBe(true);
  });

  it('a task cannot contain a phase', () => {
    // Inverting the hierarchy would make every roll-up compute the wrong direction.
    expect(canContain('TASK', 'PHASE')).toBe(false);
    expect(canContain('PHASE', 'EPIC')).toBe(true);
  });

  it('explains a refusal rather than only reporting one', () => {
    // Every refusal in this product has to be explainable to whoever hit it.
    const result = checkEdgeLegality('VERIFIES', 'TASK', 'REQUIREMENT');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.length).toBeGreaterThan(10);
      expect(result.reason).not.toMatch(/undefined|\[object/);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Whole-graph invariants                                                     */
/* -------------------------------------------------------------------------- */

describe('invariants over the whole graph', () => {
  it('accepts a well-formed graph', () => {
    const graph = graphOf(
      [node('p', 'PROJECT'), node('ph', 'PHASE'), node('g', 'GATE')],
      [edge('p', 'ph', 'CONTAINS'), edge('ph', 'g', 'CONTAINS'), edge('g', 'ph', 'VERIFIES')],
    );

    expect(errorsOnly(checkInvariants(graph))).toEqual([]);
  });

  it('rejects an illegal edge that individually passed no check', () => {
    const graph = graphOf(
      [node('p', 'PROJECT'), node('t', 'TASK'), node('r', 'REQUIREMENT')],
      [edge('p', 't', 'CONTAINS'), edge('p', 'r', 'CONTAINS'), edge('t', 'r', 'VERIFIES')],
    );

    expect(codes(graph)).toContain('ILLEGAL_EDGE');
  });

  it('rejects a node that contains itself', () => {
    const graph = graphOf([node('p', 'PROJECT')], [edge('p', 'p', 'CONTAINS')]);
    expect(codes(graph)).toContain('SELF_REFERENCE');
  });

  it('rejects a dependency cycle', () => {
    const graph = graphOf(
      [node('p', 'PROJECT'), node('a', 'TASK'), node('b', 'TASK')],
      [edge('a', 'b', 'DEPENDS_ON'), edge('b', 'a', 'DEPENDS_ON')],
    );

    expect(codes(graph)).toContain('CYCLE');
  });

  it('names the members of a cycle in the message', () => {
    const graph = graphOf(
      [node('first', 'TASK'), node('second', 'TASK')],
      [edge('first', 'second', 'DEPENDS_ON'), edge('second', 'first', 'DEPENDS_ON')],
    );

    const cycle = checkInvariants(graph).violations.find((v) => v.code === 'CYCLE');
    expect(cycle?.message).toContain('first');
    expect(cycle?.message).toContain('second');
  });

  it('does not report a self-loop twice', () => {
    // Once as a self-reference and once as a one-node cycle would put the same defect in the user's
    // list twice, which makes a list of real problems look like noise.
    const graph = graphOf([node('a', 'TASK')], [edge('a', 'a', 'DEPENDS_ON')]);
    const found = codes(graph);

    expect(found.filter((c) => c === 'CYCLE')).toHaveLength(0);
    expect(found).toContain('SELF_REFERENCE');
  });

  it('rejects a node contained by two parents', () => {
    // Double-counting in every roll-up, silently.
    const graph = graphOf(
      [node('p', 'PROJECT'), node('a', 'PHASE'), node('b', 'PHASE'), node('e', 'EPIC')],
      [
        edge('p', 'a', 'CONTAINS'),
        edge('p', 'b', 'CONTAINS'),
        edge('a', 'e', 'CONTAINS'),
        edge('b', 'e', 'CONTAINS'),
      ],
    );

    expect(codes(graph)).toContain('MULTIPLE_PARENTS');
  });

  it('rejects a node with two owners', () => {
    const graph = graphOf(
      [node('p', 'PROJECT'), node('t', 'TASK'), node('r1', 'RESOURCE'), node('r2', 'RESOURCE')],
      [edge('p', 't', 'CONTAINS'), edge('t', 'r1', 'OWNED_BY'), edge('t', 'r2', 'OWNED_BY')],
    );

    expect(codes(graph)).toContain('MULTIPLE_PARENTS');
  });

  it('warns about a requirement outside the project structure', () => {
    // Warning, not error: an orphan is usually work in progress. But invisible to every total, so it
    // must not be silent.
    const graph = graphOf([node('p', 'PROJECT'), node('r', 'REQUIREMENT')]);
    const report = checkInvariants(graph);

    expect(report.violations.map((v) => v.code)).toContain('ORPHANED_NODE');
    expect(report.valid).toBe(true);
  });

  it('rejects a node belonging to another project', () => {
    // Tenant isolation, asserted at the graph layer as well as the query layer.
    const foreign: TwinNode = { ...node('x', 'TASK'), projectId: 'someone-else' };
    expect(codes(graphOf([node('p', 'PROJECT'), foreign]))).toContain('CROSS_PROJECT_EDGE');
  });
});

describe('immutability', () => {
  it('refuses a change to a baseline', () => {
    const graph = graphOf([node('p', 'PROJECT'), node('b', 'BASELINE')]);
    expect(codes(graph, { changedNodeIds: ['b'] })).toContain('IMMUTABLE_NODE_CHANGED');
  });

  it('refuses a change to evidence', () => {
    const graph = graphOf([node('p', 'PROJECT'), node('e', 'EVIDENCE')]);
    expect(codes(graph, { changedNodeIds: ['e'] })).toContain('IMMUTABLE_NODE_CHANGED');
  });

  it('permits a change to an ordinary node', () => {
    const graph = graphOf([node('p', 'PROJECT'), node('t', 'TASK')]);
    expect(codes(graph, { changedNodeIds: ['t'] })).not.toContain('IMMUTABLE_NODE_CHANGED');
  });

  it('says what to do instead of editing', () => {
    // A refusal with no alternative is a dead end. Superseding is the supported path.
    const graph = graphOf([node('p', 'PROJECT'), node('b', 'BASELINE')]);
    const violation = checkInvariants(graph, { changedNodeIds: ['b'] }).violations.find(
      (v) => v.code === 'IMMUTABLE_NODE_CHANGED',
    );

    expect(violation?.message).toMatch(/supersede/i);
  });
});

describe('archived projects', () => {
  it('refuses a change while archived', () => {
    const graph = graphOf([node('p', 'PROJECT'), node('t', 'TASK')]);
    expect(codes(graph, { archived: true, changedNodeIds: ['t'] })).toContain(
      'ARCHIVED_PROJECT_MUTATED',
    );
  });

  it('permits reading an archived project', () => {
    // Read-only, not inaccessible. An archived project that could not be opened would make archival
    // equivalent to deletion.
    const graph = graphOf([node('p', 'PROJECT'), node('t', 'TASK')]);
    expect(codes(graph, { archived: true })).not.toContain('ARCHIVED_PROJECT_MUTATED');
  });

  it('names the items that could not be changed', () => {
    const graph = graphOf([node('p', 'PROJECT'), node('t', 'TASK')]);
    const violation = checkInvariants(graph, {
      archived: true,
      changedNodeIds: ['t'],
    }).violations.find((v) => v.code === 'ARCHIVED_PROJECT_MUTATED');

    expect(violation?.message).toContain('t');
  });
});

describe('gate staleness', () => {
  /*
   * Gap-spec §8.3: "a completed gate cannot silently change when source evidence changes; it becomes
   * stale/revalidation-required."
   *
   * The word doing the work is *silently*. Reopening the gate automatically would destroy the record
   * of what was concluded and when, and a compliance trail that rewrites itself is not a trail.
   */

  function gateGraph(result: string, invalidated: boolean): TwinGraph {
    const nodes = [
      node('p', 'PROJECT'),
      node('ph', 'PHASE'),
      node('g', 'GATE', { result }),
      node('cr', 'CHANGE_REQUEST'),
    ];
    const edges = [
      edge('p', 'ph', 'CONTAINS'),
      edge('ph', 'g', 'CONTAINS'),
      edge('p', 'cr', 'CONTAINS'),
      ...(invalidated ? [edge('cr', 'g', 'INVALIDATES')] : []),
    ];
    return graphOf(nodes, edges);
  }

  it('flags a passed gate whose basis has changed', () => {
    expect(codes(gateGraph('PASSED', true))).toContain('STALE_GATE');
  });

  it('leaves an untouched passed gate alone', () => {
    expect(codes(gateGraph('PASSED', false))).not.toContain('STALE_GATE');
  });

  it('does not flag a gate that never passed', () => {
    // A gate that has not been evaluated cannot become stale — there is no conclusion to invalidate.
    expect(codes(gateGraph('NOT_EVALUATED', true))).not.toContain('STALE_GATE');
  });

  it('does not silently change the gate’s own result', () => {
    // The behaviour the spec is actually asking for. The gate still says PASSED; what changed is that
    // the graph now says so is no longer safe to rely on.
    const graph = gateGraph('PASSED', true);
    expect(graph.node('g')?.attributes.result).toBe('PASSED');
    expect(codes(graph)).toContain('STALE_GATE');
  });

  it('names what invalidated it', () => {
    const violation = checkInvariants(gateGraph('PASSED', true)).violations.find(
      (v) => v.code === 'STALE_GATE',
    );
    expect(violation?.message).toContain('cr');
  });

  it('treats it as an error, not a warning', () => {
    // A gate reading "passed" on a basis that has moved is exactly the false assurance the product
    // exists to prevent.
    expect(checkInvariants(gateGraph('PASSED', true)).valid).toBe(false);
  });
});

describe('requirement verification coverage', () => {
  it('warns about a requirement nothing tests', () => {
    const graph = graphOf(
      [node('p', 'PROJECT'), node('r', 'REQUIREMENT')],
      [edge('p', 'r', 'CONTAINS')],
    );

    expect(codes(graph)).toContain('UNVERIFIED_REQUIREMENT');
  });

  it('is satisfied by a test, not by work', () => {
    // The same distinction as the legality rule, restated at the graph level: a requirement with a
    // task pointing at it is not verified.
    const verified = graphOf(
      [node('p', 'PROJECT'), node('r', 'REQUIREMENT'), node('t', 'TEST')],
      [edge('p', 'r', 'CONTAINS'), edge('t', 'r', 'VERIFIES')],
    );

    expect(codes(verified)).not.toContain('UNVERIFIED_REQUIREMENT');
  });

  it('does not block planning', () => {
    // Warning severity. Most of a project's life has unverified requirements, and erroring would make
    // the graph unusable until the last day.
    const graph = graphOf(
      [node('p', 'PROJECT'), node('r', 'REQUIREMENT')],
      [edge('p', 'r', 'CONTAINS')],
    );

    expect(checkInvariants(graph).valid).toBe(true);
  });
});

describe('the invariant catalogue', () => {
  it('has a distinct code for each check', () => {
    expect(new Set(INVARIANT_CODES).size).toBe(INVARIANT_CODES.length);
  });

  it('gives every violation a message a person could act on', () => {
    // A code with no message is a dead end for whoever hits it.
    const graph = graphOf(
      [node('p', 'PROJECT'), node('t', 'TASK'), node('r', 'REQUIREMENT'), node('b', 'BASELINE')],
      [edge('t', 'r', 'VERIFIES'), edge('t', 't', 'DEPENDS_ON')],
    );

    const report = checkInvariants(graph, { changedNodeIds: ['b'], archived: true });
    expect(report.violations.length).toBeGreaterThan(3);

    for (const violation of report.violations) {
      expect(violation.message.length, violation.code).toBeGreaterThan(10);
      expect(violation.nodeIds.length, violation.code).toBeGreaterThan(0);
    }
  });
});
