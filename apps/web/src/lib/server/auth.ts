import 'server-only';

import { cache } from 'react';
import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import { memberships, organizations, users } from '@govintel/db/schema';
import { resolveIdentity } from '@govintel/db/identity';
import { convertGuestSession } from '@govintel/db/guest';
import { createSession, revokeSession, touchSession } from '@govintel/db/session';
import { logger } from '@govintel/shared/logging';
import { withUnscoped } from './database.ts';
import { sign, unsign } from './signed-cookie.ts';
import { SESSION_COOKIE, guestCookieOptions } from './guest-cookie.ts';
import { recordAudit } from './audit.ts';
import type { CallbackRefusal, VerifiedIdentity } from './oidc.ts';

/**
 * Signing in, staying signed in, and signing out.
 *
 * Contract: gap-spec §6.1 (provider-neutral identity), §6.3 (session controls), §5.4 (guest to
 * account conversion), plan §20 (authentication is an audited event).
 *
 * This is the layer that joins four things that already existed separately and had never met:
 * `oidc.ts` verifies a token, `identity.ts` turns verified claims into a user, `session.ts` holds the
 * session, and `guest.ts` moves a guest's work onto their new account.
 */

export { SESSION_COOKIE } from './guest-cookie.ts';

/** Where the three OIDC secrets live between the redirect out and the callback back. */
export const OIDC_STATE_COOKIE = 'govintel_oidc';

/**
 * The transaction cookie for one sign-in attempt.
 *
 * Ten minutes: long enough for somebody to complete a provider's login including an MFA prompt,
 * short enough that an abandoned attempt does not leave a usable state value lying in a browser for
 * a day. `sameSite: 'lax'` because the provider redirects back with a top-level GET, which `strict`
 * would strip the cookie from — turning every real login into a state mismatch.
 */
export function oidcStateCookieOptions() {
  return { ...guestCookieOptions(600), sameSite: 'lax' as const };
}

/** The signed-in session cookie. Lives as long as the session's absolute window. */
export function sessionCookieOptions(seconds: number) {
  return guestCookieOptions(seconds);
}

export interface SignedInUser {
  readonly userId: string;
  readonly organizationId: string;
  readonly sessionId: string;
  readonly email: string | null;
  readonly displayName: string | null;
}

/**
 * The caller's signed-in user, or `undefined`.
 *
 * Memoised per request, like the guest session, because it is a database round trip that several
 * layers ask for independently.
 *
 * Every read re-decides validity: expired, revoked, or a locked account all resolve to nothing. That
 * is what makes revocation take effect immediately rather than at the next sign-in — the difference
 * between a session you can end and one you can only stop renewing.
 */
export const currentUser = cache(async (): Promise<SignedInUser | undefined> => {
  const store = await cookies();
  const sessionId = unsign(store.get(SESSION_COOKIE)?.value);

  if (sessionId === undefined) return undefined;

  return withUnscoped(async (db) => {
    const session = await touchSession(db, sessionId);
    if (session === undefined) return undefined;

    const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);

    if (user === undefined) return undefined;

    /*
     * A locked account ends its sessions rather than waiting for them to expire.
     *
     * `resolveIdentity` refuses a locked account at sign-in, which stops new sessions; without this
     * an account locked during a session stays usable for up to twelve hours, which is most of the
     * window in which locking it mattered.
     */
    if (user.lockedAt !== null) return undefined;

    return {
      userId: user.id,
      organizationId: session.organizationId,
      sessionId: session.id,
      email: user.email,
      displayName: user.displayName,
    };
  });
});

export type SignInResult =
  | { readonly ok: true; readonly redirectTo: string }
  | { readonly ok: false; readonly refusal: CallbackRefusal | 'LOCKED' | 'FAILED' };

/**
 * Turn a verified identity into a signed-in session, carrying the guest's work across.
 *
 * The order matters and is not obvious: the user and their organisation must exist before the guest
 * conversion, because the conversion reassigns projects *to* that organisation — and the session is
 * created last, so a failure anywhere leaves the caller a guest rather than signed in to an account
 * whose work did not arrive.
 */
