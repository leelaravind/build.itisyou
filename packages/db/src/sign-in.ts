/**
 * The database half of signing in: resolve the identity, find or create the account's organisation,
 * and carry a guest's work across — each step inside the tenant scope row-level security demands.
 *
 * Contract: gap-spec §5.4 (guest-to-account conversion keeps the same project and link), §6.1
 * (identity keyed on issuer and subject), §7 (tenant isolation), §88.
 *
 * ## Why this is its own module
 *
 * Signing in used to do all of this through the unscoped handle. That works on a superuser, which is
 * what PGlite runs the tests and the local sign-in journeys as, and fails on the role production
 * connects as — where `memberships`, `projects` and `audit_events` all *force* row-level security:
 *
 * - The membership insert for a new organisation violated the policy's `WITH CHECK`, so a first
 *   sign-in threw.
 * - The lookup of an existing user's membership returned nothing, so every sign-in tried to create
 *   another organisation.
 * - The guest conversion's `UPDATE projects` saw no rows, so it claimed nothing, silently.
 *
 * None of it surfaced because the sign-in journeys have only ever run against the embedded
 * database. Staging has no identity provider configured, so the deployed path had never executed.
 *
 * ## Adopt the guest's organisation, do not move rows out of it
 *
 * A guest session owns an organisation (KI-063), and everything the guest made — the project, its
 * twin, its evidence, its change requests, its audit trail — carries that organisation's key. Moving
 * them to a fresh organisation means rewriting the key on a dozen tables, and it cannot be done at
 * all under row-level security: an `UPDATE` that changes the tenant key must pass the policy for the
 * old row *and* the new one, and the scope names only one. The audit trail cannot be rewritten
 * anyway; it is immutable by trigger.
 *
 * So on a first sign-in the guest's organisation *becomes* the account's: it is renamed, the user
 * becomes its owner, and the projects drop their guest link. No row changes tenant, and nothing the
 * guest did goes out of sight.
 *
 * ## What this does not do yet
 *
 * A **returning** user already has an organisation. A guest session they hold alongside it is left
 * as it is — not converted, not deleted, still reachable by the guest cookie until it expires — and
 * the result says so, so the caller can tell them rather than let the work vanish. Merging it into
 * their existing organisation needs a privileged, audited transfer, which is recorded as a known
 * issue rather than improvised.
 */

import { eq } from 'drizzle-orm';
import { applyTenantScope, type Database } from './client.ts';
import { resolveIdentity, type VerifiedIdentityClaims } from './identity.ts';
import { guestSessions, memberships, organizations, projects } from './schema.ts';

export type GuestOutcome =
  /** No guest session came with the sign-in. */
  | 'NONE'
  /** First sign-in: the guest's organisation became the account's, with everything in it. */
  | 'ADOPTED'
  /** A replay of a sign-in that already adopted it. */
  | 'ALREADY_CONVERTED'
  /** The guest session had expired; its work is gone or about to be. */
  | 'EXPIRED'
  /** A returning user: their guest work stays with the guest session, untouched. */
  | 'KEPT_SEPARATE';

export interface AccountResult {
  readonly userId: string;
  readonly organizationId: string;
  readonly created: boolean;
  readonly guest: GuestOutcome;
  readonly projectsClaimed: number;
}

/** The slug that names an account's own organisation. Unique, so it doubles as the lookup key. */
export function accountSlug(userId: string): string {
  return `org-${userId}`;
}

export async function establishAccount(
  db: Database,
  claims: VerifiedIdentityClaims,
  guestSessionId: string | undefined,
  now: Date = new Date(),
): Promise<AccountResult> {
  // `users` and `organizations` are not tenant data: they are what says which tenant you are.
  const { user, created } = await resolveIdentity(db, claims, now);
  const slug = accountSlug(user.id);
  const name = claims.displayName ?? claims.email ?? 'My organisation';

  const findHome = async () =>
    (
      await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.slug, slug))
        .limit(1)
    )[0]?.id;

  let home = await findHome();
  let guest: GuestOutcome = 'NONE';
  let projectsClaimed = 0;

  if (guestSessionId !== undefined) {
    const [session] = await db
      .select()
      .from(guestSessions)
      .where(eq(guestSessions.id, guestSessionId))
      .limit(1);

    if (session === undefined) {
      guest = 'NONE';
    } else if (session.convertedAt !== null) {
      guest = 'ALREADY_CONVERTED';
    } else if (session.expiresAt <= now) {
      guest = 'EXPIRED';
    } else if (home !== undefined) {
      guest = 'KEPT_SEPARATE';
    } else {
      const adopted = await db.transaction(async (tx) => {
        /*
         * The lock serialises a double-submitted callback: the second waits for the first to commit,
         * then sees `converted_at` and adopts nothing. Taken before the scope, because
         * `guest_sessions` carries no policy and the lock is about the row, not the tenant.
         */
        const [locked] = await tx
          .select()
          .from(guestSessions)
          .where(eq(guestSessions.id, session.id))
          .for('update');

        if (locked?.convertedAt !== null) return undefined;

        await tx
          .update(organizations)
          .set({ name, slug })
          .where(eq(organizations.id, locked.organizationId));

        await tx
          .update(guestSessions)
          .set({ convertedToUserId: user.id, convertedAt: now, lastSeenAt: now })
          .where(eq(guestSessions.id, locked.id));

        // From here on the policy applies, exactly as it does to a request.
        await applyTenantScope(tx, locked.organizationId);

        await tx
          .insert(memberships)
          .values({ organizationId: locked.organizationId, userId: user.id, role: 'OWNER' });

        const claimed = await tx
          .update(projects)
          .set({ guestSessionId: null, updatedAt: now })
          .where(eq(projects.guestSessionId, locked.id))
          .returning({ id: projects.id });

        return { organizationId: locked.organizationId, claimed: claimed.length };
      });

      if (adopted === undefined) {
        guest = 'ALREADY_CONVERTED';
        home = await findHome();
      } else {
        guest = 'ADOPTED';
        home = adopted.organizationId;
        projectsClaimed = adopted.claimed;
      }
    }
  }

  home ??= await db.transaction(async (tx) => {
    const [organization] = await tx
      .insert(organizations)
      .values({ name, slug })
      .returning({ id: organizations.id });

    if (organization === undefined) throw new Error('could not create an organisation');

    await applyTenantScope(tx, organization.id);
    // OWNER, because they created it. §7.2's roles are about who else joins later.
    await tx
      .insert(memberships)
      .values({ organizationId: organization.id, userId: user.id, role: 'OWNER' });

    return organization.id;
  });

  return { userId: user.id, organizationId: home, created, guest, projectsClaimed };
}
