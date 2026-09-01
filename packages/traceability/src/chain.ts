/**
 * The Requirement → Release chain.
 *
 * This is the Phase-10 gate: "complete Requirement→Release chain verified". The chain is the argument
 * a project makes for believing it has done what it said it would — requirement, design, work, test,
 * evidence, approval, deployment — and the value is entirely in it being *walkable in both
 * directions*, node by node, rather than asserted.
 *
 * Two design positions do most of the work here.
 *
 * **A chain whose every edge exists can still be broken.** If the requirement was changed after the
 * evidence was captured, the evidence attests to a different requirement. Every link is present, the
 * report looks green, and the claim is false. Traceability tools that check only for the presence of
 * links report this as complete coverage, and that is the failure mode worth building against
 * (gap-spec §27.1 makes the same point about gates).
 *
 * **There are three outcomes, not two.** A link can be present, absent, or present-but-not-yet-
 * demonstrable — a test that exists and has never run, evidence attached to nothing, an approval
 * still pending. Collapsing the third into "absent" understates work that has been done; collapsing
 * it into "present" is the lie above. It gets its own status.
 */

import type { TwinGraph } from '@govintel/twin/graph';
import type { TwinNode } from '@govintel/twin/nodes';
import type { EdgeClass } from '@govintel/twin/edges';
import type { NodeClass } from '@govintel/twin/nodes';

/* -------------------------------------------------------------------------- */
/* The chain                                                                  */
/* -------------------------------------------------------------------------- */

export const CHAIN_VERSION = '1.0.0';

export interface Hop {
  readonly key: HopKey;
  readonly label: string;
  /**
   * Which earlier point this hop departs from.
   *
   * Explicit rather than "whatever the previous hop reached", because the chain is not a line. The
   * twin's edge model (§8.2) has work, tests and deployments all attaching directly to the
   * requirement, and only evidence and approval hanging off an earlier hop. Threading a single
   * frontier through in order made the TEST hop look for tests verifying a *task*, which the twin
   * forbids outright — so every trace came back with no test, and the report was confidently empty.
   */
  readonly from: 'REQUIREMENT' | HopKey;
  /** The class this hop lands on. */
  readonly to: NodeClass;
  /** The edge class that carries it, read in the direction requirement → release. */
  readonly via: EdgeClass;
  /**
   * Which direction the edge is stored in.
   *
   * `INBOUND` means the edge points back at the previous hop — a TEST *verifies* a requirement, so
   * the edge runs test → requirement while the chain runs requirement → test. Getting this wrong
   * produces a report that is confidently empty, which is why it is data rather than a convention.
   */
  readonly direction: 'OUTBOUND' | 'INBOUND';
  /** Whether a project can be releasable without this hop. */
  readonly required: boolean;
  /** What the absence of this hop actually means, in the project's terms. */
  readonly absenceMeans: string;
}

export const HOP_KEYS = ['DESIGN', 'WORK', 'TEST', 'EVIDENCE', 'RELEASE', 'APPROVAL'] as const;

export type HopKey = (typeof HOP_KEYS)[number];

/**
 * The chain, in order, expressed in the twin's own edge model rather than an invented one.
 *
 * Every `from`/`via`/`to` triple below is legal under `EDGE_LEGALITY` in `@govintel/twin/edges`.
 * That is not a coincidence to be maintained by hand — `chain.test.ts` asserts it — because a chain
 * describing edges the graph cannot hold produces a traceability report that is empty and confident.
 *
 * `DESIGN` and `APPROVAL` are not required, and that is deliberate rather than an oversight: plenty
 * of requirements are met by ordinary work needing no component of its own, and demanding one would
 * produce components invented to satisfy the checker. Everything from `WORK` to `EVIDENCE` is
 * required, because a requirement with no work is one nobody is meeting.
 */
