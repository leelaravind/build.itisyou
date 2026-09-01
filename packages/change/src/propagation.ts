/**
 * How change propagates through the twin.
 *
 * Gap-spec §27: "Every relationship type must define whether change propagates." The important word
 * is *whether*. The obvious implementation propagates through every edge, and it is useless: a
 * requirement change reports forty-seven affected items, everything in the project is connected to
 * everything eventually, and people stop reading the impact report by the third one they see.
 *
 * So propagation is a **deny-by-default allowlist**, exactly like edge legality and RBAC. An edge
 * class with no rule below does not propagate, and adding one is a decision somebody makes on
 * purpose. Roughly half the edge classes carry no propagation at all, and that is the design working
 * rather than the model being incomplete.
 *
 * The second decision is that propagation weakens with distance. A test verifying a changed
 * requirement is *invalidated*; the evidence behind that test is *stale*; a document two hops further
 * out merely needs review. Treating all three as invalidated would make every change look
 * catastrophic; treating them all as advisory would let a genuinely broken claim survive.
 *
 * Contract: gap-spec §26 (dependency graph), §27 (impact propagation), §27.1 (staleness).
 */

import type { EdgeClass } from '@govintel/twin/edges';
import type { NodeClass } from '@govintel/twin/nodes';

/* -------------------------------------------------------------------------- */
/* Staleness                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * §27.1's four states, in order of severity.
 *
 * The spec is explicit that dependent evidence is **never deleted automatically**, and these four
 * are why that works: a marked artefact still carries what it showed and when, so a reviewer can
 * decide whether the change actually affected it. Deleting it destroys the only record of what was
 * true before.
 *
 * The distinction that does the work is `STALE` versus `INVALIDATED`. Stale means the claim was made
 * against an older version and *might* still hold — somebody has to look. Invalidated means it
 * definitely does not hold any more. Collapsing them either buries real breakage in a pile of
 * maybes, or makes every change look like it destroyed the project.
 */
export const STALENESS = ['CURRENT', 'STALE', 'REVALIDATION_REQUIRED', 'INVALIDATED'] as const;

export type Staleness = (typeof STALENESS)[number];

const STALENESS_RANK: Readonly<Record<Staleness, number>> = {
  CURRENT: 0,
  STALE: 1,
  REVALIDATION_REQUIRED: 2,
  INVALIDATED: 3,
};

export const STALENESS_MEANING: Readonly<Record<Staleness, string>> = {
  CURRENT: 'Unaffected by this change.',
  STALE: 'Made against an older version. It may still hold; somebody has to look.',
  REVALIDATION_REQUIRED:
    'Must be re-run or re-decided before it can be relied on again. Not necessarily wrong — unverifiable until somebody does the work.',
  INVALIDATED:
    'No longer holds. What it demonstrated was about something that has since changed materially.',
};

/** The worse of two states. Impact arriving by two paths takes the worse, never the average. */
export function worse(a: Staleness, b: Staleness): Staleness {
  return STALENESS_RANK[a] >= STALENESS_RANK[b] ? a : b;
}

/**
 * Weaken a staleness by one step, for each additional hop from the change.
 *
 * Distance is a real signal. A test verifying the changed requirement is directly about it; a
 * document three hops out is about something that is about something that changed. Propagating
 * full severity across the whole reachable graph is how impact analysis becomes noise.
 */
export function weaken(state: Staleness): Staleness {
  switch (state) {
    case 'INVALIDATED':
      return 'REVALIDATION_REQUIRED';
    case 'REVALIDATION_REQUIRED':
      return 'STALE';
    case 'STALE':
    case 'CURRENT':
      return 'CURRENT';
  }
}

/* -------------------------------------------------------------------------- */
/* What changed                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The kind of change, because not every edit propagates the same way.
 *
 * `COSMETIC` exists specifically so that renaming a requirement does not invalidate its test suite.
 * Without it, every impact report is dominated by edits that changed nothing anybody depends on, and
 * the reports that matter get lost among them.
 */
export const CHANGE_KINDS = [
  /** The substance changed: what the thing requires, does or costs. */
  'MATERIAL',
  /** Wording, labels, formatting. Nothing that anything downstream depends on. */
  'COSMETIC',
  /** The thing was withdrawn. Stronger than material: dependants have lost their subject. */
  'WITHDRAWAL',
  /** Something new. Nothing depends on it yet, so it propagates to nothing. */
  'ADDITION',
] as const;

export type ChangeKind = (typeof CHANGE_KINDS)[number];

/* -------------------------------------------------------------------------- */
/* The propagation rules                                                      */
/* -------------------------------------------------------------------------- */

export interface PropagationRule {
  readonly edge: EdgeClass;
  /**
   * Which way impact travels along this edge, relative to how the edge is stored.
   *
   * `INBOUND` means impact travels from the edge's target to its source — a TEST *verifies* a
   * REQUIREMENT, so when the requirement changes, impact reaches the test by walking the edge
   * backwards. Getting this wrong produces an impact report that is confidently empty, which is the
   * failure mode the traceability chain already ran into once.
   */
  readonly direction: 'OUTBOUND' | 'INBOUND';
  /** What reaching a node along this edge does to it. */
  readonly effect: Staleness;
  /** Why, in terms a reader can disagree with. */
  readonly because: string;
}

