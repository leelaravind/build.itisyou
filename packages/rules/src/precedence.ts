/**
 * Rule precedence and conflict handling.
 *
 * Contract: gap-spec §13.2 gives the order and adds one instruction that shapes this whole file:
 * **"Never resolve conflicting critical rules silently."**
 *
 * That sentence rules out the obvious implementation. The easy thing is to sort by precedence, take
 * the winner, and move on — which produces a plan that looks decided when it is not. If a legal
 * obligation and an explicit project constraint genuinely contradict each other, nobody in this
 * system is entitled to pick. The user has to know, because resolving it may mean changing the
 * project rather than changing a setting.
 *
 * So the resolution has two outcomes, not one:
 *
 * - **Ordinary conflicts** — a recommended default undercut by a project-type pack — resolve by
 *   precedence and record what was overridden, so it can be explained.
 * - **Critical conflicts** — two `MANDATORY` rules from different sources demanding incompatible
 *   things — resolve to *nothing*. They are reported, and whatever depended on them stays blocked.
 */

import type { Rule, RuleSeverity, RuleSource } from './schema.ts';

/**
 * Precedence, most authoritative first. Gap-spec §13.2, verbatim.
 *
 * The order is not arbitrary and is worth reading as an argument. Legal and security obligations sit
 * above organisational policy because an organisation cannot policy its way out of the law. Explicit
 * project constraints sit above the project-type pack because the person doing the work knows
 * something the taxonomy does not. Recommended defaults sit last because that is what a default is.
 */
export const SOURCE_PRECEDENCE: readonly RuleSource[] = [
  'LEGAL_SECURITY',
  'ORGANIZATION_POLICY',
  'PROJECT_CONSTRAINT',
  'PROJECT_TYPE_PACK',
  'METHODOLOGY_PACK',
  'RECOMMENDED_DEFAULT',
];

const RANK: Readonly<Record<RuleSource, number>> = Object.fromEntries(
  SOURCE_PRECEDENCE.map((source, index) => [source, index]),
) as Record<RuleSource, number>;

/** Lower is more authoritative. */
export function precedenceOf(source: RuleSource): number {
  return RANK[source];
}

/** Whether `a` outranks `b`. Equal sources do not outrank each other — see `resolveConflict`. */
export function outranks(a: RuleSource, b: RuleSource): boolean {
  return precedenceOf(a) < precedenceOf(b);
}

/* -------------------------------------------------------------------------- */
/* Conflicts                                                                  */
/* -------------------------------------------------------------------------- */

export type ConflictKind = 'RESOLVED' | 'UNRESOLVABLE';

export interface Conflict {
  readonly kind: ConflictKind;
  /** What the rules disagree about — an emitted key, a gate criterion, a calculation. */
  readonly subject: string;
  readonly ruleIds: readonly string[];
  /** Present only when the conflict resolved. */
  readonly winnerId?: string;
  /** Written for the person who has to do something about it. */
  readonly explanation: string;
}

/**
 * Whether two rules are in genuine conflict over the same subject.
 *
 * Two rules emitting the same key is the common case and usually *not* a conflict: several rules
 * legitimately converge on "authentication must be tested". It is only a conflict when they say
 * incompatible things — which, in this DSL, means differing on a value the evaluator must pick one
 * of: a requirement's priority, or whether a gate criterion blocks.
 *
 * Rules that agree are merged, not adjudicated. Reporting agreement as conflict would fill the list
 * with noise and teach people to skim it.
 */
export function conflictsOver(a: Rule, b: Rule): readonly string[] {
  const subjects: string[] = [];

  const aRequirements = new Map(a.emittedRequirements.map((r) => [r.key, r]));
  for (const requirement of b.emittedRequirements) {
    const other = aRequirements.get(requirement.key);
    if (other === undefined) continue;
    if (other.priority !== requirement.priority) subjects.push(`requirement:${requirement.key}`);
  }

  const aGates = new Map(a.emittedGates.map((g) => [`${g.gateKey}:${g.criterion}`, g]));
  for (const gate of b.emittedGates) {
    const other = aGates.get(`${gate.gateKey}:${gate.criterion}`);
    if (other === undefined) continue;
    if (other.blocking !== gate.blocking) subjects.push(`gate:${gate.gateKey}`);
  }

  return subjects;
}

