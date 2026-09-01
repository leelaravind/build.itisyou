/**
 * The node classes of the Project Digital Twin.
 *
 * Contract: gap-spec §8.1 lists thirty-two node types as the *minimum*. Plan §6 makes the Digital
 * Twin the canonical project graph rather than a dashboard concept — which is the distinction that
 * matters here. A dashboard can afford a loose schema because nothing depends on it. This is the
 * thing every calculation, gate and document reads from, so a node that means two different things
 * in two places is a defect that propagates everywhere.
 *
 * Three decisions worth stating, because they shape everything downstream:
 *
 * **The taxonomy is closed.** `NODE_CLASSES` is exhaustive and `as const`, so an unrecognised class
 * is a compile error rather than a row that silently never matches a rule. New classes are a
 * deliberate schema change with a version bump, not an ad-hoc insert.
 *
 * **Nodes carry provenance, not just data.** Every node records where it came from and how confident
 * the platform is in it, using the same trust ordering as intake (`@govintel/shared/provenance`). A
 * graph that cannot distinguish "the user told us" from "an AI guessed" cannot honestly explain any
 * number computed from it.
 *
 * **Identity is stable; content is versioned.** A node's `id` never changes. Gap-spec §8.4 is
 * explicit that versioning must not copy the whole database, so history lives in snapshots and the
 * audit log rather than in duplicated node rows. See `versioning.ts`.
 */

import type { ProvenanceClass } from '@govintel/shared/provenance';

/* -------------------------------------------------------------------------- */
/* The taxonomy                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Every node class, in the order gap-spec §8.1 lists them.
 *
 * The order is preserved deliberately: it is the order the contract was written in, and keeping it
 * makes the two documents diffable by eye. `docs/PROJECT_DIGITAL_TWIN_SCHEMA.md` is generated from
 * this array, so the documentation cannot drift from the code.
 */
export const NODE_CLASSES = [
  'PROJECT',
  'OBJECTIVE',
  'REQUIREMENT',
  'ARCHITECTURE_COMPONENT',
  'ARCHITECTURE_DECISION',
  'PHASE',
  'WORKSTREAM',
  'MILESTONE',
  'EPIC',
  'TASK',
  'SUBTASK',
  'CHECKPOINT',
  'RESOURCE',
  'BUDGET_ITEM',
  'ESTIMATE',
  'RISK',
  'BLOCKER',
  'TEST',
  'EVIDENCE',
  'GATE',
  'APPROVAL',
  'DOCUMENT',
  'DEPLOYMENT',
  'ENVIRONMENT',
  'INCIDENT',
  'OPERATIONAL_TASK',
  'ASSUMPTION',
  'UNKNOWN',
  'CHANGE_REQUEST',
  'BASELINE',
  'SCENARIO',
  'FORECAST',
] as const;

export type NodeClass = (typeof NODE_CLASSES)[number];

const NODE_CLASS_SET: ReadonlySet<string> = new Set<string>(NODE_CLASSES);

export function isNodeClass(value: string): value is NodeClass {
  return NODE_CLASS_SET.has(value);
}

/* -------------------------------------------------------------------------- */
/* Grouping                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Which node classes may contain which others.
 *
 * The `contains` edge is the project's hierarchy, and it is the one relationship where an arbitrary
 * pairing produces nonsense rather than merely an odd graph — a task containing a phase inverts the
 * whole structure. Declared here rather than in `edges.ts` because containment is a property of what
 * a node *is*, not of the edge that happens to express it.
 *
 * A class absent from this map contains nothing. That is the safe default: a containment rule that
 * was never considered should refuse, not permit.
 */
export const CONTAINMENT: Readonly<Partial<Record<NodeClass, readonly NodeClass[]>>> = {
  PROJECT: [
    'OBJECTIVE',
    'REQUIREMENT',
    'ARCHITECTURE_COMPONENT',
    'ARCHITECTURE_DECISION',
    'PHASE',
    'WORKSTREAM',
    'MILESTONE',
    'RESOURCE',
    'BUDGET_ITEM',
    'RISK',
    'BLOCKER',
    'GATE',
    'DOCUMENT',
    'ENVIRONMENT',
    'ASSUMPTION',
    'UNKNOWN',
    'CHANGE_REQUEST',
    'BASELINE',
    'SCENARIO',
    'FORECAST',
    'INCIDENT',
    'OPERATIONAL_TASK',
  ],
  PHASE: ['MILESTONE', 'EPIC', 'CHECKPOINT', 'GATE'],
  WORKSTREAM: ['EPIC', 'TASK'],
  EPIC: ['TASK'],
  TASK: ['SUBTASK'],
  MILESTONE: ['CHECKPOINT'],
  REQUIREMENT: ['REQUIREMENT'],
  BUDGET_ITEM: ['BUDGET_ITEM'],
  ARCHITECTURE_COMPONENT: ['ARCHITECTURE_COMPONENT'],
  SCENARIO: ['FORECAST'],
} as const;

