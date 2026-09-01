/**
 * The project lifecycle state machine.
 *
 * Contract: plan §6 — twelve canonical states, "no arbitrary state changes", transitions "centrally
 * validated", and golden tests for **every allowed and prohibited transition**.
 *
 * The design decision that matters here is that a transition is not a permission check. Whether the
 * user is *allowed* to move a project to APPROVED is RBAC's question, and it is answered elsewhere.
 * This file answers a different one: whether the project is *in a state where that move means
 * anything*. A project moved to RELEASE_READY with no testing evidence is not a project that has
 * been approved too eagerly — it is a project whose recorded state is now false.
 *
 * Both questions have to be answered, and conflating them is how a system ends up with a status
 * field that reflects who clicked what rather than what is true.
 */

import { AppError } from '@govintel/shared/errors';

/* -------------------------------------------------------------------------- */
/* States                                                                     */
/* -------------------------------------------------------------------------- */

/** Plan §6, in order. Matches `lifecycleStateEnum` in the database schema. */
export const LIFECYCLE_STATES = [
  'IDEA',
  'DISCOVERY',
  'PLANNING',
  'PLANNED',
  'APPROVED',
  'IN_PROGRESS',
  'VERIFYING',
  'RELEASE_READY',
  'LIVE',
  'OPERATING',
  'COMPLETED',
  'ARCHIVED',
] as const;

export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

const STATE_SET: ReadonlySet<string> = new Set<string>(LIFECYCLE_STATES);

export function isLifecycleState(value: string): value is LifecycleState {
  return STATE_SET.has(value);
}

/** What each state means, for the UI and for anyone reading a transition refusal. */
export const STATE_DESCRIPTION: Readonly<Record<LifecycleState, string>> = {
  IDEA: 'An idea with nothing established yet.',
  DISCOVERY: 'Working out what is being built and for whom.',
  PLANNING: 'Turning what is known into a plan.',
  PLANNED: 'A plan exists and is internally consistent.',
  APPROVED: 'Someone with the authority has agreed to it.',
  IN_PROGRESS: 'Being built.',
  VERIFYING: 'Being checked against what was agreed.',
  RELEASE_READY: 'Verified, and cleared to go out.',
  LIVE: 'Released, and being watched.',
  OPERATING: 'Verified in production and being run.',
  COMPLETED: 'Handed over and closed.',
  ARCHIVED: 'Read-only. Kept as a record.',
};

/* -------------------------------------------------------------------------- */
/* Transitions                                                                */
/* -------------------------------------------------------------------------- */

/**
 * What a transition requires beyond simply being adjacent.
 *
 * `gates` names the quality gates that must have passed. Plan §6 gives six of these explicitly and
 * they are reproduced verbatim; the rest follow the same logic.
 */
export interface TransitionRule {
  readonly from: LifecycleState;
  readonly to: LifecycleState;
  /** Gate keys from `gates.ts` that must be PASSED. */
  readonly gates: readonly string[];
  /** Why this transition exists, and what it asserts about the project. */
  readonly meaning: string;
}

/**
 * Every permitted transition. Anything not listed is refused.
 *
 * Deny-by-default again, and for the same reason as the graph's edge legality: the interesting
 * transitions are the ones nobody thought about. A permitted-unless-forbidden machine would allow
 * IDEA → LIVE, which is not a state change but a lie.
 *
 * Backwards transitions are deliberately present. Real projects go back: verification finds
 * something, and the project returns to IN_PROGRESS. A machine that only moves forward forces people
 * to lie about where they are, which is worse than the mess it was trying to prevent.
 */