/**
 * Decide a conflict, or refuse to.
 *
 * The refusal is the important half. Two `MANDATORY` rules from *different* sources that contradict
 * each other are not something precedence should settle: a legal obligation losing to nothing, or an
 * explicit project constraint being silently overruled, are both decisions with consequences the
 * engine cannot weigh.
 *
 * Two mandatory rules from the *same* source contradicting each other is a catalogue defect, not a
 * project problem — and it is reported as unresolvable too, because the alternative is picking
 * arbitrarily between two rules that were both written deliberately.
 */
export function resolveConflict(subject: string, rules: readonly Rule[]): Conflict {
  const ids = [...rules].map((r) => r.id).sort();

  const mandatory = rules.filter((r) => r.severity === 'MANDATORY');

  if (mandatory.length > 1) {
    return {
      kind: 'UNRESOLVABLE',
      subject,
      ruleIds: ids,
      explanation: unresolvableExplanation(subject, mandatory),
    };
  }

  // Sorted by precedence, then by id so the outcome does not depend on catalogue order.
  const ordered = [...rules].sort(
    (a, b) => precedenceOf(a.source) - precedenceOf(b.source) || a.id.localeCompare(b.id),
  );

  const winner = ordered[0];
  const losers = ordered.slice(1);

  if (winner === undefined) {
    return {
      kind: 'UNRESOLVABLE',
      subject,
      ruleIds: ids,
      explanation: 'A conflict was reported with no rules attached to it.',
    };
  }

  /*
   * Equal precedence with no mandatory rule is still not decidable by this function — precedence is
   * the only tiebreaker it has, and it has run out. Reported rather than settled by id order, which
   * would be arbitrary dressed up as deterministic.
   */
  const tied = losers.filter((r) => r.source === winner.source);
  if (tied.length > 0) {
    return {
      kind: 'UNRESOLVABLE',
      subject,
      ruleIds: ids,
      explanation:
        `${describeSubject(subject)} is decided differently by ${String(tied.length + 1)} rules of equal authority ` +
        `(${[winner, ...tied].map((r) => r.id).join(', ')}). Nothing in the ruleset ranks them, so the platform will not choose.`,
    };
  }

  return {
    kind: 'RESOLVED',
    subject,
    ruleIds: ids,
    winnerId: winner.id,
    explanation:
      `${describeSubject(subject)} follows ${winner.id} (${describeSource(winner.source)}), ` +
      `which takes precedence over ${losers.map((r) => `${r.id} (${describeSource(r.source)})`).join(', ')}.`,
  };
}

function unresolvableExplanation(subject: string, mandatory: readonly Rule[]): string {
  const sources = new Set(mandatory.map((r) => r.source));

  const shared =
    sources.size === 1
      ? 'Both are mandatory and come from the same authority, so this is a defect in the ruleset rather than in the project.'
      : 'Both are mandatory and come from different authorities. Resolving this may mean changing the project, not a setting.';

  return (
    `${describeSubject(subject)} is required to be two different things by ` +
    `${mandatory.map((r) => `${r.id} (${describeSource(r.source)})`).join(' and ')}. ` +
    `${shared} Nothing that depends on it can proceed until someone decides.`
  );
}

function describeSubject(subject: string): string {
  const [kind, ...rest] = subject.split(':');
  const name = rest.join(':');

  if (kind === 'requirement') return `The requirement “${name}”`;
  if (kind === 'gate') return `The “${name}” gate`;
  if (kind === 'calculation') return `The calculation “${name}”`;
  return `“${subject}”`;
}

export function describeSource(source: RuleSource): string {
  const labels: Record<RuleSource, string> = {
    LEGAL_SECURITY: 'a legal or security obligation',
    ORGANIZATION_POLICY: 'organisation policy',
    PROJECT_CONSTRAINT: 'an explicit project constraint',
    PROJECT_TYPE_PACK: 'the project-type rules',
    METHODOLOGY_PACK: 'the methodology rules',
    RECOMMENDED_DEFAULT: 'a recommended default',
  };

  return labels[source];
}

export function describeSeverity(severity: RuleSeverity): string {
  const labels: Record<RuleSeverity, string> = {
    MANDATORY: 'blocks the gate',
    RECOMMENDED: 'strongly advised',
    ADVISORY: 'worth considering',
  };

  return labels[severity];
}
