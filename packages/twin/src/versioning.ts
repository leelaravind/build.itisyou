/**
 * Versioning the Digital Twin.
 *
 * Contract: gap-spec §8.4 — every material change is associated with a project version and
 * correlation id, and **"do not copy the entire database for every version"**. What it prescribes
 * instead is stable entities, versioned records where needed, an audit log, immutable baseline
 * snapshots and calculation snapshots.
 *
 * That instruction is the whole design. The obvious implementation — duplicate every node on every
 * edit — is wrong in three ways at once: it grows without bound, it makes "what is the current
 * value" a query rather than a lookup, and it still does not answer the question anyone actually
 * asks, which is *what changed and why*.
 *
 * So there are three distinct mechanisms here, each answering a different question:
 *
 * | Question | Mechanism |
 * |---|---|
 * | What is true now? | The nodes and edges themselves. One row per entity. |
 * | What changed, when, and by whom? | The change log — one entry per material change. |
 * | What did we commit to at that moment? | A baseline: a full, immutable snapshot, taken rarely. |
 *
 * A baseline *is* a full copy, and that is deliberate. The thing gap-spec §8.4 forbids is copying on
 * every change; a baseline is taken when a plan is agreed — a handful of times in a project's life —
 * and it must be a complete, self-contained record, because its entire purpose is to still be
 * readable when everything it referred to has moved on.
 */

import { createHash } from 'node:crypto';
import { AppError } from '@govintel/shared/errors';
import type { TwinNode } from './nodes.ts';
import type { TwinEdge } from './edges.ts';
import type { TwinGraph } from './graph.ts';

/* -------------------------------------------------------------------------- */
/* Project version                                                            */
/* -------------------------------------------------------------------------- */

/**
 * A project's version is a monotonic integer, not a semantic version.
 *
 * Semantic versioning encodes a judgement about compatibility, which is meaningless for a project
 * plan: there is no such thing as a backwards-compatible change to a deadline. A counter says the
 * one thing that is actually true — this is the Nth material state of this project — and it can be
 * compared without interpretation.
 */
export interface ProjectVersion {
  readonly projectId: string;
  readonly version: number;
  readonly correlationId: string;
  readonly at: string;
}

/* -------------------------------------------------------------------------- */
/* Change log                                                                 */
/* -------------------------------------------------------------------------- */

export const CHANGE_KINDS = [
  'NODE_CREATED',
  'NODE_UPDATED',
  'NODE_SUPERSEDED',
  'NODE_WITHDRAWN',
  'EDGE_CREATED',
  'EDGE_REMOVED',
] as const;

export type ChangeKind = (typeof CHANGE_KINDS)[number];

/**
 * One material change.
 *
 * `before`/`after` hold only the fields that actually differed. Storing whole node snapshots here
 * would reintroduce the copy-per-change problem through the back door, and would bury the answer to
 * "what changed" inside two nearly-identical blobs that a human then has to diff by eye.
 */
export interface ChangeEntry {
  readonly projectId: string;
  readonly version: number;
  readonly correlationId: string;
  readonly kind: ChangeKind;
  readonly targetId: string;
  readonly at: string;

  /** Which fields changed, and to what. Empty for creations and removals. */
  readonly before?: Readonly<Record<string, unknown>>;
  readonly after?: Readonly<Record<string, unknown>>;

  /**
   * Why. Free text supplied by whatever made the change — a rule name, a change request, a user's
   * note. A change log without reasons records that the project moved but not why, which is the half
   * that matters at a review.
   */
  readonly reason?: string;
}

/**
 * The fields that differ between two versions of a node.
 *
 * Deliberately shallow over `attributes`: a nested diff would be more precise and much harder to
 * read, and the change log is read by people. A changed attribute reports the whole attribute.
 */
export function diffNode(
  before: TwinNode,
  after: TwinNode,
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const changedBefore: Record<string, unknown> = {};
  const changedAfter: Record<string, unknown> = {};

  const scalarKeys = ['label', 'description', 'state', 'class'] as const;

  for (const key of scalarKeys) {
    if (before[key] !== after[key]) {
      changedBefore[key] = before[key];
      changedAfter[key] = after[key];
    }
  }

  if (!sameProvenance(before, after)) {
    changedBefore.provenance = before.provenance;
    changedAfter.provenance = after.provenance;
  }

  const keys = new Set([...Object.keys(before.attributes), ...Object.keys(after.attributes)]);
  for (const key of keys) {
    const a = before.attributes[key];
    const b = after.attributes[key];
    // Structural comparison via canonical JSON: attribute values are plain data by construction, and
    // reference equality would report every re-parsed object as a change.
    if (stableStringify(a) === stableStringify(b)) continue;
    changedBefore[`attributes.${key}`] = a;
    changedAfter[`attributes.${key}`] = b;
  }

  return { before: changedBefore, after: changedAfter };
}

