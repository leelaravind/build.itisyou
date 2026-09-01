/**
 * The seam between stored rows and the graph.
 *
 * Two properties are being defended here, and both are about refusing rather than coping.
 *
 * A row whose class or provenance is not in the taxonomy is **corruption**, not a variant. Coercing
 * it to a default would push the failure into whichever traversal touched it first, with nothing
 * pointing back at the row — and a provenance silently defaulted is exactly how an AI inference
 * comes to be treated as a confirmed fact.
 *
 * A graph that fails its invariants is **not written at all**. Storing it and reporting the problem
 * afterwards means some other request has already read and planned against it.
 */

import { describe, expect, it } from 'vitest';
import { TwinGraph } from '../src/graph.ts';
import { createNode, type NodeClass, type TwinNode } from '../src/nodes.ts';
import type { EdgeClass, TwinEdge } from '../src/edges.ts';
import {
  canSave,
  graphFromRows,
  rowsFromGraph,
  type EdgeRow,
  type NodeRow,
} from '../src/repository.ts';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const ORG = '22222222-2222-4222-8222-222222222222';
const AT = new Date('2026-03-01T09:00:00.000Z');

function nodeRow(overrides: Partial<NodeRow> = {}): NodeRow {
  return {
    id: 'n1',
    organizationId: ORG,
    projectId: PROJECT,
    class: 'TASK',
    label: 'A task',
    description: null,
    state: 'ACTIVE',
    provenance: 'USER_PROVIDED',
    confidence: 'HIGH',
    sourceRef: null,
    revision: 1,
    attributes: {},
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

function edgeRow(overrides: Partial<EdgeRow> = {}): EdgeRow {
  return {
    id: 'e1',
    organizationId: ORG,
    projectId: PROJECT,
    class: 'DEPENDS_ON',
    fromId: 'n1',
    toId: 'n2',
    rationale: null,
    createdAt: AT,
    ...overrides,
  };
}

function node(id: string, nodeClass: NodeClass = 'TASK'): TwinNode {
  return createNode({
    id,
    projectId: PROJECT,
    class: nodeClass,
    label: id,
    provenance: { provenance: 'USER_PROVIDED', confidence: 'HIGH' },
    at: AT.toISOString(),
  });
}

function edge(from: string, to: string, edgeClass: EdgeClass): TwinEdge {
  return {
    id: `${from}->${edgeClass}->${to}`,
    projectId: PROJECT,
    class: edgeClass,
    from,
    to,
    createdAt: AT.toISOString(),
  };
}

describe('reading rows into a graph', () => {
  it('builds a graph from valid rows', () => {
    const graph = graphFromRows(PROJECT, [nodeRow(), nodeRow({ id: 'n2' })], [edgeRow()]);

    expect(graph.size).toBe(2);
    expect(graph.edgeCount).toBe(1);
  });

  it('converts timestamps to ISO strings', () => {
    // The domain model uses strings so it can be compared, hashed and serialised without a timezone
    // question at every boundary. Dates come out of the driver; they do not go into the graph.
    const graph = graphFromRows(PROJECT, [nodeRow()], []);
    expect(graph.node('n1')?.createdAt).toBe('2026-03-01T09:00:00.000Z');
  });

  it('maps a null description to an absent property', () => {
    // Not to an empty string. `description === undefined` and `description === ''` mean different
    // things — one is "nobody wrote one", the other is "someone deliberately cleared it".
    const graph = graphFromRows(PROJECT, [nodeRow({ description: null })], []);
    expect(graph.node('n1')).not.toHaveProperty('description');
  });

  it('preserves a description that is present', () => {
    const graph = graphFromRows(PROJECT, [nodeRow({ description: 'why' })], []);
    expect(graph.node('n1')?.description).toBe('why');
  });

  it('refuses a node class outside the taxonomy', () => {
    expect(() => graphFromRows(PROJECT, [nodeRow({ class: 'SPREADSHEET' })], [])).toThrow(
      /could not be read/i,
    );
  });

  it('refuses an edge class outside the taxonomy', () => {
    expect(() =>
      graphFromRows(
        PROJECT,
        [nodeRow(), nodeRow({ id: 'n2' })],
        [edgeRow({ class: 'RELATES_TO' })],
      ),
    ).toThrow(/could not be read/i);
  });

  it('refuses a provenance class outside the taxonomy rather than defaulting it', () => {
    /*
     * The most consequential refusal in this file.
     *
     * Every explanation and every trust comparison reads provenance. Defaulting an unrecognised
     * value — to `ASSUMPTION`, say, or to `USER_PROVIDED` — would be indistinguishable from the node
     * genuinely having that provenance, and it is precisely how an inference comes to be presented
     * as something the user confirmed.
     */
    expect(() => graphFromRows(PROJECT, [nodeRow({ provenance: 'PROBABLY_TRUE' })], [])).toThrow(
      /could not be read/i,
    );
  });

  it('refuses a confidence level outside the taxonomy', () => {
    expect(() => graphFromRows(PROJECT, [nodeRow({ confidence: 'CERTAIN' })], [])).toThrow(
      /could not be read/i,
    );
  });

  it('refuses a node state outside the taxonomy', () => {
    expect(() => graphFromRows(PROJECT, [nodeRow({ state: 'DRAFT' })], [])).toThrow(
      /could not be read/i,
    );
  });

  it('does not leak the offending value into the user-facing message', () => {
    // A row's contents are unknown-provenance data, and the safe message is rendered into a page.
    // The detail is on the error for the log, not in the sentence the user sees.
    try {
      graphFromRows(PROJECT, [nodeRow({ class: '<script>alert(1)</script>' })], []);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as Error).message).not.toContain('script');
    }
  });

  it('records the offending row for investigation', () => {
    // The inverse: the operator needs to know *which* row and *why*, or the error is unactionable.
    try {
      graphFromRows(PROJECT, [nodeRow({ id: 'the-bad-one', class: 'NOPE' })], []);
      expect.unreachable('should have thrown');
    } catch (error) {
      const details = (error as { details?: Record<string, unknown> }).details ?? {};
      expect(details.id).toBe('the-bad-one');
      expect(String(details.detail)).toContain('NOPE');
    }
  });

  it('accepts an empty project', () => {
    // A project with no graph yet is normal, not an error.
    expect(graphFromRows(PROJECT, [], []).size).toBe(0);
  });
});

