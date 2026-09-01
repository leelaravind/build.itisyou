/**
 * The project graph.
 *
 * Contract: gap-spec §8 — the Digital Twin is the canonical project graph, not a view over one.
 *
 * This is an in-memory structure built from persisted nodes and edges. It is deliberately not an ORM
 * relation: the algorithms below (cycle detection, ancestry, roll-up traversal) need the whole
 * neighbourhood, and issuing a query per hop turns an O(n) walk into an O(n) round-trip storm. A
 * project's graph is small — thousands of nodes, not millions — so loading it whole is both simpler
 * and faster than being clever.
 *
 * Everything here is pure. `TwinGraph` never touches a database, a clock or a random source, which is
 * what makes the Phase-6 gate — deterministic generation from a golden fixture — testable at all.
 */

import { AppError } from '@govintel/shared/errors';
import type { NodeClass, TwinNode } from './nodes.ts';
import type { EdgeClass, TwinEdge } from './edges.ts';

/** Append to a map of arrays, creating the array on first use. */
function push(index: Map<string, TwinEdge[]>, key: string, edge: TwinEdge): void {
  const existing = index.get(key);
  if (existing === undefined) index.set(key, [edge]);
  else existing.push(edge);
}

export interface GraphInput {
  readonly projectId: string;
  readonly nodes: readonly TwinNode[];
  readonly edges: readonly TwinEdge[];
}

/**
 * An immutable view of one project's graph.
 *
 * Adjacency is indexed on construction rather than computed per query. Every traversal in the product
 * — impact analysis, roll-ups, traceability — walks edges by class, and re-filtering the full edge
 * list for each hop was the obvious first implementation and the obvious wrong one.
 */
export class TwinGraph {
  readonly projectId: string;

  private readonly nodesById: ReadonlyMap<string, TwinNode>;
  private readonly outgoing: ReadonlyMap<string, readonly TwinEdge[]>;
  private readonly incoming: ReadonlyMap<string, readonly TwinEdge[]>;
  private readonly allEdges: readonly TwinEdge[];

  constructor(input: GraphInput) {
    this.projectId = input.projectId;

    const nodes = new Map<string, TwinNode>();
    for (const node of input.nodes) {
      if (nodes.has(node.id)) {
        throw new AppError({
          code: 'TWIN_DUPLICATE_NODE',
          category: 'CONFLICT',
          safeMessage: 'The project graph contains the same item twice.',
          details: { nodeId: node.id },
        });
      }
      nodes.set(node.id, node);
    }

    const out = new Map<string, TwinEdge[]>();
    const inn = new Map<string, TwinEdge[]>();

    for (const edge of input.edges) {
      // An edge to a node that is not in the graph is a dangling reference, and silently ignoring it
      // would mean a traversal quietly returns a shorter answer than the truth.
      if (!nodes.has(edge.from) || !nodes.has(edge.to)) {
        throw new AppError({
          code: 'TWIN_DANGLING_EDGE',
          category: 'VALIDATION',
          safeMessage: 'The project graph refers to an item that does not exist.',
          details: { edgeId: edge.id, from: edge.from, to: edge.to },
        });
      }

      push(out, edge.from, edge);
      push(inn, edge.to, edge);
    }

    this.nodesById = nodes;
    this.outgoing = out;
    this.incoming = inn;
    this.allEdges = input.edges;
  }

  /* ---------------------------------------------------------------------- */
  /* Access                                                                 */
  /* ---------------------------------------------------------------------- */

  get size(): number {
    return this.nodesById.size;
  }

  get edgeCount(): number {
    return this.allEdges.length;
  }

  node(id: string): TwinNode | undefined {
    return this.nodesById.get(id);
  }