export const CHAIN: readonly Hop[] = [
  {
    key: 'DESIGN',
    label: 'Design',
    from: 'REQUIREMENT',
    to: 'ARCHITECTURE_COMPONENT',
    via: 'IMPLEMENTS',
    direction: 'INBOUND',
    required: false,
    absenceMeans:
      'Nothing in the recorded architecture is responsible for this. Normal for requirements met by ordinary work, and a problem for ones that need somewhere to live.',
  },
  {
    key: 'WORK',
    label: 'Work',
    from: 'REQUIREMENT',
    to: 'TASK',
    via: 'IMPLEMENTS',
    direction: 'INBOUND',
    required: true,
    absenceMeans:
      'Nobody is doing anything about this. It is an obligation the project has accepted with no plan that would meet it.',
  },
  {
    key: 'TEST',
    label: 'Test',
    from: 'REQUIREMENT',
    to: 'TEST',
    via: 'VERIFIES',
    direction: 'INBOUND',
    required: true,
    absenceMeans:
      'Nothing will notice if this stops being true. Work without verification is a claim about a moment in the past, and it decays silently.',
  },
  {
    key: 'EVIDENCE',
    label: 'Evidence',
    from: 'TEST',
    to: 'EVIDENCE',
    via: 'EVIDENCED_BY',
    direction: 'OUTBOUND',
    required: true,
    absenceMeans:
      'The test may have passed, but nothing was kept. Anyone asking later how this was satisfied has only the assertion that it was.',
  },
  {
    key: 'RELEASE',
    label: 'Release',
    from: 'REQUIREMENT',
    to: 'DEPLOYMENT',
    via: 'IMPLEMENTS',
    direction: 'INBOUND',
    required: false,
    absenceMeans:
      'No deployment carries this yet. The requirement may be built and verified and still be sitting on a branch nobody has shipped.',
  },
  {
    key: 'APPROVAL',
    label: 'Approval',
    from: 'RELEASE',
    to: 'APPROVAL',
    via: 'APPROVED_BY',
    direction: 'OUTBOUND',
    required: false,
    absenceMeans:
      'Nobody has accepted the release on the record. Required where a person must be accountable for shipping it, and not otherwise.',
  },
];

/* -------------------------------------------------------------------------- */
/* Link status                                                                */
/* -------------------------------------------------------------------------- */

export const LINK_STATUSES = [
  /** The link exists and the thing it points at is current and usable. */
  'LINKED',
  /** Nothing links here. */
  'MISSING',
  /**
   * Something links here, but it cannot yet support the claim — a test that has never run, an
   * approval still pending, evidence with no artefact behind it.
   */
  'UNVERIFIED',
  /**
   * The link exists and points at something that attests to an *earlier* revision of the requirement.
   *
   * Every edge is present, so a presence check reports this as complete. It is not: the thing was
   * demonstrated against a requirement that has since changed.
   */
  'STALE',
  /** The hop is not required and nothing links here. Not a gap. */
  'NOT_REQUIRED',
] as const;

export type LinkStatus = (typeof LINK_STATUSES)[number];

export interface Link {
  readonly hop: HopKey;
  readonly status: LinkStatus;
  /** Nodes reached at this hop, in graph order. Empty when MISSING or NOT_REQUIRED. */
  readonly nodeIds: readonly string[];
  /** Why the status is what it is, in this requirement's terms. */
  readonly detail: string;
}

export interface ChainTrace {
  readonly requirementId: string;
  readonly requirementLabel: string;
  readonly links: readonly Link[];
  /**
   * Whether the whole chain holds.
   *
   * True only when every required hop is `LINKED`. `UNVERIFIED` and `STALE` both fail it, because
   * both describe a chain that looks complete and does not support its claim.
   */
  readonly complete: boolean;
  /** The first hop that broke it, or `undefined` when complete. */
  readonly brokeAt?: HopKey;
}

/* -------------------------------------------------------------------------- */
/* Walking                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Walk the chain from one requirement.
 *
 * Each hop starts from the nodes the previous hop reached, so the trace is a genuine path rather than
 * six independent existence checks. That distinction matters: a project can hold a requirement, a
 * task and a test where the test verifies a *different* requirement, and six existence checks would
 * report that as fully traced.
 */
