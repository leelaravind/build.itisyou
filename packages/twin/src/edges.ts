/**
 * The edge classes of the Project Digital Twin, and which pairings are legal.
 *
 * Contract: gap-spec §8.2 lists seventeen relationship types; §8.3 gives worked examples of what the
 * graph must refuse — "task cannot verify requirement", "test may verify requirement", "evidence may
 * support test/gate/approval".
 *
 * Those examples are the reason this file exists. An edge type on its own is just a label; what makes
 * the graph trustworthy is that `verifies` cannot be asserted between arbitrary things. A traceability
 * matrix built from a graph where anything can verify anything proves nothing, and it looks exactly
 * like one that proves something.
 *
 * So legality is a **closed allowlist**: a pairing not written here is refused. The alternative — a
 * denylist of known-bad pairings — is wrong for the same reason deny-by-default is right in `rbac.ts`.
 * Every combination nobody thought about would be permitted, and there are 33 × 33 × 17 of them.
 */

import type { NodeClass } from './nodes.ts';
import { CONTAINMENT } from './nodes.ts';

/* -------------------------------------------------------------------------- */
/* The taxonomy                                                               */
/* -------------------------------------------------------------------------- */

/** Every edge class, in the order gap-spec §8.2 lists them. */
export const EDGE_CLASSES = [
  'CONTAINS',
  'DEPENDS_ON',
  'BLOCKS',
  'IMPLEMENTS',
  'SATISFIES',
  'DERIVED_FROM',
  'VERIFIES',
  'EVIDENCED_BY',
  'OWNED_BY',
  'ASSIGNED_TO',
  'FUNDED_BY',
  'MITIGATES',
  'IMPACTS',
  'DEPLOYS_TO',
  'APPROVED_BY',
  'INVALIDATES',
  'SUPERSEDES',
] as const;

export type EdgeClass = (typeof EDGE_CLASSES)[number];

const EDGE_CLASS_SET: ReadonlySet<string> = new Set<string>(EDGE_CLASSES);

export function isEdgeClass(value: string): value is EdgeClass {
  return EDGE_CLASS_SET.has(value);
}

/* -------------------------------------------------------------------------- */
/* Structural properties                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Edge classes whose graph must be acyclic.
 *
 * Gap-spec §8.3 requires dependency cycles to be detected. The set is wider than `DEPENDS_ON`
 * because the same argument applies to every relation that implies an ordering or a derivation: a
 * containment loop is a hierarchy with no root, and a `DERIVED_FROM` loop is a requirement that
 * justifies itself.
 *
 * `BLOCKS` is here too. A blocks B blocks A is not a scheduling subtlety; it is a deadlock the plan
 * would present as a schedule.
 */
export const ACYCLIC_EDGES: readonly EdgeClass[] = [
  'CONTAINS',
  'DEPENDS_ON',
  'BLOCKS',
  'DERIVED_FROM',
  'SUPERSEDES',
] as const;

/**
 * Edge classes where a node may have at most one outgoing edge.
 *
 * A node with two parents is not a tree, and every roll-up calculation in the product — budget,
 * effort, completion — assumes each node is counted once. Two `CONTAINS` parents would double-count
 * silently, which is the worst way for a number to be wrong.
 */
export const SINGLE_PARENT_EDGES: readonly EdgeClass[] = ['CONTAINS', 'OWNED_BY'] as const;

/**
 * Edge classes that must not connect a node to itself.
 *
 * All of them, in practice — a requirement that depends on itself, verifies itself or supersedes
 * itself is meaningless in every case. Stated as a list rather than assumed, so that if a
 * genuinely reflexive relation is ever added the omission is deliberate.
 */
export const IRREFLEXIVE_EDGES: readonly EdgeClass[] = EDGE_CLASSES;

/* -------------------------------------------------------------------------- */
/* Legality                                                                   */
/* -------------------------------------------------------------------------- */

type Legality = Readonly<Partial<Record<NodeClass, readonly NodeClass[]>>>;

/** Shorthand for the many relations that accept any work-shaped node on one end. */
const WORK: readonly NodeClass[] = [
  'PHASE',
  'WORKSTREAM',
  'MILESTONE',
  'EPIC',
  'TASK',
  'SUBTASK',
  'CHECKPOINT',
  'OPERATIONAL_TASK',
] as const;