export const TRANSITIONS: readonly TransitionRule[] = [
  {
    from: 'IDEA',
    to: 'DISCOVERY',
    gates: [],
    meaning: 'Someone has started establishing what this actually is.',
  },
  {
    from: 'DISCOVERY',
    to: 'PLANNING',
    gates: ['DISCOVERY'],
    meaning: 'Enough is known about the objective, the type and the constraints to plan against.',
  },
  {
    from: 'PLANNING',
    to: 'PLANNED',
    gates: ['REQUIREMENTS', 'ARCHITECTURE', 'PLANNING'],
    meaning: 'A plan exists, its dependencies are valid and its estimates are present.',
  },
  {
    from: 'PLANNED',
    to: 'APPROVED',
    gates: ['PLANNING'],
    // Plan §6: "PLANNED → APPROVED requires required approvals." The approval itself is an APPROVAL
    // node in the graph; the gate checks it exists rather than asserting it here.
    meaning: 'Someone with the authority to commit the money and the time has agreed to the plan.',
  },
  {
    from: 'APPROVED',
    to: 'IN_PROGRESS',
    gates: [],
    meaning: 'Work has started.',
  },
  {
    from: 'IN_PROGRESS',
    to: 'VERIFYING',
    gates: ['DEVELOPMENT'],
    meaning: 'The scope for this release is built and ready to be checked.',
  },
  {
    from: 'VERIFYING',
    to: 'IN_PROGRESS',
    gates: [],
    // No gate. Going back because verification found something is the system working, and putting an
    // obstacle in front of it would encourage people to press on instead.
    meaning: 'Verification found something that needs building differently.',
  },
  {
    from: 'VERIFYING',
    to: 'RELEASE_READY',
    gates: ['TESTING', 'SECURITY', 'RELEASE_READINESS'],
    meaning: 'Tested, security-reviewed, and everything needed to release exists.',
  },
  {
    from: 'RELEASE_READY',
    to: 'VERIFYING',
    gates: [],
    meaning: 'Something changed, so the verification has to be redone.',
  },
  {
    from: 'RELEASE_READY',
    to: 'LIVE',
    gates: ['RELEASE_READINESS'],
    meaning: 'Deployment has been authorised and carried out.',
  },
  {
    from: 'LIVE',
    to: 'OPERATING',
    gates: ['PRODUCTION_VERIFICATION'],
    meaning: 'What is running in production has been verified as what was released.',
  },
  {
    from: 'LIVE',
    to: 'VERIFYING',
    gates: [],
    // The rollback path. A release that went wrong must be able to go backwards without anyone having
    // to invent a state for it.
    meaning: 'The release was withdrawn or rolled back.',
  },
  {
    from: 'OPERATING',
    to: 'IN_PROGRESS',
    gates: [],
    meaning: 'Further work has started on a system that is already running.',
  },
  {
    from: 'OPERATING',
    to: 'COMPLETED',
    gates: ['OPERATIONAL_READINESS', 'COMPLETION'],
    meaning: 'Handed over, with ownership and outstanding debt recorded.',
  },
  {
    from: 'COMPLETED',
    to: 'ARCHIVED',
    gates: [],
    meaning: 'Closed and made read-only.',
  },
  {
    from: 'ARCHIVED',
    to: 'COMPLETED',
    gates: [],
    // Gap-spec §8.3 permits restoration explicitly. Archival is not deletion, and a one-way door
    // would make people avoid archiving things that should be archived.
    meaning: 'Restored from the archive so it can be worked on again.',
  },
  {
    from: 'PLANNED',
    to: 'PLANNING',
    gates: [],
    meaning: 'The plan needs revisiting before it is approved.',
  },
  {
    from: 'APPROVED',
    to: 'PLANNING',
    gates: [],
    meaning: 'Something changed enough that the approved plan no longer holds.',
  },
  {
    from: 'DISCOVERY',
    to: 'IDEA',
    gates: [],
    meaning: 'Discovery established that this is not yet a project.',
  },
];

/**
 * Archiving from anywhere.
 *
 * A project can be abandoned at any point, and forcing it through COMPLETED first would mean
 * recording that it was handed over when it was not. Kept separate from `TRANSITIONS` so the table
 * above stays a description of the *normal* path rather than being swamped by twelve archive edges.
 */
export const ARCHIVABLE_FROM: readonly LifecycleState[] = LIFECYCLE_STATES.filter(
  (s) => s !== 'ARCHIVED',
);

/* -------------------------------------------------------------------------- */
/* Checking                                                                   */
/* -------------------------------------------------------------------------- */

export type TransitionCheck =
  | { readonly ok: true; readonly requiredGates: readonly string[]; readonly meaning: string }
  | { readonly ok: false; readonly code: TransitionRefusal; readonly reason: string };

export type TransitionRefusal =
  'UNKNOWN_STATE' | 'SAME_STATE' | 'NOT_PERMITTED' | 'GATE_NOT_PASSED';

/**
 * Whether a transition is structurally permitted, and what it would require.
 *
 * Does not check gates — the caller supplies gate results to `checkTransition`. Split so the UI can
 * show "moving to RELEASE_READY needs the testing, security and release gates" *before* the user
 * tries, rather than only telling them after they fail.
 */