export function traceRequirement(graph: TwinGraph, requirementId: string): ChainTrace {
  const requirement = graph.node(requirementId);

  if (requirement?.class !== 'REQUIREMENT') {
    return {
      requirementId,
      requirementLabel: requirementId,
      links: CHAIN.map((hop) => ({
        hop: hop.key,
        status: 'MISSING' as const,
        nodeIds: [],
        detail: 'The requirement itself is not in the graph.',
      })),
      complete: false,
      brokeAt: 'DESIGN',
    };
  }

  const links: Link[] = [];
  let brokeAt: HopKey | undefined;

  /*
   * What each hop reached, so a later hop can depart from a named earlier one.
   *
   * The chain is a tree rooted at the requirement, not a line: work, tests and deployments all
   * attach to the requirement directly, and only evidence and approval hang off an earlier hop.
   */
  const reachedBy = new Map<HopKey, readonly TwinNode[]>();

  for (const hop of CHAIN) {
    const origin = hop.from === 'REQUIREMENT' ? [requirement] : (reachedBy.get(hop.from) ?? []);

    const reached = step(graph, origin, hop);
    reachedBy.set(hop.key, reached);

    if (reached.length === 0) {
      links.push({
        hop: hop.key,
        status: hop.required ? 'MISSING' : 'NOT_REQUIRED',
        nodeIds: [],
        detail: hop.absenceMeans,
      });

      if (hop.required && brokeAt === undefined) brokeAt = hop.key;
      continue;
    }

    const status = statusOf(graph, requirement, hop, reached);

    links.push({
      hop: hop.key,
      status,
      nodeIds: reached.map((n) => n.id),
      detail: detailFor(status, hop, reached),
    });

    if (hop.required && status !== 'LINKED' && brokeAt === undefined) brokeAt = hop.key;
  }

  const complete = links.every(
    (link) =>
      link.status === 'LINKED' ||
      link.status === 'NOT_REQUIRED' ||
      (link.status === 'MISSING' && !required(link.hop)),
  );

  return {
    requirementId,
    requirementLabel: requirement.label,
    links,
    complete,
    ...(brokeAt === undefined ? {} : { brokeAt }),
  };
}

/** Every requirement in the graph, traced, in graph order. */
export function traceAll(graph: TwinGraph): readonly ChainTrace[] {
  return graph.nodesOfClass('REQUIREMENT').map((node) => traceRequirement(graph, node.id));
}

function required(key: HopKey): boolean {
  return CHAIN.find((hop) => hop.key === key)?.required ?? false;
}

/** Nodes of the hop's target class reachable from the frontier along the hop's edge. */
function step(graph: TwinGraph, frontier: readonly TwinNode[], hop: Hop): readonly TwinNode[] {
  const seen = new Set<string>();
  const out: TwinNode[] = [];

  for (const from of frontier) {
    const edges =
      hop.direction === 'OUTBOUND'
        ? graph.edgesFrom(from.id, hop.via)
        : graph.edgesTo(from.id, hop.via);

    for (const edge of edges) {
      const id = hop.direction === 'OUTBOUND' ? edge.to : edge.from;
      if (seen.has(id)) continue;

      const node = graph.node(id);
      if (node?.class !== hop.to) continue;

      // Withdrawn nodes are retained in the graph as a record of what was believed, but they cannot
      // carry a live claim. A chain resting on a withdrawn test is not a chain.
      if (node.state === 'WITHDRAWN') continue;

      seen.add(id);
      out.push(node);
    }
  }

  return out;
}

/**
 * The status of a hop that reached something.
 *
 * Order matters: staleness is checked before usability, because a stale node that also passed is
 * still stale, and reporting it as merely unverified would understate what is wrong with it.
 */