const PLANNED: readonly NodeClass[] = [...WORK, 'REQUIREMENT', 'OBJECTIVE'] as const;

/**
 * Which `from → to` pairings each edge class permits.
 *
 * Read as: `EDGE_LEGALITY[edgeClass][fromClass]` is the set of classes the edge may point at. An
 * absent `from` class means the edge cannot originate there at all.
 *
 * `CONTAINS` is not listed: it derives from `CONTAINMENT` in `nodes.ts`, because containment is a
 * property of what a node is. Duplicating it here would create two sources of truth that could
 * disagree.
 */
export const EDGE_LEGALITY: Readonly<Record<Exclude<EdgeClass, 'CONTAINS'>, Legality>> = {
  /** Ordering between comparable things. Deliberately not permitted across levels of the hierarchy. */
  DEPENDS_ON: {
    PHASE: ['PHASE', 'MILESTONE', 'GATE'],
    WORKSTREAM: ['WORKSTREAM', 'PHASE'],
    MILESTONE: ['MILESTONE', 'PHASE', 'EPIC', 'TASK', 'GATE'],
    EPIC: ['EPIC', 'TASK', 'REQUIREMENT'],
    /*
     * Work and deployments may depend on an architecture component.
     *
     * Added in Phase 12 because two modules needed it independently and neither could have it. The
     * architecture checker looks for work committed against a component that is still proposed, and
     * gap-spec §27 requires "architecture component changed → implementation tasks, integration
     * tests, deployment". Without this edge, work and components are siblings under a requirement
     * with no relation between them, and a component change reaches nothing that was built on it.
     *
     * A test reaches a component through `VERIFIES`, which already permits it — that is what an
     * integration test is.
     */
    TASK: ['TASK', 'SUBTASK', 'EPIC', 'ARCHITECTURE_COMPONENT'],
    SUBTASK: ['SUBTASK', 'TASK', 'ARCHITECTURE_COMPONENT'],
    REQUIREMENT: ['REQUIREMENT'],
    ARCHITECTURE_COMPONENT: ['ARCHITECTURE_COMPONENT'],
    DEPLOYMENT: ['DEPLOYMENT', 'GATE', 'ENVIRONMENT', 'ARCHITECTURE_COMPONENT'],
    OPERATIONAL_TASK: ['OPERATIONAL_TASK', 'TASK'],
    CHECKPOINT: ['CHECKPOINT', 'TASK', 'MILESTONE'],
  },

  /** Something is preventing progress. Distinct from a dependency: a blocker is a problem, not a plan. */
  BLOCKS: {
    BLOCKER: [...PLANNED, 'DEPLOYMENT', 'GATE'],
    RISK: [...WORK],
    INCIDENT: [...WORK, 'DEPLOYMENT'],
    TASK: [...WORK],
  },

  /** Work that realises a requirement or objective. */
  IMPLEMENTS: {
    EPIC: ['REQUIREMENT', 'OBJECTIVE'],
    TASK: ['REQUIREMENT', 'OBJECTIVE'],
    SUBTASK: ['REQUIREMENT'],
    ARCHITECTURE_COMPONENT: ['REQUIREMENT', 'ARCHITECTURE_DECISION'],
    DEPLOYMENT: ['REQUIREMENT'],
  },

  /** A requirement meets an objective; a gate meets a policy expressed as a requirement. */
  SATISFIES: {
    REQUIREMENT: ['OBJECTIVE'],
    GATE: ['REQUIREMENT', 'OBJECTIVE'],
    EVIDENCE: ['REQUIREMENT'],
    DOCUMENT: ['REQUIREMENT'],
  },

  /** Where something came from. The backbone of explainability. */
  DERIVED_FROM: {
    REQUIREMENT: ['OBJECTIVE', 'REQUIREMENT', 'ASSUMPTION', 'DOCUMENT', 'CHANGE_REQUEST'],
    OBJECTIVE: ['DOCUMENT', 'ASSUMPTION'],
    PHASE: ['REQUIREMENT', 'OBJECTIVE', 'SCENARIO'],
    EPIC: ['REQUIREMENT'],
    TASK: ['REQUIREMENT', 'EPIC'],
    ESTIMATE: ['TASK', 'EPIC', 'PHASE', 'REQUIREMENT', 'ASSUMPTION', 'RESOURCE'],
    BUDGET_ITEM: ['ESTIMATE', 'RESOURCE', 'ASSUMPTION'],
    FORECAST: ['ESTIMATE', 'SCENARIO', 'BASELINE'],
    RISK: ['ASSUMPTION', 'UNKNOWN', 'REQUIREMENT'],
    ARCHITECTURE_DECISION: ['REQUIREMENT', 'ASSUMPTION', 'RISK'],
    ARCHITECTURE_COMPONENT: ['ARCHITECTURE_DECISION'],
    SCENARIO: ['BASELINE', 'FORECAST'],
    ASSUMPTION: ['UNKNOWN'],
  },

  /**
   * Verification. The narrowest relation in the graph, and deliberately so.
   *
   * Gap-spec §8.3 names this exact case: a **task** cannot verify a requirement, a **test** may.
   * The distinction is the whole basis of the traceability matrix — "we did some work near it" is
   * not evidence that a requirement is met, and a graph that conflates the two produces a
   * compliance report that is confidently wrong.
   */
  VERIFIES: {
    TEST: ['REQUIREMENT', 'OBJECTIVE', 'ARCHITECTURE_COMPONENT', 'MILESTONE'],
    GATE: ['REQUIREMENT', 'PHASE', 'MILESTONE', 'DEPLOYMENT'],
    APPROVAL: ['GATE', 'MILESTONE', 'CHANGE_REQUEST', 'BASELINE'],
  },

  /** What supports a claim. Gap-spec §8.3: evidence may support test, gate and approval. */
  EVIDENCED_BY: {
    TEST: ['EVIDENCE'],
    GATE: ['EVIDENCE'],
    APPROVAL: ['EVIDENCE'],
    REQUIREMENT: ['EVIDENCE', 'TEST'],
    MILESTONE: ['EVIDENCE'],
    DEPLOYMENT: ['EVIDENCE'],
    INCIDENT: ['EVIDENCE'],
    ESTIMATE: ['EVIDENCE'],
  },

  /** Accountability. One owner, enforced by `SINGLE_PARENT_EDGES`. */
  OWNED_BY: {
    PROJECT: ['RESOURCE'],
    OBJECTIVE: ['RESOURCE'],
    REQUIREMENT: ['RESOURCE'],
    PHASE: ['RESOURCE'],
    WORKSTREAM: ['RESOURCE'],
    EPIC: ['RESOURCE'],
    TASK: ['RESOURCE'],
    RISK: ['RESOURCE'],
    BLOCKER: ['RESOURCE'],
    GATE: ['RESOURCE'],
    DOCUMENT: ['RESOURCE'],
    CHANGE_REQUEST: ['RESOURCE'],
    INCIDENT: ['RESOURCE'],
    OPERATIONAL_TASK: ['RESOURCE'],
  },

  /** Who is doing it. Distinct from ownership: several people may work on what one person owns. */
  ASSIGNED_TO: {
    TASK: ['RESOURCE'],
    SUBTASK: ['RESOURCE'],
    EPIC: ['RESOURCE'],
    CHECKPOINT: ['RESOURCE'],
    OPERATIONAL_TASK: ['RESOURCE'],
    INCIDENT: ['RESOURCE'],
  },

  /** What pays for it. */
  FUNDED_BY: {
    PHASE: ['BUDGET_ITEM'],
    WORKSTREAM: ['BUDGET_ITEM'],
    EPIC: ['BUDGET_ITEM'],
    TASK: ['BUDGET_ITEM'],
    RESOURCE: ['BUDGET_ITEM'],
    DEPLOYMENT: ['BUDGET_ITEM'],
    OPERATIONAL_TASK: ['BUDGET_ITEM'],
  },

  /** What reduces a risk. */
  MITIGATES: {
    TASK: ['RISK'],
    EPIC: ['RISK'],
    ARCHITECTURE_DECISION: ['RISK'],
    REQUIREMENT: ['RISK'],
    GATE: ['RISK'],
    TEST: ['RISK'],
    OPERATIONAL_TASK: ['RISK', 'INCIDENT'],
  },

  /** What a change would touch. The basis of change-impact analysis in Phase 14. */
  IMPACTS: {
    CHANGE_REQUEST: [
      'REQUIREMENT',
      'OBJECTIVE',
      'PHASE',
      'EPIC',
      'TASK',
      'BUDGET_ITEM',
      'ESTIMATE',
      'MILESTONE',
      'ARCHITECTURE_COMPONENT',
      'BASELINE',
    ],
    RISK: ['MILESTONE', 'BUDGET_ITEM', 'ESTIMATE', 'OBJECTIVE', 'PHASE'],
    INCIDENT: ['ENVIRONMENT', 'DEPLOYMENT', 'MILESTONE', 'OBJECTIVE'],
    UNKNOWN: ['ESTIMATE', 'REQUIREMENT', 'PHASE', 'BUDGET_ITEM'],
    ASSUMPTION: ['ESTIMATE', 'REQUIREMENT', 'PHASE', 'BUDGET_ITEM', 'FORECAST'],
  },

  DEPLOYS_TO: {
    DEPLOYMENT: ['ENVIRONMENT'],
    ARCHITECTURE_COMPONENT: ['ENVIRONMENT'],
  },

  APPROVED_BY: {
    GATE: ['APPROVAL'],
    MILESTONE: ['APPROVAL'],
    BASELINE: ['APPROVAL'],
    CHANGE_REQUEST: ['APPROVAL'],
    DEPLOYMENT: ['APPROVAL'],
    DOCUMENT: ['APPROVAL'],
  },

  /**
   * Something that makes a prior conclusion no longer safe to rely on.
   *
   * Gap-spec §8.3: a completed gate must not silently change when its evidence changes — it becomes
   * stale. This edge is how that is recorded, rather than by mutating the gate, which would destroy
   * the record of what was concluded and when.
   */
  INVALIDATES: {
    CHANGE_REQUEST: ['GATE', 'APPROVAL', 'BASELINE', 'EVIDENCE', 'TEST', 'ESTIMATE', 'FORECAST'],
    EVIDENCE: ['GATE', 'APPROVAL', 'TEST'],
    INCIDENT: ['GATE', 'APPROVAL', 'DEPLOYMENT'],
    TEST: ['GATE', 'APPROVAL'],
    REQUIREMENT: ['TEST', 'GATE'],
  },

  /** Replacement. The superseded node stays in the graph; the edge says what replaced it. */
  SUPERSEDES: {
    REQUIREMENT: ['REQUIREMENT'],
    ARCHITECTURE_DECISION: ['ARCHITECTURE_DECISION'],
    DOCUMENT: ['DOCUMENT'],
    BASELINE: ['BASELINE'],
    ESTIMATE: ['ESTIMATE'],
    FORECAST: ['FORECAST'],
    PHASE: ['PHASE'],
    SCENARIO: ['SCENARIO'],
    ASSUMPTION: ['ASSUMPTION', 'UNKNOWN'],
  },
};

