/**
 * Baselines: deliberate governance snapshots.
 *
 * §29 opens with "Baselines are deliberate governance snapshots", and every design decision here
 * follows from taking that adjective seriously. A snapshot taken automatically on a schedule is a
 * backup. A baseline is somebody saying *this* is what we agreed, on this date, for this reason — and
 * that only means something if three things hold.
 *
 * **It can be proven unmodified.** A baseline nobody can verify is a claim about the past with
 * nothing behind it. The checksum exists so the answer to "has this been tampered with" is a
 * computation rather than an assumption.
 *
 * **It is never edited.** §29.3 says so in three words, and the interface below has no way to. Not a
 * guard that throws — an *absence*. Nothing here takes a baseline and returns a modified one.
 * Superseding creates a new baseline that points at the old one, so the history is a chain rather
 * than a series of overwrites.
 *
 * **It says why it was taken.** A baseline with no reason is indistinguishable from a scheduled
 * snapshot, and six months later nobody can tell which of eleven baselines was the one that mattered.
 *
 * Builds on `@govintel/twin/versioning`, which already does the hashing and the graph capture. This
 * layer adds the governance: type, creator, reason, approval, supersession and variance.
 *
 * Contract: gap-spec §29.
 */

import type { TwinGraph } from '@govintel/twin/graph';
import type { TwinNode } from '@govintel/twin/nodes';
import type { TwinEdge } from '@govintel/twin/edges';
import { checksumOf, takeBaseline, verifyBaseline, type Baseline } from '@govintel/twin/versioning';

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * §29.1's V1 list, and only that.
 *
 * `MONTHLY_CONTROL_BASELINE` and `CONTRACT_BASELINE` are named in the spec as *optional later*. They
 * are absent rather than present-and-unused: an enum member nothing produces looks like a supported
 * feature to everyone reading the type, and the first person to select it discovers it does nothing.
 */
export const BASELINE_TYPES = ['APPROVED_PLAN', 'RELEASE_BASELINE'] as const;

export type BaselineType = (typeof BASELINE_TYPES)[number];

export const BASELINE_MEANING: Readonly<Record<BaselineType, string>> = {
  APPROVED_PLAN:
    'What was agreed before work started. Everything the project later reports as variance is measured against this.',
  RELEASE_BASELINE:
    'What was shipped. The record somebody goes back to when production behaves in a way nobody expected.',
};

/**
 * Which types require an approval before they can be taken.
 *
 * A release baseline is the record of what was shipped, and shipping is a decision somebody is
 * accountable for. An approved plan can be taken without one — it is often the artefact the approval
 * is *about*, and requiring the approval first would make it impossible to produce.
 */
export const REQUIRES_APPROVAL: Readonly<Record<BaselineType, boolean>> = {
  APPROVED_PLAN: false,
  RELEASE_BASELINE: true,
};

export interface GovernanceBaseline extends Baseline {
  readonly type: BaselineType;
  /** §29.2. Who took it. A baseline nobody owns cannot be asked about. */
  readonly createdBy: string;
  /** §29.2. Why. The field that makes eleven baselines distinguishable from each other. */
  readonly reason: string;
  /** §29.2, where policy requires it. */
  readonly approvalId?: string;
  /** Set when a later baseline replaces this one. The chain, not an overwrite. */
  readonly supersededBy?: string;
}

/* -------------------------------------------------------------------------- */
/* Creation                                                                   */
/* -------------------------------------------------------------------------- */

export const BASELINE_REFUSALS = [
  'NO_REASON',
  'NO_CREATOR',
  'APPROVAL_REQUIRED',
  'EMPTY_GRAPH',
] as const;

export type BaselineRefusal = (typeof BASELINE_REFUSALS)[number];

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly refusal: BaselineRefusal; readonly reason: string };

export interface CreateBaselineInput {
  readonly id: string;
  readonly type: BaselineType;
  readonly label: string;
  readonly version: number;
  readonly createdBy: string;
  readonly reason: string;
  readonly approvalId?: string;
  /** Supplied by the caller. Never a clock read here: the same snapshot must hash identically. */
  readonly takenAt: string;
  readonly correlationId: string;
}

