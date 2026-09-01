/**
 * The project lifecycle state machine.
 *
 * Contract: plan §6 — twelve canonical states, *"No arbitrary state changes. Transitions must be
 * centrally validated."*, and six named examples of what a transition requires.
 *
 * ## Why this exists
 *
 * It did not, until now. `projects.lifecycle_state` has defaulted to `IDEA` since Phase 3 and no code
 * path has ever written it, so every project ever created — 3,872 on staging — was permanently an
 * idea. The gates were computed, the rules ran, the twin was built, and none of it could move a
 * project forward, because there was nothing to move it with.
 *
 * ## The shape of the decision
 *
 * A transition is allowed when three things hold, checked in this order:
 *
 * 1. The edge exists in `TRANSITIONS`. Anything else is not a transition, it is an edit.
 * 2. Every gate the edge requires has **passed**. Not "not failed" — `INDETERMINATE` is a refusal,
 *    because a gate nobody evaluated is not a gate anybody satisfied (§15.9's own rule, applied to
 *    the thing that consumes it).
 * 3. Every approval the edge requires is granted and current. A stale approval — one given against
 *    an older version of the subject — does not count, which is `isStale`'s whole purpose.
 *
 * Refusals name what is missing rather than saying no. An operator who cannot see which gate blocked
 * them will ask somebody to remove the gate.
 *
 * ## What is deliberately absent: backward transitions
 *
 * The contract names twelve states and six forward examples. It names no backward edge, and inventing
 * one would be inventing policy — specifically, policy about how a project un-ships, which is exactly
 * the kind of thing an organisation needs to decide rather than inherit from a default.
 *
 * There is also already a mechanism for reworking something that has moved on: a change request
 * (§28), which carries impact analysis and an approval. Letting a project quietly slide from
 * `VERIFYING` back to `IN_PROGRESS` would route around it.
 *
 * `ARCHIVED → COMPLETED` is the single exception, because §71 requires an archive to be restorable
 * by an authorised role. That is a restore, not a reversal.
 */

import type { GateKey } from '@govintel/rules/gates';
import type { ProjectRole } from '@govintel/shared/roles';
import { isStale, type Approval, type ApprovableSubject } from './approval.ts';

/** The twelve canonical states, in order (plan §6). */
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

/** A gate result, as `packages/rules` reports it. Structural, so this module needs no import of it. */
export interface GateReadiness {
  readonly key: GateKey;
  readonly result: 'PASSED' | 'FAILED' | 'INDETERMINATE' | 'NOT_EVALUATED';
}

export interface LifecycleTransition {
  readonly from: LifecycleState;
  readonly to: LifecycleState;
  /** Gates that must have PASSED. Every one, not any one. */
  readonly gates: readonly GateKey[];
  /** An approval subject that must be granted and current, if any. */
  readonly approval?: ApprovableSubject;
  /** Roles permitted to make this move at all, beyond the permission check. */
  readonly restrictedTo?: readonly ProjectRole[];
  /** Why this edge requires what it requires. Shown to whoever is refused. */
  readonly why: string;
}

/**
 * Every allowed transition, and nothing else.
 *
 * Six of these are quoted from plan §6's examples. The other six are derived, and the derivation is
 * stated so it can be argued with: each edge requires the gates that share its stage's name, because
 * a gate is defined as the thing that says a stage is complete. Where the contract names no gate for
 * a step — starting discovery, beginning work once approved, archiving — the edge requires none,
 * rather than one being invented to look thorough.
 */