/* -------------------------------------------------------------------------- */
/* The edge record                                                            */
/* -------------------------------------------------------------------------- */

export interface TwinEdge {
  readonly id: string;
  readonly projectId: string;
  readonly class: EdgeClass;
  readonly from: string;
  readonly to: string;

  /**
   * Why this edge exists.
   *
   * Optional, but the traceability report reads it: "task 12 implements requirement 4" is a fact,
   * and "because the intake said accessibility is a hard requirement" is what makes it reviewable.
   */
  readonly rationale?: string;

  readonly createdAt: string;
}

/* -------------------------------------------------------------------------- */
/* Checking                                                                   */
/* -------------------------------------------------------------------------- */

export type EdgeRejection =
  { readonly ok: true } | { readonly ok: false; readonly code: string; readonly reason: string };

const OK: EdgeRejection = { ok: true };

/**
 * Whether an edge of this class may join these two classes.
 *
 * Returns a reason rather than a boolean. Every refusal in this product has to be explainable to the
 * person who hit it, and "illegal edge" tells them nothing they can act on.
 */
export function checkEdgeLegality(
  edgeClass: EdgeClass,
  from: NodeClass,
  to: NodeClass,
): EdgeRejection {
  if (edgeClass === 'CONTAINS') {
    const allowed = CONTAINMENT[from] ?? [];
    if (!allowed.includes(to)) {
      return {
        ok: false,
        code: 'ILLEGAL_CONTAINMENT',
        reason: `${capitalise(describeWithArticle(from))} cannot contain ${describeWithArticle(to)}.`,
      };
    }
    return OK;
  }

  const legality = EDGE_LEGALITY[edgeClass];
  const allowed = legality[from];

  if (allowed === undefined) {
    return {
      ok: false,
      code: 'ILLEGAL_EDGE_SOURCE',
      reason: `${capitalise(describeWithArticle(from))} cannot ${describeEdge(edgeClass)} anything.`,
    };
  }

  if (!allowed.includes(to)) {
    return {
      ok: false,
      code: 'ILLEGAL_EDGE_TARGET',
      reason: `${capitalise(describeWithArticle(from))} cannot ${describeEdge(edgeClass)} ${describeWithArticle(to)}.`,
    };
  }

  return OK;
}