  /** The node, or a domain error. For call sites where absence is a bug rather than a case. */
  requireNode(id: string): TwinNode {
    const node = this.nodesById.get(id);
    if (node === undefined) {
      throw new AppError({
        code: 'TWIN_NODE_NOT_FOUND',
        category: 'NOT_FOUND',
        safeMessage: 'That item is not part of this project.',
        details: { nodeId: id },
      });
    }
    return node;
  }

  /**
   * Every node of a class, in insertion order.
   *
   * Insertion order, not sorted — the generator produces nodes in a deterministic order and callers
   * depend on that. Sorting here would hide a generator that had become non-deterministic.
   */
  nodesOfClass(nodeClass: NodeClass): readonly TwinNode[] {
    return [...this.nodesById.values()].filter((n) => n.class === nodeClass);
  }

  get nodes(): readonly TwinNode[] {
    return [...this.nodesById.values()];
  }

  get edges(): readonly TwinEdge[] {
    return this.allEdges;
  }

  edgesFrom(id: string, edgeClass?: EdgeClass): readonly TwinEdge[] {
    const all = this.outgoing.get(id) ?? [];
    return edgeClass === undefined ? all : all.filter((e) => e.class === edgeClass);
  }

  edgesTo(id: string, edgeClass?: EdgeClass): readonly TwinEdge[] {
    const all = this.incoming.get(id) ?? [];
    return edgeClass === undefined ? all : all.filter((e) => e.class === edgeClass);
  }

  /* ---------------------------------------------------------------------- */
  /* Hierarchy                                                              */
  /* ---------------------------------------------------------------------- */

  /** The node that contains this one, if any. */
  parent(id: string): TwinNode | undefined {
    const edge = this.edgesTo(id, 'CONTAINS')[0];
    return edge === undefined ? undefined : this.nodesById.get(edge.from);
  }

  children(id: string): readonly TwinNode[] {
    return this.edgesFrom(id, 'CONTAINS')
      .map((e) => this.nodesById.get(e.to))
      .filter((n): n is TwinNode => n !== undefined);
  }

  /**
   * Every ancestor, nearest first.
   *
   * Iterative and visited-guarded. A recursive walk would overflow on a deep hierarchy, and — more
   * importantly — would not terminate at all on a containment cycle. Invariants refuse such a graph,
   * but this function has to survive being called on one, because the code that *reports* the cycle
   * needs to walk it.
   */
  ancestors(id: string): readonly TwinNode[] {
    const out: TwinNode[] = [];
    const seen = new Set<string>([id]);
    let current = this.parent(id);

    while (current !== undefined && !seen.has(current.id)) {
      out.push(current);
      seen.add(current.id);
      current = this.parent(current.id);
    }

    return out;
  }

  /** Every descendant, breadth first. Same termination argument as `ancestors`. */
  descendants(id: string): readonly TwinNode[] {
    const out: TwinNode[] = [];
    const seen = new Set<string>([id]);
    const queue: string[] = [id];

    while (queue.length > 0) {
      const next = queue.shift();
      if (next === undefined) break;

      for (const child of this.children(next)) {
        if (seen.has(child.id)) continue;
        seen.add(child.id);
        out.push(child);
        queue.push(child.id);
      }
    }

    return out;
  }

  /** The root of the containment tree this node belongs to. */
  root(id: string): TwinNode {
    const chain = this.ancestors(id);
    return chain[chain.length - 1] ?? this.requireNode(id);
  }

  /* ---------------------------------------------------------------------- */
  /* Cycles                                                                 */
  /* ---------------------------------------------------------------------- */

