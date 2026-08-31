/**
 * Identity resolution.
 *
 * Contract: gap-spec §6.1 — "Use provider-neutral OIDC architecture. Do not couple domain entities
 * directly to one identity provider. User identity key: issuer, subject."
 *
 * Nothing in this module names a provider. It accepts a verified claims object and resolves it to a
 * local user. Whoever verified the token — a hosted provider SDK, a JWKS verifier, an enterprise
 * SAML bridge — is the caller's problem, and swapping them changes nothing here. That is the whole
 * point of §6.1: the provider must stay replaceable.
 *
 * **This module never verifies a token.** It takes claims that have *already* been verified. Mixing
 * verification into resolution is how "we trusted the `sub` claim from an unverified JWT" happens.
 * The type is named `VerifiedIdentityClaims` so a caller passing unverified input has to lie about
 * it in writing.
 */

import { and, eq } from 'drizzle-orm';
import { AppError } from '@govintel/shared/errors';
import type { Database } from './client.ts';
import {
  memberships,
  organizations,
  projectMembers,
  users,
  type OrganizationRole,
  type ProjectRole,
  type User,
} from './schema.ts';

/**
 * Claims from an OIDC token whose signature, issuer, audience and expiry have already been checked.
 *
 * Only `issuer` and `subject` are load-bearing. Everything else is display metadata that may change
 * at any time and must never be used for identification or authorisation.
 */
export interface VerifiedIdentityClaims {
  /** The `iss` claim. Part of the identity key. */
  readonly issuer: string;
  /** The `sub` claim. Opaque and stable within an issuer. Part of the identity key. */
  readonly subject: string;
  /**
   * The `email` claim, if present. Stored for display and support only.
   *
   * Never an identity key: email is mutable, can be reassigned to a different person after an
   * employee leaves, and two issuers can assert the same address for two different people. Keying on
   * it is a well-trodden account-takeover route.
   */
  readonly email?: string;
  readonly displayName?: string;
  readonly avatarUrl?: string;
}

/** Reject obviously malformed claims before they reach the database. */
function assertUsableClaims(claims: VerifiedIdentityClaims): void {
  const problems: string[] = [];

  if (claims.issuer.trim().length === 0) problems.push('issuer');
  if (claims.subject.trim().length === 0) problems.push('subject');

  // An issuer must be a URL. A bare string would let two different providers collide on the same
  // issuer value, which would merge two unrelated people into one account.
  if (claims.issuer.trim().length > 0) {
    try {
      const url = new URL(claims.issuer);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') problems.push('issuer');
    } catch {
      problems.push('issuer');
    }
  }

  if (problems.length > 0) {
    throw new AppError({
      code: 'IDENTITY_CLAIMS_INVALID',
      category: 'AUTHENTICATION',
      safeMessage: 'Could not sign you in. Please try again.',
      // Names only. The claim values are attacker-influenced and end up in logs.
      details: { invalidClaims: problems },
    });
  }
}

export interface ResolvedIdentity {
  readonly user: User;
  /** True when this sign-in created the account rather than matching an existing one. */
  readonly created: boolean;
}

/**
 * Find or create the local user for a set of verified claims.
 *
 * Matching is on `(issuer, subject)` and nothing else. Profile fields are refreshed on every
 * sign-in, because the provider is authoritative for them and a stale display name is a support
 * annoyance rather than a security question.
 *
 * The upsert targets the `(issuer, subject)` unique index, so two concurrent first sign-ins for the
 * same person resolve to one row rather than racing to insert two.
 */
export async function resolveIdentity(
  db: Database,
  claims: VerifiedIdentityClaims,
  now: Date = new Date(),
): Promise<ResolvedIdentity> {
  assertUsableClaims(claims);

  const issuer = claims.issuer.trim();
  const subject = claims.subject.trim();

  const [existing] = await db
    .select()
    .from(users)
    .where(and(eq(users.issuer, issuer), eq(users.subject, subject)));

  if (existing !== undefined) {
    assertNotLocked(existing);

    const [refreshed] = await db
      .update(users)
      .set({
        ...(claims.email === undefined ? {} : { email: claims.email }),
        ...(claims.displayName === undefined ? {} : { displayName: claims.displayName }),
        ...(claims.avatarUrl === undefined ? {} : { avatarUrl: claims.avatarUrl }),
        updatedAt: now,
      })
      .where(eq(users.id, existing.id))
      .returning();

    return { user: refreshed ?? existing, created: false };
  }

  const [created] = await db
    .insert(users)
    .values({
      issuer,
      subject,
      ...(claims.email === undefined ? {} : { email: claims.email }),
      ...(claims.displayName === undefined ? {} : { displayName: claims.displayName }),
      ...(claims.avatarUrl === undefined ? {} : { avatarUrl: claims.avatarUrl }),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [users.issuer, users.subject],
      set: { updatedAt: now },
    })
    .returning();

  if (created === undefined) {
    throw new AppError({
      code: 'IDENTITY_RESOLVE_FAILED',
      category: 'INTERNAL',
      safeMessage: 'Could not sign you in. Please try again.',
    });
  }

  assertNotLocked(created);

  // `created` is false when the upsert hit the conflict branch — a concurrent first sign-in won the
  // race. The distinction matters: the caller uses it to decide whether to run first-run setup.
  return { user: created, created: created.createdAt.getTime() === now.getTime() };
}

function assertNotLocked(user: User): void {
  if (user.lockedAt !== null) {
    throw new AppError({
      code: 'ACCOUNT_LOCKED',
      category: 'AUTHENTICATION',
      // Deliberately vague. Confirming that an account exists and is locked is an enumeration
      // oracle, and telling an attacker their lockout worked is free information.
      safeMessage: 'Could not sign you in. Please contact support.',
      details: { userId: user.id, lockedAt: user.lockedAt.toISOString() },
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Membership lookup                                                          */
/* -------------------------------------------------------------------------- */

export interface UserOrganization {
  readonly organizationId: string;
  readonly name: string;
  readonly slug: string;
  readonly role: OrganizationRole;
}

/** Organisations the user belongs to. The basis of every subsequent tenant scope. */
export async function organizationsForUser(
  db: Database,
  userId: string,
): Promise<readonly UserOrganization[]> {
  return db
    .select({
      organizationId: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .where(eq(memberships.userId, userId));
}

/**
 * The user's role in one organisation, or undefined if they are not a member.
 *
 * `undefined` is the important return value: it is what makes a non-member indistinguishable from
 * a member with no permissions at the authorisation layer, and it feeds `deny by default`.
 */
export async function organizationRoleFor(
  db: Database,
  userId: string,
  organizationId: string,
): Promise<OrganizationRole | undefined> {
  const [row] = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.organizationId, organizationId)));

  return row?.role;
}

/** The user's role on one project, or undefined if they are not a project member. */
export async function projectRoleFor(
  db: Database,
  userId: string,
  projectId: string,
  organizationId: string,
): Promise<ProjectRole | undefined> {
  const [row] = await db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.userId, userId),
        eq(projectMembers.projectId, projectId),
        // The tenant predicate is included even though `projectId` is already unique. If a project
        // id from another tenant is supplied, this returns nothing rather than a role — the row
        // exists, and without this clause the caller would receive authority over it.
        eq(projectMembers.organizationId, organizationId),
      ),
    );

  return row?.role;
}
