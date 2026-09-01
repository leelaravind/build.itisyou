/**
 * Change requests, and the sequence §28 requires before a material change is applied.
 *
 * The spec lists ten steps. Nine of them are ordinary; one is the reason the list exists.
 *
 * Step 5 is "check optimistic concurrency", and it sits between showing the impact and applying the
 * change for a specific reason: **the impact was calculated against a project that may no longer
 * exist.** Somebody previews a change against version 12, goes to a meeting, comes back and approves
 * it. Meanwhile the project is at version 15. Applying now applies a decision that was made about a
 * different project — the approver saw an impact report that is no longer true, and their approval
 * carries their name on a choice they did not make.
 *
 * That is the failure this module exists to prevent, and it is invisible without the check: nothing
 * errors, the change applies cleanly, and the record shows an approval against an impact analysis
 * that never described the project it was applied to.
 *
 * The second decision here is that **the preview and the application share one plan**. `plan()`
 * produces it, `preview()` renders it, `apply()` executes it. A preview computed by separate code
 * from the application is a second implementation that can disagree with the first, and the
 * disagreement surfaces as "the system did something other than what it showed me".
 *
 * Contract: gap-spec §28 (atomicity), §27 (propagation), §49 (optimistic concurrency).
 */

import type { TwinGraph } from '@govintel/twin/graph';
import { analyseImpact, summariseImpact, type ChangedNode, type ImpactReport } from './impact.ts';

export const CHANGE_ENGINE_VERSION = '1.0.0';

/* -------------------------------------------------------------------------- */
/* States                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The life of a change request.
 *
 * `SUPERSEDED` exists because of the concurrency case above: a request whose base version has moved
 * on is not rejected — nobody decided against it — and it is not applicable either. Forcing it into
 * either of those loses the distinction between "we said no" and "the world moved".
 */
export const REQUEST_STATES = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'APPLIED',
  'REJECTED',
  'SUPERSEDED',
] as const;

export type RequestState = (typeof REQUEST_STATES)[number];

export const STATE_MEANING: Readonly<Record<RequestState, string>> = {
  DRAFT: 'Being written. Nothing has been calculated against it yet.',
  PENDING_APPROVAL: 'The impact has been calculated and shown, and somebody has to decide.',
  APPROVED: 'Decided, and not yet applied. Still subject to the concurrency check.',
  APPLIED: 'In the project, with a new version recorded.',
  REJECTED: 'Somebody decided against it. That is a decision and it is retained.',
  SUPERSEDED:
    'The project moved on before this was applied. Not rejected — nobody decided against it — and no longer applicable, because the impact was calculated against a project that no longer exists.',
};

/**
 * Which transitions are legal. Deny-by-default, like every other allowlist here.
 *
 * `APPROVED → PENDING_APPROVAL` is deliberately **absent**. If the base version moves, the request
 * becomes `SUPERSEDED` and a new one is raised. Silently returning it to pending would let an
 * approval be reused across a project version it was never given against, which is the whole thing
 * the concurrency check exists to stop.
 */
export const TRANSITIONS: Readonly<Record<RequestState, readonly RequestState[]>> = {
  DRAFT: ['PENDING_APPROVAL', 'REJECTED'],
  PENDING_APPROVAL: ['APPROVED', 'REJECTED', 'SUPERSEDED'],
  APPROVED: ['APPLIED', 'REJECTED', 'SUPERSEDED'],
  APPLIED: [],
  REJECTED: [],
  SUPERSEDED: [],
};

export function canTransition(from: RequestState, to: RequestState): boolean {
  return TRANSITIONS[from].includes(to);
}

/* -------------------------------------------------------------------------- */
/* The request                                                                */
/* -------------------------------------------------------------------------- */

export interface ChangeRequest {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  /** Why this is being asked for. A change request with no reason cannot be argued about. */
  readonly rationale: string;
  readonly state: RequestState;
  readonly changes: readonly ChangedNode[];
  /**
   * The project version the impact was calculated against.
   *
   * The single most important field on this type. Everything downstream — the impact report, the
   * approval, the reader's understanding — is about the project as it stood at this version.
   */
  readonly baseVersion: number;
  readonly requestedBy: string;
  readonly approvedBy?: string;
  readonly decisionReason?: string;
}

/* -------------------------------------------------------------------------- */
/* Refusals                                                                   */
/* -------------------------------------------------------------------------- */

export const REFUSALS = [
  'ILLEGAL_TRANSITION',
  'STALE_BASE_VERSION',
  'NOT_APPROVED',
  'NO_CHANGES',
  'NO_RATIONALE',
  'APPROVER_IS_REQUESTER',
  'UNKNOWN_NODE',
] as const;

export type Refusal = (typeof REFUSALS)[number];

export interface Rejection {
  readonly ok: false;
  readonly refusal: Refusal;
  readonly reason: string;
}