function sameProvenance(a: TwinNode, b: TwinNode): boolean {
  return (
    a.provenance.provenance === b.provenance.provenance &&
    a.provenance.confidence === b.provenance.confidence &&
    a.provenance.sourceRef === b.provenance.sourceRef
  );
}

/** True when nothing material differs — used to avoid logging a change that is not one. */
export function isMaterialChange(before: TwinNode, after: TwinNode): boolean {
  const diff = diffNode(before, after);
  return Object.keys(diff.after).length > 0;
}

/* -------------------------------------------------------------------------- */
/* Baselines                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * An immutable snapshot of the whole graph at a moment.
 *
 * `checksum` is what makes it evidence rather than a copy. A baseline nobody can verify is a claim
 * about the past; a baseline with a content hash is a record that can be shown to have not been
 * edited since. It is computed over the canonical serialisation, so two baselines of identical
 * content produce identical hashes regardless of how the objects were built.
 */
export interface Baseline {
  readonly id: string;
  readonly projectId: string;
  readonly version: number;
  readonly label: string;
  readonly takenAt: string;
  readonly correlationId: string;
  readonly checksum: string;
  readonly nodes: readonly TwinNode[];
  readonly edges: readonly TwinEdge[];
}

export interface BaselineInput {
  readonly id: string;
  readonly label: string;
  readonly version: number;
  readonly takenAt: string;
  readonly correlationId: string;
}

/** Take a baseline of the graph as it currently stands. */
export function takeBaseline(graph: TwinGraph, input: BaselineInput): Baseline {
  // Sorted, so the checksum depends on content rather than on the order the graph happened to be
  // built in. Two baselines of the same project state must hash identically or the hash proves
  // nothing.
  const nodes = [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id));
  const edges = [...graph.edges].sort((a, b) => a.id.localeCompare(b.id));

  return {
    id: input.id,
    projectId: graph.projectId,
    version: input.version,
    label: input.label,
    takenAt: input.takenAt,
    correlationId: input.correlationId,
    checksum: checksumOf(nodes, edges),
    nodes,
    edges,
  };
}

/**
 * Whether a baseline still matches its own checksum.
 *
 * The point of storing the hash is being able to answer this. A baseline that has been tampered with
 * — by a bug, a bad migration, or a person — must be detectable as such rather than quietly trusted.
 */
export function verifyBaseline(baseline: Baseline): boolean {
  return checksumOf(baseline.nodes, baseline.edges) === baseline.checksum;
}

