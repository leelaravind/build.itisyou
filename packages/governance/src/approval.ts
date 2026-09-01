/**
 * Approvals and sign-offs.
 *
 * §33 opens with "Approval is separate from normal task completion", and that separation is the whole
 * idea. Finishing the work and deciding to accept it are two acts by (usually) two people, and a
 * system that treats a completed task as an approved one has quietly removed the second one.
 *
 * The field carrying the most weight is `subjectVersion`. An approval is a decision about a specific
 * version of a specific thing. §33 ends with "if subject changes after approval: approval becomes
 * stale/invalid as policy dictates", and the policy chosen here is the strict one — a materially
 * changed subject **invalidates** the approval rather than ageing it gracefully.
 *
 * The reason is that the alternative puts somebody's name on a decision they did not make. An
 * approver who signed off version 3 has not signed off version 7, and any system that treats their
 * approval as still standing is making a claim about a person. That is worse than an inconvenient
 * re-approval, and it is the kind of error nobody discovers until it matters.
 *
 * Contract: gap-spec §33, §29.2 (baseline approval), §15.8 (release approval).
 */

/* -------------------------------------------------------------------------- */
/* Shape                                                                      */
/* -------------------------------------------------------------------------- */

/** What can be approved. Deny-by-default: anything absent cannot be the subject of an approval. */
export const APPROVABLE_SUBJECTS = [
  'GATE',
  'MILESTONE',
  'BASELINE',
  'CHANGE_REQUEST',
  'DEPLOYMENT',
  'DOCUMENT',
] as const;

export type ApprovableSubject = (typeof APPROVABLE_SUBJECTS)[number];

/**
 * States, with `WITHDRAWN` distinct from `REJECTED`.
 *
 * Rejected means the approver considered it and said no. Withdrawn means the request was pulled
 * before they decided. Collapsing them attributes a decision to somebody who never made one, which is
 * the same failure as treating a stale approval as current, in a smaller way.
 */
export const APPROVAL_STATES = [
  'REQUESTED',
  'APPROVED',
  'REJECTED',
  'WITHDRAWN',
  'INVALIDATED',
] as const;

export type ApprovalState = (typeof APPROVAL_STATES)[number];

export const APPROVAL_STATE_MEANING: Readonly<Record<ApprovalState, string>> = {
  REQUESTED: 'Waiting on somebody. Not an approval, and not a rejection.',
  APPROVED: 'A named person accepted a specific version of a specific thing.',
  REJECTED: 'A named person considered it and said no. That is a decision and it is retained.',
  WITHDRAWN: 'Pulled before anybody decided. Nobody said no; nobody said yes.',
  INVALIDATED:
    'The subject changed materially after this was given. The approver approved something else, and treating this as still standing would put their name on a choice they did not make.',
};

export interface Approval {
  readonly id: string;
  readonly projectId: string;
  readonly subjectType: ApprovableSubject;
  readonly subjectId: string;
  /**
   * The version of the subject that was approved.
   *
   * The single most important field here. Without it, "approved" is a claim with no scope, and the
   * only honest reading of it is "somebody approved this at some point".
   */
  readonly subjectVersion: number;

  readonly requestedBy: string;
  readonly requestedAt: string;
  /** The role required to decide this, decided by policy rather than by the requester. */
  readonly approverRole: string;

  readonly state: ApprovalState;
  readonly approverUser?: string;
  readonly decidedAt?: string;
  /** Why. Required on any decision, including approval — see `decide`. */
  readonly comment?: string;

  /** Evidence supporting the decision. */
  readonly evidence: readonly string[];
}

/* -------------------------------------------------------------------------- */
/* Deciding                                                                   */
/* -------------------------------------------------------------------------- */

export const APPROVAL_REFUSALS = [
  'ALREADY_DECIDED',
  'APPROVER_IS_REQUESTER',
  'NO_APPROVER',
  'NO_REASON_FOR_REJECTION',
  'SUBJECT_MOVED',
] as const;