export type Result<T> = { readonly ok: true; readonly value: T } | Rejection;

/* -------------------------------------------------------------------------- */
/* The plan                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * What applying this request will do, computed once.
 *
 * `preview()` renders this and `apply()` executes it. They cannot disagree, because there is only one
 * of them — which is the point. A preview produced by separate code from the application is a second
 * implementation, and the first time they diverge the system does something other than what it showed.
 */
export interface ChangePlan {
  readonly requestId: string;
  readonly baseVersion: number;
  readonly impact: ImpactReport;
  /** Node ids whose staleness marking will change, with what it becomes. */
  readonly markings: readonly { readonly nodeId: string; readonly staleness: string }[];
  /** Approvals that will be invalidated. Separated because these have a person's name on them. */
  readonly invalidatedApprovals: readonly string[];
  /** Whether this needs an approval before it can be applied. */
  readonly requiresApproval: boolean;
  readonly summary: string;
}

/**
 * §28 steps 1–3: capture the current version, calculate the impact, and produce something to show.
 *
 * Returns a rejection rather than throwing for the cases a user can fix, because these are answers to
 * the user rather than programming errors — an exception here would be caught and turned back into a
 * message anyway, losing the specific refusal on the way.
 */
export function plan(
  graph: TwinGraph,
  request: ChangeRequest,
  currentVersion: number,
): Result<ChangePlan> {
  if (request.changes.length === 0) {
    return {
      ok: false,
      refusal: 'NO_CHANGES',
      reason:
        'A change request that changes nothing cannot be previewed, approved or applied. It would create a project version identical to the one before it, and a version history containing entries that changed nothing is one nobody trusts to be complete.',
    };
  }

  if (request.rationale.trim() === '') {
    return {
      ok: false,
      refusal: 'NO_RATIONALE',
      reason:
        'A change with no stated reason cannot be argued about, which means an approver has nothing to approve except the fact that somebody asked.',
    };
  }

  for (const change of request.changes) {
    if (graph.node(change.nodeId) === undefined) {
      return {
        ok: false,
        refusal: 'UNKNOWN_NODE',
        reason: `${change.nodeId} is not in this project. Calculating impact from a node that does not exist would produce an empty report, which reads identically to a change that affects nothing.`,
      };
    }
  }

  if (request.baseVersion !== currentVersion) {
    return {
      ok: false,
      refusal: 'STALE_BASE_VERSION',
      reason: `This was drawn up against version ${String(request.baseVersion)} and the project is now at version ${String(currentVersion)}. The impact would be calculated against a project that no longer exists.`,
    };
  }

  const impact = analyseImpact(graph, request.changes);
  const summary = summariseImpact(impact);

  const invalidatedApprovals = impact.impacted
    .filter((item) => item.nodeClass === 'APPROVAL' && item.staleness === 'INVALIDATED')
    .map((item) => item.nodeId);

  /*
   * What makes a change need approval.
   *
   * Not "is it big" — nobody agrees on that, and a size threshold is the kind of number people learn
   * to stay under. It needs approval when it invalidates something somebody already decided, or
   * breaks a claim the project is relying on. Both are facts about the graph rather than judgements.
   */
  const requiresApproval =
    invalidatedApprovals.length > 0 ||
    impact.impacted.some((item) => item.staleness === 'INVALIDATED' && item.actionable) ||
    request.changes.some((change) => change.kind === 'WITHDRAWAL');

  return {
    ok: true,
    value: {
      requestId: request.id,
      baseVersion: request.baseVersion,
      impact,
      markings: impact.impacted.map((item) => ({
        nodeId: item.nodeId,
        staleness: item.staleness,
      })),
      invalidatedApprovals,
      requiresApproval,
      summary: summary.headline,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Application                                                                */
/* -------------------------------------------------------------------------- */

export interface Application {
  readonly requestId: string;
  /** The version the project moves to. */
  readonly newVersion: number;
  readonly plan: ChangePlan;
  /** §28 step 8. One event per material effect, so the audit trail matches the impact report. */
  readonly auditEvents: readonly AuditEvent[];
  /**
   * §28 step 10. Named rather than performed: these are the things that must happen *after* the
   * transaction commits, and running them inside it would make a failed notification roll back a
   * successful change.
   */
  readonly followUp: readonly string[];
}

export interface AuditEvent {
  readonly kind: 'CHANGE_APPLIED' | 'NODE_MARKED' | 'APPROVAL_INVALIDATED' | 'VERSION_CREATED';
  readonly subjectId: string;
  readonly detail: string;
}

/**
 * §28 steps 5–9, as a decision rather than as a mutation.
 *
 * This function does not touch the database. It decides *whether* the change may be applied and
 * *what* applying it means, and the caller performs all of it in one transaction — which is what
 * step 6 requires and what "no partial project mutation" means.
 *
 * Separating the decision from the write is also what makes the ten-step sequence testable at all: a
 * function that both decided and wrote could only be tested against a database, and the concurrency
 * case would be the hardest thing in it to reach.
 */
export function apply(
  request: ChangeRequest,
  changePlan: ChangePlan,
  currentVersion: number,
): Result<Application> {
  if (!canTransition(request.state, 'APPLIED')) {
    return {
      ok: false,
      refusal: request.state === 'PENDING_APPROVAL' ? 'NOT_APPROVED' : 'ILLEGAL_TRANSITION',
      reason: `A request in ${request.state} cannot be applied. ${STATE_MEANING[request.state]}`,
    };
  }

  /*
   * The check the whole module exists for. §28 step 5.
   *
   * Deliberately compared against the *plan's* base version rather than the request's. If those two
   * ever diverge, the plan is the one that described what the approver saw, and it is the approver's
   * understanding that has to be protected.
   */
  if (changePlan.baseVersion !== currentVersion) {
    return {
      ok: false,
      refusal: 'STALE_BASE_VERSION',
      reason: `The impact was calculated against version ${String(changePlan.baseVersion)} and the project is now at version ${String(currentVersion)}. Applying now would apply a decision made about a project that no longer exists — the approver saw an impact report that is no longer true.`,
    };
  }

  if (changePlan.requiresApproval && request.approvedBy === undefined) {
    return {
      ok: false,
      refusal: 'NOT_APPROVED',
      reason:
        'This invalidates something somebody already decided, so it needs an approval before it can be applied.',
    };
  }

  if (request.approvedBy?.trim() === request.requestedBy.trim()) {
    return {
      ok: false,
      refusal: 'APPROVER_IS_REQUESTER',
      reason:
        'The person who asked for a change cannot be the person who approves it. Self-approval records a decision with nobody independent behind it, which is worse than no approval: the record looks complete.',
    };
  }

  const auditEvents: AuditEvent[] = [
    {
      kind: 'CHANGE_APPLIED',
      subjectId: request.id,
      detail: `${request.title} — ${request.rationale}`,
    },
    ...changePlan.markings.map((marking): AuditEvent => ({
      kind: 'NODE_MARKED',
      subjectId: marking.nodeId,
      detail: `Marked ${marking.staleness} by change ${request.id}.`,
    })),
    ...changePlan.invalidatedApprovals.map((approvalId): AuditEvent => ({
      kind: 'APPROVAL_INVALIDATED',
      subjectId: approvalId,
      detail: `The subject of this approval changed materially under ${request.id}, so the decision no longer applies to what was approved.`,
    })),
    {
      kind: 'VERSION_CREATED',
      subjectId: request.projectId,
      detail: `Version ${String(currentVersion + 1)} created by change ${request.id}.`,
    },
  ];

  return {
    ok: true,
    value: {
      requestId: request.id,
      newVersion: currentVersion + 1,
      plan: changePlan,
      auditEvents,
      followUp: followUpFor(changePlan),
    },
  };
}

/**
 * Work that must happen after the transaction commits, named rather than done.
 *
 * Running any of it inside the transaction would mean a failed notification rolls back a change that
 * succeeded, which is the wrong trade in both directions: the change is what matters, and a
 * notification is retryable.
 */
function followUpFor(changePlan: ChangePlan): readonly string[] {
  const out: string[] = [];

  if (changePlan.invalidatedApprovals.length > 0) {
    out.push(
      `Tell the ${String(changePlan.invalidatedApprovals.length)} approver(s) whose decision no longer applies. They put their name on something that has changed.`,
    );
  }

  const revalidation = changePlan.markings.filter(
    (m) => m.staleness === 'REVALIDATION_REQUIRED',
  ).length;

  if (revalidation > 0) {
    out.push(`Re-run or re-decide ${String(revalidation)} item(s) before relying on them again.`);
  }

  out.push('Recalculate derived values: estimates, budget roll-up, feasibility and health.');

  return out;
}

/**
 * Mark a request superseded when the project has moved past its base version.
 *
 * Separate from `apply` returning a refusal, because these answer different questions: `apply` says
 * "not now", and this records "not ever, in this form". Leaving stale requests in PENDING_APPROVAL
 * fills the queue with things that can never be applied, and people learn to ignore the queue.
 */
export function supersedeIfStale(
  request: ChangeRequest,
  currentVersion: number,
): ChangeRequest | undefined {
  if (request.baseVersion === currentVersion) return undefined;
  if (!canTransition(request.state, 'SUPERSEDED')) return undefined;

  return {
    ...request,
    state: 'SUPERSEDED',
    decisionReason: `The project moved from version ${String(request.baseVersion)} to ${String(currentVersion)} before this was applied. Nobody decided against it; the impact it was approved against no longer describes the project.`,
  };
}