export function checksumOf(nodes: readonly TwinNode[], edges: readonly TwinEdge[]): string {
  const canonical = stableStringify({
    nodes: nodes.map(canonicalNode),
    edges: edges.map(canonicalEdge),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * The fields that define a node's identity for hashing.
 *
 * `updatedAt` is excluded on purpose: two graphs with identical content that were saved at different
 * moments are the same plan, and a checksum that disagreed would make baselines useless for
 * comparison. `revision` is excluded for the same reason — it counts edits, and a node edited twice
 * back to its original value is, for the purposes of "what did we commit to", unchanged.
 */
function canonicalNode(node: TwinNode): Record<string, unknown> {
  return {
    id: node.id,
    class: node.class,
    label: node.label,
    description: node.description ?? null,
    state: node.state,
    provenance: node.provenance.provenance,
    confidence: node.provenance.confidence,
    sourceRef: node.provenance.sourceRef ?? null,
    attributes: node.attributes,
  };
}

function canonicalEdge(edge: TwinEdge): Record<string, unknown> {
  return {
    id: edge.id,
    class: edge.class,
    from: edge.from,
    to: edge.to,
    rationale: edge.rationale ?? null,
  };
}

/**
 * JSON with object keys sorted at every level.
 *
 * `JSON.stringify` preserves insertion order, so two structurally identical objects built in
 * different orders serialise differently and hash differently. That would make the checksum a
 * function of construction order rather than of content — which is the opposite of what it is for.
 */
export function stableStringify(value: unknown): string {
  /*
   * `JSON.stringify` is typed as returning `string`, and does not: it returns `undefined` for
   * `undefined`, functions and symbols. Guarding with `?? 'null'` worked but the type system called
   * the guard redundant, which meant the code read as though the case could not arise.
   *
   * None of these should reach a node attribute — but this function computes the checksum a baseline
   * is verified against, and returning `undefined` from something typed `string` would produce a
   * hash of the literal text "undefined" rather than an error.
   */
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    return 'null';
  }

  if (value === null || typeof value !== 'object') return JSON.stringify(value);

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/* -------------------------------------------------------------------------- */
/* Calculation snapshots                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The recorded result of a calculation, with everything needed to explain it later.
 *
 * Plan §12 requires calculations to be explainable and versioned, and §12.3 forbids fake precision.
 * A stored number with no record of the formula version or the inputs cannot be explained six months
 * later — and "the budget said £180,000" with no way to reconstruct why is worse than no figure,
 * because it carries authority it has not earned.
 *
 * `inputs` records the node ids and values the calculation actually read. `formulaVersion` is what
 * lets an old result stay correct-as-of-then when the formula changes: the number is not recomputed,
 * it is marked as computed under an earlier version.
 */
export interface CalculationSnapshot {
  readonly id: string;
  readonly projectId: string;
  readonly version: number;
  readonly calculation: string;
  readonly formulaVersion: string;
  readonly computedAt: string;
  readonly correlationId: string;

  readonly inputs: Readonly<Record<string, unknown>>;
  readonly result: Readonly<Record<string, unknown>>;

  /**
   * Nodes the result depends on.
   *
   * This is what makes staleness detectable: when one of these changes, the snapshot is known to be
   * out of date rather than silently wrong. Same principle as gate staleness in `invariants.ts`.
   */
  readonly dependsOn: readonly string[];

  /** Assumptions the calculation had to make. Surfaced with the number, never buried. */
  readonly assumptions: readonly string[];
}

/** Whether any node the snapshot depended on has been changed since it was computed. */
export function isSnapshotStale(
  snapshot: CalculationSnapshot,
  changedNodeIds: readonly string[],
): boolean {
  const changed = new Set(changedNodeIds);
  return snapshot.dependsOn.some((id) => changed.has(id));
}

/* -------------------------------------------------------------------------- */
/* Applying a change                                                          */
/* -------------------------------------------------------------------------- */

export interface MutationResult {
  readonly node: TwinNode;
  readonly entry?: ChangeEntry;
}

/**
 * Apply an edit to a node, producing the new node and its change-log entry.
 *
 * Refuses immutable classes outright. That check exists in three places now — here, in
 * `invariants.ts`, and in the database — for the same reason the AI-import airlock has three locks:
 * the guarantee should not rest on any single one being correct.
 */
export function applyNodeChange(
  before: TwinNode,
  changes: Partial<Pick<TwinNode, 'label' | 'description' | 'state' | 'attributes' | 'provenance'>>,
  meta: {
    readonly version: number;
    readonly correlationId: string;
    readonly at: string;
    readonly reason?: string;
  },
): MutationResult {
  if (isImmutable(before)) {
    throw new AppError({
      code: 'TWIN_IMMUTABLE_NODE',
      category: 'CONFLICT',
      safeMessage: 'That item records what was true when it was created and cannot be edited.',
      details: { nodeId: before.id, class: before.class },
    });
  }

  const after: TwinNode = {
    ...before,
    ...changes,
    revision: before.revision + 1,
    updatedAt: meta.at,
  };

  if (!isMaterialChange(before, after)) {
    // No entry, and no revision bump: a no-op edit should not appear in the history as a change,
    // and should not make every calculation snapshot that depends on this node look stale.
    return { node: before };
  }

  const diff = diffNode(before, after);

  return {
    node: after,
    entry: {
      projectId: before.projectId,
      version: meta.version,
      correlationId: meta.correlationId,
      kind: after.state === 'SUPERSEDED' ? 'NODE_SUPERSEDED' : 'NODE_UPDATED',
      targetId: before.id,
      at: meta.at,
      before: diff.before,
      after: diff.after,
      ...(meta.reason === undefined ? {} : { reason: meta.reason }),
    },
  };
}

function isImmutable(node: TwinNode): boolean {
  return node.class === 'BASELINE' || node.class === 'EVIDENCE' || node.class === 'APPROVAL';
}