describe('writing a graph to rows', () => {
  const valid = new TwinGraph({
    projectId: PROJECT,
    nodes: [node('p', 'PROJECT'), node('ph', 'PHASE')],
    edges: [edge('p', 'ph', 'CONTAINS')],
  });

  it('produces one row per node and per edge', () => {
    const rows = rowsFromGraph(valid, ORG);
    expect(rows.nodes).toHaveLength(2);
    expect(rows.edges).toHaveLength(1);
  });

  it('flattens provenance into its columns', () => {
    const rows = rowsFromGraph(valid, ORG);
    expect(rows.nodes[0]).toMatchObject({ provenance: 'USER_PROVIDED', confidence: 'HIGH' });
  });

  it('maps an absent description to null', () => {
    expect(rowsFromGraph(valid, ORG).nodes[0]?.description).toBeNull();
  });

  it('carries the organisation onto every row', () => {
    // Row-level security keys off it. A node with a null organisation in a tenanted project would be
    // invisible to every tenant-scoped query, including the one that was supposed to find it.
    const rows = rowsFromGraph(valid, ORG);
    expect(rows.nodes.every((n) => n.organizationId === ORG)).toBe(true);
    expect(rows.edges.every((e) => e.organizationId === ORG)).toBe(true);
  });

  it('permits a null organisation for a guest project', () => {
    // Guest-first: a project with no organisation is the normal case before sign-up.
    expect(rowsFromGraph(valid, null).nodes.every((n) => n.organizationId === null)).toBe(true);
  });

  it('refuses to produce rows for a graph with a cycle', () => {
    const cyclic = new TwinGraph({
      projectId: PROJECT,
      nodes: [node('a'), node('b')],
      edges: [edge('a', 'b', 'DEPENDS_ON'), edge('b', 'a', 'DEPENDS_ON')],
    });

    expect(() => rowsFromGraph(cyclic, ORG)).toThrow();
  });

  it('refuses to produce rows for a graph with an illegal edge', () => {
    const illegal = new TwinGraph({
      projectId: PROJECT,
      nodes: [node('t', 'TASK'), node('r', 'REQUIREMENT')],
      edges: [edge('t', 'r', 'VERIFIES')],
    });

    expect(() => rowsFromGraph(illegal, ORG)).toThrow();
  });

  it('reports every problem, not just the first', () => {
    /*
     * Returning one at a time turns a single review into as many round trips as there are problems,
     * which for a generated plan is how a user gives up.
     */
    const broken = new TwinGraph({
      projectId: PROJECT,
      nodes: [node('t', 'TASK'), node('r', 'REQUIREMENT'), node('a'), node('b')],
      edges: [
        edge('t', 'r', 'VERIFIES'),
        edge('a', 'b', 'DEPENDS_ON'),
        edge('b', 'a', 'DEPENDS_ON'),
      ],
    });

    try {
      rowsFromGraph(broken, ORG);
      expect.unreachable('should have thrown');
    } catch (error) {
      const details = (error as { details?: { violations?: unknown[] } }).details ?? {};
      expect((details.violations ?? []).length).toBeGreaterThan(1);
    }
  });

  it('states the single problem plainly when there is only one', () => {
    // "This structure has 1 problem" is worse than saying what it is.
    const cyclic = new TwinGraph({
      projectId: PROJECT,
      nodes: [node('a'), node('b')],
      edges: [edge('a', 'b', 'DEPENDS_ON'), edge('b', 'a', 'DEPENDS_ON')],
    });

    expect(() => rowsFromGraph(cyclic, ORG)).toThrow(/circular/i);
  });

  it('refuses to write to an archived project', () => {
    /*
     * This test previously asserted the opposite of its own name and passed, because
     * `rowsFromGraph` forwarded the archived flag without saying what had changed — and the archived
     * check only fires when it is told. The check was present and inert.
     *
     * Writing the whole graph is a change to every node in it. Gap-spec §8.3: an archived project is
     * read-only except for permitted restoration.
     */
    expect(() => rowsFromGraph(valid, ORG, { archived: true })).toThrow(/archived/i);
  });

  it('still permits writing to a project that is not archived', () => {
    // The inverse. A check that refused everything would pass the test above.
    expect(() => rowsFromGraph(valid, ORG, { archived: false })).not.toThrow();
  });

  it('is not blocked by warnings', () => {
    // An unverified requirement is a warning. Blocking the save would make it impossible to record a
    // requirement before writing a test for it, which is the normal order of work.
    const warned = new TwinGraph({
      projectId: PROJECT,
      nodes: [node('p', 'PROJECT'), node('r', 'REQUIREMENT')],
      edges: [edge('p', 'r', 'CONTAINS')],
    });

    expect(() => rowsFromGraph(warned, ORG)).not.toThrow();
  });
});