/**
 * Deny-by-default: an edge class absent from this list does not propagate.
 *
 * Nine of the seventeen edge classes are absent, and each absence is deliberate. `OWNED_BY` does not
 * propagate because changing a requirement does not affect its owner. `CONTAINS` does not propagate
 * because a project containing a changed task is not itself stale — propagating up containment makes
 * every change reach the project root, and from the root everything is reachable.
 */
export const PROPAGATION: readonly PropagationRule[] = [
  {
    edge: 'VERIFIES',
    direction: 'INBOUND',
    effect: 'INVALIDATED',
    because:
      'A test verifies a specific claim. When the claim changes, what the test demonstrated is no longer about the current requirement — it passed against something else.',
  },
  {
    edge: 'EVIDENCED_BY',
    direction: 'OUTBOUND',
    effect: 'STALE',
    because:
      'The artefact still records what happened when it was captured. Whether it still supports the claim depends on what changed, and that is a judgement rather than a deduction.',
  },
  {
    edge: 'IMPLEMENTS',
    direction: 'INBOUND',
    effect: 'REVALIDATION_REQUIRED',
    because:
      'Work built to meet a requirement that has since changed may be right, wrong, or half-right. Somebody has to compare it against the new version; the graph cannot.',
  },
  {
    edge: 'SATISFIES',
    direction: 'INBOUND',
    effect: 'REVALIDATION_REQUIRED',
    because: 'What satisfied the old version may not satisfy the new one.',
  },
  {
    edge: 'DERIVED_FROM',
    direction: 'INBOUND',
    effect: 'STALE',
    because:
      'A derived value was computed from an input that has changed. It is reproducible, so it is stale rather than invalid — recalculating is cheap and the old value is still the record of what was believed.',
  },
  {
    edge: 'APPROVED_BY',
    direction: 'OUTBOUND',
    effect: 'INVALIDATED',
    because:
      '§33: an approval is a decision about a specific version of a subject. When the subject changes materially, the approver approved something else, and treating their decision as still standing would put their name on a choice they did not make.',
  },
  {
    edge: 'DEPENDS_ON',
    direction: 'INBOUND',
    effect: 'REVALIDATION_REQUIRED',
    because:
      'Something built on this may no longer be built on what it thought. The dependant is not wrong yet, and it cannot be assumed right.',
  },
  {
    edge: 'MITIGATES',
    direction: 'OUTBOUND',
    effect: 'REVALIDATION_REQUIRED',
    because:
      'A mitigation was chosen for a risk as it stood. If the risk changed, whether the mitigation still addresses it is exactly the question nobody asks unless prompted.',
  },
];

const BY_EDGE = new Map(PROPAGATION.map((rule) => [rule.edge, rule]));

/** The rule for an edge class, or `undefined` when it does not propagate. */
export function ruleFor(edge: EdgeClass): PropagationRule | undefined {
  return BY_EDGE.get(edge);
}

/** Whether change propagates along this edge at all. */
export function propagates(edge: EdgeClass): boolean {
  return BY_EDGE.has(edge);
}

/* -------------------------------------------------------------------------- */
/* Change kind                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The effect an edge produces, adjusted for what kind of change it was.
 *
 * `COSMETIC` produces nothing at all. That is the rule that keeps impact reports readable: a project
 * where renaming a requirement invalidates its tests is one where the impact report is mostly noise,
 * and a report that is mostly noise gets skimmed — including on the occasion it matters.
 *
 * `WITHDRAWAL` escalates rather than propagating normally, because dependants have not merely lost
 * currency, they have lost their subject.
 */
export function effectOf(rule: PropagationRule, kind: ChangeKind): Staleness | undefined {
  switch (kind) {
    case 'COSMETIC':
      return undefined;

    case 'ADDITION':
      // Nothing pointed at it before it existed. An addition that *should* have invalidated
      // something is really a material change to whatever it displaces, and that is recorded there.
      return undefined;

    case 'WITHDRAWAL':
      return 'INVALIDATED';

    case 'MATERIAL':
      return rule.effect;
  }
}

/* -------------------------------------------------------------------------- */
/* Node classes that carry a claim                                            */
/* -------------------------------------------------------------------------- */

/**
 * Classes whose staleness a person actually needs to act on.
 *
 * A stale `PHASE` is not something anybody can do anything about; a stale `EVIDENCE` is. Impact still
 * traverses through everything the rules allow — the path matters — but the report leads with the
 * classes that carry a claim somebody signed up to.
 */
export const CLAIM_BEARING: readonly NodeClass[] = [
  'REQUIREMENT',
  'ARCHITECTURE_DECISION',
  'TEST',
  'EVIDENCE',
  'APPROVAL',
  'GATE',
  'BASELINE',
  'DOCUMENT',
  'DEPLOYMENT',
  'ESTIMATE',
  'BUDGET_ITEM',
];

export function bearsClaim(nodeClass: NodeClass): boolean {
  return CLAIM_BEARING.includes(nodeClass);
}