export function createBaseline(
  graph: TwinGraph,
  input: CreateBaselineInput,
): Result<GovernanceBaseline> {
  if (input.reason.trim() === '') {
    return {
      ok: false,
      refusal: 'NO_REASON',
      reason:
        'A baseline with no stated reason is indistinguishable from a scheduled snapshot. Six months later nobody can tell which of eleven baselines was the one that mattered, which is exactly when somebody needs to.',
    };
  }

  if (input.createdBy.trim() === '') {
    return {
      ok: false,
      refusal: 'NO_CREATOR',
      reason:
        'A baseline nobody took is one nobody can be asked about. §29.2 requires a creator because a governance record without a name on it is not governance.',
    };
  }

  if (REQUIRES_APPROVAL[input.type] && input.approvalId === undefined) {
    return {
      ok: false,
      refusal: 'APPROVAL_REQUIRED',
      reason: `A ${input.type.toLowerCase().replace(/_/g, ' ')} records what was shipped, and shipping is a decision somebody is accountable for. Taking it without an approval would produce a record of a decision nobody made.`,
    };
  }

  if (graph.size === 0) {
    return {
      ok: false,
      refusal: 'EMPTY_GRAPH',
      reason:
        'There is nothing to baseline. An empty baseline hashes cleanly and verifies forever, and it records nothing — which makes it worse than no baseline, because it looks like one.',
    };
  }

  const base = takeBaseline(graph, {
    id: input.id,
    label: input.label,
    version: input.version,
    takenAt: input.takenAt,
    correlationId: input.correlationId,
  });

  return {
    ok: true,
    value: {
      ...base,
      type: input.type,
      createdBy: input.createdBy,
      reason: input.reason,
      ...(input.approvalId === undefined ? {} : { approvalId: input.approvalId }),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Integrity                                                                  */
/* -------------------------------------------------------------------------- */

export interface IntegrityResult {
  readonly intact: boolean;
  /** What the recomputed checksum is, when it differs. Present only on failure. */
  readonly recomputed?: string;
  readonly explanation: string;
}

/**
 * Whether a baseline still matches its own hash, and what it means if not.
 *
 * A boolean answers "is this broken". What somebody actually needs at the moment they ask is what to
 * do about it, and the honest answer is that a baseline failing this check cannot be used as
 * evidence of anything — which is a much stronger statement than "false".
 */
export function verifyIntegrity(baseline: GovernanceBaseline): IntegrityResult {
  if (verifyBaseline(baseline)) {
    return {
      intact: true,
      explanation: 'The stored content still hashes to the checksum recorded when it was taken.',
    };
  }

  return {
    intact: false,
    recomputed: checksumOf(baseline.nodes, baseline.edges),
    explanation:
      'The stored content no longer hashes to the checksum recorded when this was taken. Something changed it — a bug, a migration, or a person — and until that is explained this baseline cannot be used as evidence of what was agreed. It is not repaired by recomputing the hash: that would erase the only sign anything was wrong.',
  };
}

/* -------------------------------------------------------------------------- */
/* Supersession                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Replace a baseline with a newer one.
 *
 * §29.3: "Never edit baseline. Create a new baseline." So this returns **both** — the new one, and
 * the old one marked as superseded by it. The old one's content is untouched; only the pointer is
 * added, and that pointer is outside the hashed content precisely so recording the supersession does
 * not break the integrity of what was baselined.
 *
 * There is deliberately no function anywhere in this module that takes a baseline and returns a
 * version of it with different nodes or edges.
 */
export function supersede(
  previous: GovernanceBaseline,
  next: GovernanceBaseline,
): { readonly previous: GovernanceBaseline; readonly next: GovernanceBaseline } {
  return {
    previous: { ...previous, supersededBy: next.id },
    next,
  };
}

/* -------------------------------------------------------------------------- */
/* Variance                                                                   */
/* -------------------------------------------------------------------------- */

export interface Variance {
  /** Node ids present now and not in the baseline. */
  readonly added: readonly string[];
  /** Node ids in the baseline and not present now. */
  readonly removed: readonly string[];
  /** Node ids whose revision has moved since the baseline. */
  readonly changed: readonly string[];
  /** Edge ids added or removed. Structure changes are the ones people notice last. */
  readonly edgesAdded: readonly string[];
  readonly edgesRemoved: readonly string[];
  readonly summary: string;
}

/**
 * What has moved since the baseline was taken.
 *
 * Reported as named ids rather than as a count or a percentage of drift. "38% divergence" is
 * unactionable and optimisable; "these four requirements changed and this one was removed" is the
 * conversation somebody actually needs to have.
 *
 * Removal is called out separately from change because it is the one people miss: a requirement that
 * quietly stopped existing does not show up in a diff of the things that are still there.
 */
export function variance(baseline: GovernanceBaseline, current: TwinGraph): Variance {
  const baselineNodes = new Map(baseline.nodes.map((n) => [n.id, n]));
  const currentNodes = new Map(current.nodes.map((n: TwinNode) => [n.id, n]));

  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  for (const [id, node] of currentNodes) {
    const before = baselineNodes.get(id);

    if (before === undefined) {
      added.push(id);
      continue;
    }

    if (before.revision !== node.revision) changed.push(id);
  }

  for (const id of baselineNodes.keys()) {
    if (!currentNodes.has(id)) removed.push(id);
  }

  const baselineEdges = new Set(baseline.edges.map((e) => e.id));
  const currentEdges = new Set(current.edges.map((e: TwinEdge) => e.id));

  const edgesAdded = [...currentEdges].filter((id) => !baselineEdges.has(id));
  const edgesRemoved = [...baselineEdges].filter((id) => !currentEdges.has(id));

  // Sorted so two runs over the same pair produce identical output, and so a reader diffing two
  // variance reports sees only real movement.
  added.sort();
  removed.sort();
  changed.sort();
  edgesAdded.sort();
  edgesRemoved.sort();

  const total = added.length + removed.length + changed.length;

  return {
    added,
    removed,
    changed,
    edgesAdded,
    edgesRemoved,
    summary:
      total === 0
        ? `Nothing has moved since ${baseline.label} was taken. The project is exactly as it was baselined.`
        : `${String(changed.length)} changed, ${String(added.length)} added, ${String(removed.length)} removed since ${baseline.label}.`,
  };
}

/**
 * Whether the project still matches the baseline exactly.
 *
 * Separate from `variance` because the yes/no question is asked far more often than the detail, and
 * a caller wanting only the answer should not have to build the lists to get it.
 */
export function matchesBaseline(baseline: GovernanceBaseline, current: TwinGraph): boolean {
  const nodes = [...current.nodes].sort((a: TwinNode, b: TwinNode) => a.id.localeCompare(b.id));
  const edges = [...current.edges].sort((a: TwinEdge, b: TwinEdge) => a.id.localeCompare(b.id));

  return checksumOf(nodes, edges) === baseline.checksum;
}
