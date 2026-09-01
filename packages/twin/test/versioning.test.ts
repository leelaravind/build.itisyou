/**
 * Versioning, baselines and calculation snapshots.
 *
 * Contract: gap-spec §8.4 — versioned records, an audit log, immutable baselines and calculation
 * snapshots, and explicitly **not** a copy of the database per version.
 *
 * The checksum tests are the ones that matter. A baseline is only evidence if it can be shown not to
 * have changed since it was taken, and a hash that depends on construction order rather than on
 * content proves nothing while looking exactly like one that does.
 */

import { describe, expect, it } from 'vitest';
import { TwinGraph } from '../src/graph.ts';
import { createNode, type NodeClass, type TwinNode } from '../src/nodes.ts';
import type { EdgeClass, TwinEdge } from '../src/edges.ts';
import {
  applyNodeChange,
  checksumOf,
  diffNode,
  isMaterialChange,
  isSnapshotStale,
  stableStringify,
  takeBaseline,
  verifyBaseline,
  type CalculationSnapshot,
} from '../src/versioning.ts';

const AT = '2026-03-01T09:00:00.000Z';
const LATER = '2026-03-02T09:00:00.000Z';
const PROJECT = 'p1';

function node(id: string, nodeClass: NodeClass = 'TASK', attributes: Record<string, unknown> = {}) {
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

function edge(from: string, to: string, edgeClass: EdgeClass = 'CONTAINS'): TwinEdge {
  return {
    id: `${from}->${edgeClass}->${to}`,
    projectId: PROJECT,
    class: edgeClass,
    from,
    to,
    createdAt: AT,
  };
}

const META = { version: 2, correlationId: 'c1', at: LATER };

describe('canonical serialisation', () => {
  it('is independent of key order', () => {
    // The property the whole checksum rests on. `JSON.stringify` preserves insertion order, so two
    // structurally identical objects would otherwise hash differently depending on how they were
    // built — which would make every baseline verification fail after an unrelated refactor.
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
  });

  it('is independent of key order at depth', () => {
    expect(stableStringify({ outer: { a: 1, b: { x: 1, y: 2 } } })).toBe(
      stableStringify({ outer: { b: { y: 2, x: 1 }, a: 1 } }),
    );
  });

  it('preserves array order', () => {
    // Arrays are ordered data. Sorting them would make [1,2] and [2,1] indistinguishable, which for a
    // dependency list or a phase sequence is a different plan.
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });

  it('handles null and undefined without throwing', () => {
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify({ a: undefined, b: 1 })).toBe('{"b":1}');
  });

  it('renders values JSON cannot represent as null rather than as the text "undefined"', () => {
    // `JSON.stringify` is typed as returning `string` and returns `undefined` for these. A checksum
    // computed over the literal text "undefined" would still be a valid-looking hash.
    expect(stableStringify(undefined)).toBe('null');
    expect(stableStringify(() => 1)).toBe('null');
    expect(stableStringify(Symbol('x'))).toBe('null');
  });

  it('distinguishes different values', () => {
    // Guards the guard: a serialiser that returned a constant would pass every test above.
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
  });
});