function statusOf(
  graph: TwinGraph,
  requirement: TwinNode,
  hop: Hop,
  reached: readonly TwinNode[],
): LinkStatus {
  const current = reached.filter((node) => !attestsToAnOlderRevision(node, requirement));

  if (current.length === 0) return 'STALE';

  const usable = current.filter((node) => isUsable(graph, node, hop));

  return usable.length === 0 ? 'UNVERIFIED' : 'LINKED';
}

/**
 * Whether this node's claim is about an older version of the requirement.
 *
 * The node records which revision it was captured against. A node that records nothing is treated as
 * *not* stale — it might be current — but it also cannot be treated as usable evidence, and
 * `isUsable` refuses it. Guessing either way here would be worse: assuming stale would flood the
 * report with false gaps, and assuming current would hide the real ones.
 */
function attestsToAnOlderRevision(node: TwinNode, requirement: TwinNode): boolean {
  const attests = node.attributes.attests;
  if (!Array.isArray(attests)) return false;

  for (const entry of attests) {
    if (typeof entry !== 'object' || entry === null) continue;

    const record = entry as Record<string, unknown>;
    if (record.nodeId !== requirement.id) continue;
    if (typeof record.revision !== 'number') continue;

    return record.revision < requirement.revision;
  }

  return false;
}

/** Whether a node reached at this hop can actually support the claim the hop makes. */
function isUsable(graph: TwinGraph, node: TwinNode, hop: Hop): boolean {
  switch (hop.key) {
    case 'TEST': {
      // A test that has never run verifies nothing. It is real work and it is not yet a result.
      const outcome = node.attributes.outcome;
      return outcome === 'PASSED';
    }

    case 'EVIDENCE': {
      // §32: evidence stores a hash of the artefact. Without one there is nothing to check the
      // artefact against, so the record is a note rather than evidence.
      return typeof node.attributes.hash === 'string' && node.attributes.hash !== '';
    }

    case 'APPROVAL': {
      // §33: an approval is a decision by a named person. Pending is not a decision, and an approval
      // with no approver recorded cannot be relied on by whoever asks later.
      return (
        node.attributes.decision === 'APPROVED' && typeof node.attributes.approver === 'string'
      );
    }

    case 'RELEASE': {
      return node.attributes.outcome === 'SUCCEEDED';
    }

    case 'WORK': {
      // Work in any state counts as linked: the hop asks whether somebody is doing something about
      // the requirement, not whether they have finished. Whether the work is *done* is the
      // execution board's question, and answering it twice in two places invites the two to disagree.
      return true;
    }

    case 'DESIGN': {
      return graph.node(node.id) !== undefined;
    }
  }
}

function detailFor(status: LinkStatus, hop: Hop, reached: readonly TwinNode[]): string {
  const names = reached.map((n) => n.label).join(', ');

  switch (status) {
    case 'LINKED':
      return `${hop.label}: ${names}`;

    case 'STALE':
      return `${names} attests to an earlier revision of this requirement. Every link is present, but what was demonstrated is not what the requirement now says.`;

    case 'UNVERIFIED':
      return unverifiedDetail(hop, names);

    case 'MISSING':
    case 'NOT_REQUIRED':
      return hop.absenceMeans;
  }
}

function unverifiedDetail(hop: Hop, names: string): string {
  switch (hop.key) {
    case 'TEST':
      return `${names} exists but has not passed. A test that has never run verifies nothing, and counting it would mean the report improves the moment somebody writes a test file.`;
    case 'EVIDENCE':
      return `${names} records no artefact hash, so there is nothing to check the artefact against.`;
    case 'APPROVAL':
      return `${names} has not been decided by a named person.`;
    case 'RELEASE':
      return `${names} has not succeeded.`;

    // Neither hop can reach UNVERIFIED — work counts in any state, and design is usable whenever it
    // resolves — but they are listed rather than defaulted so that adding a usability rule to either
    // one fails the exhaustiveness check instead of silently landing on a generic sentence.
    case 'DESIGN':
    case 'WORK':
      return `${names} cannot yet support this link.`;
  }
}