/**
 * The indefinite article for a class name.
 *
 * Seven of the thirty-two node classes begin with a vowel, so "a environment" was not a rare edge
 * case — it appeared in a large fraction of refusal messages. Chosen by first letter rather than by
 * pronunciation, which is correct for every name in the taxonomy.
 */
function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function article(word: string): string {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

/** `ARCHITECTURE_COMPONENT` → `an architecture component`. For messages people read. */
export function describeWithArticle(nodeClass: NodeClass): string {
  const name = describe(nodeClass);
  return `${article(name)} ${name}`;
}

/** `ARCHITECTURE_COMPONENT` → `architecture component`. For messages people read. */
export function describe(nodeClass: NodeClass): string {
  return nodeClass.toLowerCase().replace(/_/g, ' ');
}

/**
 * How an edge class reads inside a sentence.
 *
 * Lower-casing the class name produced "a task cannot verifies anything", which is the kind of
 * detail that makes a product feel machine-generated — and these strings are shown to users, not
 * logged. Each entry is the verb phrase that completes "an X cannot ___ a Y".
 */
const EDGE_PHRASE: Readonly<Record<EdgeClass, string>> = {
  CONTAINS: 'contain',
  DEPENDS_ON: 'depend on',
  BLOCKS: 'block',
  IMPLEMENTS: 'implement',
  SATISFIES: 'satisfy',
  DERIVED_FROM: 'be derived from',
  VERIFIES: 'verify',
  EVIDENCED_BY: 'be evidenced by',
  OWNED_BY: 'be owned by',
  ASSIGNED_TO: 'be assigned to',
  FUNDED_BY: 'be funded by',
  MITIGATES: 'mitigate',
  IMPACTS: 'impact',
  DEPLOYS_TO: 'deploy to',
  APPROVED_BY: 'be approved by',
  INVALIDATES: 'invalidate',
  SUPERSEDES: 'supersede',
};

export function describeEdge(edgeClass: EdgeClass): string {
  return EDGE_PHRASE[edgeClass];
}

/**
 * The relationship as a noun.
 *
 * Needed because a cycle is described as a thing rather than as an action: "circular dependency"
 * reads correctly where "circular depend on" does not. Only the acyclic classes strictly need one,
 * but leaving gaps would mean a future acyclic class silently produced broken prose.
 */
const EDGE_NOUN: Readonly<Record<EdgeClass, string>> = {
  CONTAINS: 'containment',
  DEPENDS_ON: 'dependency',
  BLOCKS: 'blocking',
  IMPLEMENTS: 'implementation',
  SATISFIES: 'satisfaction',
  DERIVED_FROM: 'derivation',
  VERIFIES: 'verification',
  EVIDENCED_BY: 'evidence',
  OWNED_BY: 'ownership',
  ASSIGNED_TO: 'assignment',
  FUNDED_BY: 'funding',
  MITIGATES: 'mitigation',
  IMPACTS: 'impact',
  DEPLOYS_TO: 'deployment',
  APPROVED_BY: 'approval',
  INVALIDATES: 'invalidation',
  SUPERSEDES: 'supersession',
};

export function describeEdgeAsNoun(edgeClass: EdgeClass): string {
  return EDGE_NOUN[edgeClass];
}