export const TRANSITIONS: readonly LifecycleTransition[] = [
  {
    from: 'IDEA',
    to: 'DISCOVERY',
    gates: [],
    why: 'Starting to look into an idea requires nothing. A gate here would only stop people beginning.',
  },
  {
    from: 'DISCOVERY',
    to: 'PLANNING',
    gates: ['DISCOVERY'],
    why: 'Discovery is finished when the discovery gate says so — that is what the gate is for.',
  },
  {
    from: 'PLANNING',
    to: 'PLANNED',
    gates: ['REQUIREMENTS', 'ARCHITECTURE', 'PLANNING'],
    why: 'A plan is not planned until what it must do, how it is shaped, and how it will be delivered are each settled. Three gates because they fail independently.',
  },
  {
    from: 'PLANNED',
    to: 'APPROVED',
    gates: [],
    approval: 'BASELINE',
    why: 'Plan §6: "PLANNED → APPROVED requires required approvals." Approving a plan is approving a baseline — a statement of what was agreed — so it is that approval, not a second kind.',
  },
  {
    from: 'APPROVED',
    to: 'IN_PROGRESS',
    gates: [],
    why: 'The approval to proceed has just been given. Requiring anything further here would be asking the same question twice.',
  },
  {
    from: 'IN_PROGRESS',
    to: 'VERIFYING',
    gates: ['DEVELOPMENT'],
    why: 'Plan §6: "IN_PROGRESS → VERIFYING requires development gate readiness."',
  },
  {
    from: 'VERIFYING',
    to: 'RELEASE_READY',
    gates: ['TESTING', 'SECURITY', 'RELEASE_READINESS'],
    why: 'Plan §6: "VERIFYING → RELEASE_READY requires testing/security/release gates."',
  },
  {
    from: 'RELEASE_READY',
    to: 'LIVE',
    gates: [],
    approval: 'DEPLOYMENT',
    why: 'Plan §6: "RELEASE_READY → LIVE requires deployment authorization." A deployment sign-off needs an engineer and the project owner, which is the one place two roles must both agree.',
  },
  {
    from: 'LIVE',
    to: 'OPERATING',
    gates: ['PRODUCTION_VERIFICATION', 'OPERATIONAL_READINESS'],
    why: 'Plan §6: "LIVE → OPERATING requires production verification." Operational readiness joins it because operating is what the stage is: being live is not the same as being run.',
  },
  {
    from: 'OPERATING',
    to: 'COMPLETED',
    gates: ['COMPLETION'],
    why: 'Plan §6: "OPERATING → COMPLETED requires handover/completion gate."',
  },
  {
    from: 'COMPLETED',
    to: 'ARCHIVED',
    gates: [],
    why: 'Archiving a completed project puts it beyond routine change. It removes capability rather than granting it, so it needs no gate.',
  },
  {
    from: 'ARCHIVED',
    to: 'COMPLETED',
    gates: [],
    restrictedTo: ['PROJECT_OWNER'],
    why: 'Gap-spec §71: an archive "may be restored by authorized role". The only backward edge in the machine, and it is a restore rather than a reversal — which is why it is restricted rather than gated.',
  },
];

export const TRANSITION_REFUSALS = [
  'NOT_A_TRANSITION',
  'ALREADY_IN_STATE',
  'GATE_NOT_PASSED',
  'APPROVAL_MISSING',
  'APPROVAL_STALE',
  'ROLE_NOT_PERMITTED',
] as const;

export type TransitionRefusal = (typeof TRANSITION_REFUSALS)[number];

export interface TransitionAllowed {
  readonly allowed: true;
  readonly transition: LifecycleTransition;
}

export interface TransitionRefused {
  readonly allowed: false;
  readonly refusal: TransitionRefusal;
  /** What is missing, named. Gate keys, or the approval subject, or the roles permitted. */
  readonly blocking: readonly string[];
  /** Safe to show a user: says what is missing, never why it might be bypassed. */
  readonly explanation: string;
}

export type TransitionVerdict = TransitionAllowed | TransitionRefused;

export interface TransitionContext {
  readonly gates: readonly GateReadiness[];
  readonly approvals: readonly Approval[];
  /** The project's current version, for deciding whether an approval is stale (§33). */
  readonly subjectVersion: number;
  /** The role of whoever is asking. Absent for a guest, who holds no project role. */
  readonly role?: ProjectRole;
}