export function findTransition(from: string, to: string): TransitionCheck {
  if (!isLifecycleState(from) || !isLifecycleState(to)) {
    return {
      ok: false,
      code: 'UNKNOWN_STATE',
      reason: 'That is not a state this platform recognises.',
    };
  }

  if (from === to) {
    return {
      ok: false,
      code: 'SAME_STATE',
      reason: `This project is already ${describeState(from)}.`,
    };
  }

  if (to === 'ARCHIVED' && ARCHIVABLE_FROM.includes(from)) {
    return {
      ok: true,
      requiredGates: [],
      meaning: 'Archived. Kept as a read-only record.',
    };
  }

  const rule = TRANSITIONS.find((t) => t.from === from && t.to === to);

  if (rule === undefined) {
    return {
      ok: false,
      code: 'NOT_PERMITTED',
      reason: `A project cannot go straight from ${describeState(from)} to ${describeState(to)}. ${suggestPath(from, to)}`,
    };
  }

  return { ok: true, requiredGates: rule.gates, meaning: rule.meaning };
}

export interface GateStatus {
  readonly key: string;
  readonly passed: boolean;
}

/**
 * The full check: permitted *and* the required gates have passed.
 *
 * A gate that has not been evaluated counts as not passed. Treating unevaluated as satisfied would
 * make every gate optional for anyone who simply never ran it, which is the same failure as a
 * security control that is only enforced when someone remembers to enable it.
 */
export function checkTransition(
  from: string,
  to: string,
  gates: readonly GateStatus[],
): TransitionCheck {
  const structural = findTransition(from, to);
  if (!structural.ok) return structural;

  const passed = new Set(gates.filter((g) => g.passed).map((g) => g.key));
  const outstanding = structural.requiredGates.filter((key) => !passed.has(key));

  if (outstanding.length > 0) {
    return {
      ok: false,
      code: 'GATE_NOT_PASSED',
      reason:
        outstanding.length === 1
          ? `The ${describeGate(outstanding[0] ?? '')} gate has not passed, so moving to ${describeState(to as LifecycleState)} would record something that is not true.`
          : `${String(outstanding.length)} gates have not passed (${outstanding.map(describeGate).join(', ')}), so moving to ${describeState(to as LifecycleState)} would record something that is not true.`,
    };
  }

  return structural;
}

/**
 * Perform a transition, or throw.
 *
 * For call sites where a refused transition is a bug rather than a case — a background process
 * advancing a project it has already checked.
 */
export function assertTransition(from: string, to: string, gates: readonly GateStatus[]): void {
  const check = checkTransition(from, to, gates);
  if (check.ok) return;

  throw new AppError({
    code: `LIFECYCLE_${check.code}`,
    category: check.code === 'GATE_NOT_PASSED' ? 'CONFLICT' : 'VALIDATION',
    safeMessage: check.reason,
    details: { from, to },
  });
}

/** Every state reachable from here in one step. For rendering the available actions. */
export function nextStates(from: string): readonly LifecycleState[] {
  if (!isLifecycleState(from)) return [];

  const direct = TRANSITIONS.filter((t) => t.from === from).map((t) => t.to);
  const archive: LifecycleState[] = ARCHIVABLE_FROM.includes(from) ? ['ARCHIVED'] : [];

  return [...new Set([...direct, ...archive])].sort();
}

/* -------------------------------------------------------------------------- */
/* Prose                                                                      */
/* -------------------------------------------------------------------------- */

export function describeState(state: LifecycleState): string {
  return state.toLowerCase().replace(/_/g, ' ');
}

function describeGate(key: string): string {
  return key.toLowerCase().replace(/_/g, ' ');
}

/**
 * A refusal that says what the user should do instead.
 *
 * "You cannot do that" with no alternative is where people start looking for a way around the
 * system. A shortest path through the permitted transitions is the honest answer to "then how?".
 */
function suggestPath(from: LifecycleState, to: LifecycleState): string {
  const path = shortestPath(from, to);

  if (path === null) {
    return `There is no route from ${describeState(from)} to ${describeState(to)}.`;
  }

  const steps = path.slice(1).map(describeState);
  return `It would need to go through ${steps.join(', then ')}.`;
}

/** Breadth-first over the permitted transitions. Ties broken by state order for determinism. */
export function shortestPath(from: LifecycleState, to: LifecycleState): LifecycleState[] | null {
  if (from === to) return [from];

  const queue: LifecycleState[][] = [[from]];
  const seen = new Set<LifecycleState>([from]);

  while (queue.length > 0) {
    const path = queue.shift();
    if (path === undefined) break;

    const last = path[path.length - 1];
    if (last === undefined) continue;

    for (const next of nextStates(last)) {
      if (seen.has(next)) continue;
      const extended = [...path, next];
      if (next === to) return extended;
      seen.add(next);
      queue.push(extended);
    }
  }

  return null;
}