describe('node diffs', () => {
  it('reports nothing for an unchanged node', () => {
    const before = node('a');
    expect(isMaterialChange(before, { ...before })).toBe(false);
  });

  it('reports a changed label', () => {
    const before = node('a');
    const after = { ...before, label: 'renamed' };
    const diff = diffNode(before, after);

    expect(diff.before.label).toBe('a');
    expect(diff.after.label).toBe('renamed');
  });

  it('reports only the fields that changed', () => {
    // A diff that reported everything would bury the answer to "what changed" in a wall of
    // unchanged values, which is what the change log exists to avoid.
    const before = node('a', 'TASK', { effort: 3, owner: 'sam' });
    const after = { ...before, attributes: { effort: 5, owner: 'sam' } };

    expect(Object.keys(diffNode(before, after).after)).toEqual(['attributes.effort']);
  });

  it('reports an attribute that was added', () => {
    const before = node('a', 'TASK', {});
    const after = { ...before, attributes: { effort: 5 } };

    expect(diffNode(before, after).after).toHaveProperty('attributes.effort', 5);
  });

  it('reports an attribute that was removed', () => {
    const before = node('a', 'TASK', { effort: 5 });
    const after = { ...before, attributes: {} };

    expect(diffNode(before, after).before).toHaveProperty('attributes.effort', 5);
  });

  it('does not report a structurally identical object as a change', () => {
    // Reference equality would report every re-parsed object as changed, so every save would look
    // like an edit and every calculation snapshot would look stale.
    const before = node('a', 'TASK', { range: { low: 1, high: 3 } });
    const after = { ...before, attributes: { range: { high: 3, low: 1 } } };

    expect(isMaterialChange(before, after)).toBe(false);
  });

  it('reports a change of provenance', () => {
    // Promoting an assumption to a confirmed fact is one of the most significant changes that can
    // happen to a project, and the least visible if it is not logged.
    const before = node('a');
    const after: TwinNode = {
      ...before,
      provenance: { provenance: 'USER_CONFIRMED', confidence: 'HIGH' },
    };

    expect(isMaterialChange(before, after)).toBe(true);
  });
});

describe('applying a change', () => {
  it('increments the revision', () => {
    const result = applyNodeChange(node('a'), { label: 'renamed' }, META);
    expect(result.node.revision).toBe(2);
  });

  it('produces a change-log entry', () => {
    const result = applyNodeChange(node('a'), { label: 'renamed' }, META);

    expect(result.entry?.kind).toBe('NODE_UPDATED');
    expect(result.entry?.correlationId).toBe('c1');
    expect(result.entry?.version).toBe(2);
  });

  it('records the reason when one is given', () => {
    // A change log without reasons records that the project moved but not why — the half that
    // matters at a review.
    const result = applyNodeChange(node('a'), { label: 'renamed' }, { ...META, reason: 'CR-14' });
    expect(result.entry?.reason).toBe('CR-14');
  });

  it('logs nothing and bumps nothing for a no-op edit', () => {
    /*
     * More important than it looks.
     *
     * A revision bump on a no-op would make every calculation snapshot depending on this node look
     * stale, so an idle save would trigger a cascade of recomputation and a change log full of
     * entries where nothing happened.
     */
    const before = node('a');
    const result = applyNodeChange(before, { label: 'a' }, META);

    expect(result.entry).toBeUndefined();
    expect(result.node.revision).toBe(1);
    expect(result.node).toBe(before);
  });

  it('records supersession distinctly from an ordinary update', () => {
    const result = applyNodeChange(node('a'), { state: 'SUPERSEDED' }, META);
    expect(result.entry?.kind).toBe('NODE_SUPERSEDED');
  });

  it('refuses to edit a baseline', () => {
    expect(() => applyNodeChange(node('b', 'BASELINE'), { label: 'x' }, META)).toThrow(
      /cannot be edited/i,
    );
  });

  it('refuses to edit evidence', () => {
    expect(() => applyNodeChange(node('e', 'EVIDENCE'), { label: 'x' }, META)).toThrow(
      /cannot be edited/i,
    );
  });

  it('refuses to edit an approval', () => {
    expect(() => applyNodeChange(node('a', 'APPROVAL'), { label: 'x' }, META)).toThrow(
      /cannot be edited/i,
    );
  });
});