/** The states reachable from here at all, ignoring whether their requirements are met. */
export function transitionsFrom(state: LifecycleState): readonly LifecycleTransition[] {
  return TRANSITIONS.filter((t) => t.from === state);
}

/**
 * Whether a project may move from one state to another, and if not, what is missing.
 *
 * Pure: every input is passed in. That is what makes the golden transition tests plan §6 asks for
 * possible — 144 ordered pairs, each with a stated expectation, none of which needs a database.
 */
export function evaluateTransition(
  from: LifecycleState,
  to: LifecycleState,
  context: TransitionContext,
): TransitionVerdict {
  if (from === to) {
    return {
      allowed: false,
      refusal: 'ALREADY_IN_STATE',
      blocking: [],
      explanation: `The project is already ${humanise(to)}.`,
    };
  }

  const transition = TRANSITIONS.find((t) => t.from === from && t.to === to);

  if (transition === undefined) {
    /*
     * Deny by default. The refusal deliberately does not list what *is* reachable — that belongs on
     * the screen, where it can be shown as the available actions, not in an error where it reads as
     * a hint about what to try next.
     */
    return {
      allowed: false,
      refusal: 'NOT_A_TRANSITION',
      blocking: [],
      explanation: `A project cannot move from ${humanise(from)} to ${humanise(to)}.`,
    };
  }

  if (transition.restrictedTo !== undefined) {
    if (context.role === undefined || !transition.restrictedTo.includes(context.role)) {
      return {
        allowed: false,
        refusal: 'ROLE_NOT_PERMITTED',
        blocking: [...transition.restrictedTo],
        explanation: `Only ${transition.restrictedTo.map(humanise).join(' or ')} can do that.`,
      };
    }
  }

  /*
   * A gate must have PASSED. `INDETERMINATE` and `NOT_EVALUATED` are refusals, not neutrality.
   *
   * This is §15.9's rule applied to the thing that consumes gates: a check nobody ran is not a check
   * that succeeded, and the two must never read alike, because the second is the one that gets
   * quietly treated as the first.
   */
  const unmetGates = transition.gates.filter(
    (key) => context.gates.find((g) => g.key === key)?.result !== 'PASSED',
  );

  if (unmetGates.length > 0) {
    return {
      allowed: false,
      refusal: 'GATE_NOT_PASSED',
      blocking: [...unmetGates],
      explanation: `${unmetGates.length === 1 ? 'This gate has' : 'These gates have'} not passed: ${unmetGates
        .map(humanise)
        .join(', ')}.`,
    };
  }

  if (transition.approval !== undefined) {
    const subject = transition.approval;
    const granted = context.approvals.filter(
      (a) => a.subjectType === subject && a.state === 'APPROVED',
    );

    if (granted.length === 0) {
      return {
        allowed: false,
        refusal: 'APPROVAL_MISSING',
        blocking: [subject],
        explanation: `A ${humanise(subject)} approval is required and has not been given.`,
      };
    }

    /*
     * Every granted approval must still be current, not merely one of them.
     *
     * A sign-off can require several roles (`SIGN_OFF`), and if one approver signed before a change
     * and another after, the older signature is about a different plan. Accepting the set because
     * *some* member is current is how a multi-party sign-off silently becomes a single-party one.
     */
    if (granted.every((a) => isStale(a, context.subjectVersion))) {
      return {
        allowed: false,
        refusal: 'APPROVAL_STALE',
        blocking: [subject],
        explanation: `The ${humanise(subject)} approval was given for an earlier version of this project and no longer applies.`,
      };
    }
  }

  return { allowed: true, transition };
}

/** `RELEASE_READY` → `release ready`. For sentences, not for identifiers. */
function humanise(value: string): string {
  return value.toLowerCase().replace(/_/g, ' ');
}
