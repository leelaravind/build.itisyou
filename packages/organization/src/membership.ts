/**
 * Organisation membership.
 *
 * The rules here are short, and every one of them exists because of a way an organisation locks
 * itself out, gives itself away, or quietly loses the ability to say no.
 *
 * The one worth naming up front is **the last owner**. An organisation with no owner cannot add one,
 * because adding one requires being one. It is not recoverable through the product — it needs
 * somebody with database access, which is exactly the situation a tenanted system is built to avoid.
 * So the last owner cannot be removed or demoted, and the refusal says why rather than saying "not
 * permitted".
 *
 * Contract: gap-spec §7.1 (tenant hierarchy), §7.2 (organisation roles), §7.3 (project roles).
 */

import type { OrganizationRole, ProjectRole } from '@govintel/db/schema';

/* -------------------------------------------------------------------------- */
/* Members                                                                    */
/* -------------------------------------------------------------------------- */

export interface Member {
  readonly userId: string;
  readonly organizationId: string;
  readonly role: OrganizationRole;
  readonly joinedAt: string;
  /** Whether the person has accepted. An invited member is not yet a member. */
  readonly accepted: boolean;
}

export interface ProjectMember {
  readonly userId: string;
  readonly projectId: string;
  readonly role: ProjectRole;
}

/**
 * An invitation.
 *
 * `invitedBy` is required for the same reason every decision in this platform names somebody: an
 * invitation nobody sent cannot be questioned, and the interesting question about an unexpected
 * member is always who let them in.
 */
export interface Invitation {
  readonly id: string;
  readonly organizationId: string;
  readonly email: string;
  readonly role: OrganizationRole;
  readonly invitedBy: string;
  readonly invitedAt: string;
  /** ISO date. Compared against the caller's `asOf`; never a clock read here. */
  readonly expiresOn: string;
  readonly state: InvitationState;
}

/**
 * `REVOKED` is distinct from `EXPIRED`.
 *
 * Revoked means somebody decided this person should not join. Expired means nobody acted. Collapsing
 * them loses the difference between a decision and an oversight, and only one of the two should be
 * re-sent without a conversation.
 */
export const INVITATION_STATES = ['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED'] as const;

export type InvitationState = (typeof INVITATION_STATES)[number];

/* -------------------------------------------------------------------------- */
/* Refusals                                                                   */
/* -------------------------------------------------------------------------- */

export const MEMBERSHIP_REFUSALS = [
  'LAST_OWNER',
  'NOT_PERMITTED',
  'SELF_DEMOTION',
  'ALREADY_A_MEMBER',
  'INVITATION_EXPIRED',
  'INVITATION_NOT_PENDING',
  'CANNOT_GRANT_ABOVE_OWN_ROLE',
  'AUDITOR_CANNOT_HOLD_A_PROJECT_ROLE',
] as const;

export type MembershipRefusal = (typeof MEMBERSHIP_REFUSALS)[number];

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly refusal: MembershipRefusal; readonly reason: string };

/* -------------------------------------------------------------------------- */
/* Role ordering                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Organisation roles by authority.
 *
 * `AUDITOR` sits outside the ladder deliberately. It is not "less than a member" — it is a different
 * *kind* of access: broad read, including things a MEMBER cannot see, and no write anywhere. Ranking
 * it below MEMBER would let an admin quietly grant audit visibility as a demotion.
 */
const AUTHORITY: Readonly<Record<OrganizationRole, number>> = {
  OWNER: 3,
  ADMIN: 2,
  MEMBER: 1,
  AUDITOR: 1,
};

/**
 * Whether a granter may assign a role.
 *
 * Nobody may grant a role above their own. Without this, an admin can make somebody an owner and then
 * be removed by them — privilege escalation by two hops, using only permitted operations.
 */
export function mayGrant(granter: OrganizationRole, target: OrganizationRole): boolean {
  if (granter !== 'OWNER' && granter !== 'ADMIN') return false;
  return AUTHORITY[granter] >= AUTHORITY[target];
}

/* -------------------------------------------------------------------------- */
/* Changes                                                                    */
/* -------------------------------------------------------------------------- */

export interface RoleChange {
  readonly actorId: string;
  readonly actorRole: OrganizationRole;
  readonly targetUserId: string;
  readonly newRole: OrganizationRole;
}

export function changeRole(
  members: readonly Member[],
  change: RoleChange,
): Result<readonly Member[]> {
  const target = members.find((m) => m.userId === change.targetUserId);

  if (target === undefined) {
    return {
      ok: false,
      refusal: 'NOT_PERMITTED',
      reason: 'That person is not a member of this organisation.',
    };
  }

  if (!mayGrant(change.actorRole, change.newRole)) {
    return {
      ok: false,
      refusal: 'CANNOT_GRANT_ABOVE_OWN_ROLE',
      reason: `A ${change.actorRole.toLowerCase()} cannot grant ${change.newRole.toLowerCase()}. Otherwise an admin could make somebody an owner and then be removed by them — an escalation using only permitted operations.`,
    };
  }

  if (
    change.actorId === change.targetUserId &&
    AUTHORITY[change.newRole] < AUTHORITY[target.role]
  ) {
    /*
     * Self-demotion.
     *
     * Refused not because it is dangerous in itself but because it is the second half of the
     * last-owner problem: the sole owner demoting themselves leaves an organisation nobody can
     * administer, and the person who did it can no longer undo it.
     */
    return {
      ok: false,
      refusal: 'SELF_DEMOTION',
      reason:
        'Ask somebody else to change your role. Demoting yourself is the one change you cannot undo, and if you are the last owner it leaves an organisation nobody can administer.',
    };
  }

  if (isLastOwner(members, change.targetUserId) && change.newRole !== 'OWNER') {
    return lastOwnerRefusal();
  }

  return {
    ok: true,
    value: members.map((member) =>
      member.userId === change.targetUserId ? { ...member, role: change.newRole } : member,
    ),
  };
}