export async function completeSignIn(
  identity: VerifiedIdentity,
  guestSessionId: string | undefined,
): Promise<SignInResult> {
  try {
    const outcome = await withUnscoped(async (db) => {
      const { user, created } = await resolveIdentity(db, identity);

      const organizationId = await ensureOrganization(db, user.id, identity, created);

      /*
       * Carry the guest's work over (§5.4).
       *
       * Best effort by design: a guest session that has expired or was already converted must not
       * stop somebody signing in. `convertGuestSession` is idempotent for the replayed case, and the
       * failure mode worth avoiding here is refusing a valid login because of a stale cookie.
       */
      let claimed = 0;

      if (guestSessionId !== undefined) {
        try {
          const result = await convertGuestSession(db, {
            guestSessionId,
            userId: user.id,
            organizationId,
          });
          claimed = result.projects.length;
        } catch (error) {
          logger.warn('guest conversion skipped during sign-in', {
            err: String(error),
            userId: user.id,
          });
        }
      }

      const session = await createSession(db, { userId: user.id, organizationId });

      await recordAudit(db, {
        organizationId,
        action: created ? 'USER_REGISTERED' : 'USER_SIGNED_IN',
        entityType: 'USER',
        entityId: user.id,
        actorUserId: user.id,
        summary: {
          issuer: identity.issuer,
          // The subject is the identity key, not a secret, and without it an audit entry cannot be
          // matched to a provider's own logs during an incident.
          subject: identity.subject,
          projectsClaimed: claimed,
          firstSignIn: created,
        },
      });

      return { session, claimed };
    });

    const store = await cookies();
    const seconds = Math.floor((outcome.session.absoluteExpiresAt.getTime() - Date.now()) / 1000);

    store.set(SESSION_COOKIE, sign(outcome.session.id), sessionCookieOptions(seconds));

    logger.info('signed in', { projectsClaimed: outcome.claimed });

    return { ok: true, redirectTo: '/portfolio' };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';

    // `resolveIdentity` throws for a locked account. That is a policy outcome, not a fault, and the
    // user is told their account is unavailable rather than shown a generic failure.
    if (message.includes('locked')) return { ok: false, refusal: 'LOCKED' };

    logger.error('sign-in failed', { err: String(error) });
    return { ok: false, refusal: 'FAILED' };
  }
}

/**
 * The organisation a newly signed-in user acts in.
 *
 * A first sign-in creates one, because a user with no tenant can reach nothing — every table in the
 * product is scoped by organisation, so "signed in with no organisation" is a state where the
 * application correctly shows an empty screen and the person cannot tell why.
 */
async function ensureOrganization(
  db: Parameters<Parameters<typeof withUnscoped>[0]>[0],
  userId: string,
  identity: VerifiedIdentity,
  created: boolean,
): Promise<string> {
  if (!created) {
    const [existing] = await db
      .select({ organizationId: memberships.organizationId })
      .from(memberships)
      .where(eq(memberships.userId, userId))
      .limit(1);

    if (existing !== undefined) return existing.organizationId;
  }

  const name = identity.displayName ?? identity.email ?? 'My organisation';

  const [organization] = await db
    .insert(organizations)
    .values({ name, slug: `org-${userId}` })
    .returning({ id: organizations.id });

  if (organization === undefined) throw new Error('could not create an organisation');

  // OWNER, because they created it. §7.2's roles are about who else joins later.
  await db.insert(memberships).values({ organizationId: organization.id, userId, role: 'OWNER' });

  return organization.id;
}

/**
 * Sign out.
 *
 * Revokes server-side *and* clears the cookie, in that order. Clearing alone would leave a valid
 * session id in whatever captured the cookie — so a copy taken beforehand would keep working, which
 * is precisely what somebody clicking "sign out" on a shared machine is trying to prevent.
 */
export async function signOut(): Promise<void> {
  const store = await cookies();
  const sessionId = unsign(store.get(SESSION_COOKIE)?.value);

  if (sessionId !== undefined) {
    await withUnscoped(async (db) => {
      const session = await touchSession(db, sessionId);
      await revokeSession(db, sessionId, 'LOGOUT');

      if (session !== undefined) {
        await recordAudit(db, {
          organizationId: session.organizationId,
          action: 'USER_SIGNED_OUT',
          entityType: 'SESSION',
          entityId: sessionId,
          actorUserId: session.userId,
        });
      }
    });
  }

  store.set(SESSION_COOKIE, '', { ...sessionCookieOptions(0), maxAge: 0 });
}