describe('checking before saving', () => {
  it('reports a valid graph as saveable', () => {
    const graph = new TwinGraph({
      projectId: PROJECT,
      nodes: [node('p', 'PROJECT'), node('ph', 'PHASE')],
      edges: [edge('p', 'ph', 'CONTAINS')],
    });

    expect(canSave(graph)).toBe(true);
  });

  it('reports an archived project as not saveable', () => {
    // `canSave` and `rowsFromGraph` must agree. A preview that says "saveable" followed by a save
    // that refuses is worse than showing nothing.
    const graph = new TwinGraph({
      projectId: PROJECT,
      nodes: [node('p', 'PROJECT'), node('ph', 'PHASE')],
      edges: [edge('p', 'ph', 'CONTAINS')],
    });

    expect(canSave(graph, { archived: true })).toBe(false);
  });

  it('reports an invalid graph as not saveable', () => {
    const graph = new TwinGraph({
      projectId: PROJECT,
      nodes: [node('a'), node('b')],
      edges: [edge('a', 'b', 'DEPENDS_ON'), edge('b', 'a', 'DEPENDS_ON')],
    });

    expect(canSave(graph)).toBe(false);
  });
});

describe('a round trip', () => {
  it('preserves the graph through rows and back', () => {
    /*
     * The property that matters most, and the one no individual test above establishes: everything
     * the domain model holds survives being flattened into columns. A field silently dropped here
     * would be invisible until something read it back and found nothing.
     */
    const original = new TwinGraph({
      projectId: PROJECT,
      nodes: [
        {
          ...node('p', 'PROJECT'),
          description: 'A project',
          revision: 4,
          state: 'ACTIVE',
          attributes: { projectType: 'SAAS_WEB_APP', nested: { low: 1, high: 3 } },
          provenance: {
            provenance: 'DETERMINISTIC_CALCULATION',
            confidence: 'MEDIUM',
            sourceRef: 'generator:1.0.0',
          },
        },
        node('ph', 'PHASE'),
      ],
      edges: [{ ...edge('p', 'ph', 'CONTAINS'), rationale: 'Because the type demands it.' }],
    });

    const rows = rowsFromGraph(original, ORG);

    const restored = graphFromRows(
      PROJECT,
      rows.nodes.map((n) => ({ ...n, createdAt: AT, updatedAt: AT })),
      rows.edges.map((e) => ({ ...e, createdAt: AT })),
    );

    const before = original.node('p');
    const after = restored.node('p');

    expect(after?.label).toBe(before?.label);
    expect(after?.description).toBe(before?.description);
    expect(after?.revision).toBe(before?.revision);
    expect(after?.state).toBe(before?.state);
    expect(after?.attributes).toEqual(before?.attributes);
    expect(after?.provenance).toEqual(before?.provenance);

    expect(restored.edgesFrom('p', 'CONTAINS')[0]?.rationale).toBe('Because the type demands it.');
  });
});
