/**
 * Graph invariants.
 *
 * Contract: gap-spec §8.3 gives eight examples and calls them examples — the list below is wider,
 * because each one there implies a family rather than a single case.
 *
 * The distinction that shapes this file: an invariant is checked against the **whole graph**, not at
 * the point of a single mutation. Edge legality can be decided from two node classes and is checked
 * when an edge is created (`checkEdgeLegality`). Acyclicity, single parentage and gate staleness
 * cannot: each is a property of the graph as a whole, and each can be broken by an edge that was
 * individually legal. So both checks exist, and neither replaces the other.
 *
 * Violations are returned, never thrown. A project with a dependency cycle is a project that needs
 * showing to its owner with the cycle drawn out, not an exception three layers up with the cause
 * discarded.
 */

import type { TwinGraph } from './graph.ts';
import type { NodeClass, TwinNode } from './nodes.ts';
import { isImmutableClass } from './nodes.ts';
import type { EdgeClass } from './edges.ts';
import {
  ACYCLIC_EDGES,
  EDGE_CLASSES,
  IRREFLEXIVE_EDGES,
  SINGLE_PARENT_EDGES,
  checkEdgeLegality,
  describe,
  describeEdge,
  describeEdgeAsNoun,
} from './edges.ts';

/* -------------------------------------------------------------------------- */
/* Result types                                                               */
/* -------------------------------------------------------------------------- */

export const INVARIANT_CODES = [
  'ILLEGAL_EDGE',
  'SELF_REFERENCE',
  'CYCLE',
  'MULTIPLE_PARENTS',
  'ORPHANED_NODE',
  'IMMUTABLE_NODE_CHANGED',
  'ARCHIVED_PROJECT_MUTATED',
  'STALE_GATE',
  'UNVERIFIED_REQUIREMENT',
  'CROSS_PROJECT_EDGE',
] as const;

export type InvariantCode = (typeof INVARIANT_CODES)[number];

export type Severity = 'ERROR' | 'WARNING';

export interface Violation {
  readonly code: InvariantCode;
  readonly severity: Severity;
  /** Written for the project owner, not for a log. */
  readonly message: string;
  readonly nodeIds: readonly string[];
  readonly edgeClass?: EdgeClass;
}

export interface InvariantReport {
  readonly violations: readonly Violation[];
  /** No ERROR-severity violations. Warnings do not block; they are shown. */
  readonly valid: boolean;
}

/* -------------------------------------------------------------------------- */
/* The check                                                                  */
/* -------------------------------------------------------------------------- */

export interface InvariantContext {
  /**
   * Whether the project is archived.
   *
   * Gap-spec §8.3: an archived project is read-only except for permitted restoration. Passed in
   * rather than read from a node attribute, because archival is a property of the project record and
   * duplicating it into the graph would create two answers to the same question.
   */
  readonly archived?: boolean;

  /**
   * Node ids whose content changed in the mutation being checked.
   *
   * Only meaningful when validating a proposed change. Empty means "check the graph as it stands",
   * which is what generation and periodic validation do.
   */
  readonly changedNodeIds?: readonly string[];
}

export function checkInvariants(graph: TwinGraph, context: InvariantContext = {}): InvariantReport {
  const violations: Violation[] = [
    ...checkTenancy(graph),
    ...checkEdgeLegalityAcrossGraph(graph),
    ...checkSelfReferences(graph),
    ...checkAcyclicity(graph),
    ...checkSingleParent(graph),
    ...checkOrphans(graph),
    ...checkImmutability(graph, context),
    ...checkArchived(graph, context),
    ...checkGateStaleness(graph),
    ...checkRequirementVerification(graph),
  ];

  return {
    violations,
    valid: !violations.some((v) => v.severity === 'ERROR'),
  };
}

/* -------------------------------------------------------------------------- */
/* Individual invariants                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Every node and edge belongs to the graph's project.
 *
 * The tenancy layer already scopes queries, and this is the same argument as row-level security:
 * a control that only exists at the query layer is one refactor away from not existing. A node from
 * another project inside this graph is a tenant-isolation failure, not a data-quality one.
 */
function checkTenancy(graph: TwinGraph): Violation[] {
  const wrong = graph.nodes.filter((n) => n.projectId !== graph.projectId);

  if (wrong.length === 0) return [];

  return [
    {
      code: 'CROSS_PROJECT_EDGE',
      severity: 'ERROR',
      message: 'The project graph contains items belonging to a different project.',
      nodeIds: wrong.map((n) => n.id),
    },
  ];
}