  /**
   * Every cycle in the subgraph of one edge class.
   *
   * Iterative depth-first search with an explicit stack. Recursion is the textbook implementation and
   * the wrong one here: cycle detection runs on user-supplied and AI-supplied structures, so the
   * depth is attacker-controlled and a stack overflow is a denial of service rather than a bug
   * report. The same reasoning produced the iterative `findCycles` in the interchange validator.
   *
   * Returns the node ids of each cycle found, each starting at the node where the back edge closed,
   * so a caller can render "A depends on B depends on A" rather than "there is a cycle somewhere".
   */
  findCycles(edgeClass: EdgeClass): readonly (readonly string[])[] {
    const cycles: string[][] = [];
    const colour = new Map<string, 'GREY' | 'BLACK'>();

    for (const start of this.nodesById.keys()) {
      if (colour.get(start) === 'BLACK') continue;

      // `path` is the current DFS chain; `frame` tracks how far through each node's successors we are.
      const path: string[] = [];
      const onPath = new Set<string>();
      const stack: { node: string; next: number }[] = [{ node: start, next: 0 }];

      colour.set(start, 'GREY');
      path.push(start);
      onPath.add(start);

      while (stack.length > 0) {
        const frame = stack[stack.length - 1];
        if (frame === undefined) break;

        const successors = this.edgesFrom(frame.node, edgeClass);

        if (frame.next >= successors.length) {
          colour.set(frame.node, 'BLACK');
          onPath.delete(frame.node);
          path.pop();
          stack.pop();
          continue;
        }

        const edge = successors[frame.next];
        frame.next += 1;
        if (edge === undefined) continue;

        const target = edge.to;

        if (onPath.has(target)) {
          // Back edge: the cycle is the tail of the current path from `target` onwards.
          const at = path.indexOf(target);
          if (at !== -1) cycles.push(path.slice(at));
          continue;
        }

        if (colour.get(target) === 'BLACK') continue;

        colour.set(target, 'GREY');
        path.push(target);
        onPath.add(target);
        stack.push({ node: target, next: 0 });
      }
    }

    return cycles;
  }

  /**
   * Nodes reachable from a starting node along one edge class.
   *
   * The primitive under change-impact analysis (Phase 14): "what does changing this touch?" is a
   * reachability question over `IMPACTS` and `DEPENDS_ON`.
   */
  reachable(from: string, edgeClass: EdgeClass): readonly string[] {
    const seen = new Set<string>();
    const queue = [from];

    while (queue.length > 0) {
      const next = queue.shift();
      if (next === undefined) break;

      for (const edge of this.edgesFrom(next, edgeClass)) {
        if (seen.has(edge.to)) continue;
        seen.add(edge.to);
        queue.push(edge.to);
      }
    }

    return [...seen];
  }

  /**
   * A topological ordering over one edge class, or the cycles that prevent one.
   *
   * Kahn's algorithm, with ties broken by node id so the result is **deterministic**. Without that
   * tie-break the ordering would depend on map iteration order, and a plan whose phase sequence
   * changes between two runs over identical input is exactly what the Phase-6 gate exists to catch.
   */
  topologicalOrder(
    edgeClass: EdgeClass,
  ):
    | { readonly ok: true; readonly order: readonly string[] }
    | { readonly ok: false; readonly cycles: readonly (readonly string[])[] } {
    const indegree = new Map<string, number>();
    for (const id of this.nodesById.keys()) indegree.set(id, 0);

    for (const edge of this.allEdges) {
      if (edge.class !== edgeClass) continue;
      indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    }

    const ready = [...indegree.entries()]
      .filter(([, degree]) => degree === 0)
      .map(([id]) => id)
      .sort();

    const order: string[] = [];

    while (ready.length > 0) {
      const id = ready.shift();
      if (id === undefined) break;
      order.push(id);

      const unlocked: string[] = [];
      for (const edge of this.edgesFrom(id, edgeClass)) {
        const remaining = (indegree.get(edge.to) ?? 0) - 1;
        indegree.set(edge.to, remaining);
        if (remaining === 0) unlocked.push(edge.to);
      }

      // Re-sorted rather than appended, so the ordering does not depend on discovery order.
      ready.push(...unlocked);
      ready.sort();
    }

    if (order.length !== this.nodesById.size) {
      return { ok: false, cycles: this.findCycles(edgeClass) };
    }

    return { ok: true, order };
  }
}
