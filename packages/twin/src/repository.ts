/**
 * Loading and saving the project graph.
 *
 * The seam between the pure graph (`graph.ts`, `generate.ts`, `invariants.ts` — no clock, no
 * database, no randomness) and the rows that hold it. Everything database-shaped lives here, so the
 * algorithms stay testable without a Postgres instance and the persistence stays testable without
 * reimplementing the algorithms.
 *
 * Two rules this module exists to enforce:
 *
 * **Nothing is written that fails its invariants.** `saveGraph` checks before it writes. A graph
 * with a dependency cycle stored and then reported later is a graph some other request has already
 * read and planned against.
 *
 * **The whole graph is written or none of it is.** A partial write leaves the project in a state no
 * invariant would have permitted — edges pointing at nodes that were never inserted, a hierarchy
 * missing its middle. There is no useful "half a plan".
 */

import { AppError } from '@govintel/shared/errors';
import { TwinGraph } from './graph.ts';
import type { NodeClass, NodeProvenance, TwinNode } from './nodes.ts';
import { isNodeClass } from './nodes.ts';
import type { EdgeClass, TwinEdge } from './edges.ts';
import { isEdgeClass } from './edges.ts';
import { checkInvariants, errorsOnly, type Violation } from './invariants.ts';

/* -------------------------------------------------------------------------- */
/* Row shapes                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The columns this module reads and writes.
 *
 * Declared structurally rather than imported from `@govintel/db`. The twin package deliberately does
 * not depend on the database package: the graph is a domain concept, and making it import Drizzle
 * would mean every consumer of the taxonomy — including the documentation generator — pulled a
 * database driver in with it.
 */