function checkEdgeLegalityAcrossGraph(graph: TwinGraph): Violation[] {
  const violations: Violation[] = [];

  for (const edge of graph.edges) {
    const from = graph.node(edge.from);
    const to = graph.node(edge.to);
    if (from === undefined || to === undefined) continue; // The constructor already refused these.

    const result = checkEdgeLegality(edge.class, from.class, to.class);
    if (!result.ok) {
      violations.push({
        code: 'ILLEGAL_EDGE',
        severity: 'ERROR',
        message: result.reason,
        nodeIds: [edge.from, edge.to],
        edgeClass: edge.class,
      });
    }
  }

  return violations;
}

/** Gap-spec §8.3: parent hierarchy cannot contain self. Generalised to every relation. */
function checkSelfReferences(graph: TwinGraph): Violation[] {
  const violations: Violation[] = [];

  for (const edge of graph.edges) {
    if (edge.from !== edge.to) continue;
    if (!IRREFLEXIVE_EDGES.includes(edge.class)) continue;

    const node = graph.node(edge.from);
    violations.push({
      code: 'SELF_REFERENCE',
      severity: 'ERROR',
      message: `“${node?.label ?? edge.from}” is set to ${describeEdge(edge.class)} itself, which cannot be true.`,
      nodeIds: [edge.from],
      edgeClass: edge.class,
    });
  }

  return violations;
}

/** Gap-spec §8.3: dependency cycles must be detected. */
function checkAcyclicity(graph: TwinGraph): Violation[] {
  const violations: Violation[] = [];

  for (const edgeClass of ACYCLIC_EDGES) {
    for (const cycle of graph.findCycles(edgeClass)) {
      // Self-loops are reported by `checkSelfReferences` with a clearer message; reporting them here
      // as well would mean the same defect appears twice in the owner's list.
      if (cycle.length < 2) continue;

      const labels = cycle.map((id) => graph.node(id)?.label ?? id);
      violations.push({
        code: 'CYCLE',
        severity: 'ERROR',
        message: `Circular ${describeEdgeAsNoun(edgeClass)}: ${labels.join(' → ')} → ${labels[0] ?? ''}.`,
        nodeIds: cycle,
        edgeClass,
      });
    }
  }

  return violations;
}

/** One parent, one owner. See `SINGLE_PARENT_EDGES` for why. */
function checkSingleParent(graph: TwinGraph): Violation[] {
  const violations: Violation[] = [];

  for (const edgeClass of SINGLE_PARENT_EDGES) {
    // `CONTAINS` and `OWNED_BY` point in opposite directions: a container points at what it holds,
    // whereas an owned thing points at its owner. So "how many parents" is an incoming count for one
    // and an outgoing count for the other.
    const incoming = edgeClass === 'CONTAINS';

    for (const node of graph.nodes) {
      const edges = incoming
        ? graph.edgesTo(node.id, edgeClass)
        : graph.edgesFrom(node.id, edgeClass);

      if (edges.length <= 1) continue;

      violations.push({
        code: 'MULTIPLE_PARENTS',
        severity: 'ERROR',
        message: incoming
          ? `“${node.label}” is contained by ${String(edges.length)} different items. Roll-up totals would count it more than once.`
          : `“${node.label}” has ${String(edges.length)} owners. Accountability has to rest with one.`,
        nodeIds: [node.id, ...edges.map((e) => (incoming ? e.from : e.to))],
        edgeClass,
      });
    }
  }

  return violations;
}

/**
 * Classes that must sit inside the containment tree.
 *
 * A requirement floating outside the project is invisible to every roll-up and every report — the
 * worst kind of missing, because nothing shows an absence. Warning rather than error: an orphan is
 * usually work in progress rather than corruption, and blocking generation on it would make the
 * graph harder to build incrementally.
 */
const MUST_BE_CONTAINED: readonly NodeClass[] = [
  'OBJECTIVE',
  'REQUIREMENT',
  'PHASE',
  'WORKSTREAM',
  'MILESTONE',
  'EPIC',
  'TASK',
  'SUBTASK',
  'CHECKPOINT',
  'RISK',
  'BUDGET_ITEM',
  'GATE',
] as const;

function checkOrphans(graph: TwinGraph): Violation[] {
  const violations: Violation[] = [];

  for (const node of graph.nodes) {
    if (!MUST_BE_CONTAINED.includes(node.class)) continue;
    if (graph.parent(node.id) !== undefined) continue;

    violations.push({
      code: 'ORPHANED_NODE',
      severity: 'WARNING',
      message: `“${node.label}” (${describe(node.class)}) is not part of the project structure, so it will not appear in any total.`,
      nodeIds: [node.id],
    });
  }

  return violations;
}