/**
 * Classes whose content cannot change once written.
 *
 * Gap-spec §8.3: a baseline is immutable. Evidence and approvals are here for the same reason an
 * audit trail is append-only — a record of what was true at a moment stops being a record the moment
 * it can be edited afterwards. Enforced in `invariants.ts` and, for the persisted graph, by the
 * database.
 */
export const IMMUTABLE_CLASSES: readonly NodeClass[] = [
  'BASELINE',
  'EVIDENCE',
  'APPROVAL',
] as const;

/**
 * Classes that represent something the platform does not know.
 *
 * Kept as first-class nodes rather than as absent rows. An unknown that is simply missing from the
 * graph is indistinguishable from an unknown nobody thought to ask about, and the missing-information
 * engine (plan §10) depends on telling those apart.
 */
export const UNCERTAINTY_CLASSES: readonly NodeClass[] = ['ASSUMPTION', 'UNKNOWN'] as const;

/* -------------------------------------------------------------------------- */
/* The node record                                                            */
/* -------------------------------------------------------------------------- */

/** Where a node's content came from, in the platform's terms. */
export interface NodeProvenance {
  readonly provenance: ProvenanceClass;
  readonly confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  /**
   * The import, intake field, calculation or rule that produced this node.
   *
   * Free-form by design: it is a pointer for a human reading an explanation, not something the
   * engine dereferences. Making it a foreign key would mean a node could not outlive its source,
   * and the whole point of provenance is that it survives.
   */
  readonly sourceRef?: string;
}

/**
 * One node in the graph.
 *
 * `attributes` is deliberately open. The alternative — a discriminated union with thirty-three
 * distinct shapes — was considered and rejected: the class-specific fields are still being
 * discovered phase by phase, and locking them now would mean either guessing or churning the type on
 * every subsequent phase. What *is* locked is everything the graph algorithms and invariants read,
 * which is everything above `attributes`.
 *
 * The trade is explicit: attribute typing lives in the per-class schemas that arrive with the
 * features that need them (rules in Phase 7, decomposition in Phase 8), validated at the edge rather
 * than assumed in the middle.
 */
export interface TwinNode {
  readonly id: string;
  readonly projectId: string;
  readonly class: NodeClass;

  /** Human-facing name. Always present, because a node nobody can identify is not usable evidence. */
  readonly label: string;
  readonly description?: string;

  /**
   * Lifecycle-independent status of this node.
   *
   * Not the project lifecycle (Phase 7) and not a gate result — this is whether the node itself is
   * live, superseded or withdrawn. A superseded node is retained: the graph records what was
   * believed, not only what is believed now.
   */
  readonly state: NodeState;

  readonly provenance: NodeProvenance;

  /** Monotonic per node. Incremented on every material change; see `versioning.ts`. */
  readonly revision: number;

  /** Class-specific data. See the note above on why this is not statically typed per class. */
  readonly attributes: Readonly<Record<string, unknown>>;

  readonly createdAt: string;
  readonly updatedAt: string;
}

export const NODE_STATES = ['ACTIVE', 'SUPERSEDED', 'WITHDRAWN'] as const;
export type NodeState = (typeof NODE_STATES)[number];

/* -------------------------------------------------------------------------- */
/* Construction                                                               */
/* -------------------------------------------------------------------------- */

export interface NewNode {
  readonly id: string;
  readonly projectId: string;
  readonly class: NodeClass;
  readonly label: string;
  readonly description?: string;
  readonly provenance: NodeProvenance;
  readonly attributes?: Readonly<Record<string, unknown>>;
  readonly at: string;
}

/**
 * Build a node.
 *
 * A function rather than an object literal at each call site, so every node in the graph starts at
 * revision 1 in state ACTIVE with both timestamps set. Those three fields are load-bearing for
 * versioning and easy to forget; a constructor makes forgetting impossible.
 */
export function createNode(input: NewNode): TwinNode {
  return {
    id: input.id,
    projectId: input.projectId,
    class: input.class,
    label: input.label,
    ...(input.description === undefined ? {} : { description: input.description }),
    state: 'ACTIVE',
    provenance: input.provenance,
    revision: 1,
    attributes: input.attributes ?? {},
    createdAt: input.at,
    updatedAt: input.at,
  };
}

/** Whether a class may contain another. Absence means no. */
export function canContain(parent: NodeClass, child: NodeClass): boolean {
  return CONTAINMENT[parent]?.includes(child) ?? false;
}

export function isImmutableClass(nodeClass: NodeClass): boolean {
  return IMMUTABLE_CLASSES.includes(nodeClass);
}