describe('baselines', () => {
  const graph = new TwinGraph({
    projectId: PROJECT,
    nodes: [node('p', 'PROJECT'), node('t', 'TASK', { effort: 3 })],
    edges: [edge('p', 't')],
  });

  const input = {
    id: 'b1',
    label: 'Agreed plan',
    version: 3,
    takenAt: LATER,
    correlationId: 'c1',
  };

  it('captures every node and edge', () => {
    const baseline = takeBaseline(graph, input);
    expect(baseline.nodes).toHaveLength(2);
    expect(baseline.edges).toHaveLength(1);
  });

  it('verifies against its own checksum', () => {
    expect(verifyBaseline(takeBaseline(graph, input))).toBe(true);
  });

  it('fails verification when a node is altered afterwards', () => {
    /*
     * The whole reason the checksum exists. A baseline that can be edited without detection is a
     * claim about the past rather than a record of it.
     */
    const baseline = takeBaseline(graph, input);
    const tampered = {
      ...baseline,
      nodes: baseline.nodes.map((n) => (n.id === 't' ? { ...n, label: 'edited' } : n)),
    };

    expect(verifyBaseline(tampered)).toBe(false);
  });

  it('fails verification when an edge is removed afterwards', () => {
    const baseline = takeBaseline(graph, input);
    expect(verifyBaseline({ ...baseline, edges: [] })).toBe(false);
  });

  it('fails verification when an attribute is altered afterwards', () => {
    const baseline = takeBaseline(graph, input);
    const tampered = {
      ...baseline,
      nodes: baseline.nodes.map((n) => (n.id === 't' ? { ...n, attributes: { effort: 99 } } : n)),
    };

    expect(verifyBaseline(tampered)).toBe(false);
  });

  it('hashes identical content identically regardless of node order', () => {
    // Two baselines of the same project state must hash the same, or the hash is a function of
    // construction order rather than of content.
    const reversed = new TwinGraph({
      projectId: PROJECT,
      nodes: [node('t', 'TASK', { effort: 3 }), node('p', 'PROJECT')],
      edges: [edge('p', 't')],
    });

    expect(takeBaseline(graph, input).checksum).toBe(takeBaseline(reversed, input).checksum);
  });

  it('ignores timestamps and revision counts', () => {
    /*
     * Deliberate. Two graphs with identical content saved at different moments are the same plan, and
     * a node edited twice back to its original value is — for "what did we commit to?" — unchanged.
     * A checksum that disagreed would make baselines useless for comparison.
     */
    const touched = new TwinGraph({
      projectId: PROJECT,
      nodes: [
        { ...node('p', 'PROJECT'), updatedAt: LATER, revision: 7 },
        { ...node('t', 'TASK', { effort: 3 }), updatedAt: LATER, revision: 4 },
      ],
      edges: [edge('p', 't')],
    });

    expect(takeBaseline(touched, input).checksum).toBe(takeBaseline(graph, input).checksum);
  });

  it('produces different checksums for different content', () => {
    // Guards the guard: a checksum that ignored too much would pass every test above.
    const different = new TwinGraph({
      projectId: PROJECT,
      nodes: [node('p', 'PROJECT'), node('t', 'TASK', { effort: 4 })],
      edges: [edge('p', 't')],
    });

    expect(takeBaseline(different, input).checksum).not.toBe(takeBaseline(graph, input).checksum);
  });

  it('produces a hex sha-256 digest', () => {
    expect(checksumOf([], [])).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('calculation snapshots', () => {
  const snapshot: CalculationSnapshot = {
    id: 's1',
    projectId: PROJECT,
    version: 2,
    calculation: 'budget.total',
    formulaVersion: '1.0.0',
    computedAt: AT,
    correlationId: 'c1',
    inputs: { rate: 500, days: 40 },
    result: { low: 18000, high: 24000 },
    dependsOn: ['t1', 't2'],
    assumptions: ['A day rate of £500 was assumed because none was recorded.'],
  };

  it('is stale when something it depended on changed', () => {
    expect(isSnapshotStale(snapshot, ['t2'])).toBe(true);
  });

  it('is not stale when unrelated nodes changed', () => {
    expect(isSnapshotStale(snapshot, ['t9'])).toBe(false);
  });

  it('is not stale when nothing changed', () => {
    expect(isSnapshotStale(snapshot, [])).toBe(false);
  });

  it('carries its assumptions with the number', () => {
    // Plan §12.3, no fake precision. A stored figure with its assumptions stripped carries an
    // authority it has not earned.
    expect(snapshot.assumptions.length).toBeGreaterThan(0);
  });

  it('records a range rather than a single figure', () => {
    expect(snapshot.result).toHaveProperty('low');
    expect(snapshot.result).toHaveProperty('high');
  });
});