export function removeMember(
  members: readonly Member[],
  actorRole: OrganizationRole,
  targetUserId: string,
): Result<readonly Member[]> {
  if (actorRole !== 'OWNER' && actorRole !== 'ADMIN') {
    return {
      ok: false,
      refusal: 'NOT_PERMITTED',
      reason: `A ${actorRole.toLowerCase()} cannot remove members.`,
    };
  }

  if (isLastOwner(members, targetUserId)) return lastOwnerRefusal();

  const target = members.find((m) => m.userId === targetUserId);

  if (target?.role === 'OWNER' && actorRole !== 'OWNER') {
    return {
      ok: false,
      refusal: 'NOT_PERMITTED',
      reason: 'An admin cannot remove an owner. Otherwise the ordering of authority is decoration.',
    };
  }

  return { ok: true, value: members.filter((m) => m.userId !== targetUserId) };
}

/** Whether removing or demoting this person would leave the organisation with no owner. */
export function isLastOwner(members: readonly Member[], userId: string): boolean {
  const owners = members.filter((m) => m.role === 'OWNER' && m.accepted);
  return owners.length === 1 && owners[0]?.userId === userId;
}

function lastOwnerRefusal(): Result<never> {
  return {
    ok: false,
    refusal: 'LAST_OWNER',
    reason:
      'This is the only owner. An organisation with no owner cannot appoint one, because appointing an owner requires being one — so this is not recoverable through the product, only through database access. Make somebody else an owner first.',
  };
}

/* -------------------------------------------------------------------------- */
/* Invitations                                                                */
/* -------------------------------------------------------------------------- */

export function accept(
  invitation: Invitation,
  members: readonly Member[],
  userId: string,
  asOf: string,
): Result<readonly Member[]> {
  if (invitation.state !== 'PENDING') {
    return {
      ok: false,
      refusal: 'INVITATION_NOT_PENDING',
      reason:
        invitation.state === 'REVOKED'
          ? 'This invitation was revoked. Somebody decided this person should not join, which is different from an invitation nobody acted on.'
          : `This invitation is ${invitation.state.toLowerCase()}.`,
    };
  }

  if (invitation.expiresOn < asOf) {
    /*
     * Reported rather than silently treated as revoked.
     *
     * Expiry means nobody acted; revocation means somebody decided. Only one of the two should be
     * re-sent without a conversation first.
     */
    return {
      ok: false,
      refusal: 'INVITATION_EXPIRED',
      reason: `This invitation expired on ${invitation.expiresOn}. Nobody revoked it — it simply ran out, so it can be re-sent.`,
    };
  }

  if (members.some((m) => m.userId === userId)) {
    return {
      ok: false,
      refusal: 'ALREADY_A_MEMBER',
      reason:
        'Already a member. Accepting again would either create a duplicate membership or silently change their existing role, and neither is what anybody intended.',
    };
  }

  return {
    ok: true,
    value: [
      ...members,
      {
        userId,
        organizationId: invitation.organizationId,
        role: invitation.role,
        joinedAt: asOf,
        accepted: true,
      },
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* Project membership                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Whether an organisation role may hold a project role at all.
 *
 * `AUDITOR` may not. An auditor's value is that they are outside the work — they read everything and
 * change nothing — and giving them a project role would make them a participant in something they
 * are meant to be able to examine independently. The platform cannot enforce independence, and it can
 * decline to record the arrangement that destroys it.
 */
export function mayHoldProjectRole(organizationRole: OrganizationRole): boolean {
  return organizationRole !== 'AUDITOR';
}

export function assignProjectRole(
  organizationRole: OrganizationRole,
  actorRole: OrganizationRole,
  assignment: ProjectMember,
): Result<ProjectMember> {
  if (actorRole !== 'OWNER' && actorRole !== 'ADMIN') {
    return {
      ok: false,
      refusal: 'NOT_PERMITTED',
      reason: `A ${actorRole.toLowerCase()} cannot assign project roles.`,
    };
  }

  if (!mayHoldProjectRole(organizationRole)) {
    return {
      ok: false,
      refusal: 'AUDITOR_CANNOT_HOLD_A_PROJECT_ROLE',
      reason:
        'An auditor reads everything and changes nothing, and that separation is the whole value. Giving them a project role makes them a participant in work they are meant to examine independently.',
    };
  }

  return { ok: true, value: assignment };
}