/** Gap-spec §8.3: a baseline is immutable. Extended to evidence and approvals. */
function checkImmutability(graph: TwinGraph, context: InvariantContext): Violation[] {
  const changed = context.changedNodeIds ?? [];
  if (changed.length === 0) return [];

  const violations: Violation[] = [];

  for (const id of changed) {
    const node = graph.node(id);
    if (node === undefined) continue;
    if (!isImmutableClass(node.class)) continue;

    violations.push({
      code: 'IMMUTABLE_NODE_CHANGED',
      severity: 'ERROR',
      message: `“${node.label}” is a ${describe(node.class)} and records what was true when it was created. It cannot be edited — supersede it instead.`,
      nodeIds: [id],
    });
  }

  return violations;
}

/** Gap-spec §8.3: an archived project is read-only except for permitted restoration. */
function checkArchived(graph: TwinGraph, context: InvariantContext): Violation[] {
  if (context.archived !== true) return [];

  const changed = context.changedNodeIds ?? [];
  if (changed.length === 0) return [];

  // Named, not counted. "3 items cannot be changed" gives the reader nothing to act on; the labels
  // tell them which edit to undo.
  const labels = changed.map((id) => graph.node(id)?.label ?? id);

  return [
    {
      code: 'ARCHIVED_PROJECT_MUTATED',
      severity: 'ERROR',
      message: `This project is archived and cannot be changed (${labels.join(', ')}). Restore it first.`,
      nodeIds: [...changed],
    },
  ];
}

/**
 * Gap-spec §8.3, the subtlest of the eight.
 *
 * "A completed gate cannot silently change when source evidence changes; it becomes
 * stale/revalidation-required."
 *
 * The key word is *silently*. The wrong implementation is to reopen the gate automatically, because
 * that destroys the record of what was concluded and when — and a compliance trail that rewrites
 * itself is not a trail. The right one is to leave the gate alone and surface that its basis moved,
 * which is what an `INVALIDATES` edge into a passed gate means.
 *
 * Reported as an ERROR: a gate whose evidence has been invalidated but which still reads "passed" is
 * precisely the false assurance the whole product exists to avoid.
 */
function checkGateStaleness(graph: TwinGraph): Violation[] {
  const violations: Violation[] = [];

  for (const gate of graph.nodesOfClass('GATE')) {
    if (!isPassed(gate)) continue;

    const invalidators = graph.edgesTo(gate.id, 'INVALIDATES');
    if (invalidators.length === 0) continue;

    const causes = invalidators.map((e) => graph.node(e.from)?.label ?? e.from);

    violations.push({
      code: 'STALE_GATE',
      severity: 'ERROR',
      message: `“${gate.label}” passed, but what it was based on has since changed (${causes.join(', ')}). It needs revalidating before it can be relied on.`,
      nodeIds: [gate.id, ...invalidators.map((e) => e.from)],
      edgeClass: 'INVALIDATES',
    });
  }

  return violations;
}

/** A gate's own recorded result. Attribute-level rather than typed; see the note in `nodes.ts`. */
function isPassed(node: TwinNode): boolean {
  return node.attributes.result === 'PASSED';
}

/**
 * A requirement with no test verifying it.
 *
 * Warning, not error: an unverified requirement is normal for most of a project's life, and blocking
 * on it would make the graph unusable during planning. It becomes an error at the release gate in
 * Phase 12, where "we never tested it" is a genuine blocker rather than a state of progress.
 *
 * Worth surfacing early precisely because it is easy to reach a release with a traceability matrix
 * full of gaps that nobody looked at until the day it mattered.
 */
function checkRequirementVerification(graph: TwinGraph): Violation[] {
  const violations: Violation[] = [];

  for (const requirement of graph.nodesOfClass('REQUIREMENT')) {
    const verifiers = graph
      .edgesTo(requirement.id, 'VERIFIES')
      .filter((e) => graph.node(e.from)?.class === 'TEST');

    if (verifiers.length > 0) continue;

    violations.push({
      code: 'UNVERIFIED_REQUIREMENT',
      severity: 'WARNING',
      message: `Nothing tests “${requirement.label}”. Work towards a requirement is not evidence that it is met.`,
      nodeIds: [requirement.id],
    });
  }

  return violations;
}

/* -------------------------------------------------------------------------- */
/* Convenience                                                                */
/* -------------------------------------------------------------------------- */

export function errorsOnly(report: InvariantReport): readonly Violation[] {
  return report.violations.filter((v) => v.severity === 'ERROR');
}

/** Every edge class, for tests and documentation generation that must cover all of them. */
export const ALL_EDGE_CLASSES: readonly EdgeClass[] = EDGE_CLASSES;