export type ApprovalRefusal = (typeof APPROVAL_REFUSALS)[number];

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly refusal: ApprovalRefusal; readonly reason: string };

export interface Decision {
  readonly outcome: 'APPROVED' | 'REJECTED';
  readonly approverUser: string;
  readonly decidedAt: string;
  readonly comment?: string;
  readonly evidence?: readonly string[];
  /** The subject version as it stands now. Compared against what was requested. */
  readonly subjectVersionNow: number;
}

export function decide(approval: Approval, decision: Decision): Result<Approval> {
  if (approval.state !== 'REQUESTED') {
    return {
      ok: false,
      refusal: 'ALREADY_DECIDED',
      reason: `This is ${approval.state.toLowerCase()}. ${APPROVAL_STATE_MEANING[approval.state]}`,
    };
  }

  if (decision.approverUser.trim() === '') {
    return {
      ok: false,
      refusal: 'NO_APPROVER',
      reason:
        'An approval with no named approver is a state change nobody made. §33 requires the approver user because the point of an approval is that somebody is accountable for it.',
    };
  }

  if (decision.approverUser.trim() === approval.requestedBy.trim()) {
    return {
      ok: false,
      refusal: 'APPROVER_IS_REQUESTER',
      reason:
        'The person who asked cannot be the person who decides. Self-approval records a decision with nobody independent behind it, which is worse than no approval at all, because the record looks complete.',
    };
  }

  if (decision.outcome === 'REJECTED' && (decision.comment ?? '').trim() === '') {
    /*
     * Rejection requires a reason and approval does not, which is deliberate asymmetry.
     *
     * A rejection with no reason cannot be acted on — the requester has no idea what would make it
     * acceptable, so the next attempt is a guess. An approval with no comment is complete on its own:
     * the thing was found acceptable as it stood.
     */
    return {
      ok: false,
      refusal: 'NO_REASON_FOR_REJECTION',
      reason:
        'A rejection with no reason leaves the requester guessing at what would make it acceptable, so the next attempt is a guess too. Approval needs no comment; rejection does.',
    };
  }

  if (decision.subjectVersionNow !== approval.subjectVersion) {
    /*
     * The subject moved between the request and the decision.
     *
     * The approver is looking at version 7 and the request was raised against version 3. Recording
     * their decision against 3 would misattribute it; recording it against 7 would claim they
     * reviewed a request nobody showed them. Neither is acceptable, so the request has to be raised
     * again against what they actually looked at.
     */
    return {
      ok: false,
      refusal: 'SUBJECT_MOVED',
      reason: `This was requested against version ${String(approval.subjectVersion)} and the subject is now at version ${String(decision.subjectVersionNow)}. Recording the decision against either version would claim something untrue about what the approver reviewed.`,
    };
  }

  return {
    ok: true,
    value: {
      ...approval,
      state: decision.outcome,
      approverUser: decision.approverUser,
      decidedAt: decision.decidedAt,
      ...(decision.comment === undefined ? {} : { comment: decision.comment }),
      evidence: decision.evidence ?? approval.evidence,
    },
  };
}

/**
 * Withdraw an undecided request.
 *
 * Only from `REQUESTED`. Withdrawing a decided approval would erase a decision somebody made, which
 * is what `INVALIDATED` is for — that records the subject moving, not the decision being taken back.
 */
export function withdraw(approval: Approval, reason: string): Result<Approval> {
  if (approval.state !== 'REQUESTED') {
    return {
      ok: false,
      refusal: 'ALREADY_DECIDED',
      reason: `This is ${approval.state.toLowerCase()} and withdrawing it would erase a decision somebody made. ${APPROVAL_STATE_MEANING[approval.state]}`,
    };
  }

  return { ok: true, value: { ...approval, state: 'WITHDRAWN', comment: reason } };
}