export interface NodeRow {
  readonly id: string;
  readonly organizationId: string | null;
  readonly projectId: string;
  readonly class: string;
  readonly label: string;
  readonly description: string | null;
  readonly state: string;
  readonly provenance: string;
  readonly confidence: string;
  readonly sourceRef: string | null;
  readonly revision: number;
  readonly attributes: Record<string, unknown>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface EdgeRow {
  readonly id: string;
  readonly organizationId: string | null;
  readonly projectId: string;
  readonly class: string;
  readonly fromId: string;
  readonly toId: string;
  readonly rationale: string | null;
  readonly createdAt: Date;
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Build a graph from stored rows.
 *
 * Rows carry `text` columns for `class`, `provenance` and `state`, so the values are strings as far
 * as the type system is concerned. They are narrowed here rather than cast: a row whose class is not
 * in the taxonomy is corruption — from a migration, a direct write, or a version skew — and casting
 * it would push the failure into whichever traversal happened to touch it first, with no indication
 * of where it came from.
 */
export function graphFromRows(
  projectId: string,
  nodeRows: readonly NodeRow[],
  edgeRows: readonly EdgeRow[],
): TwinGraph {
  const nodes = nodeRows.map((row) => toNode(row));
  const edges = edgeRows.map((row) => toEdge(row));

  return new TwinGraph({ projectId, nodes, edges });
}

/** Records, not plan: what a baseline leaves out of the graph it captures. */
const RECORD_CLASSES: readonly string[] = ['EVIDENCE', 'APPROVAL'];

/**
 * The plan alone, without evidence and approval records: the graph a baseline captures.
 *
 * Dropping those nodes has to drop every edge that touches them too. Filtering the nodes and keeping
 * the edges leaves a test's `EVIDENCED_BY` edge pointing at a node that is no longer in the graph,
 * and `TwinGraph` refuses a dangling edge — so a project with linked evidence could neither view nor
 * record a baseline (FR-019, found by the §63 large fixture on staging).
 */
export function planGraphFromRows(
  projectId: string,
  nodeRows: readonly NodeRow[],
  edgeRows: readonly EdgeRow[],
): TwinGraph {
  const kept = nodeRows.filter((row) => !RECORD_CLASSES.includes(row.class));
  const ids = new Set(kept.map((row) => row.id));

  return graphFromRows(
    projectId,
    kept,
    edgeRows.filter((row) => ids.has(row.fromId) && ids.has(row.toId)),
  );
}

function toNode(row: NodeRow): TwinNode {
  if (!isNodeClass(row.class)) {
    throw corrupt('node', row.id, `unrecognised class "${row.class}"`);
  }

  if (row.state !== 'ACTIVE' && row.state !== 'SUPERSEDED' && row.state !== 'WITHDRAWN') {
    throw corrupt('node', row.id, `unrecognised state "${row.state}"`);
  }

  return {
    id: row.id,
    projectId: row.projectId,
    class: row.class satisfies NodeClass,
    label: row.label,
    ...(row.description === null ? {} : { description: row.description }),
    state: row.state,
    provenance: toProvenance(row),
    revision: row.revision,
    attributes: row.attributes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const PROVENANCE_CLASSES = new Set([
  'USER_CONFIRMED',
  'DETERMINISTIC_CALCULATION',
  'USER_PROVIDED',
  'EXTERNAL_SOURCE',
  'ASSUMPTION',
  'EXTERNAL_AI_INFERENCE',
  'FUTURE_ML_PREDICTION',
]);

function toProvenance(row: NodeRow): NodeProvenance {
  if (!PROVENANCE_CLASSES.has(row.provenance)) {
    // Provenance is what every explanation and every trust comparison rests on. A node whose
    // provenance cannot be interpreted must not be silently downgraded to a default — a plausible
    // default is exactly how an inference would come to be treated as a confirmed fact.
    throw corrupt('node', row.id, `unrecognised provenance "${row.provenance}"`);
  }

  if (row.confidence !== 'LOW' && row.confidence !== 'MEDIUM' && row.confidence !== 'HIGH') {
    throw corrupt('node', row.id, `unrecognised confidence "${row.confidence}"`);
  }

  return {
    provenance: row.provenance as NodeProvenance['provenance'],
    confidence: row.confidence,
    ...(row.sourceRef === null ? {} : { sourceRef: row.sourceRef }),
  };
}

function toEdge(row: EdgeRow): TwinEdge {
  if (!isEdgeClass(row.class)) {
    throw corrupt('edge', row.id, `unrecognised class "${row.class}"`);
  }

  return {
    id: row.id,
    projectId: row.projectId,
    class: row.class satisfies EdgeClass,
    from: row.fromId,
    to: row.toId,
    ...(row.rationale === null ? {} : { rationale: row.rationale }),
    createdAt: row.createdAt.toISOString(),
  };
}

function corrupt(kind: 'node' | 'edge', id: string, detail: string): AppError {
  return new AppError({
    code: 'TWIN_CORRUPT_ROW',
    category: 'INTERNAL',
    safeMessage: 'Part of this project could not be read. It has been recorded for investigation.',
    details: { kind, id, detail },
  });
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                    */
/* -------------------------------------------------------------------------- */

export interface WritableRows {
  readonly nodes: readonly Omit<NodeRow, 'createdAt' | 'updatedAt'>[];
  readonly edges: readonly Omit<EdgeRow, 'createdAt'>[];
}

/**
 * Turn a graph into rows, refusing to produce any if it would not be valid.
 *
 * Returns rows rather than executing statements: the transaction belongs to the caller, which owns
 * the connection and knows what else is in the same unit of work. This module having its own
 * transaction would mean two nested ones on a single-connection database.
 */
export function rowsFromGraph(
  graph: TwinGraph,
  organizationId: string | null,
  context: { readonly archived?: boolean } = {},
): WritableRows {
  /*
   * Writing the whole graph *is* changing every node in it.
   *
   * `checkArchived` only fires when it is told what changed, so passing the archived flag alone let
   * a write to an archived project through — the check was present and inert, which is the same
   * shape of defect as SEC-001. A full write is a change to everything, and saying so is what makes
   * the archived rule apply here at all.
   */
  const report = checkInvariants(graph, {
    ...context,
    ...(context.archived === true ? { changedNodeIds: graph.nodes.map((n) => n.id) } : {}),
  });
  const errors = errorsOnly(report);

  if (errors.length > 0) {
    throw invalidGraph(errors);
  }

  return {
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      organizationId,
      projectId: node.projectId,
      class: node.class,
      label: node.label,
      description: node.description ?? null,
      state: node.state,
      provenance: node.provenance.provenance,
      confidence: node.provenance.confidence,
      sourceRef: node.provenance.sourceRef ?? null,
      revision: node.revision,
      attributes: node.attributes,
    })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      organizationId,
      projectId: edge.projectId,
      class: edge.class,
      fromId: edge.from,
      toId: edge.to,
      rationale: edge.rationale ?? null,
    })),
  };
}

/**
 * The error a caller gets when a graph would not be valid.
 *
 * Carries every violation, not the first. Someone fixing a generated plan needs the whole list —
 * returning one at a time turns a single review into as many round trips as there are problems.
 */
function invalidGraph(errors: readonly Violation[]): AppError {
  return new AppError({
    code: 'TWIN_INVALID_GRAPH',
    category: 'VALIDATION',
    safeMessage:
      errors.length === 1
        ? (errors[0]?.message ?? 'This project structure is not valid.')
        : `This project structure has ${String(errors.length)} problems that must be resolved first.`,
    details: {
      violations: errors.map((v) => ({ code: v.code, message: v.message, nodeIds: v.nodeIds })),
    },
  });
}

/**
 * Whether a graph could be saved, without attempting it.
 *
 * For the preview surfaces: showing "this plan has three problems" before the user commits is better
 * than letting them press save and reading an error.
 */
export function canSave(graph: TwinGraph, context: { readonly archived?: boolean } = {}): boolean {
  // Must answer exactly the question `rowsFromGraph` will, including the archived case — a preview
  // that says "saveable" and a save that refuses is worse than no preview.
  try {
    rowsFromGraph(graph, null, context);
    return true;
  } catch {
    return false;
  }
}