/* -------------------------------------------------------------------------- */
/* Staleness                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Whether an approval still applies to its subject as it stands.
 *
 * §33: "If subject changes after approval: approval becomes stale/invalid as policy dictates." The
 * policy here is strict, and the reason is that the lenient version makes a claim about a person.
 *
 * Only `APPROVED` can go stale. A rejection does not become invalid because the thing changed — it
 * records what somebody thought of the version they saw, and that remains true.
 */
export function isStale(approval: Approval, subjectVersionNow: number): boolean {
  if (approval.state !== 'APPROVED') return false;
  return subjectVersionNow !== approval.subjectVersion;
}

/**
 * Mark a stale approval invalid.
 *
 * Returns `undefined` when nothing needs to change, so a caller sweeping every approval can tell
 * which ones it actually touched rather than rewriting them all.
 */
export function invalidateIfStale(
  approval: Approval,
  subjectVersionNow: number,
): Approval | undefined {
  if (!isStale(approval, subjectVersionNow)) return undefined;

  return {
    ...approval,
    state: 'INVALIDATED',
    comment: `${approval.subjectType.toLowerCase()} ${approval.subjectId} moved from version ${String(approval.subjectVersion)} to ${String(subjectVersionNow)} after this was approved. ${approval.approverUser ?? 'The approver'} approved the earlier version, and this is retained as the record of that.`,
  };
}

/* -------------------------------------------------------------------------- */
/* Sign-off                                                                   */
/* -------------------------------------------------------------------------- */

export interface SignOffRequirement {
  readonly subjectType: ApprovableSubject;
  /** Roles that must each approve. Every one, not any one. */
  readonly roles: readonly string[];
  readonly why: string;
}

/**
 * Where more than one person has to agree.
 *
 * Every named role must approve, not any one of them. "Any of" is how a multi-party sign-off quietly
 * becomes a single-party one: the fastest approver clears it and the others never look.
 */
export const SIGN_OFF: readonly SignOffRequirement[] = [
  {
    subjectType: 'DEPLOYMENT',
    roles: ['ENGINEERING_LEAD', 'PRODUCT_OWNER'],
    why: 'Shipping is both a technical judgement and a product one, and they are frequently in tension. One person holding both is one person deciding which of their own concerns wins.',
  },
  {
    subjectType: 'BASELINE',
    roles: ['PRODUCT_OWNER'],
    why: 'A baseline is a statement about what was agreed, so the person who agreed it signs it.',
  },
  {
    subjectType: 'CHANGE_REQUEST',
    roles: ['PRODUCT_OWNER'],
    why: 'A change alters what was agreed, which is the same person’s decision as agreeing it.',
  },
];

export interface SignOffStatus {
  readonly satisfied: boolean;
  readonly missing: readonly string[];
  readonly explanation: string;
}

export function signOffStatus(
  subjectType: ApprovableSubject,
  approvals: readonly Approval[],
  subjectVersionNow: number,
): SignOffStatus {
  const requirement = SIGN_OFF.find((r) => r.subjectType === subjectType);

  if (requirement === undefined) {
    return {
      satisfied: true,
      missing: [],
      explanation: `Nothing requires a sign-off for a ${subjectType.toLowerCase()}.`,
    };
  }

  // Only current approvals count. A stale one is not a sign-off, and counting it would let a
  // multi-party gate be satisfied by decisions made about a version nobody is shipping.
  const live = approvals.filter((a) => a.state === 'APPROVED' && !isStale(a, subjectVersionNow));

  const held = new Set(live.map((a) => a.approverRole));
  const missing = requirement.roles.filter((role) => !held.has(role));

  return {
    satisfied: missing.length === 0,
    missing,
    explanation:
      missing.length === 0
        ? `All ${String(requirement.roles.length)} required sign-off(s) are current.`
        : `Waiting on ${missing.join(' and ')}. ${requirement.why}`,
  };
}
